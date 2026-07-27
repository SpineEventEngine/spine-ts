# T-0075 Review Record

Status: Pending

All four canonical specialist concerns apply:

- Style/maintainability: package boundaries, ownership, naming, test quality,
  and avoidance of speculative abstractions.
- Documentation: browser/auth/session/deployment workflows, examples,
  limitations, diagrams, third-party flows, and extension guidance.
- TypeScript/API docs: exports, runtime/type agreement, browser-safe
  declarations, package contracts, and compile-checked snippets.
- Performance/reliability: reconnect generations, retry bounds, backpressure,
  cancellation, cleanup, session lifetime, forwarding limits, and cross-runtime
  behavior.

A final `security_reviewer` gate is mandatory for credentials, OAuth/OIDC
callbacks, cookies/CSRF/CORS, tokens/keys, session fixation/replay/revocation,
Actor/tenant rewriting, subscription ownership, redaction, model decoding,
forwarding limits, and deployment trust claims.

Assignments, explicit runtime metadata, complete review waves, dispositions,
corrections, and re-review evidence will be recorded before acceptance.
