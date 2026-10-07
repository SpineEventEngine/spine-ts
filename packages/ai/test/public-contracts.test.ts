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

import { describe, expect, it } from "vitest";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import {
  AiModel,
  ModelRef,
  ModelRefSchema,
  GenerationResponseSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  AgentAiOperationStartedSchema,
  AgentModelAttemptStartedSchema,
  AgentModelAttemptFinishedSchema,
  AgentAiResultAdmittedSchema,
  AgentAiOperationFailedSchema,
  AgentToolCallStartedSchema,
  AgentToolCallFinishedSchema,
  AgentModelSelectionChangedSchema,
  AgentInvocationTerminatedSchema,
  type HistoryPage,
  type ConversationRecord,
} from "../src/index.js";

describe("public SDK-free facade inventory", () => {
  it("provides factory values with their approved type names", () => {
    const ref: ModelRef = ModelRef.of("deployment", "r1");
    const model: AiModel<typeof SupportTicketFactsSchema, typeof ProposedSupportReplySchema> =
      AiModel.define({
        name: "draft-support-reply",
        version: "v1",
        kind: "generation",
        input: SupportTicketFactsSchema,
        output: ProposedSupportReplySchema,
        instructions: "Draft a support reply for human review",
        outputMode: "native-schema",
        limits: {
          modelRequests: 1,
          toolCalls: 0,
          deadlineMs: 1000,
          maxInputBytes: 1000,
          maxOutputBytes: 1000,
          maxOutputTokens: 100,
        },
      });
    const page: HistoryPage<ConversationRecord> = { items: [] };
    expect([ref.$typeName, model.definition.output.typeName, page.items.length]).toEqual([
      ModelRefSchema.typeName,
      ProposedSupportReplySchema.typeName,
      0,
    ]);
  });

  it("exports closed content and trusted System-event descriptors", () => {
    const schemas = [
      GenerationResponseSchema,
      DecisionRequestSchema,
      DecisionResponseSchema,
      ToolRequestSchema,
      ToolResponseSchema,
      AgentAiOperationStartedSchema,
      AgentModelAttemptStartedSchema,
      AgentModelAttemptFinishedSchema,
      AgentAiResultAdmittedSchema,
      AgentAiOperationFailedSchema,
      AgentToolCallStartedSchema,
      AgentToolCallFinishedSchema,
      AgentModelSelectionChangedSchema,
      AgentInvocationTerminatedSchema,
    ];
    expect(schemas.every((schema) => schema.typeName.startsWith("spine.ts.agent."))).toBe(true);
  });
});
