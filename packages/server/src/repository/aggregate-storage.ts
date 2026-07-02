import { create, fromBinary, toBinary, type MessageShape } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, unpackAny, type MessageSchema } from "@spine-ts/core";
import { type Event, UserIdSchema } from "@spine-ts/proto";
import {
  EventStore,
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-ts/storage";

import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import type { EntityLifecycleFlags } from "../entity/entity.js";

/**
 * Small aggregate history store over snapshots and events.
 *
 * Snapshots are stored as internal records. Events are appended through the
 * storage event store and loaded by aggregate ID using producer-ID or
 * first-field routing. Appends reject events that do not route to the supplied
 * aggregate ID and reject missing, duplicate, or non-increasing versions before
 * storing anything.
 */
export class AggregateStorage<Schema extends DescriptorMessageSchema, Id = string> {
  readonly #eventSchemas: readonly MessageSchema[];
  readonly #eventStore: EventStore;
  readonly #snapshotStorage: RecordStorage<Id, SnapshotRecord>;
  readonly #stateSchema: Schema;
  readonly #stateTypeUrl: string;

  /** Open aggregate storage from a context, storage factory, and state schema. */
  constructor(options: AggregateStorageOptions<Schema>) {
    this.#stateSchema = options.stateSchema;
    this.#stateTypeUrl = deriveTypeUrl(options.stateSchema);
    this.#eventSchemas = Object.freeze([...(options.eventSchemas ?? [])]);
    this.#snapshotStorage = options.storageFactory.createRecordStorage(
      options.context,
      snapshotRecordSpec<Id>(),
    );
    this.#eventStore = new EventStore(options.context, options.storageFactory);
  }

  /** Append aggregate events in strictly increasing aggregate-version order. */
  async appendEvents(aggregateId: Id, events: Iterable<Event>): Promise<void> {
    const batch = [...events];
    const expectedId = String(aggregateId);
    let lastVersion = (await this.#readAggregateEvents(aggregateId)).at(-1)?.version ?? 0n;

    for (const event of batch) {
      const eventAggregateId = this.#eventAggregateId(event);
      if (eventAggregateId === undefined || eventAggregateId !== expectedId) {
        throw new Error("Aggregate events must all route to the same aggregate ID before append.");
      }

      const version = requireEventVersion(event);
      if (version <= lastVersion) {
        throw new Error("Aggregate event versions must be strictly increasing.");
      }
      lastVersion = version;
    }

    await this.#eventStore.appendAll(batch);
  }

  /** Store or replace the latest snapshot for one aggregate. */
  async writeSnapshot(snapshot: AggregateSnapshot<Schema, Id>): Promise<void> {
    await this.#snapshotStorage.write(
      createSnapshotRecord({
        aggregateId: snapshot.aggregateId,
        stateTypeUrl: this.#stateTypeUrl,
        state: toBinary(this.#stateSchema, snapshot.state, { writeUnknownFields: false }),
        version: snapshot.version,
        archived: snapshot.lifecycle.archived,
        deleted: snapshot.lifecycle.deleted,
      }),
    );
  }

  /** Read latest snapshot and the events after it for one aggregate. */
  async readHistory(aggregateId: Id): Promise<AggregateHistory<Schema, Id>> {
    const snapshot = await this.#readSnapshot(aggregateId);
    const snapshotVersion = snapshot?.version ?? -1n;
    const events = (await this.#readAggregateEvents(aggregateId))
      .filter(({ version }) => version > snapshotVersion)
      .map(({ event }) => event);

    return Object.freeze({
      snapshot,
      events: Object.freeze(events),
    });
  }

  async #readSnapshot(aggregateId: Id): Promise<AggregateSnapshot<Schema, Id> | undefined> {
    const record = await this.#snapshotStorage.read(aggregateId);

    if (record === undefined) {
      return undefined;
    }

    const payload = readSnapshotRecord(record);
    if (payload.stateTypeUrl !== this.#stateTypeUrl) {
      throw new Error(
        `Aggregate snapshot for "${String(aggregateId)}" has an unexpected state type.`,
      );
    }

    return Object.freeze({
      aggregateId: payload.aggregateId as Id,
      state: fromBinary(this.#stateSchema, payload.state),
      version: payload.version,
      lifecycle: Object.freeze({
        archived: payload.archived,
        deleted: payload.deleted,
      }),
    });
  }

  async #readAggregateEvents(aggregateId: Id): Promise<readonly VersionedEvent[]> {
    const expectedId = String(aggregateId);
    const events: VersionedEvent[] = [];

    for (const event of await this.#eventStore.read()) {
      if (this.#eventAggregateId(event) !== expectedId) {
        continue;
      }

      const version = requireEventVersion(event);
      events.push(Object.freeze({ event, version }));
    }

    events.sort((left, right) => compareVersions(left.version, right.version));
    rejectDuplicateVersions(events);
    return Object.freeze(events);
  }

  #eventAggregateId(event: Event): string | undefined {
    const producerId = event.context?.producerId;
    if (producerId !== undefined) {
      const userId = unpackAny(producerId, UserIdSchema);
      if (userId?.value !== undefined && userId.value !== "") {
        return userId.value;
      }
    }

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
        return primitiveId(value);
      }
    }

    return undefined;
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
export interface AggregateSnapshot<Schema extends DescriptorMessageSchema, Id = string> {
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
export interface AggregateHistory<Schema extends DescriptorMessageSchema, Id = string> {
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

const snapshotRecordTypeUrl = "type.spine-ts.dev/internal/AggregateSnapshotRecord";

function snapshotRecordSpec<Id>(): RecordSpec<Id, SnapshotRecord> {
  return new RecordSpec<Id, SnapshotRecord>({
    schema: AnySchema,
    extractId: (record) => readSnapshotRecord(record).aggregateId as Id,
    columns: [
      new RecordColumn("aggregateId", (record) => readSnapshotRecord(record).aggregateId),
      new RecordColumn("version", (record) => readSnapshotRecord(record).version),
    ],
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

function rejectDuplicateVersions(events: readonly VersionedEvent[]): void {
  let lastVersion: bigint | undefined;

  for (const { version } of events) {
    if (lastVersion !== undefined && version === lastVersion) {
      throw new Error("Aggregate event history contains duplicate versions.");
    }
    lastVersion = version;
  }
}

function primitiveId(value: unknown): string | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return undefined;
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
