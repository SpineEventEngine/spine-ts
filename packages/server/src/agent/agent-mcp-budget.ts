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

import { clone, create, toBinary } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { createHash, randomUUID } from "node:crypto";
import { AgentExecutionFault } from "./agent-execution-fault.js";
import { AnyMessages, Time } from "@spine-event-engine/core";
import type {
  AiMcpMessageRequest,
  AiMcpMessageTicket,
  AiToolInvocation,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiAttemptIdSchema,
  AiContentDigestSchema,
  AiModelKind,
  AiOutcome,
  AiToolCallIdSchema as ToolCallIdSchema,
  AgentToolCallStartedSchema as ToolStartedSchema,
  AgentToolCallFinishedSchema as ToolFinishedSchema,
  AgentHistoryEntrySchema,
  ConversationRecordIdSchema,
  ConversationRecordSchema,
  McpServerIdSchema,
  ToolEffect,
  ToolRequestSchema,
  ToolResponseSchema,
  type AgentHistoryEntry,
  type ToolRequest,
  type ToolResponse,
} from "@spine-event-engine/proto/agent";
import {
  AgentExecutionJournalEntrySchema as JournalEntrySchema,
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentProtocolEvidenceSchema,
  AgentProtocolPhase,
  AgentProtocolTicketIdSchema as TicketIdSchema,
  AgentToolEvidenceSchema,
  type AgentExecutionRecord,
  type AgentExecutionHead,
  type AgentNamedOperation,
  type AgentToolEvidence,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import {
  AgentExecutionSizes,
  type AgentExecutionCapacity,
} from "@spine-event-engine/storage/provider";
import type { AgentMcpIntent } from "./agent-mcp-host.js";
import { AgentInteractionAudit } from "./agent-interaction-audit.js";

/**
 * Provides the fenced record, capacity, and mutation view used by MCP.
 */
interface JournalSession {
  /**
   * Stops physical work when the execution claim closes.
   */
  readonly signal: AbortSignal;

  /**
   * Reads the current durable execution record.
   * @returns Current durable execution record.
   */
  record(): AgentExecutionRecord;

  /**
   * Writes one fenced record mutation with optional Agent history rows.
   * @param change Record transformation under the claim token.
   * @param historyEntries Rows included in the provider mutation.
   * @returns The saved record image.
   */
  update(
    change: (record: AgentExecutionRecord) => AgentExecutionRecord,
    historyEntries?: readonly AgentHistoryEntry[],
  ): Promise<AgentExecutionRecord>;

  /**
   * Reads provider limits for complete encoded rows.
   * @returns Provider limits for complete encoded rows.
   */
  capacity(): AgentExecutionCapacity;

  /**
   * Reads current saved model preferences for the Agent instance.
   * @returns Current saved model preferences.
   */
  preferences(): Readonly<AgentExecutionHead["preferences"]>;
}

/**
 * Charges MCP physical messages to the same fenced invocation ledger as model sends.
 */
export class AgentMcpBudget {
  readonly #received = new Map<string, number>();

  /**
   * Binds one MCP operation to the shared fenced invocation budget.
   * @param session Fenced execution journal.
   * @param operation Saved named operation.
   * @param deadlineEpochMs Original operation deadline.
   * @param audit Paired Agent history and System Event writer.
   */
  constructor(
    private readonly session: JournalSession,
    private readonly operation: AgentNamedOperation,
    private readonly deadlineEpochMs: number,
    private readonly audit: AgentInteractionAudit | undefined,
  ) {}

  /**
   * Checks invocation bounds using measured receipts and full unknown credit.
   * @param record Current durable invocation.
   * @param input Proposed physical input bytes.
   * @param output Proposed physical response allowance.
   */
  static checkSharedBytes(record: AgentExecutionRecord, input: number, output: number): void {
    const spent = record.journal.reduce(
      (sum, entry) =>
        sum +
        (entry.evidence.case === "attempt" || entry.evidence.case === "protocol"
          ? entry.evidence.value.inputBytes
          : 0n),
      0n,
    );
    const reserved = record.journal.reduce(
      (sum, entry) =>
        sum +
        (entry.evidence.case === "attempt" || entry.evidence.case === "protocol"
          ? (entry.evidence.value.receivedBytes ?? entry.evidence.value.reservedResponseBytes)
          : 0n),
      0n,
    );
    if (spent + BigInt(input) > (record.started?.bounds?.totalInputBytes ?? 0n))
      throw new AgentExecutionFault(
        "TOOL_BUDGET_EXCEEDED",
        "Agent invocation input byte budget is exhausted.",
      );
    if (reserved + BigInt(output) > (record.started?.bounds?.totalOutputBytes ?? 0n))
      throw new AgentExecutionFault(
        "TOOL_BUDGET_EXCEEDED",
        "Agent invocation output byte credit is exhausted.",
      );
  }

  /**
   * Persists full request bytes and response credit before a physical MCP send.
   * @param server Configured MCP server identifier.
   * @param request Physical protocol message and byte bounds.
   * @returns Fenced ticket for the one physical send.
   */
  async reserveMessage(server: string, request: AiMcpMessageRequest): Promise<AiMcpMessageTicket> {
    this.#checkRequest(server, request);
    const id = randomUUID();
    await this.session.update((record) => {
      if (request.phase === "call" && request.toolCallId !== undefined)
        this.#checkCallIntent(record, server, request.toolCallId);
      AgentMcpBudget.checkSharedBytes(record, request.inputBytes, request.maxOutputBytes);
      const entry = this.#entry(server, id, request, record.journal.length);
      record.journal.push(entry);
      this.#checkCapacity(record);
      if (request.phase === "call" && request.toolCallId !== undefined)
        this.#checkCallCapacity(record, request.toolCallId, request.maxOutputBytes);
      return record;
    });
    return {
      id,
      signal: this.session.signal,
      deadlineEpochMs: this.deadlineEpochMs,
      maxOutputBytes: request.maxOutputBytes,
    };
  }

  /**
   * Rejects the chunk that crosses persisted full response credit.
   * @param ticketId Saved physical-message ticket.
   * @param bytes Newly decoded response bytes.
   */
  onReceived(ticketId: string, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Agent MCP received byte count is invalid.");
    const evidence = this.#evidence(this.session.record(), ticketId);
    if (evidence.settled) throw new Error("Agent MCP message already settled.");
    const next = (this.#received.get(ticketId) ?? 0) + bytes;
    if (next > Number(evidence.reservedResponseBytes))
      throw new Error("Agent MCP response exceeded reserved bytes.");
    this.#received.set(ticketId, next);
  }

  /**
   * Persists known receipt; unknown work retains its full original credit.
   * @param ticketId Saved physical-message ticket.
   * @param receivedBytes Complete decoded response size, when known.
   * @returns When the receipt is persisted.
   */
  async finishMessage(ticketId: string, receivedBytes?: number): Promise<void> {
    const observed = this.#received.get(ticketId);
    if (receivedBytes !== undefined && observed !== undefined && receivedBytes !== observed)
      throw new Error("Agent MCP receipt byte counts disagree.");
    const bytes = receivedBytes;
    await this.session.update((record) => {
      const evidence = this.#evidence(record, ticketId);
      if (evidence.settled) throw new Error("Agent MCP message already settled.");
      if (bytes !== undefined) {
        if (
          !Number.isSafeInteger(bytes) ||
          bytes < 0 ||
          bytes > Number(evidence.reservedResponseBytes)
        )
          throw new Error("Agent MCP response exceeded reserved bytes.");
        evidence.receivedBytes = BigInt(bytes);
      }
      evidence.settled = true;
      return record;
    });
    this.#received.delete(ticketId);
  }

  /**
   * Persists one authorized proposal and never reissues an uncertain write.
   * @param invocation Model proposal and provider call identity.
   * @param facts Vetted server, tool, arguments, and effect.
   * @param operationLimit Capability tool-call bound.
   * @returns Saved or newly allocated tool intent.
   */
  async journalToolIntent(
    invocation: AiToolInvocation,
    facts: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
    operationLimit: number,
  ): Promise<AgentMcpIntent> {
    const current = this.session.record();
    this.#checkProposal(current, invocation);
    const prior = this.#toolByProposal(current, invocation);
    if (prior !== undefined) return this.#recoverIntent(prior, facts);
    return this.#saveIntent(invocation, facts, operationLimit);
  }

  /**
   * Marks a previously dispatched write uncertain before returning its outcome.
   */
  async #recoverIntent(
    prior: AgentToolEvidence,
    facts: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
  ): Promise<AgentMcpIntent> {
    if (
      prior.dispatched &&
      prior.request?.effect === ToolEffect.WRITE &&
      prior.response === undefined &&
      !prior.outcomeUnknown
    ) {
      const callId = prior.request.call?.value;
      if (callId === undefined) throw new Error("Saved Agent tool call ID is absent.");
      await this.session.update((record) => {
        this.#toolByCall(record, callId).outcomeUnknown = true;
        return record;
      });
    }
    return this.#priorTool(prior, facts);
  }

  /**
   * Allocates exactly one tool count and durable request in the fenced record.
   */
  async #saveIntent(
    invocation: AiToolInvocation,
    facts: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
    operationLimit: number,
  ): Promise<AgentMcpIntent> {
    const callId = randomUUID();
    const request = this.#toolRequest(facts, callId);
    const history = this.#requestHistory(request);
    const change = (record: AgentExecutionRecord) => {
      this.#checkProposal(record, invocation);
      if (this.#toolByProposal(record, invocation) !== undefined)
        throw new Error("Agent tool proposal was concurrently journaled.");
      this.#checkToolCount(record, operationLimit);
      record.journal.push(this.#toolEntry(invocation, request, record.journal.length));
      this.#checkCapacity(record, [history]);
      return record;
    };
    if (this.audit === undefined) await this.session.update(change, [history]);
    else
      await this.audit.save(ToolStartedSchema, this.#started(invocation, request), change, [
        history,
      ]);
    return { kind: "new", callId };
  }

  /**
   * Checks the saved tool count before appending another intent.
   * @param record Current fenced execution image.
   * @param operationLimit Selected capability's tool limit.
   */
  #checkToolCount(record: AgentExecutionRecord, operationLimit: number): void {
    const calls = record.journal.filter((entry) => entry.evidence.case === "tool");
    const operationCalls = calls.filter(
      (entry) =>
        entry.evidence.case === "tool" &&
        entry.evidence.value.operation?.value === this.operation.operation?.value,
    );
    if (
      operationCalls.length >= operationLimit ||
      calls.length >= Number(record.started?.bounds?.toolCalls ?? 0n)
    )
      throw new AgentExecutionFault(
        "TOOL_BUDGET_EXCEEDED",
        "Agent invocation tool-call budget is exhausted.",
      );
  }

  /**
   * Describes a journaled tool intent before transport can see it.
   */
  #started(invocation: AiToolInvocation, request: ToolRequest) {
    return create(ToolStartedSchema, {
      operation: this.audit?.reference(this.operation, AiModelKind.GENERATION),
      attempt: create(AiAttemptIdSchema, { value: invocation.ticketId }),
      call: request.call,
      server: request.server,
      tool: request.tool,
      arguments: create(AiContentDigestSchema, {
        value: createHash("sha256").update(request.argumentsJson).digest("hex"),
      }),
      effect: request.effect,
      startedAt: Time.currentTime(),
    });
  }

  /**
   * Persists the pre-send boundary; repeating a read may retain this flag.
   * @param callId Saved logical tool-call identity.
   * @returns When the dispatch marker is persisted.
   */
  async markToolDispatched(callId: string): Promise<void> {
    await this.session.update((record) => {
      const tool = this.#toolByCall(record, callId);
      if (tool.response !== undefined) throw new Error("Agent tool already completed.");
      tool.dispatched = true;
      return record;
    });
  }

  /**
   * Persists a complete tool result and its typed conversation row together.
   * @param callId Saved logical tool-call identity.
   * @param response Bounded tool result.
   * @param history Typed conversation rows retained with the result.
   * @returns When the fenced result and history are persisted.
   */
  async finishTool(
    callId: string,
    response: ToolResponse,
    history: readonly AgentHistoryEntry[],
  ): Promise<void> {
    const change = (record: AgentExecutionRecord) => {
      const tool = this.#toolByCall(record, callId);
      if (tool.outcomeUnknown)
        throw new Error("Agent tool outcome is unknown and cannot be completed later.");
      if (tool.response !== undefined || response.call?.value !== callId)
        throw new Error("Agent tool completion does not match a pending intent.");
      tool.response = clone(ToolResponseSchema, response);
      this.#checkCapacity(record, history);
      return record;
    };
    if (this.audit === undefined) await this.session.update(change, history);
    else await this.audit.save(ToolFinishedSchema, this.#finished(response), change, history);
  }

  /**
   * Describes the exact saved response of one tool call.
   */
  #finished(response: ToolResponse) {
    return create(ToolFinishedSchema, {
      operation: this.audit?.reference(this.operation, AiModelKind.GENERATION),
      call: response.call,
      outcome: response.outcome,
      result: create(AiContentDigestSchema, {
        value: createHash("sha256").update(toBinary(ToolResponseSchema, response)).digest("hex"),
      }),
      ...(response.diagnosticId === undefined ? {} : { diagnosticId: response.diagnosticId }),
      finishedAt: Time.currentTime(),
    });
  }

  /**
   * Ensures the proposal was actually returned by the saved physical model response.
   */
  #checkProposal(record: AgentExecutionRecord, invocation: AiToolInvocation): void {
    const attempt = record.journal.find(
      (entry) =>
        entry.evidence.case === "attempt" &&
        entry.evidence.value.attempt?.value === invocation.ticketId &&
        entry.evidence.value.operation?.value === this.operation.operation?.value,
    );
    if (
      attempt?.evidence.case !== "attempt" ||
      attempt.evidence.value.response.case !== "generationResponse" ||
      attempt.evidence.value.response.value.outcome !== AiOutcome.TOOL_REQUESTED ||
      !attempt.evidence.value.response.value.toolCalls.some(
        (call) =>
          call.providerCallId === invocation.providerCallId &&
          call.argumentsJson === invocation.argumentsJson,
      )
    )
      throw new Error("Agent tool intent has no matching saved model proposal.");
  }

  /**
   * Finds the original provider correlation without trusting a new call ID.
   */
  #toolByProposal(record: AgentExecutionRecord, invocation: AiToolInvocation) {
    const entry = record.journal.find(
      (item) =>
        item.evidence.case === "tool" &&
        item.evidence.value.operation?.value === this.operation.operation?.value &&
        item.evidence.value.requestingAttempt?.value === invocation.ticketId &&
        item.evidence.value.providerCallId === invocation.providerCallId,
    );
    return entry?.evidence.case === "tool" ? entry.evidence.value : undefined;
  }

  /**
   * Compares retained authorized facts and chooses replay or uncertain result.
   */
  #priorTool(
    prior: AgentToolEvidence,
    facts: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
  ): AgentMcpIntent {
    const request = prior.request;
    if (
      request === undefined ||
      request.server?.value !== facts.server?.value ||
      request.tool?.value !== facts.tool?.value ||
      request.argumentsJson !== facts.argumentsJson ||
      request.effect !== facts.effect
    )
      throw new AgentExecutionFault("REPLAY_DIVERGENCE", "Agent tool request changed on recovery.");
    if (prior.response !== undefined)
      return { kind: "replay", response: clone(ToolResponseSchema, prior.response) };
    const callId = request.call?.value;
    if (callId === undefined) throw new Error("Saved Agent tool call ID is absent.");
    if (prior.dispatched && request.effect === ToolEffect.WRITE)
      return {
        kind: "unknown",
        response: create(ToolResponseSchema, {
          call: request.call,
          outcome: AiOutcome.UNKNOWN,
        }),
      };
    return { kind: "new", callId };
  }

  /**
   * Constructs an authorized immutable tool intent with a runtime call ID.
   */
  #toolEntry(invocation: AiToolInvocation, request: ToolRequest, ordinal: number) {
    return create(JournalEntrySchema, {
      ordinal: BigInt(ordinal),
      evidence: {
        case: "tool",
        value: create(AgentToolEvidenceSchema, {
          operation: this.operation.operation,
          requestingAttempt: create(AiAttemptIdSchema, { value: invocation.ticketId }),
          providerCallId: invocation.providerCallId,
          request,
        }),
      },
    });
  }

  /**
   * Gives the authorized intent its runtime-generated logical call ID.
   */
  #toolRequest(
    facts: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
    callId: string,
  ): ToolRequest {
    if (facts.effect === ToolEffect.TOOL_EFFECT_UNSPECIFIED)
      throw new Error("Agent tool effect must be established by application policy.");
    return create(ToolRequestSchema, {
      ...facts,
      call: create(ToolCallIdSchema, { value: callId }),
    });
  }

  /**
   * Records the exact authorized ToolRequest in conversation history.
   */
  #requestHistory(request: ToolRequest): AgentHistoryEntry {
    return this.#toolHistory(request.call, AnyMessages.pack(ToolRequestSchema, request));
  }

  /**
   * Records the complete bounded tool content with its logical call identity.
   */
  #toolHistory(call: ToolRequest["call"], content: Any): AgentHistoryEntry {
    const occurredAt = Time.currentTime();
    return create(AgentHistoryEntrySchema, {
      occurredAt,
      item: {
        case: "conversationRecord",
        value: create(ConversationRecordSchema, {
          id: create(ConversationRecordIdSchema, { value: randomUUID() }),
          conversation: this.operation.conversation,
          operation: this.operation.operation,
          toolCall: call,
          occurredAt,
          content,
        }),
      },
    });
  }

  /**
   * Projects all credited tool result copies before allowing a physical call.
   */
  #checkCallCapacity(record: AgentExecutionRecord, callId: string, credit: number): void {
    const projected = clone(AgentExecutionRecordSchema, record);
    const tool = this.#toolByCall(projected, callId);
    const response = create(ToolResponseSchema, {
      call: tool.request?.call,
      outcome: AiOutcome.ADMITTED,
      text: ["x".repeat(credit)],
    });
    tool.response = response;
    const history = this.#toolHistory(
      response.call,
      AnyMessages.pack(ToolResponseSchema, response),
    );
    this.#checkCapacity(projected, [history]);
  }

  /**
   * Finds one tool intent by its persisted runtime call ID.
   */
  #toolByCall(record: AgentExecutionRecord, callId: string) {
    const entry = record.journal.find(
      (item) =>
        item.evidence.case === "tool" && item.evidence.value.request?.call?.value === callId,
    );
    if (entry?.evidence.case !== "tool") throw new Error("Agent tool call ID is unknown.");
    return entry.evidence.value;
  }

  /**
   * Requires one saved dispatch intent and forbids repeated physical writes.
   */
  #checkCallIntent(record: AgentExecutionRecord, server: string, callId: string): void {
    const tool = record.journal.find(
      (entry) =>
        entry.evidence.case === "tool" && entry.evidence.value.request?.call?.value === callId,
    );
    if (
      tool?.evidence.case !== "tool" ||
      !tool.evidence.value.dispatched ||
      tool.evidence.value.response !== undefined ||
      tool.evidence.value.request?.server?.value !== server
    )
      throw new Error("Agent MCP call has no dispatched durable intent.");
    if (
      tool.evidence.value.request.effect === ToolEffect.WRITE &&
      record.journal.some(
        (entry) =>
          entry.evidence.case === "protocol" && entry.evidence.value.toolCall?.value === callId,
      )
    )
      throw new Error("Agent MCP write intent already has a physical reservation.");
  }

  /**
   * Validates a bounded physical send under the active fence and saved deadline.
   */
  #checkRequest(server: string, request: AiMcpMessageRequest): void {
    if (this.session.signal.aborted || Time.currentTimeMillis() >= this.deadlineEpochMs)
      throw new Error("Agent MCP execution deadline expired.");
    if (server.trim().length === 0 || request.method.trim().length === 0)
      throw new Error("Agent MCP server and method must be nonblank.");
    if (
      !Number.isSafeInteger(request.inputBytes) ||
      request.inputBytes < 0 ||
      !Number.isSafeInteger(request.maxOutputBytes) ||
      request.maxOutputBytes < 1
    )
      throw new Error("Agent MCP physical message byte bounds are invalid.");
    if ((request.phase === "call") !== (request.toolCallId !== undefined))
      throw new Error("Agent MCP call phase must name its saved tool intent.");
  }

  /**
   * Constructs exact journal evidence for the reserved physical message.
   */
  #entry(server: string, id: string, request: AiMcpMessageRequest, ordinal: number) {
    return create(JournalEntrySchema, {
      ordinal: BigInt(ordinal),
      evidence: {
        case: "protocol",
        value: create(AgentProtocolEvidenceSchema, {
          operation: this.operation.operation,
          server: create(McpServerIdSchema, { value: server }),
          ticket: create(TicketIdSchema, { value: id }),
          phase:
            request.phase === "setup"
              ? AgentProtocolPhase.AGENT_PROTOCOL_SETUP
              : AgentProtocolPhase.AGENT_PROTOCOL_CALL,
          method: request.method,
          inputBytes: BigInt(request.inputBytes),
          reservedResponseBytes: BigInt(request.maxOutputBytes),
          ...(request.toolCallId === undefined
            ? {}
            : {
                toolCall: create(ToolCallIdSchema, { value: request.toolCallId }),
              }),
        }),
      },
    });
  }

  /**
   * Finds the one original reservation by durable ticket identity.
   */
  #evidence(record: AgentExecutionRecord, ticketId: string) {
    const entry = record.journal.find(
      (item) => item.evidence.case === "protocol" && item.evidence.value.ticket?.value === ticketId,
    );
    if (entry?.evidence.case !== "protocol") throw new Error("Agent MCP ticket is unknown.");
    return entry.evidence.value;
  }

  /**
   * Prevents a protocol journal image that exceeds the selected provider.
   */
  #checkCapacity(record: AgentExecutionRecord, history: readonly AgentHistoryEntry[] = []): void {
    const size = AgentExecutionSizes.record(record);
    if (size > Number(record.started?.bounds?.maxRecoveryBytes ?? 0n))
      throw new Error("Agent MCP journal exceeds invocation recovery bytes.");
    const capacity = this.session.capacity();
    const headBytes = this.#headBytes(record);
    if (capacity.executionHeadBytes !== undefined && headBytes > capacity.executionHeadBytes)
      throw new Error("Agent MCP head exceeds provider execution head bytes.");
    const limit = capacity.executionRecordBytes;
    if (limit !== undefined && size > limit)
      throw new Error("Agent MCP journal exceeds provider execution record bytes.");
    const scope = record.accepted?.key?.scope;
    if (history.length && scope === undefined)
      throw new Error("Agent MCP history requires its accepted instance scope.");
    const bytes =
      scope === undefined ? [] : history.map((entry) => AgentExecutionSizes.history(scope, entry));
    const historyLimit = capacity.historyRecordBytes;
    if (historyLimit !== undefined && bytes.some((count) => count > historyLimit))
      throw new Error("Agent MCP conversation history exceeds provider history bytes.");
    if (
      capacity.transactionPayloadBytes !== undefined &&
      size + headBytes + bytes.reduce((sum, count) => sum + count, 0) >
        capacity.transactionPayloadBytes
    )
      throw new Error("Agent MCP mutation exceeds provider transaction payload bytes.");
  }

  /**
   * Measures the full persistent instance head including current preferences.
   */
  #headBytes(record: AgentExecutionRecord): number {
    const accepted = record.accepted;
    if (accepted?.key?.scope === undefined)
      throw new Error("Agent MCP capacity check requires its accepted instance scope.");
    return AgentExecutionSizes.head(
      create(AgentExecutionHeadSchema, {
        scope: accepted.key.scope,
        active: accepted.key,
        pending: accepted.key,
        pendingOrder: accepted.order,
        lastResolved: accepted.order,
        claimToken: record.claimToken,
        claimExpiresAt: record.claimExpiresAt,
        preferences: [...this.session.preferences()],
        eligibleAt: Time.currentTime(),
      }),
    );
  }
}
