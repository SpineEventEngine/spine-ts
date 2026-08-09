import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import { EventSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  EntityStateKeySchema,
  type EntityStateKey,
} from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";

import type {
  EntityEventHistoryPort,
  EntityStateHistoryPort,
} from "../entity/entity-history-storage.js";
import {
  disabledEventHistoryPort,
  disabledStateHistoryPort,
} from "../entity/entity-history-storage.js";
import type { EntityRecordStorage } from "../entity/entity-record.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { RecordEntry } from "../record/record-storage.js";
import type { RecordOrder, RecordQuery } from "../record/record-query.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { StorageContext } from "../storage/storage.js";
import { TenantBoundary } from "../internal/tenancy.js";
import { CanonicalUtf8 } from "./canonical-utf8.js";
import { InMemoryStorageBackend } from "./in-memory-storage-backend.js";
import { RecordColumn } from "../record/record-column.js";
import { StorageQueryEvaluator } from "../query/query-execution.js";
import { StorageQueryPolicy, type NormalizedQueryPlan } from "../query/query-policy.js";

const storageHost = globalThis as typeof globalThis & {
  structuredClone<Value>(value: Value): Value;
};

/**
 * Shared in-memory entity-storage factory for adapter conformance.
 */
export class MemoryEntityStorageFactory {
  readonly #backend: InMemoryStorageBackend;

  /**
   * Creates a factory with a fresh backend, or deliberately shares `backend`.
   *
   * @param backend Supplies the backend to share between factory handles.
   */
  constructor(backend: InMemoryStorageBackend = new InMemoryStorageBackend()) {
    this.#backend = backend;
  }

  /**
   * Creates one scoped entity-storage handle.
   *
   * @param input Supplies the entity storage configuration.
   * @returns Returns the scoped in-memory entity storage.
   */
  create<I, S extends Message>(input: EntityStorageInput<I, S>): InMemoryEntityStorage<I, S> {
    return new InMemoryEntityStorage(input, this.backend(input));
  }

  /**
   * Opens the provider-owned maps used by an atomic in-memory commit.
   *
   * @param input Supplies the Entity storage configuration.
   * @returns The compatible backend maps for this Entity scope.
   */
  backend<I, S extends Message>(input: EntityStorageInput<I, S>): EntityBackend {
    const tenant = TenantBoundary.of(input.context);
    return InMemoryStorageBackend.bind(
      this.#backend,
      "entity",
      tenant,
      input.sourceType.typeName,
      () =>
        ({
          current: new Map<string, unknown>(),
          mutationQueue: new KeyedSerialQueue(),
        }) satisfies EntityBackend,
    );
  }
}

/**
 * One scoped in-memory current/state/event storage handle.
 */
export class InMemoryEntityStorage<I, S extends Message> {
  // prettier-ignore

  /**
   * Provides current-record storage for this entity scope.
   */
  readonly current: MemoryEntityRecordStorage<I>;

  /**
   * Provides event-history storage for this entity scope.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Provides state-history storage for this entity scope.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Creates the current, event, and state storage adapters over `backend`.
   *
   * @param input Supplies the entity storage configuration.
   * @param backend Supplies the scoped in-memory data structures.
   */
  constructor(input: EntityStorageInput<I, S>, backend: EntityBackend) {
    this.current = new MemoryEntityRecordStorage({
      idKey: input.id.key,
      idClone: input.id.clone,
      columns: input.columns,
      unpackId: input.id.unpack,
      records: backend.current as Map<string, EntityRecord>,
      queue: backend.mutationQueue,
    });
    this.events =
      input.eventHistoryStorage === undefined
        ? disabledEventHistoryPort()
        : new MemoryEntityEventHistory({
            id: input.id,
            records: input.eventHistoryStorage,
            queue: backend.mutationQueue,
          });
    this.states =
      input.stateHistoryStorage === undefined
        ? disabledStateHistoryPort()
        : new InMemoryEntityHistory({
            id: input.id,
            records: input.stateHistoryStorage,
            stateSchema: input.stateSchema,
            queue: backend.mutationQueue,
          });
  }

  /**
   * Closes this independently owned provider handle without affecting siblings.
   */
  close(): void {
    this.events.close();
    this.states.close();
  }
}

/**
 * Configures one in-memory entity storage scope.
 */
export interface EntityStorageInput<I, S extends Message> {
  // prettier-ignore

  /**
   * Identifies the storage context for this entity scope.
   */
  readonly context: StorageContext;

  /**
   * Supplies canonicalization and defensive-copy operations for entity IDs.
   */
  readonly id: EntityIdCodec<I>;

  /**
   * Descriptor-owned current-record columns, including lifecycle and state fields.
   */
  readonly columns: readonly RecordColumn<EntityRecord>[];

  /**
   * Declares the provider ID type and current EntityRecord layout.
   */
  readonly recordSpec: RecordSpec<I, EntityRecord>;

  /**
   * Identifies the Entity source type represented by these records.
   */
  readonly sourceType: GenMessage<Message>;

  /**
   * Describes the generated entity state message.
   */
  readonly stateSchema: GenMessage<S>;

  /**
   * Enables grouped retained state history for this Entity storage handle.
   */
  readonly stateHistory?: boolean;

  /**
   * Enables grouped retained diagnostic event history for this Entity storage handle.
   */
  readonly eventHistory?: boolean;

  /**
   * Supplies the enabled grouped state-history storage opened by the outer factory.
   */
  readonly stateHistoryStorage?: RecordStorage<EntityStateKey, EntityRecord>;

  /**
   * Supplies the enabled grouped event-history storage opened by the outer factory.
   */
  readonly eventHistoryStorage?: RecordStorage<import("@spine-event-engine/proto").EventId, Event>;
}

/**
 * Internal provider ID canonicalization and clone contract.
 */
export interface EntityIdCodec<I> {
  // prettier-ignore

  /**
   * Copies an entity identifier before returning it to callers.
   *
   * @param id Supplies the identifier to copy.
   * @returns Returns an independent identifier copy.
   */
  readonly clone: (id: I) => I;

  /**
   * Packs an Entity identifier into the generated persistence envelope.
   *
   * @param id Supplies the Entity identifier to pack.
   * @returns The packed identifier.
   */
  readonly pack: (id: I) => Any;

  /**
   * Unpacks one JVM EntityRecord ID envelope into the Entity identifier.
   *
   * @param id The packed EntityRecord ID.
   * @returns The unpacked entity ID, when it matches the configured schema.
   */
  readonly unpack: (id: NonNullable<EntityRecord["entityId"]>) => I | undefined;

  /**
   * Converts an entity identifier into its storage-map key.
   *
   * @param id Supplies the identifier to canonicalize.
   * @returns Returns the stable storage-map key.
   */
  readonly key: (id: I) => string;
}

/**
 * The shared maps and write queue behind one in-memory Entity storage.
 */
export interface EntityBackend {
  // prettier-ignore

  /**
   * The latest record for each Entity identifier.
   */
  readonly current: Map<string, unknown>;

  /**
   * Serializes mutations for this Entity storage scope.
   */
  readonly mutationQueue: KeyedSerialQueue;
}

/**
 * Identifies the single mutation sequence for one physical Entity storage scope.
 */
export const ENTITY_SCOPE_MUTATION_KEY = "entity-storage-scope";

/**
 * Captures immutable entity values and their durable identity.
 */
const EntitySnapshots = {
  // prettier-ignore

  /**
   * Clones one entity ID with the platform structured-clone operation.
   */
  cloneId<I>(id: I): I {
    return storageHost.structuredClone(id);
  },

  /**
   * Copies an immutable latest-state record.
   */
  copyCurrent(record: EntityRecord): EntityRecord {
    return clone(EntityRecordSchema, record);
  },
};

/**
 * In-memory latest-state storage used by all entity families.
 */
export class MemoryEntityRecordStorage<I> implements EntityRecordStorage<I> {
  readonly #idKey: (id: I) => string;
  readonly #idClone: (id: I) => I;
  readonly #records: Map<string, EntityRecord>;
  readonly #unpackId: (id: NonNullable<EntityRecord["entityId"]>) => I | undefined;
  readonly #columns: readonly RecordColumn<EntityRecord>[];
  readonly #queue: KeyedSerialQueue | undefined;

  /**
   * Creates a current-record adapter over supplied or fresh record storage.
   *
   * @param input Supplies state, ID, column, and record-storage configuration.
   */
  constructor(input: {
    readonly idKey: (id: I) => string;
    readonly idClone?: (id: I) => I;
    readonly records?: Map<string, EntityRecord>;
    readonly unpackId: (id: NonNullable<EntityRecord["entityId"]>) => I | undefined;
    readonly columns: readonly RecordColumn<EntityRecord>[];
    readonly queue?: KeyedSerialQueue;
  }) {
    this.#idKey = input.idKey;
    this.#idClone = input.idClone ?? ((id) => EntitySnapshots.cloneId(id));
    this.#records = input.records ?? new Map<string, EntityRecord>();
    this.#unpackId = input.unpackId;
    this.#columns = input.columns;
    this.#queue = input.queue;
  }

  /**
   * Reads the current record for one entity identifier.
   *
   * @param id Supplies the entity identifier to read.
   * @returns Resolves to an independent current record, when present.
   */
  read(id: I): Promise<EntityRecord | undefined> {
    return Promise.resolve().then(() => {
      const record = this.#records.get(this.#idKey(id));
      return record === undefined ? undefined : EntitySnapshots.copyCurrent(record);
    });
  }

  /**
   * Stores an independent copy of one current entity record.
   *
   * @param record Supplies the current record to store.
   * @returns Completes when the record is stored.
   */
  write(record: EntityRecord): Promise<void> {
    const write = (): Promise<void> => {
      const id = record.entityId === undefined ? undefined : this.#unpackId(record.entityId);
      if (id === undefined)
        throw new Error("Entity current record ID does not match its Entity ID schema.");
      this.#records.set(this.#idKey(id), EntitySnapshots.copyCurrent(record));
      return Promise.resolve();
    };
    return this.#queue === undefined
      ? Promise.resolve().then(write)
      : this.#queue.run(ENTITY_SCOPE_MUTATION_KEY, write);
  }

  /**
   * Returns non-deleted current records matching the normalized plan.
   *
   * @param plan Supplies the normalized record-query plan.
   * @returns Resolves to ordered matching current-record entries.
   */
  query(
    plan: NormalizedQueryPlan<I>,
  ): Promise<
    readonly import("../query/query-execution.js").NormalizedQueryEntry<I, EntityRecord>[]
  > {
    return Promise.resolve().then(() => {
      StorageQueryPolicy.validate(plan, {
        comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
        features: ["either", "nested", "order", "mask", "limit"],
      });
      const limit = plan.candidateLimit ?? 10_000;
      const candidates: EntityRecord[] = [];
      for (const record of this.#records.values()) {
        if (record.lifecycleFlags?.deleted) continue;
        candidates.push(record);
        if (candidates.length > limit) break;
      }
      if (candidates.length > limit) {
        throw new Error(`Storage query exceeded the candidate limit of ${String(limit)}.`);
      }
      const entries = candidates.flatMap((record) => {
        const copied = EntitySnapshots.copyCurrent(record);
        const id = copied.entityId === undefined ? undefined : this.#unpackId(copied.entityId);
        if (id === undefined)
          throw new Error("Entity current record ID does not match its Entity ID schema.");
        return copied.lifecycleFlags?.deleted
          ? []
          : [
              {
                id: this.#idClone(id),
                record: copied,
                columns: new Map<string, unknown>([
                  ...this.#columns.map((column): readonly [string, unknown] => [
                    column.name,
                    column.valueIn(copied),
                  ]),
                ]),
              },
            ];
      });
      return StorageQueryEvaluator.evaluate(entries, plan);
    });
  }
}

/**
 * In-memory immutable diagnostic event-history adapter.
 */
export class MemoryEntityEventHistory<I> implements EntityEventHistoryPort<I> {
  readonly #id: EntityIdCodec<I>;
  readonly #maintenance: InMemoryMaintenance | undefined;
  readonly #records: RecordStorage<import("@spine-event-engine/proto").EventId, Event>;
  readonly #queue: KeyedSerialQueue;

  /**
   * Creates an event-history adapter over grouped generated record storage.
   *
   * @param input Supplies the ID codec, generated record storage, and maintenance seam.
   */
  constructor(input: {
    readonly id: EntityIdCodec<I>;
    readonly records: RecordStorage<import("@spine-event-engine/proto").EventId, Event>;
    readonly maintenance?: InMemoryMaintenance;
    readonly queue?: KeyedSerialQueue;
  }) {
    this.#id = input.id;
    this.#maintenance = input.maintenance;
    HistoryLimits.requireBatchSize(input.maintenance?.batchSize);
    HistoryLimits.requirePageSize(input.maintenance?.pageSize);
    this.#records = input.records;
    this.#queue = input.queue ?? new KeyedSerialQueue();
  }

  /**
   * Stores one immutable event-history record idempotently.
   *
   * @param record Supplies the event-history record to append.
   * @returns Completes when the record is stored.
   */
  async append(record: Event): Promise<void> {
    this.requireOpen();
    await this.#queue.run(ENTITY_SCOPE_MUTATION_KEY, async () => {
      this.requireOpen();
      const storedEvent = this.validatedEvent(record);
      const id = this.eventIdIn(storedEvent);
      const stored = await this.#records.read(id);
      if (
        stored !== undefined &&
        !CanonicalBytes.equal(toBinary(EventSchema, stored), toBinary(EventSchema, storedEvent))
      ) {
        throw new Error("Event-history retry has divergent content.");
      }
      if (stored === undefined) await this.#records.write(storedEvent);
    });
  }

  /**
   * Reads recent events in descending producer-version order.
   *
   * @param entityId Supplies the entity identifier to inspect.
   * @param depth Limits the number of events returned.
   * @param startingFromVersion Excludes events at or after this producer version.
   * @returns Resolves to immutable event snapshots.
   */
  async backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly Event[]> {
    this.requireOpen();
    HistoryLimits.requireDepth(depth);
    const selected: Event[] = [];
    await HistoryPaging.scan(
      this.#records,
      {
        filters: [{ column: "entity_id", value: this.#id.pack(entityId) }],
      },
      [
        { field: "version", direction: "desc" },
        { field: "created", direction: "desc" },
        { field: "id", direction: "desc" },
      ],
      this.pageSize(),
      (record, field) =>
        field === "version" ? record.context?.version?.number : record.context?.timestamp,
      (page) => {
        for (const { record } of page) {
          const version = record.context?.version?.number;
          if (
            startingFromVersion === undefined ||
            (version !== undefined && BigInt(version) < startingFromVersion)
          ) {
            selected.push(record);
            if (selected.length === depth) return false;
          }
        }
        return true;
      },
    );
    return Object.freeze(
      selected
        .sort(
          (left, right) =>
            (right.context?.version?.number ?? 0) - (left.context?.version?.number ?? 0) ||
            HistoryOrdering.compareTime(
              right.context?.timestamp ?? create(TimestampSchema),
              left.context?.timestamp ?? create(TimestampSchema),
            ) ||
            CanonicalUtf8.compare(right.id?.value ?? "", left.id?.value ?? ""),
        )
        .slice(0, depth)
        .map((record) => Object.freeze(clone(EventSchema, record))),
    );
  }

  /**
   * Deletes events created before the supplied timestamp in maintenance chunks.
   *
   * @param olderThan Specifies the exclusive event creation-time boundary.
   * @returns Completes when maintenance finishes.
   */
  async truncate(olderThan: Timestamp): Promise<void> {
    this.requireOpen();
    await this.#queue.run(ENTITY_SCOPE_MUTATION_KEY, async () => {
      await this.afterSelection();
      await HistoryPaging.scan(
        this.#records,
        {},
        [
          { field: "created", direction: "asc" },
          { field: "version", direction: "asc" },
        ],
        this.pageSize(),
        (record, field) =>
          field === "version" ? record.context?.version?.number : record.context?.timestamp,
        async (page) => {
          const selected = page.filter((entry) => {
            const created = entry.record.context?.timestamp;
            return created !== undefined && HistoryOrdering.compareTime(created, olderThan) < 0;
          });
          await this.deleteEntries(selected);
          return selected.length === page.length;
        },
      );
    });
  }

  /**
   * Closes this event-history adapter.
   */
  close(): void {
    this.#records.close();
  }

  /**
   * Returns whether this event-history adapter remains open.
   *
   * @returns Returns true while the adapter is open.
   */
  isOpen(): boolean {
    return this.#records.isOpen();
  }

  private eventIdIn(event: Event): import("@spine-event-engine/proto").EventId {
    if (event.id === undefined || event.id.value.trim().length === 0) {
      throw new Error("Event history requires an event ID.");
    }
    return event.id;
  }

  private producerIdIn(event: Event): I {
    const producerId = event.context?.producerId;
    if (producerId === undefined)
      throw new Error("Event history requires an EventContext producer ID.");
    const entityId = this.#id.unpack(producerId);
    if (entityId === undefined) {
      throw new Error("Event-history producer ID does not match the configured Entity ID schema.");
    }
    return entityId;
  }

  private validatedEvent(event: Event): Event {
    this.eventIdIn(event);
    this.producerIdIn(event);
    const context = event.context;
    if (context?.version === undefined) {
      throw new Error("Event history requires an EventContext version.");
    }
    if (context.timestamp === undefined) {
      throw new Error("Event history requires an EventContext timestamp.");
    }
    const stored = clone(EventSchema, event);
    if (stored.context !== undefined) stored.context.enrichment = undefined;
    return stored;
  }

  private requireOpen(): void {
    if (!this.isOpen()) throw new Error("Entity history storage is closed.");
  }

  private async afterSelection(): Promise<void> {
    await this.#maintenance?.afterSelection?.();
    this.requireOpen();
  }

  private batchSize(): number {
    return this.#maintenance?.batchSize ?? MAINTENANCE_BATCH_SIZE;
  }

  private pageSize(): number {
    return this.#maintenance?.pageSize ?? HISTORY_PAGE_SIZE;
  }

  private async deleteEntries(
    entries: readonly { readonly id: import("@spine-event-engine/proto").EventId }[],
  ): Promise<void> {
    for (let start = 0; start < entries.length; start += this.batchSize()) {
      for (const entry of entries.slice(start, start + this.batchSize()))
        await this.#records.delete(entry.id);
      await this.#maintenance?.onChunk?.();
      this.requireOpen();
    }
  }
}

/**
 * In-memory immutable, versioned state-history adapter.
 */
export class InMemoryEntityHistory<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  readonly #id: EntityIdCodec<I>;
  readonly #records: RecordStorage<EntityStateKey, EntityRecord>;
  readonly #stateSchema: GenMessage<S>;
  readonly #maintenance: InMemoryMaintenance | undefined;
  readonly #queue: KeyedSerialQueue;

  /**
   * Creates a state-history adapter over grouped generated record storage.
   *
   * @param input Supplies the generated record storage, ID codec, state schema, and maintenance seam.
   */
  constructor(input: {
    readonly id: EntityIdCodec<I>;
    readonly records: RecordStorage<EntityStateKey, EntityRecord>;
    readonly stateSchema: GenMessage<S>;
    readonly maintenance?: InMemoryMaintenance;
    readonly queue?: KeyedSerialQueue;
  }) {
    this.#id = input.id;
    this.#records = input.records;
    this.#stateSchema = input.stateSchema;
    this.#maintenance = input.maintenance;
    this.#queue = input.queue ?? new KeyedSerialQueue();
    HistoryLimits.requireBatchSize(input.maintenance?.batchSize);
    HistoryLimits.requirePageSize(input.maintenance?.pageSize);
  }

  /**
   * Stores one generated Entity record in the grouped state history.
   *
   * @param record Supplies the Entity record to append.
   * @returns Completes when the record is stored.
   */
  async append(record: EntityRecord): Promise<void> {
    this.requireOpen();
    this.validateRecord(record);
    await this.#queue.run(ENTITY_SCOPE_MUTATION_KEY, async () => {
      this.requireOpen();
      const key = this.keyFor(record);
      const stored = await this.#records.read(key);
      if (stored !== undefined && !HistoryIdentity.sameEntityRecord(stored, record)) {
        throw new Error("State-history retry has divergent content.");
      }
      if (stored === undefined) await this.#records.write(record);
    });
  }

  /**
   * Reads recent state records in descending version and creation-time order.
   *
   * @param entityId Supplies the entity identifier to inspect.
   * @param depth Limits the number of state records returned.
   * @param startingFromVersion Excludes records at or after this version.
   * @returns Resolves to cloned generated Entity records.
   */
  async backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityRecord[]> {
    this.requireOpen();
    HistoryLimits.requireDepth(depth);
    const selected: EntityRecord[] = [];
    await HistoryPaging.scan(
      this.#records,
      {
        filters: [{ column: "entity_id", value: this.#id.pack(entityId) }],
      },
      [
        { field: "version", direction: "desc" },
        { field: "created", direction: "desc" },
      ],
      this.pageSize(),
      (record, field) => (field === "version" ? record.version?.number : record.version?.timestamp),
      (page) => {
        for (const { record } of page) {
          const version = record.version?.number;
          if (
            startingFromVersion === undefined ||
            version === undefined ||
            BigInt(version) < startingFromVersion
          ) {
            selected.push(record);
            if (selected.length === depth) return false;
          }
        }
        return true;
      },
    );
    return Object.freeze(
      selected.map((record) => Object.freeze(clone(EntityRecordSchema, record))),
    );
  }

  /**
   * Reads the latest retained state at or before a timestamp.
   *
   * @param entityId Supplies the entity identifier to inspect.
   * @param time Specifies the inclusive state creation-time boundary.
   * @returns Resolves to a cloned state, when a compatible record is retained.
   */
  async stateAt(entityId: I, time: Timestamp): Promise<S | undefined> {
    this.requireOpen();
    let selected: EntityRecord | undefined;
    await HistoryPaging.scan(
      this.#records,
      {
        filters: [{ column: "entity_id", value: this.#id.pack(entityId) }],
      },
      [
        { field: "created", direction: "desc" },
        { field: "version", direction: "desc" },
      ],
      this.pageSize(),
      (record, field) => (field === "version" ? record.version?.number : record.version?.timestamp),
      (page) => {
        selected = page
          .map((entry) => entry.record)
          .find((candidate) => {
            const created = candidate.version?.timestamp;
            return created !== undefined && HistoryOrdering.compareTime(created, time) <= 0;
          });
        return selected === undefined;
      },
    );
    return selected === undefined ? undefined : this.unpackState(selected);
  }

  /**
   * Deletes all but the requested number of newest records for one Entity.
   *
   * @param entityId Supplies the entity identifier to trim.
   * @param keepMostRecent Specifies how many newest records to retain.
   * @returns Completes when bounded deletion chunks finish.
   */
  async trim(entityId: I, keepMostRecent: number): Promise<void> {
    this.requireOpen();
    if (!Number.isSafeInteger(keepMostRecent) || keepMostRecent < 0) {
      throw new Error("State-history trim count must be a non-negative safe integer.");
    }
    await this.#queue.run(ENTITY_SCOPE_MUTATION_KEY, async () => {
      let skipped = 0;
      await this.afterSelection();
      await HistoryPaging.scan(
        this.#records,
        { filters: [{ column: "entity_id", value: this.#id.pack(entityId) }] },
        [
          { field: "version", direction: "desc" },
          { field: "created", direction: "desc" },
        ],
        this.pageSize(),
        (record, field) =>
          field === "version" ? record.version?.number : record.version?.timestamp,
        async (page) => {
          const selected = page.slice(Math.max(keepMostRecent - skipped, 0));
          skipped += page.length;
          await this.deleteEntries(selected);
          return true;
        },
      );
    });
  }

  /**
   * Deletes records created before the supplied timestamp.
   *
   * @param olderThan Specifies the exclusive state creation-time boundary.
   * @returns Completes when bounded deletion chunks finish.
   */
  async truncate(olderThan: Timestamp): Promise<void> {
    this.requireOpen();
    await this.#queue.run(ENTITY_SCOPE_MUTATION_KEY, async () => {
      await this.afterSelection();
      await HistoryPaging.scan(
        this.#records,
        {},
        [
          { field: "created", direction: "asc" },
          { field: "version", direction: "asc" },
        ],
        this.pageSize(),
        (record, field) =>
          field === "version" ? record.version?.number : record.version?.timestamp,
        async (page) => {
          const selected = page.filter((entry) => {
            const created = entry.record.version?.timestamp;
            return created !== undefined && HistoryOrdering.compareTime(created, olderThan) < 0;
          });
          await this.deleteEntries(selected);
          return selected.length === page.length;
        },
      );
    });
  }

  /**
   * Closes the grouped record-storage handle.
   */
  close(): void {
    this.#records.close();
  }

  /**
   * Returns whether the grouped record-storage handle remains open.
   *
   * @returns Returns true while the adapter is open.
   */
  isOpen(): boolean {
    return this.#records.isOpen();
  }

  private async deleteEntries(entries: readonly { readonly id: EntityStateKey }[]): Promise<void> {
    for (let start = 0; start < entries.length; start += this.batchSize()) {
      for (const entry of entries.slice(start, start + this.batchSize())) {
        await this.#records.delete(entry.id);
      }
      await this.afterMaintenanceChunk();
    }
  }

  private keyFor(record: EntityRecord): EntityStateKey {
    if (record.entityId === undefined || record.version === undefined) {
      throw new Error("State history requires EntityRecord.entityId and EntityRecord.version.");
    }
    return create(EntityStateKeySchema, {
      entityId: record.entityId,
      version: record.version.number,
    });
  }

  private entityIdIn(record: EntityRecord): I {
    if (record.entityId === undefined) {
      throw new Error("State history requires EntityRecord.entityId.");
    }
    const entityId = this.#id.unpack(record.entityId);
    if (entityId === undefined) {
      throw new Error("State-history record ID does not match the configured Entity ID schema.");
    }
    return entityId;
  }

  private validateRecord(record: EntityRecord): void {
    this.entityIdIn(record);
    if (record.version?.timestamp === undefined) {
      throw new Error(
        "State history requires EntityRecord.version and EntityRecord.version.timestamp.",
      );
    }
    this.unpackState(record);
  }

  private unpackState(record: EntityRecord): S {
    const state = record.state;
    if (!state?.typeUrl.endsWith(`/${this.#stateSchema.typeName}`)) {
      throw new Error(
        "State-history record state does not match the configured Entity state schema.",
      );
    }
    return Object.freeze(fromBinary(this.#stateSchema, state.value));
  }

  private requireOpen(): void {
    if (!this.isOpen()) throw new Error("Entity history storage is closed.");
  }

  private async afterSelection(): Promise<void> {
    await this.#maintenance?.afterSelection?.();
    this.requireOpen();
  }

  private async afterMaintenanceChunk(): Promise<void> {
    await this.#maintenance?.onChunk?.();
    this.requireOpen();
  }

  private batchSize(): number {
    return this.#maintenance?.batchSize ?? MAINTENANCE_BATCH_SIZE;
  }

  private pageSize(): number {
    return this.#maintenance?.pageSize ?? HISTORY_PAGE_SIZE;
  }
}

/**
 * Adapter-internal deterministic maintenance test seam; not a storage API.
 */
export interface InMemoryMaintenance {
  // prettier-ignore

  /**
   * Completes after maintenance selects its fixed deletion boundary.
   *
   * @returns Completes after the test seam finishes.
   */
  readonly afterSelection?: () => void | Promise<void>;

  /**
   * Completes after each maintenance deletion chunk.
   *
   * @returns Completes after the test seam finishes.
   */
  readonly onChunk?: () => void | Promise<void>;

  /**
   * Test-only override for deterministic in-memory maintenance chunking.
   */
  readonly batchSize?: number;

  /**
   * Test-only override for deterministic in-memory history query paging.
   */
  readonly pageSize?: number;
}

/**
 * Async FIFO mutexes shared by all history handles for one in-memory backend.
 */
export class KeyedSerialQueue {
  readonly #tails = new Map<string, Promise<void>>();

  /**
   * Queues an operation after earlier operations with the same key finish.
   *
   * @param key Identifies the serialized operation sequence.
   * @param operation Supplies the operation to run.
   * @returns Resolves to the operation result.
   */
  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key);
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(key, tail);
    if (previous !== undefined) await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

/**
 * Orders history records by chronology, version, and stable keys.
 */
const HistoryOrdering = {
  // prettier-ignore

  /**
   * Compares timestamps by seconds and nanos.
   */
  compareTime(left: Timestamp, right: Timestamp): number {
    return Number(left.seconds - right.seconds) || left.nanos - right.nanos;
  },
};

/**
 * Traverses finite RecordStorage windows with an exact stable keyset continuation.
 */
const HistoryPaging = {
  async scan<I, R extends Message>(
    records: RecordStorage<I, R>,
    query: Omit<RecordQuery<I>, "after" | "limit" | "sort">,
    sort: readonly RecordOrder[],
    pageSize: number,
    valueIn: (record: R, field: string) => unknown,
    visit: (page: readonly RecordEntry<I, R>[]) => boolean | Promise<boolean>,
  ): Promise<void> {
    let after: RecordQuery<I>["after"];
    do {
      const page = await records.queryEntries({
        ...query,
        sort,
        limit: pageSize,
        ...(after === undefined ? {} : { after }),
      });
      const last = page.at(-1);
      after =
        last === undefined
          ? undefined
          : {
              id: last.id,
              values: sort.map((order) => ({
                field: order.field,
                value: order.field === "id" ? last.id : valueIn(last.record, order.field),
              })),
            };
      if (!(await visit(page)) || page.length < pageSize) return;
    } while (after !== undefined);
  },
};

/**
 * Compares generated Entity records by durable binary content.
 */
const HistoryIdentity = {
  // prettier-ignore

  /**
   * Determines whether two generated Entity records have identical binary content.
   */
  sameEntityRecord(left: EntityRecord, right: EntityRecord): boolean {
    return CanonicalBytes.equal(toBinary(EntityRecordSchema, left), toBinary(EntityRecordSchema, right));
  },
};

/**
 * Validates bounded history requests.
 */
const HistoryLimits = {
  requireDepth(depth: number): void {
    if (!Number.isSafeInteger(depth) || depth <= 0) {
      throw new Error("History depth must be a positive safe integer.");
    }
  },

  requireBatchSize(batchSize: number | undefined): void {
    if (batchSize !== undefined && (!Number.isSafeInteger(batchSize) || batchSize <= 0)) {
      throw new Error("In-memory maintenance batch size must be a positive safe integer.");
    }
  },

  requirePageSize(pageSize: number | undefined): void {
    if (pageSize !== undefined && (!Number.isSafeInteger(pageSize) || pageSize <= 0)) {
      throw new Error("In-memory history page size must be a positive safe integer.");
    }
  },
};

const MAINTENANCE_BATCH_SIZE = 128;
const HISTORY_PAGE_SIZE = 10_000;

/**
 * Orders canonical UTF-8 values and compares durable bytes.
 */
const CanonicalBytes = {
  // prettier-ignore

  /**
   * Compares two durable byte sequences.
   */
  equal(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  },
};
