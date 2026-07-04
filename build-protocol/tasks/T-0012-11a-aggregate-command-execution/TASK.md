# T-0012.11a: Aggregate Command Execution

Status: follow-up review fixes complete; verification passed with escalated coverage
Start: `2026-07-04 21:57 WEST`
Parent task: `T-0012.11 Missing Details And Example Readiness`
Branch: `task/T-0012-11a-aggregate-command-execution`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11a-aggregate-command-execution`
Baseline commit: `8804e93`

## Goal

Turn the current repository-backed aggregate command path from route-only
metadata into real asynchronous command execution.

One posted command must be accepted by `CommandBus`, routed to exactly one
aggregate repository, run one registered `defineEntityHandlers(...).assign(...)`
assignee, apply the produced event(s) through aggregate appliers, persist the
aggregate history and latest snapshot through existing storage seams, and hand
the already-produced events to the existing async event-bus path.

## Must Preserve

- Keep the slice narrow and JVM-familiar.
- Preserve strict write-side/read-side segregation.
- Reuse existing `AggregateStorage` and `EventStore` seams.
- Keep `CommandBus.post()` asynchronous; do not turn command intake into an
  inline full-execution API.
- Avoid broad new abstractions, return-normalization frameworks, extra
  error-detail hierarchies, import/catch-up/scheduler/process-supervisor work,
  or read-model queries from command handling.
- Use generated protobuf APIs first and prefer `clone(schema, message)` where a
  message copy is needed.

## Required Evidence

- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/TASK.md`
- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0012-11-missing-details-example-readiness.md`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/repository/aggregate-storage.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/bus/command-bus.ts`
- `packages/server/src/bus/event-bus.ts`
- `packages/server/src/entity/entity.ts`
- `packages/server/src/handler/handler-metadata.ts`
- `packages/server/src/handler/command-registration-readiness.ts`
- `packages/server/src/handler/event-registration-readiness.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `packages/server/test/repository/aggregate-storage.test.ts`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`

## Acceptance Criteria

- Repository command dispatch no longer stops at `routeCommand()`.
- A built bounded context executes one aggregate happy path through
  `CommandBus.post()` -> repository -> assignee -> applier -> stored history.
- Produced events are applied before the stored snapshot is written.
- Aggregate persistence uses existing `AggregateStorage` / `EventStore` seams.
- Produced events are handed to the async event bus path without being appended
  twice.
- No projection execution, catch-up/import/runtime facade, or validation/refusal
  expansion is added beyond what this slice already preserves.

## TDD Plan

1. Add one focused failing integration-style repository command-execution test
   through a built bounded context.
2. Add the smallest additional focused failures for snapshot state, persisted
   history, async event-bus handoff, and async `post()` behavior.
3. Implement the smallest production slice that makes those tests green.
4. Run the required verification set and record the double-append design choice.

## Verification Plan

- Focused red test command(s) with expected failure summaries.
- Focused green test command(s).
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` or tracked-file Prettier check
- `pnpm docs:check` if public/API docs move
- `pnpm test:coverage`
- `git diff --check`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current State

- Branch/worktree created from reviewed split commit `8804e93`.
- Required task, review, runtime, test, and JVM evidence has been read.
- Durable subtask docs/logs were created before behavior work.
- The aggregate command-execution slice and its review findings A-G are
  addressed in code, focused tests, docs, and durable logs.
- Focused write-side verification passed:
  `packages/server/test/repository/repository-routing.test.ts`,
  `packages/server/test/repository/aggregate-storage.test.ts`,
  `packages/server/test/bus/event-bus.test.ts`, and
  `packages/server/test/bus/command-bus.test.ts` with 4 files and 75 tests
  green.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, and
  `git diff --check` passed in this worktree.
- A fresh sandboxed `pnpm test:coverage` rerun still depends on local endpoint
  permissions. The failing environment symptoms are ZeroMQ local IPC
  `Operation not permitted` and HTTP/2 loopback `listen EPERM 127.0.0.1`
  failures while `packages/server/test/services/spine-services.test.ts` starts
  the real gRPC server.
- The coverage-fix follow-up added primitive-ID tests and escalated
  `pnpm test:coverage` passed with 45 files and 555 tests. Coverage summary:
  statements 94.87%, branches 90.03%, functions 97.34%, lines 94.89%.
- The follow-up review-fix worker addressed the subsequent documentation,
  public generic, simplicity, and reliability findings. Fresh verification
  passed: focused tests (6 files, 105 tests), `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and escalated
  `pnpm test:coverage` (45 files, 559 tests; statements 94.85%, branches
  90.03%, functions 97.33%, lines 94.87%). Sandboxed coverage still fails only
  on local IPC/HTTP2 endpoint permissions.
- The round-2 review-fix worker completed async aggregate applier
  reliability, primitive-ID test style, and stale deferred-work docs/logs.
  Focused RED/GREEN verification passed, the primitive-ID coverage now goes
  through `AggregateStorage`, and small public-surface coverage tests keep the
  global branch gate green. Final verification passed: focused tests (5 files,
  62 tests), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm docs:check`, `git diff --check`, and escalated `pnpm test:coverage`
  (45 files, 564 tests; statements 94.85%, branches 90.03%, functions 97.33%,
  lines 94.87%). Sandboxed coverage still fails only on local IPC/HTTP2
  endpoint permissions.
