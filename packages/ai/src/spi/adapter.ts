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
 * Factory for registrations created by an optional provider adapter.
 */
export { backendDefinition, createBackendRegistration } from "../internal/registration.js";
export { deriveOutputSchema } from "../internal/schema.js";
export type { AiBackendDefinition, AiBackendRegistration } from "../internal/registration.js";
export type {
  AiAttemptRequest,
  AiAttemptResponse,
  AiAttemptTicket,
  AiAttemptReplay,
  AiAttemptCompletion,
  AiCandidateAdmission,
  AiToolInvocation,
  AiExecutionControl,
  AiBackendExecution,
  AiBackendOutcome,
} from "../internal/execution.js";
export { assertAiOutcomeContext } from "../internal/execution.js";
export { AiMcpSetupFailure } from "../internal/mcp-protocol.js";
export type {
  AiMcpProtocolFactory,
  AiMcpProtocolSession,
  AiMcpProtocolControl,
  AiMcpMessageRequest,
  AiMcpMessageTicket,
  AiMcpResolvedConnection,
  AiMcpConnectionIdentity,
  AiMcpToolDefinition,
  AiMcpAdvertisedTool,
  AiMcpToolResult,
  AiMcpResultContent,
} from "../internal/mcp-protocol.js";
