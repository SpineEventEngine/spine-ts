/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { Datastore } from "../../../storage-datastore/node_modules/@google-cloud/datastore/build/src/index.js";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Inbox } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { ShardedWorkRegistry } from "../../src/delivery/sharded-work-registry.js";
import { createMessage } from "./inbox-message-fixture.js";

const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
const datastoreHost = process.env.DATASTORE_EMULATOR_HOST;

describe.skipIf(mysqlUrl === undefined)("MySQL Inbox cleanup", () => {
  let factory: MysqlStorageFactory;

  beforeAll(async () => {
    if (mysqlUrl === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
    factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: mysqlUrl })
      .setStringifierRegistry(stringifiers)
      .build();
  });
  afterAll(() => factory?.close());

  it("deletes only the exact delivered snapshot under the current leased session", async () => {
    const context = { name: `t0191_mysql_${String(Date.now())}`, multitenant: false } as const;
    await expect(removeExact(factory, context)).resolves.toBeUndefined();
  });
});

describe.skipIf(datastoreHost === undefined)("Datastore Inbox cleanup", () => {
  it("deletes only the exact delivered snapshot under the current leased session", async () => {
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(
        new Datastore({ projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-t0191-emulator" }),
      )
      .setStringifierRegistry(stringifiers)
      .build();
    const context = { name: `t0191_datastore_${String(Date.now())}`, multitenant: false } as const;
    try {
      await expect(removeExact(factory, context)).resolves.toBeUndefined();
    } finally {
      factory.close();
    }
  });
});

async function removeExact(
  factory: Parameters<typeof open>[0],
  context: { readonly name: string; readonly multitenant: false },
): Promise<void> {
  let now = Date.now();
  const inbox = open(factory, context, () => new Date(now));
  const registry = new ShardedWorkRegistry({
    context,
    storageFactory: factory,
    leaseMs: 1_000,
    now: () => new Date(now),
  });
  const worker = (node: string) =>
    create(WorkerIdSchema, { nodeId: { value: node }, value: "worker" });
  const seed = `${context.name}-${String(Date.now())}`;
  const session = await registry.pickUp(ShardIndex.single(), worker("current"));
  if (session === undefined) throw new Error("Expected current MySQL/Datastore session.");
  const message = createMessage(`${seed}-provider`, "exact", 1n);
  await inbox.storage.write(message);
  const delivered = await inbox.markDelivered(message);
  if (delivered === undefined) throw new Error("Expected delivered provider row.");
  await expect(inbox.removeDelivered(delivered, session)).resolves.toBe(true);
  await expect(inbox.readMessage(message.id)).resolves.toBeUndefined();

  const stale = createMessage(`${seed}-stale`, "stale", 2n);
  await inbox.storage.write(stale);
  const staleDelivered = await inbox.markDelivered(stale);
  now += 1_000;
  const replacement = await registry.pickUp(ShardIndex.single(), worker("replacement"));
  expect(replacement).toBeDefined();
  await expect(inbox.removeDelivered(staleDelivered!, session)).resolves.toBe(false);
  await expect(inbox.readMessage(stale.id)).resolves.toMatchObject({ status: "DELIVERED" });

  const expired = createMessage(`${seed}-expired`, "expired", 3n);
  await inbox.storage.write(expired);
  const expiredDelivered = await inbox.markDelivered(expired);
  now += 1_001;
  await expect(inbox.removeDelivered(expiredDelivered!, replacement!)).resolves.toBe(false);
  await expect(inbox.readMessage(expired.id)).resolves.toMatchObject({ status: "DELIVERED" });

  const current = await registry.pickUp(ShardIndex.single(), worker("current-again"));
  if (current === undefined) throw new Error("Expected renewed provider session.");

  const replaced = createMessage(`${seed}-replaced`, "replaced", 4n);
  await inbox.storage.write(replaced);
  const replacedDelivered = await inbox.markDelivered(replaced);
  await expect(
    inbox.removeDelivered(
      { ...replacedDelivered!, version: replacedDelivered!.version + 1n },
      current,
    ),
  ).resolves.toBe(false);
  await expect(inbox.readMessage(replaced.id)).resolves.toMatchObject({ status: "DELIVERED" });
}

function open(
  factory: MysqlStorageFactory | DatastoreStorageFactory,
  context: { readonly name: string; readonly multitenant: false },
  now?: () => Date,
): Inbox {
  return new Inbox(new InboxStorage({ context, storageFactory: factory, now }));
}
