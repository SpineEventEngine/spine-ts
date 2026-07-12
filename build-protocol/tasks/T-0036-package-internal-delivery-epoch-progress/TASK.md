# T-0036: Package-Internal Delivery Epoch Progress

Status: Requirements split complete; coordinator design validation pending
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
- A large unsupported prefix pauses, then resumes beyond saved progress to an
  admitted supported tail without restarting at the head.
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

## Verification

- PASS: Read-only requirements split completed; no files or generated artifacts
  changed by the splitter.
- Pending coordinator storage-order validation and baseline verification.
