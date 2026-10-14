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
import { setTimeout, clearTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { toBinary } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { EventSchema } from "@spine-event-engine/proto";
import {
  PlanningIdSchema,
  PlanningStateSchema,
  PortfolioStateSchema,
  ProjectProjectionStateSchema,
  StaffingIdSchema,
  StaffingStateSchema,
} from "../dist/generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflowIds } from "../dist/test-fixtures/project-workflow.js";
import { classifyCrashReplay, completeInboxRows } from "./project-process-fault-observations.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const task = resolve(root, "build-protocol/tasks/sql-delivery-reliability");
const [providerName, countText, timeoutText] = process.argv.slice(2);
const count = Number(countText);
const processingTimeoutSeconds = Number(timeoutText);
assert.ok([2, 8].includes(count), "Replacement worker count must be 2 or 8.");
assert.ok(
  [0, 10].includes(processingTimeoutSeconds),
  "Processing timeout must be 0 or 10 seconds.",
);
const providers = JSON.parse(await readFile(resolve(task, "evidence/databases.json"), "utf8"));
const provider = providers.records.find((candidate) => candidate.name === providerName);
assert.ok(provider, `Unknown task SQL provider ${String(providerName)}.`);
const runId = randomUUID().replaceAll("-", "");
const database = `sqlrel_takeover_${runId}`;
const dir = resolve(task, "evidence/shared-takeover-runs", runId);
await mkdir(dir, { recursive: true });
const identity = { runId, database, evidencePath: dir };
await writeFile(resolve(dir, "resource.json"), `${JSON.stringify(identity, null, 2)}\n`);
process.stdout.write(`TAKEOVER_RESOURCE ${JSON.stringify(identity)}\n`);

const postgres = provider.engine === "postgres";
const requireProvider = createRequire(
  resolve(root, `packages/${postgres ? "storage-postgres" : "storage-mysql"}/package.json`),
);
const admin = postgres
  ? new (requireProvider("pg").Client)({ connectionString: provider.urls.spine_test })
  : await requireProvider("mysql2/promise").createConnection(provider.urls.spine_test);
const quotedDatabase = postgres ? `"${database}"` : `\`${database}\``;
const children = [];
const expectedKills = new Set();
let created = false;
let outcome;
let failure;
let cleanup;

try {
  if (postgres) await admin.connect();
  await admin.query(`CREATE DATABASE ${quotedDatabase}`);
  created = true;
  const url = new URL(provider.urls.spine_test);
  url.pathname = `/${database}`;
  const organization = `takeover-${runId}`;
  const contextName = `ProjectTakeover_${runId}`;
  const entryLog = resolve(dir, "entries.jsonl");
  const artifactPaths = [
    "packages/server/dist/index.js",
    "packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js",
    "packages/server-blackbox-tests/dist/generated/spine/server/testing/project_workflow_pb.js",
    "packages/delivery-server/dist/index.js",
    "packages/delivery-client/dist/index.js",
  ].map((path) => resolve(root, path));
  const artifacts = await Promise.all(
    artifactPaths.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const runtimeFiles = [];
  for (const directory of [
    "packages/server-blackbox-tests/dist",
    "packages/server/dist",
    "packages/proto/dist",
    "packages/core/dist",
    "packages/storage/dist",
    "packages/storage-postgres/dist",
    "packages/storage-mysql/dist",
    "packages/delivery-client/dist",
    "packages/delivery-server/dist",
  ])
    runtimeFiles.push(...(await javascriptFiles(resolve(root, directory))));
  for (const path of [
    "packages/server-blackbox-tests/test-fixtures/project-shared-takeover.mjs",
    "packages/server-blackbox-tests/test-fixtures/retained-delivery-worker.mjs",
    "packages/server-blackbox-tests/test-fixtures/project-worker.mjs",
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
  const runtimeTreeSha256 = createHash("sha256")
    .update(JSON.stringify(runtimeHashes))
    .digest("hex");
  await writeFile(
    resolve(dir, "provenance.json"),
    `${JSON.stringify({ gitHead, artifacts, runtimeTreeSha256, files: runtimeHashes }, null, 2)}\n`,
  );
  const server = launch("retained-delivery-worker.mjs", "delivery");
  const serverReady = await request(server, "start", {
    processingTimeoutSeconds,
    logPath: resolve(dir, "delivery.structured.jsonl"),
  });
  assert.equal(serverReady.pid, server.pid);
  assert.equal(serverReady.processingTimeoutSeconds, processingTimeoutSeconds);
  const ids = projectWorkflowIds(organization, 1);
  const candidates = [
    { method: "planning", schema: PlanningIdSchema, id: ids.planning },
    { method: "staffing", schema: StaffingIdSchema, id: ids.staffing },
  ].map(({ method, schema, id }) => ({
    method,
    correlation: `${organization}:1`,
    recipientTypeUrl: TypeUrls.derive(schema),
    recipientIdBase64: Buffer.from(toBinary(schema, id)).toString("base64"),
  }));
  const settings = {
    engine: provider.engine,
    url: url.href,
    contextName,
    organization,
    number: 1,
    shards: count,
    entryLog,
    inboxTable: `inbox_takeover_${runId.slice(0, 16)}`,
    artifactPaths,
    deliveryEndpoint: serverReady.endpoint,
  };
  const gated = launch("project-worker.mjs", "gated");
  const releaseFile = resolve(dir, "release-recipient");
  const gatedReady = await request(gated, "start", {
    settings: {
      ...settings,
      handlerGateCandidates: candidates.map((candidate) => ({
        ...candidate,
        releaseFile,
        timeoutMs: 10_000,
      })),
      logPath: resolve(dir, "gated.structured.jsonl"),
    },
  });
  assert.equal(gatedReady.pid, gated.pid);
  const commandId = randomUUID();
  appendFileSync(resolve(dir, "commands.jsonl"), `${JSON.stringify({ commandId, number: 1 })}\n`, {
    flush: true,
  });
  const acknowledged = await request(gated, "post", { commandId, number: 1 });
  assert.equal(acknowledged.ackStatus?.case, "ok", "The public Command Ack must be received.");
  const entry = await until(
    "entered saved-Event recipient handler",
    async () =>
      (await entries(entryLog)).find((item) =>
        candidates.some((candidate) =>
          Object.entries(candidate).every(([key, value]) => item[key] === value),
        ),
      ),
    30_000,
  );
  assert.equal(entry.pid, gated.pid);
  const selected = candidates.find((candidate) => candidate.method === entry.method);
  assert.ok(selected);
  const before = await request(gated, "inspect", { numbers: [1] });
  const original = before.events.find((event) => event.number === 1);
  assert.ok(original?.id && original.sha256 && original.binaryBase64);
  assert.equal(before.projects[0].states[selected.method], false);
  const exactPending = (observation, label) => {
    const targetTypeUrl = TypeUrls.derive(
      selected.method === "planning" ? PlanningStateSchema : StaffingStateSchema,
    );
    const rows = completeInboxRows(observation, count).filter(
      (row) =>
        row.targetTypeUrl === targetTypeUrl &&
        row.targetIdTypeUrl === selected.recipientTypeUrl &&
        row.targetIdBase64 === selected.recipientIdBase64 &&
        row.signalId === original.id,
    );
    assert.equal(rows.length, 1, `${label} must have exactly one original recipient row.`);
    assert.equal(rows[0].signalTypeUrl, TypeUrls.derive(EventSchema));
    assert.equal(rows[0].signalValueSha256, original.sha256);
    assert.equal(rows[0].status, "TO_DELIVER");
    return rows[0];
  };
  const pending = await until("exact pending gated-recipient Inbox row", async () => {
    const inbox = await request(gated, "inspectDelivery");
    const matches = completeInboxRows(inbox, count).filter(
      (row) =>
        row.targetIdTypeUrl === selected.recipientTypeUrl &&
        row.targetIdBase64 === selected.recipientIdBase64 &&
        row.signalId === original.id,
    );
    if (matches.length === 0) return undefined;
    return exactPending(inbox, "Before kill");
  });
  const preKillInbox = await request(gated, "inspectDelivery");
  assert.equal(exactPending(preKillInbox, "Pre-kill").messageId, pending.messageId);
  const preKill = {
    at: Date.now(),
    acknowledged,
    entry,
    before,
    pending,
    preKillInbox,
    entries: await entries(entryLog),
  };
  await writeFile(resolve(dir, "pre-kill.json"), `${JSON.stringify(preKill, null, 2)}\n`);
  const killed = await killAndConfirm(gated);
  expectedKills.add(gated.pid);
  const killAt = Date.now();
  assert.equal(server.exitCode, null, "The shared Delivery server must remain alive.");
  const ready = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const worker = launch("project-worker.mjs", `replacement-${index}`);
      return request(worker, "start", {
        settings: { ...settings, logPath: resolve(dir, `replacement-${index}.structured.jsonl`) },
      });
    }),
  );
  assert.equal(new Set(ready.map((item) => item.pid)).size, count);
  assert.ok(ready.every((item) => item.configuredShards === count));
  assert.ok(ready.every((item) => item.pid !== gated.pid));
  const observer = children.find((child) => child.pid === ready[0].pid);
  assert.ok(observer);
  const afterKill = await request(observer, "inspectDelivery");
  assert.equal(exactPending(afterKill, "Post-kill").messageId, pending.messageId);
  await writeFile(
    resolve(dir, "post-kill.json"),
    `${JSON.stringify({ killAt, killed, serverPid: server.pid, ready, afterKill }, null, 2)}\n`,
  );
  const snapshots = [];
  const observationMs = 85_000;
  const deadline = Date.now() + observationMs;
  let completed;
  let beforeStale;
  while (Date.now() < deadline) {
    const state = await request(observer, "inspect", { numbers: [1] });
    const allStates = Object.values(state.projects[0].states).every(Boolean);
    const elapsedMs = Date.now() - killAt;
    snapshots.push({ at: Date.now(), elapsedMs, allStates });
    if (processingTimeoutSeconds === 0 && beforeStale === undefined && elapsedMs >= 35_000) {
      const inbox = await request(observer, "inspectDelivery");
      const row = exactPending(inbox, "Before stale-session release");
      beforeStale = { at: Date.now(), elapsedMs, state, row, inbox };
      await writeFile(
        resolve(dir, "before-stale.json"),
        `${JSON.stringify(beforeStale, null, 2)}\n`,
      );
      assert.equal(state.projects[0].states[selected.method], false);
      assert.equal(row.messageId, pending.messageId);
    }
    if (allStates) {
      completed = state;
      break;
    }
    await delay(1_000);
  }
  const finalState = completed ?? (await request(observer, "inspect", { numbers: [1] }));
  const finalInbox = await request(observer, "inspectDelivery");
  const finalRows = completeInboxRows(finalInbox, count);
  const finalEntries = await entries(entryLog);
  await writeFile(
    resolve(dir, "final-observation.json"),
    `${JSON.stringify({ snapshots, finalState, finalInbox, finalEntries }, null, 2)}\n`,
  );
  assert.equal(server.exitCode, null, "Delivery server exited before the observation completed.");
  if (processingTimeoutSeconds === 0)
    assert.ok(beforeStale, "The default listener requires a pre-stale observation.");
  const retainedEvent = finalState.events.find((event) => event.number === 1);
  assert.equal(retainedEvent?.id, original.id);
  assert.equal(retainedEvent?.sha256, original.sha256);
  assert.equal(retainedEvent?.binaryBase64, original.binaryBase64);
  assert.equal(finalEntries.filter((item) => item.method === "create").length, 1);
  const selectedEntries = finalEntries.filter((item) => item.method === selected.method);
  assert.equal(selectedEntries[0]?.pid, gated.pid);
  assert.ok(
    completed,
    "A replacement worker must eventually finish after a stale-session release.",
  );
  assert.equal(selectedEntries.length, 2);
  assert.ok(ready.some((item) => item.pid === selectedEntries[1].pid));
  assert.ok(Object.values(finalState.projects[0].states).every(Boolean));
  const extraReplays = [];
  for (const [method, schema] of [
    ["planning", PlanningStateSchema],
    ["staffing", StaffingStateSchema],
    ["portfolio", PortfolioStateSchema],
    ["projection", ProjectProjectionStateSchema],
  ]) {
    if (method === selected.method) continue;
    const replay = classifyCrashReplay({
      preKillObservation: preKillInbox,
      observation: afterKill,
      shardCount: count,
      entries: finalEntries,
      method,
      recipientTypeUrl: TypeUrls.derive(schema),
      originalEventId: original.id,
      priorPids: [gated.pid],
      freshPids: ready.map((item) => item.pid),
    });
    if (replay !== undefined) extraReplays.push(replay);
  }
  outcome = {
    status: "PASS",
    provider: providerName,
    processes: count,
    processingTimeoutSeconds,
    ...identity,
    serverPid: server.pid,
    oldPid: gated.pid,
    selectedMethod: selected.method,
    replacementPids: ready.map((item) => item.pid),
    acceptedCommandId: commandId,
    pendingMessageId: pending.messageId,
    originalEventId: original.id,
    originalEventSha256: original.sha256,
    elapsedMs: Date.now() - killAt,
    firstCompletionElapsedMs: snapshots.find((item) => item.allStates)?.elapsedMs,
    beforeStaleElapsedMs: beforeStale?.elapsedMs,
    finalPendingStatus: finalRows.find((row) => row.messageId === pending.messageId)?.status,
    handlerCounts: Object.fromEntries(
      ["create", "planning", "staffing", "portfolio", "projection"].map((method) => [
        method,
        finalEntries.filter((item) => item.method === method).length,
      ]),
    ),
    extraReplays,
    gitHead,
    artifacts,
    runtimeTreeSha256,
  };
} catch (error) {
  failure = error;
  outcome = {
    status: "FAIL",
    provider: providerName,
    processes: count,
    processingTimeoutSeconds,
    ...identity,
    error: String(error),
  };
} finally {
  const errors = [];
  const exits = [];
  for (const child of [...children].reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        await request(child, "close", {}, 5_000);
      } catch (error) {
        errors.push(`child ${child.pid} close: ${String(error)}`);
      }
    }
    const exit = await stop(child);
    exits.push(exit);
    if (exit.code !== 0 && !expectedKills.has(exit.pid))
      errors.push(`child ${exit.pid} exited ${String(exit.code)}/${String(exit.signal)}`);
  }
  let databaseDropped = false;
  try {
    if (created) {
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
  cleanup = { databaseDropped, exits, errors };
  await writeFile(resolve(dir, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
}
if (cleanup.errors.length > 0) {
  outcome.status = "FAIL";
  outcome.cleanupErrors = cleanup.errors;
}
await writeFile(resolve(dir, "result.json"), `${JSON.stringify(outcome, null, 2)}\n`);
if (outcome.status === "PASS") process.stdout.write(`${JSON.stringify(outcome)}\n`);
if (failure !== undefined && cleanup.errors.length > 0)
  throw new AggregateError([failure, ...cleanup.errors], "Takeover run and cleanup failed.");
if (failure !== undefined) throw failure;
if (cleanup.errors.length > 0)
  throw new Error(`Takeover cleanup failed: ${cleanup.errors.join("; ")}`);

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
  children.push(child);
  return child;
}

async function entries(path) {
  const content = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return content.trim().length === 0 ? [] : content.trim().split("\n").map(JSON.parse);
}

async function until(label, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value !== undefined && value !== false) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(undefined);
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
}

async function killAndConfirm(child) {
  assert.ok(child.pid !== undefined);
  assert.equal(child.kill("SIGKILL"), true);
  const exit = await waitExit(child, 2_000);
  assert.equal(exit?.signal, "SIGKILL");
  return exit;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return { pid: child.pid, code: child.exitCode, signal: child.signalCode };
  if (child.connected) child.disconnect();
  let exit = await waitExit(child, 2_000);
  if (exit === undefined) {
    child.kill("SIGTERM");
    exit = await waitExit(child, 2_000);
  }
  if (exit === undefined) {
    child.kill("SIGKILL");
    exit = await waitExit(child, 2_000);
  }
  return { pid: child.pid, ...(exit ?? { code: null, signal: "UNREAPED" }) };
}

function request(child, kind, fields = {}, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("disconnect", onDisconnect);
      child.off("exit", onExit);
      if (error === undefined) resolve(result);
      else reject(error);
    };
    const timer = setTimeout(
      () => finish(new Error(`${kind} timed out for ${child.pid}.`)),
      timeoutMs,
    );
    const onMessage = (message) => {
      if (message.requestId !== requestId) return;
      if (message.ok) finish(undefined, message.result);
      else finish(new Error(`${kind} failed for ${child.pid}: ${message.error}`));
    };
    const onError = (error) => finish(new Error(`IPC error for ${child.pid}.`, { cause: error }));
    const onDisconnect = () => finish(new Error(`Worker ${child.pid} disconnected.`));
    const onExit = (code) => finish(new Error(`Worker ${child.pid} exited ${String(code)}.`));
    child.on("message", onMessage);
    child.on("error", onError);
    child.on("disconnect", onDisconnect);
    child.on("exit", onExit);
    try {
      child.send({ requestId, kind, ...fields }, (error) => {
        if (error !== undefined && error !== null) onError(error);
      });
    } catch (error) {
      onError(error);
    }
  });
}
