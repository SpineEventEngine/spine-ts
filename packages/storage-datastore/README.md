# Google Cloud Datastore storage for Spine TS

`@spine-event-engine/storage-datastore` stores Spine TS records in Google Cloud
Datastore, including Firestore in Datastore mode. It implements the storage
contract from `@spine-event-engine/storage`; it does not use Firestore Native
APIs.

For exact query limits, entity-storage behavior, and failure handling, see
[REFERENCE documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Stores Spine records in Google Cloud Datastore or Firestore in Datastore mode.
- ✅ Pushes supported filters and ordering to Datastore.
- ✅ Preserves atomic compare-and-set writes through provider transactions.
- ✅ Rejects queries that exceed a finite reconciliation budget instead of
  returning incomplete results.

## 🚀 Build it in this workspace

```sh
pnpm typecheck:build
```

Run this workspace-wide TypeScript build from the repository root. This private
snapshot package is not published to an npm registry; use it from this
workspace while developing the framework.

## 🔌 Create a factory

Give the adapter an already configured Datastore client when the application
controls Google authentication and client lifetime.

```ts
import { Datastore } from "@google-cloud/datastore";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";

const factory = DatastoreStorageFactory.newBuilder()
  .setClient(new Datastore({ projectId: "my-project" }))
  .build();
```

The builder always uses a caller-owned client. Its fixed finite reconciliation
bound is 1,000 records. Pass the factory to the server or create record storage
through the normal storage API.

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
      - name: _scope
      - name: status
      - name: when_created
        direction: desc
```

```sh
gcloud datastore indexes create index.yaml
gcloud datastore indexes list
```

Wait until each required index is ready before serving its query combinations.

Retained Entity histories need their own indexes because their kinds and
ordering differ from current state. For a state type named
`spine.examples.board.Message`, the usual backward-history index is:

```yaml
indexes:
  - kind: spine.examples.board.Message_EntityRecord
    properties:
      - name: _scope
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

## 🔗 Learn more

- [Storage API](../storage/README.md)
- [Datastore guide](../../docs/USER_GUIDE.md#12-develop-with-google-cloud-datastore)
- [Reference for coding agents](REFERENCE.md)
