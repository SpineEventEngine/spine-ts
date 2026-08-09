import type { DescEnum, DescField, DescMessage, ScalarType } from "@bufbuild/protobuf";

declare const columnValueType: unique symbol;

/**
 * Generated Protobuf type retained for one materialized record column.
 */
export type RecordColumnType<V = unknown> = (
  | {
      readonly kind: "scalar";
      readonly scalar: ScalarType;
      readonly longAsString: boolean;
    }
  | {
      readonly kind: "enum";
      readonly enum: DescEnum;
    }
  | {
      readonly kind: "message";
      readonly message: DescMessage;
    }
) & { readonly [columnValueType]?: V };

/**
 * Creates record-column types from generated Protobuf descriptors.
 */
export const ColumnTypes = {
  // prettier-ignore

  /**
   * Declares a scalar type for a derived column value.
   * @param scalar The Protobuf scalar type.
   * @param longAsString Whether a 64-bit value uses its generated string form.
   * @returns The scalar column type.
   */
  scalar<V = unknown>(
    scalar: ScalarType,
    longAsString?: boolean,
  ): RecordColumnType<V> {
    return Object.freeze({ kind: "scalar", scalar, longAsString: longAsString ?? false });
  },

  /**
   * Declares an enum type for a derived column value.
   * @param schema The generated enum descriptor.
   * @returns The enum column type.
   */
  enum<V = unknown>(schema: DescEnum): RecordColumnType<V> {
    return Object.freeze({ kind: "enum", enum: schema });
  },

  /**
   * Declares a message type for a derived column value.
   * @param schema The generated message descriptor.
   * @returns The message column type.
   */
  message<V = unknown>(schema: DescMessage): RecordColumnType<V> {
    return Object.freeze({ kind: "message", message: schema });
  },

  /**
   * Retains the singular value type declared by a generated Protobuf field.
   * @param field The generated field descriptor.
   * @returns The corresponding column type.
   * @throws Error when the field is repeated or a map.
   */
  fromField<V = unknown>(field: DescField): RecordColumnType<V> {
    switch (field.fieldKind) {
      case "scalar":
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
