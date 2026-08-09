import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringifierRegistry } from "@spine-event-engine/core";

type DatastoreIdType<I> = I extends Message ? GenMessage<I> : string;

/**
 * Converts a declared record ID to and from a Spine JVM Datastore key name.
 */
export class DatastoreIdColumn<I> {
  readonly #stringifiers: StringifierRegistry;

  /**
   * Creates the ID conversion.
   *
   * @param type The generated message schema or supported primitive ID kind.
   * @param stringifiers The schema-bound message stringifiers.
   */
  constructor(
    private readonly type: DatastoreIdType<I>,
    stringifiers: StringifierRegistry = new StringifierRegistry(),
  ) {
    this.#stringifiers = new StringifierRegistry(stringifiers);
    DatastoreIds.validateType(type);
  }

  /**
   * Converts a logical ID to a Datastore key name.
   *
   * @param id The logical record identifier.
   * @returns The JVM-compatible key name.
   */
  value(id: I): string {
    const value =
      typeof this.type === "string"
        ? DatastoreIds.primitive(this.type, id)
        : this.#stringifiers.forMessage(this.type).toString(id as never);
    return DatastoreIds.keyName(value);
  }

  /**
   * Restores a logical ID from a Datastore key name.
   *
   * @param value The Datastore key name.
   * @returns The restored record identifier.
   */
  read(value: string): I {
    DatastoreIds.keyName(value);
    if (typeof this.type !== "string")
      return this.#stringifiers.forMessage(this.type).fromString(value) as I;
    switch (this.type) {
      case "string":
        return value as I;
      case "int32": {
        const number = Number(value);
        DatastoreIds.primitive("int32", number);
        return number as I;
      }
      case "int64": {
        const integer = BigInt(value);
        DatastoreIds.primitive("int64", integer);
        return integer as I;
      }
      default:
        throw new Error(`Datastore storage does not support primitive ID kind "${this.type}".`);
    }
  }
}

const DatastoreIds = Object.freeze({
  validateType<I>(type: DatastoreIdType<I>): void {
    if (typeof type !== "string") return;
    if (!["string", "int32", "int64"].includes(type))
      throw new Error(`Datastore storage does not support primitive ID kind "${type}".`);
  },

  primitive(type: string, value: unknown): string {
    if (type === "string" && typeof value === "string") return value;
    if (
      type === "int32" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= -2_147_483_648 &&
      value <= 2_147_483_647
    )
      return String(value);
    if (
      type === "int64" &&
      typeof value === "bigint" &&
      value >= -(1n << 63n) &&
      value <= (1n << 63n) - 1n
    )
      return value.toString();
    throw new Error(`Datastore ${type} identifier is invalid.`);
  },

  keyName(value: string): string {
    if (value.length === 0) throw new Error("Datastore storage identifier must be non-empty.");
    if (Buffer.byteLength(value, "utf8") > 1_500)
      throw new Error("Datastore record key exceeds the 1,500-byte provider limit.");
    return value;
  },
});
