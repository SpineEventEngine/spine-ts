import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { deriveTypeUrl, packAny, packCommand, unpackAny } from "@spine-ts/core";
import { UserIdSchema } from "@spine-ts/proto";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import {
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { QueryIdSchema, QuerySchema } from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import { SignalMetadata } from "@spine-ts/server";

import { CreateTaskSchema } from "../dist/generated/spine/example/todo/v1/task_commands_pb.js";
import { TaskIdSchema } from "../dist/generated/spine/example/todo/v1/task_id_pb.js";
import { TaskListSchema } from "../dist/generated/spine/example/todo/v1/task_list_pb.js";

const baseUrl = process.env.SPINE_TODO_BASE_URL ?? "http://127.0.0.1:8080";
const commandTimeoutMs = 1_000;
const queryDeadlineMs = 5_000;
const queryRetryDelayMs = 50;
const maxDiagnosticRows = 4;
const maxDiagnosticLength = 64;
const suffix = `${Date.now()}-${process.pid}`;
const taskId = `smoke-${suffix}`;
const session = new Http2SessionManager(baseUrl);
const transport = createGrpcTransport({ baseUrl, sessionManager: session });
const commands = createClient(CommandService, transport);
const queries = createClient(QueryService, transport);
const metadata = new SignalMetadata();
const actorContext = metadata.actorContext({
  actor: create(UserIdSchema, { value: "todo-smoke-user" }),
});

try {
  const acknowledgement = await withTimeout(
    commands.post(createCommand(taskId, suffix, actorContext)),
    "CreateTask acknowledgement",
    commandTimeoutMs,
  );
  if (acknowledgement.status?.status.case !== "ok") {
    throw new Error(
      `CreateTask acknowledgement was ${sanitize(acknowledgement.status?.status.case ?? "missing")}.`,
    );
  }

  const taskList = await readTaskListEventually(taskId, actorContext);
  log(`to-do smoke ok: ${taskList.id} (${taskList.tasks[0]?.title ?? "untitled"})`);
} finally {
  session.abort();
}

function createCommand(id, commandSuffix, context) {
  return packCommand({
    id: metadata.commandId(`smoke-command-${commandSuffix}`),
    context: metadata.commandContext({ actorContext: context }),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: id }),
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
    const taskList = response.message
      .map((row) => row.state)
      .filter((state) => state !== undefined)
      .map((state) => unpackAny(state, TaskListSchema))
      .find((candidate) => candidate.id === id);
    if (response.response?.status?.status.case === "ok" && taskList !== undefined) {
      return taskList;
    }
    await delay(Math.min(queryRetryDelayMs, Math.max(0, deadline - Date.now())));
  }

  throw new Error(
    `TaskList ${sanitize(id)} was not observed after ${queryDeadlineMs}ms (${attempts} reads); ` +
      `last rows [${lastRowIds(lastResponse).join(", ")}].`,
  );
}

function createTaskListQuery(id, context, attempt) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `smoke-query-${id}-${attempt}` }),
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
    context,
  });
}

function lastRowIds(response) {
  return (response?.message ?? []).slice(0, maxDiagnosticRows).map((row) => {
    try {
      return sanitize(unpackAny(row.state, TaskListSchema).id);
    } catch {
      return "<unreadable>";
    }
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

function sanitize(value) {
  let cleaned = "";
  for (const character of String(value)) {
    const code = character.charCodeAt(0);
    cleaned += code <= 31 || code === 127 ? " " : character;
  }
  cleaned = cleaned.trim();
  return cleaned === "" ? "<blank>" : cleaned.slice(0, maxDiagnosticLength);
}
import { log } from "node:console";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
