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
import type { AiConnectionIdentity, AiControl, AiModelDefinition, AiScope } from "./contracts.js";
import { modelRefKey, nonblank } from "./model.js";

const aiBackendBrand: unique symbol = Symbol("SpineAiBackend");
const backendDefinitions = new WeakMap<object, AiBackendDefinition>();

/**
 * Adapter-created deployment admitted to an application registry.
 */
export interface AiBackendRegistration {
  /**
   * Private marker carried only by an adapter-created backend registration.
   */
  readonly [aiBackendBrand]: true;

  /**
   * Credential-free deployment reference.
   */
  readonly ref: ModelRef;

  /**
   * Declared generation or decision kind.
   */
  readonly kind: "generation" | "decision";
}

/**
 * SDK-free adapter registration boundary used by optional integrations.
 */
export interface AiBackendDefinition {
  /**
   * Credential-free deployment reference.
   */
  readonly ref: ModelRef;

  /**
   * Declared generation or decision kind.
   */
  readonly kind: "generation" | "decision";

  /**
   * Checks whether a deployment supports the declared capability.
   *
   * @param definition Typed capability requested by this registration.
   * @returns Whether the deployment can perform the capability.
   */
  readonly supports: (
    definition: Readonly<AiModelDefinition<MessageSchema, MessageSchema>>,
  ) => boolean;

  /**
   * Resolves the credential-free identity before dispatch.
   *
   * @param scope Authenticated application scope.
   * @param control Deadline and cancellation controls.
   * @returns Credential-free backend identity.
   */
  resolveIdentity(
    scope: AiScope,
    control: AiControl,
  ): AiConnectionIdentity | Promise<AiConnectionIdentity>;

  /**
   * Checks authorization for one use of the resolved backend identity.
   *
   * @param scope Authenticated application scope.
   * @param identity Resolved backend identity.
   * @param control Deadline and cancellation controls.
   * @returns Whether the backend use is authorized.
   */
  authorizeUse(
    scope: AiScope,
    identity: AiConnectionIdentity,
    control: AiControl,
  ): boolean | Promise<boolean>;

  /**
   * Connects after identity and policy checks.
   *
   * @param scope Authenticated application scope.
   * @param expectedIdentity Previously resolved backend identity.
   * @param control Deadline and cancellation controls.
   * @returns Opaque model and checked connection identity.
   */
  connect(
    scope: AiScope,
    expectedIdentity: AiConnectionIdentity,
    control: AiControl,
  ):
    | { readonly model: unknown; readonly identity: AiConnectionIdentity }
    | Promise<{ readonly model: unknown; readonly identity: AiConnectionIdentity }>;
}

/**
 * Creates a factory-proven deployment for the optional adapter.
 * @param definition Static capability and trusted connection callbacks.
 * @returns Immutable registration.
 */
export const createBackendRegistration = (
  definition: AiBackendDefinition,
): AiBackendRegistration => {
  modelRefKey(definition.ref);
  const kind: unknown = definition.kind;
  if (kind !== "generation" && kind !== "decision")
    throw new TypeError("backend kind is unsupported");
  for (const name of ["supports", "resolveIdentity", "authorizeUse", "connect"] as const)
    if (typeof definition[name] !== "function") throw new TypeError(`${name} callback is required`);
  const ref = Object.freeze({
    ...definition.ref,
    name: Object.freeze({
      ...definition.ref.name,
      value: nonblank(definition.ref.name?.value ?? "", "name"),
    }),
    revision: Object.freeze({
      ...definition.ref.revision,
      value: nonblank(definition.ref.revision?.value ?? "", "revision"),
    }),
  }) as ModelRef;
  const registration = Object.freeze({
    [aiBackendBrand]: true as const,
    ref,
    kind: definition.kind,
  });
  backendDefinitions.set(registration, Object.freeze({ ...definition, ref }));
  return registration;
};

/**
 * Reads the original adapter definition after runtime provenance validation.
 * @param registration Candidate registration.
 * @returns Frozen adapter callbacks and reference.
 */
export const backendDefinition = (registration: AiBackendRegistration): AiBackendDefinition => {
  const candidate: unknown = registration;
  const definition =
    typeof candidate === "object" && candidate !== null
      ? backendDefinitions.get(candidate)
      : undefined;
  if (!definition) throw new TypeError("backend registration must come from a factory");
  return definition;
};
