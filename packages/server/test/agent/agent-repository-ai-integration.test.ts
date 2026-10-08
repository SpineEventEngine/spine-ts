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

import { clone, create, equals, isMessage } from "@bufbuild/protobuf";
import { AiModel, AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyMessages, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  AgentAiResultAdmittedSchema,
  AgentAiOperationFailedSchema,
  AgentModelSelectionChangedSchema,
  AgentInvocationTerminatedSchema,
  AiContentDigestSchema,
  AiModelKind,
  AiOutcome,
  ConversationIdSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
} from "@spine-event-engine/proto/agent";
import {
  ActorContextSchema,
  CommandContextSchema,
  UserIdSchema,
  EventSchema,
  CommandSchema,
} from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type {
  AgentExecutionStorage,
  AgentExecutionStorageInput,
} from "@spine-event-engine/storage/provider";
import {
  AgentAcceptedInvocationSchema,
  AgentCodeRevisionSchema,
  AgentInvocationStatus,
  type AgentExecutionRecord,
  type AgentInvocationKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { Message } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { Agent } from "../../src/entity/entity.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { HandlerRegistryIngestor } from "../../src/handler/generated-handler-registry.js";
import type { EntityHandlersMetadata } from "../../src/handler/handler-metadata.js";
import { Repository, repositoryAccess } from "../../src/repository/repository.js";
import {
  observeProducedSignals,
  readAgentHistoryPage,
  readSystemEvents,
} from "../../src/testing/index.js";
import { createMessage } from "../delivery/inbox-message-fixture.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
} from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import { SupportReplyDraftedSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const proposal = AiModel.define({
  name: "draft-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply for review.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 2_000,
    maxInputBytes: 4_000,
    maxOutputBytes: 4_000,
    maxOutputTokens: 100,
  },
});
const alternateRef = ModelRef.of("source-support-alternate", "v1");

class DraftingAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static historyCount = 0;
  static stateHistoryCount = 0;

  async draft(command: DraftSupportReply) {
    if (command.question === "Prefer alternate")
      this.ai.select(AiModelKind.GENERATION, alternateRef);
    if (command.question === "Inspect history") {
      const page = await this.fullHistory({ pageSize: 2 });
      DraftingAgent.historyCount = page.items.length;
      DraftingAgent.stateHistoryCount = (await this.stateHistoryBackward(2)).length;
    }
    const result = await this.ai.invoke(proposal, {
      call: "draft",
      conversation: create(ConversationIdSchema, { value: "support-draft" }),
      input: create(SupportTicketFactsSchema, {
        ticketNumber: create(SupportTicketNumberSchema, {
          value: command.agent?.ticketNumber ?? "",
        }),
        customerQuestion: command.question,
      }),
    });
    if (!result.ok) return;
    this.update((state) =>
      Object.assign(state, {
        id: this.id,
        proposedReply: result.value.replyText,
      }),
    );
    return create(SupportReplyDraftedSchema, {
      agent: this.id,
      reply: result.value.replyText,
    });
  }
}

function draftingRepository() {
  return new Repository({
    entityType: DraftingAgent,
    schema: SupportReplyAgentStateSchema,
    agentCodeRevision: "source-drafting-v1",
    stateHistory: true,
    ai: { models: [proposal] },
    handlers: new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity",
          receiverType: DraftingAgent,
          stateSchema: SupportReplyAgentStateSchema,
          handlers: [
            {
              kind: "command-assignment",
              methodName: "draft",
              input: { schema: DraftSupportReplySchema, origin: "domestic" },
              outcomes: { returned: [SupportReplyDraftedSchema], thrown: [] },
              parameterCount: 1,
            },
          ],
        },
      ],
    })[0] as EntityHandlersMetadata<DraftingAgent, typeof SupportReplyAgentStateSchema>,
    events: [SupportReplyDraftedSchema],
  });
}

class CapturingExecutionFactory extends InMemoryStorageFactory {
  key?: AgentInvocationKey;
  corruptNextRevision = false;
  readAccepted?: (key: AgentInvocationKey) => Promise<AgentExecutionRecord | undefined>;

  protected override createAgentExecutionStorage<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S> {
    const storage = super.createAgentExecutionStorage(input);
    const admit = storage.admit.bind(storage);
    storage.admit = async (accepted) => {
      const saved = clone(AgentAcceptedInvocationSchema, accepted);
      if (this.corruptNextRevision) {
        this.corruptNextRevision = false;
        saved.codeRevision = create(AgentCodeRevisionSchema, { value: "retired-agent-code" });
      }
      const result = await admit(saved);
      if (accepted.key !== undefined) this.key = accepted.key;
      return result;
    };
    this.readAccepted ??= (key) => storage.read(key);
    return storage;
  }
}

describe("Agent repository source integration", () => {
  it("commits a model reply and retains original Agent/System audit copies", async () => {
    const ref = ModelRef.of("source-support", "v1");
    const response = create(ProposedSupportReplySchema, { replyText: "We can help." });
    const physical = vi.fn(() => response);
    const alternatePhysical = vi.fn(() => response);
    const registry = AiRegistry.create({
      defaultModels: { generation: ref },
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 1,
        deadlineMs: 2_000,
        totalInputBytes: 4_000,
        totalOutputBytes: 4_000,
        maxRecoveryBytes: 128_000,
      },
      concurrentOperations: 1,
      queuedOperations: 1,
    });
    for (const selected of [ref, alternateRef])
      registry.register(
        createBackendRegistration({
          ref: selected,
          kind: "generation",
          supports: () => true,
          resolveIdentity: () => ({
            provider: "source-script",
            account: "support",
            endpoint: "local",
            model: selected === ref ? "draft-v1" : "draft-v2",
          }),
          authorizeUse: () => true,
          connect: (_scope, identity) => ({ model: {}, identity }),
          execute: async (execution) => {
            if (!isMessage(execution.input, SupportTicketFactsSchema))
              throw new TypeError("Expected support ticket facts for drafting.");
            const prepared = create(GenerationRequestSchema, {
              input: AnyMessages.pack(SupportTicketFactsSchema, execution.input),
              instructions: "Draft a support reply for review.",
              outputSchemaJson: "{}",
              promptJson: "{}",
              digest: create(AiContentDigestSchema, { value: "0".repeat(64) }),
            });
            const attempt = await execution.control.beginAttempt({
              kind: "generation",
              content: prepared,
            });
            if ("kind" in attempt)
              throw new Error("Fresh execution unexpectedly replayed a result.");
            await execution.control.reserveTransport(attempt.id, 128, 1_024);
            if (execution.input.customerQuestion === "Unavailable") {
              const failure = await execution.control.recordFailure("UNAVAILABLE", true);
              await execution.control.finishAttempt({
                ticketId: attempt.id,
                receivedBytes: 24,
                response: create(GenerationResponseSchema, {
                  outcome: AiOutcome.FAILED,
                  diagnosticId: { value: failure.diagnosticId },
                }),
              });
              return { ok: false, failure };
            }
            const value = selected === ref ? physical() : alternatePhysical();
            await execution.control.finishAttempt({
              ticketId: attempt.id,
              receivedBytes: 64,
              response: create(GenerationResponseSchema, {
                outcome: AiOutcome.ADMITTED,
                rawOutput: JSON.stringify({ replyText: value.replyText }),
                admittedOutput: AnyMessages.pack(ProposedSupportReplySchema, value),
              }),
            });
            return { ok: true, value };
          },
        }),
      );
    const repository = draftingRepository();
    const factory = new CapturingExecutionFactory();
    const context = BoundedContext.singleTenant("SourceDrafting")
      .withAi(registry)
      .persistSystemEvents()
      .withStorageFactory(factory)
      .add(repository)
      .build();
    const produced: string[] = [];
    const observation = observeProducedSignals(context, {
      onEvent: (event) => {
        if (event.message?.typeUrl === TypeUrls.derive(SupportReplyDraftedSchema))
          produced.push(event.id?.value ?? "");
      },
    });
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-source" });
      const failed = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Unavailable" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(repository)?.replay({
        ...createMessage("source-failed-model", failed.id?.uuid ?? "", 1n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, failed, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      if (factory.key === undefined) throw new Error("Expected failed Agent admission.");
      await repositoryAccess.runAcceptedAgent(repository, undefined, factory.key);
      expect(await context.stand().read(SupportReplyAgentStateSchema, id)).toBeUndefined();
      expect(produced).toEqual([]);
      expect(
        (await readAgentHistoryPage(context, repository, id, { pageSize: 50 })).items.some(
          (entry) =>
            entry.item.case === "systemEvent" &&
            entry.item.value.message?.typeUrl === TypeUrls.derive(AgentAiOperationFailedSchema),
        ),
      ).toBe(true);
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Can you help?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await repositoryAccess.entityInboxTarget(repository)?.replay({
        ...createMessage("source-model", command.id?.uuid ?? "", 2n),
        inboxId: {
          targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
          targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
        },
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      });
      await repositoryAccess.runAcceptedAgent(repository, undefined, factory.key);
      expect(physical).toHaveBeenCalledTimes(1);
      await vi.waitFor(
        async () => {
          expect(
            (await context.stand().read(SupportReplyAgentStateSchema, id))?.proposedReply,
          ).toBe("We can help.");
        },
        { timeout: 10_000 },
      );
      await vi.waitFor(
        () => {
          expect(produced).toHaveLength(1);
        },
        { timeout: 10_000 },
      );
      expect(physical).toHaveBeenCalledTimes(1);
      const history = await readAgentHistoryPage(context, repository, id, { pageSize: 50 });
      const system = history.items.flatMap((entry) =>
        entry.item.case === "systemEvent" ? [entry.item.value] : [],
      );
      expect(system.length).toBeGreaterThanOrEqual(4);
      expect(
        system.some(
          (event) => event.message?.typeUrl === TypeUrls.derive(AgentAiResultAdmittedSchema),
        ),
      ).toBe(true);
      const ids = system.map((event) => {
        if (event.id === undefined) throw new Error("Agent System audit Event has no ID.");
        return event.id;
      });
      expect(ids).toHaveLength(system.length);
      await vi.waitFor(
        async () => {
          const persisted = await readSystemEvents(context, ids);
          expect(persisted).toHaveLength(ids.length);
          expect(
            persisted.every((event, index) => {
              const original = system[index];
              return original !== undefined && equals(EventSchema, event, original);
            }),
          ).toBe(true);
        },
        { timeout: 10_000 },
      );
      const runNext = async (question: string, suffix: string, version: bigint) => {
        const next = SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "support-user" }),
            }),
          }),
        });
        await repositoryAccess.entityInboxTarget(repository)?.replay({
          ...createMessage(suffix, next.id?.uuid ?? "", version),
          inboxId: {
            targetId: AnyMessages.pack(SupportReplyAgentIdSchema, id),
            targetTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
          },
          signal: AnyMessages.pack(CommandSchema, next, { validate: false }),
          label: "HANDLE_COMMAND",
          status: "TO_DELIVER",
        });
        const key = factory.key;
        if (key === undefined) throw new Error("Expected durable Agent admission.");
        await repositoryAccess.runAcceptedAgent(repository, undefined, key);
        return key;
      };
      await runNext("Prefer alternate", "source-select", 3n);
      expect(physical).toHaveBeenCalledTimes(2);
      expect(alternatePhysical).not.toHaveBeenCalled();
      expect(
        (await readAgentHistoryPage(context, repository, id, { pageSize: 50 })).items.some(
          (entry) =>
            entry.item.case === "systemEvent" &&
            entry.item.value.message?.typeUrl === TypeUrls.derive(AgentModelSelectionChangedSchema),
        ),
      ).toBe(true);
      await runNext("Inspect history", "source-history", 4n);
      expect(alternatePhysical).toHaveBeenCalledTimes(1);
      expect(DraftingAgent.historyCount).toBeGreaterThan(0);
      expect(DraftingAgent.stateHistoryCount).toBe(1);
      expect(
        (await context.stand().readVersioned(SupportReplyAgentStateSchema, id))?.version?.number,
      ).toBe(1);
      await vi.waitFor(() => {
        expect(produced).toHaveLength(3);
      });
      factory.corruptNextRevision = true;
      const outdated = await runNext("Outdated source", "source-outdated", 5n);
      expect((await factory.readAccepted?.(outdated))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_TERMINATED,
      );
      expect(physical).toHaveBeenCalledTimes(2);
      expect(alternatePhysical).toHaveBeenCalledTimes(1);
      const terminated = (
        await readAgentHistoryPage(context, repository, id, { pageSize: 50 })
      ).items.flatMap((entry) =>
        entry.item.case === "systemEvent" &&
        entry.item.value.message?.typeUrl === TypeUrls.derive(AgentInvocationTerminatedSchema)
          ? [entry.item.value]
          : [],
      );
      expect(terminated).toHaveLength(1);
      const terminatedMessage = terminated[0]?.message;
      if (terminatedMessage === undefined) throw new Error("Expected termination payload.");
      expect(AnyMessages.unpack(terminatedMessage, AgentInvocationTerminatedSchema)?.reason).toBe(
        "REVISION_CHANGED",
      );
      await runNext("Continue after revision failure", "source-after-outdated", 6n);
      expect(alternatePhysical).toHaveBeenCalledTimes(2);
    } finally {
      observation.close();
      await context.close();
    }
  }, 20_000);
});
