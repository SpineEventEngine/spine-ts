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

import { execFile, fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { expect, it, onTestFinished } from "vitest";

const run = promisify(execFile);
const { sharedUrl, northwindUrl, contosoUrl } = (() => {
  const sharedUrl = process.env.ORDERS_SHARED_DATABASE_URL;
  const northwindUrl = process.env.ORDERS_NORTHWIND_DATABASE_URL;
  const contosoUrl = process.env.ORDERS_CONTOSO_DATABASE_URL;
  if (!sharedUrl || !northwindUrl || !contosoUrl)
    throw new Error("Three Orders PostgreSQL database URLs are required for live tests.");
  return { sharedUrl, northwindUrl, contosoUrl };
})();

it("reads both tenant records and membership in a fresh process before reseeding", async () => {
  const id = `restart-${randomUUID()}`;
  const invoke = async (phase: "write" | "read") => {
    const result = await run(process.execPath, ["test/postgres-restart-child.mjs", phase, id], {
      cwd: new URL("..", import.meta.url),
      env: process.env,
    });
    return JSON.parse(result.stdout) as { id: string; northwind: string; contoso: string };
  };

  expect(await invoke("write")).toEqual({ id, northwind: "northwind-sku", contoso: "contoso-sku" });
  expect(await invoke("read")).toEqual({ id, northwind: "northwind-sku", contoso: "contoso-sku" });
});

it("recovers an interrupted pending command and its projection while new commands progress", async () => {
  const id = `interrupted-${randomUUID()}`;
  const expiry = await interruptPendingOrder(id);
  const result = await recoverPendingOrder(id, expiry);
  expect(result).toEqual({
    pendingOrder: id,
    pendingSku: "recovered-sku",
    pendingView: "recovered-sku",
    newSku: "new-sku",
    newView: "new-sku",
  });
});

async function interruptPendingOrder(id: string): Promise<number> {
  const child = fork("test/postgres-interruption-child.mjs", ["stage", id], {
    cwd: new URL("..", import.meta.url),
    env: process.env,
    execArgv: [],
    silent: true,
  });
  const { closed, stop } = registerChildCleanup(child, false);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const pending = new Promise<unknown>((resolve) => child.once("message", resolve));
  let confirmed = false;
  try {
    const message = (await Promise.race([
      pending,
      closed.then(() => {
        throw new Error(`Orders staging exited early: ${redact(stderr)}`);
      }),
    ])) as { kind: string; id: string; expiresAt: number };
    expect(message).toMatchObject({ kind: "pending", id });
    expect(Number.isSafeInteger(message.expiresAt)).toBe(true);
    confirmed = true;
    return message.expiresAt;
  } finally {
    const outcome = await stop();
    if (confirmed) expect(outcome.signal).toBe("SIGKILL");
  }
}

async function recoverPendingOrder(id: string, expiresAt: number): Promise<unknown> {
  const child = fork("test/postgres-interruption-child.mjs", ["recover", id, String(expiresAt)], {
    cwd: new URL("..", import.meta.url),
    env: process.env,
    execArgv: [],
    silent: true,
  });
  const { closed, stop } = registerChildCleanup(child, true);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exit = closed.then(({ code }) => code);
  const entered = milestone(child, "recovered-entered", exit, () => stderr);
  const received = milestone(child, "new-received", exit, () => stderr);
  const result = milestone(child, "result", exit, () => stderr);
  try {
    await entered;
    await received;
    child.send({ kind: "release" });
    const message = (await result) as { kind: "result"; value: unknown };
    expect(await exit).toBe(0);
    return message.value;
  } finally {
    await stop();
  }
}

function registerChildCleanup(child: ChildProcess, release: boolean) {
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    }),
  );
  let cleanup: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  const stop = () => {
    cleanup ??= (async () => {
      if (release && child.connected) {
        try {
          child.send({ kind: "release" }, () => undefined);
        } catch {
          // The child may disconnect between the check and the send.
        }
      }
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      return await closed;
    })();
    return cleanup;
  };
  onTestFinished(async () => {
    await stop();
  });
  return { closed, stop };
}

function milestone(
  child: ChildProcess,
  kind: string,
  exit: Promise<number | null>,
  stderr: () => string,
): Promise<unknown> {
  const pending = Promise.race([
    new Promise((resolve) =>
      child.on("message", (message) => {
        if ((message as { kind?: string }).kind === kind) resolve(message);
      }),
    ),
    exit.then(() => {
      throw new Error(`Orders recovery exited before ${kind}: ${redact(stderr())}`);
    }),
  ]);
  void pending.catch(() => undefined);
  return pending;
}

function redact(value: string): string {
  return value
    .replaceAll(sharedUrl, "[REDACTED]")
    .replaceAll(northwindUrl, "[REDACTED]")
    .replaceAll(contosoUrl, "[REDACTED]");
}

it("rejects persisted membership without complete storage routing before listening", async () => {
  const { configureOrdersEnvironment, createOrdersPostgresFactory, ordersTenants } =
    await import("../dist/src/index.js");
  await expect(
    configureOrdersEnvironment({
      storageFactory: await createOrdersPostgresFactory({
        sharedUrl,
        northwindUrl,
        contosoUrl,
      }),
      tenants: [ordersTenants.northwind],
      membership: "existing",
    }),
  ).rejects.toThrow(/routing/i);
});

it("rejects an unreachable tenant database before starting a listener", async () => {
  const {
    configureOrdersEnvironment,
    createOrdersPostgresFactory,
    ordersTenants,
    startOrdersServer,
  } = await import("../dist/src/index.js");
  const { withOrdersServer } = await import("../dist/src/orders-launch.js");
  const setup = await configureOrdersEnvironment({
    storageFactory: await createOrdersPostgresFactory({
      sharedUrl,
      northwindUrl: "postgresql://127.0.0.1:1/orders_unreachable",
      contosoUrl,
    }),
    tenants: [ordersTenants.northwind, ordersTenants.contoso],
    membership: "existing",
  });
  let listenerStarted = false;
  await expect(
    withOrdersServer(
      setup,
      () => startOrdersServer(setup),
      () => {
        listenerStarted = true;
        return Promise.resolve();
      },
    ),
  ).rejects.toThrow();
  expect(listenerStarted).toBe(false);
});
