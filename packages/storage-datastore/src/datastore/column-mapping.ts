import { ScalarType, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry } from "@spine-event-engine/core";
import type {
  ColumnMapping,
  ColumnTypeMapping,
  RecordColumnType,
} from "@spine-event-engine/storage";

const timestampType = "google.protobuf.Timestamp";
const versionType = "spine.core.Version";

/**
 * Converts typed Protobuf column values to Spine JVM Datastore values.
 */
export class DatastoreColumnMapping implements ColumnMapping<unknown> {
  readonly #stringifiers: StringifierRegistry;

  /**
   * Creates a JVM-compatible Datastore column mapping.
   *
   * @param stringifiers The schema-bound message stringifiers.
   */
  constructor(stringifiers: StringifierRegistry = new StringifierRegistry()) {
    this.#stringifiers = new StringifierRegistry(stringifiers);
  }

  /**
   * Returns the conversion for one generated column type.
   *
   * @param type The generated Protobuf column type.
   * @returns The JVM-compatible Datastore conversion.
   */
  of<V>(type: RecordColumnType<V>): ColumnTypeMapping<V, unknown> {
    switch (type.kind) {
      case "scalar":
        return DatastoreMappings.scalar(type.scalar);
      case "enum":
        return (value) => Datastore.int(String(value));
      case "message":
        if (type.message.typeName === timestampType)
          return (value) => DatastoreMappings.timestamp(value);
        if (type.message.typeName === versionType)
          return (value) => Datastore.int(String((value as { readonly number: number }).number));
        return (value) =>
          this.#stringifiers
            .forMessage(type.message as GenMessage<Message>)
            .toString(value as Message);
    }
  }

  /**
   * Returns native Datastore null.
   *
   * @returns The null conversion.
   */
  ofNull(): ColumnTypeMapping<null, unknown> {
    return (value) => value;
  }
}

const DatastoreMappings = Object.freeze({
  scalar<V>(type: ScalarType): ColumnTypeMapping<V, unknown> {
    switch (type) {
      case ScalarType.STRING:
      case ScalarType.BOOL:
        return (value) => value;
      case ScalarType.INT32:
      case ScalarType.SINT32:
      case ScalarType.SFIXED32:
        return (value) => Datastore.int(DatastoreMappings.signed(value, 32));
      case ScalarType.UINT32:
      case ScalarType.FIXED32:
        return (value) => Datastore.int(DatastoreMappings.unsigned(value, 32));
      case ScalarType.INT64:
      case ScalarType.SINT64:
      case ScalarType.SFIXED64:
        return (value) => Datastore.int(DatastoreMappings.signed(value, 64));
      case ScalarType.UINT64:
      case ScalarType.FIXED64:
        return (value) => Datastore.int(DatastoreMappings.unsigned(value, 64));
      case ScalarType.FLOAT:
      case ScalarType.DOUBLE:
        return (value) => Datastore.double(value as number);
      case ScalarType.BYTES:
        return (value) => Buffer.from(value as Uint8Array);
    }
  },

  signed(value: unknown, bits: 32 | 64): string {
    const integer = this.integer(value);
    const limit = 1n << BigInt(bits - 1);
    if (integer < -limit || integer >= limit)
      throw new Error(`Datastore signed ${String(bits)}-bit column is outside its range.`);
    return integer.toString();
  },

  unsigned(value: unknown, bits: 32 | 64): string {
    const integer = this.integer(value);
    if (integer < 0n || integer >= 1n << BigInt(bits))
      throw new Error(`Datastore unsigned ${String(bits)}-bit column is outside its range.`);
    if (integer > (1n << 63n) - 1n)
      throw new Error("Datastore integer columns cannot exceed the signed 64-bit provider range.");
    return integer.toString();
  },

  integer(value: unknown): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/u.test(value)) return BigInt(value);
    throw new Error("Datastore integer column is invalid.");
  },

  timestamp(value: unknown): Date {
    const timestamp = value as { readonly seconds: bigint; readonly nanos: number };
    if (
      typeof timestamp.seconds !== "bigint" ||
      !Number.isInteger(timestamp.nanos) ||
      timestamp.nanos < 0 ||
      timestamp.nanos > 999_999_999
    )
      throw new Error("Datastore timestamp column is invalid.");
    return new DatastoreTimestamp(timestamp.seconds, timestamp.nanos);
  },
});

class DatastoreTimestamp extends Date {
  constructor(
    private readonly seconds: bigint,
    private readonly nanos: number,
  ) {
    super(Number(seconds * 1_000n));
    if (!Number.isFinite(super.getTime()))
      throw new Error("Datastore timestamp column is outside the supported range.");
  }

  override getTime(): number {
    return Number(this.seconds * 1_000n);
  }

  override getMilliseconds(): number {
    return this.nanos / 1_000_000;
  }
}
