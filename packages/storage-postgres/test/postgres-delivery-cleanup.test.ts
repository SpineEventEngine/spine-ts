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

import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { create, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { DeliveryCleanupStorageFactories } from "@spine-event-engine/storage/provider";
import { RecordSpec } from "@spine-event-engine/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => {
  const rows = new Map<string, Uint8Array>();
  const query = vi.fn((sql: string, values: readonly unknown[] = []) => {
    if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
    if (sql.includes("columns WHERE")) return Promise.resolve({ rows: columns() });
    if (sql.includes("PRIMARY KEY"))
      return Promise.resolve({ rows: [{ column_name: "ID", ordinal_position: 1 }] });
    if (sql.startsWith('SELECT "bytes"')) {
      const bytes = rows.get(String(values[0]));
      return Promise.resolve({ rows: bytes === undefined ? [] : [{ bytes }] });
    }
    if (sql.startsWith("DELETE")) {
      const deleted = rows.delete(String(values[0]));
      return Promise.resolve({ rowCount: deleted ? 1 : 0, rows: [] });
    }
    return Promise.resolve({ rowCount: 0, rows: [] });
  });
  const connect = vi.fn(() => Promise.resolve({ query, release: vi.fn() }));
  const Pool = vi.fn(function Pool() {
    return { connect, end: vi.fn(() => Promise.resolve()) };
  });
  return {
    Pool,
    connect,
    query,
    set: (id: string, record: StringValue) => rows.set(id, toBinary(StringValueSchema, record)),
    reset: () => {
      rows.clear();
      query.mockClear();
      connect.mockClear();
    },
  };
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";

describe("PostgreSQL delivery cleanup", () => {
  beforeEach(() => {
    driver.reset();
  });

  it("registers a factory-managed delivery cleanup handle", async () => {
    const factory = await postgresFactory();

    expect(() => DeliveryCleanupStorageFactories.create(factory)).not.toThrow();
  });

  it("uses the ordinary session-record lock before exact Inbox deletion", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", expected);
    driver.set("inbox", expected);
    const cleanup = DeliveryCleanupStorageFactories.create(factory);

    await expect(cleanup.remove(cleanupInput(expected))).resolves.toBe(true);
    const cleanupLock = driver.query.mock.calls.find(([sql]) =>
      sql.includes("pg_advisory_xact_lock($1)"),
    )?.[1]?.[0];
    driver.query.mockClear();
    const records = factory.createRecordStorage({ name: "cleanup", multitenant: false }, spec);
    await records.compareAndSet("session", expected, expected);
    const mutationLock = driver.query.mock.calls.find(([sql]) =>
      sql.includes("pg_advisory_xact_lock($1)"),
    )?.[1]?.[0];

    expect(cleanupLock).toBe(mutationLock);
  });

  it("keeps the Inbox row when the session snapshot is stale", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    driver.set("session", create(StringValueSchema, { value: "replaced" }));
    driver.set("inbox", expected);

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove(cleanupInput(expected)),
    ).resolves.toBe(false);
    expect(driver.query.mock.calls.some(([sql]) => sql.startsWith("DELETE"))).toBe(false);
  });

  it("declines cancellation before opening cleanup record families", async () => {
    const factory = await postgresFactory();
    const expected = create(StringValueSchema, { value: "active" });
    const before = driver.connect.mock.calls.length;

    await expect(
      DeliveryCleanupStorageFactories.create(factory).remove({
        ...cleanupInput(expected),
        operation: { signal: { aborted: true } },
      }),
    ).resolves.toBe(false);
    expect(driver.connect).toHaveBeenCalledTimes(before);
  });
});

const spec = new RecordSpec({
  sourceType: StringValueSchema,
  recordType: StringValueSchema,
  idKind: "string",
  extractId: (record) => record.value,
});

function cleanupInput(expected: StringValue) {
  return {
    context: { name: "cleanup", multitenant: false } as const,
    inbox: { spec, id: "inbox", expected },
    session: {
      spec,
      id: "session",
      expected,
      isCurrent: (record: StringValue) => record.value === "active",
    },
  };
}

function columns() {
  return [
    {
      column_name: "ID",
      data_type: "character varying",
      character_maximum_length: 512,
      is_nullable: "NO",
      column_default: null,
    },
    {
      column_name: "bytes",
      data_type: "bytea",
      character_maximum_length: null,
      is_nullable: "NO",
      column_default: null,
    },
  ];
}

function postgresFactory(): Promise<PostgresStorageFactory> {
  const strings = new StringifierRegistry();
  strings.setTypeRegistry(new TypeRegistry([StringValueSchema]));
  return PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
    .setStringifierRegistry(strings)
    .build();
}
