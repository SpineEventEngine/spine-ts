# Implementation Report: T-0012.12b Create Task Flow

Status: implementation verified; review pending
Branch: `task/T-0012-12b-create-task-flow`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12b-create-task-flow`
Baseline commit: `775aa47`

## Summary

This slice adds the first real runnable to-do workflow: create one task, persist
the event through the aggregate path, project it to the read side, and query the
task list through existing framework service seams.

## Current State

- `TaskAggregate` uses `@Assign(CreateTaskSchema)` and
  `@Apply(TaskCreatedSchema)` and materializes those decorators through
  `materializeDecoratedEntityHandlers()`.
- `TaskListProjection` subscribes to `TaskCreated` and writes one visible
  task-list projection for the created task.
- `createTodoContext()` assembles a single-tenant `Tasks` bounded context with
  direct repositories and the framework's default in-memory storage.
- Aggregate storage/routing now accepts message-valued aggregate IDs so the
  generated `TaskId` contract can be used directly.
- Generated output remains ignored and untracked.

## Sub-Agent Note

Implementation agent `019f3241-11a3-7790-ac86-15bdb454b653` was closed while
still running after repeated waits. It left uncommitted WIP and no final report.
The main orchestrator inspected the diff, kept only the narrow implementation
direction, amended the WIP, and ran focused verification before this report was
updated.

## Verification So Far

- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`:
  passed, 2 tests.
- `pnpm typecheck`: passed after serial rerun.
- `pnpm exec vitest run examples/todo/src/index.test.ts packages/server/test/repository/aggregate-storage.test.ts --passWithNoTests`:
  passed, 31 tests.
- `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts --passWithNoTests`:
  passed, 46 tests.
- `pnpm exec vitest run examples/todo/src/index.test.ts packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts --passWithNoTests`:
  passed, 83 tests.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm docs:check`: passed with generated `@generated` TypeDoc warnings and
  the known invalid-origin source-link warning.
- `pnpm proto:check-generated`: passed.
- `git diff --check`: passed.
- Escalated
  `pnpm exec vitest run --coverage --passWithNoTests --testTimeout=120000 --maxWorkers=1`:
  passed 45 files / 631 tests. Coverage: statements 95.06%, branches 90.12%,
  functions 97.61%, lines 95.07%.

## Planned Verification

- Focused example black-box tests for create/query flow. Passed.
- `pnpm typecheck`. Passed.
- `pnpm lint`. Passed.
- `pnpm format:check`. Passed.
- `pnpm docs:check`. Passed with known/generated warnings.
- `pnpm test:coverage`. Sandboxed/default-timeout attempts failed for
  environmental/timing reasons; timeout-adjusted escalated coverage passed and
  met thresholds.
- `git diff --check`. Passed.

## Reviewer Risks

- Keep the example small; do not introduce a broad client DSL or server facade.
- Review the message-ID aggregate storage change carefully. It is intentionally
  narrow, but it changes a formerly primitive-only internal assumption.
- Raw Vitest imports of decorated source fail before `tsc` lowering. The focused
  example test uses built output and the user guide records `pnpm typecheck:build`
  as the prerequisite.
- `vitest.config.ts` excludes only `examples/todo/src/index.ts` from V8 coverage
  because the current Vitest transform path cannot execute raw standard
  decorators. The focused example test covers the compiled `tsc` output.
