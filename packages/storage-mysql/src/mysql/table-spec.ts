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

import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { ScalarType } from "@bufbuild/protobuf";
import type { RecordColumn, RecordColumnType } from "@spine-event-engine/storage";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";

import { MysqlIdColumn } from "./id-column.js";

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
 * @param type Retains the generated Protobuf value type.
 * @returns Returns the native MySQL type.
 */
export function mysqlColumnType(type: RecordColumnType): string {
  switch (type.kind) {
    case "enum":
      return "INT";
    case "message":
      if (type.message.typeName === "google.protobuf.Timestamp") return "BIGINT";
      if (type.message.typeName === "spine.core.Version") return "INT";
      return "TEXT";
    case "scalar":
      switch (type.scalar) {
        case ScalarType.STRING:
          return "TEXT";
        case ScalarType.INT32:
        case ScalarType.SINT32:
        case ScalarType.SFIXED32:
        case ScalarType.UINT32:
        case ScalarType.FIXED32:
          return "INT";
        case ScalarType.INT64:
        case ScalarType.SINT64:
        case ScalarType.SFIXED64:
        case ScalarType.UINT64:
        case ScalarType.FIXED64:
          return "BIGINT";
        case ScalarType.BOOL:
          return "BOOLEAN";
        case ScalarType.BYTES:
          return "BLOB";
        case ScalarType.FLOAT:
        case ScalarType.DOUBLE:
          throw new Error("Spine JVM JDBC does not support floating-point record columns.");
      }
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
 * @typeParam I Typed record identifier.
 * @typeParam R Stored record message.
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
 * @typeParam I Typed record identifier.
 * @typeParam R Stored record message.
 */
export function resolvedMysqlTableSpec<I, R extends Message>(input: {
  readonly tableName: string;
  readonly sourceType: GenMessage<Message>;
  readonly recordType: GenMessage<R>;
  readonly idType: I extends Message ? GenMessage<I> : string;
  readonly groupName?: string;
  readonly declaredColumns: readonly RecordColumn<R>[];
}): MysqlTableSpec<I, R> {
  return {
    tableName: input.tableName,
    sourceType: input.sourceType,
    recordType: input.recordType,
    idType: input.idType,
    ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
    columns: [
      { name: "ID", mysqlType: new MysqlIdColumn(input.idType).mysqlType, nullable: false },
      { name: "bytes", mysqlType: "BLOB", nullable: false },
      ...input.declaredColumns.map((column) =>
        mysqlColumnSpec(input.recordType, input.groupName, column),
      ),
    ],
    primaryKey: ["ID"],
  };
}

/**
 * Resolves one native column, including the Agent history index layout.
 * @param recordType Stored record message descriptor.
 * @param groupName Optional storage group.
 * @param column Declared storage column.
 * @returns Resolved native column.
 * @typeParam R Stored record message.
 */
function mysqlColumnSpec<R extends Message>(
  recordType: GenMessage<R>,
  groupName: string | undefined,
  column: RecordColumn<R>,
): MysqlColumnSpec {
  const entityDefault = entityAttributeDefault(recordType, groupName, column);
  const historyType =
    recordType.typeName === AgentHistoryRecordSchema.typeName
      ? AgentHistoryColumnTypes.for(column.name)
      : undefined;
  return {
    name: column.name,
    mysqlType: historyType ?? mysqlColumnType(column.type),
    nullable: entityDefault === undefined,
    ...(entityDefault === undefined ? {} : { defaultSql: entityDefault }),
  };
}

/**
 * Complete order-key bytes available after the fixed digest columns in an InnoDB index.
 */
export const AgentHistoryIndexBytes = 2944;

/**
 * Maps Agent history indexes to complete native binary column types.
 */
const AgentHistoryColumnTypes = Object.freeze({
  /**
   * Returns a native binary type for an Agent history index column.
   * @param name Materialized history column.
   * @returns Native type override for indexed history metadata.
   */
  for(name: string): string | undefined {
    if (name === "order_key") return `VARBINARY(${String(AgentHistoryIndexBytes)})`;
    if (name === "scope_digest" || name === "conversation_digest") return "VARBINARY(64)";
    if (name === "category") return "VARBINARY(12)";
    return undefined;
  },
});

/**
 * Returns the Entity column default expected by legacy table layouts.
 * @param recordType Stored record message descriptor.
 * @param groupName Optional storage group.
 * @param column Declared storage column.
 * @returns Native default expression when one is required.
 * @typeParam R Stored record message.
 */
function entityAttributeDefault<R extends Message>(
  recordType: GenMessage<R>,
  groupName: string | undefined,
  column: RecordColumn<R>,
): string | undefined {
  if (recordType.typeName !== "spine.server.entity.EntityRecord" || groupName !== undefined)
    return undefined;
  switch (column.name) {
    case "archived":
    case "deleted":
      return column.type.kind === "scalar" && column.type.scalar === ScalarType.BOOL
        ? "false"
        : undefined;
    case "version":
      return column.type.kind === "message" && column.type.message.typeName === "spine.core.Version"
        ? "0"
        : undefined;
    default:
      return undefined;
  }
}
