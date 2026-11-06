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

import { createHash, randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { TokenRevocationSchema, type TokenRevocation } from "@spine-event-engine/proto/auth";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { StorageGroup, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import { PersistentTokenRevocations } from "../../src/index.js";
import { SessionRecords } from "../../src/sessions/session-record.js";

const postgres = process.env.SPINE_TS_POSTGRESQL_URL;
const mysql = process.env.SPINE_TS_MYSQL_URL;
const maria = process.env.SPINE_TS_MARIADB_URL;
const datastore = process.env.DATASTORE_EMULATOR_HOST;

for (const [name, url, open] of [
  ["PostgreSQL", postgres, () => sqlFactory("postgres", postgres)],
  ["MySQL", mysql, () => sqlFactory("mysql", mysql)],
  ["MariaDB", maria, () => sqlFactory("mysql", maria)],
  [
    "Datastore",
    datastore,
    () =>
      DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" }))
        .build(),
  ],
] as const) {
  describe.skipIf(url === undefined)(`${name} signed revocations`, () => {
    it("retains the maximum deadline and uses scoped indexed strict cleanup across factories", async () => {
      await exercise(open);
    });
  });
}

/**
 * Builds a SQL provider with the complete revocation schema registry.
 * @param dialect Selected SQL provider.
 * @param url Protected task-only connection URL.
 * @returns Provider factory for one independent handle set.
 */
function sqlFactory(
  dialect: "postgres" | "mysql",
  url: string | undefined,
): Promise<StorageFactory> {
  if (url === undefined) throw new Error("Provider URL is required.");
  const registry = new StringifierRegistry();
  registry.setTypeRegistry(new TypeRegistry([TokenRevocationSchema]));
  return dialect === "postgres"
    ? PostgresStorageFactory.newBuilder()
        .setOptions({ url })
        .setStringifierRegistry(registry)
        .build()
    : MysqlStorageFactory.newBuilder().setOptions({ url }).setStringifierRegistry(registry).build();
}

/**
 * Proves exact retention and provider index predicates over disposable groups.
 * @param open Creates an independent configured provider factory.
 */
async function exercise(open: () => StorageFactory | Promise<StorageFactory>): Promise<void> {
  const group = new StorageGroup(`rev_${randomUUID().replaceAll("-", "")}`);
  const clock = () => timestamp(100n);
  let firstFactory: StorageFactory | undefined;
  let secondFactory: StorageFactory | undefined;
  let first: PersistentTokenRevocations | undefined;
  let second: PersistentTokenRevocations | undefined;
  let other: PersistentTokenRevocations | undefined;
  try {
    firstFactory = await open();
    secondFactory = await open();
    const opened = vi.spyOn(firstFactory, "createRecordStorage");
    const options = {
      storageFactory: firstFactory,
      group,
      issuer: "issuer",
      audience: "client",
      clock,
    };
    first = await PersistentTokenRevocations.create(options);
    second = await PersistentTokenRevocations.create({
      ...options,
      storageFactory: secondFactory,
      createMissingStructures: false,
    });
    other = await PersistentTokenRevocations.create({
      ...options,
      storageFactory: secondFactory,
      audience: "other",
      createMissingStructures: false,
    });
    await Promise.all([
      first.revoke("shared", timestamp(150n)),
      second.revoke("shared", timestamp(200n, 2)),
      first.revoke("shared", timestamp(175n, 3)),
    ]);
    expect(await first.isRevoked("shared")).toBe(true);
    expect(await other.isRevoked("shared")).toBe(false);
    for (let index = 0; index < 24; index += 1)
      await other.revoke(`other-${String(index)}`, timestamp(-1n, 1));
    await first.revoke("selected", timestamp(-1n, 1));
    await second.revoke("later", timestamp(-1n, 2));
    const handle = opened.mock.results[0]?.value as RecordStorage<string, TokenRevocation>;
    const query = handle.queryPlanEntries.bind(handle);
    const scope = createHash("sha256")
      .update(JSON.stringify(["issuer", "client"]))
      .digest();
    const lower = Buffer.concat([scope, Buffer.alloc(12)]);
    const cutoff = timestamp(-1n, 2);
    const upper = Buffer.concat([scope, SessionRecords.orderKey(cutoff)]);
    let discoveries = 0;
    vi.spyOn(handle, "queryPlanEntries").mockImplementation(async (plan) => {
      discoveries += 1;
      const rows = await query(plan);
      expect(plan.predicate).toMatchObject({
        kind: "all",
        predicates: [
          { column: "expires_order", operator: "lessThan", value: upper },
          discoveries === 1
            ? { column: "expires_order", operator: "greaterOrEqual", value: lower }
            : { column: "expires_order", operator: "greaterThan" },
        ],
      });
      expect(
        rows.every((row) => row.record.issuer === "issuer" && row.record.audience === "client"),
      ).toBe(true);
      return rows;
    });
    expect(await first.purgeExpired(cutoff)).toBe(1);
    expect(discoveries).toBe(2);
    expect(await second.purgeExpired(timestamp(-1n, 3))).toBe(1);
    await first.close();
    first = undefined;
    const reopened = await PersistentTokenRevocations.create({
      ...options,
      createMissingStructures: false,
    });
    expect(await reopened.isRevoked("shared")).toBe(true);
    await reopened.close();
    expect(await other.purgeExpired(timestamp(-1n, 2))).toBe(24);
    expect(await other.isRevoked("other-0")).toBe(false);
  } finally {
    await first?.close();
    await second?.close();
    await other?.close();
    await firstFactory?.close();
    await secondFactory?.close();
  }
}

/**
 * Creates an exact Protobuf Timestamp for provider assertions.
 * @param seconds Signed seconds.
 * @param nanos Nanosecond component.
 * @returns Complete Timestamp.
 */
function timestamp(seconds: bigint, nanos = 0) {
  return create(TimestampSchema, { seconds, nanos });
}
