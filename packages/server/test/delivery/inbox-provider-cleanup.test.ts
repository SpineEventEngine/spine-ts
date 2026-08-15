/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from "@bufbuild/protobuf";
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
    factory = await MysqlStorageFactory.newBuilder().setOptions({ url: mysqlUrl }).build();
  });
  afterAll(() => factory.close());

  it("deletes only the exact delivered snapshot under the current leased session", async () => {
    const context = { name: `t0191_mysql_${String(Date.now())}`, multitenant: false } as const;
    await expect(removeExact(factory, context)).resolves.toBeUndefined();
  });
});

describe.skipIf(datastoreHost === undefined)("Datastore Inbox cleanup", () => {
  it("deletes only the exact delivered snapshot under the current leased session", async () => {
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient(
        new Datastore({ projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-t0191-emulator" }),
      )
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
  const inbox = open(factory, context);
  const registry = new ShardedWorkRegistry({ context, storageFactory: factory });
  const session = await registry.pickUp(
    ShardIndex.single(),
    create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
  );
  const message = createMessage("provider", "exact", 1n);
  await inbox.storage.write(message);
  const delivered = await inbox.markDelivered(message);
  await expect(inbox.removeDelivered(delivered!, session!)).resolves.toBe(true);
  await expect(inbox.readMessage(message.id)).resolves.toBeUndefined();
  await registry.close();
}

function open(
  factory: MysqlStorageFactory | DatastoreStorageFactory,
  context: { readonly name: string; readonly multitenant: false },
): Inbox {
  return new Inbox(new InboxStorage({ context, storageFactory: factory }));
}
