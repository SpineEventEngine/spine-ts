# @spine-event-engine/storage-rdbms reference

This reference is for agents configuring the supported MySQL storage adapter.

## Public entry point

Import `MysqlStorageFactory`, `MysqlStorageOptions`, `MysqlTenantStorageOptions`,
`MysqlEntityStorageHandle`, `MysqlStorageFactoryBuilder`,
`MysqlCreateOperation`, `CreateOperationFactory`, `MysqlTableSpec`,
`MysqlColumnSpec`, `MysqlStorageConfigurationError`,
`MysqlStorageConnectionError`, `MysqlStorageSchemaError`,
`MysqlStorageDataError`, and `MysqlStorageOperationError` from
`@spine-event-engine/storage-rdbms`.

## Connection and schema

`MysqlStorageFactory.newBuilder().setOptions(options).build()` configures one
single-tenant database. `setTenantOptions(entries)` configures one distinct
database and pool per complete generated `TenantId`. The factory selects
the matching pool before table, query, transaction, or lock work.
`setStringifierRegistry(registry)` configures reversible mappings for
message-valued IDs and ordinary message columns; the builder snapshots the
registry so later caller changes do not alter stored or queried values.
`Identifiers` choose the storage ID representation; the configured
`StringifierRegistry` supplies the matching reversible representation for
message-valued IDs and declared message columns. `RecordQuery<I>` statically
types IDs only. Filter names and values are runtime inputs: MySQL checks the
name against the declared columns and maps each value through the corresponding
descriptor/column mapping, rather than accepting an application-constructed
provider string.
Per-family tables are created and verified lazily on first use. Options support
`connectionLimit`, `connectTimeoutMs`, and TLS material. Failure to validate
configuration throws `MysqlStorageConfigurationError`; inaccessible connections
are reported as `MysqlStorageConnectionError`; an
incompatible private table shape throws `MysqlStorageSchemaError`.

The adapter supports MySQL and MariaDB InnoDB, MyISAM, and Aria family tables.
It creates and verifies a family table lazily. An account therefore needs DDL
permission, metadata reads, and DML. Existing tables are inspected and never
altered.

Before deployment, run `pnpm --dir packages/storage-rdbms inventory:legacy --
--url <database-url>` once for every configured tenant database. The command
fails closed on connection errors, `_scope`, `_revision`, or an old primary key
containing `_scope`. Passing this inventory is a startup prerequisite for an
upgraded application. Factory build repeats the inspection for every configured
database; the runtime has no dual-layout reader or automatic
conflict winner.

## Lifecycle and tenancy

`close(): void` marks the factory and its live handles closed and starts pool
draining. Callers do not await it. A record handle closes independently. A
single-tenant factory has one database. A multitenant factory requires a
complete generated `TenantId` on each operation and routes it to its configured
database. Bounded Context names are diagnostic only and never partition rows,
tables, locks, or queries.

Each Entity source and history family has an independent table. Errors do not
include connection URLs, credentials, or provider details.

## Records and queries

CRUD operations use normal statements. Payload-based compare-and-set uses an
InnoDB transaction or a keyed `GET_LOCK` on MyISAM and Aria. On InnoDB,
`writeAll` encodes the input first, applies entries in input order, and commits
all rows or none. On MyISAM and Aria, `writeAll` has deterministic input-order
semantics but is not transactional; a failed Entity prefix requires an
identical retry. Repeated storage slots in a batch leave the last entry as the
stored value. IDs are declared as generated message IDs or the supported
primitive `string`, `int32`, and `int64` kinds. Primitive IDs use native MySQL
values; message IDs use their reversible stringifier, compact Proto JSON by
default.

Every family table has `ID`, serialized `bytes`, and only the columns declared
by its framework record and Proto model, with primary key `(ID)`. Current Entity
tables declare `archived`, `deleted`, and Entity `version` in addition to model
`(column)` fields. Those three framework columns are non-null and default to
`false`, `false`, and `0`, respectively; Entity `version` is not a provider
revision. Proto fields without `(column)` exist only inside the authoritative
`bytes` record and never become SQL columns. Existing layouts are inspected and
never altered. A mismatched type, nullability, primary key, unique constraint,
or extra column is rejected. Ordinary message columns use the same configured
reversible stringifier for writes and query operands. `Timestamp` uses epoch
nanoseconds and `Version` uses its number. Floating-point record columns are
not supported by Spine JVM JDBC and are rejected here.

Queries execute ID filters, ANDed column filters, materialized-column sorts,
keyset continuations, offsets, and limits in MySQL. Before executing, MySQL
validates each ID encoding, requires every filter and sort name to be `ID` or a
declared materialized column, and maps each filter/continuation value through
that column's descriptor. Missing materialized columns do not match; dotted
payload paths are rejected. Large offsets can be expensive.

Normalized projection plans compile IDs, equality, all five comparisons, nested
`all` / `either`, ordering, limits, and masks to one parameterized SQL statement.
A mask is applied only after an otherwise fully bounded complete-record fetch.
Normalized plans have no offset; `RecordQuery.offset` remains separate. The selected
tenant pool is acquired before the resolved family table is accessed; only that
validated table and declared columns are interpolated, while IDs, operands, and
limits are bound. Ordering ends with `ID` for a stable tie-break. An omitted
query budget accepts at most 10,000 rows; an explicit value cannot exceed
10,000. The provider fetches only the
smaller safe bound from the exact limit and query budget plus one, so it may
read one overflow-lookahead row (10,001 raw rows at the default) before
rejecting an oversized result. The primary
key serves ID queries; operators must add indexes for workload equality, range,
and composite filter/order patterns. Without them MySQL may scan or sort despite
the runtime materialization bound. To keep one normalized statement finite,
MySQL accepts at most 1,000 bound parameters including its provider limit;
oversized ID sets or composite predicate bind work reject before a connection is
acquired.

## Entity history seam

The provider/framework Entity handle returns current records plus immutable
state and event history. It is not a remote application history API. State append and retention for one entity use a MySQL server lock;
this coordination applies to one MySQL server only. Trim and truncate use
fixed-size chunks. A failed chunk can leave earlier chunks durable, so callers
retry maintenance. Current-record and history actions are separate calls, not
one cross-storage transaction.

The internal atomic Entity commit port writes current state, configured history,
and framework delivery events. InnoDB uses one connection transaction;
nontransactional engines use a deterministic immutable-history prefix and may
require an identical retry after a storage failure. Standalone history
operations remain separate.

`MysqlStorageSchemaError` reports incompatible layouts,
`MysqlStorageDataError` reports stored bytes that cannot be decoded, and
`MysqlStorageOperationError` reports sanitized bounds, query, collision, and
driver-operation failures. Custom creation uses `useOperationFactory()`; its
resolved `MysqlTableSpec` has the same native column types and naming precedence
as default DDL (explicit grouped name, explicit record name, then default).
