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

import { clone, create, equals, ScalarType } from "@bufbuild/protobuf";
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
 * Snapshots input Events and rejects missing, blank, or repeated IDs within a
 * batch. Immutable append accepts identical complete stored Events and leaves
 * completed prefixes when a later insert fails. Admission methods reject every
 * existing ID, including an identical Event.
 */
export class EventStore {
  /**
   * Selected Event Store context.
   */
  readonly #context: EventStoreContext;

  /**
   * Opens Event record-family handles.
   */
  readonly #factory: StorageFactory;

  /**
   * Whether this Event Store accepts operations.
   */
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
   * Validates strict new admission without storing an Event. An identical
   * existing Event still rejects; this precheck does not reserve its ID.
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
   * Checks strict new admission, runs caller acceptance, then atomically inserts
   * under one captured context. Competing callbacks may both run, but only one
   * absent-slot insertion can succeed.
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
   * Writes one complete Event, accepting an identical immutable retry without
   * overwriting it. A conflicting Event at the same ID rejects.
   *
   * @param event Supplies the event to append.
   * @returns Completes when the event is appended.
   */
  async append(event: Event): Promise<void> {
    const record = clone(EventSchema, event);

    await this.appendImmutable([record], EventContexts.snapshotForEvent(this.#context, record));
  }

  /**
   * Writes generated Events in order, accepting identical immutable retries.
   * A later failure retains the completed prefix for retry with the same IDs.
   *
   * @param events Supplies the events to append.
   * @returns Completes when the events are appended.
   */
  async appendAll(events: Iterable<Event>): Promise<void> {
    const records = [...events].map((event) => clone(EventSchema, event));

    if (records.length > 0) {
      await this.appendImmutable(records, EventContexts.batch(this.#context, records));
    }
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
   * Writes strictly new Events after caller acceptance.
   *
   * @param records Supplies validated Event snapshots.
   * @param context Selects their storage boundary.
   * @returns Completion after every strict insertion.
   */
  private async appendUnique(records: readonly Event[], context: StorageContext): Promise<void> {
    this.requireOpen();
    const ids = records.map((record) => EventIds.require(record));
    EventIds.rejectDuplicates(ids);

    const storage = this.#factory.createRecordStorage(context, eventStoreRecordSpec);
    try {
      await EventIds.insertUnique(storage, records);
    } finally {
      storage.close();
    }
  }

  /**
   * Writes captured immutable Events, accepting identical stored retries.
   *
   * @param records Supplies ordered Event snapshots.
   * @param context Selects their single storage boundary.
   * @returns Completion after every immutable Event is confirmed.
   */
  private async appendImmutable(records: readonly Event[], context: StorageContext): Promise<void> {
    this.requireOpen();
    EventIds.rejectDuplicates(records.map((record) => EventIds.require(record)));
    const storage = this.#factory.createRecordStorage(context, eventStoreRecordSpec);
    try {
      await EventIds.insertImmutable(storage, records);
    } finally {
      storage.close();
    }
  }

  /**
   * Checks strict admission without writing an Event.
   *
   * @param ids Supplies IDs that must be absent.
   * @param context Selects the storage boundary.
   * @returns Completion when no ID is stored.
   */
  private async checkUnique(ids: readonly EventId[], context: StorageContext): Promise<void> {
    this.requireOpen();
    EventIds.rejectDuplicates(ids);

    const storage = this.#factory.createRecordStorage(context, eventStoreRecordSpec);
    try {
      await EventIds.rejectStored(storage, ids);
    } finally {
      storage.close();
    }
  }

  /**
   * Rejects operations after this Event Store closes.
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
 * Validates event IDs before record-store operations.
 */
const EventIds = {
  // prettier-ignore

  /**
   * Validates that an Event has a non-blank ID.
   *
   * @param event Supplies the Event envelope.
   * @returns Its validated ID.
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
   *
   * @param storage Reads existing Events.
   * @param ids Supplies IDs that must be absent.
   * @returns Completion when no ID exists.
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
   * Writes each strictly new Event, retaining a completed prefix on failure.
   *
   * @param storage Supplies atomic record insertion.
   * @param records Supplies accepted Event snapshots.
   * @returns Completion after every new Event is stored.
   */
  async insertUnique(
    storage: RecordStorage<EventId, Event>,
    records: readonly Event[],
  ): Promise<void> {
    if (!storage.atomicCompareAndSet) {
      throw new Error("EventStore requires atomic record compare-and-set.");
    }
    for (const record of records) {
      const id = EventIds.require(record);
      if (!(await storage.compareAndSet(id, undefined, record))) {
        throw new Error("EventStore requires unique event IDs.");
      }
    }
  },

  /**
   * Writes immutable Events or confirms complete equality at the same ID.
   *
   * @param storage Supplies atomic single-record insertion and reads.
   * @param records Supplies ordered Event snapshots.
   * @returns Completion after each Event is present unchanged.
   */
  async insertImmutable(
    storage: RecordStorage<EventId, Event>,
    records: readonly Event[],
  ): Promise<void> {
    if (!storage.atomicCompareAndSet)
      throw new Error("EventStore requires atomic record compare-and-set.");
    for (const record of records) {
      const id = EventIds.require(record);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await storage.compareAndSet(id, undefined, record)) break;
        const stored = await storage.read(id);
        if (stored !== undefined) {
          if (!equals(EventSchema, stored, record))
            throw new Error("EventStore requires unique event IDs.");
          break;
        }
        if (attempt === 1) throw new Error("EventStore immutable insert could not confirm its ID.");
      }
    }
  },

  /**
   * Rejects repeated IDs within one append operation.
   *
   * @param ids Supplies the IDs in the operation.
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
 * Captures tenant-aware event-store contexts.
 */
const EventContexts = {
  // prettier-ignore

  /**
   * Captures one storage context.
   *
   * @param context Supplies context and optional default tenant.
   * @returns An immutable context snapshot.
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
   * Returns a complete storage context for a read.
   *
   * @param context Supplies an explicit default tenant when required.
   * @returns A complete tenant-scoped storage context.
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
   *
   * @param context Supplies the Event Store default boundary.
   * @param event Supplies an optional envelope tenant.
   * @returns The Event's complete storage context.
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
   * Returns one tenant boundary for every Event in a batch.
   *
   * @param context Supplies the Event Store default boundary.
   * @param events Supplies the complete Event batch.
   * @returns Their shared storage context.
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
   *
   * @param event Supplies the envelope origin.
   * @returns Its tenant when present.
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
   *
   * @param tenantId Supplies the optional tenant ID.
   * @returns An independent tenant ID when present.
   */
  tenantValue(tenantId: TenantId | undefined): TenantId | undefined {
    return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
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
