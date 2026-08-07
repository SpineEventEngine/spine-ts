import { clone, create, ScalarType, type Message } from "@bufbuild/protobuf";
import { AnyMessages } from "@spine-event-engine/core";
import { VersionSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  LifecycleFlagsSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { RecordColumn, RecordSpec, type StorageContext } from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/internal/entity-history";

import { describeEntityMetadata, type DescriptorMessageSchema } from "./entity-metadata.js";
import { PrimitiveIds, type PrimitiveId } from "../repository/primitive-id.js";

/**
 * Converts repository current state to and from the JVM EntityRecord envelope.
 *
 * @internal
 */
export const EntityRecords: EntityRecordConverter = Object.freeze({
  // prettier-ignore

  /**
   * Packs one current Entity state and its durable metadata.
   *
   * @param schema The generated Entity state schema.
   * @param entityId The authoritative routed Entity ID.
   * @param state The current Entity state.
   * @param version The persisted Entity version.
   * @param lifecycle The persisted Entity lifecycle.
   * @returns The generated JVM EntityRecord envelope.
   */
  pack(
    schema: DescriptorMessageSchema,
    entityId: unknown,
    state: Message,
    version: bigint | import("@spine-event-engine/proto").Version,
    lifecycle: { readonly archived: boolean; readonly deleted: boolean },
  ): EntityRecord {
    const versionNumber = typeof version === "bigint" ? version : BigInt(version.number);
    if (versionNumber < 0n || versionNumber > 2_147_483_647n) {
      throw new RangeError("EntityRecord version must fit the non-negative JVM int32 range.");
    }
    const idField = describeEntityMetadata(schema).idField.descriptor;
    const packedId =
      idField.fieldKind === "message"
        ? AnyMessages.pack(idField.message as DescriptorMessageSchema, entityId as never)
        : PrimitiveIds.pack(entityId as never);
    return create(EntityRecordSchema, {
      entityId: packedId,
      state: AnyMessages.pack(schema, state),
      version:
        typeof version === "bigint"
          ? create(VersionSchema, { number: Number(version) })
          : clone(VersionSchema, version),
      lifecycleFlags: create(LifecycleFlagsSchema, lifecycle),
    });
  },

  /**
   * Restores state and durable metadata from one generated EntityRecord.
   *
   * @param schema The generated Entity state schema.
   * @param record The JVM EntityRecord envelope.
   * @returns The unpacked state and durable metadata.
   */
  unpack(schema: DescriptorMessageSchema, record: EntityRecord): EntityRecordValue {
    const cached = stateCache.get(record)?.get(schema);
    if (cached !== undefined) return cached;
    const packedState = record.state;
    const state = packedState === undefined ? undefined : AnyMessages.unpack(packedState, schema);
    if (state === undefined)
      throw new Error("EntityRecord state does not match the Entity state schema.");
    const version = BigInt(record.version?.number ?? 0);
    if (version < 0n) throw new RangeError("EntityRecord version must be non-negative.");
    const value = Object.freeze({
      archived: record.lifecycleFlags?.archived ?? false,
      deleted: record.lifecycleFlags?.deleted ?? false,
      state,
      version,
      versionMessage: clone(VersionSchema, record.version ?? create(VersionSchema)),
    });
    let cachedBySchema = stateCache.get(record);
    if (cachedBySchema === undefined) {
      cachedBySchema = new Map();
      stateCache.set(record, cachedBySchema);
    }
    cachedBySchema.set(schema, value);
    return value;
  },
});

/**
 * Creates provider input from a class-derived EntityRecord specification.
 *
 * @param context Identifies the storage namespace for entity records.
 * @param spec The Entity-class storage specification.
 * @returns The storage input for generated JVM EntityRecord values.
 */
export function entityStorageDescriptor<I>(
  context: StorageContext,
  spec: RecordSpec<I, EntityRecord>,
): EntityStorageInput<I, Message> {
  return {
    columns: spec.columns,
    context,
    id: {
      clone: (id) => structuredClone(id),
      key: canonicalEntityIdKey,
      unpack: (id): I | undefined => {
        try {
          return spec.idValueIn(create(EntityRecordSchema, { entityId: id }));
        } catch {
          return undefined;
        }
      },
    },
    sourceType: spec.sourceType,
    stateSchema: spec.sourceType,
  };
}

/**
 * Creates the internal Stand storage input for a registered Entity state schema.
 *
 * @param context Identifies the storage namespace for entity records.
 * @param schema The registered generated state schema.
 * @param columns The state columns selected by Stand registration.
 * @returns Storage input backed by generated JVM EntityRecord values.
 * @internal
 */
export function standEntityStorageDescriptor(
  context: StorageContext,
  schema: DescriptorMessageSchema,
  columns: readonly RecordColumn<Message>[],
): EntityStorageInput<unknown, Message> {
  return entityStorageDescriptor(context, entityRecordSpec(schema, columns)) as EntityStorageInput<
    unknown,
    Message
  >;
}

/**
 * Builds the shared JVM EntityRecord specification for one Entity state schema.
 *
 * @param schema Generated Entity state schema.
 * @param columns State columns materialized from an unpacked EntityRecord.
 * @returns The generated EntityRecord specification.
 * @internal
 */
export function entityRecordSpec(
  schema: DescriptorMessageSchema,
  columns: readonly RecordColumn<Message>[],
): RecordSpec<Message | PrimitiveId, EntityRecord> {
  const metadata = describeEntityMetadata(schema);
  const input = {
    sourceType: schema,
    recordType: EntityRecordSchema,
    columns: [
      new RecordColumn<EntityRecord>(
        "archived",
        (record) => record.lifecycleFlags?.archived ?? false,
        "boolean",
      ),
      new RecordColumn<EntityRecord>(
        "deleted",
        (record) => record.lifecycleFlags?.deleted ?? false,
        "boolean",
      ),
      new RecordColumn<EntityRecord>(
        "version",
        (record) => clone(VersionSchema, record.version ?? create(VersionSchema)),
        "protobuf",
      ),
      ...columns.map(
        (column) =>
          new RecordColumn<EntityRecord>(
            column.name,
            (record) => column.valueIn(EntityRecords.unpack(schema, record).state),
            column.valueType,
          ),
      ),
    ],
  };
  return (
    metadata.idField.descriptor.fieldKind === "message"
      ? new RecordSpec<Message, EntityRecord>({
          ...input,
          idSchema: metadata.idField.descriptor.message as DescriptorMessageSchema,
          extractId: (record) =>
            unpackMessageId(record, metadata.idField.descriptor.message as DescriptorMessageSchema),
        })
      : new RecordSpec<PrimitiveId, EntityRecord>({
          ...input,
          idKind:
            metadata.idField.descriptor.scalar === ScalarType.STRING
              ? "string"
              : String(metadata.idField.descriptor.scalar),
          extractId: unpackPrimitiveId,
        })
  ) as RecordSpec<Message | PrimitiveId, EntityRecord>;
}

function unpackMessageId(record: EntityRecord, schema: DescriptorMessageSchema): Message {
  if (record.entityId === undefined) throw new Error("EntityRecord has no packed entity ID.");
  const id = AnyMessages.unpack(record.entityId, schema);
  if (id === undefined) throw new Error("EntityRecord ID does not match the Entity ID schema.");
  return id;
}

function unpackPrimitiveId(record: EntityRecord): PrimitiveId {
  const id = PrimitiveIds.unpack(record.entityId);
  if (id === undefined) throw new Error("EntityRecord ID does not match the Entity ID schema.");
  return id;
}

type EntityRecordValue = Readonly<{
  readonly archived: boolean;
  readonly deleted: boolean;
  readonly state: Message;
  readonly version: bigint;
  readonly versionMessage: import("@spine-event-engine/proto").Version;
}>;

type EntityRecordConverter = Readonly<{
  pack(
    schema: DescriptorMessageSchema,
    entityId: unknown,
    state: Message,
    version: bigint | import("@spine-event-engine/proto").Version,
    lifecycle: { readonly archived: boolean; readonly deleted: boolean },
  ): EntityRecord;
  unpack(schema: DescriptorMessageSchema, record: EntityRecord): EntityRecordValue;
}>;

const stateCache = new WeakMap<EntityRecord, Map<DescriptorMessageSchema, EntityRecordValue>>();

function canonicalEntityIdKey(id: unknown): string {
  if (id === null) return "null";
  switch (typeof id) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return `${typeof id}:${String(id)}`;
    default:
      return `json:${JSON.stringify(id)}`;
  }
}
