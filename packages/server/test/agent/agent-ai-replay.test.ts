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

import { createHash } from "node:crypto";
import { clone, create, toBinary, type Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AiModel, AiRegistry, ModelRef } from "@spine-event-engine/ai";
import {
  createBackendRegistration,
  type AiBackendExecution,
} from "@spine-event-engine/ai/spi/adapter";
import { AnyMessages, Time, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandIdSchema,
  MessageIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import {
  AiOutcome,
  ConversationIdSchema,
  DecisionQuestionKind,
  DecisionQuestionSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
} from "@spine-event-engine/proto/agent";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionRecordSchema,
  AgentExecutionScopeSchema,
  AgentExecutionStartSchema,
  AgentInvocationBoundsSchema,
  AgentInvocationKeySchema,
  AgentInvocationStatus,
  AgentSelectedModelSchema,
  AgentSignalKeySchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentExecutionStorage } from "@spine-event-engine/storage/provider";
import { describe, expect, it } from "vitest";
import { AgentAiRuntime } from "../../src/agent/agent-ai-runtime.js";
import { AgentExecutionSession } from "../../src/agent/agent-execution-session.js";
import { SupportReplyAgentIdSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import {
  ProposedSupportReplySchema,
  SupportRoutingResultSchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const input = create(SupportTicketFactsSchema, {
  ticketNumber: create(SupportTicketNumberSchema, { value: "T-7" }),
  customerQuestion: "Where is my order?",
});
const reply = create(ProposedSupportReplySchema, { replyText: "Your order is being prepared." });
const routed = create(SupportRoutingResultSchema, { queue: { value: "tier-two" } });
const conversation = create(ConversationIdSchema, { value: "ticket-T-7" });
const identity = { provider: "scripted", account: "local", endpoint: "memory", model: "support" };
const connection = {
  provider: { value: identity.provider },
  account: { value: identity.account },
  endpoint: { value: identity.endpoint },
  model: { value: identity.model },
};
const limits = {
  modelRequests: 1,
  toolCalls: 0,
  deadlineMs: 30_000,
  maxInputBytes: 1_000,
  maxOutputBytes: 200,
};
const generation = AiModel.define({
  name: "propose-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Propose a support reply.",
  outputMode: "prompt-and-validate",
  limits: { ...limits, maxOutputTokens: 100 },
});
const correctiveGeneration = AiModel.define({
  name: "propose-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Propose a support reply.",
  outputMode: "prompt-and-validate",
  limits: { ...limits, modelRequests: 2, maxOutputTokens: 100 },
});
const revisedGeneration = AiModel.define({
  name: "propose-support-reply",
  version: "v2",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Propose a support reply.",
  outputMode: "prompt-and-validate",
  limits: { ...limits, maxOutputTokens: 100 },
});
const decision = AiModel.define({
  name: "route-support-ticket",
  version: "v1",
  kind: "decision",
  input: SupportTicketFactsSchema,
  output: SupportRoutingResultSchema,
  limits,
  questions: { safe: { type: "boolean", instructions: "Is this ticket safe to route?" } },
  mapping: { version: "v1", toMessage: () => routed },
});

type Kind = "generation" | "decision";

function harness(kind: Kind, correction = false) {
  const model = kind === "decision" ? decision : correction ? correctiveGeneration : generation;
  const ref = ModelRef.of(`scripted-${kind}`, "v1");
  let physicalRequests = 0;
  let executeCalls = 0;
  let rejectTerminalWrite = false;
  let promptJson = '{"messages":[],"tools":[]}';
  let correctionDetails = "not json";
  let decisionInstruction = "Is this ticket safe to route?";
  const backend = createBackendRegistration({
    ref,
    kind,
    supports: () => true,
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: () => ({ model: {}, identity }),
    execute: async (execution: AiBackendExecution) => {
      executeCalls++;
      const content =
        kind === "generation"
          ? create(GenerationRequestSchema, {
              input: AnyMessages.pack(SupportTicketFactsSchema, input),
              instructions: "Propose a support reply.",
              outputSchemaJson: '{"type":"object"}',
              promptJson,
              digest: {
                value: createHash("sha256")
                  .update(toBinary(SupportTicketFactsSchema, input))
                  .update("Propose a support reply.")
                  .update('{"type":"object"}')
                  .update(promptJson)
                  .digest("hex"),
              },
            })
          : create(DecisionRequestSchema, {
              input: AnyMessages.pack(SupportTicketFactsSchema, input),
              questions: [
                create(DecisionQuestionSchema, {
                  id: { value: "safe" },
                  kind: DecisionQuestionKind.BOOLEAN,
                  instructions: decisionInstruction,
                }),
              ],
              digest: {
                value: createHash("sha256").update(decisionInstruction).digest("hex"),
              },
            });
      if (correction && kind === "generation") {
        if (content.$typeName !== GenerationRequestSchema.typeName)
          throw new Error("Expected a generation request for correction.");
        const first = await execution.control.beginAttempt({ kind: "generation", content });
        let firstId: string;
        let issues: readonly { code: string; path: string; message: string }[];
        if ("kind" in first) {
          expect(first.response.outcome).toBe(AiOutcome.INVALID_OUTPUT);
          expect(first.failure?.code).toBe("INVALID_OUTPUT");
          expect(first.failure?.diagnosticId).toBe(first.response.diagnosticId?.value);
          firstId = first.id;
          issues = first.issues ?? [];
        } else {
          physicalRequests++;
          firstId = first.id;
          await execution.control.reserveTransport(first.id, 20, 200);
          const admission = await execution.control.admitGeneration(
            "not json",
            execution.definition,
            execution.input,
          );
          if (admission.ok) throw new Error("Malformed output was unexpectedly admitted.");
          issues = admission.issues;
          const failure = await execution.control.recordFailure("INVALID_OUTPUT", false);
          await execution.control.finishAttempt({
            ticketId: first.id,
            receivedBytes: 8,
            issues,
            response: create(GenerationResponseSchema, {
              rawOutput: "not json",
              outcome: AiOutcome.INVALID_OUTPUT,
              diagnosticId: { value: failure.diagnosticId },
            }),
          });
        }
        const correctivePrompt = JSON.stringify({
          priorOutput: correctionDetails,
          issues,
        });
        const correctedRequest = create(GenerationRequestSchema, {
          input: AnyMessages.pack(SupportTicketFactsSchema, input),
          instructions: "Propose a support reply.",
          outputSchemaJson: '{"type":"object"}',
          promptJson: correctivePrompt,
          corrects: { value: firstId },
          digest: { value: createHash("sha256").update(correctivePrompt).digest("hex") },
        });
        const second = await execution.control.beginAttempt({
          kind: "generation",
          content: correctedRequest,
        });
        if ("kind" in second) {
          expect(second.response.outcome).toBe(AiOutcome.ADMITTED);
          return { ok: true, value: reply };
        }
        physicalRequests++;
        await execution.control.reserveTransport(second.id, 20, 200);
        await execution.control.finishAttempt({
          ticketId: second.id,
          receivedBytes: 10,
          response: create(GenerationResponseSchema, {
            rawOutput: '{"replyText":"Your order is being prepared."}',
            outcome: AiOutcome.ADMITTED,
            admittedOutput: AnyMessages.pack(ProposedSupportReplySchema, reply),
          }),
        });
        return { ok: true, value: reply };
      }
      const attempt = await execution.control.beginAttempt({ kind, content } as Parameters<
        typeof execution.control.beginAttempt
      >[0]);
      if ("kind" in attempt) {
        expect(attempt.response.$typeName).toBe(
          kind === "generation"
            ? GenerationResponseSchema.typeName
            : DecisionResponseSchema.typeName,
        );
        return { ok: true, value: kind === "generation" ? reply : routed };
      }
      physicalRequests++;
      await execution.control.reserveTransport(attempt.id, 20, 200);
      const response =
        kind === "generation"
          ? create(GenerationResponseSchema, {
              rawOutput: '{"replyText":"Your order is being prepared."}',
              outcome: AiOutcome.ADMITTED,
              admittedOutput: AnyMessages.pack(ProposedSupportReplySchema, reply),
              digest: { value: "c".repeat(64) },
            })
          : create(DecisionResponseSchema, {
              outcome: AiOutcome.ADMITTED,
              answers: [
                {
                  id: { value: "safe" },
                  kind: DecisionQuestionKind.BOOLEAN,
                  value: { case: "booleanProbability", value: 0.75 },
                },
              ],
              admittedOutput: AnyMessages.pack(SupportRoutingResultSchema, routed),
            });
      await execution.control.finishAttempt({ ticketId: attempt.id, receivedBytes: 10, response });
      return { ok: true, value: kind === "generation" ? reply : routed };
    },
  });
  const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-7" });
  const source = create(MessageIdSchema, {
    id: AnyMessages.pack(SupportReplyAgentIdSchema, agentId),
    typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
  });
  const key = create(AgentInvocationKeySchema, {
    scope: create(AgentExecutionScopeSchema, {
      stateType: "support.SupportAgent",
      agentKey: "T-7",
    }),
    sourceSignal: create(AgentSignalKeySchema, {
      id: { case: "command", value: create(CommandIdSchema, { uuid: "source-7" }) },
    }),
  });
  let saved = create(AgentExecutionRecordSchema, {
    accepted: create(AgentAcceptedInvocationSchema, { key }),
    status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
    claimToken: "claim-7",
    started: create(AgentExecutionStartSchema, {
      deadline: create(TimestampSchema, { seconds: Time.currentTime().seconds + 60n }),
      initialVersion: create(VersionSchema, { number: 0 }),
      bounds: create(AgentInvocationBoundsSchema, {
        operations: 1n,
        modelRequests: correction ? 2n : 1n,
        toolCalls: 0n,
        recordedReads: 0n,
        deadlineMillis: 60_000n,
        totalInputBytes: 4_000n,
        totalOutputBytes: 4_000n,
        maxRecoveryBytes: 24_000n,
      }),
      models: [
        create(AgentSelectedModelSchema, {
          kind: kind === "generation" ? 1 : 2,
          model: ref,
          connection,
        }),
      ],
    }),
  });
  const storage: Pick<
    AgentExecutionStorage<unknown, Message>,
    "capacity" | "update" | "renew" | "read" | "complete" | "markDelivered"
  > = {
    capacity: {},
    update: ({ expectedRecordBytes, next }) => {
      expect(expectedRecordBytes).toEqual(toBinary(AgentExecutionRecordSchema, saved));
      if (
        rejectTerminalWrite &&
        next.journal.some(
          (entry) =>
            entry.evidence.case === "operation" && entry.evidence.value.result.case !== undefined,
        )
      ) {
        rejectTerminalWrite = false;
        return Promise.reject(new Error("interrupted before result persistence"));
      }
      saved = clone(AgentExecutionRecordSchema, next);
      return Promise.resolve();
    },
    renew: () => Promise.resolve(false),
    read: () => Promise.resolve(clone(AgentExecutionRecordSchema, saved)),
    complete: () => Promise.resolve(),
    markDelivered: () => Promise.resolve(),
  };
  const registry = AiRegistry.create({
    defaultModels: { [kind]: ref },
    invocationLimits: {
      operations: 1,
      modelRequests: correction ? 2 : 1,
      toolCalls: 0,
      recordedReads: 0,
      deadlineMs: 60_000,
      totalInputBytes: 4_000,
      totalOutputBytes: 4_000,
      maxRecoveryBytes: 24_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  }).register(backend);
  const runtime = () =>
    new AgentAiRuntime(
      registry,
      { models: kind === "generation" ? [model, revisedGeneration] : [model] },
      {
        actor: create(ActorContextSchema),
        tenant: { kind: "single-tenant" },
        agent: source,
        source,
      },
      new AgentExecutionSession(storage, saved, "claim-7"),
      0,
      undefined,
    );
  return {
    model,
    runtime,
    saved: () => clone(AgentExecutionRecordSchema, saved),
    interruptTerminalWrite: () => {
      rejectTerminalWrite = true;
    },
    changePreparedPrompt: () => {
      promptJson = '{"messages":["changed"],"tools":[]}';
    },
    changeCorrectionDetails: () => {
      correctionDetails = "different prior output";
    },
    changeDecisionQuestion: () => {
      decisionInstruction = "Should this ticket be escalated?";
    },
    counts: () => ({ physicalRequests, executeCalls }),
  };
}

describe("Agent AI replay from a persisted execution journal", () => {
  it.each(["generation", "decision"] as const)(
    "reuses the completed %s physical attempt and then the saved named result",
    async (kind) => {
      const fixture = harness(kind);
      fixture.interruptTerminalWrite();
      const request = { call: "draft", conversation, input };
      const invoke = () =>
        kind === "generation"
          ? fixture.runtime().invoke(generation, request)
          : fixture.runtime().invoke(decision, request);
      await expect(invoke()).rejects.toThrow("interrupted before result persistence");
      const attempt = fixture.saved().journal.find((entry) => entry.evidence.case === "attempt");
      expect(attempt?.evidence.case).toBe("attempt");
      if (attempt?.evidence.case !== "attempt") throw new Error("Expected a physical attempt.");
      expect(attempt.evidence.value.response.case).toBe(
        kind === "generation" ? "generationResponse" : "decisionResponse",
      );
      expect(fixture.counts().physicalRequests).toBe(1);
      const resumed = await invoke();
      expect(resumed.ok).toBe(true);
      expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
      const savedResult = await invoke();
      expect(savedResult).toEqual(resumed);
      expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
    },
  );

  it("rejects changed named call, conversation and typed input before backend execution", async () => {
    const fixture = harness("generation");
    const original = { call: "draft", conversation, input };
    expect((await fixture.runtime().invoke(generation, original)).ok).toBe(true);
    const changed = [
      { ...original, call: "other" },
      { ...original, conversation: create(ConversationIdSchema, { value: "other-ticket" }) },
      {
        ...original,
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: "T-7" }),
          customerQuestion: "Cancel my order",
        }),
      },
    ];
    for (const request of changed)
      await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
        "changed on recovery",
      );
    await expect(fixture.runtime().invoke(revisedGeneration, original)).rejects.toThrow(
      "changed on recovery",
    );
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 1 });
  });

  it("rejects a changed prepared prompt before reusing a saved physical response", async () => {
    const fixture = harness("generation");
    const request = { call: "draft", conversation, input };
    fixture.interruptTerminalWrite();
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
      "interrupted before result persistence",
    );
    fixture.changePreparedPrompt();
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
      "provider request changed on recovery",
    );
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
  });

  it("rejects a changed decision question before reusing a saved answer", async () => {
    const fixture = harness("decision");
    const request = { call: "route", conversation, input };
    fixture.interruptTerminalWrite();
    await expect(fixture.runtime().invoke(decision, request)).rejects.toThrow(
      "interrupted before result persistence",
    );
    fixture.changeDecisionQuestion();
    await expect(fixture.runtime().invoke(decision, request)).rejects.toThrow(
      "provider request changed on recovery",
    );
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
  });

  it("replays invalid-output issues and the corrected generation response without redispatch", async () => {
    const fixture = harness("generation", true);
    const request = { call: "draft", conversation, input };
    fixture.interruptTerminalWrite();
    await expect(fixture.runtime().invoke(correctiveGeneration, request)).rejects.toThrow(
      "interrupted before result persistence",
    );
    const attempts = fixture.saved().journal.filter((entry) => entry.evidence.case === "attempt");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.evidence.case).toBe("attempt");
    if (attempts[0]?.evidence.case !== "attempt") throw new Error("Expected saved correction.");
    expect(attempts[0].evidence.value.validationIssues.length).toBeGreaterThan(0);
    expect(attempts[0].evidence.value.response.case).toBe("generationResponse");
    if (attempts[0].evidence.value.response.case !== "generationResponse")
      throw new Error("Expected the original invalid response.");
    expect(attempts[0].evidence.value.response.value.diagnosticId?.value).toBeTruthy();
    const resumed = await fixture.runtime().invoke(correctiveGeneration, request);
    expect(resumed.ok).toBe(true);
    expect(fixture.counts()).toEqual({ physicalRequests: 2, executeCalls: 2 });
  });

  it("rejects changed correction content while retaining the first invalid attempt", async () => {
    const fixture = harness("generation", true);
    const request = { call: "draft", conversation, input };
    fixture.interruptTerminalWrite();
    await expect(fixture.runtime().invoke(correctiveGeneration, request)).rejects.toThrow(
      "interrupted before result persistence",
    );
    fixture.changeCorrectionDetails();
    await expect(fixture.runtime().invoke(correctiveGeneration, request)).rejects.toThrow(
      "provider request changed on recovery",
    );
    expect(fixture.counts()).toEqual({ physicalRequests: 2, executeCalls: 2 });
  });
});
