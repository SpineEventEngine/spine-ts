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

import { clone, create, isMessage, type Message } from "@bufbuild/protobuf";
import { AiModel, AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import {
  AnyPacker,
  RejectionThrowable,
  SignalEnvelopes,
  Time,
  TypeUrls,
} from "@spine-event-engine/core";
import {
  ActorContextSchema,
  BoundedContextNameSchema,
  CommandContextSchema,
  CommandSchema,
  EventContextSchema,
  InternetDomainSchema,
  TenantIdSchema,
  UserIdSchema,
  type Command,
  type EventContext,
} from "@spine-event-engine/proto";
import {
  AiContentDigestSchema,
  AiModelKind,
  AgentIdSchema,
  AiOperationIdSchema,
  AiOutcome,
  CallModelSchema,
  ConversationIdSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
  ModelRepliedSchema,
  ModelCallFailedSchema,
  ModelCallSchema,
  type ModelReplied,
  type ModelCallFailed,
  type AiOperationId,
} from "@spine-event-engine/proto/agent";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type {
  AgentHistoryStorage,
  AgentHistoryStorageInput,
  EntityCommitStorage,
  EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import { Agent } from "../../src/entity/entity.js";
import { Application } from "../../src/server/application.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { HandlerRegistryIngestor } from "../../src/handler/generated-handler-registry.js";
import { Repository } from "../../src/repository/repository.js";
import { SignalPublisher } from "../../src/runtime/signal-publisher.js";
import { observeProducedSignals, readAgentHistoryPage } from "../../src/testing/index.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  SupportReplyReviewAgentStateSchema,
  type SupportReplyAgentId,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  InspectSupportReplyDraftSchema,
  CancelSupportReplyDraftSchema,
  PreferSupportReplyModelSchema,
  type DraftSupportReply,
  type InspectSupportReplyDraft,
  type CancelSupportReplyDraft,
  type PreferSupportReplyModel,
} from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  SupportReplyDraftInspectedSchema,
  SupportReplyDraftCancelledSchema,
  SupportReplyModelPreferredSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
// prettier-ignore
import {
  SupportReplyUnavailableSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_rejections_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const proposal = AiModel.define({
  name: "async-support-proposal",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply.",
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

class ModelCommandAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static replies = 0;

  static pendingAtReply: {
    readonly incoming: string;
    readonly ids: readonly string[];
    readonly detached: boolean;
  }[] = [];

  static replyAttempts = 0;

  static failReply = false;

  static chainOnReply = false;

  static chained = false;

  static replyGate: Promise<void> | undefined;

  static failures = 0;

  static mutateReturned = false;

  static rejectedCommand: Command | undefined;

  static abandonedCallId: AiOperationId | undefined;

  static rejectCancel = false;

  static gate: { readonly entered: () => void; readonly release: Promise<void> } | undefined;

  async draft(command: DraftSupportReply) {
    ModelCommandAgent.gate?.entered();
    await ModelCommandAgent.gate?.release;
    const request = this.modelCommands.create(proposal, {
      conversation: create(ConversationIdSchema, { value: "support-draft" }),
      input: create(SupportTicketFactsSchema, {
        ticketNumber: create(SupportTicketNumberSchema, {
          value: command.agent?.ticketNumber ?? "",
        }),
        customerQuestion: command.question,
      }),
    });
    if (ModelCommandAgent.mutateReturned) request.model = ModelRef.of("different-deployment", "v1");
    return request;
  }

  inspect(command: InspectSupportReplyDraft) {
    this.modelCommands.create(proposal, {
      conversation: create(ConversationIdSchema, { value: "discarded" }),
      input: create(SupportTicketFactsSchema, {
        ticketNumber: create(SupportTicketNumberSchema, {
          value: command.agent?.ticketNumber ?? "",
        }),
        customerQuestion: "Inspect the existing draft",
      }),
    });
    return create(SupportReplyDraftInspectedSchema, { agent: command.agent });
  }

  cancel(command: CancelSupportReplyDraft) {
    const callId = ModelCommandAgent.abandonedCallId;
    if (callId === undefined) throw new Error("Missing pending call ID.");
    this.modelCommands.abandon(callId);
    if (ModelCommandAgent.rejectCancel)
      throw RejectionThrowable.create(SupportReplyUnavailableSchema, { agent: this.id });
    return create(SupportReplyDraftCancelledSchema, { agent: command.agent });
  }

  prefer(command: PreferSupportReplyModel) {
    this.ai.select(AiModelKind.GENERATION, ModelRef.of("model-command-alternate", "v1"));
    return create(SupportReplyModelPreferredSchema, { agent: command.agent });
  }

  async replied(event: ModelReplied) {
    ModelCommandAgent.replyAttempts++;
    const pending = this.pendingModelCalls;
    const ids = pending.map((call) => call.id?.value ?? "");
    const first = pending[0];
    if (first?.id !== undefined) first.id.value = "mutated-detached-copy";
    ModelCommandAgent.pendingAtReply.push({
      incoming: event.call?.id?.value ?? "",
      ids,
      detached: this.pendingModelCalls[0]?.id?.value === ids[0],
    });
    if (ModelCommandAgent.failReply) throw new Error("injected reply handler failure");
    if (ModelCommandAgent.chainOnReply && !ModelCommandAgent.chained) {
      ModelCommandAgent.chained = true;
      await ModelCommandAgent.replyGate;
      const callId = event.call?.id;
      if (callId === undefined) throw new Error("Reply omitted its model call ID.");
      const original = await this.modelCallHistory(callId);
      if (original?.source.case !== "command") throw new Error("Original request was not found.");
      return this.modelCommands.create(proposal, {
        conversation: create(ConversationIdSchema, { value: "support-follow-up" }),
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: this.id.ticketNumber }),
          customerQuestion: `Follow-up after ${original.source.value.id?.uuid ?? "unknown"}`,
        }),
      });
    }
    const answer = event.output && AnyPacker.tryUnpack(event.output, ProposedSupportReplySchema);
    if (answer === undefined) throw new Error("Model reply output is missing.");
    this.update((state) => Object.assign(state, { id: this.id, proposedReply: answer.replyText }));
    ModelCommandAgent.replies++;
    return undefined;
  }

  failed(_failure: ModelCallFailed, context: EventContext): void {
    ModelCommandAgent.failures++;
    ModelCommandAgent.rejectedCommand = context.rejection?.command;
  }
}

function replyingRegistry(
  replyText: string | ((question: string) => string),
  beforeExecute?: (question: string) => Promise<void>,
) {
  const ref = ModelRef.of("model-command-test", "v1");
  const registry = AiRegistry.create({ defaultModels: { generation: ref } });
  registry.register(
    createBackendRegistration({
      ref,
      kind: "generation",
      supports: () => true,
      resolveIdentity: () => ({
        provider: "test",
        account: "support",
        endpoint: "local",
        model: "v1",
      }),
      authorizeUse: () => true,
      connect: (_scope, identity) => ({ model: {}, identity }),
      execute: async (execution) => {
        if (!isMessage(execution.input, SupportTicketFactsSchema))
          throw new TypeError("Support model received a different input type.");
        const question = execution.input.customerQuestion;
        await beforeExecute?.(question);
        const answer = typeof replyText === "string" ? replyText : replyText(question);
        const attempt = await execution.control.beginAttempt({
          kind: "generation",
          content: create(GenerationRequestSchema, {
            input: AnyPacker.pack(SupportTicketFactsSchema, execution.input),
            instructions: "Draft a support reply.",
            outputSchemaJson: "{}",
            promptJson: "{}",
            digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
          }),
        });
        await execution.control.reserveTransport(attempt.id, 40, 80);
        const value = create(ProposedSupportReplySchema, { replyText: answer });
        await execution.control.finishAttempt({
          ticketId: attempt.id,
          receivedBytes: 32,
          response: create(GenerationResponseSchema, {
            outcome: AiOutcome.ADMITTED,
            rawOutput: JSON.stringify({ replyText: answer }),
            admittedOutput: AnyPacker.pack(ProposedSupportReplySchema, value),
          }),
        });
        return { ok: true as const, value };
      },
    }),
  );
  return registry;
}

function preparedModelCommand(
  agentId: SupportReplyAgentId,
  callId: string,
  replyContext: string,
  input = AnyPacker.pack(
    SupportTicketFactsSchema,
    create(SupportTicketFactsSchema, {
      ticketNumber: create(SupportTicketNumberSchema, { value: agentId.ticketNumber }),
      customerQuestion: "A scoped request",
    }),
  ),
) {
  return SignalEnvelopes.command({
    schema: CallModelSchema,
    message: create(CallModelSchema, {
      call: create(ModelCallSchema, {
        id: create(AiOperationIdSchema, { value: callId }),
        replyContext: create(BoundedContextNameSchema, { value: replyContext }),
        agent: create(AgentIdSchema, {
          stateTypeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
          entityId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        }),
        capability: { value: proposal.definition.name },
        capabilityRevision: { value: proposal.definition.version },
        conversation: create(ConversationIdSchema, { value: "scoped" }),
        whenRequested: Time.currentTime(),
      }),
      model: ModelRef.of("model-command-test", "v1"),
      input,
    }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "support-user" }),
      }),
    }),
  });
}

class ObservedMemoryFactory extends InMemoryStorageFactory {
  commitStorage: EntityCommitStorage | undefined;

  protected override createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const storage = super.createEntityCommitStorage(input);
    this.commitStorage = storage;
    return storage;
  }
}

function modelRepository(
  chainOnReply = false,
  unmatchedReply = false,
  noReplyHandler = false,
  models: readonly (typeof proposal)[] = [proposal],
) {
  return new Repository({
    entityType: ModelCommandAgent,
    schema: SupportReplyAgentStateSchema,
    ai: { models },
    handlers: new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity",
          receiverType: ModelCommandAgent,
          stateSchema: SupportReplyAgentStateSchema,
          handlers: [
            {
              kind: "command-substitution",
              methodName: "draft",
              input: { schema: DraftSupportReplySchema, origin: "domestic" },
              outcomes: { returned: [CallModelSchema], thrown: [] },
              parameterCount: 1,
            },
            {
              kind: "command-assignment",
              methodName: "inspect",
              input: { schema: InspectSupportReplyDraftSchema, origin: "domestic" },
              outcomes: { returned: [SupportReplyDraftInspectedSchema], thrown: [] },
              parameterCount: 1,
            },
            {
              kind: "command-assignment",
              methodName: "cancel",
              input: { schema: CancelSupportReplyDraftSchema, origin: "domestic" },
              outcomes: {
                returned: [SupportReplyDraftCancelledSchema],
                thrown: [SupportReplyUnavailableSchema],
              },
              parameterCount: 1,
            },
            {
              kind: "command-assignment",
              methodName: "prefer",
              input: { schema: PreferSupportReplyModelSchema, origin: "domestic" },
              outcomes: { returned: [SupportReplyModelPreferredSchema], thrown: [] },
              parameterCount: 1,
            },
            ...(noReplyHandler
              ? []
              : [
                  {
                    kind: chainOnReply ? "command-reaction" : "event-reaction",
                    methodName: "replied",
                    input: {
                      schema: ModelRepliedSchema,
                      origin: "domestic" as const,
                      ...(unmatchedReply
                        ? { where: { eventField: "call.conversation.value", equals: "never" } }
                        : {}),
                    },
                    outcomes: { returned: chainOnReply ? [CallModelSchema] : [], thrown: [] },
                    parameterCount: 1,
                  },
                ]),
            {
              kind: "event-reaction",
              methodName: "failed",
              input: { schema: ModelCallFailedSchema, origin: "domestic" },
              outcomes: { returned: [], thrown: [] },
              parameterCount: 2,
            },
          ],
        },
      ],
    })[0] as never,
  });
}

describe("Agent model Commands", () => {
  it("rejects ambiguous model definitions for one Agent state and revision", async () => {
    const competing = AiModel.define({
      name: proposal.definition.name,
      version: proposal.definition.version,
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Use a different support reply policy.",
      outputMode: "prompt-and-validate",
      limits: proposal.definition.limits,
    });
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("AmbiguousModelDefinition")
          .withAi(replyingRegistry("Unused backend"))
          .persistSystemEvents()
          .add(modelRepository(false, false, false, [proposal, competing])),
      );
    await expect(application.build()).rejects.toThrow(/duplicate.*model|ambiguous.*model/i);
    const revised = AiModel.define({
      name: proposal.definition.name,
      version: "v2",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Use the revised support reply policy.",
      outputMode: "prompt-and-validate",
      limits: proposal.definition.limits,
    });
    const distinct = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("DistinctModelRevision")
          .withAi(replyingRegistry("Unused backend"))
          .persistSystemEvents()
          .add(modelRepository(false, false, false, [proposal, revised])),
      )
      .build();
    await distinct.close();
  });

  it("routes model outcomes only to their trusted Bounded Context, tenant, and Agent state", async () => {
    ModelCommandAgent.replies = 0;
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelOutcomeRouting")
          .withAi(replyingRegistry("Unused backend"))
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-outcome-route" });
    const prepared = preparedModelCommand(id, "route-call", "ModelOutcomeRouting");
    const payload = prepared.message && AnyPacker.tryUnpack(prepared.message, CallModelSchema);
    if (payload?.call === undefined) throw new Error("Missing prepared model call.");
    const eventFor = (call: typeof payload.call) =>
      SignalEnvelopes.event({
        schema: ModelRepliedSchema,
        message: create(ModelRepliedSchema, {
          call,
          output: AnyPacker.pack(
            ProposedSupportReplySchema,
            create(ProposedSupportReplySchema, { replyText: "Trusted reply" }),
          ),
          whenStarted: Time.currentTime(),
          whenCompleted: Time.currentTime(),
        }),
        context: create(EventContextSchema, {
          producerId: AnyPacker.pack(SupportReplyAgentIdSchema, id),
        }),
      });
    try {
      const foreignContext = clone(ModelCallSchema, payload.call);
      foreignContext.replyContext = create(BoundedContextNameSchema, { value: "AnotherContext" });
      await expect(context.eventBus().post(eventFor(foreignContext))).rejects.toThrow(
        "reply Bounded Context differs",
      );
      const foreignTenant = clone(ModelCallSchema, payload.call);
      foreignTenant.tenant = create(TenantIdSchema, {
        kind: { case: "domain", value: create(InternetDomainSchema, { value: "foreign.test" }) },
      });
      await expect(context.eventBus().post(eventFor(foreignTenant))).rejects.toThrow(
        "tenant differs from trusted Event metadata",
      );
      const foreignState = clone(ModelCallSchema, payload.call);
      if (foreignState.agent === undefined) throw new Error("Missing Agent destination.");
      foreignState.agent.stateTypeUrl = TypeUrls.derive(SupportReplyReviewAgentStateSchema);
      await context.eventBus().post(eventFor(foreignState));
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      expect(ModelCommandAgent.replies).toBe(0);
      await context.eventBus().post(eventFor(payload.call));
      await vi.waitFor(() => {
        expect(ModelCommandAgent.replies).toBe(1);
      });
      expect((await context.stand().read(SupportReplyAgentStateSchema, id))?.proposedReply).toBe(
        "Trusted reply",
      );
    } finally {
      await application.close();
    }
  });

  it("rejects foreign Bounded Context, tenant, and Agent state destinations", async () => {
    const invoked = vi.fn();
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelTrustedAdmission")
          .withAi(
            replyingRegistry("Must not run", () => {
              invoked();
              return Promise.resolve(undefined);
            }),
          )
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-trusted" });
    try {
      const foreignContext = preparedModelCommand(id, "foreign-context", "AnotherContext");
      await expect(context.commandBus().post(foreignContext)).rejects.toThrow(
        "reply Bounded Context differs",
      );
      const foreignTenant = preparedModelCommand(id, "foreign-tenant", "ModelTrustedAdmission");
      const tenantPayload =
        foreignTenant.message && AnyPacker.tryUnpack(foreignTenant.message, CallModelSchema);
      if (tenantPayload?.call === undefined) throw new Error("Missing prepared tenant call.");
      tenantPayload.call.tenant = create(TenantIdSchema, {
        kind: { case: "domain", value: create(InternetDomainSchema, { value: "foreign.test" }) },
      });
      foreignTenant.message = AnyPacker.pack(CallModelSchema, tenantPayload);
      await expect(context.commandBus().post(foreignTenant)).rejects.toThrow(
        "tenant differs from trusted Command actor metadata",
      );
      const foreignState = preparedModelCommand(id, "foreign-state", "ModelTrustedAdmission");
      const statePayload =
        foreignState.message && AnyPacker.tryUnpack(foreignState.message, CallModelSchema);
      if (statePayload?.call?.agent === undefined) throw new Error("Missing prepared Agent ID.");
      statePayload.call.agent.stateTypeUrl = TypeUrls.derive(SupportReplyReviewAgentStateSchema);
      foreignState.message = AnyPacker.pack(CallModelSchema, statePayload);
      await expect(context.commandBus().post(foreignState)).rejects.toThrow(
        "Agent state type is not registered here",
      );
      expect(invoked).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("keeps simultaneous calls pending and handles their replies in arrival order", async () => {
    ModelCommandAgent.replies = 0;
    ModelCommandAgent.pendingAtReply = [];
    const firstEntered = Promise.withResolvers<undefined>();
    const firstRelease = Promise.withResolvers<undefined>();
    const secondEntered = Promise.withResolvers<undefined>();
    const secondRelease = Promise.withResolvers<undefined>();
    const registry = replyingRegistry(
      (question) => `${question} result`,
      async (question) => {
        if (question === "First question") {
          firstEntered.resolve(undefined);
          await firstRelease.promise;
        } else {
          secondEntered.resolve(undefined);
          await secondRelease.promise;
        }
      },
    );
    const repository = modelRepository();
    const storageFactory = new ObservedMemoryFactory();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelOverlappingCalls")
          .withAi(registry)
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-overlap" });
    const draft = (question: string) =>
      SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
    try {
      await context.commandBus().post(draft("First question"));
      await firstEntered.promise;
      await context.commandBus().post(draft("Second question"));
      await secondEntered.promise;
      const both = (await storageFactory.commitStorage?.readAgentCurrent(id))?.attributes
        ?.pendingModelCalls;
      expect(both).toHaveLength(2);
      const callIds = both?.map((call) => call.id?.value ?? "") ?? [];
      secondRelease.resolve(undefined);
      await vi.waitFor(async () => {
        expect(ModelCommandAgent.pendingAtReply).toHaveLength(1);
        expect(
          (await storageFactory.commitStorage?.readAgentCurrent(id))?.attributes?.pendingModelCalls,
        ).toHaveLength(1);
      });
      expect(ModelCommandAgent.pendingAtReply[0]).toEqual({
        incoming: callIds[1],
        ids: callIds,
        detached: true,
      });
      expect((await context.stand().read(SupportReplyAgentStateSchema, id))?.proposedReply).toBe(
        "Second question result",
      );
      firstRelease.resolve(undefined);
      await vi.waitFor(async () => {
        expect(ModelCommandAgent.pendingAtReply).toHaveLength(2);
        expect(
          (await storageFactory.commitStorage?.readAgentCurrent(id))?.attributes?.pendingModelCalls,
        ).toHaveLength(0);
      });
      expect(ModelCommandAgent.pendingAtReply[1]).toEqual({
        incoming: callIds[0],
        ids: [callIds[0]],
        detached: true,
      });
      expect((await context.stand().read(SupportReplyAgentStateSchema, id))?.proposedReply).toBe(
        "First question result",
      );
      expect(ModelCommandAgent.replies).toBe(2);
    } finally {
      firstRelease.resolve(undefined);
      secondRelease.resolve(undefined);
      await application.close();
    }
  });

  it("executes the pinned deployment after the Agent changes its preference", async () => {
    ModelCommandAgent.replies = 0;
    const primaryUsed = vi.fn();
    const alternateUsed = vi.fn();
    const registry = replyingRegistry("Pinned result", () => {
      primaryUsed();
      return Promise.resolve(undefined);
    });
    const alternate = ModelRef.of("model-command-alternate", "v1");
    registry.register(
      createBackendRegistration({
        ref: alternate,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "alternate",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => {
          alternateUsed();
          return Promise.reject(new Error("Pinned model Command selected the changed preference."));
        },
      }),
    );
    const repository = modelRepository();
    const storageFactory = new ObservedMemoryFactory();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelPinnedDeployment")
          .withAi(registry)
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-pinned" });
    const preference = SignalEnvelopes.command({
      schema: PreferSupportReplyModelSchema,
      message: create(PreferSupportReplyModelSchema, { agent: id }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support-user" }),
        }),
      }),
    });
    try {
      await context.commandBus().post(preference);
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      const current = await storageFactory.commitStorage?.readAgentCurrent(id);
      expect(current?.attributes?.modelPreferences[0]?.selection.value).toEqual(alternate);
      await context
        .commandBus()
        .post(preparedModelCommand(id, "pinned-after-preference", "ModelPinnedDeployment"));
      await vi.waitFor(() => {
        expect(ModelCommandAgent.replies).toBe(1);
      });
      expect(primaryUsed).toHaveBeenCalledOnce();
      expect(alternateUsed).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("rejects a mismatched model input during Command admission", async () => {
    const invoked = vi.fn();
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelInputAdmission")
          .withAi(
            replyingRegistry("Must not run", () => {
              invoked();
              return Promise.resolve(undefined);
            }),
          )
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-input" });
    const command = preparedModelCommand(
      id,
      "input-mismatch",
      "ModelInputAdmission",
      AnyPacker.pack(
        InspectSupportReplyDraftSchema,
        create(InspectSupportReplyDraftSchema, { agent: id }),
      ),
    );
    try {
      await expect(context.commandBus().post(command)).rejects.toThrow(
        "input type differs from its registered definition",
      );
      expect(invoked).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("keeps concurrent equal call IDs isolated by exact Agent identity", async () => {
    ModelCommandAgent.replies = 0;
    const secondEntered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let entered = 0;
    const registry = replyingRegistry("Scoped reply", async () => {
      entered++;
      if (entered === 2) secondEntered.resolve(undefined);
      await release.promise;
    });
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelCollision")
          .withAi(registry)
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const firstId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-collision-A" });
    const secondId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-collision-B" });
    try {
      await Promise.all([
        context.commandBus().post(preparedModelCommand(firstId, "equal-call", "ModelCollision")),
        context.commandBus().post(preparedModelCommand(secondId, "equal-call", "ModelCollision")),
      ]);
      await secondEntered.promise;
      release.resolve(undefined);
      await vi.waitFor(async () => {
        expect(ModelCommandAgent.replies).toBe(2);
        expect(
          (await context.stand().read(SupportReplyAgentStateSchema, firstId))?.proposedReply,
        ).toBe("Scoped reply");
        expect(
          (await context.stand().read(SupportReplyAgentStateSchema, secondId))?.proposedReply,
        ).toBe("Scoped reply");
      });
    } finally {
      release.resolve(undefined);
      await application.close();
    }
  });

  it.each(["filtered", "absent"])(
    "reports a %s model reply without consuming its pending call",
    async (handler) => {
      ModelCommandAgent.replyAttempts = 0;
      const repository = modelRepository(false, handler === "filtered", handler === "absent");
      const reported = vi.spyOn(SignalPublisher.prototype, "reportFailure");
      const storageFactory = new ObservedMemoryFactory();
      const environment = ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (configuration) => {
          configuration.use({ storageFactory });
        })
        .build();
      const application = await Application.newBuilder()
        .setServerEnvironment(environment)
        .add(
          BoundedContext.singleTenant("ModelUnmatchedReply")
            .withAi(replyingRegistry("Unmatched reply"))
            .persistSystemEvents()
            .add(repository),
        )
        .build();
      const [context] = application.contexts();
      if (context === undefined) throw new Error("Expected a Bounded Context.");
      const published = Promise.withResolvers<undefined>();
      const observation = observeProducedSignals(context, {
        onEvent: (event) => {
          if (event.message && AnyPacker.tryUnpack(event.message, ModelRepliedSchema))
            published.resolve(undefined);
        },
      });
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-unmatched" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Can you help?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      try {
        await context.commandBus().post(command);
        await published.promise;
        await serverEnvironmentAccess.whenDeliveryIdle(environment);
        await vi.waitFor(() => {
          expect(
            reported.mock.calls.some(
              ([kind, , error]) =>
                kind === "event" &&
                error instanceof Error &&
                error.message === "Model outcome has no matching Agent handler.",
            ),
          ).toBe(true);
        });
        const current = await storageFactory.commitStorage?.readAgentCurrent(id);
        expect(current?.attributes?.pendingModelCalls).toHaveLength(1);
        expect(ModelCommandAgent.replyAttempts).toBe(0);
        const history = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
        expect(history.items.some((entry) => entry.item.case === "handledOutcome")).toBe(false);
      } finally {
        observation.close();
        reported.mockRestore();
        await application.close();
      }
    },
  );

  it.each(["connection", "authorization"])(
    "delivers ModelCallFailed when backend %s setup fails",
    async (failure) => {
      ModelCommandAgent.failures = 0;
      ModelCommandAgent.rejectedCommand = undefined;
      const ref = ModelRef.of("model-command-test", "v1");
      const registry = AiRegistry.create({ defaultModels: { generation: ref } });
      const executed = vi.fn();
      registry.register(
        createBackendRegistration({
          ref,
          kind: "generation",
          supports: () => true,
          resolveIdentity: () => ({
            provider: "test",
            account: "support",
            endpoint: "local",
            model: "v1",
          }),
          authorizeUse: () => failure !== "authorization",
          connect: () => {
            if (failure === "connection") throw new Error("injected connection setup failure");
            return {
              model: {},
              identity: { provider: "test", account: "support", endpoint: "local", model: "v1" },
            };
          },
          execute: () => {
            executed();
            return Promise.reject(new Error("Setup failure must prevent execution."));
          },
        }),
      );
      const repository = modelRepository();
      const environment = ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (configuration) => {
          configuration.use({ storageFactory: new InMemoryStorageFactory() });
        })
        .build();
      const application = await Application.newBuilder()
        .setServerEnvironment(environment)
        .add(
          BoundedContext.singleTenant("ModelSetupFailure")
            .withAi(registry)
            .persistSystemEvents()
            .add(repository),
        )
        .build();
      const [context] = application.contexts();
      if (context === undefined) throw new Error("Expected a Bounded Context.");
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-setup-failure" });
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Can you help?" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      try {
        await context.commandBus().post(command);
        await vi.waitFor(() => {
          expect(ModelCommandAgent.failures).toBe(1);
        });
        expect(ModelCommandAgent.rejectedCommand).toMatchObject({
          message: { typeUrl: "type.spine.io/spine.agent.CallModel" },
        });
        expect(executed).not.toHaveBeenCalled();
      } finally {
        await application.close();
      }
    },
  );

  it("drains a second model Command returned by an Agent reply during close", async () => {
    const firstEntered = Promise.withResolvers<undefined>();
    const firstRelease = Promise.withResolvers<undefined>();
    const secondEntered = Promise.withResolvers<undefined>();
    const secondRelease = Promise.withResolvers<undefined>();
    const replyRelease = Promise.withResolvers<undefined>();
    ModelCommandAgent.chainOnReply = true;
    ModelCommandAgent.chained = false;
    ModelCommandAgent.replyGate = replyRelease.promise;
    ModelCommandAgent.replies = 0;
    const registry = replyingRegistry("Two-stage proposal", async (question) => {
      if (question.startsWith("Follow-up")) {
        secondEntered.resolve(undefined);
        await secondRelease.promise;
      } else {
        firstEntered.resolve(undefined);
        await firstRelease.promise;
      }
    });
    const repository = modelRepository(true);
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelCloseChain")
          .withAi(registry)
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-close-chain" });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Begin proposal" }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support-user" }),
        }),
      }),
    });
    try {
      await context.commandBus().post(command);
      await firstEntered.promise;
      let closed = false;
      const closing = application.close().then(() => {
        closed = true;
      });
      firstRelease.resolve(undefined);
      replyRelease.resolve(undefined);
      await secondEntered.promise;
      expect(closed).toBe(false);
      secondRelease.resolve(undefined);
      await closing;
      expect(ModelCommandAgent.replies).toBe(1);
    } finally {
      firstRelease.resolve(undefined);
      secondRelease.resolve(undefined);
      replyRelease.resolve(undefined);
      ModelCommandAgent.chainOnReply = false;
      ModelCommandAgent.replyGate = undefined;
      await application.close();
    }
  });

  it("retains a pending call when its reply handler fails", async () => {
    ModelCommandAgent.failReply = true;
    ModelCommandAgent.replyAttempts = 0;
    const repository = modelRepository();
    const storageFactory = new ObservedMemoryFactory();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelReplyFailure")
          .withAi(replyingRegistry("Reply that fails in the Agent"))
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-reply-failure" });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Can you help?" }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support-user" }),
        }),
      }),
    });
    try {
      await context.commandBus().post(command);
      await vi.waitFor(() => {
        expect(ModelCommandAgent.replyAttempts).toBe(1);
      });
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      const current = await storageFactory.commitStorage?.readAgentCurrent(id);
      expect(current?.attributes?.pendingModelCalls).toHaveLength(1);
      const history = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
      expect(history.items.some((entry) => entry.item.case === "modelRequest")).toBe(true);
      expect(history.items.some((entry) => entry.item.case === "handledOutcome")).toBe(false);
    } finally {
      ModelCommandAgent.failReply = false;
      await application.close();
    }
  });

  it("keeps pending calls and omits abandonment when the handler rejects", async () => {
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const publishedRejection = vi.spyOn(SignalPublisher.prototype, "publishRejectionEvent");
    const storageFactory = new ObservedMemoryFactory();
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("RejectedAbandonment")
          .withAi(
            replyingRegistry("Accepted later", async () => {
              started.resolve(undefined);
              await release.promise;
            }),
          )
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-rejected-abandonment" });
    ModelCommandAgent.rejectCancel = true;
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question: "Current facts" }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "support-user" }),
            }),
          }),
        }),
      );
      await started.promise;
      const before = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
      const request = before.items.find((entry) => entry.item.case === "modelRequest");
      if (request?.item.case !== "modelRequest") throw new Error("Saved model request is absent.");
      const payload = request.item.value.request?.message;
      ModelCommandAgent.abandonedCallId =
        payload && AnyPacker.tryUnpack(payload, CallModelSchema)?.call?.id;
      if (ModelCommandAgent.abandonedCallId === undefined)
        throw new Error("Pending call is absent.");
      await context.commandBus().post(
        SignalEnvelopes.command({
          schema: CancelSupportReplyDraftSchema,
          message: create(CancelSupportReplyDraftSchema, { agent: id }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "support-user" }),
            }),
          }),
        }),
      );
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      const current = await storageFactory.commitStorage?.readAgentCurrent(id);
      expect(current?.attributes?.pendingModelCalls).toHaveLength(1);
      const history = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
      expect(history.items.some((entry) => entry.item.case === "abandonment")).toBe(false);
      expect(publishedRejection).toHaveBeenCalledOnce();
      const rejection = publishedRejection.mock.calls[0]?.[0];
      expect(
        rejection?.message && AnyPacker.tryUnpack(rejection.message, SupportReplyUnavailableSchema),
      ).toBeDefined();
      release.resolve(undefined);
      await application.close();
    } finally {
      publishedRejection.mockRestore();
      ModelCommandAgent.rejectCancel = false;
      ModelCommandAgent.abandonedCallId = undefined;
      release.resolve(undefined);
      await application.close();
    }
  });

  it("keeps a committed request without posting when attempt history cannot be appended", async () => {
    const ref = ModelRef.of("model-command-test", "v1");
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    const executed = vi.fn();
    ModelCommandAgent.failures = 0;
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => {
          executed();
          return Promise.reject(new Error("Attempt without history must not be posted."));
        },
      }),
    );
    const failedAppend = vi.fn();
    class FailingAttemptHistory extends InMemoryStorageFactory {
      protected override createAgentHistoryStorage<Id>(
        input: AgentHistoryStorageInput<Id>,
      ): AgentHistoryStorage<Id> {
        const history = super.createAgentHistoryStorage(input);
        const append = history.appendAll.bind(history);
        history.appendAll = async (id, entries) => {
          if (entries.some((entry) => entry.item.case === "submissionAttempt")) {
            failedAppend();
            throw new Error("injected attempt append failure");
          }
          await append(id, entries);
        };
        return history;
      }
    }
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new FailingAttemptHistory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelAttemptFailure")
          .withAi(registry)
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-attempt-failure" });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Can you help?" }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support-user" }),
        }),
      }),
    });
    try {
      await context.commandBus().post(command);
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      const rows = await serverEnvironmentAccess
        .coreDelivery(environment)
        .inbox.read(ShardIndex.single());
      expect(rows.find((row) => row.signalId === command.id?.uuid)?.status).toBe("DELIVERED");
      const history = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
      expect(history.items.some((entry) => entry.item.case === "modelRequest")).toBe(true);
      expect(history.items.some((entry) => entry.item.case === "submissionAttempt")).toBe(false);
      expect(failedAppend).toHaveBeenCalledOnce();
      expect(executed).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("rejects a changed returned CallModel before saving or invoking the provider", async () => {
    const executed = vi.fn();
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ChangedModelCommand")
          .withAi(
            replyingRegistry("Unexpected", () => {
              executed();
              return Promise.resolve();
            }),
          )
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-changed-call" });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Where is my parcel?" }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support-user" }),
        }),
      }),
    });
    ModelCommandAgent.mutateReturned = true;
    try {
      await context.commandBus().post(command);
      await expect(serverEnvironmentAccess.whenDeliveryIdle(environment)).rejects.toThrow(
        "Returned CallModel was not constructed",
      );
      const rows = await serverEnvironmentAccess
        .coreDelivery(environment)
        .inbox.read(ShardIndex.single());
      expect(rows.find((row) => row.signalId === command.id?.uuid)?.status).toBe("TO_DELIVER");
      const history = await readAgentHistoryPage(context, repository, id, { pageSize: 20 });
      expect(history.items.some((entry) => entry.item.case === "modelRequest")).toBe(false);
      expect(executed).not.toHaveBeenCalled();
    } finally {
      ModelCommandAgent.mutateReturned = false;
      await application.close();
    }
  });

  it("does not borrow saved source authorization for a reposted changed Command", async () => {
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const executed = vi.fn();
    const reported = vi.spyOn(SignalPublisher.prototype, "reportFailure");
    ModelCommandAgent.failures = 0;
    ModelCommandAgent.replies = 0;
    const repository = modelRepository();
    const storageFactory = new ObservedMemoryFactory();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("SavedSourceGuard")
          .withAi(
            replyingRegistry("Original reply", async () => {
              executed();
              started.resolve(undefined);
              await release.promise;
            }),
          )
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-saved-source" });
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          schema: DraftSupportReplySchema,
          message: create(DraftSupportReplySchema, { agent: id, question: "Original facts" }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "authorized-user" }),
            }),
          }),
        }),
      );
      await started.promise;
      const page = await readAgentHistoryPage(context, repository, id, { pageSize: 20 });
      const request = page.items.find((entry) => entry.item.case === "modelRequest");
      if (request?.item.case !== "modelRequest" || request.item.value.request === undefined)
        throw new Error("Saved model request was not found.");
      const saved = request.item.value.request;
      const changedInput = clone(CommandSchema, saved);
      const payload =
        changedInput.message && AnyPacker.tryUnpack(changedInput.message, CallModelSchema);
      if (payload === undefined) throw new Error("Saved CallModel was not found.");
      payload.input = AnyPacker.pack(
        SupportTicketFactsSchema,
        create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: id.ticketNumber }),
          customerQuestion: "Altered facts",
        }),
      );
      changedInput.message = AnyPacker.pack(CallModelSchema, payload);
      changedInput.context = create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "other-user" }),
        }),
      });
      await context.commandBus().post(changedInput);
      await vi.waitFor(() => {
        expect(reported).toHaveBeenCalledWith(
          "command",
          expect.objectContaining({ id: changedInput.id }),
          expect.objectContaining({
            message: "Admitted model Command differs from its saved request.",
          }),
        );
      });
      expect(ModelCommandAgent.failures).toBe(0);
      expect(
        (await storageFactory.commitStorage?.readAgentCurrent(id))?.attributes?.pendingModelCalls,
      ).toHaveLength(1);
      release.resolve(undefined);
      await vi.waitFor(() => {
        expect(ModelCommandAgent.replies).toBe(1);
      });
      expect(
        (await storageFactory.commitStorage?.readAgentCurrent(id))?.attributes?.pendingModelCalls,
      ).toHaveLength(0);
      await application.close();
      expect(executed).toHaveBeenCalledOnce();
      expect(ModelCommandAgent.replies).toBe(1);
      expect(ModelCommandAgent.failures).toBe(0);
    } finally {
      release.resolve(undefined);
      await application.close();
      reported.mockRestore();
    }
  });

  it("leaves the input undelivered when its atomic Agent save fails", async () => {
    const ref = ModelRef.of("model-command-test", "v1");
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    const executed = vi.fn();
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => {
          executed();
          return Promise.reject(new Error("Model execution must not start before save."));
        },
      }),
    );
    const repository = modelRepository();
    const failedCommit = vi.fn();
    class FailingAgentSave extends InMemoryStorageFactory {
      protected override createEntityCommitStorage<I, S extends Message>(
        input: EntityStorageInput<I, S>,
      ): EntityCommitStorage {
        const storage = super.createEntityCommitStorage(input);
        storage.commitAgent = () => {
          failedCommit();
          return Promise.reject(new Error("injected atomic save failure"));
        };
        return storage;
      }
    }
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new FailingAgentSave() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelSaveFailure")
          .withAi(registry)
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-save-failure" });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Can you help?" }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support-user" }),
        }),
      }),
    });
    try {
      await context.commandBus().post(command);
      await expect(serverEnvironmentAccess.whenDeliveryIdle(environment)).rejects.toThrow(
        "injected atomic save failure",
      );
      expect(failedCommit).toHaveBeenCalledOnce();
      const inbox = serverEnvironmentAccess.coreDelivery(environment).inbox;
      const rows = await inbox.read(ShardIndex.single());
      expect(rows.find((row) => row.signalId === command.id?.uuid)?.status).toBe("TO_DELIVER");
      const history = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
      expect(history.items.some((entry) => entry.item.case === "modelRequest")).toBe(false);
      expect(history.items.some((entry) => entry.item.case === "submissionAttempt")).toBe(false);
      expect(executed).not.toHaveBeenCalled();
    } finally {
      await application.close();
    }
  });

  it("acknowledges the Agent request while the model remains deferred, then routes its reply", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const handlerEntered = Promise.withResolvers<undefined>();
    const handlerRelease = Promise.withResolvers<undefined>();
    ModelCommandAgent.replies = 0;
    ModelCommandAgent.failures = 0;
    ModelCommandAgent.rejectedCommand = undefined;
    ModelCommandAgent.abandonedCallId = undefined;
    const ref = ModelRef.of("model-command-test", "v1");
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: async (execution) => {
          if (!isMessage(execution.input, SupportTicketFactsSchema))
            throw new TypeError("Support model received a different input type.");
          const attempt = await execution.control.beginAttempt({
            kind: "generation",
            content: create(GenerationRequestSchema, {
              input: AnyPacker.pack(SupportTicketFactsSchema, execution.input),
              instructions: "Draft a support reply.",
              outputSchemaJson: "{}",
              promptJson: "{}",
              digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
            }),
          });
          if (execution.input.customerQuestion === "Unavailable") {
            await execution.control.reserveTransport(attempt.id, 40, 80);
            const failure = await execution.control.recordFailure("UNAVAILABLE", true);
            await execution.control.finishAttempt({
              ticketId: attempt.id,
              receivedBytes: 16,
              response: create(GenerationResponseSchema, { outcome: AiOutcome.FAILED }),
            });
            return { ok: false as const, failure };
          }
          entered.resolve(undefined);
          await release.promise;
          await execution.control.reserveTransport(attempt.id, 40, 80);
          const value = create(ProposedSupportReplySchema, { replyText: "We can help." });
          await execution.control.finishAttempt({
            ticketId: attempt.id,
            receivedBytes: 32,
            response: create(GenerationResponseSchema, {
              outcome: AiOutcome.ADMITTED,
              rawOutput: JSON.stringify({ replyText: value.replyText }),
              admittedOutput: AnyPacker.pack(ProposedSupportReplySchema, value),
            }),
          });
          return { ok: true as const, value };
        },
      }),
    );
    const repository = modelRepository();
    const environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (configuration) => {
        configuration.use({ storageFactory: new InMemoryStorageFactory() });
      })
      .build();
    const application = await Application.newBuilder()
      .setServerEnvironment(environment)
      .add(
        BoundedContext.singleTenant("ModelCommandTest")
          .withAi(registry)
          .persistSystemEvents()
          .add(repository),
      )
      .build();
    const [context] = application.contexts();
    if (context === undefined) throw new Error("Expected a Bounded Context.");
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-async" });
    try {
      const unavailable = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Unavailable" }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await context.commandBus().post(unavailable);
      await vi.waitFor(() => {
        expect(ModelCommandAgent.failures).toBe(1);
      });
      expect(ModelCommandAgent.rejectedCommand).toMatchObject({
        message: { typeUrl: "type.spine.io/spine.agent.CallModel" },
      });
      const beforeDiscard = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
      const requestCount = beforeDiscard.items.filter(
        (entry) => entry.item.case === "modelRequest",
      ).length;
      const discarded = SignalEnvelopes.command({
        schema: InspectSupportReplyDraftSchema,
        message: create(InspectSupportReplyDraftSchema, { agent: id }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await context.commandBus().post(discarded);
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      const discardedHistory = await readAgentHistoryPage(context, repository, id, {
        pageSize: 30,
      });
      expect(
        discardedHistory.items.filter((entry) => entry.item.case === "modelRequest"),
      ).toHaveLength(requestCount);
      ModelCommandAgent.gate = {
        entered: () => {
          handlerEntered.resolve(undefined);
        },
        release: handlerRelease.promise,
      };
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
      await handlerEntered.promise;
      const inbox = serverEnvironmentAccess.coreDelivery(environment).inbox;
      const pending = await inbox.read(ShardIndex.single());
      expect(pending.find((row) => row.signalId === command.id?.uuid)?.status).toBe("TO_DELIVER");
      handlerRelease.resolve(undefined);
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      await entered.promise;
      const delivered = await inbox.read(ShardIndex.single());
      expect(delivered.find((row) => row.signalId === command.id?.uuid)?.status).toBe("DELIVERED");
      expect(await context.stand().read(SupportReplyAgentStateSchema, id)).toBeUndefined();
      const request = await readAgentHistoryPage(context, repository, id, { pageSize: 30 });
      const modelRequest = request.items.find((entry) => entry.item.case === "modelRequest");
      expect(modelRequest).toBeDefined();
      if (modelRequest?.item.case !== "modelRequest") throw new Error("Missing model request.");
      const payload = modelRequest.item.value.request?.message;
      const prepared = payload && AnyPacker.tryUnpack(payload, CallModelSchema);
      ModelCommandAgent.abandonedCallId = prepared?.call?.id;
      const abandon = SignalEnvelopes.command({
        schema: CancelSupportReplyDraftSchema,
        message: create(CancelSupportReplyDraftSchema, { agent: id }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "support-user" }),
          }),
        }),
      });
      await context.commandBus().post(abandon);
      await serverEnvironmentAccess.whenDeliveryIdle(environment);
      const abandonedHistory = await readAgentHistoryPage(context, repository, id, {
        pageSize: 30,
      });
      expect(abandonedHistory.items.some((entry) => entry.item.case === "abandonment")).toBe(true);
      release.resolve(undefined);
      await application.close();
      expect(ModelCommandAgent.replies).toBe(1);
    } finally {
      handlerRelease.resolve(undefined);
      release.resolve(undefined);
      ModelCommandAgent.gate = undefined;
      ModelCommandAgent.abandonedCallId = undefined;
      await application.close();
    }
  });
});
