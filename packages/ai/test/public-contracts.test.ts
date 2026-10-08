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
import { create, fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { AnyMessages } from "@spine-event-engine/core";
import { assertAiOutcomeContext } from "../src/spi/adapter.js";
import { AnthropicAssistantContentSchema } from "@spine-event-engine/proto/agent";
import {
  ProposedSupportReplySchema,
  SupportTicketFactsSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import {
  AiModel,
  ModelRef,
  ModelRefSchema,
  GenerationResponseSchema,
  ModelToolCallSchema,
  AiOutcome,
  AiUsageSchema,
  DecisionRequestSchema,
  DecisionRoundingSchema,
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

  it("round-trips ordered model proposals without treating them as authorized calls", () => {
    const proposal = (providerCallId: string, toolName: string, argumentsJson: string) =>
      create(ModelToolCallSchema, { providerCallId, toolName, argumentsJson });
    const response = create(GenerationResponseSchema, {
      rawOutput: "I need a lookup.",
      outcome: AiOutcome.TOOL_REQUESTED,
      usage: create(AiUsageSchema, { inputTokens: { value: 0n } }),
      toolCalls: [proposal("same", "lookup", '{"ticket":'), proposal("same", "", "")],
    });
    for (const restored of [
      fromBinary(GenerationResponseSchema, toBinary(GenerationResponseSchema, response)),
      fromJson(GenerationResponseSchema, toJson(GenerationResponseSchema, response)),
    ]) {
      expect(restored.rawOutput).toBe("I need a lookup.");
      expect(
        restored.toolCalls.map(({ providerCallId, toolName, argumentsJson }) => [
          providerCallId,
          toolName,
          argumentsJson,
        ]),
      ).toEqual([
        ["same", "lookup", '{"ticket":'],
        ["same", "", ""],
      ]);
      expect(restored.usage?.inputTokens?.value).toBe(0n);
      expect(restored.usage?.outputTokens).toBeUndefined();
    }
  });

  it("preserves ordered Anthropic reasoning and exact projections across both wire forms", () => {
    const toolCall = create(ModelToolCallSchema, {
      providerCallId: "call-1",
      toolName: "lookup",
      argumentsJson: "{}",
    });
    const response = create(GenerationResponseSchema, {
      rawOutput: "beforeafter",
      outcome: AiOutcome.TOOL_REQUESTED,
      toolCalls: [toolCall],
      anthropicContent: create(AnthropicAssistantContentSchema, {
        blocks: [
          { content: { case: "text", value: "before" } },
          { content: { case: "thinking", value: { text: "", signature: "signed" } } },
          { content: { case: "toolCall", value: toolCall } },
          { content: { case: "redactedThinking", value: { data: "opaque" } } },
          { content: { case: "text", value: "after" } },
        ],
      }),
    });
    for (const restored of [
      fromBinary(GenerationResponseSchema, toBinary(GenerationResponseSchema, response)),
      fromJson(GenerationResponseSchema, toJson(GenerationResponseSchema, response)),
    ]) {
      expect(restored.anthropicContent?.blocks.map((block) => block.content.case)).toEqual([
        "text",
        "thinking",
        "toolCall",
        "redactedThinking",
        "text",
      ]);
      const thinking = restored.anthropicContent?.blocks[1]?.content;
      expect(thinking?.case).toBe("thinking");
      if (thinking?.case !== "thinking") throw new Error("Expected thinking block");
      expect(thinking.value.text).toBe("");
      expect(thinking.value.signature).toBe("signed");
      expect(() => {
        assertAiOutcomeContext(restored);
      }).not.toThrow();
      restored.rawOutput = "contradiction";
      expect(() => {
        assertAiOutcomeContext(restored);
      }).toThrow("text projection");
    }
  });

  it("records incomplete failed reasoning but rejects incomplete tool continuations", () => {
    const partial = create(AnthropicAssistantContentSchema, {
      blocks: [{ content: { case: "thinking", value: { text: "partial", signature: "" } } }],
    });
    expect(() => {
      assertAiOutcomeContext(
        create(GenerationResponseSchema, {
          outcome: AiOutcome.FAILED,
          anthropicContent: partial,
        }),
      );
    }).not.toThrow();
    expect(() => {
      assertAiOutcomeContext(
        create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
          toolCalls: [{ providerCallId: "call", toolName: "tool_0", argumentsJson: "{}" }],
          anthropicContent: create(AnthropicAssistantContentSchema, {
            blocks: [
              ...partial.blocks,
              {
                content: {
                  case: "toolCall",
                  value: { providerCallId: "call", toolName: "tool_0", argumentsJson: "{}" },
                },
              },
            ],
          }),
        }),
      );
    }).toThrow("signature");
  });

  it("round-trips absent, zero and nonzero decision precision", () => {
    for (const [rounding, expected] of [
      [undefined, undefined],
      [
        create(DecisionRoundingSchema, { probabilityDecimals: 0 }),
        { probabilityDecimals: 0, scoreDecimals: undefined },
      ],
      [
        create(DecisionRoundingSchema, { probabilityDecimals: 2, scoreDecimals: 2 }),
        { probabilityDecimals: 2, scoreDecimals: 2 },
      ],
    ] as const) {
      const response = create(DecisionResponseSchema, {
        outcome: AiOutcome.ADMITTED,
        ...(rounding ? { rounding } : {}),
      });
      const restored = fromBinary(
        DecisionResponseSchema,
        toBinary(DecisionResponseSchema, response),
      );
      if (expected === undefined) expect(restored.rounding).toBeUndefined();
      else expect(restored.rounding?.probabilityDecimals).toBe(expected.probabilityDecimals);
      expect(restored.rounding?.probabilityDecimals).toBe(expected?.probabilityDecimals);
      expect(restored.rounding?.scoreDecimals).toBe(expected?.scoreDecimals);
    }
  });

  it("rejects nonterminal outcomes outside generation and contradictory generation output", () => {
    const proposal = create(ModelToolCallSchema, {
      providerCallId: "call-1",
      toolName: "lookup",
      argumentsJson: "{}",
    });
    const continued = create(GenerationResponseSchema, {
      outcome: AiOutcome.TOOL_REQUESTED,
      toolCalls: [proposal],
    });
    expect(() => {
      assertAiOutcomeContext(continued);
    }).not.toThrow();
    expect(() => {
      assertAiOutcomeContext(
        create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
        }),
      );
    }).toThrow("requires proposals");
    expect(() => {
      assertAiOutcomeContext(
        create(GenerationResponseSchema, {
          outcome: AiOutcome.ADMITTED,
          toolCalls: [proposal],
          admittedOutput: AnyMessages.pack(
            ProposedSupportReplySchema,
            create(ProposedSupportReplySchema, { replyText: "Hello" }),
          ),
        }),
      );
    }).toThrow("without outstanding proposals");
    expect(() => {
      assertAiOutcomeContext(
        create(GenerationResponseSchema, {
          outcome: AiOutcome.INVALID_OUTPUT,
          admittedOutput: AnyMessages.pack(
            ProposedSupportReplySchema,
            create(ProposedSupportReplySchema, { replyText: "Hello" }),
          ),
        }),
      );
    }).toThrow("Only ADMITTED");
    expect(() => {
      assertAiOutcomeContext(create(DecisionResponseSchema, { outcome: AiOutcome.FAILED }));
    }).not.toThrow();
    for (const content of [
      create(DecisionResponseSchema, { outcome: AiOutcome.TOOL_REQUESTED }),
      create(ToolResponseSchema, { outcome: AiOutcome.TOOL_REQUESTED }),
      create(AgentToolCallFinishedSchema, { outcome: AiOutcome.TOOL_REQUESTED }),
      create(AgentAiOperationFailedSchema, { outcome: AiOutcome.TOOL_REQUESTED }),
    ])
      expect(() => {
        assertAiOutcomeContext(content);
      }).toThrow("only a generation response");
  });
});
