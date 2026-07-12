# T-0036: Package-Internal Delivery Epoch Progress

Status: Round 1 findings accepted; fixes pending
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
- A large unsupported prefix pauses, then resumes the active admitted epoch
  beyond saved progress without restarting that epoch at the head. Completed
  capped admission passes may restart at the head to keep later backdated rows
  eligible while growing pass depth preserves forward progress.
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
- PASS: Implementation committed as `1ea10745`; review-package status
  reconciliation is the sole future hash under the commit-ledger convention.
- REVIEW: Round 1 TypeScript/API docs was clean. Documentation found stale
  current status and commit-ledger wording. Maintainability requested smaller
  transition methods, clearer sweep naming/invariant text, removal of an unused
  shard parameter and summary getter, and clearer sweep-test boundaries.
  Performance/reliability found that multi-page admission is not atomic: a row
  written between admission reads can join the active epoch. One single-read
  admission fix batch is required before all-lane rereview.

## Implementation Result

- Each loop admits up to 10,000 exact pending message IDs in immutable inbox
  order and retains only an opaque index across `PAUSED`. Completed capped
  epochs advance through finite admission sweeps whose depth doubles between
  passes. Restarting each pass at the head keeps later backdated rows eligible;
  increasing depth preserves progress through arbitrary finite unsupported
  prefixes without an ever-growing remembered-ID set.
- Exact-message epoch drains exclude all post-admission rows regardless of
  caller timestamp/version ordering and bound both supported and skipped work.
- Package-internal worker evidence preserves configured order, obligation,
  fulfilled run/progress, and rejected original cause/progress. Direct
  `DeliveryWorker.start()` retains its existing throw policy.
- No root export, environment lifecycle, retry timing, generated source,
  example, or public delivery declaration changed.
- Stop observed during admission prevents the first drain; stop after a drain
  starts still lets that drain settle before `STOPPED`.
