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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  CommandContextSchema,
  ActorContextSchema,
  UserIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
// prettier-ignore
import {
  CommandDispatchedToHandlerSchema,
} from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { EntityTypeNameSchema } from "@spine-event-engine/proto/generated/spine/system/server/entity_type_pb.js";
import {
  AgentHistoryCursorSchema,
  AgentHistoryEntrySchema,
  AiContentDigestSchema,
  AiOperationIdSchema,
  ConversationIdSchema,
  ConversationRecordIdSchema,
  ConversationRecordSchema,
  GenerationRequestSchema,
} from "@spine-event-engine/proto/agent";
import type { ConversationId } from "@spine-event-engine/proto/agent";
import type { HistoryRead } from "@spine-event-engine/ai";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { AgentHistoryStorageFactories } from "@spine-event-engine/storage/provider";
import type { AgentHistoryStorage } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { Agent } from "../../src/entity/entity.js";
import { AgentHistoryReads } from "../../src/agent/agent-history.js";
import {
  SupportReplyAgentIdSchema,
  type SupportReplyAgentId,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { SupportReplyDraftedSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";

class ReadingAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  readFull(request: HistoryRead) {
    return this.fullHistory(request);
  }

  readConversation(conversation: ConversationId, request: HistoryRead = { pageSize: 1 }) {
    return this.conversationHistory({ ...request, conversation });
  }

  readSystem(request: HistoryRead) {
    return this.systemEventHistory(request);
  }

  readDomain(request: HistoryRead) {
    return this.domainEventHistory(request);
  }
}

describe("Agent history binding", () => {
  it("requires repository history and returns an empty provider-backed page", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-46" });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    await expect(agent.readFull({ pageSize: 1 })).rejects.toThrow(
      "Agent history is available only from repository execution.",
    );
    expect(() =>
      AgentHistoryReads.withJournal(agent, async (_scope, _view, _request, live) => live()),
    ).toThrow("Agent history is available only from repository execution.");
    let readCount = 0;
    const storage: AgentHistoryStorage<SupportReplyAgentId> = {
      append: () => Promise.resolve(),
      read: (request) => {
        expect(request.entityId).toEqual(id);
        expect(["full", "conversation"]).toContain(request.view.kind);
        readCount += 1;
        return Promise.resolve({ entries: [], hasMore: false });
      },
      close: () => undefined,
    };
    AgentHistoryReads.bind(agent, {
      storage,
      entityId: id,
      scope: {
        context: "Support",
        tenant: "tenant-1",
        repository: "SupportReplyAgent",
        entity: "T-46",
      },
    });
    expect(await agent.readFull({ pageSize: 1001 })).toEqual({ items: [] });
    expect(readCount).toBe(1);
    await expect(
      agent.readConversation(create(ConversationIdSchema, { value: "c-1" })),
    ).resolves.toEqual({ items: [] });
  });

  it("pages original emitted Events above 100 records and binds cursors to method and Agent", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = AgentHistoryStorageFactories.create(factory, {
      context: { name: "Support", multitenant: false },
      stateType: SupportReplyAgentStateSchema.typeName,
      id: { key: (id: SupportReplyAgentId) => id.ticketNumber },
    });
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    AgentHistoryReads.bind(agent, {
      storage,
      entityId: id,
      scope: {
        context: "Support",
        tenant: "null",
        repository: SupportReplyAgentStateSchema.typeName,
        entity: id.ticketNumber,
      },
    });
    for (let index = 0; index < 121; index += 1) {
      const timestamp = create(TimestampSchema, { seconds: 2n, nanos: index });
      const event = create(EventSchema, {
        id: create(EventIdSchema, { value: `event-${index.toString().padStart(3, "0")}` }),
        message: AnyMessages.pack(
          SupportReplyDraftedSchema,
          create(SupportReplyDraftedSchema, {
            agent: id,
            reply: `Reply ${index.toString()}`,
          }),
        ),
        context: create(EventContextSchema, { timestamp }),
      });
      await storage.append(
        id,
        create(AgentHistoryEntrySchema, {
          occurredAt: timestamp,
          item: { case: "domainEvent", value: event },
        }),
      );
    }
    const first = await agent.readDomain({ pageSize: 105 });
    expect(first.items).toHaveLength(105);
    expect(first.items[0]?.id?.value).toBe("event-120");
    if (first.nextCursor === undefined) throw new Error("Expected Agent history continuation.");
    const second = await agent.readDomain({ pageSize: 19, cursor: first.nextCursor });
    expect(second.items).toHaveLength(16);
    expect(second.nextCursor).toBeUndefined();
    expect([...first.items, ...second.items].map((event) => event.id?.value)).toHaveLength(121);
    await expect(agent.readFull({ pageSize: 1, cursor: first.nextCursor })).rejects.toThrow(
      "Invalid Agent history cursor",
    );
    await expect(agent.readSystem({ pageSize: 1, cursor: first.nextCursor })).rejects.toThrow(
      "Invalid Agent history cursor",
    );
    const otherId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-48" });
    const otherAgent = new ReadingAgent({
      id: otherId,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id: otherId }),
      version: create(VersionSchema),
    });
    AgentHistoryReads.bind(otherAgent, {
      storage,
      entityId: otherId,
      scope: {
        context: "Support",
        tenant: "null",
        repository: SupportReplyAgentStateSchema.typeName,
        entity: otherId.ticketNumber,
      },
    });
    await expect(otherAgent.readDomain({ pageSize: 1, cursor: first.nextCursor })).rejects.toThrow(
      "Invalid Agent history cursor",
    );
    await expect(
      agent.readDomain({ pageSize: 1, cursor: create(AgentHistoryCursorSchema, { value: "bad" }) }),
    ).rejects.toThrow("Invalid Agent history cursor");
    await expect(
      agent.readDomain({ pageSize: 1, cursor: create(AgentHistoryCursorSchema, { value: "e30" }) }),
    ).rejects.toThrow("Invalid Agent history cursor");
    const oversized = create(AgentHistoryCursorSchema, { value: "A".repeat(9_000_000) });
    const decoder = vi.spyOn(Buffer, "from");
    try {
      await expect(agent.readDomain({ pageSize: 1, cursor: oversized })).rejects.toThrow(
        "Invalid Agent history cursor",
      );
      expect(decoder).not.toHaveBeenCalled();
    } finally {
      decoder.mockRestore();
    }
    const invalidKey = Buffer.from(
      JSON.stringify({
        version: 1,
        scope: {
          context: "Support",
          tenant: "null",
          repository: SupportReplyAgentStateSchema.typeName,
          entity: id.ticketNumber,
        },
        method: "domain",
        conversation: null,
        seconds: "invalid",
        nanos: 0,
        category: "domain",
        recordId: "event-1",
      }),
      "utf8",
    ).toString("base64url");
    await expect(
      agent.readDomain({
        pageSize: 1,
        cursor: create(AgentHistoryCursorSchema, { value: invalidKey }),
      }),
    ).rejects.toThrow("Invalid Agent history cursor");
    expect(await agent.readSystem({ pageSize: 1 })).toEqual({ items: [] });
    storage.close();
  });

  it("reuses a journaled page without asking live storage again", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-replay" });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    const scope = {
      context: "Support",
      tenant: "null",
      repository: SupportReplyAgentStateSchema.typeName,
      entity: id.ticketNumber,
    };
    const saved = {
      entries: [
        create(AgentHistoryEntrySchema, {
          occurredAt: create(TimestampSchema, { seconds: 1n }),
          item: {
            case: "domainEvent" as const,
            value: create(EventSchema, {
              id: create(EventIdSchema, { value: "saved-event" }),
              context: create(EventContextSchema, {
                timestamp: create(TimestampSchema, { seconds: 1n }),
              }),
            }),
          },
        }),
      ],
      hasMore: true,
    };
    AgentHistoryReads.bind(agent, {
      entityId: id,
      scope,
      storage: {
        append: () => Promise.resolve(),
        read: () => Promise.resolve(saved),
        close: () => undefined,
      },
    });
    const original = await agent.readFull({ pageSize: 1 });
    expect(original.nextCursor?.value).toBeTruthy();
    let liveReads = 0;
    AgentHistoryReads.bind(agent, {
      entityId: id,
      scope,
      storage: {
        append: () => Promise.resolve(),
        read: () => {
          liveReads += 1;
          return Promise.reject(new Error("Live history changed during recovery."));
        },
        close: () => undefined,
      },
      journal: (seenScope, view, request) => {
        expect(seenScope).toEqual(scope);
        expect(view).toEqual({ kind: "full" });
        expect(request).toEqual({ pageSize: 1 });
        return Promise.resolve(saved);
      },
    });
    expect(await agent.readFull({ pageSize: 1 })).toEqual(original);
    expect(liveReads).toBe(0);
  });

  it("accepts a valid cursor containing long typed identifiers", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "A".repeat(200_000) });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    const entry = create(AgentHistoryEntrySchema, {
      occurredAt: create(TimestampSchema, { seconds: 1n }),
      item: {
        case: "domainEvent",
        value: create(EventSchema, {
          id: create(EventIdSchema, { value: "event-" + "B".repeat(200_000) }),
          context: create(EventContextSchema, {
            timestamp: create(TimestampSchema, { seconds: 1n }),
          }),
        }),
      },
    });
    AgentHistoryReads.bind(agent, {
      entityId: id,
      scope: {
        context: "Support",
        tenant: "null",
        repository: SupportReplyAgentStateSchema.typeName,
        entity: id.ticketNumber,
      },
      maxBytes: 300_000,
      storage: {
        append: () => Promise.resolve(),
        read: (request) =>
          Promise.resolve(
            request.after === undefined
              ? { entries: [entry], hasMore: true }
              : { entries: [], hasMore: false },
          ),
        close: () => undefined,
      },
    });
    const first = await agent.readFull({ pageSize: 1 });
    expect(first.nextCursor?.value.length).toBeGreaterThan(500_000);
    const cursor = first.nextCursor;
    if (cursor === undefined) throw new Error("Expected a continuation cursor.");
    expect(await agent.readFull({ pageSize: 1, cursor })).toEqual({ items: [] });
  });

  it("continues equal-time category ties and isolates explicit conversations", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = AgentHistoryStorageFactories.create(factory, {
      context: { name: "Support", multitenant: false },
      stateType: SupportReplyAgentStateSchema.typeName,
      id: { key: (id: SupportReplyAgentId) => id.ticketNumber },
    });
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-ties" });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    AgentHistoryReads.bind(agent, {
      storage,
      entityId: id,
      scope: {
        context: "Support",
        tenant: "null",
        repository: SupportReplyAgentStateSchema.typeName,
        entity: id.ticketNumber,
      },
    });
    const time = create(TimestampSchema, { seconds: 20n, nanos: 901 });
    const conversationOne = create(ConversationIdSchema, { value: "c-1" });
    const conversationTwo = create(ConversationIdSchema, { value: "c-2" });
    for (const [recordId, conversation] of [
      ["r-1", conversationOne],
      ["r-2", conversationTwo],
    ] as const) {
      const record = create(ConversationRecordSchema, {
        id: create(ConversationRecordIdSchema, { value: recordId }),
        conversation,
        operation: create(AiOperationIdSchema, { value: "draft-reply" }),
        occurredAt: time,
        content: AnyMessages.pack(
          GenerationRequestSchema,
          create(GenerationRequestSchema, {
            input: AnyMessages.pack(
              DraftSupportReplySchema,
              create(DraftSupportReplySchema, {
                agent: id,
                question: "Delivery status?",
              }),
            ),
            instructions: "Draft a reply for review.",
            outputSchemaJson: "{}",
            promptJson: "[]",
            digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
          }),
        ),
      });
      await storage.append(
        id,
        create(AgentHistoryEntrySchema, {
          occurredAt: time,
          item: { case: "conversationRecord", value: record },
        }),
      );
    }
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-1" }),
      message: AnyMessages.pack(
        SupportReplyDraftedSchema,
        create(SupportReplyDraftedSchema, {
          agent: id,
          reply: "Draft for human review",
        }),
      ),
      context: create(EventContextSchema, { timestamp: time }),
    });
    await storage.append(
      id,
      create(AgentHistoryEntrySchema, {
        occurredAt: time,
        item: { case: "domainEvent", value: event },
      }),
    );
    const first = await agent.readFull({ pageSize: 1 });
    if (first.nextCursor === undefined) throw new Error("Expected first continuation.");
    const second = await agent.readFull({ pageSize: 1, cursor: first.nextCursor });
    if (second.nextCursor === undefined) throw new Error("Expected second continuation.");
    const third = await agent.readFull({ pageSize: 1, cursor: second.nextCursor });
    expect([
      first.items[0]?.item.case,
      second.items[0]?.item.case,
      third.items[0]?.item.case,
    ]).toEqual(["conversationRecord", "conversationRecord", "domainEvent"]);
    expect(third.nextCursor).toBeUndefined();
    const conversationPage = await agent.readConversation(conversationOne);
    expect(conversationPage.items.map((record) => record.id?.value)).toEqual(["r-1"]);
    await expect(
      agent.readConversation(conversationTwo, { pageSize: 1, cursor: first.nextCursor }),
    ).rejects.toThrow("Invalid Agent history cursor");
    storage.close();
  });

  it("records an original System envelope and rejects malformed read bounds", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-audit" });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    const factory = new InMemoryStorageFactory();
    const storage = AgentHistoryStorageFactories.create(factory, {
      context: { name: "Support", multitenant: false },
      stateType: SupportReplyAgentStateSchema.typeName,
      id: { key: (value: SupportReplyAgentId) => value.ticketNumber },
    });
    expect(() => AgentHistoryReads.appendSystem(agent, create(EventSchema))).toThrow(
      "Agent history is available only from repository execution.",
    );
    AgentHistoryReads.bind(agent, {
      storage,
      entityId: id,
      scope: {
        context: "Support",
        tenant: "null",
        repository: SupportReplyAgentStateSchema.typeName,
        entity: id.ticketNumber,
      },
    });
    expect(() => AgentHistoryReads.appendSystem(agent, create(EventSchema))).toThrow(
      "Agent System Event requires its original timestamp.",
    );
    const time = create(TimestampSchema, { seconds: 42n, nanos: 3 });
    const command = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: id, question: "Delivery?" }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support" }),
        }),
      }),
    });
    const auditMessage = create(CommandDispatchedToHandlerSchema, {
      receiver: create(MessageIdSchema, {
        id: AnyMessages.pack(SupportReplyAgentIdSchema, id),
        typeUrl: "type.spine.server.testing/spine.server.testing.SupportReplyAgentState",
      }),
      payload: command,
      whenDispatched: time,
      entityType: create(EntityTypeNameSchema, {
        impl: { case: "javaClassName", value: "SupportReplyAgent" },
      }),
    });
    const audit = create(EventSchema, {
      id: create(EventIdSchema, { value: "audit-1" }),
      context: create(EventContextSchema, { timestamp: time }),
      message: AnyMessages.pack(CommandDispatchedToHandlerSchema, auditMessage),
    });
    await AgentHistoryReads.appendSystem(agent, audit);
    expect((await agent.readSystem({ pageSize: 1 })).items).toEqual([audit]);
    await expect(agent.readFull({ pageSize: 0 })).rejects.toThrow(
      "pageSize must be a positive safe integer",
    );
    await expect(agent.readConversation(create(ConversationIdSchema))).rejects.toThrow(
      "requires a ConversationId",
    );
    storage.close();
  });

  it("rejects an invalid byte bound and an empty provider continuation", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-limits" });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    const storage: AgentHistoryStorage<SupportReplyAgentId> = {
      append: () => Promise.resolve(),
      read: () => Promise.resolve({ entries: [], hasMore: true }),
      close: () => undefined,
    };
    const scope = {
      context: "Support",
      tenant: "null",
      repository: SupportReplyAgentStateSchema.typeName,
      entity: id.ticketNumber,
    };
    AgentHistoryReads.bind(agent, { storage, entityId: id, scope, maxBytes: 0 });
    await expect(agent.readFull({ pageSize: 1 })).rejects.toThrow(
      "maxBytes must be a positive safe integer",
    );
    AgentHistoryReads.bind(agent, { storage, entityId: id, scope });
    await expect(agent.readFull({ pageSize: 1 })).rejects.toThrow("empty continuation");
  });

  it("rejects provider pages that contain another history category", async () => {
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-category" });
    const agent = new ReadingAgent({
      id,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id }),
      version: create(VersionSchema),
    });
    const wrong = create(AgentHistoryEntrySchema, {
      item: { case: "domainEvent", value: create(EventSchema) },
    });
    AgentHistoryReads.bind(agent, {
      entityId: id,
      scope: {
        context: "Support",
        tenant: "null",
        repository: SupportReplyAgentStateSchema.typeName,
        entity: id.ticketNumber,
      },
      storage: {
        append: () => Promise.resolve(),
        read: () => Promise.resolve({ entries: [wrong], hasMore: false }),
        close: () => undefined,
      },
    });
    await expect(agent.readSystem({ pageSize: 1 })).rejects.toThrow("wrong category");
    await expect(
      agent.readConversation(create(ConversationIdSchema, { value: "c-1" })),
    ).rejects.toThrow("wrong category");
    AgentHistoryReads.bind(agent, {
      entityId: id,
      scope: {
        context: "Support",
        tenant: "null",
        repository: SupportReplyAgentStateSchema.typeName,
        entity: id.ticketNumber,
      },
      storage: {
        append: () => Promise.resolve(),
        read: () =>
          Promise.resolve({
            entries: [
              create(AgentHistoryEntrySchema, {
                item: { case: "systemEvent", value: create(EventSchema) },
              }),
            ],
            hasMore: false,
          }),
        close: () => undefined,
      },
    });
    await expect(agent.readDomain({ pageSize: 1 })).rejects.toThrow("wrong category");
  });
});
