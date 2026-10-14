/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file
 * except in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied. See the License for the specific language governing permissions
 * and limitations under the License.
 */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const task = resolve(root, "build-protocol/tasks/sql-delivery-reliability");
const evidence = resolve(task, "evidence");
const sessionId = randomUUID();
const session = resolve(evidence, "idle-sql-matrix/sessions", sessionId);
const logDir = resolve(session, "logs");
const driver = resolve(root, "packages/server-blackbox-tests/test-fixtures/project-idle-sql.mjs");
const launchHashes = await provenance();
const gitHeadAtStart = await gitHead();
const inventory = [];
const failures = [];
const providers = ["postgres16", "postgres18", "mysql84", "mariadb114"];
const counts = [2, 8];
const modes = ["db-only", "shared-memory"];
const cases = providers.flatMap((provider) =>
  counts.flatMap((count) => modes.map((mode) => ({ provider, count, mode }))),
);
await mkdir(logDir, { recursive: true });
await saveManifest("RUNNING", null);
process.stdout.write(`IDLE_MATRIX_START ${JSON.stringify({ sessionId, total: cases.length })}\n`);

for (let index = 0; index < cases.length; index += 1) {
  const config = cases[index];
  const before = await provenance();
  assert.deepEqual(before, launchHashes, "Source or runtime hashes changed during the matrix.");
  process.stdout.write(
    `IDLE_MATRIX_CASE_START ${index + 1}/${cases.length} ${config.provider}|${config.count}|${config.mode}\n`,
  );
  try {
    const measured = await runOne(config, index + 1);
    inventory.push(measured);
    await saveManifest("RUNNING", null);
    process.stdout.write(
      `IDLE_MATRIX_CASE_PASS ${index + 1}/${cases.length} ${config.provider}|${config.count}|${config.mode} run=${measured.runId} statements=${measured.sqlWindow.statementCount}\n`,
    );
  } catch (error) {
    failures.push({ config, caseNumber: index + 1, error: String(error) });
    await saveManifest("FAIL", String(error));
    process.stderr.write(
      `IDLE_MATRIX_CASE_FAIL ${index + 1}/${cases.length} ${config.provider}|${config.count}|${config.mode} ${String(error)}\n`,
    );
    break;
  }
}

const endHashes = await provenance();
const endHead = await gitHead();
if (JSON.stringify(endHashes) !== JSON.stringify(launchHashes)) {
  failures.push({ error: "Source or runtime hash mismatch at matrix completion." });
}
const finalStatus = failures.length === 0 && inventory.length === cases.length ? "PASS" : "FAIL";
await saveManifest(finalStatus, failures[0]?.error ?? null, endHashes, endHead);
process.stdout.write(
  `IDLE_MATRIX_${finalStatus} ${JSON.stringify({ sessionId, completed: inventory.length, expected: cases.length, failures: failures.length })}\n`,
);
if (finalStatus !== "PASS") process.exitCode = 1;

async function runOne(config, caseNumber) {
  const label = `${String(caseNumber).padStart(2, "0")}-${config.provider}-${config.count}-${config.mode}`;
  const stdoutPath = resolve(logDir, `${label}.stdout.log`);
  const stderrPath = resolve(logDir, `${label}.stderr.log`);
  const command = [
    process.execPath,
    driver,
    "outer",
    config.provider,
    String(config.count),
    config.mode,
  ];
  const env = {
    ...process.env,
    TMPDIR: resolve(evidence, "runtime-tmp"),
  };
  await mkdir(env.TMPDIR, { recursive: true });
  const execution = await runCommand(command, env, stdoutPath, stderrPath);
  const stdout = await readFile(stdoutPath, "utf8");
  assert.equal(
    execution.exitCode,
    0,
    `outer driver exit=${execution.exitCode}, signal=${execution.signal}`,
  );
  const resource = parseTagged(stdout, "IDLE_RESOURCE");
  const captureLine = parseTagged(stdout, "IDLE_CAPTURE");
  assert.equal(resource.providerName, config.provider);
  assert.equal(resource.count, config.count);
  assert.equal(resource.mode, config.mode);
  assert.equal(captureLine.runId, resource.runId);
  assert.equal(captureLine.database, resource.database);
  const runDir = resolve(resource.evidencePath);
  assert.ok(runDir.startsWith(resolve(evidence, "sql-trace/idle-runs") + "/"));

  const outer = JSON.parse(await readFile(resolve(runDir, "outer-result.json"), "utf8"));
  const idleWindow = JSON.parse(await readFile(resolve(runDir, "idle-window.json"), "utf8"));
  const children = JSON.parse(await readFile(resolve(runDir, "children.json"), "utf8"));
  assert.equal(outer.databaseDropped, true);
  assert.deepEqual(outer.cleanupErrors, []);
  assert.equal(outer.capture.exitCode, 0);
  assert.equal(idleWindow.providerName, config.provider);
  assert.equal(idleWindow.count, config.count);
  assert.equal(idleWindow.mode, config.mode);
  assert.equal(idleWindow.database, resource.database);
  assert.equal(idleWindow.warmupMs, 12_000);
  assert.equal(idleWindow.workerPids.length, config.count);
  assert.equal(new Set(idleWindow.workerPids).size, config.count);
  assert.equal(children.length, config.count + (config.mode === "shared-memory" ? 1 : 0));
  assert.ok(children.every((child) => child.code === 0 && child.signal === null));

  const metadataPath = await findCaptureMetadata(config, resource);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(metadata.selectedDatabase, resource.database);
  assert.equal(metadata.engine, config.provider);
  assert.equal(metadata.exitCode, 0);
  assert.equal(metadata.loggingRestored, true);
  assert.deepEqual(metadata.restoreErrors, []);
  assert.deepEqual(metadata.failures, []);
  assert.deepEqual(metadata.markerVerification, {
    warmupMarkerCaptured: true,
    endMarkerCaptured: true,
    decoyDatabaseControlExcluded: true,
  });
  assert.ok(metadata.rawLog);
  const rawLog = await readFile(metadata.rawLog, "utf8");
  const sqlWindow = extractWindow(config.provider, rawLog);
  const durationMs = idleWindow.ended - idleWindow.began;
  assert.ok(durationMs >= 24_000 && durationMs <= 32_000, `idle window duration ${durationMs}ms`);
  const sourceAndRuntimeHashes = await provenance();
  assert.deepEqual(sourceAndRuntimeHashes, launchHashes);

  return {
    caseNumber,
    config,
    command,
    exitCode: execution.exitCode,
    signal: execution.signal,
    runId: resource.runId,
    database: resource.database,
    evidencePath: resource.evidencePath,
    metadataPath,
    rawLog: metadata.rawLog,
    engineVersion: metadata.serverVersion,
    containerName: metadata.containerName,
    containerImage: metadata.image,
    stdoutPath,
    stderrPath,
    workerPids: idleWindow.workerPids,
    deliveryPid: idleWindow.deliveryPid,
    warmupMs: idleWindow.warmupMs,
    windowDurationMs: durationMs,
    loggingRestored: metadata.loggingRestored,
    databaseDropped: outer.databaseDropped,
    cleanupErrors: outer.cleanupErrors,
    children,
    sqlWindow,
  };
}

async function runCommand(command, env, stdoutPath, stderrPath) {
  const child = spawn(command[0], command.slice(1), {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
  const result = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ exitCode: code, signal }));
  });
  await writeFile(stdoutPath, Buffer.concat(stdoutChunks));
  await writeFile(stderrPath, Buffer.concat(stderrChunks));
  return result;
}

function parseTagged(stdout, tag) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(`${tag} `));
  assert.ok(line, `missing ${tag} output`);
  return JSON.parse(line.slice(tag.length + 1));
}

async function findCaptureMetadata(config, resource) {
  const dir = resolve(evidence, "sql-trace/runs");
  const { readdir } = await import("node:fs/promises");
  const prefix = `${config.provider}-idle-${config.mode}-${config.count}-${resource.runId.slice(0, 8)}-`;
  const matches = (await readdir(dir)).filter(
    (name) => name.startsWith(prefix) && name.endsWith(".json"),
  );
  assert.equal(matches.length, 1, `expected one capture metadata file, found ${matches.length}`);
  return resolve(dir, matches[0]);
}

function extractWindow(provider, raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const isMysql = provider === "mysql84" || provider === "mariadb114";
  const rows = isMysql ? lines.map((line) => JSON.parse(line)) : lines;
  const markerText = (row) => (isMysql ? row.argument : row);
  const startIndexes = rows.flatMap((row, index) =>
    markerText(row).includes("sqlrel_trace_warmup_begin") ? [index] : [],
  );
  const endIndexes = rows.flatMap((row, index) =>
    markerText(row).includes("sqlrel_trace_capture_end") ? [index] : [],
  );
  assert.equal(startIndexes.length, 1, "expected exactly one begin marker");
  assert.equal(endIndexes.length, 1, "expected exactly one end marker");
  assert.ok(startIndexes[0] < endIndexes[0], "begin marker must precede end marker");
  const windowRows = rows.slice(startIndexes[0] + 1, endIndexes[0]);
  const statementRows = isMysql
    ? windowRows.filter((row) => ["Query", "Execute", "Prepare"].includes(row.command_type))
    : windowRows.filter((line) => /LOG:\s+(?:statement|execute\s+[^:]+):/.test(line));
  const familyCounts = {};
  const commandTypeCounts = {};
  for (const row of statementRows) {
    const sql = isMysql
      ? row.argument
      : row.replace(/^.*?LOG:\s+(?:statement|execute\s+[^:]+):\s*/, "");
    const family =
      sql
        .trim()
        .match(/^[A-Za-z]+/)?.[0]
        ?.toUpperCase() ?? "OTHER";
    familyCounts[family] = (familyCounts[family] ?? 0) + 1;
    if (isMysql)
      commandTypeCounts[row.command_type] = (commandTypeCounts[row.command_type] ?? 0) + 1;
  }
  return {
    beginMarkerIndex: startIndexes[0],
    endMarkerIndex: endIndexes[0],
    recordsInsideWindow: endIndexes[0] - startIndexes[0] - 1,
    statementCount: statementRows.length,
    familyCounts,
    ...(isMysql ? { commandTypeCounts } : {}),
  };
}

async function provenance() {
  const sourcePaths = [
    "packages/server-blackbox-tests/test-fixtures/project-idle-sql.mjs",
    "packages/server-blackbox-tests/test-fixtures/project-worker.mjs",
    "packages/server-blackbox-tests/test-fixtures/shared-delivery-worker.mjs",
    "build-protocol/tasks/sql-delivery-reliability/evidence/sql-trace/capture.mjs",
  ];
  const runtimePaths = [
    "packages/server/dist/index.js",
    "packages/storage-postgres/dist/index.js",
    "packages/storage-mysql/dist/index.js",
    "packages/delivery-server/dist/index.js",
    "packages/proto/dist/src/index.js",
  ];
  return {
    sourceSha256: await hashPaths(sourcePaths),
    runtimeSha256: await hashPaths(runtimePaths),
  };
}

async function hashPaths(paths) {
  const result = {};
  for (const relative of paths) {
    const bytes = await readFile(resolve(root, relative));
    result[relative] = createHash("sha256").update(bytes).digest("hex");
  }
  return result;
}

async function gitHead() {
  const { execFile } = await import("node:child_process");
  return await new Promise((resolveHead, rejectHead) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }, (error, stdout) => {
      if (error) rejectHead(error);
      else resolveHead(stdout.trim());
    });
  });
}

async function saveManifest(status, error, endHashes, endHead) {
  const manifest = {
    status,
    sessionId,
    configuredProfile: { model: "gpt-6-luna", reasoning: "low", runtimeMetadata: "not exposed" },
    gitHeadAtStart,
    gitHeadAtEnd: endHead ?? null,
    commandTemplate:
      "node packages/server-blackbox-tests/test-fixtures/project-idle-sql.mjs outer <provider> <2|8> <db-only|shared-memory>",
    execution: "sequential; one database capture at a time; fail-fast",
    expectedCases: cases,
    provenanceAtStart: launchHashes,
    provenanceAtEnd: endHashes ?? null,
    cases: inventory,
    failures,
    unrun: cases.slice(inventory.length + failures.length),
    error,
  };
  await writeFile(resolve(session, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
