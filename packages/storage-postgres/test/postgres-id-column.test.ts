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

import { PostgresIdColumn } from "../src/postgres/id-column.js";

describe("PostgresIdColumn", () => {
  it("stores and reads message IDs as compact Proto JSON", () => {
    const column = new PostgresIdColumn(UserIdSchema);
    const id = create(UserIdSchema, { value: "user-42" });

    expect(column.postgresType).toBe("VARCHAR(512)");
    expect(column.value(id)).toBe('{"value":"user-42"}');
    expect(column.read('{"value":"user-42"}')).toEqual(id);
  });

  it("uses the same registered stringifier for message ID writes and reads", () => {
    const registry = new StringifierRegistry();
    registry.register(UserIdSchema, {
      toString: (value) => `user:${value.value}`,
      fromString: (value) => create(UserIdSchema, { value: value.slice(5) }),
    });
    const column = new PostgresIdColumn(UserIdSchema, registry);
    const id = create(UserIdSchema, { value: "42" });

    expect(column.value(id)).toBe("user:42");
    expect(column.read("user:42")).toEqual(id);
  });

  it("uses JDBC-compatible PostgreSQL types and precision-safe bigint reads", () => {
    expect(new PostgresIdColumn("string").postgresType).toBe("VARCHAR(512)");
    expect(new PostgresIdColumn("int32").postgresType).toBe("INT");
    const integer = new PostgresIdColumn("int64");

    expect(integer.postgresType).toBe("BIGINT");
    expect(integer.read("9007199254740993")).toBe(9_007_199_254_740_993n);
  });

  it.each([
    ["string", "record-42", "VARCHAR(512)"],
    ["int32", 42, "INT"],
    ["int64", 42n, "BIGINT"],
  ] as const)("keeps a native %s ID", (kind, id, postgresType) => {
    const column = new PostgresIdColumn(kind);

    expect(column.postgresType).toBe(postgresType);
    expect(column.value(id)).toBe(id);
    expect(column.read(kind === "int64" ? "42" : id)).toBe(id);
  });

  it("rejects an invented primitive ID kind", () => {
    expect(() => new PostgresIdColumn("object")).toThrow(/does not support/i);
  });

  it("rejects provider values that do not match the declared ID type", () => {
    expect(() => new PostgresIdColumn(UserIdSchema).read(42)).toThrow(/message ID is not text/);
    expect(() => new PostgresIdColumn("string").read(42)).toThrow(/string ID is invalid/);
    expect(() => new PostgresIdColumn<unknown>("int32").value("42")).toThrow(/int32 ID is invalid/);
    expect(() => new PostgresIdColumn<unknown>("int32").value(42.5)).toThrow(/int32 ID is invalid/);
    expect(() => new PostgresIdColumn<unknown>("int32").value(2 ** 31)).toThrow(
      /int32 ID is invalid/,
    );
    expect(() => new PostgresIdColumn<unknown>("int64").value(42)).toThrow(/int64 ID is invalid/);
    expect(() => new PostgresIdColumn<unknown>("int64").value(1n << 63n)).toThrow(
      /int64 ID is invalid/,
    );
  });

  it("accepts driver-native and textual integer results", () => {
    expect(new PostgresIdColumn("int32").read("42")).toBe(42);
    expect(new PostgresIdColumn("int64").read(42n)).toBe(42n);
  });

  it("rejects identifiers beyond the shared textual key bound", () => {
    expect(() => new PostgresIdColumn("string").value("x".repeat(513))).toThrow(
      /identifier is too large/,
    );
    const registry = new StringifierRegistry();
    registry.register(UserIdSchema, {
      toString: () => "x".repeat(513),
      fromString: () => create(UserIdSchema),
    });
    expect(() => new PostgresIdColumn(UserIdSchema, registry).value(create(UserIdSchema))).toThrow(
      /identifier is too large/,
    );
  });
});
