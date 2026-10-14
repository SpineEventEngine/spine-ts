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

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";

const root = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const evidence = resolve(root, "build-protocol/tasks/sql-delivery-reliability/evidence");
const runs = resolve(evidence, "process-fault-runs");
const outputRoot = resolve(evidence, "process-fault-matrix");
const sessionId = randomUUID();
const sessionDir = resolve(outputRoot, `sessions/${sessionId}`);
const manifestPath = resolve(sessionDir, "summary.json");
const invocationPath = resolve(sessionDir, "invocations.jsonl");
const providers = ["postgres16", "postgres18", "mysql84", "mariadb114"];
const processCounts = [2, 8];
const scenarios = [
  "before-effect",
  "after-save-before-ack",
  "partial-publication-repair",
  "shared-volatile-loss",
];
const scenarioFiles = {
  "before-effect": "before-effect.json",
  "after-save-before-ack": "after-save-before-ack.json",
  "partial-publication-repair": "partial-publication-repair.json",
  "shared-volatile-loss": "shared-before-crash.json",
};
const methods = ["create", "planning", "staffing", "portfolio", "projection"];
const recipientTypeUrls = {
  create: "type.spine.server.testing/spine.server.testing.ProjectId",
  planning: "type.spine.server.testing/spine.server.testing.PlanningId",
  staffing: "type.spine.server.testing/spine.server.testing.StaffingId",
  portfolio: "type.spine.server.testing/spine.server.testing.PortfolioId",
  projection: "type.spine.server.testing/spine.server.testing.ProjectId",
};
const deliveryTargetTypeUrls = {
  planning: "type.spine.server.testing/spine.server.testing.PlanningState",
  staffing: "type.spine.server.testing/spine.server.testing.StaffingState",
  portfolio: "type.spine.server.testing/spine.server.testing.PortfolioState",
  projection: "type.spine.server.testing/spine.server.testing.ProjectProjectionState",
};
const stateNames = ["project", "planning", "staffing", "portfolio", "projection"];
const resultTimeoutMs = 240_000;
const termGraceMs = 2_000;
const reapTimeoutMs = 5_000;

const provenancePaths = [
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
  "packages/server-blackbox-tests/test-fixtures/project-process-faults.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-worker.mjs",
  "packages/server-blackbox-tests/test-fixtures/shared-delivery-worker.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-process-fault-observations.mjs",
  "packages/server-blackbox-tests/test-fixtures/resistant-fault-driver.mjs",
  "packages/server-blackbox-tests/test-fixtures/project-workflow.ts",
  "packages/server-blackbox-tests/test/project-process-faults.integration.test.ts",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(directory, name) {
  return readFile(resolve(directory, name), "utf8").then(JSON.parse);
}

function assertFullState(snapshot, label) {
  const project = snapshot?.projects?.find((row) => row.number === 1);
  assert(project !== undefined, `${label}: project 1 is missing`);
  assert(
    stateNames.every((name) => project.states?.[name] === true),
    `${label}: project 1 state set is incomplete`,
  );
}

function assertEventIntegrity(event, label) {
  assert(event?.id, `${label}: Event ID is missing`);
  assert(event.sha256, `${label}: Event SHA-256 is missing`);
  assert(
    typeof event.binaryBase64 === "string" && event.binaryBase64.length > 0,
    `${label}: Event bytes are missing`,
  );
  const bytes = Buffer.from(event.binaryBase64, "base64");
  assert(
    bytes.length > 0 && bytes.toString("base64") === event.binaryBase64,
    `${label}: Event bytes are not canonical base64`,
  );
  assert(sha256(bytes) === event.sha256, `${label}: Event bytes do not match SHA-256`);
  return { id: event.id, sha256: event.sha256, binaryBase64: event.binaryBase64 };
}

function assertSameEvent(actual, expected, label) {
  const normalized = assertEventIntegrity(actual, label);
  assert(
    normalized.id === expected.id &&
      normalized.sha256 === expected.sha256 &&
      normalized.binaryBase64 === expected.binaryBase64,
    `${label}: Event identity or serialized bytes changed`,
  );
}

function countMethods(entries) {
  return Object.fromEntries(
    methods.map((method) => [method, entries.filter((entry) => entry.method === method).length]),
  );
}

function assertEntrySet(entries, expectedCounts, processCount, label) {
  assert(Array.isArray(entries), `${label}: handler entries are missing`);
  assert(
    entries.every(
      (entry) =>
        methods.includes(entry.method) &&
        Number.isInteger(entry.pid) &&
        entry.recipientTypeUrl === recipientTypeUrls[entry.method] &&
        typeof entry.recipientIdBase64 === "string" &&
        entry.recipientIdBase64.length > 0 &&
        Buffer.from(entry.recipientIdBase64, "base64").length > 0 &&
        Buffer.from(entry.recipientIdBase64, "base64").toString("base64") ===
          entry.recipientIdBase64,
    ),
    `${label}: malformed or unexpected handler entry`,
  );
  const counts = countMethods(entries);
  for (const method of methods)
    assert(
      counts[method] === expectedCounts[method],
      `${label}: ${method} entry count ${counts[method]} != ${expectedCounts[method]}`,
    );
  assert(
    new Set(entries.map((entry) => entry.pid)).size <= processCount + 1,
    `${label}: unexpected number of worker PIDs`,
  );
  return {
    entries: entries.length,
    methodCounts: counts,
    pids: [...new Set(entries.map((entry) => entry.pid))].sort((a, b) => a - b),
  };
}

function completeDeliveryRows(observation, processCount, label) {
  const expectedShards = Array.from(
    { length: processCount },
    (_, index) => `${index}/${processCount}`,
  );
  if (processCount !== 1) expectedShards.push("0/1");
  assert(Array.isArray(observation?.shards), `${label}: Inbox shard observations are missing`);
  const actualShards = observation.shards.map((shard) => shard.shard).sort();
  assert(
    JSON.stringify(actualShards) === JSON.stringify(expectedShards.sort()),
    `${label}: expected every Inbox shard exactly once`,
  );
  return observation.shards.flatMap((shard) => {
    assert(shard.error === undefined, `${label}: Inbox shard ${shard.shard} reports an error`);
    assert(shard.truncated === false, `${label}: Inbox shard ${shard.shard} was truncated`);
    assert(Array.isArray(shard.rows), `${label}: Inbox shard ${shard.shard} has no rows array`);
    assert(shard.count === shard.rows.length, `${label}: Inbox shard ${shard.shard} count differs`);
    assert(
      shard.rows.every(
        (row) =>
          typeof row.messageId === "string" &&
          row.messageId.length > 0 &&
          typeof row.signalId === "string" &&
          row.signalId.length > 0 &&
          typeof row.status === "string" &&
          row.status.length > 0,
      ),
      `${label}: Inbox rows are missing message identity, Event identity, or status`,
    );
    return shard.rows;
  });
}

function assertSameSnapshot(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: final scenario record differs from its persisted snapshot`,
  );
}

async function snapshotProvenance() {
  const files = {};
  for (const relative of provenancePaths) {
    const bytes = await readFile(resolve(root, relative));
    files[relative] = sha256(bytes);
  }
  return files;
}

async function auditScenario(config, result, runDirectory) {
  const scenarioRecord = await readJson(runDirectory, scenarioFiles[config.scenario]);
  const commandIds =
    scenarioRecord.receivedAckIDs ??
    scenarioRecord.acknowledgedCommandIds ??
    result.receivedAckIDs ??
    result.acknowledgedCommandIds;
  assert(
    Array.isArray(commandIds) && commandIds.length > 0,
    "acknowledged Command IDs are missing",
  );
  assert(new Set(commandIds).size === commandIds.length, "acknowledged Command IDs are duplicated");
  const checks = { acknowledgedCommandIds: commandIds, scenario: config.scenario };

  if (config.scenario === "before-effect") {
    assert(commandIds.length === 1, "before-effect must acknowledge one Command");
    const preKillSnapshot = await readJson(runDirectory, "before-effect-pre-kill.json");
    const postKillSnapshot = await readJson(runDirectory, "before-effect-post-kill.json");
    const recoveredSnapshot = await readJson(
      runDirectory,
      "before-effect-recovered-pre-assert.json",
    );
    assert(scenarioRecord.entered?.method === "planning", "before-effect did not stop at Planning");
    assert(
      scenarioRecord.entered.pid === scenarioRecord.killedPid,
      "before-effect killed PID differs from gated handler PID",
    );
    assertFullState(scenarioRecord.after, "before-effect replay result");
    const original = assertEventIntegrity(
      scenarioRecord.before?.events?.[0],
      "before-effect initial Event",
    );
    assertSameEvent(
      scenarioRecord.after?.events?.find((event) => event.id === original.id),
      original,
      "before-effect replay Event",
    );
    assertSameSnapshot(
      preKillSnapshot.preKillDelivery,
      scenarioRecord.preKillDelivery,
      "before-effect pre-kill Inbox snapshot",
    );
    assertSameSnapshot(
      preKillSnapshot.entered,
      scenarioRecord.entered,
      "before-effect entered record",
    );
    assertSameSnapshot(
      preKillSnapshot.before,
      scenarioRecord.before,
      "before-effect initial state",
    );
    assert(
      postKillSnapshot.killedPid === scenarioRecord.killedPid,
      "before-effect post-kill snapshot PID differs",
    );
    assertSameSnapshot(
      postKillSnapshot.postKill,
      scenarioRecord.postKill,
      "before-effect post-kill state",
    );
    assertSameSnapshot(
      postKillSnapshot.postKillDelivery,
      scenarioRecord.postKillDelivery,
      "before-effect post-kill Inbox snapshot",
    );
    assertSameSnapshot(
      recoveredSnapshot.after,
      scenarioRecord.after,
      "before-effect recovered state",
    );
    assertSameSnapshot(
      recoveredSnapshot.allEntries,
      scenarioRecord.allEntries,
      "before-effect recovered handler ledger",
    );
    assertSameSnapshot(
      recoveredSnapshot.restartPids,
      scenarioRecord.restartPids,
      "before-effect recovered PID set",
    );
    assertSameSnapshot(
      recoveredSnapshot.recoveredDelivery,
      scenarioRecord.recoveredDelivery,
      "before-effect recovered Inbox snapshot",
    );
    const preKillRows = completeDeliveryRows(
      scenarioRecord.preKillDelivery,
      config.processes,
      "before-effect pre-kill Inbox",
    );
    const postKillRows = completeDeliveryRows(
      scenarioRecord.postKillDelivery,
      config.processes,
      "before-effect post-kill Inbox",
    );
    completeDeliveryRows(
      scenarioRecord.recoveredDelivery,
      config.processes,
      "before-effect recovered Inbox",
    );
    const oldPids = preKillSnapshot.ready.map((worker) => worker.pid);
    assert(
      oldPids.length === config.processes && new Set(oldPids).size === config.processes,
      "before-effect initial PID set is incomplete",
    );
    assert(
      Array.isArray(scenarioRecord.extraReplays),
      "before-effect measured extra-replay classification is missing",
    );
    const extraReplayMethods = scenarioRecord.extraReplays.map((replay) => replay.method);
    assert(
      extraReplayMethods.every((method) =>
        ["staffing", "portfolio", "projection"].includes(method),
      ) && new Set(extraReplayMethods).size === extraReplayMethods.length,
      "before-effect extra-replay methods are invalid or duplicated",
    );
    const expectedCounts = { create: 1, planning: 2 };
    for (const method of ["staffing", "portfolio", "projection"]) {
      const count = scenarioRecord.allEntries.filter((entry) => entry.method === method).length;
      assert(
        count === 1 || count === 2,
        `before-effect ${method} entry count ${count} is outside the measured replay range`,
      );
      const replay = scenarioRecord.extraReplays.find((entry) => entry.method === method);
      assert(
        (count === 2) === (replay !== undefined),
        `before-effect ${method} duplicate entry does not match its measured replay classification`,
      );
      expectedCounts[method] = count;
      if (replay !== undefined) {
        const methodEntries = scenarioRecord.allEntries.filter((entry) => entry.method === method);
        const oldEntries = methodEntries.filter((entry) => oldPids.includes(entry.pid));
        const freshEntries = methodEntries.filter((entry) =>
          scenarioRecord.restartPids.includes(entry.pid),
        );
        assert(
          oldEntries.length === 1 && freshEntries.length === 1,
          `before-effect ${method} replay does not have one old and one fresh PID entry`,
        );
        assert(
          replay.preKillEffect === scenarioRecord.before.projects[0].states[method],
          `before-effect ${method} replay effect snapshot differs`,
        );
        assert(
          oldEntries[0].recipientTypeUrl === freshEntries[0].recipientTypeUrl &&
            oldEntries[0].recipientIdBase64 === freshEntries[0].recipientIdBase64,
          `before-effect ${method} old and fresh entries target different typed recipients`,
        );
        const exactRow = (row) =>
          row.signalId === original.id &&
          row.targetTypeUrl === deliveryTargetTypeUrls[method] &&
          row.targetIdTypeUrl === oldEntries[0].recipientTypeUrl &&
          row.targetIdBase64 === oldEntries[0].recipientIdBase64;
        const preRows = preKillRows.filter(exactRow);
        const postRows = postKillRows.filter(exactRow);
        assert(
          preRows.length === 1 && postRows.length === 1,
          `before-effect ${method} replay is not supported by exactly one original-Event row for the typed recipient`,
        );
        assert(
          preRows[0].status === "TO_DELIVER" &&
            postRows[0].status === "TO_DELIVER" &&
            postRows[0].messageId === preRows[0].messageId &&
            replay.pendingMessageId === preRows[0].messageId &&
            postRows[0].targetIdTypeUrl === preRows[0].targetIdTypeUrl &&
            postRows[0].targetIdBase64 === preRows[0].targetIdBase64 &&
            [oldEntries[0], freshEntries[0]].every(
              (entry) =>
                preRows[0].targetIdTypeUrl === entry.recipientTypeUrl &&
                preRows[0].targetIdBase64 === entry.recipientIdBase64,
            ),
          `before-effect ${method} replay row does not match the exact typed old and fresh handler recipients`,
        );
      }
    }
    const entryCheck = assertEntrySet(
      scenarioRecord.allEntries,
      expectedCounts,
      config.processes,
      "before-effect entries",
    );
    assert(
      new Set(scenarioRecord.restartPids).size === config.processes,
      "before-effect restart PID count is invalid",
    );
    const recoveredPlanning = scenarioRecord.allEntries.filter(
      (entry) => entry.method === "planning" && scenarioRecord.restartPids.includes(entry.pid),
    );
    const gatedPlanning = scenarioRecord.allEntries.filter(
      (entry) => entry.method === "planning" && entry.pid === scenarioRecord.killedPid,
    );
    assert(
      recoveredPlanning.length === 1 &&
        recoveredPlanning[0].pid !== scenarioRecord.killedPid &&
        gatedPlanning.length === 1,
      "before-effect replay did not enter Planning on a restarted worker",
    );
    assert(
      scenarioRecord.restartPids.includes(scenarioRecord.entered.pid) === false,
      "killed before-effect PID appears in restart set",
    );
    assert(
      scenarioRecord.allEntries.every(
        (entry) => oldPids.includes(entry.pid) || scenarioRecord.restartPids.includes(entry.pid),
      ),
      "before-effect handler entry contains an unknown process PID",
    );
    assert(
      result.killedPid === scenarioRecord.killedPid,
      "result does not record the selected process kill",
    );
    if (scenarioRecord.postKill !== undefined)
      assert(
        scenarioRecord.postKill?.projects?.[0]?.states?.planning === false,
        "post-kill state observation incorrectly completed Planning",
      );
    else
      assert(
        config.requireKillObservation !== true,
        "required post-kill state observation is missing",
      );
    checks.event = original;
    checks.handlerEntries = entryCheck;
    checks.restartPids = scenarioRecord.restartPids;
    checks.completedStates = true;
    checks.extraRecipientReplays = scenarioRecord.extraReplays;
    checks.deliverySnapshots = {
      preKillShardCount: scenarioRecord.preKillDelivery.shards.length,
      postKillShardCount: scenarioRecord.postKillDelivery.shards.length,
      recoveredShardCount: scenarioRecord.recoveredDelivery.shards.length,
    };
    checks.killEvidence = {
      selectedPid: scenarioRecord.killedPid,
      enteredHandlerPid: scenarioRecord.entered.pid,
      planningEntriesOnKilledPid: gatedPlanning.length,
      replayPlanningPids: recoveredPlanning.map((entry) => entry.pid),
      postKillStateObservationRecorded: scenarioRecord.postKill !== undefined,
    };
  } else if (config.scenario === "after-save-before-ack") {
    const preRestart = await readJson(runDirectory, "ack-pre-restart.json");
    assert(commandIds.length === 1, "after-save-before-ack must acknowledge one Command");
    assert(
      scenarioRecord.pending?.signalId === result.eventId,
      "pending row does not reference the original Event",
    );
    assert(
      scenarioRecord.pending.status === "TO_DELIVER",
      "pending row was not left pending at the selected boundary",
    );
    const original = assertEventIntegrity(
      scenarioRecord.original,
      "after-save-before-ack original Event",
    );
    const savedProject = scenarioRecord.saved?.observation?.projects?.find(
      (project) => project.number === 1,
    );
    assert(savedProject !== undefined, "saved pre-ack state omitted Project 1");
    assert(
      savedProject.states?.project === true && savedProject.states?.planning === true,
      "saved pre-ack state did not commit Project and the selected Planning handler",
    );
    assert(
      Object.values(savedProject.states ?? {}).every((state) => typeof state === "boolean"),
      "saved pre-ack state contains a non-boolean state value",
    );
    assertSameEvent(
      scenarioRecord.saved?.observation?.events?.find((event) => event.id === original.id),
      original,
      "after-save-before-ack saved Event",
    );
    assertSameSnapshot(
      preRestart.saved,
      scenarioRecord.saved,
      "after-save-before-ack saved snapshot",
    );
    assertSameSnapshot(
      preRestart.pending,
      scenarioRecord.pending,
      "after-save-before-ack pending row",
    );
    assertFullState(scenarioRecord.after, "after-save-before-ack recovered state");
    assert(
      original.id === result.eventId &&
        (result.eventSha256 === undefined || original.sha256 === result.eventSha256),
      "result Event identity differs from original Event",
    );
    assertSameEvent(
      scenarioRecord.after?.events?.find((event) => event.id === original.id),
      original,
      "after-save-before-ack recovered Event",
    );
    const entryCheck = assertEntrySet(
      scenarioRecord.entries,
      { create: 1, planning: 2, staffing: 1, portfolio: 1, projection: 1 },
      config.processes,
      "after-save-before-ack entries",
    );
    assert(
      Array.isArray(preRestart.oldPids) &&
        preRestart.oldPids.length === config.processes &&
        preRestart.oldPids.includes(scenarioRecord.entered.pid),
      "old app PID set is missing or has wrong size",
    );
    const replayEntries = scenarioRecord.entries.filter(
      (entry) => entry.method === "planning" && !preRestart.oldPids.includes(entry.pid),
    );
    assert(
      replayEntries.length === 1 &&
        replayEntries.every((entry) => !preRestart.oldPids.includes(entry.pid)),
      "replayed Planning entry did not use a fresh app PID",
    );
    assert(
      scenarioRecord.recovered?.auditCount === 1,
      "exact pending-row recovery audit count mismatch",
    );
    assert(
      result.killedPid === scenarioRecord.killedPid &&
        preRestart.preRestartStatus === 1 &&
        preRestart.attempts >= 1,
      "selected worker kill or exact pending-row pre-restart evidence is incomplete",
    );
    checks.event = original;
    checks.handlerEntries = entryCheck;
    checks.freshReplayPids = replayEntries.map((entry) => entry.pid);
    checks.completedStates = true;
  } else if (config.scenario === "partial-publication-repair") {
    assert(commandIds.length === 1, "partial repair must acknowledge one Command");
    assert(
      Number.isInteger(scenarioRecord.failedInsertAttempts) &&
        scenarioRecord.failedInsertAttempts > 0,
      "publication fault counter is missing",
    );
    assertFullState(scenarioRecord.after, "partial-publication repair result");
    const original = assertEventIntegrity(
      scenarioRecord.original ?? scenarioRecord.partial?.original,
      "partial-publication original Event",
    );
    assert(
      original.id === result.eventId && original.sha256 === result.eventSha256,
      "result Event identity differs from partial-publication Event",
    );
    assertSameEvent(
      scenarioRecord.after?.events?.find((event) => event.id === original.id),
      original,
      "partial-publication repaired Event",
    );
    assert(
      scenarioRecord.partial?.snapshot?.projects?.some(
        (row) => row.number === 1 && stateNames.some((name) => row.states?.[name] === false),
      ),
      "partial-publication snapshot did not retain its partial-state observation",
    );
    assert(
      Array.isArray(scenarioRecord.repairs) && scenarioRecord.repairs.length > 0,
      "repair outcomes are missing",
    );
    const repairOutcomes = scenarioRecord.repairs.flat();
    assert(
      repairOutcomes.every(
        (repair) => repair.eventId === original.id && repair.status === "ADMITTED",
      ),
      "repair outcome/event identity mismatch",
    );
    const entryCheck = assertEntrySet(
      scenarioRecord.entries,
      { create: 1, planning: 1, staffing: 1, portfolio: 1, projection: 1 },
      config.processes,
      "partial-publication entries",
    );
    assert(
      new Set(scenarioRecord.restartPids).size === config.processes,
      "partial-publication fresh PID count mismatch",
    );
    assert(
      scenarioRecord.restartPids.some((pid) => entryCheck.pids.includes(pid)),
      "partial-publication entries have no fresh-worker PID",
    );
    const preCleanup = scenarioRecord.beforePostCleanupRepair;
    if (config.requireColdRepair === true)
      assert(preCleanup !== undefined, "required cold-repair pre-replay snapshot is missing");
    if (preCleanup !== undefined) {
      assert(Array.isArray(preCleanup.entries), "cold-repair baseline handler entries are missing");
      assertFullState(preCleanup.state, "cold-repair pre-replay state");
      assertSameEvent(
        preCleanup.state?.events?.find((event) => event.id === original.id),
        original,
        "cold-repair pre-replay Event",
      );
      assert(
        Array.isArray(preCleanup.inbox?.shards) &&
          preCleanup.inbox.shards.length > 0 &&
          preCleanup.inbox.shards.every(
            (shard) =>
              shard.error === undefined &&
              shard.truncated === false &&
              Array.isArray(shard.rows) &&
              shard.count === shard.rows.length,
          ) &&
          !preCleanup.inbox.shards.some((shard) =>
            shard.rows.some((row) => row.messageId === original.id || row.signalId === original.id),
          ),
        "cold-repair pre-replay shard reads are incomplete or still contain the original Event",
      );
      assert(
        Array.isArray(scenarioRecord.beforeColdRestartPids) &&
          scenarioRecord.beforeColdRestartPids.length === config.processes &&
          Array.isArray(scenarioRecord.postCleanupPids) &&
          new Set(scenarioRecord.postCleanupPids).size === config.processes &&
          scenarioRecord.postCleanupPids.every(
            (pid) => !scenarioRecord.beforeColdRestartPids.includes(pid),
          ),
        "cold-repair replay did not use a fresh complete process set",
      );
      assert(
        scenarioRecord.postCleanupReplay?.length === 1 &&
          scenarioRecord.postCleanupReplay[0].eventId === original.id &&
          scenarioRecord.postCleanupReplay[0].status === "ADMITTED",
        "cold-repair API outcome is not the exact original-ID ADMITTED result",
      );
      const coldBaselineEntries = preCleanup.entries;
      const coldBaselineCounts = ["planning", "staffing", "portfolio", "projection"].map(
        (method) => coldBaselineEntries.filter((entry) => entry.method === method).length,
      );
      const coldFinalCounts = ["planning", "staffing", "portfolio", "projection"].map(
        (method) => scenarioRecord.replayEntries.filter((entry) => entry.method === method).length,
      );
      assert(
        JSON.stringify(scenarioRecord.initialCounts) === JSON.stringify(coldBaselineCounts) &&
          JSON.stringify(scenarioRecord.finalCounts) === JSON.stringify(coldFinalCounts) &&
          coldFinalCounts.every((value, index) => value === coldBaselineCounts[index] + 1),
        "cold-repair recipient counts do not show exactly one additional entry per method",
      );
      const replayEntries = scenarioRecord.replayEntries;
      const replayCounts = countMethods(replayEntries);
      assert(
        replayCounts.create ===
          coldBaselineEntries.filter((entry) => entry.method === "create").length &&
          replayCounts.create === 1 &&
          ["planning", "staffing", "portfolio", "projection"].every(
            (method) =>
              replayCounts[method] ===
              coldBaselineCounts[
                ["planning", "staffing", "portfolio", "projection"].indexOf(method)
              ] +
                1,
          ),
        "cold-repair handler ledger is not Create once plus one additional entry per Event method",
      );
      const postCleanupEntries = replayEntries.filter(
        (entry) => entry.at >= scenarioRecord.repairStartedAt,
      );
      assert(
        postCleanupEntries.length === 4 &&
          new Set(postCleanupEntries.map((entry) => entry.method)).size === 4 &&
          postCleanupEntries.every(
            (entry) =>
              entry.method !== "create" && scenarioRecord.postCleanupPids.includes(entry.pid),
          ),
        "cold-repair recipient handler entries are missing or not on fresh process PIDs",
      );
      assert(
        postCleanupEntries.every(
          (entry) =>
            entry.recipientTypeUrl === recipientTypeUrls[entry.method] &&
            typeof entry.recipientIdBase64 === "string" &&
            Buffer.from(entry.recipientIdBase64, "base64").toString("base64") ===
              entry.recipientIdBase64,
        ),
        "cold-repair recipient method/type URL or identifier bytes are invalid",
      );
      const resolvedRows = scenarioRecord.resolvedRows;
      assert(
        Array.isArray(resolvedRows) &&
          resolvedRows.length === 4 &&
          resolvedRows.every((row) => row.status === "DELIVERED") &&
          new Set(resolvedRows.map((row) => `${row.targetIdTypeUrl}:${row.targetIdBase64}`))
            .size === 4,
        "cold-repair did not finish with exactly four distinct typed DELIVERED recipient rows",
      );
      const expectedResolvedTypes = new Set([
        recipientTypeUrls.planning,
        recipientTypeUrls.staffing,
        recipientTypeUrls.portfolio,
        recipientTypeUrls.create,
      ]);
      assert(
        new Set(resolvedRows.map((row) => row.targetIdTypeUrl)).size === 4 &&
          resolvedRows.every(
            (row) =>
              expectedResolvedTypes.has(row.targetIdTypeUrl) &&
              typeof row.targetIdBase64 === "string" &&
              Buffer.from(row.targetIdBase64, "base64").length > 0 &&
              Buffer.from(row.targetIdBase64, "base64").toString("base64") === row.targetIdBase64,
          ),
        "cold-repair final Inbox contains an unexpected recipient identifier type",
      );
      assertFullState(scenarioRecord.afterReplay, "cold-repair post-replay state");
      assertSameEvent(
        scenarioRecord.afterReplay?.events?.find((event) => event.id === original.id),
        original,
        "cold-repair post-replay Event",
      );
      const preReplayPids = new Set(preCleanup.entries.map((entry) => entry.pid));
      assert(
        replayEntries.every(
          (entry) =>
            scenarioRecord.postCleanupPids.includes(entry.pid) || preReplayPids.has(entry.pid),
        ),
        "cold-repair handler ledger contains an unknown process PID",
      );
      checks.event = original;
      checks.failedInsertAttempts = scenarioRecord.failedInsertAttempts;
      checks.repairOutcomeCount = repairOutcomes.length;
      checks.handlerEntries = entryCheck;
      checks.restartPids = scenarioRecord.restartPids;
      checks.coldRepair = {
        originalEventRowsAbsentBeforeReplay: true,
        completeInboxShardCountBeforeReplay: preCleanup.inbox.shards.length,
        retainedInboxRowsBeforeReplay: preCleanup.inbox.shards.reduce(
          (total, shard) => total + shard.rows.length,
          0,
        ),
        coldPids: scenarioRecord.postCleanupPids,
        initialRecipientMethodCounts: scenarioRecord.initialCounts,
        finalRecipientMethodCounts: scenarioRecord.finalCounts,
        handlerMethodCounts: replayCounts,
        deliveredTypedRows: resolvedRows.map((row) => ({
          targetIdTypeUrl: row.targetIdTypeUrl,
          targetIdBase64: row.targetIdBase64,
          status: row.status,
        })),
        replayOutcome: scenarioRecord.postCleanupReplay,
      };
    } else {
      checks.coldRepair = "not present in this historical run's artifact schema";
    }
    checks.completedStates = true;
  } else {
    assert(
      commandIds.length === 2,
      "shared volatile-loss must acknowledge seed and selected Commands",
    );
    assertFullState(scenarioRecord.seed, "shared-mode seed state");
    const retainedEvent = assertEventIntegrity(
      scenarioRecord.seed?.events?.[0],
      "shared-mode retained Event",
    );
    assert(
      retainedEvent.id === result.retainedEventId &&
        retainedEvent.sha256 === result.retainedEventSha256,
      "retained Event identity differs from result",
    );
    const aftermath = await readJson(runDirectory, "shared-after-restart.json");
    assertSameEvent(
      aftermath.after?.events?.find((event) => event.id === retainedEvent.id),
      retainedEvent,
      "shared-mode retained Event after restart",
    );
    const secondProject = aftermath.after?.projects?.find((row) => row.number === 2);
    assert(
      secondProject && stateNames.every((name) => secondProject.states?.[name] === false),
      "volatile-loss project unexpectedly has completed states",
    );
    assert(
      aftermath.newInbox?.observations?.length === 0,
      "volatile-loss post-restart Inbox has unexpected rows",
    );
    assert(
      new Set(result.initialPids).size === config.processes,
      "shared-mode initial worker PID count mismatch",
    );
    assert(
      new Set(result.restartPids).size === config.processes,
      "shared-mode restart worker PID count mismatch",
    );
    assert(
      result.restartPids.every((pid) => !result.initialPids.includes(pid)),
      "shared-mode restart worker PIDs were not fresh",
    );
    checks.retainedEvent = retainedEvent;
    checks.lostPendingMessageId = result.lostPendingMessageId;
    checks.initialPids = result.initialPids;
    checks.restartPids = result.restartPids;
    checks.expectedVolatileLossObserved = true;
    checks.durabilityClaim =
      "none: this scenario measures loss of a shared in-memory pending delivery after process failure";
  }
  return checks;
}

async function auditRun(config, runId, { verifyWorkspaceFiles = true } = {}) {
  assert(/^[a-f0-9]{32}$/u.test(runId), "new run ID is malformed");
  const runDirectory = resolve(runs, runId);
  const [result, resource, cleanup, provenance] = await Promise.all([
    readJson(runDirectory, "result.json"),
    readJson(runDirectory, "resource.json"),
    readJson(runDirectory, "cleanup.json"),
    readJson(runDirectory, "runtime-provenance.json"),
  ]);
  assert(result.status === "PASS", `run ${runId}: result status is not PASS`);
  assert(
    result.runId === runId && resource.runId === runId,
    `run ${runId}: result/resource identity mismatch`,
  );
  assert(
    result.provider === config.provider && result.scenario === config.scenario,
    `run ${runId}: provider/scenario mismatch`,
  );
  assert(result.processes === config.processes, `run ${runId}: process count mismatch`);
  assert(result.database === resource.database, `run ${runId}: database identity mismatch`);
  assert(resource.evidencePath === runDirectory, `run ${runId}: resource evidence path mismatch`);
  assert(cleanup.databaseDropped === true, `run ${runId}: unique database was not dropped`);
  assert(
    Array.isArray(cleanup.errors) && cleanup.errors.length === 0,
    `run ${runId}: cleanup errors were reported`,
  );
  assert(
    Array.isArray(cleanup.exits) && cleanup.exits.length >= config.processes,
    `run ${runId}: app worker exits are missing`,
  );
  assert(
    cleanup.exits.every((exit) => exit.code === 0 && exit.signal === null),
    `run ${runId}: one or more worker exits were unsuccessful`,
  );
  assert(
    Array.isArray(result.artifacts) && result.artifacts.length > 0,
    `run ${runId}: compiled artifact hashes are missing`,
  );
  assert(
    result.gitHead && result.runtimeTreeSha256,
    `run ${runId}: build provenance is incomplete`,
  );
  assert(
    provenance.gitHead === result.gitHead &&
      provenance.runtimeTreeSha256 === result.runtimeTreeSha256,
    `run ${runId}: provenance summary mismatch`,
  );
  assert(
    Array.isArray(provenance.files) && provenance.files.length > 0,
    `run ${runId}: deep source/build provenance list is missing`,
  );
  assert(
    sha256(Buffer.from(JSON.stringify(provenance.files))) === result.runtimeTreeSha256,
    `run ${runId}: deep provenance tree hash mismatch`,
  );
  for (const file of provenance.files) {
    const relative = file.path;
    assert(
      typeof relative === "string" &&
        !relative.startsWith("/") &&
        !relative.split("/").includes(".."),
      `run ${runId}: invalid provenance path`,
    );
    assert(
      /^[a-f0-9]{64}$/u.test(file.sha256),
      `run ${runId}: invalid provenance digest for ${relative}`,
    );
    if (verifyWorkspaceFiles) {
      const actual = sha256(await readFile(resolve(root, relative)));
      assert(actual === file.sha256, `run ${runId}: provenance file hash mismatch for ${relative}`);
    }
  }
  for (const artifact of result.artifacts) {
    const relative = artifact.path.startsWith(`${root}/`)
      ? artifact.path.slice(root.length + 1)
      : null;
    assert(relative !== null, `run ${runId}: artifact path escapes worktree`);
    assert(
      /^[a-f0-9]{64}$/u.test(artifact.sha256),
      `run ${runId}: invalid artifact digest for ${relative}`,
    );
    if (verifyWorkspaceFiles) {
      const actual = sha256(await readFile(resolve(root, relative)));
      assert(actual === artifact.sha256, `run ${runId}: artifact hash mismatch for ${relative}`);
    }
  }
  const scenarioChecks = await auditScenario(config, result, runDirectory);
  return {
    runId,
    provider: config.provider,
    processes: config.processes,
    scenario: config.scenario,
    status: result.status,
    database: resource.database,
    acknowledgedCommandIds: result.acknowledgedCommandIds,
    cleanup: {
      databaseDropped: cleanup.databaseDropped,
      errors: cleanup.errors,
      exits: cleanup.exits,
    },
    gitHead: result.gitHead,
    runtimeTreeSha256: result.runtimeTreeSha256,
    artifacts: result.artifacts,
    scenarioChecks,
  };
}

async function waitForExit(child, pgid, logStream) {
  let timedOut = false;
  let timeoutSignal = null;
  let escalated = false;
  let signalTimer;
  let doneTimer;
  let closed = false;
  const signalGroup = (signal) => {
    try {
      process.kill(-pgid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const wait = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      closed = true;
      resolveExit({ code, signal });
    });
    doneTimer = setTimeout(() => {
      if (closed) return;
      timedOut = true;
      timeoutSignal = "SIGTERM";
      logStream.write(`\nouterTimeoutMs=${resultTimeoutMs}\n`);
      signalGroup("SIGTERM");
      signalTimer = setTimeout(() => {
        if (!closed) {
          escalated = true;
          timeoutSignal = "SIGKILL";
          logStream.write("timeoutEscalation=SIGKILL\n");
          signalGroup("SIGKILL");
        }
      }, termGraceMs);
    }, resultTimeoutMs);
  });
  const exit = await wait;
  clearTimeout(doneTimer);
  clearTimeout(signalTimer);
  let groupExists = true;
  const reapDeadline = Date.now() + reapTimeoutMs;
  while (Date.now() < reapDeadline) {
    try {
      process.kill(-pgid, 0);
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
    try {
      process.kill(-pgid, 0);
      signalGroup("SIGKILL");
      await delay(100);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      groupExists = false;
    }
  }
  return { ...exit, timedOut, timeoutSignal, escalated, groupExists };
}

async function runCase(config, index, baselineProvenance, priorRuntimeTreeHash) {
  const startedAt = new Date().toISOString();
  const priorIds = new Set((await readdir(runs)).filter((name) => /^[a-f0-9]{32}$/u.test(name)));
  const logPath = resolve(
    sessionDir,
    `${config.provider}-p${config.processes}-${config.scenario}.log`,
  );
  const argv = ["--filter", "@spine-event-engine/server-blackbox-tests", "test:process-faults"];
  const env = {
    ...process.env,
    TMPDIR: resolve(evidence, "runtime-tmp"),
    SPINE_TS_FAULT_PROVIDER: config.provider,
    SPINE_TS_FAULT_SCENARIO: config.scenario,
    SPINE_TS_FAULT_PROCESSES: String(config.processes),
  };
  await mkdir(env.TMPDIR, { recursive: true });
  const record = {
    index,
    config,
    command: { executable: "pnpm", argv },
    startedAt,
    log: logPath,
    configuredProfile: { model: "gpt-6-luna", reasoning: "low" },
  };
  await writeFile(invocationPath, `${JSON.stringify(record)}\n`, { flag: "a" });
  const logStream = createWriteStream(logPath, { flags: "wx" });
  logStream.write(
    `startedAt=${startedAt}\ncommand=pnpm ${argv.join(" ")}\ncase=${JSON.stringify(config)}\n`,
  );
  const child = spawn("pnpm", argv, {
    cwd: root,
    env,
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert(child.pid !== undefined, "pnpm process did not start");
  record.pnpmPid = child.pid;
  record.processGroupId = child.pid;
  await writeFile(invocationPath, `${JSON.stringify({ ...record, phase: "spawned" })}\n`, {
    flag: "a",
  });
  child.stdout.setEncoding("utf8").on("data", (chunk) => logStream.write(`stdout: ${chunk}`));
  child.stderr.setEncoding("utf8").on("data", (chunk) => logStream.write(`stderr: ${chunk}`));
  let outcome;
  try {
    outcome = await waitForExit(child, child.pid, logStream);
  } catch (error) {
    logStream.write(`waitError=${String(error)}\n`);
    logStream.end();
    throw error;
  }
  const endedAt = new Date().toISOString();
  logStream.write(
    `endedAt=${endedAt}\nexit=${outcome.code}/${outcome.signal}\nexitDetails=${JSON.stringify(outcome)}\n`,
  );
  await new Promise((resolveEnd) => logStream.end(resolveEnd));
  record.endedAt = endedAt;
  record.exit = outcome;
  if (outcome.code !== 0 || outcome.timedOut || outcome.groupExists) {
    record.status = "FAIL";
    record.failure =
      "public package command failed, timed out, or left its isolated process group alive";
    await writeFile(invocationPath, `${JSON.stringify({ ...record, phase: "complete" })}\n`, {
      flag: "a",
    });
    return record;
  }
  try {
    const newIds = (await readdir(runs)).filter(
      (name) => /^[a-f0-9]{32}$/u.test(name) && !priorIds.has(name),
    );
    assert(newIds.length === 1, `expected one new run directory, found ${newIds.length}`);
    const run = await auditRun(config, newIds[0]);
    for (const artifact of run.artifacts) {
      const relative = artifact.path.slice(root.length + 1);
      assert(
        baselineProvenance[relative] === artifact.sha256,
        `compiled artifact hash differs from launch provenance: ${relative}`,
      );
    }
    assert(
      JSON.stringify(baselineProvenance) === JSON.stringify(await snapshotProvenance()),
      "build/source provenance changed during matrix run",
    );
    if (priorRuntimeTreeHash !== null)
      assert(
        run.runtimeTreeSha256 === priorRuntimeTreeHash,
        "runtime build provenance differs from a prior case",
      );
    record.status = "PASS";
    record.runId = run.runId;
    record.audit = run;
  } catch (error) {
    record.status = "FAIL";
    record.validationError = String(error);
  }
  await writeFile(invocationPath, `${JSON.stringify({ ...record, phase: "complete" })}\n`, {
    flag: "a",
  });
  return record;
}

async function auditExisting() {
  const runId = process.argv[3];
  const reportPath = resolve(process.argv[4] ?? "");
  const requireColdRepair = process.argv[5] === "--require-cold-repair";
  assert(/^[a-f0-9]{32}$/u.test(runId ?? ""), "--audit-existing requires a 32-character run ID");
  assert(
    reportPath.startsWith(`${outputRoot}/audits/`),
    "--audit-existing requires an explicit fresh report path under process-fault-matrix/audits",
  );
  const result = await readJson(resolve(runs, runId), "result.json");
  const config = {
    provider: result.provider,
    processes: result.processes,
    scenario: result.scenario,
    requireColdRepair,
  };
  let audit;
  let failure;
  try {
    audit = await auditRun(config, runId, { verifyWorkspaceFiles: false });
  } catch (error) {
    failure = String(error);
  }
  const report = {
    status: failure === undefined ? "PASS" : "FAIL",
    mode: "audit-only",
    runId,
    auditedAt: new Date().toISOString(),
    config,
    configuredProfile: {
      model: "gpt-6-luna",
      reasoning: "low",
      runtimeMetadata: "not exposed by this execution surface",
    },
    audit: audit ?? null,
    failure: failure ?? null,
    note: "Validates saved run artifacts and their self-contained hashes; launches no processes or database operations.",
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({
      status: report.status,
      mode: report.mode,
      runId,
      provider: config.provider,
      processes: config.processes,
      scenario: config.scenario,
      reportPath,
      failure: report.failure,
    })}\n`,
  );
  if (failure !== undefined) process.exitCode = 1;
}

async function runMatrix() {
  await mkdir(resolve(outputRoot, "sessions"), { recursive: true });
  await mkdir(runs, { recursive: true });
  await mkdir(sessionDir, { recursive: false });
  const provenanceAtLaunch = await snapshotProvenance();
  const manifest = {
    status: "RUNNING",
    startedAt: new Date().toISOString(),
    sessionId,
    worktree: root,
    configuredProfile: {
      model: "gpt-6-luna",
      reasoning: "low",
      runtimeMetadata: "not exposed by this execution surface",
    },
    command: "pnpm --filter @spine-event-engine/server-blackbox-tests test:process-faults",
    execution:
      "sequential; isolated per-invocation process group; no application/test fixture modifications",
    expectedCaseCount: providers.length * processCounts.length * scenarios.length,
    provenanceAtLaunch,
    cases: [],
  };
  await writeFile(
    resolve(sessionDir, "provenance-at-launch.json"),
    `${JSON.stringify(provenanceAtLaunch, null, 2)}\n`,
    { flag: "wx" },
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });

  let expectedIndex = 0;
  let previousRuntimeTreeHash = null;
  matrixCases: for (const provider of providers) {
    for (const processes of processCounts) {
      for (const scenario of scenarios) {
        expectedIndex++;
        const config = {
          provider,
          processes,
          scenario,
          requireColdRepair: true,
          requireKillObservation: true,
        };
        process.stdout.write(
          `CASE_START ${expectedIndex}/32 ${provider} p=${processes} scenario=${scenario}\n`,
        );
        const record = await runCase(
          config,
          expectedIndex,
          provenanceAtLaunch,
          previousRuntimeTreeHash,
        );
        manifest.cases.push(record);
        if (record.status === "PASS") {
          previousRuntimeTreeHash ??= record.audit.runtimeTreeSha256;
        }
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        process.stdout.write(
          `CASE_${record.status} ${expectedIndex}/32 ${provider} p=${processes} scenario=${scenario}${record.runId ? ` run=${record.runId}` : ""}\n`,
        );
        if (record.status !== "PASS") {
          manifest.stoppedAfterFirstFailure = true;
          break matrixCases;
        }
      }
    }
  }

  const expectedInventory = new Set(
    providers.flatMap((provider) =>
      processCounts.flatMap((processes) =>
        scenarios.map((scenario) => `${provider}|${processes}|${scenario}`),
      ),
    ),
  );
  const actualInventory = manifest.cases.map(
    (record) => `${record.config.provider}|${record.config.processes}|${record.config.scenario}`,
  );
  manifest.inventory = {
    expectedCount: expectedInventory.size,
    actualCount: actualInventory.length,
    missing: [...expectedInventory].filter((key) => !actualInventory.includes(key)),
    duplicates: actualInventory.filter((key, index) => actualInventory.indexOf(key) !== index),
  };
  manifest.unrunCases = manifest.inventory.missing;
  manifest.failedCases = manifest.cases
    .filter((record) => record.status !== "PASS")
    .map((record) => ({
      config: record.config,
      runId: record.runId ?? null,
      failure: record.failure ?? record.validationError ?? "not passed",
    }));
  manifest.status =
    manifest.inventory.missing.length === 0 &&
    manifest.inventory.duplicates.length === 0 &&
    manifest.cases.length === 32 &&
    manifest.failedCases.length === 0
      ? "PASS"
      : "FAIL";
  manifest.endedAt = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `MATRIX_${manifest.status} cases=${manifest.cases.length}/32 failures=${manifest.failedCases.length} session=${sessionDir}\n`,
  );
  if (manifest.status !== "PASS") process.exitCode = 1;
}

if (process.argv[2] === "--audit-existing") await auditExisting();
else await runMatrix();
