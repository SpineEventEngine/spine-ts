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

import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => {
  const mysqlFactory = {};
  const postgresqlFactory = {};
  const mysqlBuilder = {
    build: vi.fn(() => Promise.resolve(mysqlFactory)),
    setOptions: vi.fn(),
    setStringifierRegistry: vi.fn(),
  };
  const postgresqlBuilder = {
    build: vi.fn(() => Promise.resolve(postgresqlFactory)),
    setOptions: vi.fn(),
    setStringifierRegistry: vi.fn(),
  };
  mysqlBuilder.setOptions.mockReturnValue(mysqlBuilder);
  mysqlBuilder.setStringifierRegistry.mockReturnValue(mysqlBuilder);
  postgresqlBuilder.setOptions.mockReturnValue(postgresqlBuilder);
  postgresqlBuilder.setStringifierRegistry.mockReturnValue(postgresqlBuilder);
  const typeRegistry = {};
  const stringifiers = { setTypeRegistry: vi.fn() };
  return {
    mysqlBuilder,
    mysqlFactory,
    postgresqlBuilder,
    postgresqlFactory,
    stringifiers,
    typeRegistry,
  };
});

vi.mock("@spine-event-engine/core", () => ({
  StringifierRegistry: vi.fn(function StringifierRegistry() {
    return calls.stringifiers;
  }),
  TypeRegistry: { from: vi.fn(() => calls.typeRegistry) },
}));
vi.mock("@spine-event-engine/storage-mysql", () => ({
  MysqlStorageFactory: { newBuilder: vi.fn(() => calls.mysqlBuilder) },
}));
vi.mock("@spine-event-engine/storage-postgres", () => ({
  PostgresStorageFactory: { newBuilder: vi.fn(() => calls.postgresqlBuilder) },
}));
vi.mock("../generated/proto-module.js", () => ({ todoProtoModule: {} }));

import { TodoStorage } from "../src/todo-storage.js";

describe("To-Do single-process storage selection", () => {
  it("keeps the beginner default in memory", async () => {
    await expect(TodoStorage.select({})).resolves.toBeUndefined();
  });

  it("builds MySQL storage with Todo message stringifiers", async () => {
    await expect(
      TodoStorage.select({ TODO_MYSQL_URL: "mysql://todo.example/todo", TODO_STORAGE: "mysql" }),
    ).resolves.toBe(calls.mysqlFactory);

    expect(calls.mysqlBuilder.setOptions).toHaveBeenCalledWith({
      url: "mysql://todo.example/todo",
    });
    expect(calls.mysqlBuilder.setStringifierRegistry).toHaveBeenCalledWith(calls.stringifiers);
    expect(calls.stringifiers.setTypeRegistry).toHaveBeenCalledWith(calls.typeRegistry);
  });

  it("builds PostgreSQL storage with Todo message stringifiers", async () => {
    await expect(
      TodoStorage.select({
        TODO_POSTGRESQL_URL: "postgresql://todo.example/todo",
        TODO_STORAGE: "postgresql",
      }),
    ).resolves.toBe(calls.postgresqlFactory);

    expect(calls.postgresqlBuilder.setOptions).toHaveBeenCalledWith({
      url: "postgresql://todo.example/todo",
    });
    expect(calls.postgresqlBuilder.setStringifierRegistry).toHaveBeenCalledWith(calls.stringifiers);
  });

  it.each([
    [{ TODO_STORAGE: "mysql" }, "TODO_MYSQL_URL"],
    [{ TODO_STORAGE: "postgresql" }, "TODO_POSTGRESQL_URL"],
  ])("rejects a selected backend without %s", async (environment, variable) => {
    await expect(TodoStorage.select(environment)).rejects.toThrow(variable);
  });

  it("rejects unknown storage names without exposing configuration values", async () => {
    const secret = "postgresql://user:secret@todo.example/todo";
    const error = await TodoStorage.select({
      TODO_STORAGE: "sqlite",
      TODO_POSTGRESQL_URL: secret,
    }).catch((failure: unknown) => failure);

    expect(error).toMatchObject({
      message: 'TODO_STORAGE must be "memory", "mysql", or "postgresql".',
    });
    expect((error as Error).message).not.toContain(secret);
  });
});
