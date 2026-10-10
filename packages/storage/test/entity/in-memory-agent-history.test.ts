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

import { create, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema, TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
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

import {
  SupportReplyDraftedSchema,
  SupportTicketUpdatedSchema,
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

function packed(schema: GenMessage<Message>, message: Message) {
  return create(AnySchema, {
    typeUrl: `type.spine.io/${schema.typeName}`,
    value: toBinary(schema, message as never),
  });
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
  const question = create(SupportTicketUpdatedSchema, { agent: ticket, question: "Delivery?" });
  const request = create(GenerationRequestSchema, {
    input: packed(SupportTicketUpdatedSchema, question),
    instructions: "Propose a support reply.",
    promptJson: "[]",
    outputSchemaJson: "{}",
    digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
  });
  return conversationRecord(id, conversationId, time, request, GenerationRequestSchema);
}

function response(id: string, conversationId: string, time: Timestamp): AgentHistoryEntry {
  const ticket = create(SupportReplyAgentIdSchema, { ticketNumber: "T-history" });
  const reply = create(SupportReplyDraftedSchema, { agent: ticket, reply: "Review this reply." });
  const result = create(GenerationResponseSchema, {
    rawOutput: "Review this reply.",
    outcome: AiOutcome.ADMITTED,
    admittedOutput: packed(SupportReplyDraftedSchema, reply),
  });
  return conversationRecord(id, conversationId, time, result, GenerationResponseSchema);
}

function event(id: string, time: Timestamp, system: boolean): AgentHistoryEntry {
  const ticket = create(SupportReplyAgentIdSchema, { ticketNumber: "T-history" });
  const payload = system
    ? packed(
        AgentModelSelectionChangedSchema,
        create(AgentModelSelectionChangedSchema, {
          agent: create(MessageIdSchema, { id: packed(SupportReplyAgentIdSchema, ticket) }),
          sourceSignal: create(MessageIdSchema, {
            id: packed(EventIdSchema, create(EventIdSchema, { value: id })),
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

  it("fails explicitly when a storage factory lacks the provider capability", () => {
    const absent = Object.create(InMemoryStorageFactory.prototype) as InMemoryStorageFactory;
    expect(() => AgentHistoryStorageFactories.create(absent, scope)).toThrow(
      /Agent history storage/,
    );
  });
});
