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

import { randomUUID } from "node:crypto";

import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { TenantIdSchema, TenantSchema } from "@spine-event-engine/proto";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PersistentTenantIndex } from "../../src/context/persistent-tenant-index.js";
import { tenant } from "../tenant-fixture.js";

const postgresUrl = process.env.SPINE_TS_POSTGRESQL_URL;
const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
const emulatorHost = process.env.DATASTORE_EMULATOR_HOST;

const mysqlTrace = vi.hoisted(() => ({
  active: false,
  statements: [] as string[],
  wrapped: new WeakSet<object>(),
}));

vi.mock("mysql2/promise", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mysql2/promise")>();
  return {
    ...actual,
    createPool: (...args: Parameters<typeof actual.createPool>) => {
      const pool = actual.createPool(...args);
      const getConnection = pool.getConnection.bind(pool);
      pool.getConnection = async () => {
        const connection = await getConnection();
        if (!mysqlTrace.wrapped.has(connection)) {
          mysqlTrace.wrapped.add(connection);
          for (const method of ["query", "execute"] as const) {
            const original = connection[method];
            connection[method] = function (this: unknown, ...inputs: unknown[]) {
              if (mysqlTrace.active && typeof inputs[0] === "string")
                mysqlTrace.statements.push(inputs[0]);
              return Reflect.apply(original, this, inputs) as unknown;
            } as never;
          }
        }
        return connection;
      };
      return pool;
    },
  };
});

describe.skipIf(postgresUrl === undefined)("PostgreSQL tenant index preparation", () => {
  it("skips SQL schema work on missing and later prepared tables", async () => {
    if (postgresUrl === undefined) throw new Error("PostgreSQL URL is required.");
    const statements: string[] = [];
    const connect = Reflect.get(Pool.prototype, "connect") as (this: Pool) => Promise<PoolClient>;
    const capture = vi.spyOn(Pool.prototype, "connect").mockImplementation(function (this: Pool) {
      return connect.call(this).then((client) => {
        const query = client.query.bind(client);
        client.query = function (...args: unknown[]) {
          if (typeof args[0] === "string") statements.push(args[0]);
          return Reflect.apply(query, client, args) as unknown;
        } as typeof client.query;
        return client;
      }) as never;
    });
    try {
      await exerciseSkip(
        () =>
          PostgresStorageFactory.newBuilder()
            .setOptions({ url: postgresUrl })
            .setStringifierRegistry(stringifiers())
            .build(),
        statements,
      );
    } finally {
      capture.mockRestore();
    }
  });

  it("rejects an incompatible disposable tenant table during default creation", async () => {
    if (postgresUrl === undefined) throw new Error("PostgreSQL URL is required.");
    const group = uniqueGroup();
    const table = `${group.name}_tenant`;
    const pool = new Pool({ connectionString: postgresUrl });
    let factory: PostgresStorageFactory | undefined;
    try {
      await pool.query(`CREATE TABLE "${table}" ("wrong" TEXT)`);
      factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgresUrl })
        .setStringifierRegistry(stringifiers())
        .build();
      await expect(
        PersistentTenantIndex.create({ storageFactory: factory, group }),
      ).rejects.toThrow();
      await expect(factory.checkConnection()).resolves.toBeUndefined();
    } finally {
      await factory?.close();
      await pool.query(`DROP TABLE IF EXISTS "${table}"`);
      await pool.end();
    }
  });
});

describe.skipIf(mysqlUrl === undefined)("MySQL-family tenant index preparation", () => {
  it("skips SQL schema work on missing and later prepared tables", async () => {
    if (mysqlUrl === undefined) throw new Error("MySQL URL is required.");
    mysqlTrace.active = true;
    try {
      await exerciseSkip(
        () =>
          MysqlStorageFactory.newBuilder()
            .setOptions({ url: mysqlUrl })
            .setStringifierRegistry(stringifiers())
            .build(),
        mysqlTrace.statements,
      );
    } finally {
      mysqlTrace.active = false;
      mysqlTrace.statements.length = 0;
    }
  });
});

describe.skipIf(emulatorHost === undefined)("Datastore tenant index preparation", () => {
  it("skips the namespace probe when preparation is disabled", async () => {
    const group = uniqueGroup();
    let client: Datastore | undefined;
    let factory: DatastoreStorageFactory | undefined;
    let queries: ReturnType<typeof vi.spyOn<Datastore, "createQuery">> | undefined;
    let skipped: PersistentTenantIndex | undefined;
    let prepared: PersistentTenantIndex | undefined;
    try {
      client = new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" });
      queries = vi.spyOn(client, "createQuery");
      factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
      skipped = await PersistentTenantIndex.create({
        storageFactory: factory,
        group,
        createMissingStructures: false,
      });
      expect(queries).not.toHaveBeenCalledWith("", "__namespace__");
      prepared = await PersistentTenantIndex.create({ storageFactory: factory, group });
      expect(queries).toHaveBeenCalledWith("", "__namespace__");
      queries.mockClear();
      await skipped.keep(tenant("prepared"));
      expect(await skipped.contains(tenant("prepared"))).toBe(true);
      expect(queries).not.toHaveBeenCalledWith("", "__namespace__");
    } finally {
      await skipped?.close();
      await prepared?.close();
      await factory?.close();
      queries?.mockRestore();
    }
  });
});

/**
 * Exercises explicit skipped preparation through a real SQL provider.
 */
async function exerciseSkip(
  open: () => Promise<StorageFactory>,
  statements: string[],
): Promise<void> {
  const group = uniqueGroup();
  let factory: StorageFactory | undefined;
  let skipped: PersistentTenantIndex | undefined;
  let prepared: PersistentTenantIndex | undefined;
  try {
    factory = await open();
    statements.length = 0;
    skipped = await PersistentTenantIndex.create({
      storageFactory: factory,
      group,
      createMissingStructures: false,
    });
    expect(statements.some(isPreparationSql)).toBe(false);
    await expect(skipped.contains(tenant("missing"))).rejects.toThrow();
    expect(statements.some((sql) => /^SELECT\b/u.test(sql))).toBe(true);
    expect(statements.some(isPreparationSql)).toBe(false);
    prepared = await PersistentTenantIndex.create({ storageFactory: factory, group });
    statements.length = 0;
    await skipped.keep(tenant("prepared"));
    expect(await skipped.contains(tenant("prepared"))).toBe(true);
    expect(statements.some(isPreparationSql)).toBe(false);
  } finally {
    await skipped?.close();
    await prepared?.close();
    await factory?.close();
  }
}

/**
 * Matches SQL that prepares or checks a physical record family.
 */
function isPreparationSql(sql: string): boolean {
  return /information_schema|^CREATE\b|^ALTER\b|^DROP\b/u.test(sql);
}

/**
 * Selects a disposable physical record family.
 */
function uniqueGroup(): StorageGroup {
  return new StorageGroup(`tidx_${randomUUID().replaceAll("-", "")}`);
}

/**
 * Supplies SQL message-key schemas for the tenant registration record.
 */
function stringifiers(): StringifierRegistry {
  const registry = new StringifierRegistry();
  registry.setTypeRegistry(new TypeRegistry([TenantIdSchema, TenantSchema]));
  return registry;
}
