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

import { describe, expect, it } from "vitest";
import {
  SupportRoutingResultSchema,
  SupportTicketFactsSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import { AiModel } from "../src/index.js";
import { admitDecision } from "../src/spi/runtime.js";

const base = {
  name: "route-decision",
  version: "v1",
  kind: "decision" as const,
  input: SupportTicketFactsSchema,
  output: SupportRoutingResultSchema,
  limits: {
    modelRequests: 1,
    toolCalls: 0,
    deadlineMs: 1000,
    maxInputBytes: 1000,
    maxOutputBytes: 1000,
  },
  questions: {
    safe: { type: "boolean" as const, instructions: "Is it safe?" },
    lane: { type: "choice" as const, instructions: "Which lane?", criteria: { a: "A", b: "B" } },
    grade: { type: "score" as const, instructions: "What grade?", criteria: ["bad", "good"] },
  },
  requireProbabilities: true,
  mapping: {
    version: "v1",
    toMessage: () =>
      create(SupportRoutingResultSchema, {
        queue: { value: "tier-two" },
      }),
  },
};
const input = create(SupportTicketFactsSchema, {
  ticketNumber: { value: "T-42" },
  customerQuestion: "Where is my order?",
});
const answers = {
  safe: { type: "boolean" as const, probability: 0.5 },
  lane: { type: "choice" as const, choice: "a", probabilities: { a: 0.6, b: 0.4 } },
  grade: { type: "score" as const, score: 0.5, probabilities: { "0": 0.5, "1": 0.5 } },
};

describe("non-generative decision admission", () => {
  it("checks exact IDs, kinds, alternatives, finite ranges and distribution rounding", () => {
    const model = AiModel.define(base);
    expect(
      admitDecision(model, { answers }, input, { probabilityDecimals: 3, scoreDecimals: 3 }).ok,
    ).toBe(true);
    expect(
      admitDecision(model, { answers: { ...answers, extra: answers.safe } }, input, {
        probabilityDecimals: 3,
        scoreDecimals: 3,
      }).ok,
    ).toBe(false);
    expect(
      admitDecision(
        model,
        { answers: { ...answers, safe: { type: "boolean", probability: NaN } } },
        input,
        { probabilityDecimals: 3, scoreDecimals: 3 },
      ).ok,
    ).toBe(false);
    expect(
      admitDecision(
        model,
        { answers: { ...answers, lane: { ...answers.lane, choice: "c" } } },
        input,
        { probabilityDecimals: 3, scoreDecimals: 3 },
      ).ok,
    ).toBe(false);
    expect(
      admitDecision(
        model,
        { answers: { ...answers, grade: { ...answers.grade, score: 1.5 } } },
        input,
        { probabilityDecimals: 3, scoreDecimals: 3 },
      ).ok,
    ).toBe(false);
    expect(
      admitDecision(
        model,
        { answers: { ...answers, lane: { ...answers.lane, probabilities: { a: 0.6, b: 0.39 } } } },
        input,
        { probabilityDecimals: 3, scoreDecimals: 3 },
      ).ok,
    ).toBe(false);
  });

  it("validates mapped Protobuf and application constraints before admission", () => {
    const malformed = AiModel.define({
      ...base,
      mapping: {
        version: "v1",
        toMessage: () => create(SupportRoutingResultSchema),
      },
    });
    expect(
      admitDecision(malformed, { answers }, input, { probabilityDecimals: 3, scoreDecimals: 3 }).ok,
    ).toBe(false);
    const appCheck = AiModel.define({
      ...base,
      validation: {
        version: "v1",
        check: () => [{ code: "DOMAIN", path: "name", message: "No" }],
      },
    });
    expect(
      admitDecision(appCheck, { answers }, input, { probabilityDecimals: 3, scoreDecimals: 3 }).ok,
    ).toBe(false);
  });

  it("rejects missing answers, mismatched kinds, incomplete distributions and confidence", () => {
    const model = AiModel.define(base);
    const test = (candidate: unknown) =>
      admitDecision(model, candidate as never, input, { probabilityDecimals: 3, scoreDecimals: 3 })
        .ok;
    expect(test({ answers: { safe: answers.safe } })).toBe(false);
    expect(test({ answers: { ...answers, safe: { type: "score", score: 0 } } })).toBe(false);
    expect(
      test({ answers: { ...answers, lane: { ...answers.lane, probabilities: undefined } } }),
    ).toBe(false);
    expect(
      test({
        answers: { ...answers, lane: { ...answers.lane, probabilities: { a: 0.5, wrong: 0.5 } } },
      }),
    ).toBe(false);
    expect(
      test({ answers: { ...answers, lane: { ...answers.lane, probabilities: { a: NaN, b: 1 } } } }),
    ).toBe(false);
    expect(test({ answers: { ...answers, lane: { ...answers.lane, confidence: 2 } } })).toBe(false);
    expect(test({ answers: { ...answers, safe: { ...answers.safe, probability: -0.1 } } })).toBe(
      false,
    );
  });

  it("requires maximal choice and probability-weighted score within declared precision", () => {
    const model = AiModel.define(base);
    const decide = (candidate: unknown, probabilityDecimals = 2, scoreDecimals = 2) =>
      admitDecision(model, candidate as never, input, { probabilityDecimals, scoreDecimals }).ok;
    expect(
      decide({
        answers: { ...answers, lane: { ...answers.lane, probabilities: { a: 0.4, b: 0.6 } } },
      }),
    ).toBe(false);
    expect(decide({ answers: { ...answers, grade: { ...answers.grade, score: 0.8 } } })).toBe(
      false,
    );
    expect(
      decide({
        answers: {
          ...answers,
          grade: { ...answers.grade, score: 0.67, probabilities: { "0": 0.33, "1": 0.67 } },
        },
      }),
    ).toBe(true);
    expect(
      decide(
        {
          answers: {
            ...answers,
            grade: { ...answers.grade, score: 0.66, probabilities: { "0": 0.33, "1": 0.67 } },
          },
        },
        2,
        2,
      ),
    ).toBe(true);
    expect(
      decide(
        {
          answers: {
            ...answers,
            grade: { ...answers.grade, score: 0.65, probabilities: { "0": 0.33, "1": 0.67 } },
          },
        },
        2,
        2,
      ),
    ).toBe(false);
  });

  it("accepts omitted distributions only when declared optional and applies full precision", () => {
    const optional = AiModel.define({ ...base, requireProbabilities: false });
    const without = {
      ...answers,
      lane: { type: "choice" as const, choice: "a" },
      grade: { type: "score" as const, score: 0.5 },
    };
    expect(admitDecision(optional, { answers: without }, input, {}).ok).toBe(true);
    const inconsistent = { ...answers, grade: { ...answers.grade, score: 0.51 } };
    expect(admitDecision(optional, { answers: inconsistent }, input, {}).ok).toBe(false);
  });

  it("rejects unbounded rounding and invalid capability provenance", () => {
    const model = AiModel.define(base);
    expect(() => admitDecision(model, { answers }, input, { probabilityDecimals: NaN })).toThrow(
      "probabilityDecimals",
    );
    expect(() => admitDecision(model, { answers }, input, { scoreDecimals: 20 })).toThrow(
      "scoreDecimals",
    );
    expect(() => admitDecision(model, { answers }, input, { probabilityDecimals: -1 })).toThrow(
      "probabilityDecimals",
    );
    expect(() =>
      admitDecision({ ...model }, { answers }, input, {
        probabilityDecimals: 3,
        scoreDecimals: 3,
      }),
    ).toThrow("Factory-created");
  });
});
