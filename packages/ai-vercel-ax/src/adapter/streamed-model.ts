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
 * One received tool proposal, which may be incomplete when the stream fails.
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
   * Provider tool input; complete only after successful stream collection.
   */
  readonly input: string;
}

/**
 * Ordered Anthropic content retained independently of Ax's response projection.
 */
export type AnthropicBlock =
  | {
      /**
       * Text block discriminator.
       */
      type: "text";

      /**
       * Exact provider text, including an empty block.
       */
      text: string;
    }
  | {
      /**
       * Tool block discriminator.
       */
      type: "tool-call";

      /**
       * Provider tool proposal at this block position.
       */
      call: StreamToolCall;
    }
  | {
      /**
       * Signed thinking block discriminator.
       */
      type: "thinking";

      /**
       * Exact thinking text, which may be empty.
       */
      text: string;

      /**
       * Opaque provider signature assembled from stream fragments.
       */
      signature: string;
    }
  | {
      /**
       * Redacted thinking block discriminator.
       */
      type: "redacted-thinking";

      /**
       * Opaque encrypted provider data.
       */
      data: string;
    };

/**
 * Ordered bounded Responses item retained for stateless continuation.
 */
export type OpenAiBlock =
  | {
      /**
       * Message item kind.
       */
      readonly type: "message";

      /**
       * Provider output item ID.
       */
      readonly id: string;

      /**
       * Provider message phase.
       */
      readonly phase: "commentary" | "final_answer" | "";

      /**
       * Ordered visible and refused parts.
       */
      readonly parts: readonly {
        /**
         * Part kind.
         */
        readonly type: "output_text" | "refusal";

        /**
         * Exact bounded part text.
         */
        readonly text: string;
      }[];
    }
  | {
      /**
       * Reasoning item kind.
       */
      readonly type: "reasoning";

      /**
       * Provider output item ID.
       */
      readonly id: string;

      /**
       * Exact ordered summary parts.
       */
      readonly summary: readonly string[];

      /**
       * Opaque encrypted continuation bytes.
       */
      readonly encryptedContent: string;
    }
  | {
      /**
       * Local function call item kind.
       */
      readonly type: "function_call";

      /**
       * Provider output item ID.
       */
      readonly id: string;

      /**
       * Exact correlated function proposal.
       */
      readonly call: StreamToolCall;

      /**
       * Configured local namespace.
       */
      readonly namespace: string;
    };

/**
 * Complete only after the exact response.completed terminal event.
 */
export interface OpenAiContent {
  /**
   * Ordered provider response items.
   */
  readonly items: readonly OpenAiBlock[];

  /**
   * Whether the exact terminal event and item closure were observed.
   */
  readonly complete: boolean;
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
   * Present for a stream collected through the Anthropic Messages profile.
   */
  readonly anthropicContent?: readonly AnthropicBlock[];

  /**
   * Ordered ChatGPT plan Responses items.
   */
  readonly openaiContent?: OpenAiContent;

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
   * Received proposals, including bounded input prefixes from interrupted Anthropic blocks.
   */
  readonly toolCalls: readonly StreamToolCall[];

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
   * Allowlisted provider failure code, without provider prose.
   */
  readonly providerCode?:
    | "subscription_sharing_usage_limit_exceeded"
    | "subscription_sharing_unavailable"
    | "invalid_api_key"
    | "invalid_token";

  /**
   * Creates a safe error with bounded received content.
   * @param reason Fixed adapter diagnostic without vendor exception data.
   * @param partial Bounded provider content received before the failure.
   * @param statusCode Safe HTTP status if the provider SDK exposed it.
   * @param providerCode Safe allowlisted provider failure code.
   */
  constructor(
    reason: string,
    partial: StreamedPartialResult,
    statusCode?: number,
    providerCode?: StreamCollectionError["providerCode"],
  ) {
    super(reason);
    this.partial = partial;
    if (statusCode !== undefined) this.statusCode = statusCode;
    if (providerCode !== undefined) this.providerCode = providerCode;
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
  anthropic?: {
    blocks: AnthropicBlock[];
    open: Map<string, AnthropicOpenBlock>;
    closed: Set<string>;
  };
  openai?: {
    items: OpenAiBlock[];
    added: Map<number, { id: string; type: string }>;
    complete: boolean;
    rawBytes: number;
    failed: boolean;
  };
}

type AnthropicState = NonNullable<State["anthropic"]>;

interface AnthropicOpenBlock {
  index: number;
  kind: "text" | "thinking" | "redacted-thinking" | "tool-call";
  inputEnded?: boolean;
  inputBytes?: number;
}

/**
 * @param state Current bounded stream state.
 * @returns Immutable partial receipt.
 */
const partial = (state: State): StreamedPartialResult => ({
  text: state.text,
  toolCalls: state.anthropic
    ? state.anthropic.blocks.flatMap((block) =>
        block.type === "tool-call" ? [{ ...block.call }] : [],
      )
    : [...state.toolCalls],
  ...(state.anthropic ? { anthropicContent: [...state.anthropic.blocks] } : {}),
  ...(state.openai
    ? {
        openaiContent: {
          items: [...state.openai.items],
          complete: state.openai.complete,
        },
      }
    : {}),
  ...(state.finishReason ? { finishReason: state.finishReason } : {}),
  ...(state.usage ? { usage: state.usage } : {}),
  ...(state.actualModelId ? { actualModelId: state.actualModelId } : {}),
});

/**
 * @param state Current stream.
 * @param reason Safe failure category.
 */
const fail = (
  state: State,
  reason: string,
  statusCode?: number,
  providerCode?: StreamCollectionError["providerCode"],
): never => {
  throw new StreamCollectionError(reason, partial(state), statusCode, providerCode);
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
 * @param anthropic Whether the authenticated connection uses Anthropic Messages.
 * @param openai Whether the authenticated connection uses ChatGPT plan Responses.
 * @returns Complete text, tool calls, finish state and known usage.
 */
export const collectModelStream = async (
  model: StreamModel,
  options: Options,
  maxParsedBytes: number,
  deadline?: StreamDeadline,
  anthropic = false,
  openai = false,
): Promise<StreamedModelResult> => {
  if (!Number.isSafeInteger(maxParsedBytes) || maxParsedBytes < 1)
    throw new TypeError("Parsed output limit is invalid");
  const guard = deadline ? deadlineSignal(options.abortSignal, deadline) : undefined;
  const signal = guard?.signal ?? options.abortSignal;
  const state = streamState(anthropic, openai);
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
 * @param anthropic Whether Anthropic blocks are retained.
 * @param openai Whether Responses items are retained.
 * @returns Empty bounded stream state.
 */
const streamState = (anthropic: boolean, openai: boolean): State => ({
  text: "",
  toolCalls: [],
  bytes: 0,
  ...(anthropic ? { anthropic: { blocks: [], open: new Map(), closed: new Set() } } : {}),
  ...(openai
    ? { openai: { items: [], added: new Map(), complete: false, rawBytes: 0, failed: false } }
    : {}),
});

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
    assertStreamComplete(state);
    complete = true;
    return { ...partial(state), finishReason: state.finishReason as "stop" | "tool-calls" };
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
 * @param state Bounded provider receipt.
 */
const assertStreamComplete = (state: State): void => {
  if (
    !state.finishReason ||
    state.anthropic?.open.size ||
    (state.openai && (!state.openai.complete || state.openai.added.size))
  )
    fail(state, "Provider stream incomplete");
  if (state.openai) assertOpenAiProjection(state);
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
  if (state.anthropic) acceptAnthropicPart(state, part, limit);
  if (state.openai && part.type === "raw") acceptOpenAiRaw(state, part.rawValue, limit);
  if (part.type === "text-delta") {
    if (!state.anthropic) addBytes(state, part.delta, limit);
    state.text += part.delta;
  } else if (part.type === "tool-call") {
    if (part.providerExecuted || part.dynamic) fail(state, "Provider tool execution unsupported");
    if ([part.toolCallId, part.toolName, part.input].some((value) => typeof value !== "string"))
      fail(state, "Provider tool proposal invalid");
    if (!state.anthropic) {
      addBytes(state, part.toolCallId, limit);
      addBytes(state, part.toolName, limit);
      addBytes(state, part.input, limit);
    }
    state.toolCalls.push({ id: part.toolCallId, name: part.toolName, input: part.input });
  } else if (part.type === "response-metadata") {
    if (part.modelId) state.actualModelId = part.modelId;
  } else if (part.type === "finish") acceptFinish(state, part);
  else if (part.type === "error") fail(state, "Provider stream error");
};

/**
 * @param value Unknown SDK raw chunk.
 * @returns Plain object or undefined.
 */
const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * @param state Bounded Responses state.
 * @param raw SDK raw Responses event.
 * @param limit Retained-output byte limit.
 */
const acceptOpenAiRaw = (state: State, raw: unknown, limit: number): void => {
  const event = objectValue(raw);
  if (!event || typeof event.type !== "string") return fail(state, "Invalid Responses event");
  const openai = state.openai;
  if (!openai) return fail(state, "Responses state missing");
  if (openai.complete) fail(state, "Responses event after terminal");
  if (event.type === "response.completed") {
    const status = objectValue(event.response)?.status;
    if (openai.added.size || (status !== undefined && status !== "completed"))
      fail(state, "Provider response incomplete");
    openai.complete = true;
  } else if (event.type === "response.failed" || event.type === "response.incomplete") {
    acceptOpenAiFailure(state, event);
  } else if (event.type === "response.output_item.added") {
    addOpenAiItem(state, event);
  } else if (event.type === "response.output_item.done") {
    acceptOpenAiItem(state, event, limit);
  } else if (event.type === "response.output_text.annotation.added") {
    fail(state, "Unsupported Responses annotation");
  }
};

/**
 * @param state Bounded Responses state.
 * @param event Failed or incomplete terminal event.
 */
const acceptOpenAiFailure = (state: State, event: Record<string, unknown>): never => {
  if (state.openai) state.openai.failed = true;
  const error = objectValue(objectValue(event.response)?.error);
  const code = error?.code;
  const safeCode =
    code === "subscription_sharing_usage_limit_exceeded" ||
    code === "subscription_sharing_unavailable" ||
    code === "invalid_api_key" ||
    code === "invalid_token"
      ? code
      : undefined;
  const status = error?.status;
  const safeStatus = status === 401 || status === 403 ? status : undefined;
  return fail(
    state,
    event.type === "response.failed" ? "Provider response failed" : "Provider response incomplete",
    safeStatus,
    safeCode,
  );
};

/**
 * @param state Bounded Responses state.
 * @param event Item opening event.
 */
const addOpenAiItem = (state: State, event: Record<string, unknown>): void => {
  const item = objectValue(event.item);
  const openai = state.openai;
  if (!item || !openai) return fail(state, "Responses output item invalid");
  if (
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.type !== "string" ||
    !["message", "reasoning", "function_call"].includes(item.type) ||
    !Number.isSafeInteger(event.output_index) ||
    openai.added.has(event.output_index as number)
  )
    fail(state, "Responses output item invalid");
  openai.added.set(event.output_index as number, {
    id: item.id as string,
    type: item.type as string,
  });
};

/**
 * @param state Bounded Responses state.
 * @param event Complete output item event.
 * @param limit Retained-output byte limit.
 */
const acceptOpenAiItem = (state: State, event: Record<string, unknown>, limit: number): void => {
  const item = objectValue(event.item);
  const openai = state.openai;
  if (!openai || !item) return fail(state, "Responses output item invalid");
  if (item.status !== undefined && item.status !== "completed")
    fail(state, "Provider output item incomplete");
  const added = openai.added.get(event.output_index as number);
  if (
    event.output_index !== openai.items.length ||
    typeof item.id !== "string" ||
    !item.id ||
    added?.id !== item.id ||
    added.type !== item.type ||
    openai.items.some((prior) => prior.id === item.id)
  )
    fail(state, "Responses output item invalid");
  const block = parseOpenAiItem(state, item);
  const bytes = Buffer.byteLength(JSON.stringify(block));
  if (bytes > limit - openai.rawBytes) fail(state, "Parsed output limit exceeded");
  openai.rawBytes += bytes;
  openai.items.push(block);
  openai.added.delete(event.output_index as number);
  if (block.type === "message" && block.parts.some((part) => part.type === "refusal"))
    fail(state, "Provider response refused");
};

/**
 * @param state Bounded Responses state.
 * @param item One complete provider item.
 * @returns Checked item without unsupported fields.
 */
const parseOpenAiItem = (state: State, item: Record<string, unknown>): OpenAiBlock => {
  const id = item.id as string;
  if (item.type === "reasoning") return parseOpenAiReasoning(state, id, item);
  if (item.type === "message") return parseOpenAiMessage(state, id, item);
  if (item.type === "function_call") return parseOpenAiCall(state, id, item);
  return fail(state, "Unsupported Responses output item");
};

/**
 * @param state Bounded Responses state.
 * @param id Provider item ID.
 * @param item Complete reasoning item.
 * @returns Ordered reasoning content.
 */
const parseOpenAiReasoning = (
  state: State,
  id: string,
  item: Record<string, unknown>,
): OpenAiBlock => {
  const summary = item.summary;
  if (
    typeof item.encrypted_content !== "string" ||
    !item.encrypted_content ||
    !Array.isArray(summary) ||
    summary.some(
      (part) =>
        objectValue(part)?.type !== "summary_text" || typeof objectValue(part)?.text !== "string",
    )
  )
    fail(state, "Responses reasoning incomplete");
  return {
    type: "reasoning",
    id,
    encryptedContent: item.encrypted_content as string,
    summary: (summary as unknown[]).map((part) => objectValue(part)?.text as string),
  };
};

/**
 * @param state Bounded Responses state.
 * @param id Provider item ID.
 * @param item Complete local function call.
 * @returns Correlated tool proposal.
 */
const parseOpenAiCall = (state: State, id: string, item: Record<string, unknown>): OpenAiBlock => {
  if (
    typeof item.call_id !== "string" ||
    !item.call_id ||
    typeof item.name !== "string" ||
    !item.name ||
    typeof item.arguments !== "string" ||
    typeof item.namespace !== "string" ||
    !item.namespace ||
    item.async ||
    item.caller
  )
    fail(state, "Responses function call invalid");
  return {
    type: "function_call",
    id,
    namespace: item.namespace as string,
    call: {
      id: item.call_id as string,
      name: item.name as string,
      input: item.arguments as string,
    },
  };
};

/**
 * @param state Bounded Responses state.
 * @param id Provider item ID.
 * @param item Complete message item.
 * @returns Checked message parts.
 */
const parseOpenAiMessage = (
  state: State,
  id: string,
  item: Record<string, unknown>,
): OpenAiBlock => {
  if (
    item.role !== "assistant" ||
    !Array.isArray(item.content) ||
    (item.phase !== "commentary" && item.phase !== "final_answer" && item.phase != null)
  )
    fail(state, "Responses message invalid");
  const parts = (item.content as unknown[]).map((value) => {
    const part = objectValue(value);
    if (
      part?.type === "output_text" &&
      typeof part.text === "string" &&
      (!part.annotations || (Array.isArray(part.annotations) && part.annotations.length === 0))
    )
      return { type: "output_text" as const, text: part.text };
    if (part?.type === "refusal" && typeof part.refusal === "string")
      return { type: "refusal" as const, text: part.refusal };
    return fail(state, "Unsupported Responses message part");
  });
  return {
    type: "message",
    id,
    phase: (item.phase ?? "") as "" | "commentary" | "final_answer",
    parts,
  };
};

/**
 * @param state Complete stream and typed item receipt.
 */
const assertOpenAiProjection = (state: State): void => {
  const openai = state.openai;
  if (!openai) return fail(state, "Responses state missing");
  const items = openai.items;
  const text = items
    .flatMap((item) =>
      item.type === "message"
        ? item.parts.filter((part) => part.type === "output_text").map((part) => part.text)
        : [],
    )
    .join("");
  const calls = items.flatMap((item) => (item.type === "function_call" ? [item.call] : []));
  if (
    text !== state.text ||
    calls.length !== state.toolCalls.length ||
    calls.some((call, index) => {
      const actual = state.toolCalls[index];
      return call.id !== actual?.id || call.name !== actual.name || call.input !== actual.input;
    })
  )
    fail(state, "Responses stream projection mismatch");
};

/**
 * Retains typed Anthropic blocks in start order, with every byte reserved first.
 * @param state Bounded provider state.
 * @param part One SDK stream part.
 * @param limit Full retained-content allowance.
 */
const acceptAnthropicPart = (state: State, part: Part, limit: number): void => {
  const content = state.anthropic;
  if (!content) return;
  if (
    (part.type === "text-start" || part.type === "text-delta" || part.type === "text-end") &&
    part.providerMetadata !== undefined
  )
    fail(state, "Unsupported Anthropic text metadata");
  if (
    part.type === "text-start" ||
    part.type === "reasoning-start" ||
    part.type === "tool-input-start"
  ) {
    anthropicStart(state, content, part, limit);
    return;
  }
  if (part.type === "text-delta" || part.type === "reasoning-delta") {
    anthropicDelta(state, content, part, limit);
    return;
  }
  if (part.type === "tool-input-delta" || part.type === "tool-input-end") {
    anthropicToolInput(state, content, part, limit);
    return;
  }
  if (part.type === "text-end" || part.type === "reasoning-end" || part.type === "tool-call") {
    anthropicEnd(state, content, part, limit);
    return;
  }
  if (isAnthropicControlPart(part)) return;
  fail(state, "Unsupported Anthropic stream content");
};

/**
 * Recognizes SDK framing parts that carry no assistant content.
 * @param part Provider stream part.
 * @returns Whether this part is admitted control framing.
 */
const isAnthropicControlPart = (part: Part): boolean =>
  part.type === "response-metadata" ||
  part.type === "finish" ||
  part.type === "error" ||
  part.type === "stream-start" ||
  part.type === "raw" ||
  (part.type === "custom" && part.kind === "anthropic.message_start");

/**
 * Reserves a block position before any provider content is accumulated.
 * @param state Bounded stream state.
 * @param content Anthropic block state.
 * @param part Block start event.
 * @param limit Retained-output allowance.
 */
const anthropicStart = (
  state: State,
  content: AnthropicState,
  part: Extract<Part, { type: "text-start" | "reasoning-start" | "tool-input-start" }>,
  limit: number,
): void => {
  if (content.open.has(part.id) || content.closed.has(part.id))
    fail(state, "Duplicate Anthropic content start");
  addByteCount(state, 64, limit);
  const index = content.blocks.length;
  if (part.type === "text-start") {
    content.blocks.push({ type: "text", text: "" });
    content.open.set(part.id, { index, kind: "text" });
  } else if (part.type === "tool-input-start") {
    addBytes(state, part.id, limit);
    addBytes(state, part.toolName, limit);
    content.blocks.push({
      type: "tool-call",
      call: { id: part.id, name: part.toolName, input: "" },
    });
    content.open.set(part.id, { index, kind: "tool-call", inputBytes: 0 });
  } else anthropicReasoningStart(state, content, part, index, limit);
};

/**
 * Starts signed or encrypted reasoning without transforming provider data.
 * @param state Bounded stream state.
 * @param content Anthropic block state.
 * @param part Reasoning start event.
 * @param index Reserved block position.
 * @param limit Retained-output allowance.
 */
const anthropicReasoningStart = (
  state: State,
  content: AnthropicState,
  part: Extract<Part, { type: "reasoning-start" }>,
  index: number,
  limit: number,
): void => {
  const metadata = part.providerMetadata?.anthropic;
  const redacted = metadata?.redactedData;
  if (metadata?.signature !== undefined) fail(state, "Anthropic reasoning start metadata invalid");
  if (redacted !== undefined && typeof redacted !== "string")
    fail(state, "Anthropic reasoning metadata invalid");
  if (typeof redacted === "string") {
    addBytes(state, redacted, limit);
    content.blocks.push({ type: "redacted-thinking", data: redacted });
    content.open.set(part.id, { index, kind: "redacted-thinking" });
  } else {
    content.blocks.push({ type: "thinking", text: "", signature: "" });
    content.open.set(part.id, { index, kind: "thinking" });
  }
};

/**
 * Adds one text or reasoning delta to its open block.
 * @param state Bounded stream state.
 * @param content Anthropic block state.
 * @param part Provider delta event.
 * @param limit Retained-output allowance.
 */
const anthropicDelta = (
  state: State,
  content: AnthropicState,
  part: Extract<Part, { type: "text-delta" | "reasoning-delta" }>,
  limit: number,
): void => {
  const opened = content.open.get(part.id);
  if (!opened) return fail(state, "Orphan Anthropic content delta");
  if (part.type === "text-delta" ? opened.kind !== "text" : opened.kind !== "thinking")
    fail(state, "Orphan Anthropic content delta");
  const block = content.blocks[opened.index];
  if (part.type === "text-delta" && block?.type === "text") {
    addBytes(state, part.delta, limit);
    block.text += part.delta;
  } else if (part.type === "reasoning-delta" && block?.type === "thinking") {
    anthropicReasoningDelta(state, block, part, limit);
  } else fail(state, "Anthropic content kind mismatch");
};

/**
 * Appends reasoning text and all signature fragments in arrival order.
 * @param state Bounded stream state.
 * @param block Open signed-thinking block.
 * @param part Provider reasoning delta.
 * @param limit Retained-output allowance.
 */
const anthropicReasoningDelta = (
  state: State,
  block: Extract<AnthropicBlock, { type: "thinking" }>,
  part: Extract<Part, { type: "reasoning-delta" }>,
  limit: number,
): void => {
  const signature = part.providerMetadata?.anthropic?.signature;
  if (part.providerMetadata?.anthropic?.redactedData !== undefined)
    fail(state, "Anthropic reasoning delta metadata invalid");
  if (signature !== undefined && typeof signature !== "string")
    fail(state, "Anthropic signature metadata invalid");
  addBytes(state, part.delta, limit);
  if (typeof signature === "string") addBytes(state, signature, limit);
  block.text += part.delta;
  if (typeof signature === "string") block.signature += signature;
};

/**
 * Reserves tool input fragments until the complete proposal arrives.
 * @param state Bounded stream state.
 * @param content Anthropic block state.
 * @param part Provider tool input event.
 * @param limit Retained-output allowance.
 */
const anthropicToolInput = (
  state: State,
  content: AnthropicState,
  part: Extract<Part, { type: "tool-input-delta" | "tool-input-end" }>,
  limit: number,
): void => {
  const opened = content.open.get(part.id);
  if (opened?.kind !== "tool-call" || opened.inputEnded)
    return fail(state, "Orphan Anthropic tool input");
  if (part.type === "tool-input-end") opened.inputEnded = true;
  else {
    const block = content.blocks[opened.index];
    if (block?.type !== "tool-call") return fail(state, "Anthropic content kind mismatch");
    addBytes(state, part.delta, limit);
    block.call = { ...block.call, input: block.call.input + part.delta };
    opened.inputBytes = (opened.inputBytes ?? 0) + Buffer.byteLength(part.delta);
  }
};

/**
 * Completes only the block previously reserved for this provider ID.
 * @param state Bounded stream state.
 * @param content Anthropic block state.
 * @param part Provider block end or complete tool call.
 * @param limit Retained-output allowance.
 */
const anthropicEnd = (
  state: State,
  content: AnthropicState,
  part: Extract<Part, { type: "text-end" | "reasoning-end" | "tool-call" }>,
  limit: number,
): void => {
  const id = part.type === "tool-call" ? part.toolCallId : part.id;
  const opened = content.open.get(id);
  if (!opened) return fail(state, "Orphan Anthropic content end");
  const expected =
    part.type === "tool-call" ? "tool-call" : part.type === "text-end" ? "text" : undefined;
  if (
    expected
      ? opened.kind !== expected
      : opened.kind !== "thinking" && opened.kind !== "redacted-thinking"
  )
    fail(state, "Orphan Anthropic content end");
  const block = content.blocks[opened.index];
  if (part.type === "tool-call") anthropicToolEnd(state, block, opened, part, limit);
  else if (opened.kind === "thinking" && (block?.type !== "thinking" || !block.signature))
    fail(state, "Anthropic thinking signature missing");
  else if (
    opened.kind === "redacted-thinking" &&
    (block?.type !== "redacted-thinking" || !block.data)
  )
    fail(state, "Anthropic redacted thinking missing");
  content.open.delete(id);
  content.closed.add(id);
};

/**
 * Verifies and completes one already reserved local tool proposal.
 * @param state Bounded stream state.
 * @param block Reserved content block.
 * @param opened Open-block tracking state.
 * @param part Complete SDK tool call.
 * @param limit Retained-output allowance.
 */
const anthropicToolEnd = (
  state: State,
  block: AnthropicBlock | undefined,
  opened: AnthropicOpenBlock,
  part: Extract<Part, { type: "tool-call" }>,
  limit: number,
): void => {
  if (block?.type !== "tool-call" || block.call.name !== part.toolName || !opened.inputEnded)
    return fail(state, "Anthropic tool content changed");
  const remaining = Buffer.byteLength(part.input) - (opened.inputBytes ?? 0);
  if (remaining > 0) addByteCount(state, remaining, limit);
  block.call = { id: part.toolCallId, name: part.toolName, input: part.input };
};

/**
 * Retains one decoded part only while the parsed-output allowance remains.
 *
 * @param state Current output byte count.
 * @param value Decoded text or tool input.
 * @param limit Maximum retained bytes.
 */
const addBytes = (state: State, value: string, limit: number): void => {
  addByteCount(state, new TextEncoder().encode(value).byteLength, limit);
};

/**
 * Reserves a known encoded byte count before a provider part is retained.
 * @param state Current bounded stream.
 * @param bytes Exact additional encoded bytes.
 * @param limit Ticket output allowance.
 */
const addByteCount = (state: State, bytes: number, limit: number): void => {
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
