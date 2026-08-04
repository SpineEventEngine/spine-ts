# T-0108: Configurable Durable Stand Registry

Status: In Progress

## Objective

Adds the configurable Stand subscription-registry contract, storage-backed and
in-memory implementations, Bounded Context builder configuration, durable
definition lifecycle, and the production warning for a non-persistent registry.
This task persists subscription definitions; T-0109 owns polling and local
listener reconciliation.

## Classification

High-risk. This task adds a public extension contract and changes persistence,
atomic capacity, multi-node cleanup, Bounded Context ownership, and production
lifecycle behavior.

## Baseline And Isolation

- Baseline: `origin/main@7c5457d1`.
- Branch: `task/T-0108-durable-stand-registry`.
- Worktree: `.worktrees/T-0108-durable-stand-registry`.
- The dirty primary checkout remains coordination-only and untouched.

## Acceptance Criteria

1. Public `StandSubscriptionRegistry` supports create, activate, physical
   delete, a complete bounded snapshot, finite expired-pending cleanup,
   `persistent`, and close behavior.
2. The default storage-backed registry uses the Bounded Context's configured
   `StorageFactory` and tenant scope; 50 active subscriptions produce exactly
   50 definition rows.
3. The default and maximum definition capacity is 100 unless application code
   configures a lower positive limit. Concurrent multi-node creates admit only
   remaining capacity without leaking rows or listeners.
4. Serialized records are at most 1,048,576 bytes. Complete snapshots are
   bounded by capacity; cleanup alone is finite and paged.
5. Subscribe persists `PENDING`; Activate changes it to `ACTIVE`. Pending rows
   expire after 30 seconds. Every node may run the same finite idempotent
   cleanup, using revision-aware physical deletion.
6. Active definitions have no framework TTL. Cancel physically deletes the row
   and releases capacity atomically and idempotently; no tombstone is retained.
7. The codec rejects malformed records: unusable identifier/topic, unknown
   phase, missing creation time, pending deadline outside `PENDING`, and
   incoherent revision.
8. Restart recovery, activate/delete and snapshot/delete races, concurrent
   cleanup, capacity release, and storage-provider conformance are tested.
9. `BoundedContextBuilder.withSubscriptionRegistry(registry)` accepts a complete
   custom implementation; the Bounded Context owns and closes the selected
   registry in correct lifecycle order.
10. The in-memory implementation remains valid and reports
    `persistent === false`. Production environment attachment emits one WARN
    per context and does not fail; other environment types do not warn.
11. Public TSDoc, server README/reference, TypeDoc checks, and limitations are
    accurate. This task adds no polling or local listener reconciliation.

## High-Risk Assumptions

- `Subscription.topic` is the sole stored topic representation; no duplicate
  topic or ownership row is introduced.
- The storage key is the subscription ID. Capacity is one shared atomic counter
  plus one definition row per subscription, following the existing durable
  Gateway quota pattern without reusing the Gateway registry itself.
- Cleanup is safe to execute independently on every application node and is
  finite, idempotent, and revision-aware.
- The existing frozen T-0105 Protobuf record is sufficient. No JVM build is
  permitted; JVM source may be read for semantic evidence only.
- T-0109 owns the 10-second snapshot reconciliation loop, listener attachment,
  revision revalidation before attach, and local sweep.

## Human-Imposed Requirements Ledger

| Requirement                                                                                                             | Evidence              | Status |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------ |
| Use `.add(...)` for Entity registration.                                                                                | Wave 6 Q&A.           | Active |
| Do not fail when production uses an in-memory registry; emit one WARN per context.                                      | Wave 6 Q&A.           | Active |
| Default to the Bounded Context storage factory while allowing a complete custom registry implementation in the builder. | Wave 6 Q&A.           | Active |
| Delete cancelled subscriptions physically by default; do not retain tombstones.                                         | Wave 6 Q&A.           | Active |
| Every application node runs the same finite, idempotent expired-pending cleanup.                                        | Wave 6 Q&A.           | Active |
| Keep T-0108 separate from T-0109 polling/listener reconciliation.                                                       | Approved Wave 6 plan. | Active |
| Do not build Spine JVM.                                                                                                 | Human instruction.    | Active |

## Architecture Assignment

One existing `requirements_splitter` pass is required at this milestone
boundary, explicitly `gpt-5.6-sol` / `high`. It must identify the smallest
JVM-familiar public contract, reuse existing storage transaction/counter
patterns, freeze operation semantics and ownership, and expose real blockers
only. Runtime self-introspection is unavailable; immutable role/profile and
explicit dispatch are the accepted metadata evidence absent a visible mismatch.

## Review Dispositions

- Style/maintainability: required for the public registry and builder boundary.
- Documentation: required for README/reference changes and persistence limits.
- TypeScript/API docs: required for the exported contract and builder API.
- Performance/reliability: required at Terra/high for atomic capacity,
  persistence, cleanup, races, bounds, and close ordering.
- Security: N/A unless implementation changes a trust boundary or accepts new
  untrusted configuration beyond the bounded stored subscription record.

## Verification

Run a focused preflight over registry codecs, storage providers, Bounded Context
lifecycle, and production warning before review. After convergence, run
`verify:release` because shared server runtime and public contracts change.
