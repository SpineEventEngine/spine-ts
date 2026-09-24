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
import { TenantIdSchema } from "@spine-event-engine/proto";
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

describe("PostgresStorageFactory connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    await expect(PostgresStorageFactory.newBuilder().setTenantOptions([]).build()).rejects.toThrow(
      /requires tenants/i,
    );
  });

  it("rejects missing or mixed single-tenant and multitenant configuration", async () => {
    await expect(PostgresStorageFactory.newBuilder().build()).rejects.toThrow(
      /options are required/i,
    );
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine" })
        .setTenantOptions([
          { tenantId: tenant("one"), options: { url: "postgresql://db.example/one" } },
        ])
        .build(),
    ).rejects.toThrow(/either single-tenant or multitenant/i);
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

  it("uses the server current schema and rejects unavailable or retired layouts", async () => {
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
    factory.close();

    expect(driver.query.mock.calls.some(([sql]) => sql.includes("current_schema"))).toBe(true);

    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 0 : 0, rows: [] }),
    );
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine", schema: "missing" })
        .build(),
    ).rejects.toThrow(/schema does not exist/i);

    driver.query.mockImplementation((sql: string) => {
      if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
      if (sql.includes("information_schema.columns"))
        return Promise.resolve({ rowCount: 1, rows: [] });
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
        .build(),
    ).rejects.toThrow(/retired storage layout/i);
  });

  it("rejects an absent or invalid server current schema", async () => {
    driver.query.mockImplementation((sql: string) => {
      if (sql.includes("current_schema")) return Promise.resolve({ rows: [{ schema: null }] });
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://db.example/spine" })
        .build(),
    ).rejects.toThrow(/schema is invalid/i);
  });

  it("lists configured tenants and rejects an unknown retained tenant", async () => {
    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
    );
    const first = tenant("one");
    const second = tenant("two");
    const factory = await PostgresStorageFactory.newBuilder()
      .setTenantOptions([
        { tenantId: first, options: { url: "postgresql://db.example/one", schema: "spine" } },
        { tenantId: second, options: { url: "postgresql://db.example/two", schema: "spine" } },
      ])
      .build();
    const catalog = factory.tenantCatalog();

    const boundaries = await catalog.all();
    expect(boundaries).toHaveLength(2);
    const configured = boundaries[0];
    if (configured === undefined) throw new Error("Expected one configured PostgreSQL tenant.");
    await expect(catalog.keep(configured)).resolves.toBeUndefined();
    await expect(catalog.keep(TenantBoundary.from(tenant("unknown")))).rejects.toThrow(
      /not configured/i,
    );
    factory.close();
  });

  it("rejects duplicate tenants and normalized physical database targets", async () => {
    const one = tenant("one");
    const two = tenant("two");
    await expect(
      PostgresStorageFactory.newBuilder()
        .setTenantOptions([
          { tenantId: one, options: { url: "postgresql://db.example/one" } },
          { tenantId: one, options: { url: "postgresql://db.example/two" } },
        ])
        .build(),
    ).rejects.toThrow(/duplicate tenant/i);
    await expect(
      PostgresStorageFactory.newBuilder()
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

    await expect(
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: "postgresql://user:secret@db.example/spine" })
        .build(),
    ).rejects.toThrow("Unable to connect to PostgreSQL.");
  });

  it("closes every created pool after a later pool fails its probe", async () => {
    const first = {
      connect: vi.fn(() => Promise.resolve({ query: driver.query, release: driver.release })),
      end: vi.fn(() => Promise.resolve()),
    };
    const second = {
      connect: vi.fn(() => Promise.reject(new Error("secret driver error"))),
      end: vi.fn(() => Promise.resolve()),
    };
    driver.Pool.mockImplementationOnce(function Pool() {
      return first;
    });
    driver.Pool.mockImplementationOnce(function Pool() {
      return second;
    });
    driver.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: sql.includes("schemata") ? 1 : 0, rows: [] }),
    );

    await expect(
      PostgresStorageFactory.newBuilder()
        .setTenantOptions([
          {
            tenantId: tenant("one"),
            options: { url: "postgresql://db.example/one", schema: "spine" },
          },
          {
            tenantId: tenant("two"),
            options: { url: "postgresql://db.example/two", schema: "spine" },
          },
        ])
        .build(),
    ).rejects.toThrow("Unable to connect to PostgreSQL.");

    expect(first.end).toHaveBeenCalledOnce();
    expect(second.end).toHaveBeenCalledOnce();
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
    factory.close();
    factory.close();
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
