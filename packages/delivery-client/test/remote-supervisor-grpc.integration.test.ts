import { DeliveryServer } from "../../delivery-server/src/index.js";
import { DeliveryClient, RemoteDelivery, ShardObservationOverflowError } from "../src/index.js";
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
}, 10_000);

it("fans out one real Admin shard update through two remote ServerEnvironment assemblies", async () => {
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
});

it("recovers work written immediately after a same-endpoint Admin restart through a complete snapshot", async () => {
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
  expect(alpha.exitCode).toBeNull();
  expect(beta.exitCode).toBeNull();
}, 15_000);

it("bounds a paused RemoteDelivery Admin source then lets an environment drain its retained work", async () => {
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

  const delivery = RemoteDelivery.connectTo({
    endpoint: server.baseUrl,
    removalQuarantine: memoryQuarantine(),
    clientOptions: { observationBufferSize: 1, observationReconnects: 0 },
  });
  deliveries.push(delivery);
  await delivery.open();
  const iterator = delivery.source.observeShardUpdates()[Symbol.asyncIterator]();
  const first = iterator.next();
  await command(alpha, { command: "write", signalId: "first" });
  await expect(first).resolves.toMatchObject({ done: false });
  await eventually(() => {
    expect(dispatched.filter((event) => event.signalId === "first-started")).toHaveLength(1);
  });

  await command(alpha, { command: "write", signalId: "overflow-a" });
  await command(beta, { command: "write", signalId: "overflow-b" });
  await eventuallyAsync(async () => {
    await expect(iterator.next()).rejects.toBeInstanceOf(ShardObservationOverflowError);
  });
  const snapshot = await delivery.source.shardSnapshot();
  expect(snapshot.some((shard) => shard.messages >= 0)).toBe(true);

  await Promise.all([
    command(alpha, { command: "release-first" }),
    command(beta, { command: "release-first" }),
  ]);
  await eventually(() => {
    expect(dispatched.filter((event) => event.signalId === "overflow-a")).toHaveLength(1);
    expect(dispatched.filter((event) => event.signalId === "overflow-b")).toHaveLength(1);
  });
}, 15_000);

function trackedServer(port = 0): DeliveryServer {
  const server = new DeliveryServer({ host: "127.0.0.1", port });
  servers.push(server);
  return server;
}

function memoryQuarantine() {
  const values = new Map();
  return {
    get: (id: string) => Promise.resolve(values.get(id)),
    put: (record: { readonly id: string }) => {
      values.set(record.id, record);
      return Promise.resolve();
    },
    delete: (id: string) => {
      values.delete(id);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
}

function application(baseUrl: string, node: string): ChildProcess {
  const child = spawn(process.execPath, [applicationFixture], {
    env: { ...process.env, DELIVERY_SERVER_URL: baseUrl, DELIVERY_NODE: node },
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
    | { readonly command: "write"; readonly signalId: string }
    | { readonly command: "block-first" | "release-first" },
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

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", resolve)),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Fixture shutdown timed out.")), 5_000),
    ),
  ]);
}

function isDispatch(value: unknown): value is { readonly node: string; readonly signalId: string } {
  return (
    isRecord(value) &&
    value.type === "dispatched" &&
    typeof value.node === "string" &&
    typeof value.signalId === "string"
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
