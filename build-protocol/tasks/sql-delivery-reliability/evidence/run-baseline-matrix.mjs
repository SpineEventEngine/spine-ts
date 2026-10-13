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
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const evidence = resolve(root, "build-protocol/tasks/sql-delivery-reliability/evidence");
const runs = resolve(evidence, "matrix-runs");
const providers = ["postgres16", "postgres18", "mysql84", "mariadb114"];
const modes = ["db-only", "shared-memory"];
const processCounts = [2, 8];
const cases = [
  { total: 80, burst: 16 },
  { total: 80, burst: 16 },
  { total: 32, burst: 32 },
  { total: 32, burst: 32 },
  { total: 16, burst: 16 },
];
const methods = ["create", "planning", "staffing", "portfolio", "projection"];
const recipientTypeUrls = {
  create: "type.spine.server.testing/spine.server.testing.ProjectId",
  planning: "type.spine.server.testing/spine.server.testing.PlanningId",
  staffing: "type.spine.server.testing/spine.server.testing.StaffingId",
  portfolio: "type.spine.server.testing/spine.server.testing.PortfolioId",
  projection: "type.spine.server.testing/spine.server.testing.ProjectId",
};
const auditOnly = process.argv[2] === "--audit-existing";
const auditRunId = process.argv[3];
const auditOutputArg = process.argv[4];
const sessionId = randomUUID();
const sessionDir = resolve(evidence, `baseline-matrix-${sessionId}`);
const outputDir = auditOnly ? resolve(auditOutputArg ?? "") : sessionDir;
const summaryPath = resolve(outputDir, "summary.json");
const invocationPath = resolve(outputDir, "invocations.jsonl");
const manifest = {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  sessionId,
  worktree: root,
  execution: "sequential",
  topologies: [],
};

if (!auditOnly) {
  await mkdir(runs, { recursive: true });
  await mkdir(sessionDir, { recursive: false });
  await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseLines(contents) {
  return contents.trim() === "" ? [] : contents.trim().split("\n").map(JSON.parse);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readRun(runId) {
  const directory = resolve(runs, runId);
  const names = [
    "result.json",
    "cleanup.json",
    "admission.json",
    "entries.jsonl",
    "commands.jsonl",
    "last-snapshots.json",
    "restart-snapshots.json",
    "post-restart-snapshots.json",
    "events.json",
  ];
  const values = await Promise.all(
    names.map(async (name) => [name, await readFile(resolve(directory, name), "utf8")]),
  );
  return { directory, files: Object.fromEntries(values) };
}

function validateEvidence(result, files, config) {
  const cleanup = JSON.parse(files["cleanup.json"]);
  const admission = JSON.parse(files["admission.json"]);
  const entries = parseLines(files["entries.jsonl"]);
  const commands = parseLines(files["commands.jsonl"]);
  const snapshots = JSON.parse(files["last-snapshots.json"]);
  const restartSnapshots = JSON.parse(files["restart-snapshots.json"]);
  const postRestartSnapshots = JSON.parse(files["post-restart-snapshots.json"]);
  const events = JSON.parse(files["events.json"]);
  const expectedEntries = config.total * methods.length;

  assert(result.status === "PASS", "result status is not PASS");
  assert(
    result.provider === config.provider && result.mode === config.mode,
    "provider or mode mismatch",
  );
  assert(
    result.processes === config.processes && result.configuredShards === config.processes,
    "process/shard count mismatch",
  );
  assert(new Set(result.pids).size === config.processes, "initial worker PIDs are not unique");
  assert(
    result.total === config.total && result.burst === config.burst,
    "workload configuration mismatch",
  );
  assert(
    result.commandCount === config.total &&
      commands.filter((row) => row.phase !== "after-restart").length === config.total,
    "original command ledger count mismatch",
  );
  assert(
    admission.length === config.total && admission.every((row) => row.ackStatus?.case === "ok"),
    "admission ledger mismatch",
  );
  assert(
    result.eventCount === config.total &&
      events.length === config.total &&
      result.eventLedgerSha256 === hash(JSON.stringify(events)),
    "event count or event-ledger hash mismatch",
  );
  assert(
    events.every(
      (event) =>
        event.id &&
        event.sha256 &&
        event.binaryBase64 &&
        hash(Buffer.from(event.binaryBase64, "base64")) === event.sha256,
    ),
    "Event IDs or serialized-byte hashes are invalid",
  );
  assert(
    result.entryCount === expectedEntries &&
      entries.length === expectedEntries + (config.restart ? methods.length : 0),
    "handler entry count mismatch",
  );
  assert(
    methods.every((method) => result.entryMethods.includes(method)),
    "expected handler method missing",
  );
  assert(
    entries.every((entry) => methods.includes(entry.method)),
    "unexpected method in entry ledger",
  );
  assert(
    entries.every(
      (entry) =>
        entry.recipientTypeUrl === recipientTypeUrls[entry.method] &&
        typeof entry.recipientIdBase64 === "string" &&
        entry.recipientIdBase64.length > 0 &&
        Buffer.from(entry.recipientIdBase64, "base64").length > 0 &&
        Buffer.from(entry.recipientIdBase64, "base64").toString("base64") ===
          entry.recipientIdBase64,
    ),
    "recipient method/type URL or canonical nonempty identifier bytes are invalid",
  );
  const originalEntries = entries.filter(
    (entry) =>
      Number(entry.correlation.slice(entry.correlation.lastIndexOf(":") + 1)) <= config.total,
  );
  const restartEntries = entries.filter(
    (entry) =>
      Number(entry.correlation.slice(entry.correlation.lastIndexOf(":") + 1)) > config.total,
  );
  assert(
    originalEntries.length === expectedEntries &&
      originalEntries.every((entry) => result.pids.includes(entry.pid)),
    "original entry ledger/PID mismatch",
  );
  for (let number = 1; number <= config.total; number++) {
    const matching = originalEntries.filter((entry) => entry.correlation.endsWith(`:${number}`));
    assert(
      matching.length === methods.length &&
        methods.every((method) => matching.filter((entry) => entry.method === method).length === 1),
      `Project ${number} does not have exactly five unique handler entries`,
    );
  }
  const admissionIds = new Set(admission.map((row) => row.commandId));
  assert(
    commands
      .filter((row) => row.phase !== "after-restart")
      .every((row) => admissionIds.has(row.commandId)),
    "an original command has no matching accepted admission",
  );
  assert(cleanup.databaseDropped === true, "unique run database was not dropped");
  assert(
    cleanup.workerExits.length === config.processes &&
      cleanup.workerExits.every((exit) => exit.code === 0 && exit.signal === null),
    "worker cleanup mismatch",
  );
  assert(Array.isArray(cleanup.errors) && cleanup.errors.length === 0, "cleanup errors reported");
  if (config.mode === "shared-memory")
    assert(cleanup.deliveryExit?.code === 0, "Delivery child cleanup mismatch");
  const snapshotsByWorker = snapshots;
  assert(snapshotsByWorker.length === config.processes, "snapshot worker count mismatch");
  for (const snapshot of snapshotsByWorker) {
    assert(snapshot.events.length === config.total, "snapshot Event count mismatch");
    assert(
      snapshot.projects.length === config.total &&
        snapshot.projects.every((project) => Object.values(project.states).every(Boolean)),
      "snapshot state count or completeness mismatch",
    );
    for (const event of snapshot.events)
      assert(
        events.some(
          (original) =>
            original.number === event.number &&
            original.id === event.id &&
            original.sha256 === event.sha256 &&
            original.binaryBase64 === event.binaryBase64 &&
            hash(Buffer.from(event.binaryBase64 ?? "", "base64")) === event.sha256,
        ),
        "snapshot Event ID, serialized bytes, or hash differs from original ledger",
      );
  }
  if (config.restart) {
    const restart = result.restartResult;
    assert(restart?.retainedEventCount === config.total, "restart retained-event count mismatch");
    assert(
      restart.entryCountAfterRestart === expectedEntries + methods.length,
      "post-restart entry count mismatch",
    );
    assert(
      new Set(restart.newPids).size === config.processes &&
        restart.newPids.every((pid) => !result.pids.includes(pid)),
      "restart worker PIDs are not fresh and unique",
    );
    assert(
      restart.priorExits.length === config.processes &&
        restart.priorExits.every((exit) => exit.code === 0),
      "pre-restart app exits mismatch",
    );
    assert(
      restartEntries.length === methods.length,
      "restart did not add exactly one complete set of handler entries",
    );
    assert(
      new Set(restartEntries.map((entry) => entry.method)).size === methods.length &&
        methods.every(
          (method) => restartEntries.filter((entry) => entry.method === method).length === 1,
        ),
      "restart handler entry methods are incomplete or duplicated",
    );
    assert(
      restartEntries.every(
        (entry) =>
          entry.correlation.endsWith(`:${config.total + 1}`) && restart.newPids.includes(entry.pid),
      ),
      "restart handler entries do not belong only to the new Project and fresh workers",
    );
    assert(
      restartEntries.every((entry) => entry.recipientTypeUrl === recipientTypeUrls[entry.method]),
      "restart recipient method/type URL mismatch",
    );
    assert(
      JSON.stringify(restart.newRecipientEntries) === JSON.stringify(restartEntries),
      "restart result recipient entries differ from durable entry log",
    );
    assert(
      restart.newEventId &&
        restart.newEventSha256 &&
        typeof restart.newEventBinaryBase64 === "string" &&
        restart.newEventBinaryBase64.length > 0 &&
        hash(Buffer.from(restart.newEventBinaryBase64, "base64")) === restart.newEventSha256,
      "restart Event ID or serialized-byte hash is invalid",
    );
    assert(
      commands.filter((row) => row.phase === "after-restart").length === 1 &&
        commands.find((row) => row.phase === "after-restart").number === config.total + 1,
      "post-restart command ledger is missing or ambiguous",
    );
    assert(
      admissionIds.has(restart.newCommandId) === false,
      "post-restart command unexpectedly appears in the pre-restart admission ledger",
    );
    assert(
      snapshotsByWorker.every((snapshot) => snapshot.events.length === config.total),
      "restart snapshot includes an unexpected Event",
    );
    assert(
      restartSnapshots.length === config.processes &&
        restartSnapshots.every((snapshot) => snapshot.events.length === config.total),
      "restart-before-post snapshot worker or Event count mismatch",
    );
    for (const snapshot of restartSnapshots) {
      for (const event of snapshot.events)
        assert(
          events.some(
            (original) =>
              original.number === event.number &&
              original.id === event.id &&
              original.sha256 === event.sha256 &&
              original.binaryBase64 === event.binaryBase64 &&
              hash(Buffer.from(event.binaryBase64 ?? "", "base64")) === event.sha256,
          ),
          "restart-before-post Event view differs from original ID/bytes/hash",
        );
    }
    assert(
      postRestartSnapshots.length === config.processes &&
        postRestartSnapshots.every((snapshot) => snapshot.events.length === config.total + 1),
      "post-restart snapshot worker or Event count mismatch",
    );
    for (const snapshot of postRestartSnapshots) {
      const newEvents = snapshot.events.filter((event) => event.id === restart.newEventId);
      assert(
        newEvents.length === 1 &&
          newEvents[0].sha256 === restart.newEventSha256 &&
          newEvents[0].binaryBase64 === restart.newEventBinaryBase64 &&
          hash(Buffer.from(newEvents[0].binaryBase64, "base64")) === newEvents[0].sha256,
        "post-restart worker view differs from the exact new Event bytes/hash",
      );
      for (const event of snapshot.events.filter((item) => item.id !== restart.newEventId))
        assert(
          events.some(
            (original) =>
              original.number === event.number &&
              original.id === event.id &&
              original.sha256 === event.sha256 &&
              original.binaryBase64 === event.binaryBase64,
          ),
          "post-restart worker view changed an original Event ID or bytes",
        );
    }
  }
  return {
    commands: commands.length,
    admissions: admission.length,
    events: result.eventCount,
    entries: entries.length,
    originalEntries: originalEntries.length,
    restartEntries: restartEntries.length,
    entryLedgerSha256: hash(files["entries.jsonl"]),
    commandLedgerSha256: hash(files["commands.jsonl"]),
    eventLedgerSha256: result.eventLedgerSha256,
    uniquePids: result.pids,
    restartPids: result.restartResult?.newPids ?? [],
    databaseDropped: cleanup.databaseDropped,
    cleanupErrors: cleanup.errors,
    artifactHashes: result.artifacts,
  };
}

async function auditExisting(runId) {
  assert(/^[a-f0-9]{32}$/.test(runId ?? ""), "--audit-existing requires a 32-character run ID");
  assert(
    auditOutputArg !== undefined && auditOutputArg.length > 0,
    "--audit-existing requires an explicit fresh report path",
  );
  const reportPath = resolve(auditOutputArg);
  assert(
    reportPath.startsWith(`${evidence}/`),
    "audit report path must be within the task evidence directory",
  );
  await mkdir(dirname(reportPath), { recursive: true });
  const { files } = await readRun(runId);
  const result = JSON.parse(files["result.json"]);
  assert(result.runId === runId, "result run ID does not match requested directory");
  const config = {
    provider: result.provider,
    processes: result.processes,
    mode: result.mode,
    total: result.total,
    burst: result.burst,
    restart: result.restart,
  };
  assert(
    providers.includes(config.provider) &&
      processCounts.includes(config.processes) &&
      modes.includes(config.mode) &&
      Number.isInteger(config.total) &&
      config.total > 0 &&
      Number.isInteger(config.burst) &&
      config.burst > 0 &&
      config.restart === true,
    "result does not contain supported audit configuration fields",
  );
  const checks = validateEvidence(result, files, config);
  const report = {
    status: "PASS",
    mode: "audit-only",
    runId,
    auditedAt: new Date().toISOString(),
    config,
    checks,
    note: "Validates persisted artifacts only; launches no test, app, Delivery, or database processes.",
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function runCase(config, index) {
  const startedAt = new Date().toISOString();
  const env = {
    ...process.env,
    SPINE_TS_MATRIX_PROVIDER: config.provider,
    SPINE_TS_MATRIX_PROCESSES: String(config.processes),
    SPINE_TS_MATRIX_MODE: config.mode,
    SPINE_TS_MATRIX_TOTAL: String(config.total),
    SPINE_TS_MATRIX_BURST: String(config.burst),
    SPINE_TS_MATRIX_RESTART: "1",
  };
  const argv = ["--dir", "packages/server-blackbox-tests", "test:matrix"];
  const logPath = resolve(
    outputDir,
    `${config.provider}-p${config.processes}-${config.mode}-${index}.log`,
  );
  const priorRunIds = new Set((await readdir(runs)).filter((name) => /^[a-f0-9]{32}$/.test(name)));
  const record = { config, command: { executable: "pnpm", argv }, startedAt, log: logPath };
  await appendFile(invocationPath, `${JSON.stringify(record)}\n`);
  const child = spawn("pnpm", argv, {
    cwd: root,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pnpmPid = child.pid;
  assert(pnpmPid !== undefined, "pnpm process did not start");
  record.pnpmPid = pnpmPid;
  await appendFile(invocationPath, `${JSON.stringify({ ...record, phase: "spawned" })}\n`);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  let timedOut = false;
  let timeoutSignal = null;
  let escalated = false;
  let exitSeen = false;
  let escalationTimer;
  const outcome = await new Promise((resolveOutcome, reject) => {
    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutSignal = "SIGTERM";
      child.kill("SIGTERM");
      escalationTimer = setTimeout(() => {
        if (!exitSeen) {
          escalated = true;
          timeoutSignal = "SIGKILL";
          child.kill("SIGKILL");
        }
      }, 2_000);
    }, 260_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(escalationTimer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      exitSeen = true;
      clearTimeout(timeout);
      clearTimeout(escalationTimer);
      resolveOutcome({ code, signal, timedOut, timeoutSignal, escalated, pnpmPid });
    });
  });
  const endedAt = new Date().toISOString();
  await writeFile(
    logPath,
    `startedAt=${startedAt}\nendedAt=${endedAt}\npnpmPid=${pnpmPid}\nexit=${outcome.code}/${outcome.signal}\ntimedOut=${outcome.timedOut}\ntimeoutSignal=${outcome.timeoutSignal ?? "none"}\ntimeoutEscalated=${outcome.escalated}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
  );
  record.endedAt = endedAt;
  record.exit = outcome;
  record.pnpmPid = pnpmPid;
  if (outcome.code !== 0 || outcome.timedOut) {
    record.status = "FAIL";
    record.stdout = stdout;
    record.stderr = stderr;
    await appendFile(invocationPath, `${JSON.stringify({ ...record, phase: "complete" })}\n`);
    throw new Error(
      `matrix command failed (${outcome.code}/${outcome.signal})${outcome.timedOut ? ` after outer timeout; pnpm PID ${pnpmPid}, signal ${outcome.timeoutSignal}, escalated=${outcome.escalated}` : ""}; saved log ${logPath}\n${stderr.slice(-3000)}`,
    );
  }
  try {
    const newRunIds = (await readdir(runs)).filter(
      (name) => /^[a-f0-9]{32}$/.test(name) && !priorRunIds.has(name),
    );
    assert(
      newRunIds.length === 1,
      `expected exactly one new run directory, found ${newRunIds.length}; saved log ${logPath}`,
    );
    const runId = newRunIds[0];
    const { files } = await readRun(runId);
    const result = JSON.parse(files["result.json"]);
    assert(result.runId === runId, "result run ID does not match its directory");
    assert(result.restart === true, "application restart was not enabled");
    const checks = validateEvidence(result, files, config);
    record.status = "PASS";
    record.runId = runId;
    record.checks = checks;
    await appendFile(invocationPath, `${JSON.stringify({ ...record, phase: "complete" })}\n`);
    return { ...record, phase: "complete" };
  } catch (error) {
    record.status = "FAIL";
    record.validationError = String(error);
    await appendFile(invocationPath, `${JSON.stringify({ ...record, phase: "complete" })}\n`);
    throw error;
  }
}

if (auditOnly) {
  await auditExisting(auditRunId);
} else
  try {
    let topologyNumber = 0;
    for (const provider of providers) {
      for (const processes of processCounts) {
        for (const mode of modes) {
          topologyNumber++;
          const topology = {
            provider,
            processes,
            mode,
            startedAt: new Date().toISOString(),
            runs: [],
          };
          process.stdout.write(
            `TOPOLOGY_START ${topologyNumber}/16 ${provider} processes=${processes} mode=${mode}\n`,
          );
          for (let index = 0; index < cases.length; index++) {
            const config = { provider, processes, mode, ...cases[index], restart: true };
            const result = await runCase(config, index + 1);
            topology.runs.push({
              runId: result.runId,
              config,
              checks: result.checks,
              log: result.log,
            });
            process.stdout.write(
              `RUN_PASS ${topologyNumber}/16 ${provider} processes=${processes} mode=${mode} total=${config.total} burst=${config.burst} repeat=${index + 1} run=${result.runId}\n`,
            );
          }
          topology.status = "PASS";
          topology.endedAt = new Date().toISOString();
          manifest.topologies.push(topology);
          await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
          process.stdout.write(
            `TOPOLOGY_PASS ${topologyNumber}/16 ${provider} processes=${processes} mode=${mode}\n`,
          );
        }
      }
    }
    manifest.status = "PASS";
    manifest.endedAt = new Date().toISOString();
  } catch (error) {
    manifest.status = "FAIL_FAST";
    manifest.endedAt = new Date().toISOString();
    manifest.failure = String(error);
    await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (manifest.status === "PASS")
      await writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
