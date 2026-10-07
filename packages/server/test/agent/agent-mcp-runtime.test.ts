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
import { create } from "@bufbuild/protobuf";
import { AiRegistry, Mcp, ModelRef, type AiScope } from "@spine-event-engine/ai";
import type {
  AiBackendDefinition,
  AiMcpProtocolFactory,
  AiMcpProtocolSession,
  AiToolInvocation,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiOutcome,
  AiToolCallIdSchema,
  ToolEffect,
  ToolResponseSchema,
} from "@spine-event-engine/proto/agent";
// prettier-ignore
import {
  AgentNamedOperationSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it, vi } from "vitest";
import { AgentMcpRuntime } from "../../src/agent/agent-mcp-runtime.js";
import type { AgentMcpHost } from "../../src/agent/agent-mcp-host.js";

const limits = {
  operations: 1,
  modelRequests: 2,
  toolCalls: 2,
  recordedReads: 0,
  deadlineMs: 5_000,
  totalInputBytes: 16_384,
  totalOutputBytes: 16_384,
  maxRecoveryBytes: 16_384,
};
const schemaJson = '{"type":"object","properties":{"ticket":{"type":"string"}}}';
const endpoint = `sha256:${createHash("sha256").update("https://knowledge.test/mcp").digest("hex")}`;
const invocation: AiToolInvocation = {
  ticketId: "attempt-1",
  server: "knowledge",
  tool: "lookup",
  argumentsJson: '{"ticket":"T-1"}',
  providerCallId: "provider-call-1",
};

/**
 * Creates an isolated host backed by a real registry and protocol fixture.
 * @param effect Registered tool effect for the fixture.
 * @param mode Configured MCP transport for the fixture.
 * @param credentials Whether scoped credentials are resolved.
 * @returns Fake protocol, host hooks and observed order.
 */
const fixture = (
  effect: "read" | "write" = "read",
  mode: "http" | "stdio" = "http",
  credentials = false,
) => {
  const events: string[] = [];
  const headers = vi.fn(() => ({ Authorization: "secret" }));
  const environment = vi.fn(() => ({ TOKEN: "secret" }));
  const transport =
    mode === "http"
      ? {
          kind: "streamable-http" as const,
          url: "https://knowledge.test/mcp",
          ...(credentials ? { headers } : {}),
        }
      : {
          kind: "stdio" as const,
          executable: "/usr/bin/mcp",
          args: ["--serve"],
          cwd: "/tmp",
          ...(credentials ? { environment } : {}),
        };
  const actualEndpoint =
    mode === "http"
      ? endpoint
      : `sha256:${createHash("sha256")
          .update(JSON.stringify(["/usr/bin/mcp", ["--serve"], "/tmp"]))
          .digest("hex")}`;
  const protocol = {
    identity: { serverId: "knowledge", revision: "v1", endpoint: actualEndpoint },
    discover: vi.fn(() =>
      Promise.resolve([
        {
          name: "lookup",
          description: "Read a support ticket",
          inputSchemaJson: schemaJson,
        },
      ]),
    ),
    validateArguments: vi.fn(),
    call: vi.fn<AiMcpProtocolSession["call"]>(() =>
      Promise.resolve({
        content: [{ kind: "text" as const, text: "Found" }],
        isError: false,
      }),
    ),
    close: vi.fn(() => {
      events.push("close");
      return Promise.resolve();
    }),
  } satisfies AiMcpProtocolSession;
  const factory = {
    connect: vi.fn<AiMcpProtocolFactory["connect"]>(async ({ control }) => {
      events.push("connect");
      const ticket = await control.reserveMessage({
        phase: "setup",
        method: "initialize",
        inputBytes: 8,
        maxOutputBytes: 256,
      });
      control.onReceived(ticket.id, 12);
      await control.finishMessage(ticket.id, 12);
      return protocol;
    }),
  } satisfies AiMcpProtocolFactory;
  const policy = {
    effect,
    timeoutMs: 1_000,
    maxArgumentBytes: 512,
    maxResultBytes: 512,
    authorize: vi.fn(() => true),
  };
  const authorizeConnect = vi.fn(() => true);
  const server = Mcp.server({
    id: "knowledge",
    revision: "v1",
    authorizeConnect,
    transport,
    tools: { lookup: policy },
  });
  const registry = AiRegistry.create({
    defaultModels: {},
    invocationLimits: limits,
    concurrentOperations: 1,
    queuedOperations: 0,
    hookTimeoutMs: 1_000,
  }).registerTools(server);
  const controller = new AbortController();
  const signal = controller.signal;
  const host = {
    scope: {} as AiScope,
    registry,
    backend: {
      mcp: factory,
      ref: ModelRef.of("support-mcp", "v1"),
      kind: "generation",
      supports: () => true,
      resolveIdentity: () => ({
        provider: "fixture",
        account: "support",
        endpoint: "local",
        model: "fixture",
      }),
      authorizeUse: () => true,
      connect: (_scope, identity) => ({ model: {}, identity }),
      execute: () => Promise.reject(new Error("No model execution expected.")),
    } satisfies AiBackendDefinition,
    operation: create(AgentNamedOperationSchema, {
      callName: "draft",
      conversation: { value: "conversation-1" },
      operation: { value: "operation-1" },
    }),
    session: {} as AgentMcpHost["session"],
    signal,
    deadlineEpochMs: Date.now() + 5_000,
    reserveMessage: vi.fn(() => {
      events.push("reserve");
      return Promise.resolve({
        id: "mcp-ticket",
        signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxOutputBytes: 256,
      });
    }),
    onReceived: vi.fn(() => {
      events.push("received");
    }),
    finishMessage: vi.fn(() => {
      events.push("finish-message");
      return Promise.resolve();
    }),
    journalToolIntent: vi.fn<AgentMcpHost["journalToolIntent"]>((_call, request) => {
      events.push("intent");
      expect(request.effect).toBe(effect === "write" ? ToolEffect.WRITE : ToolEffect.READ);
      return Promise.resolve({ kind: "new" as const, callId: "tool-call-1" });
    }),
    markToolDispatched: vi.fn(() => {
      events.push("dispatched");
      return Promise.resolve();
    }),
    finishTool: vi.fn<AgentMcpHost["finishTool"]>(() => {
      events.push("finish-tool");
      return Promise.resolve();
    }),
    recordFailure: vi.fn<AgentMcpHost["recordFailure"]>((code) =>
      Promise.resolve({
        code,
        retryableByNewSignal: false,
        diagnosticId: "diagnostic-1",
      }),
    ),
  } satisfies AgentMcpHost;
  return {
    host,
    factory,
    protocol,
    policy,
    authorizeConnect,
    headers,
    environment,
    events,
    controller,
  };
};

describe("Agent MCP runtime", () => {
  it("prepares the exact registered catalog through shared protocol reservations", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    const catalog = await runtime.prepare();
    expect(catalog).toEqual([
      {
        server: "knowledge",
        tool: "lookup",
        description: "Read a support ticket",
        inputSchemaJson: schemaJson,
      },
    ]);
    expect(test.events).toEqual(["connect", "reserve", "received", "finish-message"]);
    expect(test.protocol.discover).toHaveBeenCalledWith(["lookup"]);
    await runtime.close();
    expect(test.protocol.close).toHaveBeenCalledOnce();
  });

  it("journals one authorized call before external dispatch and response delivery", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    const response = await runtime.call(invocation);
    expect(response).toMatchObject({
      call: { value: "tool-call-1" },
      outcome: AiOutcome.ADMITTED,
      text: ["Found"],
    });
    expect(test.events.slice(-3)).toEqual(["intent", "dispatched", "finish-tool"]);
    expect(test.policy.authorize).toHaveBeenCalledOnce();
    expect(test.protocol.validateArguments).toHaveBeenCalledWith(
      "lookup",
      invocation.argumentsJson,
    );
    expect(test.protocol.call).toHaveBeenCalledWith(
      "lookup",
      invocation.argumentsJson,
      expect.objectContaining({ toolCallId: "tool-call-1" }),
    );
    await runtime.close();
  });

  it("rejects missing or unconfigured tool references before protocol setup", async () => {
    const test = fixture();
    await expect(
      new AgentMcpRuntime(test.host, [{ server: "missing", tool: "lookup" }]).prepare(),
    ).rejects.toThrow("registered");
    await expect(
      new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "other" }]).prepare(),
    ).rejects.toThrow("configured");
    await expect(
      new AgentMcpRuntime(test.host, [
        { server: "knowledge", tool: "lookup" },
        { server: "knowledge", tool: "lookup" },
      ]).prepare(),
    ).rejects.toThrow("duplicated");
    expect(test.factory.connect).not.toHaveBeenCalled();
  });

  it("rejects changed discovery without advertising or dispatching a tool", async () => {
    const test = fixture();
    vi.mocked(test.protocol.discover).mockResolvedValueOnce([
      { name: "unexpected", description: "Changed", inputSchemaJson: schemaJson },
    ]);
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await expect(runtime.prepare()).rejects.toThrow("catalog");
    expect(test.protocol.close).toHaveBeenCalledOnce();
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
  });

  it("rejects a valid-looking endpoint digest that does not match configured transport", async () => {
    const test = fixture();
    test.protocol.identity.endpoint = "a".repeat(64);
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await expect(runtime.prepare()).rejects.toThrow("identity");
    expect(test.protocol.discover).not.toHaveBeenCalled();
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
    expect(test.protocol.close).toHaveBeenCalledOnce();
  });

  it("bounds cleanup of a rejected connection whose close never settles", async () => {
    const test = fixture();
    test.protocol.identity.endpoint = "wrong-endpoint";
    test.host.deadlineEpochMs = Date.now() + 40;
    vi.mocked(test.protocol.close).mockReturnValueOnce(new Promise<void>(() => undefined));
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await expect(runtime.prepare()).rejects.toThrow("identity");
    expect(test.protocol.close).toHaveBeenCalledOnce();
    expect(test.protocol.discover).not.toHaveBeenCalled();
  });

  it("does not journal or dispatch invalid and unauthorized proposals", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    vi.mocked(test.protocol.validateArguments).mockImplementationOnce(() => {
      throw new Error("schema mismatch");
    });
    expect(await runtime.call(invocation)).toMatchObject({
      outcome: AiOutcome.FAILED,
      diagnosticId: { value: "diagnostic-1" },
    });
    expect(test.host.recordFailure).toHaveBeenCalledWith("INVALID_INPUT", false);
    vi.mocked(test.policy.authorize).mockResolvedValueOnce(false);
    expect(await runtime.call(invocation)).toMatchObject({ outcome: AiOutcome.FAILED });
    expect(test.host.recordFailure).toHaveBeenCalledWith("AUTHENTICATION_REQUIRED", false);
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
    expect(test.protocol.call).not.toHaveBeenCalled();
    await runtime.close();
  });

  it.each(["replay", "unknown"] as const)(
    "returns a saved %s result without redispatch",
    async (kind) => {
      const test = fixture("write");
      const response = create(ToolResponseSchema, {
        call: create(AiToolCallIdSchema, { value: "saved-call" }),
        outcome: kind === "unknown" ? AiOutcome.UNKNOWN : AiOutcome.ADMITTED,
      });
      vi.mocked(test.host.journalToolIntent).mockResolvedValueOnce({ kind, response });
      const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
      await runtime.prepare();
      expect(await runtime.call(invocation)).toBe(response);
      expect(test.host.markToolDispatched).not.toHaveBeenCalled();
      expect(test.protocol.call).not.toHaveBeenCalled();
      expect(test.host.finishTool).not.toHaveBeenCalled();
      await runtime.close();
    },
  );

  it("records an uncertain write without retrying a rejected protocol call", async () => {
    const test = fixture("write");
    vi.mocked(test.protocol.call).mockRejectedValueOnce(new Error("connection lost"));
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    const response = await runtime.call(invocation);
    expect(response).toMatchObject({
      outcome: AiOutcome.UNKNOWN,
      diagnosticId: { value: "diagnostic-1" },
    });
    expect(test.host.recordFailure).toHaveBeenCalledWith("TOOL_OUTCOME_UNKNOWN", false);
    expect(test.protocol.call).toHaveBeenCalledOnce();
    expect(test.host.finishTool).toHaveBeenCalledOnce();
    const savedCall = vi.mocked(test.host.finishTool).mock.calls[0];
    if (!savedCall) throw new Error("The tool result was not journaled");
    const [savedId, savedResponse, history] = savedCall;
    expect(savedId).toBe("tool-call-1");
    expect(savedResponse).toBe(response);
    expect(history).toMatchObject({ item: { case: "conversationRecord" } });
    await runtime.close();
  });

  it("keeps an MCP application error distinct from transport uncertainty", async () => {
    const test = fixture("write");
    vi.mocked(test.protocol.call).mockResolvedValueOnce({
      content: [{ kind: "text", text: "not found" }],
      isError: true,
    });
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    expect(await runtime.call(invocation)).toMatchObject({
      outcome: AiOutcome.FAILED,
      toolError: true,
      text: ["not found"],
    });
    expect(test.host.recordFailure).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("closes a connection that resolves after cancellation", async () => {
    const test = fixture();
    let connect!: (session: AiMcpProtocolSession) => void;
    vi.mocked(test.factory.connect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          connect = resolve;
        }),
    );
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    const preparing = runtime.prepare();
    await vi.waitFor(() => {
      expect(test.factory.connect).toHaveBeenCalledOnce();
    });
    test.controller.abort();
    await expect(preparing).rejects.toThrow("cancellation");
    connect(test.protocol);
    await vi.waitFor(() => {
      expect(test.protocol.close).toHaveBeenCalledOnce();
    });
  });

  it("reports a failed session close without exposing transport error text", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    vi.mocked(test.protocol.close).mockRejectedValueOnce(new Error("fixture-secret"));
    await expect(runtime.close()).rejects.toThrow("MCP session close failed");
    expect(test.protocol.close).toHaveBeenCalledOnce();
  });

  it("needs no protocol connection for a capability with no tools", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime(test.host, []);
    expect(await runtime.prepare()).toEqual([]);
    expect(test.factory.connect).not.toHaveBeenCalled();
    await runtime.close();
    await runtime.close();
    await expect(runtime.prepare()).rejects.toThrow("closed");
  });

  it("waits for one shared session cleanup across concurrent close callers", async () => {
    const test = fixture();
    let release!: () => void;
    const closing = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(test.protocol.close).mockReturnValueOnce(closing);
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    const first = runtime.close();
    const second = runtime.close();
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(test.protocol.close).toHaveBeenCalledOnce();
  });

  it("bounds a stalled protocol close and consumes its late rejection", async () => {
    const test = fixture();
    let rejectClose!: (reason: Error) => void;
    vi.mocked(test.protocol.close).mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        rejectClose = reject;
      }),
    );
    const runtime = new AgentMcpRuntime({ ...test.host, deadlineEpochMs: Date.now() + 40 }, [
      { server: "knowledge", tool: "lookup" },
    ]);
    await runtime.prepare();
    const first = runtime.close();
    const second = runtime.close();
    await expect(first).rejects.toThrow("deadline");
    await expect(second).rejects.toThrow("deadline");
    expect(test.protocol.close).toHaveBeenCalledOnce();
    rejectClose(new Error("secret late close failure"));
    await Promise.resolve();
  });

  it("rejects a selected backend without a protocol factory before setup", async () => {
    const test = fixture();
    const { mcp, ...backend } = test.host.backend;
    expect(mcp).toBe(test.factory);
    const runtime = new AgentMcpRuntime({ ...test.host, backend }, [
      { server: "knowledge", tool: "lookup" },
    ]);
    await expect(runtime.prepare()).rejects.toThrow("protocol factory");
    expect(test.factory.connect).not.toHaveBeenCalled();
  });

  it("denies connection policy before resolving or dispatching transport", async () => {
    const test = fixture();
    test.authorizeConnect.mockReturnValueOnce(false);
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await expect(runtime.prepare()).rejects.toThrow("connection denied");
    expect(test.factory.connect).not.toHaveBeenCalled();
    expect(test.host.reserveMessage).not.toHaveBeenCalled();
  });

  it("does not expose a credential-bearing transport setup error", async () => {
    const test = fixture();
    vi.mocked(test.factory.connect).mockRejectedValueOnce(new Error("secret-token-value"));
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await expect(runtime.prepare()).rejects.toThrow("MCP setup failed");
    await expect(runtime.prepare()).rejects.not.toThrow("secret-token-value");
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
  });

  it("records authorization callback failure without exposing scoped error text", async () => {
    const test = fixture();
    test.policy.authorize.mockRejectedValueOnce(new Error("secret-token-value"));
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    expect(await runtime.call(invocation)).toMatchObject({
      outcome: AiOutcome.FAILED,
      diagnosticId: { value: "diagnostic-1" },
    });
    expect(test.host.recordFailure).toHaveBeenCalledWith("UNAVAILABLE", false);
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("rejects missing and duplicated discovered definitions before advertisement", async () => {
    const test = fixture();
    vi.mocked(test.protocol.discover).mockResolvedValueOnce([]);
    const missing = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await expect(missing.prepare()).rejects.toThrow("omitted");
    vi.mocked(test.protocol.discover).mockResolvedValueOnce([
      { name: "lookup", description: "First", inputSchemaJson: schemaJson },
      { name: "lookup", description: "Second", inputSchemaJson: schemaJson },
    ]);
    const duplicate = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await expect(duplicate.prepare()).rejects.toThrow("catalog");
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
  });

  it("rejects unlisted tools and malformed JSON even if a protocol validator misses them", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    expect(await runtime.call({ ...invocation, tool: "other" })).toMatchObject({
      outcome: AiOutcome.FAILED,
      diagnosticId: { value: "diagnostic-1" },
    });
    expect(await runtime.call({ ...invocation, argumentsJson: "{" })).toMatchObject({
      outcome: AiOutcome.FAILED,
      diagnosticId: { value: "diagnostic-1" },
    });
    for (const argumentsJson of ["null", "[]", "1"]) {
      expect(await runtime.call({ ...invocation, argumentsJson })).toMatchObject({
        outcome: AiOutcome.FAILED,
        diagnosticId: { value: "diagnostic-1" },
      });
    }
    expect(test.host.recordFailure).toHaveBeenCalledWith("UNSUPPORTED_CAPABILITY", false);
    expect(test.host.recordFailure).toHaveBeenCalledWith("INVALID_INPUT", false);
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("rejects UTF-8 arguments above registered bytes before validation or authorization", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    const argumentsJson = JSON.stringify({ ticket: "😀".repeat(130) });
    expect(Buffer.byteLength(argumentsJson, "utf8")).toBeGreaterThan(512);
    expect(await runtime.call({ ...invocation, argumentsJson })).toMatchObject({
      outcome: AiOutcome.FAILED,
    });
    expect(test.protocol.validateArguments).not.toHaveBeenCalled();
    expect(test.policy.authorize).not.toHaveBeenCalled();
    expect(test.host.journalToolIntent).not.toHaveBeenCalled();
    expect(test.protocol.call).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("records a failed read without misclassifying it as an uncertain write", async () => {
    const test = fixture();
    vi.mocked(test.protocol.call).mockRejectedValueOnce(new Error("read failed"));
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    expect(await runtime.call(invocation)).toMatchObject({ outcome: AiOutcome.FAILED });
    expect(test.host.recordFailure).toHaveBeenCalledWith("TOOL_FAILED", false);
    expect(test.host.finishTool).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it("preserves bounded text and structured JSON in a successful response", async () => {
    const test = fixture();
    vi.mocked(test.protocol.call).mockResolvedValueOnce({
      content: [
        { kind: "text", text: "Found" },
        { kind: "json", json: '{"ticket":"T-1"}' },
      ],
      isError: false,
    });
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    expect(await runtime.call(invocation)).toMatchObject({
      outcome: AiOutcome.ADMITTED,
      text: ["Found"],
      structuredJson: '{"ticket":"T-1"}',
    });
    await runtime.close();
  });

  it.each(["http", "stdio"] as const)(
    "uses scoped %s credentials without exposing them in session identity",
    async (mode) => {
      const test = fixture("read", mode, true);
      const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
      await runtime.prepare();
      const connection = vi.mocked(test.factory.connect).mock.calls[0]?.[0];
      if (!connection) throw new Error("MCP connection was not requested");
      expect(connection.resolved).toEqual(
        mode === "http"
          ? { headers: { Authorization: "secret" } }
          : { environment: { TOKEN: "secret" } },
      );
      expect(connection.server.id).toBe("knowledge");
      expect(test.protocol.identity.endpoint).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(test.protocol.identity.endpoint).not.toContain("secret");
      expect(mode === "http" ? test.headers : test.environment).toHaveBeenCalledOnce();
      await runtime.close();
    },
  );

  it("rejects multiple structured outputs after physical dispatch without retrying", async () => {
    const test = fixture("write");
    vi.mocked(test.protocol.call).mockResolvedValueOnce({
      content: [
        { kind: "json", json: '{"a":1}' },
        { kind: "json", json: '{"b":2}' },
      ],
      isError: false,
    });
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    expect(await runtime.call(invocation)).toMatchObject({ outcome: AiOutcome.UNKNOWN });
    expect(test.protocol.call).toHaveBeenCalledOnce();
    expect(test.host.recordFailure).toHaveBeenCalledWith("TOOL_OUTCOME_UNKNOWN", false);
    await runtime.close();
  });

  it("denies an expired operation before creating a protocol connection", async () => {
    const test = fixture();
    const runtime = new AgentMcpRuntime({ ...test.host, deadlineEpochMs: Date.now() - 1 }, [
      { server: "knowledge", tool: "lookup" },
    ]);
    await expect(runtime.prepare()).rejects.toThrow("deadline");
    expect(test.factory.connect).not.toHaveBeenCalled();
  });

  it("exposes cancellation and the Spine clock to a bounded protocol connection", async () => {
    const test = fixture();
    let protocolControl: Parameters<AiMcpProtocolFactory["connect"]>[0]["control"] | undefined;
    vi.mocked(test.factory.connect).mockImplementationOnce(({ control }) => {
      protocolControl = control;
      return Promise.resolve(test.protocol);
    });
    const runtime = new AgentMcpRuntime(test.host, [{ server: "knowledge", tool: "lookup" }]);
    await runtime.prepare();
    if (!protocolControl) throw new Error("Protocol control was not supplied");
    expect(protocolControl.hasAuthority()).toBe(true);
    expect(protocolControl.nowEpochMs()).toBeGreaterThan(0);
    await runtime.close();
    expect(protocolControl.hasAuthority()).toBe(false);
  });
});
