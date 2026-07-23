# T-0059 Client Subscriptions Review

Status: Pending implementation and deterministic verification

Baseline: `11a54925`

## Required Concerns

- TypeScript/API: public generic topic/update/handle shapes, declaration
  isolation, frozen wire compilation, error separation, and context parity.
- Documentation: actual compile-ready state/event subscription, filtering,
  no-longer-matching, overflow, cancellation, ownership, and close examples.
- Style/maintainability: a small cohesive facade reusing T-0058 lifecycle
  primitives without duplicating command-observation or prebuilding BlackBox.
- Performance/reliability: bounded queues, no silent loss, activation/cancel
  ordering, terminal stream errors, abort/close races, exactly-once remote
  cleanup, and no retained tasks/listeners.
- Security: N/A unless a new credential, metadata, endpoint, or unsafe decoded
  payload boundary is introduced. T-0067 owns the final Wave 1 security review.

## Specialist Assignment Gate

- Existing `typescript_api_docs_reviewer`: explicit `gpt-5.6-terra` / `high`.
- Existing `documentation_reviewer`: immutable `gpt-5.6-luna` / `medium`.
- Existing `style_maintainability_reviewer`: explicit `gpt-5.6-terra` / `high`.
- Existing `performance_reliability_reviewer`: explicit
  `gpt-5.6-terra` / `high`.
- Reviewers are read-only, return one complete P0-P3 finding wave or CLEAN, and
  may not spawn children. Actual runtime metadata is recorded when exposed;
  otherwise the immutable configured profile and limitation are recorded.

## Review Wave 1 — 2026-07-23

All four canonical concerns completed read-only review. Runtime
self-introspection was unavailable in every lane and no fallback was visible.
The API, style, and reliability roles ran under their explicitly dispatched
immutable `gpt-5.6-terra` / `high` profiles. The documentation role ran under
its explicitly assigned immutable `gpt-5.6-luna` / `medium` profile; this
surface rejected a redundant Luna model override, so the canonical configured
role was the dispatch mechanism and that tooling limitation is recorded.

### Accepted findings

- TypeScript/API — P1: public creation returns before the Activate transport
  handshake is established; early stream failure and immediate first updates
  can race the returned handle. Corroborated by reliability.
- TypeScript/API — P1: Subscribe validates only a nonempty ID, while echoed
  topic/scope and each update's subscription identity are not bound to the
  exact request. Corroborated by reliability.
- TypeScript/API — P1: the TypeDoc/API inventory omits five intended new root
  exports, so `docs:check` must fail until updated.
- TypeScript/API — P2: new request methods and handle `cancel()` members lack
  required method-level TypeDoc and lifecycle/error semantics.
- Documentation — P1: the package README state snippet imports a generated
  column definition as though it were a registered column set and assumes an
  undeclared client, so it is not compile-ready.
- Documentation — P1: the user-guide subscription snippet omits its generated
  schemas/column definition, registration, helpers, and client setup, so it is
  not self-contained or compile-ready.
- Style/maintainability — P2: T-0059 duplicates T-0058 queue/terminal/abort/
  cancel ownership in the already oversized client module. Extract one private
  generic bounded-stream/remote-cancel core, keep command filtering and topic
  decoding separate, and rename the now-generic owner stream registry.
- Style/maintainability — P2: native tests use fixed 25 ms sleeps instead of a
  deterministic activation observation. This is resolved together with the
  activation-handshake P1 and immediate-emission tests.

### Dispositions

- All findings are accepted and returned as one deduplicated correction batch
  to the existing implementation context. The activation and identity findings
  each count once despite corroboration across API/reliability.
- Security remains N/A: T-0059 adds no credential, endpoint, metadata-policy,
  or unsafe decoding boundary beyond the frozen validated transport. The final
  Wave 1 security review remains T-0067.
- API, documentation, maintainability, and reliability are all substantively
  affected by the correction batch and therefore require focused re-review.

### Activation-readiness clarification

Native verification proved that awaiting Connect's raw server-stream response
deadlocks until the TS server yields its first domain update. Focused frozen-JVM
analysis established that JVM activation success is routed through an
errors-only observer and no pre-update `SubscriptionUpdate` acknowledgement is
sent. The original activation P1 is therefore revised:

- Accepted: validate the exact echoed subscription, invoke `Activate`, attach
  exactly one bounded consumer before returning, buffer any immediately
  delivered wire update, and fail creation for errors known before attachment.
- Unsupported and rejected: promise remote listener readiness or require
  asynchronous activation failure to reject creation. The frozen wire has no
  acknowledgement for either property; post-attachment failure terminates the
  public handle, matching JVM behavior.
- A response-only TS activation frame is rejected because frozen JVM clients
  treat `UPDATE_NOT_SET` as invalid and TS clients would hang waiting for that
  frame from a frozen JVM server. No Proto/server behavior changes are made.
- The fixed-sleep P2 remains accepted. Native tests must establish causality by
  bounded observation/probing rather than treating creation as a wire ack.

## Focused Re-review Gate

All four concerns are substantively affected and are redispatched read-only.
Expected profiles remain explicit: TypeScript/API, style/maintainability, and
performance/reliability use their existing `gpt-5.6-terra` / `high` roles;
documentation uses its immutable `gpt-5.6-luna` / `medium` role. Reviewers
verify Wave 1 findings and the activation-readiness clarification only, return
remaining P0-P3 findings or CLEAN, and may not edit or spawn children.

## Focused Re-review Results

- Documentation: CLEAN. Snippets and lifecycle claims match the corrected API.
- Style/maintainability: CLEAN. Both stream kinds use the private shared core;
  naming and causal native tests resolve the prior P2s.
- TypeScript/API — P1: synchronous activation iterator acquisition occurs
  outside the terminalizing `try`, so creation can return a handle whose reads
  hang while cleanup is skipped. Accepted.
- TypeScript/API — P2: runtime values are deeply frozen but public state/event
  payload types remain mutable. Accepted; expose a non-exported recursive
  readonly type in the public signatures without adding another root export.
- Performance/reliability — P1: corroborates iterator acquisition and cleanup.
- Performance/reliability — P1: overflow during a multi-value wire update does
  not stop the current decode loop; trailing items can be pushed after the
  terminal overflow and observed before the error. Accepted.

Only API and reliability are substantively affected by the final correction.
Documentation and maintainability remain closed; localized terminal guards and
readonly signature alignment do not reopen their resolved concerns.

## Final Disposition

- TypeScript/API: CLEAN after final confirmation. Tooling typecheck, exact
  iterator-construction cleanup, recursively readonly private declaration
  helpers, declaration isolation, TypeDoc, and the 40-export API inventory were
  verified.
- Documentation: CLEAN. Both package and end-user snippets are compile-ready
  and all lifecycle/no-ack/overflow/replay/ownership claims are current.
- Style/maintainability: CLEAN. The private shared bounded-stream core serves
  T-0058 and T-0059 without a new public abstraction; native tests are causal.
- Performance/reliability: CLEAN after final confirmation. Synchronous and
  asynchronous activation failures, multi-value overflow, exactly-once cancel,
  listener/owner cleanup, close aggregation, and T-0058 queue semantics are
  covered.
- Security: N/A for this packet for the reason recorded above.

Every reviewer ran read-only under the expected existing role/profile. Runtime
self-introspection was unavailable in all lanes and no fallback was visible.
No unresolved P0-P3 finding remains.

The post-review coverage-only test expansion changed no production behavior or
public contract and did not reopen a specialist lane. The final full gate
passed at 90.08% branch coverage with all thresholds and exclusions unchanged.
