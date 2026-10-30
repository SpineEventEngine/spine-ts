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

import { create } from "@bufbuild/protobuf";
import { Datastore } from "@google-cloud/datastore";
import { AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { GenerationResponseSchema } from "@spine-event-engine/proto/agent";
import * as Receipt from "@spine-event-engine/proto/generated/spine/server/agent/acceptance_receipt_pb.js";
import { BoundedContext, EnvironmentType, ServerEnvironment } from "@spine-event-engine/server";
import { StorageFactory } from "@spine-event-engine/storage";
import {
  AgentHistoryStorageFactories,
  EntityCommitStorageFactories,
} from "@spine-event-engine/storage/provider";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { MysqlStorageFactory } from "@spine-event-engine/storage-mysql";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { AiTestBackend, BlackBox } from "@spine-event-engine/testing";
import process from "node:process";

import * as Commands from "../../dist/generated/spine/server/testing/support_recovery_commands_pb.js";
import "../../dist/generated/spine-bootstrap.js";
import { SupportReplyAgentIdSchema } from "../../dist/generated/spine/server/testing/support_agent_states_pb.js";
import { SupportRecoveryStateSchema } from "../../dist/generated/spine/server/testing/support_recovery_states_pb.js";
import { SupportReplyProposalSchema } from "../../dist/generated/spine/server/testing/support_recovery_types_pb.js";
import { SupportRecoveryAgent, recoveryReplyModel } from "../../dist/src/agent/recovery-agent.js";
import {
  SupportRejectionSubscriber,
  SupportReviewAssignee,
} from "../../dist/src/agent/support-reply-receivers.js";
import {
  SupportDraftObserver,
  SupportDraftReceiptObserver,
} from "../../dist/src/agent/support-draft-receivers.js";

const [provider, mode, contextName, ticketNumber, cutName] = process.argv.slice(2);
if (!provider || !mode || !contextName || !ticketNumber || !cutName)
  throw new Error("Interruption child needs provider, mode, context, ticket, and cut.");

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.send) return reject(new Error("Interruption child requires IPC."));
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

async function barrier(kind, facts = {}) {
  await send({ kind, ...facts });
  await new Promise(() => undefined);
}

async function nativeFactory(stringifiers) {
  if (provider === "postgres") {
    const url = process.env.SPINE_TS_POSTGRESQL_URL;
    if (!url) throw new Error("PostgreSQL interruption URL is required.");
    return PostgresStorageFactory.newBuilder()
      .setOptions({ url, schema: process.env.SPINE_TS_POSTGRESQL_SCHEMA })
      .setStringifierRegistry(stringifiers)
      .build();
  }
  if (provider === "mysql") {
    const url = process.env.SPINE_TS_MYSQL_URL;
    if (!url) throw new Error("MySQL interruption URL is required.");
    return MysqlStorageFactory.newBuilder()
      .setOptions({ url })
      .setStringifierRegistry(stringifiers)
      .build();
  }
  if (provider === "datastore") {
    const projectId = process.env.SPINE_TS_DATASTORE_PROJECT;
    if (!process.env.DATASTORE_EMULATOR_HOST || !projectId)
      throw new Error("Datastore interruption needs emulator host and project.");
    return DatastoreStorageFactory.newBuilder()
      .setClient(new Datastore({ projectId }))
      .setStringifierRegistry(stringifiers)
      .build();
  }
  throw new Error(`Unknown interruption provider: ${provider}.`);
}

function hasResponse(entries) {
  return entries.some(
    (entry) =>
      entry.item.case === "conversationRecord" &&
      entry.item.value.content?.typeUrl === `type.spine.io/${GenerationResponseSchema.typeName}`,
  );
}

class CutStorageFactory extends StorageFactory {
  constructor(native) {
    super();
    this.native = native;
    this.cut = false;
    AgentHistoryStorageFactories.register(this, {
      createAgentHistoryStorage: (input) => this.history(input),
    });
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => EntityCommitStorageFactories.create(native, input),
    });
  }

  history(input) {
    const storage = AgentHistoryStorageFactories.create(this.native, input);
    const appendAll = storage.appendAll.bind(storage);
    storage.appendAll = async (id, entries) => {
      await appendAll(id, entries);
      if (mode === "crash" && cutName === "response" && !this.cut && hasResponse(entries)) {
        this.cut = true;
        await barrier("response-saved");
      }
    };
    return storage;
  }

  onCreateRecordStorage(context, spec, group) {
    const storage = this.native.createRecordStorage(context, spec, group);
    if (spec.recordType.typeName !== Receipt.AgentAcceptanceReceiptSchema.typeName) return storage;
    return new Proxy(storage, {
      get: (target, property) => {
        if (property === "compareAndSet")
          return async (...args) => {
            const admitted = await target.compareAndSet(...args);
            if (mode === "crash" && cutName === "accepted" && admitted && !this.cut) {
              this.cut = true;
              await barrier("receipt-saved");
            }
            return admitted;
          };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  createEntityStorage(input) {
    return this.native.createEntityStorage(input);
  }
  checkConnection() {
    return this.native.checkConnection();
  }
  close() {
    return this.native.close();
  }
}

async function run() {
  const previousNow = Date.now;
  if (mode === "reopen") Date.now = () => previousNow() + 31_000;
  const backend = AiTestBackend.create({
    ref: ModelRef.of("support-live-interruption", "v1"),
    kind: "generation",
  });
  if (mode === "crash" || mode === "reopen")
    backend
      .forModel(recoveryReplyModel)
      .respondWith(create(SupportReplyProposalSchema, { replyText: "A reviewer can help." }));
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([SupportReplyAgentIdSchema]));
  const native = await nativeFactory(stringifiers);
  const storage = new CutStorageFactory(native);
  ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: storage });
  await ServerEnvironment.instance().completeSetup();
  const registry = AiRegistry.create({
    defaultModels: { generation: backend.registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 0,
      deadlineMs: 90_000,
      totalInputBytes: 32_768,
      totalOutputBytes: 262_144,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  }).register(backend.registration);
  const context = await BoundedContext.singleTenant(contextName)
    .withAi(registry)
    .persistSystemEvents()
    .addAssignee(new SupportReviewAssignee())
    .addEventDispatcher(new SupportRejectionSubscriber())
    .addEventDispatcher(new SupportDraftReceiptObserver(() => undefined))
    .addEventDispatcher(new SupportDraftObserver(() => undefined))
    .add(SupportRecoveryAgent, { ai: { models: [recoveryReplyModel] } })
    .build();
  const box = await BlackBox.from(context, { timeoutMs: 10_000 });
  const id = create(SupportReplyAgentIdSchema, { ticketNumber });
  const repository = context.getRepository(SupportRecoveryAgent);
  if (mode === "crash") {
    void box
      .asGuest()
      .post(
        Commands.DraftRecoverySupportReplySchema,
        create(Commands.DraftRecoverySupportReplySchema, {
          agent: id,
          question: "Original question",
        }),
      )
      .then((result) => send({ kind: "posted", result: result.kind }))
      .catch((error) => send({ kind: "error", error: String(error) }));
    return;
  }
  try {
    const stateBefore = await context.stand().read(SupportRecoveryStateSchema, id);
    const before = await box.readAgentHistory(repository, id, { pageSize: 40 });
    await send({
      kind: "reopened",
      state: stateBefore?.proposedReply,
      historyCount: before.items.length,
      requests: backend.requests().length,
      events: box.assertEvents().length,
    });
    const posted = await box
      .asGuest()
      .post(
        Commands.DraftRecoverySupportReplySchema,
        create(Commands.DraftRecoverySupportReplySchema, { agent: id, question: "Fresh question" }),
      );
    if (posted.kind !== "ok") throw new Error(`Fresh Agent input failed: ${posted.kind}`);
    let state;
    try {
      state = await box.eventually(
        () => context.stand().read(SupportRecoveryStateSchema, id),
        (value) => value?.proposedReply === "A reviewer can help.",
      );
    } catch (error) {
      const late = await box.readAgentHistory(repository, id, { pageSize: 40 });
      await send({
        kind: "fresh-late",
        error: String(error),
        requests: backend.requests().length,
        calls: SupportRecoveryAgent.draftCalls,
        historyCount: late.items.length,
        events: box.assertEvents().length,
      });
      throw error;
    }
    const after = await box.readAgentHistory(repository, id, { pageSize: 40 });
    await send({
      kind: "fresh-complete",
      state: state?.proposedReply,
      historyCount: after.items.length,
      requests: backend.requests().length,
      events: box.assertEvents().length,
      calls: SupportRecoveryAgent.draftCalls,
    });
  } finally {
    await box.close();
    await storage.close();
    Date.now = previousNow;
  }
}

run().catch(async (error) => {
  await send({ kind: "error", error: String(error), stack: error?.stack });
  process.exitCode = 1;
});
