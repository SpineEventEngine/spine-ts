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

import { create, type Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AiModel, AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyMessages, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { Time } from "@spine-event-engine/core/time";
import { AgentInvocationTerminatedSchema } from "@spine-event-engine/proto/agent";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandSchema,
  EventContextSchema,
  EventSchema,
  UserIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type {
  AgentInvocationKey,
  AgentExecutionRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AgentInvocationStatus } from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type {
  AgentExecutionStorage,
  AgentExecutionStorageInput,
  AgentPendingPage,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";
import { Agent } from "../../src/entity/entity.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { Repository } from "../../src/repository/repository.js";
import { repositoryAccess } from "../../src/repository/repository.js";
import { EntityHandlers, HandlerMetadataValues } from "../../src/handler/handler-metadata.js";
import { createMessage } from "../delivery/inbox-message-fixture.js";
import {
  SupportReplyAgentIdSchema,
  type SupportReplyAgentId,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
  ReviewSupportReplySchema,
  type ReviewSupportReply,
} from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import {
  SupportReplyDraftedSchema,
  SupportTicketUpdatedSchema,
  type SupportReplyDrafted,
  type SupportTicketUpdated,
} from "../../test-fixtures/generated/entity-metadata/support_agent_events_pb.js";

class SupportAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static calls = 0;
  static onDraft: (() => void) | undefined;

  draft(command: DraftSupportReply): void {
    void command;
    SupportAgent.calls += 1;
    SupportAgent.onDraft?.();
  }
}

class ReadingSupportAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static completed = 0;
  static replayPageSize = 1;
  static failAfterRead = false;

  async draft(command: DraftSupportReply): Promise<void> {
    if (command.question === "Exhaust read budget") {
      await this.fullHistory({ pageSize: 1 });
      return;
    }
    if (command.question === "Replay changed read") {
      await this.fullHistory({ pageSize: ReadingSupportAgent.replayPageSize });
      if (ReadingSupportAgent.failAfterRead) throw new Error("Transient callback failure.");
      return;
    }
    ReadingSupportAgent.completed++;
    this.update((state) => Object.assign(state, { id: this.id, proposedReply: "Ready" }));
  }
}

class ChangingSupportAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  draft(command: DraftSupportReply): void {
    this.update((state) =>
      Object.assign(state, {
        id: this.id,
        proposedReply: `Answer: ${command.question}`,
      }),
    );
  }
}

class EmittingSupportAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static calls = 0;

  onDraft(event: SupportReplyDrafted): void {
    void event;
  }

  draft(command: DraftSupportReply): SupportReplyDrafted {
    EmittingSupportAgent.calls += 1;
    return create(SupportReplyDraftedSchema, {
      agent: this.id,
      reply: `Answer: ${command.question}`,
    });
  }
}

class CommandingSupportAgent extends Agent<
  SupportReplyAgentId,
  typeof SupportReplyAgentStateSchema
> {
  static calls = 0;

  onTicketUpdated(event: SupportTicketUpdated): ReviewSupportReply {
    CommandingSupportAgent.calls += 1;
    return create(ReviewSupportReplySchema, { agent: event.agent });
  }

  review(command: ReviewSupportReply): void {
    void command;
  }
}

class RecordingExecutionFactory extends InMemoryStorageFactory {
  failAdmission = false;
  failUpdateOnce = false;
  failMarkDeliveryOnce = false;
  suppressSchedulerDiscovery = false;
  admittedKeys: AgentInvocationKey[] = [];
  pendingPage?: () => Promise<AgentPendingPage>;
  readAccepted?: (key: AgentInvocationKey) => Promise<AgentExecutionRecord | undefined>;

  protected override createAgentExecutionStorage<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S> {
    const storage = super.createAgentExecutionStorage(input);
    const admit = storage.admit.bind(storage);
    const update = storage.update.bind(storage);
    storage.update = async (input) => {
      if (this.failUpdateOnce) {
        this.failUpdateOnce = false;
        throw new Error("Agent execution provider temporarily unavailable.");
      }
      return update(input);
    };
    storage.admit = async (accepted) => {
      if (this.failAdmission) throw new Error("Agent admission provider unavailable.");
      const record = await admit(accepted);
      if (accepted.key !== undefined) this.admittedKeys.push(accepted.key);
      return record;
    };
    const markDelivered = storage.markDelivered.bind(storage);
    storage.markDelivered = async (...args) => {
      if (this.failMarkDeliveryOnce) {
        this.failMarkDeliveryOnce = false;
        throw new Error("Agent delivery acknowledgement unavailable.");
      }
      await markDelivered(...args);
    };
    const pending = storage.pending.bind(storage);
    storage.pending = (read) =>
      this.suppressSchedulerDiscovery
        ? Promise.resolve({ records: [], hasMore: false })
        : pending(read);
    this.pendingPage ??= () => storage.pending({ count: 10 });
    this.readAccepted ??= (key) => storage.read(key);
    return storage;
  }
}

const ai = () =>
  AiRegistry.create({
    defaultModels: {},
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 1,
      deadlineMs: 1000,
      totalInputBytes: 4000,
      totalOutputBytes: 4000,
      maxRecoveryBytes: 4000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  });

const repository = (revision = "support-agent-v1") =>
  new Repository({
    entityType: SupportAgent,
    schema: SupportReplyAgentStateSchema,
    agentCodeRevision: revision,
    ai: { models: [] },
  });

const proposal = AiModel.define({
  name: "draft-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a reply for human review.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1000,
    maxInputBytes: 4000,
    maxOutputBytes: 4000,
    maxOutputTokens: 100,
  },
});

describe("Agent registration readiness", () => {
  it("selects and saves a credential-free deployment only when execution starts", async () => {
    const factory = new RecordingExecutionFactory();
    let resolved = 0;
    let savedBeforeIdentity: AgentExecutionRecord | undefined;
    const ref = ModelRef.of("support-scripted", "v1");
    const registry = AiRegistry.create({
      defaultModels: { generation: ref },
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 1,
        deadlineMs: 1000,
        totalInputBytes: 4000,
        totalOutputBytes: 4000,
        maxRecoveryBytes: 4000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: async () => {
          resolved++;
          const key = factory.admittedKeys[0];
          if (key === undefined) throw new Error("Expected Agent intake before selection.");
          savedBeforeIdentity = await factory.readAccepted?.(key);
          return {
            provider: "scripted",
            account: "support",
            endpoint: "local",
            model: "support-v1",
          };
        },
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => Promise.reject(new Error("No model request expected.")),
      }),
    );
    const configured = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(SupportAgent, SupportReplyAgentStateSchema, (builder) => [
        builder.assign(DraftSupportReplySchema, "draft"),
      ]),
      agentCodeRevision: "support-selection-v1",
      ai: { models: [proposal] },
    });
    const context = BoundedContext.singleTenant("SelectedSupport")
      .withAi(registry)
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-selected" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("selected", command.id?.uuid ?? "", 1n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      expect(resolved).toBe(0);
      const key = factory.admittedKeys[0];
      if (key === undefined) throw new Error("Expected Agent intake.");
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      expect(resolved).toBe(1);
      expect(savedBeforeIdentity?.started?.deadline).toBeDefined();
      expect(savedBeforeIdentity?.started?.bounds?.modelRequests).toBe(1n);
      expect(savedBeforeIdentity?.started?.models).toEqual([]);
      expect(
        (await factory.readAccepted?.(key))?.started?.models[0]?.connection?.model?.value,
      ).toBe("support-v1");
    } finally {
      await context.close();
    }
  });
  it("keeps the saved start deadline when selection is interrupted", async () => {
    const factory = new RecordingExecutionFactory();
    factory.suppressSchedulerDiscovery = true;
    let nowMs = 1_782_979_201_000;
    const previousTime = Time.setProvider({
      currentTime: () =>
        create(TimestampSchema, {
          seconds: BigInt(Math.floor(nowMs / 1_000)),
          nanos: (nowMs % 1_000) * 1_000_000,
        }),
    });
    let enteredSelection: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredSelection = resolve;
    });
    let releaseSelection: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      releaseSelection = resolve;
    });
    let selectionCalls = 0;
    let modelCalls = 0;
    const ref = ModelRef.of("support-delayed", "v1");
    const registry = AiRegistry.create({
      defaultModels: { generation: ref },
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 1,
        deadlineMs: 1_000,
        totalInputBytes: 4_000,
        totalOutputBytes: 4_000,
        maxRecoveryBytes: 4_000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: async () => {
          selectionCalls++;
          enteredSelection?.();
          await pending;
          return { provider: "scripted", account: "support", endpoint: "local", model: "v1" };
        },
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => {
          modelCalls++;
          return Promise.reject(new Error("Unexpected model call."));
        },
      }),
    );
    const configured = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(SupportAgent, SupportReplyAgentStateSchema, (builder) => [
        builder.assign(DraftSupportReplySchema, "draft"),
      ]),
      agentCodeRevision: "support-interrupted-selection-v1",
      ai: { models: [proposal] },
    });
    const context = BoundedContext.singleTenant("InterruptedSelection")
      .withAi(registry)
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-interrupted" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("interrupted", command.id?.uuid ?? "", 1n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      const key = factory.admittedKeys[0];
      if (key === undefined) throw new Error("Expected accepted Agent signal.");
      const abort = new AbortController();
      const interrupted = repositoryAccess.runAcceptedAgent(
        configured,
        undefined,
        key,
        abort.signal,
      );
      await entered;
      const fixed = await factory.readAccepted?.(key);
      expect(fixed?.started?.deadline?.seconds).toBe(BigInt(Math.floor((nowMs + 1_000) / 1_000)));
      expect(fixed?.started?.bounds?.modelRequests).toBe(1n);
      expect(fixed?.started?.models).toEqual([]);
      abort.abort();
      await interrupted;
      releaseSelection?.();
      nowMs += 31_000;
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      expect((await factory.readAccepted?.(key))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_TERMINATED,
      );
      expect(selectionCalls).toBe(1);
      expect(modelCalls).toBe(0);
    } finally {
      await context.close();
      Time.setProvider(previousTime);
    }
  });
  it("terminates a read-budget fault so the next accepted signal can run", async () => {
    ReadingSupportAgent.completed = 0;
    const factory = new RecordingExecutionFactory();
    factory.suppressSchedulerDiscovery = true;
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 0,
        deadlineMs: 10_000,
        totalInputBytes: 4_000,
        totalOutputBytes: 4_000,
        maxRecoveryBytes: 8_000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    const configured = new Repository({
      entityType: ReadingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(
        ReadingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
      ),
      agentCodeRevision: "support-read-budget-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("ReadBudgetProgress")
      .withAi(registry)
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-budget" });
      for (const [index, question] of ["Exhaust read budget", "Continue"].entries()) {
        const command = SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "support-user" }),
            }),
          }),
        });
        await repositoryAccess.entityInboxTarget(configured)?.replay({
          ...createMessage(`budget-${String(index)}`, command.id?.uuid ?? "", BigInt(index + 1)),
          inboxId: {
            targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
            targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
          },
          signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
          label: "HANDLE_COMMAND",
          status: "TO_DELIVER",
        });
      }
      const [first, second] = factory.admittedKeys;
      if (first === undefined || second === undefined)
        throw new Error("Expected two accepted signals.");
      await repositoryAccess.runAcceptedAgent(configured, undefined, first);
      expect((await factory.readAccepted?.(first))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_TERMINATED,
      );
      const audit = await repositoryAccess.agentHistoryPage(configured, id, { pageSize: 20 });
      const terminated = audit.items.flatMap((entry) => {
        if (entry.item.case !== "systemEvent" || entry.item.value.message === undefined) return [];
        const event = AnyMessages.unpack(entry.item.value.message, AgentInvocationTerminatedSchema);
        return event === undefined ? [] : [event];
      });
      expect(terminated).toMatchObject([
        {
          reason: "READ_BUDGET_EXCEEDED",
          unresolvedAttempts: [],
          unresolvedToolCalls: [],
        },
      ]);
      await repositoryAccess.runAcceptedAgent(configured, undefined, second);
      expect((await factory.readAccepted?.(second))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
      );
      expect(ReadingSupportAgent.completed).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("terminates changed saved history reads and advances the next signal", async () => {
    ReadingSupportAgent.completed = 0;
    ReadingSupportAgent.replayPageSize = 1;
    ReadingSupportAgent.failAfterRead = true;
    const factory = new RecordingExecutionFactory();
    factory.suppressSchedulerDiscovery = true;
    let seconds = 1_782_979_201n;
    const previousTime = Time.setProvider({
      currentTime: () => create(TimestampSchema, { seconds }),
    });
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 1,
        deadlineMs: 60_000,
        totalInputBytes: 4_000,
        totalOutputBytes: 4_000,
        maxRecoveryBytes: 8_000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    const configured = new Repository({
      entityType: ReadingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(
        ReadingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
      ),
      agentCodeRevision: "support-read-replay-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("ReadReplayProgress")
      .withAi(registry)
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-read-replay" });
      for (const [index, question] of ["Replay changed read", "Continue"].entries()) {
        const command = SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "support-user" }),
            }),
          }),
        });
        await repositoryAccess.entityInboxTarget(configured)?.replay({
          ...createMessage(
            `read-replay-${String(index)}`,
            command.id?.uuid ?? "",
            BigInt(index + 1),
          ),
          inboxId: {
            targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
            targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
          },
          signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
          label: "HANDLE_COMMAND",
          status: "TO_DELIVER",
        });
      }
      const [first, second] = factory.admittedKeys;
      if (first === undefined || second === undefined)
        throw new Error("Expected two accepted signals.");
      await expect(repositoryAccess.runAcceptedAgent(configured, undefined, first)).rejects.toThrow(
        "Transient callback failure",
      );
      const savedDeadline = (await factory.readAccepted?.(first))?.started?.deadline;
      ReadingSupportAgent.failAfterRead = false;
      ReadingSupportAgent.replayPageSize = 2;
      seconds += 31n;
      await repositoryAccess.runAcceptedAgent(configured, undefined, first);
      const terminal = await factory.readAccepted?.(first);
      expect(terminal?.status).toBe(AgentInvocationStatus.AGENT_INVOCATION_TERMINATED);
      expect(terminal?.started?.deadline).toEqual(savedDeadline);
      await repositoryAccess.runAcceptedAgent(configured, undefined, second);
      expect((await factory.readAccepted?.(second))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
      );
      expect(ReadingSupportAgent.completed).toBe(1);
    } finally {
      await context.close();
      Time.setProvider(previousTime);
      ReadingSupportAgent.failAfterRead = false;
      ReadingSupportAgent.replayPageSize = 1;
    }
  });

  it("preserves accepted work when a provider mutation fails transiently", async () => {
    const factory = new RecordingExecutionFactory();
    factory.suppressSchedulerDiscovery = true;
    let seconds = 1_782_979_201n;
    const previousTime = Time.setProvider({
      currentTime: () => create(TimestampSchema, { seconds }),
    });
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 0,
        deadlineMs: 60_000,
        totalInputBytes: 4_000,
        totalOutputBytes: 4_000,
        maxRecoveryBytes: 8_000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    const configured = new Repository({
      entityType: ChangingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(
        ChangingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
      ),
      agentCodeRevision: "support-transient-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("TransientAgentMutation")
      .withAi(registry)
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-transient" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("transient", command.id?.uuid ?? "", 1n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      const key = factory.admittedKeys[0];
      if (key === undefined) throw new Error("Expected accepted Agent signal.");
      factory.failUpdateOnce = true;
      await expect(repositoryAccess.runAcceptedAgent(configured, undefined, key)).rejects.toThrow(
        "temporarily unavailable",
      );
      expect((await factory.readAccepted?.(key))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
      );
      seconds += 31n;
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      expect((await factory.readAccepted?.(key))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
      );
    } finally {
      await context.close();
      Time.setProvider(previousTime);
    }
  });
  it("discovers admitted Agent work without an application worker call", async () => {
    SupportAgent.calls = 0;
    let signalDraft: (() => void) | undefined;
    const drafted = new Promise<void>((resolve) => {
      signalDraft = resolve;
    });
    SupportAgent.onDraft = () => signalDraft?.();
    const configured = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(SupportAgent, SupportReplyAgentStateSchema, (builder) => [
        builder.assign(DraftSupportReplySchema, "draft"),
      ]),
      agentCodeRevision: "support-agent-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("ScheduledSupport")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-scheduled" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("agent-scheduled", command.id?.uuid ?? "", 1n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      await drafted;
      expect(SupportAgent.calls).toBe(1);
    } finally {
      SupportAgent.onDraft = undefined;
      await context.close();
    }
  });

  it("requires an AI registry and persisted System Events before Agent intake", async () => {
    expect(() =>
      BoundedContext.singleTenant("NoAi").persistSystemEvents().add(repository()).build(),
    ).toThrow(/AI registry/);
    expect(() =>
      BoundedContext.singleTenant("NoAudit").withAi(ai()).add(repository()).build(),
    ).toThrow(/persisted System Events/);
    const context = BoundedContext.singleTenant("Ready")
      .withAi(ai())
      .persistSystemEvents()
      .add(repository())
      .build();
    await context.close();
  });

  it("rejects absent Agent code revision or repository capabilities", () => {
    const withoutCode = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      ai: { models: [] },
    });
    expect(() =>
      BoundedContext.singleTenant("NoCode")
        .withAi(ai())
        .persistSystemEvents()
        .add(withoutCode)
        .build(),
    ).toThrow(/code revision/);
    const withoutCapabilities = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      agentCodeRevision: "support-agent-v1",
    });
    expect(() =>
      BoundedContext.singleTenant("NoCapabilities")
        .withAi(ai())
        .persistSystemEvents()
        .add(withoutCapabilities)
        .build(),
    ).toThrow(/capabilities/);
  });

  it("accepts a factory-created typed capability on an Agent repository", async () => {
    const configured = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      agentCodeRevision: "support-agent-v1",
      ai: { models: [proposal] },
    });
    const context = BoundedContext.singleTenant("WithModel")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    await context.close();
  });

  it("rejects raw dispatchers matching declared Agent outputs before intake", async () => {
    const eventAgent = new Repository({
      entityType: EmittingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      agentCodeRevision: "raw-event-v1",
      ai: { models: [] },
      handlers: HandlerMetadataValues.defineArity(
        EmittingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
        [
          {
            kind: "command-assignment",
            methodName: "draft",
            parameterCount: 1,
            origin: "domestic",
            outcomes: { returned: [SupportReplyDraftedSchema], thrown: [] },
          },
        ],
      ),
      events: [SupportReplyDraftedSchema],
    });
    expect(() =>
      BoundedContext.singleTenant("RawAgentEvent")
        .withAi(ai())
        .persistSystemEvents()
        .add(eventAgent)
        .addEventDispatcher({
          messageSchemas: () => [SupportReplyDraftedSchema],
          dispatch: () => Promise.resolve(),
        })
        .build(),
    ).toThrow(/durable.*dispatcher/i);

    const commandAgent = new Repository({
      entityType: CommandingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      agentCodeRevision: "raw-command-v1",
      ai: { models: [] },
      handlers: HandlerMetadataValues.defineArity(
        CommandingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [builder.command(SupportTicketUpdatedSchema, "onTicketUpdated")],
        [
          {
            kind: "command-reaction",
            methodName: "onTicketUpdated",
            parameterCount: 1,
            origin: "domestic",
            outcomes: { returned: [ReviewSupportReplySchema], thrown: [] },
          },
        ],
      ),
    });
    expect(() =>
      BoundedContext.singleTenant("RawAgentCommand")
        .withAi(ai())
        .persistSystemEvents()
        .add(commandAgent)
        .addCommandDispatcher({
          messageSchemas: () => [ReviewSupportReplySchema],
          dispatch: () => Promise.resolve(),
        })
        .build(),
    ).toThrow(/durable.*dispatcher/i);
    const unrelated = BoundedContext.singleTenant("UnrelatedRawEvent")
      .withAi(ai())
      .persistSystemEvents()
      .add(eventAgent)
      .addEventDispatcher({
        messageSchemas: () => [SupportTicketUpdatedSchema],
        dispatch: () => Promise.resolve(),
      })
      .build();
    await unrelated.close();
  });

  it("admits the stored target before Inbox replay returns and leaves handlers idle", async () => {
    SupportAgent.calls = 0;
    const factory = new RecordingExecutionFactory();
    const handlers = EntityHandlers.define(
      SupportAgent,
      SupportReplyAgentStateSchema,
      (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
    );
    const configured = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers,
      agentCodeRevision: "support-agent-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("AcceptedSupport")
      .withAi(ai())
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-93" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Delivery?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      if (command.id === undefined) throw new Error("Expected original Command ID.");
      const target = repositoryAccess.entityInboxTarget(configured);
      if (target === undefined) throw new Error("Expected Agent Inbox target.");
      const inbox = {
        ...createMessage("agent-inbox", command.id.uuid, 4_294_967_296n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND" as const,
        status: "TO_DELIVER" as const,
      };
      await target.replay(inbox);
      const page = await factory.pendingPage?.();
      expect(page?.records).toHaveLength(1);
      expect(page?.records[0]?.accepted?.key?.scope?.stateType).toBe(
        SupportReplyAgentStateSchema.typeName,
      );
      expect(page?.records[0]?.accepted?.key?.scope?.agentKey).toEqual(expect.any(String));
      expect(page?.records[0]?.accepted?.key?.sourceSignal?.id).toEqual({
        case: "command",
        value: command.id,
      });
      expect(page?.records[0]?.accepted?.recipientId).toEqual(inbox.inboxId.targetId);
      expect(page?.records[0]?.accepted?.order?.inboxVersion).toBe(4_294_967_296n);
      expect(SupportAgent.calls).toBe(0);
      factory.failAdmission = true;
      await expect(
        target.replay({ ...inbox, id: { ...inbox.id, value: "agent-inbox-retry" } }),
      ).rejects.toThrow(/provider unavailable/);
    } finally {
      await context.close();
    }
  });

  it("conditionally completes a claimed no-op Agent Command exactly once", async () => {
    SupportAgent.calls = 0;
    const factory = new RecordingExecutionFactory();
    const configured = new Repository({
      entityType: SupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(SupportAgent, SupportReplyAgentStateSchema, (builder) => [
        builder.assign(DraftSupportReplySchema, "draft"),
      ]),
      agentCodeRevision: "support-agent-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("CompletedSupport")
      .withAi(ai())
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-94" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      const inbox = {
        ...createMessage("agent-noop", command.id?.uuid ?? "", 1n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND" as const,
        status: "TO_DELIVER" as const,
      };
      await repositoryAccess.entityInboxTarget(configured)?.replay(inbox);
      const key = (await factory.pendingPage?.())?.records[0]?.accepted?.key;
      if (key === undefined) throw new Error("Expected accepted Agent invocation.");
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      expect(SupportAgent.calls).toBe(1);
      expect((await factory.readAccepted?.(key))?.status).toBe(4);
      expect((await factory.pendingPage?.())?.records).toEqual([]);
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      expect(SupportAgent.calls).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("commits a changed Agent state with the execution record in one provider transition", async () => {
    const factory = new RecordingExecutionFactory();
    const configured = new Repository({
      entityType: ChangingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: EntityHandlers.define(
        ChangingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
      ),
      agentCodeRevision: "support-agent-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("ChangedSupport")
      .withAi(ai())
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-95" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("agent-change", command.id?.uuid ?? "", 2n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      const key = (await factory.pendingPage?.())?.records[0]?.accepted?.key;
      if (key === undefined) throw new Error("Expected accepted Agent invocation.");
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      const completed = await factory.readAccepted?.(key);
      expect(completed?.status).toBe(4);
      expect(completed?.completion?.initialVersion?.number).toBe(0);
      expect(completed?.completion?.resultingVersion?.number).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("retains and delivers an emitted Event without rerunning its Command handler", async () => {
    EmittingSupportAgent.calls = 0;
    const factory = new RecordingExecutionFactory();
    const configured = new Repository({
      entityType: EmittingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: HandlerMetadataValues.defineArity(
        EmittingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [builder.assign(DraftSupportReplySchema, "draft")],
        [
          {
            kind: "command-assignment",
            methodName: "draft",
            parameterCount: 1,
            origin: "domestic",
            outcomes: { returned: [SupportReplyDraftedSchema], thrown: [] },
          },
        ],
      ),
      events: [SupportReplyDraftedSchema],
      agentCodeRevision: "support-agent-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("EmittingSupport")
      .withAi(ai())
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-96" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("agent-event", command.id?.uuid ?? "", 3n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      const key = (await factory.pendingPage?.())?.records[0]?.accepted?.key;
      if (key === undefined) throw new Error("Expected accepted Agent invocation.");
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      const completed = await factory.readAccepted?.(key);
      expect(EmittingSupportAgent.calls).toBe(1);
      expect(completed?.status).toBe(4);
      expect(completed?.completion?.outgoing).toMatchObject([
        {
          delivered: true,
          signal: {
            case: "event",
            value: { message: { typeUrl: TypeUrls.derive(SupportReplyDraftedSchema) } },
          },
        },
      ]);
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      expect(EmittingSupportAgent.calls).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("retries a saved Event after acknowledgement failure without rerunning its handler", async () => {
    EmittingSupportAgent.calls = 0;
    const factory = new RecordingExecutionFactory();
    factory.failMarkDeliveryOnce = true;
    let seconds = 1_782_979_201n;
    const previousTime = Time.setProvider({
      currentTime: () => create(TimestampSchema, { seconds }),
    });
    const configured = new Repository({
      entityType: EmittingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: HandlerMetadataValues.defineArity(
        EmittingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [
          builder.assign(DraftSupportReplySchema, "draft"),
          builder.react(SupportReplyDraftedSchema, "onDraft"),
        ],
        [
          {
            kind: "command-assignment",
            methodName: "draft",
            parameterCount: 1,
            origin: "domestic",
            outcomes: { returned: [SupportReplyDraftedSchema], thrown: [] },
          },
          {
            kind: "event-reaction",
            methodName: "onDraft",
            parameterCount: 1,
            origin: "domestic",
            outcomes: { returned: [], thrown: [] },
          },
        ],
      ),
      events: [SupportReplyDraftedSchema],
      agentCodeRevision: "support-agent-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("RecoveringSupport")
      .withAi(ai())
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-97" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("agent-recovery", command.id?.uuid ?? "", 4n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      seconds += 1n;
      const key = (await factory.pendingPage?.())?.records[0]?.accepted?.key;
      if (key === undefined) throw new Error("Expected accepted Agent invocation.");
      await expect(repositoryAccess.runAcceptedAgent(configured, undefined, key)).rejects.toThrow(
        /acknowledgement unavailable/,
      );
      const waiting = await factory.readAccepted?.(key);
      expect(waiting?.status).toBe(3);
      const originalId = waiting?.completion?.outgoing[0]?.signal;
      seconds += 31n;
      factory.failMarkDeliveryOnce = true;
      await expect(repositoryAccess.runAcceptedAgent(configured, undefined, key)).rejects.toThrow(
        /acknowledgement unavailable/,
      );
      expect((await factory.readAccepted?.(key))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY,
      );
      seconds += 31n;
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      const completed = await factory.readAccepted?.(key);
      expect(completed?.status).toBe(4);
      expect(completed?.completion?.outgoing[0]?.signal).toEqual(originalId);
      expect(completed?.completion?.outgoing[0]?.delivered).toBe(true);
      expect(EmittingSupportAgent.calls).toBe(1);
      const recipientKey = factory.admittedKeys.find(
        (accepted) => accepted.sourceSignal?.id.case === "event",
      );
      const recipient =
        recipientKey === undefined ? undefined : await factory.readAccepted?.(recipientKey);
      expect(recipient?.accepted?.signal.case).toBe("event");
    } finally {
      await context.close();
      Time.setProvider(previousTime);
    }
  });

  it("retries a saved Command through its original Entity Inbox route", async () => {
    CommandingSupportAgent.calls = 0;
    const factory = new RecordingExecutionFactory();
    factory.failMarkDeliveryOnce = true;
    let seconds = 1_782_979_201n;
    const previousTime = Time.setProvider({
      currentTime: () => create(TimestampSchema, { seconds }),
    });
    const configured = new Repository({
      entityType: CommandingSupportAgent,
      schema: SupportReplyAgentStateSchema,
      handlers: HandlerMetadataValues.defineArity(
        CommandingSupportAgent,
        SupportReplyAgentStateSchema,
        (builder) => [
          builder.command(SupportTicketUpdatedSchema, "onTicketUpdated"),
          builder.assign(ReviewSupportReplySchema, "review"),
        ],
        [
          {
            kind: "command-reaction",
            methodName: "onTicketUpdated",
            parameterCount: 1,
            origin: "domestic",
            outcomes: { returned: [ReviewSupportReplySchema], thrown: [] },
          },
          {
            kind: "command-assignment",
            methodName: "review",
            parameterCount: 1,
            origin: "domestic",
            outcomes: { returned: [], thrown: [] },
          },
        ],
      ),
      agentCodeRevision: "support-command-agent-v1",
      ai: { models: [] },
    });
    const context = BoundedContext.singleTenant("CommandingSupport")
      .withAi(ai())
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(configured)
      .build();
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-command" });
      const event = SignalEnvelopes.event({
        schema: SupportTicketUpdatedSchema,
        message: create(SupportTicketUpdatedSchema, { agent: id, question: "Status?" }),
        context: create(EventContextSchema, {
          producerId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          version: create(VersionSchema, { number: 1 }),
        }),
      });
      await repositoryAccess.entityInboxTarget(configured)?.replay({
        ...createMessage("agent-command-output", event.id?.value ?? "", 5n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(EventSchema, event, { validate: false }),
        label: "REACT_UPON_EVENT",
        status: "TO_DELIVER",
      });
      seconds += 1n;
      const key = factory.admittedKeys[0];
      if (key === undefined) throw new Error("Expected accepted source Event.");
      await expect(repositoryAccess.runAcceptedAgent(configured, undefined, key)).rejects.toThrow(
        /acknowledgement unavailable/,
      );
      const waiting = await factory.readAccepted?.(key);
      expect(waiting?.completion?.outgoing[0]?.signal.case).toBe("command");
      const original = waiting?.completion?.outgoing[0]?.signal;
      seconds += 31n;
      await repositoryAccess.runAcceptedAgent(configured, undefined, key);
      const completed = await factory.readAccepted?.(key);
      expect(completed?.completion?.outgoing[0]?.signal).toEqual(original);
      expect(completed?.completion?.outgoing[0]?.delivered).toBe(true);
      expect(CommandingSupportAgent.calls).toBe(1);
      expect(
        factory.admittedKeys.filter((candidate) => candidate.sourceSignal?.id.case === "command"),
      ).toHaveLength(1);
    } finally {
      await context.close();
      Time.setProvider(previousTime);
    }
  });
});
