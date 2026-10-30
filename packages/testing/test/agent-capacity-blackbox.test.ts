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
import { AiModel, AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { backendDefinition, createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyPacker } from "@spine-event-engine/core";
import { AiModelKind, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import {
  Agent,
  BoundedContext,
  HandlerRegistryIngestor,
  Repository,
  EnvironmentType,
  ServerEnvironment,
  ShardIndex,
  type EntityHandlersMetadata,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiTestBackend, BlackBox } from "../src/index.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  EscalatedSupportReplyAgentStateSchema,
  type SupportReplyAgentId,
} from "../test-fixtures/generated/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
} from "../test-fixtures/generated/support_agent_commands_pb.js";
import {
  SupportReplyProposedSchema,
  type SupportReplyProposed,
} from "../test-fixtures/generated/support_agent_events_pb.js";
import {
  ProposedSupportReplySchema,
  SupportReplyFactsSchema,
} from "../test-fixtures/generated/support_ai_types_pb.js";

beforeEach(async () => {
  ServerEnvironment.when(EnvironmentType.Local).use({
    storageFactory: new InMemoryStorageFactory(),
  });
  await ServerEnvironment.instance().completeSetup();
});

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

const model = AiModel.define({
  name: "capacity-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportReplyFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply for human review.",
  outputMode: "prompt-and-validate",
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 5_000,
    maxInputBytes: 4_000,
    maxOutputBytes: 4_000,
    maxOutputTokens: 100,
  },
});

class CapacityAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  async draft(command: DraftSupportReply) {
    if (!command.agent) throw new Error("Support Command requires an Agent ID.");
    const result = await this.ai.invoke(model, {
      call: "draft",
      conversation: create(ConversationIdSchema, { value: `ticket-${command.agent.ticketNumber}` }),
      input: create(SupportReplyFactsSchema, {
        ticketNumber: command.agent.ticketNumber,
        question: command.question,
        ticketRevision: 1n,
      }),
    });
    if (!result.ok) throw new Error(`Unexpected scripted failure: ${result.failure.code}`);
    this.update((state) =>
      Object.assign(state, { id: this.id, proposedReply: result.value.reply }),
    );
    return create(SupportReplyProposedSchema, { agent: this.id, reply: result.value.reply });
  }
}

class EscalatedCapacityAgent extends Agent<
  SupportReplyAgentId,
  typeof EscalatedSupportReplyAgentStateSchema
> {
  async draft(command: DraftSupportReply) {
    if (!command.agent) throw new Error("Support Command requires an Agent ID.");
    const result = await this.ai.invoke(model, {
      call: "draft",
      conversation: create(ConversationIdSchema, { value: `ticket-${command.agent.ticketNumber}` }),
      input: create(SupportReplyFactsSchema, {
        ticketNumber: command.agent.ticketNumber,
        question: command.question,
        ticketRevision: 1n,
      }),
    });
    if (!result.ok) throw new Error(`Unexpected scripted failure: ${result.failure.code}`);
    this.update((state) =>
      Object.assign(state, {
        id: this.id,
        proposedReply: result.value.reply,
        escalationCount: state.escalationCount + 1,
      }),
    );
    return create(SupportReplyProposedSchema, { agent: this.id, reply: result.value.reply });
  }
}

const alternateRef = ModelRef.of("capacity-alternate", "v1");

class PreferenceCapacityAgent extends CapacityAgent {
  override async draft(command: DraftSupportReply) {
    if (command.question === "Prefer alternate")
      this.ai.select(AiModelKind.GENERATION, alternateRef);
    return super.draft(command);
  }
}

class SelfReactingCapacityAgent extends CapacityAgent {
  static reactions = 0;

  override async draft(command: DraftSupportReply) {
    return super.draft(command);
  }

  react(proposed: SupportReplyProposed): void {
    if (proposed.agent?.ticketNumber !== this.id.ticketNumber)
      throw new Error("Follow-up Event reached a different Agent ID.");
    SelfReactingCapacityAgent.reactions++;
  }
}

function repository(entityType: typeof CapacityAgent = CapacityAgent, selfReact = false) {
  return new Repository({
    entityType,
    schema: SupportReplyAgentStateSchema,
    ai: { models: [model] },
    handlers: new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity",
          receiverType: entityType,
          stateSchema: SupportReplyAgentStateSchema,
          handlers: [
            {
              kind: "command-assignment",
              methodName: "draft",
              input: { schema: DraftSupportReplySchema, origin: "domestic" },
              outcomes: { returned: [SupportReplyProposedSchema], thrown: [] },
              parameterCount: 1,
            },
            ...(selfReact
              ? [
                  {
                    kind: "event-reaction" as const,
                    methodName: "react",
                    input: { schema: SupportReplyProposedSchema, origin: "domestic" as const },
                    outcomes: { returned: [], thrown: [] },
                    parameterCount: 1,
                  },
                ]
              : []),
          ],
        },
      ],
    })[0] as EntityHandlersMetadata<CapacityAgent, typeof SupportReplyAgentStateSchema>,
    events: [SupportReplyProposedSchema],
  });
}

function escalationRepository() {
  return new Repository({
    entityType: EscalatedCapacityAgent,
    schema: EscalatedSupportReplyAgentStateSchema,
    ai: { models: [model] },
    handlers: new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity",
          receiverType: EscalatedCapacityAgent,
          stateSchema: EscalatedSupportReplyAgentStateSchema,
          handlers: [
            {
              kind: "command-assignment",
              methodName: "draft",
              input: { schema: DraftSupportReplySchema, origin: "domestic" },
              outcomes: { returned: [SupportReplyProposedSchema], thrown: [] },
              parameterCount: 1,
            },
          ],
        },
      ],
    })[0] as EntityHandlersMetadata<
      EscalatedCapacityAgent,
      typeof EscalatedSupportReplyAgentStateSchema
    >,
    events: [SupportReplyProposedSchema],
  });
}

function registry(
  backend: AiTestBackend,
  concurrent: number,
  queued: number,
  held?: {
    readonly entered: PromiseWithResolvers<undefined>;
    readonly release: PromiseWithResolvers<undefined>;
    readonly returned: PromiseWithResolvers<undefined>;
  },
) {
  const callbacks = backendDefinition(backend.registration);
  const observed = { identities: 0, authorizations: 0 };
  let firstExecution = true;
  const registration = createBackendRegistration({
    ...callbacks,
    resolveIdentity(scope, control) {
      observed.identities++;
      return callbacks.resolveIdentity(scope, control);
    },
    authorizeUse(scope, identity, control) {
      observed.authorizations++;
      return callbacks.authorizeUse(scope, identity, control);
    },
    async execute(request) {
      const pause = held !== undefined && firstExecution;
      firstExecution = false;
      const result = await callbacks.execute(request);
      if (pause) {
        held.entered.resolve(undefined);
        await held.release.promise;
        held.returned.resolve(undefined);
      }
      return result;
    },
  });
  const ai = AiRegistry.create({
    defaultModels: { generation: registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 0,
      deadlineMs: 5_000,
      totalInputBytes: 8_000,
      totalOutputBytes: 8_000,
    },
    concurrentOperations: concurrent,
    queuedOperations: queued,
  }).register(registration);
  return { ai, observed };
}

async function contextBox(
  name: string,
  ai: AiRegistry,
  entityType: typeof CapacityAgent = CapacityAgent,
  escalated = false,
  selfReact = false,
) {
  const builder = BoundedContext.singleTenant(name).withAi(ai).persistSystemEvents();
  const context = await (
    escalated ? builder.add(escalationRepository()) : builder.add(repository(entityType, selfReact))
  ).build();
  return { box: await BlackBox.from(context, { timeoutMs: 7_000 }) };
}

async function post(
  box: BlackBox,
  ticketNumber: string,
  question = `Please draft ${ticketNumber}`,
) {
  const agent = create(SupportReplyAgentIdSchema, { ticketNumber });
  return box
    .asGuest()
    .post(DraftSupportReplySchema, create(DraftSupportReplySchema, { agent, question }));
}

async function produced(box: BlackBox, count: number) {
  return box.eventually(
    () => box.assertEvents(),
    (events) => events.length === count,
  );
}

describe("shared Agent registry capacity through BlackBox", () => {
  it("wakes a deferred shard after another context frees the only active slot", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("capacity-cross-context", "v1"),
      kind: "generation",
    });
    const responses = backend.forModel(model);
    const gate = responses.delay();
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply A" }));
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply B" }));
    const { ai } = registry(backend, 1, 0);
    const first = await contextBox("CapacityWakeA", ai);
    const second = await contextBox("CapacityWakeB", ai, CapacityAgent, true);
    try {
      expect((await post(first.box, "T-A")).kind).toBe("ok");
      await first.box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 1,
      );
      const deferred = await post(second.box, "T-B");
      expect(deferred).toMatchObject({ kind: "error", error: { type: "COMMAND_POST_ERROR" } });
      expect(
        await ServerEnvironment.instance().delivery.inbox.read(ShardIndex.single(), {
          statuses: ["TO_DELIVER"],
        }),
      ).toHaveLength(1);
      expect(backend.requests()).toHaveLength(1);
      gate.release();
      await produced(first.box, 1);
      await produced(second.box, 1);
      expect(backend.requests()).toHaveLength(2);
    } finally {
      gate.release();
      await Promise.all([first.box.close(), second.box.close()]);
    }
  });
  it("keeps a second Bounded Context admitted but unstarted until one active slot releases", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("capacity-scripted", "v1"),
      kind: "generation",
    });
    const responses = backend.forModel(model);
    const gate = responses.delay();
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply A" }));
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply B" }));
    const { ai, observed } = registry(backend, 1, 1);
    const first = await contextBox("CapacityA", ai);
    const second = await contextBox("CapacityB", ai, CapacityAgent, true);
    try {
      expect((await post(first.box, "T-A")).kind).toBe("ok");
      await first.box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 1,
      );
      const whileFirstBlocked = { ...observed };
      expect(whileFirstBlocked.identities).toBeGreaterThan(0);
      expect(whileFirstBlocked.authorizations).toBeGreaterThan(0);
      expect((await post(second.box, "T-B")).kind).toBe("ok");
      expect(backend.requests()).toHaveLength(1);
      expect(observed).toEqual(whileFirstBlocked);
      expect(second.box.assertEvents()).toEqual([]);
      gate.release();
      await produced(first.box, 1);
      await produced(second.box, 1);
      expect(backend.requests()).toHaveLength(2);
      backend.assertSatisfied();
    } finally {
      gate.release();
      await Promise.all([first.box.close(), second.box.close()]);
    }
  });

  it("starts two independent Agent IDs in the default single delivery shard with C=2", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("capacity-parallel", "v1"),
      kind: "generation",
    });
    const responses = backend.forModel(model);
    const firstGate = responses.delay();
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply A" }));
    const secondGate = responses.delay();
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply B" }));
    const { ai } = registry(backend, 2, 0);
    const { box } = await contextBox("CapacityParallel", ai);
    try {
      expect((await post(box, "T-A")).kind).toBe("ok");
      expect((await post(box, "T-B")).kind).toBe("ok");
      await box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 2,
      );
      expect(box.assertEvents()).toEqual([]);
      firstGate.release();
      secondGate.release();
      await produced(box, 2);
      backend.assertSatisfied();
    } finally {
      firstGate.release();
      secondGate.release();
      await box.close();
    }
  });

  it("closing one Bounded Context leaves a second Bounded Context's queued work runnable", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("capacity-close", "v1"),
      kind: "generation",
    });
    const responses = backend.forModel(model);
    const gate = responses.delay();
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply A" }));
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply B" }));
    const { ai } = registry(backend, 1, 1);
    const first = await contextBox("CapacityCloseA", ai);
    const second = await contextBox("CapacityCloseB", ai, CapacityAgent, true);
    try {
      expect((await post(first.box, "T-A")).kind).toBe("ok");
      await first.box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 1,
      );
      expect((await post(second.box, "T-B")).kind).toBe("ok");
      expect(second.box.assertEvents()).toEqual([]);
      await first.box.close();
      gate.release();
      await produced(second.box, 1);
      expect(backend.requests()).toHaveLength(2);
    } finally {
      gate.release();
      await Promise.all([first.box.close(), second.box.close()]);
    }
  }, 15_000);

  it("drains a held callback on close while another context continues", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("capacity-ignored-callback", "v1"),
      kind: "generation",
    });
    const responses = backend.forModel(model);
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Late reply A" }));
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply B" }));
    const held = {
      entered: Promise.withResolvers<undefined>(),
      release: Promise.withResolvers<undefined>(),
      returned: Promise.withResolvers<undefined>(),
    };
    const { ai } = registry(backend, 1, 1, held);
    const first = await contextBox("CapacityIgnoredA", ai);
    const second = await contextBox("CapacityIgnoredB", ai, CapacityAgent, true);
    try {
      expect((await post(first.box, "T-A")).kind).toBe("ok");
      await held.entered.promise;
      expect(first.box.assertEvents()).toEqual([]);
      expect((await post(second.box, "T-B")).kind).toBe("ok");
      expect(second.box.assertEvents()).toEqual([]);
      let closed = false;
      const closing = first.box.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      held.release.resolve(undefined);
      await held.returned.promise;
      await closing;
      await produced(second.box, 1);
      expect(backend.requests()).toHaveLength(2);
    } finally {
      held.release.resolve(undefined);
      await Promise.all([first.box.close(), second.box.close()]);
    }
  }, 15_000);

  it("selects a committed alternate preference when a same-Agent waiting signal starts", async () => {
    const primary = AiTestBackend.create({
      ref: ModelRef.of("capacity-preference-primary", "v1"),
      kind: "generation",
    });
    const alternate = AiTestBackend.create({ ref: alternateRef, kind: "generation" });
    const replies = primary.forModel(model);
    const gate = replies.delay();
    replies.respondWith(create(ProposedSupportReplySchema, { reply: "Original reply" }));
    alternate
      .forModel(model)
      .respondWith(create(ProposedSupportReplySchema, { reply: "Alternate reply" }));
    const { ai: primaryRegistry } = registry(primary, 1, 1);
    const ai = primaryRegistry.register(alternate.registration);
    const { box } = await contextBox("CapacityPreference", ai, PreferenceCapacityAgent);
    try {
      expect((await post(box, "T-P", "Prefer alternate")).kind).toBe("ok");
      await box.eventually(
        () => primary.requests(),
        (requests) => requests.length === 1,
      );
      expect(alternate.requests()).toHaveLength(0);
      const deferred = await post(box, "T-P", "After preference");
      expect(deferred).toMatchObject({ kind: "error", error: { type: "COMMAND_POST_ERROR" } });
      expect(
        await ServerEnvironment.instance().delivery.inbox.read(ShardIndex.single(), {
          statuses: ["TO_DELIVER"],
        }),
      ).toHaveLength(1);
      expect(primary.requests()).toHaveLength(1);
      expect(alternate.requests()).toHaveLength(0);
      gate.release();
      const events = await produced(box, 2);
      expect(
        events.map((event) =>
          event.message
            ? AnyPacker.tryUnpack(event.message, SupportReplyProposedSchema)?.reply
            : undefined,
        ),
      ).toEqual(["Original reply", "Alternate reply"]);
      expect(primary.requests()).toHaveLength(1);
      expect(alternate.requests()).toHaveLength(1);
      primary.assertSatisfied();
      alternate.assertSatisfied();
    } finally {
      gate.release();
      await box.close();
    }
  }, 15_000);

  it("delivers an Agent's output back to the same Agent on the active shard", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("capacity-self-followup", "v1"),
      kind: "generation",
    });
    backend.forModel(model).respondWith(create(ProposedSupportReplySchema, { reply: "Follow up" }));
    const { ai } = registry(backend, 1, 1);
    SelfReactingCapacityAgent.reactions = 0;
    const { box } = await contextBox(
      "CapacitySelfFollowup",
      ai,
      SelfReactingCapacityAgent,
      false,
      true,
    );
    try {
      expect((await post(box, "T-self")).kind).toBe("ok");
      await produced(box, 1);
      await box.eventually(
        () => SelfReactingCapacityAgent.reactions,
        (count) => count === 1,
      );
      expect(backend.requests()).toHaveLength(1);
    } finally {
      await box.close();
    }
  }, 15_000);
});
