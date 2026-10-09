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
  AiModelKind,
  AiOperationId,
  AgentHistoryCursor,
  ConversationId,
  ModelRef,
} from "@spine-event-engine/proto/agent";
import type { ActorContext, MessageId, TenantId } from "@spine-event-engine/proto";
import type { AiModel } from "./model.js";

/**
 * Bounds one capability, including all corrections and tool continuations.
 */
export interface AiLimits {
  /**
   * Maximum physical provider requests.
   */
  readonly modelRequests: number;

  /**
   * Maximum external tool calls.
   */
  readonly toolCalls: number;

  /**
   * Maximum elapsed milliseconds.
   */
  readonly deadlineMs: number;

  /**
   * Maximum bytes in one materialized request.
   */
  readonly maxInputBytes: number;

  /**
   * Maximum received response bytes.
   */
  readonly maxOutputBytes: number;

  /**
   * Optional generation-only ceiling when the selected deployment can enforce it.
   */
  readonly maxOutputTokens?: number;
}

/**
 * Bounds all matching handlers for one accepted signal.
 */
export interface AiInvocationLimits {
  /**
   * Maximum model operations for one accepted signal.
   */
  readonly operations: number;

  /**
   * Maximum physical provider requests across one accepted signal.
   */
  readonly modelRequests: number;

  /**
   * Maximum external tool calls across one accepted signal.
   */
  readonly toolCalls: number;

  /**
   * Maximum recorded history reads for one accepted signal.
   */
  readonly recordedReads: number;

  /**
   * Maximum elapsed time in milliseconds.
   */
  readonly deadlineMs: number;

  /**
   * Maximum cumulative input bytes for one accepted signal.
   */
  readonly totalInputBytes: number;

  /**
   * Maximum cumulative output bytes for one accepted signal.
   */
  readonly totalOutputBytes: number;

  /**
   * Maximum bytes retained for replay after interruption.
   */
  readonly maxRecoveryBytes: number;
}

/**
 * A concrete local defect that may inform a bounded generation correction.
 */
export interface AiValidationIssue {
  /**
   * Safe failure or validation category.
   */
  readonly code: string;

  /**
   * Field path affected by this issue.
   */
  readonly path: string;

  /**
   * Safe validation message for application handling.
   */
  readonly message: string;
}

/**
 * Reference to one expressly permitted MCP tool.
 */
export interface AiToolRef {
  /**
   * MCP server identifier selected by the application.
   */
  readonly server: string;

  /**
   * Exact permitted MCP tool name.
   */
  readonly tool: string;
}

/**
 * Shared typed capability definition.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 */
export interface AiModelBase<I extends MessageSchema, O extends MessageSchema> {
  /**
   * Application capability or deployment name.
   */
  readonly name: string;

  /**
   * Version of this application capability definition.
   */
  readonly version: string;

  /**
   * Generated Protobuf descriptor for typed input.
   */
  readonly input: I;

  /**
   * Generated Protobuf descriptor for typed output.
   */
  readonly output: O;

  /**
   * Fixed bounds for this capability.
   */
  readonly limits: AiLimits;

  /**
   * Versioned pure application validation rule.
   */
  readonly validation?: {
    /**
     * Version of the application output validation rule.
     */
    readonly version: string;

    /**
     * Applies a pure application rule to candidate output and invocation facts.
     *
     * @param value Candidate output after Proto validation.
     * @param input Application facts supplied to the invocation.
     * @returns Domain validation issues, or an empty list when valid.
     */
    check(value: MessageShape<O>, input: MessageShape<I>): readonly AiValidationIssue[];
  };
}

/**
 * Question evaluated by a non-generative backend.
 */
export type AiQuestion =
  | {
      /**
       * Boolean proposition kind.
       */
      readonly type: "boolean";

      /**
       * Proposition the backend evaluates.
       */
      readonly instructions: string;
    }
  | {
      /**
       * Choice question kind.
       */
      readonly type: "choice";

      /**
       * Application instructions supplied to the model.
       */
      readonly instructions: string;

      /**
       * Named alternatives available to this choice.
       */
      readonly criteria: Readonly<Record<string, string>>;
    }
  | {
      /**
       * Score question kind.
       */
      readonly type: "score";

      /**
       * Application instructions supplied to the model.
       */
      readonly instructions: string;

      /**
       * Ordered score levels, starting at zero.
       */
      readonly criteria: readonly string[];
    };

/**
 * Provider answer after kind and range validation; absence means unknown.
 */
export type AiAnswer =
  | {
      /**
       * Boolean answer kind.
       */
      readonly type: "boolean";

      /**
       * Probability that the proposition is true.
       */
      readonly probability: number;
    }
  | {
      /**
       * Choice answer kind.
       */
      readonly type: "choice";

      /**
       * Selected declared alternative key.
       */
      readonly choice: string;

      /**
       * Full distribution over declared alternatives when reported.
       */
      readonly probabilities?: Readonly<Record<string, number>>;

      /**
       * Separate provider confidence when reported.
       */
      readonly confidence?: number;
    }
  | {
      /**
       * Score answer kind.
       */
      readonly type: "score";

      /**
       * Fractional score within the declared rubric.
       */
      readonly score: number;

      /**
       * Full distribution over declared alternatives when reported.
       */
      readonly probabilities?: Readonly<Record<string, number>>;

      /**
       * Separate provider confidence when reported.
       */
      readonly confidence?: number;
    };

/**
 * Exactly the answers keyed by declared question IDs.
 */
export interface AiDecisionResult {
  /**
   * Answers keyed by the original question IDs.
   */
  readonly answers: Readonly<Record<string, AiAnswer>>;
}

/**
 * One application-defined generation or decision capability.
 *
 * @typeParam I - Input message descriptor.
 * @typeParam O - Output message descriptor.
 */
export type AiModelDefinition<I extends MessageSchema, O extends MessageSchema> = AiModelBase<
  I,
  O
> &
  (
    | {
        /**
         * Generative capability kind.
         */
        readonly kind: "generation";

        /**
         * Application instructions supplied to the model.
         */
        readonly instructions: string;

        /**
         * Structured generation mode fixed before dispatch.
         */
        readonly outputMode: "native-schema" | "prompt-and-validate";

        /**
         * Explicitly permitted tool references or policies.
         */
        readonly tools?: readonly AiToolRef[];
      }
    | {
        /**
         * Non-generative decision capability kind.
         */
        readonly kind: "decision";

        /**
         * Questions keyed by application-defined IDs.
         */
        readonly questions: Readonly<Record<string, AiQuestion>>;

        /**
         * Whether every non-boolean answer must include a full distribution.
         */
        readonly requireProbabilities?: boolean;

        /**
         * Whether the backend must evaluate questions independently.
         */
        readonly requireIndependentQuestions?: boolean;

        /**
         * Versioned pure decision-to-Protobuf mapping.
         */
        readonly mapping: {
          /**
           * Version of the decision-to-output mapping rule.
           */
          readonly version: string;

          /**
           * Maps validated decision answers to typed application output.
           *
           * @param result Validated provider answers.
           * @param input Application facts supplied to this invocation.
           * @returns Typed application output.
           */
          readonly toMessage: (result: AiDecisionResult, input: MessageShape<I>) => MessageShape<O>;
        };
      }
  );

/**
 * Safe operational failure that an Agent may turn into a domain outcome.
 */
export interface AiFailure {
  /**
   * Safe failure or validation category.
   */
  readonly code:
    | "INVALID_INPUT"
    | "UNSUPPORTED_CAPABILITY"
    | "AUTHENTICATION_REQUIRED"
    | "RATE_LIMITED"
    | "UNAVAILABLE"
    | "REFUSED"
    | "INVALID_OUTPUT"
    | "BUDGET_EXCEEDED"
    | "TOOL_FAILED"
    | "TOOL_OUTCOME_UNKNOWN"
    | "CANCELLED"
    | "DEADLINE_EXCEEDED";

  /**
   * Whether a later accepted signal may retry this failure.
   */
  readonly retryableByNewSignal: boolean;

  /**
   * Safe diagnostic reference without provider secrets.
   */
  readonly diagnosticId: string;
}

/**
 * Validated output or recorded operational failure.
 *
 * @typeParam T - Validated application output.
 */
export type AiResult<T> =
  | {
      /**
       * Indicates a validated result was admitted.
       */
      readonly ok: true;

      /**
       * Validated typed application output.
       */
      readonly value: T;

      /**
       * Logical operation covering all physical attempts.
       */
      readonly operationId: AiOperationId;
    }
  | {
      /**
       * Indicates no result was admitted.
       */
      readonly ok: false;

      /**
       * Safe operational failure category and diagnostic reference.
       */
      readonly failure: AiFailure;

      /**
       * Logical operation covering all physical attempts.
       */
      readonly operationId: AiOperationId;
    };

/**
 * Model operations available only inside an Agent signal handler.
 */
export interface AgentAi {
  /**
   * Invokes a typed capability for a named Agent call.
   *
   * @typeParam I - Input message descriptor.
   * @typeParam O - Output message descriptor.
   * @param model Capability registered for this repository.
   * @param request Named call, explicit conversation and typed facts.
   * @returns Validated output or bounded operational failure.
   */
  invoke<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: {
      /**
       * Invocation name used to identify this call.
       */
      readonly call: string;

      /**
       * Conversation in which this invocation occurs.
       */
      readonly conversation: ConversationId;

      /**
       * Validated application input facts for this invocation.
       */
      readonly input: MessageShape<I>;
    },
  ): Promise<AiResult<MessageShape<O>>>;

  /**
   * Sets a deployment preference for later signals.
   * @param kind Generation or decision kind.
   * @param model Explicit deployment or inheritance when absent.
   */
  select(kind: AiModelKind, model: ModelRef | undefined): void;
}

/**
 * Cancellation and deadline supplied to each asynchronous callback.
 */
export interface AiControl {
  /**
   * Cancellation signal for this callback.
   */
  readonly signal: AbortSignal;

  /**
   * Absolute deadline in Unix milliseconds.
   */
  readonly deadlineEpochMs: number;
}

/**
 * Trusted selection and authorization scope from an accepted signal.
 */
export interface AiScope {
  /**
   * Authenticated actor from the accepted signal.
   */
  readonly actor: ActorContext;

  /**
   * Tenant scope established for the accepted signal.
   */
  readonly tenant:
    { readonly kind: "tenant"; readonly id: TenantId } | { readonly kind: "single-tenant" };

  /**
   * Canonical Agent instance identity.
   */
  readonly agent: MessageId;

  /**
   * Canonical source signal identity.
   */
  readonly source: MessageId;
}

/**
 * Non-secret identity of an authenticated model connection.
 */
export interface AiConnectionIdentity {
  /**
   * Authenticated provider or local service name.
   */
  readonly provider: string;

  /**
   * Verified provider account or local execution identity.
   */
  readonly account: string;

  /**
   * Credential-free canonical endpoint identity.
   */
  readonly endpoint: string;

  /**
   * Concrete provider model identity or selected deployment.
   */
  readonly model: string;
}

/**
 * Optional per-kind deployment defaults.
 */
export interface AiDefaultModels {
  /**
   * Application generation default, when configured.
   */
  readonly generation?: ModelRef;

  /**
   * Application decision default, when configured.
   */
  readonly decision?: ModelRef;
}

/**
 * Application-wide registry limits and defaults.
 */
export interface AiRegistryOptions {
  /**
   * Application-wide model preferences by capability kind.
   */
  readonly defaultModels: AiDefaultModels;

  /**
   * Bounds shared by all handlers for one accepted signal.
   */
  readonly invocationLimits: AiInvocationLimits;

  /**
   * Maximum concurrent Agent signal executions sharing this registry object.
   * A slot covers the handlers and completion, including saved-output delivery.
   * This limit applies within one process.
   */
  readonly concurrentOperations: number;

  /**
   * Maximum additional Agent executions waiting in memory for a slot.
   * Further accepted signals remain in durable storage until capacity is available.
   */
  readonly queuedOperations: number;

  /**
   * Maximum duration allowed for an application callback.
   */
  readonly hookTimeoutMs?: number;
}

/**
 * Selects one newest-first page from the current Agent's history.
 */
export interface HistoryRead {
  /**
   * Positive safe number of requested items.
   */
  readonly pageSize: number;

  /**
   * Opaque continuation from the preceding page.
   */
  readonly cursor?: AgentHistoryCursor;
}

/**
 * Selects one conversation within the current Agent.
 */
export interface ConversationHistoryRead extends HistoryRead {
  /**
   * Explicitly identified conversation.
   */
  readonly conversation: ConversationId;
}

/**
 * Newest-first page with an optional continuation toward older items.
 *
 * @typeParam T - History item type.
 */
export interface HistoryPage<T> {
  /**
   * Entries returned by this read.
   */
  readonly items: readonly T[];

  /**
   * Opaque continuation when older entries remain.
   */
  readonly nextCursor?: AgentHistoryCursor;
}

/**
 * JSON values admitted for MCP arguments.
 */
export type AiJson =
  null | boolean | number | string | readonly AiJson[] | { readonly [name: string]: AiJson };

/**
 * Validated tool call presented to application authorization.
 */
export interface AiToolCall {
  /**
   * Exact permitted MCP tool name.
   */
  readonly tool: AiToolRef;

  /**
   * Validated JSON arguments supplied to the tool.
   */
  readonly arguments: Readonly<Record<string, AiJson>>;
}

/**
 * Application policy for one permitted tool.
 */
export interface McpToolPolicy {
  /**
   * Application-established read or write effect.
   */
  readonly effect: "read" | "write";

  /**
   * Maximum time allowed for one tool call.
   */
  readonly timeoutMs: number;

  /**
   * Maximum encoded tool argument bytes.
   */
  readonly maxArgumentBytes: number;

  /**
   * Maximum received tool result bytes.
   */
  readonly maxResultBytes: number;

  /**
   * Checks application permission for one tool call.
   *
   * @param scope Authenticated tenant and actor context.
   * @param call Validated MCP tool name and arguments.
   * @param control Cancellation and deadline controls.
   * @returns Whether the application permits this tool call.
   */
  readonly authorize: (
    scope: AiScope,
    call: AiToolCall,
    control: AiControl,
  ) => boolean | Promise<boolean>;
}

/**
 * Application-selected remote or local MCP transport.
 */
export type McpTransport =
  | {
      /**
       * Streamable HTTP transport kind.
       */
      readonly kind: "streamable-http";

      /**
       * Absolute streamable HTTP endpoint without credentials.
       */
      readonly url: string;

      /**
       * Returns scoped HTTP headers for one MCP connection.
       *
       * @param scope Authenticated tenant and actor context.
       * @param control Cancellation and deadline controls.
       * @returns Headers for this scoped connection.
       */
      readonly headers?: (
        scope: AiScope,
        control: AiControl,
      ) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
    }
  | {
      /**
       * Local stdio transport kind.
       */
      readonly kind: "stdio";

      /**
       * Absolute path to the local MCP executable.
       */
      readonly executable: string;

      /**
       * Fixed executable arguments.
       */
      readonly args: readonly string[];

      /**
       * Optional absolute working directory.
       */
      readonly cwd?: string;

      /**
       * Returns scoped environment variables for one local process.
       *
       * @param scope Authenticated tenant and actor context.
       * @param control Cancellation and deadline controls.
       * @returns Environment variables for this scoped process.
       */
      readonly environment?: (
        scope: AiScope,
        control: AiControl,
      ) => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>;
    };

/**
 * Explicit MCP connection and tool policy.
 */
export interface McpServerDefinition {
  /**
   * Validated MCP server identifier.
   */
  readonly id: string;

  /**
   * Configuration revision pinned to this registration.
   */
  readonly revision: string;

  /**
   * Validated HTTP or local process connection settings.
   */
  readonly transport: McpTransport;

  /**
   * Checks application permission to connect to the MCP server.
   *
   * @param scope Authenticated tenant and actor context.
   * @param control Cancellation and deadline controls.
   * @returns Whether this scope may connect to the MCP server.
   */
  readonly authorizeConnect: (scope: AiScope, control: AiControl) => boolean | Promise<boolean>;

  /**
   * Explicitly permitted tool references or policies.
   */
  readonly tools: Readonly<Record<string, McpToolPolicy>>;
}
