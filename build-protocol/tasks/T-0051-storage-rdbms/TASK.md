# T-0051: MySQL-first RDBMS storage adapter

Status: Packet 4 accepted; Packet 5 next

## Objective

Add one private workspace package, `@spine-ts/storage-rdbms`, implementing the
existing Spine TS `StorageFactory` and `RecordStorage` contracts with MySQL as
the first supported engine. Keep the package structurally ready for later
PostgreSQL support without publishing speculative generic SQL APIs.

## Classification

High-risk. This task introduces a persistence adapter, transaction and compare-
and-set behavior, SQL identifier and value encoding, query translation, schema
management, client-pool lifecycle, a new package/dependency boundary, and real
database integration tests.

## Human-Imposed Requirements Ledger

- Analyze the current Spine JVM JDBC RDBMS implementation at
  `SpineEventEngine/jdbc-storage/rdbms`; do not assume it maps one-to-one to the
  current TypeScript storage port.
- Analyze and preserve the accepted principles of Spine TS Datastore support.
- Plan and implement RDBMS storage with MySQL as the primary and currently
  supported engine.
- Use one package for current MySQL and future PostgreSQL support, named
  `storage-rdbms` (`@spine-ts/storage-rdbms` in this workspace).
- Keep later PostgreSQL support possible without claiming or implementing it in
  this task.
- Preserve the generic `@spine-ts/storage` port unless source-grounded analysis
  proves a minimal change is required and the decision is recorded.
- Use public, end-user-oriented construction and configuration; do not expose
  driver internals, SQL ASTs, or test-only seams from the package root.
- Use TDD for every runtime behavior and run real MySQL integration tests in an
  available local/containerized environment before acceptance.
- Commit and push every commit immediately, then merge, post-merge verify, and
  push `main`.
- Preserve unrelated files and never read, edit, stage, move, or delete
  `human-review-1-jul.md`.

## Initial Scope

In scope:

- authoritative JVM and TypeScript adapter research;
- a durable design/decision and implementation plan;
- one `packages/storage-rdbms` workspace package;
- MySQL configuration, schema creation, CRUD, queries, batching, compare-and-
  set, transaction behavior, multi-tenancy, error boundaries, and lifecycle;
- fake-free behavior tests where practical plus opt-in real MySQL acceptance;
- package README, TypeDoc, end-user guide, release-readiness/package graph, and
  deterministic verification updates.

Out of scope unless analysis proves required:

- PostgreSQL runtime support;
- a public generic SQL dialect or query-builder API;
- ORM/entity mapping, migrations framework, connection monitoring, retry/backoff
  policy, or changes to server/domain semantics;
- importing the JVM module's server-specific storage types that do not exist in
  the TypeScript `StorageFactory` port.

## Acceptance Criteria

Summary criteria follow; the binding detailed criteria and milestone packets
appear later in this task record:

1. MySQL storage passes the generic storage contract and adapter-specific
   correctness tests for every supported ID/index value.
2. Queries push filters, ordering, offset, and limit into SQL with parameterized
   values and deterministic identifier handling.
3. Writes, batches, and compare-and-set have explicit atomicity and conflict
   semantics, including rollback/failure tests.
4. Tenant isolation, table naming, SQL identifier quoting, binary/case-sensitive
   comparison, bigint safety, payload encoding, and error redaction are tested.
5. Package/pool ownership and closure are explicit and tested.
6. Real MySQL acceptance proves schema creation and the supported storage
   behavior; PostgreSQL remains an honest documented future extension.
7. All relevant review concerns converge, the full repository gate passes,
   integration is verified, and task/main refs are pushed.

## Source Provenance

- JVM repository: `https://github.com/SpineEventEngine/jdbc-storage.git`, shallow
  clone at commit `1b778327a6d24c9834102af86e18f9c532b8ac98` in temporary research
  space. The `rdbms/src/main` and `rdbms/src/test` trees are authoritative inputs.
- TypeScript sources: `packages/storage`, `packages/storage-datastore`,
  `examples/datastore-orders`, accepted T-0046 records, and current package/build
  configuration at baseline `1a33114712513aeac56c707d7da035c581ab8e3e`.

## Skill Applicability

- Selected and read in full: `architecture-patterns`, `codebase-design`,
  `monorepo-management`, `using-git-worktrees`, `test-driven-development`,
  `subagent-driven-development`, `requesting-code-review`, and
  `verification-before-completion`.
- Also read `codebase-design/DESIGN-IT-TWICE.md` and
  `test-driven-development/testing-anti-patterns.md` because this task chooses
  a new adapter seam and will need database test doubles before real acceptance.
- The design-it-twice instruction to invent parallel design agents conflicts
  with the project's existing-role rule. The existing requirements splitter
  will compare materially different interfaces instead; no new role is created.
- Runtime TDD, one writer, aggregated review, and evidence-before-completion are
  binding. Skills remain advisory beneath project protocol and human scope.

## Assignment Gate

- Selected surface: Codex Desktop; explicit child role/model/reasoning dispatch
  is supported.
- Requirements splitter: existing `requirements_splitter`, bounded to JVM/TS
  source comparison, alternative seam analysis, risks, acceptance criteria, and
  milestone packets. Expected and explicitly dispatched as `gpt-5.6-sol` / high.
- Implementation: existing `implementer`, expected `gpt-5.6-terra` / medium,
  will receive one bounded packet at a time after planning acceptance.
- Mechanical verification remains an orchestrator-dispatched Luna function, not
  a new role.
- Relevant review concerns: style/maintainability, documentation,
  TypeScript/API, and performance/reliability. Security remains a release gate,
  while reviewers must still flag SQL injection, credential, tenant isolation,
  and redaction defects inside their assigned concerns.

## Requirements-Splitter Acceptance Metadata

- Existing role/function: `requirements_splitter`, responsible only for the
  source comparison, architectural seam, behavior contract, risks, and ordered
  milestone packets below.
- Explicit dispatch: `gpt-5.6-sol` / `high`; both fields were present in the
  orchestrator assignment and match the immutable configured profile exposed
  to this role.
- Runtime self-introspection is not exposed to this child. No separate runtime
  model identifier is invented; the explicit dispatch and immutable role
  profile are the available acceptance evidence.
- Selected skill: user-installed `codebase-design` at
  `/Users/armiol/.agents/skills/codebase-design/SKILL.md`, read in full with
  `DESIGN-IT-TWICE.md` and `DEEPENING.md`. It supplies the module/interface/
  seam/adapter/depth/locality vocabulary used below.
- The skill's parallel-design-agent technique is not used because this
  assignment and the project role rules prohibit child spawning. The existing
  requirements splitter instead compared three materially different designs.

The orchestrator accepted this split after checking it against the current
storage contracts, Datastore adapter, pinned JVM source, and package/build
configuration. No human decision is missing. Packet 1 is assigned to the
existing `implementer` with explicit expected and dispatched profile
`gpt-5.6-terra` / `medium`. Its ownership is limited to the new package,
workspace/package graph and lockfile, D-0098, and the T-0051 records. Runtime
self-introspection will be recorded before accepting the packet result.

## Source-Grounded Findings

### TypeScript port and Datastore precedent

- `StorageFactory.createRecordStorage(context, spec)` is already the correct
  external seam. `EventStore` and bounded-context composition depend on that
  interface, not on a provider. No RDBMS type belongs in `@spine-ts/storage`.
- `RecordSpec.schema` supplies the Protobuf-ES schema needed to persist binary
  payloads. `materialize()` supplies cloned slot ID, payload, and declared
  column values. The adapter therefore needs no new record codec port.
- Storage-slot identity is not necessarily the logical ID read from the record
  body. SQL rows, `RecordEntry.id`, ID filters, continuation tie-breaking, and
  CAS must consistently use the actual slot ID.
- Repeated handles from one factory must observe the same durable rows and be
  independently closeable. Context name, tenant mode, and tenant ID are part
  of storage identity.
- The accepted Datastore design establishes useful adapter rules: small public
  root; explicit configuration; provider-side query work; reversible canonical
  IDs; bounded, typed query values; no provider types in the generic port;
  externally visible lifecycle ownership; sanitized persisted-data/provider
  errors; and opt-in real-provider acceptance in addition to deterministic
  tests.
- The generic query model allows ID filters, ANDed equality filters (an array is
  an OR/IN set), ordered fields, a stable slot-ID tie-breaker, continuation,
  offset, limit, and masks. SQL must apply filtering, ordering, continuation,
  offset, and limit in the database rather than scan and reconcile an unbounded
  result in Node.

### JVM JDBC evidence and deliberate differences

- The pinned JVM implementation creates one `JdbcRecordStorage` behind the
  existing `StorageFactory`, serializes Protobuf payload bytes, creates schema
  on storage construction, quotes table/column identifiers, parameterizes
  values through QueryDSL, and specializes MySQL upsert while keeping engine
  details behind the storage module.
- The JVM module proves the importance of binary/case-sensitive MySQL text
  comparison, sufficiently wide encoded identifiers, table-creation races,
  transactional connection commit/rollback, and real MySQL tests. Those are
  requirements, not optional polish.
- The JVM public operation/query/type-mapping SPIs are not copied. The current
  TypeScript package has one adapter and no external user requiring SQL
  customization; exporting these seams would make a shallow module.
- JVM table-per-message mapping depends on runtime column type metadata that
  the TypeScript `RecordColumn` interface intentionally does not expose. Adding
  SQL type descriptors to the generic port merely to reproduce that schema is
  rejected. The TypeScript adapter instead owns a private normalized schema.
- JVM server-specific aggregate, inbox, delivery-session, sharding, and entity
  storage classes are outside this task. The TypeScript adapter implements only
  the current `RecordStorage` contract.

## Design It Twice: Interface And Seam Options

### Option A — public engine-neutral factory and dialect union

Shape: `RdbmsStorageFactory.create({ engine: "mysql" | "postgres", ... })`,
with public engine-specific option branches and one internal dialect interface.

- Depth: moderate; one entry point hides SQL, but the interface asks callers to
  understand engines and a configuration branch that has only one real adapter.
- Locality: future PostgreSQL work is partly localized, but every engine option
  changes the already-public union.
- Seam assessment: the dialect seam is hypothetical today. Advertising
  PostgreSQL-shaped configuration before its behavior exists is not honest.
- Disposition: rejected as speculative generic SQL design.

### Option B — caller-composed driver/pool and SQL strategy

Shape: `new RdbmsStorageFactory({ pool, dialect, schema })`, with public pool,
transaction, identifier, and query-compilation ports.

- Depth: low. Driver lifecycle, SQL capability, and transaction invariants leak
  into every caller and test; deleting the module would move little knowledge.
- Locality: poor. Compatibility fixes would span user composition, test fakes,
  and the adapter.
- Seam assessment: it creates several interfaces for only one production
  adapter and exposes driver/test machinery at the package root.
- Disposition: rejected by the small-root, no-driver-internals requirement.

### Option C — MySQL-named adapter in one RDBMS package (chosen)

Shape: `MysqlStorageFactory.create(options)` returns a concrete adapter that
extends the existing `StorageFactory`. The package root exports the factory and
small end-user MySQL configuration/error types only. SQL compilation, schema,
pool, transactions, codecs, and any future dialect interface remain private.

- Depth: high. Construction plus the inherited storage interface gives callers
  schema management, encoding, CRUD, query pushdown, transactions, CAS, tenant
  isolation, and pool lifecycle without teaching SQL internals.
- Locality: MySQL behavior and verification stay in `storage-rdbms`. A later
  `PostgresStorageFactory` can be added to the same package. Only then, with two
  adapters, should common implementation be extracted behind a real private
  dialect seam.
- Seam assessment: the existing `StorageFactory` seam is real and already has
  in-memory and Datastore adapters. The package introduces no new public seam.
- Disposition: selected as the smallest honest MySQL-first/future-PostgreSQL
  design.

## Chosen Package Contract

### Public module interface

- Package: private workspace package `@spine-ts/storage-rdbms`.
- Root exports: `MysqlStorageFactory`, one end-user `MysqlStorageOptions` shape,
  and only stable adapter errors that callers must reasonably branch on. It
  does not export a pool, connection, transaction, SQL string/AST, dialect,
  table mapper, codec, fake, or migration primitive.
- `MysqlStorageFactory.create(options)` is asynchronous so it can validate
  configuration, connect, create/verify its private schema, and fail before a
  usable factory escapes. A public constructor is not required.
- Configuration is explicit and driver-neutral at the root: database endpoint,
  database/schema name, user/password or connection URI (the dependency slice
  must choose one coherent form), TLS material/settings needed for production,
  and a small pool-size/timeout subset. Do not re-export the selected driver's
  option type.
- The inherited `createRecordStorage(context, spec)` remains synchronous after
  factory initialization and returns independently closeable handles.
- `close()` marks the factory and all issued handles closed immediately, is
  idempotent, drains the owned pool, and returns the same completion promise on
  repeated calls. TypeScript permits a promise-returning override of the
  existing void-returning lifecycle method; verify this in the first compiler
  test. Change the generic `Storage`/`StorageFactory` return type only if that
  test demonstrates incompatibility, and then only to the minimal
  `void | Promise<void>` form with all affected docs/tests updated.

### Private persisted model

- Use two fixed, adapter-owned tables: one record table for scope/tenant/slot,
  Protobuf payload, and CAS state; and one column table holding materialized
  query values. Table names are adapter constants and always dialect-quoted.
  Dynamic context, tenant, record type, slot ID, and column names are data
  parameters, never SQL identifiers.
- A storage scope deterministically includes `StorageContext.name`, tenant
  mode, and `RecordSpec.schema.typeName`. A multitenant tenant key is mandatory;
  single-tenant and multitenant scopes cannot collide.
- Store actual slot IDs using one private reversible canonical codec. Equality,
  ID filters, returned entries, CAS addressing, and final ordering all use that
  encoding. Reject unsupported or over-bound encodings before acquiring a
  connection; do not truncate.
- **Accepted ID-order decision (Packet 2):** deterministic RDBMS ID/tie order
  is the MySQL binary order of the canonical `slot_key` bytes. No separate
  semantic slot-order column is introduced. Packet 3 must use exactly those
  bytes for SQL ordering and continuation predicates.
- Store records as deterministic Protobuf binary with unknown fields excluded,
  matching current Datastore behavior. Persisted corrupt/mismatched bytes yield
  one sanitized adapter decoding error.
- Store each declared `RecordColumn` as a typed normalized row. Initial MySQL
  support is the provider-honest set: `null`, boolean, finite number, string,
  and exact signed 64-bit `bigint`. Unsupported values, non-finite numbers,
  out-of-range bigint, oversized text/ID/scope/tenant/column encodings, and
  duplicate declared column names fail before SQL. The implementation packet
  must freeze byte limits from MySQL index limits and prove both edges.
- The private value codec must preserve equality and deterministic order for
  every supported value. MySQL text/key columns use binary comparison so case,
  accents, and bytes are not folded by database collation.
- Queryable fields are `id` and materialized `RecordColumn` names. A sort that
  names an unmaterialized dotted payload path is rejected with a stable error;
  the adapter never decodes an unbounded candidate set to emulate it. Users add
  a `RecordColumn` for a field that must be filtered or ordered in SQL.
- Schema creation is idempotent under concurrent factory startup. The adapter
  verifies a schema version/shape it owns and fails closed on an incompatible
  pre-existing table; this task is initial schema creation, not a migrations
  framework.

## Required Behavioral Semantics

### CRUD and batches

- `write` is an atomic MySQL upsert of payload and the complete materialized
  column set for one scope/tenant/slot. Removed columns do not leave stale
  index rows.
- `read` returns `undefined` only for absence and decodes a cloned record;
  masks remain the generic `RecordStorage` responsibility.
- `delete` is tenant/scope/slot scoped and returns true exactly when one row was
  removed; column rows are removed in the same transaction/cascade.
- `writeAll` materializes all input before SQL (already guaranteed by the
  port), uses bounded statement chunks inside one transaction, preserves input
  last-write-wins behavior for repeated slots, and commits all rows or none.
  Empty input is a no-op. Chunk size is private and selected against driver/
  MySQL parameter limits, not a public tuning API.

### Queries and values

- `ids: []` means no ID restriction. Each filter is ANDed; an array value is an
  OR/IN set, and an empty value array matches nothing.
- All ID/column predicates, stable ordering, continuation predicates, offset,
  and limit are expressed in SQL with bound values. The only interpolated SQL
  fragments are closed enums/constant quoted identifiers owned by the adapter.
- Requested sort fields are applied in order, direction is honored, and the
  actual encoded slot ID is the mandatory ascending final tie-breaker. Without
  explicit sort, slot ID ascending supplies deterministic order.
- Continuation is a keyset predicate matching the complete sort tuple plus
  slot ID, is applied before offset/limit, and remains inside the active scope
  and tenant. A mismatched continuation is rejected by the generic validator;
  unsupported/oversized values are rejected before SQL.
- `offset` and `limit` are pushed to MySQL after continuation. No unlimited
  client-side reconciliation, generic SQL cursor, or adapter scan budget is
  introduced.
- Column-table indexes must support scope+tenant+column equality and ordered
  retrieval. Real-MySQL evidence includes `EXPLAIN` assertions or an equally
  deterministic plan check for representative equality/order queries; the
  README documents where filesort or large offsets remain costly.

### Transactions and CAS

- Every multi-statement write, batch, or CAS owns exactly one pooled connection
  and transaction. Success commits once; any encode/statement/commit failure
  attempts rollback once and releases the connection in `finally`.
- `compareAndSet(slot, expected, next)` compares only the current record payload
  to the deterministic encoded expected record, as the existing port specifies;
  derived column bytes are not an independent equality condition.
- Existing-row CAS locks the scoped row before comparison. Missing-row create
  races are resolved by the unique key: exactly one concurrent
  `undefined -> next` succeeds, and a duplicate caused by that exact race is a
  clean `false`, not a provider error. Stale mismatch returns `false`, changes
  nothing, and releases/rolls back its transaction.
- `next === undefined` conditionally deletes payload and columns atomically.
  A `next` record whose logical body ID differs from the addressed slot remains
  stored at the addressed slot; query entries return that actual slot.
- Deadlocks, connection loss, serialization failures, and ambiguous commit
  outcomes are not reported as CAS `false`. This task adds no retry/backoff
  policy; such failures become sanitized adapter errors with a safe cause/code
  only if the chosen driver supports it without leaking SQL, credentials, or
  payload values.

### Tenant, lifecycle, and errors

- Every SQL statement, join, foreign key, lock, and unique constraint includes
  scope and tenant identity. Cross-tenant reads, writes, deletes, queries, CAS,
  and continuation are impossible even when slot IDs are equal.
- Blank/missing tenant IDs for multitenant context fail before pool use. Tenant
  values are bound data, never identifiers or log text.
- The package owns pools it creates. Handle close never closes the shared pool;
  factory close closes all handles and then drains the pool. Operations begun
  before close may finish; operations admitted after close fail. The tests must
  freeze this race rule and prove no connection is retained after rejection,
  rollback, decode failure, or successful completion.
- Configuration/programmer errors are simple stable errors. Provider/schema/
  transaction/decode failures use a small adapter error only when callers need
  classification. Error messages, causes exposed publicly, logs, and test
  snapshots contain no connection URI, password, SQL parameter, tenant ID,
  slot ID, column value, or payload bytes.

## Detailed Acceptance Criteria

1. The package root contains only the chosen MySQL construction/configuration
   interface and necessary branchable errors; `@spine-ts/storage` contains no
   SQL/provider type and its `StorageFactory` creation seam is unchanged.
2. Deterministic contract tests run the same CRUD, slot/logical-ID, query,
   continuation, mask, batch, CAS, tenant, and lifecycle behaviors against
   in-memory expectations and the MySQL adapter where semantics overlap.
3. Every supported slot ID kind round-trips through independent handles and
   works in read/delete/ID filter/continuation/CAS. Case- and accent-distinct
   strings remain distinct. Unsupported/oversized values fail pre-SQL.
4. Every supported query-column value preserves exact equality and defined
   ordering, including signed-64 bigint endpoints and unsafe finite numbers;
   `NaN`, infinities, out-of-range bigint, and unsupported structures fail
   before SQL.
5. SQL-injection cases in context, tenant, slot, type name, and column/filter
   values cannot change statement structure. Constant identifiers are quoted
   and all dynamic values are bound.
6. Query results prove AND/IN semantics, deterministic multi-sort plus slot
   tie-break, ascending/descending continuation, offset-before-limit, tenant
   scoping, and SQL pushdown without client-side full scans.
7. Single writes replace payload and columns atomically; `writeAll` is all-or-
   nothing across more than one statement chunk; injected statement/commit
   failures leave no partial batch.
8. CAS proves absent create, existing replace, delete, stale mismatch,
   differing logical/body ID, two independent handles, and a synchronized
   concurrent-create race in which exactly one caller succeeds.
9. Schema creation is idempotent for concurrent factories and rejects an
   incompatible existing schema without destructive alteration.
10. Factory/handle closure, in-flight shutdown, repeated close, pool ownership,
    connection release, rollback attempt, and post-close rejection are covered;
    close failure is observable without an unhandled rejection.
11. Unit tests may exercise private codecs/SQL assembly deterministically, but
    adapter acceptance is fake-free: an opt-in real MySQL suite creates an
    isolated disposable database or table prefix, runs schema/CRUD/query/
    batch/CAS/tenant/case/bigint/error/lifecycle scenarios, and removes only its
    own assets in `finally`.
12. Real acceptance records the exact MySQL server image/version, driver and
    testcontainer versions, commands, and result. No PostgreSQL test or support
    claim is made.
13. Package README, framework user guide, TypeDoc/API registry, workspace build
    references, release-readiness checks, and dependency lock are updated. Docs
    cover configuration/TLS, least-privilege schema needs, table ownership,
    limits, transactions, query/index costs, lifecycle, real-test workflow,
    and PostgreSQL as future—not current—support.
14. Focused tests, package typecheck/lint/format/docs, coverage at or above 90%,
    all relevant reviewer concerns, full `pnpm verify`, merge/post-merge
    evidence, and branch/main remote synchronization satisfy the build protocol.

## Dependency Decision Questions (Milestone 1 Gate)

These are non-human-blocking research questions; record exact versions and the
decision in `DECISION_LOG.md` before runtime implementation.

- Prefer `mysql2/promise` unless current stable evidence shows a better
  maintained ESM/Node 24 driver. Verify prepared-statement behavior, exact
  bigint handling, binary buffers/collations, TLS, pool shutdown, transaction
  APIs, error codes, maintenance/security posture, and TypeScript declarations.
- Decide whether a connection URI or a small structural option object gives
  adequate TLS/secret handling without re-exporting driver types. Document the
  rejected form and redaction implications.
- Compare direct parameterized SQL with a maintained query builder. Select a
  builder only if it materially reduces dynamic keyset/join mistakes while
  keeping dialect/AST types private and preserving exact buffer/bigint binding;
  do not add an ORM or migration framework.
- Select a current, maintained MySQL container harness compatible with Vitest
  and the repository's Node version, or use an explicit externally supplied
  MySQL URL when container execution is unavailable. The real suite must be
  opt-in and must never silently fall back to developer/cloud credentials.
- Freeze supported MySQL versions and the acceptance image from current
  upstream support data. Future PostgreSQL dependency selection is excluded.

## Ordered Milestone Packets

### Packet 1 — dependency, public contract, and schema proof

Owner: one `implementer`; files limited to the new package scaffold, necessary
workspace/lock/build references, decision log, and T-0051 records.

- Record driver/query-builder/container decisions and exact versions.
- Add compile-time RED/GREEN tests for the root exports, asynchronous factory
  construction/close substitutability, and absence of driver/SQL exports.
- Prove the two-table DDL, identifier quoting, binary comparison, version check,
  and concurrent idempotent initialization against real MySQL.
- Acceptance: package builds; factory can initialize and close a disposable
  database; incompatible schema and injection-shaped inputs fail safely.

Packet 1 evidence (2026-07-21): direct `mysql2@3.23.1` is pinned under D-0098;
the public factory asynchronously validates/connects, initializes and verifies
two fixed InnoDB `utf8mb4_bin` tables, records an owned idempotent close promise,
and exposes no driver/SQL seam. Focused fake-backed lifecycle/schema tests and
one real MySQL 8.4.10 concurrent-initialization test are green. The real suite
requires explicit `SPINE_TS_MYSQL_URL`, starts no container, and removes only
its two fixed tables. Packets 2–5 remain unimplemented.

### Packet 2 — canonical records and CRUD

Owner: same implementer/context; package runtime and focused tests only.

- TDD the scope/tenant/slot codec, payload codec, value bounds, independent
  handles, upsert/read/delete, stale-column removal, and error sanitation.
- Acceptance: criteria 2–5 for CRUD/identity plus real-MySQL case, accent,
  long-boundary, malformed-payload, and tenant isolation scenarios.

### Packet 3 — SQL query translation

Owner: same implementer/context; do not change the generic query interface.

- TDD typed column rows, equality/IN joins, deterministic multi-sort, keyset
  continuation, offset/limit, missing-column behavior, bound parameters, and
  representative index plans.
- Acceptance: criterion 6 plus both value-bound edges and no client-side scan.

### Packet 4 — transactions, batches, and CAS

Owner: same implementer/context because it depends on established schema/query
knowledge; one correction batch after mechanical checks.

- TDD bounded transactional `writeAll`, rollback/commit failure paths, CAS row
  locking, absent-create conflict mapping, conditional delete, connection
  release, and synchronized two-handle races.
- Acceptance: criteria 7–8 on real MySQL, with provider failures never becoming
  false/stale results.

### Packet 5 — lifecycle, documentation, and acceptance closure

Owner: implementer for code/docs, then all four existing specialist concerns
on one immutable endpoint; final security remains the project release gate.

- Complete close/in-flight/pool tests, README/user guide/TypeDoc, opt-in real
  MySQL scripts, release-readiness and package graph.
- Run focused mechanics, one complete reviewer wave, one aggregated correction
  batch, affected re-review only, full verification, integration, and remote
  synchronization.
- Acceptance: criteria 9–14 and all concern dispositions converge.

## Risks And Controls

- **Generic query overclaim:** binary Protobuf paths are not SQL-queryable.
  Control: accept only `id`/materialized columns and fail explicitly; no local
  scan or new generic cursor.
- **Mixed-value ordering drift:** JS, MySQL collation, numeric, and bigint order
  can differ. Control: one typed canonical representation, binary comparison,
  cross-adapter fixtures, and real boundary tests.
- **Key/index width:** arbitrary canonical values can exceed InnoDB limits.
  Control: documented byte limits, pre-SQL rejection, and edge tests; never
  truncate or silently hash without collision detection.
- **Tenant omission:** a missing predicate in one statement is a data leak.
  Control: central private scope object used by every compiler path and
  adversarial cross-tenant tests for each operation.
- **DDL/migration ambiguity:** `IF NOT EXISTS` can hide incompatible schema.
  Control: owned schema version/shape verification; no destructive auto-fix.
- **CAS missing-row race and ambiguous commit:** naive read-then-insert is not
  CAS. Control: unique key plus exact duplicate classification; other database
  failures propagate as sanitized errors.
- **Pool close versus independent handles:** closing an owned pool can strand
  apparently open handles. Control: factory tracks and closes issued handles
  before drain, freezes in-flight semantics, and exposes close completion.
- **Future-PostgreSQL over-design:** premature dialect interfaces increase
  surface without evidence. Control: only MySQL public/runtime behavior now;
  extract a private shared dialect seam only when the second adapter exists.
- **Real-test environmental fragility:** containers/ports may be unavailable.
  Control: deterministic unit coverage plus an explicit opt-in harness; lack of
  real MySQL is a task-acceptance blocker, never replaced by fakes.

## Explicit Exclusions

- PostgreSQL runtime, dependencies, tests, configuration, compatibility claims,
  and public dialect selection.
- Public SQL/query-builder/driver/pool/connection/transaction/schema-migration
  interfaces or test fakes.
- ORM mapping, arbitrary payload-path query, full-text/range predicates,
  streaming cursors, retries/backoff, monitoring, health checks, tracing, and
  connection-routing/read-replica policy.
- Server aggregate/entity/delivery/inbox storage concepts absent from the
  current TypeScript `StorageFactory` port.
- Destructive schema migration or automatic repair of unknown existing tables.
