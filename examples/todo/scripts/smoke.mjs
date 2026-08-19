// Posts one task through the configured Coordinator, then polls the
// authoritative TaskList projection to prove the managed To-Do app works.

import { log } from "node:console";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  CommandService,
  QueryIdSchema,
  QuerySchema,
  QueryService,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";

import { CreateTaskSchema } from "../dist/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../dist/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../dist/generated/spine/examples/todo/task_list_pb.js";
import { SmokeTaskLists } from "../dist/src/smoke-task-lists.js";

const baseUrl = process.env.SPINE_TODO_BASE_URL ?? "http://127.0.0.1:8080";
const commandTimeoutMs = 1_000;
const queryDeadlineMs = 5_000;
const queryRetryDelayMs = 50;
const suffix = randomUUID();
const taskId = `smoke-${suffix}`;
const session = new Http2SessionManager(baseUrl);
const transport = createGrpcTransport({ baseUrl, sessionManager: session });
const commands = createClient(CommandService, transport);
const queries = createClient(QueryService, transport);
const metadata = new SignalMetadata();
const actorContext = metadata.actorContext({
  actor: create(UserIdSchema, { value: "todo-smoke-user" }),
});

if (isEntrypoint()) {
  await main();
}

async function main() {
  try {
    const acknowledgement = await withTimeout(
      commands.post(createCommand(taskId, suffix, actorContext)),
      "CreateTask acknowledgement",
      commandTimeoutMs,
    );
    const status = acknowledgement.status?.status;
    if (status?.case !== "ok")
      throw new Error(
        status?.case === "error"
          ? `CreateTask acknowledgement failed (${SmokeTaskLists.sanitizeValue(status.value.type)}: ${SmokeTaskLists.sanitizeValue(status.value.message)}).`
          : "CreateTask acknowledgement had no status.",
      );

    const taskList = await readTaskListEventually(taskId, actorContext);
    log(`to-do smoke ok: ${taskList.id.value} (${taskList.tasks[0]?.title ?? "untitled"})`);
  } finally {
    session.abort();
  }
}

function isEntrypoint() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function createCommand(id, commandSuffix, context) {
  return SignalEnvelopes.command({
    id: metadata.commandId(`smoke-command-${commandSuffix}`),
    context: metadata.commandContext({ actorContext: context }),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: id }),
      taskListId: create(TaskListIdSchema, { value: id }),
      title: "Smoke task",
    }),
  });
}

async function readTaskListEventually(id, context) {
  const deadline = Date.now() + queryDeadlineMs;
  let lastResponse;
  let attempts = 0;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const response = await withTimeout(
      queries.read(createTaskListQuery(id, context, attempts)),
      "TaskList query",
      remainingMs,
    );
    attempts += 1;
    lastResponse = response;
    const taskList = SmokeTaskLists.inspectRows(response).taskLists.find(
      (candidate) => candidate.id.value === id,
    );
    if (response.response?.status?.status.case === "ok" && taskList !== undefined) {
      return taskList;
    }
    await delay(Math.min(queryRetryDelayMs, Math.max(0, deadline - Date.now())));
  }

  throw new Error(
    `TaskList ${SmokeTaskLists.sanitizeValue(id)} was not observed after ${queryDeadlineMs}ms (${attempts} reads); ` +
      `last diagnostics [${SmokeTaskLists.inspectRows(lastResponse).diagnostics.join(", ")}].`,
  );
}

function createTaskListQuery(id, context, attempt) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `smoke-query-${id}-${attempt}` }),
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
    context,
  });
}

async function withTimeout(promise, label, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
