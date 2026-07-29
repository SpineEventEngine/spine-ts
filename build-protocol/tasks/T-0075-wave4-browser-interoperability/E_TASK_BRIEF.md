# T-0075 Slice E: Envoy and Static Cross-Runtime Evidence

## Scope and classification

High-risk. Slice E crosses browser, proxy, authentication-gateway, native-gRPC,
subscription-resource, and serialized-wire boundaries.

The existing `createNativeGatewayServices()` API is the framework seam.
Applications own gateway listener lifecycle. Do not add a public auth listener
or duplicate `@spine-event-engine/server` lifecycle policy.

## Human-Imposed Requirements Ledger

- Use a configurable Envoy template that can front Spine TS and unmodified
  Spine JVM applications through the standalone auth gateway.
- Prove real browser traffic through Envoy, the gateway, and a real Spine TS
  Chat backend.
- gRPC-Web is required; Connect remains an explicit optional optimization.
- The backend trusts gateway-rewritten `ActorContext` and receives no browser
  credential or untrusted transport extras.
- The backend is not exposed by the reference public Envoy route.
- Configuration is customizable guidance, not framework-enforced deployment.
- Chat messages remain Projection entities, not events.
- JVM evidence is static only: frozen source, shared Protobuf/service
  descriptors, and TS-owned wire fixtures. Runtime JVM compatibility is
  deferred.
- Never invoke Java, JDK, Gradle, a JVM build/test/generation/dependency
  resolver, or a Spine JVM process.
- Do not publish packages. Do not touch `human-review-1-jul.md`.
- Preserve unrelated files and push every commit to `origin` immediately.

## Frozen Envoy input

- Official image:
  `envoyproxy/envoy:v1.38.3@sha256:5f7c43e1147412fdb3af578c651c67478a3df818eae89d2261e707e06c209cdb`.
- The digest is the OCI multi-platform index and contains linux/amd64 and
  linux/arm64 manifests.
- Never substitute `latest` or an unpinned proxy.

## E1 — Envoy and real Spine TS acceptance

Owned paths:

- `interop/envoy/**`;
- `examples/chat-web/test/interop/**`;
- the smallest directly required package/test configuration and lock entries.

Acceptance:

- Render explicit listener/upstream addresses, exact browser origin, TLS
  paths, finite request/header/stream limits, gRPC-Web filter, CORS policy, and
  HTTP/2 gateway upstream.
- Expose only the gateway on the public route; do not add a backend route.
- Validate the rendered file with the frozen Envoy image.
- Launch a real Chat backend, a separately owned Node HTTP/2 gateway using
  `createNativeGatewayServices()`, pinned Envoy, and the browser fixture with
  bounded readiness and unconditional cleanup.
- Across Chromium, Firefox, and WebKit, prove mandatory gRPC-Web ResolveContext,
  Post, Read, Projection Subscribe/Activate/update/Cancel for bearer and cookie
  sessions. A focused Chromium matrix proves credential/context/policy and
  subscription-ownership failures. One Chromium bearer smoke proves optional
  Connect through the same topology without fallback.
- Test-owned forwarding observation may inspect copied rewritten bytes before
  forwarding to the real backend. Do not add a framework observer.

## E2 — Static JVM/shared-wire evidence

Owned paths:

- `interop/jvm/wire/**`;
- `interop/jvm/wire-compatibility.test.mjs`;
- a minimal internal static-fixture seam and focused test only if required.

Acceptance:

- Reconfirm the locked unmodified revision/tree digest and existing static
  Command, Query, Projection-subscription, and exposed-event-subscription
  source evidence.
- Compare the shared Protobuf/service closure used by Post, Read, Subscribe,
  Activate, Cancel, `ActorContext`, Projection updates, and exposed-event
  updates using repository-owned/static inputs only.
- Decode/re-encode deterministic TS-owned wire fixtures through generated TS
  schemas and verify method input/output/streaming shapes and fixture digests.
- Fail closed with a file/descriptor category on incompatibility, remove
  temporary extracted source, and label results “static compatibility evidence;
  JVM runtime compatibility deferred.”

## Verification and review

- Behavior-first focused tests, changed-package TypeScript/ESLint, Envoy
  `--mode validate`, real Playwright acceptance, Proto/static-fixture checks,
  formatting, and diff hygiene precede review.
- Style/maintainability, documentation, and performance/reliability apply to
  E1. TypeScript/API is N/A unless a public contract changes.
- All four concerns apply to E2 because it validates serialized/service
  contracts; the API lane reviews compatibility evidence rather than exports.
- Slice F retains the final dedicated security review.
