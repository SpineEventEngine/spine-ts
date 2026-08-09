import { ScalarType, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringifierRegistry } from "@spine-event-engine/core";
import type {
  ColumnMapping,
  ColumnTypeMapping,
  RecordColumnType,
} from "@spine-event-engine/storage";

const timestampType = "google.protobuf.Timestamp";
const versionType = "spine.core.Version";

/**
 * Converts typed Protobuf column values to Spine JVM JDBC values.
 */
export class MysqlColumnMapping implements ColumnMapping<unknown> {
  readonly #stringifiers: StringifierRegistry;

  /**
   * Creates a JVM-compatible MySQL column mapping.
   *
   * @param stringifiers The schema-bound message stringifiers.
   */
  constructor(stringifiers: StringifierRegistry = new StringifierRegistry()) {
    this.#stringifiers = new StringifierRegistry(stringifiers);
  }

  // prettier-ignore

  /**
   * Returns the conversion for one generated column type.
   *
   * @param type The generated Protobuf column type.
   * @returns The JVM-compatible MySQL parameter conversion.
   */
  of<V>(type: RecordColumnType<V>): ColumnTypeMapping<V, unknown> {
    switch (type.kind) {
      case "scalar":
        return MysqlMappings.scalar(type.scalar);
      case "enum":
        return (value) => value;
      case "message":
        if (type.message.typeName === timestampType) {
          return (value) => MysqlMappings.timestamp(value);
        }
        if (type.message.typeName === versionType) {
          return (value) => MysqlMappings.version(value);
        }
        return (value) =>
          this.#stringifiers
            .forMessage(type.message as GenMessage<Message>)
            .toString(value as Message);
    }
  }

  /**
   * Returns SQL null unchanged.
   * @returns The null conversion.
   */
  ofNull(): ColumnTypeMapping<null, unknown> {
    return (value) => value;
  }
}

const MysqlMappings = Object.freeze({
  scalar<V>(type: ScalarType): ColumnTypeMapping<V, unknown> {
    switch (type) {
      case ScalarType.STRING:
      case ScalarType.INT32:
      case ScalarType.SINT32:
      case ScalarType.SFIXED32:
      case ScalarType.UINT32:
      case ScalarType.FIXED32:
      case ScalarType.INT64:
      case ScalarType.SINT64:
      case ScalarType.SFIXED64:
      case ScalarType.UINT64:
      case ScalarType.FIXED64:
      case ScalarType.BOOL:
      case ScalarType.BYTES:
        return (value) => value;
      case ScalarType.FLOAT:
      case ScalarType.DOUBLE:
        throw new Error("Spine JVM JDBC does not support floating-point record columns.");
    }
  },

  timestamp(value: unknown): bigint {
    const timestamp = value as { readonly seconds: bigint; readonly nanos: number };
    return timestamp.seconds * 1_000_000_000n + BigInt(timestamp.nanos);
  },

  version(value: unknown): number {
    return (value as { readonly number: number }).number;
  },
});
