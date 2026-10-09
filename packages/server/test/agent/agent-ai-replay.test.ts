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
import { AiModel, AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import {
  AiMcpSetupFailure,
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
import type {
  AgentExecutionCapacity,
  AgentExecutionStorage,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import { AgentAiRuntime } from "../../src/agent/agent-ai-runtime.js";
import { AgentExecutionSession } from "../../src/agent/agent-execution-session.js";
import { SupportReplyAgentIdSchema } from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
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
const mcpGeneration = AiModel.define({
  name: "propose-support-reply",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Propose a support reply.",
  outputMode: "prompt-and-validate",
  tools: [{ server: "knowledge", tool: "lookup" }],
  limits: { ...limits, toolCalls: 1, maxOutputTokens: 100 },
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

type BoundaryFault =
  | "invalid-credit"
  | "unknown-ticket"
  | "duplicate-reservation"
  | "missing-reservation"
  | "receipt-mismatch"
  | "over-credit";

function harness(
  kind: Kind,
  correction = false,
  fail = false,
  boundaryFault?: BoundaryFault,
  anthropicPrepared = false,
  setupFailure?: "denied" | "unsupported",
) {
  const model =
    kind === "decision"
      ? decision
      : setupFailure
        ? mcpGeneration
        : correction
          ? correctiveGeneration
          : generation;
  const ref = ModelRef.of(`scripted-${kind}`, "v1");
  const selectedIdentity = anthropicPrepared
    ? { ...identity, provider: "anthropic", model: "claude-sonnet-4-5" }
    : identity;
  let physicalRequests = 0;
  let executeCalls = 0;
  let rejectTerminalWrite = false;
  let promptJson = anthropicPrepared
    ? JSON.stringify({
        messages: [],
        tools: [],
        provider: {
          profile: "anthropic-messages-v1",
          lowering: "anthropic-4.0.72-v1",
          outputMode: "native-schema",
          providerOptions: { anthropic: { structuredOutputMode: "outputFormat" } },
        },
      })
    : '{"messages":[],"tools":[]}';
  let correctionDetails = "not json";
  let decisionInstruction = "Is this ticket safe to route?";
  let identityChanged = false;
  let connectionChanged = false;
  let authorizationDenied = false;
  let boundaryError: unknown;
  const authorizeConnect = vi.fn(() => setupFailure !== "denied");
  const discover = vi.fn(() => Promise.reject(new AiMcpSetupFailure("UNSUPPORTED_CAPABILITY")));
  const protocolConnect = vi.fn(() =>
    Promise.resolve({
      identity: {
        serverId: "knowledge",
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update("https://example.invalid/mcp").digest("hex")}`,
      },
      discover,
      validateArguments: vi.fn(),
      call: vi.fn(() => Promise.reject(new Error("Unexpected tool call."))),
      close: vi.fn(() => Promise.resolve()),
    }),
  );
  const capacity: AgentExecutionCapacity = {};
  const backend = createBackendRegistration({
    ref,
    kind,
    ...(setupFailure ? { mcp: { connect: protocolConnect } } : {}),
    supports: () => true,
    resolveIdentity: () =>
      identityChanged ? { ...selectedIdentity, model: "unexpected-deployment" } : selectedIdentity,
    authorizeUse: () => !authorizationDenied,
    connect: () => ({
      model: {},
      identity: connectionChanged
        ? { ...selectedIdentity, model: "unexpected-connection" }
        : selectedIdentity,
    }),
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
        if (fail) {
          expect(attempt.response.outcome).toBe(AiOutcome.FAILED);
          if (attempt.failure === undefined) throw new Error("Saved failure is missing.");
          return { ok: false, failure: attempt.failure };
        }
        return { ok: true, value: kind === "generation" ? reply : routed };
      }
      if (boundaryFault !== undefined) {
        try {
          if (boundaryFault === "invalid-credit")
            await execution.control.reserveTransport(attempt.id, -1, 200);
          if (boundaryFault === "unknown-ticket")
            await execution.control.reserveTransport("unknown", 20, 200);
          if (
            boundaryFault !== "invalid-credit" &&
            boundaryFault !== "unknown-ticket" &&
            boundaryFault !== "missing-reservation"
          )
            await execution.control.reserveTransport(attempt.id, 20, 200);
          if (boundaryFault === "duplicate-reservation")
            await execution.control.reserveTransport(attempt.id, 20, 200);
          if (boundaryFault === "receipt-mismatch") execution.control.onReceived(attempt.id, 3);
          await execution.control.finishAttempt({
            ticketId: attempt.id,
            receivedBytes:
              boundaryFault === "receipt-mismatch" ? 4 : boundaryFault === "over-credit" ? 201 : 1,
            response: create(GenerationResponseSchema, { outcome: AiOutcome.ADMITTED }),
          });
          throw new Error("Expected Agent attempt boundary to reject invalid work.");
        } catch (error) {
          boundaryError = error;
          throw error;
        }
      }
      await execution.control.reserveTransport(attempt.id, 20, 200);
      physicalRequests++;
      if (fail) {
        const failure = await execution.control.recordFailure("UNAVAILABLE", true);
        const response =
          kind === "generation"
            ? create(GenerationResponseSchema, {
                outcome: AiOutcome.FAILED,
                diagnosticId: { value: failure.diagnosticId },
              })
            : create(DecisionResponseSchema, {
                outcome: AiOutcome.FAILED,
                diagnosticId: { value: failure.diagnosticId },
              });
        await execution.control.finishAttempt({
          ticketId: attempt.id,
          receivedBytes: 10,
          response,
        });
        return { ok: false, failure };
      }
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
  const agent = create(MessageIdSchema, {
    id: AnyMessages.pack(SupportReplyAgentIdSchema, agentId),
    typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
  });
  const source = create(MessageIdSchema, {
    id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-7" })),
    typeUrl: TypeUrls.derive(DraftSupportReplySchema),
  });
  expect(source.typeUrl).toBe(TypeUrls.derive(DraftSupportReplySchema));
  expect(source.id?.typeUrl).not.toBe(agent.id?.typeUrl);
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
        toolCalls: setupFailure ? 1n : 0n,
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
          connection: anthropicPrepared
            ? {
                ...connection,
                provider: { value: selectedIdentity.provider },
                model: { value: selectedIdentity.model },
              }
            : connection,
        }),
      ],
    }),
  });
  const storage: Pick<
    AgentExecutionStorage<unknown, Message>,
    "capacity" | "update" | "renew" | "read" | "complete" | "markDelivered"
  > = {
    capacity,
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
  let registry = AiRegistry.create({
    defaultModels: { [kind]: ref },
    invocationLimits: {
      operations: 1,
      modelRequests: correction ? 2 : 1,
      toolCalls: setupFailure ? 1 : 0,
      recordedReads: 0,
      deadlineMs: 60_000,
      totalInputBytes: 4_000,
      totalOutputBytes: 4_000,
      maxRecoveryBytes: 24_000,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
  }).register(backend);
  if (setupFailure)
    registry = registry.registerTools(
      Mcp.server({
        id: "knowledge",
        revision: "v1",
        authorizeConnect,
        transport: { kind: "streamable-http", url: "https://example.invalid/mcp" },
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 1_024,
            maxResultBytes: 1_024,
            authorize: () => true,
          },
        },
      }),
    );
  const runtime = () =>
    new AgentAiRuntime(
      registry,
      { models: kind === "generation" ? [model, revisedGeneration] : [model] },
      {
        actor: create(ActorContextSchema),
        tenant: { kind: "single-tenant" },
        agent,
        source,
      },
      new AgentExecutionSession(storage, saved, "claim-7"),
      0,
      undefined,
    );
  return {
    model,
    authorizeConnect,
    discover,
    protocolConnect,
    runtime,
    saved: () => clone(AgentExecutionRecordSchema, saved),
    changeSaved: (change: (record: typeof saved) => void) => {
      change(saved);
    },
    interruptTerminalWrite: () => {
      rejectTerminalWrite = true;
    },
    changePreparedPrompt: () => {
      promptJson = '{"messages":["changed"],"tools":[]}';
    },
    preparedPrompt: () => promptJson,
    changeAnthropicMetadata: (field: "lowering" | "outputMode" | "providerOptions") => {
      const prepared = JSON.parse(promptJson) as { provider: Record<string, unknown> };
      prepared.provider[field] =
        field === "providerOptions"
          ? { anthropic: { structuredOutputMode: "jsonTool" } }
          : "changed";
      promptJson = JSON.stringify(prepared);
    },
    changeCorrectionDetails: () => {
      correctionDetails = "different prior output";
    },
    changeDecisionQuestion: () => {
      decisionInstruction = "Should this ticket be escalated?";
    },
    changeIdentity: () => {
      identityChanged = true;
    },
    changeConnection: () => {
      connectionChanged = true;
    },
    denyAuthorization: () => {
      authorizationDenied = true;
    },
    corruptSavedOutput: () => {
      const operation = saved.journal.find((entry) => entry.evidence.case === "operation");
      if (operation?.evidence.case !== "operation")
        throw new Error("Expected a saved named operation.");
      operation.evidence.value.result = {
        case: "admittedOutput",
        value: AnyMessages.pack(SupportTicketFactsSchema, input),
      };
    },
    counts: () => ({ physicalRequests, executeCalls }),
    boundaryError: () => boundaryError,
    setCapacity: (limits: AgentExecutionCapacity) => {
      Object.assign(capacity, limits);
    },
  };
}

describe("Agent AI replay from a persisted execution journal", () => {
  it("rejects a missing saved deployment before executing the backend", async () => {
    const fixture = harness("generation");
    fixture.changeSaved((record) => {
      const started = record.started;
      if (started === undefined) throw new Error("Expected accepted start.");
      started.models = [];
    });
    await expect(
      fixture.runtime().invoke(generation, { call: "draft", conversation, input }),
    ).rejects.toThrow("no saved authenticated deployment");
    expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 0 });
  });

  it.each(["operation", "invocation"] as const)(
    "rejects a missing saved %s deadline before replaying a physical response",
    async (missing) => {
      const fixture = harness("generation");
      const request = { call: "draft", conversation, input };
      fixture.interruptTerminalWrite();
      await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
        "interrupted before result persistence",
      );
      fixture.changeSaved((record) => {
        if (missing === "invocation") {
          const started = record.started;
          if (started === undefined) throw new Error("Expected accepted start.");
          started.deadline = undefined;
        } else {
          const entry = record.journal.find((item) => item.evidence.case === "operation");
          if (entry?.evidence.case !== "operation") throw new Error("Expected saved operation.");
          entry.evidence.value.deadline = undefined;
        }
      });
      await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
        "deadline was not saved",
      );
      expect(fixture.counts().physicalRequests).toBe(1);
    },
  );

  it.each(["provider", "account", "endpoint", "model"] as const)(
    "rejects a saved deployment missing %s before provider execution",
    async (field) => {
      const fixture = harness("generation");
      fixture.changeSaved((record) => {
        const connection = record.started?.models[0]?.connection;
        if (connection === undefined) throw new Error("Expected saved deployment.");
        connection[field] = undefined;
      });
      await expect(
        fixture.runtime().invoke(generation, { call: "draft", conversation, input }),
      ).rejects.toMatchObject({ reason: "REVISION_CHANGED" });
      expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 0 });
    },
  );

  it.each([
    [{ executionRecordBytes: 1 }, "execution record"],
    [{ executionHeadBytes: 1 }, "execution head"],
    [{ historyRecordBytes: 1 }, "conversation history"],
    [{ transactionPayloadBytes: 1 }, "transaction payload"],
  ] as const)("rejects provider capacity %o before dispatch", async (capacity, message) => {
    const fixture = harness("generation");
    fixture.setCapacity(capacity);
    await expect(
      fixture.runtime().invoke(generation, { call: "draft", conversation, input }),
    ).rejects.toThrow(message);
    expect(fixture.counts().physicalRequests).toBe(0);
  });

  it("reserves the bounded ordered generation envelope before provider dispatch", async () => {
    const fixture = harness("generation");
    fixture.setCapacity({ executionRecordBytes: 2_100 });
    await expect(
      fixture.runtime().invoke(generation, { call: "draft", conversation, input }),
    ).rejects.toThrow("execution record");
    expect(fixture.counts().physicalRequests).toBe(0);
  });

  it.each([
    ["invalid-credit", "byte bounds"],
    ["unknown-ticket", "ticket is unknown"],
    ["duplicate-reservation", "already reserved"],
    ["missing-reservation", "no live reservation"],
    ["receipt-mismatch", "byte counts disagree"],
    ["over-credit", "exceeded reserved bytes"],
  ] as const)("rejects %s at the durable physical-attempt boundary", async (fault, message) => {
    const fixture = harness("generation", false, false, fault);
    await expect(
      fixture.runtime().invoke(generation, { call: "draft", conversation, input }),
    ).rejects.toThrow(
      fault === "invalid-credit" || fault === "unknown-ticket" ? message : "cancelled",
    );
    const boundaryError = fixture.boundaryError();
    if (!(boundaryError instanceof Error)) throw new Error("Expected Agent boundary failure.");
    expect(boundaryError.message).toContain(message);
    expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 1 });
    expect(
      fixture.saved().journal.filter((entry) => entry.evidence.case === "attempt"),
    ).toHaveLength(1);
  });

  it("requires unique call names and respects the accepted operation count", async () => {
    const fixture = harness("generation");
    const runtime = fixture.runtime();
    const request = { call: "draft", conversation, input };
    expect((await runtime.invoke(generation, request)).ok).toBe(true);
    await expect(runtime.invoke(generation, request)).rejects.toThrow("unique");
    await expect(runtime.invoke(generation, { ...request, call: "second" })).rejects.toMatchObject({
      reason: "MODEL_BUDGET_EXCEEDED",
    });
    runtime.finish();
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
  });

  it("rejects unsupported preferences and callbacks after the handler closes", async () => {
    const fixture = harness("generation");
    const runtime = fixture.runtime();
    expect(() => {
      runtime.select(0, undefined);
    }).toThrow("supported kind");
    runtime.select(1, ModelRef.of("scripted-generation", "v1"));
    runtime.close();
    expect(() => {
      runtime.select(1, undefined);
    }).toThrow("closed");
    await expect(
      runtime.invoke(generation, { call: "draft", conversation, input }),
    ).rejects.toThrow("closed");
    expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 0 });
  });

  it("rejects an invalid saved terminal failure before backend execution", async () => {
    const fixture = harness("generation", false, true);
    const request = { call: "draft", conversation, input };
    expect((await fixture.runtime().invoke(generation, request)).ok).toBe(false);
    fixture.changeSaved((record) => {
      const entry = record.journal.find((item) => item.evidence.case === "operation");
      if (entry?.evidence.case !== "operation" || entry.evidence.value.result.case !== "failure")
        throw new Error("Expected saved failure.");
      entry.evidence.value.result.value.diagnostic = undefined;
    });
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow("failure category");
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 1 });
  });

  it("refuses to resend an attempt whose durable response is absent", async () => {
    const fixture = harness("generation");
    const request = { call: "draft", conversation, input };
    fixture.interruptTerminalWrite();
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
      "interrupted before result persistence",
    );
    fixture.changeSaved((record) => {
      const entry = record.journal.find((item) => item.evidence.case === "attempt");
      if (entry?.evidence.case !== "attempt") throw new Error("Expected saved attempt.");
      entry.evidence.value.response = { case: undefined };
    });
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow("cannot be resent");
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
  });

  it("rejects a response referencing a missing saved diagnostic", async () => {
    const fixture = harness("generation", false, true);
    const request = { call: "draft", conversation, input };
    fixture.interruptTerminalWrite();
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
      "interrupted before result persistence",
    );
    fixture.changeSaved((record) => {
      const entry = record.journal.find((item) => item.evidence.case === "operation");
      if (entry?.evidence.case !== "operation") throw new Error("Expected saved operation.");
      entry.evidence.value.diagnostics = [];
    });
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
      "unknown diagnostic",
    );
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
  });

  it("rejects a saved output with the wrong domain type before backend execution", async () => {
    const fixture = harness("generation");
    const request = { call: "draft", conversation, input };
    expect((await fixture.runtime().invoke(generation, request)).ok).toBe(true);
    fixture.corruptSavedOutput();
    await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
      "output type changed",
    );
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 1 });
  });

  it.each([
    ["changed model identity", "changeIdentity", "identity or authorization changed"],
    ["denied model use", "denyAuthorization", "identity or authorization changed"],
    ["changed connection identity", "changeConnection", "identity changed"],
  ] as const)("blocks %s before a physical request", async (_label, change, message) => {
    const fixture = harness("generation");
    fixture[change]();
    await expect(
      fixture.runtime().invoke(generation, { call: "draft", conversation, input }),
    ).rejects.toThrow(message);
    expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 0 });
    expect(fixture.saved().journal.filter((entry) => entry.evidence.case === "attempt")).toEqual(
      [],
    );
  });

  it.each(["generation", "decision"] as const)(
    "replays a saved %s provider failure and its original diagnostic without another request",
    async (kind) => {
      const fixture = harness(kind, false, true);
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
      expect(attempt.evidence.value.response.value?.diagnosticId?.value).toBeTruthy();
      expect(fixture.counts().physicalRequests).toBe(1);
      const resumed = await invoke();
      expect(resumed).toMatchObject({
        ok: false,
        failure: { code: "UNAVAILABLE", retryableByNewSignal: true },
      });
      expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
      expect(await invoke()).toEqual(resumed);
      expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
    },
  );

  it("replays a saved MCP setup denial without authorization, discovery, or provider callbacks", async () => {
    const fixture = harness("generation", false, false, undefined, false, "denied");
    const request = { call: "draft", conversation, input };
    const first = await fixture.runtime().invoke(mcpGeneration, request);
    expect(first).toMatchObject({
      ok: false,
      failure: { code: "AUTHENTICATION_REQUIRED", retryableByNewSignal: false },
    });
    expect(fixture.authorizeConnect).toHaveBeenCalledOnce();
    expect(fixture.protocolConnect).not.toHaveBeenCalled();
    const replayed = await fixture.runtime().invoke(mcpGeneration, request);
    expect(replayed).toEqual(first);
    expect(fixture.authorizeConnect).toHaveBeenCalledOnce();
    expect(fixture.protocolConnect).not.toHaveBeenCalled();
    expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 0 });
  });

  it("replays a saved unsupported catalog without a second connection or model call", async () => {
    const fixture = harness("generation", false, false, undefined, false, "unsupported");
    const request = { call: "draft", conversation, input };
    const first = await fixture.runtime().invoke(mcpGeneration, request);
    expect(first).toMatchObject({
      ok: false,
      failure: { code: "UNSUPPORTED_CAPABILITY", retryableByNewSignal: false },
    });
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("Expected a saved MCP setup failure.");
    expect(first.operationId.value).toBeTruthy();
    expect(first.failure.diagnosticId).toBeTruthy();
    expect(fixture.authorizeConnect).toHaveBeenCalledOnce();
    expect(fixture.protocolConnect).toHaveBeenCalledOnce();
    expect(fixture.discover).toHaveBeenCalledOnce();
    const resumed = await fixture.runtime().invoke(mcpGeneration, request);
    expect(resumed).toEqual(first);
    expect(fixture.authorizeConnect).toHaveBeenCalledOnce();
    expect(fixture.protocolConnect).toHaveBeenCalledOnce();
    expect(fixture.discover).toHaveBeenCalledOnce();
    expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 0 });
  });

  it("rejects a failed MCP setup outcome write instead of reporting a saved result", async () => {
    const fixture = harness("generation", false, false, undefined, false, "denied");
    fixture.interruptTerminalWrite();
    await expect(
      fixture.runtime().invoke(mcpGeneration, { call: "draft", conversation, input }),
    ).rejects.toThrow("interrupted before result persistence");
    expect(fixture.authorizeConnect).toHaveBeenCalledOnce();
    expect(fixture.protocolConnect).not.toHaveBeenCalled();
    expect(fixture.counts()).toEqual({ physicalRequests: 0, executeCalls: 0 });
  });

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
    await expect(fixture.runtime().invoke(generation, request)).rejects.toMatchObject({
      reason: "REPLAY_DIVERGENCE",
      message: "Saved Agent provider request changed on recovery.",
    });
    expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
  });

  it.each(["lowering", "outputMode", "providerOptions"] as const)(
    "rejects changed Anthropic %s metadata before replay or external effects",
    async (field) => {
      const fixture = harness("generation", false, false, undefined, true);
      const request = { call: "draft", conversation, input };
      fixture.interruptTerminalWrite();
      await expect(fixture.runtime().invoke(generation, request)).rejects.toThrow(
        "interrupted before result persistence",
      );
      const before = JSON.parse(fixture.preparedPrompt()) as Record<string, unknown>;
      fixture.changeAnthropicMetadata(field);
      const after = JSON.parse(fixture.preparedPrompt()) as Record<string, unknown>;
      const originalProvider = before.provider as Record<string, unknown>;
      const changedProvider = after.provider as Record<string, unknown>;
      expect(changedProvider[field]).not.toEqual(originalProvider[field]);
      expect({
        ...after,
        provider: { ...changedProvider, [field]: originalProvider[field] },
      }).toEqual(before);
      await expect(fixture.runtime().invoke(generation, request)).rejects.toMatchObject({
        reason: "REPLAY_DIVERGENCE",
        message: "Saved Agent provider request changed on recovery.",
      });
      expect(fixture.counts()).toEqual({ physicalRequests: 1, executeCalls: 2 });
      expect(
        fixture.saved().journal.filter((entry) => entry.evidence.case?.startsWith("tool")),
      ).toEqual([]);
    },
  );

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
