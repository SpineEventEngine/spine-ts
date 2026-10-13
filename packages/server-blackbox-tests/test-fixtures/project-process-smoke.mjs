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
import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { toBinary } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import {
  PlanningIdSchema,
  PortfolioIdSchema,
  ProjectIdSchema,
  StaffingIdSchema,
} from "../dist/generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflowIds } from "../dist/test-fixtures/project-workflow.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const task = resolve(root, "build-protocol/tasks/sql-delivery-reliability");
const providerName = process.argv[2] ?? "postgres16";
const count = Number(process.argv[3] ?? "2");
const mode = process.argv[4] ?? "db-only";
const total = Number(process.argv[5] ?? "1");
const burst = Number(process.argv[6] ?? "1");
const historicalName = process.argv
  .slice(7)
  .find((argument) => argument.startsWith("--historical="))
  ?.slice(13);
const restart = process.argv.includes("--restart");
assert.ok([2, 8].includes(count), "The focused smoke requires 2 or 8 processes.");
assert.ok(["db-only", "shared-memory"].includes(mode), "Unsupported Delivery mode.");
assert.ok(Number.isSafeInteger(total) && total > 0 && total <= 80);
assert.ok(Number.isSafeInteger(burst) && burst > 0 && burst <= 32);
const registry = JSON.parse(await readFile(resolve(task, "evidence/databases.json"), "utf8"));
const provider = registry.records.find((item) => item.name === providerName);
assert.ok(provider, `Unknown task database ${providerName}.`);
const runId = randomUUID().replaceAll("-", "");
const database = `sqlrel_matrix_${runId}`;
const dir = resolve(task, "evidence/matrix-runs", runId);
await mkdir(dir, { recursive: true });
const resourceIdentity = { runId, database, evidencePath: dir };
await writeFile(resolve(dir, "resource.json"), `${JSON.stringify(resourceIdentity, null, 2)}\n`);
process.stdout.write(`MATRIX_RESOURCE ${JSON.stringify(resourceIdentity)}\n`);
const entryLog = resolve(dir, "entries.jsonl");
let historicalWorkload;
let projectNumbers = Array.from({ length: total }, (_, index) => index + 1);
if (historicalName !== undefined) {
  const historical = JSON.parse(
    await readFile(resolve(task, "evidence/historical-project-workloads.json"), "utf8"),
  );
  const selected = historical.records.find((record) =>
    record.source.endsWith(`/${historicalName}.json`),
  );
  assert.ok(selected, `Unknown historical workload ${historicalName}.`);
  assert.equal(selected.attempted, total);
  assert.equal(selected.burst, burst);
  const mapped = selected.acceptedProjectIds.map((label) => {
    const suffix = /project-(\d+)$/u.exec(label);
    assert.ok(suffix, `Historical label has no Project index: ${label}.`);
    return { label, number: Number(suffix[1]) + 1 };
  });
  assert.equal(new Set(mapped.map((item) => item.number)).size, total);
  projectNumbers = mapped.map((item) => item.number).sort((left, right) => left - right);
  historicalWorkload = {
    source: `${historicalName}.json`,
    sourceSha256: selected.sourceSha256,
    mapping:
      "Historical scalar label suffix N maps to current ProjectId organization=run, number=N+1; submission follows numeric order, not recorded ACK order.",
  };
  await writeFile(resolve(dir, "historical-mapping.json"), `${JSON.stringify(mapped, null, 2)}\n`);
}
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
const isPostgres = provider.engine === "postgres";
const moduleName = isPostgres ? "storage-postgres" : "storage-mysql";
const providerRequire = createRequire(resolve(root, `packages/${moduleName}/package.json`));
const admin = isPostgres
  ? new (providerRequire("pg").Client)({ connectionString: provider.urls.spine_test })
  : await providerRequire("mysql2/promise").createConnection(provider.urls.spine_test);
const quoted = isPostgres ? `"${database}"` : `\`${database}\``;
const workers = [];
let deliveryProcess;
let deliveryReady;
let created = false;
let result;
let cleanupErrors = [];
try {
  if (isPostgres) await admin.connect();
  await admin.query(`CREATE DATABASE ${quoted}`);
  created = true;
  const url = new URL(provider.urls.spine_test);
  url.pathname = `/${database}`;
  const settings = {
    engine: provider.engine,
    url: url.href,
    contextName: `ProjectMatrix_${runId}`,
    organization: `matrix-${runId}`,
    number: 1,
    shards: count,
    entryLog,
    artifactPaths: artifacts.map((item) => item.path),
  };
  if (mode === "shared-memory") {
    deliveryProcess = fork(new URL("shared-delivery-worker.mjs", import.meta.url), [], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    deliveryProcess.stderr.on("data", (bytes) => {
      appendFileSync(resolve(dir, "delivery.stderr.log"), bytes);
    });
    deliveryProcess.stdout.on("data", (bytes) => {
      appendFileSync(resolve(dir, "delivery.stdout.log"), bytes);
    });
    deliveryReady = await request(deliveryProcess, "start");
    settings.deliveryEndpoint = deliveryReady.endpoint;
  }
  const ready = await launchAppWorkers(workers, settings, "worker");
  for (const item of ready) {
    assert.deepEqual(item.artifacts, artifacts, "Worker loaded unexpected dist artifacts.");
    assert.ok(item.endpoint.startsWith("http://127.0.0.1:"));
  }
  assert.equal(new Set(ready.map((item) => item.pid)).size, count);
  assert.ok(ready.every((item) => item.configuredShards === count));
  const commandLedger = [];
  const numbers = projectNumbers;
  for (let offset = 0; offset < total; offset += burst) {
    const batch = numbers.slice(offset, offset + burst);
    const submitted = batch.map((number, index) => {
      const commandId = randomUUID();
      appendFileSync(
        resolve(dir, "commands.jsonl"),
        `${JSON.stringify({ commandId, number, submittedAt: Date.now() })}\n`,
        { flush: true },
      );
      return request(workers[(offset + index) % count], "post", { commandId, number }, 30_000);
    });
    const accepted = await Promise.all(submitted);
    for (const item of accepted) {
      assert.equal(item.ackStatus?.case, "ok", `Project ${item.number} must be accepted.`);
      commandLedger.push(item);
    }
  }
  await writeFile(resolve(dir, "admission.json"), `${JSON.stringify(commandLedger, null, 2)}\n`);
  assert.equal(commandLedger.length, total);
  assert.deepEqual(
    [...new Set(commandLedger.map((item) => item.number))].sort((left, right) => left - right),
    numbers,
    "Each accepted Command must identify one distinct submitted Project.",
  );
  const deadline = Date.now() + 90_000;
  let snapshots;
  while (Date.now() < deadline) {
    const first = await request(workers[0], "inspect", { numbers }, 60_000);
    if (first.projects.every((item) => Object.values(item.states).every(Boolean))) {
      snapshots = [
        first,
        ...(await Promise.all(
          workers.slice(1).map((worker) => request(worker, "inspect", { numbers }, 60_000)),
        )),
      ];
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await writeFile(resolve(dir, "last-snapshots.json"), `${JSON.stringify(snapshots, null, 2)}\n`);
  assert.ok(
    snapshots?.every((item) =>
      item.projects.every((project) => Object.values(project.states).every(Boolean)),
    ),
    "Project states did not converge in every process.",
  );
  assert.ok(
    snapshots.every((item) => item.events.length === total),
    "Expected one original stored ProjectCreated Event per accepted Command.",
  );
  const eventsByNumber = new Map(snapshots[0].events.map((event) => [event.number, event]));
  assert.equal(eventsByNumber.size, total);
  assert.deepEqual(
    [...eventsByNumber.keys()].sort((left, right) => left - right),
    numbers,
    "Stored original Events must correspond to every accepted Project Command.",
  );
  assert.equal(new Set([...eventsByNumber.values()].map((event) => event.id)).size, total);
  assert.ok(
    [...eventsByNumber.values()].every((event) => event.id && event.sha256 && event.binaryBase64),
  );
  assert.ok(
    [...eventsByNumber.values()].every(
      (event) =>
        event.organization === settings.organization && event.name === `roadmap-${event.number}`,
    ),
  );
  assert.ok(
    snapshots.every((item) =>
      item.events.every((event) => {
        const original = eventsByNumber.get(event.number);
        return (
          original?.id === event.id &&
          original.sha256 === event.sha256 &&
          original.binaryBase64 === event.binaryBase64
        );
      }),
    ),
  );
  await writeFile(
    resolve(dir, "events.json"),
    `${JSON.stringify([...eventsByNumber.values()], null, 2)}\n`,
  );
  const entries = (await readFile(entryLog, "utf8")).trim().split("\n").map(JSON.parse);
  const methods = ["create", "planning", "staffing", "portfolio", "projection"];
  for (const number of numbers) {
    assertMethodEntries(entries, number, settings.organization, methods);
  }
  assert.equal(entries.length, total * methods.length);
  let restartResult;
  if (restart) {
    const firstClose = await Promise.all(
      workers.map((worker) => request(worker, "close", {}, 5000)),
    );
    assert.ok(firstClose.every((item) => item.closed));
    const priorExits = await Promise.all(workers.map((worker) => stopRecordedChild(worker)));
    assert.ok(priorExits.every((item) => item.code === 0));
    workers.length = 0;
    const restarted = await launchAppWorkers(workers, settings, "restart-worker");
    assert.equal(new Set(restarted.map((item) => item.pid)).size, count);
    assert.ok(restarted.every((item) => !ready.some((old) => old.pid === item.pid)));
    assert.ok(restarted.every((item) => item.configuredShards === count));
    assert.ok(
      restarted.every((item) => JSON.stringify(item.artifacts) === JSON.stringify(artifacts)),
    );
    const resumed = await Promise.all(
      workers.map((worker) => request(worker, "inspect", { numbers }, 60_000)),
    );
    await writeFile(
      resolve(dir, "restart-snapshots.json"),
      `${JSON.stringify(resumed, null, 2)}\n`,
    );
    assert.ok(
      resumed.every((item) =>
        item.projects.every((project) => Object.values(project.states).every(Boolean)),
      ),
    );
    assert.ok(resumed.every((item) => item.events.length === total));
    assert.ok(
      resumed.every((item) =>
        item.events.every((event) => {
          const original = eventsByNumber.get(event.number);
          return (
            original?.id === event.id &&
            original.sha256 === event.sha256 &&
            original.binaryBase64 === event.binaryBase64
          );
        }),
      ),
    );
    assert.equal((await readFile(entryLog, "utf8")).trim().split("\n").length, entries.length);
    const newNumber = Math.max(...numbers) + 1;
    const newCommandId = randomUUID();
    appendFileSync(
      resolve(dir, "commands.jsonl"),
      `${JSON.stringify({ commandId: newCommandId, number: newNumber, phase: "after-restart", submittedAt: Date.now() })}\n`,
      { flush: true },
    );
    const newAck = await request(
      workers[0],
      "post",
      { commandId: newCommandId, number: newNumber },
      30_000,
    );
    assert.equal(newAck.ackStatus?.case, "ok");
    let newStates;
    const resumedDeadline = Date.now() + 30_000;
    while (Date.now() < resumedDeadline) {
      newStates = await Promise.all(
        workers.map((worker) => request(worker, "inspect", { numbers: [newNumber] }, 30_000)),
      );
      if (
        newStates.every((view) =>
          view.projects.every((item) => Object.values(item.states).every(Boolean)),
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      newStates?.every((view) =>
        view.projects.every((item) => Object.values(item.states).every(Boolean)),
      ),
    );
    await writeFile(
      resolve(dir, "post-restart-snapshots.json"),
      `${JSON.stringify(newStates, null, 2)}\n`,
    );
    const newEvent = newStates[0].events.find((event) => event.number === newNumber);
    assert.ok(newEvent?.id);
    assert.ok(newEvent.sha256 && newEvent.binaryBase64);
    assert.ok(newStates.every((view) => view.events.length === total + 1));
    for (const view of newStates) {
      const observed = view.events.find((event) => event.number === newNumber);
      assert.equal(observed?.id, newEvent.id);
      assert.equal(observed?.sha256, newEvent.sha256);
      assert.equal(observed?.binaryBase64, newEvent.binaryBase64);
      for (const event of view.events) {
        if (event.number === newNumber) continue;
        const original = eventsByNumber.get(event.number);
        assert.equal(event.id, original?.id);
        assert.equal(event.sha256, original?.sha256);
        assert.equal(event.binaryBase64, original?.binaryBase64);
      }
    }
    const allEntries = (await readFile(entryLog, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(allEntries.length, entries.length + methods.length);
    assertMethodEntries(allEntries, newNumber, settings.organization, methods);
    const newEntries = allEntries.filter(
      (entry) => entry.correlation === `${settings.organization}:${newNumber}`,
    );
    assert.ok(newEntries.every((entry) => restarted.some((worker) => worker.pid === entry.pid)));
    restartResult = {
      priorExits,
      newPids: restarted.map((item) => item.pid),
      newCommandId,
      newEventId: newEvent.id,
      newEventSha256: newEvent.sha256,
      newEventBinaryBase64: newEvent.binaryBase64,
      newRecipientEntries: newEntries,
      retainedEventCount: total,
      entryCountAfterRestart: allEntries.length,
    };
  }
  result = {
    status: "PASS",
    runId,
    provider: provider.name,
    mode,
    database,
    processes: count,
    configuredShards: count,
    total,
    burst,
    historicalWorkload,
    restart,
    pids: ready.map((item) => item.pid),
    deliveryPid: deliveryReady?.pid,
    endpoints: ready.map((item) => item.endpoint),
    artifacts,
    commandCount: commandLedger.length,
    eventCount: eventsByNumber.size,
    eventLedgerSha256: createHash("sha256")
      .update(JSON.stringify([...eventsByNumber.values()]))
      .digest("hex"),
    entryCount: entries.length,
    entryMethods: methods,
    stateCopies: snapshots.length,
    restartResult,
  };
} finally {
  cleanupErrors = [];
  const workerExits = [];
  const closed = await Promise.allSettled(
    workers.map((worker) => request(worker, "close", {}, 5000)),
  );
  for (const [index, settled] of closed.entries()) {
    if (settled.status === "rejected") cleanupErrors.push(`app close ${index}: ${settled.reason}`);
  }
  for (const worker of workers) workerExits.push(await stopRecordedChild(worker));
  for (const exit of workerExits) {
    if (exit.code !== 0)
      cleanupErrors.push(`app ${exit.pid} exit: ${String(exit.code)}/${String(exit.signal)}`);
  }
  let deliveryExit;
  if (deliveryProcess !== undefined) {
    try {
      await request(deliveryProcess, "close", {}, 5000);
    } catch (error) {
      cleanupErrors.push(`delivery close: ${String(error)}`);
    }
    deliveryExit = await stopRecordedChild(deliveryProcess);
    if (deliveryExit.code !== 0)
      cleanupErrors.push(
        `delivery ${deliveryExit.pid} exit: ${String(deliveryExit.code)}/${String(deliveryExit.signal)}`,
      );
  }
  let databaseDropped = false;
  try {
    if (created) {
      await admin.query(`DROP DATABASE ${quoted}${isPostgres ? " WITH (FORCE)" : ""}`);
      databaseDropped = true;
    }
  } catch (error) {
    cleanupErrors.push(`database drop: ${String(error)}`);
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupErrors.push(`admin close: ${String(error)}`);
  }
  const cleanup = { databaseDropped, workerExits, deliveryExit, errors: cleanupErrors };
  await writeFile(resolve(dir, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`);
}
if (cleanupErrors.length > 0)
  throw new Error(`Process smoke cleanup failed: ${cleanupErrors.join("; ")}`);
if (result !== undefined) {
  await writeFile(resolve(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function launchAppWorkers(target, settings, label) {
  for (let index = 0; index < count; index++) {
    const worker = fork(new URL("project-worker.mjs", import.meta.url), [], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    worker.stderr.on("data", (bytes) => {
      appendFileSync(resolve(dir, `${label}-${index}.stderr.log`), bytes);
    });
    worker.stdout.on("data", (bytes) => {
      appendFileSync(resolve(dir, `${label}-${index}.stdout.log`), bytes);
    });
    target.push(worker);
  }
  return Promise.all(target.map((worker) => request(worker, "start", { settings })));
}

function assertMethodEntries(entries, number, organization, methods) {
  const ids = projectWorkflowIds(organization, number);
  const recipients = {
    create: [ProjectIdSchema, ids.project],
    planning: [PlanningIdSchema, ids.planning],
    staffing: [StaffingIdSchema, ids.staffing],
    portfolio: [PortfolioIdSchema, ids.portfolio],
    projection: [ProjectIdSchema, ids.project],
  };
  for (const method of methods) {
    const matched = entries.filter(
      (entry) => entry.method === method && entry.correlation === `${organization}:${number}`,
    );
    assert.equal(matched.length, 1, `${method} must enter exactly once for Project ${number}.`);
    const [schema, id] = recipients[method];
    assert.equal(matched[0].recipientTypeUrl, TypeUrls.derive(schema));
    assert.equal(
      matched[0].recipientIdBase64,
      Buffer.from(toBinary(schema, id)).toString("base64"),
    );
  }
}

async function stopRecordedChild(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null)
    return { pid: worker.pid, code: worker.exitCode, signal: worker.signalCode };
  if (worker.connected) worker.disconnect();
  let exit = await waitForExit(worker, 2000);
  if (exit === undefined) {
    worker.kill("SIGTERM");
    exit = await waitForExit(worker, 2000);
  }
  if (exit === undefined) {
    worker.kill("SIGKILL");
    exit = await waitForExit(worker, 2000);
  }
  return { pid: worker.pid, ...(exit ?? { code: null, signal: "UNREAPED" }) };
}

function waitForExit(worker, timeoutMs) {
  if (worker.exitCode !== null || worker.signalCode !== null)
    return Promise.resolve({ code: worker.exitCode, signal: worker.signalCode });
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      worker.off("exit", onExit);
      resolveExit(undefined);
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    };
    worker.once("exit", onExit);
  });
}

function request(worker, kind, fields = {}, timeoutMs = 15_000) {
  return new Promise((resolveRequest, rejectRequest) => {
    const requestId = randomUUID();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error === undefined) resolveRequest(result);
      else rejectRequest(error);
    };
    const timer = setTimeout(() => {
      finish(new Error(`Worker ${worker.pid} did not respond to ${kind}.`));
    }, timeoutMs);
    const onMessage = (message) => {
      if (message.requestId !== requestId) return;
      if (message.ok) finish(undefined, message.result);
      else finish(new Error(`Worker ${worker.pid} ${kind}: ${message.error}`));
    };
    const onExit = (code) => {
      finish(new Error(`Worker ${worker.pid} exited ${String(code)} during ${kind}.`));
    };
    const onDisconnect = () => {
      finish(new Error(`Worker ${worker.pid} disconnected during ${kind}.`));
    };
    const onError = (error) => {
      finish(new Error(`Worker ${worker.pid} IPC failed during ${kind}.`, { cause: error }));
    };
    const cleanup = () => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("exit", onExit);
      worker.off("disconnect", onDisconnect);
      worker.off("error", onError);
    };
    worker.on("message", onMessage);
    worker.on("exit", onExit);
    worker.on("disconnect", onDisconnect);
    worker.on("error", onError);
    try {
      worker.send({ requestId, kind, ...fields }, (error) => {
        if (error !== null && error !== undefined) onError(error);
      });
    } catch (error) {
      onError(error);
    }
  });
}
