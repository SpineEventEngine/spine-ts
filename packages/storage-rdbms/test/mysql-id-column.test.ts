import { create } from "@bufbuild/protobuf";
import { UserIdSchema } from "@spine-event-engine/proto";
import { StringifierRegistry } from "@spine-event-engine/core";
import { describe, expect, it } from "vitest";

import { MysqlIdColumn } from "../src/mysql/id-column.js";

describe("MysqlIdColumn", () => {
  it("stores and reads message IDs as compact Proto JSON", () => {
    const column = new MysqlIdColumn(UserIdSchema);
    const id = create(UserIdSchema, { value: "user-42" });

    expect(column.mysqlType).toBe("VARCHAR(512)");
    expect(column.value(id)).toBe('{"value":"user-42"}');
    expect(column.read('{"value":"user-42"}')).toEqual(id);
  });

  it("uses the same registered stringifier for message ID writes and reads", () => {
    const registry = new StringifierRegistry();
    registry.register(UserIdSchema, {
      toString: (value) => `user:${value.value}`,
      fromString: (value) => create(UserIdSchema, { value: value.slice(5) }),
    });
    const column = new MysqlIdColumn(UserIdSchema, registry);
    const id = create(UserIdSchema, { value: "42" });

    expect(column.value(id)).toBe("user:42");
    expect(column.read("user:42")).toEqual(id);
  });

  it.each([
    ["string", "record-42", "VARCHAR(512)"],
    ["int32", 42, "INT"],
    ["int64", 42n, "BIGINT"],
  ] as const)("keeps a native %s ID", (kind, id, mysqlType) => {
    const column = new MysqlIdColumn(kind);

    expect(column.mysqlType).toBe(mysqlType);
    expect(column.value(id)).toBe(id);
    expect(column.read(kind === "int64" ? "42" : id)).toBe(id);
  });

  it("rejects an invented primitive ID kind", () => {
    expect(() => new MysqlIdColumn("object")).toThrow(/does not support/i);
  });
});
