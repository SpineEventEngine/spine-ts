/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-event-engine/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => {
  const calls: { sql: string; values?: readonly unknown[] }[] = [];
  const query = vi.fn((sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
    if (sql.includes("columns WHERE")) {
      return Promise.resolve({
        rows: [
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
        ],
      });
    }
    if (sql.includes("PRIMARY KEY"))
      return Promise.resolve({ rows: [{ column_name: "ID", ordinal_position: 1 }] });
    if (sql.includes("table_constraints")) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rowCount: 1, rows: [] });
  });
  const release = vi.fn();
  const connect = vi.fn(() => Promise.resolve({ query, release }));
  const end = vi.fn(() => Promise.resolve());
  const Pool = vi.fn(function Pool() {
    return { connect, end };
  });
  return { Pool, calls, connect, end, query, release };
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";

describe("Postgres record storage", () => {
  beforeEach(() => {
    driver.query.mockReset();
    driver.query.mockImplementation((sql: string, values?: readonly unknown[]) => {
      driver.calls.push({ sql, values });
      if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
      if (sql.includes("columns WHERE")) {
        return Promise.resolve({
          rows: [
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
          ],
        });
      }
      if (sql.includes("PRIMARY KEY"))
        return Promise.resolve({ rows: [{ column_name: "ID", ordinal_position: 1 }] });
      if (sql.includes("table_constraints")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    driver.connect.mockClear();
    driver.release.mockClear();
    driver.end.mockClear();
    driver.calls.length = 0;
  });

  it("creates a factory record handle that writes with bound PostgreSQL values", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const storage = factory.createRecordStorage(
      { name: "test", multitenant: false },
      new RecordSpec({
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    const write = driver.calls.find(({ sql }) => sql.startsWith("INSERT INTO"));
    expect(write?.sql).toContain('"spine"."google_protobuf_stringvalue"');
    expect(write?.sql).toContain("VALUES ($1, $2)");
    expect(write?.values?.[0]).toBe("one");
    expect(write?.values?.[1]).toBeInstanceOf(Uint8Array);
  });

  it("writes a batch in source order inside one PostgreSQL transaction", async () => {
    const storage = await recordStorage();

    await storage.writeAll([
      create(StringValueSchema, { value: "first" }),
      create(StringValueSchema, { value: "second" }),
    ]);

    const statements = driver.calls.map(({ sql }) => sql);
    const begin = statements.lastIndexOf("BEGIN");
    const commit = statements.lastIndexOf("COMMIT");
    const writes = driver.calls.filter(({ sql }) => sql.startsWith("INSERT INTO"));
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);
    expect(writes.map(({ values }) => values?.[0])).toEqual(["first", "second"]);
  });

  it("prepares before acquiring the operation client for a pool of one", async () => {
    const storage = await recordStorage();
    driver.query.mockImplementationOnce((sql: string, values?: readonly unknown[]) => {
      driver.calls.push({ sql, values });
      expect(sql).toBe("BEGIN");
      expect(driver.connect).toHaveBeenCalledTimes(2);
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await storage.write(create(StringValueSchema, { value: "one" }));
  });

  it("rejects an immutable record when the existing payload differs", async () => {
    const storage = (await recordStorage()) as unknown as {
      write(record: ReturnType<typeof create>): Promise<void>;
      writeImmutable(record: ReturnType<typeof create>): Promise<void>;
    };
    const existing = create(StringValueSchema, { value: "one" });
    await storage.write(existing);
    driver.query.mockImplementation((sql: string, values?: readonly unknown[]) => {
      driver.calls.push({ sql, values });
      if (sql.startsWith("INSERT INTO")) return Promise.resolve({ rowCount: 0, rows: [] });
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: toBinary(StringValueSchema, existing) }] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "two" })),
    ).rejects.toThrow("immutable record collides");
  });

  it("accepts an immutable insert when a conflicting row disappears before inspection", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    let inserts = 0;
    driver.query.mockImplementation((sql: string, values?: readonly unknown[]) => {
      driver.calls.push({ sql, values });
      if (sql.startsWith("INSERT INTO")) {
        inserts += 1;
        return Promise.resolve({ rowCount: 0, rows: [] });
      }
      if (sql.startsWith('SELECT "bytes"')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      (
        storage as unknown as { writeImmutable(record: ReturnType<typeof create>): Promise<void> }
      ).writeImmutable(create(StringValueSchema, { value: "one" })),
    ).resolves.toBeUndefined();

    expect(inserts).toBe(1);
  });

  it("retries a serialization-failed compare-and-set once with a fresh client", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;
    let failed = false;
    driver.query.mockImplementation((sql: string, values?: readonly unknown[]) => {
      driver.calls.push({ sql, values });
      if (sql === "BEGIN" && !failed) {
        failed = true;
        return Promise.reject(Object.assign(new Error("serialization failure"), { code: "40001" }));
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" })),
    ).resolves.toBe(true);

    expect(driver.connect).toHaveBeenCalledTimes(2);
    expect(driver.calls.map(({ sql }) => sql)).toEqual(
      expect.arrayContaining(["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]),
    );
  });

  it("pushes normalized ID selection into one numbered PostgreSQL statement", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.queryPlan({ predicate: { kind: "ids", ids: ["one", "two"] } });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain('WHERE "ID" IN ($1, $2) ORDER BY "ID" ASC LIMIT $3');
    expect(query?.values).toEqual(["one", "two", 10_001]);
  });

  it("rejects an oversized normalized bind plan before acquiring a client", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await expect(
      storage.queryPlan({
        predicate: { kind: "ids", ids: Array.from({ length: 1_000 }, (_, index) => String(index)) },
      }),
    ).rejects.toThrow("bind budget");

    expect(driver.connect).not.toHaveBeenCalled();
    expect(driver.calls).toEqual([]);
  });
});

async function recordStorage() {
  const factory = await PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
    .build();
  return factory.createRecordStorage(
    { name: "test", multitenant: false },
    new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    }),
  );
}
