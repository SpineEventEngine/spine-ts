# @spine-event-engine/storage-rdbms reference

This reference is for agents configuring the supported MySQL storage adapter.

## Public entry point

Import `MysqlStorageFactory`, `MysqlStorageOptions`,
`MysqlEntityStorageHandle`, `MysqlStorageConfigurationError`,
`MysqlStorageConnectionError`, `MysqlStorageSchemaError`,
`MysqlStorageDataError`, and `MysqlStorageOperationError` from
`@spine-event-engine/storage-rdbms`.

## Connection and schema

`MysqlStorageFactory.create(options)` validates a full MySQL URL with a
database name, creates an owned mysql2 pool, creates missing private tables,
verifies their schema, and returns a ready factory. Options support
`connectionLimit`, `connectTimeoutMs`, and TLS material. Failure to validate
configuration throws `MysqlStorageConfigurationError`; inaccessible connections
or pool close failures are reported as `MysqlStorageConnectionError`; an
incompatible private table shape throws `MysqlStorageSchemaError`.

The adapter requires MySQL and is the only supported RDBMS engine. It creates
and verifies its private InnoDB tables at factory initialization. An account
therefore needs DDL permission, metadata reads, and transactional DML.

## Lifecycle and scope

`close()` returns one shared promise, rejects new handles and operations, closes
live handles, waits for admitted work to release connections, and drains the
pool. A record handle closes independently. A single-tenant context uses one
scope; a multitenant operation requires a non-blank tenant ID and isolates that
tenant's rows.

Each entity-history scope stores a compatibility fingerprint. An incompatible
entity ID codec, layout, or state schema fails before entity-history rows are
used. Normal `RecordStorage` rows do not use this fingerprint. Errors
intentionally do not include connection URLs, credentials, or provider details.

## Records and queries

CRUD, `writeAll`, and payload-based compare-and-set are transactional.
`writeAll` encodes the input first, applies entries in input order, and commits
all rows or none. Repeated storage slots in a batch leave the last entry as the
stored value. The adapter accepts canonical IDs including `undefined`, `null`,
booleans, finite numbers, bigints, strings, byte arrays, arrays, and plain
objects, subject to documented byte limits.

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

`createEntityStorage(input)` returns a provider/framework handle with current
records plus immutable state and event history. It is not a remote application
history API. State append and retention for one entity use a MySQL server lock;
this coordination applies to one MySQL server only. Trim and truncate use
fixed-size chunks. A failed chunk can leave earlier chunks durable, so callers
retry maintenance. Current-record and history actions are separate calls, not
one cross-storage transaction.

The internal atomic Entity commit port writes current state, configured history,
framework delivery events, and an invocation-owned receipt in one InnoDB
transaction. An ambiguous acknowledgement reconciles the durable owner so only
the committing invocation receives `committed`; later calls receive `replayed`.
Standalone history operations remain separate.

`MysqlStorageDataError` reports stored bytes that cannot be decoded, and
`MysqlStorageOperationError` reports sanitized record-operation failures.
