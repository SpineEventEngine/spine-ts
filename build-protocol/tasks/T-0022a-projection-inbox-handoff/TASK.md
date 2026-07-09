# T-0022a: Projection Inbox Handoff

Status: in progress
Start: `2026-07-09T21:21:23Z`
Baseline commit: `7799d88`
Branch: `task/T-0022a-projection-inbox-handoff`
Worktree:
`.worktrees/T-0022a-projection-inbox-handoff`

## Objective

Move live projection subscriber delivery behind the durable local inbox handoff,
matching Spine JVM `ProjectionRepository.dispatchTo()` behavior without adding a
generic delivery engine.

## Scope

- Implement only live projection event subscriber handoff.
- Route each projection target to a durable inbox row before handler execution.
- Use `UPDATE_SUBSCRIBER` for projection subscriber delivery.
- Store the original framework `Event` envelope as the inbox signal payload.
- Use the original event ID as the delivery signal ID and the projection state
  type URL plus routed projection ID as the inbox target.
- Use the current local single shard and the same local dedup window as the
  process-manager command handoff.
- Drain locally and replay only the exact inbox row target.
- Preserve the current projection transaction and `Stand` update behavior.

## Out Of Scope

- Process-manager event reactors and event-commanding methods.
- Aggregate event reactors or importers.
- Projection catch-up (`CATCH_UP`).
- Generic repository event delivery engines.
- Scheduler loops, retry monitors, transport-backed workers, and retained
  attempt history.
- New public end-user APIs.

## JVM Inspection

Current Spine JVM source fetched into scratch before this task:

- `Repository.java`
- `ProjectionRepository.java`
- `ProcessManagerRepository.java`
- `Inbox.java`
- `InboxOfEvents.java`

Local JVM research docs inspected:

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`

Observed behavior to preserve:

- JVM repositories route signals into inbox rows before endpoint delivery.
- `ProjectionRepository.dispatchTo()` sends routed events with
  `inbox.send(event).toSubscriber(id)`.
- Projection subscriber rows use `UPDATE_SUBSCRIBER`.
- Process-manager event rows use `REACT_UPON_EVENT` and remain separate.
- `InboxOfEvents` uses `TO_CATCH_UP` only for `CATCH_UP`; live subscriber and
  reactor rows remain `TO_DELIVER`.
- Delivery deduplication is by original signal ID and inbox target, not by the
  generated inbox message ID alone.

## Likely Files

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/context/projection-handoff.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/test/context/projection-handoff.test.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`

## Acceptance Criteria

- A live event routed to projection subscribers writes durable
  `UPDATE_SUBSCRIBER` inbox rows before projection handler execution.
- Successful local replay marks the rows `DELIVERED`.
- Replay invokes only the inbox-row target, not all targets returned by routing.
- Tenant-scoped projection updates remain tenant-scoped in `Stand`.
- `InboxStorage` remains the deduplication authority.
- Duplicate delivery of the same event to the same projection target does not
  double-invoke the projection.
- Existing process-manager command handoff still works.
- Documentation records the implemented projection handoff and the deferred
  process-manager reactor, catch-up, scheduler, retry, and transport-worker
  behavior.

## Review Plan

Run the required independent reviewer sub-agents after implementation:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed all findings to an authoring or fix sub-agent and repeat until clean.
