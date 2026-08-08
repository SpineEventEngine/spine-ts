import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

/**
 * Describes the private physical identity for one record family.
 */
export interface MysqlResolvedTable {
  // prettier-ignore

  /**
   * Names the physical table.
   */
  readonly tableName: string;
}

/**
 * Maps a declared storage column value type to its native MySQL type.
 *
 * @param type Names the storage value type.
 * @returns Returns the native MySQL type.
 */
export function mysqlColumnType(type: string): string {
  switch (type.toLowerCase()) {
    case "boolean":
      return "BOOLEAN";
    case "number":
      return "DOUBLE";
    case "bigint":
      return "BIGINT";
    case "bytes":
      return "MEDIUMBLOB";
    default:
      return "VARCHAR(1024)";
  }
}

/**
 * Describes one public MySQL column in a resolved record-family table.
 */
export interface MysqlColumnSpec {
  // prettier-ignore

  /**
   * Names the physical column.
   */
  readonly name: string;

  /**
   * Specifies the canonical native MySQL type.
   */
  readonly mysqlType: string;

  /**
   * Controls whether the column accepts null values.
   */
  readonly nullable: boolean;

  /**
   * Supplies an optional canonical SQL default expression.
   */
  readonly defaultSql?: string;
}

/**
 * Describes the public resolved MySQL layout for one record family.
 */
export interface MysqlTableSpec<I, R extends Message> {
  // prettier-ignore

  /**
   * Names the physical table.
   */
  readonly tableName: string;

  /**
   * Identifies the record source Protobuf type.
   */
  readonly sourceType: GenMessage<Message>;

  /**
   * Identifies the stored record Protobuf type.
   */
  readonly recordType: GenMessage<R>;

  /**
   * Identifies the storage ID type.
   */
  readonly idType: I extends Message ? GenMessage<I> : string;

  /**
   * Names the optional storage group.
   */
  readonly groupName?: string;

  /**
   * Lists canonical table columns.
   */
  readonly columns: readonly MysqlColumnSpec[];

  /**
   * Lists primary-key column names in order.
   */
  readonly primaryKey: readonly string[];
}

/**
 * Builds the canonical public layout for one resolved record family.
 *
 * @param input Identifies the resolved family and its declared columns.
 * @returns Returns the canonical table layout.
 */
export function resolvedMysqlTableSpec<I, R extends Message>(input: {
  readonly tableName: string;
  readonly sourceType: GenMessage<Message>;
  readonly recordType: GenMessage<R>;
  readonly idType: I extends Message ? GenMessage<I> : string;
  readonly groupName?: string;
  readonly declaredColumns: readonly { readonly name: string; readonly valueType: string }[];
}): MysqlTableSpec<I, R> {
  return {
    tableName: input.tableName,
    sourceType: input.sourceType,
    recordType: input.recordType,
    idType: input.idType,
    ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
    columns: [
      { name: "_scope", mysqlType: "VARBINARY(224)", nullable: false },
      { name: "ID", mysqlType: "VARBINARY(768)", nullable: false },
      { name: "bytes", mysqlType: "MEDIUMBLOB", nullable: false },
      { name: "_revision", mysqlType: "BIGINT UNSIGNED", nullable: false, defaultSql: "0" },
      ...input.declaredColumns.map((column) => ({
        name: column.name,
        mysqlType: mysqlColumnType(column.valueType),
        nullable: true,
      })),
    ],
    primaryKey: ["_scope", "ID"],
  };
}
