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

/**
 * Curated Agent message contracts and descriptors.
 */
export {
  required,
  min,
  max,
  pattern,
  range,
  validate,
  choice,
} from "../../generated/spine/options_pb.js";
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
} from "../../generated/spine/ts/agent/model_pb.js";
export {
  file_spine_ts_agent_model,
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
} from "../../generated/spine/ts/agent/model_pb.js";
export type {
  GenerationRequest,
  GenerationResponse,
  DecisionChoice,
  DecisionQuestionId,
  DecisionAlternativeKey,
  DecisionQuestion,
  DecisionRequest,
  DecisionProbability,
  DecisionAnswer,
  DecisionDistribution,
  DecisionResponse,
  ToolRequest,
  ToolResponse,
} from "../../generated/spine/ts/agent/content_pb.js";
export {
  file_spine_ts_agent_content,
  GenerationRequestSchema,
  GenerationResponseSchema,
  DecisionChoiceSchema,
  DecisionQuestionIdSchema,
  DecisionAlternativeKeySchema,
  DecisionQuestionSchema,
  DecisionRequestSchema,
  DecisionProbabilitySchema,
  DecisionAnswerSchema,
  DecisionDistributionSchema,
  DecisionResponseSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  DecisionQuestionKind,
  DecisionQuestionKindSchema,
  ToolEffect,
  ToolEffectSchema,
} from "../../generated/spine/ts/agent/content_pb.js";
export type {
  ConversationRecordId,
  AgentHistoryCursor,
  ConversationRecord,
  AgentHistoryEntry,
} from "../../generated/spine/ts/agent/history_pb.js";
export {
  file_spine_ts_agent_history,
  ConversationRecordIdSchema,
  AgentHistoryCursorSchema,
  ConversationRecordSchema,
  AgentHistoryEntrySchema,
} from "../../generated/spine/ts/agent/history_pb.js";
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
} from "../../generated/spine/ts/agent/interaction_events_pb.js";
export {
  file_spine_ts_agent_interaction_events,
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
} from "../../generated/spine/ts/agent/interaction_events_pb.js";
