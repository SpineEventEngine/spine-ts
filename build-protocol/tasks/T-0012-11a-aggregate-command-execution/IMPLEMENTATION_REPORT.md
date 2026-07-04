# Implementation Report: T-0012.11a Aggregate Command Execution

Status: implementation complete; ready for review
Branch: `task/T-0012-11a-aggregate-command-execution`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11a-aggregate-command-execution`
Baseline commit: `8804e93`

## Summary

This slice starts from the reviewed `T-0012.11` split where repository command
dispatch still ends at route calculation. The implementation target is the
smallest real aggregate write path:

- async `CommandBus.post()` acceptance;
- repository command execution for one aggregate route;
- command assignee invocation through registered handler metadata;
- aggregate event application before snapshot persistence;
- aggregate history persistence through `AggregateStorage`; and
- async handoff of already-stored events to the existing event-bus dispatcher
  path without a second append.

## Initial Evidence

- `CommandBus` already provides async intake through
  `SingleProcessServerRuntime.enqueue()`.
- `Repository` already owns handler metadata, default routing, and internal
  command/event dispatcher adapters, but command dispatch currently calls only
  `routeCommand()`.
- `AggregateStorage` already persists aggregate event streams plus snapshots
  through `EventStore` and `RecordStorage`.
- `EventBus.post()` currently appends before dispatch, so aggregate-produced
  events cannot simply be reposted after `AggregateStorage.appendEvents()`
  without double-writing them.
- The curated JVM docs keep aggregate command execution on the write side:
  command handlers emit events, appliers mutate state, event history is the
  source of truth, and latest state is stored as a side channel.

## Open Design Point

The only real design tension in this slice is event-bus reuse after aggregate
storage:

- `EventBus.post()` appends and then dispatches.
- `AggregateStorage.appendEvents()` already appends aggregate events.

Chosen path:

- keep aggregate append/version validation and snapshot writes in
  `AggregateStorage`; and
- add a small internal `EventBus` access path for already-stored events so the
  repository can dispatch them asynchronously without calling `EventBus.post()`
  and appending them again.

The stored-event dispatch path intentionally skips the pre-store append step
because aggregate-produced events are already persisted through the write-side
storage seam before event-bus handoff.

## TDD Record

- RED:
  - Ran `pnpm install` with escalation after sandbox DNS/network failures in the
    fresh worktree prevented dependency preparation.
  - Ran `pnpm typecheck:build` to generate protobuf output and build workspace
    package entrypoints needed by Vitest.
  - Ran
    `pnpm test packages/server/test/repository/repository-routing.test.ts`.
  - The new built-context command-execution test failed for the expected slice
    reason: `ExecutingTaskAggregate.assigneeCalls` stayed `0`, proving the
    repository dispatcher still stops at routing instead of invoking the
    aggregate assignee.

- GREEN:
  - Added aggregate runtime binding during bounded-context repository
    registration.
  - Changed repository command dispatch so aggregate repositories load/create
    one aggregate, invoke the assignee, bind sequential event versions, apply
    event appliers, append through `AggregateStorage`, write the latest
    snapshot, and then dispatch already-stored events through the event bus.
  - Re-ran
    `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/aggregate-storage.test.ts`
    and got 2 files, 36 tests passed.

## Verification

- `pnpm install` passed with escalation after sandbox DNS failures in the fresh
  worktree.
- `pnpm typecheck:build` passed.
- `pnpm test packages/server/test/repository/repository-routing.test.ts`
  produced the expected RED with `ExecutingTaskAggregate.assigneeCalls` staying
  `0`.
- `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/aggregate-storage.test.ts`
  passed with 2 files and 36 tests after the implementation.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `git diff --check` passed.
- `pnpm docs:check` was not run because this slice did not move public/API docs
  or package-root public exports.
- `pnpm test:coverage` failed in the sandbox for known environment reasons:
  `packages/transport/test/zeromq/local-ipc-smoke.test.ts` hit
  `Operation not permitted`, and `packages/server/test/services/spine-services.test.ts`
  hit repeated `listen EPERM: operation not permitted 127.0.0.1` timeouts while
  starting the real HTTP/2 gRPC server.
- Orchestrator reran `pnpm test:coverage` with local IPC/HTTP2 permissions. All
  528 tests passed, but branch coverage was 89.45% against the required 90%
  gate.
- Added focused follow-up tests for array command output, missing aggregate
  appliers, and malformed produced events before storage.
- Added event-bus follow-up tests for dispatching already-stored events,
  malformed stored events, and invalid stored-event access.
- Added bus validation follow-up tests for missing and blank command/event
  message type URLs after full coverage still reported 89.75% branch coverage.
- Added dispatcher-registry follow-up tests for schema collection retry,
  repeated schema deduplication, and reentrant command dispatcher registration
  after full coverage still reported 89.87% branch coverage.
- Added a final same-command-dispatcher registration test after coverage still
  reported 89.99% branch coverage.
- Final escalated `pnpm test:coverage` passed with 44 files and 543 tests:
  statements 94.89%, branches 90.05%, functions 97.3%, lines 94.91%.
