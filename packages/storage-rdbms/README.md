# MySQL storage for Spine TS

`@spine-event-engine/storage-rdbms` stores Spine TS records in MySQL. It is a
durable implementation of `@spine-event-engine/storage` and owns the mysql2
connection pool and its private tables. PostgreSQL is not supported by this
package.

For database requirements, query limits, lifecycle, and error details, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Stores Spine records durably in a MySQL database.
- ✅ Owns a bounded `mysql2` connection pool; InnoDB writes are transactional.
- ✅ Supports declared-column filters, sorting, offsets, limits, and
  continuations.
- ✅ Keeps adapter tables private behind the common `RecordStorage` API.

## 🚀 Build it in this workspace

```sh
pnpm typecheck:build
```

Run this workspace-wide TypeScript build from the repository root. This private
snapshot package is not published to an npm registry; use it from this
workspace while developing the framework.

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

Each record source uses its own private table. An ungrouped family defaults to
its Proto full name with dots replaced by underscores. A grouped family uses
the group name with dots replaced by underscores, followed by the record type's
short name. Tables include native declared columns, but the adapter never adds
user-column indexes automatically.

The table contains only `ID`, the serialized `bytes`, and the columns declared
by the Proto model. `ID` is the primary key. A Bounded Context name is useful
in diagnostics, but it is never stored in a row and never changes a table name.

## 🧪 Verify with a disposable database

Run the opt-in integration suite against a disposable MySQL database:

```sh
SPINE_TS_MYSQL_URL='mysql://user:password@127.0.0.1:3306/spine_test' \
  pnpm --filter @spine-event-engine/storage-rdbms test:mysql
```

The test creates adapter-owned tables and removes them afterward. It is not a
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
