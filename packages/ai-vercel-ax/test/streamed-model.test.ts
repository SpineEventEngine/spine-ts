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

import { MockLanguageModelV3, MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { collectModelStream, StreamCollectionError } from "../src/adapter/streamed-model.js";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

function model(parts: LanguageModelV3StreamPart[]) {
  return new MockLanguageModelV3({
    doGenerate: () => Promise.reject(new Error("doGenerate is forbidden")),
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      }),
  });
}

const options = {
  prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "ticket" }] }],
  responseFormat: { type: "json" as const, schema: { type: "object" as const } },
};

describe("direct bounded Vercel model stream", () => {
  it("settles after cancellation when a model ignores its abort signal", async () => {
    const controller = new AbortController();
    const stalled = new MockLanguageModelV3({
      doStream: () => new Promise(() => undefined),
    });
    const result = collectModelStream(stalled, { ...options, abortSignal: controller.signal }, 100);
    controller.abort();
    await expect(result).rejects.toThrow("cancelled");
  });

  it("cancels a stream that resolves only after operation cancellation", async () => {
    const controller = new AbortController();
    let release!: (value: { stream: ReadableStream<LanguageModelV3StreamPart> }) => void;
    const backend = new MockLanguageModelV3({
      doStream: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const pending = collectModelStream(
      backend,
      { ...options, abortSignal: controller.signal },
      100,
    );
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    const cancel = vi.fn();
    release({ stream: new ReadableStream({ cancel }) });
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("bounds a stalled doStream callback by the ticket deadline", async () => {
    const backend = new MockLanguageModelV3({ doStream: () => new Promise(() => undefined) });
    const deadlineEpochMs = Date.now() + 10;
    await expect(
      collectModelStream(backend, options, 100, { deadlineEpochMs, nowEpochMs: () => Date.now() }),
    ).rejects.toThrow("deadline exceeded");
  });

  it("rejects an already expired stream ticket before invoking the provider", async () => {
    const backend = model([]);
    await expect(
      collectModelStream(backend, options, 100, { deadlineEpochMs: 100, nowEpochMs: () => 100 }),
    ).rejects.toThrow("deadline exceeded");
    expect(backend.doStreamCalls).toHaveLength(0);
  });

  it("does not expire a long stream ticket at Node's timer overflow boundary", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const backend = new MockLanguageModelV3({ doStream: () => new Promise(() => undefined) });
      let settled = false;
      const pending = collectModelStream(
        backend,
        { ...options, abortSignal: controller.signal },
        100,
        { deadlineEpochMs: 100 + 2_147_483_648, nowEpochMs: () => 100 },
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

  it("bounds a provider stream that stops delivering parts after opening", async () => {
    const backend = new MockLanguageModelV3({
      doStream: () =>
        Promise.resolve({
          stream: new ReadableStream({ pull: () => new Promise(() => undefined) }),
        }),
    });
    const deadlineEpochMs = Date.now() + 10;
    await expect(
      collectModelStream(backend, options, 100, { deadlineEpochMs, nowEpochMs: () => Date.now() }),
    ).rejects.toThrow("deadline exceeded");
  });

  it("cancels a provider stream that opens only after its deadline", async () => {
    let release!: (value: { stream: ReadableStream<LanguageModelV3StreamPart> }) => void;
    const backend = new MockLanguageModelV3({
      doStream: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const deadlineEpochMs = Date.now() + 10;
    await expect(
      collectModelStream(backend, options, 100, { deadlineEpochMs, nowEpochMs: () => Date.now() }),
    ).rejects.toThrow("deadline exceeded");
    const cancel = vi.fn();
    release({ stream: new ReadableStream({ cancel }) });
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("collects text and known usage through doStream only", async () => {
    const backend = model([
      { type: "text-delta", id: "t", delta: '{"reply":' },
      { type: "text-delta", id: "t", delta: '"hello"}' },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ]);
    const result = await collectModelStream(backend, options, 100);
    expect(result.text).toBe('{"reply":"hello"}');
    expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 2 });
    expect(result.finishReason).toBe("stop");
    expect(backend.doStreamCalls).toHaveLength(1);
    expect(backend.doGenerateCalls).toHaveLength(0);
  });

  it("requires completed ChatGPT Responses and retains ordered reasoning and output items", async () => {
    const items = [
      {
        type: "reasoning",
        id: "reason-1",
        encrypted_content: "encrypted-1",
        summary: [
          { type: "summary_text", text: "first" },
          { type: "summary_text", text: "second" },
        ],
      },
      {
        type: "message",
        role: "assistant",
        id: "message-1",
        phase: "final_answer",
        content: [{ type: "output_text", text: '{"reply":"ok"}', annotations: [] }],
      },
    ];
    const parts: LanguageModelV3StreamPart[] = [
      ...items.flatMap((item, output_index) => [
        {
          type: "raw" as const,
          rawValue: {
            type: "response.output_item.added",
            output_index,
            item: { type: item.type, id: item.id },
          },
        },
        {
          type: "raw" as const,
          rawValue: { type: "response.output_item.done", output_index, item },
        },
      ]),
      { type: "text-delta", id: "message-1", delta: '{"reply":"ok"}' },
      { type: "raw", rawValue: { type: "response.completed", response: {} } },
      { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
    ];
    const result = await collectModelStream(model(parts), options, 500, undefined, false, true);
    expect(result.openaiContent).toEqual({
      complete: true,
      items: [
        {
          id: "reason-1",
          type: "reasoning",
          summary: ["first", "second"],
          encryptedContent: "encrypted-1",
        },
        {
          id: "message-1",
          type: "message",
          phase: "final_answer",
          parts: [{ type: "output_text", text: '{"reply":"ok"}' }],
        },
      ],
    });
    await expect(
      collectModelStream(
        model(
          parts.filter(
            (part) =>
              part.type !== "raw" ||
              (part.rawValue as { type?: string }).type !== "response.completed",
          ),
        ),
        options,
        500,
        undefined,
        false,
        true,
      ),
    ).rejects.toThrow("incomplete");
  });

  it("rejects a second Responses output item that reuses an earlier item ID", async () => {
    const item = {
      type: "message",
      id: "message-1",
      role: "assistant",
      content: [{ type: "output_text", text: "one", annotations: [] }],
    };
    const parts: LanguageModelV3StreamPart[] = [
      {
        type: "raw",
        rawValue: {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id: "message-1" },
        },
      },
      { type: "raw", rawValue: { type: "response.output_item.done", output_index: 0, item } },
      {
        type: "raw",
        rawValue: {
          type: "response.output_item.added",
          output_index: 1,
          item: { type: "message", id: "message-1" },
        },
      },
      { type: "raw", rawValue: { type: "response.output_item.done", output_index: 1, item } },
      { type: "text-delta", id: "message-1", delta: "one" },
      { type: "raw", rawValue: { type: "response.completed", response: {} } },
      { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
    ];
    await expect(
      collectModelStream(model(parts), options, 500, undefined, false, true),
    ).rejects.toBeInstanceOf(StreamCollectionError);
  });

  it("rejects a completed Responses event when an output item remains open", async () => {
    const pending = collectModelStream(
      model([
        {
          type: "raw",
          rawValue: {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: "message-1" },
          },
        },
        { type: "raw", rawValue: { type: "response.completed", response: {} } },
        { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
      ]),
      options,
      500,
      undefined,
      false,
      true,
    );
    await expect(pending).rejects.toThrow("incomplete");
  });

  it("retains a bounded refusal in a failed Responses receipt", async () => {
    const failure = await collectModelStream(
      model([
        {
          type: "raw",
          rawValue: {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: "message-1" },
          },
        },
        {
          type: "raw",
          rawValue: {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "message",
              role: "assistant",
              id: "message-1",
              content: [{ type: "refusal", refusal: "Cannot help" }],
            },
          },
        },
      ]),
      options,
      500,
      undefined,
      false,
      true,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StreamCollectionError);
    expect((failure as StreamCollectionError).partial.openaiContent).toMatchObject({
      complete: false,
      items: [{ id: "message-1", parts: [{ type: "refusal", text: "Cannot help" }] }],
    });
  });

  it("rejects hosted output and annotations that the local plan profile cannot replay", async () => {
    for (const event of [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "web_search_call", id: "hosted-1" },
      },
      {
        type: "response.output_text.annotation.added",
        output_index: 0,
        annotation: { type: "url_citation", url: "https://example.invalid" },
      },
    ]) {
      const failure = await collectModelStream(
        model([{ type: "raw", rawValue: event }]),
        options,
        500,
        undefined,
        false,
        true,
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(StreamCollectionError);
      expect((failure as StreamCollectionError).partial.openaiContent).toEqual({
        items: [],
        complete: false,
      });
      expect(JSON.stringify(failure)).not.toContain("example.invalid");
    }
  });

  it.each([
    ["missing encrypted reasoning", "reasoning", { type: "reasoning", id: "item-1", summary: [] }],
    [
      "provider-executed call",
      "function_call",
      {
        type: "function_call",
        id: "item-1",
        call_id: "call-1",
        name: "tool_0",
        namespace: "spine_mcp",
        arguments: "{}",
        async: true,
      },
    ],
    [
      "annotated message",
      "message",
      {
        type: "message",
        id: "item-1",
        role: "assistant",
        content: [{ type: "output_text", text: "ok", annotations: [{ type: "citation" }] }],
      },
    ],
    [
      "mismatched item ID",
      "message",
      {
        type: "message",
        id: "different",
        role: "assistant",
        content: [{ type: "output_text", text: "ok", annotations: [] }],
      },
    ],
  ])("rejects %s before admitting a typed Responses item", async (_label, type, item) => {
    const failure = await collectModelStream(
      model([
        {
          type: "raw",
          rawValue: {
            type: "response.output_item.added",
            output_index: 0,
            item: { type, id: "item-1" },
          },
        },
        { type: "raw", rawValue: { type: "response.output_item.done", output_index: 0, item } },
        { type: "raw", rawValue: { type: "response.completed", response: {} } },
        { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
      ]),
      options,
      500,
      undefined,
      false,
      true,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StreamCollectionError);
    expect((failure as StreamCollectionError).partial.openaiContent?.complete).toBe(false);
  });

  it("rejects a completed item whose SDK text projection disagrees with the received item", async () => {
    await expect(
      collectModelStream(
        model([
          {
            type: "raw",
            rawValue: {
              type: "response.output_item.added",
              output_index: 0,
              item: { type: "message", id: "item-1" },
            },
          },
          {
            type: "raw",
            rawValue: {
              type: "response.output_item.done",
              output_index: 0,
              item: {
                type: "message",
                id: "item-1",
                role: "assistant",
                content: [{ type: "output_text", text: "trusted", annotations: [] }],
              },
            },
          },
          { type: "text-delta", id: "item-1", delta: "different" },
          { type: "raw", rawValue: { type: "response.completed", response: {} } },
          { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
        ]),
        options,
        500,
        undefined,
        false,
        true,
      ),
    ).rejects.toThrow("projection mismatch");
  });

  it("rejects contradictory Responses terminal and later output events", async () => {
    for (const extra of [
      { type: "response.completed", response: {} },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "late-message" },
      },
    ]) {
      await expect(
        collectModelStream(
          model([
            { type: "raw", rawValue: { type: "response.completed", response: {} } },
            { type: "raw", rawValue: extra },
            { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
          ]),
          options,
          500,
          undefined,
          false,
          true,
        ),
      ).rejects.toThrow("after terminal");
    }
    await expect(
      collectModelStream(
        model([
          {
            type: "raw",
            rawValue: { type: "response.completed", response: { status: "incomplete" } },
          },
          { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
        ]),
        options,
        500,
        undefined,
        false,
        true,
      ),
    ).rejects.toThrow("incomplete");
  });

  it.each(["failed", "incomplete", "unknown"])(
    "rejects a response.completed event with %s status",
    async (status) => {
      await expect(
        collectModelStream(
          model([
            { type: "raw", rawValue: { type: "response.completed", response: { status } } },
            { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
          ]),
          options,
          500,
          undefined,
          false,
          true,
        ),
      ).rejects.toThrow("incomplete");
    },
  );

  it.each(["message", "reasoning", "function_call"])(
    "rejects noncompleted %s output items",
    async (type) => {
      const item =
        type === "message"
          ? { type, id: "item-1", status: "incomplete", role: "assistant", content: [] }
          : type === "reasoning"
            ? {
                type,
                id: "item-1",
                status: "incomplete",
                encrypted_content: "encrypted",
                summary: [],
              }
            : {
                type,
                id: "item-1",
                status: "incomplete",
                call_id: "call-1",
                name: "tool_0",
                namespace: "spine_mcp",
                arguments: "{}",
              };
      await expect(
        collectModelStream(
          model([
            {
              type: "raw",
              rawValue: {
                type: "response.output_item.added",
                output_index: 0,
                item: { type, id: "item-1" },
              },
            },
            { type: "raw", rawValue: { type: "response.output_item.done", output_index: 0, item } },
            { type: "raw", rawValue: { type: "response.completed", response: {} } },
            { type: "finish", finishReason: { unified: "stop", raw: "completed" }, usage },
          ]),
          options,
          500,
          undefined,
          false,
          true,
        ),
      ).rejects.toThrow("incomplete");
    },
  );

  it("retains allowlisted failed Responses codes without vendor prose", async () => {
    const failure = await collectModelStream(
      model([
        { type: "text-delta", id: "msg-1", delta: "partial" },
        {
          type: "raw",
          rawValue: {
            type: "response.failed",
            response: {
              error: {
                code: "subscription_sharing_usage_limit_exceeded",
                message: "private provider prose",
              },
            },
          },
        },
      ]),
      options,
      500,
      undefined,
      false,
      true,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StreamCollectionError);
    expect(failure).toMatchObject({ providerCode: "subscription_sharing_usage_limit_exceeded" });
    expect((failure as StreamCollectionError).partial.text).toBe("partial");
    expect(JSON.stringify(failure)).not.toContain("private provider prose");
  });

  it("bounds an encrypted reasoning item before retaining it", async () => {
    const failure = await collectModelStream(
      model([
        {
          type: "raw",
          rawValue: {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "reasoning", id: "reason-1" },
          },
        },
        {
          type: "raw",
          rawValue: {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "reasoning",
              id: "reason-1",
              status: "completed",
              summary: [],
              encrypted_content: "x".repeat(512),
            },
          },
        },
      ]),
      options,
      200,
      undefined,
      false,
      true,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StreamCollectionError);
    expect((failure as StreamCollectionError).message).toContain("Parsed output limit");
    expect((failure as StreamCollectionError).partial.openaiContent).toEqual({
      complete: false,
      items: [],
    });
  });

  it("preserves tool input and rejects a parseable truncation", async () => {
    const call = await collectModelStream(
      model([
        { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: '{"ticket":"T1"}' },
        { type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage },
      ]),
      options,
      100,
    );
    expect(call.toolCalls).toEqual([{ id: "c1", name: "lookup", input: '{"ticket":"T1"}' }]);
    await expect(
      collectModelStream(
        model([
          { type: "text-delta", id: "t", delta: '{"reply":"fine"}' },
          { type: "finish", finishReason: { unified: "length", raw: "length" }, usage },
        ]),
        options,
        100,
      ),
    ).rejects.toThrow("length");
  });

  it("caps accumulated text and rejects a stream without a finish part", async () => {
    await expect(
      collectModelStream(model([{ type: "text-delta", id: "t", delta: "éé" }]), options, 3),
    ).rejects.toThrow("limit");
    await expect(collectModelStream(model([]), options, 100)).rejects.toThrow("incomplete");
  });

  it("retains malformed ordered proposals and known usage on a rejected finish", async () => {
    const pending = collectModelStream(
      model([
        { type: "text-delta", id: "t", delta: "Need a lookup" },
        { type: "tool-call", toolCallId: "same", toolName: "lookup", input: '{"ticket":' },
        { type: "tool-call", toolCallId: "same", toolName: "", input: "" },
        { type: "finish", finishReason: { unified: "length", raw: "length" }, usage },
      ]),
      options,
      100,
    );
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StreamCollectionError);
    expect((failure as StreamCollectionError).partial).toMatchObject({
      text: "Need a lookup",
      toolCalls: [
        { id: "same", name: "lookup", input: '{"ticket":' },
        { id: "same", name: "", input: "" },
      ],
      usage: { inputTokens: 3, outputTokens: 2 },
    });
  });

  it("counts proposal IDs and names against retained output capacity", async () => {
    await expect(
      collectModelStream(
        model([{ type: "tool-call", toolCallId: "four", toolName: "lookup", input: "{}" }]),
        options,
        10,
      ),
    ).rejects.toThrow("Parsed output limit");
  });

  it("preserves actual model metadata and known zero versus unknown usage", async () => {
    const result = await collectModelStream(
      model([
        { type: "response-metadata", modelId: "served-model" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: {
              total: 0,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: undefined, text: undefined, reasoning: undefined },
          },
        },
      ]),
      options,
      100,
    );
    expect(result.actualModelId).toBe("served-model");
    expect(result.usage).toEqual({ inputTokens: 0 });
  });

  it.each(["providerExecuted", "dynamic"] as const)(
    "rejects model-side %s tool execution",
    async (flag) => {
      const call = {
        type: "tool-call" as const,
        toolCallId: "c1",
        toolName: "lookup",
        input: "{}",
        [flag]: true,
      };
      await expect(collectModelStream(model([call]), options, 100)).rejects.toThrow(
        "Provider tool execution unsupported",
      );
    },
  );

  it("rejects duplicate finishes and provider error parts", async () => {
    const finish: LanguageModelV3StreamPart = {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage,
    };
    await expect(collectModelStream(model([finish, finish]), options, 100)).rejects.toThrow(
      "Duplicate provider finish",
    );
    await expect(
      collectModelStream(model([{ type: "error", error: new Error("private") }]), options, 100),
    ).rejects.toThrow("Provider stream error");
  });

  it("rejects an already aborted stream without invoking the provider", async () => {
    const controller = new AbortController();
    controller.abort();
    const backend = model([]);
    await expect(
      collectModelStream(backend, { ...options, abortSignal: controller.signal }, 100),
    ).rejects.toThrow("cancelled");
    expect(backend.doStreamCalls).toHaveLength(0);
  });

  it("supports the published V4 direct stream without calling generation helpers", async () => {
    const backend = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-delta", id: "t", delta: "ok" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: undefined,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: undefined, reasoning: undefined },
                },
              });
              controller.close();
            },
          }),
        }),
    });
    expect((await collectModelStream(backend, options, 100)).text).toBe("ok");
    expect(backend.doStreamCalls).toHaveLength(1);
  });

  it("preserves output-only usage and keeps wholly unknown usage absent", async () => {
    const finish = (
      input: number | undefined,
      output: number | undefined,
    ): LanguageModelV3StreamPart => ({
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: input,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: output, text: undefined, reasoning: undefined },
      },
    });
    expect((await collectModelStream(model([finish(undefined, 0)]), options, 100)).usage).toEqual({
      outputTokens: 0,
    });
    expect(
      (await collectModelStream(model([finish(undefined, undefined)]), options, 100)).usage,
    ).toBeUndefined();
  });

  it("rejects invalid parsed limits and provider streams that throw while reading", async () => {
    await expect(collectModelStream(model([]), options, 0)).rejects.toThrow("limit");
    const broken = new MockLanguageModelV3({
      doStream: () =>
        Promise.resolve({
          stream: new ReadableStream({
            pull() {
              throw new Error("private body error");
            },
          }),
        }),
    });
    await expect(collectModelStream(broken, options, 100)).rejects.toThrow(
      "Provider stream failed",
    );
  });

  it("does not open a stream if the model aborts during its synchronous start", async () => {
    const controller = new AbortController();
    const backend = new MockLanguageModelV3({
      doStream: () => {
        controller.abort();
        return Promise.resolve({ stream: new ReadableStream() });
      },
    });
    await expect(
      collectModelStream(backend, { ...options, abortSignal: controller.signal }, 100),
    ).rejects.toThrow("cancelled");
  });
});
