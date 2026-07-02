# T-0012.8: Delivery And Inbox

Status: round-7 review prep
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
- The local delivery proto directory under
  `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/server/delivery`
  was present in this session but contained no proto files.

## Scope

- Add `packages/server/src/delivery` with small `Inbox`, `Delivery`,
  `InboxStorage`, shard index/session, and delivery status/label concepts as
  needed for this first slice.
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
- Consolidated round-1 fix sub-agent completed and was closed after committing
  `c2553cf`.
- Round-2 review completed with changes requested across all five required
  lanes.
- All five round-2 reviewer sub-agents were closed after their reports were
  collected.
- Consolidated round-2 fix sub-agent completed and was closed after committing
  `59a6530`.
- Round-3 review completed with changes requested in maintainability,
  documentation, security, and performance/reliability. The TypeScript/API docs
  lane was clean.
- All five round-3 reviewer sub-agents were closed after their reports were
  collected.
- Consolidated round-3 fix sub-agent completed and was closed after committing
  `76e9132`.
- Round-4 review package is prepared at
  `.superpowers/sdd/review-60c5412..76e9132.diff`.
- Round-4 review completed with one security finding. The other four required
  lanes were clean.
- All five round-4 reviewer sub-agents were closed after their reports were
  collected.
- Round-4 fix implemented in this worktree: direct inbox writes now reject
  mismatched message ID shard/message shard identities, and stored inbox record
  parsing validates canonical record and inbox keys.
- Round-4 fix committed as `d0d5e0d`.
- Round-5 review package is prepared at
  `.superpowers/sdd/review-f74df5d..d0d5e0d.diff`.
- Round-5 review completed with TypeScript/API docs and performance/reliability
  findings. Maintainability and security were clean. Documentation findings
  were stale against the already committed round-5 prep state.
- All five round-5 reviewer sub-agents were closed after their reports were
  collected.
- Round-5 fix implemented in this worktree: exported delivery docs now state
  the shard invariant, and caller-side shard mismatch uses a plain invariant
  error rather than a storage corruption error.
- Round-5 fix committed as `05f2ca7`.
- Round-6 review package is prepared at
  `.superpowers/sdd/review-f924a17..05f2ca7.diff`.
- Round-6 review completed with one TypeScript/API docs finding. The other
  four required lanes were clean.
- All five round-6 reviewer sub-agents were closed after their reports were
  collected.
- Round-6 fix implemented in this worktree by preserving the
  `DeliveryStorageCorruptionError` contract for direct write shard mismatches.
- No blocking human question is known.
