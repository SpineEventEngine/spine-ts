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

import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import type { AiFailure, AiRegistry, AiScope } from "@spine-event-engine/ai";
import type {
  AiBackendDefinition,
  AiMcpMessageRequest,
  AiMcpMessageTicket,
  AiToolInvocation,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiToolCallIdSchema as ToolCallIdSchema,
  ToolRequestSchema,
  type AgentHistoryEntry,
  type ToolRequest,
  type ToolResponse,
} from "@spine-event-engine/proto/agent";
import { Validate } from "@spine-event-engine/core";
import type { AgentLiveAiAudit } from "./agent-live-ai-audit.js";
import type { AgentPhysicalTicket } from "./agent-live-budget.js";
import { AgentLiveBudget } from "./agent-live-budget.js";
import type { AgentLiveMcpHost } from "./agent-live-mcp-host.js";
import type { AgentOperationIdentity } from "./agent-live-inputs.js";

interface LiveToolClaim {
  readonly proposal: string;
  dispatched: boolean;
  finished: boolean;
}

/**
 * Invocation-local MCP admissions and measured physical credit.
 */
export class AgentLiveMcpControls implements AgentLiveMcpHost {
  readonly #messages = new Map<string, AgentPhysicalTicket>();

  readonly #tools = new Map<string, LiveToolClaim>();

  readonly #proposals = new Set<string>();

  #toolCount = 0;

  /**
   * Binds one selected catalog to its live invocation budget and audit.
   *
   * @param input Typed input for this operation.
   */
  constructor(
    private readonly input: {
      scope: AiScope;
      registry: AiRegistry;
      backend: AiBackendDefinition;
      operation: AgentOperationIdentity;
      signal: AbortSignal;
      deadlineEpochMs?: number;
      budget: AgentLiveBudget;
      audit: AgentLiveAiAudit;
      maxToolCalls?: number;
      onProposal: (invocation: AiToolInvocation) => void;
    },
  ) {}

  /**
   * Returns the selected AI scope.
   *
   * @returns The selected AI scope for this invocation.*/ get scope(): AiScope {
    return this.input.scope;
  }

  /**
   * Returns the registered backends and MCP catalog.
   *
   * @returns The configured backend and MCP registry.*/ get registry(): AiRegistry {
    return this.input.registry;
  }

  /**
   * Returns the selected backend definition.
   *
   * @returns The selected backend definition.*/ get backend(): AiBackendDefinition {
    return this.input.backend;
  }

  /**
   * Returns the current operation identity.
   *
   * @returns The current typed AI operation identity.*/ get operation(): AgentOperationIdentity {
    return this.input.operation;
  }

  /**
   * Returns the fenced invocation signal.
   *
   * @returns The cancellation signal for this invocation.*/ get signal(): AbortSignal {
    return this.input.signal;
  }

  /**
   * Returns the absolute invocation deadline.
   *
   * @returns The absolute deadline, when configured.*/ get deadlineEpochMs(): number | undefined {
    return this.input.deadlineEpochMs;
  }

  /**
   * Acquires complete protocol response credit before a physical send.
   *
   * @param request Typed request for the current operation.
   * @param server Configured MCP server registration.
   * @returns A physical protocol ticket with complete response credit.
   */
  reserveMessage(server: string, request: AiMcpMessageRequest): Promise<AiMcpMessageTicket> {
    try {
      return Promise.resolve(this.reservePhysicalMessage(server, request));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("MCP admission failed", { cause: error }),
      );
    }
  }

  /**
   * Performs synchronous admission before returning a protocol ticket.
   *
   * @param request Typed request for the current operation.
   * @param server Configured MCP server registration.
   * @returns The admitted protocol ticket before asynchronous work begins.
   */
  private reservePhysicalMessage(server: string, request: AiMcpMessageRequest): AiMcpMessageTicket {
    this.requireActive();
    if (!server.trim() || !request.method.trim())
      throw new TypeError("MCP message identity is empty.");
    if (request.phase === "call" && !this.#tools.get(request.toolCallId ?? "")?.dispatched)
      throw new Error("MCP tool has not been dispatched.");
    const reservation = this.input.budget.reservePhysical(
      request.inputBytes,
      request.maxOutputBytes,
      "protocol",
    );
    const id = randomUUID();
    this.#messages.set(id, reservation);
    return {
      id,
      signal: this.signal,
      ...(this.deadlineEpochMs === undefined ? {} : { deadlineEpochMs: this.deadlineEpochMs }),
      ...(reservation.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: reservation.maxOutputBytes }),
    };
  }

  /**
   * Checks decoded chunks against the reserved physical response credit.
   *
   * @param bytes Measured serialized byte count.
   * @param ticketId Reserved physical attempt identifier.
   */
  onReceived(ticketId: string, bytes: number): void {
    this.input.budget.onReceived(this.message(ticketId), bytes);
  }

  /**
   * Completes a known receipt; unknown outcomes retain full reserved credit.
   *
   * @param receivedBytes Measured received payload bytes.
   * @param ticketId Reserved physical attempt identifier.
   * @returns Completion after a known protocol receipt is accounted for.
   */
  finishMessage(ticketId: string, receivedBytes?: number): Promise<void> {
    try {
      const ticket = this.message(ticketId);
      if (receivedBytes !== undefined) this.input.budget.settlePhysical(ticket, receivedBytes);
      this.#messages.delete(ticketId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("MCP receipt failed", { cause: error }),
      );
    }
  }

  /**
   * Admits a model-proposed call before asynchronous audit or dispatch.
   *
   * @param facts Complete audit facts for the operation.
   * @param invocation Captured live Agent invocation.
   * @returns The unique live call identifier for an authorized tool.
   */
  async admitTool(
    invocation: AiToolInvocation,
    facts: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
  ): Promise<string> {
    this.requireActive();
    this.input.onProposal(invocation);
    const proposal = `${invocation.ticketId}\u0000${invocation.providerCallId}`;
    if (this.#proposals.has(proposal)) throw new Error("MCP model proposal was already admitted.");
    if (this.input.maxToolCalls !== undefined && this.#toolCount >= this.input.maxToolCalls)
      throw new Error("Agent tool call budget is exhausted.");
    this.input.budget.reserveToolCall();
    this.#toolCount++;
    this.#proposals.add(proposal);
    const id = randomUUID();
    this.#tools.set(id, { proposal, dispatched: false, finished: false });
    const request = create(ToolRequestSchema, {
      ...facts,
      call: create(ToolCallIdSchema, { value: id }),
    });
    Validate.check(ToolRequestSchema, request);
    await this.input.audit.toolStarted(invocation, request);
    return id;
  }

  /**
   * Marks the exact pre-send boundary once.
   *
   * @param callId Exact MCP tool call identifier.
   */
  markToolDispatched(callId: string): void {
    const claim = this.#tools.get(callId);
    if (claim === undefined || claim.dispatched)
      throw new Error("MCP tool is missing or already dispatched.");
    this.requireActive();
    claim.dispatched = true;
  }

  /**
   * Writes a completed tool result and conversation before continuation.
   *
   * @param callId Exact MCP tool call identifier.
   * @param history Retained history entries or history port.
   * @param response Typed response from the provider.
   * @returns Completion after the tool result and conversation are saved.
   */
  async finishTool(
    callId: string,
    response: ToolResponse,
    history: AgentHistoryEntry,
  ): Promise<void> {
    const claim = this.#tools.get(callId);
    if (
      claim === undefined ||
      !claim.dispatched ||
      claim.finished ||
      response.call?.value !== callId
    )
      throw new Error("MCP tool completion does not match its dispatch.");
    await this.input.audit.toolFinished(response, history);
    claim.finished = true;
  }

  /**
   * Returns a safe invocation-local diagnostic reference.
   *
   * @param code Recorded failure code.
   * @param retryableByNewSignal Whether a fresh signal may retry this failure.
   * @returns A safe local diagnostic reference for the failed operation.
   */
  recordFailure(code: AiFailure["code"], retryableByNewSignal: boolean): Promise<AiFailure> {
    return Promise.resolve({ code, retryableByNewSignal, diagnosticId: randomUUID() });
  }

  /**
   * Returns the active physical reservation or rejects a stale ticket.
   *
   * @param id Typed identifier of the requested item.
   * @returns The active physical ticket for the requested message ID.
   */
  private message(id: string): AgentPhysicalTicket {
    const ticket = this.#messages.get(id);
    if (ticket === undefined) throw new Error("MCP physical ticket is no longer active.");
    return ticket;
  }

  /**
   * Rejects callbacks after handler cancellation.
   */
  private requireActive(): void {
    if (this.signal.aborted) throw new Error("MCP invocation is closed.");
  }
}
