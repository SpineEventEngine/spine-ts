# Implementation Report: T-0012.12b Create Task Flow

Status: complete
Branch: `task/T-0012-12b-create-task-flow`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12b-create-task-flow`
Baseline commit: `775aa47`

## Summary

This slice adds the first real runnable to-do workflow: create one task, persist
the event through the aggregate path, project it to the read side, and query the
task list through existing framework service seams.

Final verification: all required review lanes reported clean in Round 7, and
final full coverage passed 45 files / 639 tests with statements 95.18%,
branches 90.48%, functions 97.63%, and lines 95.20%.

## Current State

- `TaskAggregate` uses `@Assign(CreateTaskSchema)` and
  `@Apply(TaskCreatedSchema)` and materializes those decorators through
  `materializeDecoratedEntityHandlers()`.
- `TaskListProjection` subscribes to `TaskCreated` and writes one visible
  task-list projection row for each created task.
- `createTodoContext()` assembles a single-tenant `Tasks` bounded context with
  direct repositories and the framework's default in-memory storage.
- Aggregate storage/routing now accepts supported primitive or complete
  generated message-valued aggregate IDs so the generated `TaskId` contract can
  be used directly.
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
- Review the message-ID aggregate storage change carefully. It accepts finite
  primitives and complete generated message IDs and changes an internal ID
  assumption.
- Raw Vitest imports of decorated source fail before `tsc` lowering. The focused
  example test uses built output and the user guide records `pnpm typecheck:build`
  as the prerequisite.
- `vitest.config.ts` excludes only `examples/todo/src/index.ts` from V8 coverage
  because the current Vitest transform path cannot execute raw standard
  decorators. The focused example test covers the compiled `tsc` output.

## Round-One Review Fix Plan

- Accept finite primitive values or complete generated message IDs.
- Preserve descriptor-typed message identity in aggregate storage keys and
  repository Event routing.
- Add negative coverage for non-finite numeric IDs and wrong message types.
- Make the focused example test fail clearly when `examples/todo/dist` is stale
  or absent.
- Document that this slice exposes per-task `TaskList` projection rows.
- Suppress generated TypeDoc `@generated` tag warnings while keeping default
  TypeDoc tag handling.

## Review-Fix Verification

- `pnpm typecheck:build`: passed.
- `pnpm exec vitest run packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts examples/todo/src/index.test.ts --passWithNoTests`:
  passed 3 files / 86 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed after applying Prettier to review-fix edits.
- `pnpm docs:check`: passed with only the known invalid-origin source-link
  warning; generated `@generated` tag warnings are gone.
- `pnpm proto:check-generated`: passed.
- `git diff --check`: passed.
- Escalated
  `pnpm exec vitest run --coverage --passWithNoTests --testTimeout=120000 --maxWorkers=1`:
  passed 45 files / 634 tests. Coverage: statements 95.19%, branches 90.52%,
  functions 97.63%, lines 95.21%.

## Round-Two Review Fix Plan

- Normalize snapshot aggregate IDs before persistence so snapshot record JSON
  encoding never sees caller-provided ID objects.
- Route repository IDs according to the repository state's ID field: scalar
  state IDs receive finite primitives, message state IDs receive normalized
  complete generated message IDs.
- Reject non-finite producer IDs and first-field route IDs before Stand/storage.
- Export `PrimitiveId` and `MessageId` from `@spine-ts/server` and update the
  API docs guard.
- Refresh stale task/review/work status after the committed `2753627` fix pass.

## Second-Fix Verification

- `pnpm exec vitest run packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts examples/todo/src/index.test.ts --passWithNoTests`:
  passed 3 files / 89 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed on serial rerun. A parallel run with `pnpm typecheck`
  failed only because concurrent `proto:generate` raced in a temporary generated
  directory.
- `pnpm format:check`: passed after applying Prettier to the new test/log
  edits.
- `pnpm docs:check`: passed with only the known invalid-origin source-link
  warning; API docs now expect 171 `@spine-ts/server` exports.
- `pnpm proto:check-generated`: passed.
- `git diff --check`: passed.
- Escalated
  `pnpm exec vitest run --coverage --passWithNoTests --testTimeout=120000 --maxWorkers=1`:
  passed 45 files / 637 tests. Coverage: statements 95.15%, branches 90.41%,
  functions 97.63%, lines 95.17%.

## Third-Fix Verification

- `pnpm exec vitest run packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts examples/todo/src/index.test.ts --passWithNoTests`:
  passed 3 files / 91 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm format:check`: passed.
- `pnpm docs:check`: passed with only the known invalid-origin source-link
  warning.
- `pnpm proto:check-generated`: passed.
- `git diff --check`: passed.
- Escalated
  `pnpm exec vitest run --coverage --passWithNoTests --testTimeout=120000 --maxWorkers=1`:
  passed 45 files / 639 tests. Coverage: statements 95.18%, branches 90.49%,
  functions 97.63%, lines 95.20%.
