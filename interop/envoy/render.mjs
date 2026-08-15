/**
 * Renders the reference public route; applications own the gateway listener.
 */
import reservedSpineRpcPaths from "../../packages/server/src/server/reserved-spine-rpc-paths.json" with { type: "json" };

export function renderEnvoy(options) {
  const topology = normalize(options);
  const routes = [...spineRoutes, ...topology.authRoutes]
    .flatMap((route) => [
      route,
      { ...route, kind: "preflight" },
      { path: route.path, kind: "fallback" },
    ])
    .map((route) =>
      route.kind === "fallback"
        ? `                        - match: { path: ${route.path}, headers: [{ name: ":method", exact_match: OPTIONS }] }\n                          direct_response: { status: 204 }`
        : `                        - match: { path: ${route.path}, headers: [${
            route.kind === "preflight"
              ? `{ name: ":method", exact_match: OPTIONS }, { name: origin, present_match: true }, { name: access-control-request-method, exact_match: ${route.method} }`
              : `{ name: ":method", exact_match: ${route.method} }`
          }] }\n                          route: { cluster: gateway, timeout: ${route.timeout} }\n                          typed_per_filter_config:\n                            envoy.filters.http.buffer:\n                              "@type": type.googleapis.com/envoy.extensions.filters.http.buffer.v3.BufferPerRoute\n                              buffer: { max_request_bytes: ${route.maxRequestBytes} }`,
    )
    .join("\n");
  return `static_resources:
  listeners:
    - name: browser_gateway
      address:
        socket_address: { address: ${topology.listenAddress}, port_value: ${topology.listenPort} }
      filter_chains:
        - transport_socket:
            name: envoy.transport_sockets.tls
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext
              common_tls_context:
                tls_certificates:
                  - certificate_chain: { filename: ${topology.tlsCertificate} }
                    private_key: { filename: ${topology.tlsKey} }
          filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: browser_gateway
${topology.accessLog ? '                access_log:\n                  - name: envoy.access_loggers.stdout\n                    typed_config:\n                      "@type": type.googleapis.com/envoy.extensions.access_loggers.stream.v3.StdoutAccessLog\n' : ""}                stream_idle_timeout: 30s
                request_timeout: 30s
                max_request_headers_kb: 16
                route_config:
                  name: gateway_only
                  virtual_hosts:
                    - name: gateway
                      domains: ["*"]
                      routes:
${routes}
                      cors:
                        allow_origin_string_match:
                          - exact: ${topology.browserOrigin}
                        allow_credentials: true
                        allow_methods: GET, POST, OPTIONS
                        allow_headers: content-type,x-grpc-web,grpc-timeout,connect-protocol-version,connect-timeout-ms,authorization,x-user-agent,x-spine-csrf
                        expose_headers: grpc-status,grpc-message
                        max_age: "86400"
                        forward_not_matching_preflights: false
                http_filters:
                  - name: envoy.filters.http.buffer
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.buffer.v3.Buffer
                      max_request_bytes: 1048576
                  - name: envoy.filters.http.grpc_web
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.grpc_web.v3.GrpcWeb
                    # Connect application/json and application/proto requests pass through unchanged to the HTTP/2 gateway.
                  - name: envoy.filters.http.cors
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.cors.v3.Cors
                  - name: envoy.filters.http.router
                    typed_config:
                      "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  clusters:
    - name: gateway
      connect_timeout: 2s
      type: LOGICAL_DNS
      typed_extension_protocol_options:
        envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
          "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
          explicit_http_config:
            http2_protocol_options: {}
      load_assignment:
        cluster_name: gateway
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address: { address: ${topology.gatewayAddress}, port_value: ${topology.gatewayPort} }
`;
}

function normalize(options) {
  if (!options.browserOrigin?.startsWith("https://"))
    throw new Error("browser origin must use HTTPS");
  if (!options.tlsCertificate || !options.tlsKey)
    throw new Error("TLS certificate and key are required");
  return {
    listenAddress: options.listenAddress ?? "0.0.0.0",
    listenPort: options.listenPort ?? 8443,
    gatewayAddress: options.gatewayAddress ?? "127.0.0.1",
    gatewayPort: options.gatewayPort ?? 9443,
    browserOrigin: options.browserOrigin,
    tlsCertificate: options.tlsCertificate,
    tlsKey: options.tlsKey,
    accessLog: options.accessLog === true,
    authRoutes: (options.authRoutes ?? []).map((route) => {
      if (reservedSpineRpcPaths.includes(route.path))
        throw new Error("auth routes must not use reserved Spine RPC paths");
      if (
        !/^[A-Z]+$/.test(route.method) ||
        !/^\/(?!\/)(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(route.path)
      )
        throw new Error("auth routes require an exact method and canonical path");
      if (!Number.isSafeInteger(route.timeoutMs) || route.timeoutMs < 1)
        throw new Error("auth routes require a finite timeout");
      if (!Number.isSafeInteger(route.maxRequestBytes) || route.maxRequestBytes < 1)
        throw new Error("auth routes require a finite request-body limit");
      return {
        path: route.path,
        method: route.method,
        timeout: `${String(route.timeoutMs / 1000)}s`,
        maxRequestBytes: route.maxRequestBytes,
      };
    }),
  };
}

const spineRoutes = reservedSpineRpcPaths.map((path) => ({
  path,
  method: "POST",
  timeout: path.endsWith("/Activate") ? "0s" : "30s",
  maxRequestBytes: 1048576,
}));
