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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";

import type { InboxMessage } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

export function createMessage(
  id: string,
  signalId: string,
  version: bigint,
  whenReceived = new Date("2026-07-02T08:00:00.000Z"),
): InboxMessage {
  const taskListId = create(TaskListIdSchema, { value: "list-1" });
  const event = create(EventSchema, {
    id: create(EventIdSchema, { value: signalId }),
    message: AnyMessages.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: id }),
        taskListId,
        title: `Task ${id}`,
      }),
    ),
  });
  return Object.freeze({
    id: Object.freeze({
      value: id,
      shard: ShardIndex.single(),
    }),
    inboxId: Object.freeze({
      targetId: AnyMessages.pack(TaskListIdSchema, taskListId),
      targetTypeUrl: TypeUrls.derive(TaskListSchema),
    }),
    signalId,
    signal: AnyMessages.pack(EventSchema, event, { validate: false }),
    label: "UPDATE_SUBSCRIBER" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
    whenReceived: create(TimestampSchema, {
      seconds: BigInt(Math.floor(whenReceived.getTime() / 1_000)),
      nanos: (((whenReceived.getTime() % 1_000) + 1_000) % 1_000) * 1_000_000,
    }),
    version,
  });
}

export function oversizedText(length: number, char = "x"): string {
  return char.repeat(length);
}

export function oversizedVersion(): bigint {
  return BigInt(`1${"0".repeat(16 * 1024)}`);
}
