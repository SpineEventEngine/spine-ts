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
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { RecordSpec } from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QueryResult {
  readonly rowCount?: number;
  readonly rows: readonly Record<string, unknown>[];
}
type Query = (sql: string) => Promise<QueryResult>;

const driver = vi.hoisted(() => {
  const query = vi.fn<Query>((sql) => {
    void sql;
    return Promise.resolve({ rowCount: 0, rows: [] });
  });
  const release = vi.fn();
  const connect = vi.fn(() => Promise.resolve({ query, release }));
  const end = vi.fn(() => Promise.resolve());
  const Pool = vi.fn(function Pool() {
    return { connect, end };
  });
  const setTypeParser = vi.fn();
  return { Pool, connect, end, query, release, setTypeParser };
});

vi.mock("pg", () => ({ Pool: driver.Pool, types: { setTypeParser: driver.setTypeParser } }));

import { PostgresStorageFactory } from "../src/index.js";
import { providerEntityInput } from "../../storage/test/entity/agent-execution-provider-fixtures.js";

describe("PostgresStorageFactory connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds and creates a logical record handle without opening a connection", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine" })
      .build();
    const handle = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        recordType: EventSchema,
        idSchema: EventIdSchema,
        extractId: (event) => {
          if (event.id === undefined) throw new Error("Expected Event.id");
          return event.id;
        },
      }),
    );
    expect(driver.Pool).not.toHaveBeenCalled();
    expect(driver.connect).not.toHaveBeenCalled();
    handle.close();
    await factory.close();
  });

  it("keeps an admitted Agent coordinator independent of the public close snapshot", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine" })
      .build();
    const internal = factory as unknown as {
      createEntityCommitStorage(
        input: ReturnType<typeof providerEntityInput>,
        admitted: boolean,
      ): {
        close(): Promise<void>;
      };
    };
    const coordinator = internal.createEntityCommitStorage(providerEntityInput(), true);
    const closeCoordinator = vi.spyOn(coordinator, "close");
    await factory.close();
    expect(closeCoordinator).not.toHaveBeenCalled();
    await coordinator.close();
    expect(closeCoordinator).toHaveBeenCalledOnce();
  });

  it.each([
    "postgresql://user:secret@db.example",
    "postgresql://user:secret@db.example/spine?sslmode=require",
    "postgresql://user:secret@db.example/spine#fragment",
  ])("rejects unsupported or database-less URLs before constructing a pool", async (url) => {
    await expect(PostgresStorageFactory.newBuilder().setOptions({ url }).build()).rejects.toThrow(
      /postgresql.*(url|database)/i,
    );
  });

  it("rejects invalid pool, schema, and empty tenant settings", async () => {
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine", connectionLimit: 0 })
        .build(),
    ).rejects.toThrow(/connection limit/i);
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine", schema: "bad-name" })
        .build(),
    ).rejects.toThrow(/schema/i);
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine" })
        .setTenantOptions([])
        .build(),
    ).rejects.toThrow(/requires tenants/i);
  });

  it("requires shared options and rejects both tenant-selection modes", async () => {
    await expect(PostgresStorageFactory.newBuilder().build()).rejects.toThrow(
      /options are required/i,
    );
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine" })
        .setTenantOptions([
          { tenantId: tenant("one"), options: { url: "postgresql://db.example/one" } },
        ])
        .setTenantResolver(() => ({ url: "postgresql://db.example/two" }))
        .build(),
    ).rejects.toThrow(/either tenant options or a tenant resolver/i);
  });

  it.each([
    ["an unparsable URL", { url: "not a PostgreSQL URL" }, /valid URL/i],
    [
      "a zero connection timeout",
      { url: "postgresql://db.example/spine", connectTimeoutMs: 0 },
      /timeout/i,
    ],
    [
      "a non-integer connection limit",
      { url: "postgresql://db.example/spine", connectionLimit: 1.5 },
      /connection limit/i,
    ],
  ] as const)("rejects %s before constructing a pool", async (_name, options, message) => {
    await expect(PostgresStorageFactory.newBuilder().setOptions(options).build()).rejects.toThrow(
      message,
    );
    expect(driver.Pool).not.toHaveBeenCalled();
  });

  it("checks the server current schema without probing retired layouts", async () => {
    driver.query.mockImplementation((sql: string) => {
      if (sql.includes("current_schema")) return Promise.resolve({ rows: [{ schema: "spine" }] });
      if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
      if (sql.includes("information_schema.columns"))
        return Promise.resolve({ rowCount: 0, rows: [] });
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine" })
      .build();
    await factory.checkConnection();
    await factory.close();

    expect(driver.query.mock.calls.some(([sql]) => sql.includes("current_schema"))).toBe(true);

    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 0 : 0, rows: [] }),
    );
    const missing = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "missing" })
      .build();
    await expect(missing.checkConnection()).rejects.toThrow(/schema does not exist/i);
    await missing.close();

    driver.query.mockImplementation((sql: string) => {
      if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
      if (sql.includes("information_schema.columns"))
        return Promise.resolve({ rowCount: 1, rows: [] });
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    const retired = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    await expect(retired.checkConnection()).resolves.toBeUndefined();
    expect(
      driver.query.mock.calls.some(([sql]) => sql.includes("information_schema.columns")),
    ).toBe(false);
    await retired.close();
  });

  it("rejects an absent or invalid server current schema", async () => {
    driver.query.mockImplementation((sql: string) => {
      if (sql.includes("current_schema")) return Promise.resolve({ rows: [{ schema: null }] });
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine" })
      .build();
    await expect(factory.checkConnection()).rejects.toThrow(/schema is invalid/i);
    await factory.close();
  });

  it("lists configured tenants and rejects an unknown retained tenant", async () => {
    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
    );
    const first = tenant("one");
    const second = tenant("two");
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantOptions([
        { tenantId: first, options: { url: "postgresql://db.example/one", schema: "spine" } },
        { tenantId: second, options: { url: "postgresql://db.example/two", schema: "spine" } },
      ])
      .build();
    const catalog = factory.tenantCatalog();

    const boundaries = await catalog.all();
    expect(boundaries).toHaveLength(2);
    const signal = new AbortController().signal;
    const firstPage = await catalog.page({ count: 1, signal });
    expect(firstPage.boundaries).toEqual([boundaries[0]]);
    if (firstPage.after === undefined) throw new Error("Expected PostgreSQL catalog cursor.");
    await expect(
      catalog.page({
        count: 1,
        signal,
        after: {
          [Symbol.toStringTag]: "TenantCatalogCursor",
        },
      }),
    ).rejects.toThrow(/continuation/);
    const constructed = Reflect.construct(firstPage.after.constructor, [
      catalog,
      1,
      2,
    ]) as typeof firstPage.after;
    await expect(catalog.page({ count: 1, signal, after: constructed })).rejects.toThrow();
    const lastPage = await catalog.page({ count: 1, signal, after: firstPage.after });
    expect(lastPage.boundaries).toEqual([boundaries[1]]);
    expect(lastPage.hasMore).toBe(false);
    await expect(catalog.page({ count: 129, signal })).resolves.toMatchObject({
      boundaries,
      hasMore: false,
    });
    const configured = boundaries[0];
    if (configured === undefined) throw new Error("Expected one configured PostgreSQL tenant.");
    await expect(catalog.keep(configured)).resolves.toBeUndefined();
    await expect(catalog.keep(TenantBoundary.from(tenant("unknown")))).rejects.toThrow(
      /not configured/i,
    );
    await factory.close();
  });

  it("does not enumerate or resolve a dynamic tenant during shared checks", async () => {
    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
    );
    const resolve = vi.fn(() => ({ url: "postgresql://db.example/tenant" }));
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .setTenantResolver(resolve)
      .build();
    await factory.checkConnection();
    await expect(factory.tenantCatalog().all()).resolves.toEqual([]);
    await expect(
      factory.tenantCatalog().keep(TenantBoundary.from(tenant("dynamic"))),
    ).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
    await factory.close();
  });

  it("drains an admitted shared check before factory close settles", async () => {
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
    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
    );
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/shared", schema: "spine" })
      .build();
    const checking = factory.checkConnection();
    await connecting;
    const closing = factory.close();
    expect(driver.end).not.toHaveBeenCalled();
    if (admit === undefined) throw new Error("Expected gated PostgreSQL connection.");
    admit({ query: driver.query, release: driver.release });
    await checking;
    await closing;
    expect(driver.end).toHaveBeenCalledOnce();
    await expect(factory.checkConnection()).rejects.toThrow(/closed/i);
  });

  it("rejects duplicate tenants and normalized physical database targets", async () => {
    const one = tenant("one");
    const two = tenant("two");
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/shared" })
        .setTenantOptions([
          { tenantId: one, options: { url: "postgresql://db.example/one" } },
          { tenantId: one, options: { url: "postgresql://db.example/two" } },
        ])
        .build(),
    ).rejects.toThrow(/duplicate tenant/i);
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/shared" })
        .setTenantOptions([
          { tenantId: one, options: { url: "postgresql://db.example/shared" } },
          { tenantId: two, options: { url: "postgresql://DB.EXAMPLE:5432/SHARED" } },
        ])
        .build(),
    ).rejects.toThrow(/distinct physical databases/i);
  });

  it("sanitizes driver connection failures", async () => {
    driver.connect.mockRejectedValueOnce(
      new Error("postgresql://user:secret@db.example/spine SQL"),
    );

    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://user:secret@db.example/spine" })
      .build();
    await expect(factory.checkConnection()).rejects.toThrow("Unable to connect to PostgreSQL.");
    await factory.close();
  });

  it("reports both a failed connection probe and failed temporary-pool cleanup", async () => {
    driver.connect.mockRejectedValueOnce(new Error("secret connection failure"));
    driver.end.mockRejectedValueOnce(new Error("secret cleanup failure"));
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine" })
      .build();
    const result = await Promise.allSettled([factory.checkConnection()]);
    if (result[0].status !== "rejected") throw new Error("Expected failed connection check.");
    const failure = result[0].reason as AggregateError;
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.map((error: Error) => error.message)).toEqual([
      "Unable to connect to PostgreSQL.",
      "Unable to close PostgreSQL check pool.",
    ]);
    await factory.close();
  });

  it("reports temporary-pool cleanup failure after a successful probe", async () => {
    driver.end.mockRejectedValueOnce(new Error("secret cleanup failure"));
    driver.query.mockResolvedValue({ rowCount: 1, rows: [] });
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
      .build();
    await expect(factory.checkConnection()).rejects.toThrow(
      "Unable to close PostgreSQL check pool.",
    );
    await factory.close();
  });

  it("closes a temporary pool when its explicit check fails", async () => {
    const first = {
      connect: vi.fn(() => Promise.resolve({ query: driver.query, release: driver.release })),
      end: vi.fn(() => Promise.resolve()),
    };
    driver.Pool.mockImplementationOnce(function Pool() {
      return first;
    });
    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
    );

    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: "postgresql://db.example/one", schema: "spine" })
      .build();
    await expect(factory.checkConnection()).resolves.toBeUndefined();
    expect(first.end).toHaveBeenCalledOnce();
    await factory.close();
  });

  it("proves an explicit-schema pool and releases its probe before idempotent close", async () => {
    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
    );

    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({
        url: "postgresql://user:secret@db.example:5433/spine",
        schema: "spine",
        connectionLimit: 2,
        connectTimeoutMs: 10,
        tls: { rejectUnauthorized: false },
      })
      .build();
    await factory.checkConnection();
    await factory.close();
    await factory.close();
    await Promise.resolve();

    expect(driver.Pool).toHaveBeenCalledWith({
      host: "db.example",
      port: 5433,
      database: "spine",
      user: "user",
      password: "secret",
      max: 2,
      connectionTimeoutMillis: 10,
      ssl: { rejectUnauthorized: false },
    });
    expect(driver.connect).toHaveBeenCalledOnce();
    expect(driver.release).toHaveBeenCalledOnce();
    expect(driver.end).toHaveBeenCalledOnce();
    expect(driver.setTypeParser).not.toHaveBeenCalled();
    expect(factory.isOpen()).toBe(false);
  });
});

function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}
