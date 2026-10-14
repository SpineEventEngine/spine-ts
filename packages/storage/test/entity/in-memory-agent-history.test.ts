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
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
} from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  AiOperationIdSchema,
  ConversationIdSchema,
  ConversationRecordIdSchema,
  ConversationRecordSchema,
  AiContentDigestSchema,
  AiModelKind,
  AiOutcome,
  GenerationRequestSchema,
  GenerationResponseSchema,
  AgentModelSelectionChangedSchema,
  type AgentHistoryEntry,
} from "@spine-event-engine/proto/agent";
import { describe, expect, it } from "vitest";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
  ProposedSupportReplySchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import {
  conversation as storedRequest,
  response as storedResponse,
} from "./agent-history-fixtures.js";

// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
// prettier-ignore
import {
  SupportReplyAgentIdSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { AgentHistoryConformance } from "../../src/provider.js";
import { AgentHistoryStorageFactories } from "../../src/provider.js";
import type { AgentHistoryStorageInput } from "../../src/provider.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";

const scope: AgentHistoryStorageInput<string> = {
  context: { name: "Support", multitenant: false },
  stateType: "spine.server.testing.SupportReplyAgentState",
  id: { key: (ticketNumber) => ticketNumber },
};

function packed<T extends Message>(schema: GenMessage<T>, message: T) {
  return AnyMessages.pack(schema, message);
}

function occurredAt(seconds: bigint, nanos = 0): Timestamp {
  return create(TimestampSchema, { seconds, nanos });
}

function conversationRecord(
  id: string,
  conversationId: string,
  time: Timestamp,
  content: Message,
  schema: GenMessage<Message>,
): AgentHistoryEntry {
  const record = create(ConversationRecordSchema, {
    id: create(ConversationRecordIdSchema, { value: id }),
    conversation: create(ConversationIdSchema, { value: conversationId }),
    operation: create(AiOperationIdSchema, { value: "draft-reply" }),
    occurredAt: time,
    content: packed(schema, content),
  });
  return create(AgentHistoryEntrySchema, {
    occurredAt: time,
    item: { case: "conversationRecord", value: record },
  });
}

function conversation(id: string, conversationId: string, time: Timestamp): AgentHistoryEntry {
  const ticket = create(SupportReplyAgentIdSchema, { ticketNumber: "T-history" });
  const question = create(SupportTicketFactsSchema, {
    ticketNumber: create(SupportTicketNumberSchema, { value: ticket.ticketNumber }),
    customerQuestion: "Delivery?",
  });
  const request = create(GenerationRequestSchema, {
    input: packed(SupportTicketFactsSchema, question),
    instructions: "Propose a support reply.",
    promptJson: "[]",
    outputSchemaJson: "{}",
    digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
  });
  return conversationRecord(id, conversationId, time, request, GenerationRequestSchema);
}

function response(id: string, conversationId: string, time: Timestamp): AgentHistoryEntry {
  const reply = create(ProposedSupportReplySchema, { replyText: "Review this reply." });
  const result = create(GenerationResponseSchema, {
    rawOutput: "Review this reply.",
    outcome: AiOutcome.ADMITTED,
    admittedOutput: packed(ProposedSupportReplySchema, reply),
  });
  return conversationRecord(id, conversationId, time, result, GenerationResponseSchema);
}

function event(id: string, time: Timestamp, system: boolean): AgentHistoryEntry {
  const ticket = create(SupportReplyAgentIdSchema, { ticketNumber: "T-history" });
  const payload = system
    ? packed(
        AgentModelSelectionChangedSchema,
        create(AgentModelSelectionChangedSchema, {
          agent: create(MessageIdSchema, {
            id: packed(SupportReplyAgentIdSchema, ticket),
            typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
          }),
          sourceSignal: create(MessageIdSchema, {
            id: packed(EventIdSchema, create(EventIdSchema, { value: id })),
            typeUrl: TypeUrls.derive(EventIdSchema),
          }),
          kind: AiModelKind.GENERATION,
          changedAt: time,
        }),
      )
    : packed(
        SupportReplyDraftedSchema,
        create(SupportReplyDraftedSchema, { agent: ticket, reply: "Review this reply." }),
      );
  const envelope = create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, { timestamp: time }),
    message: payload,
  });
  return create(AgentHistoryEntrySchema, {
    occurredAt: time,
    item: { case: system ? "systemEvent" : "domainEvent", value: envelope },
  });
}

describe("in-memory Agent history", () => {
  it("passes reusable provider history conformance", async () => {
    const factory = new InMemoryStorageFactory();
    await AgentHistoryConformance.check({
      scope,
      open: (input) => AgentHistoryStorageFactories.create(factory, input),
      conversation,
      response,
      system: (id, time) => event(id, time, true),
      domain: (id, time) => event(id, time, false),
      occurredAt,
    });
    factory.close();
  });

  it("retrieves generation history with domain-correct unpackable payloads", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = AgentHistoryStorageFactories.create(factory, scope);
    try {
      await storage.append("T-history", storedRequest("request", "reply", occurredAt(1n)));
      await storage.append("T-history", storedResponse("response", "reply", occurredAt(2n)));
      const page = await storage.read({
        entityId: "T-history",
        view: {
          kind: "conversation",
          conversation: create(ConversationIdSchema, { value: "reply" }),
        },
        count: 2,
      });
      const request = page.entries.find(
        (entry) =>
          entry.item.case === "conversationRecord" &&
          entry.item.value.content?.typeUrl.endsWith("GenerationRequest"),
      );
      const result = page.entries.find(
        (entry) =>
          entry.item.case === "conversationRecord" &&
          entry.item.value.content?.typeUrl.endsWith("GenerationResponse"),
      );
      if (request?.item.case !== "conversationRecord" || result?.item.case !== "conversationRecord")
        throw new Error("Expected retrieved request and response.");
      if (request.item.value.content === undefined || result.item.value.content === undefined)
        throw new Error("Expected packed request and response.");
      const generation = AnyMessages.unpack(request.item.value.content, GenerationRequestSchema);
      const response = AnyMessages.unpack(result.item.value.content, GenerationResponseSchema);
      if (generation?.input === undefined || response?.admittedOutput === undefined)
        throw new Error("Expected admitted AI request and response payloads.");
      expect(AnyMessages.unpack(generation.input, SupportTicketFactsSchema)?.customerQuestion).toBe(
        "Delivery?",
      );
      expect(
        AnyMessages.unpack(response.admittedOutput, ProposedSupportReplySchema)?.replyText,
      ).toBe("Review this reply.");
    } finally {
      storage.close();
      factory.close();
    }
  });

  it("fails explicitly when a storage factory lacks the provider capability", () => {
    const absent = Object.create(InMemoryStorageFactory.prototype) as InMemoryStorageFactory;
    expect(() => AgentHistoryStorageFactories.create(absent, scope)).toThrow(
      /Agent history storage/,
    );
  });
});
