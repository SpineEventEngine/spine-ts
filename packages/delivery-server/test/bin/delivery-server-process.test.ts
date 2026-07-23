import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DeliveryServer } from "../../src/index.js";

const executable = resolve("packages/delivery-server/dist/bin/spine-delivery-server.js");
const signalSequences: readonly (readonly NodeJS.Signals[])[] = [
  ["SIGINT", "SIGINT"],
  ["SIGTERM", "SIGTERM"],
  ["SIGINT", "SIGTERM"],
];

describe("spine-delivery-server executable", () => {
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
    const child = spawn(process.execPath, [executable], {
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderr = collect(child.stderr);
    const readiness = await waitFor(child, "Delivery server listening at http://127.0.0.1:");
    for (const signal of signals) child.kill(signal);
    const code = await exited(child);
    expect(code).toBe(0);
    await expect(stderr).resolves.toBe("");
    const replacement = new DeliveryServer({ port: readinessPort(readiness) });
    await expect(replacement.start()).resolves.toBe(replacement);
    await replacement.close();
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
    stream?.on("data", (chunk: string) => {
      text += chunk;
      if (text.includes(expected)) resolve(text);
    });
    stream?.once("error", reject);
    child.once("exit", () => {
      reject(new Error("Executable exited before readiness."));
    });
  });
}

function readinessPort(readiness: string): number {
  const match = /http:\/\/127\.0\.0\.1:(\d+)/u.exec(readiness);
  if (match?.[1] === undefined) throw new Error("Executable readiness port is missing.");
  return Number(match[1]);
}
