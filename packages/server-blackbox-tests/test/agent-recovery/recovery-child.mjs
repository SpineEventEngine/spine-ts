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

import { create, equals, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import { createOpenAI } from "@ai-sdk/openai";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { InboxMessageIdSchema, InboxMessageSchema } from "@spine-event-engine/proto/delivery";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionHeadSchema,
  AgentInvocationKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";
import { AnyMessages, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { AgentInvocationTerminatedSchema } from "@spine-event-engine/proto/agent";
import { BoundedContext, EventRouting } from "@spine-event-engine/server";
import { ColumnTypes, RecordColumn, RecordSpec, StorageFactory } from "@spine-event-engine/storage";
import {
  AgentExecutionStorageFactories,
  AgentHistoryStorageFactories,
  DeliveryCleanupStorageFactories,
  EntityCommitStorageFactories,
} from "@spine-event-engine/storage/provider";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { Datastore } from "@google-cloud/datastore";
import { Pool } from "pg";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import process from "node:process";
import { setImmediate } from "node:timers/promises";
import { URL } from "node:url";

import * as RecoveryCommands from "../../dist/generated/spine/server/testing/support_recovery_commands_pb.js";
import { SupportReplyDraftedSchema } from "../../dist/generated/spine/server/testing/support_agent_events_pb.js";
import {
  SupportRecoveryStateSchema,
  SupportEscalationRecoveryStateSchema as EscalationStateSchema,
  SupportLookupRecoveryStateSchema as LookupStateSchema,
} from "../../dist/generated/spine/server/testing/support_recovery_states_pb.js";
import { SupportReplyProposalSchema } from "../../dist/generated/spine/server/testing/support_recovery_types_pb.js";
import { SupportReplyAgentIdSchema } from "../../dist/generated/spine/server/testing/support_agent_states_pb.js";
import { SupportRecoveryAgent, recoveryReplyModel } from "../../dist/src/agent/recovery-agent.js";
import {
  SupportEscalationRecoveryAgent,
  escalationRecoveryModel,
} from "../../dist/src/agent/escalation-recovery-agent.js";
import {
  SupportLookupRecoveryAgent,
  lookupRecoveryModel,
} from "../../dist/src/agent/lookup-recovery-agent.js";
// prettier-ignore
import {
  SupportDraftProjectionStateSchema as DraftProjectionStateSchema,
} from "../../dist/generated/spine/server/testing/support_recovery_states_pb.js";
import {
  SupportRejectionSubscriber,
  SupportReviewAssignee,
} from "../../dist/src/agent/support-reply-receivers.js";
import {
  SupportDraftObserver,
  SupportDraftProjection,
  SupportDraftReceiptObserver,
} from "../../dist/src/agent/support-draft-receivers.js";

// This read-only probe describes the persisted Inbox record through the public storage API.
const inboxProbeSpec = new RecordSpec({
  sourceType: InboxMessageSchema,
  recordType: InboxMessageSchema,
  idSchema: InboxMessageIdSchema,
  extractId: (record) => record.id,
  columns: [
    new RecordColumn(
      "inbox_id",
      ColumnTypes.fromField(InboxMessageSchema.field.inboxId),
      (record) => record.inboxId,
    ),
    new RecordColumn(
      "signal_id",
      ColumnTypes.fromField(InboxMessageSchema.field.signalId),
      (record) => record.signalId,
    ),
    new RecordColumn(
      "shard_index",
      ColumnTypes.scalar(ScalarType.INT32),
      (record) => record.id?.index?.index,
    ),
    new RecordColumn(
      "shard_total",
      ColumnTypes.scalar(ScalarType.INT32),
      (record) => record.id?.index?.ofTotal,
    ),
    new RecordColumn(
      "status",
      ColumnTypes.fromField(InboxMessageSchema.field.status),
      (record) => record.status,
    ),
    new RecordColumn(
      "when_received",
      ColumnTypes.fromField(InboxMessageSchema.field.whenReceived),
      (record) => record.whenReceived,
    ),
    new RecordColumn(
      "version",
      ColumnTypes.fromField(InboxMessageSchema.field.version),
      (record) => record.version,
    ),
    new RecordColumn(
      "message_id",
      ColumnTypes.scalar(ScalarType.STRING),
      (record) => record.id?.uuid,
    ),
  ],
});

const [
  provider,
  mode,
  contextName,
  ticketNumber,
  cutName = "response",
  expectedKey,
  expectedInbox,
] = process.argv.slice(2);
const DraftRecoverySchema = RecoveryCommands.DraftRecoverySupportReplySchema;
const DraftKnowledgeSchema = RecoveryCommands.DraftKnowledgeSupportReplySchema;
const EscalateRecoverySchema = RecoveryCommands.EscalateRecoverySupportTicketSchema;
const tenantResponse = cutName === "tenant-response";
const recoveryTenant = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
if (!provider || !mode || !contextName || !ticketNumber)
  throw new Error("Recovery child needs provider, mode, context, and ticket.");

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.send) return reject(new Error("Recovery child requires IPC."));
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

function savedResponse(input) {
  return input.next.journal.some(
    (entry) =>
      entry.evidence.case === "attempt" &&
      entry.evidence.value.response.case === "generationResponse",
  );
}

function savedToolResponse(input) {
  return input.next.journal.some(
    (entry) => entry.evidence.case === "tool" && entry.evidence.value.response !== undefined,
  );
}

function responseOperation(input) {
  const entry = input.historyEntries?.find((item) => item.item.case === "conversationRecord");
  return entry?.item.value.operation?.value;
}

function inboxHash(record) {
  return createHash("sha256").update(toBinary(InboxMessageSchema, record)).digest("hex");
}

async function terminationAudit(box, repository, id) {
  const history = await box.readAgentHistory(repository, id, { pageSize: 30 });
  const original = history.items
    .filter((entry) => entry.item.case === "systemEvent")
    .map((entry) => entry.item.value)
    .find(
      (event) =>
        event.message &&
        AnyMessages.unpack(event.message, AgentInvocationTerminatedSchema) !== undefined,
    );
  if (original?.id === undefined || original.message === undefined)
    throw new Error("Terminated Agent has no original history System Event.");
  const stored = await box.eventually(
    () => box.readSystemEvents([original.id]),
    (events) => events.length === 1,
    { timeoutMs: 10_000 },
  );
  const termination = AnyMessages.unpack(original.message, AgentInvocationTerminatedSchema);
  return {
    systemOriginalId: original.id.value,
    systemStoredId: stored[0]?.id?.value,
    systemEqual: stored[0] !== undefined && equals(EventSchema, stored[0], original),
    terminationReason: termination?.reason,
    unresolvedAttempts: termination?.unresolvedAttempts.length,
    unresolvedToolCalls: termination?.unresolvedToolCalls.length,
  };
}

async function postgresHeadProbe() {
  if (provider !== "postgres") return {};
  const schema = process.env.SPINE_TS_POSTGRESQL_SCHEMA;
  const url = process.env.SPINE_TS_POSTGRESQL_URL;
  if (!schema || !url || !/^agent_recovery_[a-f0-9]{16}$/.test(schema)) return {};
  const pool = new Pool({ connectionString: url });
  try {
    const found = await pool.query(
      "SELECT table_name FROM information_schema.columns " +
        "WHERE table_schema = $1 AND column_name = 'pending_key'",
      [schema],
    );
    if (found.rows.length !== 1) return { headTableCount: found.rows.length };
    const table = found.rows[0].table_name.replaceAll('"', '""');
    const rows = await pool.query(
      `SELECT "bytes", "pending_key", extract(epoch from clock_timestamp())::text AS now ` +
        `FROM "${schema}"."${table}" LIMIT 1`,
    );
    if (rows.rows.length !== 1) return { headRowCount: rows.rows.length };
    const head = fromBinary(AgentExecutionHeadSchema, rows.rows[0].bytes);
    return {
      headPending: head.pending !== undefined,
      headActive: head.active !== undefined,
      headEligibleAtSeconds: head.eligibleAt?.seconds?.toString(),
      headClaimExpiresAtSeconds: head.claimExpiresAt?.seconds?.toString(),
      headPendingKey: rows.rows[0].pending_key,
      providerNowSeconds: rows.rows[0].now,
    };
  } finally {
    await pool.end();
  }
}

class RecoveryCutStorageFactory extends StorageFactory {
  constructor(native, onBarrier, infrastructure = native) {
    super();
    this.native = native;
    this.infrastructure = infrastructure;
    this.onBarrier = onBarrier;
    this.reportedInbox = false;
    this.lastInbox = undefined;
    this.executionInput = undefined;
    this.lastAcceptedKey = undefined;
    this.claimAttempts = 0;
    AgentHistoryStorageFactories.register(this, {
      createAgentHistoryStorage: (input) => AgentHistoryStorageFactories.create(native, input),
    });
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => EntityCommitStorageFactories.create(native, input),
    });
    DeliveryCleanupStorageFactories.register(this, {
      createDeliveryCleanupStorage: () => DeliveryCleanupStorageFactories.create(native),
    });
    AgentExecutionStorageFactories.register(this, {
      createAgentExecutionStorage: (input) => this.executionHandle(input),
    });
  }

  executionHandle(input) {
    this.executionInput = input;
    const native = AgentExecutionStorageFactories.create(this.native, input);
    let reported = false;
    return {
      capacity: native.capacity,
      admit: async (accepted) => {
        const stored = await native.admit(accepted);
        this.lastAcceptedKey = accepted.key;
        if (cutName === "tool-write" && mode === "crash")
          await send({
            kind: "execution-admitted",
            keyBytes: Buffer.from(toBinary(AgentInvocationKeySchema, accepted.key)).toString(
              "base64",
            ),
          });
        if (cutName === "execution-admit" && mode === "crash") {
          const reread = await native.read(accepted.key);
          if (
            reread?.accepted === undefined ||
            !equals(AgentAcceptedInvocationSchema, reread.accepted, accepted)
          )
            throw new Error("Native provider did not retain Agent admission.");
          await this.onBarrier("execution-admission-saved", {
            result: "persisted",
            keyBytes: Buffer.from(toBinary(AgentInvocationKeySchema, accepted.key)).toString(
              "base64",
            ),
            inboxIdBytes: this.lastInbox?.inboxIdBytes,
          });
        }
        return stored;
      },
      pending: (...args) => native.pending(...args),
      read: (...args) => native.read(...args),
      claim: async (...args) => {
        const claimed = await native.claim(...args);
        if (mode === "recover") this.claimAttempts += 1;
        return claimed;
      },
      renew: (...args) => native.renew(...args),
      update: async (change) => {
        await native.update(change);
        if ((cutName === "response" || tenantResponse) && !reported && savedResponse(change)) {
          reported = true;
          await this.onBarrier("response-saved", {
            operation: responseOperation(change),
            ...(tenantResponse ? await this.probeExecution() : {}),
          });
        }
        if (cutName === "tool-read" && !reported && savedToolResponse(change)) {
          reported = true;
          await this.onBarrier("tool-result-saved", {
            keyBytes: Buffer.from(toBinary(AgentInvocationKeySchema, change.key)).toString(
              "base64",
            ),
            ...(await this.probeExecution()),
          });
        }
      },
      complete: async (change) => {
        await native.complete(change);
        if (cutName === "complete" && mode === "crash") {
          const reread = await native.read(change.key);
          if (reread === undefined) throw new Error("Native provider did not retain completion.");
          await this.onBarrier("completion-saved", { result: "persisted" });
        }
      },
      markDelivered: (...args) => native.markDelivered(...args),
      close: () => native.close(),
    };
  }

  onCreateRecordStorage(context, specification, group) {
    const infrastructure = tenantResponse && context.tenantId === undefined;
    const selected = infrastructure ? this.infrastructure : this.native;
    const target = infrastructure ? { ...context, multitenant: false } : context;
    const storage = selected.createRecordStorage(target, specification, group);
    if (specification.recordType.typeName !== InboxMessageSchema.typeName) return storage;
    return new Proxy(storage, {
      get: (target, property) => {
        if (property === "compareAndSet")
          return async (id, expected, next) => {
            const written = await target.compareAndSet(id, expected, next);
            if (
              (cutName === "admission" || cutName === "execution-admit") &&
              mode === "crash" &&
              written &&
              !this.reportedInbox
            ) {
              const reread = await target.read(id);
              if (reread === undefined || !equals(InboxMessageSchema, reread, next))
                throw new Error("Native provider did not retain the original Inbox row.");
              this.reportedInbox = true;
              const facts = {
                result: "persisted",
                inboxHash: inboxHash(reread),
                inboxIdBytes: Buffer.from(toBinary(InboxMessageIdSchema, reread.id)).toString(
                  "base64",
                ),
                inboxStatus: reread.status,
              };
              this.lastInbox = facts;
              if (cutName === "admission") await this.onBarrier("admission-saved", facts);
              else await send({ kind: "inbox-written", ...facts });
            }
            return written;
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  createEntityStorage(input) {
    return this.native.createEntityStorage(input);
  }

  async probeExecution() {
    if (this.executionInput === undefined) return undefined;
    const handle = AgentExecutionStorageFactories.create(this.native, this.executionInput);
    try {
      const key = expectedKey
        ? await handle.read(
            fromBinary(AgentInvocationKeySchema, Buffer.from(expectedKey, "base64")),
          )
        : this.lastAcceptedKey
          ? await handle.read(this.lastAcceptedKey)
          : undefined;
      const page = await handle.pending({ count: 10 });
      return {
        recordStatus: key?.status,
        acceptedActor: key?.accepted?.actor?.actor?.value,
        acceptedTenant: key?.accepted?.actor?.tenantId?.kind.value,
        keyBytes: this.lastAcceptedKey
          ? Buffer.from(toBinary(AgentInvocationKeySchema, this.lastAcceptedKey)).toString("base64")
          : expectedKey,
        uncertainAttempts: key?.journal.filter(
          (entry) => entry.evidence.case === "attempt" && !entry.evidence.value.response.case,
        ).length,
        attemptCount: key?.journal.filter((entry) => entry.evidence.case === "attempt").length,
        invocationDeadlineSeconds: key?.started?.deadline?.seconds?.toString(),
        operationDeadlinesSeconds: key?.journal
          .filter((entry) => entry.evidence.case === "operation")
          .map((entry) => entry.evidence.value.deadline?.seconds?.toString()),
        operationResults: key?.journal
          .filter((entry) => entry.evidence.case === "operation")
          .map((entry) => entry.evidence.value.result.case),
        attemptResponses: key?.journal
          .filter((entry) => entry.evidence.case === "attempt")
          .map((entry) => entry.evidence.value.response.case),
        outgoing: key?.completion?.outgoing.map((entry) => ({
          kind: entry.signal.case,
          id: entry.signal.value?.id?.value,
          delivered: entry.delivered,
          targets: entry.plan?.targets.map((target) => ({
            kind: target.kind,
            fingerprint: target.bindingFingerprint,
          })),
        })),
        toolIntents: key?.journal
          .filter((entry) => entry.evidence.case === "tool")
          .map((entry) => ({
            effect: entry.evidence.value.request?.effect,
            dispatched: entry.evidence.value.dispatched,
            outcomeUnknown: entry.evidence.value.outcomeUnknown,
            hasResponse: entry.evidence.value.response !== undefined,
          })),
        readSnapshots: key?.journal.filter((entry) => entry.evidence.case === "read").length,
        protocolCalls: key?.journal
          .filter((entry) => entry.evidence.case === "protocol")
          .map((entry) => ({
            method: entry.evidence.value.method,
            settled: entry.evidence.value.settled,
            reservedBytes: entry.evidence.value.reservedResponseBytes.toString(),
          })),
        reservedOutputBytes: key?.journal
          .filter((entry) => entry.evidence.case === "attempt")
          .reduce((bytes, entry) => bytes + entry.evidence.value.reservedResponseBytes, 0n)
          .toString(),
        pendingCount: page.records.length,
        pendingStatus: page.records[0]?.status,
        claimAttempts: this.claimAttempts,
      };
    } finally {
      handle.close();
    }
  }

  async probeInbox() {
    if (!expectedInbox) return undefined;
    const inbox = this.native.createRecordStorage(
      { name: contextName, multitenant: false },
      inboxProbeSpec,
    );
    const id = fromBinary(InboxMessageIdSchema, Buffer.from(expectedInbox, "base64"));
    try {
      const row = await inbox.read(id);
      return { inboxStatus: row?.status, inboxFound: row !== undefined };
    } finally {
      inbox.close();
    }
  }

  tenantCatalog() {
    return this.native.tenantCatalog();
  }

  close() {
    super.close();
    this.native.close();
    if (this.infrastructure !== this.native) this.infrastructure.close();
  }
}

async function waitForDispatchedRequest(backend, storage) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (backend.requests().length === 1) {
      const persisted = await storage.probeExecution();
      if (persisted?.uncertainAttempts !== 1 || BigInt(persisted.reservedOutputBytes ?? "0") <= 0n)
        throw new Error(
          `Native provider did not retain the uncertain model reservation: ${JSON.stringify(persisted)}.`,
        );
      return persisted;
    }
    await setImmediate();
  }
  throw new Error("Scripted physical model request did not dispatch.");
}

function registry(backend) {
  return AiRegistry.create({
    defaultModels: { generation: backend.registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 1,
      deadlineMs: 90_000,
      totalInputBytes: 16_000,
      totalOutputBytes: 16_000,
      maxRecoveryBytes: 96_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  }).register(backend.registration);
}

function toolRegistry(mode = "write") {
  const base = process.env.SPINE_TS_RECOVERY_ENDPOINT;
  if (!base) throw new Error("Tool recovery requires its local endpoint.");
  const identity = {
    provider: "openai",
    account: "fixture",
    endpoint: `${base}/v1`,
    model: "fixture-model",
  };
  const registration = VercelAx.model({
    ref: ModelRef.of("support-escalation-fixture", "v1"),
    capabilities: VercelAx.capabilities.openAIResponses(),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: (_scope, _expected, control) => ({
      model: createOpenAI({
        apiKey: "fixture-only",
        baseURL: identity.endpoint,
        fetch: control.fetch,
      }).responses(identity.model),
      identity,
    }),
  });
  const tools = Mcp.server({
    id: "support-service",
    revision: "v1",
    transport: { kind: "streamable-http", url: `${base}/mcp` },
    authorizeConnect: () => true,
    tools: {
      [mode === "write" ? "escalate" : "lookup"]: {
        effect: mode,
        timeoutMs: 60_000,
        maxArgumentBytes: 1_024,
        maxResultBytes: 4_096,
        authorize: () => true,
      },
    },
  });
  return AiRegistry.create({
    defaultModels: { generation: registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 2,
      toolCalls: 1,
      recordedReads: mode === "read" ? 1 : 0,
      deadlineMs: 90_000,
      totalInputBytes: 32_768,
      totalOutputBytes: 262_144,
      maxRecoveryBytes: 262_144,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
    hookTimeoutMs: 2_000,
  })
    .register(registration)
    .registerTools(tools);
}

async function nativeFactory(stringifiers) {
  if (provider === "postgres") {
    const url = process.env.SPINE_TS_POSTGRESQL_URL;
    if (!url) throw new Error("PostgreSQL recovery needs SPINE_TS_POSTGRESQL_URL.");
    const builder = PostgresStorageFactory.newBuilder();
    const options = { url, schema: process.env.SPINE_TS_POSTGRESQL_SCHEMA };
    if (tenantResponse) builder.setTenantOptions([{ tenantId: recoveryTenant, options }]);
    else builder.setOptions(options);
    return builder.setStringifierRegistry(stringifiers).build();
  }
  if (provider === "mysql") {
    const url = process.env.SPINE_TS_MYSQL_URL;
    if (!url) throw new Error("MySQL recovery needs SPINE_TS_MYSQL_URL.");
    return MysqlStorageFactory.newBuilder()
      .setOptions({ url })
      .setStringifierRegistry(stringifiers)
      .build();
  }
  if (provider === "datastore") {
    const projectId = process.env.SPINE_TS_DATASTORE_PROJECT;
    if (!process.env.DATASTORE_EMULATOR_HOST || !projectId)
      throw new Error("Datastore recovery needs emulator host and project.");
    return DatastoreStorageFactory.newBuilder()
      .setClient(new Datastore({ projectId }))
      .setStringifierRegistry(stringifiers)
      .build();
  }
  throw new Error(`Unknown recovery provider: ${provider}.`);
}

function draftObserver() {
  return new SupportDraftObserver(async (event) => {
    if (cutName !== "fanout") return;
    await send({
      kind: mode === "crash" ? "second-recipient-entered" : "second-recipient-delivered",
      reply: event.reply,
    });
    if (mode === "crash")
      await new Promise((resolve) => {
        const release = (candidate) => {
          if (candidate?.kind !== "release-observer") return;
          process.off("message", release);
          resolve();
        };
        process.on("message", release);
      });
  });
}

function draftReceiptObserver() {
  return new SupportDraftReceiptObserver(async (event) => {
    if (cutName !== "fanout") return;
    await send({ kind: "first-recipient-delivered", reply: event.reply });
  });
}

async function context(storage, backend) {
  const projectionRouting = EventRouting.create().route(SupportReplyDraftedSchema, () => [
    create(SupportReplyAgentIdSchema, { ticketNumber }),
  ]);
  if (mode === "revise-projection")
    return BoundedContext.singleTenant(contextName)
      .withGeneratedRegistryRoot(new URL("../../dist/", import.meta.url))
      .withStorageFactory(storage)
      .addAssignee(new SupportReviewAssignee())
      .addEventDispatcher(new SupportRejectionSubscriber())
      .addEventDispatcher(draftReceiptObserver())
      .addEventDispatcher(draftObserver())
      .add(SupportDraftProjection, { eventRouting: projectionRouting })
      .buildAsync();
  if (cutName === "tool-read")
    return BoundedContext.singleTenant(contextName)
      .withGeneratedRegistryRoot(new URL("../../dist/", import.meta.url))
      .withAi(toolRegistry("read"))
      .persistSystemEvents()
      .withStorageFactory(storage)
      .addAssignee(new SupportReviewAssignee())
      .addEventDispatcher(new SupportRejectionSubscriber())
      .addEventDispatcher(draftReceiptObserver())
      .addEventDispatcher(draftObserver())
      .add(SupportDraftProjection, { eventRouting: projectionRouting })
      .add(SupportLookupRecoveryAgent, {
        agentCodeRevision: "support-lookup-recovery-v1",
        ai: { models: [lookupRecoveryModel] },
      })
      .buildAsync();
  if (cutName === "tool-write")
    return BoundedContext.singleTenant(contextName)
      .withGeneratedRegistryRoot(new URL("../../dist/", import.meta.url))
      .withAi(toolRegistry())
      .persistSystemEvents()
      .withStorageFactory(storage)
      .addAssignee(new SupportReviewAssignee())
      .addEventDispatcher(new SupportRejectionSubscriber())
      .addEventDispatcher(draftReceiptObserver())
      .addEventDispatcher(draftObserver())
      .add(SupportEscalationRecoveryAgent, {
        agentCodeRevision: "support-escalation-recovery-v1",
        ai: { models: [escalationRecoveryModel] },
      })
      .buildAsync();
  const builder = (
    tenantResponse
      ? BoundedContext.multitenant(contextName)
      : BoundedContext.singleTenant(contextName)
  )
    .withGeneratedRegistryRoot(new URL("../../dist/", import.meta.url))
    .withAi(registry(backend))
    .persistSystemEvents()
    .withStorageFactory(storage)
    .addAssignee(new SupportReviewAssignee())
    .addEventDispatcher(new SupportRejectionSubscriber())
    .addEventDispatcher(draftReceiptObserver());
  if (mode !== "missing-receiver") builder.addEventDispatcher(draftObserver());
  builder.add(SupportRecoveryAgent, {
    agentCodeRevision: "support-recovery-v1",
    ai: { models: [recoveryReplyModel] },
  });
  if (cutName === "fanout") builder.add(SupportDraftProjection);
  return builder.buildAsync();
}

async function run() {
  const backend = AiTestBackend.create({
    ref: ModelRef.of("support-recovery-scripted", "v1"),
    kind: "generation",
  });
  if (mode === "crash" && cutName === "dispatched") {
    const responses = backend.forModel(recoveryReplyModel);
    responses.delay();
    responses.respondWith(
      create(SupportReplyProposalSchema, { replyText: "A reviewer can help." }),
    );
  } else if (
    mode === "crash" ||
    (mode === "recover" && (cutName === "admission" || cutName === "execution-admit"))
  )
    backend
      .forModel(recoveryReplyModel)
      .respondWith(create(SupportReplyProposalSchema, { replyText: "A reviewer can help." }));
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([SupportReplyAgentIdSchema]));
  const native = await nativeFactory(stringifiers);
  const infrastructure = tenantResponse
    ? await PostgresStorageFactory.newBuilder()
        .setOptions({
          url: process.env.SPINE_TS_POSTGRESQL_URL,
          schema: process.env.SPINE_TS_POSTGRESQL_SCHEMA,
        })
        .setStringifierRegistry(stringifiers)
        .build()
    : native;
  const cut = async (kind, facts) => {
    await send({ kind, ...facts, physicalRequests: backend.requests().length });
    await new Promise((resolve) => process.once("message", resolve));
  };
  const storage = new RecoveryCutStorageFactory(
    native,
    mode === "crash" ? cut : async () => {},
    infrastructure,
  );
  const built = await context(storage, backend);
  const box = await BlackBox.from(built, {
    timeoutMs: 60_000,
    ...(tenantResponse ? { tenant: recoveryTenant } : {}),
  });
  const id = create(SupportReplyAgentIdSchema, { ticketNumber });
  if (mode === "revise-projection") {
    await box
      .asGuest()
      .postEvent(
        SupportReplyDraftedSchema,
        create(SupportReplyDraftedSchema, { agent: id, reply: "Revised draft" }),
      );
    await box.eventually(
      () => built.stand().read(DraftProjectionStateSchema, id),
      (value) => value?.proposedReply === "Revised draft",
    );
    await send({ kind: "projection-revised", reply: "Revised draft" });
    await box.close();
    storage.close();
    return;
  }
  if (mode === "crash" && cutName === "tool-read") {
    await box
      .asGuest()
      .postEvent(
        SupportReplyDraftedSchema,
        create(SupportReplyDraftedSchema, { agent: id, reply: "Original draft" }),
      );
    await box.eventually(
      () => built.stand().read(DraftProjectionStateSchema, id),
      (value) => value?.proposedReply === "Original draft",
    );
  }
  if (cutName === "tool-write" && mode === "crash")
    process.on("message", (candidate) => {
      if (candidate?.kind !== "probe-tool") return;
      void storage.probeExecution().then((facts) => send({ kind: "tool-journal", ...facts }));
    });
  if (cutName === "fanout" && mode === "crash")
    process.on("message", (candidate) => {
      if (candidate?.kind !== "probe-fanout") return;
      void storage.probeExecution().then((facts) => send({ kind: "fanout-saved", ...facts }));
    });
  if (tenantResponse && mode === "crash")
    process.on("message", (candidate) => {
      if (candidate?.kind !== "probe-tenant") return;
      void Promise.all([storage.probeExecution(), postgresHeadProbe()]).then(([record, head]) =>
        send({
          kind: "tenant-probe",
          ...record,
          ...head,
          physicalRequests: backend.requests().length,
        }),
      );
    });
  if (mode === "crash") {
    const command =
      cutName === "tool-write"
        ? EscalateRecoverySchema
        : cutName === "tool-read"
          ? DraftKnowledgeSchema
          : DraftRecoverySchema;
    const posted = await (tenantResponse ? box.onBehalfOf("reviewer-a") : box.asGuest()).post(
      command,
      create(command, { agent: id, question: "Where is my shipment?" }),
    );
    await send({
      kind: "admitted",
      result: posted.kind,
      error: posted.kind === "error" ? JSON.stringify(posted.error) : undefined,
    });
    if (cutName === "dispatched") {
      const persisted = await waitForDispatchedRequest(backend, storage);
      await cut("request-dispatched", persisted);
    }
    return;
  }
  try {
    const repository = built
      .registeredRepositories()
      .find(
        (view) =>
          view.entityType ===
          (cutName === "tool-write"
            ? SupportEscalationRecoveryAgent
            : cutName === "tool-read"
              ? SupportLookupRecoveryAgent
              : SupportRecoveryAgent),
      );
    if (!repository) throw new Error("Recovery Agent repository was not registered.");
    const retained = await box.readAgentHistory(repository, id, { pageSize: 30 });
    await send({ kind: "recovery-start", historyCount: retained.items.length });
    if (cutName === "tool-write") {
      let terminal;
      try {
        terminal = await box.eventually(
          () => storage.probeExecution(),
          (value) => value?.recordStatus === 5,
          { timeoutMs: 60_000 },
        );
      } catch (error) {
        await send({
          kind: "tool-late",
          ...(await storage.probeExecution()),
          ...(await postgresHeadProbe()),
        });
        throw error;
      }
      const state = await built.stand().readVersioned(EscalationStateSchema, id);
      await send({
        kind: "tool-unknown-terminated",
        ...terminal,
        ...(await terminationAudit(box, repository, id)),
        version: state?.version?.number ?? 0,
        events: box.assertEvents().map((event) => event.message?.typeUrl),
      });
      return;
    }
    if (cutName === "dispatched") {
      let terminal;
      try {
        terminal = await box.eventually(
          () => storage.probeExecution(),
          (value) => value?.recordStatus === 5,
          { timeoutMs: 60_000 },
        );
      } catch (error) {
        await send({
          kind: "uncertainty-late",
          ...(await storage.probeExecution()),
          ...(await postgresHeadProbe()),
          physicalRequests: backend.requests().length,
        });
        throw error;
      }
      const state = await built.stand().readVersioned(SupportRecoveryStateSchema, id);
      await send({
        kind: "uncertain-terminated",
        ...terminal,
        ...(await terminationAudit(box, repository, id)),
        version: state?.version?.number ?? 0,
        physicalRequests: backend.requests().length,
        events: box.assertEvents().map((event) => event.message?.typeUrl),
      });
      return;
    }
    let state;
    const expectedReply =
      cutName === "tool-read"
        ? "Ticket found; we can help. Earlier draft: Original draft"
        : "A reviewer can help.";
    const stateSchema = cutName === "tool-read" ? LookupStateSchema : SupportRecoveryStateSchema;
    const stateScope = tenantResponse ? { tenantId: recoveryTenant } : {};
    try {
      state = await box.eventually(
        () => built.stand().read(stateSchema, id, stateScope),
        (value) => value?.proposedReply === expectedReply,
      );
    } catch (error) {
      if (cutName === "execution-admit" || cutName === "admission")
        await send({
          kind: "recovery-probe-late",
          ...(await storage.probeInbox()),
          ...(await storage.probeExecution()),
        });
      if (cutName === "tool-read")
        await send({
          kind: "read-recovery-late",
          ...(await storage.probeExecution()),
          ...(await postgresHeadProbe()),
          state: (await built.stand().read(LookupStateSchema, id))?.proposedReply,
          projection: (await built.stand().read(DraftProjectionStateSchema, id))?.proposedReply,
        });
      throw error;
    }
    const history = await box.readAgentHistory(repository, id, { pageSize: 30 });
    const operations = history.items
      .filter((entry) => entry.item.case === "conversationRecord")
      .map((entry) => entry.item.value.operation?.value)
      .filter(Boolean);
    const version = (await built.stand().readVersioned(stateSchema, id, stateScope))?.version
      ?.number;
    const events = await box.eventually(
      () =>
        box
          .assertEvents()
          .map(
            (event) =>
              event.message && AnyMessages.unpack(event.message, SupportReplyDraftedSchema),
          )
          .filter(Boolean),
      (items) => items.length === 1,
      { timeoutMs: ["complete", "fanout", "tool-read"].includes(cutName) ? 60_000 : 10_000 },
    );
    await send({
      kind: "recovered",
      ...(tenantResponse ? await storage.probeExecution() : {}),
      state: state?.proposedReply,
      version,
      events: events.map((event) => event.reply),
      operations,
      historyCount: history.items.length,
      physicalRequests: backend.requests().length,
      ...(["fanout", "tool-read"].includes(cutName) ? await storage.probeExecution() : {}),
    });
  } finally {
    await box.close();
    storage.close();
  }
}

run().catch(async (error) => {
  await send({ kind: "fatal", message: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
});
