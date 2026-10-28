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
import { AnyPacker, Time, TypeUrls, Validate } from "@spine-event-engine/core";
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
  type MessageId,
  type TenantId,
} from "@spine-event-engine/proto";
import type { RepositoryAiOptions } from "../repository/repository.js";
import type { SignalMetadata } from "../runtime/signal-metadata.js";
import { AgentLiveFault } from "./agent-live-fault.js";
import type { AgentLiveInvocation, AgentLiveModel } from "./agent-live-inputs.js";

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
   * Creates one live authorization scope directly from its original signal.
   * @param invocation Original typed source and Agent recipient.
   * @param state Generated Agent state descriptor.
   * @param metadata Causal Event actor extraction.
   * @param tenantId Selected delivery tenant, if any.
   * @returns Detached source, actor, Agent, and tenant scope.
   */
  scopeLive(
    invocation: AgentLiveInvocation,
    state: MessageSchema,
    metadata: SignalMetadata,
    tenantId?: TenantId,
  ): AiScope;

  /**
   * Finds an authorized live deployment without an execution-record message.
   * @param registry Effective AI registry.
   * @param repository Repository policy and capabilities.
   * @param scope Original authorization scope.
   * @param preferences Current committed instance preferences.
   * @param signal Invocation cancellation.
   * @param deadlineEpochMs Actual live deadline.
   * @param kind Generation or decision kind.
   * @param sourceMessage Original source payload for selection hooks.
   * @returns Validated selected model and connection.
   */
  selectLiveKind(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number | undefined,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<AgentLiveModel>;

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
    deadlineEpochMs: number | undefined,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<ModelRef | undefined>;

  /**
   * Finds and authorizes a registered deployment before identity resolution.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param preferences Persisted per-instance selections.
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
    deadlineEpochMs: number | undefined,
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
    deadlineEpochMs: number | undefined,
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
    deadlineEpochMs: number | undefined,
    callback: (control: AiControl) => Value | Promise<Value>,
  ): Promise<Value>;

  /**
   * Resolves and authorizes the selected backend's nonsecret identity.
   *
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
    deadlineEpochMs: number | undefined,
  ): Promise<AgentLiveModel["connection"]>;

  /**
   * Converts a deployment role to its generated enum value.
   *
   * @param kind Registered generation or decision role.
   * @returns Corresponding generated model kind.
   */
  kind(kind: "generation" | "decision"): AiModelKind;

  /**
   * Awaits a selection hook under cancellation and the invocation deadline.
   *
   * @typeParam Value Hook result type.
   * @param work Hook result or pending callback promise.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns Hook value if it settles before cancellation or expiry.
   */
  awaitHook<Value>(
    work: Value | Promise<Value>,
    signal: AbortSignal,
    deadlineEpochMs: number | undefined,
  ): Promise<Value>;
}

/**
 * Chooses the earliest configured callback or invocation deadline.
 *
 * @param registry Effective callback policy.
 * @param invocationDeadline Accepted invocation deadline, when configured.
 * @returns Absolute callback deadline, or undefined when no ceiling applies.
 */
const selectionHookDeadline = (
  registry: AiRegistry,
  invocationDeadline: number | undefined,
): number | undefined => {
  const hookTimeoutMs = registryOptions(registry).hookTimeoutMs;
  const hookDeadline =
    hookTimeoutMs === undefined ? undefined : Time.currentTimeMillis() + hookTimeoutMs;
  return invocationDeadline === undefined
    ? hookDeadline
    : hookDeadline === undefined
      ? invocationDeadline
      : Math.min(invocationDeadline, hookDeadline);
};

/**
 * Packs the original typed signal ID with its exact payload type.
 */
const AgentLiveSource = Object.freeze({
  /**
   * Packs the original Command or Event ID and payload type URL.
   * @param payloadType Exact declared signal payload type URL.
   * @param source Original Command or Event carrying its typed ID.
   * @returns Message ID with the original typed source ID.
   */
  create(source: AgentLiveInvocation["source"], payloadType: string): MessageId {
    if (source.case === "command") {
      if (source.value.id === undefined) throw new TypeError("Agent Command ID is missing.");
      return create(MessageIdSchema, {
        id: AnyPacker.pack(CommandIdSchema, source.value.id),
        typeUrl: payloadType,
      });
    }
    if (source.value.id === undefined) throw new TypeError("Agent Event ID is missing.");
    return create(MessageIdSchema, {
      id: AnyPacker.pack(EventIdSchema, source.value.id),
      typeUrl: payloadType,
    });
  },
});

/**
 * Selects and authenticates each available model kind at execution start.
 */
export const AgentModelSelection: AgentModelSelectionAccess = Object.freeze({
  /**
   * Derives live actor and typed source identity without persisted acceptance facts.
   */
  scopeLive(
    invocation: AgentLiveInvocation,
    state: MessageSchema,
    metadata: SignalMetadata,
    tenantId?: TenantId,
  ): AiScope {
    if (invocation.stateType !== state.typeName || !invocation.recipientId.typeUrl.trim())
      throw new TypeError("Agent selection requires its typed state and recipient.");
    const source = invocation.source;
    const id = source.value.id;
    const payloadType = source.value.message?.typeUrl;
    if (id === undefined || !payloadType?.trim())
      throw new TypeError("Agent selection requires the source ID and payload type.");
    const actor =
      source.case === "command"
        ? source.value.context?.actorContext
        : metadata.originFromEvent(source.value).actorContext;
    return {
      actor: actor === undefined ? create(ActorContextSchema) : clone(ActorContextSchema, actor),
      tenant:
        tenantId === undefined
          ? { kind: "single-tenant" }
          : { kind: "tenant", id: clone(TenantIdSchema, tenantId) },
      agent: create(MessageIdSchema, {
        id: clone(AnySchema, invocation.recipientId),
        typeUrl: TypeUrls.derive(state),
      }),
      source: AgentLiveSource.create(source, payloadType),
    };
  },

  /**
   * Selects a registered backend and its checked connection for one live kind.
   */
  async selectLiveKind(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number | undefined,
    kind: "generation" | "decision",
    sourceMessage?: Any,
  ): Promise<AgentLiveModel> {
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
    const model = clone(ModelRefSchema, registration.ref);
    Validate.check(ModelRefSchema, model);
    return {
      kind: kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION,
      model,
      connection,
    };
  },

  /**
   * Finds a deployment and checks a concrete resolver choice before identity work.
   *
   * @param registry Effective registry and hook bound.
   * @param repository Repository selection policy.
   * @param scope Accepted source and actor.
   * @param preferences Persisted per-instance selections.
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
    deadlineEpochMs: number | undefined,
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
    deadlineEpochMs: number | undefined,
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
    deadlineEpochMs: number | undefined,
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
    deadlineEpochMs: number | undefined,
    callback: (control: AiControl) => Value | Promise<Value>,
  ): Promise<Value> {
    const deadline = selectionHookDeadline(registry, deadlineEpochMs);
    if (signal.aborted) throw new Error("Agent model selection cancelled.");
    if (deadline !== undefined && deadline <= Time.currentTimeMillis())
      throw new Error("Agent model selection expired.");
    const controller = new AbortController();
    const linked = AbortSignal.any([signal, controller.signal]);
    const timer =
      deadline === undefined
        ? undefined
        : setTimeout(
            () => {
              controller.abort();
            },
            Math.max(0, deadline - Time.currentTimeMillis()),
          );
    try {
      return await this.awaitHook(
        callback({
          signal: linked,
          ...(deadline === undefined ? {} : { deadlineEpochMs: deadline }),
        }),
        linked,
        deadline,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  },

  /**
   * Builds deployment precedence from repository settings and persisted preferences.
   *
   * @param registry Effective deployment registry.
   * @param repository Repository models and selection policy.
   * @param preferences Persisted per-instance selections.
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
    deadlineEpochMs: number | undefined,
  ): Promise<AgentLiveModel["connection"]> {
    if (signal.aborted) throw new Error("Agent model selection cancelled.");
    if (deadlineEpochMs !== undefined && deadlineEpochMs <= Time.currentTimeMillis())
      throw new Error("Agent model selection expired.");
    const control = { signal, ...(deadlineEpochMs === undefined ? {} : { deadlineEpochMs }) };
    const identity = await this.awaitHook(
      backend.resolveIdentity(scope, control),
      signal,
      deadlineEpochMs,
    );
    signal.throwIfAborted();
    if (deadlineEpochMs !== undefined && deadlineEpochMs <= Time.currentTimeMillis())
      throw new Error("Agent model selection expired.");
    const allowed = await this.awaitHook(
      backend.authorizeUse(scope, identity, control),
      signal,
      deadlineEpochMs,
    );
    if (!allowed)
      throw new AgentLiveFault("MODEL_USE_DENIED", "Selected Agent model use was denied.");
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
   *
   * @param kind Registered generation or decision role.
   * @returns Matching generated model kind.
   */
  kind(kind: "generation" | "decision"): AiModelKind {
    return kind === "generation" ? AiModelKind.GENERATION : AiModelKind.DECISION;
  },

  /**
   * Bounds a connection or authorization hook even if its callback ignores cancellation.
   *
   * @typeParam Value Hook result type.
   * @param work Hook result or pending callback promise.
   * @param signal Cancellation signal for this execution.
   * @param deadlineEpochMs Absolute invocation deadline.
   * @returns Hook value if it settles before cancellation or expiry.
   */
  awaitHook<Value>(
    work: Value | Promise<Value>,
    signal: AbortSignal,
    deadlineEpochMs: number | undefined,
  ): Promise<Value> {
    const remaining =
      deadlineEpochMs === undefined ? undefined : deadlineEpochMs - Time.currentTimeMillis();
    if (signal.aborted) return Promise.reject(new Error("Agent model selection cancelled."));
    if (remaining !== undefined && remaining <= 0)
      return Promise.reject(new Error("Agent model selection expired."));
    return new Promise<Value>((resolve, reject) => {
      const abort = () => {
        if (timer !== undefined) clearTimeout(timer);
        reject(new Error("Agent model selection cancelled."));
      };
      const timer = remaining === undefined ? undefined : setTimeout(abort, remaining);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(work)
        .then(resolve, reject)
        .finally(() => {
          if (timer !== undefined) clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        })
        .catch(() => undefined);
    });
  },
});
