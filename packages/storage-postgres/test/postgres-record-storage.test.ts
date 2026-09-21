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

import { create, ScalarType, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";
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
          {
            column_name: "value",
            data_type: "text",
            character_maximum_length: null,
            is_nullable: "YES",
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
            {
              column_name: "value",
              data_type: "text",
              character_maximum_length: null,
              is_nullable: "YES",
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
        columns: valueColumns(),
      }),
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    const write = driver.calls.find(({ sql }) => sql.startsWith("INSERT INTO"));
    expect(write?.sql).toContain('"spine"."google_protobuf_stringvalue"');
    expect(write?.sql).toContain("VALUES ($1, $2, $3)");
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

  it.each(["40001", "40P01"] as const)(
    "retries compare-and-set once with a fresh client for %s",
    async (code) => {
      const storage = await recordStorage();
      await (storage as unknown as { prepare(): Promise<void> }).prepare();
      vi.clearAllMocks();
      driver.calls.length = 0;
      let failed = false;
      driver.query.mockImplementation((sql: string, values?: readonly unknown[]) => {
        driver.calls.push({ sql, values });
        if (sql === "BEGIN" && !failed) {
          failed = true;
          return Promise.reject(Object.assign(new Error("transaction failure"), { code }));
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
    },
  );

  it("does not retry a non-transactional compare-and-set error", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;
    driver.query.mockImplementation((sql: string, values?: readonly unknown[]) => {
      driver.calls.push({ sql, values });
      if (sql === "BEGIN")
        return Promise.reject(Object.assign(new Error("constraint"), { code: "23505" }));
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" })),
    ).rejects.toThrow("record operation failed");

    expect(driver.connect).toHaveBeenCalledTimes(1);
    expect(driver.calls.map(({ sql }) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(driver.release).toHaveBeenCalledTimes(1);
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

  it("accepts 999 normalized ID binds and reserves the final bind for the candidate bound", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.queryPlan({
      predicate: { kind: "ids", ids: Array.from({ length: 999 }, (_, index) => String(index)) },
    });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain("LIMIT $1000");
    expect(query?.values).toHaveLength(1_000);
    expect(query?.values?.at(-1)).toBe(10_001);
  });

  it("returns no records for an empty ID filter without acquiring a client", async () => {
    const storage = await recordStorage();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await expect(storage.query({ ids: [] })).resolves.toEqual([]);

    expect(driver.connect).not.toHaveBeenCalled();
    expect(driver.calls).toEqual([]);
  });

  it("rejects an unknown normalized column before acquiring a client", async () => {
    const storage = await recordStorage();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await expect(
      storage.queryPlan({
        predicate: { kind: "comparison", column: "missing", operator: "equal", value: "two" },
      }),
    ).rejects.toThrow("not declared");

    expect(driver.connect).not.toHaveBeenCalled();
    expect(driver.calls).toEqual([]);
  });

  it.each([
    ["equal", "IS NOT DISTINCT FROM"],
    ["greaterThan", ">"],
    ["lessThan", "<"],
    ["greaterOrEqual", ">="],
    ["lessOrEqual", "<="],
  ] as const)(
    "pushes the %s comparison into bound PostgreSQL SQL",
    async (operator, sqlOperator) => {
      const storage = await recordStorage();
      await (storage as unknown as { prepare(): Promise<void> }).prepare();
      vi.clearAllMocks();
      driver.calls.length = 0;

      await storage.queryPlan({
        predicate: { kind: "comparison", column: "value", operator, value: "two" },
      });

      const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
      expect(query?.sql).toContain(`WHERE "value" ${sqlOperator} $1`);
      expect(query?.values).toEqual(["two", 10_001]);
    },
  );

  it("pushes nested normalized predicates with declared ordering and a candidate bound", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.queryPlan({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "value", operator: "greaterOrEqual", value: "b" },
          {
            kind: "either",
            predicates: [
              { kind: "ids", ids: ["two"] },
              { kind: "comparison", column: "value", operator: "lessOrEqual", value: "z" },
            ],
          },
        ],
      },
      mask: { paths: ["value"] },
      order: [{ column: "value", direction: "desc" }],
      limit: 8,
      candidateLimit: 2,
    });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain(
      'WHERE ("value" >= $1 AND ("ID" IN ($2) OR "value" <= $3)) ORDER BY "value" DESC NULLS LAST, "ID" ASC LIMIT $4',
    );
    expect(query?.values).toEqual(["b", "two", "z", 3]);
  });

  it("uses null-safe filters and an explicit null continuation predicate", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.query({
      filters: [{ column: "value", value: null }],
      sort: [{ field: "value", direction: "asc" }],
      after: { values: [{ field: "value", value: null }], id: "one" },
      limit: 2,
    });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain('"value" IS NOT DISTINCT FROM $1');
    expect(query?.sql).toContain('("value" IS NOT NULL)');
    expect(query?.sql).toContain('ORDER BY "value" ASC NULLS FIRST, "ID" ASC LIMIT $4');
    expect(query?.values).toEqual([null, null, "one", 2]);
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
      columns: valueColumns(),
    }),
  );
}

function valueColumns(): readonly RecordColumn<StringValue, string>[] {
  return [
    new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
  ];
}
