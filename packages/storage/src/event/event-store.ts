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

  /**
   * Creates an event store for one storage context.
   *
   * @param context Specifies the storage context.
   * @param factory Creates the backing record storage.
   */
  constructor(context: StorageContext, factory: StorageFactory) {
    this.#context = context;
    this.#factory = factory;
    this.#storage = factory.createRecordStorage(context, eventSpec);
  }

  /**
   * Returns whether the underlying event record storage remains open.
   *
   * @returns Returns true while the backing storage is open.
   */
  isOpen(): boolean {
    return this.#storage.isOpen();
  }

  /**
   * Closes the underlying event record storage.
   */
  close(): void {
    this.#storage.close();
  }

  /**
   * Validates that one generated Spine event can be appended without storing it.
   *
   * @param event Supplies the event to validate.
   * @returns Completes when the event is accepted.
   */
  async accept(event: Event): Promise<void> {
    const record = clone(EventSchema, event);
    const context = EventContexts.snapshotForEvent(this.#context, record);

    await this.checkUnique([EventIds.require(record)], context);
  }

  /**
   * Accepts one event, runs caller acceptance, and appends using one captured
   * storage context.
   *
   * @param event Supplies the event to accept.
   * @param onAccepted Runs after uniqueness validation and before append.
   * @returns Resolves to the appended event snapshot.
   */
  async acceptThenAppend(event: Event, onAccepted: OnEventAccepted): Promise<Event> {
    const record = clone(EventSchema, event);
    const context = EventContexts.snapshotForEvent(this.#context, record);

    await this.checkUnique([EventIds.require(record)], context);
    await onAccepted(clone(EventSchema, record));
    await this.appendUnique([record], context);
    return clone(EventSchema, record);
  }

  /**
   * Writes one generated Spine event, rejecting missing, blank, or duplicate IDs.
   *
   * @param event Supplies the event to append.
   * @returns Completes when the event is appended.
   */
  async append(event: Event): Promise<void> {
    const record = clone(EventSchema, event);

    await this.appendUnique([record], EventContexts.snapshotForEvent(this.#context, record));
  }

  /**
   * Writes generated Spine events in order, rejecting missing, blank, or duplicate IDs.
   *
   * @param events Supplies the events to append.
   * @returns Completes when the events are appended.
   */
  async appendAll(events: Iterable<Event>): Promise<void> {
    const records = [...events].map((event) => clone(EventSchema, event));
    const context = EventContexts.snapshot(this.#context);

    if (records.length > 0) {
      await this.appendUnique(records, context);
    }
  }

  /**
   * Writes generated Spine events and returns a one-shot rollback token.
   *
   * @param events Supplies the events to append.
   * @returns Resolves to the rollback token for this append.
   */
  async appendAllWithRollback(events: Iterable<Event>): Promise<EventRollback> {
    const records = [...events].map((event) => clone(EventSchema, event));
    const context = EventContexts.snapshot(this.#context);
    const ids = records.map((record) => EventIds.require(record));

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

  /**
   * Reads persisted events through the underlying record-storage query seam.
   *
   * @param query Specifies the record query.
   * @returns Resolves to matching events.
   */
  read(query: RecordQuery<EventId> = {}): Promise<readonly Event[]> {
    return this.#storage.query(query);
  }

  private async appendUnique(records: readonly Event[], context: StorageContext): Promise<void> {
    this.requireOpen();
    const ids = records.map((record) => EventIds.require(record));
    EventIds.rejectDuplicates(ids);

    await EventStoreLocks.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventSpec);
      try {
        await EventIds.rejectStored(storage, ids);
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
    EventIds.rejectDuplicates(ids);

    await EventStoreLocks.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventSpec);
      try {
        await EventIds.rejectStored(storage, ids);
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

/**
 * Accepts an event after `EventStore` prechecks it and before append.
 *
 * @param event Supplies the validated event snapshot.
 * @returns Completes after caller acceptance finishes.
 */
export type OnEventAccepted = (event: Event) => Promise<void> | void;

/**
 * One-shot rollback token scoped to one successful event-store append.
 */
export interface EventRollback {
  // prettier-ignore

  /**
   * Deletes the events appended by the operation that created this token.
   * @returns Completes when the events are deleted.
   */
  rollback(): Promise<void>;
}

const EventStoreLocks = Object.freeze({
  queues: new WeakMap<StorageFactory, Map<string, Promise<void>>>(),

  async withLock(factory: StorageFactory, context: StorageContext, work: () => Promise<void>) {
    const queues = this.queueMap(factory);
    const key = EventContexts.key(context);
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

/**
 * Validates event IDs before record-store operations.
 */
const EventIds = {
  // prettier-ignore

  /**
   * Requires an event to have a non-blank ID.
   */
  require(event: Event): EventId {
    if (event.id === undefined) throw new Error("EventStore requires event.id.");
    if (event.id.value.trim().length === 0) {
      throw new Error("EventStore requires a non-empty event.id.value.");
    }
    return event.id;
  },

  /**
   * Rejects IDs that already exist in storage.
   */
  async rejectStored(
    storage: RecordStorage<EventId, Event>,
    ids: readonly EventId[],
  ): Promise<void> {
    if ((await storage.index({ ids })).length > 0) {
      throw new Error("EventStore requires unique event IDs.");
    }
  },

  /**
   * Rejects repeated IDs within one append operation.
   */
  rejectDuplicates(ids: readonly EventId[]): void {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id.value)) throw new Error("EventStore requires unique event IDs.");
      seen.add(id.value);
    }
  },
};

/**
 * Captures tenant-aware event-store contexts and their lock keys.
 */
const EventContexts = {
  // prettier-ignore

  /**
   * Captures one storage context.
   */
  snapshot(context: StorageContext): StorageContext {
    if (!context.multitenant) return Object.freeze({ name: context.name, multitenant: false });
    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId: EventContexts.requireTenantId(context.name, context.tenantId),
    });
  },

  /**
   * Captures one context using an event envelope tenant when present.
   */
  snapshotForEvent(context: StorageContext, event: Event): StorageContext {
    if (!context.multitenant) return EventContexts.snapshot(context);
    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId: EventContexts.requireTenantId(
        context.name,
        EventContexts.readEventTenant(event) ?? context.tenantId,
      ),
    });
  },

  /**
   * Reads an explicit tenant from an event envelope.
   */
  readEventTenant(event: Event): string | undefined {
    switch (event.context?.origin.case) {
      case "importContext":
        return EventContexts.tenantValue(event.context.origin.value.tenantId);
      case "pastMessage":
        return EventContexts.tenantValue(event.context.origin.value.actorContext?.tenantId);
      default:
        return undefined;
    }
  },

  /**
   * Converts a typed tenant ID to its storage-scope value.
   */
  tenantValue(tenantId: TenantId | undefined): string | undefined {
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
  },

  /**
   * Requires a non-blank tenant ID for a multitenant context.
   */
  requireTenantId(name: string, tenantId: string | undefined): string {
    if (tenantId === undefined || tenantId.trim().length === 0) {
      throw new Error(`Multitenant storage "${name}" requires context.tenantId.`);
    }
    return tenantId;
  },

  /**
   * Creates a deterministic key for a context-scoped append lock.
   */
  key(context: StorageContext): string {
    return JSON.stringify({
      name: context.name,
      multitenant: context.multitenant,
      tenantId: context.multitenant ? context.tenantId : "",
    });
  },
};

const eventSpec = new RecordSpec<EventId, Event>({
  schema: EventSchema,
  storageKey: "spine.core.Event:event-store",
  idSchema: EventIdSchema,
  extractId: (event) => EventIds.require(event),
  columns: [
    new RecordColumn("timestamp", (event) => event.context?.timestamp?.seconds ?? 0n, "int64"),
    new RecordColumn("typeUrl", (event) => event.message?.typeUrl, "string"),
  ],
});
