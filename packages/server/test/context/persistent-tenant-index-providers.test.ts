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

import { create, toJsonString } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  TenantIdSchema,
  TenantSchema,
  type Tenant,
  type TenantId,
} from "@spine-event-engine/proto";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import {
  RecordSpec,
  StorageGroup,
  type RecordStorage,
  type StorageFactory,
} from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { PersistentTenantIndex } from "../../src/context/persistent-tenant-index.js";
import { tenant } from "../tenant-fixture.js";

const postgres = process.env.SPINE_TS_POSTGRESQL_URL;
const mysql = process.env.SPINE_TS_MYSQL_URL;
const datastore = process.env.DATASTORE_EMULATOR_HOST;

describe.skipIf(postgres === undefined)("PostgreSQL persistent tenant directory", () => {
  it("retains first registration and keyset traversal across factories", async () => {
    if (postgres === undefined) throw new Error("PostgreSQL URL is required.");
    await exercise(() =>
      PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgres })
        .setStringifierRegistry(stringifiers())
        .build(),
    );
  });
});

describe.skipIf(mysql === undefined)("MySQL-family persistent tenant directory", () => {
  it("retains first registration and keyset traversal across factories", async () => {
    if (mysql === undefined) throw new Error("MySQL URL is required.");
    await exercise(() =>
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: mysql })
        .setStringifierRegistry(stringifiers())
        .build(),
    );
  });
});

describe.skipIf(datastore === undefined)("Datastore persistent tenant directory", () => {
  it("retains first registration and keyset traversal across factories", async () => {
    await exercise(() =>
      DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" }))
        .build(),
    );
  });
});

/**
 * Uses two independent provider factories against one physical record group.
 */
async function exercise(open: () => StorageFactory | Promise<StorageFactory>): Promise<void> {
  const group = new StorageGroup(`tenant_${randomUUID().replaceAll("-", "")}`);
  const firstTime = create(TimestampSchema, { seconds: 11n });
  let firstFactory: StorageFactory | undefined;
  let secondFactory: StorageFactory | undefined;
  let first: PersistentTenantIndex | undefined;
  let second: PersistentTenantIndex | undefined;
  let records: RecordStorage<TenantId, Tenant> | undefined;
  try {
    firstFactory = await open();
    secondFactory = await open();
    first = await PersistentTenantIndex.create({
      storageFactory: firstFactory,
      group,
      clock: () => firstTime,
    });
    second = await PersistentTenantIndex.create({
      storageFactory: secondFactory,
      group,
      clock: () => create(TimestampSchema, { seconds: 22n }),
    });
    const ids = Array.from({ length: 9 }, (_, index) => tenant(`tenant-${String(index)}`));
    const firstId = ids[0];
    const lastId = ids[8];
    if (firstId === undefined || lastId === undefined) throw new Error("Expected tenant fixtures.");
    await first.keep(firstId);
    const activeFirst = first;
    const activeSecond = second;
    await Promise.all(
      ids.slice(1).map((id, index) => (index % 2 === 0 ? activeFirst : activeSecond).keep(id)),
    );
    await Promise.all([first.keep(firstId), second.keep(firstId)]);
    records = secondFactory.createRecordStorage(
      { name: "inspection", multitenant: false },
      new RecordSpec({
        recordType: TenantSchema,
        idSchema: TenantIdSchema,
        extractId: (record) => record.id ?? tenant("missing"),
      }),
      group,
      { prepareOnAccess: false },
    );
    expect((await records.read(firstId))?.whenCreated).toEqual(firstTime);
    expect(await second.contains(firstId)).toBe(true);
    const signal = new AbortController().signal;
    const seen = [];
    let after;
    do {
      const page = await second.page({ count: 2, signal, ...(after && { after }) });
      seen.push(...page.ids);
      after = page.after;
    } while (after !== undefined);
    expect(seen).toHaveLength(ids.length);
    expect(seen.map(idText).sort()).toEqual(ids.map(idText).sort());
    expect((await first.all()).map(idText).sort()).toEqual(ids.map(idText).sort());
    const firstPage = await second.page({ count: 1, signal });
    expect(firstPage.after).toBeDefined();
    const removed = firstPage.ids[0];
    if (removed === undefined || firstPage.after === undefined)
      throw new Error("Expected a continued first page.");
    await records.delete(removed);
    await first.keep(tenant("tenant-99"));
    const following = await second.page({ count: 9, signal, after: firstPage.after });
    expect(following.ids).toHaveLength(9);
    expect(following.ids).toContainEqual(tenant("tenant-99"));
    const race = tenant("race");
    await Promise.all([first.keep(race), second.keep(race)]);
    const winningTime = (await records.read(race))?.whenCreated;
    expect(winningTime).toBeDefined();
    expect([11n, 22n]).toContain(winningTime?.seconds);
    await Promise.all([first.keep(race), second.keep(race)]);
    expect((await records.read(race))?.whenCreated).toEqual(winningTime);
    await first.close();
    expect(await second.contains(lastId)).toBe(true);
  } finally {
    records?.close();
    await first?.close();
    await second?.close();
    await firstFactory?.close();
    await secondFactory?.close();
  }
}

/**
 * Converts a complete tenant identity to a comparable wire JSON value.
 */
function idText(id: TenantId): string {
  return toJsonString(TenantIdSchema, id);
}

/**
 * Supplies message schema metadata used by SQL record keys.
 */
function stringifiers(): StringifierRegistry {
  const registry = new StringifierRegistry();
  registry.setTypeRegistry(new TypeRegistry([TenantIdSchema, TenantSchema]));
  return registry;
}
