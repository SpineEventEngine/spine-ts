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

import { ScalarType, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { RecordColumn, RecordColumnType } from "@spine-event-engine/storage";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import { PostgresDataTypes, type PostgresDdlType } from "./data-type.js";
import type { PostgresColumnSpec, PostgresTableSpec } from "./storage-factory.js";
import { PostgresIdColumn } from "./id-column.js";

/**
 * Resolves PostgreSQL-native declared-column and record-family table layouts.
 */
export const PostgresTableSpecs: PostgresTableSpecifications = Object.freeze({
  /**
   * Maps one declared record-column type to PostgreSQL DDL.
   *
   * @param type Declared Protobuf column type.
   * @returns Canonical PostgreSQL DDL type name.
   */
  postgresColumnType(type: RecordColumnType): PostgresDdlType {
    switch (type.kind) {
      case "enum":
        return PostgresDataTypes.integer;
      case "message":
        if (type.message.typeName === "google.protobuf.Timestamp") return PostgresDataTypes.bigInt;
        if (type.message.typeName === "spine.core.Version") return PostgresDataTypes.integer;
        return PostgresDataTypes.text;
      case "scalar":
        return PostgresColumnTypes.scalar(type.scalar);
    }
  },

  /**
   * Builds the complete physical layout for one record family.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf record type.
   * @param input Resolved schema, table, types, group, and declared columns.
   * @returns Complete PostgreSQL table specification.
   */
  resolvedPostgresTableSpec<I, R extends Message>(input: {
    readonly schema: string;
    readonly tableName: string;
    readonly sourceType: GenMessage<Message>;
    readonly recordType: GenMessage<R>;
    readonly idType: I extends Message ? GenMessage<I> : string;
    readonly groupName?: string;
    readonly declaredColumns: readonly RecordColumn<R>[];
  }): PostgresTableSpec<I, R> {
    return {
      schema: input.schema,
      tableName: input.tableName,
      sourceType: input.sourceType,
      recordType: input.recordType,
      idType: input.idType,
      ...(input.groupName === undefined ? {} : { groupName: input.groupName }),
      columns: [
        {
          name: "ID",
          postgresType: new PostgresIdColumn(input.idType).postgresType,
          nullable: false,
        },
        { name: "bytes", postgresType: PostgresDataTypes.bytea, nullable: false },
        ...input.declaredColumns.map((column) =>
          PostgresColumnTypes.spec(
            column,
            input.groupName === undefined &&
              input.recordType.typeName === EntityRecordSchema.typeName,
          ),
        ),
      ],
      primaryKey: ["ID"],
    };
  },
});

/**
 * Describes PostgreSQL table-layout operations.
 */
interface PostgresTableSpecifications {
  /**
   * Maps one declared record-column type to PostgreSQL DDL.
   *
   * @param type Declared Protobuf column type.
   * @returns Canonical PostgreSQL DDL type name.
   */
  postgresColumnType(type: RecordColumnType): PostgresDdlType;

  /**
   * Builds the complete physical layout for one record family.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf record type.
   * @param input Resolved schema, table, types, group, and declared columns.
   * @returns Complete PostgreSQL table specification.
   */
  resolvedPostgresTableSpec<I, R extends Message>(input: {
    readonly schema: string;
    readonly tableName: string;
    readonly sourceType: GenMessage<Message>;
    readonly recordType: GenMessage<R>;
    readonly idType: I extends Message ? GenMessage<I> : string;
    readonly groupName?: string;
    readonly declaredColumns: readonly RecordColumn<R>[];
  }): PostgresTableSpec<I, R>;
}

const PostgresColumnTypes = Object.freeze({
  /**
   * Maps one Protobuf scalar kind to PostgreSQL DDL.
   *
   * @param type Protobuf scalar kind.
   * @returns Canonical PostgreSQL DDL type name.
   */
  scalar(type: ScalarType): PostgresDdlType {
    switch (type) {
      case ScalarType.STRING:
        return PostgresDataTypes.text;
      case ScalarType.INT32:
      case ScalarType.SINT32:
      case ScalarType.SFIXED32:
      case ScalarType.UINT32:
      case ScalarType.FIXED32:
        return PostgresDataTypes.integer;
      case ScalarType.INT64:
      case ScalarType.SINT64:
      case ScalarType.SFIXED64:
      case ScalarType.UINT64:
      case ScalarType.FIXED64:
        return PostgresDataTypes.bigInt;
      case ScalarType.BOOL:
        return PostgresDataTypes.boolean;
      case ScalarType.BYTES:
        return PostgresDataTypes.bytea;
      case ScalarType.FLOAT:
        return PostgresDataTypes.real;
      case ScalarType.DOUBLE:
        return PostgresDataTypes.doublePrecision;
    }
  },

  /**
   * Builds one declared PostgreSQL column specification.
   *
   * @typeParam R Stored Protobuf record type.
   * @param column Declared logical record column.
   * @param currentEntity Whether this is an ungrouped current Entity table.
   * @returns Physical PostgreSQL column specification.
   */
  spec<R extends Message>(column: RecordColumn<R>, currentEntity: boolean): PostgresColumnSpec {
    return {
      name: column.name,
      postgresType: PostgresTableSpecs.postgresColumnType(column.type),
      nullable: !currentEntity || !["archived", "deleted", "version"].includes(column.name),
      ...(currentEntity && ["archived", "deleted"].includes(column.name)
        ? { defaultSql: "false" }
        : currentEntity && column.name === "version"
          ? { defaultSql: "0" }
          : {}),
    };
  },
});
