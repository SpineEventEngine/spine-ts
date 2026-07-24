# @spine-event-engine/storage-datastore

`@spine-event-engine/storage-datastore` is an optional Google Cloud Datastore adapter for
the provider-neutral `@spine-event-engine/storage` port. It targets Firestore in
Datastore mode through the official Datastore client; it does not use Firestore
Native APIs.

Applications either inject an already configured client or explicitly create
one. The adapter does not choose credentials and does not close an injected
client when its factory or a storage handle closes.

```ts
import { Datastore } from "@google-cloud/datastore";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";

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

Storage-slot IDs use one private reversible canonical encoding for Datastore
keys, stored metadata, ID filters, continuations, and returned entries. It
preserves `undefined`, `bigint`, arrays, and object IDs independent of object
property insertion order. Indexed column values support strings, finite
Datastore-compatible numbers, booleans, `null`, and exact signed 64-bit
`bigint` values only; out-of-range bigint input is rejected before a provider
call.

ID constraints become Datastore key filters, while supported column equality
filters and requested ordering become provider filters and orders. Every query
uses a fixed provider sentinel limit of `maxClientSideScan + 1`; the default
scan budget is `1000`, and callers may configure another positive finite
integer. The complete provider candidate set must remain within that bound. If
the sentinel row is returned, the adapter throws `DatastoreQueryLimitError`
before applying the typed continuation, deterministic ID tie-breaking, offset,
and requested result limit locally; a continuation cannot page around provider
candidate-set overflow. No partial result is returned. There is no unlimited
option or adapter-specific generic cursor API.

Normalized Projection plans push down only a whole provider-legal plan: no
more than 30 IDs, and any inequality property must be the first requested
ordering property. Conjunctive equality/ID sets meeting those rules are legal;
nested, disjunctive, over-30-ID, or misordered inequality plans use the finite
fallback. The sentinel is checked before local filtering, ordering, masks, or
limits, so overflow raises
`DatastoreQueryLimitError` instead of returning a truncated semantic result.

## Verification commands

Unit tests use an injected narrow client fake and run by default with the
repository test command. The emulator test is opt-in and requires an already
running Firestore emulator in Datastore mode:

```sh
gcloud emulators firestore start --database-mode=datastore-mode --host-port=127.0.0.1:8081
DATASTORE_EMULATOR_HOST=127.0.0.1:8081 \
  pnpm --filter @spine-event-engine/storage-datastore test:emulator
```

Set `DATASTORE_PROJECT_ID` to override the disposable emulator project ID.
Each emulator scenario uses a unique kind and removes only the records it
created. The suite covers multiple CRUD, query, transaction, batch, lifecycle,
namespace, and malformed-data scenarios; it does not globally reset the
emulator. It does not prove production composite-index deployment, transaction
limits, or all cloud consistency behavior.

The cloud smoke test is deliberately credential-gated and never runs by
default:

```sh
DATASTORE_CLOUD_TEST=1 DATASTORE_PROJECT_ID=my-test-project \
  pnpm --filter @spine-event-engine/storage-datastore test:cloud
```

Use an explicit Google credential configuration supported by the official
client. The smoke test creates a unique kind and removes its one record in a
`finally` block; it is evidence only for the configured project and is not a
production compatibility claim.
