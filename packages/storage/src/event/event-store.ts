import { clone } from "@bufbuild/protobuf";
import type { Event, EventId, TenantId } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";

import { RecordColumn } from "../record/record-column.js";
import type { RecordQuery } from "../record/record-query.js";
import { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/**
 * Framework event store backed by record storage.
 *
 * Snapshots input events before queued work, rejects missing, blank, and
 * duplicate IDs in one batch, and rejects IDs already stored for the same
 * captured storage context.
 */
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

  /** Validate that one generated Spine event can be appended without storing it. */
  async accept(event: Event): Promise<void> {
    const record = clone(EventSchema, event);
    const context = snapshotEventContext(this.#context, record);

    await this.checkUnique([eventId(record)], context);
  }

  /**
   * Validate one event, run caller acceptance, and append using one captured
   * storage context.
   */
  async acceptThenAppend(event: Event, onAccepted: OnEventAccepted): Promise<Event> {
    const record = clone(EventSchema, event);
    const context = snapshotEventContext(this.#context, record);

    await this.checkUnique([eventId(record)], context);
    await onAccepted(clone(EventSchema, record));
    await this.appendUnique([record], context);
    return clone(EventSchema, record);
  }

  /** Append one generated Spine event, rejecting missing, blank, or duplicate IDs. */
  async append(event: Event): Promise<void> {
    const record = clone(EventSchema, event);

    await this.appendUnique([record], snapshotEventContext(this.#context, record));
  }

  /** Append generated Spine events in order, rejecting missing, blank, or duplicate IDs. */
  async appendAll(events: Iterable<Event>): Promise<void> {
    const records = [...events].map((event) => clone(EventSchema, event));
    const context = snapshotContext(this.#context);

    if (records.length > 0) {
      await this.appendUnique(records, context);
    }
  }

  /** Append generated Spine events and return a one-shot token for rolling back this append. */
  async appendAllWithRollback(events: Iterable<Event>): Promise<EventRollback> {
    const records = [...events].map((event) => clone(EventSchema, event));
    const context = snapshotContext(this.#context);
    const ids = records.map((record) => eventId(record));

    if (records.length > 0) {
      await this.appendUnique(records, context);
    }
    let used = false;
    return Object.freeze({
      rollback: async () => {
        if (used) {
          throw new Error("Event rollback token has already been used.");
        }
        used = true;
        await this.deleteIds(ids, context);
      },
    });
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
      try {
        await rejectStoredIds(storage, ids);
        await storage.writeAll(records);
      } finally {
        storage.close();
      }
    });
  }

  private async deleteIds(ids: readonly EventId[], context: StorageContext): Promise<void> {
    this.requireOpen();

    await EventStoreLocks.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventSpec);
      try {
        for (const id of ids) {
          await storage.delete(id);
        }
      } finally {
        storage.close();
      }
    });
  }

  private async checkUnique(ids: readonly EventId[], context: StorageContext): Promise<void> {
    this.requireOpen();
    rejectDuplicateIds(ids);

    await EventStoreLocks.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventSpec);
      try {
        await rejectStoredIds(storage, ids);
      } finally {
        storage.close();
      }
    });
  }

  private requireOpen(): void {
    if (!this.#storage.isOpen()) {
      throw new Error("RecordStorage is closed.");
    }
  }
}

/** Callback invoked after `EventStore` prechecks an event and before append. */
export type OnEventAccepted = (event: Event) => Promise<void> | void;

/** One-shot rollback token scoped to one successful event-store append. */
export interface EventRollback {
  /** Delete the events appended by the operation that created this token. */
  rollback(): Promise<void>;
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
  if (event.id.value.trim().length === 0) {
    throw new Error("EventStore requires a non-empty event.id.value.");
  }
  return event.id;
}

async function rejectStoredIds(
  storage: RecordStorage<EventId, Event>,
  ids: readonly EventId[],
): Promise<void> {
  const appended = await storage.index({ ids });

  if (appended.length > 0) {
    throw new Error("EventStore requires unique event IDs.");
  }
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

function snapshotEventContext(context: StorageContext, event: Event): StorageContext {
  if (!context.multitenant) {
    return snapshotContext(context);
  }
  return Object.freeze({
    name: context.name,
    multitenant: true,
    tenantId: requireTenantId(context.name, readEventTenant(event) ?? context.tenantId),
  });
}

function readEventTenant(event: Event): string | undefined {
  switch (event.context?.origin.case) {
    case "importContext":
      return tenantValue(event.context.origin.value.tenantId);
    case "pastMessage":
      return tenantValue(event.context.origin.value.actorContext?.tenantId);
    default:
      return undefined;
  }
}

function tenantValue(tenantId: TenantId | undefined): string | undefined {
  switch (tenantId?.kind.case) {
    case "value":
      return tenantId.kind.value;
    case "domain":
      return `domain:${tenantId.kind.value.value}`;
    case "email":
      return `email:${tenantId.kind.value.value}`;
    default:
      return undefined;
  }
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
    multitenant: context.multitenant,
    tenantId: context.multitenant ? context.tenantId : "",
  });
}

const eventSpec = new RecordSpec<EventId, Event>({
  schema: EventSchema,
  storageKey: "spine.core.Event:event-store",
  idSchema: EventIdSchema,
  extractId: eventId,
  columns: [
    new RecordColumn("timestamp", (event) => event.context?.timestamp?.seconds ?? 0n, "int64"),
    new RecordColumn("typeUrl", (event) => event.message?.typeUrl, "string"),
  ],
});
