# T-0016e: Delivery Worker Integration

Status: complete; integrated to main
Start: `2026-07-08T11:54:09Z`
Baseline commit: `f226fda`
Branch: `task/T-0016e-delivery-worker`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016e-delivery-worker`

## Objective

Connect the existing durable inbox and shard registry to a small framework-owned
delivery worker. The worker should claim a shard, read pending inbox rows,
invoke a supplied endpoint callback, record delivery outcomes, and release the
shard. Keep this slice local and direct; do not introduce a broad scheduler,
catch-up pipeline, transport runtime, or app-facing delivery API.

## Requirements

- Use the existing `Delivery`, `Inbox`, `InboxStorage`, `ShardIndex`, and
  `ShardedWorkRegistry` storage concepts.
- Add only the status update behavior needed for a worker to mark messages as
  delivered or leave them pending for retry.
- A worker must claim a shard before dispatch, skip work if another worker owns
  the shard, and always release its session after a claimed run.
- A worker run must process `TO_DELIVER` messages in inbox order, invoke one
  supplied framework endpoint callback per message, and return simple run
  statistics.
- Failed endpoint calls must not mark the message delivered. They remain
  retryable in a later run, and the failure must be visible in the run result.
- Deduplication must continue to be storage-backed: already delivered messages
  with live retention still block duplicate writes.
- Keep direct in-process mode simple. Do not add a public scheduler,
  long-lived loop, broad delivery monitor, retained attempt-history store,
  catch-up machinery, system-context maintenance, or transport-specific API in
  this task.
- Update runtime architecture, developer API, package docs, and task/review
  logs to describe the implemented worker boundary and deferred behavior.

## Spine JVM Inspection

Current upstream files inspected before implementation:

- `server/src/main/java/io/spine/server/delivery/Delivery.java`
- `server/src/main/java/io/spine/server/delivery/Inbox.java`
- `server/src/main/java/io/spine/server/delivery/InboxStorage.java`
- `server/src/main/java/io/spine/server/delivery/ShardedMessageDelivery.java`
- `server/src/main/java/io/spine/server/delivery/TargetDelivery.java`
- `server/src/main/java/io/spine/server/delivery/LiveDeliveryStation.java`
- `server/src/main/java/io/spine/server/delivery/GroupByTargetAndDeliver.java`
- `server/src/main/java/io/spine/server/delivery/Conveyor.java`
- `server/src/main/java/io/spine/server/delivery/Station.java`
- `server/src/main/java/io/spine/server/delivery/DeliveryMonitor.java`
- `server/src/main/java/io/spine/server/delivery/ShardedWorkRegistry.java`

Implementation impact:

- JVM `Delivery.deliverMessagesFrom()` claims one shard through
  `ShardedWorkRegistry`, reads inbox pages, dispatches them, and releases the
  shard in a `finally` block. Spine TS should keep the same claim-read-dispatch-
  release shape.
- JVM `LiveDeliveryStation` filters `TO_DELIVER` messages, dispatches them, and
  marks delivered messages as `DELIVERED`; failed reception handling is monitor
  controlled. Spine TS should start with a simple result object and leave failed
  messages pending for retry.
- JVM `Conveyor.flushTo()` writes changed inbox rows in bulk. Spine TS has no
  bulk storage seam yet, so this task may add a small per-message status update
  method behind `InboxStorage` instead of widening the storage contract.
- JVM `TargetDelivery` groups messages by target and optional batch listener.
  Spine TS should not implement batching yet; one callback per inbox row is
  enough for the current local in-process boundary.
- JVM delivery includes catch-up, observers, maintenance dispatchers, monitors,
  and local async observers. These are explicitly out of scope for this slice.

## Likely Files

- `packages/server/src/delivery`
- `packages/server/test/delivery`
- `packages/server/src/index.ts`
- `packages/server/README.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/work-logs/T-0016e.md`
- `build-protocol/reviews/T-0016e-delivery-worker.md`

## Acceptance Criteria

- Delivery exposes a small framework-owned worker or drain API that processes
  one shard by claiming it, reading pending inbox rows, invoking a callback, and
  releasing the shard.
- Successful delivery marks inbox rows `DELIVERED`; failed delivery leaves them
  `TO_DELIVER` and records failures in the run result.
- Duplicate writes are still blocked by delivered rows while their retention
  window is live.
- Shard ownership, release-on-failure, retry behavior, and outcome statistics
  are covered by focused tests.
- Public docs and TypeDoc/API docs describe the worker boundary and deferred
  catch-up/scheduler/transport behavior.
- Required review lanes are clean: code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.
- `corepack pnpm verify` passes, with any sandbox limitations recorded.

## Review Plan

After the implementation sub-agent reports completion, run five separate
reviewer sub-agents:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed every finding back to an implementation/fix sub-agent and repeat review
rounds until all lanes are clean.
