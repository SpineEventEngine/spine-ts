# @spine-ts/storage-datastore

`@spine-ts/storage-datastore` is an optional Google Cloud Datastore adapter for
the provider-neutral `@spine-ts/storage` port. It targets Firestore in
Datastore mode through the official Datastore client; it does not use Firestore
Native APIs.

Applications either inject an already configured client or explicitly create
one. The adapter does not choose credentials and does not close an injected
client when its factory or a storage handle closes.

```ts
import { Datastore } from "@google-cloud/datastore";
import { DatastoreStorageFactory } from "@spine-ts/storage-datastore";

const factory = new DatastoreStorageFactory({
  client: new Datastore({ projectId: "my-project" }),
});

// Equivalent when caller-owned Google client options are sufficient:
const configuredFactory = DatastoreStorageFactory.create({ projectId: "my-project" });
```

Pass explicit `credentials` or `keyFilename` through the Google client options
when required. Application Default Credentials are supported only as the Google
client's own documented behavior, not as adapter policy. Never put credentials
or payload bytes in logs; malformed stored data is reported as a redacted
decoding error.

Each multitenant `StorageContext.tenantId` becomes a Datastore namespace.
Record data is a private flat entity with a Protobuf payload and indexed record
columns. Datastore composite indexes are deployment assets: create the indexes
required by your actual combinations of equality filters and sort order before
using those queries in production. `writeAll()` groups at most 500 mutations;
a later group failure can leave earlier groups persisted.

## Verification commands

Unit tests use an injected narrow client fake and run by default with the
repository test command. The emulator test is opt-in and requires an already
running Firestore emulator in Datastore mode:

```sh
gcloud emulators firestore start --database-mode=datastore-mode
DATASTORE_EMULATOR_HOST=127.0.0.1:8081 \
  pnpm --filter @spine-ts/storage-datastore test:emulator
```

Set `DATASTORE_PROJECT_ID` to override the disposable emulator project ID.
The emulator test creates and removes a uniquely named entity. It does not
prove production composite-index deployment, transaction limits, or all cloud
consistency behavior.

The cloud smoke test is deliberately credential-gated and never runs by
default:

```sh
DATASTORE_CLOUD_TEST=1 DATASTORE_PROJECT_ID=my-test-project \
  pnpm --filter @spine-ts/storage-datastore test:cloud
```

Use an explicit Google credential configuration supported by the official
client. The smoke test creates a unique kind and removes its one record in a
`finally` block; it is evidence only for the configured project and is not a
production compatibility claim.
