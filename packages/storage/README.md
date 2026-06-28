# @spine-ts/storage

Record-oriented storage contracts and the first in-memory adapter for Spine TS.

The package owns storage interfaces for framework runtime records without
introducing repositories, buses, services, ZeroMQ, or production database
dependencies. All storage methods are asynchronous so tests and development can
use the same seam that future durable adapters will implement.

## Stores

`StorageAdapter` separates write-side and read-side storage concepts:

- `writeEntities` stores versioned entity state records for future repositories.
- `aggregateEvents` appends aggregate event histories with expected stream
  versions.
- `aggregateSnapshots` stores versioned aggregate snapshots.
- `readProjections` stores read-side projection/query-model records.
- `deliveryRecords` stores future inbox/outbox retry records.
- `tenantIndex` tracks tenant IDs for future multi-tenant runtime discovery.
- `diagnostics` stores safe framework diagnostics without payload bytes or
  secret values.

Payload types bind to stores, not individual read calls. Package boundaries
default to `unknown`, and callers that own a typed seam can declare it through
`StorageAdapter<EntityPayload, AggregateEventPayload, AggregateSnapshotPayload,
ProjectionPayload, DeliveryPayload>` or the corresponding store interface.

Record writes use `expectedVersion` for optimistic concurrency. Pass a numeric
version, `"absent"` for create-only writes, or `"any"` when the caller
intentionally bypasses the version check. Failed checks throw
`StorageVersionConflictError` with only key/version metadata.

## In-Memory Adapter

```ts
import { createInMemoryStorageAdapter } from "@spine-ts/storage";

const storage = createInMemoryStorageAdapter<{ title: string }>();

const record = await storage.writeEntities.put({
  key: "Task:1",
  payload: { title: "Draft" },
  expectedVersion: "absent",
});

await storage.writeEntities.put({
  key: "Task:1",
  payload: { title: "Published" },
  expectedVersion: record.version,
});
```

`InMemoryStorageAdapter` is deterministic and isolated per instance. It snapshots
stored values on write and read with Node's `structuredClone()`, preserving
framework payload shapes such as byte arrays. Payloads must be structured-clone
compatible. The adapter is explicitly non-durable: data is process-local and is
lost on restart.
