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
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
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

// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";
// prettier-ignore
import {
  SupportReplyAgentIdSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import type { AgentHistoryStorageInput } from "../../src/provider.js";

export const scope: AgentHistoryStorageInput<string> = {
  context: { name: "Support", multitenant: false },
  stateType: "spine.server.testing.SupportReplyAgentState",
  id: { key: (ticketNumber) => ticketNumber },
};

function packed<T extends Message>(schema: GenMessage<T>, message: T) {
  return AnyPacker.pack(schema, message);
}

export function occurredAt(seconds: bigint, nanos = 0): Timestamp {
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

export function conversation(
  id: string,
  conversationId: string,
  time: Timestamp,
): AgentHistoryEntry {
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

export function response(id: string, conversationId: string, time: Timestamp): AgentHistoryEntry {
  const reply = create(ProposedSupportReplySchema, { replyText: "Review this reply." });
  const result = create(GenerationResponseSchema, {
    rawOutput: "Review this reply.",
    outcome: AiOutcome.ADMITTED,
    admittedOutput: packed(ProposedSupportReplySchema, reply),
  });
  return conversationRecord(id, conversationId, time, result, GenerationResponseSchema);
}

export function event(id: string, time: Timestamp, system: boolean): AgentHistoryEntry {
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
