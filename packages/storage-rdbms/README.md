# MySQL storage for Spine TS

`@spine-event-engine/storage-rdbms` stores Spine TS records in MySQL. It is a
durable implementation of `@spine-event-engine/storage` and owns the mysql2
connection pool and its private tables. PostgreSQL is not supported by this
package.

For database requirements, query limits, lifecycle, and error details, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Stores Spine records durably in a MySQL database.
- ✅ Owns a bounded `mysql2` connection pool and transactional writes.
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

Provide a MySQL URL that includes a database name. The factory connects,
creates or verifies its tables, and then is ready for the normal storage API.

```ts
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";

const factory = await MysqlStorageFactory.create({
  url: "mysql://user:password@127.0.0.1:3306/spine_app",
  connectionLimit: 8,
  tls: { rejectUnauthorized: true },
});

try {
  // Pass factory to a Spine TS server or create record storage through it.
} finally {
  await factory.close();
}
```

Use a dedicated database account. The account must be able to create and
inspect the adapter tables as well as perform normal transactional reads and
writes. Do not commit connection URLs or credentials.

## ✨ Supported records and queries

The adapter performs record CRUD, transactional `writeAll`, payload-based
compare-and-set, named-column queries, sort order, offsets, limits, and keyset
continuations. It supports primitive and structured storage IDs, but indexed
column values are limited to `null`, booleans, finite numbers, strings, and
signed 64-bit `bigint` values.

The factory creates private `spine_ts_records` and `spine_ts_columns` tables.
They are adapter implementation details; application code should use
`RecordStorage` rather than issuing SQL against them.

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

## 🔗 Learn more

- [Storage API](../storage/README.md)
- [End-user storage guide](../../docs/USER_GUIDE.md#storage)
- [Reference for coding agents](REFERENCE.md)
