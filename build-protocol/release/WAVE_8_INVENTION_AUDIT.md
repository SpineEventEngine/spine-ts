# Wave 8 Invention Audit

Status: Pre-review deterministic inventory

This is the current-state inventory for Wave 8 closure. It classifies current
runtime/public surfaces; historical plans, decisions, reports, task records,
work logs, reviews, research, generated `dist`, and tests are evidence, not
current behavior. The deterministic companion is
[`check-wave8-invention-audit.mjs`](../../scripts/check-wave8-invention-audit.mjs).

## Classification key

- **Human-approved**: explicitly required by the Wave 8 ledger.
- **JVM counterpart**: JVM-familiar record or behavior adopted by Wave 8.
- **TS necessity**: bounded adapter/lifecycle detail required by this runtime.
- **Removed**: forbidden pre-Wave-8 invention; the checker protects its absence.

## Persisted records and serialization boundaries

| Surface                                                              | Classification  | Current evidence                                                                          |
| -------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `EntityRecord`, grouped state/event history, and Event Store `Event` | JVM counterpart | Direct `RecordSpec` families; current state is never reconstructed from events.           |
| `InboxMessage` and shard-session record                              | Human-approved  | Direct rows; shard ownership excludes concurrent workers; delivered rows are dedup facts. |
| `SubscriptionRecord`                                                 | Human-approved  | One `spine.client.SubscriptionRecord` per explicit subscription.                          |
| `GatewayAuthenticatedSubscription`                                   | Human-approved  | One approved binding record; single-Gateway scope.                                        |
| `ApplicationNodeLease` and `NodeRegistrationId`                      | Human-approved  | `spine.deployment` direct record and unversioned discovery layout.                        |
| Tenant index                                                         | TS necessity    | Stores `spine.core.TenantId` in its own layout for multitenant discovery.                 |
| Protobuf-ES schemas, `Any`, and descriptor metadata                  | JVM counterpart | The active serialized boundary; authored Proto remains non-optional.                      |

## Public APIs, layouts, and limits

| Surface                                                                         | Classification  | Current evidence                                                                       |
| ------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| `RecordSpec` (`recordType`, ID, columns, `sourceType`) and `StorageGroup`       | JVM counterpart | Providers resolve direct source/record/group layouts.                                  |
| MySQL `setTableName`/create operation and Datastore layout/storage creators     | Human-approved  | Every framework record family remains configurable.                                    |
| Provider structural validation; no automatic migration                          | Human-approved  | Existing layouts are inspected, never altered.                                         |
| Datastore reconciliation 1,000, write batches 500; MySQL query structure bounds | TS necessity    | Bounded provider operation limits, not policy records.                                 |
| `DeliveryMonitor`, `FailedReception`, immediate actions                         | JVM counterpart | Default marks failed reception delivered; durable action failure isolates the target.  |
| Complete `WorkerId` fencing and finite shard lease                              | TS necessity    | Same worker converges before expiry; stale release cannot remove a replacement.        |
| Stand cleanup, Gateway expiry cleanup, bounded queues/pages                     | TS necessity    | Explicit bounded cleanup/lifecycle mechanisms; no quotas or durable scheduling policy. |

## Delivery, subscription, auth, deployment, examples, and documentation

| Surface                                           | Classification            | Current evidence                                                                            |
| ------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| Handler effect plus delivered-row CAS             | Human-approved limitation | Not one transaction; lost acknowledgement may redeliver; downstream work is idempotent.     |
| Remote inbox removal                              | Human-approved            | Rereads exact pending row and calls `removeOne()` with no local state.                      |
| Stand/Gateway subscriptions                       | Human-approved            | Best-effort updates; no complete replay, multi-Gateway coordination, quota, or reservation. |
| Browser auth/session collaborators                | TS necessity              | Application-owned identity/session policy; no Wave 8 persistence invention.                 |
| Node discovery and provider layouts               | Human-approved            | Per-record source layout with no versioned key or migration path.                           |
| Examples and current READMEs/REFERENCE/USER_GUIDE | Human-approved            | Teach direct records, provider customization, monitor behavior, and no-migration cutover.   |

## Removed artifacts protected by the deterministic audit

`RemovalQuarantine`; `RemovalFingerprint`; `DeliveryReceipt`; `DeliveryMarker`;
`DeliveryClaim`/`DedupGuard`/`DedupRecord`; `DeliveryAttempt`;
`AttemptExhaustion`; `RetryDecision`; `RevokedSession`;
`ApplicationNodeLease:v9` (the manifest rejects every `:vN`); the retired
`@spine-event-engine/validation-ts`; and `compatibilityFingerprint`. The
machine-readable source of truth is
[`.wave8-forbidden-artifacts.json`](../../.wave8-forbidden-artifacts.json).

## Navigable contract evidence

| Contract                                                                                             | Classification  | Exact evidence                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecordSpec`, `RecordSpecOptions`, `RecordColumn`, `StorageGroup`, `StorageFactory`, `RecordStorage` | JVM counterpart | [storage exports](../../packages/storage/src/index.ts), [options](../../packages/storage/src/record/record-spec.ts), [reference](../../packages/storage/REFERENCE.md)                                                                                      |
| Entity/current/history/Event Store record specs                                                      | JVM counterpart | [Entity descriptor](../../packages/server/src/entity/entity-storage-descriptor.ts), [history specs](../../packages/storage/src/entity/entity-history-record-spec.ts), [Event Store](../../packages/storage/src/event/event-store.ts)                       |
| Inbox, `InboxStorage`, shard session, `WorkerId`, `Delivery`, `DeliveryMonitor`                      | Human-approved  | [server exports](../../packages/server/src/index.ts), [Inbox records](../../packages/server/src/delivery/inbox-records.ts), [fencing](../../packages/server/src/delivery/sharded-work-registry.ts), [server reference](../../packages/server/REFERENCE.md) |
| `SubscriptionRecord` and subscription registry                                                       | Human-approved  | [Proto](../../packages/proto/proto/spine/client/subscription_record.proto), [registry](../../packages/server/src/stand/subscription-registry.ts)                                                                                                           |
| `GatewayAuthenticatedSubscription` and bindings                                                      | Human-approved  | [Proto](../../packages/proto/proto/spine/auth/authenticated_subscription.proto), [bindings](../../packages/server/src/server/durable-subscription-bindings.ts), [auth reference](../../packages/auth/REFERENCE.md)                                         |
| `ApplicationNodeLease`, `NodeRegistrationId`, registry                                               | Human-approved  | [Proto](../../packages/proto/proto/spine/deployment/node_discovery.proto), [record spec](../../packages/deployment/src/registry/leased-node-registry.ts)                                                                                                   |
| MySQL table/create configuration                                                                     | Human-approved  | [builder](../../packages/storage-rdbms/src/mysql/storage-factory.ts), [reference](../../packages/storage-rdbms/REFERENCE.md)                                                                                                                               |
| Datastore layouts and custom creators                                                                | Human-approved  | [builder](../../packages/storage-datastore/src/datastore/storage-factory.ts), [reference](../../packages/storage-datastore/REFERENCE.md)                                                                                                                   |
| Validation package                                                                                   | Human-approved  | [core manifest](../../packages/core/package.json), [facade](../../packages/core/src/index.ts)                                                                                                                                                              |

## Exact bounded-mechanism ledger

| Area                          | Value/scope                                                                  | Persistence, retry, cleanup outcome                                                                        | Evidence                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Inbox reads/dedup             | reads 1–1,000; dedup scan pages 2, max 500 pages                             | delivered row suppresses through optional `keepUntil`; absent is indefinite                                | [Inbox storage](../../packages/server/src/delivery/inbox-storage.ts)                                                       |
| Repository handoff            | `keepUntil = whenReceived + 30,000 ms`                                       | repository choice only; no separate dedup record                                                           | [repository](../../packages/server/src/repository/repository.ts)                                                           |
| Shard lease                   | default 30,000 ms; valid 1,000–2,147,483,647 ms                              | same complete worker renews; other worker waits for expiry; stale release is fenced                        | [registry](../../packages/server/src/delivery/sharded-work-registry.ts)                                                    |
| Delivery monitor              | one immediate repeat action                                                  | default marks delivered; failed mark leaves row pending, blocks same target, continues independent targets | [delivery](../../packages/server/src/delivery/delivery.ts), [reference](../../packages/server/REFERENCE.md)                |
| Stand registry                | pending 30,000 ms; scan 26/delete 25; definition ≤1 MiB                      | active has no TTL; bounded cleanup is idempotent                                                           | [registry](../../packages/server/src/stand/subscription-registry.ts), [reference](../../packages/server/REFERENCE.md)      |
| Datastore                     | reconciliation 1,000; batch 500; transaction ≤25 groups/500 mutations        | only ABORTED retries, max 3; later chunk failure leaves earlier chunks durable                             | [reference](../../packages/storage-datastore/REFERENCE.md)                                                                 |
| MySQL/MariaDB                 | query 256 IDs/32 filters/64 values/filter/8 sorts/2,048 bindings             | InnoDB transaction; MyISAM/Aria deterministic prefix and idempotent retry                                  | [reference](../../packages/storage-rdbms/REFERENCE.md)                                                                     |
| Remote delivery server/client | page 1–1,000; write/remove batches 1–100                                     | one RPC mutation; lost acknowledgement may redeliver; no local removal state                               | [client reference](../../packages/delivery-client/REFERENCE.md), [server README](../../packages/delivery-server/README.md) |
| Browser/auth and query        | browser auth default 64 active requests; Datastore query is provider-bounded | auth/session policy is application-owned; query never silently returns partial reconciliation              | [server README](../../packages/server/README.md), [Datastore reference](../../packages/storage-datastore/REFERENCE.md)     |

The checker scans current package/source/manifests/examples/public docs/active
Proto surfaces only. It explicitly permits a truthful negative public-doc
statement and excludes historical evidence, so the inventory cannot be passed
by deleting history or by a blanket word ban.

## Result

No human-decision-required item is open. Any checker finding is a runtime or
current-contract finding and returns to its owning task context; this closure
does not design a replacement.
