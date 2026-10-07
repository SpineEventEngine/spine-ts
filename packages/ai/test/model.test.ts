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
import { Int64ValueSchema } from "@bufbuild/protobuf/wkt";
import { GenerationResponseSchema, ModelRefSchema } from "@spine-event-engine/proto/agent";
import { describe, expect, it } from "vitest";
import {
  ProposedSupportReplySchema,
  SupportRoutingResultSchema,
  SupportTicketFactsSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import { AiModel, ModelRef } from "../src/index.js";
import { isAiModel, modelRefKey } from "../src/spi/runtime.js";

const limits = {
  modelRequests: 2,
  toolCalls: 0,
  deadlineMs: 1000,
  maxInputBytes: 2000,
  maxOutputBytes: 2000,
  maxOutputTokens: 80,
};

describe("typed AI capability declarations", () => {
  it("copies and freezes validated definitions so later caller mutation cannot widen limits", () => {
    const input = { ...limits };
    const model = AiModel.define({
      name: "draft-support-reply",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a response",
      outputMode: "prompt-and-validate",
      limits: input,
    });
    input.modelRequests = 100;
    expect(model.definition.limits.modelRequests).toBe(2);
    expect(Object.isFrozen(model.definition)).toBe(true);
    expect(Object.isFrozen(model.definition.limits)).toBe(true);
    expect(isAiModel(model)).toBe(true);
    expect(isAiModel({ ...model })).toBe(false);
  });

  it("rejects malformed limits and decision-only configuration before registration", () => {
    const definition = {
      name: "draft-support-reply",
      version: "v1",
      kind: "generation" as const,
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a response",
      outputMode: "prompt-and-validate" as const,
      limits: { ...limits, maxOutputBytes: 0 },
    };
    expect(() => AiModel.define(definition)).toThrow("maxOutputBytes");
    expect(() =>
      AiModel.define({ ...definition, limits: { ...limits, maxOutputTokens: 0 } }),
    ).toThrow("maxOutputTokens");
  });

  it("creates a Proto reference with nonblank semantic parts", () => {
    const ref = ModelRef.of("support-writer", "v1");
    expect(ref.$typeName).toBe(ModelRefSchema.typeName);
    expect(ref.name?.value).toBe("support-writer");
    expect(() => ModelRef.of(" ", "v1")).toThrow("name");
    expect(() => ModelRef.of("support-writer", " ")).toThrow("revision");
    expect(create(ModelRefSchema, { name: ref.name, revision: ref.revision })).toEqual(ref);
  });

  it("rejects unsupported native output schemas before a model request", () => {
    expect(() =>
      AiModel.define({
        name: "audit-content",
        version: "v1",
        kind: "generation",
        input: SupportTicketFactsSchema,
        output: GenerationResponseSchema,
        instructions: "Produce a structured result",
        outputMode: "native-schema",
        limits,
      }),
    ).toThrow("admitted_output");
  });

  it("rejects unsupported prompt-and-validate output before request dispatch", () => {
    expect(() =>
      AiModel.define({
        name: "invalid-content",
        version: "v1",
        kind: "generation",
        input: SupportTicketFactsSchema,
        output: GenerationResponseSchema,
        instructions: "Draft",
        outputMode: "prompt-and-validate",
        limits,
      }),
    ).toThrow("admitted_output");
  });

  it.each(["native-schema", "prompt-and-validate"] as const)(
    "rejects a scalar wrapper root in %s mode",
    (outputMode) => {
      expect(() =>
        AiModel.define({
          name: "invalid-scalar-root",
          version: "v1",
          kind: "generation",
          input: SupportTicketFactsSchema,
          output: Int64ValueSchema,
          instructions: "Return the exact reference number",
          outputMode,
          limits,
        }),
      ).toThrow("google.protobuf.Int64Value");
    },
  );

  it("rejects non-factory values, malformed references and unbounded generation settings", () => {
    expect(isAiModel(null)).toBe(false);
    expect(() => modelRefKey({} as never)).toThrow("Protobuf");
    expect(() => modelRefKey(create(ModelRefSchema))).toThrow("name");
    const base = {
      name: "writer",
      version: "v1",
      kind: "generation" as const,
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a reply for human review",
      outputMode: "prompt-and-validate" as const,
      limits,
    };
    expect(() => AiModel.define({ ...base, limits: { ...limits, modelRequests: -1 } })).toThrow(
      "modelRequests",
    );
    expect(() => AiModel.define({ ...base, limits: { ...limits, toolCalls: 1.5 } })).toThrow(
      "toolCalls",
    );
    expect(() => AiModel.define({ ...base, limits: { ...limits, deadlineMs: Infinity } })).toThrow(
      "deadlineMs",
    );
    expect(() => AiModel.define({ ...base, limits: { ...limits, maxInputBytes: 0 } })).toThrow(
      "maxInputBytes",
    );
    expect(() =>
      AiModel.define({ ...base, limits: { ...limits, maxOutputTokens: undefined } } as never),
    ).toThrow("maxOutputTokens");
    expect(() => AiModel.define({ ...base, outputMode: "unknown" as never })).toThrow("outputMode");
    expect(() => AiModel.define({ ...base, instructions: " " })).toThrow("instructions");
    expect(() =>
      AiModel.define({
        ...base,
        tools: [
          { server: "mcp", tool: "search" },
          { server: "mcp", tool: "search" },
        ],
      }),
    ).toThrow("Duplicate tool");
    expect(() =>
      AiModel.define({ ...base, validation: { version: " ", check: () => [] } }),
    ).toThrow("validation");
  });

  it("copies every decision question and rejects malformed mapping, criteria and limits", () => {
    const criteria = { a: "first", b: "second" };
    const base = {
      name: "rater",
      version: "v1",
      kind: "decision" as const,
      input: SupportTicketFactsSchema,
      output: SupportRoutingResultSchema,
      limits: {
        modelRequests: limits.modelRequests,
        toolCalls: 0,
        deadlineMs: limits.deadlineMs,
        maxInputBytes: limits.maxInputBytes,
        maxOutputBytes: limits.maxOutputBytes,
      },
      questions: {
        yes: { type: "boolean" as const, instructions: "Yes?" },
        pick: { type: "choice" as const, instructions: "Pick", criteria },
        score: { type: "score" as const, instructions: "Score", criteria: ["low", "high"] },
      },
      mapping: {
        version: "v1",
        toMessage: () => create(SupportRoutingResultSchema, { queue: { value: "tier-two" } }),
      },
    };
    const model = AiModel.define(base);
    criteria.a = "mutated";
    expect(model.definition.kind === "decision" && model.definition.questions.pick).toMatchObject({
      criteria: { a: "first" },
    });
    expect(() => AiModel.define({ ...base, limits: { ...base.limits, toolCalls: 1 } })).toThrow(
      "toolCalls",
    );
    expect(() =>
      AiModel.define({ ...base, limits: { ...base.limits, maxOutputTokens: 10 } }),
    ).toThrow("maxOutputTokens");
    expect(() => AiModel.define({ ...base, questions: {} })).toThrow("questions");
    expect(() =>
      AiModel.define({ ...base, mapping: { version: "", toMessage: base.mapping.toMessage } }),
    ).toThrow("mapping.version");
    expect(() => AiModel.define({ ...base, mapping: undefined } as never)).toThrow("mapping");
    expect(() =>
      AiModel.define({
        ...base,
        questions: { pick: { type: "choice", instructions: "Pick", criteria: { a: "only" } } },
      }),
    ).toThrow("two choices");
    expect(() =>
      AiModel.define({
        ...base,
        questions: { score: { type: "score", instructions: "Score", criteria: ["one"] } },
      }),
    ).toThrow("two rubric");
    expect(() =>
      AiModel.define({
        ...base,
        questions: { bad: { type: "unknown", instructions: "Bad" } },
      } as never),
    ).toThrow("unsupported kind");
  });
});
