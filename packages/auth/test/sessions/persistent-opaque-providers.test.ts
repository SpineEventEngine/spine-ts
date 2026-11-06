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
import { StorageGroup, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";
import type { OpaqueSessionRecord } from "@spine-event-engine/proto/auth";

import { OpaqueSessions, PersistentOpaqueSessionStore } from "../../src/index.js";

const postgres = process.env.SPINE_TS_POSTGRESQL_URL;
const mysql = process.env.SPINE_TS_MYSQL_URL;
const datastore = process.env.DATASTORE_EMULATOR_HOST;
const password = "persistent opaque provider test password, 32 characters";

describe.skipIf(postgres === undefined)("PostgreSQL opaque sessions", () => {
  it("retains cross-factory generations and purges exact indexed deadlines", async () => {
    if (postgres === undefined) throw new Error("PostgreSQL URL is required.");
    await exercise(() =>
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgres })
        .setStringifierRegistry(stringifiers())
        .build(),
    );
  });
});

describe.skipIf(mysql === undefined)("MySQL-family opaque sessions", () => {
  it("retains cross-factory generations and purges exact indexed deadlines", async () => {
    if (mysql === undefined) throw new Error("MySQL URL is required.");
    await exercise(() =>
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: mysql })
        .setStringifierRegistry(stringifiers())
        .build(),
    );
  });
});

describe.skipIf(datastore === undefined)("Datastore opaque sessions", () => {
  it("retains cross-factory generations and purges exact indexed deadlines", async () => {
    await exercise(() =>
      DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" }))
        .build(),
    );
  });
});

/**
 * Exercises durable atomic transitions through two independent provider factories.
 * @param open Constructs one independent provider factory.
 */
async function exercise(open: () => StorageFactory | Promise<StorageFactory>): Promise<void> {
  const group = new StorageGroup(`opaque_${randomUUID().replaceAll("-", "")}`);
  let firstFactory: StorageFactory | undefined;
  let secondFactory: StorageFactory | undefined;
  let first: PersistentOpaqueSessionStore | undefined;
  let second: PersistentOpaqueSessionStore | undefined;
  let sessionsA: OpaqueSessions | undefined;
  let sessionsB: OpaqueSessions | undefined;
  try {
    firstFactory = await open();
    secondFactory = await open();
    const opened = vi.spyOn(firstFactory, "createRecordStorage");
    const maintenance = () => create(TimestampSchema, { seconds: 200n });
    first = await PersistentOpaqueSessionStore.create({
      storageFactory: firstFactory,
      group,
      clock: maintenance,
    });
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<string, OpaqueSessionRecord>;
    second = await PersistentOpaqueSessionStore.create({
      storageFactory: secondFactory,
      group,
      clock: maintenance,
      createMissingStructures: false,
    });
    const policy = {
      scope: "orders-browser",
      password,
      clock: { now: () => Date.now() },
      ttlMilliseconds: 60_000,
    };
    sessionsA = await OpaqueSessions.create({ ...policy, store: first });
    sessionsB = await OpaqueSessions.create({ ...policy, store: second });
    const issued = await sessionsA.issue({ id: "principal", attributes: {} });
    if (issued.kind !== "created") throw new Error("Expected provider issuance.");
    expect((await sessionsB.resolve(issued.credential))?.principal).toEqual({
      id: "principal",
      attributes: {},
    });
    const rotated = await sessionsB.rotate(issued.credential);
    if (rotated.kind !== "rotated") throw new Error("Expected provider rotation.");
    expect(await sessionsA.resolve(issued.credential)).toBeUndefined();
    expect(await sessionsA.resolve(rotated.credential)).toBeDefined();
    await sessionsA.logout(issued.credential);
    expect(await sessionsB.resolve(rotated.credential)).toBeUndefined();
    const expired = (id: string, nanos: number) =>
      create(OpaqueSessionRecordSchema, {
        id,
        generation: "generation",
        principal: create(AuthenticatedPrincipalSchema, { id: "principal" }),
        whenExpires: create(TimestampSchema, { seconds: 100n, nanos }),
      });
    await first.insert(expired("old-a", 1));
    await second.insert(expired("old-b", 1));
    for (let number = 0; number < 5; number += 1)
      await first.insert(expired(`page-${String(number)}`, 1));
    await second.insert(expired("later", 2));
    const query = handle.queryEntries.bind(handle);
    const pageSizes: number[] = [];
    vi.spyOn(handle, "queryEntries").mockImplementation(async (request) => {
      const page = await query({ ...request, limit: 2 });
      pageSizes.push(page.length);
      return page;
    });
    expect(await first.purgeExpired(create(TimestampSchema, { seconds: 100n, nanos: 1 }))).toBe(7);
    expect(pageSizes.filter((size) => size === 2).length).toBeGreaterThanOrEqual(3);
    expect(await second.read("old-a")).toBeUndefined();
    expect(await second.read("old-b")).toBeUndefined();
    for (let number = 0; number < 5; number += 1)
      expect(await second.read(`page-${String(number)}`)).toBeUndefined();
    expect(await first.read("later")).toBeDefined();
    await first.close();
    first = undefined;
    const reopened = await PersistentOpaqueSessionStore.create({
      storageFactory: firstFactory,
      group,
      clock: maintenance,
      createMissingStructures: false,
    });
    expect(await reopened.read("later")).toBeDefined();
    await reopened.close();
  } finally {
    await sessionsA?.close();
    await sessionsB?.close();
    await first?.close();
    await second?.close();
    await firstFactory?.close();
    await secondFactory?.close();
  }
}

/**
 * Supplies complete message metadata for provider record serialization.
 * @returns Registry for this domain record family.
 */
function stringifiers(): StringifierRegistry {
  const registry = new StringifierRegistry();
  registry.setTypeRegistry(
    new TypeRegistry([AuthenticatedPrincipalSchema, OpaqueSessionRecordSchema]),
  );
  return registry;
}
