// Observes both CreateTask Events through the public Node client, then polls
// the authoritative TaskList projection to prove the managed To-Do app works.

import { log } from "node:console";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { pathToFileURL } from "node:url";

import { create } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client-node";
import { AnyPacker } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

import {
  AssignTaskSchema,
  CreateTaskSchema,
} from "../dist/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskCreatedSchema,
  TaskAssignedSchema,
  TaskReassignedSchema,
} from "../dist/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskAlreadyAssignedSchema,
  TaskAlreadyDoneSchema,
} from "../dist/generated/spine/examples/todo/task_rejections_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../dist/generated/spine/examples/todo/task_id_pb.js";
import { TaskListQuery } from "../dist/generated/spine/examples/todo/task_list_query.js";
import { SmokeTaskLists } from "../dist/src/smoke-task-lists.js";

const baseUrl = process.env.SPINE_TODO_BASE_URL ?? "http://127.0.0.1:8080";
const commandTimeoutMs = 1_000;
const eventDeadlineMs = 5_000;
const queryDeadlineMs = 5_000;
const queryRetryDelayMs = 50;
const suffix = randomUUID();
const taskId = `smoke-${suffix}`;
const client = Client.connectTo(baseUrl);
const request = client.onBehalfOf("todo-smoke-user");

if (isEntrypoint()) {
  await main();
}

async function main() {
  let subscription;
  try {
    const result = await request.postAndSubscribe(CreateTaskSchema, createTask(taskId), {
      events: [TaskCreatedSchema, TaskAssignedSchema],
      activationTimeoutMs: commandTimeoutMs,
      firstUpdateTimeoutMs: eventDeadlineMs,
      onFirstUpdateTimeout: () => log("to-do smoke is still waiting for its first Event."),
    });
    if (result.kind === "refused")
      throw new Error(`CreateTask was refused (${result.acknowledgement.kind}).`);
    subscription = result.subscription;
    await observeBothEvents(subscription, taskId);
    await subscription.cancel();
    subscription = undefined;
    await exerciseAssignments(taskId);
    const taskList = await readTaskListEventually(taskId);
    log(`to-do smoke ok: ${taskList.id.value} (${taskList.tasks[0]?.title ?? "untitled"})`);
  } finally {
    await subscription?.cancel();
    await client.close();
  }
}

function isEntrypoint() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

function createTask(id) {
  return create(CreateTaskSchema, {
    id: create(TaskIdSchema, { value: id }),
    taskListId: create(TaskListIdSchema, { value: id }),
    title: "Smoke task",
    assignee: create(UserIdSchema, { value: "todo-smoke-user" }),
  });
}

async function observeBothEvents(subscription, id) {
  const expected = new Set([TaskCreatedSchema.typeName, TaskAssignedSchema.typeName]);
  const updates = subscription.updates[Symbol.asyncIterator]();
  const deadline = Date.now() + eventDeadlineMs;
  while (expected.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new Error(`CreateTask Events timed out: ${[...expected].join(", ")}.`);
    const next = await withTimeout(updates.next(), "CreateTask Events", remaining);
    if (next.done) throw new Error(`CreateTask Event stream ended: ${[...expected].join(", ")}.`);
    if (next.value.kind !== "update" || next.value.update.update.case !== "eventUpdates") continue;
    for (const event of next.value.update.update.value.event) {
      const created = event.message && AnyPacker.tryUnpack(event.message, TaskCreatedSchema);
      const assigned = event.message && AnyPacker.tryUnpack(event.message, TaskAssignedSchema);
      if (created?.id?.value === id) expected.delete(TaskCreatedSchema.typeName);
      if (assigned?.id?.value === id) expected.delete(TaskAssignedSchema.typeName);
    }
  }
}

async function exerciseAssignments(id) {
  const secondId = `unassigned-${suffix}`;
  const second = await request.postAndSubscribe(
    CreateTaskSchema,
    create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: secondId }),
      taskListId: create(TaskListIdSchema, { value: id }),
      title: "Unassigned smoke task",
    }),
    { events: [TaskCreatedSchema], activationTimeoutMs: commandTimeoutMs },
  );
  await expectSelected(second, secondId, TaskCreatedSchema);

  const assignment = {
    events: [TaskAssignedSchema, TaskReassignedSchema],
    rejections: [TaskAlreadyDoneSchema, TaskAlreadyAssignedSchema],
    activationTimeoutMs: commandTimeoutMs,
  };
  const first = await request.postAndSubscribe(
    AssignTaskSchema,
    create(AssignTaskSchema, {
      id: create(TaskIdSchema, { value: secondId }),
      assignee: create(UserIdSchema, { value: "todo-smoke-user" }),
    }),
    assignment,
  );
  await expectSelected(first, secondId, TaskAssignedSchema);

  const changed = await request.postAndSubscribe(
    AssignTaskSchema,
    create(AssignTaskSchema, {
      id: create(TaskIdSchema, { value: id }),
      assignee: create(UserIdSchema, { value: "todo-smoke-reviewer" }),
    }),
    assignment,
  );
  await expectSelected(changed, id, TaskReassignedSchema);

  const rejected = await request.postAndSubscribe(
    AssignTaskSchema,
    create(AssignTaskSchema, {
      id: create(TaskIdSchema, { value: id }),
      assignee: create(UserIdSchema, { value: "todo-smoke-reviewer" }),
    }),
    assignment,
  );
  await expectSelected(rejected, id, TaskAlreadyAssignedSchema);
}

async function expectSelected(result, id, schema) {
  if (result.kind === "refused")
    throw new Error(`Expected ${schema.typeName}, got admission ${result.acknowledgement.kind}.`);
  const updates = result.subscription.updates[Symbol.asyncIterator]();
  const deadline = Date.now() + eventDeadlineMs;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`${schema.typeName} timed out.`);
      const next = await withTimeout(updates.next(), schema.typeName, remaining);
      if (next.done) throw new Error(`${schema.typeName} stream ended.`);
      if (next.value.kind !== "update" || next.value.update.update.case !== "eventUpdates")
        continue;
      for (const event of next.value.update.update.value.event) {
        const signal = event.message && AnyPacker.tryUnpack(event.message, schema);
        if (signal?.id?.value === id) return;
      }
    }
  } finally {
    await result.subscription.cancel();
  }
}

async function readTaskListEventually(id) {
  const deadline = Date.now() + queryDeadlineMs;
  let lastResponse;
  let attempts = 0;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const response = await withTimeout(
      request.send(createTaskListQuery(id)),
      "TaskList query",
      remainingMs,
    );
    attempts += 1;
    lastResponse = response;
    const taskList = SmokeTaskLists.inspectRows(response).taskLists.find(
      (candidate) => candidate.id.value === id,
    );
    const firstTask = taskList?.tasks.find((task) => task.id?.value === id);
    const secondTask = taskList?.tasks.find((task) => task.id?.value === `unassigned-${suffix}`);
    if (
      response.response?.status?.status.case === "ok" &&
      taskList !== undefined &&
      firstTask?.assignee?.value === "todo-smoke-reviewer" &&
      secondTask?.assignee?.value === "todo-smoke-user"
    ) {
      return taskList;
    }
    await delay(Math.min(queryRetryDelayMs, Math.max(0, deadline - Date.now())));
  }

  throw new Error(
    `TaskList ${SmokeTaskLists.sanitizeValue(id)} was not observed after ${queryDeadlineMs}ms (${attempts} reads); ` +
      `last diagnostics [${SmokeTaskLists.inspectRows(lastResponse).diagnostics.join(", ")}].`,
  );
}

function createTaskListQuery(id) {
  return TaskListQuery.create()
    .byId(create(TaskListIdSchema, { value: id }))
    .build()
    .build();
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
