# Storage API and in-memory storage for Spine TS

`@spine-event-engine/storage` defines the storage API used by Spine TS and
includes an in-memory implementation for local development and tests. Use it
when an application needs a small record store, or when an adapter needs to
implement the same storage contract for a durable provider.

For detailed query, lifecycle, and adapter notes, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Gives every Spine repository one storage contract.
- ✅ Includes a fast in-memory implementation for development and tests.
- ✅ Supports typed IDs, declared columns, filtering, sorting, and limits.
- ✅ Lets applications select persistence without changing domain handlers.

## 🚀 Build it in this workspace

```sh
pnpm typecheck:build
```

Run this workspace-wide TypeScript build from the repository root. This private
snapshot package is not published to an npm registry; use it from this
workspace while developing the framework.

## 🧪 Store a Protobuf record in memory

Create a `RecordSpec` to describe the record type, identity, and searchable
columns. Its source type defaults to the record type. Pass it to an
`InMemoryStorageFactory` with the storage context.

```ts
import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory, RecordColumn, RecordSpec } from "@spine-event-engine/storage";

const records = new InMemoryStorageFactory().createRecordStorage(
  { name: "Users", multitenant: false },
  new RecordSpec<string, StringValue>({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (user) => user.value,
    columns: [new RecordColumn<StringValue, string>("value", (user) => user.value, "string")],
  }),
);

await records.write(create(StringValueSchema, { value: "ava" }));
const user = await records.read("ava");
const users = await records.query({
  filters: [{ column: "value", value: "ava" }],
  sort: [{ field: "value", direction: "asc" }],
  limit: 20,
});
```

`InMemoryStorageFactory` creates a fresh backend by default. Pass the same
`InMemoryStorageBackend` to separate factories only when they intentionally
need to share rows. Query named columns, sort them, and limit the result; the
column names come from the `RecordSpec`.

The storage API clones data at its boundaries. For the base factory and the
in-memory implementation, closing a factory prevents new record handles while
existing handles remain usable. Closing a record handle invalidates that
handle's later operations. Other adapters can close live handles; see their
[Datastore reference](../storage-datastore/REFERENCE.md) and
[MySQL reference](../storage-rdbms/REFERENCE.md) before choosing shutdown
behavior.

## 🗄️ Choose a durable adapter

`@spine-event-engine/storage-datastore` provides Google Cloud Datastore
storage. `@spine-event-engine/storage-rdbms` provides MySQL storage. Configure
those packages in application code and pass the resulting factory to the Spine
server; this package does not choose a database.

| Need                        | Adapter                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| Local development and tests | `InMemoryStorageFactory` in this package                                  |
| Google Cloud Datastore      | [`@spine-event-engine/storage-datastore`](../storage-datastore/README.md) |
| MySQL                       | [`@spine-event-engine/storage-rdbms`](../storage-rdbms/README.md)         |

## ⚠️ Lifecycle differences

The common API defines record behavior, not deployment policy. Provider
adapters may close live handles, impose query budgets, or require indexes and
credentials. Read the selected adapter guide before configuring production
shutdown and queries.

## 🔗 Learn more

- [Datastore adapter](../storage-datastore/README.md)
- [MySQL adapter](../storage-rdbms/README.md)
- [Server](../server/README.md)
- [Reference for coding agents](REFERENCE.md)
