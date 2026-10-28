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
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";

import type { InboxMessage } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

/**
 * Creates a pending Task Event for one generated TaskList recipient.
 *
 * @param id Task identifier in the domain Event.
 * @param signalId Event identifier in the delivery row.
 * @param version Initial Inbox row version.
 * @param whenReceived Timestamp of durable reception.
 * @param targetId TaskList identifier shared by the Event and Inbox target.
 * @returns A domain-correct pending Inbox message.
 */
export function createMessage(
  id: string,
  signalId: string,
  version: bigint,
  whenReceived = new Date("2026-07-02T08:00:00.000Z"),
  targetId = "list-1",
): InboxMessage {
  const taskListId = create(TaskListIdSchema, { value: targetId });
  const event = create(EventSchema, {
    id: create(EventIdSchema, { value: signalId }),
    message: AnyPacker.pack(
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
      targetId: AnyPacker.pack(TaskListIdSchema, taskListId),
      targetTypeUrl: TypeUrls.derive(TaskListSchema),
    }),
    signalId,
    signal: AnyPacker.pack(EventSchema, event),
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
