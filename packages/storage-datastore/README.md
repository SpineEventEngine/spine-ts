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

## Entity history provider seam

`DatastoreStorageFactory.createEntityStorage()` is the framework's supported
provider seam for the frozen internal entity-history input. It is not a remote
history API. A returned handle binds its layout before access and can be closed
independently without closing the injected Google client or sibling handles.
State and event history reads are immutable, asynchronous, newest first, and
have finite depth; no unlimited history scan or generic cursor is exposed.

State retention (`trim`) and state/event `truncate` are application-managed.
They operate in bounded provider work and may leave already completed chunks
durable if a later chunk fails; retry is therefore required to resume cleanup.
Current-record writes and separate history calls are deliberately not one
cross-call transaction. Retrying an immutable state version or event ID with
identical content is safe; divergent content is rejected.

Framework/provider code supplies the frozen input and uses the structural
handle; application clients do not receive a history route:

```ts
import { create } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import type { EntityStorageInput } from "@spine-event-engine/storage/internal/entity-history";

const input: EntityStorageInput<string, StringValue> = {
  context: { name: "Tasks", multitenant: false },
  id: { clone: (id) => id, fingerprint: "string", key: (id) => id },
  layout: "tasks-v1",
  stateSchema: StringValueSchema,
  storageKey: "tasks.Task:current",
};
const history = factory.createEntityStorage(input);
const createdAt = create(TimestampSchema, { seconds: 1n });
await history.current.write({
  id: "task",
  state: create(StringValueSchema),
  version: 1n,
  archived: false,
  deleted: false,
});
await history.states.append({
  entityId: "task",
  state: create(StringValueSchema),
  version: 1n,
  createdAt,
});
await history.events.append({
  entityId: "task",
  event: create(EventSchema, { id: create(EventIdSchema, { value: "e1" }) }),
  producerVersion: 1n,
  createdAt,
});
await history.states.trim("task", 20);
await history.states.truncate(createdAt);
await history.events.truncate(createdAt);
```

The handle persists one canonical length-delimited scope (context, tenant mode,
and storage key) plus a compatibility fingerprint before current/history
access. It uses only fixed `$SpineEntity*` kinds: scope binding, entity root,
current/state/state-order children, and state/event identity, order, and cut
roots. The entity root serializes immutable append and retention through a
state count and revision. Multitenant scope also selects the Datastore
namespace. Indexed tokens are limited to 1,500 bytes and completed keys to
6 KiB before an RPC.

Binding and immutable append are bounded transactions. Trim reads the root
count and deletes at most eight oldest key-only state-order selections per
transaction; truncate captures one cut-key high-water mark, then removes at
most eight stable cut keys per transaction. A completed chunk remains durable
after a later failure, so callers retry the operation. Code-10 contention retry
is bounded; divergent retries, malformed durable rows, and closed handles are
surfaced. History reads select markers, stop at requested depth, and point-look
up only selected immutable rows.

Deploy the fixed entity-history indexes before enabling this seam:

```sh
gcloud datastore indexes create packages/storage-datastore/index.yaml
gcloud datastore indexes list
```

Wait until both indexes report `SERVING`. Pre-remediation dynamic history rows
are not migrated or read: use an empty namespace/project or explicitly remove
only task-owned old data when making this migration-free layout change.

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
default. Emulator evidence covers only the configured local binary; it does
not prove production index deployment, provider transaction limits, or cloud
consistency. Cloud evidence is claimed only after this command succeeds against
a disposable project with the history indexes deployed and `SERVING`:

```sh
DATASTORE_CLOUD_TEST=1 DATASTORE_PROJECT_ID=my-test-project \
  pnpm --filter @spine-event-engine/storage-datastore test:cloud
```

Use an explicit Google credential configuration supported by the official
client. The smoke test creates a unique kind and removes its one record in a
`finally` block; it is evidence only for the configured project and is not a
production compatibility claim.
