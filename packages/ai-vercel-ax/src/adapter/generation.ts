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
import { AxGen, type AxChatResponse } from "@ax-llm/ax";
import type { JSONSchema7, LanguageModelV3Message, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { AnyMessages, type MessageSchema } from "@spine-event-engine/core";
import type { AiFailure } from "@spine-event-engine/ai";
import {
  deriveOutputSchema,
  type AiBackendExecution,
  type AiBackendOutcome,
  type AiCandidateAdmission,
  type AiAttemptTicket,
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
  type GenerationResponse,
} from "@spine-event-engine/proto/agent";
import { AxVercelBridge, type PreparedRequest } from "./bridge.js";
import { providerConnection } from "./factory.js";
import {
  collectModelStream,
  StreamCollectionError,
  type StreamModel,
  type StreamedPartialResult,
} from "./streamed-model.js";

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
  const parts = message.content.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    if (part.type === "tool-call")
      return {
        type: "tool-call" as const,
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      };
    throw new TypeError("Unsupported assistant continuation content");
  });
  return { role: "assistant", content: parts };
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
 * @param request Selected execution.
 * @param prepared Actual prompt.
 * @param schema Native schema.
 * @param previous Correction target.
 * @returns Persistable exact request.
 */
const requestContent = (
  request: AiBackendExecution,
  prepared: PreparedRequest,
  schema: JSONSchema7,
  previous: AiAttemptTicket | undefined,
) => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const instructions = outputInstructions(definition.instructions, definition.outputMode, schema);
  const outputSchemaJson = JSON.stringify(schema);
  const promptJson = JSON.stringify(modelPrompt(prepared, instructions));
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
    ...(output ? { admittedOutput: AnyMessages.pack(schema, output) } : {}),
    ...(failure
      ? { diagnosticId: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }) }
      : {}),
    ...(partial.actualModelId
      ? { actualModel: create(ProviderNameSchema, { value: partial.actualModelId }) }
      : {}),
    ...(semanticUsage(partial.usage) ? { usage: semanticUsage(partial.usage) } : {}),
    digest: digest(JSON.stringify({ text: partial.text, toolCalls: partial.toolCalls })),
  });

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
 * Mutable state for one bounded Ax program; runtime persists every attempt separately.
 */
interface GenerationState {
  /**
   * Most recent physical attempt for correction correlation.
   */
  previous?: AiAttemptTicket;

  /**
   * Most recent definitive local admission.
   */
  admission?: AiCandidateAdmission;

  /**
   * Safe diagnostic from an invalid or failed physical attempt.
   */
  failure?: AiFailure;

  /**
   * Provider IDs retained after their response journal barrier.
   */
  readonly pendingCalls: Map<string, { ticketId: string; providerCallId: string; input: string }[]>;

  /**
   * Persistence failure that must not be reclassified as provider content.
   */
  barrierFailed?: boolean;
}

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
    state.failure,
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
    ...receipt(request, ticket),
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
  if (error.statusCode === 401 || error.statusCode === 403)
    return { code: "AUTHENTICATION_REQUIRED", retryable: false, outcome: AiOutcome.FAILED };
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
  return (request.definition.tools ?? []).map((ref, index) => ({
    name: `tool_${String(index)}`,
    description: `${ref.server}/${ref.tool}`,
    parameters: { type: "object" as const, properties: {}, additionalProperties: true },
    func: async () => {
      const next = state.pendingCalls.get(`tool_${String(index)}`)?.shift();
      if (!next) throw new Error("Unrecorded provider tool proposal");
      const result = await runtimeBarrier(state, () =>
        request.control.callTool({
          ticketId: next.ticketId,
          providerCallId: next.providerCallId,
          server: ref.server,
          tool: ref.tool,
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
 * @returns Published provider call options.
 */
const providerOptions = (
  request: AiBackendExecution,
  prepared: PreparedRequest,
  schema: JSONSchema7,
  ticket: AiAttemptTicket,
) => {
  const definition = request.definition;
  if (definition.kind !== "generation") throw new TypeError("Generation capability required");
  const instructions = outputInstructions(definition.instructions, definition.outputMode, schema);
  return {
    prompt: modelPrompt(prepared, instructions),
    abortSignal: ticket.signal,
    ...(definition.limits.maxOutputTokens
      ? { maxOutputTokens: definition.limits.maxOutputTokens }
      : {}),
    responseFormat:
      definition.outputMode === "native-schema"
        ? { type: "json" as const, schema }
        : { type: "text" as const },
  };
};

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
  const content = requestContent(request, prepared, schema, state.previous);
  const ticket = await runtimeBarrier(state, () =>
    request.control.beginAttempt({ kind: "generation", content }),
  );
  state.previous = ticket;
  await admitGenerationTicket(request, state, ticket);
  const options = providerOptions(request, prepared, schema, ticket);
  let partial: StreamedPartialResult;
  try {
    partial = await collectModelStream(connection.model, options, ticket.maxOutputBytes, {
      deadlineEpochMs: ticket.deadlineEpochMs,
      nowEpochMs: request.control.nowEpochMs,
    });
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
  const service = AxVercelBridge.createControlled(model, {
    maxRequests: definition.limits.modelRequests,
    onChat: (_model, prepared) => chat(request, state, prepared, schema),
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
  const state: GenerationState = { pendingCalls: new Map() };
  try {
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
