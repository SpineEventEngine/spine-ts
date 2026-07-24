# `@spine-event-engine/storage-rdbms`

`@spine-event-engine/storage-rdbms` is the private-workspace, MySQL-first durable
implementation of the provider-neutral `@spine-event-engine/storage` `StorageFactory`
port. MySQL 8.4.10 with mysql2 3.23.1 is the tested engine. PostgreSQL is a
future possibility, not a supported configuration or compatibility claim.

## Create and close a factory

```ts
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";

const factory = await MysqlStorageFactory.create({
  url: process.env.MYSQL_URL!,
  connectionLimit: 8,
  connectTimeoutMs: 5_000,
  tls: { rejectUnauthorized: true },
});
try {
  // Pass `factory` wherever a StorageFactory is accepted.
} finally {
  await factory.close();
}
```

The factory owns its mysql2 pool. Closing a handle only closes that handle;
closing the factory immediately prevents new handles and operations, closes its
live handles, waits for admitted operations to release their connections, then
drains the pool. Repeated `close()` calls share its promise.
Provider details and credentials are never included in adapter operation or
connection errors, including a pool-close failure.

Compose it through `BoundedContextBuilder.withStorageFactory(factory)` or a
`ServerEnvironment`, not through driver objects. A single-tenant context has
one scope; a multitenant context requires a non-blank operation-time `tenantId`
and isolates that tenant's rows.

## Provider-only entity history

`createEntityStorage(input)` is an internal-provider seam used by the later
repository integration; it is not a remote or end-user history API. It supplies
the frozen current-record, immutable state-history, and diagnostic event-history
ports. The returned `MysqlEntityStorageHandle` is independently closeable by its
provider/framework client; factory close also closes every live handle. MySQL
creates private `spine_ts_entity_*` tables lazily on first access, then verifies
their exact columns, InnoDB engine, primary keys, and required history indexes
before it binds a fingerprint or accesses rows. Each length-safe canonical
context/tenant/storage-key scope persists one compatibility fingerprint, so an
incompatible ID codec, layout, or state type is rejected before rows are read or
written—even from an independent factory.

Reads clone Protobuf values, are newest-first, and use an exclusive state
continuation. State rows are identified by canonical entity key plus version;
event rows by event ID, with entity correlation stored separately. An identical
retry for that durable identity succeeds; divergent content is rejected.
Provider failures are reported through the adapter's sanitized operation errors,
while malformed stored payloads and incompatible schemas retain their data/schema
errors.

State append and trim for one entity acquire a private, database-specific MySQL
`GET_LOCK` on one connection. The lock remains held across every committed
128-row trim chunk, so an append from another factory cannot interleave; a
failed lock release poisons that connection rather than returning it to the
pool. This coordination is only for one MySQL server (not cross-`mysqld`, NDB,
or statement-based replication). Current-record and history operations are not
one cross-storage transaction.

`trim` and `truncate` select/delete fixed 128-row key-only chunks; neither
offers an unbounded scan or generic cursor. A trim commit failure has an unknown
outcome: completed chunks remain durable, no internal retry runs, and the caller
must retry. Truncate captures an initial strict-time, provider-generated
write-order cutoff, so it does not chase rows appended after that capture; each delete chunk is transactional,
but a failed/unknown chunk outcome likewise requires caller retry. Closing a
history handle rejects subsequent operations. PostgreSQL support is future-only.

## Record behavior

The adapter stores deterministic Protobuf bytes in fixed private InnoDB tables
`spine_ts_records` and `spine_ts_columns`, creating and verifying their schema
at factory creation. Every factory startup executes `CREATE TABLE IF NOT EXISTS`
for both tables before verification, so the database account always needs that
DDL permission plus ordinary DML; use a dedicated database/account.

CRUD, `writeAll`, and payload-based `compareAndSet` are transactional. A batch
pre-encodes all records, executes in input order (later duplicate slots win),
and commits all rows or none. CAS addresses the supplied storage slot, not an
ID derived from the body; absent creation uses the records unique key and
returns `false` only for the exact competing create.

Supported canonical slot IDs are `undefined`, `null`, booleans, finite numbers,
bigints, strings, byte arrays, arrays, and plain objects. Canonical encodings
are limited to 512 bytes for scope, 255 for tenant and materialized column name,
and 768 for slot; indexed sortable data is limited to 768 bytes. Columns support
`null`, boolean, finite number, string (up to
256 JavaScript UTF-16 code units, encoded into the fixed 768-byte sortable
value), and signed 64-bit bigint. Unsupported or oversized data fails before
SQL.

Queries execute in MySQL: `ids`, ANDed filters (array values are OR/IN),
materialized-column sorts plus binary slot tie-break, keyset continuations,
offset, and limit. Missing materialized columns match no rows; dotted payload
paths are rejected. The lookup index supports equality/order, but MySQL may use
filesort for other orderings and large offsets remain costly.

One query accepts at most 256 `ids`, 32 filters, 64 values in each filter, eight
sort fields, and 2,048 total bound values. These fixed adapter limits are
validated before pool acquisition; they are not configurable.

Normalized Projection plans additionally compile nested `ALL`/`EITHER` and all
five comparisons to SQL with bound column names and values. A framework
`candidateLimit` becomes the bound sentinel `LIMIT` parameter independently of
any semantic result limit, avoiding unbounded row materialization and detecting
overflow before the semantic limit is applied. Repeated ordering uses left
joins for the frozen missing-value order and finishes with the binary slot-ID
tie-breaker. Authored identifiers and values are never interpolated into SQL
text.

## Verify locally

```sh
SPINE_TS_MYSQL_URL='mysql://user:password@127.0.0.1:3306/spine_test' \
  pnpm --filter @spine-event-engine/storage-rdbms test:mysql
```

The opt-in test creates adapter-owned tables and removes them afterward.
The account needs `CREATE TABLE IF NOT EXISTS` (including the FK/index),
information-schema metadata reads, and transactional `SELECT`/`INSERT`/`UPDATE`/
`DELETE`; precreating tables does not remove the adapter's create/verify step.
Use a disposable database and do not place credentials in committed files or
logs. An operation admitted before factory close may finish and release its
connection before the shared close promise settles; new handles and operations
are rejected immediately.
