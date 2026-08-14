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
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import {
  EntityStateWithVersionSchema,
  QueryResponseSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import { TaskListSchema } from "../generated/spine/examples/todo/task_list_pb.js";
import { TaskListIdSchema } from "../generated/spine/examples/todo/task_id_pb.js";
import { SmokeTaskLists } from "../src/smoke-task-lists.js";

describe("to-do smoke row inspection", () => {
  it("skips absent and mismatched rows before matching a valid task list", () => {
    const targetId = "target\nrow";
    const response = create(QueryResponseSchema, {
      message: [
        create(EntityStateWithVersionSchema),
        create(EntityStateWithVersionSchema, {
          state: AnyMessages.pack(
            StringValueSchema,
            create(StringValueSchema, { value: "wrong type" }),
          ),
        }),
        create(EntityStateWithVersionSchema, {
          state: create(AnySchema, {
            typeUrl: TypeUrls.derive(TaskListSchema),
            value: new Uint8Array([0xff]),
          }),
        }),
        create(EntityStateWithVersionSchema, {
          state: AnyMessages.pack(
            TaskListSchema,
            create(TaskListSchema, { id: create(TaskListIdSchema, { value: targetId }) }),
          ),
        }),
      ],
    });

    const inspected = SmokeTaskLists.inspectRows(response);

    expect(inspected.taskLists).toEqual([
      create(TaskListSchema, { id: create(TaskListIdSchema, { value: targetId }) }),
    ]);
    expect(inspected.diagnostics).toEqual(["target row", "<3 unavailable rows>"]);
  });

  it("bounds retained rows and reports response and diagnostic omissions", () => {
    const response = create(QueryResponseSchema, {
      message: Array.from({ length: 100 }, (_, index) =>
        create(EntityStateWithVersionSchema, {
          state: AnyMessages.pack(
            TaskListSchema,
            create(TaskListSchema, {
              id: create(TaskListIdSchema, { value: `oversized-${String(index)}` }),
            }),
          ),
        }),
      ),
    });

    const inspected = SmokeTaskLists.inspectRows(response);

    expect(inspected.taskLists).toHaveLength(16);
    expect(inspected.taskLists.map((taskList) => taskList.id?.value)).toEqual(
      Array.from({ length: 16 }, (_, index) => `oversized-${String(index)}`),
    );
    expect(inspected.diagnostics).toEqual([
      "oversized-0",
      "oversized-1",
      "oversized-2",
      "oversized-3",
      "<12 diagnostic rows omitted>",
      "<84 response rows omitted>",
    ]);
  });

  it("bounds control-character input before sanitizing an ID", () => {
    const oversizedId = `${"\n".repeat(1_000)}hidden suffix`;

    expect(SmokeTaskLists.sanitizeValue(oversizedId)).toBe("<blank>");
  });
});
