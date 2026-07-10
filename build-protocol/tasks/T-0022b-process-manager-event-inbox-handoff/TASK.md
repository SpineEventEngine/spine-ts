# T-0022b: Process-Manager Event Inbox Handoff

Status: in review/fixes
Start: `2026-07-10T00:21:00Z`
Baseline commit: `eccbbb1`
Branch: `task/T-0022b-process-manager-event-inbox-handoff`
Worktree:
`.worktrees/T-0022b-process-manager-event-inbox-handoff`

## Objective

Move live process-manager event reactors and event-commanding handlers behind
durable local inbox handoff, matching Spine JVM
`ProcessManagerRepository.dispatchTo()` behavior without adding a generic
delivery engine.

## Scope

- Implement only live process-manager event reactor handoff.
- Route each process-manager event target to a durable inbox row before handler
  execution.
- Use `REACT_UPON_EVENT` for process-manager event delivery.
- Store the original framework `Event` envelope as the inbox signal payload.
- Use the original event ID as the delivery signal ID and the process-manager
  state type URL plus routed process-manager ID as the inbox target.
- Use the current local single shard and the same local dedup window as the
  process-manager command and projection subscriber handoffs.
- Drain locally and replay only the exact inbox row target.
- Preserve current process-manager event behavior: state mutation/storage,
  produced events, produced commands, tenant-scoped `Stand` updates, and
  failure propagation.

## Out Of Scope

- Generic repository event delivery engines.
- Aggregate event reactors or importers.
- Projection catch-up (`CATCH_UP`) and `TO_CATCH_UP`.
- Scheduler loops, retry monitors, transport-backed workers, and retained
  attempt history.
- New public end-user APIs.

## Human-Imposed Requirements Ledger

- Keep the implementation small and JVM-familiar; do not invent a generic
  delivery engine.
- For `@spine-ts/server` runtime/API code, inspect the corresponding Spine JVM
  `core-jvm/server` code before implementation.
- Preserve framework-owned envelopes, transactions, delivery IDs, and handler
  discovery/materialization; end-user code must not manage framework internals.
- Use generated Protobuf APIs first and avoid ad-hoc clone helpers.
- Keep strict read-side/write-side segregation and asynchronous signal
  processing.
- Preserve tenant isolation and fail before handler code when stored inbox
  payloads, tenants, target type URLs, or routed target IDs do not match.
- Update architecture/API/package docs and durable logs as part of the task.
- Run all five required review lanes until clean.

## Splitter Result

The requirements splitter `019f4930-c363-7b31-ae00-0b103599ba85` selected this
as the first non-blocked slice after T-0022a because it is the smallest
remaining repository event endpoint. T-0022a implemented projection subscriber
`UPDATE_SUBSCRIBER` handoff; Spine JVM process-manager event delivery uses the
same inbox shape with `REACT_UPON_EVENT`.

## JVM Inspection

Local research docs inspected before task creation:

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`

Current Spine JVM source snapshot inspected:

- `/private/tmp/spine-ts-core-jvm-t0022/ProcessManagerRepository.java`
- `/private/tmp/spine-ts-core-jvm-t0022/Inbox.java`
- `/private/tmp/spine-ts-core-jvm-t0022/InboxOfEvents.java`

Observed behavior to preserve:

- `ProcessManagerRepository.initInbox()` registers an event endpoint with
  `InboxLabel.REACT_UPON_EVENT`.
- `ProcessManagerRepository.dispatchTo(ids, event)` sends each routed ID through
  `inbox().send(event).toReactor(id)` and returns `sentToInbox(event, ids)`.
- `Inbox.EventDestinations.toReactor(id)` stores the event with
  `REACT_UPON_EVENT`.
- `InboxOfEvents.determineStatus(...)` uses `TO_CATCH_UP` only for
  `CATCH_UP`; ordinary event reactor rows use the default `TO_DELIVER`.

## Likely Files

- `packages/server/src/repository/repository.ts`
- `packages/server/src/context/process-manager-handoff.ts`
- `packages/server/src/context/local-inbox-handoff.ts`
- `packages/server/test/context/process-manager-handoff.test.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`

## Acceptance Criteria

- A live event routed to process-manager event reactors or event-commanding
  handlers writes durable `REACT_UPON_EVENT` inbox rows before handler
  execution.
- Successful local replay marks rows `DELIVERED`.
- Replay invokes only the inbox-row target, not all targets returned by routing.
- Tenant-scoped process-manager state and produced signal behavior remain
  tenant-scoped.
- `InboxStorage` remains the deduplication authority.
- Duplicate delivery of the same event to the same process-manager target does
  not double-invoke the process manager.
- Existing process-manager command handoff and projection subscriber handoff
  still work.
- Documentation records the implemented process-manager event handoff and the
  still-deferred aggregate reactors/importers, projection catch-up, scheduler,
  retry, and transport-worker behavior.

## Review Plan

Run the required independent reviewer sub-agents after implementation:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed all findings to an authoring or fix sub-agent and repeat until clean.
