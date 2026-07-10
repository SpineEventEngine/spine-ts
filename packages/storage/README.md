# @spine-ts/storage

Small JVM-like storage seam for Spine TS runtime records.

The package owns the first corrected storage layer:

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

The package stays independent of `@spine-ts/server`. Storage scoping uses a
small structural `StorageContext` with `name`, `multitenant`, and optional
`tenantId`.

## Query Model

`RecordStorage` queries are intentionally small and deterministic:

- exact ID filters;
- exact column filters;
- sorting by `id`, stored columns, or simple dotted record paths;
- non-negative offsets after sorting;
- positive limits;
- simple field masks applied to cloned results.

Stored records are cloned on write and read. Generated clone methods are used
first when available, then Protobuf-ES `clone(schema, message)`, and finally
`structuredClone()` for non-message values such as stored column data.

## In-Memory Adapter

```ts
import { create } from "@bufbuild/protobuf";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";
import { InMemoryStorageFactory, RecordColumn, RecordSpec } from "@spine-ts/storage";

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
