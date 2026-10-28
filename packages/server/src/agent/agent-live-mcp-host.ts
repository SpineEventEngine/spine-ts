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
import type { AgentOperationIdentity } from "./agent-live-inputs.js";

/**
 * Invocation-local controls used by one selected MCP catalog.
 */
export interface AgentLiveMcpHost {
  /**
   * Selected AI scope for this invocation.
   */
  readonly scope: AiScope;

  /**
   * Registered backend and MCP catalog.
   */
  readonly registry: AiRegistry;

  /**
   * Selected backend definition.
   */
  readonly backend: AiBackendDefinition;

  /**
   * Current typed AI operation identity.
   */
  readonly operation: AgentOperationIdentity;

  /**
   * Cancellation fence for the invocation.
   */
  readonly signal: AbortSignal;

  /**
   * Absolute invocation deadline, when configured.
   */
  readonly deadlineEpochMs: number | undefined;

  /**
   * Acquires complete physical request and response credit before an MCP send.
   *
   * @param request Typed request for the current operation.
   * @param server Configured MCP server registration.
   * @returns A physical protocol ticket with complete response credit.
   */
  reserveMessage(server: string, request: AiMcpMessageRequest): Promise<AiMcpMessageTicket>;

  /**
   * Checks decoded chunks against their already reserved ticket.
   *
   * @param bytes Measured serialized byte count.
   * @param ticketId Reserved physical attempt identifier.
   */
  onReceived(ticketId: string, bytes: number): void;

  /**
   * Completes a known receipt, retaining full credit for unknown outcomes.
   *
   * @param receivedBytes Measured received payload bytes.
   * @param ticketId Reserved physical attempt identifier.
   * @returns Completion after a known protocol receipt is accounted for.
   */
  finishMessage(ticketId: string, receivedBytes?: number): Promise<void>;

  /**
   * Admits one vetted model-proposed tool and returns its unique live call ID.
   *
   * @param invocation Captured live Agent invocation.
   * @param request Typed request for the current operation.
   * @returns The unique live call identifier for an authorized tool.
   */
  admitTool(
    invocation: AiToolInvocation,
    request: Pick<ToolRequest, "server" | "tool" | "argumentsJson" | "effect">,
  ): Promise<string>;

  /**
   * Marks the pre-send boundary so the same write cannot be dispatched twice.
   *
   * @param callId Exact MCP tool call identifier.
   */
  markToolDispatched(callId: string): void;

  /**
   * Writes the result and original conversation row before model continuation.
   *
   * @param callId Exact MCP tool call identifier.
   * @param history Retained history entries or history port.
   * @param response Typed response from the provider.
   * @returns Completion after the tool result and conversation are saved.
   */
  finishTool(callId: string, response: ToolResponse, history: AgentHistoryEntry): Promise<void>;

  /**
   * Creates a safe local diagnostic for a failed tool or protocol operation.
   *
   * @param code Recorded failure code.
   * @param retryableByNewSignal Whether a fresh signal may retry this failure.
   * @returns A safe local diagnostic reference for the failed operation.
   */
  recordFailure(code: AiFailure["code"], retryableByNewSignal: boolean): Promise<AiFailure>;
}
