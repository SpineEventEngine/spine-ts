# @spine-event-engine/storage

Small JVM-like storage seam for Spine TS runtime records. Its root API is
independent of `@spine-event-engine/server`; server runtime code composes this seam rather
than widening it with delivery or service behavior.

The package owns the current storage layer:

- `StorageFactory.createRecordStorage(context, spec)` is the one mandatory
  adapter method;
- `RecordSpec` describes identified Protobuf records and query columns;
- `RecordStorage` stores, reads, deletes, and queries those records;
- `InMemoryStorageFactory` and `InMemoryRecordStorage` are the first concrete
  adapter. Each factory created without an `InMemoryStorageBackend` owns an
  isolated process-local backend; independently constructed factories share
  only when they receive the same explicit backend token. Compatible opens in
  one backend return independently closeable handles over the same logical
  records;
- `EventStore` is a framework delegate over `RecordStorage<EventId, Event>`.

`EventStore` is storage-only in this task. It persists and reads `Event`
records and rejects missing, blank, or duplicate event IDs for one
factory/context append path, but it does not implement event-bus dispatch,
delivery queues, subscriber fan-out, or retry behavior.
`acceptThenAppend(event, onAccepted)` lets bus code keep the event precheck,
caller acceptance, and append on one captured storage context without making the
store own dispatch.

One `RecordSpec` cannot declare the same `RecordColumn` name twice. Its
constructor rejects duplicate names before any storage adapter receives the
specification.

The package stays independent of `@spine-event-engine/server`. Storage scoping uses a
small structural `StorageContext` with `name`, `multitenant`, and optional
`tenantId`.

## Shared entity records and diagnostic history

The provider-only entity-history SPI supplies the shared contract that later
repository and provider work uses for entity persistence. `EntityRecord<I, S>`
is the one latest-state shape for Aggregate, Projection, and Process Manager
storage: it contains the canonical ID, Protobuf state, version, and
archived/deleted lifecycle flags. `EntityRecordStorage` reads and writes that
latest record.

`EntityStateHistoryPort` and `EntityEventHistoryPort` are immutable history
ports for repository/adapters. Reads are asynchronous and newest-first;
`startingFromVersion` is an exclusive continuation boundary. State history
also supports `stateAt`. Identical writes for the same state `(entity ID,
version)` or event ID are retries and are no-ops; different content for that
identity is rejected. State history exposes application-managed `trim` and
time-based `truncate`; diagnostic event history exposes time-based `truncate`
only. Maintenance is bounded and resumable, does not expose a generic cursor,
and is close-aware. A state trim serializes with appends for that entity; a
truncate processes its selected rows, so an eligible concurrent append is left
for a later invocation.

`entityStorageKey(stateType, purpose)` creates the closed `current`,
`state-history`, and `event-history` physical purposes. Adapters scope these
records by the canonical context, tenant, and purpose key and reject an
incompatible compatibility fingerprint before accessing rows. The three
purposes are separate and cannot share rows. `MemoryEntityStorageFactory`
is the adapter-conformance foundation, not a durable provider.

These contracts do not yet configure repositories or expose entity/client
history APIs; that cutover is deferred to T-0071. The diagnostic event journal
is never an event-sourcing or reconstruction store: latest entity state remains
the restoration source.

## Query Model

`StorageQueryPolicy.validate(plan, capabilities)` is the canonical normalized
query boundary for adapters. A provider advertises comparison operators and
optional `either`, nested-predicate, ordering, mask, and limit features. The
shared policy rejects malformed or unsupported plans before provider execution;
`RecordStorage.queryPlan()` then applies the shared complete evaluator for
nested predicates, repeated ordering, the stable ID tie-breaker, masks, and
limits. Application query construction remains in `@spine-event-engine/client`.
Framework callers may set `candidateLimit` to bound provider materialization
independently of the semantic result limit. Providers fetch at most one
sentinel row beyond that bound, and `RecordStorage` raises
`QueryCandidateLimitError` before evaluation when it is exceeded.

`RecordStorage` queries are intentionally small and deterministic:

- exact ID filters;
- exact column filters;
- sorting by `id`, stored columns, or simple dotted record paths;
- stable continuations after sorted row keys;
- non-negative offsets after sorting;
- positive limits;
- simple field masks applied to cloned results.

Stored records are cloned on write and read. Generated clone methods are used
first when available, then Protobuf-ES `clone(schema, message)`, and finally
`structuredClone()` for non-message values such as stored column data.

## In-Memory Adapter

```ts
import { create } from "@bufbuild/protobuf";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory, RecordColumn, RecordSpec } from "@spine-event-engine/storage";

const factory = new InMemoryStorageFactory();
const spec = new RecordSpec({
  schema: EventSchema,
  storageKey: "EventSchema:legacy",
  idSchema: EventIdSchema,
  extractId: (event) => {
    if (event.id === undefined) {
      throw new Error("Expected event.id.");
    }

    return event.id;
  },
  columns: [new RecordColumn("typeUrl", (event) => event.message?.typeUrl, "string")],
});
const storage = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);

await storage.write(
  create(EventSchema, {
    id: create(EventIdSchema, { value: "event-1" }),
  }),
);
```

`InMemoryRecordStorage` keeps deterministic per-tenant slices when the context
is multitenant. Every `InMemoryStorageFactory` created without an
`InMemoryStorageBackend` owns a fresh, isolated in-memory backend. Pass the
same root-exported `InMemoryStorageBackend` token to independently constructed
record or adapter entity factories only when they must deliberately share
compatible canonical scopes. The shared backend rejects an incompatible
fingerprint before access, and closing one factory does not clear rows used by
its siblings. The adapter is not durable across restarts. Custom adapters must
make repeated `createRecordStorage(context, spec)` calls observe the same
logical records while returning independently closeable storage handles.

Every `RecordSpec` requires a stable, nonblank `storageKey` and exactly one ID
descriptor: a Protobuf `idSchema` or a nonblank primitive `idKind`. Each
`RecordColumn` also requires a nonblank `valueType` descriptor. These declared
descriptors are inputs to the compatibility fingerprint, so adapters reject an
incompatible layout before accessing rows.
