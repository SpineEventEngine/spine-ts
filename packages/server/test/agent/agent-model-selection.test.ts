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

import { clone, create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { AiModel, AiRegistry, ModelRef, type AiScope } from "@spine-event-engine/ai";
import { createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyPacker, Time, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandSchema,
  EventContextSchema,
  EventSchema,
  RejectionEventContextSchema,
  TenantIdSchema,
  UserIdSchema,
  InternetDomainSchema,
} from "@spine-event-engine/proto";
import { AiModelKind, ModelPreferenceSchema } from "@spine-event-engine/proto/agent";
import { ModelRefSchema } from "@spine-event-engine/proto/agent";
import { describe, expect, it, vi } from "vitest";
import { AgentModelSelection } from "../../src/agent/agent-model-selection.js";
import { SignalMetadata } from "../../src/runtime/signal-metadata.js";
import { ProjectStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import { ProjectIdSchema } from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import { AssignReviewTaskSchema } from "../../test-fixtures/generated/handler-registry/commands_pb.js";
import { ReviewTaskAssignedSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  ProposedSupportReplySchema,
  SupportRoutingResultSchema,
  SupportTicketFactsSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const proposal = AiModel.define({
  name: "support-model-selection",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Prepare a support reply.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1_000,
    maxInputBytes: 1_000,
    maxOutputBytes: 1_000,
    maxOutputTokens: 100,
  },
});

const routing = AiModel.define({
  name: "route-support-ticket",
  version: "v1",
  kind: "decision",
  input: SupportTicketFactsSchema,
  output: SupportRoutingResultSchema,
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1_000,
    maxInputBytes: 1_000,
    maxOutputBytes: 1_000,
  },
  questions: { safe: { type: "boolean", instructions: "Can support handle this ticket?" } },
  mapping: {
    version: "v1",
    toMessage: () => create(SupportRoutingResultSchema, { queue: { value: "support" } }),
  },
});

function supportScope() {
  const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-selection" });
  const command = create(CommandSchema, {
    id: { uuid: "selection-command" },
    message: AnyPacker.pack(
      DraftSupportReplySchema,
      create(DraftSupportReplySchema, { agent: id, question: "Where is my order?" }),
    ),
  });
  return AgentModelSelection.scopeLive(
    {
      recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, id),
      stateType: SupportReplyAgentStateSchema.typeName,
      source: { case: "command", value: command },
    },
    SupportReplyAgentStateSchema,
    new SignalMetadata(),
  );
}

function selectionRegistry(
  authorize: (model: string) => boolean | Promise<boolean>,
  resolveIdentity: (model: string) => Promise<void> | void = () => undefined,
  defaultModel = true,
  hookTimeoutMs = 1000,
  observeScope: (phase: string, scope: AiScope) => void = () => undefined,
) {
  const primary = ModelRef.of("support-primary", "v1");
  const preferred = ModelRef.of("support-preferred", "v1");
  const registry = AiRegistry.create({
    defaultModels: defaultModel ? { generation: primary } : {},
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 0,
      deadlineMs: 1_000,
      totalInputBytes: 4_000,
      totalOutputBytes: 4_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
    hookTimeoutMs,
  });
  for (const [ref, name] of [
    [primary, "primary"],
    [preferred, "preferred"],
  ] as const)
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: async (scope) => {
          observeScope("identity", scope);
          await resolveIdentity(name);
          return { provider: "fixture", account: "support", endpoint: "memory", model: name };
        },
        authorizeUse: (scope) => {
          observeScope("use", scope);
          return authorize(name);
        },
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => Promise.reject(new Error("Selection must not dispatch a model request.")),
      }),
    );
  return { registry, primary, preferred };
}

describe("Agent model authorization scope", () => {
  it("selects a live model from the original typed signal and committed preference", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live-selection" });
    const command = create(CommandSchema, {
      id: { uuid: "live-selection-command" },
      message: AnyPacker.pack(
        DraftSupportReplySchema,
        create(DraftSupportReplySchema, { agent: id, question: "Status?" }),
      ),
      context: { actorContext: create(ActorContextSchema) },
    });
    const scope = AgentModelSelection.scopeLive(
      {
        source: { case: "command", value: command },
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, id),
        stateType: SupportReplyAgentStateSchema.typeName,
      },
      SupportReplyAgentStateSchema,
      new SignalMetadata(),
    );
    const { registry, preferred } = selectionRegistry(() => true);
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [proposal] },
      scope,
      [
        create(ModelPreferenceSchema, {
          kind: AiModelKind.GENERATION,
          selection: { case: "model", value: preferred },
        }),
      ],
      new AbortController().signal,
      Time.currentTimeMillis() + 1_000,
      "generation",
      command.message,
    );
    expect(scope.source.typeUrl).toBe(TypeUrls.derive(DraftSupportReplySchema));
    expect(scope.agent.typeUrl).toBe(TypeUrls.derive(SupportReplyAgentStateSchema));
    expect(selected.model).toEqual(preferred);
    expect(selected.connection.model?.value).toBe("preferred");
  });
  it("awaits an unbounded hook until cancellation when no deadline is configured", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const pending = AgentModelSelection.awaitHook(
      new Promise<never>(() => undefined),
      controller.signal,
      undefined,
    );
    expect(timeout).not.toHaveBeenCalled();
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    timeout.mockRestore();
  });
  it("uses the accepted support Command and claim-time preference before authorizing a deployment", async () => {
    const authorized = vi.fn(() => true);
    const { registry, preferred } = selectionRegistry(authorized);
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [proposal] },
      supportScope(),
      [
        create(ModelPreferenceSchema, {
          kind: AiModelKind.GENERATION,
          selection: { case: "model", value: preferred },
        }),
      ],
      new AbortController().signal,
      Time.currentTimeMillis() + 1_000,
      "generation",
      AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
    );
    expect(selected.model).toEqual(preferred);
    expect(selected.connection.model?.value).toBe("preferred");
    expect(authorized).toHaveBeenCalledExactlyOnceWith("preferred");
  });

  it("rejects denied model use before a connection or model request", async () => {
    const authorized = vi.fn(() => false);
    const { registry } = selectionRegistry(authorized);
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        { models: [proposal] },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() + 1_000,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toMatchObject({ name: "AgentLiveFault", reason: "MODEL_USE_DENIED" });
    expect(authorized).toHaveBeenCalledOnce();
  });

  it("selects both configured kinds and honors the repository default before the Bounded Context default", async () => {
    const { registry, preferred } = selectionRegistry(() => true);
    const decisionRef = ModelRef.of("support-decision", "v1");
    registry.register(
      createBackendRegistration({
        ref: decisionRef,
        kind: "decision",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "fixture",
          account: "support",
          endpoint: "memory",
          model: "decision",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute: () => Promise.reject(new Error("Selection must not dispatch a model request.")),
      }),
    );
    const options = {
      models: [proposal, routing],
      defaultModels: { generation: preferred, decision: decisionRef },
    };
    const scope = supportScope();
    const signal = new AbortController().signal;
    const deadline = Time.currentTimeMillis() + 1_000;
    const source = AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema));
    const selected = await Promise.all(
      ["generation", "decision"].map((kind) =>
        AgentModelSelection.selectLiveKind(
          registry,
          options,
          scope,
          [],
          signal,
          deadline,
          kind as "generation" | "decision",
          source,
        ),
      ),
    );
    expect(selected.map((item) => item.kind)).toEqual([
      AiModelKind.GENERATION,
      AiModelKind.DECISION,
    ]);
    expect(selected.map((item) => item.model)).toEqual([preferred, decisionRef]);
  });

  it("rejects an expired accepted selection without authorizing its deployment", async () => {
    const authorized = vi.fn(() => true);
    const { registry } = selectionRegistry(authorized);
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        { models: [proposal] },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() - 1,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toThrow("expired");
    expect(authorized).not.toHaveBeenCalled();
  });

  it("cancels a pending identity hook without authorizing late callback work", async () => {
    const authorized = vi.fn(() => true);
    const controller = new AbortController();
    const { registry } = selectionRegistry(authorized, () => new Promise<void>(() => undefined));
    const pending = AgentModelSelection.selectLiveKind(
      registry,
      { models: [proposal] },
      supportScope(),
      [],
      controller.signal,
      Time.currentTimeMillis() + 1_000,
      "generation",
      AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
    );
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(authorized).not.toHaveBeenCalled();
  });

  it("bootstraps a no-default Agent from a detached accepted payload and snapshots the resolver ref", async () => {
    const { registry, preferred } = selectionRegistry(() => true, undefined, false);
    const source = AnyPacker.pack(
      DraftSupportReplySchema,
      create(DraftSupportReplySchema, { question: "Choose account B" }),
    );
    let received: typeof source | undefined;
    const returned = ModelRef.of("support-preferred", "v1");
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      {
        models: [proposal],
        resolveModel: (_kind, _scope, payload) => {
          received = payload;
          payload.value[0] = 0;
          return returned;
        },
        authorizeSelection: (_scope, reference) => {
          expect(reference).not.toBe(returned);
          expect(reference).toEqual(preferred);
          if (returned.name) returned.name.value = "different";
          return true;
        },
      },
      supportScope(),
      [],
      new AbortController().signal,
      Time.currentTimeMillis() + 1_000,
      "generation",
      source,
    );
    expect(selected.model).toEqual(preferred);
    expect(received).not.toBe(source);
    expect(AnyPacker.tryUnpack(source, DraftSupportReplySchema)?.question).toBe("Choose account B");
  });

  it("keeps original accepted scope through resolver, selection and connection authorization", async () => {
    const observed: { phase: string; scope: AiScope }[] = [];
    const { registry, preferred } = selectionRegistry(
      () => true,
      undefined,
      false,
      1000,
      (phase, scope) => {
        observed.push({ phase, scope });
      },
    );
    const base = supportScope();
    base.actor.actor = create(UserIdSchema, { value: "accepted-user" });
    const scope: AiScope = {
      ...base,
      tenant: {
        kind: "tenant",
        id: create(TenantIdSchema, {
          kind: { case: "domain", value: create(InternetDomainSchema, { value: "accepted.test" }) },
        }),
      },
    };
    const facts = (value: AiScope) => ({
      actor: value.actor.actor?.value,
      tenant:
        value.tenant.kind === "tenant" && value.tenant.id.kind.case === "domain"
          ? value.tenant.id.kind.value.value
          : undefined,
      agent: value.agent.typeUrl,
      agentId: value.agent.id?.typeUrl,
      source: value.source.typeUrl,
      sourceId: value.source.id?.typeUrl,
    });
    const acceptedFacts = facts(scope);
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      {
        models: [proposal],
        resolveModel: (_kind, callbackScope) => {
          if (callbackScope.actor.actor === undefined) throw new Error("Expected accepted actor.");
          callbackScope.actor.actor.value = "altered-user";
          if (
            callbackScope.tenant.kind === "tenant" &&
            callbackScope.tenant.id.kind.case === "domain"
          )
            callbackScope.tenant.id.kind.value.value = "altered.test";
          callbackScope.agent.typeUrl = "altered.agent";
          if (callbackScope.agent.id) callbackScope.agent.id.typeUrl = "altered.agent.id";
          callbackScope.source.typeUrl = "altered.source";
          if (callbackScope.source.id) callbackScope.source.id.typeUrl = "altered.source.id";
          return preferred;
        },
        authorizeSelection: (callbackScope) => {
          observed.push({ phase: "selection", scope: callbackScope });
          return true;
        },
      },
      scope,
      [],
      new AbortController().signal,
      Time.currentTimeMillis() + 1000,
      "generation",
      AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
    );
    expect(selected.model).toEqual(preferred);
    expect(facts(scope)).toEqual(acceptedFacts);
    expect(observed.map((item) => item.phase)).toEqual(["selection", "identity", "use"]);
    expect(observed.map((item) => facts(item.scope))).toEqual([
      acceptedFacts,
      acceptedFacts,
      acceptedFacts,
    ]);
  });

  it("rejects a denied resolver choice before identity resolution", async () => {
    const resolveIdentity = vi.fn();
    const { registry, preferred } = selectionRegistry(() => true, resolveIdentity);
    const authorizeSelection = vi.fn(() => false);
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        { models: [proposal], resolveModel: () => preferred, authorizeSelection },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() + 1000,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toThrow("unauthorized");
    expect(authorizeSelection).toHaveBeenCalledOnce();
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("bounds a hanging resolver and ignores its late result", async () => {
    const authorizeSelection = vi.fn(() => true);
    const resolveIdentity = vi.fn();
    const { registry, preferred } = selectionRegistry(() => true, resolveIdentity, false, 20);
    let release: ((ref: typeof preferred) => void) | undefined;
    const result = new Promise<typeof preferred>((resolve) => {
      release = resolve;
    });
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        { models: [proposal], resolveModel: () => result, authorizeSelection },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() + 1000,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toThrow();
    release?.(preferred);
    await Promise.resolve();
    expect(authorizeSelection).not.toHaveBeenCalled();
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("does not invoke a resolver after cancellation", async () => {
    const { registry, preferred } = selectionRegistry(() => true);
    const controller = new AbortController();
    const resolveModel = vi.fn(() => preferred);
    controller.abort();
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        { models: [proposal], resolveModel },
        supportScope(),
        [],
        controller.signal,
        Time.currentTimeMillis() + 1000,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toThrow("cancelled");
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it("ignores a resolver result after cancellation during its callback", async () => {
    const authorized = vi.fn(() => true);
    const resolveIdentity = vi.fn();
    const { registry, preferred } = selectionRegistry(() => true, resolveIdentity);
    let release: ((ref: typeof preferred) => void) | undefined;
    const pendingResult = new Promise<typeof preferred>((resolve) => {
      release = resolve;
    });
    const resolveModel = vi.fn(() => pendingResult);
    const controller = new AbortController();
    const pending = AgentModelSelection.selectLiveKind(
      registry,
      { models: [proposal], resolveModel, authorizeSelection: authorized },
      supportScope(),
      [],
      controller.signal,
      Time.currentTimeMillis() + 1000,
      "generation",
      AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
    );
    expect(resolveModel).toHaveBeenCalledOnce();
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    release?.(preferred);
    await Promise.resolve();
    expect(authorized).not.toHaveBeenCalled();
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("keeps normal precedence when the source resolver returns no model", async () => {
    const { registry, primary } = selectionRegistry(() => true);
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [proposal], resolveModel: () => undefined },
      supportScope(),
      [],
      new AbortController().signal,
      Time.currentTimeMillis() + 1000,
      "generation",
      AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
    );
    expect(selected.model).toEqual(primary);
  });

  it("rejects a resolver model outside the repository allowlist before authorization", async () => {
    const authorized = vi.fn(() => true);
    const resolveIdentity = vi.fn();
    const { registry, primary, preferred } = selectionRegistry(() => true, resolveIdentity);
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        {
          models: [proposal],
          allowedModels: { generation: [primary] },
          resolveModel: () => preferred,
          authorizeSelection: authorized,
        },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() + 1000,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toThrow("allowed");
    expect(authorized).not.toHaveBeenCalled();
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("rejects an unregistered resolver model before authorization or identity work", async () => {
    const authorized = vi.fn(() => true);
    const resolveIdentity = vi.fn();
    const { registry } = selectionRegistry(() => true, resolveIdentity);
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        {
          models: [proposal],
          resolveModel: () => ModelRef.of("unknown-deployment", "v1"),
          authorizeSelection: authorized,
        },
        supportScope(),
        [],
        new AbortController().signal,
        Time.currentTimeMillis() + 1000,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toThrow("not registered");
    expect(authorized).not.toHaveBeenCalled();
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("rejects a missing accepted payload or malformed resolver reference before identity work", async () => {
    const resolveIdentity = vi.fn();
    const { registry } = selectionRegistry(() => true, resolveIdentity);
    const resolveModel = vi.fn(() => create(ModelRefSchema));
    const options = { models: [proposal], resolveModel };
    const control = new AbortController().signal;
    const deadline = Time.currentTimeMillis() + 1000;
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        options,
        supportScope(),
        [],
        control,
        deadline,
        "generation",
      ),
    ).rejects.toThrow("source payload");
    expect(resolveModel).not.toHaveBeenCalled();
    await expect(
      AgentModelSelection.selectLiveKind(
        registry,
        options,
        supportScope(),
        [],
        control,
        deadline,
        "generation",
        AnyPacker.pack(DraftSupportReplySchema, create(DraftSupportReplySchema)),
      ),
    ).rejects.toThrow();
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  it("bounds an uncooperative preference authorization callback", async () => {
    const { registry, preferred } = selectionRegistry(() => true, undefined, true, 20);
    let observedSignal: AbortSignal | undefined;
    await expect(
      AgentModelSelection.authorizeSelection(
        registry,
        {
          models: [proposal],
          authorizeSelection: (_scope, _reference, control) => {
            observedSignal = control.signal;
            return new Promise<boolean>(() => undefined);
          },
        },
        supportScope(),
        preferred,
        new AbortController().signal,
        Time.currentTimeMillis() + 1000,
      ),
    ).rejects.toThrow();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("identifies the actual handled Command and Event types", () => {
    const recipientId = AnyPacker.pack(
      ProjectIdSchema,
      create(ProjectIdSchema, { value: "project-1" }),
    );
    const command = create(CommandSchema, {
      id: { uuid: "command-1" },
      message: AnyPacker.pack(
        AssignReviewTaskSchema,
        create(AssignReviewTaskSchema, { id: "project-1" }),
      ),
    });
    const event = create(EventSchema, {
      id: { value: "event-1" },
      message: AnyPacker.pack(
        ReviewTaskAssignedSchema,
        create(ReviewTaskAssignedSchema, { id: "project-1" }),
      ),
    });
    const accepted = (signal: "command" | "event") => ({
      recipientId: clone(AnySchema, recipientId),
      stateType: ProjectStateSchema.typeName,
      source:
        signal === "command"
          ? { case: "command" as const, value: clone(CommandSchema, command) }
          : { case: "event" as const, value: clone(EventSchema, event) },
    });
    const scope = (signal: Parameters<typeof AgentModelSelection.scopeLive>[0]) =>
      AgentModelSelection.scopeLive(signal, ProjectStateSchema, new SignalMetadata());
    expect(scope(accepted("command")).source.typeUrl).toBe(TypeUrls.derive(AssignReviewTaskSchema));
    expect(scope(accepted("event")).source.typeUrl).toBe(TypeUrls.derive(ReviewTaskAssignedSchema));
    const rejection = accepted("event");
    if (rejection.source.case !== "event") throw new Error("Expected Event signal.");
    rejection.source.value.context = create(EventContextSchema, {
      rejection: create(RejectionEventContextSchema, { command }),
    });
    expect(scope(rejection).source.typeUrl).toBe(TypeUrls.derive(ReviewTaskAssignedSchema));
    const incomplete = accepted("command");
    if (incomplete.source.case !== "command") throw new Error("Expected Command signal.");
    incomplete.source.value.message = undefined;
    expect(() => scope(incomplete)).toThrow("payload type");
    const missingRecipient = accepted("command");
    missingRecipient.recipientId.typeUrl = " ";
    expect(() => scope(missingRecipient)).toThrow("typed state and recipient");
    const wrongState = { ...accepted("command"), stateType: "other.state" };
    expect(() => scope(wrongState)).toThrow("typed state and recipient");
    const missingCommandId = accepted("command");
    if (missingCommandId.source.case !== "command") throw new Error("Expected Command signal.");
    missingCommandId.source.value.id = undefined;
    expect(() => scope(missingCommandId)).toThrow("source ID");
    const missingEventId = accepted("event");
    if (missingEventId.source.case !== "event") throw new Error("Expected Event signal.");
    missingEventId.source.value.id = undefined;
    expect(() => scope(missingEventId)).toThrow("source ID");
    const blankPayloadType = accepted("event");
    if (
      blankPayloadType.source.case !== "event" ||
      blankPayloadType.source.value.message === undefined
    )
      throw new Error("Expected Event payload.");
    blankPayloadType.source.value.message.typeUrl = " ";
    expect(() => scope(blankPayloadType)).toThrow("payload type");
  });
});
