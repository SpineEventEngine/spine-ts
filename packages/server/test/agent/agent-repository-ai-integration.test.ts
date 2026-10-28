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

import { create, equals, isMessage } from "@bufbuild/protobuf";
import { rmSync } from "node:fs";
import type { Any } from "@bufbuild/protobuf/wkt";
import { AiModel, AiRegistry, ModelRef, type AiScope } from "@spine-event-engine/ai";
import { createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyPacker, Identifiers, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
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
  CommandIdSchema,
  CommandContextSchema,
  UserIdSchema,
  EventSchema,
  EventContextSchema,
} from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../../src/entity/entity.js";
import { AgentAcceptanceReceipts } from "../../src/agent/agent-acceptance-receipts.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { EnvironmentType } from "../../src/server/environment.js";
import {
  ServerEnvironment,
  ServerEnvironmentLifecycle,
  serverEnvironmentAccess,
} from "../../src/server/server-environment.js";
import { HandlerRegistryIngestor } from "../../src/handler/generated-handler-registry.js";
import type { EntityHandlersMetadata } from "../../src/handler/handler-metadata.js";
import { Repository } from "../../src/repository/repository.js";
import type { RepositoryAiOptions } from "../../src/repository/repository.js";
import {
  observeProducedSignals,
  readAgentHistoryPage,
  readSystemEvents,
} from "../../src/testing/index.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
  ReviewSupportReplySchema,
  type ReviewSupportReply,
} from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import { SupportReplyDraftedSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
import { ServerStartedSchema } from "../../test-fixtures/generated/server-lifecycle/events_pb.js";
import {
  ServerStatusProjection,
  serverStatusRegistry,
} from "../server/generated-server-registry-fixture.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

beforeEach(async () => {
  await ServerEnvironment.instance().completeSetup();
});

afterEach(async () => {
  const environment = ServerEnvironment.instance();
  for (const context of serverEnvironmentAccess.openContexts(environment)) await context.close();
  await ServerEnvironmentLifecycle.resetForTest();
});

async function configureStorage(factory: InMemoryStorageFactory): Promise<void> {
  await ServerEnvironmentLifecycle.resetForTest();
  ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: factory });
  await ServerEnvironment.instance().completeSetup();
}

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
    if (command.question === "Reset selection") {
      this.ai.select(AiModelKind.GENERATION, undefined);
      return;
    }
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

class FollowupAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static gate: { entered: () => void; release: Promise<undefined> } | undefined;

  substitute(command: DraftSupportReply): ReviewSupportReply {
    return create(ReviewSupportReplySchema, { agent: command.agent });
  }

  async review(command: ReviewSupportReply) {
    FollowupAgent.gate?.entered();
    await FollowupAgent.gate?.release;
    this.update((state) => Object.assign(state, { id: this.id, proposedReply: "Reviewed" }));
    return create(SupportReplyDraftedSchema, { agent: command.agent, reply: "Reviewed" });
  }
}

function followupRepository() {
  return new Repository({
    entityType: FollowupAgent,
    schema: SupportReplyAgentStateSchema,
    ai: { models: [] },
    handlers: new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity",
          receiverType: FollowupAgent,
          stateSchema: SupportReplyAgentStateSchema,
          handlers: [
            {
              kind: "command-substitution",
              methodName: "substitute",
              input: { schema: DraftSupportReplySchema, origin: "domestic" },
              outcomes: { returned: [ReviewSupportReplySchema], thrown: [] },
              parameterCount: 1,
            },
            {
              kind: "command-assignment",
              methodName: "review",
              input: { schema: ReviewSupportReplySchema, origin: "domestic" },
              outcomes: { returned: [SupportReplyDraftedSchema], thrown: [] },
              parameterCount: 1,
            },
          ],
        },
      ],
    })[0] as EntityHandlersMetadata<FollowupAgent, typeof SupportReplyAgentStateSchema>,
    events: [SupportReplyDraftedSchema],
  });
}

function draftingRepository(aiOptions: Partial<RepositoryAiOptions> = {}) {
  return new Repository({
    entityType: DraftingAgent,
    schema: SupportReplyAgentStateSchema,
    stateHistory: true,
    ai: { models: [proposal], ...aiOptions },
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

describe("Agent repository source integration", () => {
  it("commits a model reply and retains original Agent/System audit copies", async () => {
    const ref = ModelRef.of("source-support", "v1");
    const response = create(ProposedSupportReplySchema, { replyText: "We can help." });
    const physical = vi.fn(() => response);
    const alternatePhysical = vi.fn(() => response);
    let allowModelUse = true;
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
          authorizeUse: () => allowModelUse,
          connect: (_scope, identity) => ({ model: {}, identity }),
          execute: async (execution) => {
            if (!isMessage(execution.input, SupportTicketFactsSchema))
              throw new TypeError("Expected support ticket facts for drafting.");
            const prepared = create(GenerationRequestSchema, {
              input: AnyPacker.pack(SupportTicketFactsSchema, execution.input),
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
                admittedOutput: AnyPacker.pack(ProposedSupportReplySchema, value),
              }),
            });
            return { ok: true, value };
          },
        }),
      );
    let allowSelection = true;
    const authorizeSelection = vi.fn(() => allowSelection);
    const repository = draftingRepository({ authorizeSelection });
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const context = await BoundedContext.singleTenant("SourceDrafting")
      .withAi(registry)
      .persistSystemEvents()
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
      await context.commandBus().post(failed);
      await vi.waitFor(async () => {
        expect(
          (await readAgentHistoryPage(context, repository, id, { pageSize: 50 })).items.some(
            (entry) =>
              entry.item.case === "systemEvent" &&
              entry.item.value.message?.typeUrl === TypeUrls.derive(AgentAiOperationFailedSchema),
          ),
        ).toBe(true);
      });
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
      await context.commandBus().post(command);
      await vi.waitFor(() => {
        expect(physical).toHaveBeenCalledTimes(1);
      });
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
      const runNext = async (question: string) => {
        const next = SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "support-user" }),
            }),
          }),
        });
        await context.commandBus().post(next);
        return next;
      };
      await runNext("Prefer alternate");
      await vi.waitFor(() => {
        expect(physical).toHaveBeenCalledTimes(2);
      });
      expect(alternatePhysical).not.toHaveBeenCalled();
      expect(
        (await readAgentHistoryPage(context, repository, id, { pageSize: 50 })).items.some(
          (entry) =>
            entry.item.case === "systemEvent" &&
            entry.item.value.message?.typeUrl === TypeUrls.derive(AgentModelSelectionChangedSchema),
        ),
      ).toBe(true);
      await runNext("Inspect history");
      await vi.waitFor(() => {
        expect(alternatePhysical).toHaveBeenCalledTimes(1);
      });
      expect(DraftingAgent.historyCount).toBeGreaterThan(0);
      expect(DraftingAgent.stateHistoryCount).toBe(1);
      expect(
        (await context.stand().readVersioned(SupportReplyAgentStateSchema, id))?.version?.number,
      ).toBe(1);
      await vi.waitFor(() => {
        expect(produced).toHaveLength(3);
      });
      await runNext("Reset selection");
      await vi.waitFor(() => {
        expect(authorizeSelection).toHaveBeenLastCalledWith(
          expect.anything(),
          undefined,
          expect.anything(),
        );
      });
      await vi.waitFor(async () => {
        expect(
          (await readAgentHistoryPage(context, repository, id, { pageSize: 50 })).items.filter(
            (entry) =>
              entry.item.case === "systemEvent" &&
              entry.item.value.message?.typeUrl ===
                TypeUrls.derive(AgentModelSelectionChangedSchema),
          ).length,
        ).toBeGreaterThan(1);
      });
      await runNext("After reset");
      await vi.waitFor(() => {
        expect(physical).toHaveBeenCalledTimes(3);
      });
      await runNext("Prefer alternate");
      await vi.waitFor(() => {
        expect(physical).toHaveBeenCalledTimes(4);
      });
      const selectionChanges = (
        await readAgentHistoryPage(context, repository, id, { pageSize: 50 })
      ).items.filter(
        (entry) =>
          entry.item.case === "systemEvent" &&
          entry.item.value.message?.typeUrl === TypeUrls.derive(AgentModelSelectionChangedSchema),
      ).length;
      allowSelection = false;
      await runNext("Reset selection");
      await vi.waitFor(() => {
        expect(authorizeSelection).toHaveBeenLastCalledWith(
          expect.anything(),
          undefined,
          expect.anything(),
        );
      });
      expect(physical).toHaveBeenCalledTimes(4);
      expect(
        (await readAgentHistoryPage(context, repository, id, { pageSize: 50 })).items.filter(
          (entry) =>
            entry.item.case === "systemEvent" &&
            entry.item.value.message?.typeUrl === TypeUrls.derive(AgentModelSelectionChangedSchema),
        ),
      ).toHaveLength(selectionChanges);
      allowModelUse = false;
      const deniedCommand = await runNext("Model use denied");
      await vi.waitFor(async () => {
        const denied = (await readAgentHistoryPage(context, repository, id, { pageSize: 50 })).items
          .flatMap((entry) => (entry.item.case === "systemEvent" ? [entry.item.value] : []))
          .filter(
            (event) => event.message?.typeUrl === TypeUrls.derive(AgentInvocationTerminatedSchema),
          );
        expect(denied).toHaveLength(1);
        const event = denied[0];
        if (event?.message === undefined || event.id === undefined)
          throw new Error("Expected one typed Agent denial event.");
        const fact = AnyPacker.unpack(event.message, AgentInvocationTerminatedSchema);
        expect(fact.reason).toBe("MODEL_USE_DENIED");
        expect(fact.sourceSignal?.typeUrl).toBe(TypeUrls.derive(DraftSupportReplySchema));
        const sourceId = fact.sourceSignal?.id;
        if (sourceId === undefined) throw new Error("Expected the denied source Command ID.");
        expect(AnyPacker.unpack(sourceId, CommandIdSchema).uuid).toBe(deniedCommand.id?.uuid);
        expect(await readSystemEvents(context, [event.id])).toEqual(denied);
      });
      expect(physical).toHaveBeenCalledTimes(4);
      expect(alternatePhysical).toHaveBeenCalledTimes(1);
      expect(
        (await context.stand().readVersioned(SupportReplyAgentStateSchema, id))?.version?.number,
      ).toBe(1);
    } finally {
      observation.close();
      await context.close();
    }
  }, 20_000);

  it("selects a late registered deployment from the accepted payload without a default or subscriber", async () => {
    const ref = ModelRef.of("late-source-model", "v1");
    const resolved = vi.fn((kind: "generation" | "decision", scope: AiScope, source: Any) => {
      expect(kind).toBe("generation");
      expect(scope.source.typeUrl).toBe(TypeUrls.derive(DraftSupportReplySchema));
      expect(AnyPacker.tryUnpack(source, DraftSupportReplySchema)?.question).toBe("Resume saved");
      return ref;
    });
    const authorized = vi.fn(() => true);
    const physical = vi.fn();
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: {
        operations: 1,
        modelRequests: 1,
        toolCalls: 0,
        recordedReads: 0,
        deadlineMs: 120000,
        totalInputBytes: 4000,
        totalOutputBytes: 4000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
    const repository = draftingRepository({
      resolveModel: resolved,
      authorizeSelection: authorized,
      allowedModels: { generation: [ref] },
    });
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const context = await BoundedContext.singleTenant("LateSourceModel")
      .withAi(registry)
      .persistSystemEvents()
      .add(repository)
      .build();
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "fixture",
          account: "plan",
          endpoint: "memory",
          model: "late-model",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: async (execution) => {
          physical();
          if (!isMessage(execution.input, SupportTicketFactsSchema))
            throw new TypeError("Expected support ticket facts for drafting.");
          const attempt = await execution.control.beginAttempt({
            kind: "generation",
            content: create(GenerationRequestSchema, {
              input: AnyPacker.pack(SupportTicketFactsSchema, execution.input),
              instructions: "Draft a support reply for review.",
              outputSchemaJson: "{}",
              promptJson: "{}",
              digest: create(AiContentDigestSchema, { value: "0".repeat(64) }),
            }),
          });
          if ("kind" in attempt) throw new Error("Unexpected replayed attempt.");
          await execution.control.reserveTransport(attempt.id, 128, 1024);
          const value = create(ProposedSupportReplySchema, { replyText: "Late model worked." });
          await execution.control.finishAttempt({
            ticketId: attempt.id,
            receivedBytes: 64,
            response: create(GenerationResponseSchema, {
              outcome: AiOutcome.ADMITTED,
              rawOutput: JSON.stringify({ replyText: value.replyText }),
              admittedOutput: AnyPacker.pack(ProposedSupportReplySchema, value),
            }),
          });
          return { ok: true, value };
        },
      }),
    );
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-late" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Resume saved" }),
        context: create(CommandContextSchema, { actorContext: create(ActorContextSchema) }),
      });
      await context.commandBus().post(command);
      await vi.waitFor(() => {
        expect(physical).toHaveBeenCalledOnce();
      });
      await vi.waitFor(async () => {
        expect((await context.stand().read(SupportReplyAgentStateSchema, id))?.proposedReply).toBe(
          "Late model worked.",
        );
      });
      expect(resolved).toHaveBeenCalledOnce();
      expect(authorized).toHaveBeenCalledOnce();
    } finally {
      await context.close();
    }
  });

  it("delivers a no-op Agent's outgoing Command to the same Agent", async () => {
    const ai = AiRegistry.create({
      defaultModels: {},
      concurrentOperations: 1,
      queuedOperations: 1,
    });
    const context = await BoundedContext.singleTenant("SelfFollowupCommand")
      .withAi(ai)
      .persistSystemEvents()
      .add(followupRepository())
      .build();
    const outputs: string[] = [];
    const observer = observeProducedSignals(context, {
      onCommand: (command) => outputs.push(command.message?.typeUrl ?? ""),
      onEvent: (event) => outputs.push(event.message?.typeUrl ?? ""),
    });
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-followup" });
      await context.commandBus().post(
        SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question: "Start" }),
          context: create(CommandContextSchema, { actorContext: create(ActorContextSchema) }),
        }),
      );
      await vi.waitFor(async () => {
        expect((await context.stand().read(SupportReplyAgentStateSchema, id))?.proposedReply).toBe(
          "Reviewed",
        );
      });
      expect(outputs).toContain(TypeUrls.derive(ReviewSupportReplySchema));
      expect(outputs).toContain(TypeUrls.derive(SupportReplyDraftedSchema));
    } finally {
      observer.close();
      await context.close();
    }
  }, 15_000);

  it("drains a handed-off same-Agent Command handler before closing", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    FollowupAgent.gate = {
      entered: () => {
        entered.resolve(undefined);
      },
      release: release.promise,
    };
    const ai = AiRegistry.create({
      defaultModels: {},
      concurrentOperations: 1,
      queuedOperations: 1,
    });
    const context = await BoundedContext.singleTenant("SelfFollowupClose")
      .withAi(ai)
      .persistSystemEvents()
      .add(followupRepository())
      .build();
    const siblingRegistry = serverStatusRegistry();
    const sibling = await BoundedContext.singleTenant("SiblingDuringAgentClose")
      .withGeneratedRegistryRoot(siblingRegistry.root)
      .add(ServerStatusProjection)
      .build();
    const siblingHandler = vi.spyOn(ServerStatusProjection.prototype, "onServerStarted");
    const outputs: string[] = [];
    const observer = observeProducedSignals(context, {
      onEvent: (event) => outputs.push(event.message?.typeUrl ?? ""),
    });
    try {
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-close" });
      await context.commandBus().post(
        SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question: "Start" }),
          context: create(CommandContextSchema, { actorContext: create(ActorContextSchema) }),
        }),
      );
      await entered.promise;
      let closed = false;
      const closing = context.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      await sibling.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            producerId: Identifiers.pack("string", "sibling-start"),
          }),
          schema: ServerStartedSchema,
          message: create(ServerStartedSchema, { id: "sibling-start", name: "Sibling" }),
        }),
      );
      await vi.waitFor(() => {
        expect(siblingHandler).toHaveBeenCalledOnce();
      });
      release.resolve(undefined);
      await closing;
      expect(closed).toBe(true);
      expect(outputs).not.toContain(TypeUrls.derive(SupportReplyDraftedSchema));
    } finally {
      observer.close();
      siblingHandler.mockRestore();
      await sibling.close();
      rmSync(siblingRegistry.directory, { recursive: true, force: true });
      release.resolve(undefined);
      FollowupAgent.gate = undefined;
      await context.close();
    }
  }, 15_000);

  it("keeps accepted receipt evidence but starts no Agent effects after context close", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-receipt-gap" });
    const context = await BoundedContext.singleTenant("ReceiptCloseGap")
      .withAi(AiRegistry.create({ defaultModels: {} }))
      .persistSystemEvents()
      .add(followupRepository())
      .build();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const original = Object.getOwnPropertyDescriptor(AgentAcceptanceReceipts.prototype, "accept")
      ?.value as AgentAcceptanceReceipts["accept"];
    let accepted = false;
    const spy = vi
      .spyOn(AgentAcceptanceReceipts.prototype, "accept")
      .mockImplementation(async function (this: AgentAcceptanceReceipts, ...args) {
        entered.resolve(undefined);
        await release.promise;
        accepted = await original.apply(this, args);
        return accepted;
      });
    const output: string[] = [];
    const observer = observeProducedSignals(context, {
      onEvent: (event) => {
        output.push(event.message?.typeUrl ?? "");
      },
    });
    try {
      const posted = context.commandBus().post(
        SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question: "Close gap" }),
          context: create(CommandContextSchema, { actorContext: create(ActorContextSchema) }),
        }),
      );
      await entered.promise;
      const closing = context.close();
      release.resolve(undefined);
      await Promise.allSettled([posted, closing]);
      expect(accepted).toBe(true);
      expect(output).toEqual([]);
      const reopened = await BoundedContext.singleTenant("ReceiptCloseGap")
        .withAi(AiRegistry.create({ defaultModels: {} }))
        .persistSystemEvents()
        .add(followupRepository())
        .build();
      try {
        expect(await reopened.stand().read(SupportReplyAgentStateSchema, id)).toBeUndefined();
      } finally {
        await reopened.close();
      }
    } finally {
      release.resolve(undefined);
      spy.mockRestore();
      observer.close();
      await context.close();
    }
  });
});
