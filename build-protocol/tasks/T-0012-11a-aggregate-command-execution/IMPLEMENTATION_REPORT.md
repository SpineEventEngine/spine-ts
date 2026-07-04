# Implementation Report: T-0012.11a Aggregate Command Execution

Status: review findings addressed; ready for final verification handoff
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
  - After review, added focused failures for stored-event accept hooks,
    post-commit dispatch isolation, nested command handoff, tenant-scoped
    aggregate storage, bigint version metadata, protobuf int32 version bounds,
    readable producer IDs, and primitive producer-ID routing in aggregate
    storage.

- GREEN:
  - Added aggregate runtime binding during bounded-context repository
    registration.
  - Changed repository command dispatch so aggregate repositories load/create
    one aggregate, invoke the assignee, bind sequential event versions, apply
    event appliers, append through `AggregateStorage`, write the latest
    snapshot, and then dispatch already-stored events through the event bus.
  - Follow-up review fixes introduced one cohesive internal aggregate-command
    executor, command-derived multitenant storage contexts, bigint repository
    version metadata, explicit protobuf int32 version guards, primitive
    producer-ID packing/unpacking, stored-event accept-hook replay, and
    fire-and-forget post-commit stored-event dispatch so delivery failures do
    not reject already-committed command execution.
  - Re-ran
    `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/aggregate-storage.test.ts`
    and got 2 files, 36 tests passed.

## Review Findings Closure

- A. Command execution now commits aggregate history/snapshots first and then
  queues already-stored event delivery without awaiting it. Delivery failures
  stay isolated to the queued event job, and nested commands posted from event
  delivery no longer hold the outer command open.
- B. `EventBus` already-stored dispatch now reuses dispatcher accept hooks
  before delivery without appending again. Accept-hook failures reject only the
  stored-event delivery job.
- C. Aggregate storage now derives multitenant storage context from the caller
  command tenant, preserving tenant isolation for shared aggregate IDs.
- D. Repository-executed aggregates are instantiated with `bigint` aggregate
  version metadata, and produced event versions now fail cleanly when they
  exceed the protobuf int32 range.
- E. Produced aggregate events now preserve readable primitive producer IDs via
  packed primitive wrappers, while producer-ID readers remain compatible with
  existing string `UserId` envelopes.
- F. Aggregate command execution helpers were gathered into one small internal
  executor instead of leaving the new behavior spread across more free
  functions.
- G. Child and parent durable docs/logs now reflect the review-fix state, and
  the public docs describe built aggregate repositories as executable write-side
  components rather than route-only registration metadata.

## Verification

- `pnpm install` passed with escalation after sandbox DNS failures in the fresh
  worktree.
- `pnpm typecheck:build` passed.
- `pnpm test packages/server/test/repository/repository-routing.test.ts`
  produced the expected RED with `ExecutingTaskAggregate.assigneeCalls` staying
  `0`.
- `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/aggregate-storage.test.ts`
  passed with 2 files and 36 tests after the implementation.
- `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/aggregate-storage.test.ts packages/server/test/bus/event-bus.test.ts packages/server/test/bus/command-bus.test.ts`
  passed with 4 files and 75 tests after the review-fix pass.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `pnpm docs:check` passed after the repository/public-doc wording updates.
- `git diff --check` passed.
- Fresh sandboxed `pnpm test:coverage` still fails for known environment
  reasons: `packages/transport/test/zeromq/local-ipc-smoke.test.ts` hits
  `Operation not permitted`, and
  `packages/server/test/services/spine-services.test.ts` hits repeated
  `listen EPERM: operation not permitted 127.0.0.1` while starting the real
  HTTP/2 gRPC server.
