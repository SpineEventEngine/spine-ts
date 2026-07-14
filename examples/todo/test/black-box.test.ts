import { create } from "@bufbuild/protobuf";
import { Int32ValueSchema, StringValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { deriveTypeUrl, packAny, packCommand, unpackAny } from "@spine-ts/core";
import { UserIdSchema, ValidationErrorSchema } from "@spine-ts/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  EntityStateWithVersionSchema,
  QueryIdSchema,
  QueryResponseSchema,
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
import { SignalMetadata } from "@spine-ts/server";
import { BoundedContextFixture } from "@spine-ts/testing";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

import { analyzeBuildHandlers } from "../../../packages/server/src/handler/build-time-handler-analyzer.js";
import { GeneratedRegistryWriter } from "../../../packages/server/src/handler/generated-registry-writer.js";
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
const signalMetadata = new SignalMetadata();
const maxRemoteDiagnosticRows = 4;
const maxRemoteDiagnosticIdLength = 64;
const remoteOperationTimeoutMs = 500;

describe("@spine-ts/example-todo", () => {
  beforeAll(async () => {
    assertBuiltExample();
    ({ createTodoContext, startTodoServer } = await import("../dist/src/index.js"));
  }, 30_000);

  it("recovers registry loading after an initial generated-registry failure", async () => {
    const registry = fileURLToPath(
      new URL("../dist/generated/handler/generated-handler-registry.js", import.meta.url),
    );
    const hiddenRegistry = `${registry}.missing-for-test`;

    renameSync(registry, hiddenRegistry);
    try {
      const failure = await createTodoContext().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(
        `Generated handler registry module "${registry}"`,
      );
      expect((failure as Error).message).toContain("must exist and be readable.");
    } finally {
      renameSync(hiddenRegistry, registry);
    }

    await expect(createTodoContext()).resolves.toBeDefined();
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

  it("keeps generated registry discovery out of application context assembly", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");

    expect(source).not.toContain("GeneratedRegistryDiscovery");
    expect(source).not.toContain("HandlerMetadataRegistry");
    expect(source).not.toContain("EntityHandlersMetadata");
    expect(source).not.toContain("new Repository");
  });

  it("reports bounded diagnostics when remote query acceptance expires", async () => {
    const response = create(QueryResponseSchema, {
      message: [
        create(EntityStateWithVersionSchema, {
          state: packAny(
            TaskListSchema,
            create(TaskListSchema, {
              id: "unsafe\nrow",
            }),
          ),
        }),
      ],
    });
    let reads = 0;

    const failure = await readRemoteEventually(
      {
        read: () => {
          reads += 1;
          return Promise.resolve(response);
        },
      },
      createTaskListQuery(),
      () => false,
      20,
      1,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("query-task-list");
    expect((failure as Error).message).toContain("after 20ms");
    expect((failure as Error).message).toContain("row IDs [unsafe row]");
    expect((failure as Error).message).not.toContain("unsafe\nrow");
    expect(reads).toBeGreaterThan(1);
  });

  it("rejects a remote command when its client call never settles", async () => {
    const timeoutMs = 20;
    const startedAt = Date.now();
    const failure = await postRemoteCommand(
      {
        post: () => new Promise<never>(() => undefined),
      },
      createTaskCommand("command-timeout", "task-timeout", "Timeout"),
      "controlled hanging command",
      timeoutMs,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `Timed out waiting for controlled hanging command after ${String(timeoutMs)}ms.`,
    );
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("ignores an unrelated update and observes the exact subscribed task", async () => {
    await withRemoteTodo(async ({ baseUrl, commands, queries, subscriptions }) => {
      const subscription = await withTimeout(
        subscriptions.subscribe(createTaskListTopic("task-standalone")),
        "standalone subscription creation",
        500,
      );
      const stream = new AbortController();
      const updates: AsyncIterable<SubscriptionUpdate> = subscriptions.activate(subscription, {
        signal: stream.signal,
      });
      const iterator = updates[Symbol.asyncIterator]();
      let nextUpdate: Promise<IteratorResult<SubscriptionUpdate>> | undefined;

      try {
        nextUpdate = withTimeout(iterator.next(), "standalone server subscription update", 500);
        await postRemoteCommand(
          commands,
          createTaskCommand(
            "command-subscription-unrelated",
            "task-subscription-unrelated",
            "Unrelated",
          ),
          "unrelated subscription command acknowledgement",
        );
        await readRemoteEventually(
          queries,
          createTaskListIdQuery("task-subscription-unrelated"),
          (candidate) => taskTitle(candidate, "task-subscription-unrelated") === "Unrelated",
        );

        const ack = await postRemoteCommand(
          commands,
          createTaskCommand("command-standalone-create", "task-standalone", "Standalone"),
          "standalone command acknowledgement",
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

        expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
        expect(ack.status?.status.case).toBe("ok");
        expect(response.response?.status?.status.case).toBe("ok");
        expect(readTask(response, "task-standalone")?.completed).toBe(false);
        expect(update.subscription.id).toEqual(subscription.id);
        expect(update.list.id).toBe("task-standalone");
        expect(update.list.tasks[0]?.title).toBe("Standalone");

        const cancel = await withTimeout(
          subscriptions.cancel(subscription),
          "standalone subscription cancellation acknowledgement",
          500,
        );
        stream.abort();
        const settled = await withTimeout(
          iterator.return?.() ??
            Promise.resolve<IteratorResult<SubscriptionUpdate>>({ done: true, value: undefined }),
          "standalone subscription iterator return",
          500,
        );

        expect(cancel.status?.status.case).toBe("ok");
        expect(settled.done).toBe(true);
      } finally {
        await nextUpdate?.catch(() => undefined);
        await withTimeout(
          subscriptions.cancel(subscription),
          "standalone subscription cancellation cleanup",
          500,
        ).catch(() => undefined);
        stream.abort();
        await withTimeout(
          iterator.return?.() ??
            Promise.resolve<IteratorResult<SubscriptionUpdate>>({ done: true, value: undefined }),
          "standalone subscription iterator cleanup",
          500,
        );
      }
    });
  }, 15_000);

  it("queries all rows, an exact ID, and a supported column over generated clients", async () => {
    await withRemoteTodo(async ({ commands, queries }) => {
      await postRemoteCommand(
        commands,
        createTaskCommand("command-remote-query-first", "task-first", "First"),
        "first remote query setup acknowledgement",
      );
      await postRemoteCommand(
        commands,
        createTaskCommand("command-remote-query-second", "task-second", "Second"),
        "second remote query setup acknowledgement",
      );
      const all = await readRemoteEventually(
        queries,
        createTaskListQuery(),
        (candidate) => candidate.message.length === 2,
      );
      const exact = await readRemoteEventually(
        queries,
        createTaskListIdQuery("task-first"),
        (candidate) => candidate.message.length === 1,
      );

      await postRemoteCommand(
        commands,
        createCompleteCommand("command-remote-query-complete", "task-first"),
        "remote query completion acknowledgement",
      );
      const filtered = await readRemoteEventually(
        queries,
        createOpenTaskCountQuery(1),
        (candidate) =>
          candidate.message.length === 1 && readList(candidate, "task-second") !== undefined,
      );

      expect(all.message.map((message) => unpackTaskList(message.state)?.id).sort()).toEqual([
        "task-first",
        "task-second",
      ]);
      expect(readTask(exact, "task-first")?.title).toBe("First");
      expect(readList(filtered, "task-second")?.openTaskCount).toBe(1);
    });
  }, 15_000);

  it("returns validation and business refusals without changing remote state", async () => {
    await withRemoteTodo(async ({ commands, queries }) => {
      await postRemoteCommand(
        commands,
        createTaskCommand("command-remote-refusal-create", "task-refusal", "Kept"),
        "remote refusal setup acknowledgement",
      );
      const original = await readRemoteEventually(
        queries,
        createTaskListIdQuery("task-refusal"),
        (candidate) => taskTitle(candidate, "task-refusal") === "Kept",
      );
      const invalidRename = await postRemoteCommand(
        commands,
        createRenameCommand("command-remote-invalid-rename", "task-refusal", "", {
          validate: false,
        }),
        "invalid rename acknowledgement",
      );
      const reopenOpen = await postRemoteCommand(
        commands,
        createReopenCommand("command-remote-reopen-open", "task-refusal"),
        "reopen-open refusal acknowledgement",
      );
      await postRemoteCommand(
        commands,
        createTaskCommand("command-refusal-fence", "task-refusal-fence", "Fence"),
        "validation and reopen refusal fence acknowledgement",
      );
      await readRemoteEventually(
        queries,
        createTaskListIdQuery("task-refusal-fence"),
        (candidate) => taskTitle(candidate, "task-refusal-fence") === "Fence",
      );
      const afterRefusals = await readRemoteOnce(
        queries,
        createTaskListIdQuery("task-refusal"),
        "task state after validation and reopen refusal fence",
      );

      await postRemoteCommand(
        commands,
        createCompleteCommand("command-remote-complete", "task-refusal"),
        "remote completion acknowledgement",
      );
      const completed = await readRemoteEventually(
        queries,
        createTaskListIdQuery("task-refusal"),
        (candidate) => taskCompleted(candidate, "task-refusal") === true,
      );
      const completeAgain = await postRemoteCommand(
        commands,
        createCompleteCommand("command-remote-complete-again", "task-refusal"),
        "repeated completion refusal acknowledgement",
      );
      await postRemoteCommand(
        commands,
        createTaskCommand("command-complete-refusal-fence", "task-complete-refusal-fence", "Fence"),
        "complete refusal fence acknowledgement",
      );
      await readRemoteEventually(
        queries,
        createTaskListIdQuery("task-complete-refusal-fence"),
        (candidate) => taskTitle(candidate, "task-complete-refusal-fence") === "Fence",
      );
      const afterCompleteAgain = await readRemoteOnce(
        queries,
        createTaskListIdQuery("task-refusal"),
        "task state after complete refusal fence",
      );

      expect(errorType(invalidRename.status?.status)).toBe("COMMAND_VALIDATION_ERROR");
      expect(
        validationDetails(invalidRename.status?.status)?.constraintViolation.length,
      ).toBeGreaterThan(0);
      expect(taskListSnapshot(afterRefusals, "task-refusal")).toEqual(
        taskListSnapshot(original, "task-refusal"),
      );
      expect(errorType(reopenOpen.status?.status)).toBe("TASK_NOT_DONE");
      expect(errorType(completeAgain.status?.status)).toBe("TASK_ALREADY_DONE");
      expect(taskListSnapshot(afterCompleteAgain, "task-refusal")).toEqual(
        taskListSnapshot(completed, "task-refusal"),
      );
    });
  }, 15_000);

  it("rejects missing and blank IDs without a remote task effect", async () => {
    await withRemoteTodo(async ({ commands, queries }) => {
      await postRemoteCommand(
        commands,
        createTaskCommand("command-remote-id-create", "task-kept", "Kept"),
        "invalid ID setup acknowledgement",
      );
      const before = await readRemoteEventually(
        queries,
        createTaskListQuery(),
        (candidate) => candidate.message.length === 1,
      );
      const missingId = await postRemoteCommand(
        commands,
        packCommand({
          ...createCommandMetadata("command-remote-missing-id"),
          schema: CreateTaskSchema,
          message: create(CreateTaskSchema, { title: "Missing ID" }),
          validate: false,
        }),
        "missing ID rejection acknowledgement",
      );
      const blankId = await postRemoteCommand(
        commands,
        packCommand({
          ...createCommandMetadata("command-remote-blank-id"),
          schema: CreateTaskSchema,
          message: create(CreateTaskSchema, {
            id: create(TaskIdSchema, { value: "   " }),
            title: "Blank ID",
          }),
          validate: false,
        }),
        "blank ID rejection acknowledgement",
      );
      await postRemoteCommand(
        commands,
        createTaskCommand("command-id-fence", "task-id-fence", "Fence"),
        "invalid ID fence acknowledgement",
      );
      await readRemoteEventually(
        queries,
        createTaskListIdQuery("task-id-fence"),
        (candidate) => taskTitle(candidate, "task-id-fence") === "Fence",
      );
      const after = await readRemoteOnce(
        queries,
        createTaskListQuery(),
        "task rows after invalid ID fence",
      );

      expect(missingId.status?.status.case).toBe("error");
      expect(blankId.status?.status.case).toBe("error");
      expect(taskListSnapshot(after, "task-kept")).toEqual(taskListSnapshot(before, "task-kept"));
      expect(after.message.map((message) => unpackTaskList(message.state)?.id).sort()).toEqual([
        "task-id-fence",
        "task-kept",
      ]);
    });
  }, 15_000);

  it("closes the loopback listener and every explicitly owned client session", async () => {
    const baseUrl = await withRemoteTodo(async ({ baseUrl, queries }) => {
      await expect(
        readRemoteOnce(queries, createTaskListQuery(), "pre-close task-list read"),
      ).resolves.toBeDefined();
      return baseUrl;
    });
    const probeSession = new Http2SessionManager(baseUrl);
    const closedQueries = createClient(
      QueryService,
      createGrpcTransport({ baseUrl, sessionManager: probeSession }),
    );

    try {
      await expect(
        withTimeout(closedQueries.read(createTaskListQuery()), "closed standalone listener", 500),
      ).rejects.toThrow();
    } finally {
      probeSession.abort();
    }
  }, 15_000);

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

  it("filters task-list rows by projection columns", async () => {
    const fixture = new BoundedContextFixture(await createTodoContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    await fixture.post(createTaskCommand("command-column-first", "task-column-first", "First"));
    await fixture.post(createTaskCommand("command-column-second", "task-column-second", "Second"));
    await fixture.post(createCompleteCommand("command-column-complete", "task-column-first"));
    const response = await fixture.readEventually(createOpenTaskCountQuery(1), (candidate) => {
      const rows = candidate.message.map((message) => unpackTaskList(message.state));
      return rows.length === 1 && rows[0]?.id === "task-column-second";
    });
    const rows = response.message.map((message) => unpackTaskList(message.state));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("task-column-second");
    expect(rows[0]?.openTaskCount).toBe(1);
    expect(rows[0]?.tasks[0]?.title).toBe("Second");
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

  it("rebuilds the task list from stored events during read-side catch-up", async () => {
    const context = await createTodoContext();
    const fixture = new BoundedContextFixture(context, {
      timeoutMs: 500,
      intervalMs: 5,
    });

    try {
      await fixture.post(createTaskCommand("command-catch-up-create", "task-catch-up", "Original"));
      await fixture.post(createCompleteCommand("command-catch-up-complete", "task-catch-up"));
      await fixture.readEventually(
        createTaskListQuery(),
        (candidate) => taskCompleted(candidate, "task-catch-up") === true,
      );

      await context.stand().update(
        TaskListSchema,
        create(TaskListSchema, {
          id: "task-catch-up",
          tasks: [
            {
              id: create(TaskIdSchema, { value: "task-catch-up" }),
              title: "Wrong",
              completed: false,
            },
          ],
          openTaskCount: 1,
        }),
      );

      await expect(context.catchUpReadSide()).resolves.toEqual({
        replayedEventCount: 2,
        clearedEntityCount: 1,
        clearedStateTypes: [deriveTypeUrl(TaskListSchema)],
      });
      await expect(context.stand().read(TaskListSchema, "task-catch-up")).resolves.toEqual(
        create(TaskListSchema, {
          id: "task-catch-up",
          tasks: [
            {
              id: create(TaskIdSchema, { value: "task-catch-up" }),
              title: "Original",
              completed: true,
            },
          ],
          openTaskCount: 0,
        }),
      );
    } finally {
      await context.close();
    }
  });
});

interface RemoteTodo {
  readonly baseUrl: string;
  readonly commands: Client<typeof CommandService>;
  readonly queries: Client<typeof QueryService>;
  readonly subscriptions: Client<typeof SubscriptionService>;
}

type RemoteCommandClient = Pick<Client<typeof CommandService>, "post">;
type RemoteQueryClient = Pick<Client<typeof QueryService>, "read">;

async function postRemoteCommand(
  client: RemoteCommandClient,
  command: Parameters<RemoteCommandClient["post"]>[0],
  label: string,
  timeoutMs = remoteOperationTimeoutMs,
): Promise<Awaited<ReturnType<RemoteCommandClient["post"]>>> {
  return await withTimeout(client.post(command), label, timeoutMs);
}

async function readRemoteOnce(
  client: RemoteQueryClient,
  query: Parameters<RemoteQueryClient["read"]>[0],
  label: string,
  timeoutMs = remoteOperationTimeoutMs,
): Promise<Awaited<ReturnType<RemoteQueryClient["read"]>>> {
  return await withTimeout(client.read(query), label, timeoutMs);
}

async function withRemoteTodo<T>(onRun: (remote: RemoteTodo) => Promise<T>): Promise<T> {
  const server = await startTodoServer({ host: "127.0.0.1", port: 0 });
  const session = new Http2SessionManager(server.baseUrl);
  const transport = createGrpcTransport({
    baseUrl: server.baseUrl,
    sessionManager: session,
  });

  try {
    return await onRun({
      baseUrl: server.baseUrl,
      commands: createClient(CommandService, transport),
      queries: createClient(QueryService, transport),
      subscriptions: createClient(SubscriptionService, transport),
    });
  } finally {
    session.abort();
    await withTimeout(server.close(), "standalone server close", 6_000);
  }
}

function assertBuiltExample(): void {
  const output = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));
  const registry = fileURLToPath(
    new URL("../dist/generated/handler/generated-handler-registry.js", import.meta.url),
  );

  if (!existsSync(output) || !existsSync(registry)) {
    throw new Error("Run `pnpm typecheck:build` before running the to-do example tests.");
  }

  assertGeneratedRegistryFresh();
  assertCompiledExampleFresh();
}

function assertGeneratedRegistryFresh(): void {
  const project = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const registrySource = fileURLToPath(
    new URL("../generated/handler/generated-handler-registry.ts", import.meta.url),
  );
  const parsed = parseTodoTsConfig(project);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    ...(parsed.projectReferences === undefined
      ? {}
      : { projectReferences: parsed.projectReferences }),
  });
  const analysis = analyzeBuildHandlers(program);

  if (analysis.diagnostics.length > 0) {
    throw new Error("Generated handler registry analysis failed.");
  }

  const expected = new GeneratedRegistryWriter().render(analysis, { outputFile: registrySource });
  const actual = readFileSync(registrySource, "utf8");

  if (actual !== expected) {
    throw new Error("Run `pnpm typecheck:build`; the to-do generated handler registry is stale.");
  }
}

function assertCompiledExampleFresh(): void {
  const project = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const tempRoot = mkdtempSync(join(tmpdir(), "spine-todo-emit-"));

  try {
    const parsed = parseTodoTsConfig(project, {
      outDir: tempRoot,
      tsBuildInfoFile: join(tempRoot, "tsconfig.tsbuildinfo"),
    });
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: parsed.options,
      ...(parsed.projectReferences === undefined
        ? {}
        : { projectReferences: parsed.projectReferences }),
    });
    const emit = program.emit();
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];

    if (diagnostics.length > 0 || emit.emitSkipped) {
      throw new Error(formatDiagnostics(diagnostics));
    }

    assertFileContentEqual(
      join(tempRoot, "src/index.js"),
      fileURLToPath(new URL("../dist/src/index.js", import.meta.url)),
      "compiled to-do example entry point",
    );
    assertFileContentEqual(
      join(tempRoot, "generated/handler/generated-handler-registry.js"),
      fileURLToPath(
        new URL("../dist/generated/handler/generated-handler-registry.js", import.meta.url),
      ),
      "compiled to-do generated handler registry",
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertFileContentEqual(expectedFile: string, actualFile: string, label: string): void {
  const expected = readFileSync(expectedFile, "utf8");
  const actual = readFileSync(actualFile, "utf8");

  if (actual !== expected) {
    throw new Error(`Run \`pnpm typecheck:build\`; the ${label} is stale.`);
  }
}

function parseTodoTsConfig(
  project: string,
  overrides: ts.CompilerOptions = {},
): ts.ParsedCommandLine {
  const config = ts.readConfigFile(project, (path) => ts.sys.readFile(path));

  if (config.error !== undefined) {
    throw new Error(formatDiagnostics([config.error]));
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    fileURLToPath(new URL("..", import.meta.url)),
    overrides,
    project,
  );

  if (parsed.errors.length > 0) {
    throw new Error(formatDiagnostics(parsed.errors));
  }

  return parsed;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => fileURLToPath(new URL("../../..", import.meta.url)),
    getNewLine: () => "\n",
  });
}

function createTaskCommand(commandId: string, taskId: string, title: string) {
  return packCommand({
    ...createCommandMetadata(commandId),
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
    ...createCommandMetadata(commandId),
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
    ...createCommandMetadata(commandId),
    schema: CompleteTaskSchema,
    message: create(CompleteTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
    }),
  });
}

function createReopenCommand(commandId: string, taskId: string) {
  return packCommand({
    ...createCommandMetadata(commandId),
    schema: ReopenTaskSchema,
    message: create(ReopenTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
    }),
  });
}

function createCommandMetadata(commandId: string) {
  return {
    id: signalMetadata.commandId(commandId),
    context: signalMetadata.commandContext({
      actorContext: createActorContext(),
    }),
  };
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

function createOpenTaskCountQuery(openTaskCount: number) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "query-task-list-column" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          filter: [
            create(CompositeFilterSchema, {
              filter: [
                create(FilterSchema, {
                  fieldPath: { fieldName: ["open_task_count"] },
                  value: packAny(
                    Int32ValueSchema,
                    create(Int32ValueSchema, { value: openTaskCount }),
                  ),
                  operator: Filter_Operator.EQUAL,
                }),
              ],
              operator: CompositeFilter_CompositeOperator.ALL,
            }),
          ],
        }),
      },
    }),
    context: createActorContext(),
  });
}

function createTaskListTopic(id?: string) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "topic-task-list" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion:
        id === undefined
          ? { case: "includeAll", value: true }
          : {
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

function createActorContext() {
  return signalMetadata.actorContext({
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
  onAccept: (response: QueryResponse) => boolean,
  timeoutMs = 500,
  intervalMs = 5,
): Promise<QueryResponse> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let response: QueryResponse | undefined;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    response = await withTimeout(
      client.read(query),
      `remote query ${sanitizeDiagnostic(query.id?.value ?? "<missing>")} response`,
      remainingMs,
    );
    attempts += 1;
    if (onAccept(response)) {
      return response;
    }
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }

  throw remoteReadTimeout(query, response, timeoutMs, attempts);
}

function remoteReadTimeout(
  query: Query,
  response: QueryResponse | undefined,
  timeoutMs: number,
  attempts: number,
): Error {
  const rows = response?.message ?? [];
  const rowIds = rows.slice(0, maxRemoteDiagnosticRows).map((message) => {
    try {
      return sanitizeDiagnostic(unpackTaskList(message.state)?.id ?? "<unreadable>");
    } catch {
      return "<unreadable>";
    }
  });
  const omitted = rows.length - rowIds.length;
  const suffix = omitted > 0 ? `, <${String(omitted)} rows omitted>` : "";
  const queryId = sanitizeDiagnostic(query.id?.value ?? "<missing>");
  const status = response?.response?.status?.status.case ?? "missing";

  return new Error(
    `Remote query ${queryId} did not satisfy acceptance after ${String(timeoutMs)}ms ` +
      `(${String(attempts)} reads); last status ${status}, ${String(rows.length)} rows, ` +
      `row IDs [${rowIds.join(", ")}${suffix}].`,
  );
}

function sanitizeDiagnostic(value: string): string {
  let safeValue = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    safeValue += code <= 31 || code === 127 ? " " : character;
  }
  const sanitized = safeValue.trim();
  if (sanitized.length === 0) {
    return "<blank>";
  }
  return sanitized.slice(0, maxRemoteDiagnosticIdLength);
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
