/**
 * Renders the reference public route; applications own the gateway listener.
 */
export function renderEnvoy(options) {
  const topology = normalize(options);
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
                stream_idle_timeout: 30s
                request_timeout: 30s
                max_request_headers_kb: 16
                route_config:
                  name: gateway_only
                  virtual_hosts:
                    - name: gateway
                      domains: ["*"]
                      routes:
                        - match: { prefix: /spine.auth.AuthenticationService/ResolveContext }
                          route: { cluster: gateway, timeout: 30s }
                        - match: { prefix: /spine.client.CommandService/Post }
                          route: { cluster: gateway, timeout: 30s }
                        - match: { prefix: /spine.client.QueryService/Read }
                          route: { cluster: gateway, timeout: 30s }
                        - match: { prefix: /spine.client.SubscriptionService/Subscribe }
                          route: { cluster: gateway, timeout: 30s }
                        - match: { prefix: /spine.client.SubscriptionService/Activate }
                          route: { cluster: gateway, timeout: 0s }
                        - match: { prefix: /spine.client.SubscriptionService/Cancel }
                          route: { cluster: gateway, timeout: 30s }
                      cors:
                        allow_origin_string_match:
                          - exact: ${topology.browserOrigin}
                        allow_credentials: true
                        allow_methods: GET, POST, OPTIONS
                        allow_headers: content-type,x-grpc-web,grpc-timeout,connect-protocol-version,connect-timeout-ms,authorization,x-user-agent,x-spine-csrf
                        expose_headers: grpc-status,grpc-message
                        max_age: "86400"
                http_filters:
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
  };
}
