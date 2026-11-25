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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { CommandIdSchema, CommandSchema } from "@spine-event-engine/proto";
import {
  InboxLabel,
  InboxMessageSchema,
  InboxMessageStatus,
  type InboxMessage,
  type ShardIndex,
} from "@spine-event-engine/proto/delivery";
import { CreateTaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

/**
 * Creates a wire-valid To-do Command inbox row for storage tests.
 *
 * @param id Identifies the inbox row.
 * @param shard Identifies the delivery shard.
 * @param nanos Sets the receive timestamp fraction.
 * @param version Sets the delivery version.
 * @param status Sets the row status.
 * @returns The typed Inbox message.
 */
export function domainMessage(
  id: string,
  shard: ShardIndex,
  nanos = 0,
  version = 0,
  status = InboxMessageStatus.TO_DELIVER,
): InboxMessage {
  const taskId = create(TaskIdSchema, { value: `task-${id}` });
  const command = create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: `command-${id}` }),
    message: AnyPacker.pack(
      CreateTaskSchema,
      create(CreateTaskSchema, {
        id: taskId,
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
        title: "Indexed delivery",
      }),
    ),
  });
  return create(InboxMessageSchema, {
    id: { uuid: id, index: shard },
    signalId: { value: `signal-${id}` },
    inboxId: {
      entityId: { id: AnyPacker.pack(TaskIdSchema, taskId) },
      typeUrl: TypeUrls.derive(TaskSchema),
    },
    payload: { case: "command", value: command },
    label: InboxLabel.HANDLE_COMMAND,
    whenReceived: { seconds: 1n, nanos },
    version,
    status,
  });
}

/**
 * Measures a typed wire Inbox record for direct state tests.
 *
 * @param message Supplies the Inbox record.
 * @returns The encoded byte length.
 */
export function encodedBytes(message: InboxMessage): number {
  return toBinary(InboxMessageSchema, message).byteLength;
}
