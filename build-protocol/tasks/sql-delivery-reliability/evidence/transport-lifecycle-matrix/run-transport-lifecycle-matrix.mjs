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

import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const taskEvidence = resolve(root, "build-protocol/tasks/sql-delivery-reliability/evidence");
const runsDirectory = resolve(taskEvidence, "transport-runs");
const outputRoot = resolve(taskEvidence, "transport-lifecycle-matrix");
const sessionId = randomUUID();
const sessionDirectory = resolve(outputRoot, "sessions", sessionId);
const summaryPath = resolve(sessionDirectory, "summary.json");
const invocationsPath = resolve(sessionDirectory, "invocations.jsonl");
const providers = ["postgres16", "postgres18", "mysql84", "mariadb114"];
const protocols = ["native", "grpc-web", "connect"];
const deliveryModes = ["db-only", "shared-memory"];
const scenarios = ["cancel-retry", "pending-cancel", "concurrent-teardown", "stream-reconnect"];
const expectedCaseCount =
  providers.length * protocols.length * deliveryModes.length * scenarios.length;
const command = [
  "--filter",
  "@spine-event-engine/server-blackbox-tests",
  "test:subscription-transports",
];
const timeoutMs = 120_000;
const termGraceMs = 2_000;
const reapTimeoutMs = 5_000;

const sourcePaths = [
  "packages/server-blackbox-tests/package.json",
  "packages/server-blackbox-tests/test-fixtures/project-subscription-transport.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-subscription-wait.mjs",
  "packages/server-blackbox-tests/test/project-subscription-transports.integration.test.ts",
  "packages/server-blackbox-tests/test-fixtures/project-workflow.ts",
  "packages/auth/src/gateway/dynamic-subscription-creator.ts",
  "packages/auth/src/gateway/dynamic-unary-forwarder.ts",
  "packages/deployment/src/internal/backend-membership-kernel.ts",
];

const distPaths = [
  "packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js",
  "packages/server/dist/index.js",
  "packages/server/dist/browser/index.js",
  "packages/server/dist/browser/browser-server.js",
  "packages/server/dist/browser/durable-subscription-bindings.js",
  "packages/server/dist/server/node-coordinator.js",
  "packages/auth/dist/gateway/dynamic-subscription-creator.js",
  "packages/auth/dist/gateway/dynamic-unary-forwarder.js",
  "packages/deployment/dist/internal/backend-membership-kernel.js",
  "packages/proto/dist/src/index.js",
  "packages/storage-postgres/dist/index.js",
  "packages/storage-mysql/dist/index.js",
  "packages/client-node/dist/index.js",
  "packages/client-web/dist/index.js",
  "packages/delivery-server/dist/index.js",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function snapshotFiles(paths) {
  const hashes = {};
  for (const relative of paths) {
    hashes[relative] = sha256(await readFile(resolve(root, relative)));
  }
  return hashes;
}

async function snapshotProvenance() {
  return {
    sourceSha256: await snapshotFiles(sourcePaths),
    distSha256: await snapshotFiles(distPaths),
  };
}

function listCases() {
  return providers.flatMap((provider) =>
    protocols.flatMap((protocol) =>
      deliveryModes.flatMap((deliveryMode) =>
        scenarios.map((scenario) => ({ provider, protocol, deliveryMode, scenario })),
      ),
    ),
  );
}

async function existingRunIds() {
  try {
    return new Set((await readdir(runsDirectory)).filter((name) => /^[a-f0-9]{32}$/u.test(name)));
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
}

async function readJson(directory, filename) {
  return JSON.parse(await readFile(resolve(directory, filename), "utf8"));
}

function identityOf(config) {
  return `${config.provider}|${config.protocol}|${config.deliveryMode}|${config.scenario}`;
}

function auditCase(config, runId, resource, result, cleanup, baseline) {
  assert(resource.runId === runId, "resource run ID differs from directory ID");
  assert(resource.providerName === config.provider, "resource provider mismatch");
  assert(resource.protocol === config.protocol, "resource protocol mismatch");
  assert(resource.deliveryMode === config.deliveryMode, "resource delivery-mode mismatch");
  assert(resource.scenario === config.scenario, "resource scenario mismatch");
  assert(
    /^sqlrel_sub_[a-f0-9]{32}$/u.test(resource.database),
    "database name is not a unique task UUID",
  );
  assert(resource.database === `sqlrel_sub_${runId}`, "database does not match the unique run ID");
  assert(
    resource.evidencePath === resolve(runsDirectory, runId),
    "resource evidence path mismatch",
  );
  assert(Number.isInteger(resource.pid) && resource.pid > 0, "fixture PID is missing");
  assert(result.status === "PASS", "fixture result status is not PASS");
  assert(result.result?.provider === config.provider, "result provider mismatch");
  assert(result.result?.protocol === config.protocol, "result protocol mismatch");
  assert(result.result?.deliveryMode === config.deliveryMode, "result delivery-mode mismatch");
  assert(result.result?.scenario === config.scenario, "result scenario mismatch");
  assert(result.result?.database === resource.database, "result database mismatch");
  assert(
    JSON.stringify(result.result?.counters) === JSON.stringify(result.counters),
    "result counters differ from persisted fixture counters",
  );
  assert(cleanup.databaseDropped === true, "unique database drop was not confirmed");
  assert(cleanup.remainingSessions === 0, "backend HTTP/2 sessions remain");
  assert(
    Array.isArray(cleanup.errors) && cleanup.errors.length === 0,
    "fixture cleanup reported errors",
  );
  assert(Array.isArray(resource.artifacts), "compiled artifact identities are missing");
  const artifactHashes = Object.fromEntries(
    resource.artifacts.map((artifact) => [artifact.path.slice(root.length + 1), artifact.sha256]),
  );
  for (const requiredPath of [
    "packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js",
    "packages/server/dist/index.js",
    "packages/server/dist/server/node-coordinator.js",
    "packages/deployment/dist/internal/backend-membership-kernel.js",
    "packages/proto/dist/src/index.js",
    "packages/storage-postgres/dist/index.js",
    "packages/storage-mysql/dist/index.js",
    "packages/client-node/dist/index.js",
    "packages/client-web/dist/index.js",
    "packages/delivery-server/dist/index.js",
  ]) {
    assert(
      artifactHashes[requiredPath] !== undefined,
      `resource omitted compiled artifact: ${requiredPath}`,
    );
  }
  for (const artifact of resource.artifacts) {
    const relative = artifact.path.slice(root.length + 1);
    assert(
      baseline.distSha256[relative] === artifact.sha256,
      `artifact differs from launch hash: ${relative}`,
    );
  }
  return {
    runId,
    database: resource.database,
    evidencePath: resource.evidencePath,
    fixturePid: resource.pid,
    resourceArtifacts: artifactHashes,
    result: {
      status: result.status,
      eventId: result.result.eventId,
      stateId: result.result.stateId,
      counters: result.counters,
      secondaryCounters: result.secondaryCounters,
      handlerEntryCount: result.entries?.length,
      subscriptionTraceCount: result.subscriptionTrace?.length,
    },
    cleanup: {
      databaseDropped: cleanup.databaseDropped,
      remainingSessions: cleanup.remainingSessions,
      errors: cleanup.errors,
    },
  };
}

async function waitForExit(child, logStream) {
  let timedOut = false;
  let escalationSent = false;
  let termTimer;
  let killTimer;
  let closed = false;
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const exitPromise = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      closed = true;
      resolveExit({ code, signal });
    });
    termTimer = setTimeout(() => {
      if (closed) return;
      timedOut = true;
      logStream.write(`outerTimeoutMs=${timeoutMs}\n`);
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => {
        if (!closed) {
          escalationSent = true;
          logStream.write("timeoutEscalation=SIGKILL\n");
          signalGroup("SIGKILL");
        }
      }, termGraceMs);
    }, timeoutMs);
  });
  const exit = await exitPromise;
  clearTimeout(termTimer);
  clearTimeout(killTimer);
  let groupExists = true;
  const deadline = Date.now() + reapTimeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-child.pid, 0);
      await delay(100);
    } catch (error) {
      if (error.code === "ESRCH") {
        groupExists = false;
        break;
      }
      throw error;
    }
  }
  if (groupExists) {
    logStream.write("processGroupStillExistsAfterClose=true; cleanupSignal=SIGTERM\n");
    signalGroup("SIGTERM");
    await delay(termGraceMs);
    const termDeadline = Date.now() + reapTimeoutMs;
    while (Date.now() < termDeadline) {
      try {
        process.kill(-child.pid, 0);
        await delay(100);
      } catch (error) {
        if (error.code === "ESRCH") {
          groupExists = false;
          break;
        }
        throw error;
      }
    }
    if (groupExists) {
      logStream.write("processGroupStillExistsAfterSIGTERM=true; cleanupSignal=SIGKILL\n");
      signalGroup("SIGKILL");
      const killDeadline = Date.now() + reapTimeoutMs;
      while (Date.now() < killDeadline) {
        try {
          process.kill(-child.pid, 0);
          await delay(100);
        } catch (error) {
          if (error.code === "ESRCH") {
            groupExists = false;
            break;
          }
          throw error;
        }
      }
    }
  }
  return { ...exit, timedOut, escalationSent, groupExists };
}

async function runCase(config, index, baseline) {
  const startedAt = new Date().toISOString();
  const beforeRunIds = await existingRunIds();
  const logPath = resolve(
    sessionDirectory,
    `${config.provider}-${config.protocol}-${config.deliveryMode}-${config.scenario}.log`,
  );
  const environment = {
    ...process.env,
    TMPDIR: resolve(taskEvidence, "runtime-tmp"),
    SPINE_TS_TRANSPORT_PROVIDER: config.provider,
    SPINE_TS_TRANSPORT_PROTOCOL: config.protocol,
    SPINE_TS_TRANSPORT_SCENARIO: config.scenario,
    SPINE_TS_TRANSPORT_DELIVERY_MODE: config.deliveryMode,
  };
  await mkdir(environment.TMPDIR, { recursive: true });
  const record = {
    index,
    config,
    command: { executable: "pnpm", argv: command },
    environment: {
      SPINE_TS_TRANSPORT_PROVIDER: config.provider,
      SPINE_TS_TRANSPORT_PROTOCOL: config.protocol,
      SPINE_TS_TRANSPORT_SCENARIO: config.scenario,
      SPINE_TS_TRANSPORT_DELIVERY_MODE: config.deliveryMode,
    },
    startedAt,
    log: logPath,
    fixtureSourceSha256:
      baseline.sourceSha256[
        "packages/server-blackbox-tests/test-fixtures/project-subscription-transport.mjs"
      ],
    configuredProfile: { model: "gpt-6-luna", reasoning: "low" },
  };
  await writeFile(invocationsPath, `${JSON.stringify({ ...record, phase: "starting" })}\n`, {
    flag: "a",
  });
  const logStream = createWriteStream(logPath, { flags: "wx" });
  logStream.write(`startedAt=${startedAt}\ncommand=pnpm ${command.join(" ")}\n`);
  logStream.write(`case=${JSON.stringify(config)}\n`);
  const child = spawn("pnpm", command, {
    cwd: root,
    env: environment,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(child.pid !== undefined, "pnpm process did not start");
  record.pnpmPid = child.pid;
  record.processGroupId = child.pid;
  await writeFile(invocationsPath, `${JSON.stringify({ ...record, phase: "spawned" })}\n`, {
    flag: "a",
  });
  child.stdout.setEncoding("utf8").on("data", (chunk) => logStream.write(`stdout: ${chunk}`));
  child.stderr.setEncoding("utf8").on("data", (chunk) => logStream.write(`stderr: ${chunk}`));
  let exit;
  let waitFailure;
  try {
    exit = await waitForExit(child, logStream);
  } catch (error) {
    waitFailure = String(error);
  } finally {
    await new Promise((resolveEnd) => logStream.end(resolveEnd));
  }
  const endedAt = new Date().toISOString();
  record.endedAt = endedAt;
  record.gitHeadAtCase = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  record.exit = exit ?? null;
  if (
    waitFailure !== undefined ||
    exit === undefined ||
    exit.code !== 0 ||
    exit.signal !== null ||
    exit.timedOut ||
    exit.groupExists
  ) {
    record.status = "FAIL";
    record.failure =
      waitFailure ??
      "public opt-in test command failed, timed out, or left its isolated process group alive";
  }
  try {
    const newRunIds = [...(await existingRunIds())].filter((runId) => !beforeRunIds.has(runId));
    const matchingRunIds = [];
    const unrelatedRunIds = [];
    for (const candidateId of newRunIds) {
      try {
        const candidate = await readJson(resolve(runsDirectory, candidateId), "resource.json");
        if (
          candidate.providerName === config.provider &&
          candidate.protocol === config.protocol &&
          candidate.deliveryMode === config.deliveryMode &&
          candidate.scenario === config.scenario
        ) {
          matchingRunIds.push(candidateId);
        } else {
          unrelatedRunIds.push(candidateId);
        }
      } catch {
        unrelatedRunIds.push(candidateId);
      }
    }
    record.unrelatedConcurrentRunIds = unrelatedRunIds;
    assert(
      matchingRunIds.length === 1,
      `expected one new transport run matching this case, found ${matchingRunIds.length} (all new directories: ${newRunIds.length})`,
    );
    const runId = matchingRunIds[0];
    const runDirectory = resolve(runsDirectory, runId);
    const [resource, result, cleanup] = await Promise.all([
      readJson(runDirectory, "resource.json"),
      readJson(runDirectory, "result.json"),
      readJson(runDirectory, "cleanup.json"),
    ]);
    record.runId = runId;
    record.resource = {
      runId: resource.runId,
      database: resource.database,
      evidencePath: resource.evidencePath,
      pid: resource.pid,
    };
    record.cleanup = cleanup;
    record.audit = auditCase(config, runId, resource, result, cleanup, baseline);
    assert(
      JSON.stringify(baseline) === JSON.stringify(await snapshotProvenance()),
      "source or compiled artifact hashes changed during matrix execution",
    );
    record.status ??= "PASS";
  } catch (error) {
    record.status = "FAIL";
    record.validationError = String(error);
  }
  record.caseDurationMs = Date.parse(endedAt) - Date.parse(startedAt);
  await writeFile(invocationsPath, `${JSON.stringify({ ...record, phase: "complete" })}\n`, {
    flag: "a",
  });
  return record;
}

async function printPlan() {
  const provenance = await snapshotProvenance();
  process.stdout.write(
    `${JSON.stringify({
      mode: "plan-only",
      worktree: root,
      command: `pnpm ${command.join(" ")}`,
      expectedCaseCount,
      cases: listCases(),
      sourceHashesCaptured: Object.keys(provenance.sourceSha256).length,
      distHashesCaptured: Object.keys(provenance.distSha256).length,
      launchesProcesses: false,
      createsDatabases: false,
      configuredProfile: { model: "gpt-6-luna", reasoning: "low" },
    })}\n`,
  );
}

async function runMatrix() {
  await mkdir(resolve(outputRoot, "sessions"), { recursive: true });
  await mkdir(runsDirectory, { recursive: true });
  await mkdir(sessionDirectory, { recursive: false });
  const provenanceAtLaunch = await snapshotProvenance();
  const cases = [];
  const manifest = {
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    sessionId,
    worktree: root,
    gitHeadAtLaunch: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    configuredProfile: {
      model: "gpt-6-luna",
      reasoning: "low",
      runtimeMetadata: "not exposed by this execution surface",
    },
    command: `pnpm ${command.join(" ")}`,
    execution: "sequential; one exact detached package-command process group per case; fail-fast",
    expectedCaseCount,
    provenanceAtLaunch,
    cases,
  };
  await writeFile(
    resolve(sessionDirectory, "provenance-at-launch.json"),
    `${JSON.stringify(provenanceAtLaunch, null, 2)}\n`,
    { flag: "wx" },
  );
  await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  let index = 0;
  for (const config of listCases()) {
    index++;
    process.stdout.write(
      `TRANSPORT_CASE_START ${index}/${expectedCaseCount} ${identityOf(config)}\n`,
    );
    const record = await runCase(config, index, provenanceAtLaunch);
    cases.push(record);
    await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(
      `TRANSPORT_CASE_${record.status} ${index}/${expectedCaseCount} ${identityOf(config)}${record.runId ? ` run=${record.runId}` : ""}\n`,
    );
    if (record.status !== "PASS") {
      manifest.stoppedAfterFirstFailure = true;
      break;
    }
  }
  const expected = new Set(listCases().map(identityOf));
  const actual = cases.map((record) => identityOf(record.config));
  manifest.inventory = {
    expectedCount: expected.size,
    actualCount: actual.length,
    missing: [...expected].filter((item) => !actual.includes(item)),
    duplicates: actual.filter((item, itemIndex) => actual.indexOf(item) !== itemIndex),
  };
  manifest.unrunCases = manifest.inventory.missing;
  manifest.failedCases = cases
    .filter((record) => record.status !== "PASS")
    .map((record) => ({
      config: record.config,
      runId: record.runId ?? null,
      failure: record.failure ?? record.validationError ?? "case did not pass",
    }));
  manifest.provenanceAtEnd = await snapshotProvenance();
  manifest.status =
    manifest.inventory.missing.length === 0 &&
    manifest.inventory.duplicates.length === 0 &&
    cases.length === expectedCaseCount &&
    manifest.failedCases.length === 0 &&
    JSON.stringify(provenanceAtLaunch) === JSON.stringify(manifest.provenanceAtEnd)
      ? "PASS"
      : "FAIL";
  manifest.endedAt = new Date().toISOString();
  await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `TRANSPORT_MATRIX_${manifest.status} cases=${cases.length}/${expectedCaseCount} failures=${manifest.failedCases.length} session=${sessionDirectory}\n`,
  );
  if (manifest.status !== "PASS") process.exitCode = 1;
}

if (process.argv[2] === "--plan") await printPlan();
else await runMatrix();
