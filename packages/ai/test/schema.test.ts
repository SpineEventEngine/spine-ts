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

import {
  AgentHistoryEntrySchema,
  AiContentDigestSchema,
  AiOperationLimitsSchema,
  AiUsageSchema,
  DecisionAnswerSchema,
  DecisionDistributionSchema,
  GenerationResponseSchema,
  ModelPreferenceSchema,
  ModelRefSchema,
  ToolResponseSchema,
} from "@spine-event-engine/proto/agent";
import { EmptySchema, Int64ValueSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  RecursiveSupportTicketContextSchema,
  SupportTicketNumericEvidenceSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import { deriveOutputSchema, parseCandidate } from "../src/spi/runtime.js";

describe("descriptor-derived output admission", () => {
  it("keeps required fields and nested Proto constraints", () => {
    const schema = deriveOutputSchema(ModelRefSchema);
    expect(schema.required).toEqual(["name", "revision"]);
    expect(schema.properties.name).toMatchObject({
      type: "object",
      required: ["value"],
      additionalProperties: false,
    });
    expect(
      parseCandidate(ModelRefSchema, '{"name":{"value":"a"},"revision":{"value":"b"}}').ok,
    ).toBe(true);
    expect(parseCandidate(ModelRefSchema, '{"name":{"value":"a"}}').ok).toBe(false);
    expect(
      parseCandidate(ModelRefSchema, '{"name":{"value":""},"revision":{"value":"b"}}').ok,
    ).toBe(false);
  });

  it("preserves a required oneof and rejects extra properties or plain text", () => {
    const schema = deriveOutputSchema(ModelPreferenceSchema);
    expect(schema.allOf).toHaveLength(1);
    expect(
      parseCandidate(ModelPreferenceSchema, '{"kind":"GENERATION","inheritRepositoryDefault":{}}')
        .ok,
    ).toBe(true);
    expect(parseCandidate(ModelPreferenceSchema, '{"kind":"GENERATION"}').ok).toBe(false);
    expect(
      parseCandidate(
        ModelPreferenceSchema,
        '{"kind":"GENERATION","inheritRepositoryDefault":{},"model":{}}',
      ).ok,
    ).toBe(false);
    expect(
      parseCandidate(
        ModelPreferenceSchema,
        '{"kind":"GENERATION","inheritRepositoryDefault":{},"extra":1}',
      ).ok,
    ).toBe(false);
    expect(parseCandidate(ModelPreferenceSchema, "ordinary text").ok).toBe(false);
  });

  it("represents 64-bit integers as exact decimal strings and rejects unsafe JSON numbers", () => {
    const schema = deriveOutputSchema(AiOperationLimitsSchema);
    expect(schema.properties.deadlineMs).toMatchObject({
      type: "object",
      properties: { value: { type: "string" } },
    });
    const valid = JSON.stringify({
      modelRequests: { value: 1 },
      toolCalls: { value: 0 },
      deadlineMs: { value: "9007199254740993" },
      maxInputBytes: { value: "10" },
      maxOutputBytes: { value: "20" },
    });
    expect(parseCandidate(AiOperationLimitsSchema, valid).ok).toBe(true);
    expect(
      parseCandidate(
        AiOperationLimitsSchema,
        valid.replace('"9007199254740993"', "9007199254740993"),
      ).ok,
    ).toBe(false);
    expect(parseCandidate(AiOperationLimitsSchema, valid.replace('"10"', '"-10"')).ok).toBe(false);
    expect(parseCandidate(AiOperationLimitsSchema, "{}").ok).toBe(false);
  });

  it("preserves enum, repeated message, scalar list, bool and wrapper shapes", () => {
    const answer = deriveOutputSchema(DecisionAnswerSchema);
    expect((answer.properties.kind as { enum: string[] }).enum).toContain("BOOLEAN");
    expect(answer.properties.confidence).toMatchObject({ type: "number" });
    expect(
      parseCandidate(
        DecisionAnswerSchema,
        '{"id":{"value":"x"},"kind":"BOOLEAN","booleanProbability":0,"confidence":0.5}',
      ).ok,
    ).toBe(true);
    expect(
      parseCandidate(DecisionAnswerSchema, '{"id":"x","kind":"UNKNOWN","booleanProbability":0}').ok,
    ).toBe(false);
    expect(deriveOutputSchema(DecisionDistributionSchema).properties.probabilities).toMatchObject({
      type: "array",
    });
    expect(
      parseCandidate(
        DecisionDistributionSchema,
        '{"probabilities":[{"key":{"value":"a"},"probability":0.5}]}',
      ).ok,
    ).toBe(true);
    expect(
      parseCandidate(
        DecisionDistributionSchema,
        '{"probabilities":[{"key":{"value":"a"},"unknown":1}]}',
      ).ok,
    ).toBe(false);
    expect(deriveOutputSchema(ToolResponseSchema).properties.text).toMatchObject({ type: "array" });
    expect(deriveOutputSchema(ToolResponseSchema).properties.toolError).toMatchObject({
      type: "boolean",
    });
    expect(deriveOutputSchema(AiUsageSchema).properties.inputTokens).toMatchObject({
      type: "object",
    });
    expect(parseCandidate(AiUsageSchema, '{"inputTokens":{"value":"10"}}').ok).toBe(true);
  });

  it("enforces exact lowercase content digests and unknown token counts", () => {
    const digest = "a".repeat(64);
    expect(deriveOutputSchema(AiContentDigestSchema).properties.value).toMatchObject({
      type: "string",
      pattern: "^[0-9a-f]{64}$",
    });
    expect(parseCandidate(AiContentDigestSchema, JSON.stringify({ value: digest })).ok).toBe(true);
    expect(
      parseCandidate(AiContentDigestSchema, JSON.stringify({ value: digest.toUpperCase() })).ok,
    ).toBe(false);
    expect(
      parseCandidate(AiContentDigestSchema, JSON.stringify({ value: digest.slice(1) })).ok,
    ).toBe(false);
    const unknown = parseCandidate(AiUsageSchema, "{}");
    expect(unknown.ok).toBe(true);
    if (unknown.ok) expect(unknown.value.inputTokens).toBeUndefined();
    const zero = parseCandidate(AiUsageSchema, '{"inputTokens":{"value":"0"}}');
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.value.inputTokens?.value).toBe(0n);
  });

  it("preserves exact repeated and wrapped 64-bit values", () => {
    const exact = "9007199254740993";
    const valid = JSON.stringify({
      exactReferenceNumbers: [exact],
      preferredReferenceNumber: exact,
      relatedReferenceNumbers: [exact],
      priorityLevel: 3,
    });
    const accepted = parseCandidate(SupportTicketNumericEvidenceSchema, valid);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.value.exactReferenceNumbers).toEqual([9007199254740993n]);
      expect(accepted.value.preferredReferenceNumber).toBe(9007199254740993n);
      expect(accepted.value.relatedReferenceNumbers[0]?.value).toBe(9007199254740993n);
    }
    expect(
      parseCandidate(
        SupportTicketNumericEvidenceSchema,
        valid.replace(`["${exact}"]`, `[9007199254740993]`),
      ).ok,
    ).toBe(false);
    expect(
      parseCandidate(
        SupportTicketNumericEvidenceSchema,
        valid.replace(
          `"preferredReferenceNumber":"${exact}"`,
          `"preferredReferenceNumber":9007199254740993`,
        ),
      ).ok,
    ).toBe(false);
    expect(
      parseCandidate(
        SupportTicketNumericEvidenceSchema,
        valid.replace(
          `"relatedReferenceNumbers":["${exact}"]`,
          `"relatedReferenceNumbers":[9007199254740993]`,
        ),
      ).ok,
    ).toBe(false);
  });

  it("uses integer native schema and rejects recursive descriptors with a field path", () => {
    const schema = deriveOutputSchema(SupportTicketNumericEvidenceSchema);
    expect(schema.properties.priorityLevel).toMatchObject({ type: "integer" });
    expect(schema.properties.confidence).toMatchObject({ type: "number" });
    expect(() => deriveOutputSchema(RecursiveSupportTicketContextSchema)).toThrow("parent");
  });

  it("keeps object-shaped root outputs and rejects scalar root wrappers", () => {
    expect(deriveOutputSchema(EmptySchema)).toMatchObject({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
    expect(() => deriveOutputSchema(Int64ValueSchema)).toThrow("google.protobuf.Int64Value");
    const nested = deriveOutputSchema(SupportTicketNumericEvidenceSchema);
    expect(nested.properties.preferredReferenceNumber).toMatchObject({ type: "string" });
    expect(nested.properties.relatedReferenceNumbers).toMatchObject({ type: "array" });
  });

  it("rejects unsupported Any lowering and applies application validation after Proto checks", () => {
    expect(() => deriveOutputSchema(GenerationResponseSchema)).toThrow("admitted_output");
    expect(() => deriveOutputSchema(AgentHistoryEntrySchema)).toThrow("occurred_at");
    expect(() => deriveOutputSchema({ kind: "enum" } as never)).toThrow("message descriptor");
    expect(parseCandidate(ModelRefSchema, "[]").ok).toBe(false);
    expect(
      parseCandidate(
        AiOperationLimitsSchema,
        JSON.stringify({
          modelRequests: { value: 1 },
          deadlineMs: { value: "abc" },
          maxInputBytes: { value: "10" },
          maxOutputBytes: { value: "20" },
        }),
      ).ok,
    ).toBe(false);
    const issues = [{ code: "DOMAIN", path: "name", message: "Disallowed" }];
    expect(
      parseCandidate(
        ModelRefSchema,
        '{"name":{"value":"a"},"revision":{"value":"b"}}',
        () => issues,
      ),
    ).toEqual({
      ok: false,
      issues,
    });
  });
});
