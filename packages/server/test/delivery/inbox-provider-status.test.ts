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

import { randomInt, randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, StringifierRegistry, TypeRegistry, TypeUrls } from "@spine-event-engine/core";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { describe, expect, it } from "vitest";

import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { InboxRecords, inboxRecordSpec } from "../../src/delivery/inbox-records.js";
import type { InboxMessage, DeliveryStatus } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";

const providers = [
  { name: "memory", url: undefined },
  { name: "postgresql", url: process.env.SPINE_TS_POSTGRESQL_URL },
  { name: "mysql", url: process.env.SPINE_TS_MYSQL_URL },
] as const;

describe.each(providers)("$name Inbox status lists", ({ name, url }) => {
  it.skipIf(name !== "memory" && url === undefined)(
    "selects scalar statuses with stable pages and a deleted cursor",
    async () => {
      const stringifiers = new StringifierRegistry();
      stringifiers.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
      const factory: StorageFactory =
        name === "memory"
          ? new InMemoryStorageFactory()
          : name === "postgresql"
            ? await PostgresStorageFactory.newBuilder()
                .setOptions({ url: url ?? "" })
                .setStringifierRegistry(stringifiers)
                .build()
            : await MysqlStorageFactory.newBuilder()
                .setOptions({ url: url ?? "" })
                .setStringifierRegistry(stringifiers)
                .build();
      const context = {
        name: `sqlrel_status_${randomUUID().replaceAll("-", "")}`,
        multitenant: false,
      } as const;
      const storage = new InboxStorage({ context, storageFactory: factory });
      const shard = new ShardIndex(randomInt(1, 1_000_000_000), 1_000_000_000);
      const statuses = ["TO_DELIVER", "SCHEDULED", "DELIVERED", "TO_CATCH_UP"] as const;
      const messages = statuses.map((status, index) => statusMessage(index, status, shard));
      try {
        expect(await storage.read(shard, { statuses: ["DELIVERED"] })).toEqual([]);
        for (const message of messages) await storage.write(message);
        const ids = async (selected?: readonly (typeof statuses)[number][]) =>
          (await storage.read(shard, selected === undefined ? {} : { statuses: selected })).map(
            (message) => message.id.value,
          );

        expect(await ids()).toEqual(["status-0", "status-1", "status-2", "status-3"]);
        for (const [index, status] of statuses.entries())
          expect(await ids([status])).toEqual([`status-${String(index)}`]);
        expect(await ids(["DELIVERED", "TO_DELIVER"])).toEqual(["status-0", "status-2"]);
        expect(await ids(statuses)).toHaveLength(4);
        expect(await ids([])).toEqual([]);
        expect(await ids(["DELIVERED", "DELIVERED"])).toEqual(["status-2"]);
        for (const invalid of ["INVALID", "toString", "constructor", "__proto__"])
          await expect(storage.read(shard, { statuses: [invalid as never] })).rejects.toThrow(
            /status/i,
          );

        const firstPage = await storage.read(shard, {
          statuses: ["TO_DELIVER", "DELIVERED", "TO_CATCH_UP"],
          limit: 1,
        });
        expect(firstPage.map((message) => message.id.value)).toEqual(["status-0"]);
        const first = messages[0];
        if (first === undefined) throw new Error("Expected the first Inbox message.");
        const records = factory.createRecordStorage(context, inboxRecordSpec);
        try {
          await records.delete(inboxRecordSpec.idValueIn(InboxRecords.write(first)));
        } finally {
          records.close();
        }
        expect(
          (
            await storage.read(shard, {
              statuses: ["TO_DELIVER", "DELIVERED", "TO_CATCH_UP"],
              limit: 1,
              after: {
                messageId: first.id.value,
                whenReceived: first.whenReceived,
                version: first.version,
              },
            })
          ).map((message) => message.id.value),
        ).toEqual(["status-2"]);
      } finally {
        factory.close();
      }
    },
  );
});

function statusMessage(index: number, status: DeliveryStatus, shard: ShardIndex): InboxMessage {
  const taskListId = create(TaskListIdSchema, { value: "list-1" });
  const eventId = create(EventIdSchema, { value: `event-${String(index)}` });
  const event = create(EventSchema, {
    id: eventId,
    message: AnyPacker.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: `task-${String(index)}` }),
        taskListId,
        title: `Task ${String(index)}`,
      }),
    ),
  });
  return {
    id: { value: `status-${String(index)}`, shard },
    inboxId: {
      targetId: AnyPacker.pack(TaskListIdSchema, taskListId),
      targetTypeUrl: TypeUrls.derive(TaskListSchema),
    },
    signalId: eventId.value,
    signal: AnyPacker.pack(EventSchema, event),
    label: "UPDATE_SUBSCRIBER",
    status,
    shard,
    whenReceived: create(TimestampSchema, { seconds: 1_782_979_200n }),
    version: BigInt(index + 1),
  };
}
