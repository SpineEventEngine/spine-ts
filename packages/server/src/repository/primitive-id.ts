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

import { create, type Message } from "@bufbuild/protobuf";
import {
  BoolValueSchema,
  DoubleValueSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

/**
 * Represents a scalar value that may identify an entity.
 */
export type PrimitiveId = string | number | bigint | boolean;

/**
 * Packs and reads scalar entity identifiers.
 */
export interface PrimitiveIdCodec {
  // prettier-ignore

  /**
   * Packs an identifier into a Protobuf `Any` value.
   *
   * @param id Identifier to pack.
   * @returns Packed identifier.
   */
  pack(id: PrimitiveId): Any;

  /**
   * Reads a scalar identifier from an unknown value.
   *
   * @param value Value to inspect.
   * @returns Scalar identifier, or `undefined` when the value is unsupported.
   */
  read(value: unknown): PrimitiveId | undefined;

  /**
   * Reads a finite scalar identifier from an unknown value.
   *
   * @param value Value to inspect.
   * @returns Scalar identifier, or `undefined` when it is unsupported or non-finite.
   */
  readFinite(value: unknown): PrimitiveId | undefined;

  /**
   * Unpacks a scalar identifier from a Protobuf `Any` value.
   *
   * @param id Packed identifier to unpack.
   * @returns Scalar identifier, or `undefined` when it is absent or unsupported.
   */
  unpack(id: Any | undefined): PrimitiveId | undefined;
}

/**
 * A generated Protobuf message that identifies an entity.
 *
 * The message is validated against the Entity state ID-field schema at the
 * routing boundary. Its complete declared field set is the identifier.
 */
export interface MessageId extends Message {
  readonly $typeName: string;
}

/**
 * Internal compatibility shape for the legacy scalar-wrapper adapter.
 *
 * This is intentionally separate from {@link MessageId}: general message
 * identifiers need not, and must not, expose a `value` field.
 */
interface LegacyScalarMessageWrapper {
  readonly $typeName: string;
  readonly value: unknown;
}

/**
 * Reads message-shaped entity identifiers and legacy scalar wrappers.
 */
export interface MessageIdCodec {
  // prettier-ignore

  /**
   * Reads a message-shaped identifier from an unknown value.
   *
   * @param value Value to inspect.
   * @returns Identifier, or `undefined` when the value is malformed.
   */
  read(value: unknown): MessageId | undefined;

  /**
   * Reads the scalar value from a message-shaped identifier.
   *
   * @param value Value to inspect.
   * @returns Scalar identifier, or `undefined` when the value is malformed.
   */
  readValue(value: unknown): PrimitiveId | undefined;
}

/**
 * Provides the default scalar identifier codec.
 */
export const PrimitiveIds: PrimitiveIdCodec = Object.freeze({
  pack(id: PrimitiveId): Any {
    switch (typeof id) {
      case "string":
        return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }));
      case "number":
        return AnyMessages.pack(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
      case "boolean":
        return AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value: id }));
      case "bigint":
        return AnyMessages.pack(Int64ValueSchema, create(Int64ValueSchema, { value: id }));
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
      AnyMessages.unpack(id, Int32ValueSchema)?.value ??
      AnyMessages.unpack(id, DoubleValueSchema)?.value ??
      AnyMessages.unpack(id, Int64ValueSchema)?.value ??
      AnyMessages.unpack(id, BoolValueSchema)?.value ??
      AnyMessages.unpack(id, UserIdSchema)?.value
    );
  },
});

/**
 * Provides the default message-shaped identifier codec.
 */
export const MessageIds: MessageIdCodec = Object.freeze({
  read(value: unknown): MessageId | undefined {
    return IdValues.message(value);
  },

  readValue(value: unknown): PrimitiveId | undefined {
    return IdValues.messageValue(value);
  },
});

/**
 * Validates and decodes values shared by identifier codecs.
 */
const IdValues = Object.freeze({
  primitive(value: unknown): PrimitiveId | undefined {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "boolean"
    ) {
      return value;
    }

    return undefined;
  },

  isMessage(value: unknown): value is MessageId {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    return typeof (value as { readonly $typeName?: unknown }).$typeName === "string";
  },

  message(value: unknown): MessageId | undefined {
    return IdValues.isMessage(value) ? value : undefined;
  },

  messageValue(value: unknown): PrimitiveId | undefined {
    if (!IdValues.isLegacyScalarMessageWrapper(value)) return undefined;
    const id = PrimitiveIds.readFinite(value.value);
    return id;
  },

  isLegacyScalarMessageWrapper(value: unknown): value is LegacyScalarMessageWrapper {
    if (!IdValues.isMessage(value)) return false;
    const keys = Object.keys(value);
    return keys.length === 2 && keys.includes("value");
  },
});
