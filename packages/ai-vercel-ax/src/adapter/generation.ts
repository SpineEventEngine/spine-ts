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

import { create, toJsonString, type MessageShape } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import {
  AxGen,
  axMCPToolInputSchemaToFunctionSchema as axToolSchema,
  type AxChatResponse,
  type AxChatRequest,
} from "@ax-llm/ax";
import type { ModelMessage } from "ai";
import type {
  JSONSchema7,
  LanguageModelV3CallOptions as V3Options,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";
import { AnyMessages, type MessageSchema } from "@spine-event-engine/core";
import type { AiFailure } from "@spine-event-engine/ai";
import {
  assertAiOutcomeContext,
  deriveOutputSchema,
  type AiBackendExecution,
  type AiBackendOutcome,
  type AiCandidateAdmission,
  type AiAttemptTicket,
  type AiAttemptReplay,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiAttemptIdSchema,
  AiContentDigestSchema,
  AiDiagnosticIdSchema,
  AiOutcome,
  AiProviderModelNameSchema as ProviderNameSchema,
  AiTokenCountSchema,
  AiUsageSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
  AnthropicAssistantContentSchema,
  OpenAiAssistantContentSchema as OpenAiContentSchema,
  OpenAiMessageItem_Phase as OpenAiPhase,
  type GenerationResponse,
  type AnthropicAssistantContent,
  type OpenAiAssistantContent,
} from "@spine-event-engine/proto/agent";
import { AxVercelBridge, type PreparedRequest } from "./bridge.js";
import { providerConnection } from "./factory.js";
import { canonicalJsonValue } from "./mcp-protocol.js";
import { replayFailure } from "./replay-failure.js";
import {
  collectModelStream,
  StreamCollectionError,
  type StreamModel,
  type StreamedPartialResult,
  type AnthropicBlock,
  type OpenAiBlock,
  type OpenAiContent,
} from "./streamed-model.js";

const nativeAnthropicModels = new Set([
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
]);

/**
 * Returns the exact Anthropic options bound to the recorded output mode.
 * @param request Selected generation execution.
 * @returns Provider options for native output or undefined for prompted text.
 */
const anthropicOptions = (request: AiBackendExecution) =>
  providerConnection(request.model).capabilities.id === "anthropic-messages-v1" &&
  request.definition.kind === "generation" &&
  request.definition.outputMode === "native-schema"
    ? { anthropic: { structuredOutputMode: "outputFormat" as const } }
    : undefined;

type AnthropicOptions = ReturnType<typeof anthropicOptions>;

/**
 * Forces the pinned SDK to lower the subscription request as stateless Responses.
 * @param request Selected generation execution.
 * @returns Provider options for the ChatGPT plan profile.
 */
const chatgptPlanOptions = (request: AiBackendExecution) =>
  providerConnection(request.model).capabilities.id === "chatgpt-plan-responses-v1"
    ? {
        openai: {
          store: false,
          systemMessageMode: "developer" as const,
          include: ["reasoning.encrypted_content"],
        },
      }
    : undefined;

type ProviderSettings = AnthropicOptions | ReturnType<typeof chatgptPlanOptions>;

/**
 * @param value Exact bounded content.
 * @returns Its SHA-256 identity.
 */
const digest = (value: string) =>
  create(AiContentDigestSchema, {
    value: createHash("sha256").update(value).digest("hex"),
  });

/**
 * @param value Text-only Ax message content.
 * @returns Provider text.
 */
const messageText = (value: PreparedRequest["messages"][number]["content"]): string => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.some((part) => part.type !== "text"))
    throw new TypeError("Unsupported generation prompt content");
  return value.map((part) => (part.type === "text" ? part.text : "")).join("\n");
};

/**
 * @param prepared Actual Ax prompt.
 * @param instructions Application instructions.
 * @returns Direct provider prompt.
 */
const modelPrompt = (prepared: PreparedRequest, instructions: string): LanguageModelV3Prompt => [
  { role: "system", content: [instructions, prepared.instructions].filter(Boolean).join("\n") },
  ...prepared.messages.map((message) => {
    if (message.role === "user")
      return {
        role: "user" as const,
        content: [{ type: "text" as const, text: messageText(message.content) }],
      };
    if (message.role === "assistant") return assistantPrompt(message);
    if (message.role === "tool") return toolPrompt(message);
    throw new TypeError("Unsupported generation prompt role");
  }),
];

/**
 * Checks the exact discovered catalog against configured tool references.
 * @param request Selected generation execution.
 * @returns Model-visible names with accepted schemas and configured server/tool mapping.
 */
const advertisedFunctions = (request: AiBackendExecution) => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const configured = definition.tools ?? [];
  const catalog = request.advertisedTools ?? [];
  if (catalog.length !== configured.length) throw new TypeError("MCP tool catalog mismatch");
  const seen = new Set<string>();
  return configured.map((reference, index) =>
    advertisedFunction(reference, catalog[index], index, seen),
  );
};

/**
 * Validates one catalog entry before exposing it to Ax.
 * @param reference Configured server and tool reference.
 * @param tool Discovered tool metadata.
 * @param index Model-visible tool position.
 * @param seen Previously checked references.
 * @returns Bounded model-visible tool metadata.
 */
const advertisedFunction = (
  reference: { server: string; tool: string },
  tool: NonNullable<AiBackendExecution["advertisedTools"]>[number] | undefined,
  index: number,
  seen: Set<string>,
) => {
  const key = `${reference.server}\u0000${reference.tool}`;
  if (tool?.server !== reference.server || tool.tool !== reference.tool || seen.has(key))
    throw new TypeError("MCP tool catalog mismatch");
  seen.add(key);
  if (
    Buffer.byteLength(tool.description) > 4_096 ||
    Buffer.byteLength(tool.inputSchemaJson) > 16_384 ||
    (tool.outputSchemaJson !== undefined && Buffer.byteLength(tool.outputSchemaJson) > 16_384)
  )
    throw new TypeError("MCP tool catalog exceeds limit");
  const schema = JSON.parse(tool.inputSchemaJson) as JSONSchema7;
  if (schema.type !== "object") throw new TypeError("MCP tool schema must be an object");
  const axSchema = axToolSchema(schema as Record<string, unknown>);
  if (JSON.stringify(canonicalJsonValue(axSchema)) !== tool.inputSchemaJson)
    throw new TypeError("MCP tool schema unsupported by Ax");
  return {
    modelName: `tool_${String(index)}`,
    server: tool.server,
    tool: tool.tool,
    description: tool.description,
    inputSchemaJson: tool.inputSchemaJson,
    ...(tool.outputSchemaJson === undefined ? {} : { outputSchemaJson: tool.outputSchemaJson }),
    schema,
    axSchema,
  };
};

/**
 * @param instructions Application instructions.
 * @param mode Declared output mode.
 * @param schema Descriptor-derived output schema.
 * @returns Exact provider instructions.
 */
const outputInstructions = (
  instructions: string,
  mode: "native-schema" | "prompt-and-validate",
  schema: JSONSchema7,
): string =>
  mode === "native-schema"
    ? instructions
    : `${instructions}\nReturn only a JSON object matching this output schema: ${JSON.stringify(schema)}`;

/**
 * @param message Prior assistant response.
 * @returns Checked text and tool calls.
 */
const assistantPrompt = (
  message: Extract<PreparedRequest["messages"][number], { role: "assistant" }>,
): LanguageModelV3Message => {
  if (typeof message.content === "string")
    return { role: "assistant", content: [{ type: "text", text: message.content }] };
  return { role: "assistant", content: message.content.map(assistantPart) };
};

/**
 * @param part Ax assistant continuation part.
 * @returns Equivalent provider part.
 */
const assistantPart = (
  part: Exclude<
    Extract<PreparedRequest["messages"][number], { role: "assistant" }>["content"],
    string
  >[number],
) => {
  if (part.type === "text")
    return {
      type: "text" as const,
      text: part.text,
      ...(part.providerOptions ? { providerOptions: part.providerOptions } : {}),
    };
  if (part.type === "reasoning") return assistantReasoning(part);
  if (part.type === "tool-call")
    return {
      type: "tool-call" as const,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
      ...(part.providerOptions ? { providerOptions: part.providerOptions } : {}),
    };
  throw new TypeError("Unsupported assistant continuation content");
};

/**
 * @param part Ax reasoning continuation.
 * @returns Provider reasoning part.
 */
const assistantReasoning = (
  part: Extract<
    Exclude<
      Extract<PreparedRequest["messages"][number], { role: "assistant" }>["content"],
      string
    >[number],
    { type: "reasoning" }
  >,
) => {
  if (part.providerOptions?.openai)
    return {
      type: "reasoning" as const,
      text: part.text,
      providerOptions: { openai: part.providerOptions.openai },
    };
  const options = part.providerOptions?.anthropic;
  if (
    !options ||
    (typeof options.signature !== "string" && typeof options.redactedData !== "string")
  )
    throw new TypeError("Anthropic reasoning metadata missing");
  return { type: "reasoning" as const, text: part.text, providerOptions: { anthropic: options } };
};

/**
 * @param message Prior runtime tool result.
 * @returns Checked provider continuation.
 */
const toolPrompt = (
  message: Extract<PreparedRequest["messages"][number], { role: "tool" }>,
): LanguageModelV3Message => ({
  role: "tool",
  content: message.content.map((part) => {
    if (part.type !== "tool-result") throw new TypeError("Unsupported tool continuation content");
    if (part.output.type !== "text" && part.output.type !== "json")
      throw new TypeError("Unsupported tool result output");
    return {
      type: "tool-result" as const,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: {
        type: "text" as const,
        value: part.output.type === "text" ? part.output.value : JSON.stringify(part.output.value),
      },
    };
  }),
});

/**
 * Journals a ticket cancelled or expired after durable reservation and before dispatch.
 * @param request Selected execution.
 * @param state Program state.
 * @param ticket Reserved physical attempt.
 */
const rejectClosedTicket = async (
  request: AiBackendExecution,
  state: GenerationState,
  ticket: AiAttemptTicket,
): Promise<void> => {
  const expired = request.control.nowEpochMs() >= ticket.deadlineEpochMs;
  if (!ticket.signal.aborted && !expired) return;
  const error = new StreamCollectionError(
    expired ? "Provider request deadline exceeded" : "Provider request cancelled",
    {
      text: "",
      toolCalls: [],
    },
  );
  await journalFailure(request, state, error, ticket);
  throw error;
};

/**
 * Completes a reserved ticket if its deadline crosses during gate admission.
 * @param request Selected execution.
 * @param state Program state.
 * @param ticket Reserved physical attempt.
 */
const admitGenerationTicket = async (
  request: AiBackendExecution,
  state: GenerationState,
  ticket: AiAttemptTicket,
): Promise<void> => {
  await rejectClosedTicket(request, state, ticket);
  try {
    providerConnection(request.model).gate.admit(ticket);
  } catch (error) {
    await rejectClosedTicket(request, state, ticket);
    throw error;
  }
};

/**
 * Records the selected Anthropic lowering beside the exact prepared messages.
 * @param request Selected generation execution.
 * @param prepared Actual Ax prompt.
 * @param instructions Exact provider instructions.
 * @param settings Selected provider options for this physical attempt.
 * @returns Serialized prompt for durable comparison.
 */
const preparedPromptJson = (
  request: AiBackendExecution,
  prepared: PreparedRequest,
  instructions: string,
  settings: ProviderSettings,
): string => {
  if (request.definition.kind !== "generation")
    throw new TypeError("Generation capability required");
  const tools = advertisedFunctions(request).map(preparedTool);
  const prompt = { messages: modelPrompt(prepared, instructions), tools };
  const provider = preparedProvider(request, settings);
  return JSON.stringify(provider ? { ...prompt, provider } : prompt);
};

/**
 * @param tool Verified advertised function.
 * @returns Persistable tool record.
 */
const preparedTool = (tool: ReturnType<typeof advertisedFunctions>[number]) => ({
  modelName: tool.modelName,
  server: tool.server,
  tool: tool.tool,
  description: tool.description,
  inputSchemaJson: tool.inputSchemaJson,
  ...(tool.outputSchemaJson === undefined ? {} : { outputSchemaJson: tool.outputSchemaJson }),
});

/**
 * @param request Selected generation.
 * @param settings Selected provider options.
 * @returns Profile-specific lowering record.
 */
const preparedProvider = (request: AiBackendExecution, settings: ProviderSettings) => {
  if (request.definition.kind !== "generation")
    throw new TypeError("Generation capability required");
  const profile = providerConnection(request.model).capabilities.id;
  if (profile === "chatgpt-plan-responses-v1")
    return {
      profile,
      lowering: "openai-4.0.84-chatgpt-plan-v1",
      outputMode: request.definition.outputMode,
      providerOptions: settings,
    };
  if (profile === "anthropic-messages-v1")
    return {
      profile,
      lowering: "anthropic-4.0.72-v2",
      outputMode: request.definition.outputMode,
      providerOptions: settings ?? null,
    };
  return undefined;
};

/**
 * @param request Selected execution.
 * @param prepared Actual prompt.
 * @param schema Native schema.
 * @param previous Correction target.
 * @param settings Selected provider options for this physical attempt.
 * @returns Persistable exact request.
 */
const requestContent = (
  request: AiBackendExecution,
  prepared: PreparedRequest,
  schema: JSONSchema7,
  previous: Pick<AiAttemptTicket, "id"> | undefined,
  settings: ProviderSettings,
) => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const instructions = outputInstructions(definition.instructions, definition.outputMode, schema);
  const outputSchemaJson = JSON.stringify(schema);
  const promptJson = preparedPromptJson(request, prepared, instructions, settings);
  return create(GenerationRequestSchema, {
    input: AnyMessages.pack(definition.input, request.input),
    instructions,
    outputSchemaJson,
    promptJson,
    ...(previous ? { corrects: create(AiAttemptIdSchema, { value: previous.id }) } : {}),
    digest: digest(JSON.stringify({ instructions, outputSchemaJson, promptJson })),
  });
};

/**
 * @param usage Provider counts.
 * @returns Semantic counts preserving unknown fields.
 */
const semanticUsage = (usage: StreamedPartialResult["usage"]) =>
  usage
    ? create(AiUsageSchema, {
        ...(usage.inputTokens !== undefined
          ? { inputTokens: create(AiTokenCountSchema, { value: BigInt(usage.inputTokens) }) }
          : {}),
        ...(usage.outputTokens !== undefined
          ? { outputTokens: create(AiTokenCountSchema, { value: BigInt(usage.outputTokens) }) }
          : {}),
      })
    : undefined;

/**
 * Converts one bounded ordered receipt to its typed journal envelope.
 * @param blocks Received provider blocks, when Anthropic was selected.
 * @returns Typed ordered blocks or undefined for another provider.
 */
const typedAnthropicContent = (
  blocks: readonly AnthropicBlock[] | undefined,
): AnthropicAssistantContent | undefined =>
  blocks === undefined
    ? undefined
    : create(AnthropicAssistantContentSchema, {
        blocks: blocks.map((block) => ({
          content:
            block.type === "text"
              ? { case: "text" as const, value: block.text }
              : block.type === "tool-call"
                ? {
                    case: "toolCall" as const,
                    value: {
                      providerCallId: block.call.id,
                      toolName: block.call.name,
                      argumentsJson: block.call.input,
                    },
                  }
                : block.type === "thinking"
                  ? {
                      case: "thinking" as const,
                      value: { text: block.text, signature: block.signature },
                    }
                  : { case: "redactedThinking" as const, value: { data: block.data } },
        })),
      });

/**
 * Maps bounded ordered Responses items into the durable typed journal.
 *
 * @param content Complete or interrupted Responses receipt.
 * @returns Typed provider continuation content.
 */
const typedOpenAiContent = (content: OpenAiContent): OpenAiAssistantContent =>
  create(OpenAiContentSchema, {
    complete: content.complete,
    items: content.items.map(typedOpenAiItem),
  });

/**
 * @param item Bounded provider item.
 * @returns Typed journal item.
 */
const typedOpenAiItem = (item: OpenAiBlock) => {
  if (item.type === "reasoning")
    return {
      itemId: item.id,
      content: {
        case: "reasoning" as const,
        value: { summary: [...item.summary], encryptedContent: item.encryptedContent },
      },
    };
  if (item.type === "function_call")
    return {
      itemId: item.id,
      content: {
        case: "functionCall" as const,
        value: {
          call: {
            providerCallId: item.call.id,
            toolName: item.call.name,
            argumentsJson: item.call.input,
          },
          namespace: item.namespace,
        },
      },
    };
  return {
    itemId: item.id,
    content: { case: "message" as const, value: typedOpenAiMessage(item) },
  };
};

/**
 * @param item Bounded message item.
 * @returns Typed journal message.
 */
const typedOpenAiMessage = (item: Extract<OpenAiBlock, { type: "message" }>) => ({
  phase:
    item.phase === "commentary"
      ? OpenAiPhase.COMMENTARY
      : item.phase === "final_answer"
        ? OpenAiPhase.FINAL_ANSWER
        : OpenAiPhase.PHASE_UNSPECIFIED,
  parts: item.parts.map((part) => ({
    content:
      part.type === "output_text"
        ? { case: "outputText" as const, value: part.text }
        : { case: "refusal" as const, value: part.text },
  })),
});

/**
 * @param partial Received content.
 * @param outcome Local outcome.
 * @param failure Safe failure.
 * @param output Validated output.
 * @param schema Output descriptor.
 * @returns Journal response.
 */
const responseContent = (
  partial: StreamedPartialResult,
  outcome: AiOutcome,
  failure: AiFailure | undefined,
  output: MessageShape<MessageSchema> | undefined,
  schema: MessageSchema,
): GenerationResponse =>
  create(GenerationResponseSchema, {
    rawOutput: partial.text,
    outcome,
    toolCalls: partial.toolCalls.map((call) => ({
      providerCallId: call.id,
      toolName: call.name,
      argumentsJson: call.input,
    })),
    ...(partial.anthropicContent !== undefined
      ? { anthropicContent: typedAnthropicContent(partial.anthropicContent) }
      : {}),
    ...(partial.openaiContent !== undefined
      ? { openaiContent: typedOpenAiContent(partial.openaiContent) }
      : {}),
    ...(output ? { admittedOutput: AnyMessages.pack(schema, output) } : {}),
    ...(failure
      ? { diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }) }
      : {}),
    ...(partial.actualModelId
      ? { actualModel: create(ProviderNameSchema, { value: partial.actualModelId }) }
      : {}),
    ...(semanticUsage(partial.usage) ? { usage: semanticUsage(partial.usage) } : {}),
    digest: responseDigest(partial),
  });

/**
 * Computes the stable journal digest from the received provider projection.
 * @param partial Received content.
 * @returns Digest of the provider-facing response fields.
 */
const responseDigest = (partial: StreamedPartialResult): ReturnType<typeof digest> =>
  digest(
    JSON.stringify({
      text: partial.text,
      toolCalls: partial.toolCalls,
      ...(partial.anthropicContent !== undefined
        ? { anthropicContent: partial.anthropicContent }
        : {}),
      ...(partial.openaiContent !== undefined
        ? { openaiContent: canonicalJsonValue(partial.openaiContent) }
        : {}),
    }),
  );

/**
 * @param candidate Provider text.
 * @returns Ax envelope, retaining malformed text for correction.
 */
const axCandidate = (candidate: string): string => {
  try {
    return JSON.stringify({ answer: JSON.parse(candidate) as unknown });
  } catch {
    return candidate;
  }
};

/**
 * * Mutable state for one bounded Ax program; runtime persists every attempt separately.
 */
interface GenerationState {
  /**
   * Journaled assistant responses in the same order Ax emits their turns.
   */
  readonly assistantTurns: { response: GenerationResponse; axContent: string }[];

  /**
   * * Most recent physical attempt for correction correlation.
   */
  previous?: Pick<AiAttemptTicket, "id">;

  /**
   * * Most recent definitive local admission.
   */
  admission?: AiCandidateAdmission;

  /**
   * * Safe diagnostic from an invalid or failed physical attempt.
   */
  failure?: AiFailure;

  /**
   * * Provider IDs retained after their response journal barrier.
   */
  readonly pendingCalls: Map<string, { ticketId: string; providerCallId: string; input: string }[]>;

  /**
   * * Persistence failure that must not be reclassified as provider content.
   */
  barrierFailed?: boolean;
}

/**
 * Restores exact provider block order after checking Ax's projected assistant turn.
 * @param state Current durable response projections.
 * @param message Ax's assistant turn to correlate.
 * @param index Zero-based assistant turn position.
 * @returns Exact provider assistant message.
 */
const recordedAssistant = (
  state: GenerationState,
  message: Extract<AxChatRequest["chatPrompt"][number], { role: "assistant" }>,
  index: number,
): ModelMessage => {
  const recorded = state.assistantTurns[index];
  if (!recorded) throw new TypeError("Assistant journal turn missing");
  verifyAxAssistant(recorded, message);
  const openai = recorded.response.openaiContent;
  if (openai) {
    if (!openai.complete) throw new TypeError("Saved Responses content incomplete");
    return { role: "assistant", content: openai.items.flatMap(openAiAssistantItem) };
  }
  const anthropic = recorded.response.anthropicContent;
  if (!anthropic) throw new TypeError("Anthropic assistant journal turn missing");
  return { role: "assistant", content: anthropic.blocks.map(anthropicAssistantBlock) };
};

/**
 * Rebuilds provider continuation parts from one typed Responses item.
 *
 * @param item Durable ordered item.
 * @returns Published assistant content parts.
 */
const openAiAssistantItem = (
  item: OpenAiAssistantContent["items"][number],
): Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string> => {
  if (item.content.case === "message") {
    const phase =
      item.content.value.phase === OpenAiPhase.COMMENTARY
        ? "commentary"
        : item.content.value.phase === OpenAiPhase.FINAL_ANSWER
          ? "final_answer"
          : undefined;
    return item.content.value.parts.map((part) => {
      if (part.content.case !== "outputText") throw new TypeError("Saved Responses refusal");
      return {
        type: "text" as const,
        text: part.content.value,
        providerOptions: { openai: { itemId: item.itemId, ...(phase ? { phase } : {}) } },
      };
    });
  }
  if (item.content.case === "reasoning")
    return openAiReasoningParts(item.itemId, item.content.value);
  if (item.content.case === "functionCall")
    return [openAiCallPart(item.itemId, item.content.value)];
  throw new TypeError("Saved Responses item missing");
};

/**
 * @param itemId Saved provider item ID.
 * @param content Saved local function call.
 * @returns SDK continuation call.
 */
const openAiCallPart = (
  itemId: string,
  content: Extract<
    OpenAiAssistantContent["items"][number]["content"],
    { case: "functionCall" }
  >["value"],
) => {
  const call = content.call;
  if (!call || !content.namespace) throw new TypeError("Saved Responses call incomplete");
  return {
    type: "tool-call" as const,
    toolCallId: call.providerCallId,
    toolName: call.toolName,
    input: JSON.parse(call.argumentsJson) as object,
    providerOptions: { openai: { itemId, namespace: content.namespace } },
  };
};

/**
 * @param itemId Saved provider item ID.
 * @param reasoning Saved ordered summaries and encrypted state.
 * @returns SDK continuation parts.
 */
const openAiReasoningParts = (
  itemId: string,
  reasoning: NonNullable<
    Extract<OpenAiAssistantContent["items"][number]["content"], { case: "reasoning" }>["value"]
  >,
) => {
  if (!reasoning.encryptedContent) throw new TypeError("Saved Responses reasoning incomplete");
  const summaries = reasoning.summary.length ? reasoning.summary : [""];
  return summaries.map((text, index) => ({
    type: "reasoning" as const,
    text,
    providerOptions: {
      openai: {
        itemId,
        ...(index === summaries.length - 1
          ? { reasoningEncryptedContent: reasoning.encryptedContent }
          : {}),
      },
    },
  }));
};

/**
 * Rejects an Ax turn that cannot be correlated with its journaled response.
 * @param recorded Exact saved response and its Ax projection.
 * @param message Ax's observed assistant turn.
 */
const verifyAxAssistant = (
  recorded: GenerationState["assistantTurns"][number],
  message: Extract<AxChatRequest["chatPrompt"][number], { role: "assistant" }>,
): void => {
  if ((message.content ?? "") !== recorded.axContent)
    throw new TypeError("Anthropic assistant text diverged from journal");
  const calls = message.functionCalls ?? [];
  if (
    calls.length !== recorded.response.toolCalls.length ||
    calls.some((call, callIndex) => {
      const saved = recorded.response.toolCalls[callIndex];
      if (!saved) return true;
      return (
        call.id !== saved.providerCallId ||
        call.function.name !== saved.toolName ||
        JSON.stringify(canonicalJsonValue(call.function.params)) !==
          JSON.stringify(canonicalJsonValue(JSON.parse(saved.argumentsJson) as unknown))
      );
    })
  )
    throw new TypeError("Anthropic assistant tools diverged from journal");
};

/**
 * Restores one typed provider block in its journaled position.
 * @param block Saved Anthropic assistant block.
 * @returns Published Vercel assistant content part.
 */
const anthropicAssistantBlock = (block: AnthropicAssistantContent["blocks"][number]) => {
  const part = block.content;
  if (part.case === "text") return { type: "text" as const, text: part.value };
  if (part.case === "thinking")
    return {
      type: "reasoning" as const,
      text: part.value.text,
      providerOptions: { anthropic: { signature: part.value.signature } },
    };
  if (part.case === "redactedThinking")
    return {
      type: "reasoning" as const,
      text: "",
      providerOptions: { anthropic: { redactedData: part.value.data } },
    };
  if (part.case === "toolCall")
    return {
      type: "tool-call" as const,
      toolCallId: part.value.providerCallId,
      toolName: part.value.toolName,
      input: JSON.parse(part.value.argumentsJson) as unknown,
    };
  throw new TypeError("Anthropic assistant block missing");
};

/**
 * Preserves a failed runtime barrier without recategorizing it as model output.
 * @param state Current Ax operation state.
 * @param callback Runtime reservation, admission, or tool boundary.
 * @typeParam T Runtime callback result.
 * @returns Callback result after its barrier completes.
 */
const runtimeBarrier = async <T>(
  state: GenerationState,
  callback: () => T | Promise<T>,
): Promise<T> => {
  try {
    return await callback();
  } catch (error) {
    state.barrierFailed = true;
    throw error;
  }
};

/**
 * @param request Active execution.
 * @param state Program state.
 * @param code Safe category.
 * @param retryable Later-signal retry permission.
 * @returns Durable diagnostic.
 */
const recordFailure = async (
  request: AiBackendExecution,
  state: GenerationState,
  code: AiFailure["code"],
  retryable: boolean,
): Promise<AiFailure> => {
  try {
    return await request.control.recordFailure(code, retryable);
  } catch (error) {
    state.barrierFailed = true;
    throw error;
  }
};

/**
 * @param request Active execution.
 * @param state Program state.
 * @param completion One physical response.
 */
const finishAttempt = async (
  request: AiBackendExecution,
  state: GenerationState,
  completion: Parameters<AiBackendExecution["control"]["finishAttempt"]>[0],
): Promise<void> => {
  try {
    await request.control.finishAttempt(completion);
  } catch (error) {
    state.barrierFailed = true;
    throw error;
  }
};

/**
 * @param request Active adapter execution.
 * @param ticket Attempt identity.
 * @returns Known receipt only.
 */
const receipt = (request: AiBackendExecution, ticket: AiAttemptTicket) => {
  const bytes = providerConnection(request.model).receivedBytes(ticket.id);
  return bytes === undefined ? {} : { receivedBytes: bytes };
};

/**
 * Retains a failed stream's known receipt only within its reserved allowance.
 * @param request Active adapter execution.
 * @param ticket Attempt identity and output allowance.
 * @returns Bounded receipt, if known.
 */
const failureReceipt = (request: AiBackendExecution, ticket: AiAttemptTicket) => {
  const known = receipt(request, ticket);
  return known.receivedBytes !== undefined && known.receivedBytes <= ticket.maxOutputBytes
    ? known
    : {};
};

/**
 * @param request Selected execution.
 * @param state Program state.
 * @param partial Received stream content.
 * @param ticket Physical attempt.
 * @returns Response after journal barrier.
 */
const journalCandidate = async (
  request: AiBackendExecution,
  state: GenerationState,
  partial: StreamedPartialResult,
  ticket: AiAttemptTicket,
): Promise<AxChatResponse> => {
  state.admission = await runtimeBarrier(state, () =>
    request.control.admitGeneration(partial.text, request.definition, request.input),
  );
  const admitted = state.admission;
  if (!admitted.ok) state.failure = await recordFailure(request, state, "INVALID_OUTPUT", false);
  const response = responseContent(
    partial,
    admitted.ok ? AiOutcome.ADMITTED : AiOutcome.INVALID_OUTPUT,
    admitted.ok ? undefined : state.failure,
    admitted.ok ? admitted.value : undefined,
    request.definition.output,
  );
  await finishAttempt(request, state, {
    ticketId: ticket.id,
    ...receipt(request, ticket),
    response,
    ...(!admitted.ok ? { issues: admitted.issues } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
  });
  state.assistantTurns.push({ response, axContent: axCandidate(partial.text) });
  return { results: [{ index: 0, content: axCandidate(partial.text), finishReason: "stop" }] };
};

/**
 * @param request Selected execution.
 * @param state Program state.
 * @param error Bounded stream error.
 * @param ticket Physical attempt.
 */
const journalFailure = async (
  request: AiBackendExecution,
  state: GenerationState,
  error: StreamCollectionError,
  ticket: AiAttemptTicket,
): Promise<void> => {
  const classification = classifyStreamFailure(error);
  state.failure = await recordFailure(
    request,
    state,
    classification.code,
    classification.retryable,
  );
  const response = responseContent(
    error.partial,
    classification.outcome,
    state.failure,
    undefined,
    request.definition.output,
  );
  await finishAttempt(request, state, {
    ticketId: ticket.id,
    ...failureReceipt(request, ticket),
    response,
    ...(response.usage ? { usage: response.usage } : {}),
  });
};

/**
 * @param error Safe stream diagnostic and optional HTTP status.
 * @returns Failure category without vendor body.
 */
const classifyStreamFailure = (
  error: StreamCollectionError,
): {
  code: AiFailure["code"];
  retryable: boolean;
  outcome: AiOutcome;
} => {
  if (error.message.includes("deadline exceeded"))
    return { code: "DEADLINE_EXCEEDED", retryable: false, outcome: AiOutcome.FAILED };
  if (error.message.includes("cancelled"))
    return { code: "CANCELLED", retryable: false, outcome: AiOutcome.FAILED };
  if (error.partial.finishReason === "length" || error.message.includes("limit"))
    return { code: "INVALID_OUTPUT", retryable: false, outcome: AiOutcome.INVALID_OUTPUT };
  if (error.partial.finishReason === "content-filter")
    return { code: "REFUSED", retryable: false, outcome: AiOutcome.REFUSED };
  if (error.message === "Provider response refused")
    return { code: "REFUSED", retryable: false, outcome: AiOutcome.REFUSED };
  if (error.statusCode === 401 || error.statusCode === 403)
    return { code: "AUTHENTICATION_REQUIRED", retryable: false, outcome: AiOutcome.FAILED };
  if (error.providerCode === "invalid_api_key" || error.providerCode === "invalid_token")
    return { code: "AUTHENTICATION_REQUIRED", retryable: false, outcome: AiOutcome.FAILED };
  if (error.providerCode === "subscription_sharing_usage_limit_exceeded")
    return { code: "RATE_LIMITED", retryable: false, outcome: AiOutcome.FAILED };
  if (error.providerCode === "subscription_sharing_unavailable")
    return { code: "UNAVAILABLE", retryable: false, outcome: AiOutcome.FAILED };
  if (error.statusCode === 429)
    return { code: "RATE_LIMITED", retryable: true, outcome: AiOutcome.FAILED };
  return { code: "UNAVAILABLE", retryable: true, outcome: AiOutcome.FAILED };
};

/**
 * @param name Model-facing function name.
 * @param request Registered capability.
 * @returns Configured policy reference, if advertised.
 */
const toolReference = (name: string, request: AiBackendExecution) => {
  const match = /^tool_(\d+)$/.exec(name);
  const index = match ? Number(match[1]) : Number.NaN;
  return request.definition.kind === "generation" && Number.isSafeInteger(index)
    ? request.definition.tools?.[index]
    : undefined;
};

/**
 * @param partial Complete model response.
 * @param request Registered capability.
 * @returns Whether all proposals can be considered for authorization.
 */
const coherentProposals = (
  partial: StreamedPartialResult,
  request: AiBackendExecution,
): boolean => {
  if (partial.toolCalls.length === 0) return false;
  if (providerConnection(request.model).capabilities.id === "chatgpt-plan-responses-v1") {
    const content = partial.openaiContent;
    const calls = content?.items.filter((item) => item.type === "function_call") ?? [];
    if (
      !content?.complete ||
      calls.length !== partial.toolCalls.length ||
      calls.some((item) => item.namespace !== "spine_mcp")
    )
      return false;
  }
  const seen = new Set<string>();
  for (const call of partial.toolCalls) {
    if (
      !call.id.trim() ||
      !call.name.trim() ||
      seen.has(call.id) ||
      !toolReference(call.name, request)
    )
      return false;
    seen.add(call.id);
    try {
      const args: unknown = JSON.parse(call.input);
      if (typeof args !== "object" || args === null || Array.isArray(args)) return false;
    } catch {
      return false;
    }
  }
  return true;
};

/**
 * Replays only proposals whose exact response crossed the journal barrier.
 * @param partial Recorded provider content.
 * @returns Ax function-call continuation with received text.
 */
const toolContinuation = (partial: StreamedPartialResult): AxChatResponse => ({
  results: [
    {
      index: 0,
      ...(partial.text ? { content: partial.text } : {}),
      functionCalls: partial.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, params: JSON.parse(call.input) as object },
      })),
      finishReason: "function_call",
    },
  ],
});

/**
 * Replays one saved response without admitting a new transport request.
 * @param request Selected typed capability.
 * @param state Ax continuation and validation state.
 * @param replay Complete durable attempt record.
 * @returns Equivalent Ax response for correction or continuation.
 */
const replayGeneration = (
  request: AiBackendExecution,
  state: GenerationState,
  replay: AiAttemptReplay,
): AxChatResponse => {
  const response = replay.response;
  if (response.$typeName !== "spine.ts.agent.GenerationResponse")
    throw new TypeError("Saved attempt response kind mismatch");
  assertAiOutcomeContext(response);
  assertSavedAnthropicContent(request, response);
  assertOpenAiReceipt(request, response);
  if (response.outcome === AiOutcome.ADMITTED)
    return replayAdmittedGeneration(request, state, response);
  const partial: StreamedPartialResult = {
    text: response.rawOutput,
    toolCalls: response.toolCalls.map((call) => ({
      id: call.providerCallId,
      name: call.toolName,
      input: call.argumentsJson,
    })),
    ...(response.openaiContent
      ? { openaiContent: projectedOpenAiContent(response.openaiContent) }
      : {}),
  };
  if (response.outcome === AiOutcome.TOOL_REQUESTED)
    return replayToolProposals(request, state, replay.id, partial, response);
  state.failure = replayFailure(replay);
  if (response.outcome !== AiOutcome.INVALID_OUTPUT || !replay.issues?.length)
    throw new Error("Saved generation failure terminates this attempt");
  state.admission = { ok: false, issues: replay.issues };
  state.assistantTurns.push({ response, axContent: axCandidate(response.rawOutput) });
  return {
    results: [{ index: 0, content: axCandidate(response.rawOutput), finishReason: "stop" }],
  };
};

/**
 * Checks whether saved Anthropic blocks are complete enough to resume.
 * @param request Selected typed capability.
 * @param response Saved generation response.
 */
const assertSavedAnthropicContent = (
  request: AiBackendExecution,
  response: GenerationResponse,
): void => {
  if (providerConnection(request.model).capabilities.id !== "anthropic-messages-v1") return;
  if (!response.anthropicContent) throw new TypeError("Saved Anthropic content missing");
  if (
    (response.outcome === AiOutcome.TOOL_REQUESTED ||
      response.outcome === AiOutcome.INVALID_OUTPUT) &&
    response.anthropicContent.blocks.some(
      (block) =>
        (block.content.case === "thinking" && !block.content.value.signature) ||
        (block.content.case === "redactedThinking" && !block.content.value.data),
    )
  )
    throw new TypeError("Saved Anthropic content incomplete");
};

/**
 * Rebuilds bounded typed items for saved digest and projection checks.
 *
 * @param content Saved Responses receipt.
 * @returns Ordered provider item projection.
 */
const projectedOpenAiContent = (content: OpenAiAssistantContent): OpenAiContent => ({
  complete: content.complete,
  items: content.items.map(projectedOpenAiItem),
});

/**
 * @param item Durable typed item.
 * @returns Bounded response projection.
 */
const projectedOpenAiItem = (item: OpenAiAssistantContent["items"][number]): OpenAiBlock => {
  if (item.content.case === "reasoning")
    return {
      type: "reasoning",
      id: item.itemId,
      summary: item.content.value.summary,
      encryptedContent: item.content.value.encryptedContent,
    };
  if (item.content.case === "functionCall") {
    const call = item.content.value.call;
    if (!call) throw new TypeError("Saved Responses call missing");
    return {
      type: "function_call",
      id: item.itemId,
      call: { id: call.providerCallId, name: call.toolName, input: call.argumentsJson },
      namespace: item.content.value.namespace,
    };
  }
  if (item.content.case === "message")
    return {
      type: "message",
      id: item.itemId,
      phase:
        item.content.value.phase === OpenAiPhase.COMMENTARY
          ? "commentary"
          : item.content.value.phase === OpenAiPhase.FINAL_ANSWER
            ? "final_answer"
            : "",
      parts: item.content.value.parts.map((part) => ({
        type: part.content.case === "outputText" ? "output_text" : "refusal",
        text: part.content.value ?? "",
      })),
    };
  throw new TypeError("Saved Responses item missing");
};

/**
 * Checks the complete typed provider receipt before replay or continuation.
 *
 * @param request Selected authenticated profile.
 * @param response Durable generation receipt.
 */
const assertOpenAiReceipt = (request: AiBackendExecution, response: GenerationResponse): void => {
  if (providerConnection(request.model).capabilities.id !== "chatgpt-plan-responses-v1") return;
  if (!response.openaiContent) throw new TypeError("Saved Responses content missing");
  const content = projectedOpenAiContent(response.openaiContent);
  assertOpenAiItems(content, response);
  if (
    !content.complete &&
    (response.outcome === AiOutcome.ADMITTED ||
      response.outcome === AiOutcome.TOOL_REQUESTED ||
      response.outcome === AiOutcome.INVALID_OUTPUT)
  )
    throw new TypeError("Saved Responses content incomplete");
  assertOpenAiProjection(content, response);
};

/**
 * @param content Typed provider receipt.
 */
const assertOpenAiItems = (content: OpenAiContent, response: GenerationResponse): void => {
  const ids = new Set<string>();
  for (const item of content.items) {
    if (!item.id || ids.has(item.id)) throw new TypeError("Saved Responses item ID invalid");
    ids.add(item.id);
    if (item.type === "reasoning" && !item.encryptedContent)
      throw new TypeError("Saved Responses reasoning incomplete");
    if (item.type === "function_call" && item.namespace !== "spine_mcp")
      throw new TypeError("Saved Responses namespace invalid");
    if (
      item.type === "message" &&
      item.parts.some((part) => part.type === "refusal") &&
      (content.complete ||
        (response.outcome !== AiOutcome.FAILED && response.outcome !== AiOutcome.REFUSED))
    )
      throw new TypeError("Saved Responses refusal");
  }
};

/**
 * @param content Typed provider receipt.
 * @param response Saved response projection.
 */
const assertOpenAiProjection = (content: OpenAiContent, response: GenerationResponse): void => {
  const text = content.items
    .flatMap((item) =>
      item.type === "message"
        ? item.parts.filter((part) => part.type === "output_text").map((part) => part.text)
        : [],
    )
    .join("");
  const calls = content.items.flatMap((item) => (item.type === "function_call" ? [item.call] : []));
  const partialFailure =
    !content.complete &&
    (response.outcome === AiOutcome.FAILED || response.outcome === AiOutcome.REFUSED);
  if (
    !(partialFailure ? response.rawOutput.startsWith(text) : text === response.rawOutput) ||
    !(partialFailure
      ? calls.length <= response.toolCalls.length
      : calls.length === response.toolCalls.length) ||
    calls.some(
      (call, index) =>
        call.id !== response.toolCalls[index]?.providerCallId ||
        call.name !== response.toolCalls[index].toolName ||
        call.input !== response.toolCalls[index].argumentsJson,
    ) ||
    response.digest?.value !== savedOpenAiDigest(content, response)
  )
    throw new TypeError("Saved Responses projection changed");
};

/**
 * @param content Durable typed receipt projection.
 * @param response Durable standard response fields.
 * @returns Digest of both projections.
 */
const savedOpenAiDigest = (content: OpenAiContent, response: GenerationResponse): string =>
  responseDigest({
    text: response.rawOutput,
    toolCalls: response.toolCalls.map((call) => ({
      id: call.providerCallId,
      name: call.toolName,
      input: call.argumentsJson,
    })),
    openaiContent: content,
  }).value;

/**
 * Rebuilds a saved admitted generation without provider dispatch.
 * @param request Selected typed capability.
 * @param state Ax continuation and validation state.
 * @param response Saved admitted generation response.
 * @returns Equivalent Ax response with admitted application output.
 */
const replayAdmittedGeneration = (
  request: AiBackendExecution,
  state: GenerationState,
  response: GenerationResponse,
): AxChatResponse => {
  const output =
    response.admittedOutput &&
    AnyMessages.unpack(response.admittedOutput, request.definition.output);
  if (!output) throw new TypeError("Saved generation output missing");
  state.admission = { ok: true, value: output };
  return {
    results: [
      {
        index: 0,
        content: axCandidate(toJsonString(request.definition.output, output)),
        finishReason: "stop",
      },
    ],
  };
};

/**
 * Rebuilds only a previously journaled coherent tool proposal queue.
 */
const replayToolProposals = (
  request: AiBackendExecution,
  state: GenerationState,
  ticketId: string,
  partial: StreamedPartialResult,
  response: GenerationResponse,
): AxChatResponse => {
  if (!coherentProposals(partial, request)) throw new TypeError("Saved tool proposals invalid");
  for (const call of partial.toolCalls) {
    const queue = state.pendingCalls.get(call.name) ?? [];
    queue.push({ ticketId, providerCallId: call.id, input: call.input });
    state.pendingCalls.set(call.name, queue);
  }
  state.assistantTurns.push({ response, axContent: partial.text });
  return toolContinuation(partial);
};

/**
 * @param request Selected execution.
 * @param state Program state.
 * @param partial Complete proposal batch.
 * @param ticket Attempt identity.
 * @returns Ax continuation after durable response journal.
 */
const journalToolProposals = async (
  request: AiBackendExecution,
  state: GenerationState,
  partial: StreamedPartialResult,
  ticket: AiAttemptTicket,
): Promise<AxChatResponse> => {
  const coherent = coherentProposals(partial, request);
  if (!coherent) state.failure = await recordFailure(request, state, "INVALID_OUTPUT", false);
  const response = responseContent(
    partial,
    coherent ? AiOutcome.TOOL_REQUESTED : AiOutcome.INVALID_OUTPUT,
    coherent ? undefined : state.failure,
    undefined,
    request.definition.output,
  );
  await finishAttempt(request, state, {
    ticketId: ticket.id,
    ...receipt(request, ticket),
    response,
    ...(response.usage ? { usage: response.usage } : {}),
  });
  if (!coherent) throw new Error("Invalid provider tool proposals");
  state.assistantTurns.push({ response, axContent: partial.text });
  for (const call of partial.toolCalls) {
    const queue = state.pendingCalls.get(call.name) ?? [];
    queue.push({ ticketId: ticket.id, providerCallId: call.id, input: call.input });
    state.pendingCalls.set(call.name, queue);
  }
  return toolContinuation(partial);
};

/**
 * @param request Selected execution.
 * @param state Correlated proposal queues.
 * @returns Ax functions that call only the runtime policy boundary.
 */
const runtimeFunctions = (request: AiBackendExecution, state: GenerationState) => {
  if (request.definition.kind !== "generation") return [];
  return advertisedFunctions(request).map((tool) => ({
    name: tool.modelName,
    description: tool.description,
    parameters: tool.axSchema,
    func: async () => {
      const next = state.pendingCalls.get(tool.modelName)?.shift();
      if (!next) throw new Error("Unrecorded provider tool proposal");
      const result = await runtimeBarrier(state, () =>
        request.control.callTool({
          ticketId: next.ticketId,
          providerCallId: next.providerCallId,
          server: tool.server,
          tool: tool.tool,
          argumentsJson: next.input,
        }),
      );
      if (result.outcome !== AiOutcome.ADMITTED || result.toolError) {
        const code = result.outcome === AiOutcome.UNKNOWN ? "TOOL_OUTCOME_UNKNOWN" : "TOOL_FAILED";
        state.failure = await recordFailure(request, state, code, false);
        throw new Error("Runtime tool call failed");
      }
      return result.structuredJson || result.text.join("\n");
    },
  }));
};

/**
 * Prepares the exact prompt, output mode, and limits for one provider stream.
 * @param request Selected generation capability.
 * @param prepared Ax-rendered prompt.
 * @param schema Descriptor-derived application output schema.
 * @param ticket Durable physical attempt.
 * @param settings Provider options already bound to the prepared request.
 * @returns Published provider call options.
 */
const providerOptions = (
  request: AiBackendExecution,
  prepared: PreparedRequest,
  schema: JSONSchema7,
  ticket: AiAttemptTicket,
  settings: ProviderSettings,
): V3Options => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const instructions = outputInstructions(definition.instructions, definition.outputMode, schema);
  const chatgptPlan =
    providerConnection(request.model).capabilities.id === "chatgpt-plan-responses-v1";
  const options = {
    prompt: modelPrompt(prepared, instructions),
    tools: advertisedFunctions(request).map((tool) => providerTool(tool, chatgptPlan)),
    abortSignal: ticket.signal,
    ...(chatgptPlan ? { includeRawChunks: true } : {}),
    ...(definition.limits.maxOutputTokens
      ? { maxOutputTokens: definition.limits.maxOutputTokens }
      : {}),
    responseFormat:
      definition.outputMode === "native-schema"
        ? { type: "json" as const, schema }
        : { type: "text" as const },
  };
  return settings ? { ...options, providerOptions: settings } : options;
};

/**
 * @param tool Verified local function.
 * @param chatgptPlan Whether namespace lowering is required.
 * @returns Provider-visible tool declaration.
 */
const providerTool = (
  tool: ReturnType<typeof advertisedFunctions>[number],
  chatgptPlan: boolean,
) => ({
  type: "function" as const,
  name: tool.modelName,
  description: tool.description,
  inputSchema: tool.schema,
  ...(chatgptPlan
    ? {
        providerOptions: {
          openai: { namespace: { name: "spine_mcp", description: "Configured local MCP tools" } },
        },
      }
    : {}),
});

/**
 * @param request Selected execution.
 * @param state Program state.
 * @param prepared Actual Ax request.
 * @param schema Provider schema.
 * @returns One journaled physical model response.
 */
const chat = async (
  request: AiBackendExecution,
  state: GenerationState,
  prepared: PreparedRequest,
  schema: JSONSchema7,
): Promise<AxChatResponse> => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const connection = providerConnection(request.model);
  if (!("doStream" in connection.model)) throw new TypeError("Streaming generation model required");
  const settings = chatgptPlanOptions(request) ?? anthropicOptions(request);
  const content = requestContent(request, prepared, schema, state.previous, settings);
  const attempt = await runtimeBarrier(state, () =>
    request.control.beginAttempt({ kind: "generation", content }),
  );
  if ("kind" in attempt) {
    state.previous = { id: attempt.id };
    try {
      return replayGeneration(request, state, attempt);
    } catch (error) {
      if (!state.failure) state.barrierFailed = true;
      throw error;
    }
  }
  const ticket = attempt;
  state.previous = ticket;
  await admitGenerationTicket(request, state, ticket);
  return collectAttempt(request, state, prepared, schema, ticket, settings);
};

/**
 * Streams one admitted ticket and journals either its proposal or output.
 */
const collectAttempt = async (
  request: AiBackendExecution,
  state: GenerationState,
  prepared: PreparedRequest,
  schema: JSONSchema7,
  ticket: AiAttemptTicket,
  settings: ProviderSettings,
): Promise<AxChatResponse> => {
  const connection = providerConnection(request.model);
  if (!("doStream" in connection.model)) throw new TypeError("Streaming generation model required");
  const options = providerOptions(request, prepared, schema, ticket, settings);
  let partial: StreamedPartialResult;
  try {
    partial = await collectModelStream(
      connection.model,
      options,
      ticket.maxOutputBytes,
      {
        deadlineEpochMs: ticket.deadlineEpochMs,
        nowEpochMs: request.control.nowEpochMs,
      },
      connection.capabilities.id === "anthropic-messages-v1",
      connection.capabilities.id === "chatgpt-plan-responses-v1",
    );
  } catch (error) {
    if (!(error instanceof StreamCollectionError)) throw error;
    await journalFailure(request, state, error, ticket);
    throw error;
  }
  if (partial.toolCalls.length || partial.finishReason === "tool-calls")
    return journalToolProposals(request, state, partial, ticket);
  return journalCandidate(request, state, partial, ticket);
};

/**
 * Runs Ax corrections and tool continuations through one controlled stream.
 * @param request Selected generation execution.
 * @param model Authenticated provider model.
 * @param schema Descriptor-derived output schema.
 * @param state Attempt and admission state.
 * @returns Completion after Ax stops or exhausts its request allowance.
 */
const runProgram = async (
  request: AiBackendExecution,
  model: StreamModel,
  schema: JSONSchema7,
  state: GenerationState,
): Promise<void> => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const generator = correctionGenerator(state);
  const service = AxVercelBridge.createControlled(model, {
    maxRequests: definition.limits.modelRequests,
    onChat: (_model, prepared) => chat(request, state, prepared, schema),
    ...(["anthropic-messages-v1", "chatgpt-plan-responses-v1"].includes(
      providerConnection(request.model).capabilities.id,
    )
      ? {
          onAssistant: (
            message: Extract<AxChatRequest["chatPrompt"][number], { role: "assistant" }>,
            index: number,
          ) => recordedAssistant(state, message, index),
        }
      : {}),
  });
  await generator.forward(
    service,
    { facts: toJsonString(definition.input, request.input) },
    {
      structuredOutputMode: "native",
      maxRetries: definition.limits.modelRequests - 1,
      functions: runtimeFunctions(request, state),
      abortSignal: request.control.signal,
    },
  );
};

/**
 * Configures the bounded Ax correction feedback for one execution.
 * @param state Current admission and validation state.
 * @returns Generator with local validation feedback.
 */
const correctionGenerator = (
  state: GenerationState,
): AxGen<{ facts: string }, { answer: object }> => {
  const generator = new AxGen<{ facts: string }, { answer: object }>(
    "facts: string -> answer: json",
  );
  generator.addAssert(() => {
    if (state.admission?.ok) return true;
    const feedback = state.admission?.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    return feedback !== undefined && feedback.length > 0 ? feedback : false;
  });
  return generator;
};

/**
 * Executes bounded Ax correction over direct Vercel provider streams.
 * @param request Selected authenticated generation and runtime barriers.
 * @returns Definitively admitted output or safe failure.
 */
export const executeGeneration = async (request: AiBackendExecution): Promise<AiBackendOutcome> => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const connection = providerConnection(request.model);
  if (!("doStream" in connection.model)) throw new TypeError("Streaming generation model required");
  const schema = deriveOutputSchema(definition.output) as JSONSchema7;
  const state: GenerationState = { pendingCalls: new Map(), assistantTurns: [] };
  try {
    advertisedFunctions(request);
    if (unsupportedGeneration(request)) {
      state.failure = await recordFailure(request, state, "UNSUPPORTED_CAPABILITY", false);
      return { ok: false, failure: state.failure };
    }
    await runProgram(request, connection.model, schema, state);
    if (state.admission?.ok) return { ok: true, value: state.admission.value };
  } catch (error) {
    if (state.barrierFailed) throw error;
    state.failure ??= await recordFailure(request, state, "INVALID_OUTPUT", false);
  } finally {
    connection.gate.revoke();
  }
  return {
    ok: false,
    failure: state.failure ?? (await recordFailure(request, state, "INVALID_OUTPUT", false)),
  };
};

/**
 * @param request Selected generation.
 * @returns Whether the provider rejects its requested contract.
 */
const unsupportedGeneration = (request: AiBackendExecution): boolean => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const capabilities = providerConnection(request.model).capabilities;
  if (
    capabilities.tokenCeiling === "unsupported" &&
    definition.limits.maxOutputTokens !== undefined
  )
    return true;
  if (definition.outputMode !== "native-schema") return false;
  if (capabilities.id === "chatgpt-plan-responses-v1") return true;
  return (
    capabilities.id === "anthropic-messages-v1" &&
    !nativeAnthropicModels.has(request.identity.model)
  );
};
