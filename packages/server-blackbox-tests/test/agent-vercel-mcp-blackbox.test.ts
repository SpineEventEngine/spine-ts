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
import { createAnthropic } from "@ai-sdk/anthropic";
import { create } from "@bufbuild/protobuf";
import { AiRegistry, Mcp, ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";
import { AnyMessages } from "@spine-event-engine/core";
import {
  AiOutcome,
  AiFailureCode,
  AgentAiOperationFailedSchema,
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
import {
  ChatgptPlanSupportAgent,
  chatgptPlanSupportModel,
  McpSupportAgent,
  mcpSupportModel,
} from "./fixtures/mcp-support-agent.js";

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
 * Supplies exact ordered Responses items for the subscription fixture.
 *
 * @param requestNumber Physical request position.
 * @returns Bounded Responses SSE fixture.
 */
const chatgptPlanStream = (requestNumber: number): string => {
  const tool = requestNumber === 1;
  const text =
    requestNumber === 2 ? '{"replyText":""}' : '{"replyText":"Ticket found; we can help."}';
  const reasoning = {
    type: "reasoning",
    id: `reason-${String(requestNumber)}`,
    encrypted_content: `encrypted-${String(requestNumber)}`,
    summary: [
      { type: "summary_text", text: "first" },
      { type: "summary_text", text: "second" },
    ],
  };
  const result = tool
    ? {
        type: "function_call",
        id: "fc-1",
        call_id: "provider-call-1",
        name: "tool_0",
        namespace: "spine_mcp",
        arguments: '{"ticket":"T-47"}',
        status: "completed",
      }
    : {
        type: "message",
        role: "assistant",
        id: `msg-${String(requestNumber)}`,
        phase: "final_answer",
        content: [{ type: "output_text", text, annotations: [] }],
      };
  return eventStream([
    {
      type: "response.created",
      response: {
        id: `resp-${String(requestNumber)}`,
        created_at: requestNumber,
        model: "fixture-model",
      },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "reasoning", id: reasoning.id },
    },
    { type: "response.output_item.done", output_index: 0, item: reasoning },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: {
        type: result.type,
        id: result.id,
        ...(tool
          ? {
              call_id: "provider-call-1",
              name: "tool_0",
              arguments: '{"ticket":"T-47"}',
              namespace: "spine_mcp",
            }
          : {}),
      },
    },
    ...(tool
      ? [
          {
            type: "response.function_call_arguments.done",
            item_id: "fc-1",
            output_index: 1,
            arguments: '{"ticket":"T-47"}',
          },
        ]
      : [
          {
            type: "response.output_text.delta",
            item_id: result.id,
            output_index: 1,
            content_index: 0,
            delta: text,
          },
        ]),
    { type: "response.output_item.done", output_index: 1, item: result },
    {
      type: "response.completed",
      response: {
        id: `resp-${String(requestNumber)}`,
        status: "completed",
        usage: { input_tokens: 8, output_tokens: 6 },
      },
    },
  ]);
};

/**
 * Encodes a real Anthropic Messages stream with a typed tool proposal.
 * @param requestNumber Physical provider request sequence.
 * @returns Anthropic SSE for the selected support step.
 */
const anthropicStream = (
  requestNumber: number,
  thinking: false | "signed" | "redacted" = false,
): string => {
  const tool = requestNumber === 1;
  const index = thinking ? 1 : 0;
  const text =
    requestNumber === 2 ? '{"replyText":""}' : '{"replyText":"Ticket found; we can help."}';
  const events = [
    {
      type: "message_start",
      message: {
        id: `msg-${String(requestNumber)}`,
        type: "message",
        role: "assistant",
        model: "claude-fable-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    },
    ...(thinking
      ? [
          {
            type: "content_block_start",
            index: 0,
            content_block:
              thinking === "redacted"
                ? { type: "redacted_thinking", data: "opaque-fixture-thought" }
                : { type: "thinking", thinking: "" },
          },
          ...(thinking === "signed"
            ? [
                {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "thinking_delta", thinking: "Check the ticket first." },
                },
                {
                  type: "content_block_delta",
                  index: 0,
                  delta: {
                    type: "signature_delta",
                    signature: `signed-fixture-thought-${String(requestNumber)}`,
                  },
                },
              ]
            : []),
          { type: "content_block_stop", index: 0 },
        ]
      : []),
    ...(tool
      ? [
          {
            type: "content_block_start",
            index,
            content_block: { type: "tool_use", id: "provider-call-1", name: "tool_0", input: {} },
          },
          {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: '{"ticket":"T-47"}' },
          },
        ]
      : [
          { type: "content_block_start", index, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index, delta: { type: "text_delta", text } },
        ]),
    { type: "content_block_stop", index },
    {
      type: "message_delta",
      delta: { stop_reason: tool ? "tool_use" : "end_turn" },
      usage: { output_tokens: 3 },
    },
    { type: "message_stop" },
  ];
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
};

/**
 * Starts local Responses and MCP endpoints without paid external access.
 */
const startEndpoints = async (
  invalidToolOutput = false,
  thinking: false | "signed" | "redacted" = false,
  chatgptPlan = false,
  unsupportedSchema?: "input" | "output",
) => {
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
          chatgptPlan
            ? chatgptPlanStream(providerBodies.length)
            : providerBodies.length === 1
              ? toolProposalStream()
              : replyStream(providerBodies.length),
        );
        return;
      }
      if (request.url === "/v1/messages") {
        providerBodies.push(body);
        response.setHeader("content-type", "text/event-stream");
        response.end(anthropicStream(providerBodies.length, thinking));
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
                  inputSchema:
                    unsupportedSchema === "input"
                      ? { $ref: "https://unsupported.example/schema" }
                      : {
                          type: "object",
                          properties: { ticket: { type: "string" } },
                          required: ["ticket"],
                          additionalProperties: false,
                        },
                  ...(unsupportedSchema === "output"
                    ? { outputSchema: { type: "string" } }
                    : invalidToolOutput
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
const supportRepository = (chatgptPlan = false) =>
  new Repository({
    entityType: chatgptPlan ? ChatgptPlanSupportAgent : McpSupportAgent,
    schema: SupportRecoveryStateSchema,
    agentCodeRevision: "support-mcp-v1",
    ai: { models: [chatgptPlan ? chatgptPlanSupportModel : mcpSupportModel] },
    handlers: new HandlerRegistryIngestor().ingest({
      receivers: [
        {
          receiverKind: "entity",
          receiverType: chatgptPlan ? ChatgptPlanSupportAgent : McpSupportAgent,
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
const supportBox = async (
  base: string,
  provider: "openai" | "anthropic" | "chatgpt-plan" = "openai",
) => {
  const identity = {
    provider,
    account: "fixture",
    endpoint: `${base}/v1`,
    model: provider === "anthropic" ? "claude-fable-5" : "fixture-model",
  };
  const registrationOptions: Parameters<typeof VercelAx.model>[0] = {
    ref: ModelRef.of("support-vercel", "v1"),
    capabilities:
      provider === "anthropic"
        ? VercelAx.capabilities.anthropicMessages()
        : VercelAx.capabilities.openAIResponses(),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: (_scope, _expected, control) => ({
      model:
        provider === "anthropic"
          ? createAnthropic({
              apiKey: "fixture-only",
              baseURL: identity.endpoint,
              fetch: control.fetch,
            }).messages(identity.model)
          : createOpenAI({
              apiKey: "fixture-only",
              baseURL: identity.endpoint,
              fetch: control.fetch,
            }).responses(identity.model),
      identity,
    }),
  };
  const registration =
    provider === "chatgpt-plan"
      ? VercelAx.chatgptPlanModel({
          ref: registrationOptions.ref,
          resolveIdentity: registrationOptions.resolveIdentity,
          authorizeUse: registrationOptions.authorizeUse,
          connect: () => ({ accessToken: "fixture-only", identity }),
        })
      : VercelAx.model(registrationOptions);
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
  const repository = supportRepository(provider === "chatgpt-plan");
  const context = BoundedContext.singleTenant("RealVercelMcpSupport")
    .withAi(registry)
    .persistSystemEvents()
    .withStorageFactory(new InMemoryStorageFactory())
    .add(repository)
    .build();
  return { box: await BlackBox.from(context, { timeoutMs: 10_000 }), repository };
};

describe("Agent with real Vercel Responses and MCP transports", () => {
  it.each(["input", "output"] as const)(
    "records unsupported %s tool schema before provider inference",
    async (schema) => {
      const endpoint = await startEndpoints(false, false, true, schema);
      const { box, repository } = await supportBox(endpoint.base, "chatgpt-plan");
      const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-47" });
      try {
        expect(
          (
            await box
              .asGuest()
              .post(
                DraftRecoverySupportReplySchema,
                create(DraftRecoverySupportReplySchema, { agent: id, question: "Status?" }),
              )
          ).kind,
        ).toBe("ok");
        const failures = await box.eventually(
          async () => {
            const page = await box.readAgentHistory(repository, id, { pageSize: 30 });
            return page.items.flatMap((entry) => {
              if (entry.item.case !== "systemEvent" || !entry.item.value.message) return [];
              const event = AnyMessages.unpack(
                entry.item.value.message,
                AgentAiOperationFailedSchema,
              );
              return event ? [event] : [];
            });
          },
          (events) => events.length === 1,
        );
        expect(failures[0]).toMatchObject({
          failure: AiFailureCode.UNSUPPORTED_CAPABILITY,
          outcome: AiOutcome.FAILED,
        });
        expect(failures[0]?.operation?.operation?.value).toBeTruthy();
        expect(failures[0]?.diagnosticId?.value).toBeTruthy();
        expect(endpoint.methods).toContain("tools/list");
        expect(endpoint.methods).not.toContain("tools/call");
        expect(endpoint.providerBodies).toEqual([]);
        expect(box.assertEvents()).toEqual([]);
      } finally {
        await box.close();
        await new Promise<void>((resolve) =>
          endpoint.server.close(() => {
            resolve();
          }),
        );
      }
    },
    20_000,
  );

  it("uses the ChatGPT plan profile through Agent with recorded tool and correction attempts", async () => {
    const endpoint = await startEndpoints(false, false, true);
    const { box, repository } = await supportBox(endpoint.base, "chatgpt-plan");
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
        () => box.assertEvents(),
        (events) => events.length === 1,
      );
      expect(endpoint.providerBodies).toHaveLength(3);
      const initial = endpoint.providerBodies[0] as Record<string, unknown>;
      expect(initial).toMatchObject({ store: false, stream: true });
      expect(initial).not.toHaveProperty("max_output_tokens");
      expect(JSON.stringify(initial.tools)).toContain('"type":"namespace"');
      const continued = JSON.stringify((endpoint.providerBodies[1] as { input: unknown }).input);
      expect(continued).toContain('"encrypted_content":"encrypted-1"');
      expect(continued).toContain('"call_id":"provider-call-1"');
      expect(continued).toContain('"type":"function_call_output"');
      const page = await box.readAgentHistory(repository, id, { pageSize: 30 });
      const responses = page.items.flatMap((entry) => {
        if (entry.item.case !== "conversationRecord" || !entry.item.value.content) return [];
        const value = AnyMessages.unpack(entry.item.value.content, GenerationResponseSchema);
        return value ? [value] : [];
      });
      expect(responses.map((response) => response.outcome)).toEqual([
        AiOutcome.ADMITTED,
        AiOutcome.INVALID_OUTPUT,
        AiOutcome.TOOL_REQUESTED,
      ]);
      expect(responses[2]?.openaiContent?.items).toHaveLength(2);
      expect(
        JSON.stringify(page, (_key, value: unknown) =>
          typeof value === "bigint" ? String(value) : value,
        ),
      ).not.toContain("fixture-only");
      expect(endpoint.methods.filter((method) => method === "tools/call")).toHaveLength(1);
    } finally {
      await box.close();
      await new Promise<void>((resolve) =>
        endpoint.server.close(() => {
          resolve();
        }),
      );
    }
  }, 20_000);
  it.each([
    ["signed", '"type":"thinking"', '"signature":"signed-fixture-thought-1"'],
    ["redacted", '"type":"redacted_thinking"', '"data":"opaque-fixture-thought"'],
  ] as const)(
    "returns %s Anthropic thinking with a tool result in the same turn",
    async (kind, block, detail) => {
      const endpoint = await startEndpoints(false, kind);
      const { box } = await supportBox(endpoint.base, "anthropic");
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
          () => box.assertEvents(),
          (events) => events.length === 1,
        );
        const continuation = JSON.stringify(endpoint.providerBodies[1]);
        expect(continuation).toContain(block);
        expect(continuation).toContain(detail);
        expect(continuation).toContain('"type":"tool_result"');
        const correction = JSON.stringify(endpoint.providerBodies[2]);
        expect(correction).toContain(
          kind === "signed" ? '"signature":"signed-fixture-thought-2"' : detail,
        );
      } finally {
        await box.close();
        await new Promise<void>((resolve) =>
          endpoint.server.close(() => {
            resolve();
          }),
        );
      }
    },
    20_000,
  );

  it("persists Anthropic tool use, correction, and the drafted domain event", async () => {
    const endpoint = await startEndpoints();
    const { box, repository } = await supportBox(endpoint.base, "anthropic");
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
      expect(JSON.stringify(endpoint.providerBodies[1])).toContain('"type":"tool_result"');
      expect(JSON.stringify(endpoint.providerBodies[1])).toContain("provider-call-1");
      expect(endpoint.methods.filter((method) => method === "tools/call")).toHaveLength(1);
      const page = await box.readAgentHistory(repository, id, { pageSize: 30 });
      const content = page.items.flatMap((entry) =>
        entry.item.case === "conversationRecord" && entry.item.value.content
          ? [entry.item.value.content]
          : [],
      );
      const responses = content.flatMap((item) => {
        const response = AnyMessages.unpack(item, GenerationResponseSchema);
        return response ? [response] : [];
      });
      expect(responses.map((response) => response.outcome)).toEqual([
        AiOutcome.ADMITTED,
        AiOutcome.INVALID_OUTPUT,
        AiOutcome.TOOL_REQUESTED,
      ]);
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
