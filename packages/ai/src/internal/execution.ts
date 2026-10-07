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

import type { MessageShape } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import type {
  AgentAiOperationFailed,
  AgentToolCallFinished,
  AiOperationId,
  AiUsage,
  DecisionRequest,
  DecisionResponse,
  GenerationRequest,
  GenerationResponse,
  ToolResponse,
} from "@spine-event-engine/proto/agent";
import { AiOutcome } from "@spine-event-engine/proto/agent";
import type {
  AiConnectionIdentity,
  AiControl,
  AiDecisionResult,
  AiFailure,
  AiModelDefinition,
  AiScope,
  AiValidationIssue,
} from "./contracts.js";
import type { AiMcpAdvertisedTool } from "./mcp-protocol.js";

/**
 * * One model-facing request already recorded against the signal budget.
 */
export type AiAttemptRequest =
  | {
      /**
       * * Identifies a generation request.
       */
      readonly kind: "generation";

      /**
       * * Actual model-facing generation content.
       */
      readonly content: GenerationRequest;
    }
  | {
      /**
       * * Identifies a non-generative decision request.
       */
      readonly kind: "decision";

      /**
       * * Actual model-facing decision content.
       */
      readonly content: DecisionRequest;
    };

/**
 * * One model-facing response journaled before result admission.
 */
export type AiAttemptResponse = GenerationResponse | DecisionResponse;

/**
 * Rejects a nonterminal tool proposal in incompatible conversation/event contexts.
 * @param content Typed response or terminal System event.
 */
export const assertAiOutcomeContext = (
  content:
    | GenerationResponse
    | DecisionResponse
    | ToolResponse
    | AgentToolCallFinished
    | AgentAiOperationFailed,
): void => {
  if (content.$typeName !== "spine.ts.agent.GenerationResponse") {
    if (content.outcome === AiOutcome.TOOL_REQUESTED)
      throw new TypeError("TOOL_REQUESTED is only a generation response outcome");
    return;
  }
  const hasCalls = content.toolCalls.length > 0;
  const hasOutput = content.admittedOutput !== undefined;
  if (content.outcome === AiOutcome.TOOL_REQUESTED && (!hasCalls || hasOutput))
    throw new TypeError("TOOL_REQUESTED requires proposals without admitted output");
  if (content.outcome === AiOutcome.ADMITTED && (!hasOutput || hasCalls))
    throw new TypeError("ADMITTED requires output without outstanding proposals");
  if (content.outcome !== AiOutcome.ADMITTED && hasOutput)
    throw new TypeError("Only ADMITTED may carry application output");
};

/**
 * * One persisted physical request identity and its reserved resource bounds.
 */
export interface AiAttemptTicket {
  /**
   * * Runtime-assigned attempt ID; one ticket admits at most one transport fetch.
   */
  readonly id: string;

  /**
   * * Actual serialized provider request-body ceiling.
   */
  readonly maxInputBytes: number;

  /**
   * * Full reserved decoded response-body allowance.
   */
  readonly maxOutputBytes: number;

  /**
   * * Absolute deadline read through the runtime Time service.
   */
  readonly deadlineEpochMs: number;

  /**
   * * Cancellation and execution-fence loss signal.
   */
  readonly signal: AbortSignal;
}

/**
 * Completed physical attempt returned from a durable journal without redispatch.
 */
export interface AiAttemptReplay {
  /**
   * Distinguishes saved content from a new physical-attempt ticket.
   */
  readonly kind: "replay";

  /**
   * Original attempt identity retained for tool-call correlation.
   */
  readonly id: string;

  /**
   * Previously journaled bounded provider response.
   */
  readonly response: AiAttemptResponse;

  /**
   * Previously journaled local validation issues, when any.
   */
  readonly issues?: readonly AiValidationIssue[];

  /**
   * Original persisted failure and retryability matching the response diagnostic.
   */
  readonly failure?: AiFailure;
}

/**
 * * Fenced completion record for one physical model attempt.
 */
export interface AiAttemptCompletion {
  /**
   * * Previously allocated physical attempt identity.
   */
  readonly ticketId: string;

  /**
   * * Complete measured response bytes; absent for an incomplete or unknown receipt.
   */
  readonly receivedBytes?: number;

  /**
   * * Complete bounded provider and validation response content.
   */
  readonly response: AiAttemptResponse;

  /**
   * * Actual bounded local validation issues, when applicable.
   */
  readonly issues?: readonly AiValidationIssue[];

  /**
   * * Provider token counts; absent means unknown rather than zero.
   */
  readonly usage?: AiUsage;
}

/**
 * * Runtime admission of a generated ProtoJSON candidate.
 */
export type AiCandidateAdmission =
  | {
      /**
       * * Indicates the output passed definitive local validation.
       */
      readonly ok: true;

      /**
       * * Validated application output.
       */
      readonly value: MessageShape<MessageSchema>;
    }
  | {
      /**
       * * Indicates local output validation failed.
       */
      readonly ok: false;

      /**
       * * Actual bounded issues available for correction.
       */
      readonly issues: readonly AiValidationIssue[];
    };

/**
 * * Runtime-authorized tool call without a model-selected effect.
 */
export interface AiToolInvocation {
  /**
   * * Physical attempt whose recorded response proposed this call.
   */
  readonly ticketId: string;

  /**
   * * Configured MCP server name.
   */
  readonly server: string;

  /**
   * * Configured tool name within that server.
   */
  readonly tool: string;

  /**
   * * Canonical JSON arguments validated against tool policy.
   */
  readonly argumentsJson: string;

  /**
   * * Provider call ID used only to correlate the model continuation.
   */
  readonly providerCallId: string;
}

/**
 * * Runtime controls shared by optional model adapters and scripted backends.
 */
export interface AiExecutionControl extends AiControl {
  /**
   * Reads Unix milliseconds through the runtime Time service.
   * @returns Current Unix epoch milliseconds.
   */
  readonly nowEpochMs: () => number;

  /**
   * Checks whether the current execution fence still permits work.
   * @returns Whether the current execution fence remains valid.
   */
  readonly hasAuthority: () => boolean;

  /**
   * Records the actual request and reserves one physical attempt.
   * @param request Typed generation or decision content, including correction text.
   * @returns Runtime-assigned ticket after the journal and budget barrier.
   */
  readonly beginAttempt: (request: AiAttemptRequest) => Promise<AiAttemptTicket | AiAttemptReplay>;

  /**
   * Records transport bytes against the existing attempt ticket.
   * @param ticketId Runtime-assigned attempt ID.
   * @param inputBytes Actual serialized provider request-body bytes.
   * @param outputCredit Full output allowance held through crash uncertainty.
   * @returns Completion of the durable reservation barrier.
   */
  readonly reserveTransport: (
    ticketId: string,
    inputBytes: number,
    outputCredit: number,
  ) => Promise<void>;

  /**
   * Records a received platform chunk before parser delivery.
   * @param ticketId Runtime-assigned attempt ID.
   * @param bytes Actual received byte count for this chunk.
   */
  readonly onReceived: (ticketId: string, bytes: number) => void;

  /**
   * Records bounded response content and known receipt before output returns.
   * @param completion Fenced response, usage, receipt, and local validation issues.
   * @returns Completion of the durable journal barrier.
   */
  readonly finishAttempt: (completion: AiAttemptCompletion) => Promise<void>;

  /**
   * Persists a bounded safe diagnostic without finishing the attempt or operation.
   * @param code Allowlisted failure category.
   * @param retryableByNewSignal Whether a later accepted signal may retry.
   * @returns Runtime-allocated checked failure and diagnostic reference.
   */
  readonly recordFailure: (
    code: AiFailure["code"],
    retryableByNewSignal: boolean,
  ) => Promise<AiFailure>;

  /**
   * Applies definitive Proto and application validation to a generation candidate.
   * @param candidate Exact bounded provider text candidate.
   * @param definition Registered typed generation capability.
   * @param input Validated application facts for this invocation.
   * @returns Admitted output or actual issues for a bounded Ax correction.
   */
  readonly admitGeneration: (
    candidate: string,
    definition: Readonly<AiModelDefinition<MessageSchema, MessageSchema>>,
    input: MessageShape<MessageSchema>,
  ) => AiCandidateAdmission | Promise<AiCandidateAdmission>;

  /**
   * Applies definitive answer, mapping, Proto, and application validation.
   * @param result Provider's non-generative answers and rounding.
   * @param definition Registered typed decision capability.
   * @param input Validated application facts for this invocation.
   * @param rounding Provider-declared decimal precision, if known.
   * @returns Admitted mapped output or local issues; no chat correction.
   */
  readonly admitDecision: (
    result: AiDecisionResult,
    definition: Readonly<AiModelDefinition<MessageSchema, MessageSchema>>,
    input: MessageShape<MessageSchema>,
    rounding?: { readonly probabilityDecimals?: number; readonly scoreDecimals?: number },
  ) => AiCandidateAdmission | Promise<AiCandidateAdmission>;

  /**
   * Executes one authorized tool call using runtime policy and identity.
   * @param invocation Model request without an authoritative effect or tool-call ID.
   * @returns Recorded bounded result or unresolved write outcome.
   */
  readonly callTool: (invocation: AiToolInvocation) => Promise<ToolResponse>;
}

/**
 * * One selected, authenticated request to an adapter-created backend.
 */
export interface AiBackendExecution {
  /**
   * Exact discovered and allowlisted definitions prepared before model dispatch.
   */
  readonly advertisedTools?: readonly AiMcpAdvertisedTool[];

  /**
   * * Invocation name supplied by the application handler.
   */
  readonly call: string;

  /**
   * * Runtime-assigned logical operation spanning physical attempts.
   */
  readonly operationId: AiOperationId;

  /**
   * * Trusted authenticated signal scope.
   */
  readonly scope: AiScope;

  /**
   * * Identity established before connection and matched after it.
   */
  readonly identity: AiConnectionIdentity;

  /**
   * * Opaque model handle returned by the trusted connection callback.
   */
  readonly model: unknown;

  /**
   * * Registered typed capability and limits.
   */
  readonly definition: Readonly<AiModelDefinition<MessageSchema, MessageSchema>>;

  /**
   * * Validated application facts.
   */
  readonly input: MessageShape<MessageSchema>;

  /**
   * * Fenced runtime budgets, journal, admission, and tool authority.
   */
  readonly control: AiExecutionControl;
}

/**
 * * Backend result without a fabricated runtime operation identity.
 */
export type AiBackendOutcome =
  | {
      /**
       * * Indicates a typed application output was admitted.
       */
      readonly ok: true;

      /**
       * * Definitively validated output.
       */
      readonly value: MessageShape<MessageSchema>;
    }
  | {
      /**
       * * Indicates no application output was admitted.
       */
      readonly ok: false;

      /**
       * * Safe recorded operational failure.
       */
      readonly failure: AiFailure;
    };
