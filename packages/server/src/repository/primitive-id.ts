import { create } from "@bufbuild/protobuf";
import {
  BoolValueSchema,
  DoubleValueSchema,
  StringValueSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

export type PrimitiveId = string | number | boolean;

export interface PrimitiveIdCodec {
  pack(id: PrimitiveId): Any;
  read(value: unknown): PrimitiveId | undefined;
  readFinite(value: unknown): PrimitiveId | undefined;
  unpack(id: Any | undefined): PrimitiveId | undefined;
}

export interface MessageId {
  readonly $typeName: string;
  readonly value: PrimitiveId;
}

export interface MessageIdCodec {
  read(value: unknown): MessageId | undefined;
  readValue(value: unknown): PrimitiveId | undefined;
  key(id: MessageId): string;
}

export const PrimitiveIds: PrimitiveIdCodec = Object.freeze({
  pack(id: PrimitiveId): Any {
    switch (typeof id) {
      case "string":
        return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }));
      case "number":
        return AnyMessages.pack(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
      case "boolean":
        return AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value: id }));
    }
  },

  read(value: unknown): PrimitiveId | undefined {
    return readPrimitive(value);
  },

  readFinite(value: unknown): PrimitiveId | undefined {
    const id = readPrimitive(value);

    return typeof id === "number" && !Number.isFinite(id) ? undefined : id;
  },

  unpack(id: Any | undefined): PrimitiveId | undefined {
    if (id === undefined) {
      return undefined;
    }

    return (
      AnyMessages.unpack(id, StringValueSchema)?.value ??
      AnyMessages.unpack(id, DoubleValueSchema)?.value ??
      AnyMessages.unpack(id, BoolValueSchema)?.value ??
      AnyMessages.unpack(id, UserIdSchema)?.value
    );
  },
});

export const MessageIds: MessageIdCodec = Object.freeze({
  read(value: unknown): MessageId | undefined {
    return readMessageId(value);
  },

  readValue(value: unknown): PrimitiveId | undefined {
    return readMessageId(value)?.value;
  },

  key(id: MessageId): string {
    return JSON.stringify({
      type: "message",
      typeName: id.$typeName,
      value: {
        type: typeof id.value,
        value: id.value,
      },
    });
  },
});

function readPrimitive(value: unknown): PrimitiveId | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function isMessageIdObject(value: unknown): value is MessageId {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    keys.includes("$typeName") &&
    keys.includes("value") &&
    typeof (value as { readonly $typeName?: unknown }).$typeName === "string"
  );
}

function readMessageId(value: unknown): MessageId | undefined {
  if (!isMessageIdObject(value)) {
    return undefined;
  }

  const id = PrimitiveIds.readFinite(value.value);
  return id === undefined
    ? undefined
    : {
        $typeName: value.$typeName,
        value: id,
      };
}
