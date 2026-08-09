import { ScalarType } from "@bufbuild/protobuf";
import { UserIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { SubscriptionRecordSchema } from "@spine-event-engine/proto/client";
import { ColumnTypes } from "@spine-event-engine/storage";
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
});
