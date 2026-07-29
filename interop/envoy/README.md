# Browser gateway Envoy reference

`renderEnvoy()` creates a narrow browser-facing Envoy template. It is a
starting point, not a managed deployment product: applications own the gateway
listener, TLS material, identity-provider flow, network policy, and any
template changes.

Read the [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
before adapting this template: it documents the gateway trust boundary,
session/provider ownership, delivery limits, and verification matrix.

## Render a configuration

Pass an HTTPS browser origin, the Envoy listen address and port, the application
gateway address and port, and paths to PEM certificate and key files:

```ts
import { writeFile } from "node:fs/promises";
import { renderEnvoy } from "./interop/envoy/render.mjs";

const configuration = renderEnvoy({
  browserOrigin: "https://chat.example.test",
  listenAddress: "0.0.0.0",
  listenPort: 8443,
  gatewayAddress: "gateway.internal.example.test",
  gatewayPort: 9443,
  tlsCertificate: "/run/tls/cert.pem",
  tlsKey: "/run/tls/key.pem",
});
await writeFile("envoy.yaml", configuration);
```

The reference accepts only the six public gateway methods: `ResolveContext`,
`Post`, `Read`, `Subscribe`, `Activate`, and `Cancel`. It terminates browser
TLS, permits the exact supplied HTTPS Origin with credentials, supports
gRPC-Web, and passes explicitly selected binary Connect requests through to the
gateway. The upstream connection uses HTTP/2.

Do not publish a direct route from the browser to a Spine backend. The
application gateway resolves credentials into trusted context and is the only
public upstream in this topology. Backend listeners remain application-private.

## Validate the exact reference image

Mount the rendered file and the TLS files read-only, then validate it with the
pinned image used by the acceptance topology:

```sh
docker run --rm \
  -v "$PWD/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
  -v "$PWD/tls:/run/tls:ro" \
  envoyproxy/envoy:v1.38.3@sha256:5f7c43e1147412fdb3af578c651c67478a3df818eae89d2261e707e06c209cdb \
  -c /etc/envoy/envoy.yaml --mode validate
```

The template deliberately has finite request/header limits and a no-timeout
`Activate` stream route. Copy and customize it for real deployment needs, such
as certificates, hostnames, observability, external rate limits, or a different
network topology; keep the gateway-only public boundary when doing so.

See the [user guide](../../docs/USER_GUIDE.md#browser-gateway-envoy-reference)
and the [Chat fixture](../../examples/chat/web/README.md#real-browser-topology).
