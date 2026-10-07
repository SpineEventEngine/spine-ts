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

import type { MessageSchema } from "@spine-event-engine/core";
import type { ModelRef as ProtoModelRef } from "@spine-event-engine/proto/agent";
import { AiModel as AiModelFactory, ModelRef as ModelRefFactory } from "./internal/model.js";
import type { AiModel as InternalAiModel } from "./internal/model.js";

/**
 * SDK-free typed capability created only by {@link AiModel.define}.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 */
export type AiModel<I extends MessageSchema, O extends MessageSchema> = InternalAiModel<I, O>;

/**
 * Creates validated typed capabilities.
 */
export const AiModel: typeof AiModelFactory = AiModelFactory;

/**
 * Credential-free Protobuf deployment reference.
 */
export type ModelRef = ProtoModelRef;

/**
 * Constructs canonical deployment references.
 */
export const ModelRef: typeof ModelRefFactory = ModelRefFactory;
export { AiRegistry } from "./internal/registry.js";
export { Mcp } from "./internal/mcp.js";
export type { AiBackendRegistration } from "./internal/registration.js";
export type { McpServerRegistration } from "./internal/mcp.js";
export type {
  AgentAi,
  AiAnswer,
  AiConnectionIdentity,
  AiControl,
  AiDecisionResult,
  AiDefaultModels,
  AiFailure,
  AiInvocationLimits,
  AiJson,
  AiLimits,
  AiModelBase,
  AiModelDefinition,
  AiQuestion,
  AiRegistryOptions,
  AiResult,
  AiScope,
  AiToolCall,
  AiToolRef,
  AiValidationIssue,
  ConversationHistoryRead,
  HistoryPage,
  HistoryRead,
  McpServerDefinition,
  McpToolPolicy,
  McpTransport,
} from "./internal/contracts.js";
export type {
  ModelName,
  ModelRevision,
  ModelPreference,
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
  DecisionQuestionId,
  DecisionAlternativeKey,
  ConversationRecordId,
  AgentHistoryCursor,
  AgentHistoryEntry,
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
  AiAttemptId,
  AiContentDigest,
  AiOperationId,
  AiToolCallId,
  ConversationId,
  ConversationRecord,
  GenerationRequest,
  GenerationResponse,
  ModelToolCall,
  DecisionRequest,
  DecisionResponse,
  ToolRequest,
  ToolResponse,
  DecisionQuestion,
  DecisionAnswer,
  DecisionDistribution,
  DecisionRounding,
  DecisionChoice,
  DecisionProbability,
} from "@spine-event-engine/proto/agent";
export {
  ModelNameSchema,
  ModelRevisionSchema,
  ModelPreferenceSchema,
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
  DecisionQuestionIdSchema,
  DecisionAlternativeKeySchema,
  ConversationRecordIdSchema,
  AgentHistoryCursorSchema,
  AgentHistoryEntrySchema,
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
  AiAttemptIdSchema,
  AiContentDigestSchema,
  AiModelKind,
  AiOperationIdSchema,
  AiToolCallIdSchema,
  ConversationIdSchema,
  ConversationRecordSchema,
  ModelRefSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
  ModelToolCallSchema,
  DecisionRequestSchema,
  DecisionResponseSchema,
  ToolRequestSchema,
  ToolResponseSchema,
  DecisionQuestionSchema,
  DecisionAnswerSchema,
  DecisionDistributionSchema,
  DecisionRoundingSchema,
  DecisionChoiceSchema,
  DecisionProbabilitySchema,
  DecisionQuestionKind,
  ToolEffect,
  AiOutcome,
  AiFailureCode,
  AiExecutionMode,
} from "@spine-event-engine/proto/agent";
