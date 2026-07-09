# Review Log: T-0022a Projection Inbox Handoff

Status: ready for merge

Scope: live projection subscriber durable inbox handoff.

## Required Lanes

| Lane                       | Reviewer    | Status                     | Notes                                                                                                                                                            |
| -------------------------- | ----------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code style/maintainability | first round | fix implemented            | Replaced ad-hoc `normalizeAny()` with a generated `AnySchema` binary round-trip; introduced `RepositoryEventSubscribers` alias near `RepositoryCommandAssignee`. |
| Documentation completeness | first round | fix implemented            | Updated runtime architecture to state live projection subscribers use durable local inbox handoff while other event endpoint kinds remain deferred.              |
| TypeScript/API docs        | first round | no blocking finding logged | API wording now names the local 30-second retention window for live projection handoff dedup.                                                                    |
| Security                   | first round | fix implemented            | Clarified dedup as a local retention-window boundary, not permanent idempotence.                                                                                 |
| Performance/reliability    | first round | fix implemented            | Added exact-row local handoff replay so unrelated pending rows are not invoked and unrelated failures do not affect the received row.                            |

## First-Round Fix Pass

- Added `Delivery.drainMessage()` for framework-owned exact-row replay under the shard lease.
- Switched local projection and process-manager handoffs from broad shard drain to exact-message drain.
- Added mixed-backlog regressions for projection and process-manager handoffs, covering unrelated same-label targets plus opposite-label rows remaining pending.
- Updated the stale process-manager scheduled-row test to assert isolation instead of broad shard draining.

## Second Re-Review Fix Pass

- Added a `Delivery.drainMessage()` guard that rejects mismatched
  `message.id.shard` and `message.shard` snapshots before shard pickup.
- Introduced `DeliveryMessageDrainOptions` for exact-message drains so ignored
  `limit` options are no longer part of that API.
- Added focused delivery regression/type coverage for the mismatched-shard
  guard and exact-message options shape.
- Updated API/developer docs and export checks for `DeliveryMessageDrainOptions`.

## Remaining Findings Fix Pass

- Security Important: tightened `Delivery.drainMessage()` so exact-row shard
  equality comes from `index`/`ofTotal`, not a caller-supplied `key()`. The
  method now leases a normalized ID shard, reads by that normalized message ID,
  and checks the leased/session and pending-row shards before replay. Added a
  forged structural shard regression where `key()` lies while `index`/`ofTotal`
  point elsewhere.
- Reliability Important: moved the duplicated exact-row local handoff loop into
  a narrow shared helper. Duplicate `TO_DELIVER` rows that skip exact drain
  because the original local drain owns the shard now poll briefly for that
  exact row to become `DELIVERED`; non-duplicate skipped rows still fail fast.
  Added concurrent duplicate projection coverage and matching process-manager
  coverage for the shared helper path.
- Docs Important: corrected runtime/user/developer/package docs so
  process-manager event reactors are direct local `EventBus` execution and are
  not yet routed through durable inbox storage. README handoff sections now
  mention both process-manager command rows and live projection subscriber rows.
- Minor cleanup: removed the stray README `- and` bullet.
- Cleanup rule: replaced the overlong `assertMessageShardMatchesId` helper name
  with smaller shard-normalization helpers that satisfy semantic-name cleanup.

## Remaining Findings Verification

- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/context/projection-handoff.test.ts packages/server/test/context/process-manager-handoff.test.ts`:
  passed; 3 test files, 33 tests.
- `pnpm --config.verify-deps-before-run=false lint:generated`: first
  remaining-findings run failed on two ESLint unsafe-assignment findings in the
  new shard normalizer; after replacing those reads, passed with `tsc -b`,
  ESLint, and cleanup enforcement.
- `pnpm --config.verify-deps-before-run=false docs:check:generated`: passed;
  TypeDoc emitted the existing invalid `origin` remote source-link warning, then
  API export checks passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `git diff --check`: passed.

## Final Reliability/Docs/Coverage Fix Pass

- Reliability Important: replaced the duplicate local inbox handoff's
  time-bounded delivered-row polling with a framework-local in-flight drain map
  keyed by inbox message ID and scoped per `Delivery` instance. A duplicate now
  awaits the original exact-row drain when the original replay is still running,
  while skipped drains without a matching local in-flight drain still fail
  immediately.
- Added projection and process-manager duplicate regressions that hold the
  original replay past the old `20 * 5ms` polling window. The red run failed
  both tests on the old skipped-delivery path; the green run passed after the
  in-flight drain map fix.
- Docs Important: corrected D-0072 and the task acceptance wording so
  process-manager event reactors are described as implemented through direct
  local `EventBus` execution, with durable inbox routing for those reactors
  deferred.
- Minor cleanup: renamed the stale process-manager repository test to describe
  exact-row delivery despite older pending backlog.
- Coverage: added focused delivery worker branch tests for exact-message drain
  malformed-shard and marker-failure paths plus public
  `InboxRecords`/`DedupRecords` corrupted record decode guards. These moved
  full generated coverage branch percentage from `89.55%`/`89.61%` failed runs
  to a passing `90.03%`.

## Final Verification

- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/context/projection-handoff.test.ts packages/server/test/context/process-manager-handoff.test.ts`
  during final reliability fix pass: first red run failed the extended
  duplicate tests after the old `20 * 5ms` wait; after the in-flight drain map
  fix, passed; 2 test files, 14 tests.
- `pnpm --config.verify-deps-before-run=false test:coverage:generated` in the
  sandbox failed on native localhost/ZeroMQ IPC `EPERM`; escalated rerun before
  extra coverage tests passed all native tests but failed branch threshold at
  `89.55%`.
- Escalated `pnpm --config.verify-deps-before-run=false test:coverage:generated`
  after exact-message delivery tests passed all 1108 tests but still failed
  branch threshold at `89.61%`.
- Escalated `pnpm --config.verify-deps-before-run=false test:coverage:generated`
  after delivery record decode coverage: passed; 58 files, 1110 tests,
  statements `94.97%`, branches `90.03%`, functions `98.24%`, lines `94.97%`.
- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/context/projection-handoff.test.ts packages/server/test/context/process-manager-handoff.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/delivery/delivery-worker.test.ts`:
  passed; 4 test files, 159 tests.
- `pnpm --config.verify-deps-before-run=false lint:generated`: first final run
  failed on two `@typescript-eslint/restrict-template-expressions` findings in
  the inbox message key helper; after explicit numeric string conversion, the
  rerun passed with `tsc -b`, ESLint, and cleanup enforcement.

## Production Duplicate-Race Fix Pass

- Reliability Blocking: production repository projection handoff creates a
  fresh `Delivery` per call, so the previous duplicate in-flight map scoped per
  `Delivery` instance did not join concurrent duplicate handoffs. The fix moved
  coordination to the long-lived local inbox instance and keys it by tenant plus
  inbox target/signal/shard identity. Projection and process-manager handoffs
  now share that stable local inbox coordination while keeping the delivery
  worker exact-row focused.
- Added repository-level concurrent duplicate projection coverage using the
  real repository event dispatcher path. The subscriber is held beyond 150ms;
  the duplicate stays pending until the original replay finishes, the
  subscriber is invoked once, and the durable inbox row is delivered once.
- Added projection context failure propagation coverage using two fresh
  `Delivery` instances. A concurrent duplicate now rejects with the original
  replay error, and the row remains `TO_DELIVER` with no delivered row written.
- Minor cleanup: renamed stale duplicate test names, clarified the
  `DeliveryLoop` API-doc sentence to name the shard-level `Delivery.drain()`
  boundary, and corrected the earlier work-log phrase to "deferred
  process-manager event reactor inbox routing".

## Production Duplicate-Race Verification

- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/context/projection-handoff.test.ts packages/server/test/repository/repository-routing.test.ts`:
  red run failed as expected on skipped-delivery for the fresh-delivery context
  duplicate and the repository duplicate while the original replay was still in
  flight.
- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/context/projection-handoff.test.ts packages/server/test/repository/repository-routing.test.ts`:
  green run passed; 2 test files, 126 tests.
- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/context/projection-handoff.test.ts packages/server/test/context/process-manager-handoff.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/delivery/delivery-worker.test.ts`:
  passed after formatting; 4 test files, 161 tests.
- `pnpm --config.verify-deps-before-run=false lint:generated`: first run failed
  cleanup enforcement on one overlong test-name line and one overlong semantic
  type name; after cleanup, rerun passed with `tsc -b`, ESLint, and cleanup
  enforcement.
- `pnpm --config.verify-deps-before-run=false format:check`: first run failed
  on `packages/server/src/context/local-inbox-handoff.ts`; after
  `pnpm --config.verify-deps-before-run=false format`, rerun passed.
- `git diff --check`: passed.
- `pnpm --config.verify-deps-before-run=false test:coverage:generated` failed
  in the sandbox on native IPC restrictions (`listen EPERM: operation not
permitted 127.0.0.1` and ZeroMQ `Operation not permitted`); escalated rerun
  passed with 58 files, 1112 tests, statements `94.96%`, branches `90.03%`,
  functions `98.24%`, lines `94.97%`.

## Stale-Option Cleanup Review

- Final style and reliability reviewers found one minor stale internal option:
  `LocalInboxDrainOptions.duplicate` was still accepted by the shared local
  drain helper but was no longer read after duplicate coordination moved to the
  long-lived local inbox instances.
- Removed the unused option from `LocalInboxDrainOptions` and both local inbox
  callers in commits `e91f965` and `5f34619`, with the work log recording the
  cleanup and verification evidence.
- Post-cleanup focused verification passed: projection/process-manager handoff,
  repository routing, and delivery worker tests passed with 161 tests;
  `lint:generated`, `format:check`, and `git diff --check` passed.
- Final post-cleanup reviewers reported no Critical or Important findings in
  code style, documentation, TypeScript/API docs, security, or
  performance/reliability. Documentation review requested this review-log entry
  and status metadata update before merge.
