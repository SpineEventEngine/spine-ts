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

import { create, isMessage, toBinary } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { AiModel, AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import {
  createBackendRegistration,
  type AiBackendExecution,
  type AiMcpProtocolControl,
} from "@spine-event-engine/ai/spi/adapter";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { ActorContextSchema, CommandIdSchema, MessageIdSchema } from "@spine-event-engine/proto";
import {
  AiModelKind,
  ConversationIdSchema,
  GenerationResponseSchema,
  AiOutcome,
  GenerationRequestSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  DecisionQuestionSchema,
  DecisionQuestionIdSchema,
  DecisionQuestionKind,
  DecisionChoiceSchema,
  DecisionAlternativeKeySchema,
  DecisionAnswerSchema,
  DecisionDistributionSchema,
  DecisionProbabilitySchema,
  AgentAiResultAdmittedSchema,
  AiContentDigestSchema,
  AiDiagnosticIdSchema,
  ModelToolCallSchema,
  AgentToolCallFinishedSchema,
  AgentModelAttemptStartedSchema,
  AgentModelAttemptFinishedSchema,
  ToolResponseSchema,
  type AgentHistoryEntry,
  type ToolResponse,
} from "@spine-event-engine/proto/agent";
import type { AgentHistoryStorage } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import { AgentLiveAiRuntime } from "../../src/agent/agent-live-ai-runtime.js";
import { AgentLiveBudget } from "../../src/agent/agent-live-budget.js";
import { AgentLiveAudit } from "../../src/agent/agent-live-audit.js";
import { SignalMetadata } from "../../src/runtime/signal-metadata.js";
import { AgentModelSelection } from "../../src/agent/agent-model-selection.js";
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import { DraftSupportReplySchema } from "../../test-fixtures/generated/entity-metadata/support_agent_commands_pb.js";
import {
  ProposedSupportReplySchema,
  SupportRoutingResultSchema,
  SupportQueueNameSchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../test-fixtures/generated/entity-metadata/support_ai_types_pb.js";

const model = AiModel.define({
  name: "live-support",
  version: "v1",
  kind: "generation",
  input: SupportTicketFactsSchema,
  output: ProposedSupportReplySchema,
  instructions: "Draft a support reply.",
  outputMode: "prompt-and-validate",
  limits: { modelRequests: 1, toolCalls: 0, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
});
const ref = ModelRef.of("live-support-backend", "v1");

function liveFixture(
  ticketNumber: string,
  onAppend?: (entries: readonly AgentHistoryEntry[]) => void | Promise<void>,
) {
  const agentId = create(SupportReplyAgentIdSchema, { ticketNumber });
  const scope = {
    actor: create(ActorContextSchema),
    tenant: { kind: "single-tenant" as const },
    agent: create(MessageIdSchema, {
      id: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
      typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
    }),
    source: create(MessageIdSchema, {
      id: AnyPacker.pack(
        CommandIdSchema,
        create(CommandIdSchema, { uuid: `source-${ticketNumber}` }),
      ),
      typeUrl: TypeUrls.derive(DraftSupportReplySchema),
    }),
  };
  const metadata = new SignalMetadata({
    timeProvider: { currentTime: () => create(TimestampSchema, { seconds: 1_800_300_000n }) },
  });
  const source = SignalEnvelopes.command({
    schema: DraftSupportReplySchema,
    message: create(DraftSupportReplySchema, { agent: agentId, question: "Route this ticket" }),
    context: metadata.commandContext({}),
  });
  const saved: AgentHistoryEntry[] = [];
  const history = {
    capacity: {},
    appendAll: async (_id: unknown, entries: readonly AgentHistoryEntry[]) => {
      await onAppend?.(entries);
      saved.push(...entries);
    },
  } as unknown as AgentHistoryStorage<unknown>;
  const audit = new AgentLiveAudit(
    {
      source: { case: "command", value: source },
      recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
      stateType: SupportReplyAgentStateSchema.typeName,
    },
    SupportReplyAgentStateSchema,
    agentId,
    ticketNumber,
    history,
    metadata,
    () => undefined,
    () => Promise.resolve(),
  );
  return { scope, audit, saved };
}

describe("live Agent AI execution", () => {
  it("maps a live Decision and retains its typed request, response, and admitted audit", async () => {
    const decision = AiModel.define({
      name: "route-live-support",
      version: "v1",
      kind: "decision",
      input: SupportTicketFactsSchema,
      output: SupportRoutingResultSchema,
      questions: {
        queue: {
          type: "choice",
          instructions: "Which support queue handles this ticket?",
          criteria: { priority: "Priority support", standard: "Standard support" },
        },
      },
      mapping: {
        version: "v1",
        toMessage: (answers) =>
          create(SupportRoutingResultSchema, {
            queue: create(SupportQueueNameSchema, {
              value: answers.answers.queue?.type === "choice" ? answers.answers.queue.choice : "",
            }),
          }),
      },
      limits: { modelRequests: 1, toolCalls: 0, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
    });
    const decisionRef = ModelRef.of("live-support-decision", "v1");
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      const request = await execution.control.beginAttempt({
        kind: "decision",
        content: create(DecisionRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input as never),
          questions: [
            create(DecisionQuestionSchema, {
              id: create(DecisionQuestionIdSchema, { value: "queue" }),
              kind: DecisionQuestionKind.CHOICE,
              instructions: "Which support queue handles this ticket?",
              choices: [
                create(DecisionChoiceSchema, {
                  key: create(DecisionAlternativeKeySchema, { value: "priority" }),
                  description: "Priority support",
                }),
                create(DecisionChoiceSchema, {
                  key: create(DecisionAlternativeKeySchema, { value: "standard" }),
                  description: "Standard support",
                }),
              ],
            }),
          ],
          digest: create(AiContentDigestSchema, { value: "d".repeat(64) }),
        }),
      });
      await execution.control.reserveTransport(request.id, 100, 100);
      const admitted = await execution.control.admitDecision(
        {
          answers: {
            queue: {
              type: "choice",
              choice: "priority",
              probabilities: {
                priority: 0.9,
                standard: 0.1,
              },
            },
          },
        },
        execution.definition,
        execution.input,
      );
      if (!admitted.ok) throw new Error("Valid support routing answer was not admitted.");
      await execution.control.finishAttempt({
        ticketId: request.id,
        receivedBytes: 50,
        response: create(DecisionResponseSchema, {
          outcome: AiOutcome.ADMITTED,
          admittedOutput: AnyPacker.pack(SupportRoutingResultSchema, admitted.value as never),
          answers: [
            create(DecisionAnswerSchema, {
              id: create(DecisionQuestionIdSchema, { value: "queue" }),
              kind: DecisionQuestionKind.CHOICE,
              value: {
                case: "choice",
                value: create(DecisionAlternativeKeySchema, { value: "priority" }),
              },
              distribution: create(DecisionDistributionSchema, {
                probabilities: [
                  create(DecisionProbabilitySchema, {
                    key: create(DecisionAlternativeKeySchema, { value: "priority" }),
                    probability: 0.9,
                  }),
                  create(DecisionProbabilitySchema, {
                    key: create(DecisionAlternativeKeySchema, { value: "standard" }),
                    probability: 0.1,
                  }),
                ],
              }),
            }),
          ],
        }),
      });
      return { ok: true as const, value: admitted.value };
    });
    const registry = AiRegistry.create({ defaultModels: { decision: decisionRef } });
    registry.register(
      createBackendRegistration({
        ref: decisionRef,
        kind: "decision",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
      }),
    );
    const { scope, audit, saved } = liveFixture("T-decision");
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [decision] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "decision",
    );
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [decision] },
      scope,
      new Map([[AiModelKind.DECISION, selected]]),
      new AgentLiveBudget({ modelRequests: 1, totalOutputBytes: 1_024 }),
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );
    const result = await runtime.invoke(decision, {
      call: "route",
      conversation: create(ConversationIdSchema, { value: "support-route" }),
      input: create(SupportTicketFactsSchema, {
        ticketNumber: create(SupportTicketNumberSchema, { value: "T-decision" }),
        customerQuestion: "Please route this ticket",
      }),
    });
    if (!result.ok) throw new Error("Valid live decision was not admitted.");
    expect(result).toMatchObject({ ok: true, value: { queue: { value: "priority" } } });
    expect(execute).toHaveBeenCalledOnce();
    const system = saved.flatMap((entry) =>
      entry.item.case === "systemEvent" ? [entry.item.value.message] : [],
    );
    const starts = system.flatMap((item) => {
      const value = AnyPacker.tryUnpack(item, AgentModelAttemptStartedSchema);
      return value === undefined ? [] : [value];
    });
    const finishes = system.flatMap((item) => {
      const value = AnyPacker.tryUnpack(item, AgentModelAttemptFinishedSchema);
      return value === undefined ? [] : [value];
    });
    const admissions = system.flatMap((item) => {
      const value = AnyPacker.tryUnpack(item, AgentAiResultAdmittedSchema);
      return value === undefined ? [] : [value];
    });
    expect(starts).toHaveLength(1);
    expect(finishes).toHaveLength(1);
    expect(admissions).toHaveLength(1);
    expect(finishes[0]?.attempt).toEqual(starts[0]?.attempt);
    expect(finishes[0]?.operation).toEqual(starts[0]?.operation);
    expect(admissions[0]?.operation).toEqual(starts[0]?.operation);
    expect(finishes[0]?.outcome).toBe(AiOutcome.ADMITTED);
    const resultDigest = createHash("sha256")
      .update(toBinary(SupportRoutingResultSchema, result.value))
      .digest("hex");
    expect(admissions[0]?.result?.value).toBe(resultDigest);
    const conversation = saved.flatMap((entry) =>
      entry.item.case === "conversationRecord" ? [entry.item.value] : [],
    );
    const requests = conversation.flatMap((entry) => {
      const value = AnyPacker.tryUnpack(entry.content, DecisionRequestSchema);
      return value === undefined ? [] : [{ entry, value }];
    });
    const responses = conversation.flatMap((entry) => {
      const value = AnyPacker.tryUnpack(entry.content, DecisionResponseSchema);
      return value === undefined ? [] : [{ entry, value }];
    });
    expect(requests).toHaveLength(1);
    expect(responses).toHaveLength(1);
    const requestRecord = requests[0];
    const responseRecord = responses[0];
    if (requestRecord === undefined || responseRecord === undefined)
      throw new Error("Expected the Decision request and response audit rows.");
    expect(requests[0]?.entry.attempt).toEqual(starts[0]?.attempt);
    expect(responses[0]?.entry.attempt).toEqual(starts[0]?.attempt);
    expect(requests[0]?.entry.operation).toEqual(starts[0]?.operation?.operation);
    expect(responses[0]?.entry.operation).toEqual(starts[0]?.operation?.operation);
    expect(requests[0]?.entry.conversation?.value).toBe("support-route");
    expect(responses[0]?.entry.conversation?.value).toBe("support-route");
    expect(requests[0]?.value.digest?.value).toBe("d".repeat(64));
    expect(starts[0]?.request).toEqual(requests[0]?.value.digest);
    expect(AnyPacker.tryUnpack(requestRecord.value.input, SupportTicketFactsSchema)).toEqual(
      create(SupportTicketFactsSchema, {
        ticketNumber: create(SupportTicketNumberSchema, { value: "T-decision" }),
        customerQuestion: "Please route this ticket",
      }),
    );
    expect(requests[0]?.value.questions).toMatchObject([
      {
        id: { value: "queue" },
        kind: DecisionQuestionKind.CHOICE,
        instructions: "Which support queue handles this ticket?",
        choices: [
          { key: { value: "priority" }, description: "Priority support" },
          { key: { value: "standard" }, description: "Standard support" },
        ],
      },
    ]);
    expect(responses[0]?.value.outcome).toBe(AiOutcome.ADMITTED);
    expect(
      AnyPacker.tryUnpack(responseRecord.value.admittedOutput, SupportRoutingResultSchema),
    ).toEqual(result.value);
    expect(responses[0]?.value.answers).toMatchObject([
      {
        id: { value: "queue" },
        value: { case: "choice", value: { value: "priority" } },
        distribution: {
          probabilities: [
            { key: { value: "priority" }, probability: 0.9 },
            { key: { value: "standard" }, probability: 0.1 },
          ],
        },
      },
    ]);
  });

  it("rechecks model use after selection and before connecting the same invocation", async () => {
    let allowed = true;
    const connect = vi.fn(
      (
        _scope: unknown,
        identity: {
          provider: string;
          account: string;
          endpoint: string;
          model: string;
        },
      ) => ({ model: {}, identity }),
    );
    const execute = vi.fn(() => Promise.reject(new Error("Denied model reached the provider.")));
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => allowed,
        connect,
        execute,
      }),
    );
    const { scope, audit, saved } = liveFixture("T-revoked");
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [model] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    allowed = false;
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [model] },
      scope,
      new Map([[AiModelKind.GENERATION, selected]]),
      new AgentLiveBudget({ modelRequests: 1, totalOutputBytes: 1_024 }),
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );
    await expect(
      runtime.invoke(model, {
        call: "draft",
        conversation: create(ConversationIdSchema, { value: "support-revoked" }),
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: "T-revoked" }),
          customerQuestion: "Please draft",
        }),
      }),
    ).rejects.toThrow("identity or authorization changed");
    expect(connect).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("retains both physical correction attempts and admits only the validated reply", async () => {
    const correctionModel = AiModel.define({
      name: "live-support-correction",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a support reply.",
      outputMode: "prompt-and-validate",
      limits: { modelRequests: 2, toolCalls: 0, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
    });
    const correctionRef = ModelRef.of("live-support-correction-backend", "v1");
    const tickets: string[] = [];
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      if (!isMessage(execution.input, SupportTicketFactsSchema))
        throw new TypeError("Expected support ticket facts.");
      let previous: string | undefined;
      for (const [number, text] of ["{}", '{"replyText":"Ready"}'].entries()) {
        const ticket = await execution.control.beginAttempt({
          kind: "generation",
          content: create(GenerationRequestSchema, {
            input: AnyPacker.pack(SupportTicketFactsSchema, execution.input),
            instructions: "Draft a support reply.",
            outputSchemaJson: "{}",
            promptJson: "{}",
            digest: create(AiContentDigestSchema, { value: String(number + 1).repeat(64) }),
            ...(previous === undefined ? {} : { corrects: { value: previous } }),
          }),
        });
        tickets.push(ticket.id);
        await execution.control.reserveTransport(ticket.id, 20, 100);
        execution.control.onReceived(ticket.id, Buffer.byteLength(text));
        const admitted = await execution.control.admitGeneration(
          text,
          execution.definition,
          execution.input,
        );
        await execution.control.finishAttempt({
          ticketId: ticket.id,
          receivedBytes: Buffer.byteLength(text),
          response: create(GenerationResponseSchema, {
            rawOutput: text,
            outcome: admitted.ok ? AiOutcome.ADMITTED : AiOutcome.INVALID_OUTPUT,
            ...(admitted.ok
              ? {
                  admittedOutput: AnyPacker.pack(
                    ProposedSupportReplySchema,
                    admitted.value as never,
                  ),
                }
              : {}),
          }),
          ...(admitted.ok ? {} : { issues: admitted.issues }),
        });
        if (admitted.ok) return { ok: true as const, value: admitted.value };
        previous = ticket.id;
      }
      throw new Error("Corrected support reply was not admitted.");
    });
    const registry = AiRegistry.create({ defaultModels: { generation: correctionRef } });
    registry.register(
      createBackendRegistration({
        ref: correctionRef,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
      }),
    );
    const { scope, audit, saved } = liveFixture("T-correction");
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [correctionModel] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [correctionModel] },
      scope,
      new Map([[AiModelKind.GENERATION, selected]]),
      new AgentLiveBudget({ modelRequests: 2, totalOutputBytes: 1_024 }),
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );
    const result = await runtime.invoke(correctionModel, {
      call: "draft",
      conversation: create(ConversationIdSchema, { value: "support-correction" }),
      input: create(SupportTicketFactsSchema, {
        ticketNumber: create(SupportTicketNumberSchema, { value: "T-correction" }),
        customerQuestion: "Please draft",
      }),
    });
    expect(result).toMatchObject({ ok: true, value: { replyText: "Ready" } });
    expect(execute).toHaveBeenCalledOnce();
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).not.toBe(tickets[1]);

    const system = saved.flatMap((entry) =>
      entry.item.case === "systemEvent" ? [entry.item.value.message] : [],
    );
    const starts = system.flatMap((item) => {
      const value = AnyPacker.tryUnpack(item, AgentModelAttemptStartedSchema);
      return value === undefined ? [] : [value];
    });
    const finishes = system.flatMap((item) => {
      const value = AnyPacker.tryUnpack(item, AgentModelAttemptFinishedSchema);
      return value === undefined ? [] : [value];
    });
    const admitted = system.flatMap((item) => {
      const value = AnyPacker.tryUnpack(item, AgentAiResultAdmittedSchema);
      return value === undefined ? [] : [value];
    });
    expect(starts.map((item) => item.attempt?.value)).toEqual(tickets);
    expect(starts[0]?.previousAttempt).toBeUndefined();
    expect(starts[1]?.previousAttempt?.value).toBe(tickets[0]);
    expect(finishes.map((item) => item.attempt?.value)).toEqual(tickets);
    expect(finishes.map((item) => item.outcome)).toEqual([
      AiOutcome.INVALID_OUTPUT,
      AiOutcome.ADMITTED,
    ]);
    expect(finishes.map((item) => item.operation)).toEqual(starts.map((item) => item.operation));
    expect(admitted).toHaveLength(1);
    expect(admitted[0]?.operation).toEqual(starts[0]?.operation);
    const conversation = saved.flatMap((entry) =>
      entry.item.case === "conversationRecord" ? [entry.item.value] : [],
    );
    const requests = conversation.flatMap((entry) => {
      const value = AnyPacker.tryUnpack(entry.content, GenerationRequestSchema);
      return value === undefined ? [] : [{ entry, value }];
    });
    const responses = conversation.flatMap((entry) => {
      const value = AnyPacker.tryUnpack(entry.content, GenerationResponseSchema);
      return value === undefined ? [] : [{ entry, value }];
    });
    expect(requests.map(({ entry }) => entry.attempt?.value)).toEqual(tickets);
    expect(responses.map(({ entry }) => entry.attempt?.value)).toEqual(tickets);
    expect(requests.map(({ entry }) => entry.operation)).toEqual(
      starts.map((item) => item.operation?.operation),
    );
    expect(responses.map(({ entry }) => entry.operation)).toEqual(
      starts.map((item) => item.operation?.operation),
    );
    expect(conversation.map((entry) => entry.conversation?.value)).toEqual(
      Array.from({ length: 4 }, () => "support-correction"),
    );
    expect(requests[1]?.value.corrects?.value).toBe(tickets[0]);
    expect(responses.map(({ value }) => value.outcome)).toEqual([
      AiOutcome.INVALID_OUTPUT,
      AiOutcome.ADMITTED,
    ]);
    expect(responses[0]?.value.admittedOutput).toBeUndefined();
    expect(
      AnyPacker.tryUnpack(responses[1]?.value.admittedOutput, ProposedSupportReplySchema),
    ).toEqual(result.ok ? result.value : undefined);
  });

  it("executes the same named call anew for two accepted signals and enforces physical credit", async () => {
    const physicalRequests = vi.fn();
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      if (!isMessage(execution.input, SupportTicketFactsSchema))
        throw new TypeError("Expected support ticket facts.");
      const request = await execution.control.beginAttempt({
        kind: "generation",
        content: create(GenerationRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input),
          instructions: "Draft a support reply.",
          outputSchemaJson: "{}",
          promptJson: "{}",
          digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
        }),
      });
      physicalRequests();
      await execution.control.reserveTransport(request.id, 20, 80);
      execution.control.onReceived(request.id, 24);
      if (execution.input.customerQuestion === "Unavailable") {
        const failure = await execution.control.recordFailure("UNAVAILABLE", true);
        await execution.control.finishAttempt({
          ticketId: request.id,
          receivedBytes: 24,
          response: create(GenerationResponseSchema, {
            outcome: AiOutcome.FAILED,
            diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
          }),
        });
        return { ok: false as const, failure };
      }
      await execution.control.finishAttempt({
        ticketId: request.id,
        receivedBytes: 24,
        response: create(GenerationResponseSchema, { outcome: AiOutcome.ADMITTED }),
      });
      return {
        ok: true as const,
        value: create(ProposedSupportReplySchema, { replyText: "Ready" }),
      };
    });
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
      }),
    );
    const scope = {
      actor: create(ActorContextSchema),
      tenant: { kind: "single-tenant" as const },
      agent: create(MessageIdSchema, {
        id: AnyPacker.pack(
          SupportReplyAgentIdSchema,
          create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" }),
        ),
        typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
      }),
      source: create(MessageIdSchema, {
        id: AnyPacker.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-live" })),
        typeUrl: TypeUrls.derive(DraftSupportReplySchema),
      }),
    };
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [model] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const input = create(SupportTicketFactsSchema, {
      ticketNumber: create(SupportTicketNumberSchema, { value: "T-live" }),
      customerQuestion: "Help?",
    });
    const request = {
      call: "draft",
      conversation: create(ConversationIdSchema, { value: "support" }),
      input,
    };
    const metadata = new SignalMetadata({
      timeProvider: {
        currentTime: () => create(TimestampSchema, { seconds: 1_800_300_000n }),
      },
    });
    const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" });
    const source = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: agentId, question: "Help?" }),
      context: metadata.commandContext({}),
    });
    const written: string[] = [];
    const auditFailure = new Error("attempt start history unavailable");
    let rejectAttemptStart = false;
    const history = {
      capacity: {},
      appendAll: (_id: unknown, entries: readonly AgentHistoryEntry[]) => {
        if (
          rejectAttemptStart &&
          entries.some(
            (entry) =>
              entry.item.case === "systemEvent" &&
              entry.item.value.message?.typeUrl === TypeUrls.derive(AgentModelAttemptStartedSchema),
          )
        )
          return Promise.reject(auditFailure);
        written.push(...entries.map((entry) => entry.item.case ?? ""));
        return Promise.resolve();
      },
    } as unknown as AgentHistoryStorage<unknown>;
    const audit = new AgentLiveAudit(
      {
        source: { case: "command", value: source },
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        stateType: SupportReplyAgentStateSchema.typeName,
      },
      SupportReplyAgentStateSchema,
      agentId,
      "T-live",
      history,
      metadata,
      () => undefined,
      () => Promise.resolve(),
    );
    const make = () =>
      new AgentLiveAiRuntime(
        registry,
        { models: [model] },
        scope,
        new Map([[AiModelKind.GENERATION, selected]]),
        new AgentLiveBudget({ modelRequests: 1, totalOutputBytes: 80 }),
        new AbortController().signal,
        undefined,
        () => undefined,
        audit,
      );
    const first = make();
    await expect(first.invoke(model, request)).resolves.toMatchObject({ ok: true });
    first.finish();
    first.close();
    const second = make();
    await expect(second.invoke(model, request)).resolves.toMatchObject({ ok: true });
    const failed = make();
    await expect(
      failed.invoke(model, {
        ...request,
        input: create(SupportTicketFactsSchema, { ...input, customerQuestion: "Unavailable" }),
      }),
    ).resolves.toMatchObject({ ok: false, failure: { code: "UNAVAILABLE" } });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(physicalRequests).toHaveBeenCalledTimes(3);
    expect(written.filter((kind) => kind === "systemEvent")).toHaveLength(12);
    expect(written.filter((kind) => kind === "conversationRecord")).toHaveLength(6);

    rejectAttemptStart = true;
    await expect(make().invoke(model, request)).rejects.toBe(auditFailure);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(physicalRequests).toHaveBeenCalledTimes(3);
  });

  it("connects only a completed model proposal to the configured MCP tool", async () => {
    const mcpModel = AiModel.define({
      name: "live-support-mcp",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a support reply with the knowledge tool.",
      outputMode: "prompt-and-validate",
      tools: [{ server: "knowledge", tool: "lookup" }],
      limits: { modelRequests: 1, toolCalls: 1, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
    });
    const protocol = {
      identity: {
        serverId: "knowledge",
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update("https://knowledge.test/mcp").digest("hex")}`,
      },
      discover: () =>
        Promise.resolve([
          { name: "lookup", description: "Find ticket", inputSchemaJson: '{"type":"object"}' },
        ]),
      validateArguments: () => undefined,
      call: vi.fn(() =>
        Promise.resolve({
          content: [{ kind: "text" as const, text: "Found" }],
          isError: false,
        }),
      ),
      close: () => Promise.resolve(),
    };
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      expect(execution.advertisedTools).toHaveLength(1);
      const attempt = await execution.control.beginAttempt({
        kind: "generation",
        content: create(GenerationRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input as never),
          instructions: "Draft",
          outputSchemaJson: "{}",
          promptJson: "{}",
          digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
        }),
      });
      await execution.control.reserveTransport(attempt.id, 20, 80);
      const proposal = create(ModelToolCallSchema, {
        providerCallId: "proposal-1",
        toolName: "tool_0",
        argumentsJson: "{}",
      });
      await execution.control.finishAttempt({
        ticketId: attempt.id,
        receivedBytes: 10,
        response: create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
          toolCalls: [proposal],
        }),
      });
      const call = {
        ticketId: attempt.id,
        server: "knowledge",
        tool: "lookup",
        providerToolName: "tool_0",
        argumentsJson: "{}",
        providerCallId: "proposal-1",
      };
      await expect(
        execution.control.callTool({ ...call, providerCallId: "absent" }),
      ).rejects.toThrow("absent from the completed model response");
      await expect(
        execution.control.callTool({ ...call, providerToolName: "tool_1" }),
      ).rejects.toThrow("absent from the completed model response");
      await expect(
        execution.control.callTool({ ...call, argumentsJson: '{"other":1}' }),
      ).rejects.toThrow("absent from the completed model response");
      await expect(execution.control.callTool({ ...call, tool: "other" })).resolves.toMatchObject({
        outcome: AiOutcome.FAILED,
      });
      await expect(execution.control.callTool(call)).resolves.toMatchObject({ text: ["Found"] });
      return {
        ok: true as const,
        value: create(ProposedSupportReplySchema, { replyText: "Ready" }),
      };
    });
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.registerTools(
      Mcp.server({
        id: "knowledge",
        revision: "v1",
        transport: { kind: "streamable-http", url: "https://knowledge.test/mcp" },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 128,
            maxResultBytes: 128,
            authorize: () => true,
          },
        },
      }),
    );
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
        mcp: { connect: () => Promise.resolve(protocol) },
      }),
    );
    const scope = {
      actor: create(ActorContextSchema),
      tenant: { kind: "single-tenant" as const },
      agent: create(MessageIdSchema, {
        id: AnyPacker.pack(
          SupportReplyAgentIdSchema,
          create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" }),
        ),
        typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
      }),
      source: create(MessageIdSchema, {
        id: AnyPacker.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-live" })),
        typeUrl: TypeUrls.derive(DraftSupportReplySchema),
      }),
    };
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [mcpModel] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const metadata = new SignalMetadata({
      timeProvider: {
        currentTime: () => create(TimestampSchema, { seconds: 1_800_300_000n }),
      },
    });
    const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-live" });
    const source = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: agentId, question: "Help?" }),
      context: metadata.commandContext({}),
    });
    const saved = vi.fn(() => Promise.resolve());
    const history = { capacity: {}, appendAll: saved } as unknown as AgentHistoryStorage<unknown>;
    const audit = new AgentLiveAudit(
      {
        source: { case: "command", value: source },
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        stateType: SupportReplyAgentStateSchema.typeName,
      },
      SupportReplyAgentStateSchema,
      agentId,
      "T-live",
      history,
      metadata,
      () => undefined,
      () => Promise.resolve(),
    );
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [mcpModel] },
      scope,
      new Map([[AiModelKind.GENERATION, selected]]),
      new AgentLiveBudget({ modelRequests: 1, toolCalls: 1, totalOutputBytes: 1_024 }),
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );
    await expect(
      runtime.invoke(mcpModel, {
        call: "draft",
        conversation: create(ConversationIdSchema, { value: "support" }),
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: "T-live" }),
          customerQuestion: "Help?",
        }),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(protocol.call).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalled();
  });

  it("rejects a physical tool result when its mandatory audit append fails", async () => {
    const toolModel = AiModel.define({
      name: "live-support-audit-failure",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Read the support ticket.",
      outputMode: "prompt-and-validate",
      tools: [{ server: "knowledge", tool: "lookup" }],
      limits: { modelRequests: 1, toolCalls: 1, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
    });
    const protocol = {
      identity: {
        serverId: "knowledge",
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update("https://knowledge.test/mcp").digest("hex")}`,
      },
      discover: () =>
        Promise.resolve([{ name: "lookup", description: "Read ticket", inputSchemaJson: "{}" }]),
      validateArguments: () => undefined,
      call: vi.fn(() =>
        Promise.resolve({ content: [{ kind: "text" as const, text: "Found" }], isError: false }),
      ),
      close: vi.fn(() => Promise.resolve()),
    };
    let continued = false;
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      const attempt = await execution.control.beginAttempt({
        kind: "generation",
        content: create(GenerationRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input as never),
          instructions: "Read the support ticket.",
          outputSchemaJson: "{}",
          promptJson: "{}",
          digest: create(AiContentDigestSchema, { value: "c".repeat(64) }),
        }),
      });
      await execution.control.reserveTransport(attempt.id, 20, 80);
      await execution.control.finishAttempt({
        ticketId: attempt.id,
        receivedBytes: 10,
        response: create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
          toolCalls: [
            create(ModelToolCallSchema, {
              providerCallId: "lookup-1",
              toolName: "tool_0",
              argumentsJson: "{}",
            }),
          ],
        }),
      });
      await execution.control.callTool({
        ticketId: attempt.id,
        server: "knowledge",
        tool: "lookup",
        providerToolName: "tool_0",
        argumentsJson: "{}",
        providerCallId: "lookup-1",
      });
      continued = true;
      return {
        ok: true as const,
        value: create(ProposedSupportReplySchema, { replyText: "Ready" }),
      };
    });
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.registerTools(
      Mcp.server({
        id: "knowledge",
        revision: "v1",
        transport: { kind: "streamable-http", url: "https://knowledge.test/mcp" },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 128,
            maxResultBytes: 128,
            authorize: () => true,
          },
        },
      }),
    );
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
        mcp: { connect: () => Promise.resolve(protocol) },
      }),
    );
    const auditFailure = new Error("tool result audit failed");
    let finishBatch = false;
    const { scope, audit, saved } = liveFixture("T-tool-audit", (entries) => {
      const finished = entries.some(
        (entry) =>
          entry.item.case === "systemEvent" &&
          AnyPacker.tryUnpack(entry.item.value.message, AgentToolCallFinishedSchema) !== undefined,
      );
      if (!finished) return;
      finishBatch = entries.some(
        (entry) =>
          entry.item.case === "conversationRecord" &&
          AnyPacker.tryUnpack(entry.item.value.content, ToolResponseSchema) !== undefined,
      );
      throw auditFailure;
    });
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [toolModel] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [toolModel] },
      scope,
      new Map([[AiModelKind.GENERATION, selected]]),
      new AgentLiveBudget({ modelRequests: 1, toolCalls: 1, totalOutputBytes: 1_024 }),
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );

    try {
      await expect(
        runtime.invoke(toolModel, {
          call: "draft",
          conversation: create(ConversationIdSchema, { value: "support" }),
          input: create(SupportTicketFactsSchema, {
            ticketNumber: create(SupportTicketNumberSchema, { value: "T-tool-audit" }),
            customerQuestion: "Help?",
          }),
        }),
      ).rejects.toBe(auditFailure);
      expect(finishBatch).toBe(true);
      expect(protocol.call).toHaveBeenCalledOnce();
      expect(protocol.close).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledOnce();
      expect(continued).toBe(false);
      expect(
        saved.some(
          (entry) =>
            entry.item.case === "systemEvent" &&
            AnyPacker.tryUnpack(entry.item.value.message, AgentAiResultAdmittedSchema) !==
              undefined,
        ),
      ).toBe(false);
    } finally {
      runtime.close();
    }
  });

  it("persists failed read and uncertain write tool outcomes without dispatching either again", async () => {
    const toolModel = AiModel.define({
      name: "live-support-failed-tools",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Use the configured support tools.",
      outputMode: "prompt-and-validate",
      tools: [
        { server: "knowledge", tool: "lookup" },
        { server: "knowledge", tool: "submit" },
      ],
      limits: { modelRequests: 1, toolCalls: 2, maxInputBytes: 1_024, maxOutputBytes: 1_024 },
    });
    let protocolControl: AiMcpProtocolControl | undefined;
    const protocol = {
      identity: {
        serverId: "knowledge",
        revision: "v1",
        endpoint: `sha256:${createHash("sha256").update("https://knowledge.test/mcp").digest("hex")}`,
      },
      discover: () =>
        Promise.resolve([
          { name: "lookup", description: "Read ticket", inputSchemaJson: "{}" },
          { name: "submit", description: "Submit reply", inputSchemaJson: "{}" },
        ]),
      validateArguments: () => undefined,
      call: vi.fn(async (_tool: string, _args: string, send: { toolCallId: string }) => {
        if (protocolControl === undefined) throw new Error("MCP control was not connected.");
        await protocolControl.reserveMessage({
          phase: "call",
          method: "tools/call",
          toolCallId: send.toolCallId,
          inputBytes: 1,
          maxOutputBytes: 20,
        });
        throw new Error("Provider detail must not become a successful tool result.");
      }),
      close: vi.fn(() => Promise.resolve()),
    };
    const results: ToolResponse[] = [];
    const execute = vi.fn(async (execution: AiBackendExecution) => {
      expect(execution.advertisedTools).toHaveLength(2);
      const attempt = await execution.control.beginAttempt({
        kind: "generation",
        content: create(GenerationRequestSchema, {
          input: AnyPacker.pack(SupportTicketFactsSchema, execution.input as never),
          instructions: "Use tools",
          outputSchemaJson: "{}",
          promptJson: "{}",
          digest: create(AiContentDigestSchema, { value: "b".repeat(64) }),
        }),
      });
      await execution.control.reserveTransport(attempt.id, 20, 80);
      await execution.control.finishAttempt({
        ticketId: attempt.id,
        receivedBytes: 10,
        response: create(GenerationResponseSchema, {
          outcome: AiOutcome.TOOL_REQUESTED,
          toolCalls: [
            create(ModelToolCallSchema, {
              providerCallId: "read-1",
              toolName: "tool_0",
              argumentsJson: "{}",
            }),
            create(ModelToolCallSchema, {
              providerCallId: "write-1",
              toolName: "tool_1",
              argumentsJson: "{}",
            }),
          ],
        }),
      });
      for (const [tool, providerToolName, providerCallId] of [
        ["lookup", "tool_0", "read-1"],
        ["submit", "tool_1", "write-1"],
      ] as const)
        results.push(
          await execution.control.callTool({
            ticketId: attempt.id,
            server: "knowledge",
            tool,
            providerToolName,
            argumentsJson: "{}",
            providerCallId,
          }),
        );
      return {
        ok: true as const,
        value: create(ProposedSupportReplySchema, { replyText: "Ready" }),
      };
    });
    const registry = AiRegistry.create({ defaultModels: { generation: ref } });
    registry.registerTools(
      Mcp.server({
        id: "knowledge",
        revision: "v1",
        transport: { kind: "streamable-http", url: "https://knowledge.test/mcp" },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 128,
            maxResultBytes: 20,
            authorize: () => true,
          },
          submit: {
            effect: "write",
            timeoutMs: 1_000,
            maxArgumentBytes: 128,
            maxResultBytes: 20,
            authorize: () => true,
          },
        },
      }),
    );
    registry.register(
      createBackendRegistration({
        ref,
        kind: "generation",
        supports: () => true,
        resolveIdentity: () => ({
          provider: "test",
          account: "support",
          endpoint: "local",
          model: "v1",
        }),
        authorizeUse: () => true,
        connect: (_scope, identity) => ({ model: {}, identity }),
        execute,
        mcp: {
          connect: ({ control }) => {
            protocolControl = control;
            return Promise.resolve(protocol);
          },
        },
      }),
    );
    const agentId = create(SupportReplyAgentIdSchema, { ticketNumber: "T-failed-tools" });
    const scope = {
      actor: create(ActorContextSchema),
      tenant: { kind: "single-tenant" as const },
      agent: create(MessageIdSchema, {
        id: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        typeUrl: TypeUrls.derive(SupportReplyAgentIdSchema),
      }),
      source: create(MessageIdSchema, {
        id: AnyPacker.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "source-tools" })),
        typeUrl: TypeUrls.derive(DraftSupportReplySchema),
      }),
    };
    const selected = await AgentModelSelection.selectLiveKind(
      registry,
      { models: [toolModel] },
      scope,
      [],
      new AbortController().signal,
      undefined,
      "generation",
    );
    const metadata = new SignalMetadata({
      timeProvider: { currentTime: () => create(TimestampSchema, { seconds: 1_800_300_000n }) },
    });
    const source = SignalEnvelopes.command({
      schema: DraftSupportReplySchema,
      message: create(DraftSupportReplySchema, { agent: agentId, question: "Help?" }),
      context: metadata.commandContext({}),
    });
    const saved: AgentHistoryEntry[] = [];
    const history = {
      capacity: {},
      appendAll: (_id: unknown, entries: readonly AgentHistoryEntry[]) => {
        saved.push(...entries);
        return Promise.resolve();
      },
    } as unknown as AgentHistoryStorage<unknown>;
    const audit = new AgentLiveAudit(
      {
        source: { case: "command", value: source },
        recipientId: AnyPacker.pack(SupportReplyAgentIdSchema, agentId),
        stateType: SupportReplyAgentStateSchema.typeName,
      },
      SupportReplyAgentStateSchema,
      agentId,
      "T-failed-tools",
      history,
      metadata,
      () => undefined,
      () => Promise.resolve(),
    );
    const budget = new AgentLiveBudget({
      modelRequests: 1,
      toolCalls: 2,
      totalOutputBytes: 130,
    });
    const runtime = new AgentLiveAiRuntime(
      registry,
      { models: [toolModel] },
      scope,
      new Map([[AiModelKind.GENERATION, selected]]),
      budget,
      new AbortController().signal,
      undefined,
      () => undefined,
      audit,
    );
    await expect(
      runtime.invoke(toolModel, {
        call: "draft",
        conversation: create(ConversationIdSchema, { value: "support" }),
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: "T-failed-tools" }),
          customerQuestion: "Help?",
        }),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(results.map((result) => result.outcome)).toEqual([AiOutcome.FAILED, AiOutcome.UNKNOWN]);
    expect(results.every((result) => result.diagnosticId?.value)).toBe(true);
    expect(protocol.call).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(protocol.close).toHaveBeenCalledTimes(1);
    const finished = saved
      .flatMap((entry) =>
        entry.item.case === "systemEvent"
          ? [AnyPacker.tryUnpack(entry.item.value.message, AgentToolCallFinishedSchema)]
          : [],
      )
      .filter((event) => event !== undefined);
    expect(finished.map((event) => event.outcome)).toEqual([AiOutcome.FAILED, AiOutcome.UNKNOWN]);
    const responses = saved
      .flatMap((entry) =>
        entry.item.case === "conversationRecord"
          ? [AnyPacker.tryUnpack(entry.item.value.content, ToolResponseSchema)]
          : [],
      )
      .filter((response) => response !== undefined);
    expect(responses.map((response) => response.outcome)).toEqual([
      AiOutcome.FAILED,
      AiOutcome.UNKNOWN,
    ]);
    expect(budget.reservePhysical(1, 81, "protocol").maxOutputBytes).toBe(80);
  });
});
