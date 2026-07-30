# T-0075 E1 implementation report

## Behavior

`interop/envoy/render.mjs` renders a TLS public listener with an exact browser
origin, gRPC-Web/CORS/router filters, finite idle/request/route limits, and an
HTTP/2 upstream to the application-owned gateway. It exposes only the six
native gateway methods; no Chat backend route exists.

## Evidence

- RED: renderer and static-wire tests initially failed because their modules
  did not exist.
- GREEN: `node --test interop/envoy/render.test.mjs compatibility-tests/jvm/wire-compatibility.test.mjs`
  passed 4/4.
- The exact frozen image
  `envoyproxy/envoy:v1.38.3@sha256:5f7c43e1147412fdb3af578c651c67478a3df818eae89d2261e707e06c209cdb`
  validated `interop/envoy/validated.yaml` with `--mode validate`.

## Browser lifecycle completion

The minimal native `ResolveContext` handler is registered by the test-owned
gateway. The real topology starts Chat, the HTTP/2 native gateway, pinned
Envoy, and a TLS Vite browser host. Chromium performs browser `Post`/`Read`,
then a Projection subscription activation, receives an update, returns its
iterator, cancels the subscription, and closes its client.

A relay ownership defect found by this path is corrected in
`SubscriptionUpdateRelay`: decoded updates are cloned before their owned source
buffer is wiped. This preserves nested protobuf `bytes` values such as the
`Any` used in a `Target` filter for both an immediately waiting consumer and a
queued consumer.

## Completion evidence

- Auth native/subscription focused tests pass 74/74, including both relay
  ownership paths and public-update target rewriting.
- `npx tsc -b packages/auth packages/client-web` passes.
- The real Envoy/gateway topology passes 1/1 and asserts that the emitted
  update target bytes exactly equal the accepted public subscription target.
- The real Chromium lifecycle passes 1/1. Before teardown, its runner asserts
  zero retained bindings and at least one subscribe, activate, and
  cancel/dispose lifecycle operation.
- The browser fixture now uses `BrowserSession.bearer()` for the public auth
  transport and request metadata. `ResolveContext` completes through that
  session before Post in Chromium, Firefox, and WebKit; all three complete the
  same bearer gRPC-Web Post/Read/subscription lifecycle serially (3/3).
- `BrowserSession` binds its default `globalThis.fetch` receiver. Its focused
  suite passes 19/19, including the receiver-sensitive default-fetch case.
- Cookie lifecycle and focused Chromium security matrix: serial Playwright
  passes 8 with 10 intentional non-Chromium matrix skips. Valid cookie
  lifecycle passes in Chromium, Firefox, and WebKit. Chromium additionally
  rejects invalid bearer, expired cookie, wrong CSRF, and a real
  `https://localhost:4175` origin; rejects unauthorized room plus fabricated
  actor/tenant across Post/Read/Subscribe; denies Bert Activate/Cancel against
  Ada's public subscription; and releases an active native stream after abrupt
  browser close. The runner waits up to five seconds for zero bindings and
  zero active native streams before teardown.

## Limitations

Cookie coverage is limited to the test-owned opaque session model. Chat does
not accept tenant-bearing subscriptions, so matching tenant rewrite cannot be
demonstrated against this backend; fabricated tenant rejection is covered. The
harness asserts exact zero counter deltas for its three negative groups and
records only sanitized forwarded resolver context facts. Connect is an
optional, explicitly selected Chromium unary smoke, not a negotiated fallback
or a subscription-coverage claim. Envoy emits a deprecation warning for the
current virtual-host CORS field during validation, but the pinned configuration
validates successfully. Updating that syntax is deferred to the Envoy-template
maintenance boundary because the exact pinned image still accepts it.

## Explicit Connect smoke completion

- RED: Chromium Connect selection failed while the fixture hard-coded gRPC-Web.
  A subsequent real-wire failure showed that JSON Connect cannot encode Spine's
  packed `Any` command without a type registry.
- GREEN: the fixture chooses exactly `grpc-web` or `connect` from its URL; the
  Connect path uses `Client.forConnect()` without probing or fallback. That
  client configures binary Connect encoding for packed command/query `Any`
  values. ResolveContext remains an explicit Connect JSON call and the browser
  observes `connect-protocol-version: 1`.
- Envoy keeps its gRPC-Web filter and explicitly permits the Connect CORS
  headers `connect-protocol-version` and `connect-timeout-ms`; Connect
  `application/json` and `application/proto` pass unchanged to the HTTP/2
  gateway. Renderer tests pass 2/2.
- Focused Chromium Connect passes 1/1 (545 ms), proving resolver composition,
  Post, and authoritative Read through HTTPS Vite, pinned Envoy, the standalone
  gateway, and real Chat. `npx tsc -b packages/client-web` and the explicit
  protocol unit test pass. The normal browser matrix then passes 9 with 12
  intentional focused-matrix skips in 9.8 seconds, including the existing
  gRPC-Web lifecycle in Chromium, Firefox, and WebKit and all cleanup checks.
