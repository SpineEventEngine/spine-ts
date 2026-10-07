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

import type { AxAIFeatures, AxAIService, AxChatRequest, AxChatResponse } from "@ax-llm/ax";
import {
  generateText,
  jsonSchema,
  NoObjectGeneratedError,
  Output,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type ToolResultPart,
} from "ai";

const features: AxAIFeatures = {
  functions: true,
  functionEmulation: false,
  streaming: false,
  structuredOutputs: true,
  requiresStructuredOutput: true,
  structuredOutputModes: ["native"],
  media: {
    images: { supported: false, formats: [] },
    audio: { supported: false, formats: [] },
    files: { supported: false, formats: [], uploadMethod: "none" },
    urls: { supported: false, webSearch: false, contextFetching: false },
  },
  caching: { supported: false, types: [] },
  thinking: false,
  multiTurn: true,
};

const serviceBase = {
  getId: () => "spine-vercel",
  getName: () => "spine-vercel",
  getFeatures: () => features,
  getLastUsedEmbedModel: () => undefined,
  getLastUsedModelConfig: () => undefined,
  getMetrics: () => {
    throw new Error("Ax metrics are unavailable");
  },
  getLogger: () => () => undefined,
  getEstimatedCost: () => {
    throw new Error("Ax cost is unavailable");
  },
  setOptions: () => {
    throw new Error("Service-wide options are unsupported");
  },
  getOptions: () => ({}),
  embed: () => Promise.reject(new Error("Embedding is unsupported")),
  transcribe: () => Promise.reject(new Error("Transcription is unsupported")),
  speak: () => Promise.reject(new Error("Speech is unsupported")),
} satisfies Omit<AxAIService, "chat" | "getModelList" | "getLastUsedChatModel">;

/**
 * Prepared native request after all bridge-local validation.
 */
interface PreparedRequest {
  readonly instructions: string;
  readonly messages: ModelMessage[];
  readonly tools: ToolSet;
  readonly output: ReturnType<typeof Output.object>;
}

/**
 * Controls each physical Vercel request made by one Ax generation.
 */
export interface AxRequestControl {
  /**
   * Maximum physical requests, including corrections and tool continuations.
   */
  readonly maxRequests: number;

  /**
   * Records an attempt before dispatch; an unknown outcome still consumes it.
   * @param attempt One-based physical request number.
   * @returns Completion of the caller's reservation barrier.
   */
  readonly onAttempt?: (attempt: number) => void | Promise<void>;

  /**
   * Records provider token usage before returning a response.
   * @param tokens Provider-reported token counts.
   * @returns Completion of the caller's usage-recording barrier.
   */
  readonly onUsage?: (tokens: { totalTokens: number }) => void | Promise<void>;
}

/**
 * Builds one bounded Ax-to-Vercel compatibility service.
 */
export const AxVercelBridge = {
  /**
   * Creates an Ax chat service that delegates requests to one Vercel model.
   * @param model Authenticated Vercel generation model.
   * @param control Physical-request limits and observations supplied by Spine.
   * @returns An Ax service for one bounded generation operation.
   */
  create(model: LanguageModel, control: AxRequestControl): AxAIService {
    if (!Number.isSafeInteger(control.maxRequests) || control.maxRequests < 1) {
      throw new Error("maxRequests must be a positive safe integer");
    }
    let attempts = 0;
    const modelId = typeof model === "string" ? model : model.modelId;
    return {
      ...serviceBase,
      getModelList: () => [
        { key: "selected", description: "Selected Vercel model", model: modelId },
      ],
      getLastUsedChatModel: () => modelId,
      chat: async (request: Readonly<AxChatRequest>, options?: { abortSignal?: AbortSignal }) => {
        if (options?.abortSignal?.aborted) throw new Error("Request aborted");
        const prepared = AxVercelBridge.prepare(request);
        if (attempts >= control.maxRequests) throw new Error("Request budget exhausted");
        attempts += 1;
        await control.onAttempt?.(attempts);
        if (options?.abortSignal?.aborted) throw new Error("Request aborted");
        return AxVercelBridge.chat(model, prepared, control.onUsage, options?.abortSignal);
      },
    } satisfies AxAIService;
  },

  /**
   * Validates and materializes a native request before reserving transport.
   * @param request Ax request containing prompt, schema, and tool state.
   * @returns Request ready for one physical Vercel call.
   */
  prepare(request: Readonly<AxChatRequest>): PreparedRequest {
    const schema: unknown = request.responseFormat?.schema;
    if (request.responseFormat?.type !== "json_schema" || !schema) {
      throw new Error("Native JSON schema is required");
    }
    return {
      instructions: request.chatPrompt
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n"),
      messages: AxVercelBridge.mapMessages(request),
      tools: AxVercelBridge.mapTools(request),
      output: Output.object({ schema: jsonSchema(schema) }),
    };
  },

  /**
   * Sends one prepared Ax chat turn through the selected Vercel model.
   * @param model Vercel model selected for this operation.
   * @param prepared Request validated before reservation.
   * @param onUsage Usage persistence barrier.
   * @param signal Abort signal from the operation.
   * @returns Ax response for the generation program.
   */
  async chat(
    model: LanguageModel,
    prepared: PreparedRequest,
    onUsage?: AxRequestControl["onUsage"],
    signal?: AbortSignal,
  ): Promise<AxChatResponse> {
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model,
        instructions: prepared.instructions,
        messages: prepared.messages,
        tools: prepared.tools,
        output: prepared.output,
        maxRetries: 0,
        ...(signal ? { abortSignal: signal } : {}),
      });
    } catch (error) {
      if (!NoObjectGeneratedError.isInstance(error)) throw error;
      const modelUsage = AxVercelBridge.mapUsage(error.usage);
      if (modelUsage?.tokens) await onUsage?.(modelUsage.tokens);
      AxVercelBridge.requireSuccessfulFinish(error.finishReason);
      if (!error.text?.trim()) throw error;
      return {
        results: [{ index: 0, content: error.text, finishReason: "stop" }],
        ...(modelUsage ? { modelUsage } : {}),
      };
    }
    const modelUsage = AxVercelBridge.mapUsage(result.usage);
    if (modelUsage?.tokens) await onUsage?.(modelUsage.tokens);
    AxVercelBridge.requireSuccessfulFinish(result.finishReason);
    return AxVercelBridge.mapResponse(result);
  },

  /**
   * Rejects provider stop states that cannot represent a complete answer.
   * @param finishReason Provider finish status, if available.
   */
  requireSuccessfulFinish(finishReason: string | undefined): void {
    if (finishReason !== "stop" && finishReason !== "tool-calls")
      throw new Error(`Provider finish reason: ${finishReason ?? "unknown"}`);
  },

  /**
   * Maps assistant tool calls and results across an Ax continuation.
   * @param request Ax request containing all conversation turns.
   * @returns Vercel messages in the same order.
   */
  mapMessages(request: Readonly<AxChatRequest>): ModelMessage[] {
    const toolNames = new Map<string, string>();
    for (const message of request.chatPrompt) {
      if (message.role !== "assistant") continue;
      for (const call of message.functionCalls ?? []) {
        if (toolNames.has(call.id)) throw new Error("Duplicate tool call identity");
        toolNames.set(call.id, call.function.name);
      }
    }
    return request.chatPrompt
      .filter((message) => message.role !== "system")
      .map((message) => AxVercelBridge.mapMessage(message, toolNames));
  },

  /**
   * Maps advertised tool schemas while leaving execution with Ax and Spine.
   * @param request Ax request containing permitted function declarations.
   * @returns Vercel tool descriptions with no SDK executor.
   */
  mapTools(request: Readonly<AxChatRequest>): ToolSet {
    return Object.fromEntries(
      (request.functions ?? []).map((entry) => [
        entry.name,
        tool({
          description: entry.description,
          inputSchema: jsonSchema(
            (entry.parameters ?? { type: "object", properties: {} }) as Parameters<
              typeof jsonSchema
            >[0],
          ),
        }),
      ]),
    ) as unknown as ToolSet;
  },

  /**
   * Returns provider output and usage to Ax for correction or tool execution.
   * @param result One Vercel model result.
   * @returns An Ax chat response.
   */
  mapResponse(result: Awaited<ReturnType<typeof generateText>>): AxChatResponse {
    const functionCalls = result.toolCalls.map((call) => ({
      id: call.toolCallId,
      type: "function" as const,
      function: { name: call.toolName, params: call.input as object },
    }));
    const modelUsage = AxVercelBridge.mapUsage(result.usage);
    return {
      results: [
        {
          index: 0,
          ...(functionCalls.length
            ? { functionCalls, finishReason: "function_call" as const }
            : { content: JSON.stringify(result.output), finishReason: "stop" as const }),
        },
      ],
      ...(modelUsage ? { modelUsage } : {}),
    };
  },

  /**
   * Maps supplied provider counts without fabricating absent usage.
   * @param usage Provider usage, including optional counts.
   * @returns Ax usage when both counts are available.
   */
  mapUsage(
    usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined,
  ): AxChatResponse["modelUsage"] {
    return usage?.inputTokens === undefined || usage.outputTokens === undefined
      ? undefined
      : {
          ai: "spine-vercel",
          model: "selected",
          tokens: {
            promptTokens: usage.inputTokens,
            completionTokens: usage.outputTokens,
            totalTokens: usage.inputTokens + usage.outputTokens,
          },
        };
  },

  /**
   * Converts one Ax prompt entry into Vercel's message protocol.
   * @param message Ax prompt entry.
   * @param toolNames Names indexed by Ax tool call identity.
   * @returns Vercel message with preserved tool identity.
   */
  mapMessage(
    message: AxChatRequest["chatPrompt"][number],
    toolNames: ReadonlyMap<string, string>,
  ): ModelMessage {
    if (message.role === "function") return AxVercelBridge.mapToolResult(message, toolNames);
    if (message.role === "assistant" && message.functionCalls?.length)
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.functionCalls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.function.name,
            input:
              typeof call.function.params === "string"
                ? (JSON.parse(call.function.params) as unknown)
                : (call.function.params ?? {}),
          })),
        ],
      };
    if (message.role === "system") throw new Error("System messages must be instructions");
    if (message.content === undefined) return { role: message.role, content: "" };
    if (typeof message.content === "string")
      return { role: message.role, content: message.content };
    if (message.content.every((part) => part.type === "text"))
      return {
        role: message.role,
        content: message.content.map((part) => part.text).join("\n"),
      };
    throw new Error("Only text prompt content is supported by this bridge");
  },

  /**
   * Maps one tool result using the original tool name and call identity.
   * @param message Ax result entry.
   * @param toolNames Names from the preceding assistant calls.
   * @returns Vercel tool result entry.
   */
  mapToolResult(
    message: Extract<AxChatRequest["chatPrompt"][number], { role: "function" }>,
    toolNames: ReadonlyMap<string, string>,
  ): ModelMessage {
    const toolName = toolNames.get(message.functionId);
    if (!toolName) throw new Error("Tool result has no matching call");
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: message.functionId,
          toolName,
          output: AxVercelBridge.toolOutput(message),
        },
      ],
    };
  },

  /**
   * Maps supported tool payloads without discarding text or structured facts.
   * @param message Ax tool result with optional MCP protocol payload.
   * @returns Vercel tool output preserving supported content.
   */
  toolOutput(
    message: Extract<AxChatRequest["chatPrompt"][number], { role: "function" }>,
  ): ToolResultPart["output"] {
    const content = message.content ?? [];
    if (content.some((part) => part.type !== "text")) throw new Error("Unsupported tool content");
    const texts = content.filter((part) => part.type === "text").map((part) => part.text);
    if (message.protocolResult) {
      const encoded: unknown = JSON.stringify(message.protocolResult.value);
      if (typeof encoded !== "string") throw new Error("Unsupported structured tool result");
      const structured = JSON.parse(encoded) as unknown;
      const value = { result: message.result, content: texts, structured };
      return { type: message.isError ? "error-json" : "json", value } as ToolResultPart["output"];
    }
    if (message.isError)
      return {
        type: "error-text",
        value: texts.length ? JSON.stringify(texts) : message.result,
      };
    if (texts.length)
      return { type: "content", value: texts.map((text) => ({ type: "text", text })) };
    return { type: "text", value: message.result };
  },
};
