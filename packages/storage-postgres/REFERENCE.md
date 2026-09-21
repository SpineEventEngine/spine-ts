# @spine-event-engine/storage-postgres reference

This reference describes the public PostgreSQL adapter contract for coding
agents and maintainers.

## Public entry point

Import `PostgresStorageFactory`, `PostgresStorageFactoryBuilder`,
`PostgresStorageFactoryOptions`, `PostgresTenantStorageOptions`,
`PostgresEntityStorageHandle`, `PostgresTableSpec`,
`PostgresCreateOperation`, `PostgresCreateOperationFactory`, and
`PostgresColumnSpec` from the package root. Provider errors are
`PostgresStorageConfigurationError`, `PostgresStorageConnectionError`,
`PostgresStorageSchemaError`, `PostgresStorageDataError`, and
`PostgresStorageOperationError`.

## Configuration

`PostgresStorageFactory.newBuilder().setOptions(options).build()` configures a
single database and schema. `setTenantOptions(entries)` configures one database
and pool per complete generated `TenantId`; every operation selects its tenant
pool before table, metadata, transaction, lock, or data work. Options include a
PostgreSQL URL, pool maximum, connection timeout, TLS CA/certificate/key,
server-certificate verification, and optional schema name. URLs must include a
database and cannot bypass the explicit options model with fragments or driver
parameters. The factory proves configured connections during build and
sanitizes provider errors.

PostgreSQL creates tables but not databases or schemas. A missing schema is a
configuration error. Without an explicit schema, `current_schema()` is resolved
once while building the target and the validated result is qualified into every
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
transaction advisory locks, and a bounded normalized query plan. It preserves
the common 1,000-bind plan budget and 10,000-row default with one
overflow lookahead row. The database collation controls text ordering; the
provider does not invent a JavaScript-compatible collation.

`Timestamp` values are stored as epoch nanoseconds in `BIGINT`; `Version` is
stored as numeric `INT`. The JVM-compatible physical-name renderer folds only
unquoted ASCII spelling, accepts valid non-ASCII identifiers, enforces the
63-byte PostgreSQL identifier boundary, and rejects collisions before DDL,
DML, or catalog inspection.

## Lifecycle and errors

`factory.close()` is idempotent, closes registered handles, prevents new handle
creation, and drains pools. Record and Entity handles can close independently.
Acquired clients are released in `finally` blocks and transactions are always
committed or rolled back before release. Errors do not include URLs,
credentials, SQL text, or driver internals.

Custom table creation may use `useOperationFactory(factory)` with the exported
`PostgresTableSpec`, `PostgresCreateOperation`, and
`PostgresCreateOperationFactory` types. Do not import pool, client, catalog, or
compiler internals.

## Live verification

The infrastructure suite is intentionally excluded from ordinary CI. Supply
explicit `SPINE_TS_POSTGRESQL_URL`, `SPINE_TS_POSTGRESQL_TENANT_A_URL`, and
`SPINE_TS_POSTGRESQL_TENANT_B_URL` values naming three test databases, then run
the package's `test:postgresql:16`
or `test:postgresql:18` command against a matching service. The repository
currently records no live PostgreSQL 16/18 result, so documentation must not
claim a completed live acceptance.
