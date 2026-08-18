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

import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DeliveryServer } from "../../../delivery-server/src/index.js";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { SignalMetadata } from "../../src/index.js";
import { UserIdSchema } from "@spine-event-engine/proto";
import { CommandService, SubscriptionService, TargetSchema, TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { CreateTaskSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_commands_pb.js";
import { TaskIdSchema, TaskListIdSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_list_pb.js";
import { afterEach, expect, it } from "vitest";

const children = new Set<ChildProcess>();
const servers = new Set<DeliveryServer>();

afterEach(async () => {
  for (const child of children) child.kill("SIGTERM");
  children.clear();
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

it("RED-27/28 keeps the final managed subscription relay until fenced Delivery work drains", async () => {
  const delivery = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.add(delivery);
  await delivery.start();
  const child = fork(
    fileURLToPath(new URL("./managed-remote-delivery-application.mjs", import.meta.url)),
    [],
    {
      env: { ...process.env, SPINE_MANAGED_REMOTE_DELIVERY_URL: delivery.baseUrl },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  const ready = await receive(child, "managed-ready");
  expect(ready.members).toHaveLength(2);
  const endpoint = String(ready.endpoint);
  const transport = createGrpcTransport({ baseUrl: endpoint });
  const subscriptions = createClient(SubscriptionService, transport);
  const subscription = await subscriptions.subscribe(taskListTopic());
  const iterator = subscriptions.activate(subscription)[Symbol.asyncIterator]();
  await createClient(CommandService, transport).post(createTaskCommand());
  await expect(iterator.next()).resolves.toMatchObject({ done: false });

  // Intentionally RED: the fixture supplies real managed children and remote
  // Delivery readiness, but T-0209 has not yet exposed final relay/drain facts.
  expect(ready.finalRelayAfterDrain).toBe(true);
}, 20_000);

function receive(child: ChildProcess, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => finish(new Error("Managed fixture readiness timed out.")), 10_000);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`Managed fixture exited before readiness (code ${String(code)}, signal ${String(signal)}): ${stderr}`));
    const onMessage = (value: unknown) => {
      if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== type)
        return;
      finish(undefined, value as Record<string, unknown>);
    };
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("message", onMessage);
      if (error !== undefined) reject(error);
      else resolve(value as Record<string, unknown>);
    };
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

const metadata = new SignalMetadata();
function taskListTopic() {
  return create(TopicSchema, { id: create(TopicIdSchema, { value: "t0209" }), target: create(TargetSchema, { type: TypeUrls.derive(TaskListSchema), criterion: { case: "includeAll", value: true } }), context: metadata.actorContext({ actor: create(UserIdSchema, { value: "t0209" }) }) });
}
function createTaskCommand() {
  const actorContext = metadata.actorContext({ actor: create(UserIdSchema, { value: "t0209" }) });
  return SignalEnvelopes.command({ id: metadata.commandId("t0209-create"), context: metadata.commandContext({ actorContext }), schema: CreateTaskSchema, message: create(CreateTaskSchema, { id: create(TaskIdSchema, { value: "t0209-task" }), taskListId: create(TaskListIdSchema, { value: "t0209-task" }), title: "T-0209" }) });
}
