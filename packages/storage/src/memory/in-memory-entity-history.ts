import { clone, toBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import { EventSchema } from "@spine-event-engine/proto";

import type {
  EntityEventHistoryPort,
  EntityEventHistoryRecord,
  EntityStateHistoryPort,
  EntityStateHistoryRecord,
} from "../entity/entity-history-storage.js";
import type { EntityRecord, EntityRecordStorage } from "../entity/entity-record.js";
import type { StorageContext } from "../storage/storage.js";
import { StorageScopes } from "../storage/canonical-scope.js";
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
    const scope = StorageScopes.canonical(input.context, input.storageKey);
    const fingerprint = EntitySnapshots.fingerprint(input);
    return InMemoryStorageBackend.bind(
      this.#backend,
      scope,
      fingerprint,
      () =>
        ({
          current: new Map<string, unknown>(),
          events: new Map<string, unknown>(),
          stateQueue: new KeyedSerialQueue(),
          states: new Map<string, unknown>(),
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
  readonly current: MemoryEntityRecordStorage<I, S>;

  /**
   * Provides event-history storage for this entity scope.
   */
  readonly events: MemoryEntityEventHistory<I>;

  /**
   * Provides state-history storage for this entity scope.
   */
  readonly states: InMemoryEntityHistory<I, S>;

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
      extractId: input.extractId,
      stateSchema: input.stateSchema,
      records: backend.current as unknown as Map<string, EntityRecord<I, S>>,
    });
    this.events = new MemoryEntityEventHistory({
      idKey: input.id.key,
      idClone: input.id.clone,
      records: backend.events as unknown as Map<string, EntityEventHistoryRecord<I>>,
    });
    this.states = new InMemoryEntityHistory({
      idKey: input.id.key,
      idClone: input.id.clone,
      stateSchema: input.stateSchema,
      records: backend.states as unknown as Map<string, EntityStateHistoryRecord<I, S>>,
      queue: backend.stateQueue,
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
   * Returns the canonical entity identifier from durable state.
   *
   * @param state Supplies the durable entity state.
   * @returns Returns the state entity identifier.
   */
  readonly extractId: (state: S) => I;

  /**
   * Descriptor-owned declared state columns; lifecycle columns are supplied by storage.
   */
  readonly columns: readonly RecordColumn<S>[];

  /**
   * Names the compatible storage layout.
   */
  readonly layout: string;

  /**
   * Describes the generated entity state message.
   */
  readonly stateSchema: GenMessage<S>;

  /**
   * Names this entity storage scope within its context.
   */
  readonly storageKey: string;
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
   * Stable, validated compatibility identity for this ID representation.
   */
  readonly fingerprint: string;

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
   * The retained diagnostic events keyed by their durable identity.
   */
  readonly events: Map<string, unknown>;

  /**
   * Serializes state-history changes for the same Entity identifier.
   */
  readonly stateQueue: KeyedSerialQueue;

  /**
   * The retained state history keyed by its durable identity.
   */
  readonly states: Map<string, unknown>;
}

/**
 * Captures immutable entity values and their durable identity.
 */
const EntitySnapshots = {
  // prettier-ignore

  /**
   * Derives the compatibility fingerprint for one entity storage input.
   */
  fingerprint<I, S extends Message>(input: EntityStorageInput<I, S>): string {
    if (input.layout.trim().length === 0 || input.id.fingerprint.trim().length === 0) {
      throw new Error("Entity storage requires non-blank layout and ID codec fingerprints.");
    }
    return JSON.stringify({
      id: input.id.fingerprint,
      layout: input.layout,
      columns: input.columns.map((column) => [column.name, column.valueType]),
      state: input.stateSchema.typeName,
    });
  },

  /**
   * Clones one entity ID with the platform structured-clone operation.
   */
  cloneId<I>(id: I): I {
    return storageHost.structuredClone(id);
  },

  /**
   * Copies an immutable latest-state record.
   */
  copyCurrent<I, S extends Message>(
    record: EntityRecord<I, S>,
    schema: GenMessage<S>,
    idClone: (id: I) => I,
  ): EntityRecord<I, S> {
    return { ...record, id: idClone(record.id), state: clone(schema, record.state) };
  },

  /**
   * Copies an immutable state-history record.
   */
  copyState<I, S extends Message>(
    record: EntityStateHistoryRecord<I, S>,
    schema: GenMessage<S>,
    idClone: (id: I) => I,
  ): EntityStateHistoryRecord<I, S> {
    return {
      ...record,
      entityId: idClone(record.entityId),
      state: clone(schema, record.state),
      createdAt: { ...record.createdAt },
    };
  },
};

/**
 * In-memory latest-state storage used by all entity families.
 */
export class MemoryEntityRecordStorage<I, S extends Message> implements EntityRecordStorage<I, S> {
  readonly #idKey: (id: I) => string;
  readonly #idClone: (id: I) => I;
  readonly #records: Map<string, EntityRecord<I, S>>;
  readonly #stateSchema: GenMessage<S>;
  readonly #extractId: (state: S) => I;
  readonly #columns: readonly RecordColumn<S>[];

  /**
   * Creates a current-record adapter over supplied or fresh record storage.
   *
   * @param input Supplies state, ID, column, and record-storage configuration.
   */
  constructor(input: {
    readonly stateSchema: GenMessage<S>;
    readonly idKey: (id: I) => string;
    readonly idClone?: (id: I) => I;
    readonly records?: Map<string, EntityRecord<I, S>>;
    readonly extractId: (state: S) => I;
    readonly columns: readonly RecordColumn<S>[];
  }) {
    this.#idKey = input.idKey;
    this.#idClone = input.idClone ?? ((id) => EntitySnapshots.cloneId(id));
    this.#stateSchema = input.stateSchema;
    this.#records = input.records ?? new Map<string, EntityRecord<I, S>>();
    this.#extractId = input.extractId;
    this.#columns = input.columns;
  }

  /**
   * Reads the current record for one entity identifier.
   *
   * @param id Supplies the entity identifier to read.
   * @returns Resolves to an independent current record, when present.
   */
  read(id: I): Promise<EntityRecord<I, S> | undefined> {
    return Promise.resolve().then(() => {
      const record = this.#records.get(this.#idKey(id));
      return record === undefined
        ? undefined
        : EntitySnapshots.copyCurrent(record, this.#stateSchema, this.#idClone);
    });
  }

  /**
   * Stores an independent copy of one current entity record.
   *
   * @param record Supplies the current record to store.
   * @returns Completes when the record is stored.
   */
  write(record: EntityRecord<I, S>): Promise<void> {
    return Promise.resolve().then(() => {
      if (this.#idKey(record.id) !== this.#idKey(this.#extractId(record.state))) {
        throw new Error("Entity current record ID does not match its state ID.");
      }
      this.#records.set(
        this.#idKey(record.id),
        EntitySnapshots.copyCurrent(record, this.#stateSchema, this.#idClone),
      );
    });
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
    readonly import("../query/query-execution.js").NormalizedQueryEntry<I, EntityRecord<I, S>>[]
  > {
    return Promise.resolve().then(() => {
      StorageQueryPolicy.validate(plan, {
        comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
        features: ["either", "nested", "order", "mask", "limit"],
      });
      const limit = plan.candidateLimit ?? 10_000;
      const candidates: EntityRecord<I, S>[] = [];
      for (const record of this.#records.values()) {
        if (record.deleted) continue;
        candidates.push(record);
        if (candidates.length > limit) break;
      }
      if (candidates.length > limit) {
        throw new Error(`Storage query exceeded the candidate limit of ${String(limit)}.`);
      }
      const entries = candidates.flatMap((record) => {
        const copied = EntitySnapshots.copyCurrent(record, this.#stateSchema, this.#idClone);
        if (this.#idKey(copied.id) !== this.#idKey(this.#extractId(copied.state))) {
          throw new Error("Entity current record ID does not match its state ID.");
        }
        return copied.deleted
          ? []
          : [
              {
                id: copied.id,
                record: copied,
                columns: new Map<string, unknown>([
                  ...this.#columns.map((column): readonly [string, unknown] => [
                    column.name,
                    column.valueIn(copied.state),
                  ]),
                  ["version", copied.version],
                  ["archived", copied.archived],
                  ["deleted", copied.deleted],
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
  readonly #idKey: (id: I) => string;
  readonly #idClone: (id: I) => I;
  readonly #maintenance: InMemoryMaintenance | undefined;
  readonly #records: Map<string, EntityEventHistoryRecord<I>>;
  #open = true;

  /**
   * Creates an event-history adapter over supplied or fresh event storage.
   *
   * @param input Supplies ID, maintenance, and event-storage configuration.
   */
  constructor(input: {
    readonly idKey: (id: I) => string;
    readonly idClone?: (id: I) => I;
    readonly maintenance?: InMemoryMaintenance;
    readonly records?: Map<string, EntityEventHistoryRecord<I>>;
  }) {
    this.#idKey = input.idKey;
    this.#idClone = input.idClone ?? ((id) => EntitySnapshots.cloneId(id));
    this.#maintenance = input.maintenance;
    HistoryLimits.requireBatchSize(input.maintenance?.batchSize);
    this.#records = input.records ?? new Map<string, EntityEventHistoryRecord<I>>();
  }

  /**
   * Stores one immutable event-history record idempotently.
   *
   * @param record Supplies the event-history record to append.
   * @returns Completes when the record is stored.
   */
  append(record: EntityEventHistoryRecord<I>): Promise<void> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      const id = record.event.id?.value;
      if (id === undefined || id.trim().length === 0) {
        throw new Error("Event history requires an event ID.");
      }
      const stored = this.#records.get(id);
      if (stored !== undefined && !HistoryIdentity.sameEvent(stored, record, this.#idKey)) {
        throw new Error("Event-history retry has divergent content.");
      }
      if (stored === undefined) {
        this.#records.set(id, {
          ...record,
          entityId: this.#idClone(record.entityId),
          event: clone(EventSchema, record.event),
          createdAt: { ...record.createdAt },
        });
      }
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
  backward(entityId: I, depth: number, startingFromVersion?: bigint): Promise<readonly Event[]> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      HistoryLimits.requireDepth(depth);
      return Object.freeze(
        [...this.#records.values()]
          .filter((record) => this.#idKey(record.entityId) === this.#idKey(entityId))
          .filter(
            (record) =>
              startingFromVersion === undefined || record.producerVersion < startingFromVersion,
          )
          .sort(
            (left, right) =>
              Number(right.producerVersion - left.producerVersion) ||
              HistoryOrdering.compareTime(right.createdAt, left.createdAt) ||
              CanonicalBytes.compare(HistoryIdentity.eventId(right), HistoryIdentity.eventId(left)),
          )
          .slice(0, depth)
          .map((record) => Object.freeze(clone(EventSchema, record.event))),
      );
    });
  }

  /**
   * Deletes events created before the supplied timestamp in maintenance chunks.
   *
   * @param olderThan Specifies the exclusive event creation-time boundary.
   * @returns Completes when maintenance finishes.
   */
  async truncate(olderThan: Timestamp): Promise<void> {
    this.requireOpen();
    const upperBound = HistorySelection.lastMatchingKey(
      this.#records,
      (record) => HistoryOrdering.compareTime(record.createdAt, olderThan) < 0,
    );
    let after: string | undefined;
    while (this.#open) {
      const selected = HistorySelection.selectKeys(
        this.#records,
        after,
        this.batchSize(),
        (record, key) =>
          (upperBound === undefined || CanonicalBytes.compare(key, upperBound) <= 0) &&
          HistoryOrdering.compareTime(record.createdAt, olderThan) < 0,
      );
      if (selected.length === 0) return;
      for (const key of selected) this.#records.delete(key);
      after = selected.at(-1);
      await this.#maintenance?.onChunk?.();
      this.requireOpen();
    }
  }

  /**
   * Closes this event-history adapter.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Returns whether this event-history adapter remains open.
   *
   * @returns Returns true while the adapter is open.
   */
  isOpen(): boolean {
    return this.#open;
  }
  private requireOpen(): void {
    if (!this.#open) throw new Error("Entity history storage is closed.");
  }
  private batchSize(): number {
    return this.#maintenance?.batchSize ?? MAINTENANCE_BATCH_SIZE;
  }
}

/**
 * In-memory immutable, versioned state-history adapter.
 */
export class InMemoryEntityHistory<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  readonly #idKey: (id: I) => string;
  readonly #idClone: (id: I) => I;
  readonly #records: Map<string, EntityStateHistoryRecord<I, S>>;
  readonly #stateSchema: GenMessage<S>;
  readonly #queue: KeyedSerialQueue;
  #open = true;
  readonly #maintenance: InMemoryMaintenance | undefined;

  /**
   * Creates a state-history adapter over supplied or fresh state storage.
   *
   * @param input Supplies state, ID, maintenance, queue, and record configuration.
   */
  constructor(input: {
    readonly stateSchema: GenMessage<S>;
    readonly idKey: (id: I) => string;
    readonly idClone?: (id: I) => I;
    readonly records?: Map<string, EntityStateHistoryRecord<I, S>>;
    readonly maintenance?: InMemoryMaintenance;
    readonly queue?: KeyedSerialQueue;
  }) {
    this.#idKey = input.idKey;
    this.#idClone = input.idClone ?? ((id) => EntitySnapshots.cloneId(id));
    this.#stateSchema = input.stateSchema;
    this.#records = input.records ?? new Map<string, EntityStateHistoryRecord<I, S>>();
    this.#maintenance = input.maintenance;
    HistoryLimits.requireBatchSize(input.maintenance?.batchSize);
    this.#queue = input.queue ?? new KeyedSerialQueue();
  }

  /**
   * Stores one immutable state-history record idempotently.
   *
   * @param record Supplies the state-history record to append.
   * @returns Completes when the record is stored.
   */
  async append(record: EntityStateHistoryRecord<I, S>): Promise<void> {
    this.requireOpen();
    await this.#queue.run(this.#idKey(record.entityId), () =>
      Promise.resolve().then(() => {
        this.requireOpen();
        const key = this.key(record.entityId, record.version);
        const stored = this.#records.get(key);
        if (stored !== undefined && !HistoryIdentity.sameState(stored, record, this.#stateSchema)) {
          throw new Error("State-history retry has divergent content.");
        }
        if (stored === undefined) {
          this.#records.set(
            key,
            EntitySnapshots.copyState(record, this.#stateSchema, this.#idClone),
          );
        }
      }),
    );
  }

  /**
   * Reads recent state records in descending version order.
   *
   * @param entityId Supplies the entity identifier to inspect.
   * @param depth Limits the number of state records returned.
   * @param startingFromVersion Excludes records at or after this version.
   * @returns Resolves to immutable state-record snapshots.
   */
  backward(
    entityId: I,
    depth: number,
    startingFromVersion?: bigint,
  ): Promise<readonly EntityStateHistoryRecord<I, S>[]> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      HistoryLimits.requireDepth(depth);
      return Object.freeze(
        this.recordsFor(entityId, startingFromVersion)
          .slice(0, depth)
          .map((record) =>
            Object.freeze(EntitySnapshots.copyState(record, this.#stateSchema, this.#idClone)),
          ),
      );
    });
  }

  /**
   * Reads the latest state recorded at or before a timestamp.
   *
   * @param entityId Supplies the entity identifier to inspect.
   * @param time Specifies the inclusive state creation-time boundary.
   * @returns Resolves to an immutable state snapshot, when present.
   */
  stateAt(entityId: I, time: Timestamp): Promise<S | undefined> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      const selected = this.recordsFor(entityId)
        .filter((record) => HistoryOrdering.compareTime(record.createdAt, time) <= 0)
        .sort((left, right) => HistoryOrdering.compareStateAt(left, right))[0];
      return selected === undefined
        ? undefined
        : Object.freeze(clone(this.#stateSchema, selected.state));
    });
  }

  /**
   * Deletes all but the requested number of most recent state records.
   *
   * @param entityId Supplies the entity identifier to trim.
   * @param keepMostRecent Specifies how many recent records to retain.
   * @returns Completes when maintenance finishes.
   */
  async trim(entityId: I, keepMostRecent: number): Promise<void> {
    this.requireOpen();
    if (!Number.isSafeInteger(keepMostRecent) || keepMostRecent < 0) {
      throw new Error("State-history trim count must be a non-negative safe integer.");
    }
    await this.#queue.run(this.#idKey(entityId), async () => {
      this.requireOpen();
      const entityKey = this.#idKey(entityId);
      let deletionsRemaining = 0;
      for (const record of this.#records.values()) {
        if (this.#idKey(record.entityId) === entityKey) deletionsRemaining++;
      }
      deletionsRemaining = Math.max(0, deletionsRemaining - keepMostRecent);
      await this.afterSelection();
      this.requireOpen();
      while (this.#open && deletionsRemaining > 0) {
        const selected = HistorySelection.selectOldestStateKeys(
          this.#records,
          entityKey,
          Math.min(this.batchSize(), deletionsRemaining),
          this.#idKey,
        );
        if (selected.length === 0) return;
        for (const key of selected) this.#records.delete(key);
        deletionsRemaining -= selected.length;
        await this.afterMaintenanceChunk();
      }
    });
  }

  /**
   * Deletes state records created before the supplied timestamp in maintenance chunks.
   *
   * @param olderThan Specifies the exclusive state creation-time boundary.
   * @returns Completes when maintenance finishes.
   */
  async truncate(olderThan: Timestamp): Promise<void> {
    this.requireOpen();
    const upperBound = HistorySelection.lastMatchingKey(
      this.#records,
      (record) => HistoryOrdering.compareTime(record.createdAt, olderThan) < 0,
    );
    await this.afterSelection();
    this.requireOpen();
    let after: string | undefined;
    while (this.#open) {
      const selected = HistorySelection.selectKeys(
        this.#records,
        after,
        this.batchSize(),
        (record, key) =>
          (upperBound === undefined || CanonicalBytes.compare(key, upperBound) <= 0) &&
          HistoryOrdering.compareTime(record.createdAt, olderThan) < 0,
      );
      if (selected.length === 0) return;
      for (const key of selected) this.#records.delete(key);
      after = selected.at(-1);
      await this.afterMaintenanceChunk();
    }
  }

  /**
   * Closes this state-history adapter.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Returns whether this state-history adapter remains open.
   *
   * @returns Returns true while the adapter is open.
   */
  isOpen(): boolean {
    return this.#open;
  }

  private key(entityId: I, version: bigint): string {
    return `${this.#idKey(entityId)}:${String(version)}`;
  }

  private recordsFor(entityId: I, startingFromVersion?: bigint): EntityStateHistoryRecord<I, S>[] {
    const id = this.#idKey(entityId);
    return [...this.#records.values()]
      .filter((record) => this.#idKey(record.entityId) === id)
      .filter((record) => startingFromVersion === undefined || record.version < startingFromVersion)
      .sort((left, right) => HistoryOrdering.compareRecords(left, right));
  }

  private requireOpen(): void {
    if (!this.#open) {
      throw new Error("Entity history storage is closed.");
    }
  }
  private async afterSelection(): Promise<void> {
    await this.#maintenance?.afterSelection?.();
  }

  private async afterMaintenanceChunk(): Promise<void> {
    await this.#maintenance?.onChunk?.();
    if (!this.#open) throw new Error("Entity history storage is closed.");
  }

  private batchSize(): number {
    return this.#maintenance?.batchSize ?? MAINTENANCE_BATCH_SIZE;
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
}

/**
 * Async FIFO mutexes shared by all history handles for one in-memory backend.
 */
class KeyedSerialQueue {
  readonly #tails = new Map<string, Promise<void>>();

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
   * Compares records newest-first by version and timestamp.
   */
  compareRecords<I, S extends Message>(
    left: EntityStateHistoryRecord<I, S>,
    right: EntityStateHistoryRecord<I, S>,
  ): number {
    return (
      Number(right.version - left.version) ||
      HistoryOrdering.compareTime(right.createdAt, left.createdAt)
    );
  },

  /**
   * Compares records for temporal state selection.
   */
  compareStateAt<I, S extends Message>(
    left: EntityStateHistoryRecord<I, S>,
    right: EntityStateHistoryRecord<I, S>,
  ): number {
    return (
      HistoryOrdering.compareTime(right.createdAt, left.createdAt) ||
      Number(right.version - left.version)
    );
  },

  /**
   * Compares timestamps by seconds and nanos.
   */
  compareTime(left: Timestamp, right: Timestamp): number {
    return Number(left.seconds - right.seconds) || left.nanos - right.nanos;
  },
};

/**
 * Compares durable state and event history identities.
 */
const HistoryIdentity = {
  // prettier-ignore

  /**
   * Compares two state-history records by durable state identity.
   */
  sameState<I, S extends Message>(
    left: EntityStateHistoryRecord<I, S>,
    right: EntityStateHistoryRecord<I, S>,
    schema: GenMessage<S>,
  ): boolean {
    return (
      left.version === right.version &&
      HistoryOrdering.compareTime(left.createdAt, right.createdAt) === 0 &&
      CanonicalBytes.equal(toBinary(schema, left.state), toBinary(schema, right.state))
    );
  },

  /**
   * Compares two event-history records by durable event identity.
   */
  sameEvent<I>(
    left: EntityEventHistoryRecord<I>,
    right: EntityEventHistoryRecord<I>,
    idKey: (id: I) => string,
  ): boolean {
    return (
      idKey(left.entityId) === idKey(right.entityId) &&
      left.producerVersion === right.producerVersion &&
      HistoryOrdering.compareTime(left.createdAt, right.createdAt) === 0 &&
      CanonicalBytes.equal(toBinary(EventSchema, left.event), toBinary(EventSchema, right.event))
    );
  },

  /**
   * Returns the event ID used as an event-history tie breaker.
   */
  eventId<I>(record: EntityEventHistoryRecord<I>): string {
    return record.event.id?.value ?? "";
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
};

const MAINTENANCE_BATCH_SIZE = 128;

/**
 * Selects deterministic maintenance batches.
 */
const HistorySelection = {
  selectKeys<T>(
    records: ReadonlyMap<string, T>,
    after: string | undefined,
    batchSize: number,
    matches: (value: T, key: string) => boolean,
  ): string[] {
    const selected: string[] = [];
    let cursor = after;
    while (selected.length < batchSize) {
      let next: string | undefined;
      for (const [key, value] of records) {
        if (
          (cursor === undefined || CanonicalBytes.compare(key, cursor) > 0) &&
          matches(value, key) &&
          (next === undefined || CanonicalBytes.compare(key, next) < 0)
        ) {
          next = key;
        }
      }
      if (next === undefined) return selected;
      selected.push(next);
      cursor = next;
    }
    return selected;
  },

  lastMatchingKey<T>(
    records: ReadonlyMap<string, T>,
    matches: (value: T) => boolean,
  ): string | undefined {
    let last: string | undefined;
    for (const [key, value] of records) {
      if (matches(value) && (last === undefined || CanonicalBytes.compare(key, last) > 0))
        last = key;
    }
    return last;
  },

  selectOldestStateKeys<I, S extends Message>(
    records: ReadonlyMap<string, EntityStateHistoryRecord<I, S>>,
    entityKey: string,
    limit: number,
    idKey: (id: I) => string,
  ): string[] {
    const selected: [string, EntityStateHistoryRecord<I, S>][] = [];
    for (const entry of records) {
      if (idKey(entry[1].entityId) !== entityKey) continue;
      selected.push(entry);
      selected.sort((left, right) => OldestStateOrdering.compare(left, right));
      if (selected.length > limit) selected.pop();
    }
    return selected.map(([key]) => key);
  },
};

/**
 * Orders history records by chronology, version, and stable keys.
 */
const OldestStateOrdering = {
  // prettier-ignore

  /**
   * Compares records oldest-first for bounded maintenance selection.
   */
  compare<I, S extends Message>(
    [leftKey, left]: [string, EntityStateHistoryRecord<I, S>],
    [rightKey, right]: [string, EntityStateHistoryRecord<I, S>],
  ): number {
    return (
      Number(left.version - right.version) ||
      HistoryOrdering.compareTime(left.createdAt, right.createdAt) ||
      CanonicalBytes.compare(leftKey, rightKey)
    );
  },
};

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

  /**
   * Compares strings by canonical UTF-8 bytes.
   */
  compare(left: string, right: string): number {
    const leftBytes = CanonicalBytes.utf8(left);
    const rightBytes = CanonicalBytes.utf8(right);
    const length = Math.min(leftBytes.length, rightBytes.length);
    for (let index = 0; index < length; index++) {
      const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return leftBytes.length - rightBytes.length;
  },

  /**
   * Encodes a string as canonical UTF-8 bytes.
   */
  utf8(value: string): Uint8Array {
    const bytes: number[] = [];
    for (let index = 0; index < value.length; index++) {
      const codePoint = value.codePointAt(index);
      if (codePoint === undefined) continue;
      if (codePoint > 0xffff) index++;
      if (codePoint <= 0x7f) bytes.push(codePoint);
      else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
      else if (codePoint <= 0xffff) {
        bytes.push(
          0xe0 | (codePoint >> 12),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      } else {
        bytes.push(
          0xf0 | (codePoint >> 18),
          0x80 | ((codePoint >> 12) & 0x3f),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        );
      }
    }
    return new Uint8Array(bytes);
  },
};
