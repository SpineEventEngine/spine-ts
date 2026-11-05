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
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  BetterAuthAccountRecordSchema,
  BetterAuthSessionRecordSchema,
  BetterAuthUserRecordSchema,
  BetterAuthVerificationRecordSchema,
} from "@spine-event-engine/proto/auth";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { betterAuth } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { describe, expect, it } from "vitest";

import { PersistentBetterAuthStore } from "../../src/better-auth/index.js";
import { nativeFactoryFor } from "../../src/better-auth/persistent-store.js";

const postgres = process.env.SPINE_TS_POSTGRESQL_URL;
const mysql = process.env.SPINE_TS_MYSQL_URL;
const datastore = process.env.DATASTORE_EMULATOR_HOST;

describe.skipIf(postgres === undefined)("PostgreSQL Better Auth records", () => {
  it("replays native selected records across independent factories", async () => {
    if (postgres === undefined) throw new Error("PostgreSQL URL is required.");
    await exercise("postgres", () =>
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgres })
        .setStringifierRegistry(stringifiers())
        .build(),
    );
  });
});

describe.skipIf(mysql === undefined)("MySQL-family Better Auth records", () => {
  it("replays native selected records across independent factories", async () => {
    if (mysql === undefined) throw new Error("MySQL URL is required.");
    await exercise("mysql", () =>
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: mysql })
        .setStringifierRegistry(stringifiers())
        .build(),
    );
  });
});

describe.skipIf(datastore === undefined)("Datastore Better Auth records", () => {
  it("replays native selected records across independent factories", async () => {
    await exercise("datastore", () =>
      DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" }))
        .build(),
    );
  });
});

/**
 * Exercises selected native records over two independent provider factories.
 *
 * @param provider Selected provider used by the independent child process.
 * @param open Constructs one fresh provider factory.
 */
async function exercise(
  provider: "postgres" | "mysql" | "datastore",
  open: () => StorageFactory | Promise<StorageFactory>,
): Promise<void> {
  const group = new StorageGroup(
    `orders_better_auth_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  );
  const early = new Date("2025-01-01T00:00:00.000Z");
  const cutoff = new Date("2025-02-01T00:00:00.001Z");
  const clock = () => timestampFromDate(cutoff);
  const firstFactory = await open();
  const secondFactory = await open();
  let first: PersistentBetterAuthStore | undefined;
  let second: PersistentBetterAuthStore | undefined;
  try {
    first = await PersistentBetterAuthStore.create({
      storageFactory: firstFactory,
      group,
      models: ["user", "account", "session", "verification"],
      clock,
    });
    second = await PersistentBetterAuthStore.create({
      storageFactory: secondFactory,
      group,
      models: ["user", "account", "session", "verification"],
      clock,
      createMissingStructures: false,
    });
    const a = await adapter(first);
    const b = await adapter(second);
    await first.provision({
      users: [
        {
          id: "user-1",
          name: "Ada",
          email: "ada@example.test",
          emailVerified: true,
          createdAt: early,
          updatedAt: early,
        },
      ],
      accounts: [
        {
          userId: "user-1",
          providerId: "credential",
          accountId: "user-1",
          password: "precomputed-hash",
          createdAt: early,
          updatedAt: early,
        },
      ],
    });
    expect(
      (
        await b.findOne<{ id: string }>({
          model: "user",
          where: [{ field: "email", value: "ada@example.test" }],
        })
      )?.id,
    ).toBe("user-1");
    expect(
      (
        await b.findOne<{ userId: string }>({
          model: "account",
          where: [
            { field: "providerId", value: "credential" },
            { field: "accountId", value: "user-1" },
          ],
        })
      )?.userId,
    ).toBe("user-1");
    await a.create({
      model: "session",
      data: {
        token: "session-token",
        userId: "user-1",
        expiresAt: new Date("2025-03-01T00:00:00.000Z"),
        createdAt: early,
        updatedAt: early,
      },
    });
    expect(
      (
        await b.findOne<{ userId: string }>({
          model: "session",
          where: [{ field: "token", value: "session-token" }],
        })
      )?.userId,
    ).toBe("user-1");
    const child = await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("./fresh-process-reader.mjs", import.meta.url)),
        provider,
        group.name,
        "session-token",
      ],
      { env: process.env },
    );
    expect(child.stdout.trim()).toBe("verified");
    await a.create({
      model: "session",
      data: {
        token: "expired-token",
        userId: "user-1",
        expiresAt: new Date("2025-02-01T00:00:00.000Z"),
        createdAt: early,
        updatedAt: early,
      },
    });
    expect(
      await b.findOne({ model: "session", where: [{ field: "token", value: "expired-token" }] }),
    ).toBeNull();
    expect(await second.purgeExpired(timestampFromDate(cutoff))).toBe(1);
    await a.create({
      model: "verification",
      data: {
        identifier: "auth-state:cross-factory",
        value: "state-value",
        expiresAt: new Date("2025-03-01T00:00:00.000Z"),
        createdAt: early,
        updatedAt: early,
      },
    });
    await b.delete({
      model: "verification",
      where: [{ field: "identifier", value: "auth-state:cross-factory" }],
    });
    await expect(
      a.delete({
        model: "verification",
        where: [{ field: "identifier", value: "auth-state:cross-factory" }],
      }),
    ).rejects.toThrow(/consumed/u);
  } finally {
    await first?.close();
    await second?.close();
    await firstFactory.close();
    await secondFactory.close();
  }
}

/**
 * Initializes the actual native factory for a selected persistent store.
 *
 * @param store Prepared provider-backed store.
 * @returns Better Auth's transformed adapter.
 */
async function adapter(store: PersistentBetterAuthStore) {
  const auth = betterAuth({
    database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
    secret: "provider-test-secret-32-characters-long",
    baseURL: "http://localhost:3000",
    advanced: { database: { validateSchema: false } },
  });
  return (await auth.$context).adapter;
}

/**
 * Supplies complete selected Protobuf metadata to SQL record serialization.
 *
 * @returns Type-aware provider stringifiers.
 */
function stringifiers(): StringifierRegistry {
  const registry = new StringifierRegistry();
  registry.setTypeRegistry(
    new TypeRegistry([
      BetterAuthUserRecordSchema,
      BetterAuthAccountRecordSchema,
      BetterAuthSessionRecordSchema,
      BetterAuthVerificationRecordSchema,
    ]),
  );
  return registry;
}
