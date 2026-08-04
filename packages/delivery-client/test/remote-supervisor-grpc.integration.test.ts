import { DeliveryServer } from "../../delivery-server/src/index.js";
import { DeliveryClient } from "../src/index.js";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const servers: DeliveryServer[] = [];
const applications = new Set<ChildProcess>();
const clients: DeliveryClient[] = [];
const applicationFixture = resolve(
  "packages/delivery-client/test-fixtures/remote-environment-app.mjs",
);

afterEach(async () => {
  await Promise.all([...applications].map(stop));
  applications.clear();
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
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

function trackedServer(): DeliveryServer {
  const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
  servers.push(server);
  return server;
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
  await new Promise<void>((resolve) =>
    child.once("exit", () => {
      resolve();
    }),
  );
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
