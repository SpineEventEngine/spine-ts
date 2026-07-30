import { create } from "@bufbuild/protobuf";
import {
  BoolValueSchema,
  DoubleValueSchema,
  StringValueSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

/** Represents a scalar value that may identify an entity. */
export type PrimitiveId = string | number | boolean;

/** Packs and reads scalar entity identifiers. */
export interface PrimitiveIdCodec {
  /** Packs an identifier into a Protobuf `Any` value.
   *
   * @param id - Identifier to pack.
   * @returns Packed identifier.
   */
  pack(id: PrimitiveId): Any;
  /** Reads a scalar identifier from an unknown value.
   *
   * @param value - Value to inspect.
   * @returns Scalar identifier, or `undefined` when the value is unsupported.
   */
  read(value: unknown): PrimitiveId | undefined;
  /** Reads a finite scalar identifier from an unknown value.
   *
   * @param value - Value to inspect.
   * @returns Scalar identifier, or `undefined` when it is unsupported or non-finite.
   */
  readFinite(value: unknown): PrimitiveId | undefined;
  /** Unpacks a scalar identifier from a Protobuf `Any` value.
   *
   * @param id - Packed identifier to unpack.
   * @returns Scalar identifier, or `undefined` when it is absent or unsupported.
   */
  unpack(id: Any | undefined): PrimitiveId | undefined;
}

/** Describes the type name and scalar value of a message-shaped identifier. */
export interface MessageId {
  /** Declares the fully-qualified Protobuf message type name. */
  readonly $typeName: string;
  /** Holds the scalar identifier value. */
  readonly value: PrimitiveId;
}

/** Reads and keys message-shaped entity identifiers. */
export interface MessageIdCodec {
  /** Reads a message-shaped identifier from an unknown value.
   *
   * @param value - Value to inspect.
   * @returns Identifier, or `undefined` when the value is malformed.
   */
  read(value: unknown): MessageId | undefined;
  /** Reads the scalar value from a message-shaped identifier.
   *
   * @param value - Value to inspect.
   * @returns Scalar identifier, or `undefined` when the value is malformed.
   */
  readValue(value: unknown): PrimitiveId | undefined;
  /** Creates a stable storage key for a message-shaped identifier.
   *
   * @param id - Identifier to encode.
   * @returns Stable key that distinguishes message type and scalar value type.
   */
  key(id: MessageId): string;
}

/** Provides the default scalar identifier codec. */
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
    return IdValues.primitive(value);
  },

  readFinite(value: unknown): PrimitiveId | undefined {
    const id = IdValues.primitive(value);

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

/** Provides the default message-shaped identifier codec. */
export const MessageIds: MessageIdCodec = Object.freeze({
  read(value: unknown): MessageId | undefined {
    return IdValues.message(value);
  },

  readValue(value: unknown): PrimitiveId | undefined {
    return IdValues.message(value)?.value;
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

/** Owns the validation and decoding shared by the identifier codecs. */
const IdValues = Object.freeze({
  primitive(value: unknown): PrimitiveId | undefined {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    return undefined;
  },

  isMessage(value: unknown): value is MessageId {
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
  },

  message(value: unknown): MessageId | undefined {
    if (!IdValues.isMessage(value)) {
      return undefined;
    }

    const id = PrimitiveIds.readFinite(value.value);
    return id === undefined
      ? undefined
      : {
          $typeName: value.$typeName,
          value: id,
        };
  },
});
