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

import type { AiFailure, AiRegistry, AiScope } from "@spine-event-engine/ai";
import type {
  AiBackendDefinition,
  AiMcpMessageRequest,
  AiMcpMessageTicket,
  AiToolInvocation,
} from "@spine-event-engine/ai/spi/adapter";
import type { AgentHistoryEntry, ToolRequest, ToolResponse } from "@spine-event-engine/proto/agent";
// prettier-ignore
import type {
  AgentNamedOperation,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentExecutionSession } from "./agent-execution-session.js";

/**
 * Result of checking a persisted tool intent before any physical send.
 */
export type AgentMcpIntent =
  | {
      /**
       * Identifies an admitted intent that has not dispatched.
       */
      readonly kind: "new";

      /**
       * Durable logical call identity.
       */
      readonly callId: string;
    }
  | {
      /**
       * Identifies a saved completed call.
       */
      readonly kind: "replay";

      /**
       * Original saved tool response.
       */
      readonly response: ToolResponse;
    }
  | {
      /**
       * Identifies a write whose physical outcome cannot be proven.
       */
      readonly kind: "unknown";

      /**
       * Safe refusal to resend the original write.
       */
      readonly response: ToolResponse;
    };

/**
 * Single budget and fenced journal authority supplied to the MCP runtime.
 */
export interface AgentMcpHost {
  /**
   * Accepted actor, source, context, and tenant.
   */
  readonly scope: AiScope;

  /**
   * Registered MCP server definitions.
   */
  readonly registry: AiRegistry;

  /**
   * Selected backend with an optional MCP protocol factory.
   */
  readonly backend: AiBackendDefinition;

  /**
   * Saved named operation for this tool chain.
   */
  readonly operation: AgentNamedOperation;

  /**
   * Fenced invocation journal.
   */
  readonly session: AgentExecutionSession;

  /**
   * Cancellation signal for the active claim.
   */
  readonly signal: AbortSignal;

  /**
   * Original absolute operation deadline.
   */
  readonly deadlineEpochMs: number;

  /**
   * Persists full shared input/output credit before an MCP physical send.
   * @param server Configured MCP server identifier.
   * @param request Physical protocol message and byte bounds.
   * @returns Fenced ticket for the physical send.
   */
  reserveMessage(server: string, request: AiMcpMessageRequest): Promise<AiMcpMessageTicket>;

  /**
   * Checks a received chunk synchronously against its persisted credit.
   * @param ticketId Saved physical-message ticket.
   * @param bytes Newly decoded response bytes.
   */
  onReceived(ticketId: string, bytes: number): void;

  /**
   * Persists known receipt; uncertain credits remain charged.
   * @param ticketId Saved physical-message ticket.
   * @param receivedBytes Complete decoded response size, when known.
   * @returns When the receipt is persisted.
   */
  finishMessage(ticketId: string, receivedBytes?: number): Promise<void>;

  /**
   * Checks shared tool count and persists intent before a write dispatch.
   * @param invocation Model proposal and provider call identity.
   * @param request Vetted server, tool, arguments, and effect.
   * @returns Saved or newly allocated tool intent.
   */
  journalToolIntent(
    invocation: AiToolInvocation,
    request: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
  ): Promise<AgentMcpIntent>;

  /**
   * Persists the physical-dispatch boundary under the current claim.
   * @param callId Saved logical tool-call identity.
   * @returns When the dispatch marker is persisted.
   */
  markToolDispatched(callId: string): Promise<void>;

  /**
   * Persists a complete tool response before model continuation.
   * @param callId Saved logical tool-call identity.
   * @param response Bounded tool result.
   * @param history Typed conversation row retained with the result.
   * @returns When the fenced result and history are persisted.
   */
  finishTool(callId: string, response: ToolResponse, history: AgentHistoryEntry): Promise<void>;

  /**
   * Persists a safe nonterminal diagnostic before returning it to an adapter.
   * @param code Safe failure category.
   * @param retryableByNewSignal Whether a later signal may retry the logical work.
   * @returns Persisted diagnostic identity and category.
   */
  recordFailure(code: AiFailure["code"], retryableByNewSignal: boolean): Promise<AiFailure>;
}
