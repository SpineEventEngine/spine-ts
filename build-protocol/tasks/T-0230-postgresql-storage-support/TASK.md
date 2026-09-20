# T-0230: PostgreSQL Storage Support Plan

Status: Draft awaiting independent review
Start: `2026-09-20`
Baseline: `6fffcd6102b3eff94b0f77eb6db2fbf2e02ba172`
Branch: `add-postgresql-storage`

## Outcome

Add PostgreSQL as a durable Spine TS storage provider in a separate published npm
package. It provides the same Spine storage behavior as the current MySQL
adapter, using PostgreSQL-native connections, SQL, transactions, schema
inspection, and identifier rules. This planning task does not implement it.

Recommended names used below are `@spine-event-engine/storage-postgresql`,
`PostgreSqlStorageFactory`, `PostgreSqlStorageFactoryOptions`, and
`PostgreSqlTenantStorageOptions`. The human will decide the final public
spelling after review; the design does not depend on that spelling.

## Classification and Requirements

High risk: this adds a published persistence adapter and affects physical data,
transactions, locking, tenant isolation, SQL injection boundaries, credentials,
public APIs, release inventory, and live-provider verification.

- Follow current Spine JVM behavior wherever it defines storage meaning or
  physical values.
- Follow the existing MySQL adapter's observable behavior unless a real
  PostgreSQL difference requires another implementation.
- Publish PostgreSQL support as a new package. Do not rename or turn the MySQL
  package into a multi-provider package in this task.
- Do not add an ORM, query builder, migration framework, generic database
  facade, automatic container management, or speculative recovery mechanism.
- Do not broaden the storage SPI unless a focused test proves PostgreSQL cannot
  implement required behavior through existing provider seams.
- One production-code writer handles the coherent adapter. Parallel work is
  limited to independent research, checks, documentation, and review.
- Runtime work starts with focused failing tests. Live PostgreSQL tests remain
  outside ordinary CI and require explicit URLs.

## Evidence Checked

### TypeScript

- `packages/storage-rdbms` is MySQL-only despite its generic old name. Its
  public API and implementation are explicitly MySQL-named.
- Its roughly 3,300 runtime lines and 3,100 test lines cover typed physical
  values, lazy schema creation and strict inspection, query pushdown,
  compare-and-set, Entity histories, atomic Entity commits, fenced delivery
  cleanup, tenant-to-database routing, and lifecycle closure. “Like MySQL” means
  all of these behaviors, not basic CRUD alone.
- The main dialect differences occur in
  `src/mysql/record-storage.ts`: backticks, `?` parameters, `<=>`, MySQL upsert,
  `INSERT IGNORE`, `GET_LOCK`, engine checks, and MySQL catalog queries.
- Exact package inventories appear in release policy, artifact checks, TypeDoc,
  docs checks, root project references, the lockfile, and infrastructure-test
  inventories. A new package must update all of them.

### Binding JVM sources

Latest official sources were fetched and read at:

- `SpineEventEngine/jdbc-storage` `origin/master` `c747908403764eb9`;
- `SpineEventEngine/core-jvm` `origin/master` `8b3b0498ac847dd3`.

They establish that PostgreSQL is another relational dialect behind the same
storage behavior. PostgreSQL uses `BYTEA` for bytes; supported TS types otherwise
map to `INT`, `BIGINT`, `BOOLEAN`, `VARCHAR(512)`, and `TEXT`. Text comparison is
case-sensitive without MySQL's binary collation. Message IDs and message-valued
columns use the same reversible string form for writes and queries, while
payloads remain Protobuf wire bytes. Table family/group rules remain the same,
but PostgreSQL's 63-byte identifier limit and case folding must not silently
collapse two logical families. The latest JVM PostgreSQL mapping now includes
`REAL` and `DOUBLE PRECISION`. PostgreSQL must support these types without
broadening the existing MySQL adapter merely for symmetry.

### Current upstream baseline

- `pg` `8.23.0` is the current registry release and supports Node 24. Recheck
  and exactly pin the selected release when implementation starts.
- The latest JVM PostgreSQL acceptance uses PostgreSQL 16. Use PostgreSQL 16 as
  the compatibility floor and run the live suite against both 16 and the
  current stable major, PostgreSQL 18. The initial support claim is “PostgreSQL
  16+”; no older major is claimed without evidence.

## Chosen Design

### Package and public API

Create an independent provider package. It depends directly on `pg` plus the
same Spine/Protobuf packages as the MySQL adapter. It does not depend on the
MySQL-oriented `storage-rdbms` package.

Pin `pg` as a runtime dependency and its separately published `@types/pg`
declarations as a development dependency. Do not add Testcontainers.

Do not create `storage-sql`, expose a dialect interface, or move SQL concepts
into `@spine-event-engine/storage`. Extract code to common storage only when both
providers use it unchanged and it is genuinely provider-neutral; otherwise keep
PostgreSQL code local. Similar private code is safer than a misleading public
abstraction.

The package root exports only its factory, builder/options, stable provider
errors, provider Entity handle type, and the complete existing creation-
customization shape: `PostgreSqlTableSpec`, `PostgreSqlCreateOperation`, and
`PostgreSqlCreateOperationFactory`. The builder exposes
`useOperationFactory(factory)`. Compile-only external-consumer tests prove a
caller can implement that callback without importing provider internals. The
root does not export `pg` pools/clients, lock keys, compiler objects, catalog
rows, or test helpers.

### Configuration, tenancy, and lifecycle

- Require a `postgres:` or `postgresql:` URL containing a database name. Reject
  fragments and driver parameters that bypass the explicit options model.
- Mirror bounded MySQL options: pool maximum, connection timeout, and explicit
  TLS CA/certificate/key/server verification, privately translated to `pg`.
- Accept an explicit schema name. When absent, resolve `current_schema()` once
  while building the pool target, validate the result, and then fully qualify
  every table and metadata query. This prevents later ambient `search_path`
  changes. The schema must exist; Spine creates tables, not databases/schemas.
- Single-tenant mode uses one database/schema/pool. Multitenant mode maps each
  complete `TenantId` to a distinct database and pool, with a resolved schema
  inside that database. A schema must not replace the one-database-per-tenant
  boundary. Select the pool before any metadata, table, transaction, lock, or
  data operation; reject duplicate tenants and database targets at construction.
- Construction proves every configured pool. Errors never expose URLs,
  credentials, SQL, or driver internals. Closing is idempotent, closes live
  handles, and drains pools under the existing lifecycle contract.
- Every acquired client is released in `finally`; every started transaction is
  committed or rolled back before release.
- Register every provider-created record, Entity, Entity-commit, and delivery-
  cleanup handle in the factory's live-handle set. A handle unregisters when it
  closes. Factory close rejects creation of every new handle, closes the
  registered handles once, and begins one idempotent pool drain.
- Closing during cleanup prevents a new cleanup operation but lets an already
  acquired client reach commit or rollback before release; pool drain waits for
  that release. Since common `close(): void` cannot report `pool.end()` failure,
  contain and observe the internal drain rejection so it cannot become an
  unhandled rejection. The operation still reports its result/error to its
  caller.

### Names and physical schema

- Preserve current grouped and ungrouped table-name derivation.
- Implement one canonical physical-name function that reproduces the physical
  name created by the latest JVM renderer before registration, collision
  checks, DDL, DML, or inspection. Ordinary JVM names are emitted unquoted and
  therefore fold to lowercase in PostgreSQL; TS may quote only that already-
  folded physical name. Names JVM must quote retain the exact physical spelling
  established by JVM golden output. Golden cases cover mixed-case generated
  names, reserved words, explicit custom names, non-ASCII, the 63-byte boundary,
  case-only differences, and differences after byte 63. Reject unsafe/colliding
  names before access and never accept silent truncation.
- Validate schema separately. Interpolate only validated schema-derived
  identifiers and bind every application value.
- Each family table contains exactly `ID`, `bytes`, and declared native columns;
  `ID` is the primary key. Current Entity tables retain non-null `archived`,
  `deleted`, and `version` defaults `false`, `false`, and `0`.
- Use `BYTEA` for payload/byte columns; `VARCHAR(512)` for text/message IDs;
  `TEXT` for ordinary text/message columns; `INT`, `BIGINT`, and `BOOLEAN` for
  integer/boolean values; and `REAL`/`DOUBLE PRECISION` for floating-point
  columns. Preserve epoch-nanosecond `Timestamp` and numeric `Version` mappings.
- Lazily initialize each qualified table on one client inside a transaction and
  a distinct-domain transaction advisory lock for that table. Create if missing,
  inspect through `information_schema`/PostgreSQL catalogs, then commit only a
  compatible table. Concurrent factories therefore serialize the same first
  initialization. Roll back on DDL/inspection failure and always release the
  client. The normal deadlock/serialization classifier may restart the whole
  initialization once, but schema incompatibility is never retried. Reject
  missing/extra columns, wrong type/nullability/default, wrong primary key, and
  incompatible unique constraints. Never alter an existing table.
- PostgreSQL tables are transactional; there is no MySQL engine fallback.

### Records and queries

- Preserve CRUD, batches, payload CAS, immutable append, Entity history, and
  `RecordQuery` behavior.
- Use `$1` parameters, the canonical JVM-compatible identifier renderer,
  `IS NOT DISTINCT FROM`, PostgreSQL `OFFSET`, and
  `INSERT ... ON CONFLICT (ID) DO UPDATE`.
- Immutable append uses `ON CONFLICT (ID) DO NOTHING`, followed by exact payload
  comparison; a different payload for the same ID is a collision.
- Keep the common 1,000-bind normalized-plan budget despite PostgreSQL's larger
  protocol limit. Both SQL providers should expose the same bounded behavior.
- Advertise the MySQL normalized-query matrix: IDs, five comparisons, nested
  `all`/`either`, declared-column ordering, mask, and finite limit. Every admitted
  plan compiles to one contained SQL statement; no Node full-table fallback.
- Preserve the 10,000 candidate default plus one overflow row.
  `RecordQuery.offset` remains; normalized plans still have no offset.
- Emit `NULLS FIRST` for ascending order and `NULLS LAST` for descending order
  to match the common evaluator. Compile a continuation containing null into
  explicit null predicates; never compare a column to null with `<` or `>`.
- PostgreSQL's configured text collation can order arbitrary Unicode differently
  from JavaScript code-unit order. Do not invent a new collation policy. Prove
  case-distinct IDs and null ordering, and document database-native text order.
- Decode `BIGINT` without precision loss, accept `BYTEA` binary values, and use
  identical typed conversion for writes, filters, ordering, and continuations.
- Do not mutate node-postgres global type parsers; conversions remain local to
  this adapter so another package cannot change its behavior.

### History and maintenance bounds

The current MySQL history adapter contains an existing hazard: some backward,
`stateAt`, trim, and truncate paths read a complete history table and finish the
work in Node. Do not copy that implementation into PostgreSQL. PostgreSQL must
query newest-first for the exact Entity, implement `stateAt` with SQL ordering
and limit, and trim/truncate through bounded key-only SQL pages. If a shared
history extraction would require changing MySQL, first create a separate,
explicit MySQL correction slice; otherwise keep the bounded PostgreSQL logic
local and leave unrelated MySQL correction outside this task.

PostgreSQL uses a private fixed history page size of 128 rows, matching the
accepted RDBMS maintenance contract. Reads use stable newest-first keyset order;
maintenance selects only ordered keys. Each history family has a shared/exclusive
advisory-lock domain. A state or event append takes the matching transaction-
scoped shared family lock; the atomic Entity-commit path does the same before it
appends state history. Global state or event truncation holds the matching
session-scoped exclusive family lock and one client across all pages. Therefore,
an append cannot interleave with a multi-page truncation, while ordinary appends
to different Entities remain concurrent. State append and trim additionally
share one per-Entity advisory-lock domain. Trim holds that session lock and
client while committing independent pages, so an append for that Entity cannot
interleave between pages. The fixed lock order everywhere is family lock, then
per-Entity lock, then row lock.

Truncation freezes a stable provider high-water key only after it holds the
exclusive family lock and deletes ordered 128-key pages no later than that
boundary. A committed page remains durable; a failed page rolls back, and a
retry recomputes the next page without duplicate or skipped deletion. Close lets
the active page settle but starts no next page. No prior page's records or keys
remain retained after progress. Lock/client cleanup runs exactly once, and a
cleanup error does not hide an earlier operation error.

### Transactions, locks, and retries

- `writeAll` uses one client/transaction and commits all rows or none.
- CAS uses one transaction plus a transaction-scoped advisory lock derived from
  database/schema/table/ID. Row locks alone are insufficient because an absent
  PostgreSQL row cannot be locked.
- Atomic Entity commit uses one transaction and per-Entity transaction advisory
  lock. Current state, histories, diagnostics, and delivery events commit as one.
- Delivery cleanup uses one transaction, the same session-record coordination
  rule as ordinary mutation, `FOR UPDATE` reads, exact snapshots, and deletion
  only while the session remains current.
- Hash lock identities locally into signed 64-bit keys with domain prefixes.
  Hash collisions may serialize unrelated work but cannot permit wrong work.
- Retry the complete transaction at most once for `40P01` deadlock or `40001`
  serialization failure. Never retry configuration, schema, constraint,
  decoding, or arbitrary connection failures.

## Implementation Sequence and Estimate

Estimates are active engineering time. One writer handles production code;
independent reviews/checks run in parallel only after deterministic checks.

### 1. Contract and package skeleton — 2–3 hours

1. Add RED compile/contract tests for factory/builder API, option snapshotting,
   custom DDL callback, exports, errors, and closed lifecycle.
2. Add package manifest/project/public root, exact driver, workspace reference,
   and lockfile entry.
3. Add release, artifact, TypeDoc, docs, dependency, and package inventory
   expectations; prove the published runtime graph stays acyclic.

Exit: the package is recognized everywhere; tests fail only for missing runtime.

### 2. Connection, tenancy, names, schema — 6–8 hours

1. Implement URL/options/TLS validation, pools, connection proof, sanitized
   failures, client release, and idempotent closure.
2. Implement single/multitenant routing and duplicate-target rejection.
3. Implement the single JVM-compatible canonical physical-name function,
   collision rules, and 63-byte limit.
4. Implement table specs, including PostgreSQL float/double, ID/column mappings,
   concurrent advisory-fenced DDL/catalog inspection, and no global parsers.
5. Add JVM golden, invalid configuration/name/schema, simultaneous two-factory
   initialization, rollback/client release, and lifecycle tests.

Exit: an empty database can produce one strictly verified family table.

### 3. Record operations and query pushdown — 6–8 hours

1. Implement CRUD, upsert, immutable insert, batches, binary decoding/errors.
2. Implement advisory coordination and CAS, including absent-row races and
   bounded whole-transaction retry.
3. Implement `RecordQuery` filters/sort/continuation/offset/limit.
4. Implement normalized capabilities/compilation, bind and candidate limits.
5. Prove bound values, validated identifiers, schema containment, and failure
   before client acquisition for unsupported inputs.

Exit: observable record/query behavior matches MySQL using PostgreSQL SQL.

### 4. Entity histories and atomic operations — 6–8 hours

1. Port current Entity, state/event history, trim/truncate, immutable append,
   and closure behavior, replacing complete-table Node history work with stable
   128-key pages and high-water provider-side SQL.
2. Implement one-client atomic Entity commit.
3. Implement atomic Inbox cleanup under a current session.
4. Test conflicts, rollback at every boundary, two factories, stale sessions,
   advisory-lock safety, exact retry, cancellation, 128-key resume/high-water
   maintenance, active-page close, cleanup-handle tracking, and resource release.

Exit: server paths relying on provider atomicity work under PostgreSQL.

### 5. Live PostgreSQL acceptance — 4–6 hours

1. Add explicit `SPINE_TS_POSTGRESQL_URL` preflight and `test:postgresql`; never
   start Docker or fall back to another database.
2. Run against disposable PostgreSQL 16 and 18 databases, creating/dropping
   only unique tables.
3. Prove DDL/catalog, case-sensitive IDs, all values, CRUD/queries, rollback,
   CAS races, Entity commit/history, two-database tenant isolation, pool close.
4. Extend server Inbox provider acceptance and prove stale-session fencing
   across independent factories.
5. Record exact server/image version and command separately from ordinary CI.

Exit: unit SQL evidence and a real PostgreSQL server agree.

### 6. Documentation and release integration — 3–4 hours

1. Write beginner README and precise agent reference: install, factory, TLS,
   schema, tenancy, lifecycle, first write/read, tests, and operations.
2. Update the user storage guide/API docs and remove the MySQL README's stale
   statement about where PostgreSQL will live.
3. Update 18-to-19 public-package inventories and 26-to-27 release-manifest
   paths, plus artifact/external-consumer checks, TypeDoc exports, docs/test
   inventories, build-output cleanup, package-boundary rules, release-readiness,
   and release graph tests.
4. At implementation time select the next unused common version. Commit only
   top-level versions as `Bump version -> <version>`; pins/lockfile are separate.
5. Before merge, the human configures npm trusted publishing for the new package.
   Otherwise 18 packages can publish while the new 19th fails authorization.

Exit: external packed install works and release tooling expects 19 packages.

### 7. Review and verification — 5–7 hours

1. Run focused tests and changed-line/branch coverage (at least 90% each).
2. Run deterministic preflight before reviewers.
3. In one wave, review performance/reliability, TypeScript/API, style and method
   size, documentation, and final security (SQL, secrets/TLS, tenants/schema,
   dependencies, release).
4. Return one accepted finding batch to the same writer; reopen only concerns
   substantively affected by corrections.
5. Run live PostgreSQL once after convergence, then one `verify:release`, packed
   external install, and clean-tree/generated checks.

Exit: reviews converge, evidence is current, and every commit is on `origin`.

### Total

- Active engineering time: **32–44 hours**.
- Expected elapsed time with permitted parallel checks/reviews: **24–32 hours**,
  assuming PostgreSQL 16/18 and remote access are available.

The estimate includes histories, atomic commits, provider query execution, and
fenced Inbox cleanup. Omitting them would create a misleading “supported”
provider.

## Required Test Matrix

Deterministic tests cover:

- public exports, builder order, options snapshot, custom DDL consumer, close;
- URL/database/schema/TLS/pool/tenant/target validation without secret leakage;
- default/custom/reserved/case/63-byte names and collisions before access;
- all supported ID/column mappings, including float/double and boundary values;
- DDL inspection of columns, types, nullability, defaults, PKs, unique indexes,
  and simultaneous first initialization by independent factories;
- CRUD, batch order/rollback, immutable collision, corrupt bytes, client release;
- existing- and absent-row CAS races across clients;
- every query/plan capability, null equality/order/continuation, empty IDs,
  invalid operands, unknown columns, bind 999/1,000 edge, overflow, tie order,
  native Unicode collation evidence, and no full scan;
- bounded SQL Entity history/maintenance, atomic commit/conflict/rollback/retry;
- two-factory state-truncate versus state-append/atomic-commit and event-
  truncate versus event-append races, proving the family lock across pages;
- exact/current/stale/replaced/cancelled Inbox cleanup across two factories,
  tracked cleanup handles, post-factory-close rejection, in-flight cleanup
  settlement, idempotent pool drain, and no unhandled drain rejection;
- package inventory, dependency graph, TypeDoc/TSDoc/docs, packed manifest,
  external install, and no hidden workspace dependency.

Live PostgreSQL 16 and 18 tests cover connection/close, table/catalog behavior,
case-distinct IDs, exact physical values, all query paths, simultaneous absent
CAS and Entity races, injected rollback boundaries, stale Inbox cleanup, and
two-database tenant isolation.

## API, Wire, Storage, and Compatibility

- Public API: one new package and PostgreSQL-named public types. Existing MySQL
  and common storage APIs remain source-compatible.
- Wire: no Protobuf or transport change.
- Storage: JVM-compatible family tables/values. No MySQL reading or provider
  migration feature.
- Compatibility: no earlier TS PostgreSQL layout exists and snapshot versions
  carry no legacy obligation. Existing tables are accepted only after strict
  inspection; otherwise startup fails with migration guidance.
- Release: public count becomes 19; all future common versions include it. npm
  trusted-publisher setup is a human prerequisite before merge.
- Operations: applications provide PostgreSQL, credentials, TLS, database/
  schema creation, backups, monitoring, indexes, and migrations. Spine manages
  only its record-family tables.

## Rejected Alternatives

- Put PostgreSQL in `storage-rdbms`: contradicts the current new-package ask.
- Depend on `storage-rdbms`: would pull MySQL concepts/driver and publish private
  SQL seams.
- Add a common SQL/ORM package first: speculative and unnecessary.
- Tenant prefixes or hidden scope columns: violate physical identity/isolation.
- Row locks only: cannot serialize an absent CAS target.
- Auto-start containers: violates explicit provider-test rules.
- Claim every PostgreSQL major from one acceptance run: unsupported claim.

## Dispatch and Review Record

| Function                  | Scope                                                                               | Model           | Reasoning | Context    |
| ------------------------- | ----------------------------------------------------------------------------------- | --------------- | --------- | ---------- |
| Requirements splitter     | Independently map requirements, JVM behavior, package boundary, risks, and sequence | `gpt-5.6-sol`   | `high`    | No history |
| Independent plan reviewer | Check this completed plan for missing, invented, or contradictory work              | `gpt-5.6-terra` | `high`    | No history |

Desktop supports explicit model/reasoning dispatch. Runtime self-introspection
is unavailable; immutable configured roles and explicit call fields are the
acceptance evidence.

## Independent Review Disposition

The no-memory performance/reliability reviewer reported no P0 finding and five
actionable findings. All are accepted and corrected in this plan:

| Finding                                                                       | Disposition                                                                                                                        |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1: unconditional quoting contradicted JVM's ordinary lowercase folding       | Replaced by one JVM-golden canonical physical-name function used before every collision check and SQL operation.                   |
| P1: concurrent factories had no first-table initialization protocol           | Added a per-qualified-table transaction advisory lock around create-and-inspect, including rollback/release and two-factory tests. |
| P1: creation customization omitted its callback/result public types           | Added PostgreSQL-named operation and factory types, builder method, and compile-only external-consumer tests.                      |
| P1: delivery-cleanup handles were not explicitly tracked by factory lifecycle | Added registration/unregistration, post-close rejection, in-flight settlement, idempotent drain, and rejection-containment tests.  |
| P2: bounded history maintenance lacked a concrete progress contract           | Fixed the private page at 128 keys and defined order, high-water, per-page commit/rollback, retry, close, and cleanup behavior.    |
| P1: global state truncation was not coordinated with state append/commit      | Added shared append and exclusive truncation history-family locks, one lock order, and state/event two-factory race tests.         |

These corrections increase the implementation estimate by two active hours at
the low end and preserve the one-writer sequence. The corrected persistence/
reliability concern receives a final focused re-review before this planning task
is accepted.

## Questions Reserved Until Review

Only material questions surviving independent review will be asked. The current
candidate is exact public spelling; the JVM/live-test evidence resolves the
minimum supported version as PostgreSQL 16.
