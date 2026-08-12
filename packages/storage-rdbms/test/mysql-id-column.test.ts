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

  it("rejects provider values that do not match the declared ID type", () => {
    expect(() => new MysqlIdColumn(UserIdSchema).read(42)).toThrow(/message ID is not text/);
    expect(() => new MysqlIdColumn("string").read(42)).toThrow(/string ID is invalid/);
    expect(() => new MysqlIdColumn<unknown>("int32").value("42")).toThrow(/int32 ID is invalid/);
    expect(() => new MysqlIdColumn<unknown>("int32").value(42.5)).toThrow(/int32 ID is invalid/);
    expect(() => new MysqlIdColumn<unknown>("int32").value(2 ** 31)).toThrow(/int32 ID is invalid/);
    expect(() => new MysqlIdColumn<unknown>("int64").value(42)).toThrow(/int64 ID is invalid/);
    expect(() => new MysqlIdColumn<unknown>("int64").value(1n << 63n)).toThrow(
      /int64 ID is invalid/,
    );
  });

  it("accepts driver-native and textual integer results", () => {
    expect(new MysqlIdColumn("int32").read("42")).toBe(42);
    expect(new MysqlIdColumn("int64").read(42n)).toBe(42n);
  });

  it("rejects identifiers beyond the shared textual key bound", () => {
    expect(() => new MysqlIdColumn("string").value("x".repeat(513))).toThrow(
      /identifier is too large/,
    );
    const registry = new StringifierRegistry();
    registry.register(UserIdSchema, {
      toString: () => "x".repeat(513),
      fromString: () => create(UserIdSchema),
    });
    expect(() => new MysqlIdColumn(UserIdSchema, registry).value(create(UserIdSchema))).toThrow(
      /identifier is too large/,
    );
  });
});
