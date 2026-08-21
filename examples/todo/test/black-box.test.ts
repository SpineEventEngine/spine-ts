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

import { create, type MessageShape } from "@bufbuild/protobuf";
import { Int32ValueSchema, type Any } from "@bufbuild/protobuf/wkt";
import { createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import {
  ErrorSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
  ValidationErrorSchema,
} from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import {
  EntityStateWithVersionSchema,
  QueryIdSchema,
  QueryResponseSchema,
  QuerySchema,
  type Query,
  type QueryResponse,
} from "@spine-event-engine/proto/client";
import { CommandService } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import {
  TopicIdSchema,
  TopicSchema,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import {
  BoundedContext,
  DeliveryBuilder,
  EventRouting,
  InMemorySubscriptionRegistry,
  SignalMetadata,
  UniformAcrossAllShards,
} from "@spine-event-engine/server";
import { BlackBox, type BlackBoxScope } from "@spine-event-engine/testing";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BuildHandlerAnalyzer } from "../../../packages/proto-tools/src/generation/build-time-handler-analyzer.js";
import { GeneratedRegistryWriter } from "../../../packages/proto-tools/src/generation/generated-registry-writer.js";
import {
  InMemoryStorageBackend,
  InMemoryStorageFactory,
} from "../../../packages/storage/dist/index.js";
import { generatedSource } from "../../../packages/proto-tools/src/generation/generated-source-policy.js";
import {
  AssignTaskSchema,
  CompleteTaskSchema,
  CreateTaskSchema,
  ReassignTaskSchema,
  RenameTaskSchema,
  ReopenTaskSchema,
  UnassignTaskSchema,
} from "../generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
  type TaskListId,
} from "../generated/spine/examples/todo/task_id_pb.js";
import { TaskAssigneeSchema } from "../generated/spine/examples/todo/task_assignee_pb.js";
import { TaskListSchema, type TaskList } from "../generated/spine/examples/todo/task_list_pb.js";
import {
  TaskAlreadyAssignedSchema,
  TaskAlreadyDoneSchema,
  TaskNotAssignedSchema,
} from "../generated/spine/examples/todo/task_rejections_pb.js";
import { TaskCreatedSchema } from "../generated/spine/examples/todo/task_events_pb.js";
import { TaskSchema, type Task } from "../generated/spine/examples/todo/tasks_pb.js";

type TodoModule = typeof import("../dist/src/index.js");

let createTodoContext: TodoModule["createTodoContext"];
let startTodoServer: TodoModule["startTodoServer"];
const signalMetadata = new SignalMetadata();
const maxRemoteDiagnosticRows = 4;
const maxRemoteDiagnosticIdLength = 64;
const remoteOperationTimeoutMs = 500;
const ownedBlackBoxes = new Set<BlackBox>();

afterEach(async () => {
  await Promise.all([...ownedBlackBoxes].map((blackBox) => blackBox.close()));
  ownedBlackBoxes.clear();
});

describe("@spine-event-engine/example-todo", () => {
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
        TypeUrls.derive(CreateTaskSchema),
        TypeUrls.derive(RenameTaskSchema),
        TypeUrls.derive(CompleteTaskSchema),
        TypeUrls.derive(ReopenTaskSchema),
        TypeUrls.derive(AssignTaskSchema),
        TypeUrls.derive(ReassignTaskSchema),
        TypeUrls.derive(UnassignTaskSchema),
      ].sort(),
    );
    expect(
      context.registeredRepositories().map((repository) => repository.entityType.name),
    ).toEqual(["TaskAggregate", "TaskListProjection", "TaskAssigneeProjection"]);
  });

  it("uses the application-selected storage factory", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const createRecordStorage = vi.spyOn(storageFactory, "createRecordStorage");
    const context = await createTodoContext({ storageFactory });

    expect(createRecordStorage).toHaveBeenCalled();
    await context.close();
    storageFactory.close();
  });

  it("accepts application-owned Delivery and subscription facilities", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const subscriptionRegistry = new InMemorySubscriptionRegistry();
    const deliveryStrategy = UniformAcrossAllShards.forNumber(1);

    const context = await createTodoContext({
      deliveryStrategy,
      storageFactory,
      subscriptionRegistry,
    });

    await context.close();
    storageFactory.close();
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
          state: AnyMessages.pack(
            TaskListSchema,
            create(TaskListSchema, {
              id: create(TaskListIdSchema, { value: "unsafe\nrow" }),
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

  it("handles an early subscription read rejection while lifecycle cleanup completes", async () => {
    const cleanup: string[] = [];
    const unhandled: unknown[] = [];
    const stream = new AbortController();
    const readFailure = new Error("early subscription read failure");
    let pendingRead: Promise<IteratorResult<SubscriptionUpdate>> | undefined;
    const onUnhandledRejection = (reason: unknown, promise: Promise<unknown>): void => {
      if (promise === pendingRead) {
        unhandled.push(reason);
      }
    };
    const iterator = {
      next: () => Promise.reject<IteratorResult<SubscriptionUpdate>>(readFailure),
      return: () => {
        cleanup.push("iterator return");
        return Promise.resolve<IteratorResult<SubscriptionUpdate>>({
          done: true,
          value: undefined,
        });
      },
    };

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      try {
        pendingRead = iterator.next();
        void pendingRead.catch(() => undefined);
        await new Promise<void>((resolve) => setImmediate(resolve));
        await withTimeout(Promise.resolve(), "early rejection command work", 20);
        await expect(withTimeout(pendingRead, "early subscription read delivery", 20)).rejects.toBe(
          readFailure,
        );
      } finally {
        stream.abort();
        cleanup.push("stream abort");
        await withTimeout(
          Promise.resolve().then(() => cleanup.push("subscription cancel")),
          "early rejection subscription cancellation",
          20,
        );
        await withTimeout(
          pendingRead ??
            Promise.resolve<IteratorResult<SubscriptionUpdate>>({ done: true, value: undefined }),
          "early rejected pending read cleanup",
          20,
        ).catch(() => undefined);
        await withTimeout(iterator.return(), "early rejection subscription iterator cleanup", 20);
        cleanup.push("session abort");
      }

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(stream.signal.aborted).toBe(true);
      expect(cleanup).toEqual([
        "stream abort",
        "subscription cancel",
        "iterator return",
        "session abort",
      ]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
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
      let rawUpdate: Promise<IteratorResult<SubscriptionUpdate>> | undefined;

      try {
        rawUpdate = iterator.next();
        void rawUpdate.catch(() => undefined);
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
        const delivered = await withTimeout(
          rawUpdate,
          "standalone server subscription update",
          500,
        );
        rawUpdate = undefined;
        const response = await readRemoteEventually(
          queries,
          createTaskListQuery(),
          (candidate) => taskTitle(candidate, "task-standalone") === "Standalone",
        );
        if (delivered.done === true) {
          throw new Error("Expected standalone server subscription update.");
        }
        const update = unpackSubscribedTaskList(delivered.value);

        expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
        expect(ack.status?.status.case).toBe("ok");
        expect(response.response?.status?.status.case).toBe("ok");
        expect(readTask(response, "task-standalone")?.completed).toBe(false);
        expect(update.subscription.id).toEqual(subscription.id);
        expect(update.list.id?.value).toBe("task-standalone");
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
        stream.abort();
        await withTimeout(
          subscriptions.cancel(subscription),
          "standalone subscription cancellation cleanup",
          500,
        ).catch(() => undefined);
        await withTimeout(
          rawUpdate ??
            Promise.resolve<IteratorResult<SubscriptionUpdate>>({ done: true, value: undefined }),
          "standalone pending subscription read cleanup",
          500,
        ).catch(() => undefined);
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

      expect(all.message.map((message) => unpackTaskList(message.state)?.id?.value).sort()).toEqual(
        ["task-first", "task-second"],
      );
      expect(readTask(exact, "task-first")?.title).toBe("First");
      expect(readList(filtered, "task-second")?.openTaskCount).toBe(1);
    });
  }, 15_000);

  it("returns validation errors and accepts business rejections without changing remote state", async () => {
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
      expect(reopenOpen.status?.status.case).toBe("ok");
      expect(completeAgain.status?.status.case).toBe("ok");
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
        SignalEnvelopes.command({
          ...createCommandMetadata("command-remote-missing-id"),
          schema: CreateTaskSchema,
          message: create(CreateTaskSchema, { title: "Missing ID" }),
          validate: false,
        }),
        "missing ID rejection acknowledgement",
      );
      const blankId = await postRemoteCommand(
        commands,
        SignalEnvelopes.command({
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
      expect(
        after.message.map((message) => unpackTaskList(message.state)?.id?.value).sort(),
      ).toEqual(["task-id-fence", "task-kept"]);
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
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    const ack = await scope.post(CreateTaskSchema, createTask("task-1", "First"));
    const rows = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => candidate[0]?.tasks.length === 1,
    );

    expect(ack.kind).toBe("ok");
    expect(rows[0]).toEqual(
      create(TaskListSchema, {
        id: create(TaskListIdSchema, { value: "task-1" }),
        tasks: [
          {
            id: create(TaskIdSchema, { value: "task-1" }),
            taskListId: create(TaskListIdSchema, { value: "task-1" }),
            title: "First",
            completed: false,
          },
        ],
        openTaskCount: 1,
      }),
    );
  });

  it("starts and closes the standalone server with its default listener options", async () => {
    const server = await startTodoServer();
    try {
      expect(server.baseUrl).toBe("http://127.0.0.1:8080");
    } finally {
      await server.close();
    }
  });

  it("updates one task in a shared list without changing its sibling", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();
    const listId = "shared-list";
    try {
      await scope.post(CreateTaskSchema, createTaskInList("shared-first", listId, "First"));
      await scope.post(CreateTaskSchema, createTaskInList("shared-second", listId, "Second"));
      await scope.post(RenameTaskSchema, renameTask("shared-first", "Renamed"));
      await scope.post(AssignTaskSchema, assignTask("shared-first", "ada"));
      await scope.post(CompleteTaskSchema, completeTask("shared-first"));
      await scope.post(ReopenTaskSchema, reopenTask("shared-first"));

      const rows = await readTaskListsEventually(
        fixture,
        scope,
        createTaskListIdQuery(listId),
        (candidate) => candidate[0]?.tasks.some((task) => task.title === "Renamed") === true,
      );
      expect(rows[0]?.tasks).toMatchObject([
        {
          id: { value: "shared-first" },
          title: "Renamed",
          completed: false,
          assignee: { value: "ada" },
        },
        { id: { value: "shared-second" }, title: "Second", completed: false },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("routes assignment lifecycle events to zero, one, and two assignee targets", async () => {
    const context = await createTodoContext();
    const fixture = await createTodoBlackBox(context);
    const scope = fixture.asGuest();
    const taskId = "task-assignment";
    const firstAssignee = create(UserIdSchema, { value: "ada" });
    const secondAssignee = create(UserIdSchema, { value: "lin" });

    try {
      await scope.post(CreateTaskSchema, createTask(taskId, "Assigned"));
      await expect(
        context.stand().read(TaskAssigneeSchema, firstAssignee),
      ).resolves.toBeUndefined();

      await scope.post(AssignTaskSchema, assignTask(taskId, "ada"));
      await expectTaskAssigneeEventually(fixture, context, firstAssignee, [taskId]);

      await scope.post(ReassignTaskSchema, reassignTask(taskId, "lin"));
      await expectTaskAssigneeEventually(fixture, context, firstAssignee, []);
      await expectTaskAssigneeEventually(fixture, context, secondAssignee, [taskId]);

      await scope.post(UnassignTaskSchema, unassignTask(taskId));
      await expectTaskAssigneeEventually(fixture, context, secondAssignee, []);

      await expect(context.catchUpReadSide()).resolves.toMatchObject({
        replayedEventCount: 4,
        clearedStateTypes: [TypeUrls.derive(TaskListSchema), TypeUrls.derive(TaskAssigneeSchema)],
      });
      await expectTaskAssigneeEventually(fixture, context, firstAssignee, []);
      await expectTaskAssigneeEventually(fixture, context, secondAssignee, []);
    } finally {
      await context.close();
    }
  });

  it("keeps projections unchanged for rejected assignment transitions before reopening permits one", async () => {
    const context = await createTodoContext();
    const fixture = await createTodoBlackBox(context);
    const scope = fixture.asGuest();
    const taskId = "task-assignment-rejections";
    const listId = taskId;
    const ada = create(UserIdSchema, { value: "ada" });
    const lin = create(UserIdSchema, { value: "lin" });
    try {
      await scope.post(CreateTaskSchema, createTaskInList(taskId, listId, "One"));
      const initial = await readTaskListsEventually(
        fixture,
        scope,
        createTaskListQuery(),
        (rows) => readList(rows, listId)?.tasks.some((task) => task.id?.value === taskId) === true,
      );
      await scope.post(ReassignTaskSchema, reassignTask(taskId, "lin"));
      await scope.post(UnassignTaskSchema, unassignTask(taskId));
      await expectTaskListEventuallyUnchanged(fixture, scope, initial, taskId);
      await scope.post(AssignTaskSchema, assignTask(taskId, "ada"));
      await expectTaskAssigneeEventually(fixture, context, ada, [taskId]);
      const assigned = await readTaskListsEventually(
        fixture,
        scope,
        createTaskListIdQuery(listId),
        (rows) => readTask(rows, taskId)?.assignee?.value === "ada",
      );
      await scope.post(AssignTaskSchema, assignTask(taskId, "lin"));
      await scope.post(ReassignTaskSchema, reassignTask(taskId, "ada"));
      await expectTaskListEventuallyUnchanged(fixture, scope, assigned, taskId);
      await scope.post(CompleteTaskSchema, completeTask(taskId));
      const completed = await readTaskListsEventually(
        fixture,
        scope,
        createTaskListIdQuery(listId),
        (rows) => readTask(rows, taskId)?.completed === true,
      );
      await scope.post(AssignTaskSchema, assignTask(taskId, "lin"));
      await scope.post(ReassignTaskSchema, reassignTask(taskId, "lin"));
      await scope.post(UnassignTaskSchema, unassignTask(taskId));
      await expectTaskListEventuallyUnchanged(fixture, scope, completed, taskId);
      await expectTaskAssigneeEventually(fixture, context, ada, [taskId]);
      await expect(context.stand().read(TaskAssigneeSchema, lin)).resolves.toBeUndefined();
      await scope.post(ReopenTaskSchema, reopenTask(taskId));
      await scope.post(ReassignTaskSchema, reassignTask(taskId, "lin"));
      await expectTaskAssigneeEventually(fixture, context, ada, []);
      await expectTaskAssigneeEventually(fixture, context, lin, [taskId]);
    } finally {
      await fixture.close();
    }
  });

  it("replays a persisted projection Inbox target without rerouting after restart", async () => {
    const todo: TodoModule = await import("../dist/src/index.js");
    const { TaskEvent }: typeof import("../dist/generated/interfaces/task-event.js") =
      await import("../dist/generated/interfaces/task-event.js");
    const storageBackend = new InMemoryStorageBackend();
    const firstRoute = vi.fn(
      (event: { readonly taskListId?: MessageShape<typeof TaskListIdSchema> | undefined }) =>
        event.taskListId === undefined ? [] : [event.taskListId],
    );
    const firstStorage = new InMemoryStorageFactory(storageBackend);
    const firstRouting = EventRouting.create<TaskListId>();
    firstRouting.route(TaskEvent, firstRoute);
    const first = await BoundedContext.singleTenant("Tasks")
      .withStorageFactory(firstStorage)
      .withGeneratedRegistryRoot(new URL("../dist/", import.meta.url))
      .add(todo.TaskAggregate)
      .add(todo.TaskListProjection, {
        // Generated interface tokens cross the dynamic compiled-example boundary.
        eventRouting: firstRouting,
      })
      .buildAsync();
    const listId = create(TaskListIdSchema, { value: "task-inbox-replay" });
    const event = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-inbox-replay" }),
      context: create(EventContextSchema, {
        timestamp: signalMetadata.timestamp(),
        producerId: AnyMessages.pack(
          TaskIdSchema,
          create(TaskIdSchema, { value: "task-inbox-replay" }),
        ),
      }),
      schema: TaskCreatedSchema,
      message: create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: "task-inbox-replay" }),
        taskListId: listId,
        title: "Replay",
      }),
    });
    try {
      await first.eventBus().post(event);
      expect(firstRoute).toHaveBeenCalledTimes(1);
    } finally {
      await first.close();
    }

    const targetId = AnyMessages.pack(TaskListIdSchema, listId);
    const targetTypeUrl = TypeUrls.derive(TaskListSchema);
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory(storageBackend))
      .withNode("todo-replay-seed")
      .build();
    const replayEvent = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-inbox-restart" }),
      context: create(EventContextSchema, {
        timestamp: signalMetadata.timestamp(),
        producerId: AnyMessages.pack(
          TaskIdSchema,
          create(TaskIdSchema, { value: "task-inbox-restart" }),
        ),
      }),
      schema: TaskCreatedSchema,
      message: create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: "task-inbox-restart" }),
        taskListId: listId,
        title: "Restart replay",
      }),
    });
    await delivery.inbox.receive({
      inboxId: { targetId, targetTypeUrl },
      signalId: "event-inbox-restart",
      signal: AnyMessages.pack(EventSchema, replayEvent),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: delivery.strategy.shardFor(targetId, targetTypeUrl),
      whenReceived: new Date(),
      version: 1n,
    });

    const replayRoute = vi.fn(() => {
      throw new Error("durable Inbox replay must not reroute");
    });
    const replayRouting = EventRouting.create<TaskListId>();
    replayRouting.route(TaskEvent, replayRoute);
    const replay = await BoundedContext.singleTenant("Tasks")
      .withStorageFactory(new InMemoryStorageFactory(storageBackend))
      .withGeneratedRegistryRoot(new URL("../dist/", import.meta.url))
      .add(todo.TaskAggregate)
      .add(todo.TaskListProjection, {
        // Generated interface tokens cross the dynamic compiled-example boundary.
        eventRouting: replayRouting,
      })
      .buildAsync();
    const replayFixture = await createTodoBlackBox(replay);
    try {
      await replayFixture.eventually(
        async () => await replay.stand().read(TaskListSchema, listId),
        (state) => state?.tasks.some((task) => task.title === "Restart replay") === true,
      );
      expect(replayRoute).not.toHaveBeenCalled();
    } finally {
      await replayFixture.close();
    }
  });

  it("reads the task list by projection ID", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-list-query", "Visible"));
    const rows = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListIdQuery(),
      (candidate) => candidate.length === 1,
    );

    expect(rows[0]?.tasks).toHaveLength(1);
    expect(rows[0]?.tasks[0]?.title).toBe("Visible");
  });

  it("reads all task-list rows after creating two tasks", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-list-first", "First"));
    await scope.post(CreateTaskSchema, createTask("task-list-second", "Second"));
    const rows = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => candidate.length === 2,
    );

    expect(rows.map((row) => row.id?.value).sort()).toEqual([
      "task-list-first",
      "task-list-second",
    ]);
    expect(rows.flatMap((row) => row.tasks.map((task) => task.title)).sort()).toEqual([
      "First",
      "Second",
    ]);
  });

  it("filters task-list rows by projection columns", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-column-first", "First"));
    await scope.post(CreateTaskSchema, createTask("task-column-second", "Second"));
    await scope.post(CompleteTaskSchema, completeTask("task-column-first"));
    const rows = await readTaskListsEventually(
      fixture,
      scope,
      createOpenTaskCountQuery(1),
      (candidate) => candidate.length === 1 && candidate[0]?.id?.value === "task-column-second",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id?.value).toBe("task-column-second");
    expect(rows[0]?.openTaskCount).toBe(1);
    expect(rows[0]?.tasks[0]?.title).toBe("Second");
  });

  it("subscribes to task-list updates and receives projection-driven changes", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();
    const subscription = await scope.createSubscription(
      createTaskListTopic(),
      taskListSubscriptionOptions(),
    );
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    await subscription.activate();
    await expect(lifecycle.next()).resolves.toMatchObject({
      done: false,
      value: { state: "connecting" },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      done: false,
      value: { state: "connected" },
    });
    const iterator = subscription.updates[Symbol.asyncIterator]();

    try {
      await scope.post(CreateTaskSchema, createTask("task-live", "First"));
      const created = await nextTaskListState(iterator, "create");

      expect(created).toEqual(
        create(TaskListSchema, {
          id: create(TaskListIdSchema, { value: "task-live" }),
          tasks: [
            {
              id: create(TaskIdSchema, { value: "task-live" }),
              taskListId: create(TaskListIdSchema, { value: "task-live" }),
              title: "First",
              completed: false,
            },
          ],
          openTaskCount: 1,
        }),
      );

      await scope.post(RenameTaskSchema, renameTask("task-live", "Renamed"));
      const renamed = await nextTaskListState(iterator, "rename");

      expect(renamed.tasks[0]?.title).toBe("Renamed");
      expect(renamed.tasks[0]?.completed).toBe(false);
      expect(renamed.openTaskCount).toBe(1);

      await scope.post(CompleteTaskSchema, completeTask("task-live"));
      const completed = await nextTaskListState(iterator, "complete");

      expect(completed.tasks[0]?.title).toBe("Renamed");
      expect(completed.tasks[0]?.completed).toBe(true);
      expect(completed.openTaskCount).toBe(0);

      await scope.post(ReopenTaskSchema, reopenTask("task-live"));
      const reopened = await nextTaskListState(iterator, "reopen");

      expect(reopened.tasks[0]?.title).toBe("Renamed");
      expect(reopened.tasks[0]?.completed).toBe(false);
      expect(reopened.openTaskCount).toBe(1);
    } finally {
      await withTimeout(subscription.cancel(), "subscription cleanup", 250);
      await expect(lifecycle.next()).resolves.toMatchObject({
        done: false,
        value: { state: "closed" },
      });
      await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    }
  });

  it("renames one task through command handling and exposes the new title", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-rename", "Original"));
    const ack = await scope.post(RenameTaskSchema, renameTask("task-rename", "Renamed"));
    const rows = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => taskTitle(candidate, "task-rename") === "Renamed",
    );
    const task = readTask(rows, "task-rename");

    expect(ack.kind).toBe("ok");
    expect(task?.title).toBe("Renamed");
    expect(task?.completed).toBe(false);
    expect(readList(rows, "task-rename")?.openTaskCount).toBe(1);
  });

  it("rejects invalid rename payloads with validation details without changing the task list", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-invalid", "Kept"));
    const originalResponse = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => taskTitle(candidate, "task-invalid") === "Kept",
    );

    const invalidRename = await scope.post(RenameTaskSchema, renameTask("task-invalid", ""));
    expect(invalidRename).toMatchObject({
      kind: "error",
      error: { type: "COMMAND_VALIDATION_ERROR" },
    });
    if (invalidRename.kind !== "error") throw new Error("Expected a validation error.");
    if (invalidRename.error.$typeName !== ErrorSchema.typeName)
      throw new Error("Expected a Spine error.");
    const validationError = invalidRename.error as MessageShape<typeof ErrorSchema>;
    if (validationError.details === undefined)
      throw new Error("Expected validation error details.");
    expect(
      AnyMessages.unpack(validationError.details, ValidationErrorSchema)?.constraintViolation.some(
        (violation) => violation.fieldPath?.fieldName[0] === "title",
      ),
    ).toBe(true);
    const response = await expectTaskListEventuallyUnchanged(
      fixture,
      scope,
      originalResponse,
      "task-invalid",
    );
    expect(readTask(response, "task-invalid")).toEqual(readTask(originalResponse, "task-invalid"));
    expect(readList(response, "task-invalid")?.openTaskCount).toBe(1);
  });

  it("completes one task through command handling and closes the list row", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-complete", "Open"));
    const ack = await scope.post(CompleteTaskSchema, completeTask("task-complete"));
    const response = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-complete") === true,
    );
    const task = readTask(response, "task-complete");

    expect(ack.kind).toBe("ok");
    expect(task?.title).toBe("Open");
    expect(task?.completed).toBe(true);
    expect(readList(response, "task-complete")?.openTaskCount).toBe(0);
  });

  it("starts no probe after the rejection readiness deadline expires", async () => {
    let postCount = 0;
    const pendingRead = new Promise<RejectionEvent | undefined>(() => undefined);

    await expect(
      establishRejectionSubscriptionReadiness(
        {
          postEvent: () => {
            postCount++;
            return Promise.resolve();
          },
        },
        { next: () => pendingRead },
        0,
      ),
    ).rejects.toThrow("Rejection subscription readiness deadline expired.");
    expect(postCount).toBe(0);
  });

  it("bounds a non-settling probe post by the rejection readiness deadline", async () => {
    let postCount = 0;
    const pendingRead = new Promise<RejectionEvent | undefined>(() => undefined);

    await expect(
      establishRejectionSubscriptionReadiness(
        {
          postEvent: () => {
            postCount++;
            return new Promise<void>(() => undefined);
          },
        },
        { next: () => pendingRead },
        100,
      ),
    ).rejects.toThrow(/Timed out waiting for rejection readiness probe 1 post/u);
    expect(postCount).toBe(1);
  });

  it("bounds a non-settling assignment-rejection readiness probe post", async () => {
    const pendingRead = new Promise<
      IteratorResult<import("@spine-event-engine/client-node").SubscriptionDelivery>
    >(() => undefined);

    await expect(
      establishAssignmentRejectionSubscriptionReadiness(
        { postEvent: () => new Promise<void>(() => undefined) },
        { next: () => pendingRead },
        createTaskNotAssignedProbe,
        unpackSubscribedTaskNotAssigned,
        100,
      ),
    ).rejects.toThrow(/Timed out waiting for assignment rejection readiness probe 1 post/u);
  });

  it("propagates an immediate readiness read failure while a probe post is pending", async () => {
    const readFailure = new Error("rejection subscription read failed");
    const latePostFailure = new Error("late rejection readiness post failed");
    const delayedPost = Promise.withResolvers<undefined>();
    let postCount = 0;
    const readiness = establishRejectionSubscriptionReadiness(
      {
        postEvent: () => {
          postCount++;
          return delayedPost.promise;
        },
      },
      { next: () => Promise.reject(readFailure) },
      100,
    );

    try {
      await expect(readiness).rejects.toBe(readFailure);
      expect(postCount).toBe(1);
    } finally {
      delayedPost.reject(latePostFailure);
      await nextEventLoopTurn();
    }
  });

  it("waits for the received readiness probe post before starting the fence", async () => {
    const postFailure = new Error("late rejection readiness post failed");
    const firstRead = Promise.withResolvers<RejectionEvent | undefined>();
    const firstPost = Promise.withResolvers<undefined>();
    let nextCount = 0;
    let postCount = 0;
    const readiness = establishRejectionSubscriptionReadiness(
      {
        postEvent: (_schema, message) => {
          postCount++;
          if (postCount === 1) {
            firstRead.resolve({ message, context: create(EventContextSchema) });
            return firstPost.promise;
          }
          return Promise.resolve();
        },
      },
      {
        next: () => {
          nextCount++;
          return nextCount === 1
            ? firstRead.promise
            : new Promise<RejectionEvent | undefined>(() => undefined);
        },
      },
      100,
    );

    await nextEventLoopTurn();
    firstPost.reject(postFailure);

    await expect(readiness).rejects.toBe(postFailure);
    expect(postCount).toBe(1);
    expect(nextCount).toBe(1);
  });

  it("completes received-probe readiness only after its post and fence succeed", async () => {
    const firstRead = Promise.withResolvers<RejectionEvent | undefined>();
    const firstPost = Promise.withResolvers<undefined>();
    const fenceRead = Promise.withResolvers<RejectionEvent | undefined>();
    const fencePost = Promise.withResolvers<undefined>();
    let nextCount = 0;
    let postCount = 0;
    let readinessSettled = false;
    const readiness = establishRejectionSubscriptionReadiness(
      {
        postEvent: (_schema, message) => {
          postCount++;
          if (postCount === 1) {
            firstRead.resolve({ message, context: create(EventContextSchema) });
            return firstPost.promise;
          }
          if (postCount === 2) {
            fenceRead.resolve({ message, context: create(EventContextSchema) });
            return fencePost.promise;
          }
          throw new Error("Unexpected rejection readiness post.");
        },
      },
      {
        next: () => {
          nextCount++;
          if (nextCount === 1) {
            return firstRead.promise;
          }
          if (nextCount === 2) {
            return fenceRead.promise;
          }
          throw new Error("Unexpected rejection readiness read.");
        },
      },
      100,
    );
    void readiness.then(
      () => {
        readinessSettled = true;
      },
      () => {
        readinessSettled = true;
      },
    );

    await nextEventLoopTurn();
    expect(readinessSettled).toBe(false);
    expect(nextCount).toBe(1);
    expect(postCount).toBe(1);

    firstPost.resolve(undefined);
    await nextEventLoopTurn();
    expect(readinessSettled).toBe(false);
    expect(nextCount).toBe(2);
    expect(postCount).toBe(2);

    fencePost.resolve(undefined);
    await readiness;
    expect(readinessSettled).toBe(true);
  });

  it("observes a losing non-settling probe-post timeout after an immediate read failure", async () => {
    vi.useFakeTimers();
    try {
      const readFailure = new Error("rejection subscription read failed");
      let postCount = 0;
      const readiness = establishRejectionSubscriptionReadiness(
        {
          postEvent: () => {
            postCount++;
            return new Promise<void>(() => undefined);
          },
        },
        { next: () => Promise.reject(readFailure) },
        100,
      );

      await expect(readiness).rejects.toBe(readFailure);
      expect(postCount).toBe(1);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(100);

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("accepts an already-completed rejection and publishes its typed event", async () => {
    const context = await createTodoContext();
    const fixture = await createTodoBlackBox(context);
    const scope = fixture.asGuest();
    const subscription = await scope.createSubscription(createTaskAlreadyDoneTopic(), {
      kind: "event",
    });
    await subscription.activate();
    const iterator = subscription.updates[Symbol.asyncIterator]();

    try {
      await establishRejectionSubscriptionReadiness(rejectionPublisher(context), {
        next: async () => {
          const result = await iterator.next();
          return result.done || result.value.kind !== "update"
            ? undefined
            : unpackSubscribedTaskAlreadyDone(result.value.update);
        },
      });
      await scope.post(CreateTaskSchema, createTask("task-refuse", "One-shot"));
      await scope.post(CompleteTaskSchema, completeTask("task-refuse"));
      const completedResponse = await readTaskListsEventually(
        fixture,
        scope,
        createTaskListQuery(),
        (candidate) => taskCompleted(candidate, "task-refuse") === true,
      );
      const nextRejection = iterator.next();

      const ack = await scope.post(CompleteTaskSchema, completeTask("task-refuse"));
      const update = await nextRejection;
      if (update.done) throw new Error("Expected a task rejection event.");
      if (update.value.kind !== "update")
        throw new Error("Expected a task rejection event update.");
      const event = unpackSubscribedTaskAlreadyDone(update.value.update);
      expect(context.storedEventDispatchFailures()).toEqual([]);
      const response = await expectTaskListEventuallyUnchanged(
        fixture,
        scope,
        completedResponse,
        "task-refuse",
      );
      const task = readTask(response, "task-refuse");

      expect(ack.kind).toBe("ok");
      expect(event.message).toEqual(
        create(TaskAlreadyDoneSchema, {
          id: create(TaskIdSchema, { value: "task-refuse" }),
        }),
      );
      expect(event.context.rejection?.command).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      expect(event.context.rejection?.commandMessage).toBeUndefined();
      expect(event.context.rejection?.stacktrace).toBe("");
      expect(task).toEqual(readTask(completedResponse, "task-refuse"));
      expect(readList(response, "task-refuse")?.openTaskCount).toBe(0);
    } finally {
      await withTimeout(subscription.cancel(), "rejection subscription cleanup", 250);
    }
  });

  it("publishes exact assignment rejection types through active subscriptions", async () => {
    const context = await createTodoContext();
    const fixture = await createTodoBlackBox(context);
    const scope = fixture.asGuest();
    const unassigned = await scope.createSubscription(
      createTaskRejectionTopic(TaskNotAssignedSchema),
      {
        kind: "event",
      },
    );
    const alreadyAssigned = await scope.createSubscription(
      createTaskRejectionTopic(TaskAlreadyAssignedSchema),
      { kind: "event" },
    );
    const alreadyDone = await scope.createSubscription(
      createTaskRejectionTopic(TaskAlreadyDoneSchema),
      {
        kind: "event",
      },
    );
    await Promise.all([unassigned.activate(), alreadyAssigned.activate(), alreadyDone.activate()]);
    const unassignedUpdates = unassigned.updates[Symbol.asyncIterator]();
    const alreadyAssignedUpdates = alreadyAssigned.updates[Symbol.asyncIterator]();
    const alreadyDoneUpdates = alreadyDone.updates[Symbol.asyncIterator]();
    const taskId = "task-assignment-rejection-subscription";
    const listId = "list-assignment-rejection-subscription";

    try {
      await establishAssignmentRejectionSubscriptionReadiness(
        assignmentRejectionPublisher(context),
        unassignedUpdates,
        createTaskNotAssignedProbe,
        unpackSubscribedTaskNotAssigned,
      );

      await establishAssignmentRejectionSubscriptionReadiness(
        assignmentRejectionPublisher(context),
        alreadyAssignedUpdates,
        createTaskAlreadyAssignedProbe,
        unpackSubscribedTaskAlreadyAssigned,
      );

      await establishRejectionSubscriptionReadiness(rejectionPublisher(context), {
        next: async () => {
          const update = await nextSubscriptionUpdate(alreadyDoneUpdates);
          return unpackSubscribedTaskAlreadyDone(update);
        },
      });

      const notAssignedUpdate = nextMatchingRejectionUpdate(
        unassignedUpdates,
        unpackSubscribedTaskNotAssigned,
        "TaskNotAssigned subscription",
      );
      await scope.post(CreateTaskSchema, createTaskInList(taskId, listId, "One"));
      await scope.post(ReassignTaskSchema, reassignTask(taskId, "lin"));
      expect(await notAssignedUpdate).toEqual(
        create(TaskNotAssignedSchema, {
          id: create(TaskIdSchema, { value: taskId }),
          taskListId: create(TaskListIdSchema, { value: listId }),
        }),
      );

      const alreadyAssignedUpdate = nextMatchingRejectionUpdate(
        alreadyAssignedUpdates,
        unpackSubscribedTaskAlreadyAssigned,
        "TaskAlreadyAssigned subscription",
      );
      await scope.post(AssignTaskSchema, assignTask(taskId, "ada"));
      await scope.post(AssignTaskSchema, assignTask(taskId, "lin"));
      expect(await alreadyAssignedUpdate).toEqual(
        create(TaskAlreadyAssignedSchema, {
          id: create(TaskIdSchema, { value: taskId }),
          assignee: create(UserIdSchema, { value: "ada" }),
          taskListId: create(TaskListIdSchema, { value: listId }),
        }),
      );

      const alreadyDoneUpdate = nextMatchingRejectionUpdate(
        alreadyDoneUpdates,
        unpackSubscribedTaskAlreadyDone,
        "TaskAlreadyDone assignment subscription",
      );
      await scope.post(CompleteTaskSchema, completeTask(taskId));
      await scope.post(UnassignTaskSchema, unassignTask(taskId));
      expect((await alreadyDoneUpdate).message).toEqual(
        create(TaskAlreadyDoneSchema, {
          id: create(TaskIdSchema, { value: taskId }),
        }),
      );
    } finally {
      await Promise.all([unassigned.cancel(), alreadyAssigned.cancel(), alreadyDone.cancel()]);
      await fixture.close();
    }
  });

  it("does not invoke normal assignment routing callbacks for rejected commands", async () => {
    const todo: TodoModule = await import("../dist/src/index.js");
    const {
      TaskAssignmentEvent,
    }: typeof import("../dist/generated/interfaces/task-assignment-event.js") =
      await import("../dist/generated/interfaces/task-assignment-event.js");
    const {
      TaskReassignedSchema: routedTaskReassignedSchema,
    }: typeof import("../dist/generated/spine/examples/todo/task_events_pb.js") =
      await import("../dist/generated/spine/examples/todo/task_events_pb.js");
    const assignmentRoute = vi.fn(
      (event: { readonly assignee?: MessageShape<typeof UserIdSchema> | undefined }) =>
        event.assignee === undefined ? [] : [event.assignee],
    );
    const reassignmentRoute = vi.fn(
      (event: {
        readonly assignee?: MessageShape<typeof UserIdSchema> | undefined;
        readonly previousAssignee?: MessageShape<typeof UserIdSchema> | undefined;
      }) =>
        event.assignee === undefined || event.previousAssignee === undefined
          ? []
          : [event.previousAssignee, event.assignee],
    );
    const routing = EventRouting.create<MessageShape<typeof UserIdSchema>>()
      .route(TaskAssignmentEvent, assignmentRoute)
      .route(routedTaskReassignedSchema, reassignmentRoute);
    const context = await BoundedContext.singleTenant("Rejected assignment routing")
      .withGeneratedRegistryRoot(new URL("../dist/", import.meta.url))
      .add(todo.TaskAggregate)
      .add(todo.TaskAssigneeProjection, { eventRouting: routing })
      .buildAsync();
    const fixture = await createTodoBlackBox(context);
    const scope = fixture.asGuest();
    const taskId = "task-rejected-routing";

    try {
      await scope.post(CreateTaskSchema, createTask(taskId, "One"));
      await scope.post(AssignTaskSchema, assignTask(taskId, "ada"));
      assignmentRoute.mockClear();
      reassignmentRoute.mockClear();

      await scope.post(AssignTaskSchema, assignTask(taskId, "lin"));
      await scope.post(ReassignTaskSchema, reassignTask(taskId, "ada"));
      await scope.post(CompleteTaskSchema, completeTask(taskId));
      await scope.post(AssignTaskSchema, assignTask(taskId, "lin"));
      await scope.post(ReassignTaskSchema, reassignTask(taskId, "lin"));
      await scope.post(UnassignTaskSchema, unassignTask(taskId));

      expect(assignmentRoute).not.toHaveBeenCalled();
      expect(reassignmentRoute).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("accepts reopening an open task as a rejection without changing the task list", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-open", "Open"));
    const openResponse = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-open") === false,
    );

    const ack = await scope.post(ReopenTaskSchema, reopenTask("task-open"));
    const response = await expectTaskListEventuallyUnchanged(
      fixture,
      scope,
      openResponse,
      "task-open",
    );

    expect(ack.kind).toBe("ok");
    expect(readTask(response, "task-open")).toEqual(readTask(openResponse, "task-open"));
    expect(readList(response, "task-open")?.openTaskCount).toBe(1);
  });

  it("cancels task-list subscriptions and makes later reads inert", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();
    const subscription = await scope.createSubscription(
      createTaskListTopic(),
      taskListSubscriptionOptions(),
    );
    await subscription.activate();
    const iterator = subscription.updates[Symbol.asyncIterator]();

    try {
      await scope.post(CreateTaskSchema, createTask("task-cancel", "Cancel"));
      expect((await nextTaskListState(iterator, "cancel")).id?.value).toBe("task-cancel");

      await subscription.cancel();
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
    } finally {
      await withTimeout(subscription.cancel(), "subscription cancellation cleanup", 250);
    }
  });

  it("counts duplicate same-id projection rows", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-duplicate", "First"));
    await scope.post(CreateTaskSchema, createTask("task-duplicate", "Second"));
    await scope.post(CompleteTaskSchema, completeTask("task-duplicate"));
    const completed = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListIdQuery("task-duplicate"),
      (candidate) => candidate[0]?.tasks.every((task) => task.completed) === true,
    );
    const completedList = completed[0];

    expect(completedList?.openTaskCount).toBe(0);
    expect(completedList?.tasks.map((task) => task.completed)).toEqual([true, true]);

    await scope.post(ReopenTaskSchema, reopenTask("task-duplicate"));
    const reopened = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListIdQuery("task-duplicate"),
      (candidate) => candidate[0]?.tasks.every((task) => !task.completed) === true,
    );
    const reopenedList = reopened[0];

    expect(reopenedList?.openTaskCount).toBe(2);
    expect(reopenedList?.tasks.map((task) => task.completed)).toEqual([false, false]);
  });

  it("detects changed task-list snapshots when an extra task row appears", () => {
    const expected = createTaskListRows("task-snapshot", [
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: "task-snapshot" }),
        title: "First",
        completed: false,
      }),
    ]);
    const actual = createTaskListRows("task-snapshot", [
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
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-reopen", "Done"));
    await scope.post(CompleteTaskSchema, completeTask("task-reopen"));
    const completedResponse = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-reopen") === true,
    );
    const completedTask = readTask(completedResponse, "task-reopen");

    expect(completedTask?.completed).toBe(true);
    expect(readList(completedResponse, "task-reopen")?.openTaskCount).toBe(0);

    const ack = await scope.post(ReopenTaskSchema, reopenTask("task-reopen"));
    const response = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) => taskCompleted(candidate, "task-reopen") === false,
    );
    const task = readTask(response, "task-reopen");

    expect(ack.kind).toBe("ok");
    expect(task?.title).toBe("Done");
    expect(task?.completed).toBe(false);
    expect(readList(response, "task-reopen")?.openTaskCount).toBe(1);
  });

  it("preserves visible task state through command and projection updates", async () => {
    const fixture = await createTodoBlackBox();
    const scope = fixture.asGuest();

    await scope.post(CreateTaskSchema, createTask("task-history", "Original"));
    await scope.post(CompleteTaskSchema, completeTask("task-history"));
    await scope.post(RenameTaskSchema, renameTask("task-history", "Still done"));
    const doneResponse = await readTaskListsEventually(
      fixture,
      scope,
      createTaskListQuery(),
      (candidate) =>
        taskTitle(candidate, "task-history") === "Still done" &&
        taskCompleted(candidate, "task-history") === true,
    );

    await scope.post(ReopenTaskSchema, reopenTask("task-history"));
    const openResponse = await readTaskListsEventually(
      fixture,
      scope,
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
    const fixture = await createTodoBlackBox(context);
    const scope = fixture.asGuest();

    try {
      await scope.post(CreateTaskSchema, createTask("task-catch-up", "Original"));
      await scope.post(CompleteTaskSchema, completeTask("task-catch-up"));
      await readTaskListsEventually(
        fixture,
        scope,
        createTaskListQuery(),
        (candidate) => taskCompleted(candidate, "task-catch-up") === true,
      );

      await context.stand().update(
        TaskListSchema,
        create(TaskListSchema, {
          id: create(TaskListIdSchema, { value: "task-catch-up" }),
          tasks: [
            {
              id: create(TaskIdSchema, { value: "task-catch-up" }),
              taskListId: create(TaskListIdSchema, { value: "task-catch-up" }),
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
        clearedStateTypes: [TypeUrls.derive(TaskListSchema), TypeUrls.derive(TaskAssigneeSchema)],
      });
      await expect(
        context.stand().read(TaskListSchema, create(TaskListIdSchema, { value: "task-catch-up" })),
      ).resolves.toEqual(
        create(TaskListSchema, {
          id: create(TaskListIdSchema, { value: "task-catch-up" }),
          tasks: [
            {
              id: create(TaskIdSchema, { value: "task-catch-up" }),
              taskListId: create(TaskListIdSchema, { value: "task-catch-up" }),
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

async function createTodoBlackBox(context?: Awaited<ReturnType<typeof createTodoContext>>) {
  const blackBox = await BlackBox.from(context ?? (await createTodoContext()), {
    timeoutMs: 500,
    intervalMs: 5,
  });
  ownedBlackBoxes.add(blackBox);
  return blackBox;
}

async function readTaskLists(scope: BlackBoxScope, query: Query): Promise<readonly TaskList[]> {
  const response = await scope.send(query);
  return response.message.map(({ state }) => {
    const taskList = unpackTaskList(state);
    if (taskList === undefined) throw new Error("Expected a TaskList query response state.");
    return taskList;
  });
}

async function readTaskListsEventually(
  blackBox: BlackBox,
  scope: BlackBoxScope,
  query: Query,
  accept: (rows: readonly TaskList[]) => boolean,
): Promise<readonly TaskList[]> {
  return await blackBox.eventually(() => readTaskLists(scope, query), accept);
}

async function nextTaskListState(
  iterator: AsyncIterator<import("@spine-event-engine/client-node").SubscriptionDelivery>,
  label: string,
): Promise<TaskList> {
  const result = await withTimeout(iterator.next(), `subscription update for ${label}`, 250);
  if (result.done) {
    throw new Error(`Expected a task-list state update for ${label}.`);
  }
  if (result.value.kind !== "update") {
    throw new Error(`Expected a task-list update for ${label}.`);
  }
  return unpackSubscribedTaskList(result.value.update).list;
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
  const analysis = BuildHandlerAnalyzer.analyze(program);

  if (analysis.diagnostics.length > 0) {
    throw new Error("Generated handler registry analysis failed.");
  }

  const source = new GeneratedRegistryWriter().render(analysis, { outputFile: registrySource });
  const sources = [...source.matchAll(/from "(?:[^" ]+\/generated\/)?([^" ]+)_pb\.js"/gu)].map(
    (match) => (match[1] ?? "").replace(/^\.\//u, "").replace(/^.*?spine\//u, "spine/") + ".proto",
  );
  const expected = generatedSource(source, sources);
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
  return SignalEnvelopes.command({
    ...createCommandMetadata(commandId),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
      taskListId: create(TaskListIdSchema, { value: taskId }),
      title,
    }),
  });
}

function createTask(taskId: string, title: string) {
  return createTaskInList(taskId, taskId, title);
}

function createTaskInList(taskId: string, taskListId: string, title: string) {
  return create(CreateTaskSchema, {
    id: create(TaskIdSchema, { value: taskId }),
    taskListId: create(TaskListIdSchema, { value: taskListId }),
    title,
  });
}

function createRenameCommand(
  commandId: string,
  taskId: string,
  title: string,
  options: { readonly validate?: boolean } = {},
) {
  return SignalEnvelopes.command({
    ...createCommandMetadata(commandId),
    schema: RenameTaskSchema,
    message: create(RenameTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
      title,
    }),
    ...options,
  });
}

function renameTask(taskId: string, title: string) {
  return create(RenameTaskSchema, {
    id: create(TaskIdSchema, { value: taskId }),
    title,
  });
}

function completeTask(taskId: string) {
  return create(CompleteTaskSchema, { id: create(TaskIdSchema, { value: taskId }) });
}

function createCompleteCommand(commandId: string, taskId: string) {
  return SignalEnvelopes.command({
    ...createCommandMetadata(commandId),
    schema: CompleteTaskSchema,
    message: create(CompleteTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
    }),
  });
}

function createReopenCommand(commandId: string, taskId: string) {
  return SignalEnvelopes.command({
    ...createCommandMetadata(commandId),
    schema: ReopenTaskSchema,
    message: create(ReopenTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
    }),
  });
}

function reopenTask(taskId: string) {
  return create(ReopenTaskSchema, { id: create(TaskIdSchema, { value: taskId }) });
}

function assignTask(taskId: string, assignee: string) {
  return create(AssignTaskSchema, {
    id: create(TaskIdSchema, { value: taskId }),
    assignee: create(UserIdSchema, { value: assignee }),
  });
}

function reassignTask(taskId: string, assignee: string) {
  return create(ReassignTaskSchema, {
    id: create(TaskIdSchema, { value: taskId }),
    assignee: create(UserIdSchema, { value: assignee }),
  });
}

function unassignTask(taskId: string) {
  return create(UnassignTaskSchema, { id: create(TaskIdSchema, { value: taskId }) });
}

async function expectTaskAssigneeEventually(
  fixture: BlackBox,
  context: Awaited<ReturnType<TodoModule["createTodoContext"]>>,
  assignee: MessageShape<typeof UserIdSchema>,
  taskIds: readonly string[],
): Promise<void> {
  await fixture.eventually(
    async () => await context.stand().read(TaskAssigneeSchema, assignee),
    (state) =>
      state?.taskIds
        .map((taskId) => taskId.value)
        .sort()
        .join(",") === taskIds.join(","),
  );
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
      type: TypeUrls.derive(TaskListSchema),
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
      type: TypeUrls.derive(TaskListSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [AnyMessages.pack(TaskListIdSchema, create(TaskListIdSchema, { value: id }))],
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
      type: TypeUrls.derive(TaskListSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          filter: [
            create(CompositeFilterSchema, {
              filter: [
                create(FilterSchema, {
                  fieldPath: { fieldName: ["open_task_count"] },
                  value: AnyMessages.pack(
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
      type: TypeUrls.derive(TaskListSchema),
      criterion:
        id === undefined
          ? { case: "includeAll", value: true }
          : {
              case: "filters",
              value: create(TargetFiltersSchema, {
                idFilter: {
                  id: [AnyMessages.pack(TaskListIdSchema, create(TaskListIdSchema, { value: id }))],
                },
              }),
            },
    }),
    context: createActorContext(),
  });
}

function taskListSubscriptionOptions(id?: string) {
  return {
    kind: "entity" as const,
    authoritativeQuery: () =>
      id === undefined ? createTaskListQuery() : createTaskListIdQuery(id),
  };
}

function createTaskAlreadyDoneTopic() {
  return createTaskRejectionTopic(TaskAlreadyDoneSchema);
}

function createTaskRejectionTopic(
  schema:
    typeof TaskAlreadyAssignedSchema | typeof TaskAlreadyDoneSchema | typeof TaskNotAssignedSchema,
) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `topic-${TypeUrls.derive(schema)}` }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(schema),
      criterion: { case: "includeAll", value: true },
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
  return state === undefined ? undefined : AnyMessages.unpack(state, TaskListSchema);
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

function unpackSubscribedTaskAlreadyDone(update: SubscriptionUpdate) {
  const event = update.update.case === "eventUpdates" ? update.update.value.event[0] : undefined;
  const message =
    event?.message === undefined
      ? undefined
      : AnyMessages.unpack(event.message, TaskAlreadyDoneSchema);
  if (message === undefined || event?.context === undefined) {
    throw new Error("Expected a TaskAlreadyDone event subscription update.");
  }
  return { message, context: event.context };
}

function unpackSubscribedTaskAlreadyAssigned(update: SubscriptionUpdate) {
  const event = update.update.case === "eventUpdates" ? update.update.value.event[0] : undefined;
  const message =
    event?.message === undefined
      ? undefined
      : AnyMessages.unpack(event.message, TaskAlreadyAssignedSchema);
  if (message === undefined)
    throw new Error("Expected a TaskAlreadyAssigned event subscription update.");
  return message;
}

function unpackSubscribedTaskNotAssigned(update: SubscriptionUpdate) {
  const event = update.update.case === "eventUpdates" ? update.update.value.event[0] : undefined;
  const message =
    event?.message === undefined
      ? undefined
      : AnyMessages.unpack(event.message, TaskNotAssignedSchema);
  if (message === undefined)
    throw new Error("Expected a TaskNotAssigned event subscription update.");
  return message;
}

type RejectionEvent = ReturnType<typeof unpackSubscribedTaskAlreadyDone>;

interface RejectionPublisher {
  postEvent(
    schema: typeof TaskAlreadyDoneSchema,
    message: MessageShape<typeof TaskAlreadyDoneSchema>,
  ): Promise<void>;
}

type AssignmentRejectionMessage =
  MessageShape<typeof TaskAlreadyAssignedSchema> | MessageShape<typeof TaskNotAssignedSchema>;

type AssignmentRejectionSchema = typeof TaskAlreadyAssignedSchema | typeof TaskNotAssignedSchema;

interface AssignmentRejectionPublisher {
  postEvent(schema: AssignmentRejectionSchema, message: AssignmentRejectionMessage): Promise<void>;
}

async function establishAssignmentRejectionSubscriptionReadiness(
  fixture: AssignmentRejectionPublisher,
  subscription: AsyncIterator<import("@spine-event-engine/client-node").SubscriptionDelivery>,
  createProbe: (suffix: string) => {
    readonly schema: AssignmentRejectionSchema;
    readonly message: AssignmentRejectionMessage;
  },
  unpack: (update: SubscriptionUpdate) => AssignmentRejectionMessage,
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const read = () =>
    subscription.next().then((result): SubscriptionUpdate | undefined => {
      if (result.done) throw new Error("Rejection subscription ended during readiness.");
      return result.value.kind === "update" ? result.value.update : undefined;
    });
  let pendingRead = read();
  const finishReadiness = async (): Promise<void> => {
    const fence = createProbe("readiness-fence");
    await withTimeout(
      fixture.postEvent(fence.schema, fence.message),
      "assignment rejection readiness fence post",
      remainingMs(deadline),
    );
    for (let remaining = 17; remaining > 0; remaining--) {
      const update = await nextMatchingRejectionUpdate(
        subscription,
        unpack,
        "assignment rejection readiness fence",
        remainingMs(deadline),
      );
      if (update.id?.value === fence.message.id?.value) return;
    }
    throw new Error("Assignment rejection readiness fence was not delivered.");
  };

  for (let attempt = 1; attempt <= 16; attempt++) {
    const probe = createProbe(`readiness-${String(attempt)}`);
    const posted = withTimeout(
      fixture.postEvent(probe.schema, probe.message),
      `assignment rejection readiness probe ${String(attempt)} post`,
      remainingMs(deadline),
    );
    const initial = await Promise.race([
      pendingRead.then((update) => ({ case: "received" as const, update })),
      posted.then(() => ({ case: "posted" as const })),
    ]);
    if (initial.case === "received") {
      await posted;
      if (initial.update !== undefined) {
        try {
          unpack(initial.update);
          await finishReadiness();
          return;
        } catch {
          // The active stream may still deliver an unrelated update.
        }
      }
      pendingRead = read();
      continue;
    }
    await posted;
    const afterTurn = await Promise.race([
      pendingRead.then((update) => ({ case: "received" as const, update })),
      nextEventLoopTurn().then(() => ({ case: "pending" as const })),
    ]);
    if (afterTurn.case === "received") {
      if (afterTurn.update !== undefined) {
        try {
          unpack(afterTurn.update);
          await finishReadiness();
          return;
        } catch {
          // The active stream may still deliver an unrelated update.
        }
      }
      pendingRead = read();
    }
    if (Date.now() >= deadline) break;
  }

  for (let attempt = 1; attempt <= 8; attempt++) {
    const update = await withTimeout(
      pendingRead,
      "assignment rejection subscription readiness",
      remainingMs(deadline),
    );
    if (update !== undefined) {
      try {
        unpack(update);
        await finishReadiness();
        return;
      } catch {
        // The active stream may still deliver an unrelated update.
      }
    }
    pendingRead = read();
  }
  throw new Error("Assignment rejection subscription did not receive a matching readiness probe.");
}

type RejectionReadOutcome =
  | { readonly case: "received"; readonly update: RejectionEvent | undefined }
  | { readonly case: "readFailed"; readonly error: unknown };

type RejectionPostOutcome =
  { readonly case: "posted" } | { readonly case: "postFailed"; readonly error: unknown };

interface RejectionPendingOutcome {
  readonly case: "pending";
}

async function establishRejectionSubscriptionReadiness(
  fixture: RejectionPublisher,
  subscription: { readonly next: () => Promise<RejectionEvent | undefined> },
  timeoutMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const probes = new Map<string, string>();
  const firstRead = subscription.next().then<RejectionReadOutcome, RejectionReadOutcome>(
    (update) => ({ case: "received", update }),
    (error: unknown) => ({ case: "readFailed", error }),
  );
  const receiveProbe = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 16; attempt++) {
      const probe = createTaskAlreadyDoneProbe(`readiness-${String(attempt)}`);
      probes.set(probe.taskId, probe.taskId);
      const postBudget = remainingMs(deadline);
      const post = fixture.postEvent(TaskAlreadyDoneSchema, probe.message);
      const postOutcome = withTimeout(
        post,
        `rejection readiness probe ${String(attempt)} post`,
        postBudget,
      ).then<RejectionPostOutcome, RejectionPostOutcome>(
        () => ({ case: "posted" }),
        (error: unknown) => ({ case: "postFailed", error }),
      );
      const initialOutcome = await Promise.race([firstRead, postOutcome]);
      if (initialOutcome.case === "readFailed") {
        return propagateReadinessFailure(initialOutcome.error);
      }
      if (initialOutcome.case === "received") {
        const settledPost = await postOutcome;
        if (settledPost.case === "postFailed") {
          return propagateReadinessFailure(settledPost.error);
        }
        expectTaskAlreadyDoneProbe(assertRejectionEvent(initialOutcome.update), probes);
        return;
      }
      if (initialOutcome.case === "postFailed") {
        return propagateReadinessFailure(initialOutcome.error);
      }

      const readOutcome = await Promise.race([
        firstRead,
        nextEventLoopTurn().then<RejectionPendingOutcome>(() => ({ case: "pending" })),
      ]);
      if (readOutcome.case === "readFailed") {
        return propagateReadinessFailure(readOutcome.error);
      }
      if (readOutcome.case === "received") {
        expectTaskAlreadyDoneProbe(assertRejectionEvent(readOutcome.update), probes);
        return;
      }
    }

    const finalOutcome = await withTimeout(
      firstRead,
      "rejection subscription readiness probe",
      remainingMs(deadline),
    );
    if (finalOutcome.case === "readFailed") {
      return propagateReadinessFailure(finalOutcome.error);
    }
    expectTaskAlreadyDoneProbe(assertRejectionEvent(finalOutcome.update), probes);
  };
  await receiveProbe();

  const fence = createTaskAlreadyDoneProbe("readiness-fence");
  probes.set(fence.taskId, fence.taskId);
  let nextProbe = nextRejectionEvent(
    subscription,
    "rejection subscription readiness fence",
    remainingMs(deadline),
  );
  const fencePostBudget = remainingMs(deadline);
  const fencePost = fixture.postEvent(TaskAlreadyDoneSchema, fence.message);
  await withTimeout(fencePost, "rejection subscription readiness fence post", fencePostBudget);

  for (let remaining = probes.size; remaining > 0; remaining--) {
    const event = await nextProbe;
    expectTaskAlreadyDoneProbe(event, probes);
    if (event.message.id?.value === fence.taskId) {
      return;
    }
    nextProbe = nextRejectionEvent(
      subscription,
      "queued rejection readiness probe",
      remainingMs(deadline),
    );
  }

  throw new Error("Rejection subscription readiness fence was not delivered.");
}

function propagateReadinessFailure(error: unknown): Promise<never> {
  // Preserve the original asynchronous failure instead of replacing its identity.
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
  return Promise.reject(error);
}

function createTaskAlreadyDoneProbe(suffix: string) {
  const taskId = `task-rejection-${suffix}`;

  return {
    taskId,
    message: create(TaskAlreadyDoneSchema, {
      id: create(TaskIdSchema, { value: taskId }),
    }),
  };
}

function rejectionPublisher(
  context: Awaited<ReturnType<TodoModule["createTodoContext"]>>,
): RejectionPublisher {
  return {
    postEvent(schema, message) {
      const producerId = message.id;
      if (producerId === undefined) {
        throw new Error("A rejection readiness probe requires a Task ID.");
      }
      return context.eventBus().post(
        SignalEnvelopes.event({
          id: signalMetadata.eventId(),
          context: create(EventContextSchema, {
            timestamp: signalMetadata.timestamp(),
            producerId: AnyMessages.pack(TaskIdSchema, producerId),
          }),
          schema,
          message,
        }),
      );
    },
  };
}

function assignmentRejectionPublisher(
  context: Awaited<ReturnType<TodoModule["createTodoContext"]>>,
): AssignmentRejectionPublisher {
  return {
    postEvent(schema, message) {
      const producerId = message.id;
      if (producerId === undefined) {
        throw new Error("An assignment rejection readiness probe requires a Task ID.");
      }
      return context.eventBus().post(
        SignalEnvelopes.event({
          id: signalMetadata.eventId(),
          context: create(EventContextSchema, {
            timestamp: signalMetadata.timestamp(),
            producerId: AnyMessages.pack(TaskIdSchema, producerId),
          }),
          schema,
          message,
        }),
      );
    },
  };
}

function createTaskNotAssignedProbe(suffix: string) {
  return {
    schema: TaskNotAssignedSchema,
    message: create(TaskNotAssignedSchema, {
      id: create(TaskIdSchema, { value: `task-not-assigned-${suffix}` }),
      taskListId: create(TaskListIdSchema, { value: `list-not-assigned-${suffix}` }),
    }),
  };
}

function createTaskAlreadyAssignedProbe(suffix: string) {
  return {
    schema: TaskAlreadyAssignedSchema,
    message: create(TaskAlreadyAssignedSchema, {
      id: create(TaskIdSchema, { value: `task-already-assigned-${suffix}` }),
      assignee: create(UserIdSchema, { value: "ada" }),
      taskListId: create(TaskListIdSchema, { value: `list-already-assigned-${suffix}` }),
    }),
  };
}

function expectTaskAlreadyDoneProbe(
  event: RejectionEvent,
  probes: ReadonlyMap<string, string>,
): void {
  const taskId = event.message.id?.value;
  if (taskId === undefined || !probes.has(taskId)) {
    throw new Error("Received an unexpected rejection readiness event.");
  }

  expect(event.message).toEqual(
    create(TaskAlreadyDoneSchema, {
      id: create(TaskIdSchema, { value: taskId }),
    }),
  );
}

function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function remainingMs(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("Rejection subscription readiness deadline expired.");
  }
  return remaining;
}

async function nextRejectionEvent(
  subscription: { readonly next: () => Promise<RejectionEvent | undefined> },
  label: string,
  timeoutMs = 250,
): Promise<RejectionEvent> {
  const result = await withTimeout(
    subscription.next(),
    `subscription update for ${label}`,
    timeoutMs,
  );
  if (result === undefined) throw new Error(`Expected a rejection event for ${label}.`);
  return result;
}

async function nextMatchingRejectionUpdate<T>(
  subscription: AsyncIterator<import("@spine-event-engine/client-node").SubscriptionDelivery>,
  unpack: (update: SubscriptionUpdate) => T,
  label: string,
  timeoutMs = 500,
): Promise<T> {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const result = await withTimeout(
      subscription.next(),
      `subscription update for ${label}`,
      timeoutMs,
    );
    if (result.done) throw new Error(`Expected a subscription update for ${label}.`);
    if (result.value.kind !== "update") continue;
    try {
      return unpack(result.value.update);
    } catch {
      // Activation may yield a non-event update before the posted rejection.
    }
  }
  throw new Error(`Expected a matching rejection event for ${label}.`);
}

async function nextSubscriptionUpdate(
  subscription: AsyncIterator<import("@spine-event-engine/client-node").SubscriptionDelivery>,
): Promise<SubscriptionUpdate> {
  const result = await withTimeout(subscription.next(), "subscription update", 500);
  if (result.done) throw new Error("Expected a subscription update.");
  if (result.value.kind !== "update") {
    return await nextSubscriptionUpdate(subscription);
  }
  return result.value.update;
}

function assertRejectionEvent(value: RejectionEvent | undefined): RejectionEvent {
  if (value === undefined) throw new Error("Expected a rejection event.");
  return value;
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
      return sanitizeDiagnostic(unpackTaskList(message.state)?.id?.value ?? "<unreadable>");
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

type TaskListRows = readonly TaskList[] | Pick<QueryResponse, "message">;

function decodedTaskLists(rows: TaskListRows): readonly TaskList[] {
  if ("message" in rows) {
    const lists: TaskList[] = [];
    for (const message of rows.message) {
      const list = unpackTaskList(message.state);
      if (list !== undefined) lists.push(list);
    }
    return lists;
  }
  return rows;
}

function readList(rows: TaskListRows, taskId: string) {
  return decodedTaskLists(rows).find((list) => list.id?.value === taskId);
}

function readTask(rows: TaskListRows, taskId: string): Task | undefined {
  return readList(rows, taskId)?.tasks.find((task) => task.id?.value === taskId);
}

function createTaskListRows(id: string, tasks: Task[]): readonly TaskList[] {
  return [
    create(TaskListSchema, {
      id: create(TaskListIdSchema, { value: id }),
      openTaskCount: tasks.filter((task) => !task.completed).length,
      tasks,
    }),
  ];
}

async function expectTaskListEventuallyUnchanged(
  fixture: BlackBox,
  scope: BlackBoxScope,
  expected: readonly TaskList[],
  taskId: string,
): Promise<readonly TaskList[]> {
  const expectedSnapshot = taskListSnapshot(expected, taskId);
  const response = await readTaskLists(scope, createTaskListQuery());

  expect(taskListSnapshot(response, taskId)).toEqual(expectedSnapshot);

  return response;
}

function taskListSnapshot(rows: TaskListRows, taskId: string) {
  const list = readList(rows, taskId);

  return {
    id: list?.id?.value,
    openTaskCount: list === undefined ? undefined : list.openTaskCount,
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

function taskTitle(rows: TaskListRows, taskId: string): string | undefined {
  return readTask(rows, taskId)?.title;
}

function taskCompleted(rows: TaskListRows, taskId: string): boolean | undefined {
  return readTask(rows, taskId)?.completed;
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

  return AnyMessages.unpack(
    value.details as Parameters<typeof AnyMessages.unpack>[0],
    ValidationErrorSchema,
  );
}
