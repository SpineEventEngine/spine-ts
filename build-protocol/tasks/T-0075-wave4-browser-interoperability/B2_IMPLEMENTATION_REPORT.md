# B2 Implementation Report — Unary Authentication Gateway

## Scope delivered

- Added the transport-neutral `UnaryGateway` for `CommandService.Post`,
  `QueryService.Read`, and `AuthenticationService.ResolveContext`.
- Requires a finite non-negative request-byte bound before envelope decode.
  Unknown, oversized, and malformed requests reject before session, policy,
  context, or backend work begins.
- Post and Read independently resolve the session, authorize typed
  `IncomingRequest` facts, resolve trusted actor/tenant and validated hints,
  reject stale actor or tenant values, and replace the whole `ActorContext` with
  a fresh context using the injected clock.
- Review correction: gateway routing is canonical and snapshots allowlisted
  transport facts before awaits; policy/context receive isolated decoded views,
  stale comparison and forwarding retain the untouched envelope, and the
  resolver-returned timestamp is authoritative. Unknown Protobuf fields and
  every non-ActorContext envelope field are retained byte-equivalently.
- ResolveContext validates only the session and emits the existing informational
  actor, tenant, and expiry response. It neither authorizes an RPC nor forwards
  to a Spine backend.
- Forwarding receives only service, method, and rewritten bytes. The explicit
  rejection union is transport-neutral so B4 can map it to its chosen RPC
  status without adding native gRPC behavior here.

## TDD evidence

- RED: the six focused gateway regressions failed against the preserved
  command-only path. They exposed missing decode-before-session ordering,
  stale-context rejection, injected-clock replacement, Query.Read,
  ResolveContext, and transport-neutral rejection behavior.
- GREEN: all six focused gateway regressions pass after the bounded pipeline
  implementation. A generated-build TypeScript check then exposed type-narrowing
  and exact-optional construction defects; the minimal corrections retain the
  green gateway suite.

## Focused verification

- `pnpm --config.link-workspace-packages=true exec vitest run
packages/auth/test/unary-gateway.test.ts` — 1 file, 7 tests passed.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated` —
  passed.

## Final correction

- Gateway decoding now imports the direct semantic request decoder rather than
  the public barrel. Request bytes are copied immediately after the bound;
  each collaborator receives an independent frozen allowlisted transport view.

## Limits

B2 does not add native gRPC forwarding, subscription binding, concrete session
strategies, cookies, OIDC, React, Chat, Envoy, or any Spine JVM project
operation. The remaining complete Wave 4 validation and review cadence belongs
to the orchestrator.
