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

import { clone, create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AiModel, AiRegistry, ModelRef, type HistoryPage } from "@spine-event-engine/ai";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { Time } from "@spine-event-engine/core/time";
// prettier-ignore
import {
  CommandDispatchedToHandlerSchema,
} from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { EntityTypeNameSchema } from "@spine-event-engine/proto/generated/spine/system/server/entity_type_pb.js";
import {
  AgentHistoryEntrySchema,
  type AgentHistoryCursor,
  AiContentDigestSchema,
  AiOperationIdSchema,
  ConversationIdSchema,
  ConversationRecordIdSchema,
  ConversationRecordSchema,
  GenerationRequestSchema,
} from "@spine-event-engine/proto/agent";
import {
  ActorContextSchema,
  EventIdSchema,
  CommandContextSchema,
  EventContextSchema,
  EventSchema,
  MessageIdSchema,
  TenantIdSchema,
} from "@spine-event-engine/proto";
import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
import { AgentHistoryStorageFactories } from "@spine-event-engine/storage/provider";
import type {
  AgentHistoryStorage,
  AgentHistoryStorageInput,
} from "@spine-event-engine/storage/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../../src/entity/entity.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { Repository } from "../../src/repository/repository.js";
import { repositoryAccess } from "../../src/repository/repository.js";
import { EnvironmentType } from "../../src/server/environment.js";
import {
  ServerEnvironment,
  ServerEnvironmentLifecycle,
  serverEnvironmentAccess,
} from "../../src/server/server-environment.js";
import { HandlerMetadataValues } from "../../src/handler/handler-metadata.js";
import {
  SupportReplyAgentIdSchema,
  type SupportReplyAgentId,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  DraftSupportReplySchema,
  type DraftSupportReply,
} from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import {
  SupportReplyDraftedSchema,
  type SupportReplyDrafted,
} from "../../test-fixtures/generated/entity-metadata/support_agent_events_pb.js";

class WaitingSupportAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  static latest: WaitingSupportAgent | undefined;
  static entered: (() => void) | undefined;
  static gate: Promise<void> | undefined;
  static invokeAfterWait = false;

  async draft(command: DraftSupportReply): Promise<SupportReplyDrafted> {
    WaitingSupportAgent.latest = this;
    WaitingSupportAgent.entered?.();
    if (command.question === "Wait for service") await WaitingSupportAgent.gate;
    if (command.question === "Wait for service" && WaitingSupportAgent.invokeAfterWait)
      await this.ai.invoke(proposal, {
        call: "draft",
        conversation: create(ConversationIdSchema, { value: "late-support" }),
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: this.id.ticketNumber }),
          customerQuestion: command.question,
        }),
      });
    this.update((state) => Object.assign(state, { id: this.id, proposedReply: "Ready" }));
    return create(SupportReplyDraftedSchema, { agent: this.id, reply: "Ready" });
  }

  readBoundHistory(): Promise<HistoryPage<unknown>> {
    return this.fullHistory({ pageSize: 1 });
  }
}

function waitingRepository(withModel = false) {
  return new Repository({
    entityType: WaitingSupportAgent,
    schema: SupportReplyAgentStateSchema,
    handlers: HandlerMetadataValues.defineArity(
      WaitingSupportAgent,
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
    ai: { models: withModel ? [proposal] : [] },
    events: [SupportReplyDraftedSchema],
  });
}

class FailingAgentReadFactory extends InMemoryStorageFactory {
  createdHistory = 0;
  closedHistory = 0;

  protected override createAgentHistoryStorage<Id>(
    input: AgentHistoryStorageInput<Id>,
  ): AgentHistoryStorage<Id> {
    this.createdHistory += 1;
    const storage = super.createAgentHistoryStorage(input);
    const close = storage.close.bind(storage);
    storage.read = () => Promise.reject(new Error("history provider unavailable"));
    storage.close = () => {
      this.closedHistory += 1;
      close();
    };
    return storage;
  }
}

class CountingAgentHistoryFactory extends InMemoryStorageFactory {
  failNextHistory = false;
  historyOpens = 0;
  historyCloses = 0;

  protected override createAgentHistoryStorage<Id>(
    input: AgentHistoryStorageInput<Id>,
  ): AgentHistoryStorage<Id> {
    if (this.failNextHistory) {
      this.failNextHistory = false;
      throw new Error("Agent history acquisition failed");
    }
    const storage = super.createAgentHistoryStorage(input);
    const close = storage.close.bind(storage);
    this.historyOpens += 1;
    storage.close = () => {
      this.historyCloses += 1;
      close();
    };
    return storage;
  }
}

class GatedProtectedAgentHistoryFactory extends CountingAgentHistoryFactory {
  armed = false;
  #entered!: () => void;
  #release!: () => void;
  readonly entered = new Promise<void>((resolve) => {
    this.#entered = resolve;
  });
  readonly gate = new Promise<void>((resolve) => {
    this.#release = resolve;
  });

  protected override createAgentHistoryStorage<Id>(
    input: AgentHistoryStorageInput<Id>,
  ): AgentHistoryStorage<Id> {
    const storage = super.createAgentHistoryStorage(input);
    const read = storage.read.bind(storage);
    storage.read = async (request) => {
      if (this.armed) {
        this.#entered();
        await this.gate;
      }
      return read(request);
    };
    return storage;
  }

  release(): void {
    this.#release();
  }
}

const ai = (defaultModel?: ModelRef, deadlineMs = 1_000) =>
  AiRegistry.create({
    defaultModels: defaultModel === undefined ? {} : { generation: defaultModel },
    invocationLimits: {
      operations: 1,
      modelRequests: 1,
      toolCalls: 0,
      recordedReads: 1,
      deadlineMs,
      totalInputBytes: 4000,
      totalOutputBytes: 4000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
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

async function collectHistoryIds<T>(
  read: (cursor?: AgentHistoryCursor) => Promise<HistoryPage<T>>,
  key: (item: T) => string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: AgentHistoryCursor | undefined;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await read(cursor);
    ids.push(...page.items.map(key));
    if (page.nextCursor === undefined) return ids;
    expect(page.nextCursor.value).not.toBe(cursor?.value);
    cursor = page.nextCursor;
  }
  throw new Error("Agent history did not reach an older-page boundary.");
}

async function configureStorage(factory: StorageFactory): Promise<void> {
  await ServerEnvironmentLifecycle.resetForTest();
  ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: factory });
  await ServerEnvironment.instance().completeSetup();
}

afterEach(async () => {
  const environment = ServerEnvironment.instance();
  for (const context of serverEnvironmentAccess.openContexts(environment)) await context.close();
  await ServerEnvironmentLifecycle.resetForTest();
});

describe("Agent registration readiness", () => {
  it("inherits environment AI and accepts a Bounded Context override", async () => {
    const inherited = ai();
    const override = ai();
    await ServerEnvironmentLifecycle.resetForTest();
    ServerEnvironment.when(EnvironmentType.Local).use({ ai: inherited });
    const environment = ServerEnvironment.instance();
    expect(environment.ai).toBe(inherited);
    await environment.completeSetup();
    const first = await BoundedContext.singleTenant("InheritedAgentAi")
      .persistSystemEvents()
      .add(waitingRepository())
      .build();
    await first.close();
    const second = await BoundedContext.singleTenant("OverriddenAgentAi")
      .withAi(override)
      .persistSystemEvents()
      .add(waitingRepository())
      .build();
    await second.close();
  });

  it("still rejects Agent registration without environment or Bounded Context AI", async () => {
    await configureStorage(new InMemoryStorageFactory());
    await expect(
      BoundedContext.singleTenant("MissingAgentAi")
        .persistSystemEvents()
        .add(waitingRepository())
        .build(),
    ).rejects.toThrow("Agent registration requires an AI registry.");
  });

  it("drains protected Agent history reads and rejects an old Agent after rebind", async () => {
    const factory = new GatedProtectedAgentHistoryFactory();
    await configureStorage(factory);
    const configured = waitingRepository();
    const context = await BoundedContext.singleTenant("ProtectedAgentHistory")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-protected-history" });
    await context.commandBus().post(
      SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Draft" }),
        context: create(CommandContextSchema, { actorContext: create(ActorContextSchema) }),
      }),
    );
    await vi.waitFor(() => {
      expect(WaitingSupportAgent.latest).toBeDefined();
    });
    factory.armed = true;
    const agent = WaitingSupportAgent.latest;
    if (agent === undefined) throw new Error("Expected live Agent.");
    const admitted = agent.readBoundHistory();
    await factory.entered;
    const closing = repositoryAccess.clearRuntime(configured);
    expect(factory.historyCloses).toBe(0);
    await expect(agent.readBoundHistory()).rejects.toThrow("active runtime");
    factory.release();
    expect((await admitted).items).toHaveLength(1);
    await closing;
    expect(factory.historyCloses).toBe(1);
    await context.close();
    const rebound = await BoundedContext.singleTenant("ProtectedAgentHistory")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    try {
      await expect(agent.readBoundHistory()).rejects.toThrow("active runtime");
    } finally {
      await rebound.close();
    }
  });

  it("closes retained Agent history after public reads fail", async () => {
    const factory = new FailingAgentReadFactory();
    await configureStorage(factory);
    const configured = waitingRepository();
    const context = await BoundedContext.singleTenant("FailingAgentReads")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-failing" });
    try {
      const historyCloses = factory.closedHistory;
      await expect(configured.agentHistory(id, {}).fullHistory({ pageSize: 1 })).rejects.toThrow(
        "history provider unavailable",
      );
      await expect(configured.agentHistory(id, {}).fullHistory({ pageSize: 1 })).rejects.toThrow(
        "history provider unavailable",
      );
      expect(factory.createdHistory).toBe(1);
      expect(factory.closedHistory).toBe(historyCloses);
    } finally {
      await context.close();
    }
    expect(factory.closedHistory).toBe(1);
  });

  it("shares retained Agent audit history across public and testing reads by tenant", async () => {
    const factory = new CountingAgentHistoryFactory();
    await configureStorage(factory);
    const configured = waitingRepository();
    const context = await BoundedContext.multitenant("SharedAgentHistory")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-shared-history" });
    const tenantA = create(TenantIdSchema, { kind: { case: "value", value: "tenant-A" } });
    const tenantB = create(TenantIdSchema, { kind: { case: "value", value: "tenant-B" } });
    await context.tenantIndex.keep(tenantA);
    await context.tenantIndex.keep(tenantB);
    const before = factory.historyOpens;
    try {
      const reader = configured.agentHistory(id, { tenantId: tenantA });
      expect(await reader.fullHistory({ pageSize: 1 })).toEqual({ items: [] });
      expect(await reader.fullHistory({ pageSize: 1 })).toEqual({ items: [] });
      expect(
        await repositoryAccess.agentHistory(
          configured,
          id,
          { kind: "full" },
          { count: 1 },
          tenantA,
        ),
      ).toMatchObject({ entries: [] });
      expect(factory.historyOpens).toBe(before + 1);
      configured.setStateHistoryEnabled(true);
      expect(await reader.fullHistory({ pageSize: 1 })).toEqual({ items: [] });
      expect(factory.historyOpens).toBe(before + 1);
      expect(
        await configured.agentHistory(id, { tenantId: tenantB }).fullHistory({ pageSize: 1 }),
      ).toEqual({ items: [] });
      expect(factory.historyOpens).toBe(before + 2);
      expect(factory.historyCloses).toBe(0);
    } finally {
      await context.close();
    }
    expect(factory.historyCloses).toBe(factory.historyOpens);
  });

  it("retries Agent audit-history creation after a failed first acquisition", async () => {
    const factory = new CountingAgentHistoryFactory();
    await configureStorage(factory);
    const configured = waitingRepository();
    const context = await BoundedContext.singleTenant("RetryAgentHistory")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-retry-history" });
    factory.failNextHistory = true;
    try {
      await expect(configured.agentHistory(id, {}).fullHistory({ pageSize: 1 })).rejects.toThrow(
        "Agent history acquisition failed",
      );
      expect(factory.historyOpens).toBe(0);
      expect(await configured.agentHistory(id, {}).fullHistory({ pageSize: 1 })).toEqual({
        items: [],
      });
      expect(factory.historyOpens).toBe(1);
    } finally {
      await context.close();
    }
    expect(factory.historyCloses).toBe(1);
  });

  it("isolates public Agent history by tenant and detaches returned entries", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const configured = waitingRepository();
    const context = await BoundedContext.multitenant("TenantAgentReads")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-shared" });
    const tenantA = create(TenantIdSchema, { kind: { case: "value", value: "tenant-A" } });
    const tenantB = create(TenantIdSchema, { kind: { case: "value", value: "tenant-B" } });
    await context.tenantIndex.keep(tenantA);
    await context.tenantIndex.keep(tenantB);
    const scope = { tenantId: tenantA };
    const reader = configured.agentHistory(id, scope);
    scope.tenantId = tenantB;
    const storage = AgentHistoryStorageFactories.create(factory, {
      context: { name: "TenantAgentReads", multitenant: true, tenantId: tenantA },
      stateType: SupportReplyAgentStateSchema.typeName,
      id: {
        key: (value: SupportReplyAgentId) =>
          Buffer.from(
            toBinary(AnySchema, AnyPacker.pack(SupportReplyAgentIdSchema, value)),
          ).toString("base64"),
      },
    });
    try {
      const occurredAt = create(TimestampSchema, { seconds: 1n });
      const event = create(EventSchema, {
        id: create(EventIdSchema, { value: "tenant-event" }),
        message: AnyPacker.pack(
          SupportReplyDraftedSchema,
          create(SupportReplyDraftedSchema, { agent: id, reply: "Ready for review" }),
        ),
        context: create(EventContextSchema, { timestamp: occurredAt }),
      });
      await storage.append(
        id,
        create(AgentHistoryEntrySchema, {
          occurredAt,
          item: { case: "domainEvent", value: event },
        }),
      );
      const conversation = create(ConversationIdSchema, { value: "tenant-draft" });
      const recordAt = create(TimestampSchema, { seconds: 2n });
      const record = create(ConversationRecordSchema, {
        id: create(ConversationRecordIdSchema, { value: "tenant-request" }),
        conversation,
        operation: create(AiOperationIdSchema, { value: "draft-support" }),
        occurredAt: recordAt,
        content: AnyPacker.pack(
          GenerationRequestSchema,
          create(GenerationRequestSchema, {
            input: AnyPacker.pack(
              DraftSupportReplySchema,
              create(DraftSupportReplySchema, { agent: id, question: "Delivery?" }),
            ),
            instructions: "Draft for review.",
            outputSchemaJson: "{}",
            promptJson: "[]",
            digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
          }),
        ),
      });
      await storage.append(
        id,
        create(AgentHistoryEntrySchema, {
          occurredAt: recordAt,
          item: { case: "conversationRecord", value: record },
        }),
      );
      const olderRecord = clone(ConversationRecordSchema, record);
      olderRecord.id = create(ConversationRecordIdSchema, { value: "tenant-older-request" });
      olderRecord.occurredAt = create(TimestampSchema, { seconds: 0n });
      await storage.append(
        id,
        create(AgentHistoryEntrySchema, {
          occurredAt: olderRecord.occurredAt,
          item: { case: "conversationRecord", value: olderRecord },
        }),
      );
      const first = await reader.domainEventHistory({ pageSize: 1 });
      expect(first.items.map((item) => item.id?.value)).toEqual(["tenant-event"]);
      const returnedId = first.items[0]?.id;
      if (returnedId === undefined) throw new Error("Expected returned Event ID.");
      returnedId.value = "locally-mutated";
      expect((await reader.domainEventHistory({ pageSize: 1 })).items[0]?.id?.value).toBe(
        "tenant-event",
      );
      expect(
        (await reader.conversationHistory({ pageSize: 1, conversation })).items[0]?.id?.value,
      ).toBe("tenant-request");
      const firstConversation = await reader.conversationHistory({ pageSize: 1, conversation });
      if (firstConversation.nextCursor === undefined) throw new Error("Expected continuation.");
      const secondConversation = await reader.conversationHistory({
        pageSize: 1,
        conversation,
        cursor: firstConversation.nextCursor,
      });
      expect(secondConversation.items.map((item) => item.id?.value)).toEqual([
        "tenant-older-request",
      ]);
      expect(secondConversation.nextCursor).toBeUndefined();
      await expect(
        configured.agentHistory(id, { tenantId: tenantB }).conversationHistory({
          pageSize: 1,
          conversation,
          cursor: firstConversation.nextCursor,
        }),
      ).rejects.toThrow("Invalid Agent history cursor");
      expect(
        await configured.agentHistory(id, { tenantId: tenantB }).fullHistory({ pageSize: 1 }),
      ).toEqual({ items: [] });
      expect(() => configured.agentHistory(id, {})).toThrow("requires tenantId");
      expect(() =>
        configured.agentHistory(create(TenantIdSchema) as unknown as SupportReplyAgentId, {
          tenantId: tenantA,
        }),
      ).toThrow("requires a");
      expect(() =>
        configured.agentHistory(id, null as unknown as { tenantId?: typeof tenantA }),
      ).toThrow("explicit scope");
      await expect(
        reader.conversationHistory({
          pageSize: 1,
          conversation: create(ConversationIdSchema),
        }),
      ).rejects.toThrow("requires a ConversationId");
    } finally {
      storage.close();
      await context.close();
    }
  });

  it("pages more than 100 retained typed entries across every public history view", async () => {
    const factory = new InMemoryStorageFactory();
    await configureStorage(factory);
    const configured = waitingRepository();
    const context = await BoundedContext.singleTenant("PagedAgentReads")
      .withAi(ai())
      .persistSystemEvents()
      .add(configured)
      .build();
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-paged" });
    const conversation = create(ConversationIdSchema, { value: "paged-draft" });
    const storage = AgentHistoryStorageFactories.create(factory, {
      context: { name: "PagedAgentReads", multitenant: false },
      stateType: SupportReplyAgentStateSchema.typeName,
      id: {
        key: (value: SupportReplyAgentId) =>
          Buffer.from(
            toBinary(AnySchema, AnyPacker.pack(SupportReplyAgentIdSchema, value)),
          ).toString("base64"),
      },
    });
    let nanos = 0;
    const previousTime = Time.setProvider({
      currentTime: () => create(TimestampSchema, { seconds: 1_782_979_201n, nanos: nanos++ }),
    });
    const fullExpected: string[] = [];
    const domainExpected: string[] = [];
    const systemExpected: string[] = [];
    const conversationExpected: string[] = [];
    try {
      const command = SignalEnvelopes.command({
        schema: DraftSupportReplySchema,
        message: create(DraftSupportReplySchema, { agent: id, question: "Delivery?" }),
        context: create(CommandContextSchema, { actorContext: create(ActorContextSchema) }),
      });
      for (let index = 0; index < 121; index += 1) {
        const suffix = index.toString().padStart(3, "0");
        const domainAt = Time.currentTime();
        const domainId = `domain-${suffix}`;
        const domain = create(EventSchema, {
          id: create(EventIdSchema, { value: domainId }),
          context: create(EventContextSchema, { timestamp: domainAt }),
          message: AnyPacker.pack(
            SupportReplyDraftedSchema,
            create(SupportReplyDraftedSchema, { agent: id, reply: `Draft ${suffix}` }),
          ),
        });
        await storage.append(
          id,
          create(AgentHistoryEntrySchema, {
            occurredAt: domainAt,
            item: { case: "domainEvent", value: domain },
          }),
        );
        domainExpected.unshift(domainId);
        fullExpected.unshift(`domain:${domainId}`);

        const systemAt = Time.currentTime();
        const systemId = `system-${suffix}`;
        const system = create(EventSchema, {
          id: create(EventIdSchema, { value: systemId }),
          context: create(EventContextSchema, { timestamp: systemAt }),
          message: AnyPacker.pack(
            CommandDispatchedToHandlerSchema,
            create(CommandDispatchedToHandlerSchema, {
              receiver: create(MessageIdSchema, {
                id: AnyPacker.pack(SupportReplyAgentIdSchema, id),
                typeUrl: TypeUrls.derive(SupportReplyAgentStateSchema),
              }),
              payload: command,
              whenDispatched: systemAt,
              entityType: create(EntityTypeNameSchema, {
                impl: { case: "javaClassName", value: "WaitingSupportAgent" },
              }),
            }),
          ),
        });
        await storage.append(
          id,
          create(AgentHistoryEntrySchema, {
            occurredAt: systemAt,
            item: { case: "systemEvent", value: system },
          }),
        );
        systemExpected.unshift(systemId);
        fullExpected.unshift(`system:${systemId}`);

        const recordAt = Time.currentTime();
        const recordId = `conversation-${suffix}`;
        const record = create(ConversationRecordSchema, {
          id: create(ConversationRecordIdSchema, { value: recordId }),
          conversation,
          operation: create(AiOperationIdSchema, { value: "draft-support" }),
          occurredAt: recordAt,
          content: AnyPacker.pack(
            GenerationRequestSchema,
            create(GenerationRequestSchema, {
              input: AnyPacker.pack(
                DraftSupportReplySchema,
                create(DraftSupportReplySchema, { agent: id, question: "Delivery?" }),
              ),
              instructions: "Draft for review.",
              outputSchemaJson: "{}",
              promptJson: "[]",
              digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
            }),
          ),
        });
        await storage.append(
          id,
          create(AgentHistoryEntrySchema, {
            occurredAt: recordAt,
            item: { case: "conversationRecord", value: record },
          }),
        );
        conversationExpected.unshift(recordId);
        fullExpected.unshift(`conversation:${recordId}`);
      }
      const reader = configured.agentHistory(id, {});
      const full = await collectHistoryIds(
        (cursor) =>
          reader.fullHistory({ pageSize: 57, ...(cursor === undefined ? {} : { cursor }) }),
        (entry) => {
          if (entry.item.case === "conversationRecord")
            return `conversation:${entry.item.value.id?.value ?? ""}`;
          if (entry.item.case === "systemEvent")
            return `system:${entry.item.value.id?.value ?? ""}`;
          if (entry.item.case === "domainEvent")
            return `domain:${entry.item.value.id?.value ?? ""}`;
          throw new Error("Unexpected Agent history category.");
        },
      );
      const domain = await collectHistoryIds(
        (cursor) =>
          reader.domainEventHistory({ pageSize: 43, ...(cursor === undefined ? {} : { cursor }) }),
        (event) => event.id?.value ?? "",
      );
      const system = await collectHistoryIds(
        (cursor) =>
          reader.systemEventHistory({ pageSize: 43, ...(cursor === undefined ? {} : { cursor }) }),
        (event) => event.id?.value ?? "",
      );
      const records = await collectHistoryIds(
        (cursor) =>
          reader.conversationHistory({
            pageSize: 43,
            conversation,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        (record) => record.id?.value ?? "",
      );
      expect(full).toEqual(fullExpected);
      expect(domain).toEqual(domainExpected);
      expect(system).toEqual(systemExpected);
      expect(records).toEqual(conversationExpected);
      expect(new Set(full).size).toBe(363);
    } finally {
      Time.setProvider(previousTime);
      storage.close();
      await context.close();
    }
  });
});
