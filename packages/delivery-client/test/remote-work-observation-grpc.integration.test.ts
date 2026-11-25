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

import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { Identifiers, TypeUrls } from "@spine-event-engine/core";
import { ProjectStateSchema } from "@spine-event-engine/server-test-fixtures/entity/project_states_pb.js";
import { ShardIndex, UniformAcrossAllShards } from "@spine-event-engine/server";
import { DeliveryClient, RemoteDelivery } from "../src/index.js";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const servers: DeliveryServer[] = [];
const applications = new Set<ChildProcess>();
const clients: DeliveryClient[] = [];
const deliveries: RemoteDelivery[] = [];
const applicationFixture = resolve(
  "packages/delivery-client/test-fixtures/remote-environment-app.mjs",
);

afterEach(async () => {
  const failures: unknown[] = [];
  for (const child of applications) {
    try {
      await stop(child);
    } catch (error) {
      failures.push(error);
    }
  }
  applications.clear();
  for (const client of clients.splice(0)) {
    try {
      client.close();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const delivery of deliveries.splice(0)) {
    try {
      await delivery.close();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const server of servers.splice(0)) {
    try {
      await server.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Fixture cleanup failed.");
});

it("fences an expired blocked owner before its delayed commit can disturb a replacement", async () => {
  const server = trackedServer();
  await server.start();
  const alpha = application(server.baseUrl, "alpha");
  const beta = application(server.baseUrl, "beta");
  const events: { readonly node: string; readonly signalId: string }[] = [];
  for (const child of [alpha, beta])
    child.on("message", (frame: unknown) => {
      if (isDispatch(frame)) events.push(frame);
    });
  await Promise.all([ready(alpha), ready(beta)]);
  await Promise.all([
    command(alpha, { command: "block-first" }),
    command(beta, { command: "block-first" }),
  ]);
  await command(alpha, { command: "write", signalId: "first" });
  await eventually(() => {
    expect(events.filter((event) => event.signalId === "first-started")).toHaveLength(1);
  });
  const owner = events.find((event) => event.signalId === "first-started")?.node;
  const replacement = owner === "alpha" ? beta : alpha;
  await command(replacement, { command: "release-first" });
  const admin = DeliveryClient.connectTo(server.baseUrl);
  clients.push(admin);
  await eventuallyAsync(async () => {
    await expect(admin.releaseExpired(1)).resolves.toHaveLength(1);
  });
  await command(replacement, { command: "write", signalId: "wake" });
  await eventually(() => {
    expect(
      events.filter((event) => event.node !== owner && event.signalId === "committed-first"),
    ).toHaveLength(1);
  });
  await Promise.all([
    command(alpha, { command: "release-first" }),
    command(beta, { command: "release-first" }),
  ]);
  await eventually(() => {
    expect(
      events.filter((event) => event.node === owner && event.signalId === "resumed-first"),
    ).toHaveLength(1);
    if (!events.some((event) => event.node === owner && event.signalId === "fenced"))
      throw new Error(`Missing owner fence event: ${JSON.stringify(events)}`);
  });
  expect(
    events.filter((event) => event.node === owner && event.signalId === "committed-first"),
  ).toHaveLength(0);
  expect(replacement.exitCode).toBeNull();
  const reader = DeliveryClient.connectTo(server.baseUrl);
  clients.push(reader);
  await eventuallyAsync(async () => {
    expect(await reader.newestPending(ShardIndex.single())).toBeUndefined();
    expect((await reader.shardSnapshot())[0]?.status).toBe("NOT_PICKED");
  });
  expect(alpha.exitCode).toBeNull();
  expect(beta.exitCode).toBeNull();
}, 10_000);

it("fans out one real work notice through two remote ServerEnvironment assemblies", async () => {
  const server = trackedServer();
  await server.start();
  const alpha = application(server.baseUrl, "alpha");
  const beta = application(server.baseUrl, "beta");
  const deliveries: { readonly node: string; readonly signalId: string }[] = [];
  for (const child of [alpha, beta])
    child.on("message", (frame: unknown) => {
      if (isDispatch(frame)) deliveries.push(frame);
    });
  await Promise.all([ready(alpha), ready(beta)]);

  await Promise.all([
    command(alpha, { command: "block-first" }),
    command(beta, { command: "block-first" }),
  ]);
  await command(alpha, { command: "write", signalId: "first" });
  await eventually(() => {
    expect(deliveries.filter((delivery) => delivery.signalId === "first-started")).toHaveLength(1);
  });
  await command(beta, { command: "write", signalId: "during-drain" });
  await Promise.all([
    command(alpha, { command: "release-first" }),
    command(beta, { command: "release-first" }),
  ]);
  await eventually(() => {
    expect(deliveries.filter((delivery) => delivery.signalId === "during-drain")).toHaveLength(1);
  });
  expect(deliveries.filter((delivery) => delivery.signalId === "first")).toHaveLength(1);
  expect(deliveries.filter((delivery) => delivery.signalId === "during-drain")).toHaveLength(1);
  const reader = DeliveryClient.connectTo(server.baseUrl);
  clients.push(reader);
  await eventuallyAsync(async () => {
    expect(await reader.newestPending(ShardIndex.single())).toBeUndefined();
    expect((await reader.shardSnapshot())[0]?.status).toBe("NOT_PICKED");
  });
});

it("lets a third identical replica discover old free work before the reminder", async () => {
  const server = trackedServer();
  await server.start();
  const settings = { DELIVERY_SHARDS: "3", DELIVERY_MAX_CONCURRENT: "1" };
  const east = application(server.baseUrl, "east", settings);
  const west = application(server.baseUrl, "west", settings);
  const events: { readonly node: string; readonly signalId: string }[] = [];
  for (const child of [east, west])
    child.on("message", (frame: unknown) => {
      if (isDispatch(frame)) events.push(frame);
    });
  await Promise.all([ready(east), ready(west)]);
  await Promise.all([
    command(east, { command: "block-first" }),
    command(west, { command: "block-first" }),
  ]);
  const eastId = routedId("first-east", 0, 3);
  const westId = routedId("first-west", 1, 3);
  const northId = routedId("waiting-north", 2, 3);
  await command(east, { command: "write", signalId: eastId, shardIndex: 0 });
  await eventually(() => {
    expect(events.filter((event) => event.signalId === `${eastId}-started`)).toHaveLength(1);
  });
  await command(west, { command: "write", signalId: westId, shardIndex: 1 });
  await eventually(() => {
    expect(events.filter((event) => event.signalId === `${westId}-started`)).toHaveLength(1);
  });
  expect(events.find((event) => event.signalId === `${eastId}-started`)?.node).not.toBe(
    events.find((event) => event.signalId === `${westId}-started`)?.node,
  );

  await command(east, { command: "write", signalId: northId, shardIndex: 2 });
  expect(events.filter((event) => event.signalId === northId)).toHaveLength(0);
  const north = application(server.baseUrl, "north", settings);
  north.on("message", (frame: unknown) => {
    if (isDispatch(frame)) events.push(frame);
  });
  const joinedAt = Date.now();
  await ready(north);
  await eventually(() => {
    const matching = events.filter((event) => event.signalId === northId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ node: "north", signalId: northId });
  });
  expect(Date.now() - joinedAt).toBeLessThan(10_000);

  await Promise.all([
    command(east, { command: "release-first" }),
    command(west, { command: "release-first" }),
  ]);
  const reader = DeliveryClient.connectTo(server.baseUrl);
  clients.push(reader);
  await eventuallyAsync(async () => {
    for (let index = 0; index < 3; index += 1) {
      expect(await reader.newestPending(new ShardIndex(index, 3))).toBeUndefined();
    }
    expect((await reader.shardSnapshot()).every((shard) => shard.status === "NOT_PICKED")).toBe(
      true,
    );
  });
}, 15_000);

it("accepts a server reminder after a full-cap work notice was dropped", async () => {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0, workReminderSeconds: 1 });
  servers.push(server);
  await server.start();
  const child = application(server.baseUrl, "capped", {
    DELIVERY_SHARDS: "2",
    DELIVERY_MAX_CONCURRENT: "1",
  });
  const events: { readonly node: string; readonly signalId: string; readonly at: number }[] = [];
  child.on("message", (frame: unknown) => {
    if (isDispatch(frame)) events.push({ ...frame, at: Date.now() });
  });
  await ready(child);
  await command(child, { command: "block-first" });
  const first = routedId("first-held", 0, 2);
  const second = routedId("reminder", 1, 2);
  await command(child, { command: "write", signalId: first, shardIndex: 0 });
  await eventually(() => {
    expect(events.filter((event) => event.signalId === `${first}-started`)).toHaveLength(1);
  });
  await command(child, { command: "write", signalId: second, shardIndex: 1 });
  await eventuallyAsync(async () => {
    const evidence = await command(child, { command: "source-evidence" });
    if (!isSourceEvidence(evidence) || evidence.notices < 2)
      throw new Error("Initial available-shard notice was not read.");
  });
  expect(events.filter((event) => event.signalId === second)).toHaveLength(0);
  await command(child, { command: "release-first" });
  await eventually(() => {
    expect(events.filter((event) => event.signalId === second)).toHaveLength(1);
  });
  const reader = DeliveryClient.connectTo(server.baseUrl);
  clients.push(reader);
  await eventuallyAsync(async () => {
    expect(await reader.newestPending(new ShardIndex(1, 2))).toBeUndefined();
    expect((await reader.shardSnapshot()).every((shard) => shard.status === "NOT_PICKED")).toBe(
      true,
    );
  });
}, 10_000);

it("rediscovers work after reconnecting to the same endpoint", async () => {
  const server = trackedServer();
  await server.start();
  const endpoint = server.baseUrl;
  const alpha = application(endpoint, "alpha");
  const beta = application(endpoint, "beta");
  const deliveries: { readonly node: string; readonly signalId: string }[] = [];
  for (const child of [alpha, beta])
    child.on("message", (frame: unknown) => {
      if (isDispatch(frame)) deliveries.push(frame);
    });
  await Promise.all([ready(alpha), ready(beta)]);

  await server.close();
  await eventuallyAsync(async () => {
    await expect(command(alpha, { command: "write", signalId: "while-down" })).rejects.toThrow();
  });
  const replacement = trackedServer(server.port);
  await replacement.start();
  expect(replacement.baseUrl).toBe(endpoint);

  await command(alpha, { command: "write", signalId: "after-restart" });
  await eventually(() => {
    expect(deliveries.filter((delivery) => delivery.signalId === "after-restart")).toHaveLength(1);
  });
  const reader = DeliveryClient.connectTo(endpoint);
  clients.push(reader);
  await eventuallyAsync(async () => {
    expect(await reader.newestPending(ShardIndex.single())).toBeUndefined();
    expect((await reader.shardSnapshot())[0]?.status).toBe("NOT_PICKED");
  });
  expect(alpha.exitCode).toBeNull();
  expect(beta.exitCode).toBeNull();
}, 15_000);

it("continues remote work after a reader pauses through several pending writes", async () => {
  const server = trackedServer();
  await server.start();
  const alpha = application(server.baseUrl, "alpha");
  const beta = application(server.baseUrl, "beta");
  const dispatched: { readonly node: string; readonly signalId: string }[] = [];
  for (const child of [alpha, beta])
    child.on("message", (frame: unknown) => {
      if (isDispatch(frame)) dispatched.push(frame);
    });
  await Promise.all([ready(alpha), ready(beta)]);
  await Promise.all([
    command(alpha, { command: "block-first" }),
    command(beta, { command: "block-first" }),
  ]);

  await command(alpha, { command: "write", signalId: "first" });
  await eventually(() => {
    expect(dispatched.filter((event) => event.signalId === "first-started")).toHaveLength(1);
  });
  await command(alpha, { command: "hold-source" });

  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      command(index % 2 === 0 ? alpha : beta, {
        command: "write",
        signalId: `overflow-${String(index)}`,
      }),
    ),
  );
  await command(alpha, { command: "release-source" });
  await eventuallyAsync(async () => {
    const evidence = await command(alpha, { command: "source-evidence" });
    if (!isSourceEvidence(evidence) || evidence.watches < 1)
      throw new Error(`Work stream did not start: ${JSON.stringify(evidence)}`);
  });

  await Promise.all([
    command(alpha, { command: "release-first" }),
    command(beta, { command: "release-first" }),
  ]);
  await eventually(() => {
    for (let index = 0; index < 12; index += 1)
      expect(
        dispatched.filter((event) => event.signalId === `overflow-${String(index)}`),
      ).toHaveLength(1);
  });
  const reader = DeliveryClient.connectTo(server.baseUrl);
  clients.push(reader);
  await eventuallyAsync(async () => {
    expect(await reader.newestPending(ShardIndex.single())).toBeUndefined();
    expect((await reader.shardSnapshot())[0]?.status).toBe("NOT_PICKED");
  });
}, 15_000);

it("forces a child that ignores graceful shutdown and settles its forced exit", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "setInterval(() => undefined, 1000); process.on('SIGTERM', () => undefined); process.send?.({ type: 'ready' })",
    ],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  applications.add(child);
  await ready(child);

  await expect(stop(child, 10)).resolves.toBeUndefined();
  expect(child.signalCode).toBe("SIGKILL");
});

function trackedServer(port = 0): DeliveryServer {
  const server = new DeliveryServer({ host: "127.0.0.1", port });
  servers.push(server);
  return server;
}

function routedId(prefix: string, index: number, total: number): string {
  const strategy = UniformAcrossAllShards.forNumber(total);
  const type = TypeUrls.derive(ProjectStateSchema);
  for (let suffix = 0; ; suffix += 1) {
    const id = `${prefix}-${String(suffix)}`;
    if (strategy.shardFor(Identifiers.pack("string", id), type).index === index) return id;
  }
}

function application(
  baseUrl: string,
  node: string,
  environment: Readonly<Record<string, string>> = {},
): ChildProcess {
  const child = spawn(process.execPath, [applicationFixture], {
    env: { ...process.env, DELIVERY_SERVER_URL: baseUrl, DELIVERY_NODE: node, ...environment },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  applications.add(child);
  return child;
}

function ready(child: ChildProcess): Promise<void> {
  return receive(child, "ready").then(() => undefined);
}

function command(
  child: ChildProcess,
  request:
    | { readonly command: "write"; readonly signalId: string; readonly shardIndex?: number }
    | {
        readonly command:
          "block-first" | "release-first" | "hold-source" | "release-source" | "source-evidence";
      },
) {
  const id = crypto.randomUUID();
  const result = receive(child, "result", id);
  child.send({ id, ...request });
  return result;
}

function receive(child: ChildProcess, type: string, id?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error("Fixture response timed out."));
    }, 5_000);
    const onExit = () => {
      finish(new Error("Fixture process exited before response."));
    };
    const onMessage = (frame: unknown) => {
      if (!isRecord(frame) || frame.type !== type || (id !== undefined && frame.id !== id)) return;
      finish(undefined, frame);
    };
    const finish = (error?: Error, frame?: unknown) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("message", onMessage);
      if (error !== undefined) reject(error);
      else resolve(frame);
    };
    child.once("exit", onExit);
    child.on("message", onMessage);
  });
}

async function stop(
  child: ChildProcess,
  gracefulTimeoutMs = 5_000,
  forcedTimeoutMs = 5_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await exitWithin(child, gracefulTimeoutMs);
  } catch (gracefulFailure) {
    if (gracefulFailure instanceof FixtureExitError) throw gracefulFailure;
    const forcedExit = exitWithin(child, forcedTimeoutMs);
    child.kill("SIGKILL");
    try {
      await forcedExit;
    } catch (forcedFailure) {
      throw new AggregateError([gracefulFailure, forcedFailure], "Fixture shutdown failed.");
    }
  }
}

function exitWithin(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return child.exitCode === 0 || child.signalCode !== null
      ? Promise.resolve()
      : Promise.reject(new FixtureExitError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0 || signal !== null) finish();
      else finish(new FixtureExitError());
    };
    const timer = setTimeout(() => {
      finish(new Error("Fixture shutdown timed out."));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

class FixtureExitError extends Error {
  constructor() {
    super("Fixture process exited unsuccessfully.");
  }
}

function isDispatch(value: unknown): value is { readonly node: string; readonly signalId: string } {
  return (
    isRecord(value) &&
    value.type === "dispatched" &&
    typeof value.node === "string" &&
    typeof value.signalId === "string"
  );
}

function isSourceEvidence(
  value: unknown,
): value is { readonly watches: number; readonly failures: number; readonly notices: number } {
  return (
    isRecord(value) &&
    typeof value.watches === "number" &&
    typeof value.failures === "number" &&
    typeof value.notices === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

async function eventuallyAsync(assertion: () => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await assertion();
}
