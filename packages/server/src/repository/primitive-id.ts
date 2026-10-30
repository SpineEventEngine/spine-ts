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
import { AnyPacker } from "@spine-event-engine/core";
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
  // prettier-ignore

  /**
   * Fully qualified Protobuf message type name.
   */
  readonly $typeName: string;
}

/**
 * Reads message-shaped entity identifiers.
 */
export interface MessageIdCodec {
  // prettier-ignore

  /**
   * Performs shallow message-shape recognition for an unknown identifier.
   *
   * Repository routing validates the recognized message against its target
   * schema before durable use.
   *
   * @param value Value to inspect.
   * @returns Identifier, or `undefined` when the value is malformed.
   */
  read(value: unknown): MessageId | undefined;
}

/**
 * Provides the default scalar identifier codec.
 */
export const PrimitiveIds: PrimitiveIdCodec = Object.freeze({
  pack(id: PrimitiveId): Any {
    switch (typeof id) {
      case "string":
        return AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value: id }));
      case "number":
        return AnyPacker.pack(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
      case "boolean":
        return AnyPacker.pack(BoolValueSchema, create(BoolValueSchema, { value: id }));
      case "bigint":
        return AnyPacker.pack(Int64ValueSchema, create(Int64ValueSchema, { value: id }));
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
      AnyPacker.tryUnpack(id, StringValueSchema)?.value ??
      AnyPacker.tryUnpack(id, Int32ValueSchema)?.value ??
      AnyPacker.tryUnpack(id, DoubleValueSchema)?.value ??
      AnyPacker.tryUnpack(id, Int64ValueSchema)?.value ??
      AnyPacker.tryUnpack(id, BoolValueSchema)?.value ??
      AnyPacker.tryUnpack(id, UserIdSchema)?.value
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
});

/**
 * Validates and decodes values shared by identifier codecs.
 */
const IdValues = Object.freeze({
  /**
   * Reads a primitive identifier value.
   * @param value Candidate identifier.
   * @returns Primitive identifier, if supported.
   */
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

  /**
   * Checks whether an identifier is a generated message.
   * @param value Candidate identifier.
   * @returns Whether the value is a generated message.
   */
  isMessage(value: unknown): value is MessageId {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    return (
      Object.hasOwn(value, "$typeName") &&
      typeof (value as { readonly $typeName?: unknown }).$typeName === "string"
    );
  },

  /**
   * Reads a message identifier value.
   * @param value Candidate identifier.
   * @returns Message identifier, if supported.
   */
  message(value: unknown): MessageId | undefined {
    return IdValues.isMessage(value) ? value : undefined;
  },
});
