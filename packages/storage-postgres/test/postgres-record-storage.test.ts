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
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  StorageGroup,
  type NormalizedQueryPlan,
} from "@spine-event-engine/storage";
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
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { PostgresClientDisposal, PostgresTransactionErrors } from "../src/postgres/errors.js";
import { PostgresRecordStorage } from "../src/postgres/record-storage.js";
import { PostgresTableSpecs } from "../src/postgres/table-spec.js";

describe("Postgres record storage", () => {
  it("binds each legacy scalar-list member and makes an empty list match no rows", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;

    await storage.queryEntries({ filters: [{ column: "value", value: ["one", "two", "one"] }] });
    const listed = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(listed?.sql).toContain(
      '("value" IS NOT DISTINCT FROM $1 OR "value" IS NOT DISTINCT FROM $2 OR "value" IS NOT DISTINCT FROM $3)',
    );
    expect(listed?.values?.slice(0, 3)).toEqual(["one", "two", "one"]);

    driver.calls.length = 0;
    await storage.queryEntries({ filters: [{ column: "value", value: [] }] });
    const empty = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(empty?.sql).toContain("WHERE 1=0");
    expect(empty?.values).not.toContain([]);
  });
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
    driver.Pool.mockClear();
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

  it("checks a physical family without DDL and reuses its readiness on first write", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const context = { name: "test", multitenant: false } as const;
    const spec = recordSpec();
    await StoragePreparations.for(factory).prepareRecord(context, spec, undefined, "check");
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(false);
    expect(driver.Pool).toHaveBeenCalledTimes(2);
    expect(driver.end).toHaveBeenCalledTimes(2);
    const storage = factory.createRecordStorage(context, spec);
    await storage.write(create(StringValueSchema, { value: "first" }));
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(false);
    expect(driver.Pool).toHaveBeenCalledTimes(3);
    expect(driver.end).toHaveBeenCalledTimes(2);
    await factory.close();
    expect(driver.end).toHaveBeenCalledTimes(3);
  });

  it("prepares equivalent reordered columns without invoking record callbacks", async () => {
    const extract = vi.fn((record: StringValue) => record.value);
    const first = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: extract,
      columns: valueColumns(),
    });
    const reordered = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: extract,
      columns: [...valueColumns()].reverse(),
    });
    const custom = vi.fn(() => ({ sql: "CREATE TABLE custom ()" }));
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .useOperationFactory(custom)
      .build();
    const context = { name: "same-family", multitenant: false } as const;
    const preparation = StoragePreparations.for(factory);
    await preparation.prepareRecord(context, first, undefined, "check");
    await preparation.prepareRecord(context, reordered, undefined, "create");
    expect(extract).not.toHaveBeenCalled();
    expect(custom).not.toHaveBeenCalled();
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(false);
    await factory.close();
  });

  it("rejects an incompatible declaration without discarding a compatible family", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const context = { name: "same-family", multitenant: false } as const;
    const preparation = StoragePreparations.for(factory);
    await preparation.prepareRecord(context, recordSpec(), undefined, "check");
    const changed = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record: StringValue) => record.value,
      columns: [new RecordColumn("value", ColumnTypes.scalar(ScalarType.INT32), () => 1)],
    });
    await expect(preparation.prepareRecord(context, changed, undefined, "create")).rejects.toThrow(
      /conflict/i,
    );
    await preparation.prepareRecord(context, recordSpec(), undefined, "create");
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(false);
    await factory.close();
  });

  it("retries failed read-only checking with creation after the missing table appears", async () => {
    let present = false;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith("CREATE TABLE")) present = true;
      if (sql.includes("schemata")) return Promise.resolve({ rows: [], rowCount: 1 });
      if (sql.includes("columns WHERE"))
        return Promise.resolve({
          rows: present
            ? [
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
                  is_nullable: "NO",
                  column_default: null,
                },
                {
                  column_name: "value",
                  data_type: "text",
                  is_nullable: "YES",
                  column_default: null,
                },
              ]
            : [],
        });
      if (sql.includes("PRIMARY KEY"))
        return Promise.resolve({
          rows: present ? [{ column_name: "ID", ordinal_position: 1 }] : [],
        });
      return Promise.resolve({ rows: [] });
    });
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const preparation = StoragePreparations.for(factory);
    const context = { name: "retry", multitenant: false } as const;
    await expect(
      preparation.prepareRecord(context, recordSpec(), undefined, "check"),
    ).rejects.toThrow(/incompatible/i);
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(false);
    await preparation.prepareRecord(context, recordSpec(), undefined, "create");
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(true);
    await factory.close();
  });

  it("drains an admitted check and rejects new preparation after the close fence", async () => {
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const ordinary = driver.query.getMockImplementation();
    if (ordinary === undefined) throw new Error("Expected PostgreSQL query fixture.");
    driver.query.mockImplementation(async (sql, values) => {
      if (sql.includes("columns WHERE")) {
        started.resolve(undefined);
        await release.promise;
      }
      return ordinary(sql, values);
    });
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const preparation = StoragePreparations.for(factory);
    const context = { name: "drain-check", multitenant: false } as const;
    const checking = preparation.prepareRecord(context, recordSpec(), undefined, "check");
    await started.promise;
    const endedBeforeRelease = driver.end.mock.calls.length;
    const closing = factory.close();
    await expect(
      preparation.prepareRecord(context, recordSpec(), undefined, "check"),
    ).rejects.toThrow(/closed/i);
    expect(driver.end).toHaveBeenCalledTimes(endedBeforeRelease);
    release.resolve(undefined);
    await checking;
    await closing;
    expect(driver.end.mock.calls.length).toBeGreaterThan(endedBeforeRelease);
  });

  it("does not escalate a pending failed check into creation", async () => {
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let present = false;
    driver.query.mockImplementation(async (sql, values) => {
      driver.recordCall(sql, values);
      if (sql.includes("schemata")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("CREATE TABLE")) present = true;
      if (sql.includes("columns WHERE")) {
        if (!present) {
          started.resolve(undefined);
          await release.promise;
        }
        return {
          rows: present
            ? [
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
                  is_nullable: "NO",
                  column_default: null,
                },
                {
                  column_name: "value",
                  data_type: "text",
                  is_nullable: "YES",
                  column_default: null,
                },
              ]
            : [],
        };
      }
      if (sql.includes("PRIMARY KEY"))
        return { rows: present ? [{ column_name: "ID", ordinal_position: 1 }] : [] };
      return { rows: [] };
    });
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const preparation = StoragePreparations.for(factory);
    const context = { name: "pending-check", multitenant: false } as const;
    const check = preparation.prepareRecord(context, recordSpec(), undefined, "check");
    await started.promise;
    const createPending = preparation.prepareRecord(context, recordSpec(), undefined, "create");
    release.resolve(undefined);
    const outcomes = await Promise.allSettled([check, createPending]);
    expect(outcomes.map(({ status }) => status)).toEqual(["rejected", "rejected"]);
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(false);
    await preparation.prepareRecord(context, recordSpec(), undefined, "create");
    expect(driver.calls.some(({ sql }) => sql.startsWith("CREATE"))).toBe(true);
    await factory.close();
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
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
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

  it("coalesces concurrent tenant directory resolution and retains the successful database", async () => {
    const resolver = vi.fn(() => ({ url: "postgresql://db.example/tenant_a", schema: "spine" }));
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(resolver)
      .build();
    const context = { name: "tenant", multitenant: true as const, tenantId: tenantId("a") };
    const first = factory.createRecordStorage(context, recordSpec());
    const second = factory.createRecordStorage(context, recordSpec());
    await Promise.all([
      first.write(create(StringValueSchema, { value: "first" })),
      second.write(create(StringValueSchema, { value: "second" })),
    ]);
    expect(resolver).toHaveBeenCalledOnce();
    expect(driver.Pool).toHaveBeenCalledOnce();
    await factory.close();
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("retries a failed shared connection check through its retained runtime pool", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .build();
    const records = factory.createRecordStorage(
      { name: "shared", multitenant: false },
      recordSpec(),
    );
    try {
      await expect(records.read("missing")).resolves.toBeUndefined();
      expect(driver.Pool).toHaveBeenCalledOnce();
      driver.connect.mockRejectedValueOnce(new Error("probe unavailable"));
      await expect(factory.checkConnection()).rejects.toThrow("Unable to connect to PostgreSQL.");
      expect(driver.Pool).toHaveBeenCalledOnce();
      expect(driver.end).not.toHaveBeenCalled();
      await expect(records.read("still-missing")).resolves.toBeUndefined();
      const acquisitions = driver.connect.mock.calls.length;
      const probes = driver.calls.filter(({ sql }) => sql.includes("schemata")).length;
      await expect(factory.checkConnection()).resolves.toBeUndefined();
      expect(driver.connect).toHaveBeenCalledTimes(acquisitions + 1);
      expect(driver.calls.filter(({ sql }) => sql.includes("schemata"))).toHaveLength(probes + 1);
      expect(driver.Pool).toHaveBeenCalledOnce();
      expect(driver.end).not.toHaveBeenCalled();
    } finally {
      records.close();
      await factory.close();
    }
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("keeps a retained shared pool usable after a second grouped family fails read-only checking", async () => {
    const { factory, records, metadataReads, repair, check } = await retainedGroupedPostgres();
    try {
      await expect(records.read("first-missing")).resolves.toBeUndefined();
      expect(driver.Pool).toHaveBeenCalledOnce();
      const before = metadataReads();
      const creates = driver.calls.filter(({ sql }) => sql.startsWith("CREATE")).length;
      await expect(check()).rejects.toThrow(/incompatible/i);
      expect(metadataReads()).toBe(before + 1);
      expect(driver.calls.filter(({ sql }) => sql.startsWith("CREATE"))).toHaveLength(creates);
      expect(driver.Pool).toHaveBeenCalledOnce();
      expect(driver.end).not.toHaveBeenCalled();
      await expect(records.read("still-missing")).resolves.toBeUndefined();
      repair();
      const beforeRetry = metadataReads();
      await check();
      expect(metadataReads()).toBe(beforeRetry + 1);
      expect(driver.calls.filter(({ sql }) => sql.startsWith("CREATE"))).toHaveLength(creates);
      expect(driver.Pool).toHaveBeenCalledOnce();
      expect(driver.end).not.toHaveBeenCalled();
    } finally {
      records.close();
      await factory.close();
    }
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("joins explicit tenant checking to a pending runtime database without a second pool", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<{ url: string; schema: string }>();
    const resolver = vi.fn(() => {
      entered.resolve(undefined);
      return release.promise;
    });
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(resolver)
      .build();
    const context = { name: "tenant", multitenant: true as const, tenantId: tenantId("joined") };
    const spec = recordSpec();
    const records = factory.createRecordStorage(context, spec);
    const reading = records.read("missing");
    let readSettled = false;
    void reading.then(
      () => {
        readSettled = true;
      },
      () => {
        readSettled = true;
      },
    );
    try {
      await entered.promise;
      const checking = StoragePreparations.for(factory).prepareRecord(
        context,
        spec,
        undefined,
        "check",
      );
      let checkSettled = false;
      void checking.then(
        () => {
          checkSettled = true;
        },
        () => {
          checkSettled = true;
        },
      );
      expect(resolver).toHaveBeenCalledOnce();
      expect(readSettled).toBe(false);
      expect(checkSettled).toBe(false);
      expect(driver.Pool).not.toHaveBeenCalled();
      expect(driver.end).not.toHaveBeenCalled();
      release.resolve({ url: "postgresql://db.example/tenant_joined", schema: "spine" });
      await expect(reading).resolves.toBeUndefined();
      await expect(checking).resolves.toBeUndefined();
      expect(resolver).toHaveBeenCalledOnce();
      expect(driver.Pool).toHaveBeenCalledOnce();
      expect(driver.end).not.toHaveBeenCalled();
    } finally {
      release.resolve({ url: "postgresql://db.example/tenant_joined", schema: "spine" });
      records.close();
      await factory.close();
    }
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("retries a failed tenant directory lookup on the next admitted operation", async () => {
    const resolver = vi
      .fn()
      .mockRejectedValueOnce(new Error("directory unavailable"))
      .mockResolvedValue({ url: "postgresql://db.example/tenant_a", schema: "spine" });
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(resolver)
      .build();
    const storage = factory.createRecordStorage(
      { name: "tenant", multitenant: true, tenantId: tenantId("a") },
      recordSpec(),
    );
    await expect(storage.write(create(StringValueSchema, { value: "first" }))).rejects.toThrow();
    await expect(
      storage.write(create(StringValueSchema, { value: "second" })),
    ).resolves.toBeUndefined();
    expect(resolver).toHaveBeenCalledTimes(2);
    await factory.close();
  });

  it("releases a failed tenant probe target so another tenant can bind it", async () => {
    const ends: ReturnType<typeof vi.fn>[] = [];
    for (let index = 0; index < 3; index += 1) {
      const end = vi.fn(() => Promise.resolve());
      ends.push(end);
      driver.Pool.mockImplementationOnce(function Pool() {
        return { connect: driver.connect, end };
      });
    }
    driver.connect.mockRejectedValueOnce(new Error("probe unavailable"));
    const resolver = vi.fn(() => ({ url: "postgresql://db.example/reserved", schema: "spine" }));
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(resolver)
      .build();
    const preparation = StoragePreparations.for(factory);
    const first = { name: "tenant", multitenant: true as const, tenantId: tenantId("a") };
    const second = { name: "tenant", multitenant: true as const, tenantId: tenantId("b") };

    await expect(
      preparation.prepareRecord(first, recordSpec(), undefined, "check"),
    ).rejects.toThrow("Unable to connect to PostgreSQL.");
    await expect(
      preparation.prepareRecord(second, recordSpec(), undefined, "check"),
    ).resolves.toBeUndefined();
    await expect(
      preparation.prepareRecord(first, recordSpec(), undefined, "check"),
    ).rejects.toThrow(/distinct physical databases/i);
    expect(driver.Pool).toHaveBeenCalledTimes(3);
    expect(driver.connect).toHaveBeenCalledTimes(3);
    for (const end of ends) expect(end).toHaveBeenCalledOnce();
    expect(driver.release).toHaveBeenCalledTimes(2);
    expect(resolver).toHaveBeenCalledTimes(3);
    await factory.close();
    for (const end of ends) expect(end).toHaveBeenCalledOnce();
  });

  it("rejects a shared and tenant family mapped to one unpartitioned table", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(() => ({ url: "postgresql://db.example/shared", schema: "spine" }))
      .build();
    const shared = factory.createRecordStorage(
      { name: "shared", multitenant: false },
      recordSpec(),
    );
    const tenant = factory.createRecordStorage(
      { name: "tenant", multitenant: true, tenantId: tenantId("a") },
      recordSpec(),
    );
    await shared.write(create(StringValueSchema, { value: "shared" }));
    const [failure] = await Promise.allSettled([
      tenant.write(create(StringValueSchema, { value: "tenant" })),
    ]);
    if (failure.status !== "rejected") throw new Error("Expected physical family collision.");
    expect(((failure.reason as Error).cause as Error).message).toMatch(/collide/i);
    await factory.close();
  });

  it("rejects two resolved tenants targeting the same physical database", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(() => ({ url: "postgresql://db.example/tenant", schema: "spine" }))
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
    const [failure] = await Promise.allSettled([
      second.write(create(StringValueSchema, { value: "second" })),
    ]);
    if (failure.status !== "rejected") throw new Error("Expected tenant database collision.");
    expect(((failure.reason as Error).cause as Error).message).toMatch(
      /distinct physical databases/i,
    );
    await factory.close();
  });

  it("drains an admitted first write before closing its newly bound pool", async () => {
    let admit: ((client: Awaited<ReturnType<typeof driver.connect>>) => void) | undefined;
    let entered: (() => void) | undefined;
    const connecting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    driver.connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          admit = resolve;
          entered?.();
        }),
    );
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const storage = factory.createRecordStorage({ name: "test", multitenant: false }, recordSpec());
    const write = storage.write(create(StringValueSchema, { value: "first" }));
    await connecting;
    const closing = factory.close();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(driver.end).not.toHaveBeenCalled();
    if (admit === undefined) throw new Error("Expected a gated PostgreSQL connection.");
    admit({ query: driver.query, release: driver.release });
    await expect(write).resolves.toBeUndefined();
    await closing;
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("fences new public work while a previously admitted batch finishes", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const storage = factory.createRecordStorage({ name: "test", multitenant: false }, recordSpec());
    await (storage as PostgresRecordStorage<string, StringValue>).prepare();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const firstWrite = new Promise<void>((resolve) => {
      entered = resolve;
    });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith("INSERT INTO") && release === undefined)
        return new Promise((resolve) => {
          release = () => {
            resolve({ rowCount: 1, rows: [] });
          };
          entered?.();
        });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    const batch = storage.writeAll([
      create(StringValueSchema, { value: "first" }),
      create(StringValueSchema, { value: "second" }),
    ]);
    await firstWrite;
    const closing = factory.close();
    await expect(storage.write(create(StringValueSchema, { value: "late" }))).rejects.toThrow(
      /closed/i,
    );
    if (release === undefined) throw new Error("Expected gated first row.");
    release();
    await expect(batch).resolves.toBeUndefined();
    await closing;
    expect(driver.calls.filter(({ sql }) => sql.startsWith("INSERT INTO"))).toHaveLength(2);
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("drains a compare-and-set retry admitted before factory close", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    const storage = factory.createRecordStorage({ name: "test", multitenant: false }, recordSpec());
    await (storage as PostgresRecordStorage<string, StringValue>).prepare();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const firstAttempt = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let inserts = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"')) return Promise.resolve({ rows: [] });
      if (sql.startsWith("INSERT INTO")) {
        inserts += 1;
        if (inserts === 1)
          return new Promise((resolve) => {
            release = () => {
              resolve({ rowCount: 0, rows: [] });
            };
            entered?.();
          });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    const change = storage.compareAndSet(
      "slot",
      undefined,
      create(StringValueSchema, { value: "next" }),
    );
    await firstAttempt;
    const closing = factory.close();
    await expect(storage.read("late")).rejects.toThrow(/closed/i);
    if (release === undefined) throw new Error("Expected gated CAS attempt.");
    release();
    await expect(change).resolves.toBe(true);
    await closing;
    expect(inserts).toBe(2);
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("admits a public write before its materializer closes the factory reentrantly", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    let closing: Promise<void> | undefined;
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => {
        closing ??= factory.close();
        return record.value;
      },
      columns: valueColumns(),
    });
    const storage = factory.createRecordStorage({ name: "test", multitenant: false }, spec);
    await expect(
      storage.write(create(StringValueSchema, { value: "first" })),
    ).resolves.toBeUndefined();
    if (closing === undefined) throw new Error("Expected materializer-triggered close.");
    await closing;
    expect(driver.calls.some(({ sql }) => sql.startsWith("INSERT INTO"))).toBe(true);
    expect(driver.end).toHaveBeenCalledOnce();
  });

  it("admits a write before its tenant resolver closes the factory reentrantly", async () => {
    let closing: Promise<void> | undefined;
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(() => {
        closing = factory.close();
        return { url: "postgresql://db.example/tenant_a", schema: "spine" };
      })
      .build();
    const storage = factory.createRecordStorage(
      { name: "tenant", multitenant: true, tenantId: tenantId("a") },
      recordSpec(),
    );
    await expect(
      storage.write(create(StringValueSchema, { value: "first" })),
    ).resolves.toBeUndefined();
    if (closing === undefined) throw new Error("Expected resolver-triggered close.");
    await closing;
    expect(driver.end).toHaveBeenCalledOnce();
    expect(() =>
      factory.createRecordStorage(
        { name: "tenant", multitenant: true, tenantId: tenantId("a") },
        recordSpec(),
      ),
    ).toThrow(/closed/i);
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

    await factory.close();
    await factory.close();
    await Promise.resolve();

    expect(storage.isOpen()).toBe(false);
    expect(driver.end).not.toHaveBeenCalled();
    await expect((storage as PostgresRecordStorage<string, StringValue>).prepare()).rejects.toThrow(
      /closed/i,
    );
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

  it("writes a batch in source order without a cross-record transaction", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;

    await storage.writeAll([
      create(StringValueSchema, { value: "first" }),
      create(StringValueSchema, { value: "second" }),
    ]);

    const statements = driver.calls.map(({ sql }) => sql);
    const writes = driver.calls.filter(({ sql }) => sql.startsWith("INSERT INTO"));
    expect(statements).not.toContain("BEGIN");
    expect(statements).not.toContain("COMMIT");
    expect(writes.map(({ values }) => values?.[0])).toEqual(["first", "second"]);
  });

  it("keeps the completed batch prefix when a later record fails", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith("INSERT INTO") && values?.[0] === "second")
        return Promise.reject(new Error("later write failed"));
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.writeAll([
        create(StringValueSchema, { value: "first" }),
        create(StringValueSchema, { value: "second" }),
      ]),
    ).rejects.toThrow(/record operation failed/i);
    expect(driver.calls.filter(({ sql }) => sql.startsWith("INSERT INTO"))).toHaveLength(2);
    expect(driver.calls.map(({ sql }) => sql)).not.toContain("ROLLBACK");
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

  it("discards a client marked unusable after a record operation fails", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    const failure = new Error("broken PostgreSQL client with private detail");
    PostgresClientDisposal.mark(failure);
    driver.query.mockRejectedValueOnce(failure);

    await expect(storage.write(create(StringValueSchema, { value: "one" }))).rejects.toThrow(
      "record operation failed",
    );

    expect(driver.release).toHaveBeenCalledWith(expect.any(Error));
    expect((driver.release.mock.calls[0] as unknown[])[0]).not.toBe(failure);
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
    await storage.write(create(StringValueSchema, { value: "one" }));
    const begin = driver.calls.findIndex(({ sql }) => sql === "BEGIN");
    const insert = driver.calls.findIndex(({ sql }) => sql.startsWith("INSERT INTO"));
    expect(begin).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(begin);
    expect(driver.connect).toHaveBeenCalledTimes(3);
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

  it("retries an immutable insert when a conflicting row disappears before inspection", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    let inserts = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith("INSERT INTO")) {
        inserts += 1;
        return Promise.resolve({ rowCount: inserts === 1 ? 0 : 1, rows: [] });
      }
      if (sql.startsWith('SELECT "bytes"')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      (
        storage as unknown as { writeImmutable(record: ReturnType<typeof create>): Promise<void> }
      ).writeImmutable(create(StringValueSchema, { value: "one" })),
    ).resolves.toBeUndefined();

    expect(inserts).toBe(2);
  });

  it("bounds immutable insert contention when every collision disappears", async () => {
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
      (storage as unknown as { writeImmutable(record: StringValue): Promise<void> }).writeImmutable(
        create(StringValueSchema, { value: "one" }),
      ),
    ).rejects.toThrow(/contention exceeded/i);
    expect(inserts).toBe(3);
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

  it("guards a semantically equivalent stored encoding with its exact raw bytes", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;
    const raw = Uint8Array.of(10, 1, 97, 10, 1, 97);
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"')) return Promise.resolve({ rows: [{ bytes: raw }] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.compareAndSet(
        "slot",
        create(StringValueSchema, { value: "a" }),
        create(StringValueSchema, { value: "b" }),
      ),
    ).resolves.toBe(true);

    const update = driver.calls.find(({ sql }) => sql.startsWith("UPDATE"));
    expect(update?.sql).toContain('"ID" = $1 AND "bytes" =');
    expect(Array.from(update?.values?.[1] as Uint8Array)).toEqual([...raw]);
    expect(driver.calls.map(({ sql }) => sql)).not.toContain("BEGIN");
    expect(driver.calls.some(({ sql }) => sql.includes("pg_advisory"))).toBe(false);
  });

  it("rereads after a guard miss and rejects a changed expected record", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    let reads = 0;
    const bytesOf = (value: string) =>
      toBinary(StringValueSchema, create(StringValueSchema, { value }));
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: bytesOf(reads++ === 0 ? "first" : "rival") }] });
      if (sql.startsWith("UPDATE")) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.compareAndSet(
        "slot",
        create(StringValueSchema, { value: "first" }),
        create(StringValueSchema, { value: "next" }),
      ),
    ).resolves.toBe(false);
    expect(reads).toBe(2);
    expect(driver.calls.filter(({ sql }) => sql.startsWith("UPDATE"))).toHaveLength(1);
  });

  it("bounds repeated guard misses and accepts a same-value no-op", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    driver.calls.length = 0;
    const current = create(StringValueSchema, { value: "first" });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({ rows: [{ bytes: toBinary(StringValueSchema, current) }] });
      if (sql.startsWith("UPDATE")) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.compareAndSet("slot", current, current)).resolves.toBe(true);
    expect(driver.calls.some(({ sql }) => sql.startsWith("UPDATE"))).toBe(false);
    await expect(
      storage.compareAndSet("slot", current, create(StringValueSchema, { value: "next" })),
    ).rejects.toThrow(/contention exceeded/i);
    expect(driver.calls.filter(({ sql }) => sql.startsWith("UPDATE"))).toHaveLength(3);
  });

  it("treats an absent delete as a no-op and rereads an insert collision", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    let reads = 0;
    const rival = create(StringValueSchema, { value: "rival" });
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"'))
        return Promise.resolve({
          rows: reads++ < 2 ? [] : [{ bytes: toBinary(StringValueSchema, rival) }],
        });
      if (sql.startsWith("INSERT INTO")) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(storage.compareAndSet("slot", undefined, undefined)).resolves.toBe(true);
    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "next" })),
    ).resolves.toBe(false);
    expect(driver.calls.filter(({ sql }) => sql.startsWith("INSERT INTO"))).toHaveLength(1);
  });

  it("rereads a conditional delete miss before reporting a changed expected record", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    let reads = 0;
    driver.query.mockImplementation((sql, values) => {
      driver.recordCall(sql, values);
      if (sql.startsWith('SELECT "bytes"')) {
        const value = reads++ === 0 ? "first" : "rival";
        return Promise.resolve({
          rows: [{ bytes: toBinary(StringValueSchema, create(StringValueSchema, { value })) }],
        });
      }
      if (sql.startsWith("DELETE")) return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      storage.compareAndSet("slot", create(StringValueSchema, { value: "first" }), undefined),
    ).resolves.toBe(false);
    expect(reads).toBe(2);
    expect(driver.calls.filter(({ sql }) => sql.startsWith("DELETE"))).toHaveLength(1);
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

  it("runs exhaustive plans without a provider limit and scans for oversized ID sets", async () => {
    const storage = await recordStorage();
    await (storage as unknown as { prepare(): Promise<void> }).prepare();
    vi.clearAllMocks();
    driver.calls.length = 0;
    await storage.queryPlan({
      exhaustive: true,
      predicate: { kind: "comparison", column: "value", operator: "greaterThan", value: "a" },
      order: [{ column: "value", direction: "asc" }],
      limit: 1,
    });
    let query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).not.toContain("WHERE");
    expect(query?.sql).toContain('ORDER BY "value" ASC NULLS FIRST, "ID" ASC');
    expect(query?.sql).not.toContain("LIMIT");
    expect(query?.values).toEqual([]);

    driver.calls.length = 0;
    await storage.queryPlan({
      exhaustive: true,
      predicate: {
        kind: "ids",
        ids: Array.from({ length: 1_001 }, (_, index) => String(index)),
      },
    });
    query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).not.toContain("WHERE");
    expect(query?.sql).not.toContain("LIMIT");

    driver.calls.length = 0;
    await storage.queryPlan({
      exhaustive: true,
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "value", operator: "equal", value: "one" },
          { kind: "ids", ids: Array.from({ length: 1_001 }, (_, index) => String(index)) },
        ],
      },
    });
    query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).not.toContain("WHERE");

    driver.calls.length = 0;
    await storage.queryPlan({ exhaustive: true });
    query = driver.calls.find(({ sql }) => sql.startsWith('SELECT "ID", "bytes"'));
    expect(query?.sql).not.toContain("LIMIT");
  });

  it("keeps rewritten nested filters and aligns nullable numeric order with the evaluator", async () => {
    const spec = new RecordSpec<number, StringValue>({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: (record) => Number(record.value),
      columns: [
        new RecordColumn("number", ColumnTypes.scalar(ScalarType.INT32), (record) =>
          Number(record.value),
        ),
        new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
      ],
    });
    const table = PostgresTableSpecs.resolvedPostgresTableSpec({
      schema: "spine",
      tableName: "numeric_records",
      sourceType: spec.sourceType,
      recordType: spec.recordType,
      idType: spec.idType,
      declaredColumns: spec.columns,
    });
    const storage = new PostgresRecordStorage(
      { name: "numeric-records", multitenant: false },
      spec,
      table.tableName,
      () => table,
      {
        resolve: () => Promise.resolve(),
        track: (work) => work,
        prepare: () => Promise.resolve(),
        publicOpen: () => true,
        databaseName: "test",
        schema: "spine",
        acquire: () => driver.connect() as never,
      },
      () => undefined,
    );
    await (storage as unknown as { bind(): Promise<void> }).bind();
    const compiler = storage as unknown as {
      planQuery(plan: NormalizedQueryPlan<number>): { sql: string; values: readonly unknown[] };
    };
    const number = { kind: "comparison", column: "number", operator: "equal", value: 2 } as const;
    const text = { kind: "comparison", column: "value", operator: "equal", value: "a" } as const;
    const nested = compiler.planQuery({
      exhaustive: true,
      predicate: {
        kind: "all",
        predicates: [{ kind: "all", predicates: [number, text] }, { ...number }],
      },
    });
    expect(nested.sql).toContain(
      'WHERE (("number" IS NOT DISTINCT FROM $1) AND "number" IS NOT DISTINCT FROM $2)',
    );
    expect(nested.sql).not.toContain('"value"');
    expect(nested.values).toEqual([2, 2]);
    const either = compiler.planQuery({
      exhaustive: true,
      predicate: {
        kind: "all",
        predicates: [number, { kind: "either", predicates: [{ ...number }, text] }],
      },
    });
    expect(either.sql).toContain('WHERE ("number" IS NOT DISTINCT FROM $1)');
    expect(either.sql).not.toContain(" OR ");
    expect(either.values).toEqual([2]);
    for (const [direction, nulls] of [
      ["asc", "ASC NULLS FIRST"],
      ["desc", "DESC NULLS LAST"],
    ] as const) {
      const ordered = compiler.planQuery({
        exhaustive: true,
        order: [{ column: "number", direction }],
        limit: 1,
      });
      expect(ordered.sql).toContain(`"number" ${nulls}, "ID" ASC LIMIT $1`);
    }
  });

  it("does not push custom numeric SQL mappings for logical strings or string IDs", async () => {
    const spec = recordSpec();
    const canonical = PostgresTableSpecs.resolvedPostgresTableSpec({
      schema: "spine",
      tableName: "custom_numeric",
      sourceType: spec.sourceType,
      recordType: spec.recordType,
      idType: spec.idType,
      declaredColumns: spec.columns,
    });
    const storage = new PostgresRecordStorage(
      { name: "custom-numeric", multitenant: false },
      spec,
      "custom_numeric",
      () => ({
        ...canonical,
        columns: canonical.columns.map((column) =>
          column.name === "ID" || column.name === "value"
            ? { ...column, postgresType: "INT" }
            : column,
        ),
      }),
      {
        resolve: () => Promise.resolve(),
        track: (work) => work,
        prepare: () => Promise.resolve(),
        publicOpen: () => true,
        databaseName: "test",
        schema: "spine",
        acquire: () => driver.connect() as never,
      },
      () => undefined,
    );
    await (storage as unknown as { bind(): Promise<void> }).bind();
    const compiler = storage as unknown as {
      planQuery(plan: NormalizedQueryPlan<string>): { sql: string; values: readonly unknown[] };
    };
    const plan = compiler.planQuery({
      exhaustive: true,
      predicate: { kind: "comparison", column: "value", operator: "equal", value: "2" },
      order: [{ column: "value", direction: "asc" }],
      limit: 1,
    });
    expect(plan.sql).not.toContain(" WHERE ");
    expect(plan.sql).not.toContain(" LIMIT ");
    expect(
      compiler.planQuery({ exhaustive: true, predicate: { kind: "ids", ids: ["2"] } }).sql,
    ).not.toContain(" WHERE ");
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

async function retainedGroupedPostgres() {
  let repaired = false;
  const ordinary = driver.query.getMockImplementation();
  if (ordinary === undefined) throw new Error("Expected PostgreSQL metadata query fixture.");
  driver.query.mockImplementation((sql, values) => {
    if (sql.includes("columns WHERE") && values?.[1] === "late_history" && !repaired) {
      driver.recordCall(sql, values);
      return Promise.resolve({ rows: [] });
    }
    return ordinary(sql, values);
  });
  const factory = await PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
    .setTableName(StringValueSchema, StringValueSchema, "late_history")
    .build();
  const context = { name: "shared", multitenant: false } as const;
  const spec = recordSpec();
  const group = new StorageGroup("history");
  return {
    factory,
    records: factory.createRecordStorage(context, spec),
    repair: () => {
      repaired = true;
    },
    metadataReads: () =>
      driver.calls.filter(
        ({ sql, values }) => sql.includes("columns WHERE") && values?.[1] === "late_history",
      ).length,
    check: () => StoragePreparations.for(factory).prepareRecord(context, spec, group, "check"),
  };
}

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
