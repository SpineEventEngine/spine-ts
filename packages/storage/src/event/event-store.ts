/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { clone, create, ScalarType } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Event, EventId, TenantId } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";

import { RecordColumn } from "../record/record-column.js";
import { ColumnTypes } from "../record/column-type.js";
import type { RecordQuery } from "../record/record-query.js";
import { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageFactory } from "../storage/storage-factory.js";
import { TenantBoundary } from "../internal/tenancy.js";

/**
 * Framework event store backed by record storage.
 *
 * Snapshots input events before queued work, rejects missing, blank, and
 * duplicate IDs in one batch, and rejects IDs already stored for the same
 * captured storage context.
 */
export class EventStore {
  readonly #context: EventStoreContext;
  readonly #factory: StorageFactory;
  #open = true;

  /**
   * Creates an event store for one storage context.
   *
   * @param context Specifies the storage context.
   * @param factory Creates the backing record storage.
   */
  constructor(context: EventStoreContext, factory: StorageFactory) {
    this.#context = EventContexts.base(context);
    this.#factory = factory;
  }

  /**
   * Returns whether this Event Store still accepts operations.
   *
   * @returns Returns true until this Event Store is closed.
   */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Closes this Event Store. Operation-selected storage handles close after use.
   */
  close(): void {
    this.#open = false;
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

    if (records.length > 0) {
      await this.appendUnique(records, EventContexts.batch(this.#context, records));
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
    const ids = records.map((record) => EventIds.require(record));
    const context = records.length === 0 ? undefined : EventContexts.batch(this.#context, records);

    if (context !== undefined) {
      await this.appendUnique(records, context);
    }
    let used = false;
    return Object.freeze({
      rollback: async () => {
        if (used) {
          throw new Error("Event rollback token has already been used.");
        }
        used = true;
        if (context !== undefined) await this.deleteIds(ids, context);
      },
    });
  }

  /**
   * Reads persisted events through the underlying record-storage query seam.
   *
   * @param query Specifies the record query.
   * @returns Resolves to matching events.
   */
  async read(query: RecordQuery<EventId> = {}): Promise<readonly Event[]> {
    this.requireOpen();
    const storage = this.#factory.createRecordStorage(
      EventContexts.snapshot(this.#context),
      eventStoreRecordSpec,
    );
    try {
      return await storage.query(query);
    } finally {
      storage.close();
    }
  }

  private async appendUnique(records: readonly Event[], context: StorageContext): Promise<void> {
    this.requireOpen();
    const ids = records.map((record) => EventIds.require(record));
    EventIds.rejectDuplicates(ids);

    await eventStoreAccess.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventStoreRecordSpec);
      try {
        await EventIds.insertUnique(storage, records);
      } finally {
        storage.close();
      }
    });
  }

  private async deleteIds(ids: readonly EventId[], context: StorageContext): Promise<void> {
    this.requireOpen();

    await eventStoreAccess.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventStoreRecordSpec);
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

    await eventStoreAccess.withLock(this.#factory, context, async () => {
      const storage = this.#factory.createRecordStorage(context, eventStoreRecordSpec);
      try {
        await EventIds.rejectStored(storage, ids);
      } finally {
        storage.close();
      }
    });
  }

  private requireOpen(): void {
    if (!this.#open) throw new Error("EventStore is closed.");
  }
}

/**
 * Selects Event Store tenancy before an event envelope supplies a tenant.
 *
 * Multitenant append operations may omit `tenantId` only because the complete
 * tenant is then required in every stored event envelope. Reads require an
 * explicitly selected tenant.
 */
export type EventStoreContext =
  | {
      // prettier-ignore

      /**
       * Diagnostic Bounded Context name.
       */
      readonly name: string;

      /**
       * Selects the one unpartitioned storage boundary.
       */
      readonly multitenant: false;
    }
  | {
      // prettier-ignore

      /**
       * Diagnostic Bounded Context name.
       */
      readonly name: string;

      /**
       * Requires tenant selection for every storage operation.
       */
      readonly multitenant: true;

      /**
       * Selects a default complete tenant when an event does not carry one.
       */
      readonly tenantId?: TenantId;
    };

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
  queues: new WeakMap<StorageFactory, Map<string | symbol, Promise<void>>>(),

  async withLock<T>(
    factory: StorageFactory,
    context: StorageContext,
    work: () => Promise<T>,
  ): Promise<T> {
    const queues = this.queueMap(factory);
    const key = EventContexts.key(context);
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const stored = next.then(
      () => undefined,
      () => undefined,
    );

    queues.set(key, stored);
    try {
      return await next;
    } finally {
      if (queues.get(key) === stored) {
        queues.delete(key);
      }
    }
  },

  queueMap(factory: StorageFactory): Map<string | symbol, Promise<void>> {
    let queues = this.queues.get(factory);
    if (queues === undefined) {
      queues = new Map();
      this.queues.set(factory, queues);
    }
    return queues;
  },
});

/**
 * Provider-only coordination access for the Event Store context lock.
 * @internal
 */
export const eventStoreAccess: {
  readonly withLock: <T>(
    factory: StorageFactory,
    context: StorageContext,
    work: () => Promise<T>,
  ) => Promise<T>;
} = Object.freeze({
  // prettier-ignore

  /**
   * Runs work under the same factory/context lock used by direct Event Store appends.
   *
   * @param factory The factory that owns the Event Store records.
   * @param context The Event Store context to serialize.
   * @param work The operation to run while holding the lock.
   * @returns The operation result.
   */
  withLock<T>(
    factory: StorageFactory,
    context: StorageContext,
    work: () => Promise<T>,
  ): Promise<T> {
    return EventStoreLocks.withLock(factory, context, work);
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
   * Atomically inserts each event ID and rolls back this batch on collision.
   */
  async insertUnique(
    storage: RecordStorage<EventId, Event>,
    records: readonly Event[],
  ): Promise<void> {
    if (!storage.atomicCompareAndSet) {
      throw new Error("EventStore requires atomic record compare-and-set.");
    }
    const inserted: { readonly id: EventId; readonly record: Event }[] = [];
    try {
      for (const record of records) {
        const id = EventIds.require(record);
        if (!(await storage.compareAndSet(id, undefined, record))) {
          throw new Error("EventStore requires unique event IDs.");
        }
        inserted.push({ id, record });
      }
    } catch (error) {
      const failures: unknown[] = [];
      for (const { id, record } of inserted.reverse()) {
        try {
          if (!(await storage.compareAndSet(id, record, undefined))) {
            failures.push(new Error("EventStore append rollback lost its stored event."));
          }
        } catch (rollbackError) {
          failures.push(rollbackError);
        }
      }
      if (failures.length > 0) {
        throw new AggregateError([error, ...failures], "EventStore append rollback failed.");
      }
      throw error;
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
  base(context: EventStoreContext): EventStoreContext {
    return context.multitenant
      ? Object.freeze({
          name: context.name,
          multitenant: true,
          ...(context.tenantId === undefined
            ? {}
            : { tenantId: clone(TenantIdSchema, context.tenantId) }),
        })
      : Object.freeze({ name: context.name, multitenant: false });
  },

  snapshot(context: EventStoreContext): StorageContext {
    if (!context.multitenant) return Object.freeze({ name: context.name, multitenant: false });
    if (context.tenantId === undefined)
      throw new Error("Multitenant EventStore reads require a complete tenant ID.");
    const boundary = TenantBoundary.from(context.tenantId);
    const tenantId = boundary.tenantId;
    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId,
    });
  },

  /**
   * Captures one context using an event envelope tenant when present.
   */
  snapshotForEvent(context: EventStoreContext, event: Event): StorageContext {
    if (!context.multitenant) return EventContexts.snapshot(context);
    const tenantId = EventContexts.readEventTenant(event) ?? context.tenantId;
    if (tenantId === undefined)
      throw new Error("Multitenant EventStore append requires an event tenant ID.");
    return EventContexts.snapshot({
      name: context.name,
      multitenant: true,
      tenantId,
    });
  },

  batch(context: EventStoreContext, events: readonly Event[]): StorageContext {
    const first = events[0];
    if (first === undefined) throw new Error("EventStore batch requires at least one event.");
    const selected = EventContexts.snapshotForEvent(context, first);
    const key = TenantBoundary.of(selected).key;
    for (const event of events.slice(1)) {
      if (TenantBoundary.of(EventContexts.snapshotForEvent(context, event)).key !== key)
        throw new Error("One EventStore batch cannot contain events from different tenants.");
    }
    return selected;
  },

  /**
   * Reads an explicit tenant from an event envelope.
   */
  readEventTenant(event: Event): TenantId | undefined {
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
  tenantValue(tenantId: TenantId | undefined): TenantId | undefined {
    return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
  },

  /**
   * Creates a deterministic key for a context-scoped append lock.
   */
  key(context: StorageContext): string | symbol {
    return TenantBoundary.of(context).key;
  },
};

/**
 * Provides the canonical event-store record layout to provider-only internals.
 *
 * @internal
 */
export const eventStoreRecordSpec: RecordSpec<EventId, Event> = new RecordSpec<EventId, Event>({
  recordType: EventSchema,
  idSchema: EventIdSchema,
  extractId: (event) => EventIds.require(event),
  columns: [
    new RecordColumn(
      "created",
      ColumnTypes.message(TimestampSchema),
      (event) => event.context?.timestamp ?? create(TimestampSchema),
    ),
    new RecordColumn(
      "type",
      ColumnTypes.scalar(ScalarType.STRING),
      (event) => event.message?.typeUrl,
    ),
  ],
});
