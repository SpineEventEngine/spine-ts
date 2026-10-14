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
import { Buffer } from "node:buffer";
import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { create, toBinary } from "@bufbuild/protobuf";
import { AnyMessages, StringifierRegistry, TypeRegistry, TypeUrls } from "@spine-event-engine/core";
import { InboxIdSchema } from "@spine-event-engine/proto/delivery";
import { classifyCrashReplay, completeInboxRows } from "./project-process-fault-observations.mjs";
import {
  PlanningIdSchema,
  PortfolioStateSchema,
  ProjectIdSchema,
  ProjectProjectionStateSchema,
  StaffingIdSchema,
  StaffingStateSchema,
} from "../dist/generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflowIds } from "../dist/test-fixtures/project-workflow.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const task = resolve(root, "build-protocol/tasks/sql-delivery-reliability");
const providerName = process.argv[2];
const scenario = process.argv[3];
const count = Number(process.argv[4]);
assert.ok([2, 8].includes(count));
assert.ok(
  [
    "before-effect",
    "after-save-before-ack",
    "partial-publication-repair",
    "shared-volatile-loss",
  ].includes(scenario),
);
const registry = JSON.parse(await readFile(resolve(task, "evidence/databases.json"), "utf8"));
const provider = registry.records.find((item) => item.name === providerName);
assert.ok(provider, `Unknown task provider ${String(providerName)}.`);
const runId = randomUUID().replaceAll("-", "");
const database = `sqlrel_fault_${runId}`;
const dir = resolve(task, "evidence/process-fault-runs", runId);
await mkdir(dir, { recursive: true });
const identity = { runId, database, evidencePath: dir };
await writeFile(resolve(dir, "resource.json"), `${JSON.stringify(identity, null, 2)}\n`);
process.stdout.write(`FAULT_RESOURCE ${JSON.stringify(identity)}\n`);

const artifactPaths = [
  "packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js",
  "packages/server-blackbox-tests/dist/generated/spine/server/testing/project_workflow_pb.js",
  "packages/server/dist/index.js",
  "packages/proto/dist/src/index.js",
  "packages/core/dist/index.js",
  "packages/storage/dist/index.js",
  "packages/storage-postgres/dist/index.js",
  "packages/storage-mysql/dist/index.js",
  "packages/delivery-client/dist/index.js",
  "packages/delivery-server/dist/index.js",
];
const artifacts = await Promise.all(
  artifactPaths.map(async (path) => ({
    path: resolve(root, path),
    sha256: createHash("sha256")
      .update(await readFile(resolve(root, path)))
      .digest("hex"),
  })),
);
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const runtimeTreePaths = [
  "packages/server-blackbox-tests/dist",
  "packages/server/dist",
  "packages/proto/dist",
  "packages/core/dist",
  "packages/storage/dist",
  "packages/storage-postgres/dist",
  "packages/storage-mysql/dist",
  "packages/delivery-client/dist",
  "packages/delivery-server/dist",
];
const runtimeFiles = [];
for (const path of runtimeTreePaths)
  runtimeFiles.push(...(await javascriptFiles(resolve(root, path))));
for (const path of [
  "packages/server-blackbox-tests/test-fixtures/project-worker.mjs",
  "packages/server-blackbox-tests/test-fixtures/shared-delivery-worker.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-process-faults.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-process-fault-observations.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-workflow.ts",
])
  runtimeFiles.push(resolve(root, path));
const runtimeHashes = await Promise.all(
  runtimeFiles.sort().map(async (path) => ({
    path: relative(root, path),
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  })),
);
const runtimeTreeSha256 = createHash("sha256").update(JSON.stringify(runtimeHashes)).digest("hex");
await writeFile(
  resolve(dir, "runtime-provenance.json"),
  `${JSON.stringify(
    {
      gitHead,
      runtimeTreeSha256,
      files: runtimeHashes,
    },
    null,
    2,
  )}\n`,
);
const postgres = provider.engine === "postgres";
const moduleName = postgres ? "storage-postgres" : "storage-mysql";
const requireProvider = createRequire(resolve(root, `packages/${moduleName}/package.json`));
const admin = postgres
  ? new (requireProvider("pg").Client)({ connectionString: provider.urls.spine_test })
  : await requireProvider("mysql2/promise").createConnection(provider.urls.spine_test);
const quotedDatabase = postgres ? `"${database}"` : `\`${database}\``;
const workers = [];
const entryLog = resolve(dir, "entries.jsonl");
const inboxTable = `inbox_fault_${runId.slice(0, 16)}`;
const organization = `fault-${runId}`;
const contextName = `ProjectFault_${runId}`;
const commandIds = [];
const expectedExits = new Set();
let delivery;
let deliveryReady;
let sql;
let ackFaultInstalled = false;
let insertFaultInstalled = false;
let databaseCreated = false;
let result;
let cleanup;
let failure;

try {
  if (postgres) await admin.connect();
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);
  databaseCreated = true;
  const url = new URL(provider.urls.spine_test);
  url.pathname = `/${database}`;
  sql = postgres
    ? new (requireProvider("pg").Client)({ connectionString: url.href })
    : await requireProvider("mysql2/promise").createConnection(url.href);
  if (postgres) await sql.connect();
  const settings = {
    engine: provider.engine,
    url: url.href,
    contextName,
    organization,
    number: 1,
    shards: count,
    entryLog,
    inboxTable,
    artifactPaths: artifacts.map((item) => item.path),
  };
  if (scenario === "shared-volatile-loss") {
    delivery = launch("shared-delivery-worker.mjs", "delivery");
    deliveryReady = await request(delivery, "start", {
      logPath: resolve(dir, "delivery.structured.jsonl"),
    });
    settings.deliveryEndpoint = deliveryReady.endpoint;
  }
  const evidence =
    scenario === "before-effect"
      ? await beforeEffect(settings)
      : scenario === "after-save-before-ack"
        ? await afterSaveBeforeAck(settings)
        : scenario === "partial-publication-repair"
          ? await partialPublicationRepair(settings)
          : await sharedVolatileLoss(settings);
  result = {
    status: "PASS",
    scenario,
    provider: provider.name,
    processes: count,
    runId,
    database,
    acknowledgedCommandIds: commandIds,
    artifacts,
    gitHead,
    runtimeTreeSha256,
    ...evidence,
  };
} catch (error) {
  failure = error;
  result = {
    status: "FAIL",
    scenario,
    provider: provider.name,
    processes: count,
    runId,
    database,
    acknowledgedCommandIds: commandIds,
    artifacts,
    gitHead,
    runtimeTreeSha256,
    error: String(error),
  };
} finally {
  const errors = [];
  const exits = [];
  for (const [index, worker] of workers.entries()) {
    if (worker.exitCode === null && worker.signalCode === null) {
      try {
        await request(worker, "close", {}, 5_000);
      } catch (error) {
        errors.push(`app close ${index}: ${String(error)}`);
      }
    }
    const exit = await stop(worker);
    exits.push(exit);
    if (exit.code !== 0 && !expectedExits.has(exit.pid))
      errors.push(`app ${exit.pid} exited ${String(exit.code)}/${String(exit.signal)}`);
  }
  let deliveryExit;
  if (delivery !== undefined) {
    if (delivery.exitCode === null && delivery.signalCode === null) {
      try {
        await request(delivery, "close", {}, 5_000);
      } catch (error) {
        errors.push(`delivery close: ${String(error)}`);
      }
    }
    deliveryExit = await stop(delivery);
    if (deliveryExit.code !== 0 && !expectedExits.has(deliveryExit.pid))
      errors.push(`delivery ${deliveryExit.pid} exited ${String(deliveryExit.code)}`);
  }
  let databaseDropped = false;
  if (ackFaultInstalled) {
    try {
      await dropAckBlock();
    } catch (error) {
      errors.push(`ack trigger removal: ${String(error)}`);
    }
  }
  if (insertFaultInstalled) {
    try {
      await dropInsertFault();
    } catch (error) {
      errors.push(`insert trigger removal: ${String(error)}`);
    }
  }
  try {
    await sql?.end();
  } catch (error) {
    errors.push(`SQL fault connection close: ${String(error)}`);
  }
  try {
    if (databaseCreated) {
      await admin.query(`DROP DATABASE ${quotedDatabase}${postgres ? " WITH (FORCE)" : ""}`);
      databaseDropped = true;
    }
  } catch (error) {
    errors.push(`database drop: ${String(error)}`);
  }
  try {
    await admin.end();
  } catch (error) {
    errors.push(`admin close: ${String(error)}`);
  }
  cleanup = { databaseDropped, exits, deliveryExit, errors };
  await writeFile(resolve(dir, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
}
if (result !== undefined) {
  if (cleanup.errors.length > 0) {
    result.status = "FAIL";
    result.cleanupErrors = cleanup.errors;
  }
  await writeFile(resolve(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "PASS") process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (failure !== undefined && cleanup.errors.length > 0)
  throw new AggregateError([failure, ...cleanup.errors], "Fault run and cleanup failed.");
if (failure !== undefined) throw failure;
if (cleanup.errors.length > 0)
  throw new Error(`Fault cleanup failed: ${cleanup.errors.join("; ")}`);

async function javascriptFiles(directory) {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) found.push(...(await javascriptFiles(path)));
    else if (item.isFile() && item.name.endsWith(".js")) found.push(path);
  }
  return found;
}

function launch(filename, label) {
  const child = fork(new URL(filename, import.meta.url), [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stderr.on("data", (bytes) => appendFileSync(resolve(dir, `${label}.stderr.log`), bytes));
  child.stdout.on("data", (bytes) => appendFileSync(resolve(dir, `${label}.stdout.log`), bytes));
  return child;
}

async function startWorkers(settings, label) {
  const started = [];
  for (let index = 0; index < count; index++) {
    const worker = launch("project-worker.mjs", `${label}-${index}`);
    workers.push(worker);
    started.push(
      request(worker, "start", {
        settings: { ...settings, logPath: resolve(dir, `${label}-${index}.structured.jsonl`) },
      }),
    );
  }
  const ready = await Promise.all(started);
  assert.equal(new Set(ready.map((item) => item.pid)).size, count);
  assert.ok(ready.every((item) => item.configuredShards === count));
  assert.ok(ready.every((item) => JSON.stringify(item.artifacts) === JSON.stringify(artifacts)));
  return ready;
}

async function post(worker, number) {
  const commandId = randomUUID();
  appendFileSync(resolve(dir, "commands.jsonl"), `${JSON.stringify({ commandId, number })}\n`, {
    flush: true,
  });
  const acknowledged = await request(worker, "post", { commandId, number });
  assert.equal(acknowledged.ackStatus?.case, "ok", "Crash evidence requires a received OK Ack.");
  commandIds.push(commandId);
  return acknowledged;
}

function expectedEntry(method, number) {
  const ids = projectWorkflowIds(organization, number);
  const selected =
    method === "planning"
      ? [PlanningIdSchema, ids.planning]
      : method === "create"
        ? [ProjectIdSchema, ids.project]
        : undefined;
  if (selected === undefined) throw new Error(`Unsupported gated method ${method}.`);
  const [schema, id] = selected;
  return {
    method,
    correlation: `${organization}:${number}`,
    recipientTypeUrl: TypeUrls.derive(schema),
    recipientIdBase64: Buffer.from(toBinary(schema, id)).toString("base64"),
  };
}

async function entries() {
  const text = await readFile(entryLog, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.trim().length === 0 ? [] : text.trim().split("\n").map(JSON.parse);
}

async function until(label, predicate, timeoutMs = 15_000, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value !== undefined && value !== false) return value;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function beforeEffect(settings) {
  const gated = expectedEntry("planning", 1);
  const releaseFile = resolve(dir, "release-planning");
  settings.handlerGate = { ...gated, releaseFile, timeoutMs: 10_000 };
  const ready = await startWorkers(settings, "initial");
  await post(workers[0], 1);
  const entered = await until("exact Planning entry", async () =>
    (await entries()).find((entry) =>
      Object.entries(gated).every(([key, value]) => entry[key] === value),
    ),
  );
  assert.ok(ready.some((worker) => worker.pid === entered.pid));
  const observer = workers.find((worker) => worker.pid !== entered.pid);
  const before = await request(observer, "inspect", { numbers: [1] });
  const original = before.events.find((event) => event.number === 1);
  assert.ok(original?.id && original.binaryBase64 && original.sha256);
  const preKillDelivery = await request(observer, "inspectDelivery");
  await writeFile(
    resolve(dir, "before-effect-pre-kill.json"),
    `${JSON.stringify({ entered, ready, before, preKillDelivery, entries: await entries() }, null, 2)}\n`,
  );
  assert.equal(before.projects[0].states.planning, false);
  const killed = workers.find((worker) => worker.pid === entered.pid);
  await killAndConfirm(killed);
  const postKill = await request(
    workers.find((worker) => worker.pid !== killed.pid),
    "inspect",
    { numbers: [1] },
  );
  const postKillDelivery = await request(
    workers.find((worker) => worker.pid !== killed.pid),
    "inspectDelivery",
  );
  await writeFile(
    resolve(dir, "before-effect-post-kill.json"),
    `${JSON.stringify({ killedPid: killed.pid, postKill, postKillDelivery, entries: await entries() }, null, 2)}\n`,
  );
  assert.equal(postKill.projects[0].states.planning, false);
  const surviving = workers.filter((worker) => worker !== killed);
  await Promise.all(surviving.map((worker) => request(worker, "close", {}, 5_000)));
  const stopped = await Promise.all(surviving.map((worker) => stop(worker)));
  for (const exit of stopped) assert.equal(exit.code, 0);
  workers.length = 0;
  delete settings.handlerGate;
  const restarted = await startWorkers(settings, "restarted");
  assert.ok(restarted.every((worker) => !ready.some((old) => old.pid === worker.pid)));
  const after = await until(
    "recovered complete Project workflow",
    async () => {
      const observation = await request(workers[0], "inspect", { numbers: [1] });
      return Object.values(observation.projects[0].states).every(Boolean) ? observation : undefined;
    },
    90_000,
  );
  const recovered = after.events.find((event) => event.number === 1);
  assert.equal(recovered.id, original.id);
  assert.equal(recovered.binaryBase64, original.binaryBase64);
  assert.equal(recovered.sha256, original.sha256);
  const allEntries = await entries();
  const recoveredDelivery = await request(workers[0], "inspectDelivery");
  await writeFile(
    resolve(dir, "before-effect-recovered-pre-assert.json"),
    `${JSON.stringify({ after, recoveredDelivery, allEntries, restartPids: restarted.map((worker) => worker.pid) }, null, 2)}\n`,
  );
  assert.equal(allEntries.filter((entry) => entry.method === "create").length, 1);
  const priorPids = ready.map((worker) => worker.pid);
  const freshPids = restarted.map((worker) => worker.pid);
  const replayable = [
    ["staffing", StaffingStateSchema],
    ["portfolio", PortfolioStateSchema],
    ["projection", ProjectProjectionStateSchema],
  ];
  const extraReplays = [];
  for (const [method, schema] of replayable) {
    const replay = classifyCrashReplay({
      preKillObservation: preKillDelivery,
      observation: postKillDelivery,
      shardCount: count,
      entries: allEntries,
      method,
      recipientTypeUrl: TypeUrls.derive(schema),
      originalEventId: original.id,
      priorPids,
      freshPids,
    });
    if (replay !== undefined)
      extraReplays.push({ ...replay, preKillEffect: before.projects[0].states[method] });
  }
  const planningEntries = allEntries.filter((entry) => entry.method === "planning");
  assert.equal(planningEntries.length, 2);
  assert.equal(
    planningEntries.filter((entry) => restarted.some((worker) => worker.pid === entry.pid)).length,
    1,
  );
  await writeFile(
    resolve(dir, "before-effect.json"),
    `${JSON.stringify(
      {
        acknowledgedCommandIds: commandIds,
        entered,
        before,
        postKill,
        after,
        allEntries,
        extraReplays,
        preKillDelivery,
        postKillDelivery,
        recoveredDelivery,
        planningEntryCount: planningEntries.length,
        killedPid: killed.pid,
        restartPids: restarted.map((worker) => worker.pid),
      },
      null,
      2,
    )}\n`,
  );
  return { killedPid: killed.pid, eventId: original.id, eventSha256: original.sha256 };
}

async function afterSaveBeforeAck(settings) {
  const gated = expectedEntry("planning", 1);
  const releaseFile = resolve(dir, "release-planning");
  settings.handlerGate = { ...gated, releaseFile, timeoutMs: 10_000 };
  const ready = await startWorkers(settings, "initial");
  await post(workers[0], 1);
  const entered = await until("exact Planning entry", async () =>
    (await entries()).find((entry) =>
      Object.entries(gated).every(([key, value]) => entry[key] === value),
    ),
  );
  const other = workers.find((worker) => worker.pid !== entered.pid);
  assert.ok(other);
  const before = await request(other, "inspect", { numbers: [1] });
  const original = before.events.find((event) => event.number === 1);
  assert.ok(original?.id && original.binaryBase64 && original.sha256);
  assert.equal(before.projects[0].states.planning, false);
  const pending = await until("exact pending Planning Inbox row", async () => {
    const inbox = await request(other, "inspectDelivery");
    return completeInboxRows(inbox, count).find(
      (row) =>
        row.signalId === original.id &&
        row.targetIdTypeUrl === gated.recipientTypeUrl &&
        row.targetIdBase64 === gated.recipientIdBase64 &&
        row.status === "TO_DELIVER",
    );
  });
  await installAckBlock(pending.messageId);
  await writeFile(releaseFile, "release\n");
  const saved = await until(
    "committed Planning state before acknowledgement",
    async () => {
      const observation = await request(other, "inspect", { numbers: [1] });
      if (!observation.projects[0].states.planning) return undefined;
      const inbox = await request(other, "inspectDelivery");
      const row = completeInboxRows(inbox, count).find(
        (candidate) => candidate.messageId === pending.messageId,
      );
      return row?.status === "TO_DELIVER" ? { observation, row } : undefined;
    },
    15_000,
  );
  const killed = workers.find((worker) => worker.pid === entered.pid);
  assert.ok(killed);
  await killAndConfirm(killed);
  const survivors = workers.filter((worker) => worker !== killed);
  await Promise.all(survivors.map((worker) => killAndConfirm(worker)));
  const attempts = await ackAttempts();
  assert.ok(attempts >= 1, "The selected SQL acknowledgement trigger must have run.");
  const preRestartStatus = await rawInboxStatus(pending.messageId);
  assert.equal(preRestartStatus, 1, "The old workers must leave the exact row pending.");
  await writeFile(
    resolve(dir, "ack-pre-restart.json"),
    `${JSON.stringify(
      {
        acknowledgedCommandIds: commandIds,
        entered,
        pending,
        saved,
        attempts,
        preRestartStatus,
        oldPids: ready.map((worker) => worker.pid),
        entries: await entries(),
      },
      null,
      2,
    )}\n`,
  );
  await dropAckBlock();
  ackFaultInstalled = false;
  await installAckAudit(pending.messageId);
  workers.length = 0;
  delete settings.handlerGate;
  const restarted = await startWorkers(settings, "restarted");
  assert.ok(restarted.every((worker) => !ready.some((old) => old.pid === worker.pid)));
  let recovered;
  try {
    recovered = await until(
      "committed recovered Planning acknowledgement",
      async () => {
        if ((await ackAuditCount()) === 0) return undefined;
        const inbox = await request(workers[0], "inspectDelivery");
        const row = completeInboxRows(inbox, count).find(
          (candidate) => candidate.messageId === pending.messageId,
        );
        assert.ok(row === undefined || row.status === "DELIVERED");
        return { auditCount: await ackAuditCount(), row: row ?? null };
      },
      process.env.SPINE_TS_FAULT_DIAGNOSTIC_SHORT === "1" ? 25_000 : 90_000,
    );
  } catch (error) {
    const observations = await Promise.allSettled(
      workers.map(async (worker) => ({
        pid: worker.pid,
        inbox: await request(worker, "inspectDelivery"),
        state: await request(worker, "inspect", { numbers: [1] }),
      })),
    );
    await writeFile(
      resolve(dir, "ack-recovery-failed.json"),
      `${JSON.stringify(
        {
          error: String(error),
          restartPids: restarted.map((worker) => worker.pid),
          entries: await entries(),
          observations: observations.map((item) =>
            item.status === "fulfilled" ? item.value : { error: String(item.reason) },
          ),
          sqlCatalog: await sqlStateCatalog().catch((failure) => ({ error: String(failure) })),
        },
        null,
        2,
      )}\n`,
    );
    throw error;
  }
  const after = await request(workers[0], "inspect", { numbers: [1] });
  assert.ok(Object.values(after.projects[0].states).every(Boolean));
  const freshPlanningEntries = (await entries()).filter(
    (entry) => entry.method === "planning" && restarted.some((worker) => worker.pid === entry.pid),
  );
  assert.equal(freshPlanningEntries.length, 1);
  const planningEntries = (await entries()).filter((entry) => entry.method === "planning");
  assert.equal(
    planningEntries.length,
    2,
    "Crash before acknowledgement may replay the handler once.",
  );
  const retained = after.events.find((event) => event.number === 1);
  assert.equal(retained?.id, original.id);
  assert.equal(retained?.binaryBase64, original.binaryBase64);
  assert.equal(retained?.sha256, original.sha256);
  assert.equal((await entries()).filter((entry) => entry.method === "create").length, 1);
  for (const method of ["staffing", "portfolio", "projection"])
    assert.equal((await entries()).filter((entry) => entry.method === method).length, 1);
  await writeFile(
    resolve(dir, "after-save-before-ack.json"),
    `${JSON.stringify(
      {
        acknowledgedCommandIds: commandIds,
        entered,
        pending,
        saved,
        attempts,
        preRestartStatus,
        killedPid: killed.pid,
        recovered,
        original,
        after,
        entries: await entries(),
      },
      null,
      2,
    )}\n`,
  );
  return { killedPid: killed.pid, eventId: original.id, ackAttempts: attempts };
}

async function rawInboxStatus(messageId) {
  assert.match(messageId, /^[0-9a-f-]{36}$/u);
  const result =
    await sql.query(`SELECT status FROM ${postgres ? `"${inboxTable}"` : `\`${inboxTable}\``}
    WHERE message_id = '${messageId}'`);
  const rows = postgres ? result.rows : result[0];
  assert.equal(rows.length, 1, "Expected one exact SQL Inbox row before restart.");
  return Number(rows[0].status);
}

async function sqlStateCatalog() {
  const result = await sql.query(
    postgres
      ? "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
      : "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position",
  );
  const columns = postgres ? result.rows : result[0];
  const names = [...new Set(columns.map((row) => row.table_name))].filter(
    (name) => /planning|history|inbox/iu.test(name) && /^[A-Za-z0-9_]+$/u.test(name),
  );
  const rows = await Promise.all(
    names.map(async (name) => {
      const query = `SELECT * FROM ${postgres ? `"${name}"` : `\`${name}\``} LIMIT 3`;
      const response = await sql.query(query);
      return { table: name, rows: postgres ? response.rows : response[0] };
    }),
  );
  return JSON.parse(
    JSON.stringify({ columns, rows }, (_key, value) =>
      typeof value === "bigint" ? String(value) : value,
    ),
  );
}

async function installAckBlock(messageId) {
  assert.match(messageId, /^[0-9a-f-]{36}$/u);
  if (postgres) {
    await sql.query("CREATE SEQUENCE fault_ack_attempts");
    await sql.query(`CREATE FUNCTION block_fault_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.message_id = '${messageId}' AND NEW.status = 3 THEN
          PERFORM nextval('fault_ack_attempts');
          PERFORM pg_sleep(20);
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'task blocked acknowledgement';
        END IF;
        RETURN NEW;
      END $$`);
    await sql.query(`CREATE TRIGGER block_fault_ack BEFORE UPDATE ON "${inboxTable}"
      FOR EACH ROW EXECUTE FUNCTION block_fault_ack()`);
  } else {
    await sql.query(
      "CREATE TABLE fault_ack_attempts(id integer PRIMARY KEY, attempts integer NOT NULL) ENGINE=MyISAM",
    );
    await sql.query("INSERT INTO fault_ack_attempts VALUES (1, 0)");
    await sql.query(`CREATE TRIGGER block_fault_ack BEFORE UPDATE ON \`${inboxTable}\` FOR EACH ROW
      BEGIN
        IF NEW.message_id = '${messageId}' AND NEW.status = 3 THEN
          UPDATE fault_ack_attempts SET attempts = attempts + 1 WHERE id = 1;
          DO SLEEP(20);
          SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'task blocked acknowledgement';
        END IF;
      END`);
  }
  ackFaultInstalled = true;
}

async function ackAttempts() {
  const result = await sql.query(
    postgres
      ? "SELECT last_value AS attempts FROM fault_ack_attempts"
      : "SELECT attempts FROM fault_ack_attempts",
  );
  const rows = postgres ? result.rows : result[0];
  return Number(rows[0]?.attempts ?? 0);
}

async function installAckAudit(messageId) {
  assert.match(messageId, /^[0-9a-f-]{36}$/u);
  if (postgres) {
    await sql.query("CREATE TABLE fault_ack_audit(message_id text NOT NULL)");
    await sql.query(`CREATE FUNCTION audit_fault_ack() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.message_id = '${messageId}' AND NEW.status = 3 THEN
          INSERT INTO fault_ack_audit(message_id) VALUES (NEW.message_id);
        END IF;
        RETURN NEW;
      END $$`);
    await sql.query(`CREATE TRIGGER audit_fault_ack AFTER UPDATE ON "${inboxTable}"
      FOR EACH ROW EXECUTE FUNCTION audit_fault_ack()`);
  } else {
    await sql.query("CREATE TABLE fault_ack_audit(message_id varchar(36) NOT NULL) ENGINE=InnoDB");
    await sql.query(`CREATE TRIGGER audit_fault_ack AFTER UPDATE ON \`${inboxTable}\` FOR EACH ROW
      BEGIN
        IF NEW.message_id = '${messageId}' AND NEW.status = 3 THEN
          INSERT INTO fault_ack_audit(message_id) VALUES (NEW.message_id);
        END IF;
      END`);
  }
}

async function ackAuditCount() {
  const result = await sql.query("SELECT COUNT(*) AS acknowledgements FROM fault_ack_audit");
  const rows = postgres ? result.rows : result[0];
  return Number(rows[0]?.acknowledgements ?? 0);
}

async function dropAckBlock() {
  if (!ackFaultInstalled) return;
  await sql.query(
    postgres
      ? `DROP TRIGGER IF EXISTS block_fault_ack ON "${inboxTable}"`
      : "DROP TRIGGER IF EXISTS block_fault_ack",
  );
  if (postgres) {
    await sql.query("DROP FUNCTION IF EXISTS block_fault_ack()");
    await sql.query("DROP SEQUENCE IF EXISTS fault_ack_attempts");
  } else {
    await sql.query("DROP TABLE IF EXISTS fault_ack_attempts");
  }
}

async function partialPublicationRepair(settings) {
  const target = projectWorkflowIds(organization, 1).staffing;
  const typedTarget = {
    targetIdTypeUrl: TypeUrls.derive(StaffingIdSchema),
    targetIdBase64: Buffer.from(toBinary(StaffingIdSchema, target)).toString("base64"),
  };
  const ready = await startWorkers(settings, "initial");
  await installInsertFault(target);
  await post(workers[0], 1);
  const partial = await until(
    "saved Event and partial recipient admission",
    async () => {
      const snapshot = await request(workers[0], "inspect", { numbers: [1] });
      const original = snapshot.events.find((event) => event.number === 1);
      if (original === undefined) return undefined;
      const inbox = await request(workers[0], "inspectDelivery");
      const rows = completeInboxRows(inbox, count);
      const prefix = rows.filter((row) => row.signalId === original.id);
      if (prefix.length === 0 || (await insertAttempts()) === 0) return undefined;
      assert.ok(
        prefix.every(
          (row) =>
            row.targetIdTypeUrl !== typedTarget.targetIdTypeUrl ||
            row.targetIdBase64 !== typedTarget.targetIdBase64,
        ),
      );
      return { snapshot, original, prefix };
    },
    30_000,
  );
  assert.ok(partial.original.binaryBase64 && partial.original.sha256);
  await writeFile(
    resolve(dir, "partial-before-exhaustion.json"),
    `${JSON.stringify(partial, null, 2)}\n`,
  );
  const exhausted = await until(
    "finite insert exhaustion, settled Command, and completed Planning prefix",
    async () => {
      const failedInsertAttempts = await insertAttempts();
      if (failedInsertAttempts < 3) return undefined;
      const snapshot = await request(workers[0], "inspect", { numbers: [1] });
      if (!snapshot.projects[0].states.planning || snapshot.projects[0].states.staffing)
        return undefined;
      const inbox = await request(workers[0], "inspectDelivery");
      const rows = completeInboxRows(inbox, count);
      const commandRows = rows.filter((row) => row.signalId === commandIds[0]);
      const prefix = rows.find(
        (row) =>
          row.signalId === partial.original.id &&
          row.targetIdTypeUrl === TypeUrls.derive(PlanningIdSchema),
      );
      if (commandRows.some((row) => row.status === "TO_DELIVER") || prefix?.status !== "DELIVERED")
        return undefined;
      assert.ok(
        rows.every(
          (row) =>
            row.signalId !== partial.original.id ||
            row.targetIdTypeUrl !== typedTarget.targetIdTypeUrl ||
            row.targetIdBase64 !== typedTarget.targetIdBase64,
        ),
      );
      return { failedInsertAttempts, commandRows, prefix, snapshot };
    },
    15_000,
  );
  const { failedInsertAttempts } = exhausted;
  await writeFile(
    resolve(dir, "publication-exhaustion.json"),
    `${JSON.stringify(exhausted, null, 2)}\n`,
  );
  await dropInsertFault();
  insertFaultInstalled = false;
  await Promise.all(workers.map((worker) => killAndConfirm(worker)));
  workers.length = 0;
  const restarted = await startWorkers(settings, "restarted");
  assert.ok(restarted.every((worker) => !ready.some((old) => old.pid === worker.pid)));
  const repairs = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      request(workers[index % workers.length], "republish", {
        eventIds: [partial.original.id],
      }),
    ),
  );
  for (const repair of repairs)
    assert.deepEqual(
      repair.map((outcome) => [outcome.eventId, outcome.status]),
      [[partial.original.id, "ADMITTED"]],
    );
  const after = await until(
    "repaired complete Project workflow",
    async () => {
      const observation = await request(workers[0], "inspect", { numbers: [1] });
      return Object.values(observation.projects[0].states).every(Boolean) ? observation : undefined;
    },
    30_000,
  );
  const retained = after.events.find((event) => event.number === 1);
  assert.equal(retained?.id, partial.original.id);
  assert.equal(retained?.binaryBase64, partial.original.binaryBase64);
  assert.equal(retained?.sha256, partial.original.sha256);
  const allEntries = await entries();
  for (const method of ["create", "planning", "staffing", "portfolio", "projection"])
    assert.equal(allEntries.filter((entry) => entry.method === method).length, 1);
  assert.ok(
    allEntries.some(
      (entry) =>
        entry.method === "staffing" &&
        entry.correlation === `${organization}:1` &&
        entry.recipientTypeUrl === typedTarget.targetIdTypeUrl &&
        entry.recipientIdBase64 === typedTarget.targetIdBase64,
    ),
  );
  let latestInbox;
  let deliveredRecipients;
  try {
    deliveredRecipients = await until(
      "four distinct delivered original Event recipients before cleanup",
      async () => {
        latestInbox = await request(workers[0], "inspectDelivery");
        const rows = completeInboxRows(latestInbox, count).filter(
          (row) => row.signalId === partial.original.id,
        );
        const delivered = rows.filter((row) => row.status === "DELIVERED");
        const distinct = new Set(
          delivered.map((row) => `${row.targetIdTypeUrl}:${row.targetIdBase64}`),
        );
        return distinct.size === 4 ? { rows, delivered } : undefined;
      },
      15_000,
    );
  } catch (error) {
    await writeFile(
      resolve(dir, "retained-recipient-diagnostic.json"),
      `${JSON.stringify({ error: String(error), latestInbox, entries: await entries() }, null, 2)}\n`,
    );
    throw error;
  }
  let latestCleanupInbox;
  let cleaned;
  const cleanupTrace = [];
  let lastCleanupTrace = 0;
  try {
    cleaned = await until(
      "runtime cleanup of all original Event recipient rows",
      async () => {
        latestCleanupInbox = await request(workers[0], "inspectDelivery");
        const rows = completeInboxRows(latestCleanupInbox, count).filter(
          (row) => row.signalId === partial.original.id,
        );
        if (Date.now() - lastCleanupTrace >= 5_000) {
          cleanupTrace.push({ at: Date.now(), rows, source: latestCleanupInbox.observations });
          lastCleanupTrace = Date.now();
        }
        return rows.length === 0 ? { inbox: latestCleanupInbox, at: Date.now() } : undefined;
      },
      65_000,
      250,
    );
  } catch (error) {
    await writeFile(
      resolve(dir, "post-cleanup-diagnostic.json"),
      `${JSON.stringify({ error: String(error), deliveredRecipients, cleanupTrace, latestCleanupInbox, entries: await entries() }, null, 2)}\n`,
    );
    throw error;
  }
  const beforePostCleanupRepair = {
    at: Date.now(),
    entries: await entries(),
    state: await request(workers[0], "inspect", { numbers: [1] }),
    inbox: await request(workers[0], "inspectDelivery"),
  };
  await writeFile(
    resolve(dir, "before-post-cleanup-repair.json"),
    `${JSON.stringify(beforePostCleanupRepair, null, 2)}\n`,
  );
  const beforeColdRestartPids = workers.map((worker) => worker.pid);
  await Promise.all(workers.map((worker) => killAndConfirm(worker)));
  workers.length = 0;
  const postCleanupWorkers = await startWorkers(settings, "post-cleanup");
  assert.ok(postCleanupWorkers.every((worker) => !beforeColdRestartPids.includes(worker.pid)));
  const repairStartedAt = Date.now();
  const postCleanupReplay = await request(workers[0], "republish", {
    eventIds: [partial.original.id],
  });
  const repairEndedAt = Date.now();
  assert.deepEqual(
    postCleanupReplay.map((outcome) => [outcome.eventId, outcome.status]),
    [[partial.original.id, "ADMITTED"]],
  );
  const replayTrace = [];
  let lastReplayTrace = 0;
  let replayEntries;
  let settledInbox;
  const methods = ["planning", "staffing", "portfolio", "projection"];
  const initialCounts = methods.map(
    (method) => beforePostCleanupRepair.entries.filter((entry) => entry.method === method).length,
  );
  try {
    replayEntries = await until(
      "resolution of post-cleanup Event receipts",
      async () => {
        const observed = await entries();
        const counts = methods.map(
          (method) => observed.filter((entry) => entry.method === method).length,
        );
        assert.ok(counts.every((value, index) => value <= initialCounts[index] + 1));
        const inbox = await request(workers[0], "inspectDelivery");
        const rows = completeInboxRows(inbox, count).filter(
          (row) => row.signalId === partial.original.id,
        );
        if (Date.now() - lastReplayTrace >= 2_000 || replayTrace.length === 0) {
          replayTrace.push({ at: Date.now(), inbox, counts, entries: observed });
          lastReplayTrace = Date.now();
        }
        if (rows.some((row) => row.status === "TO_DELIVER")) return undefined;
        if (!counts.every((value, index) => value === initialCounts[index] + 1)) return undefined;
        settledInbox = inbox;
        return observed;
      },
      30_000,
    );
  } catch (error) {
    await writeFile(
      resolve(dir, "post-replay-diagnostic.json"),
      `${JSON.stringify({ error: String(error), deliveredRecipients, cleanupTrace, cleaned, beforePostCleanupRepair, beforeColdRestartPids, postCleanupPids: postCleanupWorkers.map((worker) => worker.pid), repairStartedAt, repairEndedAt, postCleanupReplay, replayTrace, entries: await entries(), state: await request(workers[0], "inspect", { numbers: [1] }) }, null, 2)}\n`,
    );
    throw error;
  }
  assert.equal(replayEntries.filter((entry) => entry.method === "create").length, 1);
  const finalCounts = methods.map(
    (method) => replayEntries.filter((entry) => entry.method === method).length,
  );
  const resolvedRows = completeInboxRows(settledInbox, count).filter(
    (row) => row.signalId === partial.original.id,
  );
  assert.equal(resolvedRows.length, 4);
  assert.equal(
    new Set(resolvedRows.map((row) => `${row.targetIdTypeUrl}:${row.targetIdBase64}`)).size,
    4,
  );
  assert.ok(resolvedRows.every((row) => row.status === "DELIVERED"));
  const afterReplay = await request(workers[0], "inspect", { numbers: [1] });
  assert.ok(Object.values(afterReplay.projects[0].states).every(Boolean));
  const replayedEvent = afterReplay.events.find((event) => event.number === 1);
  assert.equal(replayedEvent?.id, partial.original.id);
  assert.equal(replayedEvent?.binaryBase64, partial.original.binaryBase64);
  assert.equal(replayedEvent?.sha256, partial.original.sha256);
  await writeFile(
    resolve(dir, "partial-publication-repair.json"),
    `${JSON.stringify(
      {
        acknowledgedCommandIds: commandIds,
        partial,
        exhausted,
        failedInsertAttempts,
        restartPids: restarted.map((worker) => worker.pid),
        repairs,
        after,
        entries: allEntries,
        deliveredRecipients,
        cleanupTrace,
        cleaned,
        beforePostCleanupRepair,
        beforeColdRestartPids,
        postCleanupPids: postCleanupWorkers.map((worker) => worker.pid),
        repairStartedAt,
        repairEndedAt,
        postCleanupReplay,
        replayTrace,
        initialCounts,
        finalCounts,
        resolvedRows,
        afterReplay,
        replayEntries,
      },
      null,
      2,
    )}\n`,
  );
  return {
    eventId: partial.original.id,
    eventSha256: partial.original.sha256,
    failedInsertAttempts,
    repairs,
    postCleanupReplay,
  };
}

async function installInsertFault(target) {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([StaffingIdSchema]));
  const encoded = stringifiers.forMessage(InboxIdSchema).toString(
    create(InboxIdSchema, {
      entityId: { id: AnyMessages.pack(StaffingIdSchema, target) },
      typeUrl: TypeUrls.derive(StaffingStateSchema),
    }),
  );
  const hex = Buffer.from(encoded, "utf8").toString("hex");
  const comparison = postgres
    ? `convert_from(decode('${hex}', 'hex'), 'UTF8')`
    : `CONVERT(UNHEX('${hex}') USING utf8mb4)`;
  if (postgres) {
    await sql.query("CREATE SEQUENCE fault_insert_attempts");
    await sql.query(`CREATE FUNCTION fail_fault_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.inbox_id = ${comparison} THEN
          PERFORM nextval('fault_insert_attempts');
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'task injected target admission fault';
        END IF;
        RETURN NEW;
      END $$`);
    await sql.query(`CREATE TRIGGER fail_fault_insert BEFORE INSERT ON "${inboxTable}"
      FOR EACH ROW EXECUTE FUNCTION fail_fault_insert()`);
  } else {
    await sql.query(
      "CREATE TABLE fault_insert_attempts(id integer PRIMARY KEY, attempts integer NOT NULL) ENGINE=MyISAM",
    );
    await sql.query("INSERT INTO fault_insert_attempts VALUES (1, 0)");
    await sql.query(`CREATE TRIGGER fail_fault_insert BEFORE INSERT ON \`${inboxTable}\` FOR EACH ROW
      BEGIN
        IF NEW.inbox_id = ${comparison} THEN
          UPDATE fault_insert_attempts SET attempts = attempts + 1 WHERE id = 1;
          SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 1644,
            MESSAGE_TEXT = 'task injected target admission fault';
        END IF;
      END`);
  }
  insertFaultInstalled = true;
}

async function insertAttempts() {
  const result = await sql.query(
    postgres
      ? "SELECT last_value AS attempts FROM fault_insert_attempts"
      : "SELECT attempts FROM fault_insert_attempts",
  );
  const rows = postgres ? result.rows : result[0];
  return Number(rows[0]?.attempts ?? 0);
}

async function dropInsertFault() {
  if (!insertFaultInstalled) return;
  await sql.query(
    postgres
      ? `DROP TRIGGER IF EXISTS fail_fault_insert ON "${inboxTable}"`
      : "DROP TRIGGER IF EXISTS fail_fault_insert",
  );
  if (postgres) {
    await sql.query("DROP FUNCTION IF EXISTS fail_fault_insert()");
    await sql.query("DROP SEQUENCE IF EXISTS fault_insert_attempts");
  } else {
    await sql.query("DROP TABLE IF EXISTS fault_insert_attempts");
  }
}

async function sharedVolatileLoss(settings) {
  const gated = expectedEntry("create", 2);
  const releaseFile = resolve(dir, "release-second-command");
  settings.handlerGate = { ...gated, releaseFile, timeoutMs: 10_000 };
  const firstReady = await startWorkers(settings, "initial");
  await post(workers[0], 1);
  const seed = await until("seeded Project and original Event", async () => {
    const observation = await request(workers[0], "inspect", { numbers: [1] });
    return Object.values(observation.projects[0].states).every(Boolean) &&
      observation.events.length === 1
      ? observation
      : undefined;
  });
  const original = seed.events.find((event) => event.number === 1);
  assert.ok(original?.id && original.sha256 && original.binaryBase64);
  const submitted = post(workers[0], 2);
  const entered = await until("second accepted CreateProject entry", async () =>
    (await entries()).find((entry) =>
      Object.entries(gated).every(([key, value]) => entry[key] === value),
    ),
  );
  await submitted;
  const inspectWorker = workers.find((worker) => worker.pid !== entered.pid);
  assert.ok(inspectWorker);
  const before = await request(inspectWorker, "inspect", { numbers: [1, 2] });
  assert.equal(before.projects[1].states.project, false);
  const pending = await until("volatile pending accepted Command row", async () => {
    const inbox = await request(inspectWorker, "inspectDelivery");
    return completeInboxRows(inbox, count).find(
      (row) =>
        row.signalId === commandIds[1] &&
        row.signalTypeUrl === "type.spine.io/spine.core.Command" &&
        row.targetIdTypeUrl === gated.recipientTypeUrl &&
        row.targetIdBase64 === gated.recipientIdBase64 &&
        row.status === "TO_DELIVER",
    );
  });
  await writeFile(
    resolve(dir, "shared-before-crash.json"),
    `${JSON.stringify(
      {
        firstReady,
        deliveryPid: deliveryReady.pid,
        acknowledgedCommandIds: commandIds,
        entered,
        seed,
        before,
        pending,
        entries: await entries(),
      },
      null,
      2,
    )}\n`,
  );
  await Promise.all([delivery, ...workers].map((child) => killAndConfirm(child)));
  workers.length = 0;
  delete settings.handlerGate;
  delivery = launch("shared-delivery-worker.mjs", "restarted-delivery");
  deliveryReady = await request(delivery, "start", {
    logPath: resolve(dir, "restarted-delivery.structured.jsonl"),
  });
  settings.deliveryEndpoint = deliveryReady.endpoint;
  const secondReady = await startWorkers(settings, "restarted");
  await new Promise((resolve) => setTimeout(resolve, 12_000));
  const after = await request(workers[0], "inspect", { numbers: [1, 2] });
  const retained = after.events.find((event) => event.number === 1);
  assert.equal(retained?.id, original.id);
  assert.equal(retained?.binaryBase64, original.binaryBase64);
  assert.equal(retained?.sha256, original.sha256);
  assert.ok(Object.values(after.projects[0].states).every(Boolean));
  assert.equal(after.projects[1].states.project, false);
  assert.equal(
    after.events.some((event) => event.number === 2),
    false,
  );
  const newInbox = await request(workers[0], "inspectDelivery");
  assert.equal(
    completeInboxRows(newInbox, count).some(
      (row) => row.messageId === pending.messageId || row.signalId === commandIds[1],
    ),
    false,
  );
  assert.equal(
    (await entries()).filter(
      (entry) => entry.method === "create" && entry.correlation === `${organization}:2`,
    ).length,
    1,
  );
  await writeFile(
    resolve(dir, "shared-after-restart.json"),
    `${JSON.stringify(
      {
        secondReady,
        deliveryPid: deliveryReady.pid,
        seed,
        pending,
        after,
        newInbox,
        entries: await entries(),
      },
      null,
      2,
    )}\n`,
  );
  return {
    lostPendingMessageId: pending.messageId,
    retainedEventId: original.id,
    retainedEventSha256: original.sha256,
    initialPids: firstReady.map((worker) => worker.pid),
    restartPids: secondReady.map((worker) => worker.pid),
  };
}

async function stop(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null)
    return { pid: worker.pid, code: worker.exitCode, signal: worker.signalCode };
  if (worker.connected) worker.disconnect();
  let exit = await waitExit(worker, 2_000);
  if (exit === undefined) {
    worker.kill("SIGTERM");
    exit = await waitExit(worker, 2_000);
  }
  if (exit === undefined) {
    worker.kill("SIGKILL");
    exit = await waitExit(worker, 2_000);
  }
  return { pid: worker.pid, ...(exit ?? { code: null, signal: "UNREAPED" }) };
}

function waitExit(worker, timeoutMs) {
  if (worker.exitCode !== null || worker.signalCode !== null)
    return Promise.resolve({ code: worker.exitCode, signal: worker.signalCode });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.off("exit", onExit);
      resolve(undefined);
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    worker.once("exit", onExit);
  });
}

async function killAndConfirm(worker) {
  assert.ok(worker?.pid !== undefined);
  assert.equal(worker.kill("SIGKILL"), true, `Could not signal process ${worker.pid}.`);
  const exit = await waitExit(worker, 2_000);
  assert.equal(exit?.signal, "SIGKILL", `Process ${worker.pid} did not exit by SIGKILL.`);
  expectedExits.add(worker.pid);
  return exit;
}

function request(worker, kind, fields = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("disconnect", onDisconnect);
      worker.off("exit", onExit);
      if (error === undefined) resolve(value);
      else reject(error);
    };
    const timer = setTimeout(
      () => finish(new Error(`Worker ${worker.pid} did not respond to ${kind}.`)),
      timeoutMs,
    );
    const onMessage = (message) => {
      if (message.requestId !== requestId) return;
      if (message.ok) finish(undefined, message.result);
      else finish(new Error(`Worker ${worker.pid} ${kind}: ${message.error}`));
    };
    const onError = (error) =>
      finish(new Error(`Worker ${worker.pid} IPC error.`, { cause: error }));
    const onDisconnect = () => finish(new Error(`Worker ${worker.pid} disconnected.`));
    const onExit = (code) => finish(new Error(`Worker ${worker.pid} exited ${String(code)}.`));
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("disconnect", onDisconnect);
    worker.on("exit", onExit);
    try {
      worker.send({ requestId, kind, ...fields }, (error) => {
        if (error !== null && error !== undefined) onError(error);
      });
    } catch (error) {
      onError(error);
    }
  });
}
