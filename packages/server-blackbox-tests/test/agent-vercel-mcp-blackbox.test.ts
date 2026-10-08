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

import { createServer, type Server } from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import { create } from "@bufbuild/protobuf";
import { AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";
import { AnyMessages } from "@spine-event-engine/core";
import {
  AiOutcome,
  GenerationRequestSchema,
  GenerationResponseSchema,
  ToolRequestSchema,
  ToolResponseSchema,
} from "@spine-event-engine/proto/agent";
import {
  BoundedContext,
  HandlerRegistryIngestor,
  Repository,
  type EntityHandlersMetadata,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { BlackBox } from "@spine-event-engine/testing";
import { describe, expect, it } from "vitest";
import { DraftRecoverySupportReplySchema } from "../generated/spine/server/testing/support_recovery_commands_pb.js";
import { SupportReplyDraftedSchema } from "../generated/spine/server/testing/support_agent_events_pb.js";
import { SupportRecoveryStateSchema } from "../generated/spine/server/testing/support_recovery_states_pb.js";
import { SupportReplyAgentIdSchema } from "../generated/spine/server/testing/support_agent_states_pb.js";
import { McpSupportAgent, mcpSupportModel } from "./fixtures/mcp-support-agent.js";

interface RpcRequest {
  readonly method: string;
  readonly id?: string | number;
}

/**
 * Encodes a bounded sequence of pinned OpenAI Responses events.
 */
const eventStream = (events: readonly object[]): string =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

/**
 * Supplies the first model tool proposal as a real Responses SSE body.
 */
const toolProposalStream = (): string =>
  eventStream([
    { type: "response.created", response: { id: "resp-1", created_at: 1, model: "fixture-model" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "function_call",
        id: "fc-1",
        call_id: "provider-call-1",
        name: "tool_0",
        arguments: '{"ticket":"T-47"}',
      },
    },
    {
      type: "response.function_call_arguments.done",
      item_id: "fc-1",
      output_index: 0,
      arguments: '{"ticket":"T-47"}',
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "function_call",
        id: "fc-1",
        call_id: "provider-call-1",
        name: "tool_0",
        arguments: '{"ticket":"T-47"}',
        status: "completed",
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp-1",
        status: "completed",
        usage: { input_tokens: 5, output_tokens: 3 },
      },
    },
  ]);

/**
 * Supplies an invalid proposal followed by the corrected typed reply.
 */
const replyStream = (requestNumber: number): string =>
  eventStream([
    {
      type: "response.created",
      response: {
        id: `resp-${String(requestNumber)}`,
        created_at: requestNumber,
        model: "fixture-model",
      },
    },
    {
      type: "response.output_text.delta",
      item_id: `msg-${String(requestNumber)}`,
      delta:
        requestNumber === 2 ? '{"replyText":""}' : '{"replyText":"Ticket found; we can help."}',
    },
    {
      type: "response.completed",
      response: {
        id: `resp-${String(requestNumber)}`,
        status: "completed",
        usage: { input_tokens: 8, output_tokens: 6 },
      },
    },
  ]);

/**
 * Starts local Responses and MCP endpoints without paid external access.
 */
const startEndpoints = async (invalidToolOutput = false) => {
  const methods: string[] = [];
  const providerBodies: unknown[] = [];
  const server: Server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk as Uint8Array);
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request.url === "/v1/responses") {
        providerBodies.push(body);
        response.setHeader("content-type", "text/event-stream");
        response.end(
          providerBodies.length === 1 ? toolProposalStream() : replyStream(providerBodies.length),
        );
        return;
      }
      const rpc = body as RpcRequest;
      methods.push(rpc.method);
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
                  description: "Look up a ticket",
                  inputSchema: {
                    type: "object",
                    properties: { ticket: { type: "string" } },
                    required: ["ticket"],
                    additionalProperties: false,
                  },
                  ...(invalidToolOutput
                    ? {
                        outputSchema: {
                          type: "object",
                          properties: { ticketNumber: { type: "string" } },
                          required: ["ticketNumber"],
                          additionalProperties: false,
                        },
                      }
                    : {}),
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
            result: invalidToolOutput
              ? {
                  content: [{ type: "text", text: "Ticket found" }],
                  structuredContent: { ticketNumber: 17 },
                  isError: false,
                }
              : { content: [{ type: "text", text: "Ticket found" }], isError: false },
          }),
        );
      else response.writeHead(202).end();
    })().catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  return { server, base: `http://127.0.0.1:${String(address.port)}`, methods, providerBodies };
};

/**
 * Builds a domain-correct support Agent repository for the typed MCP capability.
 */
const supportRepository = () =>
  new Repository({
    entityType: McpSupportAgent,
    schema: SupportRecoveryStateSchema,
    agentCodeRevision: "support-mcp-v1",
    ai: { models: [mcpSupportModel] },
    handlers: new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity",
          receiverType: McpSupportAgent,
          stateSchema: SupportRecoveryStateSchema,
          handlers: [
            {
              kind: "command-assignment",
              methodName: "draft",
              input: { schema: DraftRecoverySupportReplySchema, origin: "domestic" },
              outcomes: { returned: [SupportReplyDraftedSchema], thrown: [] },
              parameterCount: 1,
            },
          ],
        },
      ],
    })[0] as EntityHandlersMetadata<McpSupportAgent, typeof SupportRecoveryStateSchema>,
    events: [SupportReplyDraftedSchema],
  });

/**
 * Creates a real Agent with the local Responses and MCP endpoints.
 * @param base Local fixture address.
 * @returns BlackBox and repository for checking the persisted outcome.
 */
const supportBox = async (base: string) => {
  const identity = {
    provider: "openai",
    account: "fixture",
    endpoint: `${base}/v1`,
    model: "fixture-model",
  };
  const registration = VercelAx.model({
    ref: ModelRef.of("support-vercel", "v1"),
    capabilities: VercelAx.capabilities.openAIResponses(),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: (_scope, _expected, control) => ({
      model: createOpenAI({
        apiKey: "fixture-only",
        baseURL: identity.endpoint,
        fetch: control.fetch,
      }).responses(identity.model),
      identity,
    }),
  });
  const tools = Mcp.server({
    id: "knowledge",
    revision: "v1",
    transport: { kind: "streamable-http", url: `${base}/mcp` },
    authorizeConnect: () => true,
    tools: {
      lookup: {
        effect: "read",
        timeoutMs: 2_000,
        maxArgumentBytes: 1_024,
        maxResultBytes: 4_096,
        authorize: () => true,
      },
    },
  });
  const registry = AiRegistry.create({
    defaultModels: { generation: registration.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 3,
      toolCalls: 1,
      recordedReads: 0,
      deadlineMs: 10_000,
      totalInputBytes: 32_768,
      totalOutputBytes: 262_144,
      maxRecoveryBytes: 262_144,
    },
    concurrentOperations: 1,
    queuedOperations: 0,
    hookTimeoutMs: 2_000,
  })
    .register(registration)
    .registerTools(tools);
  const repository = supportRepository();
  const context = BoundedContext.singleTenant("RealVercelMcpSupport")
    .withAi(registry)
    .persistSystemEvents()
    .withStorageFactory(new InMemoryStorageFactory())
    .add(repository)
    .build();
  return { box: await BlackBox.from(context, { timeoutMs: 10_000 }), repository };
};

describe("Agent with real Vercel Responses and MCP transports", () => {
  it("does not admit malformed successful MCP structure or resume the model", async () => {
    const endpoint = await startEndpoints(true);
    const { box, repository } = await supportBox(endpoint.base);
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    try {
      const posted = await box
        .asGuest()
        .post(
          DraftRecoverySupportReplySchema,
          create(DraftRecoverySupportReplySchema, { agent: id, question: "Where is my order?" }),
        );
      expect(posted.kind).toBe("ok");
      await box.eventually(
        () => box.readAgentHistory(repository, id, { pageSize: 30 }),
        (page) =>
          page.items.some((entry) => {
            if (entry.item.case !== "conversationRecord") return false;
            return (
              entry.item.value.content !== undefined &&
              AnyMessages.unpack(entry.item.value.content, ToolResponseSchema) !== undefined
            );
          }),
      );
      const page = await box.readAgentHistory(repository, id, { pageSize: 30 });
      const toolResponses = page.items.flatMap((entry) => {
        if (entry.item.case !== "conversationRecord" || !entry.item.value.content) return [];
        const response = AnyMessages.unpack(entry.item.value.content, ToolResponseSchema);
        return response ? [response] : [];
      });
      expect(toolResponses).toHaveLength(1);
      expect(toolResponses[0]?.outcome).not.toBe(AiOutcome.ADMITTED);
      expect(endpoint.methods.filter((method) => method === "tools/call")).toHaveLength(1);
      expect(endpoint.providerBodies).toHaveLength(1);
      expect(box.assertEvents()).toEqual([]);
    } finally {
      await box.close();
      await new Promise<void>((resolve) => {
        endpoint.server.close(() => {
          resolve();
        });
      });
    }
  }, 20_000);

  it("persists tool use and a corrected reply through real provider and MCP requests", async () => {
    const endpoint = await startEndpoints();
    const identity = {
      provider: "openai",
      account: "fixture",
      endpoint: `${endpoint.base}/v1`,
      model: "fixture-model",
    };
    const registration = VercelAx.model({
      ref: ModelRef.of("support-vercel", "v1"),
      capabilities: VercelAx.capabilities.openAIResponses(),
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect: (_scope, _expected, control) => ({
        model: createOpenAI({
          apiKey: "fixture-only",
          baseURL: identity.endpoint,
          fetch: control.fetch,
        }).responses(identity.model),
        identity,
      }),
    });
    const tools = Mcp.server({
      id: "knowledge",
      revision: "v1",
      transport: { kind: "streamable-http", url: `${endpoint.base}/mcp` },
      authorizeConnect: () => true,
      tools: {
        lookup: {
          effect: "read",
          timeoutMs: 2_000,
          maxArgumentBytes: 1_024,
          maxResultBytes: 4_096,
          authorize: () => true,
        },
      },
    });
    const registry = AiRegistry.create({
      defaultModels: { generation: registration.ref },
      invocationLimits: {
        operations: 1,
        modelRequests: 3,
        toolCalls: 1,
        recordedReads: 0,
        deadlineMs: 10_000,
        totalInputBytes: 32_768,
        totalOutputBytes: 262_144,
        maxRecoveryBytes: 262_144,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
      hookTimeoutMs: 2_000,
    })
      .register(registration)
      .registerTools(tools);
    const repository = supportRepository();
    const context = BoundedContext.singleTenant("RealVercelMcpSupport")
      .withAi(registry)
      .persistSystemEvents()
      .withStorageFactory(new InMemoryStorageFactory())
      .add(repository)
      .build();
    const box = await BlackBox.from(context, { timeoutMs: 10_000 });
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
    try {
      const posted = await box
        .asGuest()
        .post(
          DraftRecoverySupportReplySchema,
          create(DraftRecoverySupportReplySchema, { agent: id, question: "Where is my order?" }),
        );
      expect(posted.kind).toBe("ok");
      const events = await box.eventually(
        () => box.assertEvents(),
        (items) => items.length === 1,
      );
      const published = events[0]?.message;
      if (!published) throw new Error("Expected drafted reply event");
      expect(AnyMessages.unpack(published, SupportReplyDraftedSchema)?.reply).toBe(
        "Ticket found; we can help.",
      );
      expect(endpoint.providerBodies).toHaveLength(3);
      expect(JSON.stringify(endpoint.providerBodies[0])).toContain('"name":"tool_0"');
      expect(JSON.stringify(endpoint.providerBodies[1])).toContain('"type":"function_call_output"');
      expect(JSON.stringify(endpoint.providerBodies[1])).toContain("Ticket found");
      expect(JSON.stringify(endpoint.providerBodies[2])).toContain("replyText");
      const page = await box.readAgentHistory(repository, id, { pageSize: 30 });
      const content = page.items.flatMap((entry) =>
        entry.item.case === "conversationRecord" && entry.item.value.content
          ? [entry.item.value.content]
          : [],
      );
      const requests = content.flatMap((item) => {
        const value = AnyMessages.unpack(item, GenerationRequestSchema);
        return value ? [value] : [];
      });
      expect(requests).toHaveLength(3);
      expect(requests[0]?.corrects?.value).toBeTruthy();
      expect(requests[2]?.corrects).toBeUndefined();
      const responses = content.flatMap((item) => {
        const value = AnyMessages.unpack(item, GenerationResponseSchema);
        return value ? [value] : [];
      });
      expect(endpoint.methods.filter((method) => method === "tools/call")).toHaveLength(1);
      expect(responses.map((response) => response.outcome)).toEqual([
        AiOutcome.ADMITTED,
        AiOutcome.INVALID_OUTPUT,
        AiOutcome.TOOL_REQUESTED,
      ]);
      expect(
        content.flatMap((item) => AnyMessages.unpack(item, ToolRequestSchema) ?? []),
      ).toHaveLength(1);
      expect(
        content.flatMap((item) => AnyMessages.unpack(item, ToolResponseSchema) ?? []),
      ).toMatchObject([{ outcome: AiOutcome.ADMITTED, text: ["Ticket found"] }]);
    } finally {
      await box.close();
      await new Promise<void>((resolve) =>
        endpoint.server.close(() => {
          resolve();
        }),
      );
    }
  }, 20_000);
});
