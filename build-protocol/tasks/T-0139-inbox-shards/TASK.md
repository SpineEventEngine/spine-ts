# T-0139: Inbox And Shard Records

Status: Complete on stacked integration train; T-0140/T-0142 build handoffs recorded.

## Objective

Persists approved `InboxMessage` and shard-session Protobuf records directly,
uses shard ownership as the only delivery exclusion mechanism, migrates
TenantIndex to direct `TenantId`, and deletes all invented attempt, claim,
dedup, quarantine, removal-fingerprint, JSON-in-`Any`, receipt, and marker
persistence.

## Classification

High-risk. This task changes serialized delivery records, shard concurrency,
deduplication, provider selection, and remote removal failure behavior.

## Baseline And Ownership

- Baseline: pushed T-0138 commit `713658d6`.
- Branch: `task/T-0139-inbox-shards`.
- Worktree: `.worktrees/T-0139-inbox-shards`.
- Ownership: Inbox, shard registry, lease, and pickup sources/tests under
  `packages/server/src/delivery/**`; TenantIndex persistence; all
  `packages/delivery-client/**` source/tests/exports/docs involving
  `RemovalQuarantine`, fingerprints, or replacement persistence; provider
  conformance tests; T-0139 records.
- Do not implement DeliveryMonitor policy (T-0140), examples (T-0142), logging
  (Wave 9), multiple Gateways, JVM changes/builds, or compatibility aliases.

## Frozen Human Requirements

- Store only real Protobuf records; never JSON packed in `Any`.
- Store pending and delivered `InboxMessage` rows directly. Delivered rows are
  the deduplication fact.
- Use shard ownership as the only delivery exclusion mechanism. Do not acquire
  per-message claims or separate deduplication records.
- Preserve the JVM rule that one node owns and drains a shard until no pending
  messages remain.
- Delete delivery attempts, quarantine persistence, remote
  `RemovalQuarantine`, removal fingerprints, receipts, and replacement marker
  types.
- Store the existing `spine.core.TenantId` directly for TenantIndex.
- Prove MySQL and Datastore customization reaches every surviving durable
  family owned by the integration train.

## Architecture Assignment

- Existing role: `requirements_splitter`.
- Expected and explicitly dispatched profile: `gpt-5.6-sol` / `high`.
- Freeze exact record specifications, IDs/columns, shard-session ownership and
  fencing transitions, pending/delivered dedup semantics, remote removal
  behavior without quarantine, provider selector identities, TenantIndex
  migration, concurrency/failure cases, deletion inventory, and ordered TDD
  slices.
- Read-only; no edits, subagents, JVM work, DeliveryMonitor implementation, or
  new persistent types.

The assignment completed with the immutable configured
`requirements_splitter` profile `gpt-5.6-sol` / `high`. Runtime model and
reasoning self-introspection were unavailable; no visible mismatch or fallback
occurred.

## Frozen Architecture

### Inbox Records

The existing ergonomic TypeScript `InboxMessage` remains a delivery-port type.
The persistence seam converts it to and from the approved generated
`spine.server.delivery.InboxMessage`. Storage never wraps this record in `Any`
and never serializes it as JSON.

The ungrouped `RecordSpec` uses `InboxMessageSchema` for both source and record,
`InboxMessageIdSchema` for its identifier, and the required `id` field as the
record ID. It exposes these columns:

- `inbox_id`, as a message value;
- `signal_id`, as a message value;
- `shard_index` and `shard_total`, as numbers;
- `status`, as a number;
- `when_received`, as a timestamp;
- `version`, as a number;
- `message_id`, as a string.

The mapper validates nonblank message and signal identifiers, the complete
`InboxId`, equal public and identifier shard values, known non-unknown label
and status values, the command/event payload selected by the label, finite
timestamps, optional `keep_until`, and a nonnegative `int32` version. Invalid
caller input raises `InboxMessageError`; an invalid stored record raises
`DeliveryStorageCorruptionError`.

Insertion is compare-and-set from absence and never overwrites a collision.
Delivery completion is one exact-record compare-and-set from pending to the
same record marked delivered. An already matching delivered row is idempotent
success. Delivered rows are the deduplication facts: while holding the shard,
delivery queries the exact Inbox and signal IDs, suppresses a duplicate if a
live delivered predecessor exists, and marks the duplicate row delivered.
An expired `keep_until` does not suppress delivery. There is no guard record,
per-message claim, attempt, receipt, marker, or background retention policy.

The handler side effect and delivered transition are intentionally not one
transaction. A lost acknowledgement can therefore redeliver after restart;
downstream signal idempotency owns this existing at-least-once boundary.

### Shard Sessions

The ungrouped shard `RecordSpec` uses `ShardSessionRecordSchema` for source and
record, `ShardIndexSchema` for the ID, and the required `index` field as the
record ID. It has no materialized columns and requires atomic compare-and-set.

`WorkerId.nodeId` is the stable application `NodeId` from `ServerEnvironment`.
`WorkerId.value` is an opaque UUID generated once per delivery-worker lifetime,
reused by that worker, distinct between workers on one node, and regenerated
after process restart. No separate session, generation, epoch, token, or
persisted expiry exists.

Expiry is derived as `when_last_picked + leaseMs`; equality at the boundary is
expired. Acquisition compare-and-sets a missing, unowned, or expired exact
record to the current worker and time. A live record owned by another worker is
unavailable. Renewal requires the same complete Worker ID and exact live
snapshot. Release compare-and-sets the exact owned snapshot to an unowned row,
retaining `when_last_picked`; it never deletes the row. Compare-and-set loss is
reread and retried within the existing bound. Invalid timestamps or arithmetic
overflow fail closed.

The exact stored snapshot and complete Worker ID are the fence. A dead worker
can be replaced after derived expiry. A stale owner cannot renew, complete, or
release after takeover. Lost acquisition and renewal acknowledgements converge
only when reread state has the same complete live Worker ID. Lost release
acknowledgement converges when reread state is unowned.

One owner retains the shard while repeatedly reading pending rows until a full
rescan is empty, including messages arriving during the drain. It revalidates
or renews ownership before callback or durable completion and releases in
`finally` after in-flight work settles. No per-message claim remains.

### Tenant Index

TenantIndex keeps its string-only API and persists the approved
`spine.core.TenantId` directly through an ungrouped spec whose source, record,
and ID schema are all `TenantIdSchema` and whose record is its own ID. `keep()`
uses the `value` oneof case. `all()` accepts only that case; domain/email or an
invalid case is storage corruption, never silently flattened.

### Provider Selection

All three families are ungrouped with identical source and record types.
MySQL customization therefore uses record-only `setTableName(...)`, and
Datastore customization uses record-only `useRecordStorage(...)`, for
`InboxMessageSchema`, `ShardSessionRecordSchema`, and `TenantIdSchema`.
Runtime-construction tests must prove these hooks are reached.

The complete surviving-family conformance ledger is current `EntityRecord`,
grouped state-history `EntityRecord`, grouped event-history `Event`, ungrouped
Event Store `Event`, `InboxMessage`, `ShardSessionRecord`,
`SubscriptionRecord`, `GatewayAuthenticatedSubscription`,
`ApplicationNodeLease`, and TenantIndex `TenantId`.

### Remote Removal

Delete `RemovalQuarantine`, its record and error types, every configuration or
constructor input, lifecycle state, fingerprint, export, fixture, test, and
documentation claim. Do not replace it with a Set, map, marker, receipt,
fingerprint, or persistent type.

Remote `begin` rereads the authoritative row and admits only the exact pending
message in the exclusively owned shard. `complete` calls `removeOne` directly
and becomes inactive only after success. After an uncertain failure, a later
read observes either absence or a retryable row. The error is handed to the
T-0140 monitor boundary; T-0139 stores nothing about it.

### Deletions And T-0140 Boundary

Delete without aliases all message claims, separate dedup records/storage,
JSON/base64/UTF-8 `Any` Inbox and shard records/type URLs, durable attempts,
parked/quarantine/dead-letter persistence, receipts, fingerprints, and markers.
Repository scans must reject these concepts and any replacement persistent
message type.

T-0139 owns the direct records, storage primitives, provider families,
TenantIndex, and removal-quarantine deletion. T-0140 owns monitor callbacks,
reception actions, default failure continuation, timers/backoff, and final stop
policy. T-0139 must not add an attempt compatibility facade or provisional
monitor. Its focused owned tests must pass; the stacked branch may retain only
an explicitly inventoried compile failure in T-0140 orchestration files that
still import old retry/attempt policy.

## Ordered TDD Slices

1. Direct Inbox spec, generated mapping, validation, and round trip.
2. Collision-safe insert, exact pending-to-delivered transition, and delivered
   row deduplication; remove claims and guard storage.
3. Direct shard-session spec, derived lease, exact-worker CAS transitions, and
   corruption handling.
4. Worker lifetime identity, restart/takeover, acknowledgement convergence, and
   stale-owner fencing.
5. Drain-until-empty without per-message claims.
6. Direct TenantId storage behind the existing string API.
7. Provider customization and complete surviving-family conformance.
8. Remote removal without quarantine or fingerprint state.
9. Mechanical deletion scans, docs/API cleanup, focused coverage, and exact
   T-0140 integration-failure inventory.

### Implementation Progress

- 2026-08-08: Slice 1 direct `InboxMessage` record specification is GREEN;
  generated mapping, validation, and storage round trip remain in progress.
- 2026-08-08: Slices 7 and 8 now have focused direct-family provider evidence
  and direct remote removal without persistent client state. Slice 9 deletion
  removed attempts/retry decisions and the removal-quarantine API. The remaining
  package TypeScript inventory is deliberately confined to the T-0140 delivery
  orchestration boundary and requires no T-0139 compatibility facade.
- 2026-08-08: All nine implementation slices are converged in the bounded
  worktree. Direct Inbox coverage is independent of the server-root/T-0140
  graph and covers corrupt stored records, exact pending-to-delivered CAS,
  live delivered suppression, and expired delivered admission. Direct shard
  coverage includes same-worker lost-acknowledgement convergence, takeover and
  stale fencing, distinct worker/restart identities, and mid-drain arrival or
  ownership loss. Runtime provider construction proves all three direct
  families reach the configured MySQL and Datastore record hooks. Narrow API
  documentation states the at-least-once/idempotency boundary truthfully.

## Verification And Review

- Required reviews: TypeScript/API docs, performance/reliability, and
  style/maintainability; documentation when public claims change.
- Security is N/A unless a trust or authorization boundary changes.
- Required verification: focused concurrency/corruption tests, provider
  conformance, changed-source coverage at least 90% in every metric, package
  checks, and one focused `verify:task` after convergence.

### 2026-08-08 Review-Correction Evidence

- Focused direct/provider/client suite: 8 files / 62 tests passed. The exact
  six-source V8 profile passed at 94.59% statements, 91.19% branches, 97.18%
  functions, and 96.69% lines, without coverage configuration changes.
- Changed-file ESLint and Prettier, delivery-client typechecking, and
  `git diff --check` pass. Server typechecking is limited to the frozen eight
  T-0140 orchestration diagnostics; TSDoc is limited to inherited storage-rdbms
  debt. Review correction re-review remains required only for reliability and
  maintainability.

### 2026-08-08 Final Targeted Re-Review Evidence

- RED/GREEN tests prove durable Timestamp/number cursor values exclude the
  cursor row, bounded same-key delivered scans continue beyond expired pages to
  a live predecessor and fail closed at their finite 500-page bound, and direct
  TenantId domain/email/unset corruption throws `DeliveryStorageCorruptionError`.
- The exact six-source coverage profile passed 8 files / 65 tests at 94.36%
  statements, 90.70% branches, 97.20% functions, and 96.56% lines. Reliability
  and maintainability await their final re-review; all other lane dispositions
  remain unchanged.

### 2026-08-08 Pre-Epoch Timestamp Evidence

- Direct Inbox record and continuation timestamp conversion use normalized
  floor seconds and non-negative nanos. Regression tests cover `-1ms` durable
  record round-trip and a pre-epoch cursor excluding itself while returning its
  next row. The exact six-source profile is 8 files / 67 tests at 94.38%
  statements, 90.70% branches, 97.20% functions, and 96.57% lines.

### 2026-08-08 Coverage Correction

The test-only coverage correction preserves the frozen runtime and T-0140
boundary. The exact V8 command targeted only the six behavior-changed runtime
sources: `context/tenant-index.ts`, `delivery/inbox-records.ts`,
`delivery/inbox-storage.ts`, `delivery/sharded-work-registry.ts`, remote
`adapters.ts`, and remote `remote-delivery.ts`. It passed 7 files / 52 tests
with 93.49% statements (532/569), 90.11% branches (392/435), 97.05% functions
(132/136), and 95.86% lines (487/508), with no threshold or configuration
exclusions. Direct tests cover TenantId modes/corruption, Inbox mapping and
CAS/dedup branches, shard ownership/corruption/drain branches, RemoteInbox
pagination/admission, and RemoteDelivery lifecycle/close branches. Export-only
and TSDoc-only changed files remain deterministic API/documentation targets,
not runtime coverage sources.
