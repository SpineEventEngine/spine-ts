import type { Message } from "@bufbuild/protobuf";
import {
  entityStorageKey,
  type EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";
import type { RecordColumn, StorageContext } from "@spine-event-engine/storage";

import type { DescriptorMessageSchema } from "./entity-metadata.js";

/** One current-record descriptor shared by repositories and Stand. */
export function entityStorageDescriptor(
  context: StorageContext,
  schema: DescriptorMessageSchema,
  idField: string,
  columns: readonly RecordColumn<Message>[],
): EntityStorageInput<unknown, Message> {
  const extractId = (state: Message): unknown => (state as Record<string, unknown>)[idField];
  return {
    columns,
    context,
    extractId,
    id: {
      clone: (id) => structuredClone(id),
      fingerprint: `${schema.typeName}:entity-id:${idField}:v1`,
      key: (id) => canonicalEntityIdKey(id),
    },
    layout: "spine-ts.entity-record.v2",
    stateSchema: schema,
    storageKey: entityStorageKey(schema.typeName, "current"),
  };
}

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
