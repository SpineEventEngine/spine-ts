# T-0060 Runner-neutral BlackBox Review

Status: CLEAN — accepted for integration

Baseline: `de0a5867`

## Required Concerns

- TypeScript/API: idiomatic schema-bound facade, actor/tenant/time-zone scope,
  immutable observations, stable errors, declaration isolation, and no raw
  runtime leakage.
- Documentation: compile-ready BlackBox setup, input, query, subscription,
  eventual-wait, ownership, timeout, and cleanup examples.
- Style/maintainability: one cohesive facade reusing client/server seams without
  duplicating their protocol machinery or exposing the legacy fixture.
- Performance/reliability: bounded waits, subscription/resource ownership,
  deterministic cleanup and error aggregation, no retained timers/listeners,
  and idempotent close.
- Security: N/A unless a new credential, endpoint, metadata-policy, or unsafe
  payload boundary is introduced. T-0067 owns final Wave 1 security review.

## Reopened prerequisite concerns

- T-0058 TypeScript/API reopens for the narrow public `ClientOptions.zoneId`
  addition, immutable client-wide semantics, validation, and declarations.
- T-0058 documentation reopens for the system-zone default and explicit
  `zoneId` usage.
- T-0058 performance/reliability reopens for cloned configuration, concurrent
  actor scopes sharing one fixed tenant/zone, consistent command/query/topic
  contexts, and validation before owned session creation.
- No separate T-0058 style re-review is required; the T-0060 style lane reviews
  the combined diff and specifically rejects a generalized context abstraction.

## Specialist Assignment Gate

- Existing `typescript_api_docs_reviewer`: explicit `gpt-5.6-terra` / `high`.
- Existing `documentation_reviewer`: immutable `gpt-5.6-luna` / `medium`.
- Existing `style_maintainability_reviewer`: explicit `gpt-5.6-terra` / `high`.
- Existing `performance_reliability_reviewer`: explicit
  `gpt-5.6-terra` / `high`.
- Reviewers are read-only, return one complete P0-P3 finding wave or CLEAN, and
  may not spawn children. Actual runtime metadata is recorded when exposed;
  otherwise the immutable configured profile and limitation are recorded.
- The surface rejected a redundant explicit `gpt-5.6-luna` model override for
  the immutable documentation-reviewer role because only orchestrator model
  overrides are selectable. The existing role was therefore dispatched with
  explicit `medium` reasoning and an assignment message recording its immutable
  configured `gpt-5.6-luna` profile. This is a dispatch-surface limitation, not
  a profile substitution. The surface also permits only two child threads in
  this task, so the four-lane wave is capacity-sequenced while findings remain
  aggregated until every lane completes.

## Pre-review Evidence

- Repository TypeScript, lint/cleanup enforcement, formatting, generated API
  docs/inventory, generated-proto cleanliness, release-readiness, and diff
  checks passed after the consolidated type corrections.
- Node BlackBox contract/lifecycle/declaration suite passed 19/19.
- Combined Vitest BlackBox/client/subscription/loopback/Todo suite passed
  129/129 using real ephemeral loopback listeners.

## Wave Results (pending aggregation)

### Documentation

- Existing `documentation_reviewer`; immutable configured
  `gpt-5.6-luna` / `medium`. Runtime self-introspection was unavailable; the
  dispatch-surface limitation above applies and no fallback or mismatch was
  visible.
- P2: `packages/client/README.md` imports `TaskIdSchema` from the illustrative
  `task_list_pb` module even though the documented/current generated layout uses
  a separate `task_id_pb` module. The snippet is not compile-ready as written.
- P2: BlackBox documentation describes `postEvent(schema, message)` only in
  prose. The required comprehensive input guide needs a compile-ready generated
  direct-event snippet in the package README and/or end-user BlackBox section.
- All other reviewed setup, tenant/zone/actor, command/query/subscription,
  timing/error, ownership/close, runner-neutrality, and public-inventory claims
  are clean.

### TypeScript/API

- Existing `typescript_api_docs_reviewer`; explicitly dispatched
  `gpt-5.6-terra` / `high`. Runtime self-introspection was unavailable and no
  fallback or mismatch was visible.
- P1: observed command posting tracks a wrapper but returns the original event
  handle, so explicit caller cancellation cannot release BlackBox ownership and
  close attempts redundant cancellation.
- P1: `Tracked.return()` releases ownership even when the underlying iterator
  has no `return()`; the client bounded-stream iterator has only `next()`, so
  the active stream escapes subscription-first cleanup until client close.
- P1: public query-state/version and immediate command-event observation types
  remain mutable even though runtime values are deep-frozen, violating the
  immutable-observation contract and allowing mutations that throw at runtime.
- No P0/P2/P3 findings.

### Style/Maintainability

- Existing `style_maintainability_reviewer`; explicitly dispatched
  `gpt-5.6-terra` / `high`. Runtime self-introspection was unavailable and no
  fallback or mismatch was visible.
- P1: omitted zone resolution is repeated during client validation and
  construction, and again independently between BlackBox and its client. A
  system-zone change between calls can split client and direct-event context,
  contradicting the fixed-zone contract. Normalize/clone once and share it.
- P1: independently confirms that iterator `return()` releases BlackBox
  ownership without cancelling the underlying subscription.
- Todo direct migration is maintainable and contains no disguised retired
  fixture facade; no other findings.

### Performance/Reliability

- Existing `performance_reliability_reviewer`; explicitly dispatched
  `gpt-5.6-terra` / `high`. Runtime self-introspection was unavailable and no
  fallback or mismatch was visible.
- P1: independently confirms that observed command-event posting returns the
  raw handle instead of its tracked wrapper.
- P1: independently confirms that iterator `return()` releases ownership without
  cancelling; it also requires `throw()` to cancel, with state/event/observed
  stream coverage and exactly-once cleanup before BlackBox close.
- P1: `BlackBox.from()` validates, then retains and rereads the caller's mutable
  options after asynchronous builder/server startup. Mutation can bypass
  tenant/timing validation or split direct-event/client zones. Normalize and
  clone one immutable options snapshot before the first await.
- No additional findings.

## Aggregated Correction Batch

1. Normalize and clone client/BlackBox tenant, zone, and timing configuration
   exactly once before owned resource acquisition/awaits; share the fixed zone
   between BlackBox direct-event and client contexts.
2. Return tracked observed-event handles, and make iterator `return()`/`throw()`
   cancel the wrapped handle before ownership release, with exactly-once
   state/event/observed cleanup tests.
3. Apply deep-readonly public output types to Projection query state/version and
   immediate command-event message/context, with compile-time mutation rejection.
4. Correct the illustrative client `TaskIdSchema` import and add a compile-ready
   generated direct-event BlackBox snippet.

All findings are actionable; no disposition is deferred or rejected. One
bounded implementation owner receives this complete batch before focused
reverification and affected-lane re-review.

## Correction Verification

- Corrected Node BlackBox shared contract/lifecycle/declaration tests pass
  22/22.
- Corrected combined Vitest client/root/subscription/loopback/BlackBox/Todo
  tests pass 135/135.
- Generated docs/API inventory still exposes exactly five testing exports, and
  the diff check passes.
- TypeScript/API, performance/reliability, style/maintainability, and
  documentation reopen only for their substantively affected corrections.

## Affected-lane Re-review

### TypeScript/API

- CLEAN. Same existing reviewer/profile; runtime self-introspection remained
  unavailable with no fallback or mismatch visible.
- Confirmed tracked observed wrappers, cancel-before-release iterator return/
  throw, and deeply readonly query/version/command-event public declarations
  with compile-time rejection coverage. Reviewer evidence: lifecycle/declaration
  6/6 and client public-type fixture 3/3.

### Performance/Reliability

- CLEAN. Same existing reviewer/profile; runtime self-introspection remained
  unavailable with no fallback or mismatch visible.
- Confirmed pre-await cloned option snapshot shared by client/direct events,
  returned tracked observed wrappers, memoized underlying cancellation,
  cancel-before-release iterator return/throw, exact-count cleanup paths, and
  deferred-builder/changing-system-zone regressions. No new lifecycle, ordering,
  timer/listener, concurrency, or resource-bound issue.

### Documentation

- NOT CLEAN. Same immutable configured reviewer/profile; runtime
  self-introspection remained unavailable with no fallback visible.
- Original client README ID import is resolved and direct-event snippets now
  exist, but P2 remains in `docs/USER_GUIDE.md`: the Todo `TaskCreated` direct-
  event example omits its required `title` field.
- Adjacent P2 in `docs/USER_GUIDE.md`: a client subscription snippet still
  imports `TaskIdSchema` from `task_list_pb` instead of the current separate
  `task_id_pb` generated module.
- Timing/default/pre-acquisition and normalized snapshot claims are clean.

### Style/Maintainability

- CLEAN. Same existing reviewer/profile; runtime self-introspection remained
  unavailable with no fallback or mismatch visible.
- Confirmed both P1s resolved through small module-private normalized option
  types and the existing tracked-handle seam, with no generalized context
  abstraction, retired facade, or material duplication.

### Documentation final

- CLEAN. Same immutable configured reviewer/profile; explicit Luna override
  remained unsupported by the surface, runtime self-introspection remained
  unavailable, and no fallback was visible.
- Confirmed `TaskIdSchema` uses `task_id_pb`, required `TaskCreated.title` is
  present, surrounding snippets remain coherent, and the guide diff check
  passes.

## Final Disposition

- TypeScript/API: CLEAN after correction.
- Documentation: CLEAN after correction.
- Style/maintainability: CLEAN after correction.
- Performance/reliability: CLEAN after correction.
- Security: N/A. This packet adds a loopback testing facade and fixed request
  context but no credential, public deployment endpoint, or new unsafe payload
  boundary; T-0067 owns final Wave 1 security review.
- No accepted limitations, deferred findings, or rejected findings.
- A later deterministic coverage-harness correction parameterized the already
  reviewed shared contract so Node exercises built public exports and Vitest
  instruments source public exports. It changed no production behavior,
  threshold, exclusion, or contract body and therefore did not reopen lanes.
