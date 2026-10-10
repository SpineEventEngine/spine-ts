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

import { describe, expect, it } from "vitest";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import {
  collectModelStream,
  StreamCollectionError,
  type StreamModel,
} from "../src/adapter/streamed-model.js";

const modelWith = (parts: readonly LanguageModelV3StreamPart[]): StreamModel =>
  ({
    specificationVersion: "v3",
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      }),
  }) as unknown as StreamModel;

const finish = {
  type: "finish" as const,
  finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: undefined, reasoning: undefined },
  },
};

describe("bounded Anthropic stream collection", () => {
  it("retains signed, redacted, empty, text and tool blocks in exact start order", async () => {
    const result = await collectModelStream(
      modelWith([
        { type: "reasoning-start", id: "0" },
        {
          type: "reasoning-delta",
          id: "0",
          delta: "",
          providerMetadata: { anthropic: { signature: "sig-" } },
        },
        {
          type: "reasoning-delta",
          id: "0",
          delta: "",
          providerMetadata: { anthropic: { signature: "one" } },
        },
        { type: "reasoning-end", id: "0" },
        { type: "tool-input-start", id: "call-1", toolName: "tool_0" },
        { type: "tool-input-delta", id: "call-1", delta: "{}" },
        { type: "tool-input-end", id: "call-1" },
        { type: "tool-call", toolCallId: "call-1", toolName: "tool_0", input: "{}" },
        {
          type: "reasoning-start",
          id: "2",
          providerMetadata: { anthropic: { redactedData: "cipher" } },
        },
        { type: "reasoning-end", id: "2" },
        { type: "text-start", id: "3" },
        { type: "text-delta", id: "3", delta: "after" },
        { type: "text-end", id: "3" },
        finish,
      ]),
      { prompt: [] },
      1024,
      undefined,
      true,
    );
    expect(result.anthropicContent).toEqual([
      { type: "thinking", text: "", signature: "sig-one" },
      { type: "tool-call", call: { id: "call-1", name: "tool_0", input: "{}" } },
      { type: "redacted-thinking", data: "cipher" },
      { type: "text", text: "after" },
    ]);
    expect(result.text).toBe("after");
  });

  it("rejects missing signatures and empty-block floods before tool dispatch", async () => {
    const unsigned = modelWith([
      { type: "reasoning-start", id: "0" },
      { type: "reasoning-end", id: "0" },
      finish,
    ]);
    await expect(
      collectModelStream(unsigned, { prompt: [] }, 1024, undefined, true),
    ).rejects.toMatchObject({ message: "Anthropic thinking signature missing" });
    const flood = modelWith(
      Array.from({ length: 9 }, (_, index): LanguageModelV3StreamPart => ({
        type: "text-start",
        id: String(index),
      })),
    );
    await expect(
      collectModelStream(flood, { prompt: [] }, 512, undefined, true),
    ).rejects.toBeInstanceOf(StreamCollectionError);
  });

  it("keeps bounded tool input and its proposal projection equal after a crossing delta", async () => {
    const model = modelWith([
      { type: "tool-input-start", id: "call-1", toolName: "tool_0" },
      { type: "tool-input-delta", id: "call-1", delta: "ab" },
      { type: "tool-input-delta", id: "call-1", delta: "over-limit" },
    ]);
    try {
      await collectModelStream(model, { prompt: [] }, 64 + 6 + 6 + 2, undefined, true);
      throw new Error("Expected parsed-output limit failure");
    } catch (error) {
      expect(error).toBeInstanceOf(StreamCollectionError);
      if (!(error instanceof StreamCollectionError)) throw error;
      expect(error.partial.toolCalls).toEqual([{ id: "call-1", name: "tool_0", input: "ab" }]);
      expect(error.partial.anthropicContent?.at(0)).toEqual({
        type: "tool-call",
        call: { id: "call-1", name: "tool_0", input: "ab" },
      });
    }
  });

  it("rejects provider text metadata that cannot be replayed as plain text", async () => {
    const compaction = modelWith([
      { type: "text-start", id: "0", providerMetadata: { anthropic: { type: "compaction" } } },
      { type: "text-delta", id: "0", delta: "summary" },
      { type: "text-end", id: "0" },
      finish,
    ]);
    await expect(
      collectModelStream(compaction, { prompt: [] }, 1024, undefined, true),
    ).rejects.toMatchObject({ message: "Unsupported Anthropic text metadata" });
  });

  it("rejects reused content IDs and misplaced reasoning metadata before any proposal", async () => {
    const reused = modelWith([
      { type: "text-start", id: "block-1" },
      { type: "text-end", id: "block-1" },
      { type: "reasoning-start", id: "block-1" },
      finish,
    ]);
    await expect(
      collectModelStream(reused, { prompt: [] }, 1024, undefined, true),
    ).rejects.toMatchObject({ message: "Duplicate Anthropic content start" });
    const signedAtStart = modelWith([
      {
        type: "reasoning-start",
        id: "block-2",
        providerMetadata: { anthropic: { signature: "misplaced" } },
      },
      finish,
    ]);
    await expect(
      collectModelStream(signedAtStart, { prompt: [] }, 1024, undefined, true),
    ).rejects.toMatchObject({ message: "Anthropic reasoning start metadata invalid" });
    const redactedDelta = modelWith([
      { type: "reasoning-start", id: "block-3" },
      {
        type: "reasoning-delta",
        id: "block-3",
        delta: "thinking",
        providerMetadata: { anthropic: { redactedData: "misplaced" } },
      },
      finish,
    ]);
    await expect(
      collectModelStream(redactedDelta, { prompt: [] }, 1024, undefined, true),
    ).rejects.toMatchObject({ message: "Anthropic reasoning delta metadata invalid" });
  });
});
