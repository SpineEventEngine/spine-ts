# MySQL storage for Spine TS

`@spine-event-engine/storage-rdbms` stores Spine TS records in MySQL. It is a
durable implementation of `@spine-event-engine/storage` and manages the mysql2
connection pool and its private tables. PostgreSQL is not supported by this
package.

This is an experimental snapshot package. Use Node 24 or newer, generated
record schemas, and a reachable MySQL database.

For database requirements, query limits, lifecycle, and error details, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Stores Spine records durably in a MySQL database.
- ✅ Manages a bounded `mysql2` connection pool; InnoDB writes are transactional.
- ✅ Supports declared-column filters, sorting, offsets, limits, and
  continuations.
- ✅ Keeps adapter tables private behind the common `RecordStorage` API.

## 🚀 Build it in this workspace

```sh
pnpm typecheck:build
```

Run this workspace-wide TypeScript build from the repository root. For an
experimental npm consumer, install `@spine-event-engine/storage-rdbms@snapshot`.
The snapshot tag can change before a stable release.

## 🔌 Create and close a MySQL factory

Provide a MySQL URL that includes a database name. Building the factory opens
its pool only; each record family creates and verifies its private table lazily
on first use.

```ts
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";

const factory = await MysqlStorageFactory.newBuilder()
  .setOptions({
    url: "mysql://user:password@127.0.0.1:3306/spine_app",
    connectionLimit: 8,
    tls: { rejectUnauthorized: true },
  })
  .build();

try {
  // Pass factory to a Spine TS server or create record storage through it.
} finally {
  factory.close();
}
```

For a multitenant application, assign each complete generated `TenantId` to a
different database. The factory creates one pool per configured tenant and
selects that pool before it opens a table or starts a transaction:

```ts
import { create } from "@bufbuild/protobuf";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";

const acme = create(TenantIdSchema, { kind: { case: "value", value: "acme" } });
const globex = create(TenantIdSchema, { kind: { case: "value", value: "globex" } });

const factory = await MysqlStorageFactory.newBuilder()
  .setTenantOptions([
    { tenantId: acme, options: { url: "mysql://user:password@db/acme" } },
    { tenantId: globex, options: { url: "mysql://user:password@db/globex" } },
  ])
  .build();
```

Use a dedicated database account. The account must be able to create and
inspect the adapter tables and perform normal reads and writes. Do not commit
connection URLs or credentials.

## ✨ Supported records and queries

The adapter performs record CRUD, payload-based compare-and-set, named-column
queries, sort order, offsets, limits, and keyset continuations. InnoDB makes
`writeAll` and Entity commits transactional. MyISAM and Aria instead use
deterministic ordered writes with immutable-prefix retry semantics; a failed
write may require an identical retry. It supports primitive and structured
storage IDs. Declared columns support strings, booleans, integral Protobuf
numbers, enums, bytes, messages, `Timestamp`, and `Version`. Spine JVM JDBC
does not support `float` or `double` record columns, so this adapter rejects
them too.

Each record source uses a separate private table. An ungrouped family defaults to
its Proto full name with dots replaced by underscores. A grouped family uses
the group name with dots replaced by underscores, followed by the record type's
short name. Tables include native declared columns, but the adapter never adds
user-column indexes automatically.

The table contains exactly `ID`, the serialized `bytes`, the framework columns
for that record family, and fields explicitly marked `(column)` in the Proto
model. It does not get a separate SQL column for every Proto field. `ID` is the
primary key. A Bounded Context name is useful in diagnostics, but it is never
stored in a row and never changes a table name.

For generated records, start by marking the few Proto fields that a query needs
with `(column)`. Those declarations, not a field-name convention, select the
native MySQL columns. `Identifiers` determine the storage ID, and `Stringifiers`
turn message-valued IDs and declared message columns into the same stable text
for a write, lookup, filter, sort continuation, and read. `RecordQuery<I>`
statically types IDs only: MySQL validates filter names and values at runtime
against the record descriptor and its declared column mappings.

## 🧭 See a Proto model become a table

Suppose an application declares this Projection state:

```proto
package spine.examples.messageboard;

message MessageView {
  MessageId id = 1 [(required) = true, (set_once) = true];
  BoardId board = 2 [(column) = true];
  UserId author = 3 [(column) = true];
  string text = 4;
}
```

The default current-state table is conceptually:

```sql
CREATE TABLE spine_examples_messageboard_MessageView (
  ID VARCHAR(512) NOT NULL,
  bytes BLOB NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  deleted BOOLEAN NOT NULL DEFAULT false,
  version INT NOT NULL DEFAULT 0,
  board TEXT NULL,
  author TEXT NULL,
  PRIMARY KEY (ID)
);
```

`ID` stores `MessageId` as compact Proto JSON, such as
`{"value":"message-42"}`. `bytes` contains the authoritative generated
`EntityRecord`, including the complete `MessageView` state. `archived`,
`deleted`, and `version` are Entity lifecycle/version facts, not a provider
revision. The `board` and `author` columns exist only because those Proto fields
use `(column)`; `text` stays inside `bytes` because it is not a query column.

For `board == BoardId("board-7")`, Spine uses the same reversible stringifier
as the write and sends parameterized SQL equivalent to:

```sql
SELECT ID, bytes
FROM spine_examples_messageboard_MessageView
WHERE board = ?
ORDER BY ID ASC;
-- bound value: {"value":"board-7"}
```

MySQL compares the materialized column, then Spine decodes each matching
authoritative `bytes` payload. The adapter does not create an index for
`board`; add application indexes for production query patterns.

## 🧪 Verify with a disposable database

Run the opt-in integration suite against a disposable MySQL database:

```sh
SPINE_TS_MYSQL_URL='mysql://user:password@127.0.0.1:3306/spine_test' \
  pnpm --filter @spine-event-engine/storage-rdbms test:mysql
```

The test creates temporary adapter tables and removes them afterward. It is not a
substitute for an application's backup, monitoring, permissions, or database
operations plan.

## ⚠️ Before production

Use a dedicated database and account, protect the connection URL, configure
TLS, and plan backups, monitoring, and migrations. Indexed `bigint` values must
fit the exact signed 64-bit MySQL range. PostgreSQL support is planned for the
same package but is not implemented.

Before starting this corrected layout against an existing database, run the
legacy-layout inventory for every configured tenant database:

```sh
pnpm --dir packages/storage-rdbms inventory:legacy -- \
  --url 'mysql://user:password@127.0.0.1:3306/tenant_a' \
  --url 'mysql://user:password@127.0.0.1:3306/tenant_b'
```

The command exits nonzero if a database is unreachable or contains the old
`_scope`, `_revision`, or compound scope key. Do not start the corrected
runtime until it passes. The factory repeats this check for every configured
database before it becomes usable. The runtime does not read both layouts or choose
between rows that old Bounded Context partitions would collapse onto the same
new `ID`; migrate those rows offline and stop on every conflict.

## 🔗 Learn more

- [Storage API](../storage/README.md)
- [End-user storage guide](../../docs/USER_GUIDE.md#13-develop-with-mysql-rdbms-storage)
- [Reference for coding agents](REFERENCE.md)
