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

import { create } from "@bufbuild/protobuf";
import { AnyMessages, Time, TypeUrls, Validate } from "@spine-event-engine/core";
import type { MessageSchema } from "@spine-event-engine/core";
import type { AiRegistry, AiScope, ModelRef } from "@spine-event-engine/ai";
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
  type ModelPreference,
} from "@spine-event-engine/proto/agent";
import {
  CommandIdSchema,
  EventIdSchema,
  MessageIdSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  AgentSelectedModelSchema,
  type AgentAcceptedInvocation,
  type AgentSelectedModel,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { RepositoryAiOptions } from "../repository/repository.js";

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
   * @returns Selected, authorized deployments by available kind.
   */
  select(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
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
  ): Promise<AgentSelectedModel>;

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
   * @returns Selected deployments for kinds used by the repository.
   */
  async select(
    registry: AiRegistry,
    repository: RepositoryAiOptions,
    scope: AiScope,
    preferences: readonly ModelPreference[],
    signal: AbortSignal,
    deadlineEpochMs: number,
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
  ): Promise<AgentSelectedModel> {
    const registration = selectDeployment(
      registry,
      this.selection(registry, repository, preferences, kind),
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
   * Resolves and authorizes a connection identity within the execution deadline.
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
    const control = { signal, deadlineEpochMs };
    const identity = await this.awaitHook(
      backend.resolveIdentity(scope, control),
      signal,
      deadlineEpochMs,
    );
    const allowed = await this.awaitHook(
      backend.authorizeUse(scope, identity, control),
      signal,
      deadlineEpochMs,
    );
    if (!allowed) throw new Error("Selected Agent model use is unauthorized.");
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
    if (signal.aborted || remaining <= 0)
      return Promise.reject(new Error("Agent model selection expired."));
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
