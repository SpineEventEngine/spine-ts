import { DeliveryServer } from "../../delivery-server/src/index.js";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const servers: DeliveryServer[] = [];
const applications = new Set<ChildProcess>();
const applicationFixture = resolve("packages/delivery-client/test-fixtures/remote-environment-app.mjs");

afterEach(async () => {
  await Promise.all([...applications].map(stop));
  applications.clear();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

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

  await command(alpha, { command: "write", signalId: "first" });
  await eventually(() => {
    expect(deliveries.filter((delivery) => delivery.signalId === "first")).toHaveLength(1);
  });
  await command(beta, { command: "write", signalId: "during-drain" });
  await eventually(() => {
    expect(deliveries.filter((delivery) => delivery.signalId === "during-drain")).toHaveLength(1);
  });
  expect(deliveries).toHaveLength(2);
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

function command(child: ChildProcess, request: { readonly command: "write"; readonly signalId: string }) {
  const id = crypto.randomUUID();
  const result = receive(child, "result", id);
  child.send({ id, ...request });
  return result;
}

function receive(child: ChildProcess, type: string, id?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Fixture response timed out.")), 5_000);
    const onExit = () => finish(new Error("Fixture process exited before response."));
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
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}
