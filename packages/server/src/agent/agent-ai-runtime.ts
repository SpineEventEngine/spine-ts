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

import { clone, create, toBinary, type MessageShape } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { createHash, randomUUID } from "node:crypto";
import { AgentExecutionFault } from "./agent-execution-fault.js";
import {
  AnyMessages,
  Time,
  TypeUrls,
  Validate,
  type MessageSchema,
} from "@spine-event-engine/core";
import type {
  AgentAi,
  AiConnectionIdentity,
  AiFailure,
  AiModel,
  AiRegistry,
  AiScope,
  AiResult,
  ModelRef,
} from "@spine-event-engine/ai";
import {
  admitDecision,
  backendDefinition,
  isAiModel,
  parseCandidate,
  selectDeployment,
} from "@spine-event-engine/ai/spi/runtime";
import type {
  AiAttemptCompletion,
  AiAttemptReplay,
  AiAttemptRequest,
  AiBackendDefinition,
  AiBackendExecution,
  AiBackendOutcome,
  AiExecutionControl,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiAttemptIdSchema,
  AiCapabilityNameSchema,
  AiCapabilityRevisionSchema,
  AiContentDigestSchema,
  AiDeadlineMillisSchema,
  AiDiagnosticIdSchema,
  AiFailureCode,
  AiInputByteLimitSchema as InputBytesSchema,
  AiModelKind,
  AiExecutionMode,
  AgentAiOperationStartedSchema as OperationStartedSchema,
  AgentModelAttemptStartedSchema as AttemptStartedSchema,
  AgentModelAttemptFinishedSchema as AttemptFinishedSchema,
  AgentAiResultAdmittedSchema as ResultAdmittedSchema,
  AgentAiOperationFailedSchema as OperationFailedSchema,
  AiValidationRevisionSchema,
  ModelRefSchema,
  AiModelRequestLimitSchema as RequestLimitSchema,
  AiOperationIdSchema,
  AiOperationLimitsSchema,
  AiOutputByteLimitSchema as OutputBytesSchema,
  AiOutputTokenLimitSchema as OutputTokensSchema,
  AiOutcome,
  AiToolCallLimitSchema as ToolLimitSchema,
  ConversationIdSchema,
  DecisionRequestSchema,
  DecisionAnswerSchema,
  DecisionQuestionIdSchema,
  DecisionQuestionKind,
  DecisionResponseSchema,
  GenerationRequestSchema,
  GenerationResponseSchema,
  AgentHistoryEntrySchema,
  ConversationRecordIdSchema,
  ConversationRecordSchema,
  type ConversationId,
} from "@spine-event-engine/proto/agent";
import {
  AgentAttemptEvidenceSchema,
  AgentExecutionJournalEntrySchema as JournalEntrySchema,
  AgentNamedOperationSchema,
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentSavedFailureSchema,
  AgentValidationIssueSchema,
  type AgentAttemptEvidence,
  type AgentExecutionRecord,
  type AgentNamedOperation,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { AgentExecutionSizes } from "@spine-event-engine/storage/provider";
import type { RepositoryAiOptions } from "../repository/repository.js";
import { AgentExecutionSession } from "./agent-execution-session.js";
import { AgentMcpBudget } from "./agent-mcp-budget.js";
import type { AgentMcpHost } from "./agent-mcp-host.js";
import { AgentMcpRuntime } from "./agent-mcp-runtime.js";
import { AgentModelSelection } from "./agent-model-selection.js";
import { AgentInteractionAudit } from "./agent-interaction-audit.js";

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
 * Carries one named typed input within the accepted handler.
 * @typeParam I Generated input descriptor.
 */
interface InvokeRequest<I extends MessageSchema> {
  readonly call: string;
  readonly conversation: ConversationId;
  readonly input: MessageShape<I>;
}

/**
 * Indicates a saved physical request with no recorded response after recovery.
 */
export class AgentUncertainAttemptError extends Error {
  /**
   * Creates an error that prevents replaying an unresolved physical request.
   */
  constructor() {
    super("Agent physical request outcome is uncertain; it cannot be resent.");
  }
}

/**
 * Provides one handler's named AI calls against a fenced execution journal.
 */
export class AgentAiRuntime implements AgentAi {
  readonly #names = new Set<string>();

  readonly #controller = new AbortController();

  readonly #signal: AbortSignal;

  #cursor = 0;

  #busy = false;

  #closed = false;

  /**
   * Binds named calls to the selected repository and fenced invocation.
   *
   * @param registry Configured model and MCP registrations.
   * @param repository Repository model policy.
   * @param scope Accepted actor, source, Bounded Context, and tenant.
   * @param session Fenced durable execution session.
   * @param handlerOrdinal Saved generated handler order.
   * @param audit Paired Agent history and System Event writer.
   */
  constructor(
    private readonly registry: AiRegistry,
    private readonly repository: RepositoryAiOptions,
    private readonly scope: AiScope,
    private readonly session: AgentExecutionSession,
    private readonly handlerOrdinal: number,
    private readonly audit: AgentInteractionAudit | undefined,
  ) {
    this.#signal = AbortSignal.any([session.signal, this.#controller.signal]);
  }

  /**
   * Returns one saved or newly admitted typed model result.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   * @param model Registered capability to invoke.
   * @param request Named call, conversation, and typed input.
   * @returns Saved or newly admitted result with its operation identity.
   */
  async invoke<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
  ): Promise<AiResult<MessageShape<O>>> {
    this.#requireOpen();
    if (this.#busy) throw new Error("Agent AI calls must be sequential within one handler.");
    this.#busy = true;
    try {
      if (!isAiModel(model) || !this.repository.models.includes(model))
        throw new TypeError("Agent model is not registered for this repository.");
      if (request.call.trim().length === 0 || this.#names.has(request.call))
        throw new TypeError("Agent AI call names must be nonblank and unique per handler.");
      this.#names.add(request.call);
      Validate.check(ConversationIdSchema, request.conversation);
      Validate.check(model.definition.input, request.input);
      const operation = await this.#operation(model, request);
      this.#requireOpen();
      return (
        this.#savedResult(model, operation) ?? (await this.#dispatch(model, request, operation))
      );
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Restores a terminal named result without contacting the backend.
   * @typeParam O Generated admitted-output descriptor.
   */
  #savedResult<O extends MessageSchema>(
    model: AiModel<MessageSchema, O>,
    operation: AgentNamedOperation,
  ): AiResult<MessageShape<O>> | undefined {
    const operationId = operation.operation;
    if (operationId === undefined) throw new Error("Agent named operation has no durable ID.");
    if (operation.result.case === "admittedOutput") {
      const value = AnyMessages.unpack(operation.result.value, model.definition.output);
      if (value === undefined) throw new Error("Saved Agent AI output type changed.");
      return { ok: true, value, operationId };
    }
    if (operation.result.case === "failure") {
      const saved = operation.result.value;
      const code = Object.entries(failureCodes).find(([, value]) => value === saved.code)?.[0];
      if (code === undefined || saved.diagnostic === undefined)
        throw new Error("Saved Agent AI failure category is invalid.");
      return {
        ok: false,
        operationId,
        failure: {
          code: code as AiFailure["code"],
          retryableByNewSignal: saved.retryableByNewSignal,
          diagnosticId: saved.diagnostic.value,
        },
      };
    }
    return undefined;
  }

  /**
   * Sets a preference only for a later accepted signal.
   * @param kind Generation or decision selection.
   * @param model Deployment to prefer for later accepted work.
   */
  select(kind: AiModelKind, model: ModelRef | undefined): void {
    this.#requireOpen();
    const selectedKind =
      kind === AiModelKind.GENERATION
        ? "generation"
        : kind === AiModelKind.DECISION
          ? "decision"
          : undefined;
    if (selectedKind === undefined)
      throw new TypeError("Agent model preference requires a supported kind.");
    if (model !== undefined) {
      Validate.check(ModelRefSchema, model);
      selectDeployment(this.registry, {
        kind: selectedKind,
        models: this.repository.models,
        instancePreference: model,
        ...(this.repository.allowedModels?.[selectedKind] === undefined
          ? {}
          : { allowedModels: this.repository.allowedModels[selectedKind] }),
      });
    }
    this.session.stagePreference(kind, model);
  }

  /**
   * Rejects recovery when the accepted handler no longer issues its saved calls.
   */
  finish(): void {
    this.#requireOpen();
    if (this.#busy) throw new Error("Agent handler returned with a pending AI call.");
    const saved = this.#savedOperations(this.session.record());
    if (this.#cursor !== saved.length)
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent named operation sequence changed on recovery.",
      );
  }

  /**
   * Rejects callbacks retained after the generated handler returns.
   */
  close(): void {
    this.#closed = true;
    this.#controller.abort();
  }

  #requireOpen(): void {
    if (this.#closed || this.#signal.aborted)
      throw new Error("Agent AI handler capability is closed.");
  }

  /**
   * Loads or persists the next exact handler-scoped named operation.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  async #operation<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
  ): Promise<AgentNamedOperation> {
    const saved = this.#savedOperations(this.session.record())[this.#cursor++];
    if (saved !== undefined) {
      this.#verifyOperation(saved, model, request);
      return saved;
    }
    const created = this.#newOperation(model, request);
    const change = (record: AgentExecutionRecord) => {
      record.journal.push(
        create(JournalEntrySchema, {
          ordinal: BigInt(record.journal.length),
          evidence: { case: "operation", value: created },
        }),
      );
      return record;
    };
    if (this.audit === undefined) await this.session.update(change);
    else
      await this.audit.save(
        OperationStartedSchema,
        this.#operationStarted(model, request, created),
        change,
      );
    return created;
  }

  /**
   * Describes a newly journaled named operation using its original typed input.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  #operationStarted<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
    operation: AgentNamedOperation,
  ) {
    const kind =
      model.definition.kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION;
    const mode =
      model.definition.kind === "decision"
        ? AiExecutionMode.DECISION_DIRECT
        : model.definition.outputMode === "native-schema"
          ? AiExecutionMode.GENERATION_NATIVE_SCHEMA
          : AiExecutionMode.GENERATION_PROMPT_VALIDATE;
    const digest = createHash("sha256")
      .update(toBinary(model.definition.input, request.input))
      .digest("hex");
    return create(OperationStartedSchema, {
      operation: this.audit?.reference(operation, kind),
      capability: operation.capability,
      capabilityRevision: operation.capabilityRevision,
      input: create(AiContentDigestSchema, { value: digest }),
      limits: operation.limits,
      startedAt: Time.currentTime(),
      mode,
    });
  }

  /**
   * Rejects changed call facts before any recovery side effect.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  #verifyOperation<I extends MessageSchema, O extends MessageSchema>(
    saved: AgentNamedOperation,
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
  ): void {
    if (
      saved.callName !== request.call ||
      saved.conversation?.value !== request.conversation.value ||
      saved.capability?.value !== model.definition.name ||
      saved.capabilityRevision?.value !== model.definition.version ||
      !this.#sameInput(saved, model.definition.input, request.input)
    )
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent named operation changed on recovery.",
      );
  }

  /**
   * Captures one typed call's immutable accepted facts.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  #newOperation<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
  ): AgentNamedOperation {
    return create(AgentNamedOperationSchema, {
      handlerOrdinal: this.handlerOrdinal,
      callName: request.call,
      conversation: clone(ConversationIdSchema, request.conversation),
      operation: create(AiOperationIdSchema, { value: randomUUID() }),
      limits: this.#limits(model),
      input: AnyMessages.pack(model.definition.input, request.input),
      capability: create(AiCapabilityNameSchema, { value: model.definition.name }),
      capabilityRevision: create(AiCapabilityRevisionSchema, { value: model.definition.version }),
      deadline: this.#operationDeadline(model.definition.limits.deadlineMs),
    });
  }

  /**
   * Samples Time once and caps a capability deadline at the saved invocation deadline.
   */
  #operationDeadline(durationMs: number) {
    const now = Time.currentTime();
    const nowMs = Number(now.seconds) * 1_000 + Math.floor(now.nanos / 1_000_000);
    const deadlineMs = Math.min(nowMs + durationMs, this.#invocationDeadline());
    return create(TimestampSchema, {
      seconds: BigInt(Math.floor(deadlineMs / 1_000)),
      nanos: (deadlineMs % 1_000) * 1_000_000,
    });
  }

  /**
   * Calls the selected authenticated backend after recording the named operation.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  async #dispatch<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
    operation: AgentNamedOperation,
  ): Promise<AiResult<MessageShape<O>>> {
    const { backend, execution, mcp } = await this.#execution(model, request, operation);
    try {
      this.#requireOpen();
      const outcome = await AgentModelSelection.awaitHook(
        backend.execute(execution),
        this.#signal,
        this.#deadline(operation),
      );
      this.#requireOpen();
      if (outcome.ok) Validate.check(model.definition.output, outcome.value as MessageShape<O>);
      await this.#saveOutcome(model, operation, outcome);
      return outcome.ok
        ? {
            ok: true,
            value: outcome.value as MessageShape<O>,
            operationId: this.#operationId(operation),
          }
        : { ok: false, failure: outcome.failure, operationId: this.#operationId(operation) };
    } finally {
      await this.#closeMcp(mcp, operation);
    }
  }

  /**
   * Selects the saved deployment under current registry policy.
   */
  #selectedBackend(model: Model) {
    const selected = this.session
      .record()
      .started?.models.find(
        (item) =>
          item.kind ===
          (model.definition.kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION),
      );
    if (selected?.model === undefined || selected.connection === undefined)
      throw new Error("Agent AI kind has no saved authenticated deployment.");
    const registration = selectDeployment(this.registry, {
      kind: model.definition.kind,
      models: this.repository.models,
      instancePreference: selected.model,
      ...(this.repository.allowedModels?.[model.definition.kind] === undefined
        ? {}
        : { allowedModels: this.repository.allowedModels[model.definition.kind] }),
    });
    const backend = backendDefinition(registration);
    return { backend, connection: selected.connection };
  }

  /**
   * Reauthorizes and binds the saved operation to the adapter execution.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  async #execution<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
    operation: AgentNamedOperation,
  ): Promise<{
    backend: AiBackendDefinition;
    execution: AiBackendExecution;
    mcp: AgentMcpRuntime | undefined;
  }> {
    const { backend, connection } = this.#selectedBackend(model);
    const identity = await this.#connectIdentity(backend, connection, operation);
    const tools = model.definition.kind === "generation" ? (model.definition.tools ?? []) : [];
    const mcp = tools.length
      ? new AgentMcpRuntime(this.#mcpHost(backend, operation, model), tools)
      : undefined;
    try {
      const execution = await this.#connectExecution(
        backend,
        model,
        request,
        operation,
        identity,
        mcp,
      );
      return { backend, execution, mcp };
    } catch (error) {
      await this.#closeMcp(mcp, operation);
      throw error;
    }
  }

  /**
   * Records safe cleanup failure without replacing a saved result or setup error.
   */
  async #closeMcp(mcp: AgentMcpRuntime | undefined, operation: AgentNamedOperation): Promise<void> {
    if (mcp === undefined) return;
    try {
      await mcp.close();
    } catch {
      try {
        await this.#recordFailure(operation, "TOOL_FAILED", false);
      } catch {
        // The original result or setup error remains authoritative after cleanup failure.
      }
    }
  }

  /**
   * Prepares the exact catalog and reconnects the saved model identity.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  async #connectExecution<I extends MessageSchema, O extends MessageSchema>(
    backend: AiBackendDefinition,
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
    operation: AgentNamedOperation,
    identity: AiConnectionIdentity,
    mcp: AgentMcpRuntime | undefined,
  ): Promise<AiBackendExecution> {
    const advertisedTools = await mcp?.prepare();
    const control = this.#control(operation, model, mcp);
    const connected = await AgentModelSelection.awaitHook(
      backend.connect(this.scope, identity, control),
      this.#signal,
      control.deadlineEpochMs,
    );
    if (!this.#sameIdentity(connected.identity, identity))
      throw new AgentExecutionFault(
        "REVISION_CHANGED",
        "Agent backend connection identity changed.",
      );
    return this.#adapterExecution(
      model,
      request,
      operation,
      identity,
      connected.model,
      control,
      advertisedTools,
    );
  }

  /**
   * Materializes the checked adapter invocation after connection and catalog setup.
   * @typeParam I Generated input descriptor.
   * @typeParam O Generated admitted-output descriptor.
   */
  #adapterExecution<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: InvokeRequest<I>,
    operation: AgentNamedOperation,
    identity: AiConnectionIdentity,
    connectedModel: unknown,
    control: AiExecutionControl,
    advertisedTools: AiBackendExecution["advertisedTools"],
  ): AiBackendExecution {
    return {
      call: request.call,
      operationId: this.#operationId(operation),
      scope: this.scope,
      identity,
      model: connectedModel,
      // Adapter SPI erases the factory-validated descriptor pair at this boundary.
      definition: (model as Model).definition,
      input: request.input,
      control,
      ...(advertisedTools === undefined ? {} : { advertisedTools }),
    };
  }

  /**
   * Binds the MCP module to this invocation's single fenced budget authority.
   */
  #mcpHost(
    backend: AiBackendDefinition,
    operation: AgentNamedOperation,
    model: Model,
  ): AgentMcpHost {
    const deadlineEpochMs = this.#deadline(operation);
    const budget = new AgentMcpBudget(this.session, operation, deadlineEpochMs, this.audit);
    return {
      scope: this.scope,
      registry: this.registry,
      backend,
      operation,
      session: this.session,
      signal: this.#signal,
      deadlineEpochMs,
      reserveMessage: (server, message) => budget.reserveMessage(server, message),
      onReceived: (id, bytes) => {
        budget.onReceived(id, bytes);
      },
      finishMessage: (id, bytes) => budget.finishMessage(id, bytes),
      journalToolIntent: (invocation, facts) =>
        budget.journalToolIntent(invocation, facts, model.definition.limits.toolCalls),
      markToolDispatched: (id) => budget.markToolDispatched(id),
      finishTool: (id, response, history) => budget.finishTool(id, response, [history]),
      recordFailure: (code, retryable) => this.#recordFailure(operation, code, retryable),
    };
  }

  /**
   * Retains the admitted result before the domain handler can observe it.
   */
  async #saveOutcome(
    model: Model,
    operation: AgentNamedOperation,
    outcome: AiBackendOutcome,
  ): Promise<void> {
    const change = this.#outcomeChange(model, operation, outcome);
    if (this.audit === undefined) await this.session.update(change);
    else if (outcome.ok)
      await this.audit.save(
        ResultAdmittedSchema,
        this.#admittedEvent(model, operation, outcome),
        change,
      );
    else
      await this.audit.save(
        OperationFailedSchema,
        this.#failedEvent(model, operation, outcome),
        change,
      );
  }

  /**
   * Applies the final typed result to its named operation.
   */
  #outcomeChange(model: Model, operation: AgentNamedOperation, outcome: AiBackendOutcome) {
    return (record: AgentExecutionRecord) => {
      const saved = this.#findOperation(record, operation);
      saved.result = outcome.ok
        ? {
            case: "admittedOutput",
            value: AnyMessages.pack(model.definition.output, outcome.value),
          }
        : {
            case: "failure",
            value: create(AgentSavedFailureSchema, {
              code: failureCodes[outcome.failure.code],
              retryableByNewSignal: outcome.failure.retryableByNewSignal,
              diagnostic: create(AiDiagnosticIdSchema, { value: outcome.failure.diagnosticId }),
            }),
          };
      const response = record.journal.findLast(
        (entry) =>
          entry.evidence.case === "attempt" &&
          entry.evidence.value.operation?.value === operation.operation?.value,
      );
      saved.outcome =
        response?.evidence.case === "attempt" ? response.evidence.value.outcome : AiOutcome.FAILED;
      return record;
    };
  }

  /**
   * Describes one locally admitted output without exposing its content.
   */
  #admittedEvent(
    model: Model,
    operation: AgentNamedOperation,
    outcome: Extract<AiBackendOutcome, { ok: true }>,
  ) {
    return create(ResultAdmittedSchema, {
      operation: this.audit?.reference(operation, this.#modelKind(model)),
      result: create(AiContentDigestSchema, {
        value: createHash("sha256")
          .update(toBinary(model.definition.output, outcome.value))
          .digest("hex"),
      }),
      validationRevision: create(AiValidationRevisionSchema, {
        value: model.definition.validation?.version ?? model.definition.version,
      }),
      admittedAt: Time.currentTime(),
    });
  }

  /**
   * Describes one terminal logical failure with its original safe diagnostic.
   */
  #failedEvent(
    model: Model,
    operation: AgentNamedOperation,
    outcome: Extract<AiBackendOutcome, { ok: false }>,
  ) {
    const last = this.#lastAttempt(operation);
    return create(OperationFailedSchema, {
      operation: this.audit?.reference(operation, this.#modelKind(model)),
      outcome:
        last?.outcome === AiOutcome.TOOL_REQUESTED
          ? AiOutcome.FAILED
          : (last?.outcome ?? AiOutcome.FAILED),
      diagnosticId: create(AiDiagnosticIdSchema, { value: outcome.failure.diagnosticId }),
      ...(last?.attempt === undefined ? {} : { attempt: last.attempt }),
      failedAt: Time.currentTime(),
      failure: failureCodes[outcome.failure.code],
    });
  }

  /**
   * Finds the last saved physical attempt of one named operation.
   */
  #lastAttempt(operation: AgentNamedOperation): AgentAttemptEvidence | undefined {
    const entry = this.session
      .record()
      .journal.findLast(
        (item) =>
          item.evidence.case === "attempt" &&
          item.evidence.value.operation?.value === operation.operation?.value,
      );
    return entry?.evidence.case === "attempt" ? entry.evidence.value : undefined;
  }

  /**
   * Converts the factory-defined API kind to its persisted System-event enum.
   */
  #modelKind(model: Model): AiModelKind {
    return model.definition.kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION;
  }

  /**
   * Requires the durable identity of a named operation.
   */
  #operationId(operation: AgentNamedOperation) {
    if (operation.operation === undefined) throw new Error("Agent named operation has no ID.");
    return operation.operation;
  }

  /**
   * Restores nonsecret connection identity and rejects drift before use.
   */
  async #connectIdentity(
    backend: AiBackendDefinition,
    saved: NonNullable<AgentExecutionRecord["started"]>["models"][number]["connection"],
    operation: AgentNamedOperation,
  ) {
    if (saved === undefined) throw new Error("Saved Agent connection identity is absent.");
    const deadlineEpochMs = this.#deadline(operation);
    const control = { signal: this.#signal, deadlineEpochMs };
    const identity = await AgentModelSelection.awaitHook(
      backend.resolveIdentity(this.scope, control),
      this.#signal,
      deadlineEpochMs,
    );
    const authorized = await AgentModelSelection.awaitHook(
      backend.authorizeUse(this.scope, identity, control),
      this.#signal,
      deadlineEpochMs,
    );
    if (
      !authorized ||
      !this.#sameIdentity(identity, {
        provider: saved.provider?.value ?? "",
        account: saved.account?.value ?? "",
        endpoint: saved.endpoint?.value ?? "",
        model: saved.model?.value ?? "",
      })
    )
      throw new AgentExecutionFault(
        "REVISION_CHANGED",
        "Agent model identity or authorization changed.",
      );
    return identity;
  }

  /**
   * Compares all credential-free fields of a selected connection.
   */
  #sameIdentity(
    left: { provider: string; account: string; endpoint: string; model: string },
    right: { provider: string; account: string; endpoint: string; model: string },
  ): boolean {
    return (
      left.provider === right.provider &&
      left.account === right.account &&
      left.endpoint === right.endpoint &&
      left.model === right.model
    );
  }

  /**
   * Reads the saved invocation deadline without extending it on restart.
   */
  #invocationDeadline(): number {
    const deadline = this.session.record().started?.deadline;
    if (deadline === undefined) throw new Error("Agent AI deadline was not saved.");
    return Number(deadline.seconds) * 1_000 + Math.floor(deadline.nanos / 1_000_000);
  }

  /**
   * Reads the persisted per-capability absolute deadline.
   */
  #deadline(operation: AgentNamedOperation): number {
    const deadline = operation.deadline;
    if (deadline === undefined) throw new Error("Agent capability deadline was not saved.");
    return Math.min(
      this.#invocationDeadline(),
      Number(deadline.seconds) * 1_000 + Math.floor(deadline.nanos / 1_000_000),
    );
  }

  /**
   * Enumerates this handler's named calls in original order.
   */
  #savedOperations(record: AgentExecutionRecord): AgentNamedOperation[] {
    return record.journal.flatMap((entry) =>
      entry.evidence.case === "operation" &&
      entry.evidence.value.handlerOrdinal === this.handlerOrdinal
        ? [entry.evidence.value]
        : [],
    );
  }

  /**
   * Compares exact canonical typed application input.
   * @typeParam I Generated input descriptor.
   */
  #sameInput<I extends MessageSchema>(
    saved: AgentNamedOperation,
    schema: I,
    input: MessageShape<I>,
  ): boolean {
    const packed = saved.input;
    if (packed === undefined) return false;
    const current = AnyMessages.pack(schema, input);
    return (
      packed.typeUrl === current.typeUrl &&
      Buffer.compare(Buffer.from(packed.value), Buffer.from(current.value)) === 0
    );
  }

  /**
   * Materializes per-capability immutable operation limits.
   */
  #limits(model: Model) {
    const limits = model.definition.limits;
    return create(AiOperationLimitsSchema, {
      modelRequests: create(RequestLimitSchema, { value: limits.modelRequests }),
      toolCalls: create(ToolLimitSchema, { value: limits.toolCalls }),
      deadlineMs: create(AiDeadlineMillisSchema, { value: BigInt(limits.deadlineMs) }),
      maxInputBytes: create(InputBytesSchema, { value: BigInt(limits.maxInputBytes) }),
      maxOutputBytes: create(OutputBytesSchema, { value: BigInt(limits.maxOutputBytes) }),
      ...(limits.maxOutputTokens === undefined
        ? {}
        : {
            maxOutputTokens: create(OutputTokensSchema, {
              value: BigInt(limits.maxOutputTokens),
            }),
          }),
    });
  }

  /**
   * Supplies fenced physical-attempt controls for the selected backend.
   */
  #control(
    operation: AgentNamedOperation,
    model: Model,
    mcp?: AgentMcpRuntime,
  ): AiExecutionControl {
    const deadlineEpochMs = this.#deadline(operation);
    const received = new Map<string, number>();
    let attemptNumber = 0;
    return {
      signal: this.#signal,
      deadlineEpochMs,
      nowEpochMs: () => Time.currentTimeMillis(),
      hasAuthority: () => !this.#signal.aborted && Time.currentTimeMillis() < deadlineEpochMs,
      beginAttempt: (request) => this.#beginAttempt(operation, model, request, ++attemptNumber),
      reserveTransport: (id, bytes, credit) => this.#reserve(id, bytes, credit, model),
      onReceived: (id, bytes) => {
        this.#providerBytes(received, id, bytes);
      },
      finishAttempt: (completion) => this.#finishAttempt(operation, completion, received),
      recordFailure: (code, retryableByNewSignal) =>
        this.#recordFailure(operation, code, retryableByNewSignal),
      admitGeneration: (candidate, definition, input) =>
        parseCandidate(
          definition.output,
          candidate,
          (value) => definition.validation?.check(value, input) ?? [],
        ),
      admitDecision: (result, definition, input, rounding) =>
        admitDecision(model, result, input, rounding ?? {}),
      callTool: (invocation) => this.#callTool(mcp, invocation),
    };
  }

  /**
   * Delegates only configured proposals to the selected MCP runtime.
   */
  #callTool(
    mcp: AgentMcpRuntime | undefined,
    invocation: Parameters<AiExecutionControl["callTool"]>[0],
  ) {
    if (mcp === undefined)
      return Promise.reject(new Error("Agent capability has no configured MCP tools."));
    return mcp.call(invocation);
  }

  /**
   * Counts decoded provider bytes before returning control to its transport.
   */
  #providerBytes(received: Map<string, number>, id: string, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error("Agent provider receipt byte count is invalid.");
    received.set(id, (received.get(id) ?? 0) + bytes);
  }

  /**
   * Persists a safe diagnostic before exposing its identity to the adapter.
   */
  async #recordFailure(
    operation: AgentNamedOperation,
    code: AiFailure["code"],
    retryableByNewSignal: boolean,
  ): Promise<AiFailure> {
    const failure: AiFailure = { code, retryableByNewSignal, diagnosticId: randomUUID() };
    await this.session.update((record) => {
      const saved = this.#findOperation(record, operation);
      saved.diagnostics.push(
        create(AgentSavedFailureSchema, {
          code: failureCodes[code],
          retryableByNewSignal,
          diagnostic: create(AiDiagnosticIdSchema, { value: failure.diagnosticId }),
        }),
      );
      const limit = Number(record.started?.bounds?.maxRecoveryBytes ?? 0n);
      if (AgentExecutionSizes.record(record) > limit)
        throw new Error("Agent diagnostic exceeds the invocation recovery byte bound.");
      return record;
    });
    return failure;
  }

  /**
   * Restores only the exact diagnostic referenced by a saved response.
   */
  #savedDiagnostic(operation: AgentNamedOperation, id: string): AiFailure {
    const saved = this.#findOperation(this.session.record(), operation).diagnostics.find(
      (item) => item.diagnostic?.value === id,
    );
    const code = Object.entries(failureCodes).find(([, value]) => value === saved?.code)?.[0];
    if (saved === undefined || code === undefined)
      throw new Error("Saved Agent model response references an unknown diagnostic.");
    return {
      code: code as AiFailure["code"],
      diagnosticId: id,
      retryableByNewSignal: saved.retryableByNewSignal,
    };
  }

  /**
   * Finds the current journal image of a previously admitted operation.
   */
  #findOperation(
    record: AgentExecutionRecord,
    operation: AgentNamedOperation,
  ): AgentNamedOperation {
    const entry = record.journal.find(
      (item) =>
        item.evidence.case === "operation" &&
        item.evidence.value.operation?.value === operation.operation?.value,
    );
    if (entry?.evidence.case !== "operation")
      throw new Error("Agent named operation journal disappeared.");
    return entry.evidence.value;
  }

  /**
   * Persists one physical request before an adapter receives a new ticket.
   */
  async #beginAttempt(
    operation: AgentNamedOperation,
    model: Model,
    request: AiAttemptRequest,
    number: number,
  ) {
    const prior = this.#priorAttempt(operation, number);
    if (prior !== undefined) return this.#replayAttempt(operation, request, prior);
    if (this.#signal.aborted || Time.currentTimeMillis() >= this.#deadline(operation))
      throw new Error("Agent model attempt deadline expired.");
    if (
      number > model.definition.limits.modelRequests ||
      this.#attemptCount() >= Number(this.session.record().started?.bounds?.modelRequests ?? 0n)
    )
      throw new AgentExecutionFault(
        "MODEL_BUDGET_EXCEEDED",
        "Agent physical model request budget is exhausted.",
      );
    const id = randomUUID();
    const requestContent =
      request.kind === "generation"
        ? AnyMessages.pack(GenerationRequestSchema, request.content)
        : AnyMessages.pack(DecisionRequestSchema, request.content);
    const history = this.#conversationHistory(operation, id, requestContent);
    await this.#saveAttempt(operation, request, number, id, history);
    return {
      id,
      maxInputBytes: model.definition.limits.maxInputBytes,
      maxOutputBytes: model.definition.limits.maxOutputBytes,
      deadlineEpochMs: this.#deadline(operation),
      signal: this.#signal,
    };
  }

  /**
   * Finds the exact physical ordinal already saved for recovery.
   */
  #priorAttempt(operation: AgentNamedOperation, number: number): AgentAttemptEvidence | undefined {
    const entry = this.session
      .record()
      .journal.find(
        (item) =>
          item.evidence.case === "attempt" &&
          item.evidence.value.operation?.value === operation.operation?.value &&
          item.evidence.value.physicalAttempt === BigInt(number),
      );
    return entry?.evidence.case === "attempt" ? entry.evidence.value : undefined;
  }

  /**
   * Restores saved content and its exact diagnostic without a new ticket.
   */
  #replayAttempt(
    operation: AgentNamedOperation,
    request: AiAttemptRequest,
    prior: AgentAttemptEvidence,
  ): AiAttemptReplay {
    if (!this.#sameRequest(prior, request))
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Saved Agent provider request changed on recovery.",
      );
    if (prior.response.case !== "generationResponse" && prior.response.case !== "decisionResponse")
      throw new AgentUncertainAttemptError();
    const diagnosticId = prior.response.value.diagnosticId?.value;
    const failure =
      diagnosticId === undefined ? undefined : this.#savedDiagnostic(operation, diagnosticId);
    return {
      kind: "replay",
      id: prior.attempt?.value ?? "",
      response: prior.response.value,
      issues: prior.validationIssues.map((issue) => ({
        code: issue.code,
        path: issue.path,
        message: issue.message,
      })),
      ...(failure === undefined ? {} : { failure }),
    };
  }

  /**
   * Saves an original request with its conversation row in one provider mutation.
   */
  async #saveAttempt(
    operation: AgentNamedOperation,
    request: AiAttemptRequest,
    number: number,
    id: string,
    history: MessageShape<typeof AgentHistoryEntrySchema>,
  ): Promise<void> {
    const change = this.#attemptChange(operation, request, number, id);
    if (this.audit === undefined) await this.session.update(change, [history]);
    else
      await this.audit.save(
        AttemptStartedSchema,
        this.#attemptStarted(operation, request, id),
        change,
        [history],
      );
  }

  /**
   * Appends a physical request without consuming a second ticket.
   */
  #attemptChange(
    operation: AgentNamedOperation,
    request: AiAttemptRequest,
    number: number,
    id: string,
  ) {
    return (record: AgentExecutionRecord) => {
      record.journal.push(
        create(JournalEntrySchema, {
          ordinal: BigInt(record.journal.length),
          evidence: {
            case: "attempt",
            value: create(AgentAttemptEvidenceSchema, {
              operation: operation.operation,
              attempt: create(AiAttemptIdSchema, { value: id }),
              physicalAttempt: BigInt(number),
              preparedRequest:
                request.kind === "generation"
                  ? { case: "generationRequest", value: request.content }
                  : { case: "decisionRequest", value: request.content },
            }),
          },
        }),
      );
      return record;
    };
  }

  /**
   * Describes the prepared physical request using its saved digest.
   */
  #attemptStarted(operation: AgentNamedOperation, request: AiAttemptRequest, id: string) {
    return create(AttemptStartedSchema, {
      operation: this.audit?.reference(
        operation,
        request.kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION,
      ),
      attempt: create(AiAttemptIdSchema, { value: id }),
      startedAt: Time.currentTime(),
      request: request.content.digest,
      ...(request.kind === "generation" && request.content.corrects !== undefined
        ? { previousAttempt: request.content.corrects }
        : {}),
    });
  }

  /**
   * Reserves transport bytes and provider persistence capacity before dispatch.
   */
  async #reserve(id: string, bytes: number, credit: number, model: Model): Promise<void> {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > model.definition.limits.maxInputBytes ||
      !Number.isSafeInteger(credit) ||
      credit < 1 ||
      credit > model.definition.limits.maxOutputBytes
    )
      throw new Error("Agent provider request exceeds its operation byte bounds.");
    const record = this.session.record();
    AgentMcpBudget.checkSharedBytes(record, bytes, credit);
    this.#findAttempt(record, id).inputBytes = BigInt(bytes);
    this.#checkCapacity(record, credit, model);
    await this.session.update((current) => {
      const evidence = this.#findAttempt(current, id);
      if (evidence.reservedResponseBytes !== 0n)
        throw new Error("Agent transport ticket was already reserved.");
      evidence.inputBytes = BigInt(bytes);
      evidence.reservedResponseBytes = BigInt(credit);
      return current;
    });
  }

  /**
   * Persists a complete response before an adapter can return it to the handler.
   */
  async #finishAttempt(
    operation: AgentNamedOperation,
    completion: AiAttemptCompletion,
    received: ReadonlyMap<string, number>,
  ): Promise<void> {
    const response = completion.response;
    const content =
      response.$typeName === GenerationResponseSchema.typeName
        ? AnyMessages.pack(GenerationResponseSchema, response)
        : AnyMessages.pack(DecisionResponseSchema, response);
    const responseDigest =
      response.$typeName === GenerationResponseSchema.typeName ? response.digest : undefined;
    const history = this.#conversationHistory(operation, completion.ticketId, content);
    const change = (record: AgentExecutionRecord) => {
      this.#storeCompletion(
        this.#findAttempt(record, completion.ticketId),
        completion,
        received.get(completion.ticketId),
      );
      return record;
    };
    if (this.audit === undefined) await this.session.update(change, [history]);
    else
      await this.audit.save(
        AttemptFinishedSchema,
        this.#attemptFinished(operation, completion, responseDigest),
        change,
        [history],
      );
  }

  /**
   * Describes the persisted response and its original physical ticket.
   */
  #attemptFinished(
    operation: AgentNamedOperation,
    completion: AiAttemptCompletion,
    responseDigest: MessageShape<typeof AiContentDigestSchema> | undefined,
  ) {
    const response = completion.response;
    return create(AttemptFinishedSchema, {
      operation: this.audit?.reference(
        operation,
        response.$typeName === GenerationResponseSchema.typeName
          ? AiModelKind.GENERATION
          : AiModelKind.DECISION,
      ),
      attempt: create(AiAttemptIdSchema, { value: completion.ticketId }),
      outcome: response.outcome,
      ...(responseDigest === undefined ? {} : { response: responseDigest }),
      ...(response.usage === undefined ? {} : { usage: response.usage }),
      ...(response.diagnosticId === undefined ? {} : { diagnosticId: response.diagnosticId }),
      finishedAt: Time.currentTime(),
    });
  }

  /**
   * Applies one bounded observed completion to its reserved attempt.
   */
  #storeCompletion(
    evidence: AgentAttemptEvidence,
    completion: AiAttemptCompletion,
    observedBytes: number | undefined,
  ): void {
    if (evidence.reservedResponseBytes === 0n || evidence.response.case !== undefined)
      throw new Error("Agent model attempt has no live reservation.");
    if (
      observedBytes !== undefined &&
      completion.receivedBytes !== undefined &&
      observedBytes !== completion.receivedBytes
    )
      throw new Error("Agent model receipt byte counts disagree.");
    const bytes = completion.receivedBytes;
    if (bytes !== undefined) {
      if (bytes > Number(evidence.reservedResponseBytes))
        throw new Error("Agent model response exceeded reserved bytes.");
      evidence.receivedBytes = BigInt(bytes);
    }
    const response = completion.response;
    evidence.response =
      response.$typeName === GenerationResponseSchema.typeName
        ? { case: "generationResponse", value: response }
        : { case: "decisionResponse", value: response };
    evidence.outcome = response.outcome;
    evidence.validationIssues = (completion.issues ?? []).map((issue) =>
      create(AgentValidationIssueSchema, {
        code: issue.code,
        path: issue.path,
        message: issue.message,
      }),
    );
  }

  /**
   * Links one exact typed exchange to the named operation and physical attempt.
   */
  #conversationHistory(
    operation: AgentNamedOperation,
    attemptId: string,
    content: MessageShape<typeof AnySchema>,
  ) {
    const occurredAt = Time.currentTime();
    return create(AgentHistoryEntrySchema, {
      occurredAt,
      item: {
        case: "conversationRecord",
        value: create(ConversationRecordSchema, {
          id: create(ConversationRecordIdSchema, { value: randomUUID() }),
          conversation: operation.conversation,
          operation: operation.operation,
          attempt: create(AiAttemptIdSchema, { value: attemptId }),
          occurredAt,
          content,
        }),
      },
    });
  }

  /**
   * Finds one journaled attempt under its original ticket.
   */
  #findAttempt(record: AgentExecutionRecord, id: string) {
    const entry = record.journal.find(
      (item) => item.evidence.case === "attempt" && item.evidence.value.attempt?.value === id,
    );
    if (entry?.evidence.case !== "attempt") throw new Error("Agent model ticket is unknown.");
    return entry.evidence.value;
  }

  /**
   * Counts physical attempts across all handlers in this invocation.
   */
  #attemptCount(): number {
    return this.session.record().journal.filter((entry) => entry.evidence.case === "attempt")
      .length;
  }

  /**
   * Checks complete provider wrappers with a maximally credited response.
   */
  #checkCapacity(record: AgentExecutionRecord, credit: number, model: Model): void {
    const recoveryLimit = Number(record.started?.bounds?.maxRecoveryBytes ?? 0n);
    if (!Number.isSafeInteger(recoveryLimit) || recoveryLimit < 1 || credit > recoveryLimit)
      throw new Error("Agent model credit exceeds invocation recovery bytes.");
    const projected = this.#projectedRecord(record, 1, model);
    const creditBytes = BigInt(credit);
    // The generation envelope can add one ordered Anthropic content copy.
    const orderedContent = model.definition.kind === "generation" ? creditBytes + 64n : 0n;
    // Three response copies: raw/decoded content, typed attempt output, named result.
    // One more credit covers bounded usage, issues, model identity, and proposal metadata.
    const recordBytes =
      BigInt(AgentExecutionSizes.record(projected)) +
      3n * (creditBytes - 1n) +
      creditBytes +
      orderedContent +
      240n;
    const headBytes = this.#projectedHead(record);
    const history = this.#historyBytes(record, 1, model);
    // The response row retains raw/decoded content and typed output, plus metadata credit.
    const responseBytes =
      BigInt(history.response) + 2n * (creditBytes - 1n) + creditBytes + orderedContent + 120n;
    const auditBytes = this.#capacityAuditBytes(record, model);
    this.#checkProjectedBounds(recoveryLimit, recordBytes, headBytes, [
      BigInt(history.request),
      responseBytes,
      ...auditBytes,
    ]);
  }

  /**
   * Applies invocation and provider byte limits to projected persistent rows.
   */
  #checkProjectedBounds(
    recoveryLimit: number,
    recordBytes: bigint,
    headBytes: number,
    historyBytes: readonly bigint[],
  ): void {
    const capacity = this.session.capacity();
    if (recordBytes > BigInt(recoveryLimit))
      throw new Error("Agent model evidence exceeds invocation recovery bytes.");
    if (
      capacity.executionRecordBytes !== undefined &&
      recordBytes > BigInt(capacity.executionRecordBytes)
    )
      throw new Error("Agent execution record cannot retain the bounded model response.");
    if (capacity.executionHeadBytes !== undefined && headBytes > capacity.executionHeadBytes)
      throw new Error("Agent execution head exceeds its provider payload bound.");
    if (
      capacity.historyRecordBytes !== undefined &&
      historyBytes.some((bytes) => bytes > BigInt(capacity.historyRecordBytes ?? 0))
    )
      throw new Error("Agent conversation history cannot retain the bounded model response.");
    if (
      capacity.transactionPayloadBytes !== undefined &&
      recordBytes + BigInt(headBytes) + historyBytes.reduce((sum, bytes) => sum + bytes, 0n) >
        BigInt(capacity.transactionPayloadBytes)
    )
      throw new Error("Agent model evidence exceeds provider transaction payload capacity.");
  }

  /**
   * Measures both original outcome audit rows with the accepted scope and actor.
   */
  #capacityAuditBytes(record: AgentExecutionRecord, model: Model): readonly bigint[] {
    if (this.audit === undefined) return [];
    const operation = record.journal.findLast((entry) => entry.evidence.case === "operation");
    const attempt = record.journal.findLast((entry) => entry.evidence.case === "attempt");
    if (operation?.evidence.case !== "operation" || attempt?.evidence.case !== "attempt")
      throw new Error("Agent audit capacity requires saved operation and attempt.");
    const ref = this.audit.reference(operation.evidence.value, this.#modelKind(model));
    const digest = create(AiContentDigestSchema, { value: "a".repeat(64) });
    const finish = create(AttemptFinishedSchema, {
      operation: ref,
      attempt: attempt.evidence.value.attempt,
      outcome: AiOutcome.ADMITTED,
      response: digest,
      finishedAt: Time.currentTime(),
    });
    const admitted = create(ResultAdmittedSchema, {
      operation: ref,
      result: digest,
      validationRevision: create(AiValidationRevisionSchema, {
        value: model.definition.validation?.version ?? model.definition.version,
      }),
      admittedAt: Time.currentTime(),
    });
    return [
      BigInt(this.audit.historyBytes(AttemptFinishedSchema, finish)),
      BigInt(this.audit.historyBytes(ResultAdmittedSchema, admitted)),
    ];
  }

  /**
   * Measures the full record with raw, response-Any and admitted-output copies.
   */
  #projectedRecord(
    record: AgentExecutionRecord,
    credit: number,
    model: Model,
  ): AgentExecutionRecord {
    const projected = clone(AgentExecutionRecordSchema, record);
    const attempt = projected.journal.findLast((entry) => entry.evidence.case === "attempt");
    const operation = projected.journal.findLast((entry) => entry.evidence.case === "operation");
    if (attempt?.evidence.case !== "attempt" || operation?.evidence.case !== "operation")
      throw new Error("Agent capacity check requires a saved attempt and operation.");
    const admitted = create(AnySchema, {
      typeUrl: TypeUrls.derive(model.definition.output),
      value: new Uint8Array(credit),
    });
    attempt.evidence.value.response =
      model.definition.kind === "generation"
        ? { case: "generationResponse", value: this.#creditedGeneration(credit, admitted) }
        : { case: "decisionResponse", value: this.#creditedDecision(credit, admitted) };
    operation.evidence.value.result = { case: "admittedOutput", value: admitted };
    return projected;
  }

  /**
   * Sizes assistant text and typed output as separate credited copies.
   */
  #creditedGeneration(credit: number, admitted: MessageShape<typeof AnySchema>) {
    return create(GenerationResponseSchema, {
      rawOutput: "x".repeat(credit),
      outcome: AiOutcome.ADMITTED,
      admittedOutput: admitted,
      digest: create(AiContentDigestSchema, { value: "a".repeat(64) }),
    });
  }

  /**
   * Sizes decoded decision answers and typed output as distinct copies.
   */
  #creditedDecision(credit: number, admitted: MessageShape<typeof AnySchema>) {
    return create(DecisionResponseSchema, {
      outcome: AiOutcome.ADMITTED,
      admittedOutput: admitted,
      answers: [
        create(DecisionAnswerSchema, {
          id: create(DecisionQuestionIdSchema, { value: "x".repeat(credit) }),
          kind: DecisionQuestionKind.BOOLEAN,
          value: { case: "booleanProbability", value: 0.5 },
        }),
      ],
    });
  }

  /**
   * Measures a conservative complete claim head including pending Inbox order.
   */
  #projectedHead(record: AgentExecutionRecord): number {
    const accepted = record.accepted;
    if (accepted?.key?.scope === undefined)
      throw new Error("Agent capacity check requires the accepted instance scope.");
    return AgentExecutionSizes.head(
      create(AgentExecutionHeadSchema, {
        scope: accepted.key.scope,
        active: accepted.key,
        pending: accepted.key,
        pendingOrder: accepted.order,
        lastResolved: accepted.order,
        claimToken: record.claimToken,
        claimExpiresAt: record.claimExpiresAt,
        preferences: [...this.session.preferences()],
        eligibleAt: Time.currentTime(),
      }),
    );
  }

  /**
   * Measures both complete typed conversation rows staged around transport.
   */
  #historyBytes(
    record: AgentExecutionRecord,
    credit: number,
    model: Model,
  ): { request: number; response: number } {
    const scope = record.accepted?.key?.scope;
    const operation = record.journal.findLast((entry) => entry.evidence.case === "operation");
    const attempt = record.journal.findLast((entry) => entry.evidence.case === "attempt");
    if (
      scope === undefined ||
      operation?.evidence.case !== "operation" ||
      attempt?.evidence.case !== "attempt"
    )
      throw new Error("Agent conversation capacity requires saved operation and attempt.");
    const named = operation.evidence.value;
    const physical = attempt.evidence.value;
    const id = physical.attempt?.value;
    if (id === undefined) throw new Error("Agent capacity check requires an attempt ID.");
    return {
      request: AgentExecutionSizes.history(
        scope,
        this.#conversationHistory(named, id, this.#preparedContent(physical)),
      ),
      response: AgentExecutionSizes.history(
        scope,
        this.#conversationHistory(named, id, this.#creditedContent(model, credit)),
      ),
    };
  }

  /**
   * Restores the exact packed prepared request for history sizing.
   */
  #preparedContent(attempt: AgentAttemptEvidence) {
    const prepared = attempt.preparedRequest;
    if (prepared.case !== "generationRequest" && prepared.case !== "decisionRequest")
      throw new Error("Agent prepared request is absent from the attempt journal.");
    const schema =
      prepared.case === "generationRequest" ? GenerationRequestSchema : DecisionRequestSchema;
    return create(AnySchema, {
      typeUrl: TypeUrls.derive(schema),
      value:
        prepared.case === "generationRequest"
          ? toBinary(GenerationRequestSchema, prepared.value)
          : toBinary(DecisionRequestSchema, prepared.value),
    });
  }

  /**
   * Models the full credited response Any without dispatching externally.
   */
  #creditedContent(model: Model, credit: number) {
    const admitted = create(AnySchema, {
      typeUrl: TypeUrls.derive(model.definition.output),
      value: new Uint8Array(credit),
    });
    return model.definition.kind === "generation"
      ? AnyMessages.pack(GenerationResponseSchema, this.#creditedGeneration(credit, admitted))
      : AnyMessages.pack(DecisionResponseSchema, this.#creditedDecision(credit, admitted));
  }

  /**
   * Compares exact prepared request content before a saved response is reused.
   */
  #sameRequest(saved: AgentAttemptEvidence, request: AiAttemptRequest): boolean {
    if (request.kind === "generation" && saved.preparedRequest.case === "generationRequest")
      return (
        Buffer.compare(
          Buffer.from(toBinary(GenerationRequestSchema, request.content)),
          Buffer.from(toBinary(GenerationRequestSchema, saved.preparedRequest.value)),
        ) === 0
      );
    if (request.kind === "decision" && saved.preparedRequest.case === "decisionRequest")
      return (
        Buffer.compare(
          Buffer.from(toBinary(DecisionRequestSchema, request.content)),
          Buffer.from(toBinary(DecisionRequestSchema, saved.preparedRequest.value)),
        ) === 0
      );
    return false;
  }
}
