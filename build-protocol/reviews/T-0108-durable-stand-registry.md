# T-0108 Review Record

Status: Review In Progress

## Baseline

- Baseline: `origin/main@7c5457d1`.
- Branch: `task/T-0108-durable-stand-registry`.

## Planned Concerns

- Style/maintainability: public contract depth, builder composition, and
  avoidance of Gateway-registry duplication.
- Documentation: beginner-facing registry configuration, persistence behavior,
  warnings, cleanup, and limitations.
- TypeScript/API: exported registry contract, builder method, configuration,
  declarations, TSDoc, and compatibility.
- Performance/reliability: atomic cross-node capacity, record/snapshot bounds,
  cleanup races, restart recovery, provider conformance, and close ordering.
- Security: N/A unless the implementation adds a new trust boundary or
  unbounded/unvalidated stored input.

Reviewer assignments will be recorded only after deterministic preflight at a
clean, pushed endpoint. Every dispatch will use the existing immutable role and
the protocol-prescribed explicit model/reasoning profile.

## Deterministic Preflight

At pushed endpoint `bd2e4f2d`, `verify:task --no-coverage` passed every
deterministic gate and 104 focused registry/context/environment tests. The
coverage form also passed all gates and 104 tests but measured entire large
shared source files at 68.22% lines, so it did not satisfy the global 90%
threshold. This is not used as acceptance evidence; final `verify:release`
will enforce repository-wide coverage after review convergence.

## Review Assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`. The dispatch surface does not expose Luna as a
  manual model override, so the immutable role profile plus the explicit
  assignment text is the metadata evidence.
- TypeScript/API: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / `high`.
- Security: N/A. The task adds no credential, transport-trust, authorization,
  executable-input, or externally selected resource boundary; it stores the
  already bounded subscription Protobuf through the existing StorageFactory.

Runtime self-introspection is unavailable. Immutable configured roles and
explicit dispatch fields/text are accepted unless the surface exposes a
visible mismatch. Reviewers receive the pushed `origin/main@7c5457d1...bd2e4f2d`
diff and must return findings only for their canonical concern.

## Review Results

- Style/maintainability: two P2 findings. Remove completed-migration result
  aliases and centralize maximum-capacity and cleanup-page policy constants.
  Mechanical diff and standalone-function ledger are clean.
- Documentation: two P2 findings. Explain the atomic-CAS provider requirement
  and unsupported-provider failure; add a beginner lifecycle example and exact
  agent-facing create/activate/delete/get/snapshot/cleanup/error behavior.
- TypeScript/API: two P1 and two P2 findings. Remove the durable class's public
  `string` ID widening, validate negative revisions consistently, expose a
  deep-readonly subscription view, and document builder ownership/exclusion in
  public TSDoc.
- Performance/reliability: two P1 findings. A second live handle can treat an
  in-progress staged create/delete as abandoned, and the codec admits missing
  or blank topic IDs. Live MySQL and Datastore conformance is still unexecuted.
- Security: N/A disposition retained; no reviewer finding changes the stated
  trust-boundary analysis.

All reviewers used the recorded existing roles and configured profiles. Runtime
self-introspection remained unavailable and no visible model/profile mismatch
was exposed.

## Public API, Style, And Documentation Correction

- Style/maintainability P2 accepted and resolved: transitional result aliases
  are absent; canonical `StandCreateResult`, `StandActivateResult`, and
  `StandDeleteResult` remain the only result names. The builder and both
  registries share internal 100-definition and 25-entry cleanup bounds without
  a server-root export. The exact durable standalone helper dispositions are in
  `build-protocol/standalone-function-necessities/T-0080F.json`.
- Documentation P2 accepted and resolved: the server README teaches a
  create-to-close lifecycle and states the atomic compare-and-set provider
  requirement and construction-time failure. The reference specifies outcomes,
  errors, bounds, fail-closed malformed data, hidden revision-zero cleanup,
  provider requirements, and ownership/closure without execution-wave jargon.
- TypeScript/API P1/P2 accepted and resolved: the nested public subscription
  view is deeply readonly; focused typechecking rejects mutation. Durable
  activate, get, and delete accept only generated `SubscriptionId` values; both
  registries reject negative expected revisions with `RangeError`. Builder
  TSDoc records ownership transfer, configuration exclusion, and exact throws.
- Mechanical evidence from the assigned existing `implementer`, explicitly
  `gpt-5.6-terra` / `medium`: focused registry Vitest with a 5-second timeout
  passed 43/43; server TypeScript, relevant ESLint, cleanup, TSDoc, API docs
  (235 server exports), documentation audience, Prettier, and diff checks
  passed. Runtime self-introspection was unavailable; the configured immutable
  role/profile and explicit dispatch remain the metadata evidence.
- Provider conformance is outside this correction and remains unclaimed.

## Correction Architecture Assignment

The live-operation recovery P1 demonstrates a distributed correctness ambiguity
in the frozen two-row protocol. Before implementation, one bounded existing
`requirements_splitter` pass is assigned explicitly `gpt-5.6-sol` / `high` to
choose the smallest provider-neutral repair that preserves exact capacity,
physical deletion, restart recovery, one definition row per subscription plus
the separate control record, and the existing public contract. It must address
fencing/ownership under arbitrary pauses, not assume a staged operation is
abandoned merely because its row is absent, and state honestly if the existing
serialized record cannot express the required invariant. It also specifies the
minimal MySQL/Datastore conformance execution plan without building Spine JVM.

## Correction Architecture Resolution

The first Sol/high pass established that leases alone cannot fence an arbitrarily
paused owner, but did not return a final choice after bounded prompts and was
interrupted. A fresh, narrowly constrained existing `requirements_splitter`,
again explicit `gpt-5.6-sol` / `high`, selected a permanent generation fence as
the smaller complete design. Runtime self-introspection was unavailable for both
passes; immutable role/profile plus explicit dispatch is the metadata evidence.

`StandSubscriptionRecord` gains one internal 16-byte cryptographically random
generation. It remains constant for a definition lifetime and changes on every
recreation. Revision zero is reserved for an internal pre-admission row and is
never returned or counted; admitted rows retain revisions one and above. The
internal control format is versioned and has clean, staged, and committed states
with an operation token, kind, ID, generation, expected/resulting revision and
digests as required. Every definition-row CAS, including reservation discard,
must occur while holding the matching control operation. Control revision fences
ABA on the control slot; full-row CAS includes generation and fences same-ID,
byte-equivalent recreation on the definition slot.

Create first CASes a generation-bearing revision-zero reservation, then stages
its exact admission, promotes it to revision one, commits the count increment,
and clears control. Activate stages the exact generation/revision transition,
updates the row, commits unchanged count, and clears. Delete stages the exact
generation/revision, removes the row, commits the decrement, and clears. Helpers
complete the same transitions idempotently. Snapshots fence their bounded
`limit + 1` admitted-row query through control; revision-zero rows are excluded.
Cleanup serializes discard/delete and processes at most 25 with one extra row to
derive `more`. Unexpected generation, revision, digest, count, or control state
fails closed.

The implementation must directly test paused owners/helpers around every
transition; same-ID recreation ABA; create/discard ordering; result attribution;
capacity/count; staged/committed applied-then-thrown recovery; snapshot fencing;
revision-zero exclusion/cleanup; malformed generation/control; and quiescent
50-row shape. One reusable conformance suite must run against memory, local
MySQL, and the Datastore emulator. The earlier assumption that the existing
record needed no wire change is superseded by the demonstrated P1; this is an
internal record and no migration compatibility is required.

## Architecture Evidence

The existing `requirements_splitter`, explicit `gpt-5.6-sol` / `high`, completed
the single milestone-boundary pass. Runtime self-introspection was unavailable;
the immutable role/profile and explicit dispatch are accepted with no visible
mismatch. It inspected pinned Spine JVM Stand/registry/context sources
read-only and ran no JVM build.

The frozen design uses the public registry contract and immutable result types,
one Protobuf definition row per subscription, one internal CAS control row,
physical deletion, revision-aware finite cleanup, context ownership, custom
builder injection, and environment-owned production warning recorded in the
task. No human blocker, polling/listener responsibility, provider-specific
transaction SPI, or Gateway-registry reuse remains.

## Provider-Conformance Evidence

- The assigned existing `implementer` used the explicit `gpt-5.6-terra` /
  `medium` configuration. Runtime self-introspection was unavailable; no
  visible profile mismatch was exposed, so the immutable configured role/profile
  is the metadata evidence.
- The reusable public lifecycle fixture is green against `InMemoryStorageFactory`
  and local real MySQL (6/6 each). Both assigned service health checks passed.
- Datastore emulator conformance is not accepted: a live first-create execution
  fails with `3 INVALID_ARGUMENT: order by clause cannot contain duplicate
fields __key__`. The fixture makes no production change; repair requires the
  current provider/runtime owner to investigate the duplicated Datastore order.
  The test's globally fake-clock expiry approach is also unsuitable for gRPC
  transport because it blocks timer progress; any accepted final fixture must
  fake only `Date` or use another no-sleep clock seam.
- The reported provider finding is resolved by the narrow `id`-order
  canonicalization: Datastore now appends `__key__` only when no explicit
  identifier order exists. The closest RED unit regression failed with two key
  orders; it is green after the correction (33/33). Rebuilt live conformance is
  accepted for memory, MySQL, and Datastore at 7/7 each. The real-emulator suite
  logs the Google client Filter-object recommendation warning only.

## Correction Re-Review Assignments

The converged correction endpoint is assigned one concern-specific re-review
wave. Style/maintainability uses the existing `style_maintainability_reviewer`,
explicit `gpt-5.6-terra` / `high`; documentation uses the existing immutable
`documentation_reviewer`, `gpt-5.6-luna` / `medium`; TypeScript/API uses the
existing `typescript_api_docs_reviewer`, explicit `gpt-5.6-terra` / `high`;
performance/reliability uses the existing
`performance_reliability_reviewer`, explicit `gpt-5.6-terra` / `high`.
Security remains N/A because the correction exposes no new trust boundary,
credential handling, or authorization behavior. The Desktop surface supports
these explicit dispatches. Runtime self-introspection may remain unavailable;
acceptance will record the immutable role/profile plus any visible metadata and
will reject only an omitted/wrong dispatch or visible mismatch.

## Correction Re-Review Results

- Style/maintainability: one P2 and two P3 findings. The standalone-function
  ledger still claims string IDs, one duplicate return is unreachable, and the
  provider fixture replaces registries without closing every handle.
- Documentation: two P2 and two P3 findings. Public registry TSDoc omits
  observable throws/closed behavior; the agent reference omits exact get,
  cleanup, and close outcomes and overgeneralizes built-in ownership; the shared
  entry summary incorrectly calls in-memory entries durable.
- TypeScript/API: two P1 findings. A clean-control revision-zero reservation can
  be returned publicly, and recursive runtime freezing throws for valid
  nonempty Protobuf byte arrays.
- Performance/reliability: three P1 and one P2 findings. Public get/activate can
  observe or promote revision zero and corrupt the capacity count; a discarded
  paused create reuses an expired deadline and generation; arbitrarily many
  paused creators can persist uncounted revision-zero rows beyond capacity; the
  conformance fixture leaks replaced registry handles.
- Security: the prior N/A disposition remains unchanged.

All reviewers used their recorded existing roles and configured profiles.
Runtime self-introspection was unavailable and no visible mismatch occurred.

The unbounded-reservation P1 is a demonstrated distributed-admission design
block, so one bounded existing `requirements_splitter` correction pass is
assigned explicitly `gpt-5.6-sol` / `high`. It must preserve physical deletion,
exact capacity, one definition row per subscription plus the separate control
record at quiescence, arbitrary-pause fencing, bounded provider-neutral CAS,
the 1 MiB definition bound, and current public APIs. It must choose the smallest
recoverable pre-admission representation and specify direct RED tests. The
Desktop surface supports explicit dispatch; runtime self-introspection may be
unavailable and will be recorded honestly.

## Reservation Correction Resolution

The bounded existing `requirements_splitter`, explicitly `gpt-5.6-sol` /
`high`, selected a single fixed temporary staging slot as the smallest complete
repair. Runtime self-introspection was unavailable. The agent returned the
decisive invariant but did not return its requested expanded final after
repeated bounded prompts, so it was interrupted to avoid further delay; that
limitation is recorded rather than presented as a clean completion.

Creation must serialize pre-admission through the sole control record and one
separate fixed staging storage/slot. The full definition payload is kept in the
1 MiB-capable staging record, never duplicated into the control payload. Control
accounts for the in-flight capacity slot before any subscription-ID definition
row can exist. Operation token, definition generation, ID, revision, and digest
are revalidated around every single-row CAS. Helpers either finish the exact
staged definition or roll back its reserved count; a stale owner can at worst
occupy the one fixed staging slot and cannot promote it after its control token
changes. A newer operation removes a mismatched stale stage with exact CAS
before reusing the slot. At quiescence the staging storage is empty, leaving the
approved 50 definition records plus one control record for 50 active
subscriptions. No pair-CAS, transaction SPI, duplicated control payload, or
public API change is introduced.

The correction owner must make crash/missing-stage liveness explicit and prove
that any timeout used only enables recovery after fencing; it cannot be the
safety fence. RED coverage must hold owners before/after control acquisition and
staging-slot writes, start more creators than the configured capacity, exercise
same/different IDs and stale-stage reuse, restart helpers, assert one bounded
stage row and exact count, and confirm public get/activate/delete/snapshot never
observe revision zero. Retry must create a fresh generation and 30-second
pending lifetime. The same correction also owns typed-array-safe clone/freeze,
fixture closure, TSDoc/reference, ledger wording, and dead-code findings.

The complete finding batch is assigned to one fresh existing `implementer`,
explicitly `gpt-5.6-terra` / `medium`, with exclusive ownership of the registry,
its focused tests/docs/ledger, and the provider fixture. The Desktop surface
supports the explicit dispatch. Runtime self-introspection may be unavailable;
the immutable role/profile and explicit dispatch remain the acceptance evidence.

## Final Finding Re-Review Assignments

Endpoint `03375535` is assigned a final, finding-specific re-review. The same
existing roles and explicit profiles are reused: style/maintainability
`gpt-5.6-terra` / `high`, documentation `gpt-5.6-luna` / `medium`,
TypeScript/API `gpt-5.6-terra` / `high`, and performance/reliability
`gpt-5.6-terra` / `high`. Review is limited to the previously accepted
findings and their substantively changed staging/MySQL/fixture boundaries.
Security remains N/A. Runtime self-introspection may be unavailable; immutable
role/profile plus explicit dispatch remain the metadata evidence.

## Final Finding Re-Review Results

- Style/maintainability: two P2 findings. Split the 53-line create settlement
  state machine into named transitions; guarantee factory close even if a
  tracked registry close fails.
- Documentation: one P2 and one P3 finding. Remove the unsupported claim that a
  custom registry owns one handle and document create's blank-ID/topic
  `TypeError`.
- TypeScript/API: one P1 finding. The deep-readonly mapped type incorrectly
  promises readonly `Uint8Array` values while the clone-safe runtime deliberately
  returns mutable byte arrays.
- Performance/reliability: one runtime P1, one persistence-format P1, and one
  P2. A stale owner can publish into the fixed stage after rollback and wedge a
  fresh staged control; fixture cleanup can skip factory close. The MySQL scope
  correction changes the pre-release physical namespace from schema name to the
  declared storage key.

The MySQL persistence-format finding is dispositioned by the human's explicit
project decision that this pre-release codebase requires no migration
compatibility and may change without a migration cycle. The storage-key scope is
the correct provider contract and receives no legacy fallback or migration
machinery. The runtime P1, API P1, style/documentation findings, and cleanup P2
are accepted for correction.

One fresh existing `implementer` owns the complete final correction, explicitly
`gpt-5.6-terra` / `medium`. It must add the exact two-owner stale-stage RED test,
exact-CAS evict only a mismatched stage under the current control, split named
settlement steps, model bytes as mutable but clone-isolated in the public type,
guarantee/aggregate teardown, and correct the two documentation statements.
Runtime self-introspection may be unavailable; immutable role/profile plus
explicit dispatch are the acceptance evidence.

## Closure Re-Review Assignments

Endpoint `6ed03ce4` is assigned one last narrow re-review of only the corrected
open findings. TypeScript/API and performance/reliability use their existing
reviewers with explicit `gpt-5.6-terra` / `high`; style/maintainability uses its
existing reviewer with explicit `gpt-5.6-terra` / `high`; documentation uses its
immutable existing `gpt-5.6-luna` / `medium` reviewer. Security remains N/A.
Runtime self-introspection may be unavailable; immutable role/profile and
explicit dispatch remain the metadata evidence.

## Closure Re-Review Results

- TypeScript/API: CLEAN.
- Style/maintainability: CLEAN.
- Performance/reliability: runtime fencing, liveness, and teardown are clean;
  one P1 test defect remains because the stale-stage assertion opens storage key
  `...:stage` instead of production's `...:staging` and therefore inspects a
  different empty namespace.
- Documentation: one P2 wording defect remains because the beginner README
  calls returned copies fully frozen while cloned Protobuf byte arrays remain
  intentionally mutable.

The two deterministic corrections are assigned to one fresh existing
`implementer`, explicitly `gpt-5.6-terra` / `medium`: use the exact production
staging key in the regression and qualify the beginner clone/freeze wording.
Runtime self-introspection may be unavailable; immutable role/profile plus
explicit dispatch remain the acceptance evidence.

## Final Correction Evidence

The existing `implementer` correction used explicit `gpt-5.6-terra` / `medium`.
Runtime self-introspection is unavailable; immutable configured role/profile
and explicit dispatch are the recorded metadata evidence with no visible
mismatch. The provider fixture now owns every registry it constructs. Public
TSDoc and REFERENCE specify observable closed/error behavior and exact get,
cleanup, close, and built-in three-handle ownership semantics. The shared
entry wording is provider-neutral and byte-array clone isolation remains
covered without claiming Uint8Array instances are frozen.

Deterministic fake-Date/timer/deferred-CAS regressions prove liveness-boundary
rollback/reuse, bounded held admission, fresh same-ID retry lifetime, and safe
legacy revision-zero invisibility/removal. The closest MySQL adapter regression
proves distinct storage keys physically separate same-schema records while a
matching key shares scope. Evidence is registry 49/49 (5-second timeout),
MySQL adapter 103/103, real-MySQL concurrency 20 consecutive runs of 7/7, and
the memory/MySQL/Datastore provider script 7/7 each. Server/RDBMS typechecks
and focused TSDoc, cleanup, API/audience docs, ESLint, Prettier, and diff checks
pass. The Datastore run emits only its existing Filter-object recommendation.
Security remains N/A: this correction adds no trust boundary or unbounded input.

## Final Stale-Stage Correction Disposition

- Performance/reliability P1 resolved: under the revalidated current control,
  create settlement exact-CAS removes a mismatched fixed stage, rolls back the
  current fenced admission, and retries. A deterministic two-owner fake-time
  regression proves the stale owner cannot claim the fresh result, the final
  definition is fresh, count/capacity are exact, and the fixed stage is empty.
- TypeScript/API P1 resolved: `DeepReadonly` preserves `ArrayBuffer` and
  `ArrayBufferView` leaves as mutable cloned byte views while keeping message
  object fields readonly. The compile-time regression rejects topic-ID mutation
  and accepts returned-byte mutation; runtime clone isolation remains covered.
- Style/documentation P2 resolved: create settlement is split into named staged
  promotion and committed cleanup helpers; public `create()` TSDoc documents
  blank ID/topic `TypeError`, and the root reference says the context owns and
  closes a supplied registry implementation.
- Fixture cleanup P2 resolved: registry closures and factory closure run through
  `allSettled`, and all errors are aggregated after every close attempt. A
  focused seam proves factory close follows a failed registry close.
- Mechanical evidence: registry 50/50 and provider-fixture 8/8 with a
  five-second timeout; server/RDBMS TypeScript, focused ESLint, cleanup, TSDoc,
  API/audience docs, Prettier, and diff checks pass. Live-provider reruns are
  not claimed by this correction context.

## Final Proof Execution

The existing `implementer` completed the final proof with the explicitly
assigned immutable profile `gpt-5.6-terra` / `medium`. Runtime
self-introspection is unavailable on this surface, so the explicit assignment
and configured role/profile are the available metadata evidence; no visible
mismatch was exposed.

- The closest stale-stage test passed 1/1 and the complete registry suite
  passed 50/50, both with the five-second test timeout. The two-owner fake-time
  interleaving proves old-owner rollback, fresh-control acquisition, and stale
  stage publication leave exactly the fresh definition, count one, and an empty
  fixed stage. Settlement revalidates the exact current control before a
  mismatched-stage CAS eviction, and token/generation matching prevents stale
  stage data from being promoted.
- The provider-fixture suite passed 8/8. Its seven registry lifecycle cases
  passed against memory, MySQL, and Datastore individually; the eighth focused
  fixture-disposal test proves factory close is attempted after a registry
  close rejection. The Datastore emulator emitted only its pre-existing Google
  Filter-object recommendation warning.
- The MySQL storage-factory suite passed 103/103. Twenty sequential live MySQL
  conformance executions passed (each 7/7 lifecycle cases plus the fixture
  disposal proof), with no admission/count recurrence.
- Server and RDBMS TypeScript builds, focused ESLint, cleanup, TSDoc, API
  documentation (235 server exports), documentation-audience, Prettier, and
  `git diff --check` all exited successfully.

## Deterministic Closure Corrections

- The final stale-stage helper now opens the exact production fixed-stage
  storage key, `spine.server.StandSubscriptionRecord:staging`, through one
  test-local constant. Its empty-stage assertion therefore observes the real
  stage namespace after the two-owner interleaving rather than a different,
  always-empty namespace.
- The beginner server README now distinguishes the frozen cloned
  message/object graph from intentionally mutable cloned Protobuf byte arrays;
  returned bytes remain isolated from both stored and caller input bytes.
- The existing `implementer` assignment remains explicitly
  `gpt-5.6-terra` / `medium`. Runtime self-introspection is unavailable on this
  surface, so the immutable configured role/profile and explicit dispatch are
  the available metadata evidence; no visible mismatch was exposed.
- Fresh deterministic evidence: the corrected stale-stage regression passed
  1/1 and the complete registry suite passed 50/50 with the five-second test
  timeout. Server TypeScript, focused ESLint, cleanup, TSDoc, API docs (235
  server exports), audience checks, README/test Prettier, and diff hygiene all
  exited cleanly. The reusable provider fixture passed 8/8 independently for
  memory, MySQL, and Datastore; Datastore emitted only its existing
  Filter-object recommendation warning.

The corrected staging-key assertion is assigned one final narrow pass to the
existing performance/reliability reviewer, explicit `gpt-5.6-terra` / `high`.
The corrected README wording is assigned one final narrow pass to the immutable
existing documentation reviewer, `gpt-5.6-luna` / `medium`. Runtime
self-introspection may be unavailable; immutable role/profile and explicit
dispatch remain the metadata evidence.

The performance/reliability closure check is CLEAN: the regression reads the
exact production staging namespace and proves it empty after both owners settle.
The documentation check found only one stale snippet comment calling `get()`'s
result a fully frozen copy. The deterministic record-only correction now calls
it an isolated snapshot, matching the already-correct surrounding byte-array
qualification; it does not reopen another review lane.

Cheap preflight corrections were deterministic test-contract updates only: a
readonly public entry now reconstructs its generated ID in the provider fixture,
and Bounded Context storage fault/count expectations include the built-in fixed
staging handle. They do not alter reviewed production behavior or reopen a
specialist concern. The corrected preflight passed six files / 273 tests and all
mandatory deterministic repository gates recorded in the work log.
