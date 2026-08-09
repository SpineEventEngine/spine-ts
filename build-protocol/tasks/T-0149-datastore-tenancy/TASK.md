# T-0149: JVM-Compatible Datastore Tenancy and Layout

Status: In progress; non-releasable stacked checkpoint.

## Objective

Correct the Datastore adapter so a complete generated tenant selects a native
Datastore namespace for every key, query, and transaction, while single tenancy
preserves the caller client's configured/default namespace. Match Spine JVM's
kind, key-name, and declared-property values, and delete `_scope`, Bounded
Context physical identity, tagged private values, and persisted tenant-index
records without aliases or a dual layout.

## Baseline

- Branch: `task/T-0149-datastore-tenancy`.
- Baseline: `6ed83aed` from the reviewed, non-releasable T-0148 MySQL branch.
- Canonical plan:
  `build-protocol/planning/STORAGE_TENANCY_CORRECTION_PLAN.md`.

## Acceptance

- The default converter maps complete generated TenantIds reversibly to JVM
  namespaces `D<domain>`, `E<email>`, and `V<value>` without collisions.
- Every multitenant key, query, and transaction carries the selected native
  namespace. Single-tenant operations preserve the client default.
- Kinds derive from the approved record-family type/group mapping without a
  Bounded Context name. Keys use the JVM stringified record ID.
- Entities contain unindexed serialized `bytes` plus declared Proto columns
  only. `_scope` and private tagged property formats are absent.
- Stored columns, filter/range operands, sorting values, and continuations use
  the identical typed JVM-compatible Datastore mapping.
- Tenant catalog enumeration reads native `__namespace__` metadata through the
  same converter, ignores unrelated namespaces, and persists no TenantId row.
- Converter admission rejects empty/incomplete TenantIds, collisions, invalid
  namespaces, and an empty/default namespace in multitenant mode.
- Existing compare-and-set remains atomic through provider transactions and
  exact payload comparison without a private revision property.
- Focused tests, package typecheck, ESLint, TSDoc, Prettier, diff checks, and
  prohibited-symbol scans pass before the checkpoint is pushed.

## Exclusions

- No old-layout migration, compatibility facade, or dual read/write.
- No shared server, delivery startup, examples, or final beginner-guide cutover;
  those belong to T-0150.
- No merge to `main`; T-0147 through T-0150 form one release train.

## Human Requirements Preserved

- Bounded Context names never partition Datastore data.
- Tenant isolation is the native namespace, not a hidden property.
- Physical values must be readable and queryable by Spine JVM.
- No replacement scope, revision, marker, receipt, claim, fingerprint, or
  persisted tenant-index record may be introduced.
