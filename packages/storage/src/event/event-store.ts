import { clone } from "@bufbuild/protobuf";
import type { Event, EventId } from "@spine-ts/proto";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";

import { RecordColumn } from "../record/record-column.js";
import type { RecordQuery } from "../record/record-query.js";
import { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/** Framework event store backed by a record storage. */
export class EventStore {
  readonly #context: StorageContext;
  readonly #factory: StorageFactory;
  readonly #storage: RecordStorage<EventId, Event>;

  constructor(context: StorageContext, factory: StorageFactory) {
    this.#context = context;
    this.#factory = factory;
    this.#storage = factory.createRecordStorage(context, eventSpec);
  }

  /** Whether the underlying event record storage remains open. */
  isOpen(): boolean {
    return this.#storage.isOpen();
  }

  /** Close the underlying event record storage. */
  close(): void {
    this.#storage.close();
  }

  /** Append one generated Spine event. */
  async append(event: Event): Promise<void> {
    await this.appendUnique([clone(EventSchema, event)], snapshotContext(this.#context));
  }

  /** Append generated Spine events in order. */
  async appendAll(events: Iterable<Event>): Promise<void> {
    const records = [...events].map((event) => clone(EventSchema, event));
    const context = snapshotContext(this.#context);

    if (records.length > 0) {
      await this.appendUnique(records, context);
    }
  }

  /** Read persisted events through the underlying record-storage query seam. */
  read(query: RecordQuery<EventId> = {}): Promise<readonly Event[]> {
    return this.#storage.query(query);
  }

  private async appendUnique(records: readonly Event[], context: StorageContext): Promise<void> {
    this.requireOpen();
    const ids = records.map((record) => eventId(record));
    rejectDuplicateIds(ids);

    await EventStoreLocks.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventSpec);
      const appended = await storage.index({ ids });

      if (appended.length > 0) {
        throw new Error("EventStore requires unique event IDs.");
      }

      await storage.writeAll(records);
    });
  }

  private requireOpen(): void {
    if (!this.#storage.isOpen()) {
      throw new Error("RecordStorage is closed.");
    }
  }
}

const EventStoreLocks = Object.freeze({
  queues: new WeakMap<StorageFactory, Map<string, Promise<void>>>(),

  async withLock(factory: StorageFactory, context: StorageContext, work: () => Promise<void>) {
    const queues = this.queueMap(factory);
    const key = contextKey(context);
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const stored = next.catch(() => undefined);

    queues.set(key, stored);
    try {
      await next;
    } finally {
      if (queues.get(key) === stored) {
        queues.delete(key);
      }
    }
  },

  queueMap(factory: StorageFactory): Map<string, Promise<void>> {
    let queues = this.queues.get(factory);
    if (queues === undefined) {
      queues = new Map();
      this.queues.set(factory, queues);
    }
    return queues;
  },
});

function eventId(event: Event): EventId {
  if (event.id === undefined) {
    throw new Error("EventStore requires event.id.");
  }
  return event.id;
}

function rejectDuplicateIds(ids: readonly EventId[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    const key = id.value;
    if (seen.has(key)) {
      throw new Error("EventStore requires unique event IDs.");
    }
    seen.add(key);
  }
}

function snapshotContext(context: StorageContext): StorageContext {
  if (!context.multitenant) {
    return Object.freeze({
      name: context.name,
      multitenant: false,
    });
  }
  return Object.freeze({
    name: context.name,
    multitenant: true,
    tenantId: requireTenantId(context.name, context.tenantId),
  });
}

function requireTenantId(name: string, tenantId: string | undefined): string {
  if (tenantId === undefined || tenantId.trim().length === 0) {
    throw new Error(`Multitenant storage "${name}" requires context.tenantId.`);
  }
  return tenantId;
}

function contextKey(context: StorageContext): string {
  return JSON.stringify({
    name: context.name,
    tenantId: context.multitenant ? context.tenantId : "",
  });
}

const eventSpec = new RecordSpec<EventId, Event>({
  schema: EventSchema,
  idSchema: EventIdSchema,
  extractId: eventId,
  columns: [
    new RecordColumn("timestamp", (event) => event.context?.timestamp?.seconds ?? 0n),
    new RecordColumn("typeUrl", (event) => event.message?.typeUrl),
  ],
});
