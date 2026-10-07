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

import { createServer } from "node:http";
import { create } from "@bufbuild/protobuf";
import { AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import { backendDefinition } from "@spine-event-engine/ai/spi/runtime";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";
import { AnyMessages } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandIdSchema,
  MessageIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { AiOutcome } from "@spine-event-engine/proto/agent";
// prettier-ignore
import {
  AgentNamedOperationSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it, vi } from "vitest";
import type { AgentMcpHost } from "../../server/src/agent/agent-mcp-host.js";
import { AgentMcpRuntime } from "../../server/src/agent/agent-mcp-runtime.js";
import { SupportReplyAgentIdSchema } from "../generated/spine/server/testing/support_agent_states_pb.js";

const limits = {
  operations: 1,
  modelRequests: 1,
  toolCalls: 1,
  recordedReads: 0,
  deadlineMs: 5_000,
  totalInputBytes: 16_384,
  totalOutputBytes: 16_384,
  maxRecoveryBytes: 16_384,
};

interface RpcRequest {
  readonly method: string;
  readonly id?: string | number;
}

describe("real MCP transport through Agent runtime", () => {
  it("journals a discovered HTTP tool call before physical dispatch", async () => {
    const observed: string[] = [];
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of request) chunks.push(chunk as Uint8Array);
        const rpc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RpcRequest;
        observed.push(`remote:${rpc.method}`);
        response.setHeader("content-type", "application/json");
        if (rpc.method === "initialize")
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "support-fixture", version: "1" },
              },
            }),
          );
        else if (rpc.method === "tools/list")
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: {
                tools: [
                  {
                    name: "lookup",
                    description: "Read a support ticket",
                    inputSchema: {
                      type: "object",
                      properties: { ticket: { type: "string" } },
                      required: ["ticket"],
                      additionalProperties: false,
                    },
                  },
                ],
              },
            }),
          );
        else if (rpc.method === "tools/call")
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpc.id,
              result: { content: [{ type: "text", text: "Ticket found" }], isError: false },
            }),
          );
        else response.writeHead(202).end();
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
    const url = `http://127.0.0.1:${String(address.port)}/mcp`;
    const controller = new AbortController();
    const credentials = vi.fn(() => ({ Authorization: "Bearer fixture-secret" }));
    const registered = Mcp.server({
      id: "support",
      revision: "v1",
      transport: { kind: "streamable-http", url, headers: credentials },
      authorizeConnect: () => true,
      tools: {
        lookup: {
          effect: "read",
          timeoutMs: 1_000,
          maxArgumentBytes: 1_024,
          maxResultBytes: 4_096,
          authorize: () => true,
        },
      },
    });
    const registry = AiRegistry.create({
      defaultModels: {},
      invocationLimits: limits,
      concurrentOperations: 1,
      queuedOperations: 0,
      hookTimeoutMs: 1_000,
    }).registerTools(registered);
    const backend = backendDefinition(
      VercelAx.model({
        ref: ModelRef.of("support-http", "v1"),
        capabilities: VercelAx.capabilities.openAIResponses(),
        resolveIdentity: () => ({
          provider: "fixture",
          account: "support",
          endpoint: url,
          model: "fixture-model",
        }),
        authorizeUse: () => true,
        connect: () => Promise.reject(new Error("No model connection expected")),
      }),
    );
    let sequence = 0;
    const host = {
      scope: {
        actor: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "support-user" }),
        }),
        tenant: { kind: "single-tenant" },
        agent: create(MessageIdSchema, {
          id: AnyMessages.pack(
            SupportReplyAgentIdSchema,
            create(SupportReplyAgentIdSchema, { ticketNumber: "T-1" }),
          ),
        }),
        source: create(MessageIdSchema, {
          id: AnyMessages.pack(
            CommandIdSchema,
            create(CommandIdSchema, { uuid: "fixture-command-1" }),
          ),
        }),
      },
      registry,
      backend,
      operation: create(AgentNamedOperationSchema, {
        callName: "draft",
        conversation: { value: "conversation-1" },
        operation: { value: "operation-1" },
      }),
      session: {} as AgentMcpHost["session"],
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      reserveMessage: vi.fn<AgentMcpHost["reserveMessage"]>((_server, request) => {
        observed.push(`reserve:${request.method}`);
        return Promise.resolve({
          id: `physical-${String(++sequence)}`,
          signal: controller.signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxOutputBytes: request.maxOutputBytes,
        });
      }),
      onReceived: vi.fn<AgentMcpHost["onReceived"]>((_id, bytes) => {
        observed.push(`received:${String(bytes)}`);
      }),
      finishMessage: vi.fn<AgentMcpHost["finishMessage"]>((_id, bytes) => {
        observed.push(`finish:${String(bytes)}`);
        return Promise.resolve();
      }),
      journalToolIntent: vi.fn<AgentMcpHost["journalToolIntent"]>(() => {
        observed.push("intent");
        return Promise.resolve({ kind: "new" as const, callId: "tool-call-1" });
      }),
      markToolDispatched: vi.fn<AgentMcpHost["markToolDispatched"]>(() => {
        observed.push("dispatched");
        return Promise.resolve();
      }),
      finishTool: vi.fn<AgentMcpHost["finishTool"]>(() => {
        observed.push("finish-tool");
        return Promise.resolve();
      }),
      recordFailure: vi.fn<AgentMcpHost["recordFailure"]>(() =>
        Promise.reject(new Error("Unexpected diagnostic")),
      ),
    } satisfies AgentMcpHost;
    const runtime = new AgentMcpRuntime(host, [{ server: "support", tool: "lookup" }]);
    try {
      const catalog = await runtime.prepare();
      expect(catalog).toMatchObject([
        { server: "support", tool: "lookup", description: "Read a support ticket" },
      ]);
      expect(catalog[0]?.inputSchemaJson).toContain('"ticket"');
      const result = await runtime.call({
        ticketId: "attempt-1",
        server: "support",
        tool: "lookup",
        argumentsJson: '{"ticket":"T-1"}',
        providerCallId: "provider-call-1",
      });
      expect(result).toMatchObject({ outcome: AiOutcome.ADMITTED, text: ["Ticket found"] });
      expect(observed.indexOf("intent")).toBeLessThan(observed.indexOf("remote:tools/call"));
      expect(observed.indexOf("dispatched")).toBeLessThan(observed.indexOf("remote:tools/call"));
      expect(observed).toContain("finish-tool");
      expect(credentials).toHaveBeenCalledOnce();
      expect(observed.join(" ")).not.toContain("fixture-secret");
      expect(host.finishMessage).toHaveBeenCalled();
      expect(host.onReceived).toHaveBeenCalled();
    } finally {
      await runtime.close();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
  }, 10_000);
});
