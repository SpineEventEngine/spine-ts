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
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import { SignalEnvelopes } from "@spine-event-engine/core";
import {
  AdminService,
  InboxService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  CommandService,
  SubscriptionService,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { CreateTaskSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/dist/generated/spine/examples/todo/task_id_pb.js";
import { DeliveryAssembly } from "../../../delivery-server/src/server/assembly.js";
import { SignalMetadata } from "../../src/index.js";
import { afterEach, expect, it } from "vitest";

const childPath = fileURLToPath(
  new URL("./managed-external-events-application.mjs", import.meta.url),
);
const children = new Set<ChildProcess>();
const deliveries = new Set<DeliveryListener>();
const triggerDirectories = new Set<string>();
const metadata = new SignalMetadata();

afterEach(async () => {
  await Promise.all([...children].map(stop));
  children.clear();
  await Promise.all([...deliveries].map((delivery) => delivery.close()));
  deliveries.clear();
  await Promise.all(
    [...triggerDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  triggerDirectories.clear();
});

it(
  "RED-17/18/29 delivers domestic Todo Events through local brokers and " +
    "Delivery-backed external state subscriptions",
  async () => {
    const source = await readFile(childPath, "utf8");
    expect(source).toContain("createTodoContext");
    expect(source).toContain('origin: "external"');
    expect(source).not.toMatch(
      /ZeroMQ|SignalTransport|ContextTransport|RuntimeTransportBinding|ExternalMessage|forwarder/iu,
    );

    const { child, endpoint } = await start();
    const transport = createGrpcTransport({ baseUrl: endpoint });
    const subscriptions = createClient(SubscriptionService, transport);
    const subscription = await subscriptions.subscribe(externalStateTopic());
    const updates = subscriptions.activate(subscription)[Symbol.asyncIterator]();
    const commands = createClient(CommandService, transport);

    await bounded(commands.post(createTaskCommand("t0210-domestic-one")), "first domestic command");
    await expect(bounded(updates.next(), "first external state update")).resolves.toMatchObject({
      done: false,
    });
    await bounded(
      commands.post(createTaskCommand("t0210-domestic-two")),
      "second domestic command",
    );
    await expect(bounded(updates.next(), "second external state update")).resolves.toMatchObject({
      done: false,
    });

    expect(child.connected).toBe(true);
  },
  20_000,
);

it(
  "RED-19 imports a ThirdParty Event through the local broker and reaches the same " +
    "Delivery-backed subscription",
  async () => {
    const { directory, endpoint } = await start();
    const transport = createGrpcTransport({ baseUrl: endpoint });
    const subscriptions = createClient(SubscriptionService, transport);
    const subscription = await subscriptions.subscribe(externalStateTopic());
    const updates = subscriptions.activate(subscription)[Symbol.asyncIterator]();

    await writeFile(join(directory, "third-party-request"), "");
    await expect(
      bounded(updates.next(), "third-party external state update"),
    ).resolves.toMatchObject({
      done: false,
    });
  },
  20_000,
);

async function start(): Promise<{
  readonly child: ChildProcess;
  readonly directory: string;
  readonly endpoint: string;
}> {
  const delivery = await new DeliveryListener().start();
  deliveries.add(delivery);
  const directory = await mkdtemp(join(tmpdir(), "spine-t0210-third-party-"));
  triggerDirectories.add(directory);
  const child = fork(childPath, [], {
    env: {
      ...process.env,
      SPINE_MANAGED_REMOTE_DELIVERY_URL: delivery.baseUrl,
      SPINE_T0210_THIRD_PARTY_DIRECTORY: directory,
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.add(child);
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  const ready = await receive(child, "managed-ready");
  expect(ready.members).toHaveLength(2);
  return { child, directory, endpoint: String(ready.endpoint) };
}

function externalStateTopic() {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t0210-external-state" }),
    target: create(TargetSchema, {
      type: "type.googleapis.com/ProjectionState",
      criterion: { case: "includeAll", value: true },
    }),
    context: metadata.actorContext({ actor: create(UserIdSchema, { value: "t0210" }) }),
  });
}

function createTaskCommand(taskId: string) {
  const actorContext = metadata.actorContext({ actor: create(UserIdSchema, { value: "t0210" }) });
  return SignalEnvelopes.command({
    id: metadata.commandId(taskId),
    context: metadata.commandContext({ actorContext }),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
      taskListId: create(TaskListIdSchema, { value: "t0210-task-list" }),
      title: taskId,
    }),
  });
}

function receive(child: ChildProcess, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      finish(new Error(`Managed fixture ${type} timed out: ${stderr}`));
    }, 10_000);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        new Error(
          `Managed fixture exited before ${type}: ${String(code)}/${String(signal)}: ${stderr}`,
        ),
      );
    };
    const onMessage = (value: unknown) => {
      if (
        typeof value === "object" &&
        value !== null &&
        (value as { type?: unknown }).type === type
      )
        finish(undefined, value as Record<string, unknown>);
    };
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("message", onMessage);
      if (error !== undefined) reject(error);
      else if (value !== undefined) resolve(value);
      else reject(new Error("Managed fixture frame was missing."));
    };
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}

class DeliveryListener {
  readonly #assembly = DeliveryAssembly.create();
  readonly #sessions = new Set<http2.ServerHttp2Session>();
  #server: http2.Http2Server | undefined;
  #port: number | undefined;

  get baseUrl(): string {
    if (this.#port === undefined) throw new Error("Delivery listener is not started.");
    return `http://127.0.0.1:${String(this.#port)}`;
  }

  async start(): Promise<this> {
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          router.service(InboxService, this.#assembly.inbox);
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
    this.#assembly.closeAdmission();
    this.#assembly.closeAdmin();
    for (const session of this.#sessions) session.close();
    if (this.#server?.listening)
      await new Promise<void>((resolve) => {
        this.#server?.close(() => {
          resolve();
        });
      });
  }
}

function listen(server: http2.Http2Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

function bounded<T>(work: Promise<T>, description: string, timeout = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${description} timed out.`));
      }, timeout);
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}
