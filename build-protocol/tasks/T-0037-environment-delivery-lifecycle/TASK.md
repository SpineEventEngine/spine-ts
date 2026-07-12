# T-0037: Environment Delivery Lifecycle

Status: Requirements split pending
Started: `2026-07-12T04:15:00Z`
Baseline commit: `0308bc4a`
Branch: `task/T-0037-environment-delivery-lifecycle`
Worktree: `.worktrees/T-0037-environment-delivery-lifecycle`

## Objective

Consume T-0036's package-internal delivery epoch and shard evidence at the one
`ServerEnvironment` lifecycle seam selected by D-0085, while keeping retry
timing, public monitor/scheduler APIs, topology, and adapters deferred.

## Human-Imposed Requirements Ledger

- Continue autonomously until the project is complete or a real blocker occurs.
- Use this isolated feature branch/worktree and required subagents.
- Split the work into smaller coherent slices when that keeps implementation
  and review packages small.
- Read relevant Spine JVM server documentation/source before implementation.
- Use TDD for runtime behavior.
- Run lightweight docs/status lint before review.
- Run code style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability lanes until clean; defer security to final project
  readiness.
- Use focused inner-loop tests and reserve full `pnpm verify` for final gates.
- Ignore superseded history unless current records claim it active.
- Keep generated Protobuf output out of VCS.
- Do not touch `human-review-1-jul.md`.

## Decision Boundary

- D-0085 assigns one package-internal owner at `ServerEnvironment` level.
- T-0037 consumes T-0036 evidence without reopening loop/worker internals.
- Expected lifecycle scope includes attachment/generation cardinality, startup
  recovery, local supported-write readiness, coalescing, parked rejected-cause
  ownership/reporting, and stop/shutdown ordering.
- Retry delay, backoff, jitter, public retry policy, public monitor/action APIs,
  process supervision, topology, adapters, catch-up delivery, and legacy
  `IMPORT_EVENT` support remain excluded.

## First Required Step

Run a read-only requirements split against D-0085 and current server,
environment, context-handoff, and T-0036 internal seams. The splitter must
recommend the smallest coherent implementation sequence and identify whether
T-0037 itself should become multiple independently reviewed child slices before
runtime code changes.

## Verification

- Pending requirements split and coordinator validation.
