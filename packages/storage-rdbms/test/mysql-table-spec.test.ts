import { describe, expect, it } from "vitest";

import { MysqlTableResolver } from "../src/mysql/table-resolver.js";
import { mysqlColumnType } from "../src/mysql/table-spec.js";

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
    expect(new MysqlTableResolver().resolve("example.Source", "history", undefined, "example.Event").tableName).toBe("history_Event");
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
      expect(() => { resolver.setRecordName("example.Record", name); }).toThrow(/invalid/i);
    expect(() => resolver.resolve("example.Record", undefined, "bad-name")).toThrow(/invalid/i);

    resolver.setRecordName("example.Record", "occupied");
    expect(() => { resolver.setGroupName("example.Source", "example.Event", "occupied"); }).toThrow(
      /collides/i,
    );
  });

  it("rejects collisions between distinct default-resolved families", () => {
    const resolver = new MysqlTableResolver();
    resolver.resolve("example.Source", "group", undefined, "example.Record");
    expect(() => resolver.resolve("other.Source", "group", undefined, "other.Record")).toThrow(/collides/i);
  });

  it("maps declared columns to their native MySQL types", () => {
    expect(["boolean", "number", "bigint", "bytes", "string"].map(mysqlColumnType)).toEqual([
      "BOOLEAN", "DOUBLE", "BIGINT", "MEDIUMBLOB", "VARCHAR(1024)",
    ]);
  });
});
