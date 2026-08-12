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
import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  AdminService,
  Health,
  HealthCheckRequestSchema,
  HealthCheckResponse_ServingStatus,
  ShardStatus,
} from "@spine-event-engine/proto/delivery-server";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error The executable JavaScript fixture intentionally has no public declarations.
import { controlFrame } from "../../test-fixtures/multi-machine-app.mjs";
// @ts-expect-error The executable JavaScript fixture intentionally has no public declarations.
import { createMultiMachineApplication } from "../../test-fixtures/multi-machine-app.mjs";

const serverExecutable = resolve("packages/delivery-server/dist/bin/spine-delivery-server.js");
const appFixture = resolve("packages/delivery-client/test-fixtures/multi-machine-app.mjs");
const IPC_TIMEOUT_MS = 1_000;
const STALE_MS = 1_000;
const STALE_TOLERANCE_MS = 100;
const TAKEOVER_DEADLINE_MS = 5_000;
let activeCoordinationTimers = 0;

describe("TS-to-TS multi-machine delivery", () => {
  const resources = new Set<ChildProcess>();

  afterEach(async () => {
    await Promise.all([...resources].map(stop));
    resources.clear();
  });

  it("coordinates isolated applications through public package roots and generated descriptors", async () => {
    let primary: unknown;
    let server: ChildProcess | undefined;
    let alpha: ChildProcess | undefined;
    let beta: ChildProcess | undefined;
    let adminSessions: Http2SessionManager | undefined;
    let healthSessions: Http2SessionManager | undefined;
    let observation: Promise<void> | undefined;
    let streamFailure: unknown;
    let closingAdmin = false;
    let terminalHealth: (() => Promise<void>) | undefined;
    const updates: unknown[] = [];
    try {
      expect(createMultiMachineApplication).toBeTypeOf("function");
      server = spawn(process.execPath, [serverExecutable], {
        env: { ...process.env, PORT: "0", SHARD_PROCESSING_TIMEOUT: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      resources.add(server);
      const baseUrl = await readiness(server);
      adminSessions = new Http2SessionManager(baseUrl);
      healthSessions = new Http2SessionManager(baseUrl);
      const admin = createClient(
        AdminService,
        createGrpcTransport({ baseUrl, sessionManager: adminSessions }),
      );
      const health = createClient(
        Health,
        createGrpcTransport({ baseUrl, sessionManager: healthSessions }),
      );
      terminalHealth = async () => {
        await expect(health.check(create(HealthCheckRequestSchema))).rejects.toThrow();
      };
      observation = (async () => {
        for await (const frame of admin.subscribeToShardUpdates(create(EmptySchema))) {
          if (updates.length === 21) throw new Error("Admin frame collection overflow.");
          updates.push(frame);
        }
      })().catch((error: unknown) => {
        if (!closingAdmin) streamFailure = error;
      });
      await eventually(() => {
        rejectStream(streamFailure);
        expect(updates).toHaveLength(1);
      });
      expect(created(updates[0])).toBe(true);
      await expect(admin.getShardInfo(create(EmptySchema))).resolves.toMatchObject({ shards: [] });
      for (const service of ["", "spine.delivery.InboxService"]) {
        await expect(
          health.check(create(HealthCheckRequestSchema, { service })),
        ).resolves.toMatchObject({
          status: HealthCheckResponse_ServingStatus.SERVING,
        });
      }
      await expect(
        health.check(create(HealthCheckRequestSchema, { service: "unknown" })),
      ).resolves.toMatchObject({ status: HealthCheckResponse_ServingStatus.NOT_SERVING });

      alpha = app(baseUrl, "alpha");
      beta = app(baseUrl, "beta");
      resources.add(alpha);
      resources.add(beta);
      await Promise.all([ready(alpha), ready(beta)]);
      const dispatched: {
        readonly signalId: string;
        readonly node: string;
        readonly at: number;
      }[] = [];
      for (const child of [alpha, beta])
        child.on("message", (frame) => {
          const message = dispatchedFrame(frame);
          if (message !== undefined) dispatched.push(message);
        });
      const pickups = await Promise.all([
        command(alpha, { command: "pickUp" }),
        command(beta, { command: "pickUp" }),
      ]);
      expect(pickups.filter(Boolean)).toHaveLength(1);
      const owner = pickups[0] ? alpha : beta;
      await expect(command(owner, { command: "release" })).resolves.toBe(true);
      await adminBarrier(updates, ["PICKED/0", "NOT_PICKED/0"], () => streamFailure);
      await Promise.all([
        command(alpha, { command: "start" }),
        command(beta, { command: "start" }),
      ]);
      await command(alpha, { command: "write", signalId: "alpha" });
      await eventually(() => {
        expect(dispatched.filter((frame) => frame.signalId === "alpha")).toHaveLength(1);
      });
      await adminBarrier(updates, ordinaryThrough("alpha"), () => streamFailure);
      await command(beta, { command: "write", signalId: "beta" });
      await eventually(() => {
        expect(dispatched.filter((frame) => frame.signalId === "beta")).toHaveLength(1);
      });
      await adminBarrier(updates, ordinaryThrough("beta"), () => streamFailure);
      expect(dispatched.filter((frame) => frame.signalId === "alpha")).toHaveLength(1);
      expect(dispatched.filter((frame) => frame.signalId === "beta")).toHaveLength(1);

      await Promise.all([
        command(alpha, { command: "armStall" }),
        command(beta, { command: "armStall" }),
      ]);
      await command(alpha, { command: "write", signalId: "stall" });
      await eventually(() => {
        expect(dispatched.filter((frame) => frame.signalId === "stall")).toHaveLength(1);
      });
      const stalled = dispatched.find((frame) => frame.signalId === "stall");
      if (stalled === undefined) throw new Error("Stalled delivery owner is missing.");
      const killed = stalled.node === "alpha" ? alpha : beta;
      const survivor = killed === alpha ? beta : alpha;
      await command(survivor, { command: "disarmStall" });
      await delay(500);
      expect(
        dispatched.filter((frame) => frame.signalId === "stall" && frame.node !== stalled.node),
      ).toHaveLength(0);
      killed.kill("SIGKILL");
      await once(killed, "exit");
      await eventually(() => {
        expect(
          dispatched.filter((frame) => frame.signalId === "stall" && frame.node !== stalled.node),
        ).toHaveLength(1);
      });
      const takeover = dispatched.find(
        (frame) => frame.signalId === "stall" && frame.node !== stalled.node,
      );
      if (takeover === undefined) throw new Error("Stale takeover dispatch is missing.");
      const takeoverElapsed = takeover.at - stalled.at;
      expect(takeoverElapsed).toBeGreaterThanOrEqual(STALE_MS - STALE_TOLERANCE_MS);
      expect(takeoverElapsed).toBeLessThan(TAKEOVER_DEADLINE_MS);
      await adminBarrier(updates, takeoverThrough(), () => streamFailure);
      await command(survivor, { command: "replace" });
      await command(survivor, { command: "write", signalId: "final" });
      await eventually(() => {
        expect(dispatched.filter((frame) => frame.signalId === "final")).toHaveLength(1);
      });
      await adminBarrier(updates, fullSequence(), () => streamFailure);
      rejectStream(streamFailure);
      const adminUpdates = updates.filter(update);
      expect(updates).toHaveLength(21);
      expect(adminUpdates).toHaveLength(20);
      expect(adminUpdates.map(summary)).toEqual(fullSequence());
      const snapshot = await admin.getShardInfo(create(EmptySchema));
      expect(snapshot.shards).toHaveLength(0);
    } catch (error) {
      primary = error;
    } finally {
      await settle(primary, [
        () => stopStarted(alpha),
        () => stopStarted(beta),
        async () => {
          closingAdmin = true;
          adminSessions?.abort();
          await observation;
        },
        () => stopRequired(server),
        async () => {
          try {
            await terminalHealth?.();
          } finally {
            healthSessions?.abort();
          }
        },
      ]);
    }
  }, 30_000);

  it("preserves a post-readiness failure while cleanup releases the topology and port", async () => {
    const primary = new Error("deliberate post-readiness failure");
    const injected = new Error("deterministic cleanup failure");
    let server: ChildProcess | undefined;
    let alpha: ChildProcess | undefined;
    let beta: ChildProcess | undefined;
    let sessions: Http2SessionManager | undefined;
    let observation: Promise<void> | undefined;
    let streamEnded = false;
    let port = 0;

    const scenario = async () => {
      try {
        server = spawn(process.execPath, [serverExecutable], {
          env: { ...process.env, PORT: "0", SHARD_PROCESSING_TIMEOUT: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        resources.add(server);
        const baseUrl = await readiness(server);
        port = portOf(baseUrl);
        sessions = new Http2SessionManager(baseUrl);
        const transport = createGrpcTransport({ baseUrl, sessionManager: sessions });
        const admin = createClient(AdminService, transport);
        observation = (async () => {
          try {
            for await (const _frame of admin.subscribeToShardUpdates(create(EmptySchema))) {
              void _frame;
            }
          } finally {
            streamEnded = true;
          }
        })();
        alpha = app(baseUrl, "failure-alpha");
        beta = app(baseUrl, "failure-beta");
        resources.add(alpha);
        resources.add(beta);
        await Promise.all([ready(alpha), ready(beta)]);
        throw primary;
      } catch (error) {
        await settle(error, [
          () => stopRequired(alpha),
          () => stopRequired(beta),
          () => Promise.reject(injected),
          async () => {
            sessions?.abort();
            await observation?.catch(() => undefined);
          },
          () => stopRequired(server),
          () => reuse(port),
        ]);
      }
    };

    const failure = await scenario().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error("Cleanup failure was not aggregated.");
    expect(failure.errors).toEqual([primary, injected]);
    expect(terminated(alpha)).toBe(true);
    expect(terminated(beta)).toBe(true);
    expect(terminated(server)).toBe(true);
    expect(streamEnded).toBe(true);
  }, 15_000);

  it("bounds readiness and request IPC while removing settlement listeners", async () => {
    expect(parseControlFrame({ id: "extra", command: "start", extra: true })).toBeUndefined();
    expect(parseControlFrame({ id: "missing", command: "write" })).toBeUndefined();
    expect(
      parseControlFrame({ id: "extra-signal", command: "start", signalId: "x" }),
    ).toBeUndefined();
    const silent = spawn(
      process.execPath,
      ["-e", "process.on('message', () => undefined); setInterval(() => undefined, 1000);"],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    resources.add(silent);

    await expect(ready(silent)).rejects.toThrow("Fixture readiness timed out.");
    expect(coordinationState(silent)).toEqual([0, 0, 0, 0, 0]);
    await expect(settledExit(silent, 10)).resolves.toBe(false);
    expect(coordinationState(silent)).toEqual([0, 0, 0, 0, 0]);
    const raced = inducedExitRace();
    await expect(settledExit(raced, IPC_TIMEOUT_MS)).resolves.toBe(true);
    expect(coordinationState(raced)).toEqual([0, 0, 0, 0, 0]);
    await expect(command(silent, { command: "start" })).rejects.toThrow(
      "Fixture command timed out.",
    );
    expect(coordinationState(silent)).toEqual([0, 0, 0, 0, 0]);
    silent.disconnect();
    await expect(command(silent, { command: "start" })).rejects.toThrow(
      "Fixture IPC disconnected before response.",
    );
    expect(coordinationState(silent)).toEqual([0, 0, 0, 0, 0]);

    const exiting = spawn(
      process.execPath,
      ["-e", "process.on('message', () => undefined); setInterval(() => undefined, 1000);"],
      {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    resources.add(exiting);
    const exitFailure = ready(exiting);
    exiting.emit("exit", 0, null);
    await expect(exitFailure).rejects.toThrow("Fixture process exited before response.");
    expect(coordinationState(exiting)).toEqual([0, 0, 0, 0, 0]);
    const eventualExit = settledExit(exiting, IPC_TIMEOUT_MS);
    exiting.kill("SIGTERM");
    await expect(eventualExit).resolves.toBe(true);
    expect(coordinationState(exiting)).toEqual([0, 0, 0, 0, 0]);

    const failed = spawn("/definitely/missing/spine-ts-fixture", [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    resources.add(failed);
    await expect(ready(failed)).rejects.toThrow("Fixture process failed before response.");
    expect(coordinationState(failed)).toEqual([0, 0, 0, 0, 0]);

    const sendFailure = spawn(
      process.execPath,
      ["-e", "process.on('message', () => undefined); setInterval(() => undefined, 1000);"],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    resources.add(sendFailure);
    injectSendFailure(sendFailure);
    await expect(command(sendFailure, { command: "start" })).rejects.toThrow(
      "Fixture command send failed.",
    );
    expect(coordinationState(sendFailure)).toEqual([0, 0, 0, 0, 0]);
  }, 10_000);
});

function parseControlFrame(frame: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- runtime-checking an executable JS fixture
  return controlFrame(frame);
}

function app(baseUrl: string, node: string): ChildProcess {
  return spawn(process.execPath, [appFixture], {
    env: { ...process.env, DELIVERY_SERVER_URL: baseUrl, DELIVERY_NODE: node },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
}

function ready(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = onceResult(child, resolve, reject, "Fixture readiness timed out.");
    const onMessage = (frame: unknown) => {
      if (isRecord(frame) && frame.type === "ready") finish.resolve(undefined);
      else finish.reject(new Error("Fixture readiness failed."));
    };
    finish.listen("message", onMessage);
  });
}

type FixtureCommand =
  | { readonly command: "write"; readonly signalId: string }
  | {
      readonly command:
        "pickUp" | "release" | "start" | "replace" | "armStall" | "disarmStall" | "close";
    };

function command(child: ChildProcess, request: FixtureCommand): Promise<unknown> {
  const id = `${request.command}:${String(Date.now())}:${String(Math.random())}`;
  return new Promise((resolve, reject) => {
    const finish = onceResult<unknown>(child, resolve, reject, "Fixture command timed out.");
    const onMessage = (frame: unknown) => {
      if (!isRecord(frame) || frame.id !== id) return;
      if (frame.type === "error")
        finish.reject(
          new Error(typeof frame.message === "string" ? frame.message : "Fixture command failed."),
        );
      else if (frame.type === "result") finish.resolve(frame.result);
      else finish.reject(new Error("Fixture response frame is invalid."));
    };
    finish.listen("message", onMessage);
    try {
      child.send({ id, ...request }, (error) => {
        if (error !== null) finish.reject(new Error("Fixture command send failed."));
      });
    } catch {
      finish.reject(new Error("Fixture command send failed."));
    }
  });
}

function readiness(child: ChildProcess): Promise<string> {
  const stdout = child.stdout;
  if (stdout === null)
    return Promise.reject(new Error("Executable readiness output is unavailable."));
  return new Promise((resolve, reject) => {
    let output = "";
    const finish = onceResult<string>(child, resolve, reject, "Executable readiness timed out.");
    const onData = (chunk: Buffer | string) => {
      output += String(chunk);
      const baseUrl = /http:\/\/127\.0\.0\.1:\d+/u.exec(output)?.[0];
      if (baseUrl !== undefined) finish.resolve(baseUrl);
    };
    stdout.setEncoding("utf8");
    stdout.on("data", onData);
    finish.onCleanup(() => {
      stdout.off("data", onData);
    });
  });
}

async function eventually(assertion: () => void, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (terminated(child)) return;
  child.kill("SIGTERM");
  const exited = await settledExit(child, 5_000);
  if (exited) return;
  child.kill("SIGKILL");
  if (!(await settledExit(child, 1_000))) throw new Error("Child process did not exit.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function created(frame: unknown): boolean {
  if (!isRecord(frame) || !isRecord(frame.value)) return false;
  return frame.value.case === "created" && frame.value.value === true;
}

function dispatchedFrame(
  frame: unknown,
): { readonly signalId: string; readonly node: string; readonly at: number } | undefined {
  if (
    !isRecord(frame) ||
    frame.type !== "dispatched" ||
    typeof frame.signalId !== "string" ||
    typeof frame.node !== "string"
  )
    return undefined;
  return { signalId: frame.signalId, node: frame.node, at: Date.now() };
}

function update(
  frame: unknown,
): frame is { readonly value: { readonly value: Record<string, unknown> } } {
  return (
    isRecord(frame) &&
    isRecord(frame.value) &&
    frame.value.case === "update" &&
    isRecord(frame.value.value)
  );
}

function summary(frame: { readonly value: { readonly value: Record<string, unknown> } }): string {
  const value = frame.value.value;
  const status = value.newStatus === ShardStatus.PICKED ? "PICKED" : "NOT_PICKED";
  return `${status}/${String(value.newMessagesCount)}`;
}

async function adminBarrier(
  updates: readonly unknown[],
  expected: readonly string[],
  failure: () => unknown,
): Promise<void> {
  await eventually(() => {
    rejectStream(failure());
    expect(updates.filter(update).map(summary)).toEqual(expected);
  });
}

function ordinaryThrough(phase: "alpha" | "beta"): readonly string[] {
  const first = ["PICKED/0", "NOT_PICKED/0"];
  const ordinary = ["NOT_PICKED/1", "PICKED/1", "PICKED/0", "NOT_PICKED/0"];
  return phase === "alpha" ? [...first, ...ordinary] : [...first, ...ordinary, ...ordinary];
}

function takeoverThrough(): readonly string[] {
  return [
    ...ordinaryThrough("beta"),
    "NOT_PICKED/1",
    "PICKED/1",
    "NOT_PICKED/1",
    "PICKED/1",
    "PICKED/0",
    "NOT_PICKED/0",
  ];
}

function fullSequence(): readonly string[] {
  return [...takeoverThrough(), "NOT_PICKED/1", "PICKED/1", "PICKED/0", "NOT_PICKED/0"];
}

function portOf(baseUrl: string): number {
  const port = Number(new URL(baseUrl).port);
  if (!Number.isInteger(port) || port < 1) throw new Error("Fixture listener port is invalid.");
  return port;
}

async function stopRequired(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined) throw new Error("Expected child process was not started.");
  await stop(child);
}

async function stopStarted(child: ChildProcess | undefined): Promise<void> {
  if (child !== undefined) await stop(child);
}

async function settledExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (terminated(child)) return true;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      activeCoordinationTimers -= 1;
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onExit = () => {
      finish(true);
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Child process failed while awaiting exit."));
    };
    activeCoordinationTimers += 1;
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    timer.unref();
    child.once("exit", onExit);
    child.once("error", onError);
    if (terminated(child)) finish(true);
  });
}

function inducedExitRace(): ChildProcess {
  let exitCodeReads = 0;
  const child = new EventEmitter();
  Object.defineProperties(child, {
    exitCode: {
      get: () => {
        exitCodeReads += 1;
        return exitCodeReads === 1 ? null : 0;
      },
    },
    signalCode: { value: null },
  });
  return child as ChildProcess;
}

function terminated(child: ChildProcess | undefined): boolean {
  return child !== undefined && (child.exitCode !== null || child.signalCode !== null);
}

function coordinationState(child: ChildProcess): readonly number[] {
  return [
    ...["message", "exit", "disconnect", "error"].map((event) => child.listenerCount(event)),
    activeCoordinationTimers,
  ];
}

function injectSendFailure(child: ChildProcess): void {
  Object.defineProperty(child, "send", {
    configurable: true,
    value: (...args: unknown[]) => {
      const callback = args.find(
        (value): value is (error: Error | null) => void => typeof value === "function",
      );
      queueMicrotask(() => {
        callback?.(new Error("injected send failure"));
      });
      return false;
    },
  });
}

async function settle(primary: unknown, actions: readonly (() => Promise<void>)[]): Promise<void> {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (primary !== undefined) {
    if (failures.length === 0) throw requiredError(primary);
    throw new AggregateError([primary, ...failures], "Topology cleanup failed.");
  }
  if (failures.length > 0) throw new AggregateError(failures, "Topology cleanup failed.");
}

function rejectStream(error: unknown): void {
  if (error !== undefined) throw requiredError(error);
}

function requiredError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Topology operation failed.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function onceResult<T>(
  child: ChildProcess,
  resolvePromise: (value: T) => void,
  rejectPromise: (error: Error) => void,
  timeoutMessage: string,
): {
  resolve(value: T): void;
  reject(error: Error): void;
  listen(event: "message", listener: (frame: unknown) => void): void;
  onCleanup(action: () => void): void;
} {
  let settled = false;
  let onMessage: ((frame: unknown) => void) | undefined;
  const cleanupActions: (() => void)[] = [];
  const cleanup = () => {
    clearTimeout(timer);
    activeCoordinationTimers -= 1;
    child.off("exit", onExit);
    child.off("disconnect", onDisconnect);
    child.off("error", onError);
    if (onMessage !== undefined) child.off("message", onMessage);
    for (const action of cleanupActions) action();
  };
  const resolve = (value: T) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolvePromise(value);
  };
  const reject = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(error);
  };
  const onExit = () => {
    reject(new Error("Fixture process exited before response."));
  };
  const onDisconnect = () => {
    reject(new Error("Fixture IPC disconnected before response."));
  };
  const onError = () => {
    reject(new Error("Fixture process failed before response."));
  };
  activeCoordinationTimers += 1;
  const timer = setTimeout(() => {
    reject(new Error(timeoutMessage));
  }, IPC_TIMEOUT_MS);
  child.once("exit", onExit);
  child.once("disconnect", onDisconnect);
  child.once("error", onError);
  return {
    resolve,
    reject,
    listen(_event, listener) {
      onMessage = listener;
      child.on("message", listener);
    },
    onCleanup(action) {
      cleanupActions.push(action);
    },
  };
}

async function reuse(port: number): Promise<void> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
