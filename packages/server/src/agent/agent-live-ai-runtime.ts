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

import { create, type MessageShape } from "@bufbuild/protobuf";
import { randomUUID } from "node:crypto";
import { Validate, Time, type MessageSchema } from "@spine-event-engine/core";
import type {
  AgentAi,
  AiFailure,
  AiModel,
  AiRegistry,
  AiResult,
  AiScope,
  ModelRef,
} from "@spine-event-engine/ai";
import {
  admitDecision,
  backendDefinition,
  isAiModel,
  parseCandidate,
  selectDeployment,
} from "@spine-event-engine/ai/spi/runtime";
import {
  AiMcpSetupFailure,
  type AiAttemptCompletion,
  type AiAttemptRequest,
  type AiBackendDefinition,
  type AiExecutionControl,
  type AiMcpAdvertisedTool,
} from "@spine-event-engine/ai/spi/adapter";
import {
  AiModelKind,
  AiOutcome,
  AiOperationIdSchema,
  ConversationIdSchema,
  GenerationResponseSchema,
  ModelRefSchema,
  type AiConnectionIdentity,
} from "@spine-event-engine/proto/agent";
import type { RepositoryAiOptions } from "../repository/repository.js";
import { AgentModelSelection } from "./agent-model-selection.js";
import { AgentLiveAiAudit } from "./agent-live-ai-audit.js";
import type { AgentLiveAudit } from "./agent-live-audit.js";
import { AgentLiveBudget, type AgentPhysicalTicket } from "./agent-live-budget.js";
import type { AgentLiveModel } from "./agent-live-inputs.js";
import type { AgentOperationIdentity } from "./agent-live-inputs.js";
import { AgentLiveMcpControls } from "./agent-live-mcp-controls.js";
import { AgentLiveMcpRuntime } from "./agent-live-mcp-runtime.js";

interface LiveAttempt {
  readonly id: string;
  reservation?: AgentPhysicalTicket;
  response?: AiAttemptCompletion["response"];
  completed: boolean;
}
type Model = AiModel<MessageSchema, MessageSchema>;

/**
 * Executes named AI calls for one live handler without a recovery journal.
 */
export class AgentLiveAiRuntime implements AgentAi {
  readonly #names = new Set<string>();

  readonly #controller = new AbortController();

  readonly #signal: AbortSignal;

  #busy = false;

  #closed = false;

  /**
   * Binds selected models and one invocation-wide local budget.
   *
   * @param audit Retained history audit for this invocation.
   * @param budget Invocation-wide resource budget.
   * @param checkSession Callback that validates the current execution session.
   * @param deadlineEpochMs Absolute invocation deadline, when configured.
   * @param onSelect Callback that stages a model selection.
   * @param registry Registered AI models or MCP servers.
   * @param repository Repository configured for this Entity.
   * @param scope Captured invocation or tenant scope.
   * @param selected Models or selection retained for this invocation.
   * @param signal Signal or cancellation signal for this operation.
   */
  constructor(
    private readonly registry: AiRegistry,
    private readonly repository: RepositoryAiOptions,
    private readonly scope: AiScope,
    private readonly selected: ReadonlyMap<AiModelKind, AgentLiveModel>,
    private readonly budget: AgentLiveBudget,
    signal: AbortSignal,
    private readonly deadlineEpochMs: number | undefined,
    private readonly onSelect: (kind: AiModelKind, model: ModelRef | undefined) => void,
    private readonly audit: AgentLiveAudit<unknown> | undefined,
    private readonly checkSession: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.#signal = AbortSignal.any([signal, this.#controller.signal]);
  }

  /**
   * Executes one validated registered capability and returns its fresh result.
   *
   * @typeParam I Generated input schema of the invoked capability.
   * @typeParam O Generated output schema of the invoked capability.
   * @param model Selected AI model for this invocation.
   * @param request Typed request for the current operation.
   * @returns The typed model result with its operation identifier.
   */
  async invoke<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: {
      readonly call: string;
      readonly conversation: MessageShape<typeof ConversationIdSchema>;
      readonly input: MessageShape<I>;
    },
  ): Promise<AiResult<MessageShape<O>>> {
    this.requireOpen();
    if (this.#busy) throw new Error("Agent AI calls must be sequential within one handler.");
    this.#busy = true;
    try {
      this.validateRequest(model, request);
      this.budget.reserveOperation();
      await this.checkSession();
      const operationId = create(AiOperationIdSchema, { value: randomUUID() });
      const outcome = await this.execute(model, request, operationId);
      this.requireOpen();
      return outcome.ok
        ? { ok: true, value: outcome.value as MessageShape<O>, operationId }
        : { ok: false, failure: outcome.failure, operationId };
    } finally {
      this.#busy = false;
    }
  }

  /**
   * Prepares a checked model preference for a later accepted signal.
   *
   * @param kind Declared model or operation kind.
   * @param model Selected AI model for this invocation.
   */
  select(kind: AiModelKind, model: ModelRef | undefined): void {
    this.requireOpen();
    const role =
      kind === AiModelKind.GENERATION
        ? "generation"
        : kind === AiModelKind.DECISION
          ? "decision"
          : undefined;
    if (role === undefined)
      throw new TypeError("Agent model preference requires a supported kind.");
    if (model !== undefined) {
      Validate.check(ModelRefSchema, model);
      selectDeployment(this.registry, {
        kind: role,
        models: this.repository.models,
        instancePreference: model,
        ...(this.repository.allowedModels?.[role] === undefined
          ? {}
          : { allowedModels: this.repository.allowedModels[role] }),
      });
    }
    this.onSelect(kind, model);
  }

  /**
   * Rejects a handler that returned with a pending model operation.
   */
  finish(): void {
    this.requireOpen();
    if (this.#busy) throw new Error("Agent handler returned with a pending AI call.");
  }

  /**
   * Cancels callbacks retained after the handler returns.
   */
  close(): void {
    this.#closed = true;
    this.#controller.abort();
  }

  /**
   * Rejects stale or cancelled handler capabilities.
   */
  private requireOpen(): void {
    if (this.#closed || this.#signal.aborted)
      throw new Error("Agent AI handler capability is closed.");
  }

  /**
   * Validates typed input and per-handler call identity before any external work.
   *
   * @typeParam I Generated schema for the supplied input.
   * @typeParam O Generated schema for the declared output.
   * @param model Selected AI model for this invocation.
   * @param request Typed request for the current operation.
   */
  private validateRequest<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: {
      call: string;
      conversation: MessageShape<typeof ConversationIdSchema>;
      input: MessageShape<I>;
    },
  ): void {
    if (!isAiModel(model) || !this.repository.models.includes(model))
      throw new TypeError("Agent model is not registered for this repository.");
    if (!request.call.trim() || this.#names.has(request.call))
      throw new TypeError("Agent AI call names must be nonblank and unique per handler.");
    Validate.check(ConversationIdSchema, request.conversation);
    Validate.check(model.definition.input, request.input);
    this.#names.add(request.call);
  }

  /**
   * Connects the authenticated selected deployment and runs one backend operation.
   *
   * @typeParam I Generated input schema for the selected capability.
   * @typeParam O Generated output schema for the selected capability.
   * @param model Selected AI model for this invocation.
   * @param operationId Typed AI operation identifier.
   * @param request Typed request for the current operation.
   * @returns The authenticated backend outcome for this operation.
   */
  private async execute<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: {
      call: string;
      conversation: MessageShape<typeof ConversationIdSchema>;
      input: MessageShape<I>;
    },
    operationId: MessageShape<typeof AiOperationIdSchema>,
  ) {
    const { backend, selected } = this.selectedBackend(model);
    const operation = { operation: operationId, conversation: request.conversation };
    const audit =
      this.audit === undefined
        ? undefined
        : new AgentLiveAiAudit(this.audit, operation, selected, model);
    const deadline = this.operationDeadline(model);
    const identity = await this.authorize(backend, selected, deadline);
    await audit?.started(request.input);
    return this.runAuthorized(
      model,
      request,
      operationId,
      backend,
      identity,
      operation,
      audit,
      deadline,
    );
  }

  /**
   * Executes the authorized model and closes its selected MCP sessions.
   *
   * @typeParam I Generated input schema of the authorized model.
   * @typeParam O Generated output schema of the authorized model.
   * @param audit Retained history audit for this invocation.
   * @param backend Selected AI backend registration.
   * @param deadline Operation deadline, when configured.
   * @param identity Authorized provider connection identity.
   * @param model Selected AI model for this invocation.
   * @param operation Current AI operation identity.
   * @param operationId Typed AI operation identifier.
   * @param request Typed request for the current operation.
   * @returns The authorized backend outcome after MCP cleanup.
   */
  private async runAuthorized<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: { call: string; input: MessageShape<I> },
    operationId: MessageShape<typeof AiOperationIdSchema>,
    backend: AiBackendDefinition,
    identity: { provider: string; account: string; endpoint: string; model: string },
    operation: AgentOperationIdentity,
    audit: AgentLiveAiAudit | undefined,
    deadline: number | undefined,
  ) {
    const attempts = new Map<string, LiveAttempt>();
    const mcp = this.mcp(model, backend, operation, audit, attempts, deadline);
    return this.withMcp(mcp, async () => {
      await this.checkSession();
      let advertised: readonly AiMcpAdvertisedTool[] | undefined;
      try {
        advertised = await mcp?.prepare();
      } catch (error) {
        return this.setupFailure(error, audit);
      }
      return this.runAndAudit(
        model,
        request,
        operationId,
        backend,
        identity,
        audit,
        deadline,
        attempts,
        mcp,
        advertised,
      );
    });
  }

  /**
   * Records a safe setup failure without disguising unrelated errors.
   *
   * @param audit Retained history audit for this invocation.
   * @param error Original operation or cleanup error.
   * @returns The recorded safe failure for an MCP setup error.
   */
  private async setupFailure(error: unknown, audit: AgentLiveAiAudit | undefined) {
    if (!(error instanceof AiMcpSetupFailure)) throw error;
    const outcome = { ok: false as const, failure: this.failure(error.code, false) };
    await audit?.outcome(outcome);
    return outcome;
  }

  /**
   * Invokes the prepared backend and validates its result before audit.
   *
   * @typeParam I Generated input schema used for validation.
   * @typeParam O Generated output schema validated before audit.
   * @param advertised Tools advertised by the selected MCP session.
   * @param attempts Physical attempt state for this invocation.
   * @param audit Retained history audit for this invocation.
   * @param backend Selected AI backend registration.
   * @param deadline Operation deadline, when configured.
   * @param identity Authorized provider connection identity.
   * @param mcp Selected MCP session, when present.
   * @param model Selected AI model for this invocation.
   * @param operationId Typed AI operation identifier.
   * @param request Typed request for the current operation.
   * @returns The validated backend outcome after its audit is saved.
   */
  private async runAndAudit<I extends MessageSchema, O extends MessageSchema>(
    model: AiModel<I, O>,
    request: { call: string; input: MessageShape<I> },
    operationId: MessageShape<typeof AiOperationIdSchema>,
    backend: AiBackendDefinition,
    identity: { provider: string; account: string; endpoint: string; model: string },
    audit: AgentLiveAiAudit | undefined,
    deadline: number | undefined,
    attempts: Map<string, LiveAttempt>,
    mcp: AgentLiveMcpRuntime | undefined,
    advertised: readonly AiMcpAdvertisedTool[] | undefined,
  ) {
    const control = this.control(model, audit, deadline, attempts, mcp);
    const outcome = await this.runConnected(
      backend,
      model,
      request,
      operationId,
      identity,
      control,
      deadline,
      advertised,
    );
    if (outcome.ok) Validate.check(model.definition.output, outcome.value as MessageShape<O>);
    await audit?.outcome(outcome);
    return outcome;
  }

  /**
   * Handles operation and cleanup failures while closing the selected protocol.
   *
   * @typeParam T Operation result retained through MCP cleanup.
   * @param mcp Selected MCP session, when present.
   * @param run Callback executed inside the guarded session.
   * @returns The operation result after MCP cleanup succeeds.
   */
  private async withMcp<T>(
    mcp: AgentLiveMcpRuntime | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    let failed: unknown;
    try {
      return await run();
    } catch (error) {
      failed = error;
      throw error;
    } finally {
      await this.closeMcp(mcp, failed);
    }
  }

  /**
   * Binds the exact configured MCP catalog to this live operation.
   *
   * @param attempts Physical attempt state for this invocation.
   * @param audit Retained history audit for this invocation.
   * @param backend Selected AI backend registration.
   * @param deadline Operation deadline, when configured.
   * @param model Selected AI model for this invocation.
   * @param operation Current AI operation identity.
   * @returns The configured MCP runtime, or undefined when no server is selected.
   */
  private mcp(
    model: Model,
    backend: AiBackendDefinition,
    operation: {
      operation: MessageShape<typeof AiOperationIdSchema>;
      conversation: MessageShape<typeof ConversationIdSchema>;
    },
    audit: AgentLiveAiAudit | undefined,
    attempts: Map<string, LiveAttempt>,
    deadline: number | undefined,
  ) {
    const tools = model.definition.kind === "generation" ? (model.definition.tools ?? []) : [];
    if (!tools.length) return undefined;
    if (audit === undefined) throw new Error("Agent MCP tools require live audit storage.");
    const host = new AgentLiveMcpControls({
      scope: this.scope,
      registry: this.registry,
      backend,
      operation,
      signal: this.#signal,
      budget: this.budget,
      audit,
      ...(model.definition.limits.toolCalls === undefined
        ? {}
        : { maxToolCalls: model.definition.limits.toolCalls }),
      onProposal: (invocation) => {
        this.checkProposal(attempts, invocation);
      },
      ...(deadline === undefined ? {} : { deadlineEpochMs: deadline }),
    });
    return new AgentLiveMcpRuntime(host, tools);
  }

  /**
   * Rejects a proposal absent from its completed physical model response.
   *
   * @param attempts Physical attempt state for this invocation.
   * @param invocation Captured live Agent invocation.
   */
  private checkProposal(
    attempts: Map<string, LiveAttempt>,
    invocation: {
      ticketId: string;
      providerCallId: string;
      tool: string;
      providerToolName?: string;
      argumentsJson: string;
    },
  ): void {
    const response = attempts.get(invocation.ticketId)?.response;
    if (
      response?.$typeName !== GenerationResponseSchema.typeName ||
      response.outcome !== AiOutcome.TOOL_REQUESTED ||
      !response.toolCalls.some(
        (call) =>
          call.providerCallId === invocation.providerCallId &&
          call.toolName === (invocation.providerToolName ?? invocation.tool) &&
          call.argumentsJson === invocation.argumentsJson,
      )
    )
      throw new Error("MCP tool proposal is absent from the completed model response.");
  }

  /**
   * Handles an operation failure together with MCP cleanup failure.
   *
   * @param failed Original failure retained through cleanup.
   * @param mcp Selected MCP session, when present.
   * @returns Completion after preserving any operation and MCP cleanup failures.
   */
  private async closeMcp(mcp: AgentLiveMcpRuntime | undefined, failed: unknown): Promise<void> {
    if (mcp === undefined) return;
    try {
      await mcp.close();
    } catch (cleanup) {
      if (failed !== undefined)
        throw new AggregateError([failed, cleanup], "Agent MCP operation and cleanup failed.");
      throw cleanup;
    }
  }

  /**
   * Executes a checked backend using the selected authenticated connection.
   *
   * @typeParam I Generated input schema sent to the backend.
   * @typeParam O Generated output schema returned by the backend.
   * @param advertised Tools advertised by the selected MCP session.
   * @param backend Selected AI backend registration.
   * @param control MCP execution controls for this invocation.
   * @param deadline Operation deadline, when configured.
   * @param identity Authorized provider connection identity.
   * @param model Selected AI model for this invocation.
   * @param operationId Typed AI operation identifier.
   * @param request Typed request for the current operation.
   * @returns The checked backend outcome from the authenticated connection.
   */
  private async runConnected<I extends MessageSchema, O extends MessageSchema>(
    backend: AiBackendDefinition,
    model: AiModel<I, O>,
    request: { call: string; input: MessageShape<I> },
    operationId: MessageShape<typeof AiOperationIdSchema>,
    identity: { provider: string; account: string; endpoint: string; model: string },
    control: AiExecutionControl,
    deadline: number | undefined,
    advertised: readonly AiMcpAdvertisedTool[] | undefined,
  ) {
    await this.checkSession();
    const connected = await AgentModelSelection.awaitHook(
      backend.connect(this.scope, identity, control),
      this.#signal,
      deadline,
    );
    if (!this.sameIdentity(connected.identity, identity))
      throw new Error("Agent backend connection identity changed.");
    await this.checkSession();
    return AgentModelSelection.awaitHook(
      backend.execute({
        call: request.call,
        operationId,
        scope: this.scope,
        identity,
        model: connected.model,
        definition: (model as Model).definition,
        input: request.input,
        control,
        ...(advertised === undefined ? {} : { advertisedTools: advertised }),
      }),
      this.#signal,
      deadline,
    );
  }

  /**
   * Calculates capability time at the invocation's sampled deadline.
   *
   * @param model Selected AI model for this invocation.
   * @returns The effective epoch deadline, or undefined when no limit applies.
   */
  private operationDeadline(model: Model): number | undefined {
    const duration = model.definition.limits.deadlineMs;
    if (duration === undefined) return this.deadlineEpochMs;
    const local = Time.currentTimeMillis() + duration;
    return this.deadlineEpochMs === undefined ? local : Math.min(local, this.deadlineEpochMs);
  }

  /**
   * Resolves the selected backend through current repository policy.
   *
   * @param model Selected AI model for this invocation.
   * @returns The selected model and its registered backend.
   */
  private selectedBackend(model: Model) {
    const role = model.definition.kind;
    const kind = role === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION;
    const selected = this.selected.get(kind);
    if (selected === undefined) throw new Error("Agent AI kind has no selected deployment.");
    const registration = selectDeployment(this.registry, {
      kind: role,
      models: this.repository.models,
      instancePreference: selected.model,
      ...(this.repository.allowedModels?.[role] === undefined
        ? {}
        : { allowedModels: this.repository.allowedModels[role] }),
    });
    return { selected, backend: backendDefinition(registration) };
  }

  /**
   * Checks authenticated nonsecret identity immediately before connection.
   *
   * @param backend Selected AI backend registration.
   * @param deadline Operation deadline, when configured.
   * @param selected Models or selection retained for this invocation.
   * @returns The revalidated authenticated connection identity.
   */
  private async authorize(
    backend: AiBackendDefinition,
    selected: AgentLiveModel,
    deadline: number | undefined,
  ) {
    await this.checkSession();
    const control = {
      signal: this.#signal,
      ...(deadline === undefined ? {} : { deadlineEpochMs: deadline }),
    };
    const identity = await AgentModelSelection.awaitHook(
      backend.resolveIdentity(this.scope, control),
      this.#signal,
      deadline,
    );
    await this.checkSession();
    const allowed = await AgentModelSelection.awaitHook(
      backend.authorizeUse(this.scope, identity, control),
      this.#signal,
      deadline,
    );
    if (!allowed || !this.sameIdentity(identity, this.savedIdentity(selected.connection)))
      throw new Error("Agent model identity or authorization changed.");
    return identity;
  }

  /**
   * Returns credential-free fields from the validated selected connection.
   *
   * @param selected Models or selection retained for this invocation.
   * @returns Credential-free fields from the selected connection.
   */
  private savedIdentity(selected: AiConnectionIdentity) {
    return {
      provider: selected.provider?.value ?? "",
      account: selected.account?.value ?? "",
      endpoint: selected.endpoint?.value ?? "",
      model: selected.model?.value ?? "",
    };
  }

  /**
   * Compares all credential-free identity fields.
   *
   * @param left Earlier value in the comparison.
   * @param right Later value in the comparison.
   * @returns Whether all credential-free connection fields match.
   */
  private sameIdentity(
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
   * Creates physical tickets, validation, and local accounting to one backend.
   *
   * @param attempts Physical attempt state for this invocation.
   * @param audit Retained history audit for this invocation.
   * @param deadline Operation deadline, when configured.
   * @param mcp Selected MCP session, when present.
   * @param model Selected AI model for this invocation.
   * @returns The controls for physical admission, validation, and accounting.
   */
  private control(
    model: Model,
    audit: AgentLiveAiAudit | undefined,
    deadline: number | undefined,
    attempts: Map<string, LiveAttempt>,
    mcp: AgentLiveMcpRuntime | undefined,
  ): AiExecutionControl {
    let count = 0;
    return {
      signal: this.#signal,
      ...(deadline === undefined ? {} : { deadlineEpochMs: deadline }),
      nowEpochMs: () => Time.currentTimeMillis(),
      hasAuthority: () => this.hasAuthority(deadline),
      beginAttempt: (request) =>
        this.beginAttempt(attempts, model, request, ++count, audit, deadline),
      reserveTransport: (id, bytes, credit) =>
        Promise.resolve(this.reserveTransport(attempts, id, bytes, credit, model)),
      onReceived: (id, bytes) => {
        this.budget.onReceived(this.ticket(attempts, id), bytes);
      },
      finishAttempt: (completion) => this.finishAttempt(attempts, completion, audit),
      recordFailure: (code, retryable) => Promise.resolve(this.failure(code, retryable)),
      admitGeneration: (candidate, definition, input) =>
        parseCandidate(
          definition.output,
          candidate,
          (value) => definition.validation?.check(value, input) ?? [],
        ),
      admitDecision: (result, _definition, input, rounding) =>
        admitDecision(model, result, input, rounding ?? {}),
      callTool: (invocation) =>
        mcp?.call(invocation) ??
        Promise.reject(new Error("Agent capability has no configured MCP tools.")),
    };
  }

  /**
   * Checks cancellation and the selected operation deadline.
   *
   * @param deadline Operation deadline, when configured.
   * @returns Whether the session remains active and before its deadline.
   */
  private hasAuthority(deadline: number | undefined): boolean {
    return !this.#signal.aborted && (deadline === undefined || Time.currentTimeMillis() < deadline);
  }

  /**
   * Creates one fresh physical request with per-capability request count.
   *
   * @param _request Original request retained for callback compatibility.
   * @param attempts Physical attempt state for this invocation.
   * @param audit Retained history audit for this invocation.
   * @param deadline Operation deadline, when configured.
   * @param model Selected AI model for this invocation.
   * @param number Physical attempt sequence number.
   * @returns The admitted physical attempt or a safe failure.
   */
  private beginAttempt(
    attempts: Map<string, LiveAttempt>,
    model: Model,
    _request: AiAttemptRequest,
    number: number,
    audit: AgentLiveAiAudit | undefined,
    deadline: number | undefined,
  ) {
    this.requireOpen();
    if (!this.hasAuthority(deadline)) throw new Error("Agent model attempt deadline expired.");
    if (
      model.definition.limits.modelRequests !== undefined &&
      number > model.definition.limits.modelRequests
    )
      throw new Error("Agent physical model request budget is exhausted.");
    const id = randomUUID();
    return (
      audit
        ?.attemptStarted(_request, id)
        .then(() => this.newTicket(attempts, id, model, deadline)) ??
      Promise.resolve(this.newTicket(attempts, id, model, deadline))
    );
  }

  /**
   * Sets a fresh transport ticket only after its start audit settles.
   *
   * @param attempts Physical attempt state for this invocation.
   * @param deadline Operation deadline, when configured.
   * @param id Typed identifier of the requested item.
   * @param model Selected AI model for this invocation.
   * @returns The reserved transport ticket after its start audit.
   */
  private newTicket(
    attempts: Map<string, LiveAttempt>,
    id: string,
    model: Model,
    deadline: number | undefined,
  ) {
    attempts.set(id, { id, completed: false });
    return {
      id,
      signal: this.#signal,
      ...(model.definition.limits.maxInputBytes === undefined
        ? {}
        : { maxInputBytes: model.definition.limits.maxInputBytes }),
      ...(model.definition.limits.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: model.definition.limits.maxOutputBytes }),
      ...(deadline === undefined ? {} : { deadlineEpochMs: deadline }),
    };
  }

  /**
   * Acquires full output credit before transport starts.
   *
   * @param attempts Physical attempt state for this invocation.
   * @param bytes Measured serialized byte count.
   * @param credit Reserved input and output byte credit.
   * @param id Typed identifier of the requested item.
   * @param model Selected AI model for this invocation.
   * @returns The transport ticket with full response credit reserved.
   */
  private reserveTransport(
    attempts: Map<string, LiveAttempt>,
    id: string,
    bytes: number,
    credit: number | undefined,
    model: Model,
  ): number | undefined {
    this.requireOpen();
    const attempt = attempts.get(id);
    if (attempt === undefined || attempt.reservation !== undefined || attempt.completed)
      throw new Error("Agent transport ticket was already reserved or unknown.");
    const limits = model.definition.limits;
    if (
      (limits.maxInputBytes !== undefined && bytes > limits.maxInputBytes) ||
      (limits.maxOutputBytes !== undefined &&
        credit !== undefined &&
        credit > limits.maxOutputBytes)
    )
      throw new Error("Agent provider request exceeds its operation byte bounds.");
    const ticket = this.budget.reservePhysical(bytes, credit ?? limits.maxOutputBytes, "model");
    attempt.reservation = ticket;
    return ticket.maxOutputBytes;
  }

  /**
   * Gets one existing reservation for a physical receipt.
   *
   * @param attempts Physical attempt state for this invocation.
   * @param id Typed identifier of the requested item.
   * @returns The active physical reservation for the supplied ticket ID.
   */
  private ticket(attempts: ReadonlyMap<string, LiveAttempt>, id: string): AgentPhysicalTicket {
    const ticket = attempts.get(id)?.reservation;
    if (ticket === undefined) throw new Error("Agent model attempt has no live reservation.");
    return ticket;
  }

  /**
   * Completes measured response bytes without replay state.
   *
   * @param attempts Physical attempt state for this invocation.
   * @param audit Retained history audit for this invocation.
   * @param completion Completed provider attempt or operation.
   * @returns Completion after response accounting and audit settle.
   */
  private async finishAttempt(
    attempts: Map<string, LiveAttempt>,
    completion: AiAttemptCompletion,
    audit: AgentLiveAiAudit | undefined,
  ): Promise<void> {
    this.requireOpen();
    const attempt = attempts.get(completion.ticketId);
    if (attempt === undefined || attempt.completed)
      throw new Error("Agent model attempt is unknown or completed.");
    const ticket = this.ticket(attempts, completion.ticketId);
    await audit?.attemptFinished(completion);
    if (completion.receivedBytes !== undefined)
      this.budget.settlePhysical(ticket, completion.receivedBytes);
    attempt.response = completion.response;
    attempt.completed = true;
  }

  /**
   * Returns one safe local diagnostic without a durable execution record.
   *
   * @param code Recorded failure code.
   * @param retryableByNewSignal Whether a fresh signal may retry this failure.
   * @returns A safe local AI failure without persisted execution status.
   */
  private failure(code: AiFailure["code"], retryableByNewSignal: boolean): AiFailure {
    return { code, retryableByNewSignal, diagnosticId: randomUUID() };
  }
}
