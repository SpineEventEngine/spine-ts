# T-0036 Implementation Report

Status: Complete; merged to `main` and post-merge verified

Branch: `task/T-0036-package-internal-delivery-epoch-progress`

Baseline: `67da0b1c`

## Result

- `DeliveryLoop` admits a bounded immutable snapshot of detached canonical
  pending inbox rows before callbacks run. Admission is exactly one inbox read capped
  by the existing storage read limit, currently 1,000 rows, so an inter-page
  write cannot join the active epoch.
- Completed capped snapshots advance through finite admission sweeps. Sweep
  depth doubles after each pass restarts at the inbox head, so later backdated
  rows remain eligible while explicit epochs eventually reach every finite
  unsupported-prefix depth. Sweep state is one continuation and two counters,
  not an ever-growing remembered-ID set.
- Internal epoch drains consume admitted rows without preliminary per-ID storage
  reads. Admission canonicalizes and detaches mutable `Date` and `Any.value`
  state once; read-only drain internals reuse the private frozen retained array.
  Durable claim/mark CAS remains authoritative, so stale
  status or claim changes skip callbacks. Normally ordered and backdated
  post-admission rows remain pending until a later new epoch.
- Each explicit loop run starts at most two bounded drains. `PAUSED` retains the
  opaque snapshot index; `IDLE`, `FAILED`, `SKIPPED`, and `STOPPED` clear or
  park progress according to the accepted contract.
- Internal loop evidence retains frozen counters and failures from safely
  completed drains. Admission rejection reports zero progress for the new
  epoch rather than stale evidence from a prior epoch.
- `DeliveryWorker` retains configured shard identity and one opaque obligation,
  settles attempted shards in configured order, and returns discriminated
  fulfilled/rejected evidence with last-safe progress and original causes.
- Later internal invocation continues only `PAUSED` or explicitly retriggered
  rejected shards for the same obligation. Fulfilled `FAILED`/`SKIPPED` park,
  `IDLE` completes, and `STOPPED` stops.
- Public/direct `DeliveryWorker.start()` remains the compatibility adapter: one
  rejection throws the original cause; multiple rejections throw one ordered
  `AggregateError`. Existing stop, close, and concurrent-start behavior remains
  covered.
- Stop during admission prevents the first drain. Stop after a drain begins
  still waits for that drain and returns `STOPPED` without interruption.
- No automatic invocation, environment lifecycle, retry timing, root export,
  generated file, example, Protobuf, or storage schema changed.

## TDD Evidence

- Cycle 1 RED: normal and backdated callback rows were delivered by the active
  run, and useful rows extended one start to `IDLE`.
- Cycle 1 GREEN: exact-ID admission excluded both callback rows and bounded
  useful work at `PAUSED` until a later explicit run.
- Cycle 2 RED: the package-internal ordered worker evidence/start seam did not
  exist.
- Cycle 2 GREEN: mixed `PAUSED`/`FAILED`/`SKIPPED` evidence and ordered
  rejection/sibling evidence passed; rejected work also remained dormant until
  a later explicit invocation.
- Cycle 3 RED: admission rejection retained counters from the previous complete
  epoch.
- Cycle 3 GREEN: resetting progress before admission produced truthful zero
  last-safe progress.
- Cycle 4 RED: a 10,001-row unsupported prefix was re-admitted ahead of its
  supported tail, and stop during blocked admission still ran one callback.
- Cycle 4 GREEN: capped-epoch continuation reached the tail in the next epoch,
  admission stop ran zero drains, and active-drain tests synchronized on actual
  drain start.
- Cycle 5 RED: with a growing tail keeping every later admission capped, the
  retained boundary delivered the forward tail and continued to bypass a
  supported row inserted behind it during the active epoch.
- Cycle 5 GREEN: finite growing admission sweeps restarted from the head,
  admitted the later backdated row without changing the active epoch, and
  retained forward progress through capped unsupported chunks.
- Cycle 6 RED: a supported row inserted before the second admission page joined
  the active epoch and was delivered; the focused regression observed the old
  multi-read admission behavior.
- Cycle 6 GREEN: epoch admission became one storage-bounded read sourced from
  `inboxStorageAccess.maxReadLimit`; the focused regression observed one query
  and no inter-page delivery, and the updated 40-test loop suite passed.
- Cycle 7 RED: one capped unsupported epoch performed one admission query and
  1,000 sequential inbox point reads.
- Cycle 7 GREEN: the epoch retained admitted rows after one canonical detachment
  and drained the private frozen array directly. The same focused test observed one query and zero point reads;
  stale durable status and live-claim changes also produced no callback,
  accepted work, delivery, or failure.

## Round 1 Fix Files

- `packages/server/src/delivery/delivery.ts`
- `packages/server/src/delivery/delivery-loop.ts`
- `packages/server/test/delivery/delivery-loop.test.ts`
- `packages/server/test/delivery/delivery-storage-fault-fixture.ts`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/tasks/T-0036-package-internal-delivery-epoch-progress/TASK.md`
- `build-protocol/tasks/T-0036-package-internal-delivery-epoch-progress/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0036.md`
- `build-protocol/reviews/T-0036-package-internal-delivery-epoch-progress.md`

## Verification

- PASS: focused cycle 1 loop tests, 3 tests.
- PASS: full delivery loop suite, 35 tests before the final progress regression.
- PASS: focused cycle 2 worker tests, 2 tests; explicit rejected retry, 1 test.
- PASS: full worker-runtime suite, 13 tests before the explicit retry addition.
- PASS: focused cycle 3 progress regression, 1 test.
- PASS: focused cycle 4 cap/stop regressions, 2 tests; full loop suite, 38
  tests.
- PASS: loop/worker suites, 3 files / 128 tests.
- PASS: loop/worker/delivery/inbox suites, 4 files / 257 tests.
- PASS: generated TypeScript build (`tsc -b`).
- PASS: final loop suite, 39 tests.
- PASS: final loop/worker/delivery/inbox suite, 4 files / 258 tests.
- PASS: final changed-file ESLint over five TypeScript source/test files.
- PASS: cycle 6 RED command
  `pnpm exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "admits an epoch with one query before an inter-page write can join"`;
  1 failed as intended because the inter-page row was delivered.
- PASS: cycle 6 GREEN with the same focused command; 1 passed / 39 skipped.
- PASS: full loop command
  `pnpm exec vitest run packages/server/test/delivery/delivery-loop.test.ts`;
  40 passed.
- PASS: four-file command over `delivery-loop.test.ts`,
  `delivery-worker-runtime.test.ts`, `delivery-worker.test.ts`, and
  `inbox.test.ts`; 4 files / 259 tests passed.
- PASS: generated typecheck `pnpm typecheck:build:generated` (`tsc -b`).
- PASS: changed-file ESLint over `delivery-loop.ts`, `delivery.ts`, and
  `delivery-loop.test.ts`.
- PASS: `pnpm docs:check`; only the existing invalid-`origin` source-link
  warning was emitted.
- PASS: `pnpm format:check` and `git diff --check`.
- PASS: Round 2 docs/status pass corrected the active closing summary and
  reconciled the known work-log commits through `40793085` without changing
  runtime, tests, or architecture semantics. Lightweight docs/status lint,
  `pnpm docs:check`, `pnpm format:check`, and `git diff --check` passed; docs
  emitted only the known invalid-`origin` warning. No rereview is claimed.
- PASS: cycle 7 RED failed as intended with 1,000 point reads after one capped
  admission query; focused GREEN passed 2 tests / skipped 39.
- PASS: Round 3 loop suite, 41 tests; four-file delivery suite, 4 files / 260
  tests; generated `tsc -b`; changed-file ESLint over four TypeScript files.
- PASS: Round 3 `pnpm docs:check`, `pnpm format:check`, and `git diff --check`;
  docs emitted only the known invalid-`origin` source-link warning.
- PASS: Coordinator pre-review performance follow-up reused the private frozen
  retained array after one-time canonicalization. Focused operation/stale-state
  tests passed 2 tests, the four-file suite passed 260 tests, generated `tsc -b`
  passed, and changed-file ESLint passed.
- PASS: Final focused coverage command passed 2 files / 71 tests. Selected
  delivery sources measured 258/375 branches; `delivery-loop.ts` reached
  91.75% and `delivery-worker.ts` reached 95.45%.
- PASS: Native full `pnpm verify` passed ordinary and coverage runs at 60 files
  / 1,309 tests. Coverage measured 95.14% statements (7,036/7,395), 90.11%
  branches (3,591/3,985), 98.20% functions (1,918/1,953), and 95.15% lines
  (6,898/7,249). Before this cycle global branches were 89.73%
  (3,576/3,985).

Round 5 is clean. Final and post-merge native verification pass all gates, and
T-0036 is integrated into `main` as `d00f9c7c`.
