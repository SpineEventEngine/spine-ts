import { create } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny } from "@spine-ts/core";
import {
  EntityStateWithVersionSchema,
  QueryResponseSchema,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { describe, expect, it } from "vitest";

import { TaskListSchema } from "../generated/spine/example/todo/v1/task_list_pb.js";
import { inspectTaskListRows } from "../src/smoke-task-lists.js";

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
});
