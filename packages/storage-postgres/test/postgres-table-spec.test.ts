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

import { ScalarType } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ColumnTypes, RecordColumn } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { PostgresTableSpecs } from "../src/postgres/table-spec.js";
import { PostgresTableResolver } from "../src/postgres/table-resolver.js";

describe("PostgreSQL table foundation", () => {
  it("maps PostgreSQL-native scalar types including float and double", () => {
    expect(
      [
        ColumnTypes.scalar(ScalarType.BYTES),
        ColumnTypes.scalar(ScalarType.STRING),
        ColumnTypes.scalar(ScalarType.INT32),
        ColumnTypes.scalar(ScalarType.INT64),
        ColumnTypes.scalar(ScalarType.BOOL),
        ColumnTypes.scalar(ScalarType.FLOAT),
        ColumnTypes.scalar(ScalarType.DOUBLE),
        ColumnTypes.message(StringValueSchema),
      ].map((type) => PostgresTableSpecs.postgresColumnType(type)),
    ).toEqual(["BYTEA", "TEXT", "INT", "BIGINT", "BOOLEAN", "REAL", "DOUBLE PRECISION", "TEXT"]);
  });

  it("renders JVM-compatible PostgreSQL identifiers without ASCII-only rejection", () => {
    const resolver = new PostgresTableResolver();

    expect(resolver.resolve("example.Task", undefined).tableName).toBe("example_task");
    resolver.setRecordName(StringValueSchema.typeName, "MixedCase");
    expect(resolver.resolve(StringValueSchema.typeName, undefined).tableName).toBe("mixedcase");
    expect(() => {
      resolver.setRecordName("example.Other", "mixedcase");
    }).toThrow(/collides/i);
    expect(() => {
      resolver.setRecordName("example.Long", "a".repeat(64));
    }).toThrow(/invalid/i);
    resolver.setRecordName("example.Unicode", "éclair");
    expect(resolver.resolve("example.Unicode", undefined).tableName).toBe("éclair");
  });

  it("resolves grouped defaults and explicit names while refusing reused physical tables", () => {
    const resolver = new PostgresTableResolver();

    expect(resolver.resolve("example.Source", "audit", undefined, "example.Record").tableName).toBe(
      "audit_record",
    );
    expect(
      resolver.resolve("example.Other", "audit", "ExplicitName", "example.Record").tableName,
    ).toBe("explicitname");
    expect(resolver.resolve("example.Source", "audit").tableName).toBe("audit_source");
    resolver.setRecordName("example.Source", "source_table");
    resolver.setRecordName("example.Source", "renamed_source_table");
    resolver.resolve("example.First", undefined, "shared_table");

    expect(() => resolver.resolve("example.Second", undefined, "shared_table")).toThrow(
      /collides/i,
    );
  });

  it("preserves quoted PostgreSQL identifier spelling for reserved and non-ASCII names", () => {
    const resolver = new PostgresTableResolver();

    expect(resolver.resolve("example.Source", undefined, "Select").tableName).toBe("Select");
    expect(resolver.resolve("example.Cross", undefined, "Cross").tableName).toBe("Cross");
    expect(resolver.resolve("example.Collation", undefined, "Collation").tableName).toBe(
      "Collation",
    );
    expect(resolver.resolve("example.Between", undefined, "Between").tableName).toBe("between");
    expect(resolver.resolve("example.New", undefined, "New").tableName).toBe("new");
    expect(resolver.resolve("example.Unicode", undefined, "Éclair").tableName).toBe("Éclair");
    expect(() => resolver.resolve("example.Bad", undefined, "bad name")).toThrow(/invalid/i);
    expect(() => resolver.resolve("example.Nul", undefined, "bad\u0000name")).toThrow(/invalid/i);
  });

  it("matches JVM physical-name byte, collision, and grouped-name boundaries", () => {
    const resolver = new PostgresTableResolver();
    const sixtyThree = "a".repeat(63);

    expect(resolver.resolve("Example.Mixed", undefined).tableName).toBe("example_mixed");
    expect(resolver.resolve("example.Custom", undefined, "MixedCase").tableName).toBe("mixedcase");
    expect(
      resolver.resolve("example.Group", "states", "StateTable", "example.Record").tableName,
    ).toBe("statetable");
    expect(resolver.resolve("example.Bytes", undefined, sixtyThree).tableName).toBe(sixtyThree);
    resolver.resolve("example.First", undefined, "CaseOnly");
    expect(() => resolver.resolve("example.Second", undefined, "caseonly")).toThrow(/collides/i);
    expect(() => resolver.resolve("example.Long", undefined, `${sixtyThree}x`)).toThrow(/invalid/i);
    expect(() => resolver.resolve("example.Empty", undefined, "")).toThrow(/invalid/i);
  });

  it("builds the complete record-family layout with PostgreSQL payload columns", () => {
    const table = PostgresTableSpecs.resolvedPostgresTableSpec({
      schema: "spine",
      tableName: "records",
      sourceType: StringValueSchema,
      recordType: StringValueSchema,
      idType: "string",
      declaredColumns: [new RecordColumn("ratio", ColumnTypes.scalar(ScalarType.FLOAT), () => 0)],
    });

    expect(table.columns).toEqual([
      { name: "ID", postgresType: "VARCHAR(512)", nullable: false },
      { name: "bytes", postgresType: "BYTEA", nullable: false },
      { name: "ratio", postgresType: "REAL", nullable: true },
    ]);
    expect(table.schema).toBe("spine");
    expect(table.primaryKey).toEqual(["ID"]);
  });

  it("defaults ungrouped current Entity status columns without changing grouped history columns", () => {
    const columns = [
      new RecordColumn("archived", ColumnTypes.scalar(ScalarType.BOOL), () => false),
      new RecordColumn("deleted", ColumnTypes.scalar(ScalarType.BOOL), () => false),
      new RecordColumn("version", ColumnTypes.scalar(ScalarType.INT32), () => 0),
    ];
    const current = PostgresTableSpecs.resolvedPostgresTableSpec({
      schema: "spine",
      tableName: "current",
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idType: "string",
      declaredColumns: columns,
    });
    const history = PostgresTableSpecs.resolvedPostgresTableSpec({
      schema: "spine",
      tableName: "history",
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idType: "string",
      groupName: "states",
      declaredColumns: columns,
    });

    expect(current.columns.slice(-3)).toEqual([
      { name: "archived", postgresType: "BOOLEAN", nullable: false, defaultSql: "false" },
      { name: "deleted", postgresType: "BOOLEAN", nullable: false, defaultSql: "false" },
      { name: "version", postgresType: "INT", nullable: false, defaultSql: "0" },
    ]);
    expect(history.columns.slice(-3).every((column) => column.nullable)).toBe(true);
  });
});
