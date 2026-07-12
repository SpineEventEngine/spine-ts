# T-0036: Package-Internal Delivery Epoch Progress

Status: Requirements split in progress
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

## Verification

- Pending requirements split and baseline verification.
