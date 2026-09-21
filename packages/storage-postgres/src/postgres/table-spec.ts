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

import type { PostgresColumnSpec, PostgresTableSpec } from "./storage-factory.js";
import { PostgresIdColumn } from "./id-column.js";

/**
 * Resolves PostgreSQL-native declared-column and record-family table layouts.
 */
export const PostgresTableSpecs: PostgresTableSpecifications = Object.freeze({
  postgresColumnType(type: RecordColumnType): string {
    switch (type.kind) {
      case "enum":
        return "INT";
      case "message":
        if (type.message.typeName === "google.protobuf.Timestamp") return "BIGINT";
        if (type.message.typeName === "spine.core.Version") return "INT";
        return "TEXT";
      case "scalar":
        return PostgresColumnTypes.scalar(type.scalar);
    }
  },
  resolvedPostgresTableSpec<I, R extends Message>(input: {
    readonly tableName: string;
    readonly sourceType: GenMessage<Message>;
    readonly recordType: GenMessage<R>;
    readonly idType: I extends Message ? GenMessage<I> : string;
    readonly groupName?: string;
    readonly declaredColumns: readonly RecordColumn<R>[];
  }): PostgresTableSpec<I, R> {
    return {
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
        { name: "bytes", postgresType: "BYTEA", nullable: false },
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

interface PostgresTableSpecifications {
  postgresColumnType(type: RecordColumnType): string;
  resolvedPostgresTableSpec<I, R extends Message>(input: {
    readonly tableName: string;
    readonly sourceType: GenMessage<Message>;
    readonly recordType: GenMessage<R>;
    readonly idType: I extends Message ? GenMessage<I> : string;
    readonly groupName?: string;
    readonly declaredColumns: readonly RecordColumn<R>[];
  }): PostgresTableSpec<I, R>;
}

const PostgresColumnTypes = Object.freeze({
  scalar(type: ScalarType): string {
    switch (type) {
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
        return "BYTEA";
      case ScalarType.FLOAT:
        return "REAL";
      case ScalarType.DOUBLE:
        return "DOUBLE PRECISION";
    }
  },

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
