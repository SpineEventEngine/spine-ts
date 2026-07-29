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
  assert.match(rendered, /allow_headers: content-type,x-grpc-web,grpc-timeout,connect-protocol-version,connect-timeout-ms,authorization,x-user-agent,x-spine-csrf/);
  assert.match(rendered, /Connect application\/json and application\/proto requests pass through unchanged/);
  assert.match(rendered, /type: LOGICAL_DNS/);
  assert.match(rendered, /envoy\.extensions\.upstreams\.http\.v3\.HttpProtocolOptions/);
  assert.match(rendered, /max_request_headers_kb: 16/);
  assert.match(rendered, /stream_idle_timeout: 30s/);
  assert.match(rendered, /\/spine\.client\.CommandService\/Post/);
  assert.match(rendered, /\/spine\.auth\.AuthenticationService\/ResolveContext/);
  assert.match(rendered, /\/spine\.client\.QueryService\/Read/);
  assert.match(rendered, /\/spine\.client\.SubscriptionService\/Activate/);
  assert.match(rendered, /SubscriptionService\/Activate \}\n                          route: \{ cluster: gateway, timeout: 0s \}/);
  assert.doesNotMatch(rendered, /backend/);
});

test("rejects an insecure or incomplete public topology", () => {
  assert.throws(() => renderEnvoy({ browserOrigin: "http://chat.example.test" }), /HTTPS/);
  assert.throws(
    () => renderEnvoy({ browserOrigin: "https://chat.example.test", tlsCertificate: "/cert" }),
    /TLS certificate and key/,
  );
});
