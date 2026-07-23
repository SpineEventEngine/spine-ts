# T-0061 Public Delivery Review

Status: CLEAN — accepted for integration

Baseline: `3f284a4a`

## Required Concerns

- TypeScript/API: small JVM-familiar and idiomatic builder/run contract,
  immutable public evidence, stable validation, environment defaults, public
  exports/declarations, and no internal coordinator or storage leakage.
- Documentation: compile-ready builder/default/override/run/monitor snippets,
  accurate at-least-once and local scheduling semantics, resource ownership,
  exclusions, and future scheduler/remote-topology boundaries.
- Style/maintainability: cohesive builder and monitor seams over the existing
  core without parallel delivery engines, getter proliferation, catch-up
  placeholders, compatibility aliases, or unrelated abstraction layers.
- Performance/reliability: bounded paging/batching/failures, exclusive pickup,
  fencing and attempt preservation, deterministic monitor order/cancellation,
  release in every terminal path, immutable observations, and no unbounded
  timers/tasks/listeners.
- Security: N/A unless implementation unexpectedly adds a network, credential,
  unsafe payload-decoding, or public trust boundary. T-0067 owns the final Wave
  1 security review.

## Human-Imposed Requirements Ledger

The complete ledger is in the task record and is binding for every lane. In
particular: implement conceptual/behavioral parity idiomatically without
over-engineering; no deprecation aliases; Node only; T-0062 owns the production
scheduler/supervisor; T-0063 through T-0066 own the in-memory simple-server
remote topology; Redis/Hazelcast are excluded; live TS/JVM tests are Wave 3;
admin UI/TUI is Wave 4; preserve unrelated files and never access the protected
human-review file.

## Specialist Assignment Gate

- Existing `typescript_api_docs_reviewer`: expected explicit
  `gpt-5.6-terra` / `high`.
- Existing `documentation_reviewer`: immutable configured
  `gpt-5.6-luna` / `medium`; the dispatch will explicitly state both fields and
  use explicit `medium` reasoning if the surface rejects a redundant model
  override.
- Existing `style_maintainability_reviewer`: expected explicit
  `gpt-5.6-terra` / `high`.
- Existing `performance_reliability_reviewer`: expected explicit
  `gpt-5.6-terra` / `high`.
- Reviewers are read-only, receive the task record and full ledger, return one
  complete P0-P3 finding wave or CLEAN, and may not spawn children. Actual
  runtime metadata is recorded when exposed; otherwise the immutable configured
  role/profile and limitation are recorded before accepting results.
- The surface rejected the redundant explicit `gpt-5.6-luna` model override
  for the immutable documentation-reviewer role because only Sol/Terra model
  overrides are selectable. The role itself is fixed to Luna/medium, so it is
  redispatched with explicit `medium` reasoning and the immutable configured
  model stated in the assignment. This is a dispatch-surface limitation, not a
  role/profile substitution.

## Pre-review Evidence

- Generated TypeScript/tooling typechecking, ESLint, cleanup enforcement, and
  formatting passed.
- The uninstrumented suite passed 98 files (3 skipped) and 2,097 tests (21
  skipped).
- Global branch coverage passed at 90.06% (6,346/7,046); builder-local branch
  coverage is 95.00%. No threshold or exclusion changed.
- TypeDoc/API inventory passed with 212 expected server exports. All 39 copied
  Proto checksums and 48 normalized descriptors matched; generated outputs were
  clean; release readiness checked 16 package imports and 121 Markdown links.

## Wave Results

- TypeScript/API and style/maintainability were dispatched read-only with
  explicit `gpt-5.6-terra` / `high` fields. The surface then reported its child
  thread limit when reliability was dispatched, so reliability and
  documentation are capacity-sequenced behind the active lanes. No concern is
  omitted and findings remain unaggregated until all four lanes finish.

### Style/Maintainability

- Existing `style_maintainability_reviewer`, explicitly
  `gpt-5.6-terra` / `high`. Runtime model self-introspection was unavailable;
  the configured profile matched and no fallback was visible.
- P1: `DeliveryMonitor.onStarted` is documented as post-pickup but public
  `run()` emits it before `drain()` attempts pickup. An already-owned shard
  therefore reports both started and skipped without acquisition. Move the
  event to the successful-pickup boundary or deliberately rename/recontract it,
  with an already-owned ordering regression.
- P1: `withWorkRegistry()` accepts a registry whose storage context/factory may
  differ from the delivery inbox. Two deliveries can then drain the same inbox
  while fencing unrelated registry namespaces. Couple or validate these seams
  and add a mismatched-registry regression.
- No P0, P2, or P3 findings.

### TypeScript/API

- Existing `typescript_api_docs_reviewer`, explicitly
  `gpt-5.6-terra` / `high`. Runtime model self-introspection was unavailable;
  the configured profile matched and no fallback was visible.
- P1: independently confirms `onStarted` is emitted before exclusive pickup,
  contrary to its public contract and JVM semantics.
- P1: a multi-shard strategy with omitted `DeliveryRunOptions.shard` silently
  derives one arbitrary shard from synthetic `"local"` values, despite the
  option promising omission only for a one-shard strategy. Require an explicit
  shard for multi-shard strategies or expose/use cardinality safely.
- P1: root-exported `Delivery` exposes its constructor, direct `drain()` and
  `drainMessage()`, attempt history, and shard registry, bypassing the intended
  builder/run boundary and leaking internal storage/coordinator seams. Direct
  optional bounds/node also bypass builder validation.
- P1: `DeliveryResult` is shallowly frozen, but failed-page message evidence
  retains mutable `Date` and `Any.value` values, violating the immutable public
  evidence contract.
- P2: `DeliveryBuilder.build()` resolves `ServerEnvironment.instance()` even
  when context, storage factory, and node were supplied explicitly, locking
  global configuration and coupling explicit local construction to unrelated
  environment state.
- No P0 or P3 findings.

### Performance/Reliability

- Existing `performance_reliability_reviewer`, explicitly
  `gpt-5.6-terra` / `high`. Runtime model self-introspection was unavailable;
  the configured profile matched and no fallback was visible.
- P1: public `run()` discards `DeliveryDrainOutcome` continuation/skipped-scan
  state and treats `accepted < pageSize` as exhaustion. A bounded skipped prefix
  can therefore produce false `COMPLETED` while a supported tail remains
  pending. Reuse/preserve the existing loop progress semantics and add a public
  tail-row regression.
- P1: independently confirms pre-pickup `onStarted` ordering.
- P1: independently confirms that an unrelated supplied registry defeats
  exclusive fencing for the inbox namespace.
- P2: page size accepts values above the storage maximum of 1,000, failing only
  during `run()`, and batch size has no practical upper bound while retaining
  every page. Validate/document finite maxima and their boundaries.
- P2: monitor exceptions have no defined/tested semantics. Define propagation
  or containment for every hook, document ordering, and prove the shard session
  is available afterward.
- No P0 or P3 findings.

### Documentation

- Existing `documentation_reviewer`; immutable configured
  `gpt-5.6-luna` / `medium`, with explicit medium reasoning after the documented
  surface rejection of a redundant Luna override. Runtime self-introspection
  was unavailable and no fallback was visible.
- P1: independently confirms the `onStarted` TypeDoc/behavior contradiction.
- P1: the package README and user guide promise immutable page evidence while
  nested failure messages retain mutable dates and byte arrays.
- P2: snippets do not comprehensively cover defaults and key overrides for
  storage, strategy, registry, monitor, batch/node, and explicit run shard.
- At-least-once behavior and catch-up, scheduler, and remote-topology exclusions
  are accurate. No P0 or P3 findings.

## Aggregated Correction Batch

1. Preserve the existing drain/loop continuation semantics in the public finite
   run so skipped prefixes cannot falsely complete and the configured finite
   page/batch bounds remain authoritative.
2. Emit `onStarted` only after successful exclusive pickup. Already-owned runs
   report skip/completion without start, and every hook/terminal ordering is
   covered.
3. Couple or validate a supplied work registry against the delivery storage
   context/factory so it cannot create a separate fencing namespace.
4. Give strategies an explicit shard cardinality and require
   `DeliveryRunOptions.shard` when cardinality exceeds one; never derive a
   synthetic multi-shard target.
5. Narrow the root public `Delivery` surface to the builder-owned run/inbox/
   configuration contract. Do not expose direct constructor/drain/message,
   attempt-history, registry, or internal `DeliveryRun`/`DeliveryFailure`
   machinery. An idiomatic opaque interface/facade over the existing internal
   class is acceptable and preferred to broad internal migration.
6. Return genuinely immutable public page/result evidence. Prefer a small
   copied page summary with primitive counts over exposing mutable internal
   failure payloads/errors.
7. Resolve `ServerEnvironment.instance()` only for omitted environment-owned
   defaults. Fully explicit construction must not lock unrelated global state.
8. Enforce the storage page maximum and a documented practical batch maximum at
   builder configuration time, with boundary tests and retained evidence
   bounded by those values.
9. Define monitor exception propagation/containment and terminal callback
   semantics. Prove acquired sessions are released and reusable after every
   throwing hook.
10. Update TypeDoc, package README, API guide, user guide, export inventories,
    and compile-ready examples for the corrected default/override/monitor/
    explicit-shard contract.

All findings are accepted and actionable. One complete correction batch returns
to the existing implementation owner. No lane is re-reviewed until the batch is
mechanically green; then all four substantively affected lanes reopen once.

## Correction Verification

- Focused affected suites passed 212 tests; builder-local branch coverage is
  95.65%.
- Corrected canonical verification passed 98 files (3 skipped) and 2,107 tests
  (21 skipped), with 90.08% global branch coverage (6,370/7,071).
- Typechecking, lint, cleanup enforcement, formatting, TypeDoc/API inventory
  with 211 server exports, Proto checksums/descriptors, generated cleanliness,
  release readiness, and diff integrity passed.
- API, style, reliability, and documentation reopen once for their affected
  corrections.

## Affected-lane Re-review

### TypeScript/API

- Existing reviewer, explicitly `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable with no visible fallback.
- P1 remains: custom `DeliveryStrategy.shardCount` is documented positive but
  not validated, and an explicit run shard need not have an `ofTotal` matching
  that cardinality. Validate positive safe-integer cardinality and reject a
  mismatched explicit shard, with regressions.
- The narrow facade, no internal constructor/drain/attempt/registry leakage,
  primitive frozen evidence, post-pickup start, lazy environment resolution,
  declarations, and exports are otherwise clean.

### Style/Maintainability

- Existing reviewer, explicitly `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable with no visible fallback.
- P1: monitor exception tests cover `onStarted`, `onPage`, and `onCompleted`
  but not `onFailure` and `onSkipped`. Add both throwing-hook regressions,
  including rejection/terminal-callback order and shard reusability where a
  session was acquired.
- P2: registry mismatch coverage changes context and factory together. Add
  separate context-only and factory-only cases so conjunction cannot regress
  into an unsafe OR predicate.
- The corrected monitor placement/release, aligned registry check, narrow
  facade, reuse of the existing core, and scope exclusions are otherwise clean.

### Performance/Reliability

- Existing reviewer, explicitly `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable with no visible fallback.
- P1: independently confirms the unvalidated strategy cardinality and explicit
  shard `ofTotal` mismatch can strand durable rows under another shard key.
- P2: independently confirms missing throwing `onFailure`/`onSkipped` hook
  regressions. The implementation appears safe but every accepted hook contract
  must be proved.
- Continuation, post-pickup release, registry alignment, finite bounds,
  primitive frozen evidence, and resource bounds are otherwise clean.

### Documentation

- CLEAN. Same immutable configured `gpt-5.6-luna` / `medium` role and explicit
  medium reasoning; runtime self-introspection unavailable with no fallback.
- Default and explicit builds, registry/strategy/shard examples, monitor order
  and exceptions, finite maxima, immutable evidence, at-least-once behavior,
  and scheduler/catch-up/remote exclusions match the implementation. Affected
  documentation diff integrity passed.

## Final Re-review Correction

1. Validate every custom strategy `shardCount` as a positive safe integer and
   require every explicit run shard's `ofTotal` to equal it. Add invalid-
   cardinality and durable mismatch regressions.
2. Add throwing `onFailure` and `onSkipped` tests proving rejection, later
   terminal-hook suppression, and shard reuse where acquisition occurred.
3. Split registry mismatch coverage into context-only and factory-only cases.

Documentation remains closed because this batch changes no documented contract.
API, style, and reliability reopen only for these affected corrections after
focused and canonical mechanical verification.

## Final Correction Verification

- Focused builder/loop/registry suites passed 131 tests; builder-local branch
  coverage is 96.00%.
- Final canonical verification passed 98 files (3 skipped) and 2,115 tests (21
  skipped), with 90.09% branches (6,378/7,079).
- Typechecking, lint, cleanup, formatting, 211-server-export API inventory,
  Proto/generated integrity, release readiness, and diff integrity passed.
- API, style, and reliability reopen for the final batch; documentation stays
  closed and CLEAN.

## Final Affected Recheck

### TypeScript/API

- Existing reviewer, explicit `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable with no visible fallback.
- P2: `DeliveryRunOptions.shard` TypeDoc omits the new invariant that explicit
  `ShardIndex.ofTotal` must equal `DeliveryStrategy.shardCount`.
- Validation timing, durable mismatch preservation, narrow facade, immutable
  evidence, and lazy environment resolution are otherwise clean; focused
  builder tests passed 25/25.

### Style/Maintainability

- Existing reviewer, explicit `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable with no visible fallback.
- P1: the custom strategy object remains mutable by caller reference after
  `build()`. Changing its `shardCount` changes the built delivery's run guard,
  contradicting the resolved-snapshot contract and potentially stranding rows.
  Snapshot the resolved cardinality/strategy boundary and add a post-build
  mutation regression.
- Throwing-hook and independent registry mismatch tests are clean.

### Performance/Reliability

- Existing reviewer, explicit `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable with no visible fallback.
- P1: independently confirms post-build mutation of the caller-owned strategy
  cardinality can switch or reject the built delivery's durable shard keys.
- Cardinality/mismatch timing, durable preservation, throwing hooks, and
  independent registry mismatch behavior are otherwise clean; focused builder
  tests passed 25/25.

## Snapshot Correction

- Capture one immutable resolved shard cardinality per built delivery and use it
  for every omitted/explicit run-shard guard. A delegated custom `shardFor`
  result must also match that fixed total before durable work.
- Add a post-build caller-mutation regression proving the original shard guard
  remains effective.
- State the explicit shard-total invariant in `DeliveryRunOptions.shard`
  TypeDoc.
- API, style, and reliability reopen only for this behavioral/TypeDoc change;
  documentation-guide review remains closed.

## Snapshot Verification

- Builder tests passed 26/26; builder branch coverage is 96.15%.
- Canonical verification passed 98 files (3 skipped) and 2,116 tests (21
  skipped), with 90.10% global branches (6,380/7,081).
- Typechecking, lint, cleanup, format, 211-export API inventory,
  Proto/generated integrity, release readiness, and diff checks passed.

## Snapshot Re-review

### TypeScript/API

- CLEAN. Existing explicit `gpt-5.6-terra` / `high` reviewer; runtime
  self-introspection unavailable with no visible fallback.
- Fixed cardinality, delegated/explicit shard alignment, post-build mutation
  isolation, TypeDoc, narrow facade, immutable evidence, and lazy environment
  resolution all pass review.

### Style/Maintainability

- CLEAN. Existing explicit `gpt-5.6-terra` / `high` reviewer; runtime
  self-introspection unavailable with no visible fallback.
- The frozen wrapper is minimal and cohesive, captures resolved cardinality,
  validates delegated totals, preserves caller ownership, and introduces no
  abstraction or scope regression.

### Performance/Reliability

- P2: implementation ordering is correct, but the explicit shard-total
  regression proves rejection/pending-row preservation without asserting that
  no durable pickup was attempted. Add a recording-registry zero-pickup
  assertion.
- Fixed cardinality and delegated mismatch behavior are otherwise clean;
  focused builder tests passed 26/26.

## Reliability Evidence Correction

- Add only the zero-pickup assertion for the mismatched explicit shard. This is
  test evidence for existing ordering, not a behavior/API/docs change; only
  reliability reopens after focused mechanical verification.
- Final reliability acceptance is CLEAN. The regression uses a recording
  registry, asserts zero pickup calls, preserves the pending row, and passed
  26/26 focused tests under explicit `gpt-5.6-terra` / `high`.

## Final Disposition

- TypeScript/API: CLEAN after correction.
- Style/maintainability: CLEAN after correction.
- Performance/reliability: CLEAN after the final recording-registry assertion;
  focused acceptance passed 26/26.
- Documentation: CLEAN after correction.
- Security: N/A. T-0061 adds no network, credential, payload-decoding, or trust
  boundary; T-0067 owns the final Wave 1 security review.
- No accepted limitations, rejected findings, or deferred findings. The only
  metadata limitation is unavailable runtime self-introspection; every role's
  immutable configured profile matched its explicit dispatch with no visible
  fallback.
- T-0061 is accepted for final canonical verification, commit, immediate task-
  branch push, integration into `main`, post-merge verification, and immediate
  `main` push.
