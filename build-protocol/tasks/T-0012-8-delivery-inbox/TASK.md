# T-0012.8: Delivery And Inbox

Status: round-1 fixes pending
Start: `2026-07-02 07:52 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-8-delivery-inbox`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-8-delivery-inbox`
Baseline commit: `de3ccc7`

## Goal

Add the first small durable delivery slice after repositories can receive
signals.

## JVM Evidence

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` says
  `InboxMessage` is the durable delivery record and that delivery deduplicates
  by `(signal_id, inbox_id)`, not by record ID alone.
- The same document says `DeliveryStrategy.determineIndex(entityId,
entityStateType)` returns a zero-based shard index and that all messages for
  one target entity should map to one shard unless a custom strategy
  deliberately changes the trade-off.
- Shard pickup must use compare-and-set semantics in backing storage; Node
  multi-process deployment cannot rely on in-process locks.
- The local JVM source tree under
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/delivery`
  did not contain the concrete delivery Java sources in this session, so the
  checked-in research docs are the source baseline.

## Scope

- Add `packages/server/src/delivery` with small `Inbox`, `Delivery`,
  `InboxStorage`, shard index/session, delivery status/label, and local
  delivery strategy concepts as needed for this first slice.
- Build durable inbox storage over the existing `StorageFactory` /
  `RecordStorage` seam.
- Support writing inbox messages with target inbox identity, original signal
  identity, label, status, shard, received time, ordering version, and optional
  dedup retention.
- Support deduplication by `(signal ID, inbox ID)` for live inbox writes.
- Support shard pickup/release with a storage-backed record so the API is not
  just an in-process lock.
- Keep worker loops, retry monitors, conveyor/stations, repository invocation,
  `Stand`, gRPC services, transport retries, and example app work out of this
  slice.
- Keep APIs short, JVM-familiar, and source/test files grouped by semantics.
- No exported standalone helpers unless a strong reason is recorded.

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Required Verification

- Focused delivery/inbox tests.
- Typecheck, lint, tracked formatting, docs/API, and diff hygiene.
- Broader verification if the implementation touches shared storage behavior.

## Current State

- Implementation sub-agent completed and was closed after committing
  `0f7986a`.
- Review round 1 completed with changes requested across all five required
  lanes.
- All five round-1 reviewer sub-agents were closed after their reports were
  collected.
- No blocking human question is known.
