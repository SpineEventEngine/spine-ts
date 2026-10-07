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

import type { AiScope, McpServerDefinition } from "./contracts.js";

/**
 * Durable admission for one physical MCP protocol send.
 */
export interface AiMcpMessageTicket {
  /**
   * Runtime-assigned reservation identifier.
   */
  readonly id: string;

  /**
   * Fenced cancellation signal.
   */
  readonly signal: AbortSignal;

  /**
   * Absolute send deadline.
   */
  readonly deadlineEpochMs: number;

  /**
   * Full decoded response credit reserved before dispatch.
   */
  readonly maxOutputBytes: number;
}

/**
 * Materialized protocol message submitted for durable reservation.
 */
export interface AiMcpMessageRequest {
  /**
   * Setup or tool-call phase.
   */
  readonly phase: "setup" | "call";

  /**
   * Actual MCP JSON-RPC method or HTTP method.
   */
  readonly method: string;

  /**
   * Exact serialized request-body bytes.
   */
  readonly inputBytes: number;

  /**
   * Full response credit requested for this message.
   */
  readonly maxOutputBytes: number;

  /**
   * Runtime-assigned tool call identity, present only for tool dispatch.
   */
  readonly toolCallId?: string;
}

/**
 * Fenced runtime controls for all MCP setup and tool sends.
 */
export interface AiMcpProtocolControl {
  /**
   * Invocation cancellation.
   */
  readonly signal: AbortSignal;

  /**
   * Invocation deadline.
   */
  readonly deadlineEpochMs: number;

  /**
   * Reads current epoch milliseconds from the runtime clock.
   * @returns Current epoch milliseconds from the runtime clock.
   */
  readonly nowEpochMs: () => number;

  /**
   * Checks whether the active execution fence still admits sends.
   * @returns Whether the active execution fence still admits sends.
   */
  readonly hasAuthority: () => boolean;

  /**
   * Acquires request bytes and full output credit before physical send.
   * @param request Exact physical message and requested credit.
   * @returns Fenced reservation ticket after persistence.
   */
  readonly reserveMessage: (request: AiMcpMessageRequest) => Promise<AiMcpMessageTicket>;

  /**
   * Records each received chunk, including a crossing chunk, synchronously.
   * @param ticketId Reservation receiving bytes.
   * @param bytes Decoded bytes in this chunk.
   */
  readonly onReceived: (ticketId: string, bytes: number) => void;

  /**
   * Persists known receipt once a send settles; absent bytes retain uncertain credit.
   * @param ticketId Settled reservation.
   * @param receivedBytes Complete measured decoded bytes; absent after an incomplete response.
   * @returns Completion after durable receipt recording.
   */
  readonly finishMessage: (ticketId: string, receivedBytes?: number) => Promise<void>;
}

/**
 * Credentials resolved by runtime callbacks before protocol construction.
 */
export interface AiMcpResolvedConnection {
  /**
   * Scoped HTTP headers; never included in recorded identity.
   */
  readonly headers?: Readonly<Record<string, string>>;

  /**
   * Scoped child environment; never included in recorded identity.
   */
  readonly environment?: Readonly<Record<string, string>>;
}

/**
 * Credential-free configured endpoint pinned before protocol dispatch.
 */
export interface AiMcpConnectionIdentity {
  /**
   * Registered server identifier.
   */
  readonly serverId: string;

  /**
   * Registered server revision.
   */
  readonly revision: string;

  /**
   * `sha256:` followed by the SHA-256 hex digest of the configured HTTP URL, or of
   * JSON.stringify([executable, args, cwd]) for stdio. Resolved headers and
   * environment are excluded. The digest is compared before discovery.
   */
  readonly endpoint: string;
}

/**
 * Accepted remote tool definition advertised to the selected model.
 */
export interface AiMcpToolDefinition {
  /**
   * Exact configured MCP tool name.
   */
  readonly name: string;

  /**
   * Bounded discovered description.
   */
  readonly description: string;

  /**
   * Accepted input schema serialized as JSON.
   */
  readonly inputSchemaJson: string;
}

/**
 * Runtime-selected discovered definition tied to one configured tool reference.
 */
export interface AiMcpAdvertisedTool {
  /**
   * Configured MCP server identifier.
   */
  readonly server: string;

  /**
   * Configured tool name within that server.
   */
  readonly tool: string;

  /**
   * Bounded discovered description.
   */
  readonly description: string;

  /**
   * Canonical accepted JSON input schema.
   */
  readonly inputSchemaJson: string;
}

/**
 * Bounded MCP result content admitted into a tool response.
 */
export type AiMcpResultContent =
  | {
      /**
       * Text result discriminant.
       */
      readonly kind: "text";

      /**
       * Bounded UTF-8 text.
       */
      readonly text: string;
    }
  | {
      /**
       * Structured JSON result discriminant.
       */
      readonly kind: "json";

      /**
       * Bounded canonical JSON text.
       */
      readonly json: string;
    };

/**
 * One response from an externally dispatched MCP tool.
 */
export interface AiMcpToolResult {
  /**
   * Text or structured JSON, without resource or binary content.
   */
  readonly content: readonly AiMcpResultContent[];

  /**
   * MCP application error flag, distinct from an uncertain transport failure.
   */
  readonly isError: boolean;
}

/**
 * One registered-server MCP connection; it cannot bypass runtime call intent.
 */
export interface AiMcpProtocolSession {
  /**
   * Credential-free server identity for persisted reconnection checks.
   */
  readonly identity: AiMcpConnectionIdentity;

  /**
   * Lists and validates only configured tool names.
   * @param allowedNames Registered names allowed for this invocation.
   * @returns Bounded accepted definitions.
   */
  discover(allowedNames: readonly string[]): Promise<readonly AiMcpToolDefinition[]>;

  /**
   * Validates canonical JSON arguments locally before runtime authorization.
   * @param name Advertised tool name.
   * @param canonicalJson Serialized argument object.
   */
  validateArguments(name: string, canonicalJson: string): void;

  /**
   * Dispatches one already-authorized and journaled tool call.
   * @param name Advertised tool name.
   * @param canonicalJson Locally validated argument object.
   * @param options Runtime tool identity and call bounds.
   * @returns Bounded text or structured JSON result.
   */
  call(
    name: string,
    canonicalJson: string,
    options: {
      readonly toolCallId: string;
      readonly signal: AbortSignal;
      readonly deadlineEpochMs: number;
      readonly maxResultBytes: number;
    },
  ): Promise<AiMcpToolResult>;

  /**
   * Closes protocol sends and resources.
   * @returns Completion after protocol sends and resources close.
   */
  close(): Promise<void>;
}

/**
 * Optional registration-scoped MCP protocol implementation.
 */
export interface AiMcpProtocolFactory {
  /**
   * Creates one selected server connection after runtime authorization.
   * @param options Registered server, scoped credentials, and runtime controls.
   * @returns Negotiated session with credential-free identity.
   */
  connect(options: {
    readonly server: McpServerDefinition;
    readonly scope: AiScope;
    readonly resolved: AiMcpResolvedConnection;
    readonly control: AiMcpProtocolControl;
  }): Promise<AiMcpProtocolSession>;
}
