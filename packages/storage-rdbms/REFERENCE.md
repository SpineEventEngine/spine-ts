# @spine-event-engine/storage-rdbms reference

This reference is for agents configuring the supported MySQL storage adapter.

## Public entry point

Import `MysqlStorageFactory`, `MysqlStorageOptions`,
`MysqlEntityStorageHandle`, `MysqlStorageFactoryBuilder`,
`MysqlCreateOperation`, `CreateOperationFactory`, `MysqlTableSpec`,
`MysqlColumnSpec`, `MysqlStorageConfigurationError`,
`MysqlStorageConnectionError`, `MysqlStorageSchemaError`,
`MysqlStorageDataError`, and `MysqlStorageOperationError` from
`@spine-event-engine/storage-rdbms`.

## Connection and schema

`MysqlStorageFactory.newBuilder().setOptions(options).build()` validates a full MySQL URL with a
database name, creates an owned mysql2 pool, and returns a ready factory.
Per-family tables are created and verified lazily on first use. Options support
`connectionLimit`, `connectTimeoutMs`, and TLS material. Failure to validate
configuration throws `MysqlStorageConfigurationError`; inaccessible connections
are reported as `MysqlStorageConnectionError`; an
incompatible private table shape throws `MysqlStorageSchemaError`.

The adapter supports MySQL and MariaDB InnoDB, MyISAM, and Aria family tables.
It creates and verifies a family table lazily. An account therefore needs DDL
permission, metadata reads, and DML. Existing tables are inspected and never
altered.

## Lifecycle and scope

`close(): void` marks the factory and its live handles closed and starts pool
draining. Callers do not await it. A record handle closes independently. A single-tenant context uses one
scope; a multitenant operation requires a non-blank tenant ID and isolates that
tenant's rows.

Each Entity source and history family has an independent table. Errors do not
include connection URLs, credentials, or provider details.

## Records and queries

CRUD operations use normal statements. Payload-based compare-and-set uses an
InnoDB transaction or a keyed `GET_LOCK` on MyISAM and Aria. On InnoDB,
`writeAll` encodes the input first, applies entries in input order, and commits
all rows or none. On MyISAM and Aria, `writeAll` has deterministic input-order
semantics but is not transactional; a failed Entity prefix requires an
identical retry. Repeated storage slots in a batch leave the last entry as the
stored value. The adapter accepts canonical IDs including `undefined`, `null`,
booleans, finite numbers, bigints, strings, byte arrays, arrays, and plain
objects, subject to documented byte limits.

Every family table has `_scope VARBINARY(224) NOT NULL`, `ID VARBINARY(768)
NOT NULL`, `bytes MEDIUMBLOB NOT NULL`, and `_revision BIGINT UNSIGNED NOT NULL
DEFAULT 0`, with primary key `(_scope, ID)`. Existing layouts are inspected and
never altered; required columns, primary-key order, types, nullability,
defaults, binary collation, and harmful extra unique constraints must be
compatible.

Queries execute ID filters, ANDed column filters, materialized-column sorts,
keyset continuations, offsets, and limits in MySQL. They accept at most 256
IDs, 32 filters, 64 values per filter, eight sort fields, and 2,048 total bound
values. These limits are fixed. Missing materialized columns do not match;
dotted payload paths are rejected. Large offsets can be expensive.

Normalized projection plans compile supported nested predicates and comparisons
to parameterized SQL. The configured plan bound is sent as a sentinel SQL limit so
overflow is detected before a semantic result limit is applied. Identifiers and
values are bound rather than interpolated into SQL.

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
