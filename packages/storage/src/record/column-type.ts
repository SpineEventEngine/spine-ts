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

import { ScalarType, type DescEnum, type DescField, type DescMessage } from "@bufbuild/protobuf";

declare const columnValueType: unique symbol;

/**
 * Generated Protobuf type retained for one materialized record column.
 *
 * @typeParam V Declared column value type.
 */
export type RecordColumnType<V = unknown> = (
  | {
      // prettier-ignore

      /**
       * Identifies a Protobuf byte scalar column.
       */
      readonly kind: "scalar";

      /**
       * Retains the Protobuf BYTES scalar kind.
       */
      readonly scalar: ScalarType.BYTES;

      /**
       * Whether generated code represents a 64-bit value as a string.
       */
      readonly longAsString: boolean;

      /**
       * Exact byte width when this scalar is BYTES and was declared with fixedBytes.
       */
      readonly byteLength?: number;
    }
  | {
      // prettier-ignore

      /**
       * Identifies a non-byte Protobuf scalar column.
       */
      readonly kind: "scalar";

      /**
       * Retains a scalar kind that cannot declare an exact byte width.
       */
      readonly scalar: Exclude<ScalarType, ScalarType.BYTES>;

      /**
       * Whether generated code represents a 64-bit value as a string.
       */
      readonly longAsString: boolean;

      /**
       * Prevents byte widths on non-byte scalar descriptors.
       */
      readonly byteLength?: never;
    }
  | {
      // prettier-ignore

      /**
       * Identifies a Protobuf enum column.
       */
      readonly kind: "enum";

      /**
       * Generated enum descriptor retained by the column.
       */
      readonly enum: DescEnum;
    }
  | {
      // prettier-ignore

      /**
       * Identifies a Protobuf message column.
       */
      readonly kind: "message";

      /**
       * Generated message descriptor retained by the column.
       */
      readonly message: DescMessage;
    }
) & {
  // prettier-ignore

  /**
   * Compile-time value type carried by the column declaration.
   */
  readonly [columnValueType]?: V;
};

/**
 * Creates record-column types from generated Protobuf descriptors.
 */
export const ColumnTypes = {
  // prettier-ignore

  /**
   * Declares bytes with an exact stored and queried width.
   * @param byteLength Positive safe-integer width.
   * @returns Fixed-width byte column type.
   */
  fixedBytes(byteLength: number): RecordColumnType<Uint8Array> {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0)
      throw new RangeError("Fixed-byte width must be a positive safe integer.");
    return Object.freeze({ kind: "scalar", scalar: ScalarType.BYTES, longAsString: false, byteLength });
  },

  /**
   * Declares a scalar type for a derived column value.
   * @param scalar The Protobuf scalar type.
   * @param longAsString Whether a 64-bit value uses its generated string form.
   * @returns The scalar column type.
   * @typeParam V Declared column value type.
   */
  scalar<V = unknown>(scalar: ScalarType, longAsString?: boolean): RecordColumnType<V> {
    if (scalar === ScalarType.BYTES)
      return Object.freeze({ kind: "scalar", scalar, longAsString: longAsString ?? false });
    return Object.freeze({ kind: "scalar", scalar, longAsString: longAsString ?? false });
  },

  /**
   * Declares an enum type for a derived column value.
   * @param schema The generated enum descriptor.
   * @returns The enum column type.
   * @typeParam V Declared column value type.
   */
  enum<V = unknown>(schema: DescEnum): RecordColumnType<V> {
    return Object.freeze({ kind: "enum", enum: schema });
  },

  /**
   * Declares a message type for a derived column value.
   * @param schema The generated message descriptor.
   * @returns The message column type.
   * @typeParam V Declared column value type.
   */
  message<V = unknown>(schema: DescMessage): RecordColumnType<V> {
    return Object.freeze({ kind: "message", message: schema });
  },

  /**
   * Retains the singular value type declared by a generated Protobuf field.
   * @param field The generated field descriptor.
   * @returns The corresponding column type.
   * @throws Error when the field is repeated or a map.
   * @typeParam V Declared column value type.
   */
  fromField<V = unknown>(field: DescField): RecordColumnType<V> {
    switch (field.fieldKind) {
      case "scalar":
        if (field.scalar === ScalarType.BYTES)
          return Object.freeze({
            kind: "scalar",
            scalar: field.scalar,
            longAsString: field.longAsString,
          });
        return Object.freeze({
          kind: "scalar",
          scalar: field.scalar,
          longAsString: field.longAsString,
        });
      case "enum":
        return Object.freeze({ kind: "enum", enum: field.enum });
      case "message":
        return Object.freeze({ kind: "message", message: field.message });
      case "list":
      case "map":
        throw new Error(`Record column "${field.name}" must have one singular value.`);
    }
  },
} as const;
Object.freeze(ColumnTypes);

/**
 * Validates present values for fixed-width byte columns.
 */
export const FixedByteWidthValidation: Readonly<{
  /**
   * Requires a present byte value to match its declared exact width.
   *
   * @param type Validated record-column descriptor.
   * @param value Present stored or queried column value.
   * @throws TypeError when a fixed-byte value is not bytes or has the wrong width.
   */
  require(type: RecordColumnType, value: unknown): void;
}> = Object.freeze({
  /**
   * Requires a present byte value to match its declared exact width.
   *
   * @param type Validated record-column descriptor.
   * @param value Present stored or queried column value.
   * @throws TypeError when a fixed-byte value is not bytes or has the wrong width.
   */
  require(type: RecordColumnType, value: unknown): void {
    if (type.kind !== "scalar" || type.byteLength === undefined) return;
    if (!(value instanceof Uint8Array) || value.byteLength !== type.byteLength)
      throw new TypeError(`Fixed-byte column requires exactly ${String(type.byteLength)} bytes.`);
  },
});
