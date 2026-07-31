# @spine-event-engine/storage-datastore

`@spine-event-engine/storage-datastore` stores Spine TS records in Google Cloud
Datastore, including Firestore in Datastore mode. It implements the storage
contract from `@spine-event-engine/storage`; it does not use Firestore Native
APIs.

For exact query limits, entity-storage behavior, and failure handling, see
[REFERENCE documentation for agents](REFERENCE.md).

## Use from this source workspace

```sh
pnpm --filter @spine-event-engine/storage-datastore build
```

This private snapshot package is not published to an npm registry. Use it from
this workspace while developing the framework.

## Create a factory

Give the adapter an already configured Datastore client when the application
controls Google authentication and client lifetime.

```ts
import { Datastore } from "@google-cloud/datastore";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";

const factory = new DatastoreStorageFactory({
  client: new Datastore({ projectId: "my-project" }),
  maxClientSideScan: 1_000,
});
```

Alternatively, `DatastoreStorageFactory.create({ projectId: "my-project" })`
constructs a Google client from the supplied official client options. Pass the
factory to the server or create record storage through the normal storage API.

## Configure credentials and indexes

Credential selection belongs to the official Google client. For example, an
application can use Application Default Credentials or pass `credentials` or
`keyFilename` in its Datastore options. Keep credentials out of source code and
logs.

Queries that combine equality filters and ordering can require composite
indexes. Deploy this package's entity-history indexes when using the provider
history seam:

```sh
gcloud datastore indexes create packages/storage-datastore/index.yaml
gcloud datastore indexes list
```

Create any additional composite indexes required by the application's own
record-query combinations before serving production traffic.

## Query limits

The adapter has a finite client-side reconciliation budget. It is `1000` by
default and can be set to another positive finite integer with
`maxClientSideScan`. When a query needs more candidates than that budget,
`DatastoreQueryLimitError` is thrown instead of returning a partial result.
There is no unlimited scan setting or Datastore-specific cursor API.

## Verify a local emulator

The optional emulator suite needs an already-running Firestore emulator in
Datastore mode.

```sh
gcloud emulators firestore start --database-mode=datastore-mode --host-port=127.0.0.1:8081
DATASTORE_EMULATOR_HOST=127.0.0.1:8081 \
  pnpm --filter @spine-event-engine/storage-datastore test:emulator
```

Use a disposable project for the credential-gated cloud smoke test. Neither
test substitutes for production index, quota, or consistency planning.
