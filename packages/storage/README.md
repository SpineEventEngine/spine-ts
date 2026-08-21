# Storage API and in-memory storage for Spine TS

`@spine-event-engine/storage` defines the storage API used by Spine TS and
includes an in-memory implementation for local development and tests. Use it
when an application needs a small record store, or when an adapter needs to
implement the same storage contract for a durable provider.

This is an experimental snapshot package. Use Node 24 or newer and generated
Protobuf record schemas before configuring storage.

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

Run this workspace-wide TypeScript build from the repository root. For an
experimental npm consumer, install `@spine-event-engine/storage@snapshot`.
The snapshot tag can change before a stable release.

## 🧪 Start with the Proto fields people may query

Persistence begins in the Proto model. Mark only the fields that need to be
filtered or sorted with `(column)`. The complete message is always kept as
authoritative bytes; an unmarked field is not silently promoted to a provider
property.

```proto
message TaskView {
  TaskId id = 1;
  UserId assignee = 2 [(column) = true];
  string title = 3;
}
```

Here `assignee` is a query column. `title` stays in the serialized record. The
generated record specification carries that declaration into the selected
storage adapter.

## 🧪 Store a Protobuf record in memory

Create a `RecordSpec` to describe the record type, identity, and searchable
columns. Its source type defaults to the record type. Pass it to an
`InMemoryStorageFactory` with the storage context.

```ts
import { create, ScalarType } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import {
  ColumnTypes,
  InMemoryStorageFactory,
  RecordColumn,
  RecordSpec,
} from "@spine-event-engine/storage";

const records = new InMemoryStorageFactory().createRecordStorage(
  { name: "Users", multitenant: false },
  new RecordSpec<string, StringValue>({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (user) => user.value,
    columns: [
      new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (user) => user.value),
    ],
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
column names come from the declared `RecordSpec`/Proto mapping. `RecordQuery<I>`
types its IDs. Providers apply their documented runtime mapping and validation
to filter names and values: MySQL checks declared columns, while other adapters
can support different query shapes. A provider can push down supported ID and
declared-column query parts while preserving the common result semantics.

The storage API clones data at its boundaries. For the base factory and the
in-memory implementation, closing a factory prevents new record handles while
existing handles remain usable. Closing a record handle invalidates that
handle's later operations. Other adapters can close live handles; see their
[Datastore reference](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/storage-datastore/REFERENCE.md) and
[MySQL reference](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/storage-rdbms/REFERENCE.md) before choosing shutdown
behavior.

## 🧩 Keep compatible record families separate

Most applications only need a `RecordSpec`. Sometimes two record families use
the same source type and record type but must remain separate: for example,
two independently retained views of the same Task state records.
Pass a `StorageGroup` as the optional third argument to give that family its
separate physical storage group. The group is deliberately separate from the
`RecordSpec`, because the record layout has not changed.

```ts
import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory, RecordSpec, StorageGroup } from "@spine-event-engine/storage";

const factory = new InMemoryStorageFactory();
const stateHistorySpec = new RecordSpec<string, StringValue>({
  recordType: StringValueSchema,
  idKind: "string",
  extractId: (state) => state.value,
});

const auditStates = factory.createRecordStorage(
  { name: "Tasks", multitenant: false },
  stateHistorySpec,
  new StorageGroup("example.tasks.TaskState.audit"),
);

await auditStates.write(create(StringValueSchema, { value: "first" }));
```

Use a group only when otherwise compatible records must not share rows. The
ordinary Event Store is intentionally ungrouped.

## 🗄️ Choose a durable adapter

`@spine-event-engine/storage-datastore` provides Google Cloud Datastore
storage. `@spine-event-engine/storage-rdbms` provides MySQL storage. Configure
those packages in application code and pass the resulting factory to the Spine
server; this package does not choose a database.

| Need                        | Adapter                                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Local development and tests | `InMemoryStorageFactory` in this package                                                                                               |
| Google Cloud Datastore      | [`@spine-event-engine/storage-datastore`](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/storage-datastore/README.md) |
| MySQL                       | [`@spine-event-engine/storage-rdbms`](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/storage-rdbms/README.md)         |

## ⚠️ Lifecycle differences

The common API defines record behavior, not deployment policy. Provider
adapters may close live handles, impose query budgets, or require indexes and
credentials. Read the selected adapter guide before configuring production
shutdown and queries.

## 🔗 Learn more

- [Datastore adapter](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/storage-datastore/README.md)
- [MySQL adapter](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/storage-rdbms/README.md)
- [Server](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/server/README.md)
- [Reference for coding agents](REFERENCE.md)
