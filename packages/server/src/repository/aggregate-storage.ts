import { create, fromBinary, toBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
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

type SnapshotRecord = Message<"spine.server.AggregateSnapshotRecord"> & {
  aggregateId: string;
  stateTypeUrl: string;
  state: Uint8Array;
  version: bigint;
  archived: boolean;
  deleted: boolean;
};

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
export interface AggregateSnapshot<Schema extends DescriptorMessageSchema> {
  /** Aggregate identifier. */
  readonly aggregateId: string;
  /** Aggregate state restored from the snapshot. */
  readonly state: MessageShape<Schema>;
  /** Aggregate version captured by the snapshot. */
  readonly version: bigint;
  /** Lifecycle flags captured by the snapshot. */
  readonly lifecycle: EntityLifecycleFlags;
}

/** Aggregate history loaded from storage. */
export interface AggregateHistory<Schema extends DescriptorMessageSchema> {
  /** Latest snapshot, when one has been stored. */
  readonly snapshot: AggregateSnapshot<Schema> | undefined;
  /** Events after the snapshot version, or all events when no snapshot exists. */
  readonly events: readonly Event[];
}

/**
 * Small aggregate history store over snapshots and events.
 *
 * Snapshots are stored as framework-owned records. Events are appended through
 * the storage event store and loaded by aggregate ID using producer-ID or
 * first-field routing.
 */
export class AggregateStorage<Schema extends DescriptorMessageSchema> {
  readonly #eventSchemas: readonly MessageSchema[];
  readonly #eventStore: EventStore;
  readonly #snapshotStorage: RecordStorage<string, SnapshotRecord>;
  readonly #stateSchema: Schema;
  readonly #stateTypeUrl: string;

  /** Open aggregate storage from a context, storage factory, and state schema. */
  constructor(options: AggregateStorageOptions<Schema>) {
    this.#stateSchema = options.stateSchema;
    this.#stateTypeUrl = deriveTypeUrl(options.stateSchema);
    this.#eventSchemas = Object.freeze([...(options.eventSchemas ?? [])]);
    this.#snapshotStorage = options.storageFactory.createRecordStorage(
      options.context,
      snapshotRecordSpec,
    );
    this.#eventStore = new EventStore(options.context, options.storageFactory);
  }

  /** Append aggregate events in order. */
  async appendEvents(aggregateId: string, events: Iterable<Event>): Promise<void> {
    void aggregateId;
    await this.#eventStore.appendAll(events);
  }

  /** Store or replace the latest snapshot for one aggregate. */
  async writeSnapshot(snapshot: AggregateSnapshot<Schema>): Promise<void> {
    await this.#snapshotStorage.write(
      create(snapshotRecordSchema, {
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
  async readHistory(aggregateId: string): Promise<AggregateHistory<Schema>> {
    const snapshot = await this.#readSnapshot(aggregateId);
    const snapshotVersion = snapshot?.version ?? -1n;
    const events = (await this.#eventStore.read())
      .filter(
        (event) =>
          this.#eventAggregateId(event) === aggregateId && eventVersion(event) > snapshotVersion,
      )
      .sort((left, right) => compareVersions(eventVersion(left), eventVersion(right)));

    return Object.freeze({
      snapshot,
      events: Object.freeze(events),
    });
  }

  async #readSnapshot(aggregateId: string): Promise<AggregateSnapshot<Schema> | undefined> {
    const record = await this.#snapshotStorage.read(aggregateId);

    if (record === undefined) {
      return undefined;
    }
    if (record.stateTypeUrl !== this.#stateTypeUrl) {
      throw new Error(`Aggregate snapshot for "${aggregateId}" has an unexpected state type.`);
    }

    return Object.freeze({
      aggregateId: record.aggregateId,
      state: fromBinary(this.#stateSchema, record.state),
      version: record.version,
      lifecycle: Object.freeze({
        archived: record.archived,
        deleted: record.deleted,
      }),
    });
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

const snapshotRecordSchema = createSnapshotRecordSchema();
const snapshotRecordSpec = new RecordSpec<string, SnapshotRecord>({
  schema: snapshotRecordSchema,
  extractId: (record) => record.aggregateId,
  columns: [
    new RecordColumn("aggregateId", (record) => record.aggregateId),
    new RecordColumn("version", (record) => record.version),
  ],
});

function createSnapshotRecordSchema(): GenMessage<SnapshotRecord> {
  const descriptor = create(FileDescriptorProtoSchema, {
    name: "spine/server/aggregate_storage.proto",
    package: "spine.server",
    syntax: "proto3",
    messageType: [
      {
        name: "AggregateSnapshotRecord",
        field: [
          field("aggregate_id", 1, FieldDescriptorProto_Type.STRING),
          field("state_type_url", 2, FieldDescriptorProto_Type.STRING),
          field("state", 3, FieldDescriptorProto_Type.BYTES),
          field("version", 4, FieldDescriptorProto_Type.UINT64),
          field("archived", 5, FieldDescriptorProto_Type.BOOL),
          field("deleted", 6, FieldDescriptorProto_Type.BOOL),
        ],
      },
    ],
  });

  return messageDesc(
    fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64")),
    0,
  );
}

function field(name: string, number: number, type: FieldDescriptorProto_Type) {
  return {
    name,
    number,
    label: FieldDescriptorProto_Label.OPTIONAL,
    type,
  };
}

function eventVersion(event: Event): bigint {
  const version = event.context?.version?.number;
  return version === undefined ? 0n : BigInt(version);
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
