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

import type {
  Experimental_DecisionModelV4,
  Experimental_EvaluationModelV4,
} from "@ai-sdk/provider";
import type { AiConnectionIdentity, AiControl, AiScope } from "@spine-event-engine/ai";
import {
  createBackendRegistration,
  type AiBackendRegistration,
  type AiExecutionControl,
} from "@spine-event-engine/ai/spi/adapter";
import type { ModelRef } from "@spine-event-engine/ai";
import { createBoundedProviderFetch, type BoundedProviderFetch } from "./bounded-fetch.js";
import { scheduleBoundedDeadline } from "./deadline.js";
import type { StreamModel } from "./streamed-model.js";
import { executeGeneration } from "./generation.js";
import { executeDecision } from "./decision.js";

/**
 * Operation-scoped provider fetch supplied to a trusted connection callback.
 */
export interface VercelConnectControl extends AiControl {
  /**
   * Install as the provider's fetch; it cannot dispatch before an attempt is admitted.
   */
  readonly fetch: typeof globalThis.fetch;
}

/**
 * Versioned provider and transport behavior tested by this adapter.
 */
export interface VercelProviderCapabilities {
  /**
   * Versioned integration profile.
   */
  readonly id: "openai-responses-v1" | "openrouter-decisions-v1";

  /**
   * Exact route relative to the credential-free endpoint identity.
   */
  readonly routeSuffix: "/responses" | "/decisions";

  /**
   * Tested provider request and response protocol.
   */
  readonly providerProtocol: "openai-responses-stream-v1" | "openrouter-jev-decisions-v1";

  /**
   * Exact guarded-fetch accounting and route contract.
   */
  readonly boundedFetchRevision: "spine-bounded-fetch-v1";

  /**
   * Supported output-schema or decision-question lowering.
   */
  readonly outputContract: "native-json-or-prompt-validate-v1" | "typed-decision-v1";

  /**
   * Operation and ticket cancellation with a local callback deadline.
   */
  readonly cancellationContract: "ticket-abort-and-deadline-v1";

  /**
   * One physical provider call per durable attempt ticket, without SDK retries.
   */
  readonly retryContract: "one-provider-call-per-ticket-v1";
}

const openAIProfile = Object.freeze({
  id: "openai-responses-v1",
  routeSuffix: "/responses",
  providerProtocol: "openai-responses-stream-v1",
  boundedFetchRevision: "spine-bounded-fetch-v1",
  outputContract: "native-json-or-prompt-validate-v1",
  cancellationContract: "ticket-abort-and-deadline-v1",
  retryContract: "one-provider-call-per-ticket-v1",
} as const satisfies VercelProviderCapabilities);

const openRouterProfile = Object.freeze({
  id: "openrouter-decisions-v1",
  routeSuffix: "/decisions",
  providerProtocol: "openrouter-jev-decisions-v1",
  boundedFetchRevision: "spine-bounded-fetch-v1",
  outputContract: "typed-decision-v1",
  cancellationContract: "ticket-abort-and-deadline-v1",
  retryContract: "one-provider-call-per-ticket-v1",
} as const satisfies VercelProviderCapabilities);

/**
 * Rejects incomplete or altered capability declarations before registration.
 * @param actual Caller-supplied profile.
 * @param expected Adapter-tested protocol profile.
 */
const assertProfile = (
  actual: VercelProviderCapabilities,
  expected: VercelProviderCapabilities,
): void => {
  const keys = Object.keys(expected) as (keyof VercelProviderCapabilities)[];
  if (
    Object.keys(actual).length !== keys.length ||
    keys.some((key) => actual[key] !== expected[key])
  )
    throw new TypeError("Unsupported provider capabilities");
};

/**
 * Concrete provider model plus its verified credential-free identity.
 * @typeParam M Published provider model type.
 */
export interface VercelConnection<M> {
  /**
   * Provider model constructed with the supplied scoped fetch.
   */
  readonly model: M;

  /**
   * Identity associated with the trusted credential binding.
   */
  readonly identity: AiConnectionIdentity;
}

/**
 * Trusted callbacks for a selected provider deployment.
 * @typeParam M Published provider model type.
 */
export interface VercelModelOptions<M extends StreamModel | VercelDecisionModel> {
  /**
   * Credential-free application deployment reference.
   */
  readonly ref: ModelRef;

  /**
   * Versioned provider protocol supported by this adapter.
   */
  readonly capabilities: VercelProviderCapabilities;

  /**
   * Platform fetch, replaceable by a credential-free protocol fixture.
   */
  readonly platformFetch?: typeof globalThis.fetch;

  /**
   * Resolves authenticated provider/account/endpoint/model identity.
   * @param scope Authenticated signal scope.
   * @param control Runtime cancellation and deadline.
   * @returns Credential-free deployment identity.
   */
  readonly resolveIdentity: (
    scope: AiScope,
    control: AiControl,
  ) => AiConnectionIdentity | Promise<AiConnectionIdentity>;

  /**
   * Checks this scope's permission for the resolved deployment identity.
   * @param scope Authenticated signal scope.
   * @param identity Resolved deployment identity.
   * @param control Runtime cancellation and deadline.
   * @returns Whether the scope may use this deployment.
   */
  readonly authorizeUse: (
    scope: AiScope,
    identity: AiConnectionIdentity,
    control: AiControl,
  ) => boolean | Promise<boolean>;

  /**
   * Creates one operation-scoped model using the supplied guarded fetch.
   * @param scope Authenticated signal scope.
   * @param expected Authorized deployment identity.
   * @param control Scoped fetch, cancellation, and deadline.
   * @returns Provider model and matching credential-free identity.
   */
  readonly connect: (
    scope: AiScope,
    expected: AiConnectionIdentity,
    control: VercelConnectControl,
  ) => VercelConnection<M> | Promise<VercelConnection<M>>;
}

/**
 * Accepted V4 decision model or published OpenRouter evaluation compatibility model.
 */
// Published OpenRouter 3.1.0 implements the SDK's deprecated evaluation compatibility contract.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export type VercelDecisionModel = Experimental_DecisionModelV4 | Experimental_EvaluationModelV4;

/**
 * Opaque connection retrieved only by this adapter after runtime selection.
 * @typeParam M Published provider model type.
 */
export interface ProviderConnection<M> {
  /**
   * Provider model bound to this connection's guarded fetch.
   */
  readonly model: M;

  /**
   * Fetch gate admitting one durable attempt at a time.
   */
  readonly gate: BoundedProviderFetch;

  /**
   * Reads locally observed platform bytes for one attempt, if any are known.
   * @param ticketId Durable physical-attempt identity.
   * @returns Received byte count or undefined before a body receipt.
   */
  readonly receivedBytes: (ticketId: string) => number | undefined;
}

const connections = new WeakMap<object, ProviderConnection<StreamModel | VercelDecisionModel>>();

/**
 * Reads a model and gate previously created by this adapter.
 * @param handle Opaque selected model handle.
 * @returns Authenticated provider connection.
 */
export const providerConnection = (
  handle: unknown,
): ProviderConnection<StreamModel | VercelDecisionModel> => {
  const connection =
    typeof handle === "object" && handle !== null ? connections.get(handle) : undefined;
  if (!connection) throw new TypeError("Provider connection is not from this adapter");
  return connection;
};

/**
 * Requires the callback identity to match the earlier authorized identity.
 * @param expected Authenticated identity before provider construction.
 * @param actual Identity returned with the constructed provider.
 */
const checkIdentity = (expected: AiConnectionIdentity, actual: AiConnectionIdentity): void => {
  const candidate: unknown = actual;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    ["provider", "account", "endpoint", "model"].some(
      (field) =>
        actual[field as keyof AiConnectionIdentity] !==
        expected[field as keyof AiConnectionIdentity],
    )
  )
    throw new Error("Provider connection identity changed");
};

/**
 * Bounds a connection callback even when it ignores its AbortSignal.
 * @param pending Trusted model construction.
 * @param control Runtime cancellation and Time read.
 * @typeParam M Published provider model type.
 * @returns Constructed connection before deadline.
 */
const awaitConnection = async <M extends StreamModel | VercelDecisionModel>(
  pending: Promise<VercelConnection<M>>,
  control: AiExecutionControl,
) => {
  const remaining = control.deadlineEpochMs - control.nowEpochMs();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new Error("Connection deadline exceeded");
  let cancelTimer!: () => void;
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new Error("Connection cancelled"));
    };
    control.signal.addEventListener("abort", abort, { once: true });
    cancelTimer = scheduleBoundedDeadline(control.deadlineEpochMs, control.nowEpochMs, () => {
      reject(new Error("Connection deadline exceeded"));
    });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    cancelTimer();
    control.signal.removeEventListener("abort", abort);
  }
};

/**
 * Creates an inert fetch gate for the exact selected provider route.
 * @param options Trusted deployment callback settings.
 * @param expected Authorized credential-free identity.
 * @param control Runtime reservation and fence callbacks.
 * @param received Local physical body-byte receipts.
 * @typeParam M Published provider model type.
 * @returns Guarded fetch gate without network dispatch.
 */
const scopedGate = <M extends StreamModel | VercelDecisionModel>(
  options: VercelModelOptions<M>,
  expected: AiConnectionIdentity,
  control: AiExecutionControl,
  received: Map<string, number>,
): BoundedProviderFetch => {
  const endpoint = new URL(expected.endpoint);
  const route = `${endpoint.pathname.replace(/\/$/, "")}${options.capabilities.routeSuffix}`;
  const url = new URL(route, endpoint);
  return createBoundedProviderFetch({
    allowedUrls: [url.href],
    platformFetch: options.platformFetch ?? globalThis.fetch,
    hasAuthority: control.hasAuthority,
    nowEpochMs: control.nowEpochMs,
    reserve: control.reserveTransport,
    onReceived: (ticketId, bytes) => {
      received.set(ticketId, (received.get(ticketId) ?? 0) + bytes);
      control.onReceived(ticketId, bytes);
    },
  });
};

/**
 * Rejects a connection after operation cancellation or deadline expiry.
 * @param control Current operation controls.
 */
const assertConnectionActive = (control: AiExecutionControl): void => {
  if (control.signal.aborted || !control.hasAuthority()) throw new Error("Connection cancelled");
  const remaining = control.deadlineEpochMs - control.nowEpochMs();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new Error("Connection deadline exceeded");
};

/**
 * Constructs an inert scoped fetch and verifies the callback's connection identity.
 * @param options Trusted deployment callbacks.
 * @param scope Authenticated operation scope.
 * @param expected Previously authorized identity.
 * @param control Durable execution controls.
 * @typeParam M Published provider model type.
 * @returns Opaque model handle for the selected operation.
 */
const connect = async <M extends StreamModel | VercelDecisionModel>(
  options: VercelModelOptions<M>,
  scope: AiScope,
  expected: AiConnectionIdentity,
  control: AiExecutionControl,
) => {
  assertConnectionActive(control);
  const received = new Map<string, number>();
  const gate = scopedGate(options, expected, control, received);
  try {
    const result = await awaitConnection(
      Promise.resolve(
        options.connect(scope, expected, {
          signal: control.signal,
          deadlineEpochMs: control.deadlineEpochMs,
          fetch: gate.fetch,
        }),
      ),
      control,
    );
    checkIdentity(expected, result.identity);
    assertConnectionActive(control);
    const handle = Object.freeze({});
    connections.set(handle, {
      model: result.model,
      gate,
      receivedBytes: (ticketId) => received.get(ticketId),
    });
    return { model: handle, identity: result.identity };
  } catch (error) {
    gate.revoke();
    throw error;
  }
};

/**
 * Factory for tested OpenAI Responses generation connections.
 */
export const VercelAx = {
  /**
   * Tested generation provider capabilities.
   */
  capabilities: {
    /**
     * Returns the pinned OpenAI Responses protocol.
     * @returns Pinned Vercel OpenAI Responses streaming protocol profile.
     */
    openAIResponses: (): VercelProviderCapabilities => openAIProfile,
  },

  /**
   * Registers a trusted scoped Vercel generation deployment.
   * @param options Credential-free identity and guarded provider construction.
   * @returns Immutable SDK-free registration.
   */
  model(options: VercelModelOptions<StreamModel>): AiBackendRegistration {
    assertProfile(options.capabilities, openAIProfile);
    return createBackendRegistration({
      ref: options.ref,
      kind: "generation",
      supports: (definition) => definition.kind === "generation",
      resolveIdentity: options.resolveIdentity,
      authorizeUse: options.authorizeUse,
      connect: (scope, expected, control) => connect(options, scope, expected, control),
      execute: executeGeneration,
    });
  },
};

/**
 * Factory for tested OpenRouter Decisions connections.
 */
export const VercelDecision = {
  /**
   * Tested non-generative provider capabilities.
   */
  capabilities: {
    /**
     * Returns the pinned OpenRouter Jev protocol.
     * @returns Pinned OpenRouter Decisions evaluation protocol profile.
     */
    openRouterJev: (): VercelProviderCapabilities => openRouterProfile,
  },

  /**
   * Registers a trusted non-generative decision deployment.
   * @param options Credential-free identity and guarded provider construction.
   * @returns Immutable SDK-free registration.
   */
  model(options: VercelModelOptions<VercelDecisionModel>): AiBackendRegistration {
    assertProfile(options.capabilities, openRouterProfile);
    return createBackendRegistration({
      ref: options.ref,
      kind: "decision",
      supports: (definition) => definition.kind === "decision",
      resolveIdentity: options.resolveIdentity,
      authorizeUse: options.authorizeUse,
      connect: (scope, expected, control) => connect(options, scope, expected, control),
      execute: executeDecision,
    });
  },
};
