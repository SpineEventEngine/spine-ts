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

import { clone, create, ScalarType, toBinary } from "@bufbuild/protobuf";
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

const savedEventStores = new WeakMap<
  EventStore,
  {
    readonly context: EventStoreContext;
    readonly factory: StorageFactory;
  }
>();

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
    savedEventStores.set(this, { context: this.#context, factory });
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

  /**
   * Persists one batch only when every original Event ID is available.
   *
   * @param records Original Event envelopes.
   * @param context Captured tenant and Bounded Context.
   * @returns Completion after all unique Events are persisted.
   */
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

  /**
   * Deletes the IDs inserted by a failed legacy batch operation.
   *
   * @param ids IDs inserted by the current batch.
   * @param context Captured tenant and Bounded Context.
   * @returns Completion after those IDs are removed.
   */
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

  /**
   * Checks that no ID in a batch is already stored for this Bounded Context and tenant.
   *
   * @param ids Original Event IDs.
   * @param context Captured tenant and Bounded Context.
   * @returns Completion after duplicate validation.
   */
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

  /**
   * Rejects calls after this Event Store closes.
   */
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

  /**
   * Serializes Event ID checks and insertion for one captured Bounded Context and tenant.
   *
   * @param factory Storage provider used for the Event family.
   * @param context Captured tenant and Bounded Context.
   * @param work Operation run under the Bounded Context and tenant lock.
   * @returns Result returned by the operation.
   * @typeParam T Operation result.
   */
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

  /**
   * Returns the serial queue map for one storage provider.
   *
   * @param factory Storage provider used for the Event family.
   * @returns Bounded Context and tenant queues for this provider.
   */
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
 * Provider-only Event Store coordination bound to a captured Bounded Context and tenant.
 * @internal
 */
interface EventStoreAccess {
  /**
   * Serializes work for one captured storage context.
   *
   * @param factory Storage provider used for the Event family.
   * @param context Captured tenant and Bounded Context.
   * @param work Operation run under the Bounded Context and tenant lock.
   * @returns Result returned by the operation.
   * @typeParam T Result of the serialized operation.
   */
  withLock<T>(factory: StorageFactory, context: StorageContext, work: () => Promise<T>): Promise<T>;

  /**
   * Accepts an original saved Event ID or verifies its exact stored envelope.
   *
   * @param store Event Store with a captured Bounded Context and tenant.
   * @param event Original saved Event envelope.
   * @returns Stored or newly appended original Event.
   */
  appendOrVerifyOriginal(store: EventStore, event: Event): Promise<Event>;
}

/**
 * Exposes captured Event Store coordination to provider and Agent delivery paths.
 * @internal
 */
export const eventStoreAccess: EventStoreAccess = Object.freeze({
  // prettier-ignore

  /**
   * Runs work under the same factory/context lock used by direct Event Store appends.
   *
   * @param factory The factory that owns the Event Store records.
   * @param context The Event Store context to serialize.
   * @param work The operation to run while holding the lock.
   * @returns The operation result.
   * @typeParam T Result returned by the transaction callback.
   */
  withLock<T>(
    factory: StorageFactory,
    context: StorageContext,
    work: () => Promise<T>,
  ): Promise<T> {
    return EventStoreLocks.withLock(factory, context, work);
  },

  /**
   * Reuses one EventStore's captured tenant and Bounded Context for saved-output retry.
   */
  async appendOrVerifyOriginal(store: EventStore, event: Event): Promise<Event> {
    if (!store.isOpen()) throw new Error("EventStore is closed.");
    const binding = savedEventStores.get(store);
    if (binding === undefined)
      throw new Error("Saved Agent Event requires an EventStore instance.");
    const record = clone(EventSchema, event);
    const context = EventContexts.snapshotForEvent(binding.context, record);
    const id = EventIds.require(record);
    await this.withLock(binding.factory, context, async () => {
      const storage = binding.factory.createRecordStorage(context, eventStoreRecordSpec);
      try {
        await SavedEvents.appendOrVerify(storage, id, record);
      } finally {
        storage.close();
      }
    });
    return clone(EventSchema, record);
  },
});

/**
 * Keeps saved-output insert and complete-envelope comparison together.
 */
const SavedEvents = {
  /**
   * Applies atomic insert and compares every original Event byte after a collision.
   * @param event Original event envelope.
   * @param id Complete persisted record identity.
   * @param storage Native record storage for this row.
   * @returns Completion after exact-envelope insertion or verification.
   */
  async appendOrVerify(
    storage: RecordStorage<EventId, Event>,
    id: EventId,
    event: Event,
  ): Promise<void> {
    if (!storage.atomicCompareAndSet)
      throw new Error("Saved Agent Event requires atomic record compare-and-set.");
    try {
      if (await storage.compareAndSet(id, undefined, event)) return;
    } catch (error) {
      const stored = await storage.read(id);
      if (stored !== undefined && this.same(stored, event)) return;
      throw error;
    }
    const stored = await storage.read(id);
    if (stored === undefined || !this.same(stored, event))
      throw new Error("Saved Agent Event ID conflicts with another envelope.");
  },

  /**
   * Compares complete Protobuf envelopes, including unknown fields.
   * @param left First value in the comparison.
   * @param right Second value in the comparison.
   * @returns Whether the two original Event envelopes have identical bytes.
   */
  same(left: Event, right: Event): boolean {
    const a = toBinary(EventSchema, left);
    const b = toBinary(EventSchema, right);
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  },
};

/**
 * Validates event IDs before record-store operations.
 */
const EventIds = {
  // prettier-ignore

  /**
   * Validates an event to have a non-blank ID.
   * @param event Original event envelope.
   * @returns Present value or an error when missing.
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
   * @param ids Original event identities.
   * @param storage Native record storage for this row.
   * @returns Completion after duplicate-ID validation.
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
   * Writes each event ID and rejects the whole batch on collision.
   * @param records Records participating in this operation.
   * @param storage Native record storage for this row.
   * @returns Completion after unique Event IDs are persisted.
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
   * @param ids Original event identities.
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
   * @param context Captured event storage context.
   * @returns Base event storage context.
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

  /**
   * Captures the selected tenant for an Event Store read.
   * @param context Event Store storage context and selected tenant.
   * @returns Immutable storage context for the read.
   */
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
   * @param context Captured event storage context.
   * @param event Original event envelope.
   * @returns Captured storage context for this Event and tenant.
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

  /**
   * Checks every Event in one batch uses the same captured tenant.
   * @param context Event Store storage context before envelope validation.
   * @param events Original Event envelopes in the batch.
   * @returns Immutable storage context shared by every Event in the batch.
   */
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
   * @param event Original event envelope.
   * @returns Tenant encoded in the original Event when present.
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
   * @param tenantId Tenant identifier captured for this operation.
   * @returns Tenant identity when configured.
   */
  tenantValue(tenantId: TenantId | undefined): TenantId | undefined {
    return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
  },

  /**
   * Creates a deterministic key for a context-scoped append lock.
   * @param context Captured event storage context.
   * @returns Complete encoded invocation identity.
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
