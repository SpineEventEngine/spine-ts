import assert from "node:assert/strict";
import test from "node:test";

import { renderEnvoy } from "./render.mjs";

test("renders a bounded grpc-web gateway-only listener", () => {
  const rendered = renderEnvoy({
    browserOrigin: "https://chat.example.test",
    listenAddress: "127.0.0.1",
    listenPort: 8443,
    gatewayAddress: "127.0.0.1",
    gatewayPort: 9443,
    tlsCertificate: "/run/tls/cert.pem",
    tlsKey: "/run/tls/key.pem",
  });

  assert.match(rendered, /name: envoy\.filters\.http\.grpc_web/);
  assert.match(rendered, /allow_origin_string_match:[\s\S]*https:\/\/chat\.example\.test/);
  assert.match(rendered, /allow_credentials: true/);
  assert.match(
    rendered,
    /allow_headers: content-type,x-grpc-web,grpc-timeout,connect-protocol-version,connect-timeout-ms,authorization,x-user-agent,x-spine-csrf/,
  );
  assert.match(
    rendered,
    /path: \/spine\.auth\.AuthenticationService\/ResolveContext, headers: \[\{ name: ":method", exact_match: OPTIONS \}, \{ name: origin, present_match: true \}, \{ name: access-control-request-method, exact_match: POST \}\] \}\n {26}route: \{ cluster: gateway, timeout: 30s \}/,
    "genuine preflights must select the CORS-filtered bounded route",
  );
  assert.match(
    rendered,
    /path: \/spine\.auth\.AuthenticationService\/ResolveContext, headers: \[\{ name: ":method", exact_match: OPTIONS \}\] \}\n {26}direct_response: \{ status: 204 \}/,
    "malformed or non-preflight OPTIONS must remain terminal and local",
  );
  assert.match(
    rendered,
    /Connect application\/json and application\/proto requests pass through unchanged/,
  );
  assert.match(rendered, /type: LOGICAL_DNS/);
  assert.match(rendered, /envoy\.extensions\.upstreams\.http\.v3\.HttpProtocolOptions/);
  assert.match(rendered, /max_request_headers_kb: 16/);
  assert.match(rendered, /stream_idle_timeout: 30s/);
  assert.match(
    rendered,
    /path: \/spine\.client\.CommandService\/Post, headers: \[\{ name: ":method", exact_match: POST \}\]/,
  );
  assert.match(
    rendered,
    /path: \/spine\.auth\.AuthenticationService\/ResolveContext, headers: \[\{ name: ":method", exact_match: OPTIONS \}\]/,
    "the CORS filter needs an exact preflight route before it can add allow-origin headers",
  );
  assert.match(rendered, /\/spine\.auth\.AuthenticationService\/ResolveContext/);
  assert.match(rendered, /\/spine\.client\.QueryService\/Read/);
  assert.match(rendered, /\/spine\.client\.SubscriptionService\/Activate/);
  assert.match(
    rendered,
    /SubscriptionService\/Activate, headers: \[\{ name: ":method", exact_match: POST \}\] \}\n {26}route: \{ cluster: gateway, timeout: 0s \}[\s\S]*BufferPerRoute[\s\S]*max_request_bytes: 1048576/,
  );
  assert.doesNotMatch(rendered, /backend/);
  assert.doesNotMatch(rendered, /match: \{ prefix:/);
  assert.match(rendered, /name: envoy\.filters\.http\.buffer/);
  assert.match(rendered, /forward_not_matching_preflights: false/);
  assert.doesNotMatch(rendered, /route: \{[^}]*max_request_bytes/);
});

test("renders supplied auth endpoints as exact finite routes", () => {
  const rendered = renderEnvoy({
    browserOrigin: "https://chat.example.test",
    tlsCertificate: "/cert",
    tlsKey: "/key",
    authRoutes: [
      { method: "POST", path: "/auth/exchange", timeoutMs: 1200, maxRequestBytes: 4096 },
    ],
  });
  assert.match(
    rendered,
    /path: \/auth\/exchange, headers: \[\{ name: ":method", exact_match: POST \}\]/,
  );
  assert.match(rendered, /timeout: 1\.2s/);
  assert.match(rendered, /BufferPerRoute[\s\S]*max_request_bytes: 4096/);
});

test("matches genuine GET auth preflights and retains a counter-neutral OPTIONS fallback", () => {
  const rendered = renderEnvoy({
    browserOrigin: "https://chat.example.test",
    tlsCertificate: "/cert",
    tlsKey: "/key",
    authRoutes: [{ method: "GET", path: "/auth/session", timeoutMs: 1200, maxRequestBytes: 4096 }],
  });

  assert.match(
    rendered,
    /path: \/auth\/session, headers: \[\{ name: ":method", exact_match: OPTIONS \}, \{ name: origin, present_match: true \}, \{ name: access-control-request-method, exact_match: GET \}\]/,
  );
  assert.match(
    rendered,
    /path: \/auth\/session, headers: \[\{ name: ":method", exact_match: OPTIONS \}\] \}\n {26}direct_response: \{ status: 204 \}/,
  );
});

test("emits Envoy access logs only when diagnostic capture is requested", () => {
  const ordinary = renderEnvoy({
    browserOrigin: "https://chat.example.test",
    tlsCertificate: "/cert",
    tlsKey: "/key",
  });
  const diagnostic = renderEnvoy({
    browserOrigin: "https://chat.example.test",
    tlsCertificate: "/cert",
    tlsKey: "/key",
    accessLog: true,
  });

  assert.doesNotMatch(ordinary, /envoy\.access_loggers\.stdout/);
  assert.match(diagnostic, /envoy\.access_loggers\.stdout/);
  assert.equal((ordinary.match(/stream_idle_timeout: 30s/g) ?? []).length, 1);
  assert.equal((diagnostic.match(/stream_idle_timeout: 30s/g) ?? []).length, 1);
});

for (const method of ["GET", "POST"]) {
  test(`rejects a ${method} auth route collision with a reserved RPC path`, () => {
    assert.throws(
      () =>
        renderEnvoy({
          browserOrigin: "https://chat.example.test",
          tlsCertificate: "/cert",
          tlsKey: "/key",
          authRoutes: [
            {
              method,
              path: "/spine.client.CommandService/Post",
              timeoutMs: 1200,
              maxRequestBytes: 4096,
            },
          ],
        }),
      /reserved Spine RPC paths/,
    );
  });
}

test("rejects an insecure or incomplete public topology", () => {
  assert.throws(() => renderEnvoy({ browserOrigin: "http://chat.example.test" }), /HTTPS/);
  assert.throws(
    () => renderEnvoy({ browserOrigin: "https://chat.example.test", tlsCertificate: "/cert" }),
    /TLS certificate and key/,
  );
});
