import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
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
  type Query,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import {
  TopicIdSchema,
  TopicSchema,
  type SubscriptionUpdate,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import { BoundedContextFixture } from "@spine-ts/testing";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CompleteTaskSchema,
  CreateTaskSchema,
  RenameTaskSchema,
  ReopenTaskSchema,
} from "../generated/spine/example/todo/v1/task_commands_pb.js";
import { TaskIdSchema } from "../generated/spine/example/todo/v1/task_id_pb.js";
import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";
import { TaskSchema, type Task } from "../generated/spine/example/todo/v1/tasks_pb.js";

type TodoModule = typeof import("../dist/src/index.js");

let createTodoContext: TodoModule["createTodoContext"];
let startTodoServer: TodoModule["startTodoServer"];

describe("@spine-ts/example-todo", () => {
  beforeAll(async () => {
    assertBuiltExample();
    ({ createTodoContext, startTodoServer } = await import("../dist/src/index.js"));
  });

  it("loads generated handler metadata into the bounded context", async () => {
    const context = await createTodoContext();

    expect([...context.commandBus().acceptedCommandTypes()].sort()).toEqual(
      [
        deriveTypeUrl(CreateTaskSchema),
        deriveTypeUrl(RenameTaskSchema),
        deriveTypeUrl(CompleteTaskSchema),
        deriveTypeUrl(ReopenTaskSchema),
      ].sort(),
    );
    expect(
      context.registeredRepositories().map((repository) => repository.entityType.name),
    ).toEqual(["TaskAggregate", "TaskListProjection"]);
  });

  it("runs as a standalone gRPC-compatible server for command, query, and subscription clients", async () => {
    const server = await startTodoServer({ host: "127.0.0.1", port: 0 });

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commands = createClient(CommandService, transport);
      const queries = createClient(QueryService, transport);
      const subscriptions = createClient(SubscriptionService, transport);
      const subscription = await subscriptions.subscribe(createTaskListTopic());
      const updates: AsyncIterable<SubscriptionUpdate> = subscriptions.activate(subscription);
      const iterator = updates[Symbol.asyncIterator]();
      let nextUpdate: Promise<IteratorResult<SubscriptionUpdate>> | undefined;

      try {
        await delay(25);
        nextUpdate = withTimeout(iterator.next(), "standalone server subscription update", 500);
        const ack = await commands.post(
          createTaskCommand("command-standalone-create", "task-standalone", "Standalone"),
        );
        const response = await readRemoteEventually(
          queries,
          createTaskListQuery(),
          (candidate) => taskTitle(candidate, "task-standalone") === "Standalone",
        );
        const delivered = await nextUpdate;
        nextUpdate = undefined;
        if (delivered.done === true) {
          throw new Error("Expected standalone server subscription update.");
        }
        const update = unpackSubscribedTaskList(delivered.value);

        expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
        expect(ack.status?.status.case).toBe("ok");
        expect(response.response?.status?.status.case).toBe("ok");
        expect(readTask(response, "task-standalone")?.completed).toBe(false);
        expect(update.subscription.id).toEqual(subscription.id);
        expect(update.list.tasks[0]?.title).toBe("Standalone");
      } finally {
        await nextUpdate?.catch(() => undefined);
        await subscriptions.cancel(subscription);
        await iterator.return?.();
      }
    } finally {
      await server.close();
    }
  });

  it("creates one task through command handling and exposes it in the task list", async () => {
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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

  it("subscribes to task-list updates and receives projection-driven changes", async () => {
    const fixture = new BoundedContextFixture(await createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });
    const subscription = await fixture.subscribe(createTaskListTopic());

    try {
      await fixture.post(createTaskCommand("command-subscribe-create", "task-live", "First"));
      const created = unpackSubscribedTaskList(
        await nextSubscriptionUpdate(subscription, "create"),
      );

      expect(created.response.status?.status.case).toBe("ok");
      expect(created.subscription.id).toEqual(subscription.subscription.id);
      expect(created.list).toEqual(
        create(TaskListSchema, {
          id: "task-live",
          tasks: [
            {
              id: create(TaskIdSchema, { value: "task-live" }),
              title: "First",
              completed: false,
            },
          ],
          openTaskCount: 1,
        }),
      );

      await fixture.post(createRenameCommand("command-subscribe-rename", "task-live", "Renamed"));
      const renamed = unpackSubscribedTaskList(
        await nextSubscriptionUpdate(subscription, "rename"),
      );

      expect(renamed.list.tasks[0]?.title).toBe("Renamed");
      expect(renamed.list.tasks[0]?.completed).toBe(false);
      expect(renamed.list.openTaskCount).toBe(1);

      await fixture.post(createCompleteCommand("command-subscribe-complete", "task-live"));
      const completed = unpackSubscribedTaskList(
        await nextSubscriptionUpdate(subscription, "complete"),
      );

      expect(completed.list.tasks[0]?.title).toBe("Renamed");
      expect(completed.list.tasks[0]?.completed).toBe(true);
      expect(completed.list.openTaskCount).toBe(0);

      await fixture.post(createReopenCommand("command-subscribe-reopen", "task-live"));
      const reopened = unpackSubscribedTaskList(
        await nextSubscriptionUpdate(subscription, "reopen"),
      );

      expect(reopened.list.tasks[0]?.title).toBe("Renamed");
      expect(reopened.list.tasks[0]?.completed).toBe(false);
      expect(reopened.list.openTaskCount).toBe(1);
    } finally {
      await withTimeout(subscription.close(), "subscription cleanup", 250);
    }
  });

  it("renames one task through command handling and exposes the new title", async () => {
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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

  it("cancels task-list subscriptions and makes later reads inert", async () => {
    const fixture = new BoundedContextFixture(await createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });
    const subscription = await fixture.subscribe(createTaskListTopic());

    try {
      await fixture.post(createTaskCommand("command-cancel-subscribe", "task-cancel", "Cancel"));
      expect(
        unpackSubscribedTaskList(
          await withTimeout(subscription.next(), "subscription update for cancel", 250),
        ).list.id,
      ).toBe("task-cancel");

      const cancel = await subscription.cancel();

      expect(cancel.status?.status.case).toBe("ok");
      await expect(nextSubscriptionUpdate(subscription, "cancel")).resolves.toBeUndefined();
    } finally {
      await withTimeout(subscription.close(), "subscription cancellation cleanup", 250);
    }
  });

  it("counts duplicate same-id projection rows", async () => {
    const fixture = new BoundedContextFixture(await createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-duplicate-first", "task-duplicate", "First"));
    await fixture.post(createTaskCommand("command-duplicate-second", "task-duplicate", "Second"));
    await fixture.post(createCompleteCommand("command-duplicate-complete", "task-duplicate"));
    const completed = await fixture.readEventually(
      createTaskListIdQuery("task-duplicate"),
      (candidate) =>
        unpackTaskList(candidate.message[0]?.state)?.tasks.every((task) => task.completed) === true,
    );
    const completedList = unpackTaskList(completed.message[0]?.state);

    expect(completedList?.openTaskCount).toBe(0);
    expect(completedList?.tasks.map((task) => task.completed)).toEqual([true, true]);

    await fixture.post(createReopenCommand("command-duplicate-reopen", "task-duplicate"));
    const reopened = await fixture.readEventually(
      createTaskListIdQuery("task-duplicate"),
      (candidate) =>
        unpackTaskList(candidate.message[0]?.state)?.tasks.every((task) => !task.completed) ===
        true,
    );
    const reopenedList = unpackTaskList(reopened.message[0]?.state);

    expect(reopenedList?.openTaskCount).toBe(2);
    expect(reopenedList?.tasks.map((task) => task.completed)).toEqual([false, false]);
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
    const fixture = new BoundedContextFixture(await createTodoContext(), {
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
  const output = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));
  const registry = fileURLToPath(
    new URL("../dist/generated/handler/generated-handler-registry.js", import.meta.url),
  );

  if (!existsSync(output) || !existsSync(registry)) {
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

function createTaskListIdQuery(id = "task-list-query") {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "query-task-list-by-id" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [packAny(StringValueSchema, create(StringValueSchema, { value: id }))],
          },
        }),
      },
    }),
    context: createActorContext(),
  });
}

function createTaskListTopic() {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "topic-task-list" }),
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

function createActorContext() {
  return create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "todo-user" }),
  });
}

function unpackTaskList(state: Any | undefined): TaskList | undefined {
  return state === undefined ? undefined : unpackAny(state, TaskListSchema);
}

function unpackSubscribedTaskList(update: SubscriptionUpdate | undefined) {
  const entityUpdate =
    update?.update.case === "entityUpdates" ? update.update.value.update[0] : undefined;
  const list =
    entityUpdate?.kind.case === "state" ? unpackTaskList(entityUpdate.kind.value) : undefined;

  if (update?.subscription === undefined || update.response === undefined) {
    throw new Error("Expected a subscription update.");
  }
  if (list === undefined) {
    throw new Error("Expected a task-list projection update.");
  }

  return {
    response: update.response,
    subscription: update.subscription,
    list,
  };
}

async function nextSubscriptionUpdate(
  subscription: Awaited<ReturnType<BoundedContextFixture["subscribe"]>>,
  label: string,
  timeoutMs = 250,
) {
  return await withTimeout(subscription.next(), `subscription update for ${label}`, timeoutMs);
}

async function readRemoteEventually(
  client: { readonly read: (query: Query) => Promise<QueryResponse> },
  query: Query,
  accept: (response: QueryResponse) => boolean,
  timeoutMs = 500,
  intervalMs = 5,
): Promise<QueryResponse> {
  const deadline = Date.now() + timeoutMs;
  let response = await client.read(query);

  while (!accept(response) && Date.now() < deadline) {
    await delay(intervalMs);
    response = await client.read(query);
  }

  return response;
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label} after ${String(timeoutMs)}ms.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
