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

import { Buffer } from "node:buffer";
import process from "node:process";
import { create, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  AnyPacker,
  Identifiers,
  StringifierRegistry,
  TypeRegistry,
  TypeUrls,
} from "@spine-event-engine/core";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import {
  InboxMessageSchema,
  ShardSessionRecordSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";

import { TaskCreatedSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/dist/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_list_pb.js";
import { Inbox } from "../../dist/delivery/inbox.js";
import { InboxStorage } from "../../dist/delivery/inbox-storage.js";
import { ShardIndex } from "../../dist/delivery/shard-index.js";
import { ShardedWorkRegistry } from "../../dist/delivery/sharded-work-registry.js";

const input = JSON.parse(process.argv[2] ?? "null");
if (input === null || typeof input !== "object") throw new Error("Writer input is required.");
const url = process.env.SPINE_TS_RECOVERY_WRITE_URL;
if (url === undefined) throw new Error("Writer SQL URL is required.");
const registry = new StringifierRegistry();
registry.setTypeRegistry(new TypeRegistry([TaskListIdSchema]));
const Factory = input.postgres ? PostgresStorageFactory : MysqlStorageFactory;
const factory = await Factory.newBuilder()
  .setOptions({ url })
  .setStringifierRegistry(registry)
  .setTableName(InboxMessageSchema, input.inboxTable)
  .setTableName(ShardSessionRecordSchema, input.sessionTable)
  .build();
try {
  const inbox = new Inbox(
    new InboxStorage({
      context: { name: input.contextName, multitenant: false },
      storageFactory: factory,
    }),
  );
  const taskListId = create(TaskListIdSchema, { value: input.taskListId });
  const event = create(EventSchema, {
    id: create(EventIdSchema, { value: input.signalId }),
    message: AnyPacker.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: input.taskId }),
        taskListId,
        title: input.signalId,
      }),
    ),
  });
  const result = await inbox.receive({
    inboxId: {
      targetId: Identifiers.pack(TaskListIdSchema, taskListId),
      targetTypeUrl: TypeUrls.derive(TaskListSchema),
    },
    signalId: input.signalId,
    signal: AnyPacker.pack(EventSchema, event),
    label: "UPDATE_SUBSCRIBER",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived: timestampFromDate(new Date()),
    version: 2n,
  });
  const contender = input.attemptPickup
    ? await new ShardedWorkRegistry({
        context: { name: input.contextName, multitenant: false },
        storageFactory: factory,
      }).pickUp(
        ShardIndex.single(),
        create(WorkerIdSchema, {
          nodeId: { value: `writer-${process.pid}` },
          value: `writer-${process.pid}`,
        }),
      )
    : undefined;
  const facts = {
    outcome: result.outcome,
    id: result.message.id.value,
    signalId: input.signalId,
    eventHex: Buffer.from(toBinary(EventSchema, event)).toString("hex"),
    pid: process.pid,
    pickup: input.attemptPickup
      ? contender === undefined
        ? "BLOCKED"
        : "ACQUIRED"
      : "NOT_ATTEMPTED",
  };
  process.stdout.write(`${JSON.stringify(facts)}\n`);
} finally {
  factory.close();
}
