# T-0075: Wave 4 Browser Client and Interoperability

Status: In progress

## Objective

Implement the approved Wave 4 browser, standalone authentication, React, Chat,
Envoy, and unmodified Spine JVM interoperability scope recorded in
`build-protocol/planning/WAVE_4_BROWSER_CLIENT_INTEROPERABILITY_PLAN.md`.

## Classification

High-risk. This task creates public packages and browser/runtime boundaries,
handles credentials and sessions, rewrites serialized requests at a security
boundary, owns long-lived subscription resources, and must interoperate with
both Spine TS and an unmodified frozen Spine JVM backend.

## Human-Imposed Requirements Ledger

- Implement Wave 4 autonomously according to the build protocol.
- Evolve the existing client implementation into
  `@spine-event-engine/client-node`; add framework-neutral
  `@spine-event-engine/client-web` and separate
  `@spine-event-engine/client-react`.
- Use gRPC-Web as the universal browser protocol. Connect is an explicit
  optional TypeScript optimization, not the only browser route.
- Promise minimal update-delivery guarantees. Updates may be duplicated,
  missing, or differently ordered; clients re-read authoritative Entity state
  after reconnect or a reported gap.
- Notify and continue by default on a recoverable subscription gap and expose
  the condition to application code.
- Keep React-specific `use...` names only in the React package. Spine
  operations remain `post`, `send`, `create`, `activate`, and `cancel`.
- Add provider-neutral `@spine-event-engine/auth` as a standalone,
  protocol-aware gateway. Spine TS and unmodified Spine JVM applications trust
  its `ActorContext` and do not configure authentication.
- The gateway owns credential verification, application sessions,
  authorization, Actor/tenant resolution, context replacement, and forwarding.
  Informational Actor/tenant context returned to browsers is not a credential.
- Support opaque stored sessions and signed application-session tokens, cookie
  and bearer transport, generic OIDC, Google, GitHub, and custom providers.
- Reauthorize every request, including Subscribe, Activate, and Cancel. Reject
  fabricated, stale, or mismatched caller context and reconstruct a trusted
  `ActorContext` before forwarding.
- Use `IncomingRequest`; do not introduce `SpineOperation`.
- Supply authentication extension points and secure, customizable deployment
  guidance; the framework does not enforce application topology.
- Add a configurable Envoy template serving Spine TS and unmodified Spine JVM
  gRPC servers through the standalone gateway.
- Add and use the dedicated Chat example. Chat messages are Projection
  entities, not domain events. The browser uses `client-react`.
- Do not build Spine JVM during Wave 4. Preserve an immutable, unmodified
  source/descriptor reference for static capability and wire-contract
  comparison only. Runtime JVM compatibility execution is deferred.
- Support current Chromium, Firefox, and WebKit. SSR, Suspense, service workers,
  edge runtimes, normalized caching, and non-React adapters are out of scope.
- Document all update-completeness, auth, session, trust-boundary, and
  deployment limitations plus extension points with compile-checked snippets,
  diagrams, and third-party authentication flows.
- Do not publish to npm. Wave 5 owns deployment hardening; Wave 6 owns
  best-effort horizontal subscription reachability.
- Use only `@spine-event-engine/*`; no deprecation cycle is required.
- Preserve unrelated changes; never read or modify `human-review-1-jul.md`.
- Push every commit to `origin` immediately.

## Planning Gate

- Existing role: `requirements_splitter`.
- Scope: decompose approved Slices A-F into review-sized tasks, freezing public
  and security seams without reopening accepted product decisions.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Both fields are explicit in dispatch. The role is read-only and may not edit,
  commit, push, merge, or spawn children.

## Implementation Gate

- Existing role: `implementer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Each bounded owner uses behavior-first TDD, owns only assigned paths, records
  focused evidence, and may not spawn children.

## Acceptance Criteria

- Package split, browser-safe client boundary, gRPC-Web baseline, optional
  Connect adapter, and finite reconnect/cancellation lifecycle are implemented.
- The auth gateway implements approved credential, session, authorization,
  context rewriting, subscription ownership, forwarding, cancellation,
  backpressure, cleanup, and redaction behavior.
- Opaque/signed sessions and generic OIDC, Google, GitHub, and custom provider
  flows have reviewed callback and key-lifecycle security.
- `client-react` and Chat implement safe React/Strict Mode lifecycle behavior
  and authoritative re-query after reconnect/gaps.
- Configurable Envoy acceptance proves real browser traffic through the gateway
  to Spine TS. JVM compatibility in this wave is limited to shared
  Protobuf/service descriptors, static unmodified-source inspection, and
  TS-owned wire-contract fixtures; no Spine JVM build or launch is performed.
- Public and agent-oriented docs exactly describe APIs, extensions,
  limitations, examples, diagrams, and deployment assumptions.
- Focused verification, all specialist concerns, final security review, full
  native coverage of at least 90% branches, merge, post-merge verification, and
  remote synchronization complete.
