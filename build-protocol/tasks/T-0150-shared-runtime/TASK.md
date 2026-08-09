# T-0150: Atomic Shared-Runtime Storage Cutover

Status: Complete.

## Objective

Complete the storage-tenancy correction as one shared-runtime cutover. Adopt
complete generated tenant boundaries and typed RecordColumn declarations in
the server, organize memory/EventStore/cache identity by tenant and record
family without Bounded Context names, delete the old canonical-scope and stored
TenantId seams, converge examples and active documentation, and verify the
stacked train as one releasable unit.

## Baseline

- Branch: `task/T-0150-shared-runtime`.
- Baseline: `34900a85`, the reviewed T-0149 Datastore checkpoint.
- Canonical plan:
  `build-protocol/planning/STORAGE_TENANCY_CORRECTION_PLAN.md`.

## Acceptance

- The repository compiles with the discriminated `StorageContext` and complete
  generated `TenantId`; no scalar/string compatibility facade remains.
- Every server RecordSpec declares its ID and query columns with the approved
  typed Proto contract. Stored values and Query operands retain symmetric
  provider mappings.
- Memory record storage, Entity history, EventStore, locks, and caches use
  tenant boundary + record family + ID. Bounded Context names never affect
  physical identity or record sharing.
- Tenant startup uses factory-owned provider catalogs or memory tenant slices.
  No generic TenantId RecordSpec, persisted tenant-index row, or provider-local
  tenant parsing remains.
- Inbox, shard, subscription, lease, authenticated subscription, Entity,
  EventStore, and history behavior remain correct, including tenant isolation,
  CAS, worker fencing, acknowledgement recovery, and restart/takeover behavior.
- MySQL and Datastore migration inventory commands fail closed on the invented
  old layout; no dual read/write or automatic winner selection is introduced.
- Examples and beginner-facing guides truthfully show database/namespace
  tenancy, Proto-derived tables/kinds, and symmetric Query column mapping while
  preserving README look and feel.
- Repository scans find no `_scope`, `_revision`, canonical-scope, tagged
  provider values, scalar tenant facade, or persisted TenantId family outside
  explicit historical/migration evidence.
- Changed-source coverage reaches at least 90% in every metric, all relevant
  specialist lanes including security converge, and one final
  `verify:release` passes.

## Exclusions

- No compatibility overload, dual physical layout, online copy-on-read, or
  automatic migration.
- No merge to `main` until the complete T-0147 through T-0150 train passes its
  release gates.
