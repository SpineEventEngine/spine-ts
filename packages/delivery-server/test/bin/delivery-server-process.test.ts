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

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, onTestFinished } from "vitest";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { Health } from "@spine-event-engine/proto/delivery-server";

import { DeliveryServer } from "../../src/index.js";

const executable = resolve("packages/delivery-server/dist/bin/spine-delivery-server.js");
const signalSequences: readonly (readonly NodeJS.Signals[])[] = [
  ["SIGINT", "SIGINT"],
  ["SIGTERM", "SIGTERM"],
  ["SIGINT", "SIGTERM"],
];

describe("spine-delivery-server executable", () => {
  it("exits nonzero after a two-child startup collides with the public port", async () => {
    const occupied = new DeliveryServer({ port: 0 });
    await occupied.start();
    const child = spawn(process.execPath, [executable], {
      detached: true,
      env: { ...process.env, PORT: String(occupied.port), DELIVERY_PROCESS_COUNT: "2" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = collect(child.stderr);
    try {
      const code = await Promise.race([
        exited(child),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("CLI did not exit after public bind failure."));
          }, 2_000);
        }),
      ]);
      expect(code).not.toBe(0);
      await expect(stderr).resolves.toContain("Delivery server startup failed:");
    } finally {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Process group already exited. */
        }
      }
      await occupied.close();
    }
  });
  it("starts and closes a parent with two private children from its environment", async () => {
    const child = spawn(process.execPath, [executable], {
      env: { ...process.env, PORT: "0", DELIVERY_PROCESS_COUNT: "2" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => {
        resolve();
      });
    });
    onTestFinished(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    });
    const stderr = collect(child.stderr);
    const exit = exited(child);
    const readiness = await waitFor(child, "Delivery server listening at http://127.0.0.1:");
    const baseUrl = `http://127.0.0.1:${String(readinessPort(readiness))}`;
    const sessions = new Http2SessionManager(baseUrl);
    try {
      const health = createClient(
        Health,
        createGrpcTransport({ baseUrl, sessionManager: sessions }),
      );
      await expect(health.check({ service: "" })).resolves.toBeDefined();
    } finally {
      sessions.abort();
      child.kill("SIGTERM");
    }
    await expect(exit).resolves.toBe(0);
    await expect(stderr).resolves.toBe("");
  });
  it("fails invalid configuration before listener startup with a sanitized nonzero error", async () => {
    const child = spawn(process.execPath, [executable], {
      env: { ...process.env, PORT: "invalid" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = collect(child.stderr);
    const code = await exited(child);
    expect(code).not.toBe(0);
    await expect(stderr).resolves.toContain(
      "Delivery server startup failed: Delivery server port is invalid.",
    );
  });

  it.each(signalSequences)("releases its listener after signal sequence %j", async (...signals) => {
    const deliveryServerModule = pathToFileURL(
      resolve("packages/delivery-server/dist/server/delivery-server.js"),
    ).href;
    const script = [
      `const { DeliveryServer } = await import(${JSON.stringify(deliveryServerModule)});`,
      "let shuttingDown = false;",
      "let closeCalls = 0;",
      "const emit = process.emit;",
      "process.emit = function (event, ...args) {",
      `  const repeated = shuttingDown && event === ${JSON.stringify(signals[1])};`,
      "  const handled = emit.call(this, event, ...args);",
      "  if (repeated) process.stdout.write(`Repeated signal handled; close calls=${closeCalls};\\n`);",
      "  return handled;",
      "};",
      "const close = DeliveryServer.prototype.close;",
      "DeliveryServer.prototype.close = function () {",
      "  closeCalls++;",
      "  const closing = close.call(this);",
      `  if (process.listenerCount(${JSON.stringify(signals[1])}) === 0) {`,
      '    throw new Error("Delivery server signal handler missing during shutdown.");',
      "  }",
      "  shuttingDown = true;",
      '  process.stdout.write("Delivery server shutdown started\\n");',
      "  return new Promise((resolve, reject) => {",
      "    process.stdin.once('data', () => closing.then(resolve, reject));",
      "  });",
      "};",
      `await import(${JSON.stringify(pathToFileURL(executable).href)});`,
    ].join("\n");
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...process.env, PORT: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => {
        resolve();
      });
    });
    onTestFinished(async () => {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    });
    const stderr = collect(child.stderr);
    const exit = exited(child);
    const readiness = await waitFor(child, "Delivery server listening at http://127.0.0.1:");
    expect(child.kill(signals[0])).toBe(true);
    await waitFor(child, "Delivery server shutdown started");
    expect(child.kill(signals[1])).toBe(true);
    const repeated = await waitFor(child, ";\n");
    expect(repeated).toContain("Repeated signal handled; close calls=1;\n");
    child.stdin.end("close\n");
    const code = await exit;
    expect(code).toBe(0);
    await expect(stderr).resolves.toBe("");
    const replacement = new DeliveryServer({ port: readinessPort(readiness) });
    await expect(replacement.start()).resolves.toBe(replacement);
    await replacement.close();
  });

  it("keeps terminal signals handled through process exit", async () => {
    const script = [
      `await import(${JSON.stringify(pathToFileURL(executable).href)});`,
      'process.once("exit", () => process.kill(process.pid, "SIGINT"));',
    ].join("\n");
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = collect(child.stderr);
    const exit = exited(child);
    await waitFor(child, "Delivery server listening at http://127.0.0.1:");
    child.kill("SIGINT");

    await expect(exit).resolves.toBe(0);
    await expect(stderr).resolves.toBe("");
  });
});

function collect(stream: NodeJS.ReadableStream | null): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      text += chunk;
    });
    stream?.once("error", reject);
    stream?.once("end", () => {
      resolve(text);
    });
  });
}

function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("exit", (code: number | null) => {
      resolve(code);
    });
  });
}

function waitFor(child: ReturnType<typeof spawn>, expected: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const stream = child.stdout;
    stream?.setEncoding("utf8");
    const detach = () => {
      stream?.off("data", onData);
      stream?.off("error", onError);
      child.off("exit", onExit);
    };
    const onData = (chunk: string) => {
      text += chunk;
      if (text.includes(expected)) {
        detach();
        resolve(text);
      }
    };
    const onError = (error: Error) => {
      detach();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      detach();
      reject(
        new Error(
          `Executable exited before ${JSON.stringify(expected)} (code=${String(code)}, signal=${String(signal)}).`,
        ),
      );
    };
    stream?.on("data", onData);
    stream?.once("error", onError);
    child.once("exit", onExit);
  });
}

function readinessPort(readiness: string): number {
  const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(readiness);
  if (match?.[1] === undefined) throw new Error("Executable readiness port is missing.");
  return Number(match[1]);
}
