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

import { createHash, randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { AnyMessages, Time } from "@spine-event-engine/core";
import type { AiControl, AiJson, AiToolRef, McpServerDefinition } from "@spine-event-engine/ai";
import {
  mcpDefinition,
  mcpRegistration,
  registryOptions,
} from "@spine-event-engine/ai/spi/runtime";
import type {
  AiMcpAdvertisedTool,
  AiMcpProtocolControl,
  AiMcpProtocolSession,
  AiMcpToolResult,
  AiToolInvocation,
} from "@spine-event-engine/ai/spi/adapter";
import { AiMcpSetupFailure } from "@spine-event-engine/ai/spi/adapter";
import {
  AgentHistoryEntrySchema,
  AiDiagnosticIdSchema,
  AiOutcome,
  AiToolCallIdSchema as ToolCallIdSchema,
  ConversationRecordIdSchema,
  ConversationRecordSchema,
  McpServerIdSchema,
  McpToolNameSchema,
  ToolEffect,
  ToolResponseSchema,
  type AgentHistoryEntry,
  type ToolResponse,
} from "@spine-event-engine/proto/agent";
import type { AgentMcpHost } from "./agent-mcp-host.js";
import { AgentExecutionFault } from "./agent-execution-fault.js";

interface SelectedServer {
  readonly definition: McpServerDefinition;
  readonly tools: readonly string[];
}

/**
 * Safe MCP runtime failure whose text contains no scoped credentials.
 */
class SafeMcpError extends Error {}

/**
 * Executes one selected MCP catalog and its calls under the shared Agent journal.
 */
export class AgentMcpRuntime {
  /**
   * Connected protocol sessions indexed by registered server ID.
   */
  private readonly sessions = new Map<string, AiMcpProtocolSession>();

  /**
   * Cancellation for all callbacks and protocol sessions in this invocation.
   */
  private readonly closed = new AbortController();

  /**
   * Shared discovery result for concurrent prepare callers.
   */
  private prepared?: Promise<readonly AiMcpAdvertisedTool[]>;

  /**
   * Shared completion for all callers closing this invocation.
   */
  private closing?: Promise<void>;

  /**
   * Binds one accepted capability tool list to the active fenced operation.
   * @param host Shared budget, session and diagnostic authority.
   * @param allowedTools Capability tools in declared order.
   */
  constructor(
    private readonly host: AgentMcpHost,
    private readonly allowedTools: readonly AiToolRef[],
  ) {}

  /**
   * Prepares the exact configured catalog before a model request is prepared.
   * @returns Immutable descriptions and schemas in capability order.
   */
  prepare(): Promise<readonly AiMcpAdvertisedTool[]> {
    if (this.closed.signal.aborted) return Promise.reject(new SafeMcpError("MCP runtime closed"));
    this.prepared ??= this.prepareAll();
    return this.prepared;
  }

  /**
   * Validates and executes one model-proposed call through persisted intent.
   * @param invocation Correlated model proposal with canonical arguments.
   * @returns Saved or newly journaled bounded tool response.
   */
  async call(invocation: AiToolInvocation): Promise<ToolResponse> {
    await this.prepare();
    const server = this.serverFor(invocation.server);
    const policy = server?.tools[invocation.tool];
    const session = this.sessions.get(invocation.server);
    if (!this.isAllowed(invocation) || !policy || !session)
      return this.rejected("UNSUPPORTED_CAPABILITY");
    if (Buffer.byteLength(invocation.argumentsJson, "utf8") > policy.maxArgumentBytes)
      return this.rejected("INVALID_INPUT");
    let argumentsObject: Readonly<Record<string, AiJson>>;
    try {
      session.validateArguments(invocation.tool, invocation.argumentsJson);
      const parsed: unknown = JSON.parse(invocation.argumentsJson);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
        throw new SafeMcpError("MCP tool arguments must be a JSON object");
      argumentsObject = parsed as Readonly<Record<string, AiJson>>;
    } catch {
      return this.rejected("INVALID_INPUT");
    }
    const authorization = await this.authorize(invocation, policy, argumentsObject);
    if (authorization === "unavailable") return this.rejected("UNAVAILABLE");
    if (authorization === "denied") return this.rejected("AUTHENTICATION_REQUIRED");
    return this.dispatch(invocation, session, policy);
  }

  /**
   * Checks one registered tool authorization callback before intent is saved.
   * @param call Model-proposed tool call.
   * @param policy Registered tool policy.
   * @param argumentsObject Parsed JSON object arguments.
   * @returns Allowed, denied or unavailable authorization state.
   */
  private async authorize(
    call: AiToolInvocation,
    policy: McpServerDefinition["tools"][string],
    argumentsObject: Readonly<Record<string, AiJson>>,
  ): Promise<"allowed" | "denied" | "unavailable"> {
    try {
      const allowed = await this.bounded(
        (control) =>
          policy.authorize(
            this.host.scope,
            {
              tool: { server: call.server, tool: call.tool },
              arguments: argumentsObject,
            },
            control,
          ),
        this.hookTimeout(),
      );
      return allowed ? "allowed" : "denied";
    } catch {
      return "unavailable";
    }
  }

  /**
   * Cancels pending work and attempts bounded cleanup of connected protocol sessions.
   * @returns Shared completion, rejecting if cleanup fails or exceeds the deadline.
   */
  close(): Promise<void> {
    this.closing ??= this.closeSessions();
    return this.closing;
  }

  /**
   * Cancels callbacks and bounds the wait for connected protocol sessions.
   * @returns Shared cleanup completion or a safe rejection.
   */
  private async closeSessions(): Promise<void> {
    this.closed.abort();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    const settled = Promise.allSettled(
      sessions.map((session) => Promise.resolve().then(() => session.close())),
    );
    const deadline = Math.min(
      this.host.deadlineEpochMs,
      Time.currentTimeMillis() + this.hookTimeout(),
    );
    const child = new AbortController();
    const stop = schedule(deadline, child);
    const abort = abortWait(child.signal);
    let closed: Awaited<typeof settled>;
    try {
      closed = await Promise.race([settled, abort.promise]);
    } finally {
      abort.dispose();
      stop();
    }
    if (closed.some((result) => result.status === "rejected"))
      throw new SafeMcpError("MCP session close failed");
  }

  /**
   * Lists registry-approved servers without making a connection.
   * @returns Exact servers and configured tools.
   */
  private selected(): ReadonlyMap<string, SelectedServer> {
    const servers = new Map<string, { definition: McpServerDefinition; tools: string[] }>();
    for (const ref of this.allowedTools) {
      const registration = mcpRegistration(this.host.registry, ref.server);
      if (!registration) throw new SafeMcpError("MCP server is not registered");
      const definition = mcpDefinition(registration);
      if (!Object.hasOwn(definition.tools, ref.tool))
        throw new SafeMcpError("MCP tool is not configured");
      const selected = servers.get(ref.server) ?? { definition, tools: [] };
      if (selected.tools.includes(ref.tool))
        throw new SafeMcpError("MCP tool reference is duplicated");
      selected.tools.push(ref.tool);
      servers.set(ref.server, selected);
    }
    return servers;
  }

  /**
   * Prepares every selected server under bounded authorization.
   * @returns Catalog in capability order.
   */
  private async prepareAll(): Promise<readonly AiMcpAdvertisedTool[]> {
    const selected = this.selected();
    if (!selected.size) return Object.freeze([]);
    if (!this.host.backend.mcp)
      throw new SafeMcpError("Selected backend has no MCP protocol factory");
    const definitions = new Map<string, AiMcpAdvertisedTool>();
    try {
      for (const [id, server] of selected) {
        const session = await this.connect(server.definition);
        const found = await this.bounded(() => session.discover(server.tools), this.hookTimeout());
        this.collectDefinitions(id, server.tools, found, definitions);
      }
      return this.orderedCatalog(definitions);
    } catch (error) {
      try {
        await this.close();
      } catch {
        /* The setup failure remains authoritative. */
      }
      if (error instanceof AiMcpSetupFailure || error instanceof AgentExecutionFault) throw error;
      throw error instanceof SafeMcpError ? error : new SafeMcpError("MCP setup failed");
    }
  }

  /**
   * Checks discovered definitions against configured names without advertising extras.
   * @param id Registered server ID.
   * @param allowed Configured tool names.
   * @param found Bounded discovery result.
   * @param definitions Accumulated exact catalog.
   */
  private collectDefinitions(
    id: string,
    allowed: readonly string[],
    found: readonly {
      name: string;
      description: string;
      inputSchemaJson: string;
      outputSchemaJson?: string;
    }[],
    definitions: Map<string, AiMcpAdvertisedTool>,
  ): void {
    for (const tool of found) {
      const key = `${id}\u0000${tool.name}`;
      if (!allowed.includes(tool.name) || definitions.has(key))
        throw new AiMcpSetupFailure("UNSUPPORTED_CAPABILITY");
      definitions.set(
        key,
        Object.freeze({
          server: id,
          tool: tool.name,
          description: tool.description,
          inputSchemaJson: tool.inputSchemaJson,
          ...(tool.outputSchemaJson === undefined
            ? {}
            : { outputSchemaJson: tool.outputSchemaJson }),
        }),
      );
    }
  }

  /**
   * Returns the exact discovered catalog in capability order.
   * @param definitions Checked descriptions and schemas by configured reference.
   * @returns Immutable catalog in capability order.
   */
  private orderedCatalog(
    definitions: ReadonlyMap<string, AiMcpAdvertisedTool>,
  ): readonly AiMcpAdvertisedTool[] {
    return Object.freeze(
      this.allowedTools.map((ref) => {
        const definition = definitions.get(`${ref.server}\u0000${ref.tool}`);
        if (!definition) throw new AiMcpSetupFailure("UNSUPPORTED_CAPABILITY");
        return definition;
      }),
    );
  }

  /**
   * Connects one authorized server and checks its credential-free identity.
   * @param server Registered server configuration.
   * @returns Scoped protocol session.
   */
  private async connect(server: McpServerDefinition): Promise<AiMcpProtocolSession> {
    const timeout = this.hookTimeout();
    const allowed = await this.bounded(
      (control) => server.authorizeConnect(this.host.scope, control),
      timeout,
    );
    if (!allowed) throw new AiMcpSetupFailure("AUTHENTICATION_REQUIRED");
    const resolved = await this.resolve(server);
    const factory = this.host.backend.mcp;
    if (!factory) throw new SafeMcpError("Selected backend has no MCP protocol factory");
    const session = await this.bounded<AiMcpProtocolSession>(
      (control) =>
        factory.connect({
          server,
          scope: this.host.scope,
          resolved,
          control: this.protocol(server.id, control),
        }),
      timeout,
      (late) => late.close(),
    );
    await this.checkConnectionIdentity(server, session, timeout);
    this.sessions.set(server.id, session);
    return session;
  }

  /**
   * Rejects identity drift after attempting bounded cleanup of the session.
   * @param server Registered server configuration.
   * @param session Newly connected protocol session.
   * @param timeout Local callback timeout in milliseconds.
   * @returns Completion after identity verification.
   */
  private async checkConnectionIdentity(
    server: McpServerDefinition,
    session: AiMcpProtocolSession,
    timeout: number,
  ): Promise<void> {
    if (
      session.identity.serverId !== server.id ||
      session.identity.revision !== server.revision ||
      session.identity.endpoint !== endpointDigest(server)
    ) {
      try {
        await this.bounded(() => session.close(), timeout);
      } catch {
        // Identity mismatch remains the safe rejection after bounded cleanup.
      }
      throw new SafeMcpError("MCP connection identity changed");
    }
  }

  /**
   * Resolves scoped credentials without adding them to recorded identity.
   * @param server Registered server configuration.
   * @returns Headers or child environment for connection construction.
   */
  private async resolve(server: McpServerDefinition) {
    const transport = server.transport;
    const timeout = this.hookTimeout();
    if (transport.kind === "streamable-http") {
      const headers = transport.headers;
      return headers
        ? { headers: await this.bounded((control) => headers(this.host.scope, control), timeout) }
        : {};
    }
    const environment = transport.environment;
    return environment
      ? {
          environment: await this.bounded(
            (control) => environment(this.host.scope, control),
            timeout,
          ),
        }
      : {};
  }

  /**
   * Reads the finite callback bound from application registration.
   * @returns Callback timeout in milliseconds.
   */
  private hookTimeout(): number {
    return registryOptions(this.host.registry).hookTimeoutMs ?? 5_000;
  }

  /**
   * Binds protocol reservations and receipts to the shared budget.
   * @param server Registered server ID.
   * @param control Bounded connection control.
   * @returns Protocol controls scoped to this operation.
   */
  private protocol(server: string, control: AiControl): AiMcpProtocolControl {
    return {
      signal: control.signal,
      deadlineEpochMs: this.host.deadlineEpochMs,
      nowEpochMs: () => Time.currentTimeMillis(),
      hasAuthority: () => !control.signal.aborted && !this.closed.signal.aborted,
      reserveMessage: (request) => this.host.reserveMessage(server, request),
      onReceived: (id, bytes) => {
        this.host.onReceived(id, bytes);
      },
      finishMessage: (id, bytes) => this.host.finishMessage(id, bytes),
    };
  }

  /**
   * Checks whether the capability listed this exact tool reference.
   * @param call Model-proposed tool reference.
   * @returns Whether the tool is in the configured allowlist.
   */
  private isAllowed(call: AiToolInvocation): boolean {
    return this.allowedTools.some((ref) => ref.server === call.server && ref.tool === call.tool);
  }

  /**
   * Finds a registered server by ID.
   * @param id Registered server ID.
   * @returns Server definition, or absence for an unknown ID.
   */
  private serverFor(id: string): McpServerDefinition | undefined {
    const registration = mcpRegistration(this.host.registry, id);
    return registration ? mcpDefinition(registration) : undefined;
  }

  /**
   * Records intent, dispatches once and persists the resulting response.
   * @param call Correlated model proposal.
   * @param session Checked protocol session.
   * @param policy Registered tool policy.
   * @returns Saved or newly persisted response.
   */
  private async dispatch(
    call: AiToolInvocation,
    session: AiMcpProtocolSession,
    policy: McpServerDefinition["tools"][string],
  ): Promise<ToolResponse> {
    const request = {
      server: create(McpServerIdSchema, { value: call.server }),
      tool: create(McpToolNameSchema, { value: call.tool }),
      argumentsJson: call.argumentsJson,
      effect: policy.effect === "write" ? ToolEffect.WRITE : ToolEffect.READ,
    };
    const intent = await this.host.journalToolIntent(call, request);
    if (intent.kind !== "new") return intent.response;
    await this.host.markToolDispatched(intent.callId);
    const response = await this.perform(call, session, policy, intent.callId);
    await this.host.finishTool(intent.callId, response, this.history(response));
    return response;
  }

  /**
   * Performs a bounded call and preserves uncertainty for failed writes.
   * @param call Correlated model proposal.
   * @param session Checked protocol session.
   * @param policy Registered tool policy.
   * @param callId Runtime-allocated tool call ID.
   * @returns Supported result or recorded safe failure.
   */
  private async perform(
    call: AiToolInvocation,
    session: AiMcpProtocolSession,
    policy: McpServerDefinition["tools"][string],
    callId: string,
  ): Promise<ToolResponse> {
    try {
      const result = await this.bounded(
        (control) =>
          session.call(call.tool, call.argumentsJson, {
            toolCallId: callId,
            signal: control.signal,
            deadlineEpochMs: control.deadlineEpochMs,
            maxResultBytes: policy.maxResultBytes,
          }),
        policy.timeoutMs,
      );
      return this.response(callId, result);
    } catch {
      const unknown = policy.effect === "write";
      const failure = await this.host.recordFailure(
        unknown ? "TOOL_OUTCOME_UNKNOWN" : "TOOL_FAILED",
        false,
      );
      return create(ToolResponseSchema, {
        call: create(ToolCallIdSchema, { value: callId }),
        outcome: unknown ? AiOutcome.UNKNOWN : AiOutcome.FAILED,
        diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
      });
    }
  }

  /**
   * Converts supported text and structured JSON with the MCP error flag.
   * @param callId Runtime-allocated tool call ID.
   * @param result Bounded protocol result.
   * @returns Domain tool response.
   */
  private response(callId: string, result: AiMcpToolResult): ToolResponse {
    const structured = result.content.filter((part) => part.kind === "json");
    if (structured.length > 1) throw new Error("MCP result has multiple structured values");
    return create(ToolResponseSchema, {
      call: create(ToolCallIdSchema, { value: callId }),
      outcome: result.isError ? AiOutcome.FAILED : AiOutcome.ADMITTED,
      text: result.content.flatMap((part) => (part.kind === "text" ? [part.text] : [])),
      ...(structured[0]?.kind === "json" ? { structuredJson: structured[0].json } : {}),
      toolError: result.isError,
    });
  }

  /**
   * Records a failed proposal without fabricating an authorized request.
   * @param code Safe failure category.
   * @returns Failed response with a persisted diagnostic reference.
   */
  private async rejected(
    code: "INVALID_INPUT" | "UNSUPPORTED_CAPABILITY" | "AUTHENTICATION_REQUIRED" | "UNAVAILABLE",
  ) {
    const failure = await this.host.recordFailure(code, false);
    return create(ToolResponseSchema, {
      call: create(ToolCallIdSchema, { value: randomUUID() }),
      outcome: AiOutcome.FAILED,
      diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
    });
  }

  /**
   * Creates response history for one completed tool intent.
   * @param response Persisted tool response.
   * @returns Conversation record wrapped as an Agent history entry.
   */
  private history(response: ToolResponse): AgentHistoryEntry {
    const occurredAt = Time.currentTime();
    return create(AgentHistoryEntrySchema, {
      occurredAt,
      item: {
        case: "conversationRecord",
        value: create(ConversationRecordSchema, {
          id: create(ConversationRecordIdSchema, { value: randomUUID() }),
          conversation: this.host.operation.conversation,
          operation: this.host.operation.operation,
          toolCall: response.call,
          occurredAt,
          content: AnyMessages.pack(ToolResponseSchema, response),
        }),
      },
    });
  }

  /**
   * Executes one callback within the operation and local deadline.
   * @typeParam T Callback result type.
   * @param run Callback with a child cancellation control.
   * @param limitMs Configured local timeout in milliseconds.
   * @param onLate Cleanup for a resource created after cancellation.
   * @returns Callback result before the deadline.
   */
  private async bounded<T>(
    run: (control: AiControl) => T | Promise<T>,
    limitMs: number,
    onLate?: (value: T) => Promise<void>,
  ): Promise<T> {
    const now = Time.currentTimeMillis();
    const deadline = Math.min(this.host.deadlineEpochMs, now + limitMs);
    if (this.host.signal.aborted || this.closed.signal.aborted || deadline <= now)
      throw new SafeMcpError("MCP operation deadline or cancellation");
    const child = new AbortController();
    const signal = AbortSignal.any([this.host.signal, this.closed.signal, child.signal]);
    const stop = schedule(deadline, child);
    const running = Promise.resolve().then(() => run({ signal, deadlineEpochMs: deadline }));
    const abort = abortWait(signal);
    try {
      return await Promise.race([running, abort.promise]);
    } catch (error) {
      if (onLate) void running.then(onLate, () => undefined).catch(() => undefined);
      throw error;
    } finally {
      abort.dispose();
      stop();
    }
  }
}

/**
 * Calculates SHA-256 of the configured transport endpoint without resolved credentials.
 * @param server Registered transport configuration.
 * @returns Credential-free endpoint digest.
 */
const endpointDigest = (server: McpServerDefinition): string => {
  const transport = server.transport;
  const fingerprint =
    transport.kind === "streamable-http"
      ? transport.url
      : JSON.stringify([transport.executable, transport.args, transport.cwd]);
  return `sha256:${createHash("sha256").update(fingerprint).digest("hex")}`;
};

/**
 * Creates an abort rejection with listener cleanup for one bounded callback.
 * @param signal Child cancellation signal.
 * @returns Abort promise and listener disposal.
 */
const abortWait = (signal: AbortSignal): { promise: Promise<never>; dispose: () => void } => {
  let listener: (() => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    listener = () => {
      reject(new SafeMcpError("MCP operation deadline or cancellation"));
    };
    if (signal.aborted) listener();
    else signal.addEventListener("abort", listener, { once: true });
  });
  return {
    promise,
    dispose: () => {
      if (listener) signal.removeEventListener("abort", listener);
    },
  };
};

/**
 * Schedules a timer that rechecks long absolute deadlines.
 * @param deadline Absolute epoch millisecond deadline.
 * @param child Child controller to abort when expired.
 * @returns Timer cancellation.
 */
const schedule = (deadline: number, child: AbortController): (() => void) => {
  let timer: ReturnType<typeof setTimeout>;
  const tick = (): void => {
    const remaining = deadline - Time.currentTimeMillis();
    if (remaining <= 0) child.abort();
    else timer = setTimeout(tick, Math.min(remaining, 2_147_483_647));
  };
  tick();
  return () => {
    clearTimeout(timer);
  };
};
