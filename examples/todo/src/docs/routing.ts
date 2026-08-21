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

import { EventRouting } from "@spine-event-engine/server";
import type { UserId } from "@spine-event-engine/proto";

import { TaskReassignedSchema } from "../../generated/spine/examples/todo/task_events_pb.js";
import type { TaskListId } from "../../generated/spine/examples/todo/task_id_pb.js";
import { TaskAssignmentEvent as TaskAssignmentEventToken } from "../../generated/interfaces/task-assignment-event.js";
import { TaskEvent } from "../../generated/interfaces/task-event.js";

const taskListRouting = EventRouting.create<TaskListId>().route(TaskEvent, (event) =>
  event.taskListId === undefined ? [] : [event.taskListId],
);
const assigneeRouting = EventRouting.create<UserId>()
  .route(TaskAssignmentEventToken, (event) =>
    event.assignee === undefined ? [] : [event.assignee],
  )
  .route(TaskReassignedSchema, (event) =>
    event.previousAssignee === undefined || event.assignee === undefined
      ? []
      : [event.previousAssignee, event.assignee],
  );

void taskListRouting;
void assigneeRouting;
