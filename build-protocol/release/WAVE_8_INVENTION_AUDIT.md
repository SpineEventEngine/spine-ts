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

`RemovalQuarantine` and removal fingerprints; receipts and markers; replacement
dedup records and per-message claims; `DeliveryAttempt`, `AttemptExhaustion`,
and `RetryDecision`; revoked-session facilities; `ApplicationNodeLease:v1` and
versioned discovery keys; `@spine-event-engine/validation-ts`; shared-layout
fingerprints; and the retired pre-Wave-8 persistence vocabulary.

The checker scans current package/source/manifests/examples/public docs/active
Proto surfaces only. It explicitly permits a truthful negative public-doc
statement and excludes historical evidence, so the inventory cannot be passed
by deleting history or by a blanket word ban.

## Result

No human-decision-required item is open. Any checker finding is a runtime or
current-contract finding and returns to its owning task context; this closure
does not design a replacement.
