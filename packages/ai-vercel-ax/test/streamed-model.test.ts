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
