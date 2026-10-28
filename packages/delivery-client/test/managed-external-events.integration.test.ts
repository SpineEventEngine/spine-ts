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
import { access, mkdtemp, readFile, rm, watch, writeFile } from "node:fs/promises";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  AdminService,
  InboxService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import { UserIdSchema } from "@spine-event-engine/proto";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import {
  CommandService,
  SubscriptionService,
  type SubscriptionUpdate,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { CreateProjectSchema } from "@spine-event-engine/server-test-fixtures/entity/project_commands_pb.js";
import { ProjectOverviewStateSchema } from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";
import { DeliveryAssembly } from "@spine-event-engine/delivery-server/testing";
import { SignalMetadata } from "@spine-event-engine/server";
import { afterEach, expect, it } from "vitest";
import { RemoteDelivery } from "../src/index.js";
import { ShardIndex } from "@spine-event-engine/server";

const childPath = fileURLToPath(
  new URL("../test-fixtures/managed-external-events-application.mjs", import.meta.url),
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

it("resolves its managed-host access seam from private server test fixtures", async () => {
  const source = await readFile(childPath, "utf8");

  expect(source).toContain('from "@spine-event-engine/server-test-fixtures/internal"');
  expect(source).toContain('from "@spine-event-engine/server-test-fixtures/entity/');
});

it("starts concurrent managed fixtures on independent Coordinator ports", async () => {
  const [first, second] = await Promise.all([start(), start()]);

  expect(first.endpoint).not.toBe(second.endpoint);
  expect(first.child.connected).toBe(true);
  expect(second.child.connected).toBe(true);
}, 20_000);

it(
  "RED-17/18/29 delivers domestic Project Events through local brokers and " +
    "Delivery-backed external state subscriptions",
  async () => {
    const source = await readFile(childPath, "utf8");
    expect(source).toContain("createManagedProjectContext");
    expect(source).toContain('origin: "external"');
    expect(source).not.toMatch(/ExternalMessage|forwarder/iu);

    const { child, endpoint } = await start();
    const transport = createGrpcTransport({ baseUrl: endpoint });
    const subscriptions = createClient(SubscriptionService, transport);
    const subscription = await subscriptions.subscribe(externalStateTopic());
    // The generated stream iterator leaves its return value as `any`; the tests check `done`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const updates: AsyncIterator<SubscriptionUpdate, void> = subscriptions
      .activate(subscription)
      [Symbol.asyncIterator]();
    const commands = createClient(CommandService, transport);
    await expectActivationAck(updates);

    await bounded(
      commands.post(createProjectCommand("t0210-domestic-one")),
      "first domestic command",
    );
    const first = await bounded(updates.next(), "first external state update");
    if (first.done) throw new Error("First external Project update was missing.");
    expect(externalState(first.value)).toEqual({
      id: "t0210-domestic-one",
      name: "external:t0210-domestic-one",
    });
    await bounded(
      commands.post(createProjectCommand("t0210-domestic-two")),
      "second domestic command",
    );
    const second = await bounded(updates.next(), "second external state update");
    if (second.done) throw new Error("Second external Project update was missing.");
    expect(externalState(second.value)).toEqual({
      id: "t0210-domestic-two",
      name: "external:t0210-domestic-two",
    });

    expect(child.connected).toBe(true);
  },
  20_000,
);

it(
  "RED-19 imports a ThirdParty Event through the local broker and reaches the same " +
    "Delivery-backed subscription",
  async () => {
    const { directory, endpoint, delivery } = await start();
    const transport = createGrpcTransport({ baseUrl: endpoint });
    const subscriptions = createClient(SubscriptionService, transport);
    const subscription = await subscriptions.subscribe(externalStateTopic());
    // The generated stream iterator leaves its return value as `any`; the tests check `done`.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const updates: AsyncIterator<SubscriptionUpdate, void> = subscriptions
      .activate(subscription)
      [Symbol.asyncIterator]();
    await expectActivationAck(updates);

    const holder = RemoteDelivery.connectTo({ endpoint: delivery.baseUrl });
    await holder.open();
    const held = await holder.workRegistry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "test-process" }, value: "third-party-held" }),
    );
    if (held === undefined) throw new Error("Expected the remote shard to be available.");
    try {
      const completed = fileAppears(directory, "third-party-complete");
      await writeFile(join(directory, "third-party-request"), "");
      await bounded(completed, "remote ThirdParty reception completion");
      const pending = await holder.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] });
      expect(pending).toHaveLength(1);
      expect(typeof pending[0]?.signalId).toBe("string");
    } finally {
      await holder.workRegistry.release(held);
      await holder.close();
    }
    const thirdParty = await bounded(updates.next(), "third-party external state update");
    if (thirdParty.done) throw new Error("ThirdParty Project update was missing.");
    expect(externalState(thirdParty.value)).toEqual({
      id: "t0210-third-party",
      name: "external:t0210-third-party",
    });
  },
  20_000,
);

async function expectActivationAck(
  updates: AsyncIterator<SubscriptionUpdate, void>,
): Promise<void> {
  const acknowledgement = await bounded(updates.next(), "external subscription activation ACK");
  if (acknowledgement.done) throw new Error("External activation ended before its ACK.");
  expect(acknowledgement.value.response?.status?.status.case).toBe("ok");
  expect(acknowledgement.value.update.case).toBeUndefined();
}

function externalState(update: SubscriptionUpdate): { id: string; name: string } | undefined {
  if (update.update.case !== "entityUpdates") return undefined;
  const state = update.update.value.update[0]?.kind;
  if (state?.case !== "state") return undefined;
  if (state.value.typeUrl !== TypeUrls.derive(ProjectOverviewStateSchema)) return undefined;
  const decoded = AnyPacker.unpack(state.value, ProjectOverviewStateSchema);
  return { id: decoded.id, name: decoded.name };
}

async function start(): Promise<{
  readonly child: ChildProcess;
  readonly delivery: DeliveryListener;
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
  return { child, delivery, directory, endpoint: String(ready.endpoint) };
}

async function fileAppears(directory: string, name: string): Promise<void> {
  const pending = watch(directory);
  try {
    try {
      await access(join(directory, name));
      return;
    } catch {
      for await (const event of pending) if (event.filename === name) return;
    }
  } finally {
    if (pending.return !== undefined) await pending.return();
  }
}

function externalStateTopic() {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t0210-external-state" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(ProjectOverviewStateSchema),
      criterion: { case: "includeAll", value: true },
    }),
    context: metadata.actorContext({ actor: create(UserIdSchema, { value: "t0210" }) }),
  });
}

function createProjectCommand(projectId: string) {
  const actorContext = metadata.actorContext({ actor: create(UserIdSchema, { value: "t0210" }) });
  return SignalEnvelopes.command({
    context: metadata.commandContext({ actorContext }),
    schema: CreateProjectSchema,
    message: create(CreateProjectSchema, {
      id: projectId,
      name: projectId,
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
