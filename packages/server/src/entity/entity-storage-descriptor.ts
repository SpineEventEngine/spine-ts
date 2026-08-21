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

import { clone, create, ScalarType, toBinary, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { AnyMessages, Identifiers } from "@spine-event-engine/core";
import { VersionSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  LifecycleFlagsSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  type StorageContext,
} from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";

import { describeEntityMetadata, type DescriptorMessageSchema } from "./entity-metadata.js";
import type { PrimitiveId } from "../repository/primitive-id.js";

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
    const packedId = EntityIds.pack(schema, entityId);
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
      key: (id) => canonicalEntityIdKey(spec.sourceType, id),
      pack: (id) => EntityIds.pack(spec.sourceType, id),
      unpack: (id): I | undefined => {
        try {
          return spec.idValueIn(create(EntityRecordSchema, { entityId: id }));
        } catch {
          return undefined;
        }
      },
    },
    recordSpec: spec,
    sourceType: spec.sourceType,
    stateSchema: spec.sourceType,
  };
}

/**
 * Packs Entity IDs according to the declaration-first ID field of their state.
 *
 * @internal
 */
export const EntityIds: Readonly<{
  pack(schema: DescriptorMessageSchema, entityId: unknown): Any;
}> = Object.freeze({
  pack(schema: DescriptorMessageSchema, entityId: unknown): Any {
    const idField = describeEntityMetadata(schema).idField.descriptor;
    if (idField.fieldKind === "message") {
      return Identifiers.pack(idField.message as DescriptorMessageSchema, entityId as never);
    }
    if (idField.fieldKind === "scalar") {
      switch (primitiveIdKind(idField.scalar)) {
        case "string":
          return Identifiers.pack("string", entityId as string);
        case "int32":
          return Identifiers.pack("int32", entityId as number);
        case "int64":
          return Identifiers.pack("int64", entityId as bigint);
      }
    }
    throw new Error("Entity ID field must be scalar or message-valued.");
  },
});

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
        ColumnTypes.scalar(ScalarType.BOOL),
        (record) => record.lifecycleFlags?.archived ?? false,
      ),
      new RecordColumn<EntityRecord>(
        "deleted",
        ColumnTypes.scalar(ScalarType.BOOL),
        (record) => record.lifecycleFlags?.deleted ?? false,
      ),
      new RecordColumn<EntityRecord>("version", ColumnTypes.message(VersionSchema), (record) =>
        clone(VersionSchema, record.version ?? create(VersionSchema)),
      ),
      ...columns.map(
        (column) =>
          new RecordColumn<EntityRecord>(column.name, column.type, (record) =>
            column.valueIn(EntityRecords.unpack(schema, record).state),
          ),
      ),
    ],
  };
  const idField = metadata.idField.descriptor;
  if (idField.fieldKind === "message")
    return new RecordSpec<Message, EntityRecord>({
      ...input,
      idSchema: idField.message as unknown as DescriptorMessageSchema,
      extractId: (record) =>
        unpackMessageId(record, idField.message as unknown as DescriptorMessageSchema),
    });
  if (idField.fieldKind === "scalar")
    return new RecordSpec<PrimitiveId, EntityRecord>({
      ...input,
      idKind: primitiveIdKind(idField.scalar),
      extractId: (record) => unpackPrimitiveId(record, primitiveIdKind(idField.scalar)),
    });
  throw new Error(`Entity ID field "${idField.name}" must be scalar or message-valued.`);
}

function primitiveIdKind(type: ScalarType): "string" | "int32" | "int64" {
  switch (type) {
    case ScalarType.STRING:
      return "string";
    case ScalarType.INT32:
    case ScalarType.SINT32:
    case ScalarType.SFIXED32:
      return "int32";
    case ScalarType.INT64:
    case ScalarType.SINT64:
    case ScalarType.SFIXED64:
      return "int64";
    default:
      throw new Error("Spine JVM storage does not support this primitive Entity ID type.");
  }
}

function unpackMessageId(record: EntityRecord, schema: DescriptorMessageSchema): Message {
  if (record.entityId === undefined) throw new Error("EntityRecord has no packed entity ID.");
  const id = AnyMessages.unpack(record.entityId, schema);
  if (id === undefined) throw new Error("EntityRecord ID does not match the Entity ID schema.");
  return id;
}

function unpackPrimitiveId(record: EntityRecord, kind: "string" | "int32" | "int64"): PrimitiveId {
  const id =
    record.entityId === undefined
      ? undefined
      : kind === "string"
        ? Identifiers.unpack("string", record.entityId)
        : kind === "int32"
          ? Identifiers.unpack("int32", record.entityId)
          : Identifiers.unpack("int64", record.entityId);
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

function canonicalEntityIdKey(schema: DescriptorMessageSchema, id: unknown): string {
  return Buffer.from(toBinary(AnySchema, EntityIds.pack(schema, id))).toString("base64");
}
