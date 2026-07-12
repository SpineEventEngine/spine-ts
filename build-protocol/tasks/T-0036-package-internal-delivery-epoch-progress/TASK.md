# T-0036: Package-Internal Delivery Epoch Progress

Status: Coverage gate passed; fresh package and rereview pending
Started: `2026-07-12T01:45:00Z`
Baseline commit: `67da0b1c`
Branch: `task/T-0036-package-internal-delivery-epoch-progress`
Worktree: `.worktrees/T-0036-package-internal-delivery-epoch-progress`

## Objective

Implement the smallest package-internal delivery loop/worker prerequisites from
D-0085: finite epoch progress, selective paused-shard continuation, and
fulfilled/rejected per-shard evidence, while delivery remains explicitly
invoked and no environment lifecycle or public progress API is added.

## Human-Imposed Requirements Ledger

- Continue autonomously until the project is complete or a real blocker occurs.
- Use this isolated feature branch/worktree and one implementation worker.
- Keep the slice and review package deliberately small.
- Read relevant Spine JVM server docs/source before implementation.
- Use test-driven development for runtime behavior.
- Run code style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability reviewer lanes until clean.
- Defer security review to final project readiness.
- Run lightweight docs/status lint before review; use focused inner-loop tests
  and reserve full `pnpm verify` for final and post-merge gates.
- Ignore superseded history unless current records claim it active.
- Keep generated Protobuf output out of VCS.
- Do not touch `human-review-1-jul.md`.

## Initial Boundaries

- Package-internal delivery loop/worker changes only.
- Preserve explicit invocation; no `ServerEnvironment` lifecycle wiring.
- No startup recovery, durable-write notification, lifecycle coalescing,
  attachment generations, parked lifecycle errors, shutdown wiring, or retry
  timing.
- No public cursor, epoch, shard-result, lifecycle, monitor, scheduler, or
  retry-policy API.
- Preserve T-0034 exhausted-row behavior, pending/skipped `CATCH_UP`, and
  fail-closed legacy `IMPORT_EVENT`.

## Accepted Split

T-0036 remains one coherent package; it is not split further. Loop epoch
progress and worker evidence must land together so T-0037 can consume one
complete internal interface without reopening worker internals.

- Each explicit worker start performs one bounded step for a finite admitted
  per-shard epoch. Useful work cannot reset or extend the bound.
- Post-admission rows are excluded from that epoch.
- `PAUSED` retains opaque continuation and the epoch bound for a later explicit
  selective start.
- `IDLE` completes; fulfilled `FAILED` and `SKIPPED` park; `STOPPED` cannot
  continue.
- Mixed results explicitly continue only paused shards.
- Rejection preserves configured shard identity, original cause, obligation,
  and last safe progress while fulfilled sibling evidence remains available.
- The existing direct compatibility path preserves its current single-cause or
  ordered `AggregateError` rejection behavior.
- Supporting declarations stay beside the loop/worker classes and remain
  package-internal. T-0037 ownership/readiness/reporting fields are excluded.

## Test-First Acceptance

- Continuous supported appends do not extend an admitted epoch.
- `PAUSED` resumes the same exact admitted rows beyond saved progress without
  rebuilding that epoch. A large unsupported prefix advances across completed
  single-read admission chunks. Completed passes restart at the head to keep
  later backdated rows eligible while growing pass depth preserves forward
  progress.
- Useful work is bounded per start like skipped work.
- Mixed `PAUSED`/`FAILED`/`SKIPPED` selectively reruns only `PAUSED`.
- Rejected and fulfilled sibling shard evidence remains ordered and associated.
- Multiple rejection causes keep configured-shard order; compatibility throws
  the same single cause or ordered `AggregateError`.
- Rejected continuation requires a later explicit invocation.
- Stop/concurrent-start behavior remains compatible.
- T-0034, `CATCH_UP`, and `IMPORT_EVENT` regressions remain green.
- Root exports and generated API docs expose no epoch, cursor, obligation,
  shard-result, or selective-start declaration.

## Likely Files

- `packages/server/src/delivery/delivery-loop.ts`
- `packages/server/src/delivery/delivery-worker.ts`
- `packages/server/src/delivery/delivery.ts` only if drain admission needs it.
- `packages/server/src/delivery/inbox-storage.ts` only if a package-internal
  admission-bound read is required.
- Focused delivery loop and worker-runtime tests.
- `build-protocol/RUNTIME_ARCHITECTURE.md` and T-0036 durable records.

Do not edit root exports, `DEVELOPER_API.md`, examples, environment/server
lifecycle code, or generated files.

## Design Risks

- A key high-watermark is insufficient unless storage ordering is monotonic;
  otherwise pair it with a monotonic finite work budget.
- Zip configured shard, loop, obligation, and settled result explicitly; do not
  infer identity from filtered fulfilled-array position.
- Keep compatibility rejection separate from richer internal evidence.
- Successful callbacks must not reset the per-start bound.

## Coordinator Design Constraint

The current inbox order uses caller-visible `whenReceived`, `version`, and a
random message ID. The low-level public receive path accepts caller-provided
time/version, so a callback can append a post-admission row that sorts before an
admission high-watermark. A bare latest-key bound is therefore insufficient.

Implementation must first prove with tests that normally ordered and backdated
callback writes are excluded from the current epoch. Use a bounded immutable
admission snapshot or an equally strong package-internal mechanism. A finite
work counter may additionally bound execution but cannot alone establish row
membership.

## Verification

- PASS: Read-only requirements split completed; no files or generated artifacts
  changed by the splitter.
- PASS: Coordinator inspected TypeScript inbox ordering/storage and the local
  Spine JVM delivery specification. Bare key high-watermark was rejected;
  bounded snapshot/equivalent membership is required.
- PASS: Fresh-worktree generated build and focused delivery loop/worker suites:
  3 files, 123 tests.
- NOTE: Initial focused test/typecheck attempts failed only because fresh
  ignored workspace/protobuf outputs were absent; dependency install and
  `proto:generate` restored the expected baseline without tracked output.
- PASS: TDD cycle 1 proved normally ordered and backdated callback writes were
  previously admitted during an active run, then passed after exact-ID snapshot
  admission and bounded useful-work continuation.
- PASS: TDD cycle 2 proved the internal ordered shard-evidence invocation was
  absent, then passed with selective `PAUSED` continuation and associated
  shard/obligation/cause/progress evidence.
- PASS: TDD cycle 3 proved admission rejection could expose stale prior-epoch
  progress, then passed after progress reset moved before admission.
- PASS: Focused loop/worker baseline expanded to 3 files / 128 tests; focused
  loop/worker/delivery/inbox regressions passed 4 files / 257 tests.
- PASS: Generated TypeScript build (`tsc -b`). Full `pnpm verify` was not run,
  per task direction.
- FINDING: Coordinator pre-review audit found that retaining only the capped
  ordering continuation can permanently bypass a post-admission backdated row
  at or before that continuation. The starvation fix must preserve eventual
  eligibility of those rows without extending the active immutable epoch.
- FINDING: Changed-file ESLint reports two stop guards as statically
  unnecessary. Preserve the asynchronous stop behavior through a lint-clean
  implementation.
- PASS: TDD cycle 5 proved that a later backdated row remained bypassed while
  every subsequent admission stayed capped, then passed after finite growing
  admission sweeps periodically restarted from the inbox head.
- PASS: Final pre-review fix verification: loop suite 39 tests; four-file
  delivery suite 258 tests; generated `tsc -b`; changed-file ESLint over all
  five changed TypeScript source/test files.
- PASS: Coordinator repeated the 4-file / 258-test suite, generated build,
  changed-file ESLint, `docs:check`, `format:check`, and `git diff --check`.
  Documentation emitted only the existing invalid-`origin` source-link warning.
- PASS: Implementation committed as `1ea10745`; review status was reconciled in
  `a1714e1f`, reviewers were assigned in `a3187dcf`, and findings were recorded
  in `0c0b18e7`. Only the eventual Round 1 fix commit remains a future hash.
- REVIEW: Round 1 TypeScript/API docs was clean. Documentation found stale
  current status and commit-ledger wording. Maintainability requested smaller
  transition methods, clearer sweep naming/invariant text, removal of an unused
  shard parameter and summary getter, and clearer sweep-test boundaries.
  Performance/reliability found that multi-page admission is not atomic: a row
  written between admission reads can join the active epoch. One single-read
  admission fix batch is required before all-lane rereview.
- PASS: Round 1 fix coordinator gate: 4 delivery files / 259 tests, generated
  build, changed-file ESLint, `docs:check`, `format:check`, and
  `git diff --check`. Only the known invalid-`origin` TypeDoc warning remains.
- PASS: Round 1 fixes committed as `474bfd78`; the rereview-package status
  was reconciled in `add82669`, and the Round 2 package was generated from that
  fixed baseline.
- REVIEW: Round 2 code style, TypeScript/API docs, and
  performance/reliability returned clean. Documentation found only stale
  current summary/ledger text: the implementation report still says completed
  coordinator/package steps remain, and the ledger omits known reconciliation
  commit `add82669`. A narrow docs/status fix was required before all-lane
  rereview; the following PASS records that fix, while rereview remains.
- PASS: The Round 2 docs/status worker corrected the active remaining-work
  summary, added all known commits through `192b3d3b` to the work-log ledger,
  and aligned the four durable statuses. No runtime, test, or architecture
  semantics changed. Lightweight docs/status lint, `pnpm docs:check`,
  `pnpm format:check`, and `git diff --check` passed; docs emitted only the
  known invalid-`origin` warning. No rereview is claimed. A docs/status fix
  commit, fresh review package, all-lane rereview, and the final gate/merge
  remain.
- PASS: Round 2 docs/status fixes committed as `40793085`; status was
  reconciled in `32827343`, and Round 3 package
  `.superpowers/sdd/review-67da0b1c..32827343.diff` was generated from that
  fixed boundary. No future hash remains from that phase.
- REVIEW: Round 3 code style and TypeScript/API docs returned clean.
  Documentation found one stale implementation-report remaining-work line.
  Performance/reliability found a P1 adapter-cost issue: admitted rows are read
  once for membership and then reread sequentially by ID, producing up to 1,001
  storage operations for one 1,000-row epoch. Retain bounded canonical admitted
  row snapshots while claim CAS preserves current-state safety, add operation-
  count coverage, correct status, and rerun all lanes.
- PASS: TDD cycle 7 measured 1,000 sequential inbox point reads after the one
  capped admission query. Retaining detached canonical admitted rows removed
  those reads; the focused operation-count regression then passed with one
  query and zero point reads. A later admitted supported row changed to
  `DELIVERED` and another acquired a live claim before `PAUSED` continuation;
  durable claim CAS skipped both without callback, accepted work, delivery, or
  failure.
- PASS: Round 3 fix verification so far: focused GREEN 2 tests, loop suite 41
  tests, four delivery files / 260 tests, generated `tsc -b`, and changed-file
  ESLint over all four changed TypeScript files. Documentation, formatting, and
  final diff/status checks remain before worker closure. Full `pnpm verify`
  remains reserved.
- PASS: `pnpm docs:check`, `pnpm format:check`, and `git diff --check` passed on
  the Round 3 fix tree. Docs emitted only the known invalid-`origin` source-link
  warning. The worker claims no rereview; fix commit, package rereview, and the
  final task gate/merge remain.
- PASS: Coordinator pre-review performance follow-up removed per-drain
  whole-epoch canonical copies while preserving one-time admission detachment.
  Focused operation/stale-state tests passed 2 tests, the four-file suite passed
  260 tests, generated `tsc -b` passed, and changed-file ESLint passed. No
  private array-identity contract was added.
- PASS: Round 3 fixes committed as `e6c92128`; package-boundary reconciliation
  is the sole future hash under the ledger convention.
- PASS: Round 4 code style/maintainability, documentation, TypeScript/API docs,
  and performance/reliability all returned clean. The API lane confirmed 205
  expected server exports and no root/subpath leakage; reliability passed 2
  focused files / 55 tests. Final full verification remains.
- GATE: Sandboxed full verify reached 54/60 files but listener/IPC tests failed
  with expected `EPERM`. Native rerun passed all 60 files / 1,293 tests, then
  coverage ran all 1,293 tests successfully but failed the global branch
  threshold: 89.73% actual versus 90% required. Add focused coverage for new
  epoch branches, rerun review lanes, and repeat the full native gate.
- PASS: Final test-only coverage cycle added retained-epoch validation and
  duplicate/stale-row behavior, package-internal cursor/access/concurrent-start
  errors, invalid admission/progress handling, and new-obligation shard
  readmission. Focused coverage passed 2 files / 71 tests; the selected delivery
  sources measured 258/375 branches, including 91.75% for `delivery-loop.ts`
  and 95.45% for `delivery-worker.ts`. Native `pnpm verify` passed ordinary and
  coverage runs at 60 files / 1,309 tests. Global coverage is now 95.14%
  statements (7,036/7,395), 90.11% branches (3,591/3,985), 98.20% functions
  (1,918/1,953), and 95.15% lines (6,898/7,249), up from 89.73% branches
  (3,576/3,985). The test change still requires a fresh fixed-baseline package
  and all four rereview lanes; no clean rereview is claimed.
- PASS: At `2026-07-12T04:42:00Z`, the coordinator independently passed the
  four-file / 260-test suite, generated build, changed-file ESLint,
  `docs:check`, `format:check`, and `git diff --check` after the one-time
  snapshot-copy optimization. Only the eventual Round 3 fix commit remains a
  future hash; package rereview and the final gate still follow it.

## Implementation Result

- Each loop admits detached canonical pending-row snapshots from one inbox read
  capped by the existing storage read limit, currently 1,000 rows, and retains
  only those bounded rows plus an opaque index across `PAUSED`. Canonical
  detachment occurs once at admission; read-only drain internals reuse the
  private frozen retained array and perform no preliminary per-ID row read.
  Supported rows remain guarded by durable claim and mark CAS. Completed capped epochs advance through finite
  admission sweeps whose chunk depth doubles between passes. Restarting each
  pass at the head keeps later backdated rows eligible; increasing depth
  preserves progress through arbitrary finite unsupported prefixes without an
  ever-growing remembered-ID set.
- Exact-row epoch drains exclude all post-admission rows regardless of
  caller timestamp/version ordering and bound both supported and skipped work.
- Package-internal worker evidence preserves configured order, obligation,
  fulfilled run/progress, and rejected original cause/progress. Direct
  `DeliveryWorker.start()` retains its existing throw policy.
- No root export, environment lifecycle, retry timing, generated source,
  example, or public delivery declaration changed.
- Stop observed during admission prevents the first drain; stop after a drain
  starts still lets that drain settle before `STOPPED`.
