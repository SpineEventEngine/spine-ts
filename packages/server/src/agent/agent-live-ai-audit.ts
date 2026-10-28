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

import { create, toBinary } from "@bufbuild/protobuf";
import { createHash, randomUUID } from "node:crypto";
import { AnyPacker, Time, type MessageSchema } from "@spine-event-engine/core";
import type { AiFailure, AiModel } from "@spine-event-engine/ai";
import type {
  AiAttemptCompletion,
  AiAttemptRequest,
  AiBackendOutcome,
  AiToolInvocation,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AgentAiOperationStartedSchema as OperationStartedSchema,
  AgentModelAttemptStartedSchema as AttemptStartedSchema,
  AgentModelAttemptFinishedSchema as AttemptFinishedSchema,
  AgentAiResultAdmittedSchema as ResultAdmittedSchema,
  AgentAiOperationFailedSchema as OperationFailedSchema,
  AgentHistoryEntrySchema,
  ConversationRecordSchema,
  ConversationRecordIdSchema,
  AiAttemptIdSchema,
  AiCapabilityNameSchema,
  AiCapabilityRevisionSchema,
  AiContentDigestSchema,
  AiDiagnosticIdSchema,
  AiValidationRevisionSchema,
  AiOperationLimitsSchema,
  AiModelRequestLimitSchema as ModelRequestLimitSchema,
  AiToolCallLimitSchema as ToolCallLimitSchema,
  AiDeadlineMillisSchema,
  AiInputByteLimitSchema as InputByteLimitSchema,
  AiOutputByteLimitSchema as OutputByteLimitSchema,
  AiOutputTokenLimitSchema as OutputTokenLimitSchema,
  AiExecutionMode,
  AiOutcome,
  AiFailureCode,
  GenerationRequestSchema,
  GenerationResponseSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  AgentToolCallStartedSchema as ToolStartedSchema,
  AgentToolCallFinishedSchema as ToolFinishedSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  AiToolCallIdSchema as ToolCallIdSchema,
  type AgentHistoryEntry,
  type ToolRequest,
  type ToolResponse,
} from "@spine-event-engine/proto/agent";
import type { AgentOperationIdentity, AgentLiveModel } from "./agent-live-inputs.js";
import { AgentLiveAudit } from "./agent-live-audit.js";

type Model = AiModel<MessageSchema, MessageSchema>;
const failureCodes: Readonly<Record<AiFailure["code"], AiFailureCode>> = Object.freeze({
  INVALID_INPUT: AiFailureCode.INVALID_INPUT,
  UNSUPPORTED_CAPABILITY: AiFailureCode.UNSUPPORTED_CAPABILITY,
  AUTHENTICATION_REQUIRED: AiFailureCode.AUTHENTICATION_REQUIRED,
  RATE_LIMITED: AiFailureCode.RATE_LIMITED,
  UNAVAILABLE: AiFailureCode.UNAVAILABLE,
  REFUSED: AiFailureCode.REFUSED,
  INVALID_OUTPUT: AiFailureCode.INVALID_OUTPUT,
  BUDGET_EXCEEDED: AiFailureCode.BUDGET_EXCEEDED,
  TOOL_FAILED: AiFailureCode.TOOL_FAILED,
  TOOL_OUTCOME_UNKNOWN: AiFailureCode.TOOL_OUTCOME_UNKNOWN,
  CANCELLED: AiFailureCode.CANCELLED,
  DEADLINE_EXCEEDED: AiFailureCode.DEADLINE_EXCEEDED,
});

/**
 * Emits exact live AI audit facts with paired conversation rows.
*/
export class AgentLiveAiAudit {
  #lastAttempt: { id: string; outcome: AiOutcome } | undefined;

  /**
   * Binds one named operation to original typed source and selected model.
   *
   * @param audit Retained history audit for this invocation.
   * @param model Selected AI model for this invocation.
   * @param operation Current AI operation identity.
   * @param selected Models or selection retained for this invocation.
  */
  constructor(
    private readonly audit: AgentLiveAudit<unknown>,
    private readonly operation: AgentOperationIdentity,
    private readonly selected: AgentLiveModel,
    private readonly model: Model,
  ) {}

  /**
   * Writes operation start before the model adapter can run.
   *
   * @param input Typed input for this operation.
   * @returns Completion after the start history is saved.
  */
  async started(input: object): Promise<void> {
    const digest = createHash("sha256")
      .update(toBinary(this.model.definition.input, input as never))
      .digest("hex");
    const definition = this.model.definition;
    const mode =
      definition.kind === "decision"
        ? AiExecutionMode.DECISION_DIRECT
        : definition.outputMode === "native-schema"
          ? AiExecutionMode.GENERATION_NATIVE_SCHEMA
          : AiExecutionMode.GENERATION_PROMPT_VALIDATE;
    await this.audit.save(
      OperationStartedSchema,
      create(OperationStartedSchema, {
        operation: this.audit.reference(this.operation, this.selected),
        capability: create(AiCapabilityNameSchema, { value: definition.name }),
        capabilityRevision: create(AiCapabilityRevisionSchema, { value: definition.version }),
        input: create(AiContentDigestSchema, { value: digest }),
        limits: this.limits(),
        connection: this.selected.connection,
        startedAt: Time.currentTime(),
        mode,
      }),
    );
  }

  /**
   * Writes a physical request and exact typed conversation input before dispatch.
   *
   * @param id Typed identifier of the requested item.
   * @param request Typed request for the current operation.
   * @returns Completion after the physical request and input history are saved.
  */
  async attemptStarted(request: AiAttemptRequest, id: string): Promise<void> {
    const content =
      request.kind === "generation"
        ? AnyPacker.pack(GenerationRequestSchema, request.content)
        : AnyPacker.pack(DecisionRequestSchema, request.content);
    const history = this.conversation(id, content);
    await this.audit.save(
      AttemptStartedSchema,
      create(AttemptStartedSchema, {
        operation: this.audit.reference(this.operation, this.selected),
        attempt: create(AiAttemptIdSchema, { value: id }),
        startedAt: Time.currentTime(),
        request: request.content.digest,
        ...(request.kind === "generation" && request.content.corrects !== undefined
          ? { previousAttempt: request.content.corrects }
          : {}),
      }),
      [history],
    );
  }

  /**
   * Writes one measured physical response with its original typed conversation row.
   *
   * @param completion Completed provider attempt or operation.
   * @returns Completion after the measured response history is saved.
  */
  async attemptFinished(completion: AiAttemptCompletion): Promise<void> {
    const response = completion.response;
    const generation = response.$typeName === GenerationResponseSchema.typeName;
    const content = generation
      ? AnyPacker.pack(GenerationResponseSchema, response)
      : AnyPacker.pack(DecisionResponseSchema, response);
    this.#lastAttempt = { id: completion.ticketId, outcome: response.outcome };
    await this.audit.save(
      AttemptFinishedSchema,
      create(AttemptFinishedSchema, {
        operation: this.audit.reference(this.operation, this.selected),
        attempt: create(AiAttemptIdSchema, { value: completion.ticketId }),
        outcome: response.outcome,
        finishedAt: Time.currentTime(),
        ...(generation && response.digest !== undefined ? { response: response.digest } : {}),
        ...(response.usage === undefined ? {} : { usage: response.usage }),
        ...(response.diagnosticId === undefined ? {} : { diagnosticId: response.diagnosticId }),
      }),
      [this.conversation(completion.ticketId, content)],
    );
  }

  /**
   * Writes the admitted output identity or safe logical failure.
   *
   * @param result Completed operation result.
   * @returns Completion after the logical outcome history is saved.
  */
  async outcome(result: AiBackendOutcome): Promise<void> {
    if (result.ok) {
      const digest = createHash("sha256")
        .update(toBinary(this.model.definition.output, result.value))
        .digest("hex");
      await this.audit.save(
        ResultAdmittedSchema,
        create(ResultAdmittedSchema, {
          operation: this.audit.reference(this.operation, this.selected),
          result: create(AiContentDigestSchema, { value: digest }),
          validationRevision: create(AiValidationRevisionSchema, {
            value: this.model.definition.validation?.version ?? this.model.definition.version,
          }),
          admittedAt: Time.currentTime(),
        }),
      );
      return;
    }
    await this.audit.save(
      OperationFailedSchema,
      create(OperationFailedSchema, {
        operation: this.audit.reference(this.operation, this.selected),
        outcome:
          this.#lastAttempt?.outcome === AiOutcome.TOOL_REQUESTED
            ? AiOutcome.FAILED
            : (this.#lastAttempt?.outcome ?? AiOutcome.FAILED),
        diagnosticId: create(AiDiagnosticIdSchema, { value: result.failure.diagnosticId }),
        ...(this.#lastAttempt === undefined
          ? {}
          : { attempt: create(AiAttemptIdSchema, { value: this.#lastAttempt.id }) }),
        failedAt: Time.currentTime(),
        failure: failureCodes[result.failure.code],
      }),
    );
  }

  /**
   * Writes an authorized tool request and its original conversation input before dispatch.
   *
   * @param invocation Captured live Agent invocation.
   * @param request Typed request for the current operation.
   * @returns Completion after the tool request and conversation input are saved.
  */
  async toolStarted(invocation: AiToolInvocation, request: ToolRequest): Promise<void> {
    if (request.call === undefined) throw new Error("Agent tool audit requires its call ID.");
    const digest = createHash("sha256").update(request.argumentsJson).digest("hex");
    await this.audit.save(
      ToolStartedSchema,
      create(ToolStartedSchema, {
        operation: this.audit.reference(this.operation, this.selected),
        attempt: create(AiAttemptIdSchema, { value: invocation.ticketId }),
        call: request.call,
        server: request.server,
        tool: request.tool,
        arguments: create(AiContentDigestSchema, { value: digest }),
        effect: request.effect,
        startedAt: Time.currentTime(),
      }),
      [this.toolConversation(request.call.value, AnyPacker.pack(ToolRequestSchema, request))],
    );
  }

  /**
   * Writes one bounded tool response and its paired conversation row.
   *
   * @param history Retained history entries or history port.
   * @param response Typed response from the provider.
   * @returns Completion after the tool response and conversation row are saved.
  */
  async toolFinished(response: ToolResponse, history: AgentHistoryEntry): Promise<void> {
    await this.audit.save(
      ToolFinishedSchema,
      create(ToolFinishedSchema, {
        operation: this.audit.reference(this.operation, this.selected),
        call: response.call,
        outcome: response.outcome,
        result: create(AiContentDigestSchema, {
          value: createHash("sha256").update(toBinary(ToolResponseSchema, response)).digest("hex"),
        }),
        ...(response.diagnosticId === undefined ? {} : { diagnosticId: response.diagnosticId }),
        finishedAt: Time.currentTime(),
      }),
      [history],
    );
  }

  /**
   * Wraps one tool request in the same live conversation as its response.
   *
   * @param callId Exact MCP tool call identifier.
   * @param content Typed model content.
   * @returns The typed conversation record for one tool exchange.
  */
  private toolConversation(
    callId: string,
    content: ReturnType<typeof AnyPacker.pack>,
  ): AgentHistoryEntry {
    const occurredAt = Time.currentTime();
    return create(AgentHistoryEntrySchema, {
      occurredAt,
      item: {
        case: "conversationRecord",
        value: create(ConversationRecordSchema, {
          id: create(ConversationRecordIdSchema, { value: randomUUID() }),
          conversation: this.operation.conversation,
          operation: this.operation.operation,
          toolCall: create(ToolCallIdSchema, { value: callId }),
          occurredAt,
          content,
        }),
      },
    });
  }

  /**
   * Wraps one typed physical exchange in a real conversation record.
   *
   * @param content Typed model content.
   * @param id Typed identifier of the requested item.
   * @returns The typed conversation record for one physical exchange.
  */
  private conversation(
    id: string,
    content: ReturnType<typeof AnyPacker.pack>,
  ): ReturnType<typeof create<typeof AgentHistoryEntrySchema>> {
    const occurredAt = Time.currentTime();
    return create(AgentHistoryEntrySchema, {
      occurredAt,
      item: {
        case: "conversationRecord",
        value: create(ConversationRecordSchema, {
          id: create(ConversationRecordIdSchema, { value: randomUUID() }),
          conversation: this.operation.conversation,
          operation: this.operation.operation,
          attempt: create(AiAttemptIdSchema, { value: id }),
          occurredAt,
          content,
        }),
      },
    });
  }

  /**
   * Creates current capability limits for a genuine start audit.
   *
   * @returns The current configured limits for the start audit.
  */
  private limits() {
    const limits = this.model.definition.limits;
    return create(AiOperationLimitsSchema, {
      ...(limits.modelRequests === undefined
        ? {}
        : { modelRequests: create(ModelRequestLimitSchema, { value: limits.modelRequests }) }),
      ...(limits.toolCalls === undefined
        ? {}
        : { toolCalls: create(ToolCallLimitSchema, { value: limits.toolCalls }) }),
      ...(limits.deadlineMs === undefined
        ? {}
        : { deadlineMs: create(AiDeadlineMillisSchema, { value: BigInt(limits.deadlineMs) }) }),
      ...(limits.maxInputBytes === undefined
        ? {}
        : {
            maxInputBytes: create(InputByteLimitSchema, { value: BigInt(limits.maxInputBytes) }),
          }),
      ...(limits.maxOutputBytes === undefined
        ? {}
        : {
            maxOutputBytes: create(OutputByteLimitSchema, {
              value: BigInt(limits.maxOutputBytes),
            }),
          }),
      ...(limits.maxOutputTokens === undefined
        ? {}
        : {
            maxOutputTokens: create(OutputTokenLimitSchema, {
              value: BigInt(limits.maxOutputTokens),
            }),
          }),
    });
  }
}
