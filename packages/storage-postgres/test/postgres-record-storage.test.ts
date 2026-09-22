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

import { create, ScalarType, toBinary } from "@bufbuild/protobuf";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { ColumnTypes, RecordColumn, RecordSpec, StorageGroup } from "@spine-event-engine/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  readonly rowCount?: number;
  readonly rows: readonly Record<string, unknown>[];
}
type Query = (sql: string, values?: readonly unknown[]) => Promise<QueryResult>;

const driver = vi.hoisted(() => {
  const calls: { sql: string; values?: readonly unknown[] }[] = [];
  const recordCall = (sql: string, values: readonly unknown[] | undefined) => {
    calls.push(values === undefined ? { sql } : { sql, values });
  };
  const query = vi.fn<Query>((sql, values) => {
    recordCall(sql, values);
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
  return { Pool, calls, connect, end, query, recordCall, release };
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";
import { PostgresClientDisposal, PostgresTransactionErrors } from "../src/postgres/errors.js";

describe("Postgres record storage", () => {
  beforeEach(() => {
    driver.query.mockReset();
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
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

  it("classifies only PostgreSQL retry codes and tracks discarded clients", () => {
    const error = new Error("operation");

    expect(PostgresTransactionErrors.retryable({ code: "40001" })).toBe(true);
    expect(PostgresTransactionErrors.retryable({ code: "other" })).toBe(false);
    expect(PostgresTransactionErrors.retryable(undefined)).toBe(false);
    expect(PostgresClientDisposal.required(error)).toBe(false);
    PostgresClientDisposal.mark(error);
    expect(PostgresClientDisposal.required(error)).toBe(true);
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

  it("passes each resolved schema to custom table creation", async () => {
    const operations: { schema: string; sql: string }[] = [];
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "explicit_schema" })
      .useOperationFactory((table) => {
        const sql = `CREATE TABLE IF NOT EXISTS "${table.schema}"."${table.tableName}" ()`;
        operations.push({ schema: table.schema, sql });
        return { sql };
      })
      .build();
    const storage = factory.createRecordStorage(
      { name: "explicit", multitenant: false },
      recordSpec(),
    );

    await storage.write(create(StringValueSchema, { value: "explicit" }));

    expect(operations).toEqual([
      {
        schema: "explicit_schema",
        sql: 'CREATE TABLE IF NOT EXISTS "explicit_schema"."google_protobuf_stringvalue" ()',
      },
    ]);
  });

  it("passes distinct tenant schemas to custom table creation", async () => {
    const schemas: string[] = [];
    const factory = await PostgresStorageFactory.newBuilder()
      .setTenantOptions([
        {
          tenantId: create(TenantIdSchema, { kind: { case: "value", value: "a" } }),
          options: { url: "postgresql://db.example/tenant_a", schema: "tenant_a_schema" },
        },
        {
          tenantId: create(TenantIdSchema, { kind: { case: "value", value: "b" } }),
          options: { url: "postgresql://db.example/tenant_b", schema: "tenant_b_schema" },
        },
      ])
      .useOperationFactory((table) => {
        schemas.push(table.schema);
        return { sql: `CREATE TABLE IF NOT EXISTS "${table.schema}"."${table.tableName}" ()` };
      })
      .build();
    const first = factory.createRecordStorage(
      { name: "tenant", multitenant: true, tenantId: tenantId("a") },
      recordSpec(),
    );
    const second = factory.createRecordStorage(
      { name: "tenant", multitenant: true, tenantId: tenantId("b") },
      recordSpec(),
    );

    await first.write(create(StringValueSchema, { value: "first" }));
    await second.write(create(StringValueSchema, { value: "second" }));

    expect(schemas).toEqual(["tenant_a_schema", "tenant_b_schema"]);
  });

  it("routes a public grouped table-name registration only to its grouped family", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .setTableName(StringValueSchema, StringValueSchema, "GroupedTable")
      .build();
    const grouped = factory.createRecordStorage(
      { name: "test", multitenant: false },
      recordSpec(),
      new StorageGroup("audit"),
    );
    const ungrouped = factory.createRecordStorage(
      { name: "test", multitenant: false },
      recordSpec(),
    );

    await grouped.write(create(StringValueSchema, { value: "grouped" }));
    await ungrouped.write(create(StringValueSchema, { value: "plain" }));

    const createdTables = driver.calls
      .filter(({ sql }) => sql.startsWith("CREATE TABLE IF NOT EXISTS"))
      .map(({ sql }) => /CREATE TABLE IF NOT EXISTS ("[^"]+"\."[^"]+")/.exec(sql)?.[1]);

    expect(createdTables).toEqual([
      '"spine"."groupedtable"',
      '"spine"."google_protobuf_stringvalue"',
    ]);
  });

  it("closes live record handles once and rejects record creation after factory close", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const storage = factory.createRecordStorage({ name: "test", multitenant: false }, recordSpec());

    factory.close();
    factory.close();
    await Promise.resolve();

    expect(storage.isOpen()).toBe(false);
    expect(driver.end).toHaveBeenCalledOnce();
    expect(() =>
      factory.createRecordStorage({ name: "test", multitenant: false }, recordSpec()),
    ).toThrow(/closed/i);
  });

  it("rejects a tenant-bound record request from a single-tenant factory", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();

    expect(() =>
      factory.createRecordStorage(
        {
          name: "tenant",
          multitenant: true,
          tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }),
        },
        recordSpec(),
      ),
    ).toThrow(/no configured database/i);
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

  it.each(["40001", "40P01"] as const)(
    "retries the complete writeAll transaction once on a fresh client for %s",
    async (code) => {
      const storage = await recordStorage();
      await (storage as unknown as { prepare(): Promise<void> }).prepare();
      vi.clearAllMocks();
      driver.calls.length = 0;
      let failed = false;
      driver.query.mockImplementation((sql, values) => {
        driver.recordCall(sql, values);
        if (sql === "BEGIN" && !failed) {
          failed = true;
          return Promise.reject(Object.assign(new Error("retry"), { code }));
        }
        return Promise.resolve({ rowCount: 1, rows: [] });
      });

      await storage.writeAll([create(StringValueSchema, { value: "one" })]);

      expect(driver.connect).toHaveBeenCalledTimes(2);
      expect(driver.calls.map(({ sql }) => sql)).toEqual(
        expect.arrayContaining(["ROLLBACK", "COMMIT"]),
      );
    },
  );

  it("stops writeAll after its one retry", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql === "BEGIN")
        return Promise.reject(Object.assign(new Error("retry"), { code: "40001" }));
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.writeAll([create(StringValueSchema, { value: "one" })])).rejects.toThrow(
      /record operation failed/i,
    );

    expect(driver.connect).toHaveBeenCalledTimes(2);
  });

  it("sanitizes a record-driver failure and releases its operation client", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith("INSERT INTO")) return Promise.reject(new Error("secret driver detail"));
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.write(create(StringValueSchema, { value: "one" }))).rejects.toThrow(
      "record operation failed",
    );

    expect(driver.release).toHaveBeenCalledOnce();
  });

  it("discards a transaction client when the operation and rollback both fail", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql === "BEGIN") return Promise.reject(new Error("secret operation"));
      if (sql === "ROLLBACK") return Promise.reject(new Error("secret rollback"));
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.write(create(StringValueSchema, { value: "one" }))).rejects.toThrow(
      "record operation failed",
    );
    expect(driver.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it("reads one stored record and reports whether deletion changed a row", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const record = create(StringValueSchema, { value: "stored" });
    let deleted = false;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"') && values?.[0] === "missing")
        return Promise.resolve({ rows: [] });
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: toBinary(StringValueSchema, record) }] });
      if (sql.startsWith("DELETE")) {
        deleted = !deleted;
        return Promise.resolve({ rowCount: deleted ? 1 : 0, rows: [] });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.read("stored")).resolves.toEqual(record);
    await expect(storage.read("missing")).resolves.toBeUndefined();
    await expect(storage.delete("stored")).resolves.toBe(true);
    await expect(storage.delete("stored")).resolves.toBe(false);
  });

  it("rejects corrupt stored bytes and preserves the provider data-error boundary", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: Uint8Array.of(255) }] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.read("corrupt")).rejects.toThrow(
      /stored PostgreSQL record data is invalid/i,
    );
  });

  it("prepares before acquiring the operation client for a pool of one", async () => {
    const storage = await recordStorage();
    driver.query.mockImplementationOnce((sql, values) => {
      driver.recordCall(sql, values);
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
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith("INSERT INTO")) return Promise.resolve({ rowCount: 0, rows: [] });
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: toBinary(StringValueSchema, existing) }] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "two" })),
    ).rejects.toThrow("immutable record collides");
  });

  it("persists an immutable record when its ID has no conflict", async () => {
    const storage = await recordStorage();

    await expect(
      (storage as unknown as { writeImmutable(record: StringValue): Promise<void> }).writeImmutable(
        create(StringValueSchema, { value: "new" }),
      ),
    ).resolves.toBeUndefined();

    expect(driver.calls.some(({ sql }) => sql.includes('ON CONFLICT ("ID") DO NOTHING'))).toBe(
      true,
    );
  });

  it("accepts an immutable record when the conflicting payload is identical", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const record = create(StringValueSchema, { value: "one" });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith("INSERT INTO")) return Promise.resolve({ rowCount: 0, rows: [] });
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: toBinary(StringValueSchema, record) }] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      (storage as unknown as { writeImmutable(value: StringValue): Promise<void> }).writeImmutable(
        record,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts an immutable insert when a conflicting row disappears before inspection", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    let inserts = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
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
      driver.query.mockImplementation((sql, values) => {
        driver.recordCall(sql, values);
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

  it("stops after the single permitted retry and releases both CAS clients", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql === "BEGIN")
        return Promise.reject(Object.assign(new Error("serialization failure"), { code: "40001" }));
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" })),
    ).rejects.toThrow("record operation failed");

    expect(driver.connect).toHaveBeenCalledTimes(2);
    expect(driver.calls.filter(({ sql }) => sql === "ROLLBACK")).toHaveLength(2);
    expect(driver.release).toHaveBeenCalledTimes(2);
  });

  it("deletes the matching current row through compare-and-set", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const current = create(StringValueSchema, { value: "one" });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: toBinary(StringValueSchema, current) }] });
      if (sql.startsWith("DELETE")) return Promise.resolve({ rowCount: 1, rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.compareAndSet("one", current, undefined)).resolves.toBe(true);
    expect(driver.calls.some(({ sql }) => sql.startsWith("DELETE"))).toBe(true);
  });

  it("writes a compare-and-set replacement at the caller-selected slot", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;

    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "record-body" })),
    ).resolves.toBe(true);

    const write = driver.calls.find(({ sql }) => sql.startsWith("INSERT INTO"));
    expect(write?.values?.[0]).toBe("slot");
  });

  it("does not retry a non-transactional compare-and-set error", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
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

  it("returns false without mutation when compare-and-set finds a different payload", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const stored = create(StringValueSchema, { value: "stored" });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: toBinary(StringValueSchema, stored) }] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.compareAndSet(
        "one",
        create(StringValueSchema, { value: "expected" }),
        create(StringValueSchema, { value: "next" }),
      ),
    ).resolves.toBe(false);

    expect(driver.calls.some(({ sql }) => sql.startsWith("INSERT INTO"))).toBe(false);
    expect(driver.calls.map(({ sql }) => sql)).toEqual(expect.arrayContaining(["BEGIN", "COMMIT"]));
  });

  it("derives distinct transaction advisory keys for distinct storage IDs", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;

    await storage.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" }));
    await storage.compareAndSet("two", undefined, create(StringValueSchema, { value: "two" }));

    const keys = driver.calls
      .filter(({ sql }) => sql === "SELECT pg_advisory_xact_lock($1)")
      .map(({ values }) => values?.[0]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toEqual(keys[1]);
  });

  it("serializes an expected-absent compare-and-set ahead of a normal write", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const scheduler = lockedQueries();
    driver.connect.mockImplementationOnce(() => Promise.resolve(scheduler.client("cas")));
    driver.connect.mockImplementationOnce(() => Promise.resolve(scheduler.client("write")));

    const cas = storage.compareAndSet(
      "slot",
      undefined,
      create(StringValueSchema, { value: "cas" }),
    );
    await scheduler.casLocked;
    const write = storage.write(create(StringValueSchema, { value: "slot" }));
    await scheduler.mutationReached;
    scheduler.releaseCas();

    await expect(cas).resolves.toBe(true);
    await expect(write).resolves.toBeUndefined();
    expect(scheduler.writes).toEqual(["cas", "write"]);
  });

  it("serializes an expected-absent compare-and-set ahead of an immutable write", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const scheduler = lockedQueries();
    driver.connect.mockImplementationOnce(() => Promise.resolve(scheduler.client("cas")));
    driver.connect.mockImplementationOnce(() => Promise.resolve(scheduler.client("immutable")));

    const cas = storage.compareAndSet(
      "slot",
      undefined,
      create(StringValueSchema, { value: "slot" }),
    );
    await scheduler.casLocked;
    const immutable = (
      storage as unknown as { writeImmutable(record: StringValue): Promise<void> }
    ).writeImmutable(create(StringValueSchema, { value: "slot" }));
    await scheduler.mutationReached;
    scheduler.releaseCas();

    await expect(cas).resolves.toBe(true);
    await expect(immutable).resolves.toBeUndefined();
    expect(scheduler.writes).toEqual(["cas", "immutable"]);
  });

  it("locks each writeAll slot once in stable order without reordering writes", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;

    await storage.writeAll([
      create(StringValueSchema, { value: "two" }),
      create(StringValueSchema, { value: "one" }),
      create(StringValueSchema, { value: "two" }),
    ]);

    const locks = driver.calls
      .filter(({ sql }) => sql === "SELECT pg_advisory_xact_lock($1)")
      .map(({ values }) => values?.[0] as bigint);
    const writes = driver.calls
      .filter(({ sql }) => sql.startsWith("INSERT INTO"))
      .map(({ values }) => values?.[0]);
    expect(locks).toEqual([...new Set(locks)].sort((left, right) => (left < right ? -1 : 1)));
    expect(writes).toEqual(["two", "one", "two"]);
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

  it("pushes record IDs and column filters into one PostgreSQL query", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.query({ ids: ["one", "two"], filters: [{ column: "value", value: "two" }] });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain('WHERE "ID" IN ($1, $2) AND "value" IS NOT DISTINCT FROM $3');
    expect(query?.sql).toContain('ORDER BY "ID" ASC');
    expect(query?.values).toEqual(["one", "two", "two"]);
  });

  it("uses the PostgreSQL finite offset window when no explicit record limit is supplied", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.query({ offset: 4 });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain('ORDER BY "ID" ASC LIMIT $1 OFFSET $2');
    expect(query?.values).toEqual([9_223_372_036_854_775_807n, 4]);
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

  it("uses PostgreSQL's finite offset window and descending null order", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.query({ sort: [{ field: "value", direction: "desc" }], limit: 3, offset: 2 });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain('ORDER BY "value" DESC NULLS LAST, "ID" ASC LIMIT $1 OFFSET $2');
    expect(query?.values).toEqual([3, 2]);
  });

  it("continues descending records after a non-null value and includes the ID tie-breaker", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;

    await storage.query({
      sort: [{ field: "value", direction: "desc" }],
      after: { values: [{ field: "value", value: "middle" }], id: "one" },
      limit: 2,
    });

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain('"value" < $1');
    expect(query?.sql).toContain('"value" IS NOT DISTINCT FROM $2 AND "ID" > $3');
    expect(query?.values).toEqual(["middle", "middle", "one", 2]);
  });

  it("decodes stable ID-tied query rows in PostgreSQL result order", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const first = create(StringValueSchema, { value: "first" });
    const second = create(StringValueSchema, { value: "second" });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "ID", "bytes"')) {
        return Promise.resolve({
          rows: [
            { ID: "first", bytes: toBinary(StringValueSchema, first) },
            { ID: "second", bytes: toBinary(StringValueSchema, second) },
          ],
        });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.query({ sort: [{ field: "value" }] })).resolves.toEqual([first, second]);

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).toContain('ORDER BY "value" ASC NULLS FIRST, "ID" ASC');
  });

  it("requests one overflow candidate and rejects it after decoded plan evaluation", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    const first = create(StringValueSchema, { value: "first" });
    const second = create(StringValueSchema, { value: "second" });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "ID", "bytes"')) {
        return Promise.resolve({
          rows: [
            { ID: "first", bytes: toBinary(StringValueSchema, first) },
            { ID: "second", bytes: toBinary(StringValueSchema, second) },
          ],
        });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.queryPlan({ candidateLimit: 1 })).rejects.toThrow(/candidate limit/i);

    const query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.values).toEqual([2]);
  });
});

async function recordStorage() {
  const factory = await PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
    .build();
  return factory.createRecordStorage({ name: "test", multitenant: false }, recordSpec());
}

function recordSpec(): RecordSpec<string, StringValue> {
  return new RecordSpec({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
    columns: valueColumns(),
  });
}

function valueColumns(): readonly RecordColumn<StringValue, string>[] {
  return [
    new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
  ];
}

function tenantId(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

function lockedQueries() {
  const writes: string[] = [];
  const held = new Map<bigint, string>();
  const clientLocks = new Map<string, Set<bigint>>();
  const waiters = new Map<bigint, (() => void)[]>();
  let releaseCas = () => undefined;
  let signalCasLocked = () => undefined;
  let signalMutationReached = () => undefined;
  const casLocked = new Promise<void>((resolve) => {
    signalCasLocked = resolve;
  });
  const casReleased = new Promise<void>((resolve) => {
    releaseCas = resolve;
  });
  const mutationReached = new Promise<void>((resolve) => {
    signalMutationReached = resolve;
  });
  const client = (name: string) => ({
    query: (sql: string, parameters?: readonly unknown[]) =>
      lockedQuery(
        name,
        sql,
        parameters,
        writes,
        held,
        clientLocks,
        waiters,
        signalMutationReached,
        async () => {
          if (name !== "cas") return;
          signalCasLocked();
          await casReleased;
        },
      ),
    release: vi.fn(),
  });
  return { casLocked, client, mutationReached, releaseCas, writes };
}

async function lockedQuery(
  client: string,
  sql: string,
  parameters: readonly unknown[] | undefined,
  writes: string[],
  held: Map<bigint, string>,
  clientLocks: Map<string, Set<bigint>>,
  waiters: Map<bigint, (() => void)[]>,
  mutationReached: () => void,
  onCasLock: () => Promise<void>,
): Promise<QueryResult> {
  if (client !== "cas" && (sql === "SELECT pg_advisory_xact_lock($1)" || sql.startsWith("INSERT")))
    mutationReached();
  if (sql === "SELECT pg_advisory_xact_lock($1)") {
    const key = parameters?.[0] as bigint;
    await lock(client, key, held, clientLocks, waiters);
    await onCasLock();
  } else if (sql.startsWith('SELECT "bytes"')) {
    return { rows: [] };
  } else if (sql.startsWith("INSERT INTO")) {
    writes.push(client);
  } else if (sql === "COMMIT" || sql === "ROLLBACK")
    releaseLocks(client, held, clientLocks, waiters);
  return { rowCount: 1, rows: [] };
}

function lock(
  client: string,
  key: bigint,
  held: Map<bigint, string>,
  clientLocks: Map<string, Set<bigint>>,
  waiters: Map<bigint, (() => void)[]>,
): Promise<void> {
  if (held.get(key) === undefined) {
    takeLock(client, key, held, clientLocks);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const queued = waiters.get(key) ?? [];
    queued.push(() => {
      takeLock(client, key, held, clientLocks);
      resolve();
    });
    waiters.set(key, queued);
  });
}

function takeLock(
  client: string,
  key: bigint,
  held: Map<bigint, string>,
  clientLocks: Map<string, Set<bigint>>,
): void {
  held.set(key, client);
  let locks = clientLocks.get(client);
  if (locks === undefined) {
    locks = new Set();
    clientLocks.set(client, locks);
  }
  locks.add(key);
}

function releaseLocks(
  client: string,
  held: Map<bigint, string>,
  clientLocks: Map<string, Set<bigint>>,
  waiters: Map<bigint, (() => void)[]>,
): void {
  for (const key of clientLocks.get(client) ?? []) {
    held.delete(key);
    waiters.get(key)?.shift()?.();
  }
  clientLocks.delete(client);
}
