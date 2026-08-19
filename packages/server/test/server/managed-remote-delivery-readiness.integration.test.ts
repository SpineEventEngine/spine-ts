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
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
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
import { CreateTaskSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/dist/generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_list_pb.js";
import { DeliveryAssembly } from "../../../delivery-server/src/server/assembly.js";
import { afterEach, expect, it } from "vitest";

const children = new Set<ChildProcess>();
const deliveries = new Set<GatedDeliveryListener>();
const handlerGates = new Set<HandlerGate>();

afterEach(async () => {
  // Release either real Delivery gate before asking the managed parent to shut
  // down: a replacement can still be opening its initial snapshot.
  for (const delivery of deliveries) {
    delivery.release();
    delivery.releaseSnapshot();
  }
  await Promise.all([...handlerGates].map((gate) => gate.release()));
  const exits = [...children].map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  });
  await Promise.all(exits);
  children.clear();
  await Promise.all([...deliveries].map((delivery) => delivery.close()));
  deliveries.clear();
  await Promise.all([...handlerGates].map((gate) => gate.close()));
  handlerGates.clear();
});

it("RED-27/28 keeps the final managed subscription relay until fenced Delivery work drains", async () => {
  const delivery = await new GatedDeliveryListener().start();
  deliveries.add(delivery);
  const handlerGate = await HandlerGate.create();
  handlerGates.add(handlerGate);
  const child = fork(
    fileURLToPath(new URL("./managed-remote-delivery-application.mjs", import.meta.url)),
    [],
    {
      env: {
        ...process.env,
        SPINE_MANAGED_REMOTE_DELIVERY_URL: delivery.baseUrl,
        SPINE_MANAGED_HANDLER_GATE: handlerGate.directory,
      },
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
  await bounded(commands.post(createTaskCommand()), "initial command");
  await expect(bounded(iterator.next(), "initial update")).resolves.toMatchObject({ done: false });

  await handlerGate.arm();
  const nextUpdate = iterator.next();
  await bounded(
    commands.post(createTaskCommand("t0209-drain-create", "t0209-drain-task")),
    "drained command",
  );
  await handlerGate.entered();

  const drained = receive(child, "drained");
  const draining = receive(child, "draining");
  child.send({ type: "drain" });
  await draining;
  await expect(
    commands.post(createTaskCommand("t0209-after-drain", "t0209-after-drain-task")),
  ).rejects.toMatchObject({ code: Code.Unavailable });
  await expect(
    Promise.race([
      drained.then(() => "drained" as const),
      new Promise<"active">((resolve) => {
        setTimeout(() => {
          resolve("active");
        }, 1_100);
      }),
    ]),
  ).resolves.toBe("active");
  await handlerGate.release();
  await expect(bounded(nextUpdate, "drained update")).resolves.toMatchObject({ done: false });
  await drained;
  await expect(iterator.next()).resolves.toMatchObject({ done: true });
}, 20_000);

it("RED-28 holds a replacement outside managed admission until its remote snapshot opens", async () => {
  const delivery = await new GatedDeliveryListener().start();
  deliveries.add(delivery);
  const handlerGate = await HandlerGate.create();
  handlerGates.add(handlerGate);
  const child = fork(
    fileURLToPath(new URL("./managed-remote-delivery-application.mjs", import.meta.url)),
    [],
    {
      env: {
        ...process.env,
        SPINE_MANAGED_REMOTE_DELIVERY_URL: delivery.baseUrl,
        SPINE_MANAGED_HANDLER_GATE: handlerGate.directory,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  children.add(child);
  const ready = await receive(child, "managed-ready");
  const members = memberFacts(ready);
  const endpoint = String(ready.endpoint);
  const transport = createGrpcTransport({ baseUrl: endpoint });
  const subscriptions = createClient(SubscriptionService, transport);
  const subscription = await subscriptions.subscribe(taskListTopic());
  const iterator = subscriptions.activate(subscription)[Symbol.asyncIterator]();
  const commands = createClient(CommandService, transport);
  await bounded(commands.post(createTaskCommand()), "replacement initial command");
  await expect(bounded(iterator.next(), "replacement initial update")).resolves.toMatchObject({
    done: false,
  });

  const owner = await handlerGate.owner();
  const removed = members.find((member) => member.pid !== owner);
  if (removed === undefined) throw new Error("Managed fixture did not report an initial replica.");
  delivery.armSnapshot();
  process.kill(removed.pid, "SIGKILL");
  await expect.poll(() => currentMembers(child, "retired")).toHaveLength(1);
  const whileSnapshotHeld = await currentMembers(child, "retired-confirmed");
  expect(whileSnapshotHeld).toHaveLength(1);
  expect(whileSnapshotHeld[0]?.pid).not.toBe(removed.pid);
  await delivery.snapshotEntered;

  const nextUpdate = iterator.next();
  await bounded(
    commands.post(createTaskCommand("t0209-survivor", "t0209-survivor-task")),
    "survivor command",
  );
  await expect(bounded(nextUpdate, "survivor update")).resolves.toMatchObject({ done: false });
  delivery.releaseSnapshot();
  await expect.poll(() => currentMembers(child, "replacement"), { timeout: 2_000 }).toHaveLength(2);

  const afterRejoin = iterator.next();
  await bounded(
    commands.post(createTaskCommand("t0209-replacement", "t0209-replacement-task")),
    "replacement command",
  );
  await expect(bounded(afterRejoin, "replacement update")).resolves.toMatchObject({ done: false });
}, 20_000);

function receive(
  child: ChildProcess,
  type: string,
  description = type,
  matches: (value: Record<string, unknown>) => boolean = () => true,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      finish(new Error(`Managed fixture ${description} timed out: ${stderr}`));
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
      const frame = value as Record<string, unknown>;
      if (matches(frame)) finish(undefined, frame);
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

class HandlerGate {
  readonly #arm: string;
  readonly #entered: string;
  readonly #release: string;

  private constructor(readonly directory: string) {
    this.#arm = join(directory, "arm");
    this.#entered = join(directory, "entered");
    this.#release = join(directory, "release");
  }

  static async create(): Promise<HandlerGate> {
    return new HandlerGate(await mkdtemp(join(tmpdir(), "spine-t0209-handler-")));
  }

  async arm(): Promise<void> {
    await writeFile(this.#arm, "");
  }

  async entered(): Promise<void> {
    await expect.poll(() => fileExists(this.#entered), { timeout: 10_000 }).toBe(true);
  }

  async release(): Promise<void> {
    await writeFile(this.#release, "");
  }

  async owner(): Promise<number> {
    const owner = join(this.directory, "owner");
    await expect.poll(() => fileExists(owner), { timeout: 10_000 }).toBe(true);
    return Number(await readFile(owner, "utf8"));
  }

  async close(): Promise<void> {
    await this.release();
    await rm(this.directory, { recursive: true, force: true });
  }
}

async function fileExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function currentMembers(
  child: ChildProcess,
  requestId: string,
): Promise<readonly { readonly pid: number; readonly slot: number }[]> {
  const response = receive(
    child,
    "managed-members",
    `members ${requestId}`,
    (message) => message.requestId === requestId,
  );
  child.send({ type: "members", requestId });
  return memberFacts(await response);
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
function createTaskCommand(commandId = "t0209-create", taskId = "t0209-task") {
  const actorContext = metadata.actorContext({ actor: create(UserIdSchema, { value: "t0209" }) });
  return SignalEnvelopes.command({
    id: metadata.commandId(commandId),
    context: metadata.commandContext({ actorContext }),
    schema: CreateTaskSchema,
    message: create(CreateTaskSchema, {
      id: create(TaskIdSchema, { value: taskId }),
      taskListId: create(TaskListIdSchema, { value: "t0209-task" }),
      title: taskId,
    }),
  });
}

/**
 * A fixture-local Delivery listener assembled from the production RPC handlers.
 * It gates one real initial snapshot while keeping normal remote Delivery
 * traffic on the production service implementation.
 */
class GatedDeliveryListener {
  readonly #assembly = DeliveryAssembly.create();
  readonly #sessions = new Set<http2.ServerHttp2Session>();
  readonly #snapshotEntered = deferred<undefined>();
  readonly #snapshotReleased = deferred<undefined>();
  #snapshotArmed = false;
  #server: http2.Http2Server | undefined;
  #port: number | undefined;

  get baseUrl(): string {
    if (this.#port === undefined) throw new Error("Gated Delivery listener has not started.");
    return `http://127.0.0.1:${String(this.#port)}`;
  }

  get snapshotEntered(): Promise<undefined> {
    return this.#snapshotEntered.promise;
  }

  armSnapshot(): void {
    this.#snapshotArmed = true;
  }

  release(): void {
    // The handler gate owns active work. Delivery has no work gate to release.
  }

  releaseSnapshot(): void {
    this.#snapshotReleased.resolve(undefined);
  }

  async start(): Promise<this> {
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          router.service(InboxService, this.#assembly.inbox);
          router.service(ShardService, this.#assembly.shards);
          router.service(AdminService, {
            ...this.#assembly.admin,
            getShardInfo: async (request, context) => {
              if (this.#snapshotArmed) {
                this.#snapshotArmed = false;
                this.#snapshotEntered.resolve(undefined);
                await this.#snapshotReleased.promise;
              }
              return this.#assembly.admin.getShardInfo(request, context);
            },
          });
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
    this.releaseSnapshot();
    this.#assembly.closeAdmission();
    this.#assembly.closeAdmin();
    for (const session of this.#sessions) session.close();
    const server = this.#server;
    if (server?.listening) await closeListener(server);
  }
}

function memberFacts(
  message: Record<string, unknown>,
): readonly { readonly pid: number; readonly slot: number }[] {
  const members = message.members;
  if (!Array.isArray(members)) throw new Error("Managed fixture members were missing.");
  return members.map((member) => {
    if (
      typeof member !== "object" ||
      member === null ||
      typeof (member as { pid?: unknown }).pid !== "number" ||
      typeof (member as { slot?: unknown }).slot !== "number"
    )
      throw new Error("Managed fixture member was malformed.");
    return member as { readonly pid: number; readonly slot: number };
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function bounded<T>(work: Promise<T>, description: string, timeout = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${description} timed out.`));
    }, timeout);
  });
  return Promise.race([work, expired]).finally(() => {
    clearTimeout(timer);
  });
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
