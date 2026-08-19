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
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { Code, createClient, type ServiceImpl } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import { SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  AdminService,
  InboxService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import { SignalMetadata } from "../../src/index.js";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  CommandService,
  SubscriptionService,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import {
  CreateTaskSchema,
  RenameTaskSchema,
} from "../../../../examples/todo/dist/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/dist/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_list_pb.js";
import { DeliveryAssembly } from "../../../delivery-server/src/server/assembly.js";
import { afterEach, expect, it } from "vitest";

const children = new Set<ChildProcess>();
const deliveries = new Set<GatedDeliveryListener>();

afterEach(async () => {
  for (const child of children) child.kill("SIGTERM");
  children.clear();
  await Promise.all([...deliveries].map((delivery) => delivery.close()));
  deliveries.clear();
});

it("RED-27/28 keeps the final managed subscription relay until fenced Delivery work drains", async () => {
  const delivery = await new GatedDeliveryListener().start();
  deliveries.add(delivery);
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
  const commands = createClient(CommandService, transport);
  await commands.post(createTaskCommand());
  await expect(iterator.next()).resolves.toMatchObject({ done: false });

  delivery.arm();
  const nextUpdate = iterator.next();
  await commands.post(renameTaskCommand());
  await delivery.entered;

  const drained = receive(child, "drained");
  child.send({ type: "drain" });
  await expect(commands.post(createTaskCommand("t0209-after-drain"))).rejects.toMatchObject({
    code: Code.Unavailable,
  });
  delivery.release();
  await expect(nextUpdate).resolves.toMatchObject({ done: false });
  await drained;
  await expect(iterator.next()).resolves.toMatchObject({ done: true });
}, 20_000);

function receive(child: ChildProcess, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      finish(new Error("Managed fixture readiness timed out."));
    }, 10_000);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        new Error(
          `Managed fixture exited before readiness (code ${String(code)}, signal ${String(signal)}): ${stderr}`,
        ),
      );
    };
    const onMessage = (value: unknown) => {
      if (
        typeof value !== "object" ||
        value === null ||
        (value as { type?: unknown }).type !== type
      )
        return;
      finish(undefined, value as Record<string, unknown>);
    };
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("message", onMessage);
      if (error !== undefined) reject(error);
      else if (value !== undefined) resolve(value);
      else reject(new Error("Managed fixture message was missing."));
    };
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

const metadata = new SignalMetadata();
function taskListTopic() {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t0209" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(TaskListSchema),
      criterion: { case: "includeAll", value: true },
    }),
    context: metadata.actorContext({ actor: create(UserIdSchema, { value: "t0209" }) }),
  });
}
function createTaskCommand(commandId = "t0209-create") {
  const actorContext = metadata.actorContext({ actor: create(UserIdSchema, { value: "t0209" }) });
  return SignalEnvelopes.command({
    id: metadata.commandId(commandId),
    context: metadata.commandContext({ actorContext }),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: "t0209-task" }),
      taskListId: create(TaskListIdSchema, { value: "t0209-task" }),
      title: "T-0209",
    }),
  });
}
function renameTaskCommand() {
  const actorContext = metadata.actorContext({ actor: create(UserIdSchema, { value: "t0209" }) });
  return SignalEnvelopes.command({
    id: metadata.commandId("t0209-rename"),
    context: metadata.commandContext({ actorContext }),
    schema: RenameTaskSchema,
    message: create(RenameTaskSchema, {
      id: create(TaskIdSchema, { value: "t0209-task" }),
      title: "Drained",
    }),
  });
}

/**
 * A fixture-local Delivery listener assembled from the production RPC handlers.
 * It gates one real Inbox read after arming, keeping normal remote Delivery work
 * active without proxying application signals through test orchestration.
 */
class GatedDeliveryListener {
  readonly #assembly = DeliveryAssembly.create();
  readonly #sessions = new Set<http2.ServerHttp2Session>();
  readonly #entered = deferred<undefined>();
  readonly #released = deferred<undefined>();
  #armed = false;
  #server: http2.Http2Server | undefined;
  #port: number | undefined;

  get baseUrl(): string {
    if (this.#port === undefined) throw new Error("Gated Delivery listener has not started.");
    return `http://127.0.0.1:${String(this.#port)}`;
  }

  get entered(): Promise<undefined> {
    return this.#entered.promise;
  }

  arm(): void {
    this.#armed = true;
  }

  release(): void {
    this.#released.resolve(undefined);
  }

  async start(): Promise<this> {
    const inbox: ServiceImpl<typeof InboxService> = {
      ...this.#assembly.inbox,
      findManyInShard: async (request, context) => {
        if (this.#armed) {
          this.#armed = false;
          this.#entered.resolve(undefined);
          await this.#released.promise;
        }
        return this.#assembly.inbox.findManyInShard(request, context);
      },
    };
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          router.service(InboxService, inbox);
          router.service(ShardService, this.#assembly.shards);
          router.service(AdminService, this.#assembly.admin);
        },
      }),
    );
    server.on("session", (session) => {
      this.#sessions.add(session);
      session.on("close", () => this.#sessions.delete(session));
    });
    this.#server = server;
    this.#port = await listen(server);
    return this;
  }

  async close(): Promise<void> {
    this.release();
    this.#assembly.closeAdmission();
    this.#assembly.closeAdmin();
    for (const session of this.#sessions) session.close();
    const server = this.#server;
    if (server?.listening) await closeListener(server);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function listen(server: http2.Http2Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const done = () => {
      server.off("error", fail);
      server.off("listening", ready);
    };
    const fail = (error: Error) => {
      done();
      reject(error);
    };
    const ready = () => {
      done();
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", fail);
    server.once("listening", ready);
    server.listen(0, "127.0.0.1");
  });
}

function closeListener(server: http2.Http2Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
