# T-0148: JVM-Compatible MySQL Tenancy and Layout

Status: In progress; non-releasable stacked checkpoint.

## Objective

Correct the MySQL adapter so a complete generated tenant selects one configured
database/pool before record-family work, while single tenancy uses its one
configured database. Match Spine JVM's native ID and declared-column values,
and delete `_scope`, `_revision`, Bounded Context physical identity, and the
private tagged/binary value encodings without aliases or a dual layout.

## Baseline

- Branch: `task/T-0148-mysql-tenancy`.
- Baseline: `77a41124` from the non-releasable T-0147 common-contract branch.
- Canonical plan:
  `build-protocol/planning/STORAGE_TENANCY_CORRECTION_PLAN.md`.

## Acceptance

- The builder accepts either one single-tenant options value or immutable typed
  tenant/database entries; ambiguous, blank, duplicate, and same-target entries
  fail before pool use.
- Every operation selects the correct tenant pool before table, query,
  transaction, or lock work; missing, unexpected, and unknown tenants fail
  closed.
- Tables have primary key `ID`, serialized `bytes`, and declared columns only.
  `_scope` and `_revision` do not occur in production SQL or schema checks.
- Primitive IDs use native JVM-compatible scalar values. Message IDs and
  ordinary message columns use compact Proto JSON. Other columns match the
  frozen T-0147 mappings.
- The identical typed mapping converts persisted columns, query operands,
  sorting values, and continuations.
- Existing exact-payload compare-and-set remains transactional through row
  locking and payload comparison, without a revision column.
- All pools close exactly once, including partial-build failure paths.
- Focused tests, package typecheck, ESLint, TSDoc, Prettier, diff checks, and
  prohibited-symbol scans pass before the checkpoint is pushed.

## Exclusions

- No old-layout migration, compatibility facade, or dual read/write.
- No Datastore, shared server, example, or beginner-guide cutover; those belong
  to T-0149 and T-0150.
- No merge to `main`; T-0147 through T-0150 form one release train.

## Human Requirements Preserved

- Bounded Context names never partition MySQL data.
- Tenant isolation is database/data-source selection, not a hidden column.
- Physical values must be readable and queryable by Spine JVM.
- No replacement scope, revision, marker, receipt, claim, fingerprint, or
  persisted tenant-index record may be introduced.
