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
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const driver = fileURLToPath(
  new URL("../test-fixtures/project-process-smoke.mjs", import.meta.url),
);
const resistantDriver = fileURLToPath(
  new URL("../test-fixtures/resistant-matrix-driver.mjs", import.meta.url),
);

async function runIsolatedDriver(
  args: string[],
  timeoutMs = 210_000,
  termGraceMs = 500,
): Promise<string> {
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("Process matrix driver did not start.");
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const terminateGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  const deadline = { expired: false };
  let escalation: Promise<void> | undefined;
  const escalate = (): Promise<void> => {
    escalation ??= new Promise<void>((resolve) => {
      terminateGroup("SIGTERM");
      setTimeout(() => {
        terminateGroup("SIGKILL");
        resolve();
      }, termGraceMs);
    });
    return escalation;
  };
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
        reapTimer = setTimeout(
          () => {
            if (deadline.expired) resolve(undefined);
          },
          timeoutMs + termGraceMs + 1_000,
        );
      }),
    ]);
    if (exit === undefined) {
      await escalate();
      throw new Error(
        `Process matrix driver ${String(pid)} did not exit after SIGKILL; cleanup unknown after forced termination.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    if (exit.code !== 0) {
      await escalate();
      const outcome = `Process matrix driver exited ${String(exit.code)}/${String(exit.signal)}`;
      const timing = deadline.expired ? " after timeout" : "";
      throw new Error(
        `${outcome}${timing}; cleanup unknown after forced termination.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    if (deadline.expired) {
      await escalate();
      throw new Error(
        `Process matrix driver timed out; cleanup unknown after forced termination.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    return stdout;
  } finally {
    clearTimeout(timeout);
    clearTimeout(reapTimer);
  }
}

test("the matrix watchdog kills a TERM-resistant driver and retains its diagnostics", async () => {
  const started = Date.now();
  const failure = await runIsolatedDriver([resistantDriver], 500, 50).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  const message = (failure as Error).message;
  expect(message).toMatch(
    /after timeout[\s\S]*resistant driver ready[\s\S]*resistant driver diagnostic/u,
  );
  expect(message).toContain("cleanup unknown after forced termination");
  const identityLine = /MATRIX_RESOURCE (\{[^\n]+\})/u.exec(message)?.[1];
  if (identityLine === undefined)
    throw new Error("The stopped driver did not report its resource identity.");
  const identity = JSON.parse(identityLine) as {
    runId: string;
    database: string;
    evidencePath: string;
  };
  expect(identity.database).toBe(`sqlrel_matrix_${identity.runId}`);
  expect(identity.evidencePath).toMatch(/^.*spine-matrix-watchdog-[^/]+$/u);
  expect(identity.evidencePath.startsWith(tmpdir())).toBe(true);
  try {
    const retained = JSON.parse(
      await readFile(`${identity.evidencePath}/resource.json`, "utf8"),
    ) as typeof identity;
    expect(retained).toEqual(identity);
    await expect(readFile(`${identity.evidencePath}/cleanup.json`, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(identity.evidencePath, { recursive: true, force: true });
  }
  const pid = /resistant driver ready pid=(\d+)/u.exec(message)?.[1];
  if (pid === undefined) throw new Error("The resistant driver did not report its PID.");
  expect(() => process.kill(Number(pid), 0)).toThrow();
  expect(Date.now() - started).toBeLessThan(2_000);
});

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for the opt-in process matrix.`);
  }
  return value;
}

test("selected Project workflow process topology completes with durable cleanup", async () => {
  const provider = required("SPINE_TS_MATRIX_PROVIDER");
  const processes = required("SPINE_TS_MATRIX_PROCESSES");
  const mode = required("SPINE_TS_MATRIX_MODE");
  const total = required("SPINE_TS_MATRIX_TOTAL");
  const burst = required("SPINE_TS_MATRIX_BURST");
  const historical = process.env.SPINE_TS_MATRIX_HISTORICAL;
  const restart = process.env.SPINE_TS_MATRIX_RESTART === "1";
  const args = [driver, provider, processes, mode, total, burst];
  if (historical !== undefined) args.push(`--historical=${historical}`);
  if (restart) args.push("--restart");

  const stdout = await runIsolatedDriver(args);
  const resultLine = stdout.trim().split("\n").at(-1);
  if (resultLine === undefined) throw new Error("Process matrix driver returned no result.");
  const result = JSON.parse(resultLine) as {
    status: string;
    runId: string;
    processes: number;
    configuredShards: number;
    total: number;
    eventCount: number;
    entryCount: number;
    pids: number[];
    restartResult?: { entryCountAfterRestart: number };
  };
  expect(result.status).toBe("PASS");
  expect(result.processes).toBe(Number(processes));
  expect(result.configuredShards).toBe(Number(processes));
  expect(new Set(result.pids).size).toBe(Number(processes));
  expect(result.total).toBe(Number(total));
  expect(result.eventCount).toBe(Number(total));
  expect(result.entryCount).toBe(Number(total) * 5);
  if (restart) expect(result.restartResult?.entryCountAfterRestart).toBe((Number(total) + 1) * 5);

  const cleanupPath = new URL(
    `../../../build-protocol/tasks/sql-delivery-reliability/evidence/matrix-runs/${result.runId}/cleanup.json`,
    import.meta.url,
  );
  const cleanup = JSON.parse(await readFile(cleanupPath, "utf8")) as {
    databaseDropped: boolean;
    workerExits: { code: number | null }[];
    deliveryExit?: { code: number | null };
    errors: string[];
  };
  expect(cleanup.databaseDropped).toBe(true);
  expect(cleanup.workerExits).toHaveLength(Number(processes));
  expect(cleanup.workerExits.every((exit) => exit.code === 0)).toBe(true);
  if (mode === "shared-memory") expect(cleanup.deliveryExit?.code).toBe(0);
  expect(cleanup.errors).toEqual([]);
}, 240_000);
