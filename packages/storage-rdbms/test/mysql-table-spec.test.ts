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
import { create, ScalarType } from "@bufbuild/protobuf";
import { UserIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { SubscriptionRecordSchema } from "@spine-event-engine/proto/client";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ColumnTypes, RecordColumn } from "@spine-event-engine/storage";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { MysqlTableResolver } from "../src/mysql/table-resolver.js";
import { mysqlColumnType, resolvedMysqlTableSpec } from "../src/mysql/table-spec.js";

describe("MysqlTableResolver", () => {
  it("resolves one stable table for a source and group while separating groups", () => {
    const resolver = new MysqlTableResolver();

    const ungrouped = resolver.resolve("example.task.Task", undefined);
    const grouped = resolver.resolve("example.task.Task", "history");

    expect(ungrouped.tableName).toBe("example_task_Task");
    expect(resolver.resolve("example.task.Task", undefined)).toEqual(ungrouped);
    expect(grouped.tableName).not.toBe(ungrouped.tableName);
  });

  it("uses JVM defaults and gives exact source registrations precedence over record registrations", () => {
    const resolver = new MysqlTableResolver();
    resolver.setRecordName("example.Record", "all_records");
    resolver.setGroupName("example.Source", "example.Record", "source_records");

    expect(resolver.resolve("example.Record", undefined).tableName).toBe("all_records");
    expect(
      resolver.resolve("example.Source", "history", undefined, "example.Record").tableName,
    ).toBe("source_records");
    expect(
      resolver.resolve("example.Other", "history", undefined, "example.Record").tableName,
    ).toBe("all_records");
    expect(
      resolver.resolve("example.Source", "history", "explicit", "example.Record").tableName,
    ).toBe("explicit");
  });

  it("uses the grouped record simple name in the default table name", () => {
    expect(
      new MysqlTableResolver().resolve("example.Source", "history", undefined, "example.Event")
        .tableName,
    ).toBe("history_Event");
  });

  it("uses the latest registration for the same identity", () => {
    const resolver = new MysqlTableResolver();
    resolver.setRecordName("example.Record", "first_name");
    resolver.setRecordName("example.Record", "last_name");

    expect(resolver.resolve("example.Record", undefined).tableName).toBe("last_name");
  });

  it("rejects invalid, blank, overlong, and colliding physical names", () => {
    const resolver = new MysqlTableResolver();

    for (const name of ["", "has-dash", "1leading", "x".repeat(65)])
      expect(() => {
        resolver.setRecordName("example.Record", name);
      }).toThrow(/invalid/i);
    expect(() => resolver.resolve("example.Record", undefined, "bad-name")).toThrow(/invalid/i);

    resolver.setRecordName("example.Record", "occupied");
    expect(() => {
      resolver.setGroupName("example.Source", "example.Event", "occupied");
    }).toThrow(/collides/i);
  });

  it("rejects collisions between distinct default-resolved families", () => {
    const resolver = new MysqlTableResolver();
    resolver.resolve("example.Source", "group", undefined, "example.Record");
    expect(() => resolver.resolve("other.Source", "group", undefined, "other.Record")).toThrow(
      /collides/i,
    );
  });

  it("maps declared columns to their native MySQL types", () => {
    expect(
      [
        ColumnTypes.scalar(ScalarType.BOOL),
        ColumnTypes.scalar(ScalarType.INT32),
        ColumnTypes.scalar(ScalarType.INT64),
        ColumnTypes.scalar(ScalarType.BYTES),
        ColumnTypes.scalar(ScalarType.STRING),
        ColumnTypes.fromField(SubscriptionRecordSchema.field.status),
        ColumnTypes.message(UserIdSchema),
        ColumnTypes.message(TimestampSchema),
        ColumnTypes.message(VersionSchema),
      ].map(mysqlColumnType),
    ).toEqual(["BOOLEAN", "INT", "BIGINT", "BLOB", "TEXT", "INT", "TEXT", "BIGINT", "INT"]);
  });

  it("contains only the JVM record columns and keys by ID", () => {
    const table = resolvedMysqlTableSpec({
      tableName: "records",
      sourceType: StringValueSchema,
      recordType: StringValueSchema,
      idType: "string",
      declaredColumns: [],
    });

    expect(table.columns.map(({ name }) => name)).toEqual(["ID", "bytes"]);
    expect(table.columns[0]?.mysqlType).toBe("VARCHAR(512)");
    expect(table.primaryKey).toEqual(["ID"]);
  });

  it("gives only Entity attributes their JVM defaults", () => {
    const table = resolvedMysqlTableSpec({
      tableName: "message_view",
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idType: "string",
      declaredColumns: [
        new RecordColumn("archived", ColumnTypes.scalar(ScalarType.BOOL), () => false),
        new RecordColumn("deleted", ColumnTypes.scalar(ScalarType.BOOL), () => false),
        new RecordColumn("version", ColumnTypes.message(VersionSchema), () =>
          create(VersionSchema),
        ),
        new RecordColumn("board", ColumnTypes.message(StringValueSchema), (record) => record),
        new RecordColumn("author", ColumnTypes.message(StringValueSchema), (record) => record),
      ],
    });

    expect(table.columns).toEqual([
      { name: "ID", mysqlType: "VARCHAR(512)", nullable: false },
      { name: "bytes", mysqlType: "BLOB", nullable: false },
      { name: "archived", mysqlType: "BOOLEAN", nullable: false, defaultSql: "false" },
      { name: "deleted", mysqlType: "BOOLEAN", nullable: false, defaultSql: "false" },
      { name: "version", mysqlType: "INT", nullable: false, defaultSql: "0" },
      { name: "board", mysqlType: "TEXT", nullable: true },
      { name: "author", mysqlType: "TEXT", nullable: true },
    ]);
  });

  it("leaves same-named ordinary record columns nullable", () => {
    const table = resolvedMysqlTableSpec({
      tableName: "ordinary_record",
      sourceType: StringValueSchema,
      recordType: StringValueSchema,
      idType: "string",
      declaredColumns: [
        new RecordColumn("archived", ColumnTypes.scalar(ScalarType.BOOL), () => false),
        new RecordColumn("deleted", ColumnTypes.scalar(ScalarType.STRING), () => "value"),
        new RecordColumn("version", ColumnTypes.scalar(ScalarType.INT32), () => 1),
      ],
    });

    expect(table.columns.slice(2)).toEqual([
      { name: "archived", mysqlType: "BOOLEAN", nullable: true },
      { name: "deleted", mysqlType: "TEXT", nullable: true },
      { name: "version", mysqlType: "INT", nullable: true },
    ]);
  });

  it("leaves grouped EntityRecord columns nullable", () => {
    const table = resolvedMysqlTableSpec({
      tableName: "entity_history",
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idType: "string",
      groupName: "history",
      declaredColumns: [
        new RecordColumn("archived", ColumnTypes.scalar(ScalarType.BOOL), () => false),
        new RecordColumn("deleted", ColumnTypes.scalar(ScalarType.BOOL), () => false),
        new RecordColumn("version", ColumnTypes.message(VersionSchema), () =>
          create(VersionSchema),
        ),
      ],
    });

    expect(table.columns.slice(2)).toEqual([
      { name: "archived", mysqlType: "BOOLEAN", nullable: true },
      { name: "deleted", mysqlType: "BOOLEAN", nullable: true },
      { name: "version", mysqlType: "INT", nullable: true },
    ]);
  });
});
