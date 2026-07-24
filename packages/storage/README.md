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
  adapter, with storage objects from the same factory and `RecordSpec` instance
  sharing one process-local backing record set per context name, tenant mode,
  and tenant ID while returning independently closeable handles;
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
  idSchema: EventIdSchema,
  extractId: (event) => {
    if (event.id === undefined) {
      throw new Error("Expected event.id.");
    }

    return event.id;
  },
  columns: [new RecordColumn("typeUrl", (event) => event.message?.typeUrl)],
});
const storage = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);

await storage.write(
  create(EventSchema, {
    id: create(EventIdSchema, { value: "event-1" }),
  }),
);
```

`InMemoryRecordStorage` keeps deterministic per-tenant slices when the context
is multitenant. Storage objects opened by one `InMemoryStorageFactory` with the
same `RecordSpec` instance, context name, tenant mode, and tenant ID share
those process-local slices. The adapter is not durable across restarts. Custom
adapters must make repeated `createRecordStorage(context, spec)` calls observe
the same logical records while returning independently closeable storage
handles.
