/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { AnyMessages, TypeUrls } from "../../../../packages/core/dist/index.js";
import { EventIdSchema, EventSchema } from "../../../../packages/proto/dist/src/index.js";
import { DeliveryServer } from "../../../../packages/delivery-server/dist/index.js";
import {
  DeliveryClient,
  DeliveryPagingError,
  RemoteInbox,
} from "../../../../packages/delivery-client/dist/index.js";
import {
  OrganizationIdSchema,
  ProjectIdSchema,
  ProjectProjectionStateSchema,
} from "../../../../packages/server-blackbox-tests/dist/generated/spine/server/testing/project_workflow_pb.js";
import { ProjectCreatedSchema } from "../../../../packages/server-blackbox-tests/dist/generated/spine/server/testing/project_events_pb.js";
import { ShardIndex } from "../../../../packages/server/dist/index.js";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(evidenceDir, "../../../../packages/server/package.json"));
const { create } = require("@bufbuild/protobuf");
const { TimestampSchema } = require("@bufbuild/protobuf/wkt");
const runId = randomUUID();
const outputPath = resolve(evidenceDir, `real-wire-paging-${runId}.json`);
const logPath = resolve(evidenceDir, `real-wire-paging-${runId}.log`);
const scriptPid = process.pid;
const sha = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const relevantFiles = [
  "packages/delivery-server/dist/index.js",
  "packages/delivery-server/dist/server/delivery-server.js",
  "packages/delivery-server/dist/server/assembly.js",
  "packages/delivery-client/dist/index.js",
  "packages/delivery-client/dist/remote/adapters.js",
  "packages/delivery-client/dist/client/client.js",
  "packages/delivery-client/dist/client/types.js",
  "packages/delivery-client/dist/wire/codec.js",
  "packages/core/dist/index.js",
  "packages/proto/dist/src/index.js",
  "packages/server/dist/index.js",
  "packages/server-blackbox-tests/dist/generated/spine/server/testing/project_workflow_pb.js",
  "packages/server-blackbox-tests/dist/generated/spine/server/testing/project_events_pb.js",
];
const record = {
  runId,
  scriptPid,
  configuredProfile: "orchestrator-dispatched mechanical function: gpt-6-luna / low",
  runtimeProfileIntrospection: "unavailable on this execution surface",
  startedAt: new Date().toISOString(),
  command:
    "TMPDIR=/Users/armiol/.codex/worktrees/sql-delivery-reliability/spine-ts/build-protocol/tasks/sql-delivery-reliability/evidence/runtime-tmp node build-protocol/tasks/sql-delivery-reliability/evidence/run-real-wire-paging-repro.mjs",
  scope:
    "loopback in-memory DeliveryServer and actual DeliveryClient/RemoteInbox wire; no database",
  topology: {
    host: "127.0.0.1",
    port: 0,
    messages: 101,
    shard: { index: 0, ofTotal: 1 },
    equalTimestamp: true,
    readPageSizes: [100, 101],
    remoteInboxLimit: 100,
  },
  hashes: {},
  writes: [],
  firstPage100: [],
  rawPage101: [],
  remoteInboxReads: [],
  cleanup: {},
};
const log = [];
let server;
let client;
let exitFailure;
const bounded = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      globalThis.setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms),
    ),
  ]);
const compact = (message) => ({
  id: message.id.value,
  signalId: message.signalId,
  version: String(message.version),
  whenReceived: {
    seconds: String(message.whenReceived.seconds),
    nanos: message.whenReceived.nanos,
  },
  label: message.label,
  status: message.status,
  shard: { index: message.shard.index, ofTotal: message.shard.ofTotal },
  inboxTargetTypeUrl: message.inboxId.targetTypeUrl,
  inboxTargetIdTypeUrl: message.inboxId.targetId.typeUrl,
});
const writeEvidence = async () => {
  record.finishedAt = new Date().toISOString();
  record.result = exitFailure ? "FAIL" : "PASS";
  if (exitFailure)
    record.failure = {
      name: exitFailure.name,
      message: exitFailure.message,
      stack: exitFailure.stack,
    };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(logPath, `${log.join("\n")}\n`);
};

try {
  for (const relative of relevantFiles)
    record.hashes[relative] = await sha(resolve(evidenceDir, "../../../../", relative));
  log.push(`start run=${runId} pid=${scriptPid}`);
  server = new DeliveryServer({ host: "127.0.0.1", port: 0, maxRetainedMessages: 200 });
  await bounded(server.start(), 5000, "server start");
  record.endpoint = server.baseUrl;
  client = DeliveryClient.connectTo(server.baseUrl, { pageSize: 100 });
  const inbox = new RemoteInbox(client);
  const shard = ShardIndex.single();
  const timestamp = create(TimestampSchema, { seconds: 1_700_000_000n, nanos: 123_000_000 });
  const org = create(OrganizationIdSchema, { code: `wire-paging-${runId}` });
  const label = "UPDATE_SUBSCRIBER";
  const targetTypeUrl = TypeUrls.derive(ProjectProjectionStateSchema);

  for (let n = 1; n <= 101; n += 1) {
    const project = create(ProjectIdSchema, { organization: org, number: n });
    const createdPayload = create(ProjectCreatedSchema, {
      organization: org,
      project,
      name: `Paging proof ${n}`,
    });
    const eventId = randomUUID();
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: eventId }),
      message: AnyMessages.pack(ProjectCreatedSchema, createdPayload, { validate: false }),
    });
    const result = await bounded(
      inbox.receive(
        {
          inboxId: { targetId: AnyMessages.pack(ProjectIdSchema, project), targetTypeUrl },
          signalId: eventId,
          signal: AnyMessages.pack(EventSchema, event, { validate: false }),
          label,
          status: "TO_DELIVER",
          shard,
          whenReceived: timestamp,
          version: BigInt(n),
        },
        { timeoutMs: 5000 },
      ),
      6000,
      `write ${n}`,
    );
    record.writes.push({
      id: result.message.id.value,
      signalId: result.message.signalId,
      version: String(result.message.version),
      eventId,
      projectNumber: n,
    });
  }
  record.writeCount = record.writes.length;
  record.uniqueMessageIds = new Set(record.writes.map((row) => row.id)).size;
  record.uniqueSignalIds = new Set(record.writes.map((row) => row.signalId)).size;
  if (
    record.writeCount !== 101 ||
    record.uniqueMessageIds !== 101 ||
    record.uniqueSignalIds !== 101
  )
    throw new Error("write count or unique ID assertion failed");

  const firstPage = await bounded(
    client.readPage(shard, { pageSize: 100, timeoutMs: 5000 }),
    6000,
    "raw page100",
  );
  record.firstPage100 = firstPage.map(compact);
  record.firstPageCount = firstPage.length;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const items = await bounded(
        inbox.read(shard, { limit: 100, timeoutMs: 5000 }),
        6000,
        `RemoteInbox read ${attempt}`,
      );
      record.remoteInboxReads.push({ attempt, outcome: "resolved", count: items.length });
    } catch (error) {
      record.remoteInboxReads.push({
        attempt,
        outcome: "rejected",
        name: error?.name ?? null,
        message: error?.message ?? String(error),
        code: error?.code ?? null,
        isDeliveryPagingError: error instanceof DeliveryPagingError,
      });
    }
  }
  const fullPage = await bounded(
    client.readPage(shard, { pageSize: 101, timeoutMs: 5000 }),
    6000,
    "raw page101",
  );
  record.rawPage101 = fullPage.map(compact);
  record.rawPage101Count = fullPage.length;
  record.trailingRowsAfter100 = fullPage.slice(100).map(compact);
  const sameTimestamp = (left, right) =>
    left.whenReceived.seconds === right.whenReceived.seconds &&
    left.whenReceived.nanos === right.whenReceived.nanos;
  record.timestampTieAtBoundary =
    firstPage.length >= 2 && sameTimestamp(firstPage.at(-1), firstPage.at(-2));
  record.timestampTieAcrossBoundary =
    firstPage.length === 100 &&
    fullPage.length === 101 &&
    sameTimestamp(firstPage.at(-1), fullPage[100]);
  record.first100IdsMatch = firstPage.every(
    (item, index) => item.id.value === fullPage[index]?.id.value,
  );
  record.domainProjection = fullPage.map((item) => {
    const signal = AnyMessages.unpack(item.signal, EventSchema);
    const payload = signal?.message
      ? AnyMessages.unpack(signal.message, ProjectCreatedSchema)
      : undefined;
    return {
      inboxMessageId: item.id.value,
      eventId: signal?.id?.value ?? null,
      projectNumber: payload?.project?.number ?? null,
      targetTypeUrl: item.inboxId.targetTypeUrl,
      targetIdTypeUrl: item.inboxId.targetId.typeUrl,
    };
  });
  record.assertions = {
    firstPageCount100: record.firstPageCount === 100,
    rawPageCount101: record.rawPage101Count === 101,
    repeatedRemoteInboxPagingError:
      record.remoteInboxReads.length === 2 &&
      record.remoteInboxReads.every(
        (item) => item.outcome === "rejected" && item.isDeliveryPagingError,
      ),
    tieAtBoundary: record.timestampTieAcrossBoundary,
    first100OrderConsistent: record.first100IdsMatch,
    allDomainEventsDecoded:
      record.domainProjection.length === 101 &&
      record.domainProjection.every(
        (item, index) => item.projectNumber === index + 1 && item.eventId,
      ),
    typedProjectTarget: record.domainProjection.every(
      (item) =>
        item.targetTypeUrl === targetTypeUrl &&
        item.targetIdTypeUrl.endsWith("/spine.server.testing.ProjectId"),
    ),
  };
  if (Object.values(record.assertions).some((value) => value !== true))
    throw new Error(`evidence assertion failed: ${JSON.stringify(record.assertions)}`);
  log.push(
    `writes=${record.writeCount} page100=${record.firstPageCount} page101=${record.rawPage101Count}`,
  );
  log.push(`remoteInboxReads=${JSON.stringify(record.remoteInboxReads)}`);
} catch (error) {
  exitFailure = error instanceof Error ? error : new Error(String(error));
} finally {
  if (client) {
    try {
      client.close();
      record.cleanup.clientClose = "synchronous close returned";
    } catch (error) {
      record.cleanup.clientClose = `failed: ${error.message}`;
      exitFailure ??= error;
    }
  }
  if (server) {
    try {
      await bounded(server.close(), 5000, "server close");
      record.cleanup.serverClose = "completed";
    } catch (error) {
      record.cleanup.serverClose = `failed: ${error.message}`;
      exitFailure ??= error;
    }
  }
  await writeEvidence();
}
globalThis.console.log(
  JSON.stringify({
    result: record.result,
    outputPath,
    logPath,
    pid: scriptPid,
    cleanup: record.cleanup,
    failure: record.failure ?? null,
  }),
);
if (exitFailure) process.exitCode = 1;
