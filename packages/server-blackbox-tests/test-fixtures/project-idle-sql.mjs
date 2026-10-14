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

import assert from "node:assert/strict";
import { spawn, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const task = resolve(root, "build-protocol/tasks/sql-delivery-reliability");
const [phase, providerName, countText, mode, database, evidencePath] = process.argv.slice(2);
const count = Number(countText);
assert.ok(["outer", "child"].includes(phase));
assert.ok(["postgres16", "postgres18", "mysql84", "mariadb114"].includes(providerName));
assert.ok([2, 8].includes(count));
assert.ok(["db-only", "shared-memory"].includes(mode));
const records = JSON.parse(await readFile(resolve(task, "evidence/databases.json"), "utf8"));
const provider = records.records.find((item) => item.name === providerName);
assert.ok(provider);
const postgres = provider.engine === "postgres";
const requireProvider = createRequire(
  resolve(root, `packages/${postgres ? "storage-postgres" : "storage-mysql"}/package.json`),
);
const quoted = (name) => (postgres ? `"${name}"` : `\`${name}\``);
const connection = (url) =>
  postgres
    ? new (requireProvider("pg").Client)({ connectionString: url })
    : requireProvider("mysql2/promise").createConnection(url);
const connect = async (url) => {
  const client = await connection(url);
  if (postgres) await client.connect();
  return client;
};

if (phase === "outer") await outer();
else await child();

async function outer() {
  const runId = randomUUID().replaceAll("-", "");
  const selected = `sqlrel_idle_${runId}`;
  const dir = resolve(task, "evidence/sql-trace/idle-runs", runId);
  await mkdir(dir, { recursive: true });
  const identity = { runId, database: selected, evidencePath: dir, providerName, count, mode };
  await writeFile(resolve(dir, "resource.json"), `${JSON.stringify(identity, null, 2)}\n`);
  process.stdout.write(`IDLE_RESOURCE ${JSON.stringify(identity)}\n`);
  const admin = await connect(provider.urls.spine_test);
  let created = false;
  let capture;
  const cleanupErrors = [];
  try {
    await admin.query(`CREATE DATABASE ${quoted(selected)}`);
    created = true;
    const label = `idle-${mode}-${count}-${runId.slice(0, 8)}`;
    capture = await runCapture(providerName, count, mode, selected, dir, label);
    assert.equal(capture.exitCode, 0, `SQL capture exited ${capture.exitCode}.`);
  } finally {
    if (created) {
      try {
        await admin.query(`DROP DATABASE ${quoted(selected)}${postgres ? " WITH (FORCE)" : ""}`);
      } catch (error) {
        cleanupErrors.push(`drop: ${String(error)}`);
      }
    }
    try {
      await admin.end();
    } catch (error) {
      cleanupErrors.push(`admin end: ${String(error)}`);
    }
    await writeFile(
      resolve(dir, "outer-result.json"),
      `${JSON.stringify({ identity, capture, databaseDropped: created && cleanupErrors.length === 0, cleanupErrors }, null, 2)}\n`,
    );
  }
  assert.deepEqual(cleanupErrors, []);
  process.stdout.write(`IDLE_CAPTURE ${JSON.stringify({ ...identity, capture })}\n`);
}

async function runCapture(name, workers, deliveryMode, selected, dir, label) {
  const args = [
    resolve(task, "evidence/sql-trace/capture.mjs"),
    name,
    "--",
    process.execPath,
    fileURLToPath(import.meta.url),
    "child",
    name,
    String(workers),
    deliveryMode,
    selected,
    dir,
  ];
  const processHandle = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, TRACE_DATABASE: selected, TRACE_OPERATION: label },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle.stdout.on("data", (bytes) =>
    appendFileSync(resolve(dir, "capture.stdout.log"), bytes),
  );
  processHandle.stderr.on("data", (bytes) =>
    appendFileSync(resolve(dir, "capture.stderr.log"), bytes),
  );
  const exit = await new Promise((resolveExit, rejectExit) => {
    processHandle.once("error", rejectExit);
    processHandle.once("exit", (code, signal) => resolveExit({ exitCode: code, signal }));
  });
  return exit;
}

async function child() {
  assert.match(database, /^sqlrel_idle_[a-f0-9]{32}$/);
  assert.ok(evidencePath?.startsWith(resolve(task, "evidence/sql-trace/idle-runs")));
  const selectedUrl = process.env[postgres ? "SPINE_TS_POSTGRESQL_URL" : "SPINE_TS_MYSQL_URL"];
  assert.ok(selectedUrl);
  assert.equal(new URL(selectedUrl).pathname, `/${database}`);
  const children = [];
  const client = await connect(selectedUrl);
  const exits = [];
  let deliveryPid = null;
  let error;
  try {
    const settings = {
      engine: provider.engine,
      url: selectedUrl,
      contextName: `ProjectIdle_${database.slice(-16)}`,
      organization: `idle-${database.slice(-16)}`,
      number: 1,
      shards: count,
      entryLog: resolve(evidencePath, "entries.jsonl"),
      artifactPaths: [resolve(root, "packages/server/dist/index.js")],
    };
    if (mode === "shared-memory") {
      const shared = launch("shared-delivery-worker.mjs", "delivery");
      const ready = await request(shared, "start", {
        logPath: resolve(evidencePath, "delivery.structured.jsonl"),
      });
      deliveryPid = ready.pid;
      settings.deliveryEndpoint = ready.endpoint;
    }
    const workers = Array.from({ length: count }, (_, index) =>
      launch("project-worker.mjs", `app-${index}`),
    );
    const ready = await Promise.all(
      workers.map((worker, index) =>
        request(worker, "start", {
          settings: {
            ...settings,
            logPath: resolve(evidencePath, `app-${index}.structured.jsonl`),
          },
        }),
      ),
    );
    assert.equal(new Set(ready.map((item) => item.pid)).size, count);
    assert.ok(ready.every((item) => item.configuredShards === count));
    // Let the first ten-second recovery scan initialize its SQL families before measuring idle work.
    await delay(12_000);
    const began = Date.now();
    await client.query(`SELECT '${process.env.TRACE_MARKER_BEGIN}' AS marker`);
    await delay(25_000);
    await client.query(`SELECT '${process.env.TRACE_MARKER_END}' AS marker`);
    const ended = Date.now();
    await writeFile(
      resolve(evidencePath, "idle-window.json"),
      `${JSON.stringify({ providerName, count, mode, database, warmupMs: 12_000, began, ended, workerPids: ready.map((item) => item.pid), deliveryPid }, null, 2)}\n`,
    );
  } catch (caught) {
    error = caught;
  } finally {
    for (const worker of children.toReversed()) {
      try {
        await request(worker, "close", {}, 5_000);
      } catch (caught) {
        error ??= caught;
      }
      if (worker.connected) worker.disconnect();
      exits.push(await stop(worker));
    }
    try {
      await client.end();
    } catch (caught) {
      error ??= caught;
    }
    await writeFile(resolve(evidencePath, "children.json"), `${JSON.stringify(exits, null, 2)}\n`);
  }
  if (error !== undefined) throw error;
  assert.ok(exits.every((item) => item.code === 0));
  process.stdout.write(
    `IDLE_CHILD ${JSON.stringify({ providerName, count, mode, database, exits })}\n`,
  );

  function launch(name, label) {
    const worker = fork(new URL(name, import.meta.url), [], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    worker.stdout.on("data", (bytes) =>
      appendFileSync(resolve(evidencePath, `${label}.stdout.log`), bytes),
    );
    worker.stderr.on("data", (bytes) =>
      appendFileSync(resolve(evidencePath, `${label}.stderr.log`), bytes),
    );
    children.push(worker);
    return worker;
  }
}

function request(worker, kind, fields = {}, timeoutMs = 15_000) {
  return new Promise((resolveRequest, rejectRequest) => {
    const requestId = randomUUID();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("exit", onExit);
      worker.off("disconnect", onDisconnect);
      worker.off("error", onError);
      if (error === undefined) resolveRequest(result);
      else rejectRequest(error);
    };
    const onMessage = (message) => {
      if (message.requestId !== requestId) return;
      if (message.ok) finish(undefined, message.result);
      else finish(new Error(String(message.error)));
    };
    const onExit = (code) => finish(new Error(`Worker ${worker.pid} exited ${String(code)}.`));
    const onDisconnect = () => finish(new Error(`Worker ${worker.pid} disconnected.`));
    const onError = (error) => finish(error);
    const timer = setTimeout(
      () => finish(new Error(`Worker ${worker.pid} ${kind} timed out.`)),
      timeoutMs,
    );
    worker.on("message", onMessage);
    worker.once("exit", onExit);
    worker.once("disconnect", onDisconnect);
    worker.once("error", onError);
    try {
      worker.send({ requestId, kind, ...fields }, (error) => {
        if (error) finish(error);
      });
    } catch (error) {
      finish(error);
    }
  });
}

async function stop(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null)
    return { pid: worker.pid, code: worker.exitCode, signal: worker.signalCode };
  let exit = await waitForExit(worker, 2_000);
  if (exit === null) {
    worker.kill("SIGTERM");
    exit = await waitForExit(worker, 2_000);
  }
  if (exit === null) {
    worker.kill("SIGKILL");
    exit = await waitForExit(worker, 2_000);
  }
  return { pid: worker.pid, ...(exit ?? { code: null, signal: "UNREAPED" }) };
}

function waitForExit(worker, timeoutMs) {
  if (worker.exitCode !== null || worker.signalCode !== null)
    return Promise.resolve({ code: worker.exitCode, signal: worker.signalCode });
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      worker.off("exit", onExit);
      resolveExit(null);
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    };
    worker.once("exit", onExit);
  });
}
