# T-0075 Slice F task brief

## Classification and boundary

High-risk release/documentation closure. Slices A-E are feature-frozen. Slice F
may correct documentation, public TSDoc, documentation checks, and
release-evidence records. It may correct a demonstrated documentation-only
package metadata or declaration mismatch, but must not redesign runtime
behavior.

No Spine JVM project may be built, tested, generated, launched, downloaded, or
used for dependency resolution. JVM claims remain limited to the frozen static
source/descriptor evidence already accepted in Slice E.

## Human-imposed requirements ledger

- The auth component is a standalone gateway/trust-boundary module. Spine TS
  and JVM backends trust the gateway-created `ActorContext` and do not perform
  authentication routines.
- Actor/tenant returned to a browser are informational facts, not credentials.
  Every later request is authenticated and authorized independently.
- Browser protocols are explicit: gRPC-Web is universal; Connect is optional,
  binary `application/proto`, and never probed or used as fallback.
- React-specific APIs may use `use...`; framework-neutral client operations use
  post/send/create/activate/cancel terminology.
- Chat messages are Projection entities, never domain events.
- Update delivery has minimal guarantees. Subscriptions are hints; clients
  reconnect and re-query authoritative entity state.
- The Envoy topology is a customizable reference/template. The framework
  explains trust assumptions but does not enforce an application's deployment.
- Wave 4 modifies no Spine JVM code and runs no Spine JVM build.
- npm publication remains deferred and must be called out for reconsideration
  after all waves.

## Required documentation product

Create one authoritative, agent-oriented browser/auth extension guide under
`docs/` and link it from the user guide, API index, relevant package READMEs,
Chat, and Envoy documentation. It must contain:

1. A package/responsibility map for `auth`, `client-web`, `client-node`,
   `client-react`, the application gateway/HTTP adapter, Envoy, the Spine
   backend, provider adapters, and application policy/session stores.
2. Exact public extension signatures or links to exact declarations, with
   invariants and “must not” rules for authentication, session resolution,
   identity mapping, context resolution, authorization, provider adapters,
   revocation, request facts, native forwarding, and subscription ownership.
3. Configuration/default/failure tables for browser retry/queues/deadlines,
   opaque and signed sessions, cookies/CSRF/CORS, OIDC transactions/grants,
   provider/JWKS behavior, gateway limits, subscription bindings/relays, and
   Envoy inputs.
4. Cookie-versus-bearer and opaque-versus-signed decision tables.
5. Complete generic OIDC, Google, GitHub, and custom-provider flows, including
   PKCE/state/nonce, one-time exchange, provider-token secrecy, application
   session issuance, refresh/re-login ownership, and safe callback responses.
6. Identity-to-Actor and optional tenant resolution/provisioning examples.
7. Authorization examples or a complete decision matrix for every
   `IncomingRequest` kind: resolve context, command, query, subscribe,
   activate, and cancel.
8. Session persistence, cache, expiry, rotation, refresh, logout, and
   revocation guidance for one and multiple gateway nodes.
9. Credential/request redaction and safe diagnostic guidance.
10. Subscription/reconnect and React Strict Mode state/lifecycle diagrams.
11. Browser → Envoy → standalone gateway → TS/JVM backend and third-party
    sign-in diagrams, with the exact trust boundaries and application-owned
    listener lifecycle.
12. TS runtime acceptance versus partial static JVM compatibility wording, plus
    testing recipes for policy, sessions, provider callbacks, reconnect,
    Projection subscriptions, browser engines, Envoy, and cleanup.

Diagrams must be durable Markdown/Mermaid or equivalent text in the guide.
Examples must use current public APIs, be compile-checked where executable, or
be explicitly labelled pseudocode.

## Mandatory public limitations

The authoritative guide and appropriate package/user/example surfaces must
state all of these without contradiction:

- Subscriptions are not authoritative or complete.
- Duplicate, missing, and differently ordered updates are possible.
- A healthy-looking transport cannot prove every update was delivered.
- Entity resynchronization restores current authoritative state, not
  intermediate history.
- Event gaps may occur and are not replayed in Wave 4.
- Cross-node subscription propagation is outside Wave 4 and remains Wave 6.
- Gateway authentication does not protect a backend route exposed around it.
- Browser-visible actor/tenant context is informational, not a credential.
- Signed sessions trade local validation for delayed revocation.
- Signed-token revocation exists only with an explicit shared revocation
  capability.
- Opaque sessions require an application-selected durable/shared store for
  production continuity and multiple gateway nodes.
- Third-party sign-in does not define application provisioning or permissions.
- Provider access/refresh/ID tokens are sensitive server-side material.
- Open subscriptions are not instantaneously revoked; authorization is checked
  again on reconnect/expiry and each lifecycle request.
- The Envoy/network topology is customizable guidance, not enforced policy.
- React support excludes SSR, Suspense, normalized caching, service workers,
  and external state managers in Wave 4.
- npm publication remains deferred.
- JVM compatibility is partial static source/descriptor evidence; complete
  transitive and runtime interoperability is deferred.

## Reconciliation requirements

- Remove stale “later Wave 4 slice” or “not provided” statements for features
  that now exist, especially in `packages/auth/README.md`.
- Keep package READMEs concise but link to the authoritative guide.
- Keep `docs/USER_GUIDE.md` an end-user flow with current inline snippets and
  a clear route into advanced extension/deployment material.
- Update public TSDoc only where it is incomplete or contradicts the guide.
- Extend documentation/snippet/API checks so the new executable examples and
  required limitation inventory fail closed when they drift.

## Acceptance and review

- Fresh-reader checks prove every package/link/signature/decision-table route is
  discoverable and every mandatory limitation is present.
- TypeScript snippets, TypeDoc/API inventories, package metadata, links,
  formatting, and diff hygiene pass.
- All four canonical specialist concerns apply to the complete Slice F
  candidate. Corrections return as one batch.
- After specialist convergence, the existing final security reviewer performs
  the dedicated Wave 4 release-readiness review across auth, sessions,
  providers, cookies/CSRF/CORS, context rewriting, subscription ownership,
  redaction, limits, Envoy, and deployment claims.
- Full native verification with at least 90% branch coverage, task commit and
  immediate push, merge to `main`, post-merge verification, and remote `main`
  push are mandatory.
