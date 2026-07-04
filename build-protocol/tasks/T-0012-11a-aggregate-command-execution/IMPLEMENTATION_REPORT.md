# Implementation Report: T-0012.11a Aggregate Command Execution

Status: round-2 review fixes complete; verification passed with escalated coverage
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

## Coverage-Fix Follow-up

Full escalated coverage after the review-fix commit passed all 552 tests but
missed the global branch gate by 0.15 percentage points, with
`packages/server/src/repository/primitive-id.ts` called out as the clearest
small coverage gap. The follow-up adds one focused internal repository test for
primitive aggregate IDs, covering string/number/boolean producer-ID
packing/unpacking, legacy `UserId` unpacking, absent producer IDs, unreadable
producer IDs, and nonprimitive runtime values. No production helpers were added.

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
- Coverage-fix focused test:
  `pnpm test packages/server/test/repository/primitive-id.test.ts` passed with
  1 file and 3 tests.
- Coverage-fix sandboxed `pnpm test:coverage` still fails only on the known
  local IPC/HTTP2 permission errors.
- Coverage-fix escalated `pnpm test:coverage` passed with 45 files and
  555 tests. Coverage summary: statements 94.87%, branches 90.03%, functions
  97.34%, lines 94.89%.

## Review-Fix Worker Follow-up

The T-0012.11a review-fix worker addressed the subsequent documentation,
public API, simplicity, and reliability findings:

- public docs now distinguish direct route-only repository APIs from built
  bounded-context aggregate command execution;
- handler-backed aggregate repository options now require aggregate `bigint`
  version metadata at the type boundary;
- primitive producer-ID behavior is grouped behind the `PrimitiveIds` object,
  and the aggregate-storage one-line primitive wrapper was removed;
- aggregate command assignees are awaited before produced events are
  normalized;
- appended events are handed to stored-event dispatch even when snapshot
  writing rejects, while command completion still reflects the snapshot
  failure; and
- repository preparation checks existing registration before binding runtime,
  so a failed reentrant build cannot clear an already registered repository's
  executable runtime.

Focused RED/GREEN coverage was added for async assignees, snapshot-write
failure dispatch, reentrant registration cleanup, and the bigint public type
boundary.

Fresh verification for this worker passed:

- `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/repository.test.ts packages/server/test/repository/primitive-id.test.ts packages/server/test/repository/aggregate-storage.test.ts packages/server/test/context/bounded-context.test.ts packages/server/test/index.test.ts`
  passed with 6 files and 105 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `pnpm docs:check` passed and regenerated TypeDoc.
- `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed on known local endpoint permissions:
  ZeroMQ local IPC `Operation not permitted` and HTTP/2 loopback
  `listen EPERM: operation not permitted 127.0.0.1`.
- Escalated `pnpm test:coverage` passed with 45 files and 559 tests. Coverage
  summary: statements 94.85%, branches 90.03%, functions 97.33%, lines 94.87%.

## Round-2 Review-Fix Worker

The round-2 worker addressed the reliability, style, and documentation findings
reported after the follow-up review-fix pass:

- aggregate event appliers are now awaited during command execution and
  rehydration before event append/snapshot ordering proceeds;
- focused RED/GREEN coverage proves command completion waits for an async
  applier before snapshots are persisted, and async applier rejection rejects
  command completion before storage append;
- `packages/server/test/repository/primitive-id.test.ts` no longer imports the
  internal `PrimitiveIds` helper and instead proves primitive producer-ID
  routing through `AggregateStorage`;
- `docs/USER_GUIDE.md` now distinguishes built aggregate command
  assignee/applier execution from the remaining deferred handler/runtime work;
  and
- small public-surface coverage tests in command/event readiness and signal
  intake keep the global branch gate green after replacing the direct internal
  primitive-ID helper test; and
- this implementation report, the task log, review log, and work log carry
  explicit round-2 review-fix state.

Focused round-2 verification:

- RED:
  `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/primitive-id.test.ts`
  failed because async applier command completion resolved before the applier
  gate and async applier rejection was unobserved by command completion.
- GREEN:
  the same focused command passed with 2 files and 25 tests after awaiting
  aggregate event appliers and rewriting primitive-ID coverage through storage.

Final round-2 verification passed:

- `pnpm test packages/server/test/repository/repository-routing.test.ts packages/server/test/repository/primitive-id.test.ts packages/server/test/handler/command-registration-readiness.test.ts packages/server/test/handler/event-registration-readiness.test.ts packages/server/test/runtime/signal-intake.test.ts`
  passed with 5 files and 62 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `pnpm docs:check` passed and regenerated TypeDoc with the existing invalid
  `origin` source-link warning only.
- `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed on known local endpoint permissions:
  ZeroMQ local IPC `Operation not permitted` and HTTP/2 loopback
  `listen EPERM: operation not permitted 127.0.0.1`.
- Escalated `pnpm test:coverage` passed with 45 files and 564 tests. Coverage
  summary: statements 94.85%, branches 90.03%, functions 97.33%, lines 94.87%.
