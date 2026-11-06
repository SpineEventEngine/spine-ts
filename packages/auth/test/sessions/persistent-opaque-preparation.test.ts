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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  AuthenticatedPrincipalSchema,
  OpaqueSessionRecordSchema,
} from "@spine-event-engine/proto/auth";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PersistentOpaqueSessionStore } from "../../src/index.js";

const postgresUrl = process.env.SPINE_TS_POSTGRESQL_URL;
const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
const datastoreHost = process.env.DATASTORE_EMULATOR_HOST;
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

describe.skipIf(postgresUrl === undefined)("PostgreSQL opaque preparation", () => {
  it("skips metadata and DDL on missing and later prepared structures", async () => {
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
});

describe.skipIf(mysqlUrl === undefined)("MySQL-family opaque preparation", () => {
  it("skips metadata and DDL on missing and later prepared structures", async () => {
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

describe.skipIf(datastoreHost === undefined)("Datastore opaque preparation", () => {
  it("skips the namespace probe on the non-preparing handle", async () => {
    const client = new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" });
    const queries = vi.spyOn(client, "createQuery");
    const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
    const group = uniqueGroup();
    let skipped: PersistentOpaqueSessionStore | undefined;
    let prepared: PersistentOpaqueSessionStore | undefined;
    try {
      skipped = await PersistentOpaqueSessionStore.create({
        storageFactory: factory,
        group,
        createMissingStructures: false,
      });
      expect(queries).not.toHaveBeenCalledWith("", "__namespace__");
      prepared = await PersistentOpaqueSessionStore.create({ storageFactory: factory, group });
      expect(queries).toHaveBeenCalledWith("", "__namespace__");
      queries.mockClear();
      await skipped.insert(record("prepared"));
      expect(await skipped.read("prepared")).toBeDefined();
      expect(queries).not.toHaveBeenCalledWith("", "__namespace__");
    } finally {
      await skipped?.close();
      await prepared?.close();
      await factory.close();
      queries.mockRestore();
    }
  });
});

/**
 * Exercises a false handle before and after default preparation through real SQL.
 * @param open Creates a disposable provider factory.
 * @param statements Captured native statements.
 */
async function exerciseSkip(
  open: () => Promise<StorageFactory>,
  statements: string[],
): Promise<void> {
  const group = uniqueGroup();
  let factory: StorageFactory | undefined;
  let skipped: PersistentOpaqueSessionStore | undefined;
  let prepared: PersistentOpaqueSessionStore | undefined;
  try {
    factory = await open();
    statements.length = 0;
    skipped = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      createMissingStructures: false,
    });
    expect(statements.some(isPreparationSql)).toBe(false);
    await expect(skipped.read("missing")).rejects.toThrow();
    expect(statements.some((sql) => /^SELECT\b/u.test(sql))).toBe(true);
    expect(statements.some(isPreparationSql)).toBe(false);
    prepared = await PersistentOpaqueSessionStore.create({ storageFactory: factory, group });
    expect(statements.some(isPreparationSql)).toBe(true);
    statements.length = 0;
    await skipped.insert(record("prepared"));
    expect(await skipped.read("prepared")).toBeDefined();
    expect(statements.some(isPreparationSql)).toBe(false);
  } finally {
    await skipped?.close();
    await prepared?.close();
    await factory?.close();
  }
}

/**
 * @returns Whether SQL performs physical preparation or metadata checks.
 */
function isPreparationSql(sql: string): boolean {
  return /information_schema|^CREATE\b|^ALTER\b|^DROP\b/u.test(sql);
}

/**
 * @returns A disposable physical record group.
 */
function uniqueGroup(): StorageGroup {
  return new StorageGroup(`opaque_${randomUUID().replaceAll("-", "")}`);
}

/**
 * @returns Domain message metadata for SQL serialization.
 */
function stringifiers(): StringifierRegistry {
  const registry = new StringifierRegistry();
  registry.setTypeRegistry(
    new TypeRegistry([AuthenticatedPrincipalSchema, OpaqueSessionRecordSchema]),
  );
  return registry;
}

/**
 * Creates a domain-correct opaque session record for physical preparation checks.
 * @param id Stable record identifier.
 * @returns Complete session record.
 */
function record(id: string) {
  return create(OpaqueSessionRecordSchema, {
    id,
    generation: "generation",
    principal: create(AuthenticatedPrincipalSchema, { id: "principal" }),
    whenExpires: create(TimestampSchema, { seconds: 100n }),
  });
}
