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

import { AxGen } from "@ax-llm/ax";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { AxVercelBridge } from "../src/adapter/bridge.js";

function tokenUsage(input: number, output: number) {
  return {
    inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

describe("Ax-to-Vercel bridge", () => {
  it("routes native structured generation through the Vercel model with its schema", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Hello"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(8, 4),
        warnings: [],
      },
    });
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );

    const result = await generator.forward(
      service,
      { ticket: "T-1" },
      {
        structuredOutputMode: "native",
        maxRetries: 0,
      },
    );

    expect(result.reply).toBe("Hello");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.responseFormat?.type).toBe("json");
    const responseFormat = model.doGenerateCalls[0]?.responseFormat;
    if (responseFormat?.type !== "json") throw new Error("Expected JSON response format");
    expect(responseFormat.schema).toMatchObject({
      schema: { type: "object", properties: { reply: { type: "string" } } },
    });
  });
  it("lets Ax correct an invalid structured candidate through a second counted request", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          content: [{ type: "text", text: "{}" }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: tokenUsage(3, 1),
          warnings: [],
        },
        {
          content: [{ type: "text", text: '{"reply":"Fixed"}' }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: tokenUsage(5, 2),
          warnings: [],
        },
      ],
    });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    const result = await generator.forward(
      AxVercelBridge.create(model, { maxRequests: 2 }),
      { ticket: "T-2" },
      {
        structuredOutputMode: "native",
        maxRetries: 1,
      },
    );
    expect(result.reply).toBe("Fixed");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain("reply");
  });

  it("blocks correction before a second physical request when the request budget is exhausted", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: "{}" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(3, 1),
        warnings: [],
      },
    });
    const attempts: number[] = [];
    const usage: number[] = [];
    const service = AxVercelBridge.create(model, {
      maxRequests: 1,
      onAttempt: (attempt) => {
        attempts.push(attempt);
      },
      onUsage: (tokens) => {
        usage.push(tokens.totalTokens);
      },
    });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    await expect(
      generator.forward(
        service,
        { ticket: "T-3" },
        {
          structuredOutputMode: "native",
          maxRetries: 1,
        },
      ),
    ).rejects.toThrow("Request budget exhausted");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(attempts).toEqual([1]);
    expect(usage).toEqual([4]);
  });

  it("passes an authorized tool call back to Ax and sends its result in the continuation", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "lookup",
              input: '{"ticket":"T-4"}',
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
          usage: tokenUsage(4, 2),
          warnings: [],
        },
        {
          content: [{ type: "text", text: '{"reply":"Found"}' }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: tokenUsage(5, 3),
          warnings: [],
        },
      ],
    });
    const calls: unknown[] = [];
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    const result = await generator.forward(
      AxVercelBridge.create(model, { maxRequests: 2 }),
      { ticket: "T-4" },
      {
        structuredOutputMode: "native",
        maxRetries: 0,
        maxSteps: 2,
        functions: [
          {
            name: "lookup",
            description: "Look up ticket",
            parameters: {
              type: "object",
              properties: { ticket: { type: "string", description: "Ticket ID" } },
              required: ["ticket"],
            },
            func: (args) => {
              calls.push(args);
              return { found: true };
            },
          },
        ],
      },
    );
    expect(result.reply).toBe("Found");
    expect(calls).toEqual([{ ticket: "T-4" }]);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain("found");
  });

  it("forwards cancellation to the Vercel provider request", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let onProviderEnter: () => void = () => undefined;
    const providerEntered = new Promise<void>((resolve) => {
      onProviderEnter = () => {
        resolve();
      };
    });
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        providerSignal = options.abortSignal;
        onProviderEnter();
        await new Promise<never>((_resolve, reject) => {
          options.abortSignal?.addEventListener("abort", () => {
            reject(new Error("provider aborted"));
          });
        });
        throw new Error("unreachable");
      },
    });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    const pending = generator.forward(
      AxVercelBridge.create(model, { maxRequests: 1 }),
      { ticket: "T-5" },
      {
        structuredOutputMode: "native",
        maxRetries: 0,
        abortSignal: controller.signal,
      },
    );
    await providerEntered;
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(providerSignal?.aborted).toBe(true);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("does not report token counts when the provider omits usage", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Hello"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        warnings: [],
        usage: {
          inputTokens: {
            total: undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined },
        },
      },
    });
    const usage: number[] = [];
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    await generator.forward(
      AxVercelBridge.create(model, {
        maxRequests: 1,
        onUsage: (tokens) => {
          usage.push(tokens.totalTokens);
        },
      }),
      { ticket: "T-6" },
      { structuredOutputMode: "native", maxRetries: 0 },
    );
    expect(usage).toEqual([]);
  });

  it("awaits an asynchronous reservation rejection before provider dispatch", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Unexpected"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(2, 1),
        warnings: [],
      },
    });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    await expect(
      generator.forward(
        AxVercelBridge.create(model, {
          maxRequests: 1,
          onAttempt: () => Promise.reject(new Error("reservation refused")),
        }),
        { ticket: "T-7" },
        { structuredOutputMode: "native", maxRetries: 0 },
      ),
    ).rejects.toThrow("reservation refused");
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("rejects prompt-only requests before reaching the provider", async () => {
    const model = new MockLanguageModelV3();
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    await expect(
      service.chat({ chatPrompt: [{ role: "user", content: "hello" }] }),
    ).rejects.toThrow("Native JSON schema is required");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("rejects non-chat operations and invalid physical-request limits", async () => {
    const model = new MockLanguageModelV3();
    expect(() => AxVercelBridge.create(model, { maxRequests: 0 })).toThrow(
      "maxRequests must be a positive safe integer",
    );
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    expect(service.getFeatures().structuredOutputModes).toEqual(["native"]);
    expect(service.getFeatures().streaming).toBe(false);
    expect(service.getFeatures().functionEmulation).toBe(false);
    expect(service.getModelList()?.[0]).toMatchObject({ model: model.modelId });
    expect(service.getLastUsedChatModel()).toBe(model.modelId);
    await expect(service.embed({ texts: ["x"] })).rejects.toThrow("Embedding is unsupported");
    await expect(service.transcribe({ audio: { data: "", format: "wav" } })).rejects.toThrow(
      "Transcription is unsupported",
    );
    await expect(service.speak({ text: "x" })).rejects.toThrow("Speech is unsupported");
  });

  it("does not retry a provider failure inside the Vercel SDK", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: () => Promise.reject(new Error("transport failed")),
    });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    await expect(
      generator.forward(
        AxVercelBridge.create(model, { maxRequests: 3 }),
        { ticket: "T-8" },
        { structuredOutputMode: "native", maxRetries: 0 },
      ),
    ).rejects.toThrow("transport failed");
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it("rejects unsupported media before the Vercel request", async () => {
    const model = new MockLanguageModelV3();
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    await expect(
      service.chat({
        chatPrompt: [
          { role: "user", content: [{ type: "image", mimeType: "image/png", image: "a" }] },
        ],
        responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
      }),
    ).rejects.toThrow("Only text prompt content is supported by this bridge");
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("awaits usage recording before returning Ax output", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Held"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(2, 1),
        warnings: [],
      },
    });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    await expect(
      generator.forward(
        AxVercelBridge.create(model, {
          maxRequests: 1,
          onUsage: () => Promise.reject(new Error("usage write failed")),
        }),
        { ticket: "T-9" },
        { structuredOutputMode: "native", maxRetries: 0 },
      ),
    ).rejects.toThrow("usage write failed");
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it("does not claim unmeasured Ax cost or latency", () => {
    const service = AxVercelBridge.create(new MockLanguageModelV3(), { maxRequests: 1 });
    expect(() => service.getMetrics()).toThrow("Ax metrics are unavailable");
    expect(() => service.getEstimatedCost()).toThrow("Ax cost is unavailable");
  });
  it("preserves text and structured MCP tool content in a continuation", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Used facts"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(3, 2),
        warnings: [],
      },
    });
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    await service.chat({
      chatPrompt: [
        { role: "user", content: "Find policy" },
        {
          role: "assistant",
          functionCalls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "lookup", params: { ticket: "T-10" } },
            },
          ],
        },
        {
          role: "function",
          functionId: "call-1",
          result: "summary",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
          protocolResult: {
            protocol: { kind: "mcp", namespace: "docs", name: "lookup" },
            value: { policy: "P-1" },
          },
        },
      ],
      responseFormat: {
        type: "json_schema",
        schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
      },
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("first");
    expect(prompt).toContain("second");
    expect(prompt).toContain("P-1");
  });

  it("rejects unsupported MCP image content before provider dispatch", async () => {
    const model = new MockLanguageModelV3();
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    await expect(
      service.chat({
        chatPrompt: [
          {
            role: "assistant",
            functionCalls: [
              { id: "call-2", type: "function", function: { name: "lookup", params: {} } },
            ],
          },
          {
            role: "function",
            functionId: "call-2",
            result: "image",
            content: [{ type: "image", mimeType: "image/png", image: "a" }],
          },
        ],
        responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
      }),
    ).rejects.toThrow("Unsupported tool content");
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("rejects service-wide options that would otherwise be silently ignored", () => {
    const service = AxVercelBridge.create(new MockLanguageModelV3(), { maxRequests: 1 });
    expect(() => {
      service.setOptions({ abortSignal: new AbortController().signal });
    }).toThrow("Service-wide options are unsupported");
  });

  it("rejects tool results whose call identity is absent", async () => {
    const model = new MockLanguageModelV3();
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    await expect(
      service.chat({
        chatPrompt: [{ role: "function", functionId: "missing", result: "x" }],
        responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
      }),
    ).rejects.toThrow("Tool result has no matching call");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("preserves a provider tool error in the continuation", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Stopped"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(2, 1),
        warnings: [],
      },
    });
    const service = AxVercelBridge.create(model, { maxRequests: 1 });
    await service.chat({
      chatPrompt: [
        {
          role: "assistant",
          functionCalls: [
            { id: "bad", type: "function", function: { name: "lookup", params: {} } },
          ],
        },
        { role: "function", functionId: "bad", result: "lookup failed", isError: true },
      ],
      responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("error-text");
    expect(prompt).toContain("lookup failed");
  });
  it("replays string tool arguments and each text result part", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Used text"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(2, 1),
        warnings: [],
      },
    });
    await AxVercelBridge.create(model, { maxRequests: 1 }).chat({
      chatPrompt: [
        {
          role: "assistant",
          functionCalls: [
            {
              id: "text-1",
              type: "function",
              function: { name: "lookup", params: '{"ticket":"T-11"}' },
            },
          ],
        },
        {
          role: "function",
          functionId: "text-1",
          result: "summary",
          content: [
            { type: "text", text: "alpha" },
            { type: "text", text: "beta" },
          ],
        },
      ],
      responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain('"ticket":"T-11"');
    expect(prompt).toContain('"type":"content"');
    expect(prompt).toContain("alpha");
    expect(prompt).toContain("beta");
  });

  it("keeps structured tool errors distinct from successful tool output", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Stopped"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(2, 1),
        warnings: [],
      },
    });
    await AxVercelBridge.create(model, { maxRequests: 1 }).chat({
      chatPrompt: [
        {
          role: "assistant",
          functionCalls: [
            { id: "error-1", type: "function", function: { name: "lookup", params: {} } },
          ],
        },
        {
          role: "function",
          functionId: "error-1",
          result: "failed",
          isError: true,
          protocolResult: {
            protocol: { kind: "mcp", namespace: "docs", name: "lookup" },
            value: { code: "DENIED" },
          },
        },
      ],
      responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain('"type":"error-json"');
    expect(prompt).toContain("DENIED");
  });

  it("rejects an undefined structured tool result before provider dispatch", async () => {
    const model = new MockLanguageModelV3();
    await expect(
      AxVercelBridge.create(model, { maxRequests: 1 }).chat({
        chatPrompt: [
          {
            role: "assistant",
            functionCalls: [
              { id: "missing-1", type: "function", function: { name: "lookup", params: {} } },
            ],
          },
          {
            role: "function",
            functionId: "missing-1",
            result: "missing",
            protocolResult: {
              protocol: { kind: "mcp", namespace: "docs", name: "lookup" },
              value: undefined,
            },
          },
        ],
        responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
      }),
    ).rejects.toThrow("Unsupported structured tool result");
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("does not consume a physical attempt for an invalid preflight request", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"Ready"}' }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: tokenUsage(2, 1),
        warnings: [],
      },
    });
    const attempts: number[] = [];
    const service = AxVercelBridge.create(model, {
      maxRequests: 1,
      onAttempt: (attempt) => {
        attempts.push(attempt);
      },
    });
    await expect(service.chat({ chatPrompt: [{ role: "user", content: "T-12" }] })).rejects.toThrow(
      "Native JSON schema is required",
    );
    expect(attempts).toEqual([]);
    await service.chat({
      chatPrompt: [{ role: "user", content: "T-12" }],
      responseFormat: {
        type: "json_schema",
        schema: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] },
      },
    });
    expect(attempts).toEqual([1]);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it("does not reserve a request already cancelled before dispatch", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new MockLanguageModelV3();
    const attempts: number[] = [];
    const service = AxVercelBridge.create(model, {
      maxRequests: 1,
      onAttempt: (attempt) => {
        attempts.push(attempt);
      },
    });
    await expect(
      service.chat(
        {
          chatPrompt: [{ role: "user", content: "T-13" }],
          responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
        },
        { abortSignal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(attempts).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("returns malformed provider JSON to Ax for correction and records both usages", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          content: [{ type: "text", text: "{" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: tokenUsage(3, 2),
          warnings: [],
        },
        {
          content: [{ type: "text", text: '{"reply":"Fixed"}' }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: tokenUsage(4, 2),
          warnings: [],
        },
      ],
    });
    const usage: number[] = [];
    const result = await new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    ).forward(
      AxVercelBridge.create(model, {
        maxRequests: 2,
        onUsage: ({ totalTokens }) => {
          usage.push(totalTokens);
        },
      }),
      { ticket: "T-14" },
      { structuredOutputMode: "native", maxRetries: 1 },
    );
    expect(result.reply).toBe("Fixed");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(usage).toEqual([5, 6]);
  });

  it("records malformed output usage even when correction is budget-exhausted", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: "{" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(3, 2),
        warnings: [],
      },
    });
    const usage: number[] = [];
    await expect(
      new AxGen<{ ticket: string }, { reply: string }>("ticket: string -> reply: string").forward(
        AxVercelBridge.create(model, {
          maxRequests: 1,
          onUsage: ({ totalTokens }) => {
            usage.push(totalTokens);
          },
        }),
        { ticket: "T-15" },
        { structuredOutputMode: "native", maxRetries: 1 },
      ),
    ).rejects.toThrow("Request budget exhausted");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(usage).toEqual([5]);
  });

  it("propagates usage persistence failure for malformed output", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: "{" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(3, 2),
        warnings: [],
      },
    });
    await expect(
      new AxGen<{ ticket: string }, { reply: string }>("ticket: string -> reply: string").forward(
        AxVercelBridge.create(model, {
          maxRequests: 2,
          onUsage: () => Promise.reject(new Error("usage write failed")),
        }),
        { ticket: "T-16" },
        { structuredOutputMode: "native", maxRetries: 1 },
      ),
    ).rejects.toThrow("usage write failed");
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("does not dispatch if cancellation occurs during attempt reservation", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV3();
    const attempts: number[] = [];
    const service = AxVercelBridge.create(model, {
      maxRequests: 1,
      onAttempt: (attempt) => {
        attempts.push(attempt);
        controller.abort();
        return Promise.resolve();
      },
    });
    await expect(
      service.chat(
        {
          chatPrompt: [{ role: "user", content: "T-17" }],
          responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
        },
        { abortSignal: controller.signal },
      ),
    ).rejects.toThrow("Request aborted");
    expect(attempts).toEqual([1]);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("gives a parameterless Ax function a valid empty object input schema", () => {
    const tools = AxVercelBridge.mapTools({
      chatPrompt: [],
      functions: [{ name: "ping", description: "Check availability" }],
    });
    expect(tools.ping?.inputSchema).toMatchObject({
      jsonSchema: { type: "object", properties: {} },
    });
  });

  it("rejects repeated tool call identities before provider dispatch", async () => {
    const model = new MockLanguageModelV3();
    await expect(
      AxVercelBridge.create(model, { maxRequests: 1 }).chat({
        chatPrompt: [
          {
            role: "assistant",
            functionCalls: [
              { id: "same", type: "function", function: { name: "first", params: {} } },
            ],
          },
          { role: "function", functionId: "same", result: "ok" },
          {
            role: "assistant",
            functionCalls: [
              { id: "same", type: "function", function: { name: "second", params: {} } },
            ],
          },
        ],
        responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
      }),
    ).rejects.toThrow("Duplicate tool call identity");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("rejects parseable provider output stopped by length and records usage", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "text", text: '{"reply":"False success"}' }],
        finishReason: { unified: "length", raw: "length" },
        usage: tokenUsage(3, 2),
        warnings: [],
      },
    });
    const usage: number[] = [];
    await expect(
      new AxGen<{ ticket: string }, { reply: string }>("ticket: string -> reply: string").forward(
        AxVercelBridge.create(model, {
          maxRequests: 1,
          onUsage: ({ totalTokens }) => {
            usage.push(totalTokens);
          },
        }),
        { ticket: "T-18" },
        { structuredOutputMode: "native", maxRetries: 0 },
      ),
    ).rejects.toThrow("Provider finish reason: length");
    expect(usage).toEqual([5]);
  });

  it("preserves assistant text alongside a function call", () => {
    const messages = AxVercelBridge.mapMessages({
      chatPrompt: [
        {
          role: "assistant",
          content: "Searching policy",
          functionCalls: [
            { id: "call-text", type: "function", function: { name: "lookup", params: {} } },
          ],
        },
      ],
    });
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "Searching policy" },
        { type: "tool-call", toolCallId: "call-text", toolName: "lookup" },
      ],
    });
  });
  it.each(["content-filter", "error"] as const)(
    "rejects a %s provider finish state after recording usage",
    async (finish) => {
      const model = new MockLanguageModelV3({
        doGenerate: {
          content: [{ type: "text", text: '{"reply":"Ignored"}' }],
          finishReason: { unified: finish, raw: finish },
          usage: tokenUsage(3, 2),
          warnings: [],
        },
      });
      const usage: number[] = [];
      await expect(
        AxVercelBridge.create(model, {
          maxRequests: 1,
          onUsage: ({ totalTokens }) => {
            usage.push(totalTokens);
          },
        }).chat({
          chatPrompt: [{ role: "user", content: "T-19" }],
          responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
        }),
      ).rejects.toThrow(`Provider finish reason: ${finish}`);
      expect(usage).toEqual([5]);
    },
  );

  it("rejects unsupported user media before provider dispatch", async () => {
    const model = new MockLanguageModelV3();
    await expect(
      AxVercelBridge.create(model, { maxRequests: 1 }).chat({
        chatPrompt: [
          {
            role: "user",
            content: [{ type: "image", mimeType: "image/png", image: "a" }],
          },
        ],
        responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
      }),
    ).rejects.toThrow("Only text prompt content is supported");
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("rejects tool-call-only output that the SDK cannot expose after recording usage", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [{ type: "tool-call", toolCallId: "call-empty", toolName: "lookup", input: "{}" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: tokenUsage(3, 2),
        warnings: [],
      },
    });
    const usage: number[] = [];
    await expect(
      AxVercelBridge.create(model, {
        maxRequests: 1,
        onUsage: ({ totalTokens }) => {
          usage.push(totalTokens);
        },
      }).chat({
        chatPrompt: [{ role: "user", content: "Find policy" }],
        functions: [{ name: "lookup", description: "Look up policy" }],
        responseFormat: { type: "json_schema", schema: { type: "object", properties: {} } },
      }),
    ).rejects.toThrow("No object generated");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(usage).toEqual([5]);
  });
});

describe("controlled Ax bridge dispatch", () => {
  it("uses the required controlled chat delegate for each Ax request", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: () => Promise.reject(new Error("uncontrolled generateText used")),
    });
    const seen: string[] = [];
    const service = AxVercelBridge.createControlled(model, {
      maxRequests: 1,
      onChat: (_model, prepared) => {
        seen.push(prepared.instructions);
        return Promise.resolve({ results: [{ index: 0,
          content: '{"reply":"controlled"}', finishReason: "stop" }] });
      },
    });
    const generator = new AxGen<{ ticket: string }, { reply: string }>(
      "ticket: string -> reply: string",
    );
    const result = await generator.forward(
      service,
      { ticket: "T-9" },
      {
        structuredOutputMode: "native",
        maxRetries: 0,
      },
    );
    expect(result.reply).toBe("controlled");
    expect(seen).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
