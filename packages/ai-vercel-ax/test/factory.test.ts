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

import { AiModel, ModelRef, type AiFailure, type AiModelDefinition } from "@spine-event-engine/ai";
import { AnyMessages, type MessageSchema } from "@spine-event-engine/core";
import { backendDefinition } from "@spine-event-engine/ai/spi/adapter";
import type {
  AiBackendExecution,
  AiExecutionControl,
  AiMcpAdvertisedTool,
} from "@spine-event-engine/ai/spi/adapter";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AiOperationIdSchema,
  AiToolCallIdSchema,
  AiUsageSchema,
  AiOutcome,
  DecisionResponseSchema,
  GenerationResponseSchema,
  AnthropicAssistantContentSchema,
  ToolResponseSchema,
} from "@spine-event-engine/proto/agent";
import {
  ProposedSupportReplySchema,
  SupportRoutingResultSchema,
  SupportTicketFactsSchema,
  SupportTicketNumberSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_ai_types_pb.js";
import { describe, expect, it, vi } from "vitest";
import {
  VercelAx,
  VercelDecision,
  providerConnection,
  type VercelConnectControl,
  type VercelDecisionModel,
} from "../src/adapter/factory.js";

const identity = {
  provider: "openai",
  account: "account-a",
  endpoint: "https://provider.example/v1",
  model: "test-model",
};

const scope = {} as Parameters<ReturnType<typeof backendDefinition>["resolveIdentity"]>[0];

const advertisedLookup = Object.freeze({
  server: "support",
  tool: "lookup",
  description: "Lookup a support ticket",
  inputSchemaJson:
    '{"additionalProperties":false,"properties":{"ticket":{"type":"string"}},' +
    '"required":["ticket"],"type":"object"}',
});

const sdkUsage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: undefined, reasoning: undefined },
});

const unknownUsage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

function control(): AiExecutionControl {
  return {
    signal: new AbortController().signal,
    deadlineEpochMs: 1_000,
    nowEpochMs: () => 100,
    hasAuthority: () => true,
    beginAttempt: vi.fn(),
    reserveTransport: vi.fn(),
    onReceived: vi.fn(),
    finishAttempt: vi.fn(),
    recordFailure: vi.fn((code: AiFailure["code"], retryableByNewSignal: boolean) =>
      Promise.resolve({
        code,
        retryableByNewSignal,
        diagnosticId: "diagnostic-1",
      }),
    ),
    admitGeneration: vi.fn(),
    admitDecision: vi.fn(),
    callTool: vi.fn(),
  };
}

// Erases only the typed descriptor parameters when entering the nongeneric backend SPI.
// Each capability retains its generated input/output schemas and is validated by AiModel.define.
const executionDefinition = <I extends MessageSchema, O extends MessageSchema>(
  definition: Readonly<AiModelDefinition<I, O>>,
): AiBackendExecution["definition"] => definition as AiBackendExecution["definition"];

function generationFixture(
  streams: readonly (readonly LanguageModelV3StreamPart[])[],
  maxRequests = streams.length,
  withTool = false,
  provider: "openai" | "anthropic" = "openai",
  modelId = "claude-sonnet-4-5",
  outputMode: "native-schema" | "prompt-and-validate" = "native-schema",
) {
  let scopedFetch!: typeof fetch;
  let nextStream = 0;
  const providerCalls: LanguageModelV3CallOptions[] = [];
  const network = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
  const selectedIdentity =
    provider === "anthropic" ? { ...identity, provider, model: modelId } : identity;
  const model = new MockLanguageModelV3({
    modelId: selectedIdentity.model,
    doStream: async (options) => {
      providerCalls.push(options);
      await (
        await scopedFetch(
          `https://provider.example/v1/${provider === "anthropic" ? "messages" : "responses"}`,
          {
            method: "POST",
            body: "{}",
          },
        )
      ).text();
      const parts = streams[nextStream++] ?? [];
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
  const registration = VercelAx.model({
    ref: ModelRef.of("draft-support-reply", "r1"),
    capabilities:
      provider === "anthropic"
        ? VercelAx.capabilities.anthropicMessages()
        : VercelAx.capabilities.openAIResponses(),
    platformFetch: network,
    resolveIdentity: () => selectedIdentity,
    authorizeUse: () => true,
    connect: (_scope, _expected, runtime) => {
      scopedFetch = runtime.fetch;
      return { model, identity: selectedIdentity };
    },
  });
  const definition = executionDefinition(
    AiModel.define({
      name: "draft-support-reply",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a reply",
      outputMode,
      ...(withTool ? { tools: [{ server: "support", tool: "lookup" }] } : {}),
      limits: {
        modelRequests: maxRequests,
        toolCalls: withTool ? 1 : 0,
        deadlineMs: 900,
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        maxOutputTokens: 100,
      },
    }).definition,
  );
  const runtime = control();
  vi.mocked(runtime.beginAttempt).mockImplementation(() =>
    Promise.resolve({
      id: `attempt-${String(vi.mocked(runtime.beginAttempt).mock.calls.length)}`,
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 1000,
      signal: runtime.signal,
    }),
  );
  const run = async (
    advertisedTools: readonly AiMcpAdvertisedTool[] = withTool ? [advertisedLookup] : [],
  ) => {
    const selected = await backendDefinition(registration).connect(
      scope,
      selectedIdentity,
      runtime,
    );
    return backendDefinition(registration).execute({
      operationId: create(AiOperationIdSchema, { value: "generation-case" }),
      call: "support-request",
      scope,
      identity: selectedIdentity,
      model: selected.model,
      definition,
      advertisedTools,
      input: create(SupportTicketFactsSchema, {
        ticketNumber: { value: "T-1" },
        customerQuestion: "When will my order arrive?",
      }),
      control: runtime,
    });
  };
  return { run, runtime, model, network, registration, providerCalls };
}

const anthropicEvents = (text: string, stopReason = "end_turn") =>
  [
    {
      type: "message_start",
      message: {
        id: "msg-fixture",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 4,
          output_tokens: 0,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");

const anthropicToolEvents = () =>
  [
    {
      type: "message_start",
      message: {
        id: "msg-tool",
        type: "message",
        role: "assistant",
        model: "claude-fable-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 4, output_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "signed-native" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "provider-call-1", name: "tool_0", input: {} },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"ticket":"T-1"}' },
    },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");

const nativeAnthropicIds = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5",
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-fable-5",
  "claude-fable-5-1",
] as const;

function realAnthropicFixture(
  wire: string | readonly string[],
  outputMode: "native-schema" | "prompt-and-validate" = "native-schema",
  modelId = "claude-sonnet-4-5",
  settings: {
    signal?: AbortSignal;
    maxOutputBytes?: number;
    authToken?: string;
    withTool?: boolean;
  } = {},
) {
  const selectedIdentity = { ...identity, provider: "anthropic", model: modelId };
  let wireIndex = 0;
  const network = vi.fn<typeof fetch>().mockImplementation(() =>
    Promise.resolve(
      new Response(typeof wire === "string" ? wire : (wire[wireIndex++] ?? ""), {
        headers: { "content-type": "text/event-stream" },
      }),
    ),
  );
  const registration = VercelAx.model({
    ref: ModelRef.of("draft-support-reply", "r1"),
    capabilities: VercelAx.capabilities.anthropicMessages(),
    platformFetch: network,
    resolveIdentity: () => selectedIdentity,
    authorizeUse: () => true,
    connect: (_scope, _expected, runtime) => ({
      model: createAnthropic({
        ...(settings.authToken ? { authToken: settings.authToken } : { apiKey: "fixture-only" }),
        baseURL: selectedIdentity.endpoint,
        fetch: runtime.fetch,
      }).messages(modelId),
      identity: selectedIdentity,
    }),
  });
  const definition = executionDefinition(
    AiModel.define({
      name: "draft-support-reply",
      version: "v1",
      kind: "generation",
      input: SupportTicketFactsSchema,
      output: ProposedSupportReplySchema,
      instructions: "Draft a reply",
      outputMode,
      ...(settings.withTool ? { tools: [{ server: "support", tool: "lookup" }] } : {}),
      limits: {
        modelRequests: settings.withTool ? 2 : 1,
        toolCalls: settings.withTool ? 1 : 0,
        deadlineMs: 900,
        maxInputBytes: settings.withTool ? 8000 : 2000,
        maxOutputBytes: 4000,
        maxOutputTokens: 100,
      },
    }).definition,
  );
  const runtime = { ...control(), ...(settings.signal ? { signal: settings.signal } : {}) };
  vi.mocked(runtime.beginAttempt).mockImplementation(() =>
    Promise.resolve({
      id: `anthropic-attempt-${String(vi.mocked(runtime.beginAttempt).mock.calls.length)}`,
      maxInputBytes: settings.withTool ? 8000 : 2000,
      maxOutputBytes: settings.maxOutputBytes ?? 4000,
      deadlineEpochMs: 1000,
      signal: runtime.signal,
    }),
  );
  const run = async () => {
    const selected = await backendDefinition(registration).connect(
      scope,
      selectedIdentity,
      runtime,
    );
    return backendDefinition(registration).execute({
      operationId: create(AiOperationIdSchema, { value: "anthropic-operation" }),
      call: "support-request",
      scope,
      identity: selectedIdentity,
      model: selected.model,
      definition,
      ...(settings.withTool ? { advertisedTools: [advertisedLookup] } : {}),
      input: create(SupportTicketFactsSchema, {
        ticketNumber: { value: "T-1" },
        customerQuestion: "Where is my order?",
      }),
      control: runtime,
    });
  };
  return { run, runtime, network };
}

function decisionFixture(model: VercelDecisionModel) {
  const registration = VercelDecision.model({
    ref: ModelRef.of("support-safety", "r1"),
    capabilities: VercelDecision.capabilities.openRouterJev(),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: () => ({ model, identity }),
  });
  const definition = executionDefinition(
    AiModel.define({
      name: "support-safety",
      version: "v1",
      kind: "decision",
      input: SupportTicketFactsSchema,
      output: SupportRoutingResultSchema,
      limits: {
        modelRequests: 1,
        toolCalls: 0,
        deadlineMs: 900,
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
      },
      questions: { safe: { type: "boolean", instructions: "Is this safe?" } },
      mapping: {
        version: "v1",
        toMessage: () => create(SupportRoutingResultSchema, { queue: { value: "tier-one" } }),
      },
    }).definition,
  );
  const runtime = control();
  vi.mocked(runtime.beginAttempt).mockResolvedValue({
    id: "decision-scripted",
    maxInputBytes: 2000,
    maxOutputBytes: 2000,
    deadlineEpochMs: 1000,
    signal: runtime.signal,
  });
  vi.mocked(runtime.admitDecision).mockReturnValue({
    ok: true,
    value: create(SupportRoutingResultSchema, { queue: { value: "tier-one" } }),
  });
  const run = async (override = runtime) => {
    const selected = await backendDefinition(registration).connect(scope, identity, override);
    return backendDefinition(registration).execute({
      operationId: create(AiOperationIdSchema, { value: "decision-scripted-op" }),
      call: "support-request",
      scope,
      identity,
      model: selected.model,
      definition,
      input: create(SupportTicketFactsSchema, {
        ticketNumber: { value: "T-9" },
        customerQuestion: "Is this allowed?",
      }),
      control: override,
    });
  };
  return { run, runtime, registration, definition };
}

describe("Vercel connection registration", () => {
  it("registers the pinned Anthropic Messages route as a generation provider", () => {
    const capabilities = VercelAx.capabilities.anthropicMessages();
    const anthropicIdentity = { ...identity, provider: "anthropic", model: "claude-sonnet-4-5" };
    expect(capabilities).toMatchObject({
      id: "anthropic-messages-v1",
      routeSuffix: "/messages",
      providerProtocol: "anthropic-messages-stream-v1",
      outputContract: "native-json-or-prompt-validate-v1",
      retryContract: "one-provider-call-per-ticket-v1",
    });
    expect(() =>
      VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities,
        resolveIdentity: () => anthropicIdentity,
        authorizeUse: () => true,
        connect: () => ({
          model: new MockLanguageModelV3({ modelId: anthropicIdentity.model }),
          identity: anthropicIdentity,
        }),
      }),
    ).not.toThrow();
    expect(() =>
      VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities: { ...capabilities, routeSuffix: "/responses" },
        resolveIdentity: () => anthropicIdentity,
        authorizeUse: () => true,
        connect: () => ({
          model: new MockLanguageModelV3({ modelId: anthropicIdentity.model }),
          identity: anthropicIdentity,
        }),
      }),
    ).toThrow("capabilities");
  });

  it("rejects an Anthropic model that differs from the authorized identity", async () => {
    const selectedIdentity = { ...identity, provider: "anthropic", model: "claude-sonnet-4-5" };
    const network = vi.fn<typeof fetch>();
    const registration = VercelAx.model({
      ref: ModelRef.of("draft-support-reply", "r1"),
      capabilities: VercelAx.capabilities.anthropicMessages(),
      platformFetch: network,
      resolveIdentity: () => selectedIdentity,
      authorizeUse: () => true,
      connect: () => ({
        model: new MockLanguageModelV3({ modelId: "different-model" }),
        identity: selectedIdentity,
      }),
    });
    await expect(
      backendDefinition(registration).connect(scope, selectedIdentity, control()),
    ).rejects.toThrow("model identity changed");
    expect(network).not.toHaveBeenCalled();
  });

  it("forces native Anthropic output format without a JSON tool fallback", async () => {
    const fixture = generationFixture(
      [
        [
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: '{"replyText":"Hello"}' },
          { type: "text-end", id: "text" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "end_turn" },
            usage: sdkUsage(3, 2),
          },
        ],
      ],
      1,
      false,
      "anthropic",
    );
    vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
      ok: true,
      value: create(ProposedSupportReplySchema, { replyText: "Hello" }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true });
    expect(fixture.providerCalls).toHaveLength(1);
    expect(fixture.providerCalls[0]).toMatchObject({
      responseFormat: { type: "json" },
      providerOptions: { anthropic: { structuredOutputMode: "outputFormat" } },
    });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    const response = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response;
    expect(response).toMatchObject({ outcome: AiOutcome.ADMITTED });
    if (response?.$typeName !== "spine.ts.agent.GenerationResponse")
      throw new Error("Expected generation response");
    expect(response.actualModel).toBeUndefined();
  });

  it.each(["claude-3-haiku-20240307", "claude-sonnet-4-5-unlisted", "unknown-future-model"])(
    "rejects unsupported Anthropic native model %s before an attempt",
    async (modelId) => {
      const fixture = generationFixture([], 1, false, "anthropic", modelId);
      await expect(fixture.run()).resolves.toMatchObject({
        ok: false,
        failure: { code: "UNSUPPORTED_CAPABILITY" },
      });
      expect(fixture.runtime.beginAttempt).not.toHaveBeenCalled();
      expect(fixture.network).not.toHaveBeenCalled();
    },
  );

  it("allows an older Anthropic model through prompt validation", async () => {
    const fixture = generationFixture(
      [
        [
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: '{"replyText":"Hello"}' },
          { type: "text-end", id: "text" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "end_turn" },
            usage: sdkUsage(1, 1),
          },
        ],
      ],
      1,
      false,
      "anthropic",
      "claude-3-haiku-20240307",
      "prompt-and-validate",
    );
    vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
      ok: true,
      value: create(ProposedSupportReplySchema, { replyText: "Hello" }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true });
    expect(fixture.providerCalls[0]?.responseFormat).toEqual({ type: "text" });
    expect(fixture.providerCalls[0]?.providerOptions).toBeUndefined();
    const attempt = vi.mocked(fixture.runtime.beginAttempt).mock.calls[0]?.[0];
    if (attempt?.kind !== "generation") throw new Error("Expected generation request");
    expect(JSON.parse(attempt.content.promptJson)).toMatchObject({
      provider: {
        profile: "anthropic-messages-v1",
        lowering: "anthropic-4.0.72-v2",
        outputMode: "prompt-and-validate",
        providerOptions: null,
      },
    });
  });

  it.each(nativeAnthropicIds)(
    "journals native Anthropic SSE model %s with a real SDK request",
    async (modelId) => {
      const fixture = realAnthropicFixture(
        anthropicEvents('{"replyText":"Hello"}'),
        "native-schema",
        modelId,
      );
      vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
        ok: true,
        value: create(ProposedSupportReplySchema, { replyText: "Hello" }),
      });
      await expect(fixture.run()).resolves.toMatchObject({ ok: true });
      expect(fixture.network).toHaveBeenCalledTimes(1);
      const [url, init] = vi.mocked(fixture.network).mock.calls[0] ?? [];
      expect(url).toBe("https://provider.example/v1/messages");
      const body: unknown = JSON.parse(
        typeof init?.body === "string"
          ? init.body
          : Buffer.from(init?.body as Uint8Array).toString("utf8"),
      );
      expect(body).toMatchObject({
        model: modelId,
        stream: true,
        output_config: { format: { type: "json_schema" } },
      });
      expect(JSON.stringify(body)).not.toContain('"name":"json"');
      const completion = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0];
      expect(completion?.response).toMatchObject({
        outcome: AiOutcome.ADMITTED,
        rawOutput: '{"replyText":"Hello"}',
        actualModel: { value: "claude-sonnet-4-5-20250929" },
        usage: create(AiUsageSchema, {
          inputTokens: { value: 7n },
          outputTokens: { value: 2n },
        }),
      });
      const request = vi.mocked(fixture.runtime.beginAttempt).mock.calls[0]?.[0];
      if (request?.kind !== "generation") throw new Error("Expected generation request");
      expect(JSON.parse(request.content.promptJson)).toMatchObject({
        provider: {
          profile: "anthropic-messages-v1",
          lowering: "anthropic-4.0.72-v2",
          outputMode: "native-schema",
          providerOptions: { anthropic: { structuredOutputMode: "outputFormat" } },
        },
      });
    },
  );

  it("sends signed thinking and a tool result through native Anthropic output format", async () => {
    const fixture = realAnthropicFixture(
      [anthropicToolEvents(), anthropicEvents('{"replyText":"Done"}')],
      "native-schema",
      "claude-fable-5",
      { withTool: true },
    );
    vi.mocked(fixture.runtime.callTool).mockResolvedValue(
      create(ToolResponseSchema, {
        call: create(AiToolCallIdSchema, { value: "spine-call" }),
        outcome: AiOutcome.ADMITTED,
        text: ["Ticket found"],
      }),
    );
    vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
      ok: true,
      value: create(ProposedSupportReplySchema, { replyText: "Done" }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true });
    expect(fixture.network).toHaveBeenCalledTimes(2);
    const [, init] = vi.mocked(fixture.network).mock.calls[1] ?? [];
    const body: unknown = JSON.parse(
      typeof init?.body === "string"
        ? init.body
        : Buffer.from(init?.body as Uint8Array).toString("utf8"),
    );
    expect(body).toMatchObject({ output_config: { format: { type: "json_schema" } } });
    expect(JSON.stringify(body)).toContain('"signature":"signed-native"');
    expect(JSON.stringify(body)).toContain('"type":"tool_result"');
  });

  it("uses a trusted Anthropic token for prompted text without recording it", async () => {
    const fixture = realAnthropicFixture(
      anthropicEvents('{"replyText":"Hello"}'),
      "prompt-and-validate",
      "claude-3-haiku-20240307",
      { authToken: "fixture-bearer-secret" },
    );
    vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
      ok: true,
      value: create(ProposedSupportReplySchema, { replyText: "Hello" }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true });
    const [, init] = vi.mocked(fixture.network).mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-bearer-secret");
    const body: unknown = JSON.parse(
      typeof init?.body === "string"
        ? init.body
        : Buffer.from(init?.body as Uint8Array).toString("utf8"),
    );
    expect(body).toMatchObject({ model: "claude-3-haiku-20240307", stream: true });
    expect(body).not.toHaveProperty("output_config");
    const request = vi.mocked(fixture.runtime.beginAttempt).mock.calls[0]?.[0];
    if (request?.kind !== "generation") throw new Error("Expected generation request");
    expect(request.content.instructions).toContain("replyText");
    expect(JSON.stringify(request)).not.toContain("fixture-bearer-secret");
    expect(JSON.parse(request.content.promptJson)).toMatchObject({
      provider: { outputMode: "prompt-and-validate", providerOptions: null },
    });
  });

  it.each([
    { stopReason: "refusal", code: "REFUSED", outcome: AiOutcome.REFUSED },
    { stopReason: "max_tokens", code: "INVALID_OUTPUT", outcome: AiOutcome.INVALID_OUTPUT },
  ])("journals Anthropic $stopReason without admitting its partial text", async (failure) => {
    const wire = anthropicEvents("partial", failure.stopReason);
    const fixture = realAnthropicFixture(wire);
    await expect(fixture.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: failure.code },
    });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.admitGeneration).not.toHaveBeenCalled();
    const completion = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0];
    expect(completion?.receivedBytes).toBe(Buffer.byteLength(wire));
    expect(completion?.response).toMatchObject({
      outcome: failure.outcome,
      rawOutput: "partial",
      actualModel: { value: "claude-sonnet-4-5-20250929" },
    });
  });

  it.each([
    { status: 401, type: "authentication_error", code: "AUTHENTICATION_REQUIRED", retry: false },
    { status: 403, type: "permission_error", code: "AUTHENTICATION_REQUIRED", retry: false },
    { status: 429, type: "rate_limit_error", code: "RATE_LIMITED", retry: true },
    { status: 529, type: "overloaded_error", code: "UNAVAILABLE", retry: true },
  ])("journals one safe Anthropic HTTP $status failure", async (failure) => {
    const fixture = realAnthropicFixture("");
    fixture.network.mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: failure.type, message: "private provider diagnostic" },
        }),
        {
          status: failure.status,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await expect(fixture.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: failure.code, retryableByNewSignal: failure.retry },
    });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    const completion = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0];
    expect(completion?.response).toMatchObject({ outcome: AiOutcome.FAILED });
    expect(JSON.stringify(completion)).not.toContain("private provider diagnostic");
  });

  it("rejects an incomplete Anthropic SSE without admitting a candidate", async () => {
    const partial = anthropicEvents("partial").replace(/event: message_stop[\s\S]*$/, "");
    const fixture = realAnthropicFixture(partial);
    await expect(fixture.run()).resolves.toMatchObject({ ok: false });
    expect(fixture.runtime.admitGeneration).not.toHaveBeenCalled();
    const completion = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0];
    expect(completion?.receivedBytes).toBe(Buffer.byteLength(partial));
    expect(completion?.response).toMatchObject({
      outcome: AiOutcome.FAILED,
      rawOutput: "partial",
    });
  });

  it("bounds an actual Anthropic SSE body before candidate admission", async () => {
    const fixture = realAnthropicFixture(
      anthropicEvents('{"replyText":"Hello"}'),
      "native-schema",
      "claude-sonnet-4-5",
      { maxOutputBytes: 100 },
    );
    await expect(fixture.run()).resolves.toMatchObject({ ok: false });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.admitGeneration).not.toHaveBeenCalled();
    const completion = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0];
    expect(completion?.receivedBytes).toBeUndefined();
    expect(completion?.response.outcome).toBe(AiOutcome.FAILED);
  });

  it("cancels a pending Anthropic fetch and journals one cancelled attempt", async () => {
    const controller = new AbortController();
    const fixture = realAnthropicFixture("", "native-schema", "claude-sonnet-4-5", {
      signal: controller.signal,
    });
    fixture.network.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("network aborted"));
            },
            { once: true },
          );
        }),
    );
    const pending = fixture.run();
    await vi.waitFor(() => {
      expect(fixture.network).toHaveBeenCalledTimes(1);
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      failure: { code: "CANCELLED" },
    });
    expect(fixture.runtime.admitGeneration).not.toHaveBeenCalled();
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response.outcome).toBe(
      AiOutcome.FAILED,
    );
  });

  it("replays a recorded Anthropic generation without another physical fetch", async () => {
    const fixture = generationFixture([], 1, false, "anthropic");
    const saved = create(ProposedSupportReplySchema, { replyText: "Saved" });
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "anthropic-saved",
      response: create(GenerationResponseSchema, {
        outcome: AiOutcome.ADMITTED,
        rawOutput: '{"replyText":"Saved"}',
        anthropicContent: create(AnthropicAssistantContentSchema, {
          blocks: [{ content: { case: "text", value: '{"replyText":"Saved"}' } }],
        }),
        admittedOutput: AnyMessages.pack(ProposedSupportReplySchema, saved),
      }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true, value: saved });
    expect(fixture.network).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
    const request = vi.mocked(fixture.runtime.beginAttempt).mock.calls[0]?.[0];
    if (request?.kind !== "generation") throw new Error("Expected generation request");
    expect(JSON.parse(request.content.promptJson)).toMatchObject({
      provider: { profile: "anthropic-messages-v1", lowering: "anthropic-4.0.72-v2" },
    });
  });

  it("rebuilds a serialized signed Anthropic tool turn before the next provider request", async () => {
    const fixture = generationFixture(
      [
        [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "end_turn" },
            usage: sdkUsage(2, 1),
          },
        ],
      ],
      2,
      true,
      "anthropic",
    );
    const saved = create(GenerationResponseSchema, {
      outcome: AiOutcome.TOOL_REQUESTED,
      toolCalls: [
        { providerCallId: "provider-saved", toolName: "tool_0", argumentsJson: '{"ticket":"T-1"}' },
      ],
      anthropicContent: create(AnthropicAssistantContentSchema, {
        blocks: [
          { content: { case: "thinking", value: { text: "", signature: "saved-signature" } } },
          {
            content: {
              case: "toolCall",
              value: {
                providerCallId: "provider-saved",
                toolName: "tool_0",
                argumentsJson: '{"ticket":"T-1"}',
              },
            },
          },
        ],
      }),
    });
    vi.mocked(fixture.runtime.beginAttempt)
      .mockResolvedValueOnce({
        kind: "replay",
        id: "saved-proposal",
        response: fromBinary(GenerationResponseSchema, toBinary(GenerationResponseSchema, saved)),
      })
      .mockResolvedValueOnce({
        id: "fresh-after-tool",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 1000,
        signal: fixture.runtime.signal,
      });
    vi.mocked(fixture.runtime.callTool).mockResolvedValue(
      create(ToolResponseSchema, {
        call: create(AiToolCallIdSchema, { value: "saved-call" }),
        outcome: AiOutcome.ADMITTED,
        text: ["Ticket found"],
      }),
    );
    vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
      ok: true,
      value: create(ProposedSupportReplySchema, { replyText: "Done" }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.callTool).toHaveBeenCalledTimes(1);
    const assistant = fixture.providerCalls[0]?.prompt.find(
      (message) => message.role === "assistant",
    );
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role !== "assistant") throw new Error("Expected recorded assistant turn");
    expect(
      assistant.content.some(
        (part) =>
          part.type === "reasoning" &&
          part.text === "" &&
          part.providerOptions?.anthropic?.signature === "saved-signature",
      ),
    ).toBe(true);
  });

  it("does not call an Anthropic proposed tool after journal persistence fails", async () => {
    const fixture = generationFixture(
      [
        [
          {
            type: "tool-call",
            toolCallId: "provider-call-1",
            toolName: "tool_0",
            input: '{"ticket":"T-1"}',
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: sdkUsage(2, 1),
          },
        ],
      ],
      2,
      true,
      "anthropic",
    );
    vi.mocked(fixture.runtime.finishAttempt).mockRejectedValue(new Error("journal unavailable"));
    await expect(fixture.run()).rejects.toThrow("journal unavailable");
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.callTool).not.toHaveBeenCalled();
  });

  it("reuses a saved admitted decision without a second provider call", async () => {
    const doDecide = vi.fn().mockRejectedValue(new Error("provider must not run"));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    const saved = create(SupportRoutingResultSchema, { queue: { value: "tier-one" } });
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "saved-decision",
      response: create(DecisionResponseSchema, {
        outcome: AiOutcome.ADMITTED,
        admittedOutput: AnyMessages.pack(SupportRoutingResultSchema, saved),
      }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true, value: saved });
    expect(doDecide).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: AiOutcome.INVALID_OUTPUT, code: "INVALID_OUTPUT" as const, retryable: false },
    { outcome: AiOutcome.FAILED, code: "UNAVAILABLE" as const, retryable: true },
    { outcome: AiOutcome.REFUSED, code: "REFUSED" as const, retryable: false },
  ])("preserves saved decision $code without another provider call", async (saved) => {
    const doDecide = vi.fn().mockRejectedValue(new Error("provider must not run"));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "saved-decision-failure",
      response: create(DecisionResponseSchema, {
        outcome: saved.outcome,
        diagnosticId: { value: "original-diagnostic" },
      }),
      failure: {
        code: saved.code,
        retryableByNewSignal: saved.retryable,
        diagnosticId: "original-diagnostic",
      },
    });
    await expect(fixture.run()).resolves.toMatchObject({
      ok: false,
      failure: {
        code: saved.code,
        retryableByNewSignal: saved.retryable,
        diagnosticId: "original-diagnostic",
      },
    });
    expect(doDecide).not.toHaveBeenCalled();
    expect(fixture.runtime.recordFailure).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it("replays a saved invalid decision diagnostic without another provider call", async () => {
    const doDecide = vi.fn().mockRejectedValue(new Error("provider must not run"));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "saved-invalid-decision",
      response: create(DecisionResponseSchema, {
        outcome: AiOutcome.INVALID_OUTPUT,
        diagnosticId: { value: "diagnostic-saved" },
      }),
      failure: {
        code: "INVALID_OUTPUT",
        retryableByNewSignal: false,
        diagnosticId: "diagnostic-saved",
      },
    });
    await expect(fixture.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: "INVALID_OUTPUT", diagnosticId: "diagnostic-saved" },
    });
    expect(doDecide).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it.each([
    create(DecisionResponseSchema, { outcome: AiOutcome.ADMITTED }),
    create(DecisionResponseSchema, { outcome: AiOutcome.INVALID_OUTPUT }),
    create(GenerationResponseSchema, { outcome: AiOutcome.INVALID_OUTPUT }),
  ])("rejects incompatible saved decision response without provider dispatch", async (response) => {
    const doDecide = vi.fn().mockRejectedValue(new Error("provider must not run"));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "saved-incomplete-decision",
      response,
    });
    await expect(fixture.run()).rejects.toThrow("Saved");
    expect(doDecide).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it("reuses a saved admitted generation response without another provider attempt", async () => {
    const fixture = generationFixture([], 1);
    const saved = create(ProposedSupportReplySchema, { replyText: "Saved" });
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "saved-attempt",
      response: create(GenerationResponseSchema, {
        rawOutput: '{"replyText":"Saved"}',
        outcome: AiOutcome.ADMITTED,
        admittedOutput: AnyMessages.pack(ProposedSupportReplySchema, saved),
      }),
    });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true, value: saved });
    expect(fixture.network).not.toHaveBeenCalled();
    expect(fixture.runtime.reserveTransport).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: AiOutcome.FAILED, code: "UNAVAILABLE" as const, retryable: true },
    { outcome: AiOutcome.REFUSED, code: "REFUSED" as const, retryable: false },
  ])("preserves saved generation $code without another provider attempt", async (saved) => {
    const fixture = generationFixture([], 1);
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "saved-failure",
      response: create(GenerationResponseSchema, {
        outcome: saved.outcome,
        diagnosticId: { value: "original-diagnostic" },
      }),
      failure: {
        code: saved.code,
        retryableByNewSignal: saved.retryable,
        diagnosticId: "original-diagnostic",
      },
    });
    await expect(fixture.run()).resolves.toMatchObject({
      ok: false,
      failure: {
        code: saved.code,
        retryableByNewSignal: saved.retryable,
        diagnosticId: "original-diagnostic",
      },
    });
    expect(fixture.network).not.toHaveBeenCalled();
    expect(fixture.runtime.recordFailure).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it.each([
    { outcome: AiOutcome.INVALID_OUTPUT, code: "UNAVAILABLE" as const, diagnosticId: "original" },
    { outcome: AiOutcome.REFUSED, code: "UNAVAILABLE" as const, diagnosticId: "original" },
    { outcome: AiOutcome.FAILED, code: "REFUSED" as const, diagnosticId: "original" },
    { outcome: AiOutcome.FAILED, code: "UNAVAILABLE" as const, diagnosticId: "changed" },
    { outcome: AiOutcome.UNSPECIFIED, code: "UNAVAILABLE" as const, diagnosticId: "original" },
  ])("rejects an incoherent saved generation failure before redispatch", async (saved) => {
    const fixture = generationFixture([], 1);
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "saved-incoherent",
      response: create(GenerationResponseSchema, {
        outcome: saved.outcome,
        diagnosticId: { value: "original" },
      }),
      failure: { code: saved.code, retryableByNewSignal: false, diagnosticId: saved.diagnosticId },
    });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.network).not.toHaveBeenCalled();
    expect(fixture.runtime.recordFailure).not.toHaveBeenCalled();
  });

  it.each(["text", "structured"] as const)(
    "replays saved %s tool output before the next physical model attempt",
    async (format) => {
      const fixture = generationFixture(
        [
          [
            { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: sdkUsage(2, 1),
            },
          ],
        ],
        2,
        true,
      );
      vi.mocked(fixture.runtime.beginAttempt)
        .mockResolvedValueOnce({
          kind: "replay",
          id: "saved-proposal",
          response: create(GenerationResponseSchema, {
            outcome: AiOutcome.TOOL_REQUESTED,
            toolCalls: [
              {
                providerCallId: "provider-saved",
                toolName: "tool_0",
                argumentsJson: '{"ticket":"T-1"}',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          id: "fresh-after-tool",
          maxInputBytes: 2000,
          maxOutputBytes: 2000,
          deadlineEpochMs: 1000,
          signal: fixture.runtime.signal,
        });
      vi.mocked(fixture.runtime.callTool).mockResolvedValue(
        create(ToolResponseSchema, {
          call: create(AiToolCallIdSchema, { value: "spine-saved" }),
          outcome: AiOutcome.ADMITTED,
          ...(format === "text"
            ? { text: ["Ticket found"] }
            : { structuredJson: '{"ticketNumber":"T-1"}' }),
        }),
      );
      const output = create(ProposedSupportReplySchema, { replyText: "Done" });
      vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({ ok: true, value: output });
      await expect(fixture.run()).resolves.toMatchObject({ ok: true, value: output });
      expect(fixture.network).toHaveBeenCalledTimes(1);
      expect(fixture.runtime.callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: "saved-proposal",
          providerCallId: "provider-saved",
        }),
      );
      expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
      if (format === "structured")
        expect(JSON.stringify(fixture.providerCalls[0]?.prompt)).toContain("ticketNumber");
    },
  );

  it.each([
    { providerCallId: "", toolName: "tool_0", argumentsJson: "{}" },
    { providerCallId: "saved", toolName: "other", argumentsJson: "{}" },
    { providerCallId: "saved", toolName: "tool_0", argumentsJson: "{" },
    { providerCallId: "saved", toolName: "tool_0", argumentsJson: "[]" },
  ])("rejects an incoherent saved tool proposal before tool or provider dispatch", async (call) => {
    const fixture = generationFixture([], 1, true);
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "malformed-proposal",
      response: create(GenerationResponseSchema, {
        outcome: AiOutcome.TOOL_REQUESTED,
        toolCalls: [call],
      }),
    });
    await expect(fixture.run()).rejects.toThrow("Saved tool proposals invalid");
    expect(fixture.runtime.callTool).not.toHaveBeenCalled();
    expect(fixture.network).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it("rejects a saved response with the wrong capability kind before dispatch", async () => {
    const fixture = generationFixture([], 1);
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      kind: "replay",
      id: "wrong-kind",
      response: create(DecisionResponseSchema, { outcome: AiOutcome.INVALID_OUTPUT }),
    });
    await expect(fixture.run()).rejects.toThrow("kind mismatch");
    expect(fixture.network).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it("rejects incomplete saved generation outcomes without refetching", async () => {
    for (const response of [
      create(GenerationResponseSchema, { outcome: AiOutcome.ADMITTED }),
      create(GenerationResponseSchema, { outcome: AiOutcome.INVALID_OUTPUT, rawOutput: "bad" }),
    ]) {
      const fixture = generationFixture([], 1);
      vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
        kind: "replay",
        id: "saved-incomplete",
        response,
      });
      await expect(fixture.run()).rejects.toThrow();
      expect(fixture.network).not.toHaveBeenCalled();
      expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
    }
  });

  it("uses saved validation issues for correction without refetching the invalid output", async () => {
    const fixture = generationFixture(
      [
        [
          { type: "text-delta", id: "t", delta: '{"replyText":"Fixed"}' },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: sdkUsage(2, 1),
          },
        ],
      ],
      2,
    );
    vi.mocked(fixture.runtime.beginAttempt)
      .mockResolvedValueOnce({
        kind: "replay",
        id: "saved-invalid",
        response: create(GenerationResponseSchema, {
          rawOutput: "not-json",
          outcome: AiOutcome.INVALID_OUTPUT,
          diagnosticId: { value: "diagnostic-saved" },
        }),
        failure: {
          code: "INVALID_OUTPUT",
          retryableByNewSignal: false,
          diagnosticId: "diagnostic-saved",
        },
        issues: [{ code: "INVALID_OUTPUT", path: "replyText", message: "A reply is required" }],
      })
      .mockResolvedValueOnce({
        id: "correction",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 1000,
        signal: fixture.runtime.signal,
      });
    const output = create(ProposedSupportReplySchema, { replyText: "Fixed" });
    vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({ ok: true, value: output });
    await expect(fixture.run()).resolves.toMatchObject({ ok: true, value: output });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response).toMatchObject({
      outcome: AiOutcome.ADMITTED,
    });
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response).not.toHaveProperty(
      "diagnosticId",
    );
    const corrected = vi.mocked(fixture.runtime.beginAttempt).mock.calls[1]?.[0];
    if (corrected?.kind !== "generation") throw new Error("Expected correction request");
    expect(corrected.content.corrects?.value).toBe("saved-invalid");
  });

  it.each(["signed", "redacted"] as const)(
    "replays saved invalid Anthropic output with %s thinking into a correction",
    async (kind) => {
      const fixture = generationFixture(
        [
          [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: '{"replyText":"Fixed"}' },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "end_turn" },
              usage: sdkUsage(2, 1),
            },
          ],
        ],
        2,
        false,
        "anthropic",
      );
      const saved = create(GenerationResponseSchema, {
        rawOutput: "not-json",
        outcome: AiOutcome.INVALID_OUTPUT,
        diagnosticId: { value: "diagnostic-saved" },
        anthropicContent: create(AnthropicAssistantContentSchema, {
          blocks: [
            kind === "signed"
              ? { content: { case: "thinking", value: { text: "", signature: "saved-signature" } } }
              : { content: { case: "redactedThinking", value: { data: "saved-ciphertext" } } },
            { content: { case: "text", value: "not-json" } },
          ],
        }),
      });
      vi.mocked(fixture.runtime.beginAttempt)
        .mockResolvedValueOnce({
          kind: "replay",
          id: "saved-invalid-anthropic",
          response: fromBinary(GenerationResponseSchema, toBinary(GenerationResponseSchema, saved)),
          failure: {
            code: "INVALID_OUTPUT",
            retryableByNewSignal: false,
            diagnosticId: "diagnostic-saved",
          },
          issues: [{ code: "INVALID_OUTPUT", path: "replyText", message: "A reply is required" }],
        })
        .mockResolvedValueOnce({
          id: "correction",
          maxInputBytes: 2000,
          maxOutputBytes: 2000,
          deadlineEpochMs: 1000,
          signal: fixture.runtime.signal,
        });
      const output = create(ProposedSupportReplySchema, { replyText: "Fixed" });
      vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({ ok: true, value: output });
      await expect(fixture.run()).resolves.toMatchObject({ ok: true, value: output });
      expect(fixture.network).toHaveBeenCalledTimes(1);
      expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
      const correction = vi.mocked(fixture.runtime.beginAttempt).mock.calls[1]?.[0];
      if (correction?.kind !== "generation") throw new Error("Expected correction request");
      expect(correction.content.corrects?.value).toBe("saved-invalid-anthropic");
      expect(correction.content.promptJson).toContain(
        kind === "signed" ? "saved-signature" : "saved-ciphertext",
      );
      const assistant = fixture.providerCalls[0]?.prompt.find(
        (message) => message.role === "assistant",
      );
      if (assistant?.role !== "assistant") throw new Error("Expected saved assistant turn");
      const reasoning = assistant.content.find((part) => part.type === "reasoning");
      if (reasoning?.type !== "reasoning") throw new Error("Expected saved reasoning block");
      expect(reasoning.text).toBe("");
      expect(reasoning.providerOptions?.anthropic).toEqual(
        kind === "signed" ? { signature: "saved-signature" } : { redactedData: "saved-ciphertext" },
      );
      expect(
        assistant.content.some((part) => part.type === "text" && part.text === "not-json"),
      ).toBe(true);
    },
  );

  it("records the exact discovered tool schema and mapping in prepared generation input", async () => {
    const outputSchemaJson = JSON.stringify({
      additionalProperties: false,
      properties: { ticket: { type: "string" } },
      required: ["ticket"],
      type: "object",
    });
    const fixture = generationFixture(
      [
        [
          { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: sdkUsage(1, 1),
          },
        ],
      ],
      1,
      true,
    );
    await fixture.run([{ ...advertisedLookup, outputSchemaJson }]);
    const started = vi.mocked(fixture.runtime.beginAttempt).mock.calls[0]?.[0];
    if (started?.kind !== "generation") throw new Error("Expected generation request");
    expect(JSON.parse(started.content.promptJson) as unknown).toMatchObject({
      tools: [
        {
          modelName: "tool_0",
          server: "support",
          tool: "lookup",
          description: "Lookup a support ticket",
          inputSchemaJson: advertisedLookup.inputSchemaJson,
          outputSchemaJson,
        },
      ],
    });
    expect(fixture.providerCalls[0]?.tools).toEqual([
      {
        type: "function",
        name: "tool_0",
        description: "Lookup a support ticket",
        inputSchema: JSON.parse(advertisedLookup.inputSchemaJson) as unknown,
      },
    ]);
    const baseline = generationFixture(
      [
        [
          { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: sdkUsage(1, 1) },
        ],
      ],
      1,
      true,
    );
    await baseline.run();
    const original = vi.mocked(baseline.runtime.beginAttempt).mock.calls[0]?.[0];
    if (original?.kind !== "generation") throw new Error("Expected original generation request");
    expect(started.content.digest?.value).not.toBe(original.content.digest?.value);
  });

  it("rejects an oversized discovered tool output schema before provider dispatch", async () => {
    const fixture = generationFixture([], 1, true);
    const catalog = [{ ...advertisedLookup, outputSchemaJson: "x".repeat(16_385) }];
    expect(await fixture.run(catalog)).toMatchObject({
      ok: false,
      failure: { code: "INVALID_OUTPUT" },
    });
    expect(fixture.runtime.beginAttempt).not.toHaveBeenCalled();
    expect(fixture.providerCalls).toHaveLength(0);
  });

  it("rejects missing and unexpected tool catalogs before a provider attempt", async () => {
    const missing = generationFixture([], 1, true);
    await expect(missing.run([])).resolves.toMatchObject({ ok: false });
    expect(missing.runtime.beginAttempt).not.toHaveBeenCalled();
    expect(missing.providerCalls).toHaveLength(0);
    const unexpected = generationFixture([], 1, false);
    await expect(unexpected.run([advertisedLookup])).resolves.toMatchObject({ ok: false });
    expect(unexpected.runtime.beginAttempt).not.toHaveBeenCalled();
    expect(unexpected.providerCalls).toHaveLength(0);
  });

  it.each([
    { label: "server mapping", catalog: { ...advertisedLookup, server: "other" } },
    { label: "tool mapping", catalog: { ...advertisedLookup, tool: "other" } },
    {
      label: "oversized description",
      catalog: { ...advertisedLookup, description: "x".repeat(4_097) },
    },
    {
      label: "oversized schema",
      catalog: { ...advertisedLookup, inputSchemaJson: "x".repeat(16_385) },
    },
    { label: "malformed schema", catalog: { ...advertisedLookup, inputSchemaJson: "{" } },
    {
      label: "non-object schema",
      catalog: { ...advertisedLookup, inputSchemaJson: '{"type":"string"}' },
    },
    {
      label: "changed schema encoding",
      catalog: {
        ...advertisedLookup,
        inputSchemaJson:
          '{"type":"object","properties":{"ticket":{"type":"string"}},' +
          '"required":["ticket"],"additionalProperties":false}',
      },
    },
  ])("rejects $label before beginning a model attempt", async ({ catalog }) => {
    const fixture = generationFixture([], 1, true);
    await expect(fixture.run([catalog])).resolves.toMatchObject({ ok: false });
    expect(fixture.runtime.beginAttempt).not.toHaveBeenCalled();
    expect(fixture.providerCalls).toHaveLength(0);
  });

  it("makes the bounded MCP protocol factory available to generation runtime", () => {
    const fixture = generationFixture([], 1, true);
    expect(typeof backendDefinition(fixture.registration).mcp?.connect).toBe("function");
  });

  it("journals explicit zero decision precision and output-only usage", async () => {
    const model = {
      specificationVersion: "v4" as const,
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"] as const,
      doDecide: () =>
        Promise.resolve({
          answers: { safe: { type: "boolean" as const, probability: 0 } },
          rounding: { probabilityDecimals: 0 },
          usage: { outputTokens: 0 },
          warnings: [],
        }),
    };
    const fixture = decisionFixture(model);
    expect(await fixture.run()).toMatchObject({ ok: true });
    expect(fixture.runtime.admitDecision).toHaveBeenCalledWith(
      expect.anything(),
      fixture.definition,
      expect.anything(),
      { probabilityDecimals: 0 },
    );
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
      response: { rounding: { probabilityDecimals: 0 }, usage: { outputTokens: { value: 0n } } },
    });
    const response = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response;
    if (response?.$typeName !== "spine.ts.agent.DecisionResponse")
      throw new Error("Missing decision response");
    expect(response.rounding?.scoreDecimals).toBeUndefined();
    expect(response.usage?.inputTokens).toBeUndefined();
  });

  it.each([
    { precision: { scoreDecimals: 2 }, expected: { scoreDecimals: 2 } },
    {
      precision: { probabilityDecimals: 2, scoreDecimals: 2 },
      expected: { probabilityDecimals: 2, scoreDecimals: 2 },
    },
    { precision: {}, expected: undefined },
  ])(
    "preserves provider precision $precision without inventing missing decimals",
    async ({ precision, expected }) => {
      const model = {
        specificationVersion: "v4" as const,
        provider: "fixture",
        modelId: identity.model,
        supportedQuestionTypes: ["boolean"] as const,
        doDecide: () =>
          Promise.resolve({
            answers: { safe: { type: "boolean" as const, probability: 0.8 } },
            rounding: precision,
            usage: { inputTokens: 0 },
            warnings: [],
          }),
      };
      const fixture = decisionFixture(model);
      expect(await fixture.run()).toMatchObject({ ok: true });
      const response = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response;
      if (response?.$typeName !== "spine.ts.agent.DecisionResponse")
        throw new Error("Missing decision response");
      if (expected) expect(response.rounding).toMatchObject(expected);
      else expect(response.rounding).toBeUndefined();
      expect(response.usage?.inputTokens?.value).toBe(0n);
      expect(response.usage?.outputTokens).toBeUndefined();
    },
  );

  it("rejects an unsupported decision question before reserving an attempt", async () => {
    const model = {
      specificationVersion: "v4" as const,
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["score"] as const,
      doDecide: () => Promise.reject(new Error("Must not dispatch")),
    };
    const fixture = decisionFixture(model);
    await expect(fixture.run()).rejects.toThrow("unsupported by provider");
    expect(fixture.runtime.beginAttempt).not.toHaveBeenCalled();
  });

  it("propagates decision cancellation without a fabricated provider failure", async () => {
    const model = {
      specificationVersion: "v4" as const,
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"] as const,
      doDecide: () => new Promise<never>(() => undefined),
    };
    const fixture = decisionFixture(model);
    const controller = new AbortController();
    const runtime = { ...fixture.runtime, signal: controller.signal };
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      id: "decision-cancel",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 1000,
      signal: controller.signal,
    });
    const pending = fixture.run(runtime);
    await vi.waitFor(() => {
      expect(fixture.runtime.beginAttempt).toHaveBeenCalledTimes(1);
    });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(fixture.runtime.recordFailure).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).not.toHaveBeenCalled();
  });

  it("journals an expired decision ticket before invoking the provider", async () => {
    const doDecide = vi.fn(() => new Promise<never>(() => undefined));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    let current = 100;
    const runtime = { ...fixture.runtime, nowEpochMs: () => current };
    vi.mocked(fixture.runtime.beginAttempt).mockImplementation(() => {
      current = 1000;
      return Promise.resolve({
        id: "expired-decision",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 1000,
        signal: runtime.signal,
      });
    });
    expect(await fixture.run(runtime)).toMatchObject({
      ok: false,
      failure: { code: "DEADLINE_EXCEEDED" },
    });
    expect(doDecide).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("journals a cancelled decision ticket before invoking the provider", async () => {
    const doDecide = vi.fn(() => new Promise<never>(() => undefined));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    const controller = new AbortController();
    controller.abort();
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      id: "cancelled-decision",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 1000,
      signal: controller.signal,
    });
    expect(await fixture.run()).toMatchObject({ ok: false, failure: { code: "CANCELLED" } });
    expect(doDecide).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("classifies a decision deadline while the provider never settles", async () => {
    const doDecide = vi.fn(() => new Promise<never>(() => undefined));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    const started = Date.now();
    const runtime = {
      ...fixture.runtime,
      deadlineEpochMs: 110,
      nowEpochMs: () => 100 + Date.now() - started,
    };
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      id: "decision-inflight",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 110,
      signal: runtime.signal,
    });
    expect(await fixture.run(runtime)).toMatchObject({
      ok: false,
      failure: { code: "DEADLINE_EXCEEDED", retryableByNewSignal: false },
    });
    expect(doDecide).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.recordFailure).toHaveBeenCalledWith("DEADLINE_EXCEEDED", false);
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("journals decision expiry between the ticket check and gate admission", async () => {
    const doDecide = vi.fn(() => new Promise<never>(() => undefined));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    let reads = 0;
    const runtime = { ...fixture.runtime, nowEpochMs: () => (++reads === 1 ? 99 : 100) };
    vi.mocked(fixture.runtime.beginAttempt).mockImplementation(() => {
      reads = 0;
      return Promise.resolve({
        id: "racing-decision",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 100,
        signal: runtime.signal,
      });
    });
    expect(await fixture.run(runtime)).toMatchObject({
      ok: false,
      failure: { code: "DEADLINE_EXCEEDED" },
    });
    expect(doDecide).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["before provider entry", 3],
    ["after provider entry", 6],
  ] as const)("journals decision expiry %s", async (_phase, validReads) => {
    const doDecide = vi.fn(() => new Promise<never>(() => undefined));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    let reads = 0;
    const runtime = { ...fixture.runtime, nowEpochMs: () => (++reads <= validReads ? 99 : 100) };
    vi.mocked(fixture.runtime.beginAttempt).mockImplementation(() => {
      reads = 0;
      return Promise.resolve({
        id: "decision-crossing",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 100,
        signal: runtime.signal,
      });
    });
    expect(await fixture.run(runtime)).toMatchObject({
      ok: false,
      failure: { code: "DEADLINE_EXCEEDED", retryableByNewSignal: false },
    });
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
    expect(doDecide).toHaveBeenCalledTimes(validReads === 3 ? 0 : 1);
  });

  it("uses the earlier decision ticket deadline for a stalled provider", async () => {
    const doDecide = vi.fn(() => new Promise<never>(() => undefined));
    const fixture = decisionFixture({
      specificationVersion: "v4",
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"],
      doDecide,
    });
    const started = Date.now();
    const runtime = {
      ...fixture.runtime,
      deadlineEpochMs: 1000,
      nowEpochMs: () => 100 + Date.now() - started,
    };
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      id: "short-decision",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 110,
      signal: runtime.signal,
    });
    expect(await fixture.run(runtime)).toMatchObject({
      ok: false,
      failure: { code: "DEADLINE_EXCEEDED", retryableByNewSignal: false },
    });
    expect(doDecide).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("does not falsely expire a long pending decision timer", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fixture = decisionFixture({
        specificationVersion: "v4",
        provider: "fixture",
        modelId: identity.model,
        supportedQuestionTypes: ["boolean"],
        doDecide: () => new Promise<never>(() => undefined),
      });
      const runtime = {
        ...fixture.runtime,
        signal: controller.signal,
        deadlineEpochMs: 100 + 2_147_483_648,
      };
      vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
        id: "long-decision",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: runtime.deadlineEpochMs,
        signal: controller.signal,
      });
      let settled = false;
      const pending = fixture.run(runtime);
      void pending
        .finally(() => {
          settled = true;
        })
        .catch(() => undefined);
      await vi.advanceTimersByTimeAsync(20);
      expect(settled).toBe(false);
      controller.abort();
      await expect(pending).rejects.toThrow("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { calls: [], reason: "missing proposals" },
    { calls: [{ id: "", name: "tool_0", input: "{}" }], reason: "blank ID" },
    { calls: [{ id: "c1", name: "", input: "{}" }], reason: "blank name" },
    { calls: [{ id: "c1", name: "tool_2", input: "{}" }], reason: "unadvertised tool" },
    { calls: [{ id: "c1", name: "tool_0", input: "{" }], reason: "malformed JSON" },
    { calls: [{ id: "c1", name: "tool_0", input: "[]" }], reason: "array arguments" },
    {
      calls: [
        { id: "c1", name: "tool_0", input: "{}" },
        { id: "c1", name: "tool_0", input: "{}" },
      ],
      reason: "duplicate ID",
    },
  ])("rejects $reason without dispatching a tool", async ({ calls }) => {
    const parts: LanguageModelV3StreamPart[] = [
      ...calls.map((call): LanguageModelV3StreamPart => ({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        input: call.input,
      })),
      {
        type: "finish",
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: sdkUsage(1, 1),
      },
    ];
    const fixture = generationFixture([parts], 1, true);
    expect(await fixture.run()).toMatchObject({ ok: false, failure: { code: "INVALID_OUTPUT" } });
    expect(fixture.runtime.callTool).not.toHaveBeenCalled();
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
      response: {
        outcome: AiOutcome.INVALID_OUTPUT,
        toolCalls: calls.map(({ id, name, input }) => ({
          providerCallId: id,
          toolName: name,
          argumentsJson: input,
        })),
      },
    });
  });

  it.each(["reservation", "admission"] as const)(
    "does not misclassify a failed generation %s barrier",
    async (barrier) => {
      const fixture = generationFixture([
        [
          { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: sdkUsage(1, 1) },
        ],
      ]);
      if (barrier === "reservation")
        vi.mocked(fixture.runtime.beginAttempt).mockRejectedValue(new Error("journal unavailable"));
      else
        vi.mocked(fixture.runtime.admitGeneration).mockRejectedValue(
          new Error("admission unavailable"),
        );
      await expect(fixture.run()).rejects.toThrow(
        barrier === "reservation" ? "journal unavailable" : "admission unavailable",
      );
      expect(fixture.runtime.recordFailure).not.toHaveBeenCalled();
      expect(fixture.network).toHaveBeenCalledTimes(barrier === "reservation" ? 0 : 1);
    },
  );

  it.each([1, 2])(
    "journals invalid generation output with request allowance %i",
    async (maxRequests) => {
      const invalid: LanguageModelV3StreamPart[] = [
        { type: "text-delta", id: "t", delta: "{}" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: sdkUsage(2, 1) },
      ];
      const valid: LanguageModelV3StreamPart[] = [
        { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: sdkUsage(3, 2) },
      ];
      const fixture = generationFixture([invalid, valid], maxRequests);
      vi.mocked(fixture.runtime.admitGeneration)
        .mockReturnValueOnce({
          ok: false,
          issues: [{ code: "INVALID_OUTPUT", path: "replyText", message: "Required reply" }],
        })
        .mockReturnValue({
          ok: true,
          value: create(ProposedSupportReplySchema, { replyText: "Done" }),
        });
      const result = await fixture.run();
      expect(result).toMatchObject(
        maxRequests === 1
          ? { ok: false, failure: { code: "INVALID_OUTPUT" } }
          : { ok: true, value: { replyText: "Done" } },
      );
      expect(fixture.network).toHaveBeenCalledTimes(maxRequests);
      expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(maxRequests);
      expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
        response: {
          outcome: AiOutcome.INVALID_OUTPUT,
          rawOutput: "{}",
          diagnosticId: { value: "diagnostic-1" },
          usage: { inputTokens: { value: 2n } },
        },
        issues: [{ code: "INVALID_OUTPUT", path: "replyText" }],
      });
      if (maxRequests === 2) {
        expect(vi.mocked(fixture.runtime.beginAttempt).mock.calls[1]?.[0]).toMatchObject({
          content: { corrects: { value: "attempt-1" } },
        });
        expect(
          vi.mocked(fixture.runtime.finishAttempt).mock.calls[1]?.[0].response,
        ).not.toHaveProperty("diagnosticId");
      }
    },
  );

  it.each(["admitted", "invalid"] as const)(
    "keeps provider usage absent on %s generation output",
    async (outcome) => {
      const fixture = generationFixture([
        [
          { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: unknownUsage },
        ],
      ]);
      vi.mocked(fixture.runtime.admitGeneration).mockReturnValue(
        outcome === "admitted"
          ? { ok: true, value: create(ProposedSupportReplySchema, { replyText: "Done" }) }
          : {
              ok: false,
              issues: [{ code: "INVALID_OUTPUT", path: "replyText", message: "Rejected reply" }],
            },
      );
      const result = await fixture.run();
      expect(result.ok).toBe(outcome === "admitted");
      const finished = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0];
      expect(finished?.usage).toBeUndefined();
      expect(finished?.response.usage).toBeUndefined();
    },
  );

  it.each(["input", "output"] as const)(
    "preserves only the reported %s token count in a generation record",
    async (known) => {
      const fixture = generationFixture([
        [
          { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                ...unknownUsage.inputTokens,
                total: known === "input" ? 3 : undefined,
              },
              outputTokens: {
                ...unknownUsage.outputTokens,
                total: known === "output" ? 2 : undefined,
              },
            },
          },
        ],
      ]);
      vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
        ok: true,
        value: create(ProposedSupportReplySchema, { replyText: "Done" }),
      });
      expect(await fixture.run()).toMatchObject({ ok: true });
      const usage = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response.usage;
      if (known === "input") {
        expect(usage?.inputTokens?.value).toBe(3n);
        expect(usage?.outputTokens).toBeUndefined();
      } else {
        expect(usage?.inputTokens).toBeUndefined();
        expect(usage?.outputTokens?.value).toBe(2n);
      }
    },
  );

  it("fails closed when admission rejects output without correction feedback", async () => {
    const fixture = generationFixture([
      [
        { type: "text-delta", id: "t", delta: "{}" },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: sdkUsage(1, 1) },
      ],
    ]);
    vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({ ok: false, issues: [] });
    expect(await fixture.run()).toMatchObject({ ok: false, failure: { code: "INVALID_OUTPUT" } });
    expect(fixture.network).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it.each(["diagnostic", "finish"] as const)(
    "propagates a failed generation %s journal barrier",
    async (barrier) => {
      const fixture = generationFixture([
        [
          { type: "text-delta", id: "t", delta: "{}" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: sdkUsage(1, 1) },
        ],
      ]);
      vi.mocked(fixture.runtime.admitGeneration).mockReturnValue({
        ok: false,
        issues: [{ code: "INVALID_OUTPUT", path: "replyText", message: "Required reply" }],
      });
      if (barrier === "diagnostic")
        vi.mocked(fixture.runtime.recordFailure).mockRejectedValue(
          new Error("diagnostic journal unavailable"),
        );
      else
        vi.mocked(fixture.runtime.finishAttempt).mockRejectedValue(
          new Error("response journal unavailable"),
        );
      await expect(fixture.run()).rejects.toThrow(
        barrier === "diagnostic"
          ? "diagnostic journal unavailable"
          : "response journal unavailable",
      );
      expect(fixture.network).toHaveBeenCalledTimes(1);
      expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(barrier === "diagnostic" ? 0 : 1);
    },
  );

  it.each([
    { reason: "length", code: "INVALID_OUTPUT", outcome: AiOutcome.INVALID_OUTPUT },
    { reason: "content-filter", code: "REFUSED", outcome: AiOutcome.REFUSED },
  ] as const)("journals provider finish $reason as $code", async ({ reason, code, outcome }) => {
    const fixture = generationFixture([
      [
        { type: "text-delta", id: "t", delta: '{"replyText":"Done"}' },
        { type: "finish", finishReason: { unified: reason, raw: reason }, usage: sdkUsage(5, 3) },
      ],
    ]);
    const result = await fixture.run();
    expect(result).toMatchObject({ ok: false, failure: { code } });
    expect(fixture.runtime.admitGeneration).not.toHaveBeenCalled();
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
      response: {
        outcome,
        rawOutput: '{"replyText":"Done"}',
        usage: { inputTokens: { value: 5n } },
      },
    });
  });

  it("journals a provider stream error without exposing the provider exception", async () => {
    const fixture = generationFixture([
      [
        { type: "text-delta", id: "t", delta: '{"replyText":"partial' },
        { type: "error", error: new Error("private provider response") },
      ],
    ]);
    expect(await fixture.run()).toMatchObject({
      ok: false,
      failure: { code: "UNAVAILABLE", retryableByNewSignal: true },
    });
    expect(fixture.runtime.admitGeneration).not.toHaveBeenCalled();
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
      response: { outcome: AiOutcome.FAILED, rawOutput: '{"replyText":"partial' },
    });
    expect(JSON.stringify(vi.mocked(fixture.runtime.finishAttempt).mock.calls)).not.toContain(
      "private provider response",
    );
    expect(fixture.network).toHaveBeenCalledOnce();
  });

  it("journals a parsed output byte limit before admitting text", async () => {
    const fixture = generationFixture([
      [
        { type: "text-delta", id: "t", delta: '{"replyText":"too long"}' },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: sdkUsage(1, 1) },
      ],
    ]);
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      id: "attempt-1",
      maxInputBytes: 2000,
      maxOutputBytes: 10,
      deadlineEpochMs: 1000,
      signal: fixture.runtime.signal,
    });
    expect(await fixture.run()).toMatchObject({ ok: false, failure: { code: "INVALID_OUTPUT" } });
    expect(fixture.runtime.admitGeneration).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("reports known partial response bytes after an interrupted stream", async () => {
    const fixture = generationFixture([[]]);
    let chunk = 0;
    fixture.network.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunk++ === 0) controller.enqueue(new TextEncoder().encode("partial"));
            else controller.error(new Error("response interrupted"));
          },
        }),
      ),
    );
    expect(await fixture.run()).toMatchObject({ ok: false });
    expect(fixture.runtime.onReceived).toHaveBeenCalled();
    const completion = vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0];
    expect(completion).toBeDefined();
    expect(completion?.receivedBytes).toBe(Buffer.byteLength("partial"));
  });

  it("journals cancellation after reservation without dispatching the model", async () => {
    const fixture = generationFixture([[]]);
    const controller = new AbortController();
    controller.abort();
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      id: "cancelled-ticket",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 1000,
      signal: controller.signal,
    });
    expect(await fixture.run()).toMatchObject({ ok: false, failure: { code: "CANCELLED" } });
    expect(fixture.model.doStreamCalls).toHaveLength(0);
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("journals a generation ticket expired before gate admission", async () => {
    const fixture = generationFixture([[]]);
    vi.mocked(fixture.runtime.beginAttempt).mockResolvedValue({
      id: "expired-generation",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 100,
      signal: fixture.runtime.signal,
    });
    expect(await fixture.run()).toMatchObject({
      ok: false,
      failure: { code: "DEADLINE_EXCEEDED" },
    });
    expect(fixture.model.doStreamCalls).toHaveLength(0);
    expect(fixture.network).not.toHaveBeenCalled();
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("journals generation expiry between the ticket check and gate admission", async () => {
    const fixture = generationFixture([[]]);
    let reads = 0;
    Object.defineProperty(fixture.runtime, "nowEpochMs", {
      value: () => (++reads === 1 ? 99 : 100),
    });
    vi.mocked(fixture.runtime.beginAttempt).mockImplementation(() => {
      reads = 0;
      return Promise.resolve({
        id: "racing-generation",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 100,
        signal: fixture.runtime.signal,
      });
    });
    expect(await fixture.run()).toMatchObject({
      ok: false,
      failure: { code: "DEADLINE_EXCEEDED" },
    });
    expect(fixture.model.doStreamCalls).toHaveLength(0);
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("journals cancellation that crosses generation gate admission", async () => {
    const fixture = generationFixture([[]]);
    const controller = new AbortController();
    let reads = 0;
    Object.defineProperty(fixture.runtime, "nowEpochMs", {
      value: () => {
        if (++reads === 2) controller.abort();
        return 99;
      },
    });
    vi.mocked(fixture.runtime.beginAttempt).mockImplementation(() => {
      reads = 0;
      return Promise.resolve({
        id: "generation-racing-cancel",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 1000,
        signal: controller.signal,
      });
    });
    expect(await fixture.run()).toMatchObject({
      ok: false,
      failure: { code: "CANCELLED", retryableByNewSignal: false },
    });
    expect(fixture.model.doStreamCalls).toHaveLength(0);
    expect(fixture.runtime.finishAttempt).toHaveBeenCalledTimes(1);
  });

  it("does not reclassify a failed decision journal barrier as provider failure", async () => {
    const model = {
      specificationVersion: "v4" as const,
      provider: "fixture",
      modelId: identity.model,
      supportedQuestionTypes: ["boolean"] as const,
      doDecide: () =>
        Promise.resolve({
          answers: { safe: { type: "boolean" as const, probability: 0.8 } },
          warnings: [],
        }),
    };
    const registration = VercelDecision.model({
      ref: ModelRef.of("support-safety", "r1"),
      capabilities: VercelDecision.capabilities.openRouterJev(),
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect: () => ({ model, identity }),
    });
    const definition = executionDefinition(
      AiModel.define({
        name: "support-safety",
        version: "v1",
        kind: "decision",
        input: SupportTicketFactsSchema,
        output: SupportRoutingResultSchema,
        limits: {
          modelRequests: 1,
          toolCalls: 0,
          deadlineMs: 900,
          maxInputBytes: 2000,
          maxOutputBytes: 2000,
        },
        questions: { safe: { type: "boolean", instructions: "Is this safe?" } },
        mapping: {
          version: "v1",
          toMessage: () => create(SupportRoutingResultSchema, { queue: { value: "tier-one" } }),
        },
      }).definition,
    );
    const runtime = control();
    vi.mocked(runtime.beginAttempt).mockResolvedValue({
      id: "decision-barrier",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 1000,
      signal: runtime.signal,
    });
    vi.mocked(runtime.admitDecision).mockReturnValue({
      ok: true,
      value: create(SupportRoutingResultSchema, { queue: { value: "tier-one" } }),
    });
    vi.mocked(runtime.finishAttempt).mockRejectedValue(new Error("journal unavailable"));
    const selected = await backendDefinition(registration).connect(scope, identity, runtime);
    await expect(
      backendDefinition(registration).execute({
        operationId: create(AiOperationIdSchema, { value: "decision-barrier-op" }),
        call: "support-request",
        scope,
        identity,
        model: selected.model,
        definition,
        input: create(SupportTicketFactsSchema, {
          ticketNumber: { value: "T-12" },
          customerQuestion: "Help?",
        }),
        control: runtime,
      }),
    ).rejects.toThrow("journal unavailable");
    expect(runtime.finishAttempt).toHaveBeenCalledTimes(1);
    expect(runtime.recordFailure).not.toHaveBeenCalled();
  });

  it("records duplicate and malformed provider proposals without a tool dispatch", async () => {
    let scopedFetch!: typeof fetch;
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    const backend = new MockLanguageModelV3({
      doStream: async () => {
        await (
          await scopedFetch("https://provider.example/v1/responses", { method: "POST", body: "{}" })
        ).text();
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-delta", id: "t", delta: "Checking policy" });
              controller.enqueue({
                type: "tool-call",
                toolCallId: "same",
                toolName: "tool_0",
                input: '{"ticket":',
              });
              controller.enqueue({
                type: "tool-call",
                toolCallId: "same",
                toolName: "",
                input: "",
              });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool-calls" },
                usage: sdkUsage(1, 2),
              });
              controller.close();
            },
          }),
        };
      },
    });
    const registration = VercelAx.model({
      ref: ModelRef.of("draft-support-reply", "r1"),
      capabilities: VercelAx.capabilities.openAIResponses(),
      platformFetch: network,
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect: (_scope, _expected, runtime) => {
        scopedFetch = runtime.fetch;
        return { model: backend, identity };
      },
    });
    const definition = executionDefinition(
      AiModel.define({
        name: "draft-support-reply",
        version: "v1",
        kind: "generation",
        input: SupportTicketFactsSchema,
        output: ProposedSupportReplySchema,
        instructions: "Draft a reply",
        outputMode: "native-schema",
        tools: [{ server: "support", tool: "lookup" }],
        limits: {
          modelRequests: 1,
          toolCalls: 1,
          deadlineMs: 900,
          maxInputBytes: 2000,
          maxOutputBytes: 2000,
          maxOutputTokens: 100,
        },
      }).definition,
    );
    const runtime = control();
    vi.mocked(runtime.beginAttempt).mockResolvedValue({
      id: "bad-proposals",
      maxInputBytes: 2000,
      maxOutputBytes: 2000,
      deadlineEpochMs: 1000,
      signal: runtime.signal,
    });
    const selected = await backendDefinition(registration).connect(scope, identity, runtime);
    const result = await backendDefinition(registration).execute({
      operationId: create(AiOperationIdSchema, { value: "bad-op" }),
      call: "support-request",
      scope,
      identity,
      model: selected.model,
      definition,
      advertisedTools: [advertisedLookup],
      input: create(SupportTicketFactsSchema, {
        ticketNumber: { value: "T-1" },
        customerQuestion: "Help?",
      }),
      control: runtime,
    });
    expect(result).toMatchObject({ ok: false, failure: { code: "INVALID_OUTPUT" } });
    expect(runtime.callTool).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
      response: {
        outcome: AiOutcome.INVALID_OUTPUT,
        rawOutput: "Checking policy",
        toolCalls: [
          { providerCallId: "same", argumentsJson: '{"ticket":' },
          { providerCallId: "same", toolName: "", argumentsJson: "" },
        ],
      },
    });
  });

  it.each([
    ["provider name", "lookup", '{"ticket":"T-1"}', "provider-1"],
    ["null arguments", "tool_0", "null", "provider-1"],
  ] as const)("rejects %s in a recorded tool proposal", async (_case, name, input, id) => {
    const fixture = generationFixture(
      [
        [
          { type: "tool-call", toolCallId: id, toolName: name, input },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: sdkUsage(1, 1),
          },
        ],
      ],
      1,
      true,
    );
    expect(await fixture.run()).toMatchObject({ ok: false, failure: { code: "INVALID_OUTPUT" } });
    expect(fixture.runtime.callTool).not.toHaveBeenCalled();
    expect(vi.mocked(fixture.runtime.finishAttempt).mock.calls[0]?.[0].response).toMatchObject({
      outcome: AiOutcome.INVALID_OUTPUT,
      toolCalls: [{ providerCallId: id, toolName: name, argumentsJson: input }],
    });
  });

  it.each([
    [401, "AUTHENTICATION_REQUIRED", false],
    [403, "AUTHENTICATION_REQUIRED", false],
    [429, "RATE_LIMITED", true],
    [500, "UNAVAILABLE", true],
  ] as const)("records HTTP %i as %s without an SDK resend", async (status, code, retryable) => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "fixture provider error", type: "fixture_error" },
        }),
        { status, headers: { "content-type": "application/json" } },
      ),
    );
    const registration = VercelAx.model({
      ref: ModelRef.of("draft-support-reply", "r1"),
      capabilities: VercelAx.capabilities.openAIResponses(),
      platformFetch: network,
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect: (_scope, _expected, runtime) => ({
        model: createOpenAI({
          apiKey: "fixture",
          baseURL: identity.endpoint,
          fetch: runtime.fetch,
        }).responses(identity.model),
        identity,
      }),
    });
    const definition = executionDefinition(
      AiModel.define({
        name: "draft-support-reply",
        version: "v1",
        kind: "generation",
        input: SupportTicketFactsSchema,
        output: ProposedSupportReplySchema,
        instructions: "Draft a reply",
        outputMode: "native-schema",
        limits: {
          modelRequests: 2,
          toolCalls: 0,
          deadlineMs: 900,
          maxInputBytes: 4000,
          maxOutputBytes: 4000,
          maxOutputTokens: 100,
        },
      }).definition,
    );
    const runtime = control();
    vi.mocked(runtime.beginAttempt).mockResolvedValue({
      id: "failed-1",
      maxInputBytes: 4000,
      maxOutputBytes: 4000,
      deadlineEpochMs: 1000,
      signal: runtime.signal,
    });
    const selected = await backendDefinition(registration).connect(scope, identity, runtime);
    const result = await backendDefinition(registration).execute({
      operationId: create(AiOperationIdSchema, { value: "op-failed" }),
      call: "support-request",
      scope,
      identity,
      model: selected.model,
      definition,
      input: create(SupportTicketFactsSchema, {
        ticketNumber: { value: "T-9" },
        customerQuestion: "Help?",
      }),
      control: runtime,
    });
    expect(result).toMatchObject({ ok: false, failure: { code, retryableByNewSignal: retryable } });
    expect(network).toHaveBeenCalledTimes(1);
    expect(runtime.recordFailure).toHaveBeenCalledWith(code, retryable);
    expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
      response: { outcome: AiOutcome.FAILED, diagnosticId: { value: "diagnostic-1" } },
    });
  });

  it("uses the pinned OpenAI Responses constructor through the guarded fetch", async () => {
    const events = [
      {
        type: "response.created",
        response: { id: "resp-1", created_at: 1, model: identity.model },
      },
      {
        type: "response.output_text.delta",
        item_id: "msg-1",
        delta: '{"replyText":"Provider reply"}',
      },
      {
        type: "response.completed",
        response: {
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(events, { headers: { "content-type": "text/event-stream" } }),
      );
    const registration = VercelAx.model({
      ref: ModelRef.of("draft-support-reply", "r1"),
      capabilities: VercelAx.capabilities.openAIResponses(),
      platformFetch: network,
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect: (_scope, _expected, runtime) => ({
        model: createOpenAI({
          apiKey: "fixture",
          baseURL: identity.endpoint,
          fetch: runtime.fetch,
        }).responses(identity.model),
        identity,
      }),
    });
    const definition = executionDefinition(
      AiModel.define({
        name: "draft-support-reply",
        version: "v1",
        kind: "generation",
        input: SupportTicketFactsSchema,
        output: ProposedSupportReplySchema,
        instructions: "Draft a reply",
        outputMode: "native-schema",
        limits: {
          modelRequests: 1,
          toolCalls: 0,
          deadlineMs: 900,
          maxInputBytes: 4000,
          maxOutputBytes: 4000,
          maxOutputTokens: 100,
        },
      }).definition,
    );
    const runtime = control();
    vi.mocked(runtime.beginAttempt).mockResolvedValue({
      id: "openai-1",
      maxInputBytes: 4000,
      maxOutputBytes: 4000,
      deadlineEpochMs: 1000,
      signal: runtime.signal,
    });
    vi.mocked(runtime.admitGeneration).mockReturnValue({
      ok: true,
      value: create(ProposedSupportReplySchema, { replyText: "Provider reply" }),
    });
    const selected = await backendDefinition(registration).connect(scope, identity, runtime);
    const result = await backendDefinition(registration).execute({
      operationId: create(AiOperationIdSchema, { value: "op-openai" }),
      call: "support-request",
      scope,
      identity,
      model: selected.model,
      definition,
      input: create(SupportTicketFactsSchema, {
        ticketNumber: { value: "T-8" },
        customerQuestion: "What is the status?",
      }),
      control: runtime,
    });
    expect(result).toMatchObject({ ok: true, value: { replyText: "Provider reply" } });
    expect(network).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runtime.reserveTransport).mock.calls).toHaveLength(1);
    expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
      response: {
        actualModel: { value: identity.model },
        usage: { inputTokens: { value: 5n }, outputTokens: { value: 3n } },
      },
    });
  });

  it.each(["admitted", "invalid", "unavailable", "boolean", "score", "no-usage"] as const)(
    "sends one actual Jev decision request with outcome %s",
    async (mode) => {
      const success = mode !== "invalid" && mode !== "unavailable";
      const question =
        mode === "boolean"
          ? { type: "boolean" as const, instructions: "Is this safe?" }
          : mode === "score"
            ? {
                type: "score" as const,
                instructions: "Rate urgency",
                criteria: ["Routine", "Urgent"],
              }
            : {
                type: "choice" as const,
                instructions: "Select support queue",
                criteria: { "tier-one": "General support", "tier-two": "Specialist support" },
              };
      const answer =
        mode === "boolean"
          ? { type: "noul", noul: 0.8 }
          : mode === "score"
            ? { type: "score", score: 0.7, probabilities: { "0": 0.3, "1": 0.7 } }
            : {
                type: "choice",
                choice: "tier-one",
                probabilities: { "tier-one": 0.75, "tier-two": 0.25 },
              };
      const decisionIdentity = {
        ...identity,
        provider: "openrouter",
        endpoint: "https://provider.example/alpha",
        model: "typesafe/jev-1.13",
      };
      const network = vi.fn<typeof fetch>().mockResolvedValue(
        mode === "unavailable"
          ? new Response('{"error":"temporary"}', {
              status: 500,
              headers: { "content-type": "application/json" },
            })
          : new Response(
              JSON.stringify({
                answers: { lane: answer },
                ...(mode === "no-usage" ? {} : { usage: { input_tokens: 0 } }),
              }),
              { headers: { "content-type": "application/json" } },
            ),
      );
      const registration = VercelDecision.model({
        ref: ModelRef.of("support-routing", "r1"),
        capabilities: VercelDecision.capabilities.openRouterJev(),
        platformFetch: network,
        resolveIdentity: () => decisionIdentity,
        authorizeUse: () => true,
        connect: (_scope, _expected, runtime) => ({
          model: createOpenRouter({
            apiKey: "fixture",
            decisionsBaseURL: decisionIdentity.endpoint,
            fetch: runtime.fetch,
          }).evaluationModel(decisionIdentity.model),
          identity: decisionIdentity,
        }),
      });
      const definition = executionDefinition(
        AiModel.define({
          name: "support-routing",
          version: "v1",
          kind: "decision",
          input: SupportTicketFactsSchema,
          output: SupportRoutingResultSchema,
          limits: {
            modelRequests: 1,
            toolCalls: 0,
            deadlineMs: 900,
            maxInputBytes: 2000,
            maxOutputBytes: 2000,
          },
          questions: { lane: question },
          mapping: {
            version: "v1",
            toMessage: () => create(SupportRoutingResultSchema, { queue: { value: "tier-one" } }),
          },
        }).definition,
      );
      const runtime = control();
      vi.mocked(runtime.beginAttempt).mockResolvedValue({
        id: "decision-1",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 1000,
        signal: runtime.signal,
      });
      vi.mocked(runtime.admitDecision).mockReturnValue(
        success
          ? {
              ok: true,
              value: create(SupportRoutingResultSchema, { queue: { value: "tier-one" } }),
            }
          : {
              ok: false,
              issues: [
                { code: "INVALID_OUTPUT", path: "answers.lane", message: "Invalid decision" },
              ],
            },
      );
      const selected = await backendDefinition(registration).connect(
        scope,
        decisionIdentity,
        runtime,
      );
      const result = await backendDefinition(registration).execute({
        operationId: create(AiOperationIdSchema, { value: "decision-op" }),
        call: "support-request",
        scope,
        identity: decisionIdentity,
        model: selected.model,
        definition,
        input: create(SupportTicketFactsSchema, {
          ticketNumber: { value: "T-7" },
          customerQuestion: "Where is it?",
        }),
        control: runtime,
      });
      if (success)
        expect(result).toMatchObject({ ok: true, value: { queue: { value: "tier-one" } } });
      else
        expect(result).toMatchObject({
          ok: false,
          failure: { code: mode === "invalid" ? "INVALID_OUTPUT" : "UNAVAILABLE" },
        });
      expect(network).toHaveBeenCalledTimes(1);
      expect(vi.mocked(runtime.reserveTransport).mock.calls).toHaveLength(1);
      const sent = network.mock.calls[0]?.[1]?.body;
      if (!(sent instanceof Uint8Array)) throw new Error("Expected bounded request bytes");
      const body = JSON.parse(new TextDecoder().decode(sent)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "typesafe/jev-1.13",
        questions: { lane: { type: mode === "boolean" ? "noul" : question.type } },
      });
      if (mode === "unavailable") expect(runtime.admitDecision).not.toHaveBeenCalled();
      else
        expect(runtime.admitDecision).toHaveBeenCalledWith(
          expect.anything(),
          definition,
          expect.anything(),
          { probabilityDecimals: 2, scoreDecimals: 2 },
        );
      expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
        response: {
          outcome: success
            ? AiOutcome.ADMITTED
            : mode === "invalid"
              ? AiOutcome.INVALID_OUTPUT
              : AiOutcome.FAILED,
        },
      });
      if (mode !== "unavailable") {
        const response = vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0].response;
        if (!response) throw new Error("Expected recorded decision response");
        expect(response).toMatchObject({ rounding: { probabilityDecimals: 2, scoreDecimals: 2 } });
        if (mode === "no-usage") expect(response.usage).toBeUndefined();
        else expect(response.usage).toMatchObject({ inputTokens: { value: 0n } });
      }
      if (mode === "invalid")
        expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
          issues: [{ code: "INVALID_OUTPUT", path: "answers.lane", message: "Invalid decision" }],
          response: { diagnosticId: { value: "diagnostic-1" } },
        });
    },
  );

  it.each([AiOutcome.ADMITTED, AiOutcome.FAILED, AiOutcome.UNKNOWN])(
    "journals a proposal before runtime tool outcome %s",
    async (toolOutcome) => {
      let stream = 0;
      let scopedFetch!: typeof fetch;
      const network = vi
        .fn<typeof fetch>()
        .mockImplementation(() => Promise.resolve(new Response("ok")));
      const backend = new MockLanguageModelV3({
        doStream: async () => {
          const response = await scopedFetch("https://provider.example/v1/responses", {
            method: "POST",
            body: "{}",
          });
          await response.text();
          return {
            stream: new ReadableStream({
              start(controller) {
                if (stream++ === 0) {
                  if (toolOutcome === AiOutcome.ADMITTED)
                    controller.enqueue({
                      type: "text-delta",
                      id: "preface",
                      delta: "Checking policy",
                    });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "provider-1",
                    toolName: "tool_0",
                    input: '{"ticket":"T-1"}',
                  });
                  controller.enqueue({
                    type: "finish",
                    finishReason: { unified: "tool-calls", raw: "tool-calls" },
                    usage: unknownUsage,
                  });
                } else {
                  controller.enqueue({
                    type: "text-delta",
                    id: "t",
                    delta: '{"replyText":"Done"}',
                  });
                  controller.enqueue({
                    type: "finish",
                    finishReason: { unified: "stop", raw: "stop" },
                    usage: sdkUsage(4, 2),
                  });
                }
                controller.close();
              },
            }),
          };
        },
      });
      const registration = VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities: VercelAx.capabilities.openAIResponses(),
        platformFetch: network,
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: (_scope, _expected, runtime) => {
          scopedFetch = runtime.fetch;
          return { model: backend, identity };
        },
      });
      const definition = executionDefinition(
        AiModel.define({
          name: "draft-support-reply",
          version: "v1",
          kind: "generation",
          input: SupportTicketFactsSchema,
          output: ProposedSupportReplySchema,
          instructions: "Draft a reply",
          outputMode: "native-schema",
          tools: [{ server: "support", tool: "lookup" }],
          limits: {
            modelRequests: 2,
            toolCalls: 1,
            deadlineMs: 900,
            maxInputBytes: 2000,
            maxOutputBytes: 2000,
            maxOutputTokens: 100,
          },
        }).definition,
      );
      const runtime = control();
      let release!: () => void;
      vi.mocked(runtime.finishAttempt).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      vi.mocked(runtime.beginAttempt)
        .mockResolvedValueOnce({
          id: "attempt-1",
          maxInputBytes: 2000,
          maxOutputBytes: 2000,
          deadlineEpochMs: 1000,
          signal: runtime.signal,
        })
        .mockResolvedValueOnce({
          id: "attempt-2",
          maxInputBytes: 2000,
          maxOutputBytes: 2000,
          deadlineEpochMs: 1000,
          signal: runtime.signal,
        });
      vi.mocked(runtime.callTool).mockResolvedValue(
        create(ToolResponseSchema, {
          call: create(AiToolCallIdSchema, { value: "spine-call-1" }),
          outcome: toolOutcome,
          text: ["Policy found"],
        }),
      );
      vi.mocked(runtime.admitGeneration).mockReturnValue({
        ok: true,
        value: create(ProposedSupportReplySchema, { replyText: "Done" }),
      });
      const selected = await backendDefinition(registration).connect(scope, identity, runtime);
      const result = backendDefinition(registration).execute({
        operationId: create(AiOperationIdSchema, { value: "op-1" }),
        call: "support-request",
        scope,
        identity,
        model: selected.model,
        definition,
        advertisedTools: [advertisedLookup],
        input: create(SupportTicketFactsSchema, {
          ticketNumber: create(SupportTicketNumberSchema, { value: "T-1" }),
          customerQuestion: "Where is my order?",
        }),
        control: runtime,
      });
      await vi.waitFor(() => {
        expect(runtime.finishAttempt).toHaveBeenCalledTimes(1);
      });
      expect(runtime.callTool).not.toHaveBeenCalled();
      expect(backend.doStreamCalls).toHaveLength(1);
      expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
        ticketId: "attempt-1",
        response: {
          outcome: AiOutcome.TOOL_REQUESTED,
          rawOutput: toolOutcome === AiOutcome.ADMITTED ? "Checking policy" : "",
          toolCalls: [
            { providerCallId: "provider-1", toolName: "tool_0", argumentsJson: '{"ticket":"T-1"}' },
          ],
        },
      });
      expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0].usage).toBeUndefined();
      release();
      const completed = await result;
      expect(runtime.callTool).toHaveBeenCalledTimes(1);
      expect(backend.doStreamCalls).toHaveLength(toolOutcome === AiOutcome.ADMITTED ? 2 : 1);
      if (toolOutcome === AiOutcome.ADMITTED)
        expect(completed).toMatchObject({ ok: true, value: { replyText: "Done" } });
      else
        expect(completed).toMatchObject({
          ok: false,
          failure: {
            code: toolOutcome === AiOutcome.UNKNOWN ? "TOOL_OUTCOME_UNKNOWN" : "TOOL_FAILED",
          },
        });
      expect(runtime.callTool).toHaveBeenCalledWith({
        ticketId: "attempt-1",
        providerCallId: "provider-1",
        server: "support",
        tool: "lookup",
        argumentsJson: '{"ticket":"T-1"}',
      });
      expect(backend.doStreamCalls).toHaveLength(toolOutcome === AiOutcome.ADMITTED ? 2 : 1);
    },
  );

  it.each(["native-schema", "prompt-and-validate"] as const)(
    "uses one controlled model stream and journals a %s Proto output",
    async (outputMode) => {
      const backend = new MockLanguageModelV3({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({
                  type: "text-delta",
                  id: "text",
                  delta: '{"replyText":"Hello"}',
                });
                controller.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: {
                    inputTokens: {
                      total: 3,
                      noCache: 3,
                      cacheRead: undefined,
                      cacheWrite: undefined,
                    },
                    outputTokens: { total: 2, text: 2, reasoning: undefined },
                  },
                });
                controller.close();
              },
            }),
          }),
      });
      const registration = VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities: VercelAx.capabilities.openAIResponses(),
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: () => ({ model: backend, identity }),
      });
      const definition = executionDefinition(
        AiModel.define({
          name: "draft-support-reply",
          version: "v1",
          kind: "generation",
          input: SupportTicketFactsSchema,
          output: ProposedSupportReplySchema,
          instructions: "Draft a reply",
          outputMode,
          limits: {
            modelRequests: 1,
            toolCalls: 0,
            deadlineMs: 900,
            maxInputBytes: 2000,
            maxOutputBytes: 2000,
            maxOutputTokens: 100,
          },
        }).definition,
      );
      const runtime = control();
      const input = create(SupportTicketFactsSchema, {
        ticketNumber: create(SupportTicketNumberSchema, { value: "T-1" }),
        customerQuestion: "When will my order arrive?",
      });
      vi.mocked(runtime.beginAttempt).mockResolvedValue({
        id: "attempt-1",
        maxInputBytes: 2000,
        maxOutputBytes: 2000,
        deadlineEpochMs: 1000,
        signal: runtime.signal,
      });
      vi.mocked(runtime.admitGeneration).mockReturnValue({
        ok: true,
        value: create(ProposedSupportReplySchema, { replyText: "Hello" }),
      });
      const selected = await backendDefinition(registration).connect(scope, identity, runtime);
      const result = await backendDefinition(registration).execute({
        operationId: create(AiOperationIdSchema, { value: "op-1" }),
        call: "support-request",
        scope,
        identity,
        model: selected.model,
        definition,
        input,
        control: runtime,
      });
      expect(result).toMatchObject({ ok: true, value: { replyText: "Hello" } });
      expect(backend.doStreamCalls).toHaveLength(1);
      expect(backend.doStreamCalls[0]?.responseFormat?.type).toBe(
        outputMode === "native-schema" ? "json" : "text",
      );
      if (outputMode === "prompt-and-validate")
        expect(JSON.stringify(backend.doStreamCalls[0]?.prompt)).toContain("replyText");
      expect(backend.doGenerateCalls).toHaveLength(0);
      const actualRequest = vi.mocked(runtime.beginAttempt).mock.calls[0]?.[0];
      if (actualRequest?.kind !== "generation") throw new Error("Expected generation request");
      expect(actualRequest.content.instructions).toContain("Draft a reply");
      expect(vi.mocked(runtime.finishAttempt).mock.calls[0]?.[0]).toMatchObject({
        response: {
          rawOutput: '{"replyText":"Hello"}',
          usage: create(AiUsageSchema, {
            inputTokens: { value: 3n },
            outputTokens: { value: 2n },
          }),
        },
      });
    },
  );

  it("keeps provider fetch inert until a physical attempt and rejects identity drift", async () => {
    const network = vi.fn<typeof fetch>();
    let scopedFetch!: typeof fetch;
    const registration = VercelAx.model({
      ref: ModelRef.of("draft-support-reply", "r1"),
      capabilities: VercelAx.capabilities.openAIResponses(),
      platformFetch: network,
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect: (_scope, _expected, runtime) => {
        scopedFetch = runtime.fetch;
        return {
          model: new MockLanguageModelV3({}),
          identity: { ...identity, account: "different-account" },
        };
      },
    });
    const backend = backendDefinition(registration);
    await expect(backend.connect(scope, identity, control())).rejects.toThrow("identity");
    await expect(scopedFetch("https://provider.example/v1/responses")).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });

  it("times out a connection callback that ignores its signal", async () => {
    const registration = VercelAx.model({
      ref: ModelRef.of("draft-support-reply", "r1"),
      capabilities: VercelAx.capabilities.openAIResponses(),
      platformFetch: vi.fn<typeof fetch>(),
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect: () => new Promise(() => undefined),
    });
    const runtime = control();
    const started = Date.now();
    await expect(
      backendDefinition(registration).connect(scope, identity, {
        ...runtime,
        deadlineEpochMs: 101,
        nowEpochMs: () => 100 + Date.now() - started,
      }),
    ).rejects.toThrow("deadline");
  });

  it("does not falsely expire a long pending connection timer", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const registration = VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities: VercelAx.capabilities.openAIResponses(),
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: () => new Promise(() => undefined),
      });
      let settled = false;
      const runtime = {
        ...control(),
        signal: controller.signal,
        deadlineEpochMs: 100 + 2_147_483_648,
      };
      const pending = Promise.resolve(
        backendDefinition(registration).connect(scope, identity, runtime),
      );
      void pending
        .finally(() => {
          settled = true;
        })
        .catch(() => undefined);
      await vi.advanceTimersByTimeAsync(20);
      expect(settled).toBe(false);
      controller.abort();
      await expect(pending).rejects.toThrow("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["aborted", "expired"] as const)(
    "rejects an %s connection before constructing a provider",
    async (reason) => {
      const connect = vi.fn(() => ({ model: new MockLanguageModelV3({}), identity }));
      const registration = VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities: VercelAx.capabilities.openAIResponses(),
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect,
      });
      const controller = new AbortController();
      if (reason === "aborted") controller.abort();
      const runtime = {
        ...control(),
        signal: controller.signal,
        deadlineEpochMs: reason === "expired" ? 100 : 1000,
      };
      await expect(
        backendDefinition(registration).connect(scope, identity, runtime),
      ).rejects.toThrow();
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it("rejects a mismatched provider capability route before connection", () => {
    expect(() =>
      VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities: { ...VercelAx.capabilities.openAIResponses(), routeSuffix: "/decisions" },
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: () => ({ model: new MockLanguageModelV3({}), identity }),
      }),
    ).toThrow("capabilities");
  });

  it("rejects fabricated provider handles and decision capability routes", () => {
    for (const handle of [null, "model", {}])
      expect(() => providerConnection(handle)).toThrow("not from this adapter");
    expect(() =>
      VercelDecision.model({
        ref: ModelRef.of("support-routing", "r1"),
        capabilities: { ...VercelDecision.capabilities.openRouterJev(), routeSuffix: "/responses" },
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: () => ({
          model: createOpenRouter({ apiKey: "fixture" }).evaluationModel("typesafe/jev-1.13"),
          identity,
        }),
      }),
    ).toThrow("capabilities");
  });

  it("rejects incomplete and changed versioned capability declarations", () => {
    const tested = VercelAx.capabilities.openAIResponses();
    expect(tested).toMatchObject({
      providerProtocol: "openai-responses-stream-v1",
      boundedFetchRevision: "spine-bounded-fetch-v1",
      outputContract: "native-json-or-prompt-validate-v1",
      cancellationContract: "ticket-abort-and-deadline-v1",
      retryContract: "one-provider-call-per-ticket-v1",
    });
    const registration = (capabilities: typeof tested) =>
      VercelAx.model({
        ref: ModelRef.of("draft-support-reply", "r1"),
        capabilities,
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: () => ({ model: new MockLanguageModelV3({}), identity }),
      });
    expect(() =>
      registration({ id: tested.id, routeSuffix: tested.routeSuffix } as typeof tested),
    ).toThrow("capabilities");
    expect(() =>
      registration({
        ...tested,
        boundedFetchRevision: "changed" as typeof tested.boundedFetchRevision,
      }),
    ).toThrow("capabilities");
    expect(() => registration(tested)).not.toThrow();
    expect(VercelDecision.capabilities.openRouterJev()).toMatchObject({
      providerProtocol: "openrouter-jev-decisions-v1",
      outputContract: "typed-decision-v1",
    });
  });

  it("revokes a connection when its deadline expires after callback entry", async () => {
    let scopedFetch!: typeof fetch;
    const connect = vi.fn((_scope, _expected, control: VercelConnectControl) => {
      scopedFetch = control.fetch;
      return { model: new MockLanguageModelV3({}), identity };
    });
    const registration = VercelAx.model({
      ref: ModelRef.of("draft-support-reply", "r1"),
      capabilities: VercelAx.capabilities.openAIResponses(),
      resolveIdentity: () => identity,
      authorizeUse: () => true,
      connect,
    });
    let reads = 0;
    const runtime = {
      ...control(),
      deadlineEpochMs: 100,
      nowEpochMs: () => (++reads === 1 ? 99 : 100),
    };
    await expect(backendDefinition(registration).connect(scope, identity, runtime)).rejects.toThrow(
      "deadline",
    );
    expect(connect).toHaveBeenCalledTimes(1);
    await expect(scopedFetch("https://provider.example/v1/responses")).rejects.toThrow();
  });
});
