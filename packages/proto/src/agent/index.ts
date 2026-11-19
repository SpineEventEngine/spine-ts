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

import {
  required as generatedRequired,
  min as generatedMin,
  max as generatedMax,
  pattern as generatedPattern,
  range as generatedRange,
  validate as generatedValidate,
  choice as generatedChoice,
} from "../../generated/spine/options_pb.js";

/**
 * Requires a field value according to Spine validation rules.
 */
export const required: typeof generatedRequired = generatedRequired;

/**
 * Sets the lower numeric boundary.
 */
export const min: typeof generatedMin = generatedMin;

/**
 * Sets the upper numeric boundary.
 */
export const max: typeof generatedMax = generatedMax;

/**
 * Constrains a string field with the configured validation pattern.
 */
export const pattern: typeof generatedPattern = generatedPattern;

/**
 * Constrains a numeric field to the specified bounded range.
 */
export const range: typeof generatedRange = generatedRange;

/**
 * Enables validation of the nested message value.
 */
export const validate: typeof generatedValidate = generatedValidate;

/**
 * Configures selection rules for the annotated oneof.
 */
export const choice: typeof generatedChoice = generatedChoice;

export type {
  ModelName,
  ModelRevision,
  ModelRef,
  ModelPreference,
  ConversationId,
  AiOperationId,
  AiAttemptId,
  AiContentDigest,
  AiToolCallId,
  AiCapabilityName,
  AiCapabilityRevision,
  AiValidationRevision,
  AiMappingRevision,
  AiDiagnosticId,
  McpServerId,
  McpToolName,
  AiModelRequestLimit,
  AiToolCallLimit,
  AiDeadlineMillis,
  AiInputByteLimit,
  AiOutputByteLimit,
  AiOutputTokenLimit,
  AiTokenCount,
  AiProviderName,
  AiAccountIdentity,
  AiEndpointIdentity,
  AiProviderModelName,
  AiOperationLimits,
  AiUsage,
  AiConnectionIdentity,
} from "../../generated/spine/agent/model_pb.js";

export {
  file_spine_agent_model,
  ModelNameSchema,
  ModelRevisionSchema,
  ModelRefSchema,
  ModelPreferenceSchema,
  ConversationIdSchema,
  AiOperationIdSchema,
  AiAttemptIdSchema,
  AiContentDigestSchema,
  AiToolCallIdSchema,
  AiCapabilityNameSchema,
  AiCapabilityRevisionSchema,
  AiValidationRevisionSchema,
  AiMappingRevisionSchema,
  AiDiagnosticIdSchema,
  McpServerIdSchema,
  McpToolNameSchema,
  AiModelRequestLimitSchema,
  AiToolCallLimitSchema,
  AiDeadlineMillisSchema,
  AiInputByteLimitSchema,
  AiOutputByteLimitSchema,
  AiOutputTokenLimitSchema,
  AiTokenCountSchema,
  AiProviderNameSchema,
  AiAccountIdentitySchema,
  AiEndpointIdentitySchema,
  AiProviderModelNameSchema,
  AiOperationLimitsSchema,
  AiUsageSchema,
  AiConnectionIdentitySchema,
  AiModelKind,
  AiModelKindSchema,
  AiExecutionMode,
  AiExecutionModeSchema,
  AiOutcome,
  AiOutcomeSchema,
  AiFailureCode,
  AiFailureCodeSchema,
} from "../../generated/spine/agent/model_pb.js";

export type {
  GenerationRequest,
  GenerationResponse,
  ModelToolCall,
  AnthropicAssistantContent,
  AnthropicContentBlock,
  AnthropicThinking,
  AnthropicRedactedThinking,
  OpenAiAssistantContent,
  OpenAiOutputItem,
  OpenAiMessageItem,
  OpenAiMessagePart,
  OpenAiReasoningItem,
  OpenAiFunctionCallItem,
  DecisionChoice,
  DecisionQuestionId,
  DecisionAlternativeKey,
  DecisionQuestion,
  DecisionRequest,
  DecisionProbability,
  DecisionAnswer,
  DecisionDistribution,
  DecisionRounding,
  DecisionResponse,
  ToolRequest,
  ToolResponse,
} from "../../generated/spine/agent/content_pb.js";

export {
  file_spine_agent_content,
  GenerationRequestSchema,
  GenerationResponseSchema,
  ModelToolCallSchema,
  AnthropicAssistantContentSchema,
  AnthropicContentBlockSchema,
  AnthropicThinkingSchema,
  AnthropicRedactedThinkingSchema,
  OpenAiAssistantContentSchema,
  OpenAiOutputItemSchema,
  OpenAiMessageItemSchema,
  OpenAiMessagePartSchema,
  OpenAiReasoningItemSchema,
  OpenAiFunctionCallItemSchema,
  OpenAiMessageItem_Phase,
  OpenAiMessageItem_PhaseSchema,
  DecisionChoiceSchema,
  DecisionQuestionIdSchema,
  DecisionAlternativeKeySchema,
  DecisionQuestionSchema,
  DecisionRequestSchema,
  DecisionProbabilitySchema,
  DecisionAnswerSchema,
  DecisionDistributionSchema,
  DecisionRoundingSchema,
  DecisionResponseSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  DecisionQuestionKind,
  DecisionQuestionKindSchema,
  ToolEffect,
  ToolEffectSchema,
} from "../../generated/spine/agent/content_pb.js";

export type {
  ConversationRecordId,
  AgentHistoryCursor,
  ConversationRecord,
  ModelRequestRecord,
  ModelSubmissionAttemptRecord,
  ModelOutcomeHandledRecord,
  ModelCallAbandonedRecord,
  AgentHistoryEntry,
} from "../../generated/spine/agent/history_pb.js";

export {
  file_spine_agent_history,
  ConversationRecordIdSchema,
  AgentHistoryCursorSchema,
  ConversationRecordSchema,
  ModelRequestRecordSchema,
  ModelSubmissionAttemptRecordSchema,
  ModelOutcomeHandledRecordSchema,
  ModelCallAbandonedRecordSchema,
  AgentHistoryEntrySchema,
} from "../../generated/spine/agent/history_pb.js";

export type {
  AgentOperationRef,
  AgentAiOperationStarted,
  AgentModelAttemptStarted,
  AgentModelAttemptFinished,
  AgentAiResultAdmitted,
  AgentAiOperationFailed,
  AgentToolCallStarted,
  AgentToolCallFinished,
  AgentModelSelectionChanged,
  AgentInvocationTerminated,
} from "../../generated/spine/agent/interaction_events_pb.js";

export {
  file_spine_agent_interaction_events,
  AgentOperationRefSchema,
  AgentAiOperationStartedSchema,
  AgentModelAttemptStartedSchema,
  AgentModelAttemptFinishedSchema,
  AgentAiResultAdmittedSchema,
  AgentAiOperationFailedSchema,
  AgentToolCallStartedSchema,
  AgentToolCallFinishedSchema,
  AgentModelSelectionChangedSchema,
  AgentInvocationTerminatedSchema,
} from "../../generated/spine/agent/interaction_events_pb.js";

export type { AgentId } from "../../generated/spine/agent/agent_id_pb.js";

export {
  file_spine_agent_agent_id,
  AgentIdSchema,
} from "../../generated/spine/agent/agent_id_pb.js";

export type { ModelCall } from "../../generated/spine/agent/model_call_pb.js";

export {
  file_spine_agent_model_call,
  ModelCallSchema,
} from "../../generated/spine/agent/model_call_pb.js";

export type { CallModel } from "../../generated/spine/agent/commands_pb.js";

export {
  file_spine_agent_commands,
  CallModelSchema,
} from "../../generated/spine/agent/commands_pb.js";

export type { ModelReplied } from "../../generated/spine/agent/events_pb.js";

export {
  file_spine_agent_events,
  ModelRepliedSchema,
} from "../../generated/spine/agent/events_pb.js";

export type { ModelCallFailed } from "../../generated/spine/agent/rejections_pb.js";

export {
  file_spine_agent_rejections,
  ModelCallFailedSchema,
} from "../../generated/spine/agent/rejections_pb.js";
