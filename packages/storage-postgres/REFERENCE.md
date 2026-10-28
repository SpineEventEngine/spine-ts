# @spine-event-engine/storage-postgres reference

This reference describes the public PostgreSQL adapter contract for coding
agents.

## Public entry point

Import `PostgresStorageFactory`, `PostgresStorageFactoryBuilder`,
`PostgresStorageFactoryOptions`, `PostgresTenantStorageOptions`, `PostgresTenantResolver`,
`PostgresEntityStorageHandle`, `PostgresTableSpec`,
`PostgresCreateOperation`, `PostgresCreateOperationFactory`, and
`PostgresColumnSpec` from the package root. Provider errors are
`PostgresStorageConfigurationError`, `PostgresStorageConnectionError`,
`PostgresStorageSchemaError`, `PostgresStorageDataError`, and
`PostgresStorageOperationError`.

## Configuration

`PostgresStorageFactory.newBuilder().setOptions(options).build()` assembles a
logical factory without connecting. Shared `setOptions()` is required;
`setTenantOptions(entries)` or `setTenantResolver(resolver)` additionally selects
one database per complete generated `TenantId`. The two tenant selection modes
cannot be combined. A resolver may return options asynchronously; concurrent
first uses of one tenant share resolution, failed attempts may retry, and a
successful binding stays fixed for this factory. Options include a
PostgreSQL URL, pool maximum, connection timeout, TLS CA/certificate/key,
server-certificate verification, and optional schema name. URLs must include a
database and cannot bypass the explicit options model with fragments or driver
parameters. `checkConnection()` checks only the shared destination using
read-only SQL; it does not resolve tenants, create tables, or check a model.
Provider integrations can use `StoragePreparations.for(factory)` to create or
check a declared Record, Entity current/enabled history, or surviving Agent
audit family. Check mode inspects the selected tenant's actual schema, table,
and required audit indexes without DDL or custom creation SQL. A successful
compatible preparation is reused by later handles and operations in this
factory. Explicit preparation uses and releases a temporary pool when no runtime
pool exists; otherwise it reuses the retained runtime pool. Failed requirements
can be retried without discarding
earlier compatible families.

PostgreSQL creates tables but not databases or schemas. A missing schema is a
configuration error on `checkConnection()` or first use. Without an explicit schema, `current_schema()`
is resolved from the server on first use and the validated result qualifies every
table and metadata statement.

## Physical layout and queries

Family tables contain `ID`, `bytes`, declared native columns, and the Entity
framework columns where applicable. `ID` is the primary key. Payloads and byte
columns use `BYTEA`; text IDs use `VARCHAR(512)`; ordinary text uses `TEXT`;
integer, boolean, timestamp, version, `REAL`, and `DOUBLE PRECISION` values use
their PostgreSQL-native mappings. Existing tables are inspected and never
altered. Missing, extra, or incompatible columns, defaults, nullability,
primary keys, or unique constraints reject with `PostgresStorageSchemaError`.

The adapter uses `$1` parameters, `IS NOT DISTINCT FROM`, PostgreSQL upsert,
independent bounded history maintenance pages, and a normalized query plan. It preserves
the common 1,000-bind plan budget and 10,000-row default with one
overflow lookahead row. The database collation controls text ordering; the
provider does not invent a JavaScript-compatible collation.

Normalized plans support IDs; equal, greater-than, less-than, greater-or-equal,
and less-or-equal comparisons; nested all/either predicates; declared-column
ordering; and finite limits. They do not support normalized offsets:
`RecordQuery.offset` is the separate provider-side pagination feature.

`Timestamp` values are stored as epoch nanoseconds in `BIGINT`; `Version` is
stored as numeric `INT`. Indexed timestamp values must fit signed 64-bit epoch
nanoseconds (approximately 1677–2262 UTC); Protobuf's wider `Timestamp` range
does not expand this SQL range. The JVM-compatible physical-name renderer folds
plain, non-reserved ASCII identifiers only. Reserved and quoted-required names
preserve their spelling; all names reject NUL, unsafe values, 63-byte overflow,
and collisions before DDL, DML, or catalog inspection.

## Entity commit behavior

The provider captures and validates one Entity commit input before database I/O,
then prepares its record families. It writes state history, diagnostic Events,
canonical delivery Events, and finally the current state as ordered independent
records. A later failure leaves the completed prefix in place; an Event row
alone does not prove that the current state was written. Concurrent commits can
interleave, including their current-state writes. This is not one SQL
transaction across the four families.

After preparation succeeds, a PostgreSQL deadlock (`40P01`) or serialization
failure (`40001`) during the ordered record writes triggers one replay of the
captured input. A failure during preparation is not retried. Commit does not
rerun the handler or create new
versions or Event IDs. An immutable retry accepts an existing row only when its
wire bytes match; the same ID with different bytes is a collision. A caller
retry must likewise reuse the original versions and Event IDs. See the
[shared storage contract](../storage/REFERENCE.md) for the provider SPI and
cross-provider limits.

## Agent history

The provider-only Agent history handle stores `AgentHistoryRecord` in one
`agent_history` record family per selected tenant database. Its payload retains
the original complete `AgentHistoryEntry` and full state type and Agent key.
SHA-256 digests provide bounded physical record IDs and indexed scope keys;
reads also compare the complete state type and Agent key. Three validated B-tree
indexes cover scope plus full order, scope plus category plus full order, and
scope plus conversation digest plus full order. Conversation reads also compare
the complete conversation key. `order_key` encodes original seconds,
nanoseconds, category, and unsigned UTF-8 record ID under PostgreSQL `C`
collation. The handle rejects incompatible existing same-name indexes; native
B-tree entry limits still apply to exceptionally long record IDs. Pages use
bounded SQL chunks and sum serialized entry bytes; a fetched chunk can be
larger than the returned byte budget.

## Agent live persistence

Agent audit entries use the indexed tenant-scoped `agent_history` family above.
`appendAll()` writes the complete immutable group in one PostgreSQL transaction.
Live Agent completion uses `EntityCommitStorage.commitAgent()` to compare the
exact Entity state image and model preferences, and to commit state, preference,
and history changes atomically. A no-op or preference-only turn does not need a
new Entity Version. The typed admission receipt is a separate record family;
it is not a replayable execution record. No database transaction remains open
while a model request runs. Factory shutdown drains admitted operations before
closing their retained connections.

## Lifecycle and errors

Await `factory.close()` to observe cleanup failures. It synchronously prevents new handle
creation, waits for admitted Entity commits, then closes registered handles and pools.
Repeated calls return the same completion. Record and Entity handles can close independently.
Acquired clients are released in `finally` blocks. History maintenance applies
each deletion page independently. Top-level provider error messages and public
responses omit URLs, credentials, SQL text, and driver details. The original
driver failure remains available as the internal `cause`; do not expose it in
public responses or unfiltered logs.

Custom table creation may use `useOperationFactory(factory)` with the exported
`PostgresTableSpec`, `PostgresCreateOperation`, and
`PostgresCreateOperationFactory` types. The resolved `table.schema` and
`table.tableName` identify the target; custom SQL must safely quote both
identifiers and remain idempotent. Do not import pool, client, catalog, or
compiler internals.

## Live verification

The infrastructure suite is intentionally excluded from ordinary CI. Its Agent
history regressions require a superuser to alter index catalog flags within
disposable temporary schemas, which are removed after each test. This is a test
requirement; the production adapter does not require superuser access. Supply
explicit `SPINE_TS_POSTGRESQL_URL`, `SPINE_TS_POSTGRESQL_TENANT_A_URL`, and
`SPINE_TS_POSTGRESQL_TENANT_B_URL` values naming three test databases, then run
the package's `test:postgresql:16`
or `test:postgresql:18` command against a matching service. The repository
records successful live acceptance against PostgreSQL 16.15 and 18.6. The four
skipped cases in each run are the MySQL and Datastore variants in the shared
Inbox test file; both PostgreSQL Inbox cases run.
