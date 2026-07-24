import { clone, create, fromBinary, toBinary, type MessageShape } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, unpackAny, type MessageSchema } from "@spine-event-engine/core";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import {
  EventStore,
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";

import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import type { EntityLifecycleFlags } from "../entity/entity.js";
import { MessageIds, PrimitiveIds, type MessageId, type PrimitiveId } from "./primitive-id.js";

/**
 * Small aggregate history store over snapshots and events.
 *
 * Snapshots are stored as internal records. Events are appended through the
 * storage event store and loaded by aggregate ID using producer-ID or
 * first-field routing. Appends reject events that do not route to the supplied
 * aggregate ID and reject missing, duplicate, or non-increasing versions before
 * storing anything.
 */
export class AggregateStorage<
  Schema extends DescriptorMessageSchema,
  Id extends AggregateId = string,
> {
  readonly #context: StorageContext;
  readonly #eventSchemas: readonly MessageSchema[];
  readonly #storageFactory: StorageFactory;
  readonly #stateSchema: Schema;
  readonly #stateTypeUrl: string;

  /** Open aggregate storage from a context, storage factory, and state schema. */
  constructor(options: AggregateStorageOptions<Schema>) {
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    this.#stateSchema = options.stateSchema;
    this.#stateTypeUrl = deriveTypeUrl(options.stateSchema);
    this.#eventSchemas = Object.freeze([...(options.eventSchemas ?? [])]);
  }

  /** Append aggregate events in strictly increasing aggregate-version order. */
  async appendEvents(aggregateId: Id, events: Iterable<Event>): Promise<void> {
    const context = snapshotStorageContext(this.#context);
    const batch = Object.freeze([...events].map((event) => clone(EventSchema, event)));
    const key = aggregateLockKey(context, requireAggregateId(aggregateId));

    await AggregateStorageLocks.withLock(this.#storageFactory, key, () =>
      this.#appendEventBatch(context, aggregateId, batch),
    );
  }

  /** Store a managed aggregate snapshot and events after validating the event batch. */
  async writeSnapshotWithEvents(
    snapshot: AggregateSnapshot<Schema, Id>,
    events: Iterable<Event>,
  ): Promise<void> {
    const context = snapshotStorageContext(this.#context);
    const aggregateId = snapshot.aggregateId;
    const batch = Object.freeze([...events].map((event) => clone(EventSchema, event)));
    const key = aggregateLockKey(context, requireAggregateId(aggregateId));

    await AggregateStorageLocks.withLock(this.#storageFactory, key, () =>
      this.#writeManagedBatch(context, snapshot, batch),
    );
  }

  async #appendEventBatch(
    context: StorageContext,
    aggregateId: Id,
    batch: readonly Event[],
  ): Promise<void> {
    const storedEvents = await this.#readAggregateEvents(context, aggregateId);
    const eventStore = this.#eventStore(context);

    try {
      rejectConsecutiveVersions(storedEvents, 1n);
      const eventIds = new Set((await eventStore.read()).map((event) => requireEventId(event)));
      this.#validateBatch(aggregateId, batch, storedEvents.at(-1)?.version ?? 0n, eventIds);
      await eventStore.appendAll(batch);
    } finally {
      eventStore.close();
    }
  }

  async #writeManagedBatch(
    context: StorageContext,
    snapshot: AggregateSnapshot<Schema, Id>,
    batch: readonly Event[],
  ): Promise<void> {
    const aggregateId = snapshot.aggregateId;
    const storedEvents = await this.#readAggregateEvents(context, aggregateId);
    const eventStore = this.#eventStore(context);

    try {
      const eventIds = new Set((await eventStore.read()).map((event) => requireEventId(event)));
      this.#validateManagedBatch(
        aggregateId,
        batch,
        snapshot.version,
        storedEvents.at(-1)?.version ?? 0n,
        eventIds,
      );
      const rollback = await eventStore.appendAllWithRollback(batch);
      try {
        await this.#writeSnapshot(context, snapshot, aggregateId);
      } catch (error) {
        await this.#rollbackEvents(rollback, error);
      }
    } finally {
      eventStore.close();
    }
  }

  async #rollbackEvents(
    rollback: { rollback(): Promise<void> },
    snapshotError: unknown,
  ): Promise<never> {
    try {
      await rollback.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [snapshotError, rollbackError],
        "Managed aggregate persistence failed and event rollback failed.",
      );
    }
    throw snapshotError;
  }

  #validateManagedBatch(
    aggregateId: Id,
    batch: readonly Event[],
    snapshotVersion: bigint,
    lastStoredVersion: bigint,
    eventIds: Set<string>,
  ): void {
    if (snapshotVersion !== lastStoredVersion + 1n) {
      throw new Error("Managed aggregate snapshots must advance by one dispatch version.");
    }
    for (const event of batch) {
      this.#acceptEventId(event, eventIds);
      this.#acceptEventRoute(event, aggregateId);
      if (requireEventVersion(event) !== snapshotVersion) {
        throw new Error("Managed aggregate events must use the snapshot dispatch version.");
      }
    }
  }

  #validateBatch(
    aggregateId: Id,
    batch: readonly Event[],
    lastStoredVersion: bigint,
    eventIds: Set<string>,
  ): void {
    let lastVersion = lastStoredVersion;
    for (const event of batch) {
      this.#acceptEventId(event, eventIds);
      this.#acceptEventRoute(event, aggregateId);
      lastVersion = this.#acceptEventVersion(event, lastVersion);
    }
  }

  #acceptEventId(event: Event, eventIds: Set<string>): void {
    const eventId = requireEventId(event);
    if (eventIds.has(eventId)) {
      throw new Error("Aggregate event IDs must be unique before append.");
    }
    eventIds.add(eventId);
  }

  #acceptEventRoute(event: Event, aggregateId: Id): void {
    const eventAggregateId = this.#eventAggregateId(event);
    if (eventAggregateId === undefined || !sameAggregateId(eventAggregateId, aggregateId)) {
      throw new Error("Aggregate events must all route to the same aggregate ID before append.");
    }
  }

  #acceptEventVersion(event: Event, lastVersion: bigint): bigint {
    const version = requireEventVersion(event);
    if (version !== lastVersion + 1n) {
      throw new Error("Aggregate event versions must be strictly increasing and consecutive.");
    }
    return version;
  }

  /** Store or replace the latest snapshot for one aggregate. */
  async writeSnapshot(snapshot: AggregateSnapshot<Schema, Id>): Promise<void> {
    const aggregateId = requireAggregateId(snapshot.aggregateId);
    await this.#writeSnapshot(snapshotStorageContext(this.#context), snapshot, aggregateId);
  }

  async #writeSnapshot(
    context: StorageContext,
    snapshot: AggregateSnapshot<Schema, Id>,
    aggregateId: AggregateId,
  ): Promise<void> {
    this.#validateSnapshot(aggregateId, snapshot.state, snapshot.version);
    const storage = this.#snapshotStorage(context);

    try {
      await storage.write(
        createSnapshotRecord({
          aggregateId,
          stateTypeUrl: this.#stateTypeUrl,
          state: toBinary(this.#stateSchema, snapshot.state, { writeUnknownFields: false }),
          version: snapshot.version,
          archived: snapshot.lifecycle.archived,
          deleted: snapshot.lifecycle.deleted,
        }),
      );
    } finally {
      storage.close();
    }
  }

  /** Read latest snapshot and the events after it for one aggregate. */
  async readHistory(aggregateId: Id): Promise<AggregateHistory<Schema, Id>> {
    requireAggregateId(aggregateId);
    const context = snapshotStorageContext(this.#context);
    const snapshot = await this.#readSnapshot(context, aggregateId);
    const snapshotVersion = snapshot?.version ?? -1n;
    const tail = (await this.#readAggregateEvents(context, aggregateId)).filter(
      ({ version }) => version > snapshotVersion,
    );
    rejectConsecutiveVersions(tail, snapshot === undefined ? 1n : snapshot.version + 1n);
    const events = tail.map(({ event }) => event);

    return Object.freeze({
      snapshot,
      events: Object.freeze(events),
    });
  }

  async #readSnapshot(
    context: StorageContext,
    aggregateId: Id,
  ): Promise<AggregateSnapshot<Schema, Id> | undefined> {
    const storage = this.#snapshotStorage(context);
    let record: SnapshotRecord | undefined;
    try {
      record = await storage.read(aggregateId);
    } finally {
      storage.close();
    }

    if (record === undefined) {
      return undefined;
    }

    const payload = readSnapshotRecord(record);
    if (!sameSnapshotId(payload.aggregateId, aggregateId)) {
      throw new Error(
        `Aggregate snapshot for "${formatAggregateId(aggregateId)}" has an unexpected ID.`,
      );
    }
    if (payload.stateTypeUrl !== this.#stateTypeUrl) {
      throw new Error(
        `Aggregate snapshot for "${formatAggregateId(aggregateId)}" has an unexpected state type.`,
      );
    }
    if (payload.version <= 0n) {
      throw new Error(
        `Aggregate snapshot for "${formatAggregateId(aggregateId)}" must have a positive version.`,
      );
    }

    const state = fromBinary(this.#stateSchema, payload.state);
    this.#validateSnapshot(payload.aggregateId as Id, state, payload.version);

    return Object.freeze({
      aggregateId: payload.aggregateId as Id,
      state,
      version: payload.version,
      lifecycle: Object.freeze({
        archived: payload.archived,
        deleted: payload.deleted,
      }),
    });
  }

  async #readAggregateEvents(
    context: StorageContext,
    aggregateId: Id,
  ): Promise<readonly VersionedEvent[]> {
    const expectedId = requireAggregateId(aggregateId);
    const events: VersionedEvent[] = [];
    const eventStore = this.#eventStore(context);

    try {
      for (const event of await eventStore.read()) {
        if (event.context?.rejection !== undefined) {
          continue;
        }
        const eventAggregateId = this.#eventAggregateId(event);
        if (eventAggregateId === undefined || !sameAggregateId(eventAggregateId, expectedId)) {
          continue;
        }

        const version = requireEventVersion(event);
        requireEventId(event);
        events.push(Object.freeze({ event, version }));
      }
    } finally {
      eventStore.close();
    }

    events.sort((left, right) => compareVersions(left.version, right.version));
    rejectDuplicateEventIds(events);
    return Object.freeze(events);
  }

  #eventStore(context: StorageContext): EventStore {
    return new EventStore(context, this.#storageFactory);
  }

  #snapshotStorage(context: StorageContext): RecordStorage<Id, SnapshotRecord> {
    return this.#storageFactory.createRecordStorage(context, snapshotRecordSpec<Id>());
  }

  #eventAggregateId(event: Event): AggregateId | undefined {
    const producerId = this.#producerId(event);
    const payloadId = this.#payloadId(event);

    if (
      producerId !== undefined &&
      payloadId !== undefined &&
      !sameAggregateId(producerId, payloadId)
    ) {
      throw new Error(
        "Aggregate event producer ID and payload ID must identify the same aggregate ID.",
      );
    }

    return producerId ?? payloadId;
  }

  #producerId(event: Event): AggregateId | undefined {
    const producerId = event.context?.producerId;
    if (producerId !== undefined) {
      const unpacked = PrimitiveIds.unpack(producerId);
      if (unpacked !== undefined) {
        return unpacked;
      }
      throw new Error("Aggregate event routing requires a readable producer ID.");
    }

    return undefined;
  }

  #payloadId(event: Event): AggregateId | undefined {
    const message = event.message;
    if (message === undefined) {
      return undefined;
    }

    for (const schema of this.#eventSchemas) {
      if (message.typeUrl !== deriveTypeUrl(schema)) {
        continue;
      }
      const unpacked = unpackAny(message, schema);
      const firstField = schema.fields[0];
      if (unpacked !== undefined && firstField !== undefined) {
        const value = (unpacked as Record<string, unknown>)[firstField.localName];
        return readAggregateId(value);
      }
    }

    return undefined;
  }

  #stateId(state: MessageShape<Schema>): AggregateId | undefined {
    const firstField = this.#stateSchema.fields[0];
    if (firstField === undefined) {
      return undefined;
    }
    return readAggregateId((state as Record<string, unknown>)[firstField.localName]);
  }

  #validateSnapshot(aggregateId: AggregateId, state: MessageShape<Schema>, version: bigint): void {
    if (version <= 0n) {
      throw new Error(
        `Aggregate snapshot for "${formatAggregateId(aggregateId)}" must have a positive version.`,
      );
    }

    const stateId = this.#stateId(state);
    if (!sameAggregateId(stateId, aggregateId)) {
      throw new Error(
        `Aggregate snapshot for "${formatAggregateId(aggregateId)}" has an unexpected state ID.`,
      );
    }
  }
}

type SnapshotRecord = Any;

/** Options for opening aggregate snapshot and event storage. */
export interface AggregateStorageOptions<Schema extends DescriptorMessageSchema> {
  /** Storage context that scopes aggregate records. */
  readonly context: StorageContext;
  /** Storage factory used to open snapshot record storage and event storage. */
  readonly storageFactory: StorageFactory;
  /** Generated state schema stored in aggregate snapshots. */
  readonly stateSchema: Schema;
  /** Generated event schemas used for first-field aggregate event routing. */
  readonly eventSchemas?: readonly MessageSchema[];
}

/** Snapshot persisted for one aggregate. */
export interface AggregateSnapshot<
  Schema extends DescriptorMessageSchema,
  Id extends AggregateId = string,
> {
  /** Aggregate identifier. */
  readonly aggregateId: Id;
  /** Aggregate state restored from the snapshot. */
  readonly state: MessageShape<Schema>;
  /** Aggregate version captured by the snapshot. */
  readonly version: bigint;
  /** Lifecycle flags captured by the snapshot. */
  readonly lifecycle: EntityLifecycleFlags;
}

/** Aggregate history loaded from storage. */
export interface AggregateHistory<
  Schema extends DescriptorMessageSchema,
  Id extends AggregateId = string,
> {
  /** Latest snapshot, when one has been stored. */
  readonly snapshot: AggregateSnapshot<Schema, Id> | undefined;
  /** Events after the snapshot version, or all events when no snapshot exists. */
  readonly events: readonly Event[];
}

interface SnapshotRecordPayload<Id = unknown> {
  readonly aggregateId: Id;
  readonly stateTypeUrl: string;
  readonly state: Uint8Array;
  readonly version: bigint;
  readonly archived: boolean;
  readonly deleted: boolean;
}

interface EncodedSnapshotRecordPayload {
  readonly aggregateId: unknown;
  readonly stateTypeUrl: string;
  readonly stateBase64: string;
  readonly version: string;
  readonly archived: boolean;
  readonly deleted: boolean;
}

interface VersionedEvent {
  readonly event: Event;
  readonly version: bigint;
}

/** Aggregate identifier supported by aggregate history storage. */
export type AggregateId = PrimitiveId | MessageId;

const snapshotRecordTypeUrl = "type.spine-ts.dev/internal/AggregateSnapshotRecord";

const AggregateStorageLocks = Object.freeze({
  queues: new WeakMap<StorageFactory, Map<string, Promise<void>>>(),

  async withLock(factory: StorageFactory, key: string, work: () => Promise<void>): Promise<void> {
    const queues = this.queueMap(factory);
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

const snapshotRecordSpecValue = new RecordSpec<unknown, SnapshotRecord>({
  schema: AnySchema,
  extractId: (record) => readSnapshotRecord(record).aggregateId,
  columns: [
    new RecordColumn("aggregateId", (record) => readSnapshotRecord(record).aggregateId),
    new RecordColumn("version", (record) => readSnapshotRecord(record).version),
  ],
});

function snapshotRecordSpec<Id>(): RecordSpec<Id, SnapshotRecord> {
  return snapshotRecordSpecValue as RecordSpec<Id, SnapshotRecord>;
}

function snapshotStorageContext(context: StorageContext): StorageContext {
  if (!context.multitenant) {
    return Object.freeze({
      name: context.name,
      multitenant: false,
    });
  }
  const { tenantId } = context;
  if (tenantId === undefined || tenantId.trim().length === 0) {
    throw new Error(`Multitenant storage "${context.name}" requires context.tenantId.`);
  }
  return Object.freeze({
    name: context.name,
    multitenant: true,
    tenantId,
  });
}

function aggregateLockKey(context: StorageContext, aggregateId: AggregateId): string {
  return JSON.stringify({
    name: context.name,
    multitenant: context.multitenant,
    tenantId: context.multitenant ? context.tenantId : "",
    aggregateId: aggregateIdKey(aggregateId),
  });
}

function createSnapshotRecord(payload: SnapshotRecordPayload): SnapshotRecord {
  const encoded: EncodedSnapshotRecordPayload = {
    aggregateId: payload.aggregateId,
    stateTypeUrl: payload.stateTypeUrl,
    stateBase64: Buffer.from(payload.state).toString("base64"),
    version: payload.version.toString(),
    archived: payload.archived,
    deleted: payload.deleted,
  };

  return create(AnySchema, {
    typeUrl: snapshotRecordTypeUrl,
    value: Buffer.from(JSON.stringify(encoded), "utf8"),
  });
}

function readSnapshotRecord(record: SnapshotRecord): SnapshotRecordPayload {
  if (record.typeUrl !== snapshotRecordTypeUrl) {
    throw new Error("Aggregate snapshot record has an unexpected internal type URL.");
  }

  const decoded = JSON.parse(
    Buffer.from(record.value).toString("utf8"),
  ) as Partial<EncodedSnapshotRecordPayload>;

  if (
    typeof decoded.stateTypeUrl !== "string" ||
    typeof decoded.stateBase64 !== "string" ||
    typeof decoded.version !== "string" ||
    decoded.aggregateId === undefined ||
    decoded.aggregateId === null ||
    typeof decoded.archived !== "boolean" ||
    typeof decoded.deleted !== "boolean"
  ) {
    throw new Error("Aggregate snapshot record is malformed.");
  }

  return Object.freeze({
    aggregateId: decoded.aggregateId,
    stateTypeUrl: decoded.stateTypeUrl,
    state: Buffer.from(decoded.stateBase64, "base64"),
    version: BigInt(decoded.version),
    archived: decoded.archived,
    deleted: decoded.deleted,
  });
}

function requireEventVersion(event: Event): bigint {
  const version = event.context?.version?.number;
  if (version === undefined) {
    throw new Error("Aggregate event routing requires a readable version.");
  }
  return BigInt(version);
}

function requireEventId(event: Event): string {
  const value = event.id?.value;
  if (value === undefined || value.trim().length === 0) {
    throw new Error("Aggregate event routing requires a readable event ID.");
  }
  return value;
}

function rejectConsecutiveVersions(
  events: readonly VersionedEvent[],
  firstExpectedVersion: bigint,
): void {
  let expectedVersion = firstExpectedVersion;

  for (const { version } of events) {
    if (version === expectedVersion - 1n) {
      throw new Error("Aggregate event history contains duplicate versions.");
    }
    if (version !== expectedVersion) {
      throw new Error("Aggregate event history contains version gaps.");
    }
    expectedVersion++;
  }
}

function rejectDuplicateEventIds(events: readonly VersionedEvent[]): void {
  const eventIds = new Set<string>();
  for (const { event } of events) {
    const eventId = requireEventId(event);
    if (eventIds.has(eventId)) {
      throw new Error("Aggregate event history contains duplicate event IDs.");
    }
    eventIds.add(eventId);
  }
}

function readAggregateId(value: unknown): AggregateId | undefined {
  const primitive = PrimitiveIds.readFinite(value);
  if (primitive !== undefined) {
    return primitive;
  }
  return MessageIds.read(value);
}

function requireAggregateId(value: unknown): AggregateId {
  const id = readAggregateId(value);
  if (id === undefined) {
    throw new Error("Aggregate IDs must be finite primitive values or single-field message IDs.");
  }
  return id;
}

function sameAggregateId(left: unknown, right: unknown): boolean {
  const leftId = readAggregateId(left);
  const rightId = readAggregateId(right);

  return (
    leftId !== undefined &&
    rightId !== undefined &&
    aggregateIdKey(leftId) === aggregateIdKey(rightId)
  );
}

function aggregateIdKey(id: AggregateId): string {
  if (typeof id === "object") {
    return MessageIds.key(id);
  }

  return JSON.stringify({
    type: typeof id,
    value: id,
  });
}

function formatAggregateId(id: unknown): string {
  const aggregateId = readAggregateId(id);
  return aggregateId === undefined ? String(id) : aggregateIdKey(aggregateId);
}

function sameSnapshotId(left: unknown, right: unknown): boolean {
  return sameAggregateId(left, right);
}

function compareVersions(left: bigint, right: bigint): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
