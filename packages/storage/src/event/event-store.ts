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

import { createHash } from "node:crypto";
import { clone, create, equals, ScalarType } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Event, EventId, TenantId } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";

import { RecordColumn } from "../record/record-column.js";
import { ColumnTypes } from "../record/column-type.js";
import type { RecordQuery } from "../record/record-query.js";
import { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import { StorageGroup } from "../record/storage-group.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageFactory } from "../storage/storage-factory.js";
import { TenantBoundary } from "../internal/tenancy.js";

const idleClosers = new WeakMap<EventStore, () => void>();

/**
 * Stable physical Event record family for one logical context and store role.
 */
export const EventStoreGroups: Readonly<{
  forContext(contextName: string, role?: "domain" | "system"): StorageGroup;
}> = Object.freeze({
  /**
   * Derives the portable group name from the exact context name and role.
   *
   * @param contextName Framework-validated logical context name.
   * @param role Domain or paired System Event store.
   * @returns Stable physical Event family selector.
   */
  forContext(contextName: string, role: "domain" | "system" = "domain"): StorageGroup {
    const logical = JSON.stringify(["spine.EventStoreGroup/v1", role, contextName]);
    const digest = createHash("sha256").update(logical, "utf8").digest("hex");
    return new StorageGroup(`es_${BigInt(`0x${digest}`).toString(36).padStart(50, "0")}`);
  },
});

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
   * Record family selected by the logical context and store role.
   */
  readonly #group: StorageGroup | undefined;

  /**
   * Retains one record storage per complete tenant boundary.
   */
  readonly #storages = new Map<string | symbol, RecordStorage<EventId, Event>>();

  /**
   * Tracks admitted physical storage groups until their complete operation settles.
   */
  readonly #active = new Set<Promise<unknown>>();

  /**
   * Reuses one asynchronous close result across repeated calls.
   */
  #closing: Promise<void> | undefined;

  /**
   * Retains the terminal result of synchronous assembly cleanup.
   */
  #idleOutcome: { error?: Error } | undefined;

  /**
   * Whether this Event Store accepts operations.
   */
  #open = true;

  /**
   * Creates an event store for one storage context.
   *
   * @param context Specifies the storage context.
   * @param factory Creates the backing record storage.
   * @param group Selects a separate Event record family when supplied.
   */
  constructor(context: EventStoreContext, factory: StorageFactory, group?: StorageGroup) {
    this.#context = EventContexts.base(context);
    this.#factory = factory;
    this.#group = group ?? EventStoreGroups.forContext(this.#context.name);
    idleClosers.set(this, () => {
      this.#closeIdle();
    });
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
   * Rejects new work, drains admitted storage groups, and closes retained handles.
   * Repeated calls return the same close result.
   *
   * @returns Completion after all admitted work and storage cleanup settle.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    if (this.#idleOutcome !== undefined) {
      const error = this.#idleOutcome.error;
      return error === undefined ? Promise.resolve() : Promise.reject(error);
    }
    this.#open = false;
    this.#closing = this.drainAndClose();
    return this.#closing;
  }

  /**
   * Closes an idle store during synchronous assembly cleanup.
   * Active storage work is a misuse and leaves all handles open.
   *
   */
  #closeIdle(): void {
    if (this.#active.size > 0 || (this.#closing !== undefined && this.#idleOutcome === undefined))
      throw new Error("EventStore closeIdle requires no active storage work.");
    if (this.#idleOutcome !== undefined) {
      if (this.#idleOutcome.error !== undefined) throw this.#idleOutcome.error;
      return;
    }
    this.#open = false;
    try {
      this.closeStorages();
      this.#idleOutcome = {};
    } catch (error) {
      this.#idleOutcome = { error: error as Error };
      throw error;
    }
  }

  /**
   * Waits for admitted physical work and then closes every retained handle.
   *
   * @returns Completion after admitted work and cleanup settle.
   */
  private async drainAndClose(): Promise<void> {
    await Promise.allSettled([...this.#active]);
    try {
      this.closeStorages();
      this.#idleOutcome = {};
    } catch (error) {
      this.#idleOutcome = { error: error as Error };
      throw error;
    }
  }

  /**
   * Closes every retained handle and reports all cleanup failures.
   */
  private closeStorages(): void {
    const storages = [...this.#storages.values()];
    this.#storages.clear();
    const errors: unknown[] = [];
    for (const storage of storages) {
      try {
        storage.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "EventStore close failed.");
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
    this.requireOpen();
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
    return this.runStorage(EventContexts.snapshot(this.#context), (storage) =>
      storage.query(query),
    );
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

    await this.runStorage(context, (storage) => EventIds.insertUnique(storage, records));
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
    await this.runStorage(context, (storage) => EventIds.insertImmutable(storage, records));
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

    await this.runStorage(context, (storage) => EventIds.rejectStored(storage, ids));
  }

  /**
   * Executes one complete physical storage operation through settlement.
   *
   * @typeParam T Operation result type.
   * @param context Captured tenant scope.
   * @param onStorage Work admitted against the retained handle.
   * @returns The operation result or its original failure.
   */
  private async runStorage<T>(
    context: StorageContext,
    onStorage: (storage: RecordStorage<EventId, Event>) => Promise<T>,
  ): Promise<T> {
    const storage = this.storageFor(context);
    const work = Promise.resolve().then(() => onStorage(storage));
    this.#active.add(work);
    try {
      return await work;
    } finally {
      this.#active.delete(work);
    }
  }

  /**
   * Returns retained record storage for the captured tenant boundary.
   *
   * @param context Complete tenant-scoped storage context.
   * @returns The retained record storage.
   */
  private storageFor(context: StorageContext): RecordStorage<EventId, Event> {
    this.requireOpen();
    const key = TenantBoundary.of(context).key;
    const existing = this.#storages.get(key);
    if (existing !== undefined) return existing;
    const storage = this.#factory.createRecordStorage(context, eventStoreRecordSpec, this.#group);
    this.#storages.set(key, storage);
    return storage;
  }

  /**
   * Rejects operations after this Event Store closes.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("EventStore is closed.");
  }
}

/**
 * Gives server assembly access to synchronous idle cleanup through the provider entrypoint.
 * @internal
 */
export const eventStoreAccess = {
  /**
   * Closes an idle Event Store during synchronous assembly rollback.
   *
   * @param store Framework Event Store to close.
   */
  closeIdle(store: EventStore): void {
    const close = idleClosers.get(store);
    if (close === undefined) throw new TypeError("EventStore idle cleanup requires an EventStore.");
    close();
  },
};

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
