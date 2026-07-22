import { create } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny } from "@spine-ts/core";
import { EntityStateWithVersionSchema, QueryResponseSchema } from "@spine-ts/proto/client";
import { describe, expect, it } from "vitest";

import { TaskListSchema } from "../generated/spine/example/todo/v1/task_list_pb.js";
import { inspectTaskListRows, sanitizeSmokeValue } from "../src/smoke-task-lists.js";

describe("to-do smoke row inspection", () => {
  it("skips absent and mismatched rows before matching a valid task list", () => {
    const targetId = "target\nrow";
    const response = create(QueryResponseSchema, {
      message: [
        create(EntityStateWithVersionSchema),
        create(EntityStateWithVersionSchema, {
          state: packAny(StringValueSchema, create(StringValueSchema, { value: "wrong type" })),
        }),
        create(EntityStateWithVersionSchema, {
          state: create(AnySchema, {
            typeUrl: deriveTypeUrl(TaskListSchema),
            value: new Uint8Array([0xff]),
          }),
        }),
        create(EntityStateWithVersionSchema, {
          state: packAny(TaskListSchema, create(TaskListSchema, { id: targetId })),
        }),
      ],
    });

    const inspected = inspectTaskListRows(response);

    expect(inspected.taskLists).toEqual([create(TaskListSchema, { id: targetId })]);
    expect(inspected.diagnostics).toEqual(["target row", "<3 unavailable rows>"]);
  });

  it("bounds retained rows and reports response and diagnostic omissions", () => {
    const response = create(QueryResponseSchema, {
      message: Array.from({ length: 100 }, (_, index) =>
        create(EntityStateWithVersionSchema, {
          state: packAny(
            TaskListSchema,
            create(TaskListSchema, { id: `oversized-${String(index)}` }),
          ),
        }),
      ),
    });

    const inspected = inspectTaskListRows(response);

    expect(inspected.taskLists).toHaveLength(16);
    expect(inspected.taskLists.map((taskList) => taskList.id)).toEqual(
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

    expect(sanitizeSmokeValue(oversizedId)).toBe("<blank>");
  });
});
