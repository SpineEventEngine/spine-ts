# Google Cloud Datastore storage for Spine TS

`@spine-event-engine/storage-datastore` stores Spine TS records in Google Cloud
Datastore, including Firestore in Datastore mode. It implements the storage
contract from `@spine-event-engine/storage`; it does not use Firestore Native
APIs.

This is an experimental snapshot package. Use Node 24 or newer, generated
record schemas, and a configured Google Datastore client.

For exact query limits, entity-storage behavior, and failure handling, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Stores Spine records in Google Cloud Datastore or Firestore in Datastore mode.
- ✅ Pushes supported filters and ordering to Datastore.
- ✅ Preserves atomic compare-and-set writes through provider transactions.
- ✅ Rejects queries that exceed a finite reconciliation budget instead of
  returning incomplete results.

## 🚀 First snapshot success

```sh
mkdir spine-datastore-app && cd spine-datastore-app
pnpm init
pnpm add @spine-event-engine/storage-datastore@snapshot @spine-event-engine/storage@snapshot @bufbuild/protobuf @google-cloud/datastore
```

Create a `storage.ts` file from the factory example below, replace `my-project`
with a Google Cloud project that you can access, and run it with Node 24 or
newer. A successful read of `task-42` proves the installed snapshot can create,
write, and read a Datastore record. The snapshot tag can change before a stable
release.

## 🔌 Create a factory

Give the adapter an already configured Datastore client when the application
controls Google authentication and client lifetime.

<!-- docs-snippet-path: packages/storage-datastore/src/index.ts -->

```ts
import { Datastore } from "@google-cloud/datastore";
import { create, ScalarType } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";

const factory = DatastoreStorageFactory.newBuilder()
  .setClient(new Datastore({ projectId: "my-project" }))
  .build();
const records = factory.createRecordStorage(
  { name: "Tasks", multitenant: false },
  new RecordSpec<string, StringValue>({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
    columns: [
      new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
    ],
  }),
);

try {
  await records.write(create(StringValueSchema, { value: "task-42" }));
  const stored = await records.read("task-42");
  if (stored?.value !== "task-42") throw new Error("The record was not stored.");
} finally {
  await records.close();
  factory.close();
}
```

The builder always uses a client supplied by the caller. Its fixed finite reconciliation
bound is 1,000 records. Pass the factory to the server or create record storage
through the normal storage API. When application values contain `Any`, configure
a `StringifierRegistry` with that application's `TypeRegistry` before building;
the layout section below explains why that mapping must remain reversible.

## Build it in this workspace

Contributors changing this repository can run the workspace-wide build from its
root:

```sh
pnpm typecheck:build
```

## 🧭 Understand tenants and kinds

Datastore uses its native namespace as the tenant boundary. By default, Spine
converts a complete generated `TenantId` to the safe reversible Spine JVM forms:
`Dexample.org` for a domain or `Vtenant-a` for a plain value. Spine JVM's email
form replaces `@` with `-at-`; two different emails can therefore become the
same namespace. Spine TS rejects that unsafe default. To use email tenant IDs,
install the same reversible custom namespace converter in both runtimes.
Single-tenant storage keeps the namespace already configured on the
caller-supplied client. A Bounded Context name helps diagnostics; it never changes
a namespace, kind, or key.

Suppose a projection state is declared like this:

```proto
package spine.examples.messageboard;

message MessageView {
  MessageId id = 1 [(required) = true, (set_once) = true];
  BoardId board = 2 [(column) = true];
  UserId author = 3 [(column) = true];
  string text = 4;
}
```

With the default layout, its kind is the full Proto type name, for example
`spine.examples.messageboard.MessageView`. One entity looks conceptually like
this:

| Datastore part | Stored value                              |
| -------------- | ----------------------------------------- |
| namespace      | `Vtenant-a`                               |
| kind           | `spine.examples.messageboard.MessageView` |
| key name       | `{"value":"message-42"}`                  |
| `bytes`        | unindexed `EntityRecord` with the state   |
| `archived`     | native boolean                            |
| `deleted`      | native boolean                            |
| `version`      | native integer                            |
| `board`        | `{"value":"board-7"}`                     |
| `author`       | `{"value":"user-3"}`                      |

`archived`, `deleted`, and `version` come from Spine's generated `EntityRecord`;
they are Entity lifecycle/version facts, not a provider revision. `board` and
`author` exist because the Proto fields use `(column)`. The unindexed `bytes`
payload remains authoritative.

The same identity and value mapping is used at each step: `Identifiers` turn
the record ID into the key name, while the configured `StringifierRegistry`
turns message-valued IDs and `(column)` values into reversible text. Do not
pre-stringify a query value in application code. `RecordQuery<I>` statically
types IDs only; Datastore checks the string filter name and `unknown` value
against the record descriptor and column mapping, then applies the registry
mapping used on write.

Message-valued IDs and columns use compact Proto JSON by default. Supply the
application `TypeRegistry` as shown above when a stored framework value contains
an `Any`; it tells Proto JSON how to expand the packed application type.
Applications can also register one reversible custom `Stringifier`. The same
mapping is used for writes, key lookups, filters, ordering continuations, and
reads. Primitive values use their native Datastore representation. There is no
`_scope`, copied ID, storage revision, fingerprint, marker, or compatibility
entity. The runnable configuration is in the
[Message Board deployment](https://github.com/SpineEventEngine/spine-ts/blob/main/examples/message-board/app/src/deployment-config.ts).

When a user queries `board == BoardId("board-7")`, Spine converts that generated
`BoardId` with the same stringifier and sends a Datastore property filter for
`board == '{"value":"board-7"}'`. Datastore uses the declared property and its
indexes to find matching keys; Spine decodes the authoritative `bytes` payload
for each result.

## 🔐 Configure credentials and indexes

Credential selection belongs to the official Google client. For example, an
application can use Application Default Credentials or pass `credentials` or
`keyFilename` in its Datastore options. Keep credentials out of source code and
logs.

Queries that combine equality filters and ordering can require composite
indexes. Kind names depend on the application's Proto types and layout choices,
so the framework cannot ship one universal index file. Keep the required
indexes in the application and deploy them before serving those queries. For
example:

```yaml
indexes:
  - kind: spine.examples.orders.OrderView
    properties:
      - name: status
      - name: when_created
        direction: desc
```

```sh
gcloud datastore indexes create index.yaml
gcloud datastore indexes list
```

Wait until each required index is ready before serving its query combinations.

Retained Entity histories need separate indexes because their kinds and
ordering differ from current state. For a state type named
`spine.examples.board.Message`, the usual backward-history index is:

```yaml
indexes:
  - kind: spine.examples.board.Message_EntityRecord
    properties:
      - name: entity_id
      - name: version
        direction: desc
      - name: created
        direction: desc
```

`stateAt()` instead orders `created` and then `version`, both descending.
Diagnostic event history uses the corresponding
`<state-source>_Event` grouped kind and the same `entity_id`, `version`, and
`created` columns. Inspect the concrete query shapes your application serves
and add the matching Datastore composite indexes; the adapter never creates
them automatically.

## 📏 Understand query limits

The adapter has a fixed finite client-side reconciliation budget of `1000`.
When a query needs more candidates than that budget,
`DatastoreQueryLimitError` is thrown instead of returning a partial result.
There is no unlimited scan setting or Datastore-specific cursor API.
Provider filters and ordering are pushed down; public query offsets and mixed
local/provider limits are reconciled locally within that finite bound.

Ordinary `write()` and `writeAll()` calls are independent provider writes. Use
compare-and-set for an atomic conditional record update, or an Entity commit
for one atomic current-state/history/event mutation.

## 🧪 Verify with a local emulator

The optional emulator suite needs an already-running Firestore emulator in
Datastore mode.

```sh
gcloud emulators firestore start --database-mode=datastore-mode --host-port=127.0.0.1:8081
DATASTORE_EMULATOR_HOST=127.0.0.1:8081 \
  pnpm --filter @spine-event-engine/storage-datastore test:emulator
```

Use a disposable project for the credential-gated cloud smoke test. Neither
test substitutes for production index, quota, or consistency planning.

## ⚠️ Before production

Deploy every composite index used by the application, select quotas and retry
policy for its workload, and keep Google credentials outside source control.
This adapter does not provide an unlimited scan mode or a Datastore-specific
cursor API.

Before starting this corrected layout in an existing project, inventory every
native namespace and kind:

```sh
pnpm --dir packages/storage-datastore inventory:legacy -- --project my-project
```

The command exits nonzero if discovery fails or it finds an old `_scope`
property or scope-derived key name. Do not start the corrected runtime until it
passes. Old rows are invisible to direct keys; move them offline, and stop if
rows from old Bounded Context partitions would become the same namespace,
kind, and key. The runtime never chooses a winner.

## 🔗 Learn more

- [Storage API](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/storage/README.md)
- [Datastore guide](https://github.com/SpineEventEngine/spine-ts/blob/main/docs/USER_GUIDE.md#6-persist-application-data)
- [Reference for coding agents](REFERENCE.md)
