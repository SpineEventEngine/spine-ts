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
      ].map((type) => PostgresTableSpecs.postgresColumnType(type)),
    ).toEqual(["BYTEA", "TEXT", "INT", "BIGINT", "BOOLEAN", "REAL", "DOUBLE PRECISION"]);
  });

  it("renders JVM-compatible lowercase names and rejects PostgreSQL collisions", () => {
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

  it("builds the complete record-family layout with PostgreSQL payload columns", () => {
    const table = PostgresTableSpecs.resolvedPostgresTableSpec({
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
    expect(table.primaryKey).toEqual(["ID"]);
  });
});
