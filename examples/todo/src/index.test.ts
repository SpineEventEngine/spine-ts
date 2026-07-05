import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packCommand, unpackAny } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  UserIdSchema,
} from "@spine-ts/proto";
import {
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { QueryIdSchema, QuerySchema } from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { BoundedContextFixture } from "@spine-ts/testing";
import { describe, expect, it } from "vitest";

import { CreateTaskSchema } from "../generated/spine/example/todo/v1/task_commands_pb.js";
import { TaskIdSchema } from "../generated/spine/example/todo/v1/task_id_pb.js";
import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";
import { createTodoContext } from "../dist/src/index.js";

describe("@spine-ts/example-todo", () => {
  it("creates one task through command handling and exposes it in the task list", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    const ack = await fixture.post(createTaskCommand("command-create-first", "task-1", "First"));
    const response = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => unpackTaskList(candidate.message[0]?.state)?.tasks.length === 1,
    );
    const list = unpackTaskList(response.message[0]?.state);

    expect(ack.status?.status.case).toBe("ok");
    expect(response.response?.status?.status.case).toBe("ok");
    expect(list).toEqual(
      create(TaskListSchema, {
        id: "task-1",
        tasks: [
          {
            id: create(TaskIdSchema, { value: "task-1" }),
            title: "First",
            completed: false,
          },
        ],
        openTaskCount: 1,
      }),
    );
  });

  it("reads the task list by projection ID", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-list-query", "task-list-query", "Visible"));
    const response = await fixture.readEventually(
      createTaskListIdQuery(),
      (candidate) => candidate.message.length === 1,
    );
    const list = unpackTaskList(response.message[0]?.state);

    expect(response.response?.status?.status.case).toBe("ok");
    expect(list?.tasks).toHaveLength(1);
    expect(list?.tasks[0]?.title).toBe("Visible");
  });
});

function createTaskCommand(commandId: string, taskId: string, title: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
      title,
    }),
  });
}

function createTaskListQuery() {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "query-task-list" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion: {
        case: "includeAll",
        value: true,
      },
    }),
    context: createActorContext(),
  });
}

function createTaskListIdQuery() {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "query-task-list-by-id" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [
              packAny(StringValueSchema, create(StringValueSchema, { value: "task-list-query" })),
            ],
          },
        }),
      },
    }),
    context: createActorContext(),
  });
}

function createActorContext() {
  return create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "todo-user" }),
  });
}

function unpackTaskList(state: Any | undefined): TaskList | undefined {
  return state === undefined ? undefined : unpackAny(state, TaskListSchema);
}
