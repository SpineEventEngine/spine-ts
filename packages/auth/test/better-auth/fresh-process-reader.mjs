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

import { Datastore } from "@google-cloud/datastore";
import process from "node:process";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  BetterAuthAccountRecordSchema,
  BetterAuthSessionRecordSchema,
  BetterAuthUserRecordSchema,
  BetterAuthVerificationRecordSchema,
} from "@spine-event-engine/proto/auth";
import { StorageGroup } from "@spine-event-engine/storage";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { betterAuth } from "better-auth";

import {
  PersistentBetterAuthStore,
  nativeFactoryFor,
} from "../../dist/better-auth/persistent-store.js";

const [provider, groupName, token] = process.argv.slice(2);
const stringifiers = new StringifierRegistry();
stringifiers.setTypeRegistry(
  new TypeRegistry([
    BetterAuthUserRecordSchema,
    BetterAuthAccountRecordSchema,
    BetterAuthSessionRecordSchema,
    BetterAuthVerificationRecordSchema,
  ]),
);
const open = () => {
  switch (provider) {
    case "postgres":
      return PostgresStorageFactory.newBuilder()
        .setOptions({ url: process.env.SPINE_TS_POSTGRESQL_URL })
        .setStringifierRegistry(stringifiers)
        .build();
    case "mysql":
      return MysqlStorageFactory.newBuilder()
        .setOptions({ url: process.env.SPINE_TS_MYSQL_URL })
        .setStringifierRegistry(stringifiers)
        .build();
    case "datastore":
      return DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: "spine-persistent-tenant-auth-emulator" }))
        .build();
    default:
      throw new Error("Unsupported test provider.");
  }
};

let factory;
let store;
try {
  factory = await open();
  store = await PersistentBetterAuthStore.create({
    storageFactory: factory,
    group: new StorageGroup(groupName),
    models: ["user", "account", "session", "verification"],
    createMissingStructures: false,
    clock: () => timestampFromDate(new Date("2025-02-01T00:00:00.001Z")),
  });
  const auth = betterAuth({
    database: nativeFactoryFor(store),
    secret: "provider-test-secret-32-characters-long",
    baseURL: "http://localhost:3000",
    advanced: { database: { validateSchema: false } },
  });
  const row = await (
    await auth.$context
  ).adapter.findOne({
    model: "session",
    where: [{ field: "token", value: token }],
  });
  if (row?.userId !== "user-1") throw new Error("Session did not survive process restart.");
  process.stdout.write("verified\n");
} catch {
  process.stderr.write("Fresh process Better Auth persistence proof failed.\n");
  process.exitCode = 1;
} finally {
  await store?.close();
  await factory?.close();
}
