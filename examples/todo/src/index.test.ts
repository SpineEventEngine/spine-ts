import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packCommand, unpackAny } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  UserIdSchema,
  ValidationErrorSchema,
} from "@spine-ts/proto";
import {
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  EntityStateWithVersionSchema,
  QueryIdSchema,
  QuerySchema,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { BoundedContextFixture } from "@spine-ts/testing";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CompleteTaskSchema,
  CreateTaskSchema,
  RenameTaskSchema,
  ReopenTaskSchema,
} from "../generated/spine/example/todo/v1/task_commands_pb.js";
import {
  TaskCompletedSchema,
  TaskCreatedSchema,
  TaskReopenedSchema,
} from "../generated/spine/example/todo/v1/task_events_pb.js";
import { TaskIdSchema } from "../generated/spine/example/todo/v1/task_id_pb.js";
import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";
import { TaskSchema, type Task } from "../generated/spine/example/todo/v1/tasks_pb.js";

type TodoModule = typeof import("../dist/src/index.js");

let createTodoContext: TodoModule["createTodoContext"];
let TaskListProjection: TodoModule["TaskListProjection"];

describe("@spine-ts/example-todo", () => {
  beforeAll(async () => {
    assertBuiltExample();
    ({ createTodoContext, TaskListProjection } = await import("../dist/src/index.js"));
  });

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

  it("reads all task-list rows after creating two tasks", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-list-first", "task-list-first", "First"));
    await fixture.post(createTaskCommand("command-list-second", "task-list-second", "Second"));
    const response = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => candidate.message.length === 2,
    );
    const rows = response.message.map((message) => unpackTaskList(message.state));

    expect(rows.map((row) => row?.id).sort()).toEqual(["task-list-first", "task-list-second"]);
    expect(rows.flatMap((row) => row?.tasks.map((task) => task.title) ?? []).sort()).toEqual([
      "First",
      "Second",
    ]);
  });

  it("renames one task through command handling and exposes the new title", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-rename-create", "task-rename", "Original"));
    const ack = await fixture.post(
      createRenameCommand("command-rename-task", "task-rename", "Renamed"),
    );
    const response = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskTitle(candidate, "task-rename") === "Renamed",
    );
    const task = readTask(response, "task-rename");

    expect(ack.status?.status.case).toBe("ok");
    expect(task?.title).toBe("Renamed");
    expect(task?.completed).toBe(false);
    expect(readList(response, "task-rename")?.openTaskCount).toBe(1);
  });

  it("rejects invalid rename payloads with validation details without changing the task list", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-invalid-rename-create", "task-invalid", "Kept"));
    const originalResponse = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskTitle(candidate, "task-invalid") === "Kept",
    );

    const ack = await fixture.post(
      createRenameCommand("command-invalid-rename", "task-invalid", "", { validate: false }),
    );
    const response = await expectTaskListEventuallyUnchanged(
      fixture,
      originalResponse,
      "task-invalid",
    );
    const details = validationDetails(ack.status?.status);

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("COMMAND_VALIDATION_ERROR");
    expect(errorMessage(ack.status?.status)).toBe("Command payload validation failed.");
    expect(details?.constraintViolation.length).toBeGreaterThan(0);
    expect(readTask(response, "task-invalid")).toEqual(readTask(originalResponse, "task-invalid"));
    expect(readList(response, "task-invalid")?.openTaskCount).toBe(1);
  });

  it("completes one task through command handling and closes the list row", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-complete-create", "task-complete", "Open"));
    const ack = await fixture.post(createCompleteCommand("command-complete-task", "task-complete"));
    const response = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-complete") === true,
    );
    const task = readTask(response, "task-complete");

    expect(ack.status?.status.case).toBe("ok");
    expect(task?.title).toBe("Open");
    expect(task?.completed).toBe(true);
    expect(readList(response, "task-complete")?.openTaskCount).toBe(0);
  });

  it("refuses completing an already completed task without changing the task list", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-refuse-create", "task-refuse", "One-shot"));
    await fixture.post(createCompleteCommand("command-refuse-complete", "task-refuse"));
    const completedResponse = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-refuse") === true,
    );

    const ack = await fixture.post(
      createCompleteCommand("command-refuse-complete-again", "task-refuse"),
    );
    const response = await expectTaskListEventuallyUnchanged(
      fixture,
      completedResponse,
      "task-refuse",
    );
    const task = readTask(response, "task-refuse");

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("TASK_ALREADY_DONE");
    expect(errorMessage(ack.status?.status)).toBe("Task is already done.");
    expect(task).toEqual(readTask(completedResponse, "task-refuse"));
    expect(readList(response, "task-refuse")?.openTaskCount).toBe(0);
  });

  it("refuses reopening an open task without changing the task list", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-refuse-reopen-create", "task-open", "Open"));
    const openResponse = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-open") === false,
    );

    const ack = await fixture.post(createReopenCommand("command-refuse-reopen", "task-open"));
    const response = await expectTaskListEventuallyUnchanged(fixture, openResponse, "task-open");

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("TASK_NOT_DONE");
    expect(errorMessage(ack.status?.status)).toBe("Task is not done.");
    expect(readTask(response, "task-open")).toEqual(readTask(openResponse, "task-open"));
    expect(readList(response, "task-open")?.openTaskCount).toBe(1);
  });

  it("counts duplicate same-id projection rows", () => {
    const projection = new TaskListProjection({
      id: "task-duplicate",
      schema: TaskListSchema,
      state: create(TaskListSchema, { id: "task-duplicate" }),
      version: 0,
    });

    projection.onTaskCreated(
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: "task-duplicate" }),
        title: "First",
      }),
    );
    projection.onTaskCreated(
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: "task-duplicate" }),
        title: "Second",
      }),
    );

    projection.onTaskCompleted(
      create(TaskCompletedSchema, {
        id: create(TaskIdSchema, { value: "task-duplicate" }),
      }),
    );

    expect(projection.state.openTaskCount).toBe(0);
    expect(projection.state.tasks.map((task) => task.completed)).toEqual([true, true]);

    projection.onTaskReopened(
      create(TaskReopenedSchema, {
        id: create(TaskIdSchema, { value: "task-duplicate" }),
      }),
    );

    expect(projection.state.openTaskCount).toBe(2);
    expect(projection.state.tasks.map((task) => task.completed)).toEqual([false, false]);
  });

  it("detects changed task-list snapshots when an extra task row appears", () => {
    const expected = createTaskListResponse("task-snapshot", [
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: "task-snapshot" }),
        title: "First",
        completed: false,
      }),
    ]);
    const actual = createTaskListResponse("task-snapshot", [
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: "task-snapshot" }),
        title: "First",
        completed: false,
      }),
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: "task-extra" }),
        title: "Extra",
        completed: true,
      }),
    ]);

    expect(
      sameTaskListSnapshot(
        taskListSnapshot(actual, "task-snapshot"),
        taskListSnapshot(expected, "task-snapshot"),
      ),
    ).toBe(false);
  });

  it("reopens one task through command handling and opens the list row", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-reopen-create", "task-reopen", "Done"));
    await fixture.post(createCompleteCommand("command-reopen-complete", "task-reopen"));
    const completedResponse = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-reopen") === true,
    );
    const completedTask = readTask(completedResponse, "task-reopen");

    expect(completedTask?.completed).toBe(true);
    expect(readList(completedResponse, "task-reopen")?.openTaskCount).toBe(0);

    const ack = await fixture.post(createReopenCommand("command-reopen-task", "task-reopen"));
    const response = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-reopen") === false,
    );
    const task = readTask(response, "task-reopen");

    expect(ack.status?.status.case).toBe("ok");
    expect(task?.title).toBe("Done");
    expect(task?.completed).toBe(false);
    expect(readList(response, "task-reopen")?.openTaskCount).toBe(1);
  });

  it("preserves visible task state through command and projection updates", async () => {
    const fixture = new BoundedContextFixture(createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-history-create", "task-history", "Original"));
    await fixture.post(createCompleteCommand("command-history-complete", "task-history"));
    await fixture.post(createRenameCommand("command-history-rename", "task-history", "Still done"));
    const doneResponse = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) =>
        taskTitle(candidate, "task-history") === "Still done" &&
        taskCompleted(candidate, "task-history") === true,
    );

    await fixture.post(createReopenCommand("command-history-reopen", "task-history"));
    const openResponse = await fixture.readEventually(
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-history") === false,
    );
    const doneTask = readTask(doneResponse, "task-history");
    const openTask = readTask(openResponse, "task-history");

    expect(doneTask?.title).toBe("Still done");
    expect(doneTask?.completed).toBe(true);
    expect(readList(doneResponse, "task-history")?.openTaskCount).toBe(0);
    expect(openTask?.title).toBe("Still done");
    expect(openTask?.completed).toBe(false);
    expect(readList(openResponse, "task-history")?.openTaskCount).toBe(1);
  });
});

function assertBuiltExample(): void {
  const source = fileURLToPath(new URL("./index.ts", import.meta.url));
  const output = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));

  if (!existsSync(output) || statSync(output).mtimeMs < statSync(source).mtimeMs) {
    throw new Error("Run `pnpm typecheck:build` before running the to-do example tests.");
  }
}

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

function createRenameCommand(
  commandId: string,
  taskId: string,
  title: string,
  options: { readonly validate?: boolean } = {},
) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
    schema: RenameTaskSchema,
    message: create(RenameTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
      title,
    }),
    ...options,
  });
}

function createCompleteCommand(commandId: string, taskId: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
    schema: CompleteTaskSchema,
    message: create(CompleteTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
    }),
  });
}

function createReopenCommand(commandId: string, taskId: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
    schema: ReopenTaskSchema,
    message: create(ReopenTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
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

function readList(response: Pick<QueryResponse, "message">, taskId: string) {
  return response.message
    .map((message) => unpackTaskList(message.state))
    .find((list) => list?.id === taskId);
}

function readTask(response: Pick<QueryResponse, "message">, taskId: string): Task | undefined {
  return readList(response, taskId)?.tasks.find((task) => task.id?.value === taskId);
}

function createTaskListResponse(id: string, tasks: Task[]): Pick<QueryResponse, "message"> {
  return {
    message: [
      create(EntityStateWithVersionSchema, {
        state: packAny(
          TaskListSchema,
          create(TaskListSchema, {
            id,
            openTaskCount: tasks.filter((task) => !task.completed).length,
            tasks,
          }),
        ),
      }),
    ],
  };
}

async function expectTaskListEventuallyUnchanged(
  fixture: BoundedContextFixture,
  expected: QueryResponse,
  taskId: string,
): Promise<QueryResponse> {
  const expectedSnapshot = taskListSnapshot(expected, taskId);
  const response = await fixture.readEventually(
    createTaskListQuery(),
    (candidate) => !sameTaskListSnapshot(taskListSnapshot(candidate, taskId), expectedSnapshot),
  );

  expect(taskListSnapshot(response, taskId)).toEqual(expectedSnapshot);

  return response;
}

function taskListSnapshot(response: Pick<QueryResponse, "message">, taskId: string) {
  const list = readList(response, taskId);

  return {
    id: list?.id,
    openTaskCount: list?.openTaskCount,
    tasks:
      list?.tasks.map((task) => ({
        id: task.id?.value,
        title: task.title,
        completed: task.completed,
      })) ?? [],
  };
}

function sameTaskListSnapshot(
  actual: ReturnType<typeof taskListSnapshot>,
  expected: ReturnType<typeof taskListSnapshot>,
) {
  return (
    actual.id === expected.id &&
    actual.openTaskCount === expected.openTaskCount &&
    actual.tasks.length === expected.tasks.length &&
    actual.tasks.every((task, index) => {
      const expectedTask = expected.tasks[index];

      return (
        expectedTask !== undefined &&
        task.id === expectedTask.id &&
        task.title === expectedTask.title &&
        task.completed === expectedTask.completed
      );
    })
  );
}

function taskTitle(response: Pick<QueryResponse, "message">, taskId: string): string | undefined {
  return readTask(response, taskId)?.title;
}

function taskCompleted(
  response: Pick<QueryResponse, "message">,
  taskId: string,
): boolean | undefined {
  return readTask(response, taskId)?.completed;
}

function errorMessage(status: unknown) {
  if (
    typeof status !== "object" ||
    status === null ||
    !("case" in status) ||
    status.case !== "error"
  ) {
    return undefined;
  }
  const value = "value" in status ? status.value : undefined;

  return typeof value === "object" && value !== null && "message" in value
    ? value.message
    : undefined;
}

function errorType(status: unknown) {
  if (
    typeof status !== "object" ||
    status === null ||
    !("case" in status) ||
    status.case !== "error"
  ) {
    return undefined;
  }
  const value = "value" in status ? status.value : undefined;

  return typeof value === "object" && value !== null && "type" in value ? value.type : undefined;
}

function validationDetails(status: unknown) {
  if (
    typeof status !== "object" ||
    status === null ||
    !("case" in status) ||
    status.case !== "error"
  ) {
    return undefined;
  }
  const value = "value" in status ? status.value : undefined;
  if (typeof value !== "object" || value === null || !("details" in value)) {
    return undefined;
  }

  return unpackAny(value.details as Parameters<typeof unpackAny>[0], ValidationErrorSchema);
}
