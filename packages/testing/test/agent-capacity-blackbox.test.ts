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
import { backendDefinition, createBackendRegistration } from "@spine-event-engine/ai/spi/adapter";
import { AnyMessages, Time } from "@spine-event-engine/core";
import { AiModelKind, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import {
  Agent,
  BoundedContext,
  HandlerRegistryIngestor,
  Repository,
  type EntityHandlersMetadata,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import type {
  AgentExecutionStorage,
  AgentExecutionStorageInput,
} from "@spine-event-engine/storage/provider";
import type * as Records from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";
import { AiTestBackend, BlackBox } from "../src/index.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
} from "../test-fixtures/generated/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
} from "../test-fixtures/generated/support_agent_commands_pb.js";
import { SupportReplyProposedSchema } from "../test-fixtures/generated/support_agent_events_pb.js";
import {
  ProposedSupportReplySchema,
  SupportReplyFactsSchema,
} from "../test-fixtures/generated/support_ai_types_pb.js";

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

const alternateRef = ModelRef.of("capacity-alternate", "v1");

class PreferenceCapacityAgent extends CapacityAgent {
  override async draft(command: DraftSupportReply) {
    if (command.question === "Prefer alternate")
      this.ai.select(AiModelKind.GENERATION, alternateRef);
    return super.draft(command);
  }
}

class CapacityStorage extends InMemoryStorageFactory {
  readonly reads = new Map<string, () => Promise<Records.AgentExecutionRecord | undefined>>();
  readonly accepted: (() => Promise<Records.AgentExecutionRecord | undefined>)[] = [];
  completed = 0;

  protected override createAgentExecutionStorage<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S> {
    const storage = super.createAgentExecutionStorage(input);
    const admit = storage.admit.bind(storage);
    const complete = storage.complete.bind(storage);
    storage.complete = async (completion) => {
      await complete(completion);
      this.completed++;
    };
    storage.admit = async (accepted) => {
      const record = await admit(accepted);
      const key = accepted.key;
      const id = accepted.recipientId
        ? AnyMessages.unpack(accepted.recipientId, SupportReplyAgentIdSchema)
        : undefined;
      if (key) this.accepted.push(() => storage.read(key));
      if (key && id) this.reads.set(id.ticketNumber, () => storage.read(key));
      return record;
    };
    return storage;
  }

  read(ticketNumber: string): Promise<Records.AgentExecutionRecord | undefined> {
    return this.reads.get(ticketNumber)?.() ?? Promise.resolve(undefined);
  }
}

function repository(entityType: typeof CapacityAgent = CapacityAgent) {
  return new Repository({
    entityType,
    schema: SupportReplyAgentStateSchema,
    agentCodeRevision: "capacity-v1",
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
          ],
        },
      ],
    })[0] as EntityHandlersMetadata<CapacityAgent, typeof SupportReplyAgentStateSchema>,
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
      maxRecoveryBytes: 24_000,
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
) {
  const storage = new CapacityStorage();
  const context = BoundedContext.singleTenant(name)
    .withAi(ai)
    .persistSystemEvents()
    .withStorageFactory(storage)
    .add(repository(entityType))
    .build();
  return { box: await BlackBox.from(context, { timeoutMs: 7_000 }), storage };
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
    const second = await contextBox("CapacityB", ai);
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
      await second.box.eventually(
        () => second.storage.read("T-B"),
        (record) => !!record,
      );
      expect((await second.storage.read("T-B"))?.started).toBeUndefined();
      expect((await second.storage.read("T-B"))?.claimToken).toBe("");
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

  it.each([0, 1])("revisits durable overflow with C=1 and Q=%i", async (queued) => {
    const backend = AiTestBackend.create({
      ref: ModelRef.of(`capacity-overflow-${String(queued)}`, "v1"),
      kind: "generation",
    });
    const responses = backend.forModel(model);
    const gate = responses.delay();
    for (const ticket of ["T-A", "T-B", "T-C"])
      responses.respondWith(create(ProposedSupportReplySchema, { reply: `Reply ${ticket}` }));
    const { ai } = registry(backend, 1, queued);
    const { box, storage } = await contextBox(`CapacityOverflow${String(queued)}`, ai);
    try {
      expect((await post(box, "T-A")).kind).toBe("ok");
      await box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 1,
      );
      for (const ticket of ["T-B", "T-C"]) expect((await post(box, ticket)).kind).toBe("ok");
      await box.eventually(
        () => storage.read("T-C"),
        (record) => !!record,
      );
      expect((await storage.read("T-B"))?.started).toBeUndefined();
      expect((await storage.read("T-C"))?.started).toBeUndefined();
      expect(backend.requests()).toHaveLength(1);
      gate.release();
      await produced(box, 3);
      expect(backend.requests()).toHaveLength(3);
      backend.assertSatisfied();
    } finally {
      gate.release();
      await box.close();
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
    const { box, storage } = await contextBox("CapacityParallel", ai);
    try {
      expect((await post(box, "T-A")).kind).toBe("ok");
      expect((await post(box, "T-B")).kind).toBe("ok");
      await box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 2,
      );
      expect((await storage.read("T-A"))?.started).toBeDefined();
      expect((await storage.read("T-B"))?.started).toBeDefined();
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

  it("starts a queued signal's deadline when promoted after Time advances", async () => {
    let offsetMillis = 0;
    let previous: ReturnType<typeof Time.setProvider> | undefined;
    const backend = AiTestBackend.create({
      ref: ModelRef.of("capacity-deadline", "v1"),
      kind: "generation",
    });
    const responses = backend.forModel(model);
    const gate = responses.delay();
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply A" }));
    responses.respondWith(create(ProposedSupportReplySchema, { reply: "Reply B" }));
    const { ai } = registry(backend, 1, 1);
    const { box, storage } = await contextBox("CapacityDeadline", ai);
    try {
      expect((await post(box, "T-A")).kind).toBe("ok");
      await box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 1,
      );
      previous = Time.setProvider({
        currentTime: () => {
          const currentMillis = Date.now() + offsetMillis;
          return create(TimestampSchema, {
            seconds: BigInt(Math.trunc(currentMillis / 1_000)),
            nanos: (currentMillis % 1_000) * 1_000_000,
          });
        },
      });
      expect((await post(box, "T-B")).kind).toBe("ok");
      await box.eventually(
        () => storage.read("T-B"),
        (record) => !!record,
      );
      expect((await storage.read("T-B"))?.started).toBeUndefined();
      offsetMillis = 2_000;
      const promotedAt = Time.currentTimeMillis();
      gate.release();
      await produced(box, 2);
      const started = (await storage.read("T-B"))?.started;
      const deadline = started?.deadline;
      if (!deadline) throw new Error("Expected promoted invocation deadline.");
      expect(
        Number(deadline.seconds) * 1_000 + Math.floor(deadline.nanos / 1_000_000),
      ).toBeGreaterThanOrEqual(promotedAt + 5_000);
      backend.assertSatisfied();
    } finally {
      gate.release();
      await box.close();
      if (previous) Time.setProvider(previous);
    }
  }, 15_000);

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
    const second = await contextBox("CapacityCloseB", ai);
    try {
      expect((await post(first.box, "T-A")).kind).toBe("ok");
      await first.box.eventually(
        () => backend.requests(),
        (requests) => requests.length === 1,
      );
      expect((await post(second.box, "T-B")).kind).toBe("ok");
      await second.box.eventually(
        () => second.storage.read("T-B"),
        (record) => !!record,
      );
      expect((await second.storage.read("T-B"))?.started).toBeUndefined();
      await first.box.close();
      gate.release();
      await produced(second.box, 1);
      expect(backend.requests()).toHaveLength(2);
    } finally {
      gate.release();
      await Promise.all([first.box.close(), second.box.close()]);
    }
  }, 15_000);

  it("bounds an ignored model callback on A close without committing its late result", async () => {
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
    const second = await contextBox("CapacityIgnoredB", ai);
    try {
      expect((await post(first.box, "T-A")).kind).toBe("ok");
      await held.entered.promise;
      expect(first.box.assertEvents()).toEqual([]);
      expect((await post(second.box, "T-B")).kind).toBe("ok");
      await second.box.eventually(
        () => second.storage.read("T-B"),
        (record) => !!record,
      );
      expect((await second.storage.read("T-B"))?.started).toBeUndefined();
      await first.box.close();
      held.release.resolve(undefined);
      await held.returned.promise;
      await produced(second.box, 1);
      expect(first.storage.completed).toBe(0);
      expect(second.storage.completed).toBe(1);
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
    const { box, storage } = await contextBox("CapacityPreference", ai, PreferenceCapacityAgent);
    try {
      expect((await post(box, "T-P", "Prefer alternate")).kind).toBe("ok");
      await box.eventually(
        () => primary.requests(),
        (requests) => requests.length === 1,
      );
      expect(alternate.requests()).toHaveLength(0);
      expect((await post(box, "T-P", "After preference")).kind).toBe("ok");
      await box.eventually(
        () => storage.accepted.length,
        (count) => count === 2,
      );
      const waiting = await storage.accepted[1]?.();
      expect(waiting?.started).toBeUndefined();
      expect(primary.requests()).toHaveLength(1);
      expect(alternate.requests()).toHaveLength(0);
      gate.release();
      const events = await produced(box, 2);
      expect(
        events.map((event) =>
          event.message
            ? AnyMessages.unpack(event.message, SupportReplyProposedSchema)?.reply
            : undefined,
        ),
      ).toEqual(["Original reply", "Alternate reply"]);
      expect(primary.requests()).toHaveLength(1);
      expect(alternate.requests()).toHaveLength(1);
      const firstSaved = await storage.accepted[0]?.();
      expect(firstSaved?.completion?.preferences[0]?.selection.case).toBe("model");
      primary.assertSatisfied();
      alternate.assertSatisfied();
    } finally {
      gate.release();
      await box.close();
    }
  });
});
