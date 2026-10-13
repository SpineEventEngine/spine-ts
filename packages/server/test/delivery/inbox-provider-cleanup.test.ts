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
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { TaskListIdSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { Datastore } from "@google-cloud/datastore";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Inbox } from "../../src/delivery/inbox.js";
import { Delivery } from "../../src/delivery/delivery.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { InboxRecords, inboxRecordSpec } from "../../src/delivery/inbox-records.js";
import {
  ShardedWorkRegistry,
  shardSessionRecordSpec,
} from "../../src/delivery/sharded-work-registry.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { createMessage } from "./inbox-message-fixture.js";
import { providerEnabled } from "./inbox-provider-selection.js";

const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
const postgresqlUrl = process.env.SPINE_TS_POSTGRESQL_URL;
const datastoreHost = process.env.DATASTORE_EMULATOR_HOST;
const datastoreProject = process.env.DATASTORE_PROJECT_ID ?? "spine-wave12";
const inboxProvider = process.env.SPINE_TS_INBOX_PROVIDER;
const mysqlEngine = process.env.SPINE_TS_MYSQL_ENGINE?.toUpperCase();

describe.skipIf(!providerEnabled(inboxProvider, "mysql", mysqlUrl !== undefined))(
  "MySQL Inbox cleanup",
  () => {
    let factory: MysqlStorageFactory;
    let secondFactory: MysqlStorageFactory;

    beforeAll(async () => {
      if (mysqlUrl === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
      const stringifiers = new StringifierRegistry();
      stringifiers.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
      factory = await MysqlStorageFactory.newBuilder()
        .setOptions({ url: mysqlUrl })
        .setStringifierRegistry(stringifiers)
        .build();
      secondFactory = await MysqlStorageFactory.newBuilder()
        .setOptions({ url: mysqlUrl })
        .setStringifierRegistry(stringifiers)
        .build();
    });
    afterAll(() => {
      factory.close();
      secondFactory.close();
    });

    it("deletes eligible delivered IDs directly", async () => {
      const context = {
        name: `t0191_mysql_${randomUUID()}`,
        multitenant: false,
      } as const;
      await expect(removeExact(factory, context)).resolves.toBeUndefined();
    });

    it("shares direct ID deletion across independently opened factories", async () => {
      const context = {
        name: `t0191_mysql_two_factory_${randomUUID()}`,
        multitenant: false,
      } as const;
      await expect(
        removeAcrossFactories(factory, secondFactory, context, () => mysqlCount(factory, context)),
      ).resolves.toBeUndefined();
    });

    it.skipIf(mysqlEngine !== "MYISAM" && mysqlEngine !== "ARIA")(
      "deletes Inbox rows and updates shard sessions on physical nontransactional tables",
      async () => {
        if (mysqlUrl === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
        if (mysqlEngine === undefined) throw new Error("Expected a selected MySQL engine.");
        const context = {
          name: `t0191_mysql_physical_${randomUUID()}`,
          multitenant: false,
        } as const;
        const inboxStorage = factory.createRecordStorage(context, inboxRecordSpec);
        const inboxId = InboxRecords.write(createMessage(`${context.name}-init`, "init", 1n)).id;
        if (inboxId === undefined) throw new Error("Expected an Inbox ID.");
        await inboxStorage.read(inboxId);
        const inboxTable = (inboxStorage as unknown as { tableName: string }).tableName;
        inboxStorage.close();
        const sessionStorage = factory.createRecordStorage(context, shardSessionRecordSpec);
        await sessionStorage.read(create(ShardIndexSchema, { index: 0, ofTotal: 1 }));
        const sessionTable = (sessionStorage as unknown as { tableName: string }).tableName;
        sessionStorage.close();
        const connection = await createConnection(mysqlUrl);
        const originals = new Map<string, { engine: string; charset: string; collation: string }>();
        try {
          for (const table of [inboxTable, sessionTable]) {
            const [original] = await connection.query<(RowDataPacket & { engine: string })[]>(
              "SELECT ENGINE AS engine FROM information_schema.tables " +
                "WHERE table_schema = DATABASE() AND table_name = ?",
              [table],
            );
            const prior = original[0]?.engine.toUpperCase();
            if (prior === undefined || !["INNODB", "MYISAM", "ARIA"].includes(prior))
              throw new Error("Expected a supported physical table engine.");
            const [columns] = await connection.query<
              (RowDataPacket & { charset: string; collation: string })[]
            >(
              "SELECT CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation " +
                "FROM information_schema.columns WHERE table_schema = DATABASE() " +
                "AND table_name = ? AND column_name = 'ID'",
              [table],
            );
            const charset = columns[0]?.charset;
            const collation = columns[0]?.collation;
            if (
              charset === undefined ||
              collation === undefined ||
              !/^[a-z0-9_]+$/i.test(charset) ||
              !/^[a-z0-9_]+$/i.test(collation)
            )
              throw new Error("Expected a supported ID column collation.");
            originals.set(table, { engine: prior, charset, collation });
            await connection.query(
              `ALTER TABLE \`${table}\` MODIFY \`ID\` VARCHAR(512) ` +
                `CHARACTER SET latin1 COLLATE latin1_bin NOT NULL, ENGINE=${mysqlEngine}`,
            );
            const [rows] = await connection.query<(RowDataPacket & { engine: string })[]>(
              "SELECT ENGINE AS engine FROM information_schema.tables " +
                "WHERE table_schema = DATABASE() AND table_name = ?",
              [table],
            );
            expect(rows[0]?.engine.toUpperCase()).toBe(mysqlEngine);
          }
          await removeExact(factory, context);
          const registry = new ShardedWorkRegistry({ context, storageFactory: factory });
          const shard = ShardIndex.single();
          const worker = create(WorkerIdSchema, { nodeId: { value: "node-1" }, value: "worker-1" });
          const session = await registry.pickUp(shard, worker);
          expect(session).toBeDefined();
          if (session === undefined) throw new Error("Expected a shard session.");
          await expect(registry.release(session)).resolves.toBe(true);

          const inbox = open(factory, context);
          const expired = createMessage(
            `${context.name}-expired`,
            "expired",
            3n,
            new Date("2026-07-01T00:00:00.000Z"),
          );
          const pending = createMessage(
            `${context.name}-pending`,
            "pending",
            4n,
            new Date("2026-07-01T01:00:00.000Z"),
          );
          await inbox.storage.write(expired);
          await inbox.markDelivered(expired);
          await inbox.storage.write(pending);
          const seen: string[] = [];
          const delivery = new Delivery({
            context,
            storageFactory: factory,
            pageSize: 1,
            inbox,
            workRegistry: registry,
          });
          await expect(
            delivery.drain(shard, {
              onMessage: (row) => {
                seen.push(row.id.value);
              },
            }),
          ).resolves.toMatchObject({ status: "DRAINED", delivered: 1 });
          expect(seen).toEqual([pending.id.value]);
          await expect(inbox.readMessage(expired.id)).resolves.toBeUndefined();
        } finally {
          for (const [table, original] of originals)
            await connection.query(
              `ALTER TABLE \`${table}\` MODIFY \`ID\` VARCHAR(512) ` +
                `CHARACTER SET ${original.charset} COLLATE ${original.collation} ` +
                `NOT NULL, ENGINE=${original.engine}`,
            );
          await connection.end();
        }
      },
    );
  },
);

describe.skipIf(!providerEnabled(inboxProvider, "postgresql", postgresqlUrl !== undefined))(
  "PostgreSQL Inbox cleanup",
  () => {
    let factory: PostgresStorageFactory;
    let secondFactory: PostgresStorageFactory;

    beforeAll(async () => {
      if (postgresqlUrl === undefined) throw new Error("SPINE_TS_POSTGRESQL_URL is required.");
      const stringifiers = new StringifierRegistry();
      stringifiers.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
      factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgresqlUrl })
        .setStringifierRegistry(stringifiers)
        .build();
      secondFactory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: postgresqlUrl })
        .setStringifierRegistry(stringifiers)
        .build();
    });
    afterAll(() => {
      factory.close();
      secondFactory.close();
    });

    it("deletes eligible delivered IDs directly", async () => {
      const context = {
        name: `t0230_postgresql_${randomUUID()}`,
        multitenant: false,
      } as const;
      await expect(removeExact(factory, context)).resolves.toBeUndefined();
    });

    it("shares direct ID deletion across independently opened factories", async () => {
      const context = {
        name: `t0230_postgresql_two_factory_${randomUUID()}`,
        multitenant: false,
      } as const;
      await expect(removeAcrossFactories(factory, secondFactory, context)).resolves.toBeUndefined();
    });
  },
);

describe.skipIf(!providerEnabled(inboxProvider, "datastore", datastoreHost !== undefined))(
  "Datastore Inbox cleanup",
  () => {
    it("deletes eligible delivered IDs directly", async () => {
      const stringifiers = new StringifierRegistry();
      stringifiers.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
      const factory = DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: datastoreProject }))
        .setStringifierRegistry(stringifiers)
        .build();
      const context = {
        name: `t0191_datastore_${randomUUID()}`,
        multitenant: false,
      } as const;
      try {
        await expect(removeExact(factory, context)).resolves.toBeUndefined();
      } finally {
        factory.close();
      }
    });

    it("shares direct ID deletion across independently opened factories", async () => {
      const stringifiers = new StringifierRegistry();
      stringifiers.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
      const firstFactory = DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: datastoreProject }))
        .setStringifierRegistry(stringifiers)
        .build();
      const secondFactory = DatastoreStorageFactory.newBuilder()
        .setClient(new Datastore({ projectId: datastoreProject }))
        .setStringifierRegistry(stringifiers)
        .build();
      const context = {
        name: `t0191_datastore_two_factory_${randomUUID()}`,
        multitenant: false,
      } as const;
      try {
        await expect(
          removeAcrossFactories(firstFactory, secondFactory, context, (message) =>
            datastoreCount(firstFactory, context, message),
          ),
        ).resolves.toBeUndefined();
      } finally {
        firstFactory.close();
        secondFactory.close();
      }
    });
  },
);

async function removeExact(
  factory: Parameters<typeof open>[0],
  context: { readonly name: string; readonly multitenant: false },
): Promise<void> {
  const now = Date.now() + 7_200_000;
  const inbox = open(factory, context, () => new Date(now));
  const seed = `${context.name}-${randomUUID()}`;
  const message = createMessage(`${seed}-delivered`, "direct", 1n);
  await inbox.storage.write(message);
  const delivered = await inbox.markDelivered(message);
  if (delivered === undefined) throw new Error("Expected delivered provider row.");
  await expect(
    inbox.removeDelivered({ ...delivered, version: delivered.version + 1n }),
  ).resolves.toBe(true);
  await expect(inbox.readMessage(message.id)).resolves.toBeUndefined();
  await expect(inbox.removeDelivered(delivered)).resolves.toBe(false);

  const protectedMessage = {
    ...createMessage(`${seed}-protected`, "protected", 2n),
    keepUntil: new Date(now + 1),
  };
  await inbox.storage.write(protectedMessage);
  const protectedDelivered = await inbox.markDelivered(protectedMessage);
  if (protectedDelivered === undefined) throw new Error("Expected protected provider row.");
  await expect(inbox.removeDelivered(protectedDelivered)).resolves.toBe(false);
  await expect(inbox.readMessage(protectedMessage.id)).resolves.toMatchObject({
    status: "DELIVERED",
  });
}

async function removeAcrossFactories(
  firstFactory: MysqlStorageFactory | PostgresStorageFactory | DatastoreStorageFactory,
  secondFactory: MysqlStorageFactory | PostgresStorageFactory | DatastoreStorageFactory,
  context: { readonly name: string; readonly multitenant: false },
  count?: (message: Parameters<Inbox["removeDelivered"]>[0]) => Promise<number>,
): Promise<void> {
  const firstInbox = open(firstFactory, context);
  const secondInbox = open(secondFactory, context);
  const message = createMessage(`${context.name}-row`, "shared", 1n);
  await firstInbox.storage.write(message);
  const delivered = await firstInbox.markDelivered(message);
  if (delivered === undefined) throw new Error("Expected delivered provider row.");
  if (count !== undefined) await expect(count(delivered)).resolves.toBe(1);
  await expect(secondInbox.removeDelivered(delivered)).resolves.toBe(true);
  if (count !== undefined) await expect(count(delivered)).resolves.toBe(0);
  await expect(firstInbox.readMessage(message.id)).resolves.toBeUndefined();
  await expect(firstInbox.removeDelivered(delivered)).resolves.toBe(false);
}

async function mysqlCount(
  factory: MysqlStorageFactory,
  context: { readonly name: string; readonly multitenant: false },
): Promise<number> {
  if (mysqlUrl === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
  const storage = factory.createRecordStorage(context, inboxRecordSpec) as unknown as {
    tableName: string;
    close(): void;
  };
  const table = storage.tableName.replaceAll("`", "``");
  const connection = await createConnection(mysqlUrl);
  try {
    const [rows] = await connection.query<(RowDataPacket & { count: number })[]>(
      `SELECT COUNT(*) AS count FROM \`${table}\` WHERE bytes LIKE ?`,
      [`%${context.name}-row%`],
    );
    return rows[0]?.count ?? 0;
  } finally {
    storage.close();
    await connection.end();
  }
}

async function datastoreCount(
  factory: DatastoreStorageFactory,
  context: { readonly name: string; readonly multitenant: false },
  message: Parameters<Inbox["removeDelivered"]>[0],
): Promise<number> {
  const storage = factory.createRecordStorage(context, inboxRecordSpec) as unknown as {
    transactionEntity(value: ReturnType<typeof InboxRecords.write>): { key: unknown };
    close(): void;
  };
  const client = new Datastore({ projectId: datastoreProject });
  try {
    const [entities] = (await client.get(
      storage.transactionEntity(InboxRecords.write(message)).key as never,
    )) as [unknown];
    return entities === undefined ? 0 : 1;
  } finally {
    storage.close();
  }
}

function open(
  factory: MysqlStorageFactory | PostgresStorageFactory | DatastoreStorageFactory,
  context: { readonly name: string; readonly multitenant: false },
  now?: () => Date,
): Inbox {
  return new Inbox(
    new InboxStorage({ context, storageFactory: factory, ...(now === undefined ? {} : { now }) }),
  );
}
