import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { packAny } from "@spine-ts/core";
import {
  EntityStateWithVersionSchema,
  QueryResponseSchema,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { describe, expect, it } from "vitest";

// @ts-expect-error The private executable MJS script has no declaration output.
import { inspectTaskListRows } from "../scripts/smoke.mjs";
import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";

interface InspectedTaskListRows {
  readonly diagnostics: readonly string[];
  readonly taskLists: readonly TaskList[];
}

const inspectRows = inspectTaskListRows as unknown as (
  response: QueryResponse,
) => InspectedTaskListRows;

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
          state: packAny(TaskListSchema, create(TaskListSchema, { id: targetId })),
        }),
      ],
    });

    const inspected = inspectRows(response);

    expect(inspected.taskLists).toEqual([create(TaskListSchema, { id: targetId })]);
    expect(inspected.diagnostics).toEqual(["target row", "<2 unavailable rows>"]);
  });
});
