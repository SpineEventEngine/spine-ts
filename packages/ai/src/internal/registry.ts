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
import type { ModelRef } from "@spine-event-engine/proto/agent";
import type { AiDefaultModels, AiInvocationLimits, AiRegistryOptions } from "./contracts.js";
import { isAiModel, modelRefKey, ModelRef as ModelRefFactory, positiveInteger } from "./model.js";
import type { AiModel } from "./model.js";
import { backendDefinition, type AiBackendRegistration } from "./registration.js";
import { mcpDefinition, type McpServerRegistration } from "./mcp.js";

interface RegistryState {
  /**
   * Configured options for this contract.
   */
  readonly options: Readonly<AiRegistryOptions>;

  /**
   * Configured backends for this contract.
   */
  readonly backends: Map<string, AiBackendRegistration>;

  /**
   * Explicitly permitted tool references or policies.
   */
  readonly tools: Map<string, McpServerRegistration>;

  /**
   * Configured frozen for this contract.
   */
  frozen: boolean;
}
const registries = new WeakMap<AiRegistry, RegistryState>();

/**
 * Copies whole-signal limits with required finite bounds.
 * @param limits Caller-supplied limits.
 * @returns Immutable invocation limits.
 */
const copyInvocationLimits = (limits: AiInvocationLimits): AiInvocationLimits => {
  const candidate: unknown = limits;
  if (typeof candidate !== "object" || candidate === null)
    throw new TypeError("invocationLimits are required");
  return Object.freeze({
    operations: positiveInteger(limits.operations, "operations"),
    modelRequests: positiveInteger(limits.modelRequests, "modelRequests"),
    toolCalls: positiveInteger(limits.toolCalls, "toolCalls", true),
    recordedReads: positiveInteger(limits.recordedReads, "recordedReads", true),
    deadlineMs: positiveInteger(limits.deadlineMs, "deadlineMs"),
    totalInputBytes: positiveInteger(limits.totalInputBytes, "totalInputBytes"),
    totalOutputBytes: positiveInteger(limits.totalOutputBytes, "totalOutputBytes"),
    maxRecoveryBytes: positiveInteger(limits.maxRecoveryBytes, "maxRecoveryBytes"),
  });
};

/**
 * Copies optional deployment defaults by Protobuf value.
 * @param defaults Caller-supplied defaults.
 * @returns Immutable references.
 */
const copyDefaults = (defaults: AiDefaultModels): AiDefaultModels => {
  const candidate: unknown = defaults;
  if (typeof candidate !== "object" || candidate === null)
    throw new TypeError("defaultModels are required");
  const copy = (ref: ModelRef): ModelRef => {
    const value = ModelRefFactory.of(ref.name?.value ?? "", ref.revision?.value ?? "");
    Object.freeze(value.name);
    Object.freeze(value.revision);
    return Object.freeze(value);
  };
  return Object.freeze({
    ...(defaults.generation ? { generation: copy(defaults.generation) } : {}),
    ...(defaults.decision ? { decision: copy(defaults.decision) } : {}),
  });
};

/**
 * Retrieves active registry state without exposing it on the public class.
 * @param registry Factory-created registry.
 * @returns Internal mutable configuration state.
 */
const state = (registry: AiRegistry): RegistryState => {
  const found = registries.get(registry);
  if (!found) throw new TypeError("registry must come from AiRegistry.create");
  return found;
};

/**
 * Application registry configured before a context is built.
 */
export class AiRegistry {
  /**
   * Creates a registry only through the factory.
   */
  private constructor() {
    // Only create() may install the private registry state.
  }

  /**
   * Creates a validated application registry.
   * @param options Defaults, limits and queue bounds.
   * @returns Mutable configuration until context build.
   */
  static create(options: AiRegistryOptions): AiRegistry {
    const copy = Object.freeze({
      defaultModels: copyDefaults(options.defaultModels),
      invocationLimits: copyInvocationLimits(options.invocationLimits),
      concurrentOperations: positiveInteger(options.concurrentOperations, "concurrentOperations"),
      queuedOperations: positiveInteger(options.queuedOperations, "queuedOperations", true),
      hookTimeoutMs: positiveInteger(
        options.hookTimeoutMs ?? Math.min(5000, options.invocationLimits.deadlineMs),
        "hookTimeoutMs",
      ),
    });
    if (copy.hookTimeoutMs > copy.invocationLimits.deadlineMs)
      throw new TypeError("hookTimeoutMs cannot exceed invocation deadlineMs");
    const registry = new AiRegistry();
    registries.set(registry, {
      options: copy,
      backends: new Map(),
      tools: new Map(),
      frozen: false,
    });
    return registry;
  }

  /**
   * Registers one unique adapter deployment.
   * @param deployment Factory-created adapter registration.
   * @returns This registry for configuration chaining.
   */
  register(deployment: AiBackendRegistration): this {
    const current = state(this);
    if (current.frozen) throw new Error("AI registry is frozen");
    const definition = backendDefinition(deployment);
    const key = modelRefKey(definition.ref);
    if (current.backends.has(key)) throw new TypeError("Duplicate deployment reference");
    current.backends.set(key, deployment);
    return this;
  }

  /**
   * Registers one unique MCP server policy.
   * @param server Factory-created MCP configuration.
   * @returns This registry for configuration chaining.
   */
  registerTools(server: McpServerRegistration): this {
    const current = state(this);
    if (current.frozen) throw new Error("AI registry is frozen");
    const definition = mcpDefinition(server);
    if (current.tools.has(definition.id)) throw new TypeError("Duplicate MCP server ID");
    current.tools.set(definition.id, server);
    return this;
  }
}

/**
 * Sets registration to its immutable build state.
 * @param registry Application configuration.
 */
export const freezeRegistry = (registry: AiRegistry): void => {
  const current = state(registry);
  for (const kind of ["generation", "decision"] as const) {
    const ref = current.options.defaultModels[kind];
    if (!ref) continue;
    const registration = current.backends.get(modelRefKey(ref));
    if (registration?.kind !== kind)
      throw new TypeError(`${kind} default lacks a compatible registered deployment`);
  }
  current.frozen = true;
};

/**
 * Inputs for the per-kind selection precedence and repository allowlist.
 */
export interface AiSelection {
  /**
   * Declared generation or decision kind.
   */
  readonly kind: "generation" | "decision";

  /**
   * Registered application capabilities considered for selection.
   */
  readonly models: readonly AiModel<MessageSchema, MessageSchema>[];

  /**
   * Explicit model selected for this Agent instance.
   */
  readonly instancePreference?: ModelRef;

  /**
   * Repository model preference for this kind.
   */
  readonly repositoryDefault?: ModelRef;

  /**
   * Context model preference for this kind.
   */
  readonly contextDefault?: ModelRef;

  /**
   * Repository allowlist of permitted deployment references.
   */
  readonly allowedModels?: readonly ModelRef[];
}

/**
 * Resolves one deployment by Proto value and validates its capabilities.
 * @param registry Configured application registry.
 * @param selection Effective scope preferences and registered capabilities.
 * @returns Registered deployment selected for this invocation.
 */
export const selectDeployment = (
  registry: AiRegistry,
  selection: AiSelection,
): AiBackendRegistration => {
  const kind: unknown = selection.kind;
  if (kind !== "generation" && kind !== "decision")
    throw new TypeError("selection kind is unsupported");
  const current = state(registry);
  const ref =
    selection.instancePreference ??
    selection.repositoryDefault ??
    selection.contextDefault ??
    current.options.defaultModels[selection.kind];
  if (!ref) throw new TypeError(`${selection.kind} has no deployment default`);
  const key = modelRefKey(ref);
  if (
    selection.allowedModels &&
    !selection.allowedModels.some((allowed) => modelRefKey(allowed) === key)
  )
    throw new TypeError("Selected deployment is not allowed by repository");
  const registered = current.backends.get(key);
  if (registered?.kind !== selection.kind)
    throw new TypeError("Selected deployment is not registered for this kind");
  const models = selection.models.filter(
    (model) => isAiModel(model) && model.definition.kind === selection.kind,
  );
  if (
    models.length === 0 ||
    models.some((model) => !backendDefinition(registered).supports(model.definition))
  )
    throw new TypeError("Selected deployment lacks a registered capability");
  return registered;
};

/**
 * Returns frozen application options for internal runtime binding.
 * @param registry Application registry.
 * @returns Immutable configuration options.
 */
export const registryOptions = (registry: AiRegistry): Readonly<AiRegistryOptions> => {
  return state(registry).options;
};

/**
 * Finds a factory-created MCP registration by configured server ID.
 * @param registry Application configuration.
 * @param id Configured MCP server identifier.
 * @returns Registered server, or absence when the ID is not configured.
 */
export const mcpRegistration = (
  registry: AiRegistry,
  id: string,
): McpServerRegistration | undefined => state(registry).tools.get(id);

/**
 * Returns a frozen snapshot of configured MCP registrations.
 * @param registry Application configuration.
 * @returns Registrations in configuration order without the mutable registry map.
 */
export const mcpRegistrations = (registry: AiRegistry): readonly McpServerRegistration[] =>
  Object.freeze([...state(registry).tools.values()]);
