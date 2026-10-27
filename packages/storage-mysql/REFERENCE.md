# @spine-event-engine/storage-mysql reference

This reference is for coding agents configuring the supported MySQL storage adapter.

## Public entry point

Import `MysqlStorageFactory`, `MysqlStorageOptions`, `MysqlTenantStorageOptions`,
`MysqlTenantResolver`,
`MysqlEntityStorageHandle`, `MysqlStorageFactoryBuilder`,
`MysqlCreateOperation`, `CreateOperationFactory`, `MysqlTableSpec`,
`MysqlColumnSpec`, `MysqlStorageConfigurationError`,
`MysqlStorageConnectionError`, `MysqlStorageSchemaError`,
`MysqlStorageDataError`, and `MysqlStorageOperationError` from
`@spine-event-engine/storage-mysql`.

## Connection and schema

`MysqlStorageFactory.newBuilder().setOptions(options).build()` configures one
shared database without connecting. `setTenantOptions(entries)` configures
distinct databases for complete generated `TenantId` values;
`setTenantResolver(resolver)` selects them asynchronously on first use. Fixed
entries and a resolver are mutually exclusive. Shared options are required in
both modes. The first storage operation binds each database and its pool;
concurrent first uses share that binding, while a failed binding can retry.
`checkConnection()` probes only the shared database with `SELECT 1`, performs
no schema checks or DDL, and releases a temporary pool unless runtime work
already bound one. Successful checks are remembered; failed checks can retry.
The provider-only `StoragePreparations` port accepts declared Record, current
Entity and enabled history, or surviving Agent audit requirements. Its `check`
mode reads physical metadata without creating tables or indexes. Its `create`
mode creates missing structures and verifies their complete layout. Both modes
reuse a bound runtime pool or release temporary pools, and compatible results
are shared with later ordinary use. A failed attempt remains retryable.
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
Without explicit preparation, per-family tables are created and verified lazily
on first use. Options support
`connectionLimit`, `connectTimeoutMs`, and TLS material. Failure to validate
configuration throws `MysqlStorageConfigurationError`; inaccessible connections
are reported as `MysqlStorageConnectionError`; an
incompatible private table shape throws `MysqlStorageSchemaError`.

The adapter supports MySQL and MariaDB InnoDB, MyISAM, and Aria family tables.
It creates and verifies a family table lazily. An account therefore needs DDL
permission, metadata reads, and DML. Existing tables are inspected and never
altered.

MyISAM and Aria impose a smaller primary-key byte limit than InnoDB. A family
using the canonical `VARCHAR(512)` ID must therefore be provisioned with a
one-byte binary collation, such as `latin1_bin`, and can store only IDs
representable in that character set. An `utf8mb4` ID of that declared width
cannot be converted to MyISAM.

The optional `inventory:legacy` command remains available for operators
examining older layouts. Factory build and `checkConnection()` do not scan
unrelated tables or perform an upgrade-layout inventory. Requested record
families are checked when normal storage operations first use them.

## Lifecycle and tenancy

`close(): Promise<void>` immediately fences new public operations, waits for
complete admitted record, Entity, Agent, and commit work, then closes live
handles and drains pools. Await it to
observe cleanup failures; repeated calls return the same completion. A record
handle closes independently. Shared operations use the configured shared
destination. Creating a multitenant storage handle requires a complete
generated `TenantId` in its `StorageContext`; that captured tenant selects the
database for operations through the handle. Bounded Context names are
diagnostic only and never partition rows, tables, locks, or queries.

Each Entity source and history family has an independent table. Top-level
provider error messages and public responses omit connection URLs,
credentials, and driver details. The original driver failure remains available
as the internal `cause`; do not expose it in public responses or unfiltered
logs.

## Records and queries

CRUD operations use normal statements. Payload-based compare-and-set uses
atomic conditional statements for one storage slot on InnoDB, MyISAM, and Aria.
`writeAll` encodes input first and writes entries in input order; a later failure
leaves completed rows in place on every engine. Repeated storage slots in a
batch leave the last completed entry as the
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
nanoseconds in signed 64-bit `BIGINT` columns. Indexed timestamp values must
fit that range (approximately 1677–2262 UTC); Protobuf's wider `Timestamp`
range does not expand the SQL range. `Version` uses its number. Floating-point
record columns are not supported by Spine JVM JDBC and are rejected here.

Queries execute ID filters, ANDed column filters, materialized-column sorts,
keyset continuations, offsets, and limits in MySQL. Before executing, MySQL
validates each ID encoding, requires every filter and sort name to be `ID` or a
declared materialized column, and maps each filter/continuation value through
that column's descriptor. Missing materialized columns do not match; dotted
payload paths are rejected. Large offsets can be expensive.

Normalized projection plans compile IDs, equality, all five comparisons, nested
`all` / `either`, ordering, and limits to one parameterized SQL statement.
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
state and event history. It is not a remote application history API. State and
diagnostic append use immutable per-record insertion. Trim and truncate use
fixed-size chunks. A failed chunk can leave earlier chunks durable, so callers
retry maintenance. Current-record and history actions are separate calls, not
one cross-storage transaction.

The internal Entity commit port writes state history, diagnostic Events,
framework delivery Events, then current state as independent records. A failure
can leave a completed prefix on every engine. One classified deadlock retry
replays captured input with unchanged versions and Event IDs. Standalone
history operations remain separate; a delivery Event alone does not prove the
current-state write completed.

## Agent history

The provider-only Agent history handle stores original complete
`AgentHistoryEntry` bytes and full repository scope in one `agent_history`
record family per tenant database. SHA-256 digests provide bounded physical
record IDs and indexed scope/conversation keys; reads also compare the full
state type, Agent key, and selected conversation key with binary equality.
Three validated InnoDB B-tree indexes cover scope plus full order, scope plus
category plus full order, and scope plus conversation digest plus full order.
The `VARBINARY(2944)` order column fits the 3,072-byte InnoDB composite-index
budget with two 64-byte digests; category uses 12 bytes. Its value encodes the
complete Timestamp, category, and unsigned UTF-8 record ID. Longer values
reject before storage rather than using a prefix index. Existing prefix,
misordered, or otherwise incompatible same-name indexes reject when the handle
opens. Pages use bounded native SQL chunks and sum serialized entry bytes; a
fetched chunk can be larger than the returned byte budget.

## Agent execution

Agent execution conformance is exercised with MySQL 5.7 and 8.4, and MariaDB 11.4.

Agent repositories require InnoDB. The execution handle rejects a nontransactional
engine before accepting Agent work; the existing engine choices for other Entity
families are unchanged. Execution and per-instance pending records use complete
binary ordering keys and validated composite indexes.

One connection transaction checks the claim and initial Entity Version, then
writes state, mandatory history, preferences and outgoing Command obligations. Emitted
domain Events enter immutable Agent history and are handed to the normal EventBus
after completion without a saved delivery phase. Connection
binding is scoped to that asynchronous operation. Encoded execution,
per-instance, and Agent history records must each fit the 65,535-byte BLOB limit. The runtime must
check its response reservation against the provider limits before inference.
Reopening a factory can read the saved work. No transaction remains open during
a model request.

`MysqlStorageSchemaError` reports incompatible layouts,
`MysqlStorageDataError` reports stored bytes that cannot be decoded, and
`MysqlStorageOperationError` reports sanitized bounds, query, collision, and
driver-operation failures. Custom creation uses `useOperationFactory()`; its
resolved `MysqlTableSpec` has the same native column types and family-specific
naming as default DDL. A grouped family uses its explicit grouped override or
grouped default; an ungrouped family uses its explicit record override or
ungrouped default. An ungrouped override never aliases a grouped family.
