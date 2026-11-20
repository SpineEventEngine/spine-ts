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
import { Client } from "@spine-event-engine/client-node";
import { AiModel, AiRegistry, ModelRef } from "@spine-event-engine/ai";
import { backendDefinition, createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyPacker } from "@spine-event-engine/core";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import { AiModelKind, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import {
  Agent,
  Application,
  BoundedContext,
  HandlerRegistryIngestor,
  Repository,
  EnvironmentType,
  Server,
  ServerEnvironment,
  ShardIndex,
  type EntityHandlersMetadata,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { observeProducedSignals } from "@spine-event-engine/server/testing";
import { describe, expect, it, vi } from "vitest";
import { AiTestBackend } from "../src/index.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
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

const model = AiModel.define({
  name: "completion-support-reply",
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

class CompletionAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
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

const alternateRef = ModelRef.of("completion-alternate", "v1");

class PreferenceCompletionAgent extends CompletionAgent {
  override async draft(command: DraftSupportReply) {
    if (command.question === "Prefer alternate")
      this.ai.select(AiModelKind.GENERATION, alternateRef);
    return super.draft(command);
  }
}

class SelfReactingCompletionAgent extends CompletionAgent {
  static reactions = 0;

  override async draft(command: DraftSupportReply) {
    return super.draft(command);
  }

  react(proposed: SupportReplyProposed): void {
    if (proposed.agent?.ticketNumber !== this.id.ticketNumber)
      throw new Error("Follow-up Event reached a different Agent ID.");
    SelfReactingCompletionAgent.reactions++;
  }
}

function repository(entityType: typeof CompletionAgent = CompletionAgent, selfReact = false) {
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
    })[0] as EntityHandlersMetadata<CompletionAgent, typeof SupportReplyAgentStateSchema>,
    events: [SupportReplyProposedSchema],
  });
}

function registry(
  backend: AiTestBackend,
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
  }).register(registration);
  return { ai, observed };
}

async function contextBox(
  name: string,
  ai: AiRegistry,
  entityType: typeof CompletionAgent = CompletionAgent,
  selfReact = false,
) {
  const builder = BoundedContext.singleTenant(name).withAi(ai).persistSystemEvents();
  builder.add(repository(entityType, selfReact));
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({
        storageFactory: new InMemoryStorageFactory(),
      });
    })
    .build();
  const application = await Application.newBuilder()
    .setServerEnvironment(environment)
    .add(builder)
    .build();
  const context = application.contexts()[0];
  if (context === undefined) throw new Error("Expected a Bounded Context in the Application.");
  const endpoint = await Server.atPort(0).setApplication(application).start();
  const client = Client.connectTo(endpoint.baseUrl);
  const events: Event[] = [];
  const observer = observeProducedSignals(context, {
    onEvent: (event) => events.push(clone(EventSchema, event)),
  });
  const box = {
    asGuest: () => client.asGuest(),
    assertEvents: () => events.map((event) => clone(EventSchema, event)),
    eventually: async <Value>(
      read: () => Value | Promise<Value>,
      ready: (value: Value) => boolean,
    ) => {
      let result!: Value;
      await vi.waitFor(
        async () => {
          result = await read();
          expect(ready(result)).toBe(true);
        },
        { timeout: 7_000 },
      );
      return result;
    },
    close: async () => {
      await client.close();
      await endpoint.close();
      observer.close();
      await application.close();
    },
  };
  return { box, environment };
}

type CompletionBox = Awaited<ReturnType<typeof contextBox>>["box"];

async function post(
  box: CompletionBox,
  ticketNumber: string,
  question = `Please draft ${ticketNumber}`,
) {
  const agent = create(SupportReplyAgentIdSchema, { ticketNumber });
  return box
    .asGuest()
    .post(DraftSupportReplySchema, create(DraftSupportReplySchema, { agent, question }));
}

async function produced(box: CompletionBox, count: number) {
  return box.eventually(
    () => box.assertEvents(),
    (events) => events.length === count,
  );
}

describe("Agent completion through BlackBox", () => {
  it("drains a held callback on close while another context continues", async () => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of("completion-ignored-callback", "v1"),
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
    const { ai } = registry(backend, held);
    const first = await contextBox("CompletionIgnoredA", ai);
    const second = await contextBox("CompletionIgnoredB", ai);
    try {
      expect((await post(first.box, "T-A")).kind).toBe("ok");
      await held.entered.promise;
      expect(first.box.assertEvents()).toEqual([]);
      expect((await post(second.box, "T-B")).kind).toBe("ok");
      await produced(second.box, 1);
      let closed = false;
      const closing = first.box.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      held.release.resolve(undefined);
      await held.returned.promise;
      await closing;
      await produced(first.box, 1);
      expect(backend.requests()).toHaveLength(2);
    } finally {
      held.release.resolve(undefined);
      await Promise.all([first.box.close(), second.box.close()]);
    }
  }, 15_000);

  it("selects a committed alternate preference when a same-Agent waiting signal starts", async () => {
    const primary = AiTestBackend.create({
      ref: ModelRef.of("completion-preference-primary", "v1"),
      kind: "generation",
    });
    const alternate = AiTestBackend.create({ ref: alternateRef, kind: "generation" });
    const replies = primary.forModel(model);
    const gate = replies.delay();
    replies.respondWith(create(ProposedSupportReplySchema, { reply: "Original reply" }));
    alternate
      .forModel(model)
      .respondWith(create(ProposedSupportReplySchema, { reply: "Alternate reply" }));
    const { ai: primaryRegistry } = registry(primary);
    const ai = primaryRegistry.register(alternate.registration);
    const { box, environment } = await contextBox(
      "CompletionPreference",
      ai,
      PreferenceCompletionAgent,
    );
    try {
      expect((await post(box, "T-P", "Prefer alternate")).kind).toBe("ok");
      await box.eventually(
        () => primary.requests(),
        (requests) => requests.length === 1,
      );
      expect(alternate.requests()).toHaveLength(0);
      const deferred = await post(box, "T-P", "After preference");
      expect(deferred).toMatchObject({ kind: "ok" });
      expect(
        await environment.delivery.inbox.read(ShardIndex.single(), {
          statuses: ["TO_DELIVER"],
        }),
      ).toHaveLength(2);
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
      ref: ModelRef.of("completion-self-followup", "v1"),
      kind: "generation",
    });
    backend.forModel(model).respondWith(create(ProposedSupportReplySchema, { reply: "Follow up" }));
    const { ai } = registry(backend);
    SelfReactingCompletionAgent.reactions = 0;
    const { box } = await contextBox(
      "CompletionSelfFollowup",
      ai,
      SelfReactingCompletionAgent,
      true,
    );
    try {
      expect((await post(box, "T-self")).kind).toBe("ok");
      await produced(box, 1);
      await box.eventually(
        () => SelfReactingCompletionAgent.reactions,
        (count) => count === 1,
      );
      expect(backend.requests()).toHaveLength(1);
    } finally {
      await box.close();
    }
  }, 15_000);
});
