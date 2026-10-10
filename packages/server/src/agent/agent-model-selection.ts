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

import { clone, create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { AnyMessages, Time, TypeUrls, Validate } from "@spine-event-engine/core";
import type { MessageSchema } from "@spine-event-engine/core";
import {
  ModelRef as ModelRefFactory,
  type AiControl,
  type AiRegistry,
  type AiScope,
  type ModelRef,
} from "@spine-event-engine/ai";
import {
  backendDefinition,
  registryOptions,
  selectDeployment,
} from "@spine-event-engine/ai/spi/runtime";
import {
  AiAccountIdentitySchema,
  AiConnectionIdentitySchema,
  AiEndpointIdentitySchema,
  AiModelKind,
  AiProviderModelNameSchema as ModelNameSchema,
  AiProviderNameSchema,
  ModelRefSchema,
  type ModelPreference,
} from "@spine-event-engine/proto/agent";
import {
  CommandIdSchema,
  EventIdSchema,
  MessageIdSchema,
  ActorContextSchema,
  TenantIdSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  AgentSelectedModelSchema,
  type AgentAcceptedInvocation,
  type AgentSelectedModel,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { RepositoryAiOptions } from "../repository/repository.js";
import { AgentExecutionFault } from "./agent-execution-fault.js";

/**
 * Copies every accepted-scope identity before passing it to an application callback.
 *
 * @param scope Original accepted actor, tenant, Agent and source facts.
 * @returns Detached scope with independent nested Protobuf values.
 */
const copyScope = (scope: AiScope): AiScope => ({
  actor: clone(ActorContextSchema, scope.actor),
  tenant:
    scope.tenant.kind === "tenant"
      ? { kind: "tenant", id: clone(TenantIdSchema, scope.tenant.id) }
      : { kind: "single-tenant" },
  agent: clone(MessageIdSchema, scope.agent),
  source: clone(MessageIdSchema, scope.source),
});

interface AgentModelSelectionAccess {
  /**
   * Builds the authorization scope from immutable accepted signal facts.
   *
   * @param accepted Accepted original signal and recipient.
   * @param state Generated Agent state descriptor.
   * @param tenantId Delivery tenant, or undefined for a single-tenant Bounded Context.
   * @returns Typed actor, Agent, tenant, and source scope.
   */
  scope(accepted: AgentAcceptedInvocation, state: MessageSchema, tenantId?: TenantId): AiScope;

  /**
   * Returns each model kind required by the repository's capabilities.
   * @param registry Effective deployment registry.
   * @param repository Repository models and selection policy.
   * @param scope Authenticated accepted-invocation scope.
   * @param preferences Claim-time per-instance selections.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param sourceMessage Detached original accepted payload when selection is required.
   * @returns Selected, authorized deployments by available kind.
   */
  select(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
    sourceMessage?: Any,
  ): Promise<readonly AgentSelectedModel[]>;

  /**
   * Resolves one kind through instance, repository, and Bounded Context precedence.
   *
   * @param registry Effective deployment registry.
   * @param repository Repository models and selection policy.
   * @param scope Authenticated accepted-invocation scope.
   * @param preferences Claim-time per-instance selections.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param kind Generation or decision kind to resolve.
   * @param sourceMessage Detached original accepted payload when selection is required.
   * @returns Authorized deployment and nonsecret connection identity.
   */
  selectKind(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<AgentSelectedModel>;

  /**
   * Resolves and copies one explicit model from the accepted payload.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param kind Generation or decision kind.
   * @param sourceMessage Detached source supplied by the runner.
   * @returns A validated explicit model or absence.
   */
  resolveOverride(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    signal: AbortSignal,
    deadlineEpochMs: number,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<ModelRef | undefined>;

  /**
   * Finds and authorizes a registered deployment before identity resolution.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param preferences Claim-time per-instance selections.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param kind Generation or decision kind.
   * @param sourceMessage Original accepted payload.
   * @returns A registered authorized deployment.
   */
  deployment(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<ReturnType<typeof selectDeployment>>;

  /**
   * Checks a concrete or inherited selection with repository policy.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param reference Selected deployment or inheritance.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns When the selection is authorized.
   */
  authorizeSelection(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    reference: ModelRef | undefined,
    signal: AbortSignal,
    deadlineEpochMs: number,
  ): Promise<void>;

  /**
   * Calls a hook only while active and races its bounded cancellation.
   *
   * @typeParam Value Callback result.
   * @param registry Effective registry and hook bound.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param callback Hook receiving a bounded linked control.
   * @returns A result produced before cancellation or expiry.
   */
  invokeHook<Value>(
    registry: AiRegistry,
    signal: AbortSignal,
    deadlineEpochMs: number,
    callback: (control: AiControl) => Value | Promise<Value>,
  ): Promise<Value>;

  /**
   * Resolves and authorizes the selected backend's nonsecret identity.
   * @param backend Factory-proven selected backend callbacks.
   * @param scope Authenticated accepted-invocation scope.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns Validated connection identity for the selected backend.
   */
  connection(
    backend: ReturnType<typeof backendDefinition>,
    scope: AiScope,
    signal: AbortSignal,
    deadlineEpochMs: number,
  ): Promise<NonNullable<AgentSelectedModel["connection"]>>;

  /**
   * Converts a deployment role to its generated enum value.
   * @param kind Registered generation or decision role.
   * @returns Corresponding generated model kind.
   */
  kind(kind: "generation" | "decision"): AiModelKind;

  /**
   * Awaits a selection hook under cancellation and the invocation deadline.
   * @typeParam Value Hook result type.
   * @param work Hook result or pending callback promise.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns Hook value if it settles before cancellation or expiry.
   */
  awaitHook<Value>(
    work: Value | Promise<Value>,
    signal: AbortSignal,
    deadlineEpochMs: number,
  ): Promise<Value>;
}

/**
 * Selects and authenticates each available model kind at execution start.
 */
export const AgentModelSelection: AgentModelSelectionAccess = Object.freeze({
  /**
   * Constructs the accepted actor, tenant, Agent and source authorization scope.
   *
   * @param accepted Original accepted signal and typed recipient.
   * @param state Generated Agent state descriptor.
   * @param tenantId Delivery tenant, if this Bounded Context is tenant-scoped.
   * @returns Scope passed to identity and authorization callbacks.
   */
  scope(accepted: AgentAcceptedInvocation, state: MessageSchema, tenantId?: TenantId): AiScope {
    const recipient = accepted.recipientId;
    if (recipient === undefined) throw new Error("Agent selection requires the typed recipient.");
    const signal = accepted.signal;
    if (signal.case !== "command" && signal.case !== "event")
      throw new Error("Agent selection requires its original source signal.");
    const sourceId =
      signal.case === "command"
        ? signal.value.id === undefined
          ? undefined
          : AnyMessages.pack(CommandIdSchema, signal.value.id)
        : signal.value.id === undefined
          ? undefined
          : AnyMessages.pack(EventIdSchema, signal.value.id);
    if (sourceId === undefined) throw new Error("Agent selection requires the source ID.");
    const payloadType = signal.value.message?.typeUrl;
    if (payloadType === undefined || payloadType.trim().length === 0)
      throw new Error("Agent selection requires the source payload type.");
    const actor = accepted.actor;
    if (actor === undefined) throw new Error("Agent selection requires the accepted actor.");
    return {
      actor,
      tenant: tenantId === undefined ? { kind: "single-tenant" } : { kind: "tenant", id: tenantId },
      agent: create(MessageIdSchema, { id: recipient, typeUrl: TypeUrls.derive(state) }),
      source: create(MessageIdSchema, {
        id: sourceId,
        typeUrl: payloadType,
      }),
    };
  },

  /**
   * Resolves, authorizes and records one selected deployment for each available kind.
   * @param registry Effective deployment registry.
   * @param repository Repository models and selection policy.
   * @param scope Authenticated accepted-invocation scope.
   * @param preferences Claim-time per-instance selections.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param sourceMessage Detached original accepted payload when selection is required.
   * @returns Selected deployments for kinds used by the repository.
   */
  async select(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
    sourceMessage?: Any,
  ): Promise<readonly AgentSelectedModel[]> {
    const selected: AgentSelectedModel[] = [];
    for (const kind of ["generation", "decision"] as const) {
      if (!repository.models.some((model) => model.definition.kind === kind)) continue;
      selected.push(
        await this.selectKind(
          registry,
          repository,
          scope,
          preferences,
          signal,
          deadlineEpochMs,
          kind,
          sourceMessage,
        ),
      );
    }
    return selected;
  },

  /**
   * Resolves a deployment through normal precedence and checks authenticated identity.
   * @param registry Effective deployment registry.
   * @param repository Repository models and selection policy.
   * @param scope Authenticated accepted-invocation scope.
   * @param preferences Claim-time per-instance selections.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param kind Generation or decision kind to select.
   * @param sourceMessage Detached original accepted payload when selection is required.
   * @returns Chosen deployment and validated connection identity.
   */
  async selectKind(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<AgentSelectedModel> {
    const registration = await this.deployment(
      registry,
      repository,
      scope,
      preferences,
      signal,
      deadlineEpochMs,
      kind,
      sourceMessage,
    );
    const connection = await this.connection(
      backendDefinition(registration),
      scope,
      signal,
      deadlineEpochMs,
    );
    return create(AgentSelectedModelSchema, {
      kind: this.kind(kind),
      model: registration.ref,
      connection,
    });
  },

  /**
   * Finds a deployment and checks a concrete resolver choice before identity work.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param preferences Claim-time per-instance selections.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param kind Generation or decision kind.
   * @param sourceMessage Original accepted payload.
   * @returns A registered authorized deployment.
   */
  async deployment(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<ReturnType<typeof selectDeployment>> {
    const override = await this.resolveOverride(
      registry,
      repository,
      scope,
      signal,
      deadlineEpochMs,
      kind,
      sourceMessage,
    );
    const normal = this.selection(registry, repository, preferences, kind);
    const registration = selectDeployment(registry, {
      ...normal,
      ...(override === undefined ? {} : { instancePreference: override }),
    });
    if (override !== undefined)
      await this.authorizeSelection(registry, repository, scope, override, signal, deadlineEpochMs);
    return registration;
  },

  /**
   * Resolves and copies one explicit model from the accepted payload.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param kind Generation or decision kind.
   * @param sourceMessage Detached source supplied by the runner.
   * @returns A validated explicit model or absence.
   */
  async resolveOverride(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    signal: AbortSignal,
    deadlineEpochMs: number,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<ModelRef | undefined> {
    if (repository.resolveModel === undefined) return undefined;
    if (sourceMessage === undefined) throw new Error("Agent selection requires source payload.");
    const result = await this.invokeHook(registry, signal, deadlineEpochMs, (control) =>
      repository.resolveModel?.(kind, copyScope(scope), clone(AnySchema, sourceMessage), control),
    );
    if (result === undefined) return undefined;
    Validate.check(ModelRefSchema, result);
    return ModelRefFactory.of(result.name?.value ?? "", result.revision?.value ?? "");
  },

  /**
   * Checks a concrete or inherited selection with the repository policy.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param reference Selected deployment or inherited preference.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns When selection is authorized.
   */
  async authorizeSelection(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    reference: ModelRef | undefined,
    signal: AbortSignal,
    deadlineEpochMs: number,
  ): Promise<void> {
    if (repository.authorizeSelection === undefined) return;
    const allowed = await this.invokeHook(registry, signal, deadlineEpochMs, (control) =>
      repository.authorizeSelection?.(scope, reference, control),
    );
    if (allowed !== true) throw new Error("Agent model selection is unauthorized.");
  },

  /**
   * Calls a hook only while active and races its bounded cancellation.
   *
   * @typeParam Value Callback result.
   * @param registry Effective registry and hook bound.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @param callback Hook receiving a linked bounded control.
   * @returns A result produced before cancellation or expiry.
   */
  async invokeHook<Value>(
    registry: AiRegistry,
    signal: AbortSignal,
    deadlineEpochMs: number,
    callback: (control: AiControl) => Value | Promise<Value>,
  ): Promise<Value> {
    const deadline = Math.min(
      deadlineEpochMs,
      Time.currentTimeMillis() +
        (registryOptions(registry).hookTimeoutMs ??
          registryOptions(registry).invocationLimits.deadlineMs),
    );
    if (signal.aborted) throw new Error("Agent model selection cancelled.");
    if (deadline <= Time.currentTimeMillis()) throw new Error("Agent model selection expired.");
    const controller = new AbortController();
    const linked = AbortSignal.any([signal, controller.signal]);
    const timer = setTimeout(
      () => {
        controller.abort();
      },
      Math.max(0, deadline - Time.currentTimeMillis()),
    );
    try {
      return await this.awaitHook(
        callback({ signal: linked, deadlineEpochMs: deadline }),
        linked,
        deadline,
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  },

  /**
   * Builds the accepted deployment precedence from repository and claim-time facts.
   * @param registry Effective deployment registry.
   * @param repository Repository models and selection policy.
   * @param preferences Claim-time per-instance selections.
   * @param kind Generation or decision kind to select.
   * @returns Inputs for the registry's normal selection path.
   */
  selection(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    preferences: readonly ModelPreference[],
    kind: "generation" | "decision",
  ): Parameters<typeof selectDeployment>[1] {
    const preference = preferences.find((item) => item.kind === this.kind(kind));
    const instancePreference: ModelRef | undefined =
      preference?.selection.case === "model" ? preference.selection.value : undefined;
    return {
      kind,
      models: repository.models,
      ...(instancePreference === undefined ? {} : { instancePreference }),
      ...(repository.defaultModels?.[kind] === undefined
        ? {}
        : { repositoryDefault: repository.defaultModels[kind] }),
      ...(registryOptions(registry).defaultModels[kind] === undefined
        ? {}
        : { contextDefault: registryOptions(registry).defaultModels[kind] }),
      ...(repository.allowedModels?.[kind] === undefined
        ? {}
        : { allowedModels: repository.allowedModels[kind] }),
    };
  },

  /**
   * Resolves a connection identity within the deadline. An explicit use denial
   * becomes a safe terminal execution fault before the Agent handler runs.
   *
   * @param backend Factory-proven selected backend callbacks.
   * @param scope Authenticated accepted-invocation scope.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns Validated nonsecret connection identity.
   */
  async connection(
    backend: ReturnType<typeof backendDefinition>,
    scope: AiScope,
    signal: AbortSignal,
    deadlineEpochMs: number,
  ): Promise<NonNullable<AgentSelectedModel["connection"]>> {
    if (signal.aborted) throw new Error("Agent model selection cancelled.");
    if (deadlineEpochMs <= Time.currentTimeMillis())
      throw new Error("Agent model selection expired.");
    const control = { signal, deadlineEpochMs };
    const identity = await this.awaitHook(
      backend.resolveIdentity(scope, control),
      signal,
      deadlineEpochMs,
    );
    signal.throwIfAborted();
    if (deadlineEpochMs <= Time.currentTimeMillis())
      throw new Error("Agent model selection expired.");
    const allowed = await this.awaitHook(
      backend.authorizeUse(scope, identity, control),
      signal,
      deadlineEpochMs,
    );
    if (!allowed)
      throw new AgentExecutionFault("MODEL_USE_DENIED", "Selected Agent model use was denied.");
    const connection = create(AiConnectionIdentitySchema, {
      provider: create(AiProviderNameSchema, { value: identity.provider }),
      account: create(AiAccountIdentitySchema, { value: identity.account }),
      endpoint: create(AiEndpointIdentitySchema, { value: identity.endpoint }),
      model: create(ModelNameSchema, { value: identity.model }),
    });
    Validate.check(AiConnectionIdentitySchema, connection);
    return connection;
  },

  /**
   * Converts a registered deployment role to the generated closed enum.
   * @param kind Registered generation or decision role.
   * @returns Matching generated model kind.
   */
  kind(kind: "generation" | "decision"): AiModelKind {
    return kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION;
  },

  /**
   * Bounds a connection or authorization hook even if its callback ignores cancellation.
   * @typeParam Value Hook result type.
   * @param work Hook result or pending callback promise.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns Hook value if it settles before cancellation or expiry.
   */
  awaitHook<Value>(
    work: Value | Promise<Value>,
    signal: AbortSignal,
    deadlineEpochMs: number,
  ): Promise<Value> {
    const remaining = deadlineEpochMs - Time.currentTimeMillis();
    if (signal.aborted) return Promise.reject(new Error("Agent model selection cancelled."));
    if (remaining <= 0) return Promise.reject(new Error("Agent model selection expired."));
    return new Promise<Value>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new Error("Agent model selection cancelled."));
      };
      const timer = setTimeout(abort, remaining);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(work)
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        })
        .catch(() => undefined);
    });
  },
});
