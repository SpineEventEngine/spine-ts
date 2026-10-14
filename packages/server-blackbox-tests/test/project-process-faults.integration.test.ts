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
  new URL("../test-fixtures/project-process-faults.mjs", import.meta.url),
);
const resistantDriver = fileURLToPath(
  new URL("../test-fixtures/resistant-fault-driver.mjs", import.meta.url),
);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function resourceIdentity(
  stdout: string,
): { runId: string; database: string; evidencePath: string } | undefined {
  const line = /FAULT_RESOURCE (\{[^\n]+\})/u.exec(stdout)?.[1];
  if (line === undefined) return undefined;
  const parsed: unknown = JSON.parse(line);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("runId" in parsed) ||
    typeof parsed.runId !== "string" ||
    !("database" in parsed) ||
    typeof parsed.database !== "string" ||
    !("evidencePath" in parsed) ||
    typeof parsed.evidencePath !== "string"
  )
    throw new Error("Fault driver returned an invalid resource identity.");
  return parsed as { runId: string; database: string; evidencePath: string };
}

async function cleanupState(stdout: string): Promise<string> {
  const identity = resourceIdentity(stdout);
  if (identity === undefined) return "resource identity unavailable";
  return readFile(`${identity.evidencePath}/cleanup.json`, "utf8").then(
    (content) => content,
    () => "cleanup unverified",
  );
}

async function runIsolatedFaultDriver(
  args: string[],
  timeoutMs = 210_000,
  termGraceMs = 500,
): Promise<string> {
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid === undefined) throw new Error("Process fault driver did not start.");
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
      }, termGraceMs);
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
        child.once("error", (error: Error) => {
          reject(error);
        });
        child.once("exit", (code, signal) => {
          resolve({ code, signal });
        });
      },
    );
    const exit = await Promise.race([
      exited,
      new Promise<undefined>((resolve) => {
        reapTimer = setTimeout(
          () => {
            resolve(undefined);
          },
          timeoutMs + termGraceMs + 1_000,
        );
      }),
    ]);
    if (exit === undefined || deadline.expired || exit.code !== 0) {
      await escalate().catch(() => undefined);
      const cleanup = await cleanupState(stdout);
      throw new Error(
        `Fault driver ${String(pid)} exited ${String(exit?.code)}/${String(exit?.signal)}; ` +
          `expired=${String(deadline.expired)}; cleanup=${cleanup}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    return stdout;
  } finally {
    clearTimeout(timeout);
    clearTimeout(reapTimer);
  }
}

test("the fault watchdog bounds a TERM-resistant process and reports its resource", async () => {
  const started = Date.now();
  const failure = await runIsolatedFaultDriver([resistantDriver], 500, 50).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  const message = (failure as Error).message;
  expect(message).toContain("resistant fault diagnostic");
  expect(message).toContain("cleanup unverified");
  const identityLine = /FAULT_RESOURCE (\{[^\n]+\})/u.exec(message)?.[1];
  if (identityLine === undefined) throw new Error("The driver omitted its resource identity.");
  const identity = JSON.parse(identityLine) as { runId: string; evidencePath: string };
  try {
    expect(identity.evidencePath).toContain("spine-fault-watchdog-");
    expect(Date.now() - started).toBeLessThan(2_000);
    const pid = /resistant fault driver pid=(\d+)/u.exec(message)?.[1];
    if (pid === undefined) throw new Error("The driver omitted its PID.");
    expect(() => process.kill(Number(pid), 0)).toThrow();
  } finally {
    await rm(identity.evidencePath, { recursive: true, force: true });
  }
});

test("selected OS-process fault preserves its measured persistence boundary", async () => {
  const provider = required("SPINE_TS_FAULT_PROVIDER");
  const scenario = required("SPINE_TS_FAULT_SCENARIO");
  const processes = Number(required("SPINE_TS_FAULT_PROCESSES"));
  expect([2, 8]).toContain(processes);
  expect([
    "before-effect",
    "after-save-before-ack",
    "partial-publication-repair",
    "shared-volatile-loss",
  ]).toContain(scenario);

  const stdout = await runIsolatedFaultDriver([driver, provider, scenario, String(processes)]);
  const identity = resourceIdentity(stdout);
  const cleanup = await cleanupState(stdout);
  expect(identity).toBeDefined();
  const resultLine = stdout.trim().split("\n").at(-1);
  if (resultLine === undefined) throw new Error("Fault driver returned no result.");
  const result = JSON.parse(resultLine) as {
    status: string;
    scenario: string;
    provider: string;
    processes: number;
    acknowledgedCommandIds: string[];
  };
  expect(result.status).toBe("PASS");
  expect(result.scenario).toBe(scenario);
  expect(result.provider).toBe(provider);
  expect(result.processes).toBe(processes);
  expect(result.acknowledgedCommandIds.length).toBeGreaterThan(0);
  const cleanupRecord = JSON.parse(cleanup) as { databaseDropped: boolean; errors: string[] };
  expect(cleanupRecord.databaseDropped).toBe(true);
  expect(cleanupRecord.errors).toEqual([]);
  if (identity === undefined) throw new Error("Fault driver returned no resource identity.");
  await rm(identity.evidencePath, { recursive: true, force: true });
}, 240_000);
