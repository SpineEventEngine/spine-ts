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
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const driver = fileURLToPath(
  new URL("../test-fixtures/project-shared-takeover.mjs", import.meta.url),
);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function resourceIdentity(stdout: string): { evidencePath: string; database: string } | undefined {
  const line = /TAKEOVER_RESOURCE (\{[^\n]+\})/u.exec(stdout)?.[1];
  if (line === undefined) return undefined;
  const parsed: unknown = JSON.parse(line);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("evidencePath" in parsed) ||
    typeof parsed.evidencePath !== "string" ||
    !("database" in parsed) ||
    typeof parsed.database !== "string"
  )
    throw new Error("Takeover driver returned an invalid resource identity.");
  return parsed as { evidencePath: string; database: string };
}

async function cleanupState(stdout: string): Promise<string> {
  const identity = resourceIdentity(stdout);
  if (identity === undefined) return "resource identity unavailable";
  return readFile(`${identity.evidencePath}/cleanup.json`, "utf8").then(
    (content) => content,
    () => "cleanup unverified",
  );
}

async function runIsolatedDriver(args: string[], timeoutMs = 125_000): Promise<string> {
  const child = spawn(process.execPath, [driver, ...args], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid === undefined) throw new Error("Takeover driver did not start.");
  const pid = child.pid;
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  let escalation: Promise<void> | undefined;
  const escalate = (): Promise<void> => {
    escalation ??= new Promise<void>((resolve, reject) => {
      signalGroup("SIGTERM");
      setTimeout(() => {
        try {
          signalGroup("SIGKILL");
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, 500);
    });
    return escalation;
  };
  const deadline = { expired: false };
  const timeout = setTimeout(() => {
    deadline.expired = true;
    void escalate().catch(() => undefined);
  }, timeoutMs);
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          resolve({ code, signal });
        });
      },
    );
    const exit = await Promise.race([
      exited,
      new Promise<undefined>((resolve) => {
        reapTimer = setTimeout(() => {
          resolve(undefined);
        }, timeoutMs + 1_500);
      }),
    ]);
    if (exit === undefined || deadline.expired || exit.code !== 0) {
      await escalate().catch(() => undefined);
      const cleanup = await cleanupState(stdout);
      throw new Error(
        `Takeover driver ${String(pid)} exited ${String(exit?.code)}/${String(exit?.signal)}; ` +
          `expired=${String(deadline.expired)}; cleanup=${cleanup}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    return stdout;
  } finally {
    clearTimeout(timeout);
    clearTimeout(reapTimer);
  }
}

test("selected shared Delivery worker replacement records its actual recovery clock", async () => {
  const provider = required("SPINE_TS_TAKEOVER_PROVIDER");
  const processes = Number(required("SPINE_TS_TAKEOVER_PROCESSES"));
  const processingTimeoutSeconds = Number(required("SPINE_TS_TAKEOVER_PROCESSING_TIMEOUT_SECONDS"));
  expect([2, 8]).toContain(processes);
  expect([0, 10]).toContain(processingTimeoutSeconds);
  const stdout = await runIsolatedDriver([
    provider,
    String(processes),
    String(processingTimeoutSeconds),
  ]);
  const resultLine = stdout.trim().split("\n").at(-1);
  if (resultLine === undefined) throw new Error("Takeover driver returned no result.");
  const result = JSON.parse(resultLine) as {
    status: string;
    provider: string;
    processes: number;
    processingTimeoutSeconds: number;
    acceptedCommandId: string;
    originalEventId: string;
    firstCompletionElapsedMs: number;
    beforeStaleElapsedMs?: number;
  };
  expect(result).toMatchObject({ status: "PASS", provider, processes, processingTimeoutSeconds });
  expect(result.acceptedCommandId.length).toBeGreaterThan(0);
  expect(result.originalEventId.length).toBeGreaterThan(0);
  expect(result.firstCompletionElapsedMs).toBeGreaterThan(0);
  if (processingTimeoutSeconds === 0)
    expect(result.beforeStaleElapsedMs).toBeGreaterThanOrEqual(35_000);
  const cleanup = JSON.parse(await cleanupState(stdout)) as {
    databaseDropped: boolean;
    errors: string[];
  };
  expect(cleanup.databaseDropped).toBe(true);
  expect(cleanup.errors).toEqual([]);
  const identity = resourceIdentity(stdout);
  if (identity === undefined) throw new Error("Takeover driver returned no resource identity.");
  await rm(identity.evidencePath, { recursive: true, force: true });
}, 150_000);
