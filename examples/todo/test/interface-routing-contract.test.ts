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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { validateEntityStateTransition } from "@spine-event-engine/server";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CreateTaskSchema } from "../generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskCreatedSchema,
  TaskRenamedSchema,
} from "../generated/spine/examples/todo/task_events_pb.js";
import { TaskIdSchema, TaskListIdSchema } from "../generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../generated/spine/examples/todo/task_list_pb.js";
import {
  TaskAlreadyAssignedSchema,
  TaskNotAssignedSchema,
} from "../generated/spine/examples/todo/task_rejections_pb.js";
import { TaskSchema } from "../generated/spine/examples/todo/tasks_pb.js";

const todoRoot = new URL("..", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, todoRoot), "utf8");
}

describe("To-Do interface-routing contract", () => {
  it("marks all Task events with generated TaskEvent and only assignment lifecycle events with TaskAssignmentEvent", () => {
    const events = source("proto/spine/examples/todo/task_events.proto");
    const commands = source("proto/spine/examples/todo/task_commands.proto");

    expect(events).toContain('option (every_is).ts_type = "TaskEvent";');
    expect(events).toContain("option (every_is).generate = true;");
    expect(events).toContain('option (is).ts_type = "TaskAssignmentEvent";');
    expect(commands).not.toContain("(is)");
    expect(commands).not.toContain("(every_is)");
    expect(events).not.toContain("TaskReassignmentEvent");
  });

  it("keeps TaskList routing token-based and reassignment exact", () => {
    const application = source("src/todo-app.ts");

    expect(application).toContain("TaskEvent");
    expect(application).toContain("TaskAssignmentEvent");
    expect(application).toContain("TaskReassignedSchema");
    expect(application).not.toContain("TaskReassignmentEvent");
  });

  it("routes new assignment rejections by their declared TaskListId without TaskId inference", () => {
    const application = source("src/todo-app.ts");
    const fields = (schema: {
      readonly fields: readonly { readonly localName: string; readonly number: number }[];
    }) => Object.fromEntries(schema.fields.map((field) => [field.localName, field.number]));

    expect(fields(TaskAlreadyAssignedSchema)).toMatchObject({ id: 1, assignee: 2, taskListId: 3 });
    expect(fields(TaskNotAssignedSchema)).toMatchObject({ id: 1, taskListId: 2 });
    expect(application).toContain(
      ".route(TaskAlreadyAssignedSchema, (event) => [taskListIds.require(event.taskListId)])",
    );
    expect(application).toContain(
      ".route(TaskNotAssignedSchema, (event) => [taskListIds.require(event.taskListId)])",
    );
  });

  it("allows the first Task transition to establish its task-list identity", () => {
    const id = create(TaskIdSchema, { value: "task-1" });
    const result = validateEntityStateTransition({
      schema: TaskSchema,
      previous: create(TaskSchema, { id }),
      next: create(TaskSchema, {
        id,
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
        title: "First",
      }),
    });

    expect(result.valid).toBe(true);
  });

  it("preserves legacy task title tags while assigning list identity new tags", () => {
    const fields = (schema: {
      readonly fields: readonly { readonly localName: string; readonly number: number }[];
    }) => Object.fromEntries(schema.fields.map((field) => [field.localName, field.number]));

    expect(fields(CreateTaskSchema)).toMatchObject({ id: 1, title: 2, taskListId: 3 });
    expect(fields(TaskCreatedSchema)).toMatchObject({ id: 1, title: 2, taskListId: 3 });
    expect(fields(TaskRenamedSchema)).toMatchObject({ id: 1, title: 2, taskListId: 3 });
    expect(fields(TaskListSchema)).toMatchObject({ id: 4, tasks: 2, openTaskCount: 3 });
  });

  it("does not decode a legacy TaskList field-one ID into the typed ID", () => {
    const legacyFieldOne = new Uint8Array([0x0a, 0x03, 0x6f, 0x6c, 0x64]);

    expect(fromBinary(TaskListSchema, legacyFieldOne).id).toBeUndefined();
    expect(
      toBinary(
        TaskListSchema,
        create(TaskListSchema, {
          id: create(TaskListIdSchema, { value: "new" }),
        }),
      )[0],
    ).toBe(0x22);
  });
});
