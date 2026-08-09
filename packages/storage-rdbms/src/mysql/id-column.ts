import { fromJsonString, toJsonString, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

type MysqlIdType<I> = I extends Message ? GenMessage<I> : string;

/**
 * Converts one declared record ID to and from Spine JVM JDBC values.
 */
export class MysqlIdColumn<I> {
  // prettier-ignore

  /**
   * The canonical MySQL ID column type.
   */
  readonly mysqlType: string;

  /**
   * Creates an ID conversion from the declared record ID type.
   *
   * @param type The message schema or supported primitive kind.
   */
  constructor(private readonly type: MysqlIdType<I>) {
    this.mysqlType = MysqlIdTypes.mysqlType(type);
  }

  /**
   * Converts a logical ID to a MySQL parameter.
   * @param id The logical record ID.
   * @returns The JVM-compatible MySQL value.
   */
  value(id: I): unknown {
    if (typeof this.type !== "string")
      return MysqlIdTypes.text(toJsonString(this.type, id as never));
    MysqlIdTypes.validate(this.type, id);
    return this.type === "string" ? MysqlIdTypes.text(id as string) : id;
  }

  /**
   * Converts a MySQL value back to the logical ID.
   * @param value The selected MySQL value.
   * @returns The logical record ID.
   */
  read(value: unknown): I {
    if (typeof this.type !== "string") {
      if (typeof value !== "string") throw new Error("MySQL message ID is not text.");
      return fromJsonString(this.type, value) as I;
    }
    switch (this.type) {
      case "string":
        if (typeof value !== "string") throw new Error("MySQL string ID is invalid.");
        return value as I;
      case "int32": {
        const number = typeof value === "number" ? value : Number(value);
        MysqlIdTypes.validate("int32", number);
        return number as I;
      }
      case "int64": {
        const integer = typeof value === "bigint" ? value : BigInt(value as string | number);
        MysqlIdTypes.validate("int64", integer);
        return integer as I;
      }
      default:
        throw new Error(`MySQL storage does not support primitive ID kind "${this.type}".`);
    }
  }
}

const MysqlIdTypes = Object.freeze({
  text(value: string): string {
    if (value.length > 512) throw new Error("MySQL storage identifier is too large.");
    return value;
  },

  mysqlType<I>(type: MysqlIdType<I>): string {
    if (typeof type !== "string") return "VARCHAR(512)";
    switch (type) {
      case "string":
        return "VARCHAR(512)";
      case "int32":
        return "INT";
      case "int64":
        return "BIGINT";
      default:
        throw new Error(`MySQL storage does not support primitive ID kind "${type}".`);
    }
  },

  validate(type: string, value: unknown): void {
    if (type === "string" && typeof value === "string") return;
    if (
      type === "int32" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= -(2 ** 31) &&
      value < 2 ** 31
    )
      return;
    if (type === "int64" && typeof value === "bigint" && value >= -(1n << 63n) && value < 1n << 63n)
      return;
    throw new Error(`MySQL ${type} ID is invalid.`);
  },
});
