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

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions as V3Options,
  LanguageModelV3StreamPart as V3Part,
  LanguageModelV4,
  LanguageModelV4CallOptions as V4Options,
  LanguageModelV4StreamPart as V4Part,
} from "@ai-sdk/provider";
import { APICallError } from "ai";
import { scheduleBoundedDeadline } from "./deadline.js";

/**
 * A provider call exposed only through the pinned direct streaming interface.
 */
export type StreamModel = LanguageModelV3 | LanguageModelV4;

/**
 * One complete tool call emitted by a model stream.
 */
export interface StreamToolCall {
  /**
   * Provider call identity for continuation correlation.
   */
  readonly id: string;

  /**
   * Declared provider-facing tool name.
   */
  readonly name: string;

  /**
   * Complete JSON tool input, subject to runtime validation.
   */
  readonly input: string;
}

/**
 * Bounded parsed output and provider-reported usage.
 */
export interface StreamedModelResult {
  /**
   * Exact accumulated model text within the parsed-output allowance.
   */
  readonly text: string;

  /**
   * Complete client-executed calls, if emitted.
   */
  readonly toolCalls: readonly StreamToolCall[];

  /**
   * Complete provider stop state.
   */
  readonly finishReason: "stop" | "tool-calls";

  /**
   * Provider-reported token counts, absent when both are unknown.
   */
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };

  /**
   * Concrete provider model, when reported.
   */
  readonly actualModelId?: string;
}

/**
 * Received bounded content retained when a provider stream cannot complete.
 */
export type StreamedPartialResult = Omit<StreamedModelResult, "finishReason"> & {
  /**
   * Provider stop state when supplied, including rejected truncation/refusal.
   */
  readonly finishReason?: string;
};

/**
 * Safe stream failure carrying already received bounded content.
 */
export class StreamCollectionError extends Error {
  /**
   * Already received bounded text, proposals, and usage.
   */
  readonly partial: StreamedPartialResult;

  /**
   * HTTP status reported by the pinned SDK, when safely available.
   */
  readonly statusCode?: number;

  /**
   * Creates a safe error with bounded received content.
   * @param reason Fixed adapter diagnostic without vendor exception data.
   * @param partial Bounded provider content received before the failure.
   * @param statusCode Safe HTTP status if the provider SDK exposed it.
   */
  constructor(reason: string, partial: StreamedPartialResult, statusCode?: number) {
    super(reason);
    this.partial = partial;
    if (statusCode !== undefined) this.statusCode = statusCode;
  }
}

type Part = V3Part | V4Part;
type Options = V3Options | V4Options;
interface StreamDeadline {
  readonly deadlineEpochMs: number;
  readonly nowEpochMs: () => number;
}

/**
 * Creates a local deadline signal for provider callbacks that ignore their input signal.
 * @param source Ticket cancellation signal.
 * @param deadline Runtime ticket deadline and clock.
 * @returns Linked signal, expiry state, and timer cleanup.
 */
const deadlineSignal = (source: AbortSignal | undefined, deadline: StreamDeadline) => {
  const controller = new AbortController();
  const remaining = deadline.deadlineEpochMs - deadline.nowEpochMs();
  let expired = !Number.isFinite(remaining) || remaining <= 0;
  const abort = () => {
    controller.abort();
  };
  if (source?.aborted || expired) abort();
  source?.addEventListener("abort", abort, { once: true });
  const cancelTimer = expired
    ? undefined
    : scheduleBoundedDeadline(deadline.deadlineEpochMs, deadline.nowEpochMs, () => {
        expired = true;
        abort();
      });
  return {
    signal: controller.signal,
    expired: () => expired,
    dispose: () => {
      cancelTimer?.();
      source?.removeEventListener("abort", abort);
    },
  };
};
interface State {
  text: string;
  toolCalls: StreamToolCall[];
  bytes: number;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  actualModelId?: string;
}

/**
 * @param state Current bounded stream state.
 * @returns Immutable partial receipt.
 */
const partial = (state: State): StreamedPartialResult => ({
  text: state.text,
  toolCalls: [...state.toolCalls],
  ...(state.finishReason ? { finishReason: state.finishReason } : {}),
  ...(state.usage ? { usage: state.usage } : {}),
  ...(state.actualModelId ? { actualModelId: state.actualModelId } : {}),
});

/**
 * @param state Current stream.
 * @param reason Safe failure category.
 */
const fail = (state: State, reason: string, statusCode?: number): never => {
  throw new StreamCollectionError(reason, partial(state), statusCode);
};

/**
 * Categorizes a bounded local stream interruption without provider error text.
 * @param signal Linked cancellation signal.
 * @param expired Whether the ticket deadline elapsed.
 * @returns Safe failure reason.
 */
const failureReason = (signal: AbortSignal | undefined, expired: boolean): string =>
  expired
    ? "Provider request deadline exceeded"
    : signal?.aborted
      ? "Provider request cancelled"
      : "Provider stream failed";

/**
 * Opens one provider stream and closes a stream that appears after cancellation.
 * @param model Pinned direct-stream provider.
 * @param options Matching published call options.
 * @param signal Linked cancellation signal.
 * @returns Provider stream while the ticket is active.
 */
const openBoundedStream = async (
  model: StreamModel,
  options: Options,
  signal: AbortSignal | undefined,
) => {
  const pending = openStream(model, options);
  try {
    return await raceAbort(pending, signal);
  } catch (error) {
    void pending
      .then(
        ({ stream }) => stream.cancel().catch(() => undefined),
        () => undefined,
      )
      .catch(() => undefined);
    throw error;
  }
};

/**
 * Reads one direct provider stream without the AI SDK's accumulated text helpers.
 *
 * @param model Pinned V3 or V4 provider model bound to guarded fetch.
 * @param options Provider-native prompt, schema and cancellation settings.
 * @param maxParsedBytes Bound for retained decoded text and tool input.
 * @param deadline Optional runtime ticket deadline for ignored provider cancellation.
 * @returns Complete text, tool calls, finish state and known usage.
 */
export const collectModelStream = async (
  model: StreamModel,
  options: Options,
  maxParsedBytes: number,
  deadline?: StreamDeadline,
): Promise<StreamedModelResult> => {
  if (!Number.isSafeInteger(maxParsedBytes) || maxParsedBytes < 1)
    throw new TypeError("Parsed output limit is invalid");
  const guard = deadline ? deadlineSignal(options.abortSignal, deadline) : undefined;
  const signal = guard?.signal ?? options.abortSignal;
  const state: State = { text: "", toolCalls: [], bytes: 0 };
  try {
    if (signal?.aborted) fail(state, failureReason(signal, guard?.expired() ?? false));
    const result = await openBoundedStream(
      model,
      guard ? { ...options, abortSignal: guard.signal } : options,
      signal,
    );
    return await readModelStream(result.stream, state, signal, maxParsedBytes, guard?.expired);
  } catch (error) {
    if (error instanceof StreamCollectionError) throw error;
    const statusCode = APICallError.isInstance(error) ? error.statusCode : undefined;
    return fail(state, failureReason(signal, guard?.expired() ?? false), statusCode);
  } finally {
    guard?.dispose();
  }
};

/**
 * Consumes one direct stream while retaining only bounded parsed content.
 * @param stream Provider-native response stream.
 * @param state Current bounded receipt.
 * @param signal Attempt cancellation.
 * @param maxParsedBytes Maximum retained parsed output bytes.
 * @param deadlineExpired Whether the local ticket deadline elapsed.
 * @returns Complete provider response and known usage.
 */
const readModelStream = async (
  stream: ReadableStream<Part>,
  state: State,
  signal: AbortSignal | undefined,
  maxParsedBytes: number,
  deadlineExpired?: () => boolean,
): Promise<StreamedModelResult> => {
  const reader = stream.getReader();
  let complete = false;
  try {
    for (;;) {
      const next = await raceAbort(reader.read(), signal);
      if (next.done) break;
      acceptPart(state, next.value, maxParsedBytes);
    }
    if (!state.finishReason) fail(state, "Provider stream incomplete");
    complete = true;
    return state as StreamedModelResult;
  } catch (error) {
    if (error instanceof StreamCollectionError) throw error;
    return fail(
      state,
      deadlineExpired?.()
        ? "Provider request deadline exceeded"
        : signal?.aborted
          ? "Provider request cancelled"
          : "Provider stream failed",
    );
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

/**
 * Settles promptly when a custom provider ignores an operation abort.
 * @param pending Provider work that may ignore its AbortSignal.
 * @param signal Operation cancellation signal.
 * @typeParam T Pending provider result.
 * @returns Provider value while the operation remains active.
 */
const raceAbort = async <T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
  if (!signal) return pending;
  if (signal.aborted) throw new Error("Provider request cancelled");
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new Error("Provider request cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
};

/**
 * Opens the published provider stream without invoking generate helpers.
 *
 * @param model Pinned provider model.
 * @param options Matching provider call options.
 * @returns Direct provider stream.
 */
const openStream = async (model: StreamModel, options: Options) => {
  if (model.specificationVersion === "v3") return model.doStream(options as V3Options);
  return model.doStream(options as V4Options);
};

/**
 * Accumulates one bounded provider part without retaining raw errors.
 *
 * @param state Current bounded model output.
 * @param part Published provider stream part.
 * @param limit Maximum parsed output bytes.
 */
const acceptPart = (state: State, part: Part, limit: number): void => {
  if (part.type === "text-delta") {
    addBytes(state, part.delta, limit);
    state.text += part.delta;
  } else if (part.type === "tool-call") {
    if (part.providerExecuted || part.dynamic) fail(state, "Provider tool execution unsupported");
    if ([part.toolCallId, part.toolName, part.input].some((value) => typeof value !== "string"))
      fail(state, "Provider tool proposal invalid");
    addBytes(state, part.toolCallId, limit);
    addBytes(state, part.toolName, limit);
    addBytes(state, part.input, limit);
    state.toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input });
  } else if (part.type === "response-metadata") {
    if (part.modelId) state.actualModelId = part.modelId;
  } else if (part.type === "finish") acceptFinish(state, part);
  else if (part.type === "error") fail(state, "Provider stream error");
};

/**
 * Retains one decoded part only while the parsed-output allowance remains.
 *
 * @param state Current output byte count.
 * @param value Decoded text or tool input.
 * @param limit Maximum retained bytes.
 */
const addBytes = (state: State, value: string, limit: number): void => {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > limit - state.bytes) fail(state, "Parsed output limit exceeded");
  state.bytes += bytes;
};

/**
 * Accepts only complete provider finish states and preserves unknown usage.
 *
 * @param state Current model result.
 * @param part Provider finish part.
 */
const acceptFinish = (state: State, part: Extract<Part, { type: "finish" }>): void => {
  if (state.finishReason) fail(state, "Duplicate provider finish");
  const reason = part.finishReason.unified;
  state.finishReason = reason;
  const input = part.usage.inputTokens.total;
  const output = part.usage.outputTokens.total;
  if (input !== undefined || output !== undefined)
    state.usage = {
      ...(input !== undefined ? { inputTokens: input } : {}),
      ...(output !== undefined ? { outputTokens: output } : {}),
    };
  if (reason !== "stop" && reason !== "tool-calls")
    fail(state, `Provider finish reason: ${reason}`);
};
