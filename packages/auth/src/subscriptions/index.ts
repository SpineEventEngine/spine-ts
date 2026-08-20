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

import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS } from "@spine-event-engine/core/internal/subscription-lifecycle";
import { ActorContextSchema, TenantIdSchema, type ActorContext } from "@spine-event-engine/proto";
import {
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import type { ILogLayer } from "loglayer";
import type {
  AuthorizationPolicy,
  Clock,
  ContextResolver,
  IncomingRequest,
  RequestCredential,
  SessionResolver,
  TransportRequestContext,
} from "../index.js";
import { IncomingRequests } from "../request/index.js";

declare const setTimeout: (callback: () => void, milliseconds: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

type BindingState = "inactive" | "active" | "cancelling" | "closed";
interface Binding {
  readonly definition: Uint8Array;
  readonly context: ActorContext;
  readonly expiresAtMs: number | undefined;
  state: BindingState;
  controller: AbortController;
  tail: Promise<void>;
  effectTail: Promise<void>;
  pending: number;
  expiring: boolean;
  cancelRequested: boolean;
}

/**
 * Owned raw Topic protobuf bytes for the `SubscriptionService.Subscribe` RPC. The gateway copies them on admission.
 */
export interface SubscriptionTopicWire {
  // prettier-ignore

  /**
   * Identifies raw bytes as a subscription topic.
   */
  readonly kind: "subscription-topic";

  /**
   * Carries the owned serialized topic.
   */
  readonly bytes: Uint8Array;
}

/**
 * Owned raw Subscription protobuf bytes for the public Activate and Cancel RPCs.
 * The gateway copies them on admission.
 */
export interface PublicSubscriptionWire {
  // prettier-ignore

  /**
   * Identifies raw bytes as a public subscription.
   */
  readonly kind: "public-subscription";

  /**
   * Carries the owned serialized subscription.
   */
  readonly bytes: Uint8Array;
}

/**
 * Owned serialized public update bytes admitted by the B4 relay.
 */
export interface SubscriptionUpdateWire {
  // prettier-ignore

  /**
   * Identifies raw bytes as a public update.
   */
  readonly kind: "subscription-update";

  /**
   * Carries the owned serialized update.
   */
  readonly bytes: Uint8Array;
}

/**
 * Delivers one public update to an asynchronous stream.
 * @param update Supplies the copied public update.
 * @returns Completes after the update is handled.
 */
export type SubscriptionUpdateSink = (update: SubscriptionUpdateWire) => Promise<void>;

/**
 * Trusted-infrastructure-only raw backend envelope.
 * It is never returned in a gateway result or decoded browser result.
 */
export interface BackendSubscriptionEnvelope {
  // prettier-ignore

  /**
   * Identifies raw bytes as a trusted backend envelope.
   */
  readonly kind: "backend-subscription-envelope";

  /**
   * Carries the owned serialized backend envelope.
   */
  readonly bytes: Uint8Array;
}

/**
 * Standard event-capable cancellation signal supplied to every backend callback.
 */
export type SubscriptionAbortSignal = AbortSignal;

/**
 * Processes a fresh canonical subscription definition copy.
 *
 * @param definition Supplies the copied canonical subscription definition.
 * @param signal Cancels the backend effect.
 * @returns Completes after the backend effect ends.
 */
export type OnSubscriptionDefinition = (
  definition: PublicSubscriptionWire,
  signal: SubscriptionAbortSignal,
) => Promise<void>;

/**
 * Opaque result of an ownership transition.
 */
export interface SubscriptionBindingTransition {
  // prettier-ignore

  /**
   * Identifies the ownership transition outcome.
   */
  readonly kind: "activated" | "closed" | "denied";
}
type SubscriptionOperation = "subscribe" | "activate" | "cancel";
interface PreparedOperation {
  readonly source: Extract<IncomingRequest, { readonly kind: SubscriptionOperation }>;
  readonly context: ActorContext;
  readonly expiresAtMs: number | undefined;
  readonly nowMs: number;
}

/**
 * Finite B3 ownership limits. Every supplied value must be a positive safe integer.
 */
export interface SubscriptionGatewayLimits {
  // prettier-ignore

  /**
   * Limits admitted public request bytes.
   */
  readonly maxRequestBytes?: number;

  /**
   * Limits each ephemeral native backend envelope.
   */
  readonly maxBackendEnvelopeBytes?: number;

  /**
   * Limits queued work per binding.
   */
  readonly pendingOperationLimit?: number;

  /**
   * Limits finite backend operations and setup in milliseconds; it never limits an acknowledged active callback.
   */
  readonly operationTimeoutMs?: number;

  /**
   * Limits shutdown cleanup duration in milliseconds.
   */
  readonly shutdownTimeoutMs?: number;
}
const defaultLimits: Required<SubscriptionGatewayLimits> = {
  maxRequestBytes: 1_048_576,
  maxBackendEnvelopeBytes: 1_048_576,
  pendingOperationLimit: 1,
  operationTimeoutMs: 30_000,
  shutdownTimeoutMs: 1_000,
};

/**
 * Trusted infrastructure store for logical subscription ownership. Results expose only transition state;
 * canonical definitions enter at creation and reach only the gateway-supplied transition callback as copies.
 */
export interface SubscriptionBindings {
  // prettier-ignore

  /**
   * Creates and retains an inactive canonical subscription from a trusted topic.
   * @param input Supplies the rewritten trusted topic and expiry.
   * @returns Returns the retained public subscription wire.
   */
  create(input: {
    readonly topic: SubscriptionTopicWire;
    readonly whenExpires?: number;
  }): Promise<PublicSubscriptionWire>;

  /**
   * Activates an owned logical binding.
   * @param input Supplies trusted context and the definition callback.
   * @returns Returns the ownership transition outcome.
   */
  activate(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
    readonly onDefinition: OnSubscriptionDefinition;

    /**
     * Active-effect cancellation signal. A pre-aborted signal starts no backend work.
     */
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition>;

  /**
   * Cancels an owned logical binding.
   * @param input Supplies ownership facts and the definition callback.
   * @returns Returns the ownership transition outcome.
   */
  cancel(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
    readonly onDefinition: OnSubscriptionDefinition;
  }): Promise<SubscriptionBindingTransition>;

  /**
   * Removes bindings expired at the supplied time.
   * @param nowMs Supplies the current time in milliseconds.
   * @returns Completes after expired bindings are removed.
   */
  purgeExpired(nowMs: number): Promise<void>;

  /**
   * Restores active durable definitions after a Gateway restart when supported.
   *
   * Implementations without durable storage may omit this operation.
   *
   * @param input Supplies the restart time and logical-definition callback.
   * @returns Completes after the bounded recovery pass.
   */
  recoverActive?(input: {
    readonly nowMs: number;

    /**
     * Restores one definition and its expiry.
     *
     * @param definition Supplies the retained public subscription.
     * @param whenExpires Supplies its expiry in epoch milliseconds.
     * @returns Completes after the definition is restored.
     */
    readonly onDefinition: (
      definition: PublicSubscriptionWire,
      whenExpires: number,
    ) => Promise<void>;
  }): Promise<void>;

  /**
   * Closes all retained bindings.
   * @returns Completes after retained bindings close.
   */
  close(): Promise<void>;
}

/**
 * In-memory reference store. It serializes transitions, copies all ingress/egress bytes, and makes close terminal.
 */
export class InMemorySubscriptionBindings implements SubscriptionBindings {
  readonly #bindings = new Map<string, Binding>();
  readonly #nextId: () => string;
  readonly #disposeCallback: OnSubscriptionDefinition;
  #closed = false;
  readonly #limits: Required<SubscriptionGatewayLimits>;

  /**
   * Creates the in-memory binding store.
   * @param options Supplies identifiers, process limits, and disposal behavior.
   */
  constructor(options: {
    readonly nextId: () => string;
    readonly limits?: SubscriptionGatewayLimits;
    readonly dispose: OnSubscriptionDefinition;
  }) {
    this.#nextId = options.nextId;
    this.#limits = SubscriptionGatewayValues.limits(options.limits);
    this.#disposeCallback = options.dispose;
  }

  /**
   * Returns the number of retained private bindings for lifecycle observability.
   * @returns Returns the retained binding count.
   */
  get size(): number {
    return this.#bindings.size;
  }

  /**
   * Removes already-expired logical bindings without a background timer.
   * @param nowMs Supplies the current time in milliseconds.
   * @returns Completes after expired envelopes are removed.
   */
  purgeExpired(nowMs: number): Promise<void> {
    for (const [id, binding] of this.#bindings)
      if (binding.expiresAtMs !== undefined && binding.expiresAtMs <= nowMs)
        this.#expire(id, binding);
    return Promise.resolve();
  }

  /**
   * Closes the store by aborting work and waiting for bounded cleanup.
   *
   * Cooperative callbacks allow cleanup to complete before this method resolves.
   * Non-cooperative raw callbacks cause an `AggregateError` after
   * `shutdownTimeoutMs`; their exactly-once disposal remains queued until they
   * settle.
   *
   * @returns Completes after bounded cooperative cleanup, or rejects with an
   * `AggregateError` when cleanup exceeds its shutdown limit.
   */
  async close(): Promise<void> {
    this.#closed = true;
    const closing = [...this.#bindings.entries()];
    for (const [, binding] of closing) binding.controller.abort();
    const results = await Promise.allSettled(
      closing.map(([id, binding]) => this.#waitForShutdown(this.#disposeAfterWork(id, binding))),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result): unknown => result.reason);
    if (failures.length > 0)
      throw new AggregateError(failures, "subscription shutdown cleanup failed");
  }

  /**
   * Creates an inactive binding from a trusted rewritten topic.
   * @param input Supplies the topic and expiry.
   * @returns Returns the retained public subscription wire.
   */
  create(input: {
    readonly topic: SubscriptionTopicWire;
    readonly whenExpires?: number;
  }): Promise<PublicSubscriptionWire> {
    try {
      if (this.#closed) throw new Error("subscription bindings are closed");
      const id = this.#nextId();
      if (id.length === 0 || this.#bindings.has(id))
        throw new Error("subscription ID must be unique");
      const topic = fromBinary(TopicSchema, input.topic.bytes);
      if (topic.context === undefined) throw new Error("subscription topic has no trusted context");
      const wire = SubscriptionGatewayValues.subscribed(id, input.topic.bytes);
      if (wire.kind !== "subscribed") throw new Error("subscription wire creation failed");
      this.#bindings.set(id, {
        definition: wire.wire.bytes.slice(),
        context: clone(ActorContextSchema, topic.context),
        expiresAtMs: input.whenExpires,
        state: "inactive",
        controller: new AbortController(),
        tail: Promise.resolve(),
        effectTail: Promise.resolve(),
        pending: 0,
        expiring: false,
        cancelRequested: false,
      });
      return Promise.resolve(SubscriptionGatewayValues.copyPublic(wire.wire));
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("subscription binding creation failed"),
      );
    }
  }

  /**
   * Activates only an owned inactive binding and restores retry state after callback failure.
   * @param input Supplies ownership facts and the backend callback.
   * @returns Returns the ownership transition outcome.
   */
  async activate(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
    readonly onDefinition: OnSubscriptionDefinition;
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition> {
    if (input.signal.aborted) return { kind: "denied" };
    if (this.#precheck(input) !== "owned") return { kind: "denied" };
    return this.#coordinate(input.id, async () => {
      const binding = await this.#owned(input);
      if (input.signal.aborted || binding?.state !== "inactive") return { kind: "denied" };
      binding.state = "active";
      binding.controller = new AbortController();
      const abort = () => {
        binding.controller.abort();
      };
      input.signal.addEventListener("abort", abort, { once: true });
      try {
        await this.#runActiveEffect(binding, input.onDefinition);
      } catch (error) {
        if (binding.cancelRequested) return { kind: "activated" };
        binding.state = "inactive";
        throw error;
      } finally {
        input.signal.removeEventListener("abort", abort);
      }
      return { kind: "activated" };
    });
  }

  /**
   * Cancels an owned binding and retains retry state after failed cleanup.
   * @param input Supplies ownership facts and the backend callback.
   * @returns Returns the ownership transition outcome.
   */
  async cancel(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
    readonly onDefinition: OnSubscriptionDefinition;
  }): Promise<SubscriptionBindingTransition> {
    const admission = this.#precheck(input);
    if (admission === "absent") return { kind: "closed" };
    if (admission !== "owned") return { kind: "denied" };
    const active = this.#bindings.get(input.id);
    if (active?.state === "active") {
      active.cancelRequested = true;
      active.controller.abort();
    }
    return this.#coordinate(input.id, async () => {
      const binding = await this.#owned(input);
      if (binding === undefined) return { kind: "closed" };
      if (binding.state === "closed") return { kind: "closed" };
      binding.state = "cancelling";
      binding.controller = new AbortController();
      await this.#runEffect(binding, input.onDefinition);
      this.#dispose(input.id, binding);
      return { kind: "closed" };
    });
  }
  #owned(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
  }): Promise<Binding | undefined> {
    const binding = this.#bindings.get(input.id);
    if (binding === undefined) return Promise.resolve(undefined);
    if (binding.expiresAtMs !== undefined && binding.expiresAtMs <= input.nowMs) {
      this.#expire(input.id, binding);
      return Promise.resolve(undefined);
    }
    return SubscriptionGatewayValues.contextsEqual(binding.context, input.context)
      ? Promise.resolve(binding)
      : Promise.resolve(undefined);
  }
  #precheck(input: {
    readonly id: string;
    readonly context: ActorContext;
    readonly nowMs: number;
  }): "owned" | "absent" | "denied" {
    const binding = this.#bindings.get(input.id);
    if (binding === undefined) return "absent";
    if (!SubscriptionGatewayValues.contextsEqual(binding.context, input.context)) return "denied";
    if (
      binding.expiring ||
      (binding.expiresAtMs !== undefined && binding.expiresAtMs <= input.nowMs)
    ) {
      this.#expire(input.id, binding);
      return "denied";
    }
    return "owned";
  }
  #expire(id: string, binding: Binding): void {
    if (binding.expiring || this.#bindings.get(id) !== binding) return;
    binding.expiring = true;
    binding.controller.abort();
    // spine-log-boundary: auth.subscription_expiry_cleanup
    void this.#disposeAfterWork(id, binding).catch(() => undefined);
  }
  #dispose(id: string, binding: Binding): void {
    binding.definition.fill(0);
    binding.state = "closed";
    this.#bindings.delete(id);
  }
  async #runEffect(binding: Binding, callback: OnSubscriptionDefinition): Promise<void> {
    const effect = this.#startEffect(binding, callback);
    await SubscriptionGatewayValues.withTimeout(
      effect,
      this.#limits.operationTimeoutMs,
      binding.controller,
    );
  }
  async #runActiveEffect(binding: Binding, callback: OnSubscriptionDefinition): Promise<void> {
    let observeAbort = () => undefined;
    const aborted = new Promise<"aborted">((resolve) => {
      observeAbort = () => {
        resolve("aborted");
      };
      binding.controller.signal.addEventListener("abort", observeAbort, { once: true });
    });
    try {
      if (binding.controller.signal.aborted) throw new Error("subscription operation aborted");
      const effect = this.#startEffect(binding, callback);
      const result = await Promise.race([effect.then(() => "settled" as const), aborted]);
      if (result === "settled" || binding.cancelRequested) return;
    } finally {
      binding.controller.signal.removeEventListener("abort", observeAbort);
    }
    throw new Error("subscription operation aborted");
  }
  #startEffect(binding: Binding, callback: OnSubscriptionDefinition): Promise<void> {
    const definition = SubscriptionGatewayValues.copyPublic({
      kind: "public-subscription",
      bytes: binding.definition,
    });
    let effect: Promise<void>;
    try {
      effect = Promise.resolve(callback(definition, binding.controller.signal));
    } catch (error) {
      effect = Promise.reject(
        error instanceof Error
          ? error
          : new Error("Subscription backend callback threw a non-Error value.", { cause: error }),
      );
    }
    // spine-log-boundary: auth.subscription_effect_settlement
    const settled = effect.then(
      () => undefined,
      () => undefined,
    );
    binding.effectTail = binding.effectTail.then(() => settled);
    void settled.then(() => definition.bytes.fill(0));
    return effect;
  }
  #disposeAfterWork(id: string, binding: Binding): Promise<void> {
    const cleanup = binding.tail
      .then(() => binding.effectTail)
      .then(() => this.#disposeWithCallback(id, binding));
    // spine-log-boundary: auth.subscription_cleanup_tail
    binding.tail = cleanup.catch(() => undefined);
    // spine-log-boundary: auth.subscription_cleanup_observer
    void cleanup.catch(() => undefined);
    return cleanup;
  }
  #waitForShutdown(cleanup: Promise<void>): Promise<void> {
    return SubscriptionGatewayValues.withTimeout(
      cleanup,
      this.#limits.shutdownTimeoutMs,
      new AbortController(),
    );
  }
  async #disposeWithCallback(id: string, binding: Binding): Promise<void> {
    if (this.#bindings.get(id) !== binding) return;
    const definition = SubscriptionGatewayValues.copyPublic({
      kind: "public-subscription",
      bytes: binding.definition,
    });
    this.#dispose(id, binding);
    const controller = new AbortController();
    try {
      await SubscriptionGatewayValues.withTimeout(
        this.#disposeCallback(definition, controller.signal),
        this.#limits.shutdownTimeoutMs,
        controller,
      );
    } finally {
      definition.bytes.fill(0);
    }
  }
  async #coordinate<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const binding = this.#bindings.get(id);
    if (binding === undefined) return operation();
    if (binding.pending > this.#limits.pendingOperationLimit) throw new Error("binding-busy");
    binding.pending++;
    const previous = binding.tail;
    let release: () => void = () => undefined;
    binding.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (this.#closed) throw new Error("subscription bindings are closed");
      return await operation();
    } finally {
      binding.pending--;
      release();
    }
  }
}

/**
 * Admission input for one of the three SubscriptionService RPCs.
 * `wire` is copied immediately and credential is never forwarded.
 */
export interface SubscriptionGatewayRequest {
  // prettier-ignore

  /**
   * Identifies the receiving RPC service.
   */
  readonly service: string;

  /**
   * Identifies the invoked RPC method.
   */
  readonly method: string;

  /**
   * Carries copied public request bytes.
   */
  readonly wire: SubscriptionTopicWire | PublicSubscriptionWire;

  /**
   * Carries the credential used for this admission.
   */
  readonly credential?: RequestCredential | undefined;

  /**
   * Carries allowlisted transport facts.
   */
  readonly transport: TransportRequestContext;

  /**
   * B4 public update admission seam; ignored for Subscribe and Cancel.
   */
  readonly updates?: SubscriptionUpdateSink;

  /**
   * B4 downstream cancellation signal, copied only as a control capability.
   */
  readonly signal?: AbortSignal;
}

/**
 * B4-mappable backend seam.
 * It receives copied wire values and requires cleanup of every backend subscription.
 */
export interface SubscriptionCreator {
  // prettier-ignore

  /**
   * Creates one per-node native subscription.
   * @param request Supplies the copied canonical subscription definition.
   * @param signal Cancels the backend operation.
   * @returns Returns the trusted backend envelope.
   */
  subscribe(
    request: PublicSubscriptionWire,
    signal: SubscriptionAbortSignal,
  ): Promise<BackendSubscriptionEnvelope>;

  /**
   * Activates a backend subscription.
   * @param request Supplies the copied private backend envelope and update sink.
   * @param signal Cancels the backend operation.
   * @returns Completes after activation ends.
   */
  activate(
    request: {
      readonly wire: BackendSubscriptionEnvelope;
      readonly updates: SubscriptionUpdateSink;
    },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;

  /**
   * Cancels a backend subscription.
   * @param request Supplies copied canonical subscription bytes.
   * @param signal Cancels the backend operation.
   * @returns Completes after cancellation ends.
   */
  cancel(
    request: { readonly wire: PublicSubscriptionWire },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;

  /**
   * Removes one per-node native subscription.
   * @param envelope Supplies the copied backend envelope.
   * @param signal Cancels the backend operation.
   * @returns Completes after disposal ends.
   */
  dispose(envelope: BackendSubscriptionEnvelope, signal: SubscriptionAbortSignal): Promise<void>;
}

/**
 * Coordinates one logical public subscription without retaining native child envelopes.
 *
 * A coordinator may fan one definition out to several native application nodes. It
 * compensates any partially created native children before it rejects creation.
 */
export interface SubscriptionCoordinator {
  // Creation finishes before a browser activation starts native update streams.

  /**
   * Creates every current native child for a logical definition.
   *
   * @param request Supplies the copied canonical definition.
   * @param signal Cancels logical creation.
   * @param maxBackendEnvelopeBytes Limits each native child envelope.
   * @returns Completes only after all current children are installed.
   */
  subscribe(
    request: PublicSubscriptionWire,
    signal: SubscriptionAbortSignal,
    maxBackendEnvelopeBytes: number,
  ): Promise<void>;

  /**
   * Activates the native children and relays their updates until cancellation.
   *
   * @param request Supplies the definition and update sink.
   * @param signal Cancels the active logical subscription.
   * @returns Completes after activation ends.
   */
  activate(
    request: { readonly wire: PublicSubscriptionWire; readonly updates: SubscriptionUpdateSink },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;

  /**
   * Cancels every native child for one logical definition.
   *
   * @param request Supplies the definition to cancel.
   * @param signal Cancels the cleanup operation.
   * @returns Completes after child cleanup settles.
   */
  cancel(
    request: { readonly wire: PublicSubscriptionWire },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;
}

/**
 * Collaborators for independently authenticated and authorized subscription operations.
 */
export interface SubscriptionGatewayOptions {
  // prettier-ignore

  /**
   * Stores opaque subscription ownership bindings.
   */
  readonly bindings: SubscriptionBindings;

  /**
   * Resolves credential sessions.
   */
  readonly sessions?: SessionResolver;

  /**
   * Admits requests with the framework-owned public principal and no session expiry.
   * This mode is mutually exclusive with sessions.
   */
  readonly publicAccess?: true;

  /**
   * Authorizes each resolved request.
   */
  readonly authorize: AuthorizationPolicy["authorize"];

  /**
   * Resolves trusted actor contexts.
   */
  readonly contexts: ContextResolver;

  /**
   * Supplies trusted timestamps.
   */
  readonly clock: Clock;

  /**
   * Coordinates logical subscriptions across the current native membership.
   */
  readonly creator: SubscriptionCoordinator;

  /**
   * Overrides finite gateway limits.
   */
  readonly limits?: SubscriptionGatewayLimits;

  /**
   * Application-owned logger reserved for component-local records. The component
   * does not retain or close the supplied logger.
   */
  readonly logger?: ILogLayer;
}

/**
 * Opaque browser-facing operation result.
 * Only subscribed contains a copied public Subscription wire, never backend bytes.
 */
export type SubscriptionGatewayResult =
  | {
      // prettier-ignore

      /**
       * Identifies successful subscription creation.
       */ readonly kind: "subscribed";

      /**
       * Carries copied public subscription bytes.
       */ readonly wire: PublicSubscriptionWire;
    }
  | {
      // prettier-ignore

      /**
       * Identifies successful activation.
       */
      readonly kind: "activated";
    }
  | {
      // prettier-ignore

      /**
       * Identifies successful cancellation.
       */
      readonly kind: "cancelled";
    }
  | {
      // prettier-ignore

      /**
       * Identifies a rejected operation.
       */
      readonly kind: "rejected";

      /**
       * Explains why the operation was rejected.
       */
      readonly reason:
        | "unknown-operation"
        | "malformed-request"
        | "unauthenticated"
        | "forbidden"
        | "denied"
        | "request-too-large"
        | "backend-envelope-too-large"
        | "binding-busy";
    };

/**
 * B3 gateway.
 * It serializes operations, admits one transport snapshot, and never reveals backend envelopes.
 */
export class SubscriptionGateway {
  readonly #options: SubscriptionGatewayOptions;
  readonly #limits: Required<SubscriptionGatewayLimits>;
  readonly #expiryTimers = new Set<unknown>();
  readonly #publicPendingTimers = new Map<string, unknown>();
  #closed = false;

  /**
   * Creates the subscription gateway.
   * @param options Supplies authenticated gateway collaborators.
   */
  constructor(options: SubscriptionGatewayOptions) {
    if ((options.sessions === undefined) === (options.publicAccess !== true))
      throw new Error("Subscription gateway requires exactly one of sessions or publicAccess.");
    this.#options = options;
    this.#limits = SubscriptionGatewayValues.limits(options.limits);
  }

  /**
   * Handles one authenticated subscription RPC request.
   * @param request Supplies the copied request admission facts.
   * @returns Returns the opaque operation result.
   */
  async handle(request: SubscriptionGatewayRequest): Promise<SubscriptionGatewayResult> {
    if (this.#closed) return SubscriptionGatewayValues.rejected("denied");
    const admitted = SubscriptionGatewayValues.admit(request, this.#limits);
    if (admitted === undefined) return SubscriptionGatewayValues.rejected("request-too-large");
    try {
      return await this.#handleOperation(admitted);
    } finally {
      admitted.wire.bytes.fill(0);
    }
  }

  /**
   * Closes admission and closes retained bindings.
   * @returns Completes after retained bindings close.
   */
  async close(): Promise<void> {
    this.#closed = true;
    for (const timer of this.#expiryTimers) clearTimeout(timer);
    this.#expiryTimers.clear();
    for (const timer of this.#publicPendingTimers.values()) clearTimeout(timer);
    this.#publicPendingTimers.clear();
    await this.#options.bindings.close();
  }

  /**
   * Schedules finite local expiry cleanup for a recovered durable definition.
   * @param whenExpires Supplies the retained expiry in epoch milliseconds.
   */
  scheduleExpiry(whenExpires: number): void {
    const nowMs = this.#nowMs();
    if (nowMs === undefined || this.#closed) return;
    const timer = setTimeout(
      () => {
        this.#expiryTimers.delete(timer);
        // spine-log-boundary: auth.subscription_timer_purge
        void this.#options.bindings.purgeExpired(whenExpires).catch(() => undefined);
      },
      Math.max(0, whenExpires - nowMs),
    );
    this.#expiryTimers.add(timer);
  }
  async #handleOperation(request: SubscriptionGatewayRequest): Promise<SubscriptionGatewayResult> {
    const kind = SubscriptionGatewayValues.operationFor(request);
    if (kind === undefined) return SubscriptionGatewayValues.rejected("unknown-operation");
    const nowMs = this.#nowMs();
    if (nowMs === undefined) return SubscriptionGatewayValues.rejected("denied");
    try {
      await this.#options.bindings.purgeExpired(nowMs);
    } catch (error) {
      if (error instanceof Error && error.message === "binding-busy")
        return SubscriptionGatewayValues.rejected("binding-busy");
      throw error;
    }
    const prepared = await this.#prepareSecurity(kind, request);
    if ("kind" in prepared) return prepared;
    return this.#perform(prepared, request.updates, request.signal);
  }
  async #prepareSecurity(
    kind: SubscriptionOperation,
    request: SubscriptionGatewayRequest,
  ): Promise<PreparedOperation | SubscriptionGatewayResult> {
    const source = SubscriptionGatewayValues.decode(kind, request.wire.bytes, request.transport);
    if (source === undefined) return SubscriptionGatewayValues.rejected("malformed-request");
    const session =
      this.#options.publicAccess === true
        ? { principal: SubscriptionGatewayValues.publicPrincipal }
        : request.credential === undefined
          ? undefined
          : await this.#options.sessions?.resolve(request.credential);
    if (session === undefined) return SubscriptionGatewayValues.rejected("unauthenticated");
    const authorization = SubscriptionGatewayValues.decode(
      kind,
      request.wire.bytes,
      request.transport,
    );
    if (
      authorization === undefined ||
      !(await this.#options.authorize(session.principal, authorization))
    )
      return SubscriptionGatewayValues.rejected("forbidden");
    return this.#resolveTrusted(kind, request, source, session);
  }
  async #resolveTrusted(
    kind: SubscriptionOperation,
    request: SubscriptionGatewayRequest,
    source: Extract<IncomingRequest, { readonly kind: SubscriptionOperation }>,
    session: {
      readonly principal: Parameters<AuthorizationPolicy["authorize"]>[0];
      readonly expiresAt?: { readonly seconds: bigint; readonly nanos: number };
    },
  ): Promise<PreparedOperation | SubscriptionGatewayResult> {
    const contextRequest = SubscriptionGatewayValues.decode(
      kind,
      request.wire.bytes,
      request.transport,
    );
    if (contextRequest === undefined)
      return SubscriptionGatewayValues.rejected("malformed-request");
    const context = SubscriptionGatewayValues.trustedContext(
      await this.#options.contexts.resolve(session.principal, contextRequest, this.#options.clock),
    );
    const nowMs = this.#nowMs();
    const expiresAtMs =
      session.expiresAt === undefined
        ? undefined
        : SubscriptionGatewayValues.timestampMs(session.expiresAt.seconds, session.expiresAt.nanos);
    if (
      nowMs === undefined ||
      (this.#options.publicAccess !== true && expiresAtMs === undefined) ||
      (expiresAtMs !== undefined && expiresAtMs <= nowMs) ||
      !SubscriptionGatewayValues.matches(source.requestedContext, context)
    )
      return SubscriptionGatewayValues.rejected("denied");
    return {
      source,
      context,
      expiresAtMs,
      nowMs,
    };
  }
  #nowMs(): number | undefined {
    const now = this.#options.clock.now();
    return SubscriptionGatewayValues.timestampMs(now.seconds, now.nanos);
  }
  async #perform(
    prepared: PreparedOperation,
    updates: SubscriptionUpdateSink | undefined,
    signal: AbortSignal | undefined,
  ): Promise<SubscriptionGatewayResult> {
    const { source, context, expiresAtMs, nowMs } = prepared;
    const rewritten = SubscriptionGatewayValues.rewrite(source, context);
    if (source.kind === "subscribe") return this.#subscribe(rewritten, context, expiresAtMs);
    const id = source.subscription.id?.value;
    if (id === undefined || id.length === 0) return SubscriptionGatewayValues.rejected("denied");
    return source.kind === "activate"
      ? this.#activate(
          id,
          context,
          nowMs,
          expiresAtMs,
          updates ?? SubscriptionGatewayValues.discardUpdate,
          signal,
        )
      : this.#cancel(id, context, nowMs);
  }
  async #activate(
    id: string,
    context: ActorContext,
    nowMs: number,
    expiresAtMs: number | undefined,
    updates: SubscriptionUpdateSink,
    signal: AbortSignal | undefined,
  ): Promise<SubscriptionGatewayResult> {
    const activeController = new AbortController();
    const active = activeController.signal;
    const abort = () => {
      activeController.abort();
    };
    if (signal?.aborted) return SubscriptionGatewayValues.rejected("denied");
    if (this.#options.publicAccess === true) this.#clearPublicPending(id);
    signal?.addEventListener("abort", abort, { once: true });
    const expiry =
      expiresAtMs === undefined
        ? undefined
        : setTimeout(
            () => {
              activeController.abort();
            },
            Math.max(0, expiresAtMs - nowMs),
          );
    let activationFailure: Error | undefined;
    let outcome: SubscriptionGatewayResult = SubscriptionGatewayValues.rejected("denied");
    try {
      const result = await this.#options.bindings.activate({
        id,
        context,
        nowMs,
        signal: active,
        onDefinition: (definition, effectSignal) =>
          this.#forwardActivate(definition, updates, effectSignal),
      });
      outcome =
        result.kind === "activated"
          ? { kind: "activated" }
          : SubscriptionGatewayValues.rejected("denied");
    } catch (error) {
      if (error instanceof Error && error.message === "binding-busy")
        outcome = SubscriptionGatewayValues.rejected("binding-busy");
      else
        activationFailure =
          error instanceof Error
            ? error
            : new Error("Public subscription activation failed with a non-Error value.", {
                cause: error,
              });
    } finally {
      if (expiry !== undefined) clearTimeout(expiry);
      signal?.removeEventListener("abort", abort);
    }
    let cleanupFailure: Error | undefined;
    if (this.#options.publicAccess === true)
      try {
        await this.#cancel(id, context, this.#nowMs() ?? nowMs);
      } catch (error) {
        cleanupFailure =
          error instanceof Error
            ? error
            : new Error("Public subscription cleanup failed with a non-Error value.", {
                cause: error,
              });
      }
    if (activationFailure !== undefined) {
      if (cleanupFailure !== undefined)
        throw new AggregateError(
          [activationFailure, cleanupFailure],
          "public subscription cleanup failed",
        );
      throw activationFailure;
    }
    if (cleanupFailure !== undefined) throw cleanupFailure;
    return outcome;
  }
  async #cancel(
    id: string,
    context: ActorContext,
    nowMs: number,
  ): Promise<SubscriptionGatewayResult> {
    this.#clearPublicPending(id);
    try {
      const result = await this.#options.bindings.cancel({
        id,
        context,
        nowMs,
        onDefinition: (definition, effectSignal) => this.#forwardCancel(definition, effectSignal),
      });
      return result.kind === "denied"
        ? SubscriptionGatewayValues.rejected("denied")
        : { kind: "cancelled" };
    } catch (error) {
      if (error instanceof Error && error.message === "binding-busy")
        return SubscriptionGatewayValues.rejected("binding-busy");
      throw error;
    }
  }
  async #subscribe(
    bytes: Uint8Array,
    context: ActorContext,
    expiresAtMs: number | undefined,
  ): Promise<SubscriptionGatewayResult> {
    const wire = await this.#options.bindings.create({
      topic: { kind: "subscription-topic", bytes: bytes.slice() },
      ...(expiresAtMs === undefined ? {} : { whenExpires: expiresAtMs }),
    });
    const id = fromBinary(SubscriptionSchema, wire.bytes).id?.value;
    if (id === undefined || id.length === 0) throw new Error("retained subscription has no ID");
    const controller = new AbortController();
    try {
      await this.#receiveBackend(wire, controller);
      const nowMs = this.#nowMs();
      if (nowMs === undefined || (expiresAtMs !== undefined && expiresAtMs <= nowMs)) {
        await this.#compensateDefinition(wire, controller);
        await this.#options.bindings.cancel({
          id,
          context,
          nowMs: nowMs ?? expiresAtMs ?? 0,
          onDefinition: () => Promise.resolve(),
        });
        return SubscriptionGatewayValues.rejected("denied");
      }
      if (expiresAtMs !== undefined) this.scheduleExpiry(expiresAtMs);
      if (this.#options.publicAccess === true) this.#schedulePublicPending(id, context);
      return { kind: "subscribed", wire: SubscriptionGatewayValues.copyPublic(wire) };
    } catch (error) {
      try {
        await this.#compensateDefinition(wire, controller);
        await this.#options.bindings.cancel({
          id,
          context,
          nowMs: this.#nowMs() ?? expiresAtMs ?? 0,
          onDefinition: () => Promise.resolve(),
        });
        // spine-log-boundary: auth.subscription_recovered_cleanup
      } catch {
        // Retain the row: a later request can retry backend cleanup.
      }
      throw error;
    }
  }
  #schedulePublicPending(id: string, context: ActorContext): void {
    this.#clearPublicPending(id);
    const timer = setTimeout(() => {
      if (this.#publicPendingTimers.get(id) !== timer) return;
      this.#publicPendingTimers.delete(id);
      // spine-log-boundary: auth.public_pending_subscription_cleanup
      void this.#cancel(id, context, this.#nowMs() ?? 0).then(
        (result) => {
          if (result.kind === "rejected") this.#retryPublicPending(id, context);
        },
        () => {
          this.#retryPublicPending(id, context);
        },
      );
    }, SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS);
    this.#publicPendingTimers.set(id, timer);
  }
  #retryPublicPending(id: string, context: ActorContext): void {
    if (!this.#closed && !this.#publicPendingTimers.has(id))
      this.#schedulePublicPending(id, context);
  }
  #clearPublicPending(id: string): void {
    const timer = this.#publicPendingTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.#publicPendingTimers.delete(id);
  }
  async #receiveBackend(wire: PublicSubscriptionWire, controller: AbortController): Promise<void> {
    return SubscriptionGatewayValues.withTimeout(
      this.#options.creator.subscribe(
        SubscriptionGatewayValues.copyPublic(wire),
        controller.signal,
        this.#limits.maxBackendEnvelopeBytes,
      ),
      this.#limits.operationTimeoutMs,
      controller,
    );
  }
  async #compensateDefinition(
    wire: PublicSubscriptionWire,
    controller: AbortController,
  ): Promise<void> {
    const signal = controller.signal.aborted ? new AbortController().signal : controller.signal;
    await this.#options.creator.cancel(
      { wire: SubscriptionGatewayValues.copyPublic(wire) },
      signal,
    );
  }
  async #forwardActivate(
    definition: PublicSubscriptionWire,
    updates: SubscriptionUpdateSink,
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    const privateWire = SubscriptionGatewayValues.copyPublic(definition);
    try {
      const publicSubscription = fromBinary(SubscriptionSchema, definition.bytes);
      await this.#options.creator.activate(
        {
          wire: privateWire,
          updates: async (update) => {
            try {
              const decoded = fromBinary(SubscriptionUpdateSchema, update.bytes);
              decoded.subscription = clone(SubscriptionSchema, publicSubscription);
              await updates({
                kind: "subscription-update",
                bytes: toBinary(SubscriptionUpdateSchema, decoded),
              });
            } finally {
              update.bytes.fill(0);
            }
          },
        },
        signal,
      );
    } finally {
      privateWire.bytes.fill(0);
    }
  }
  async #forwardCancel(
    definition: PublicSubscriptionWire,
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    const privateWire = SubscriptionGatewayValues.copyPublic(definition);
    try {
      await this.#options.creator.cancel({ wire: privateWire }, signal);
    } finally {
      privateWire.bytes.fill(0);
    }
  }
}

/**
 * Builds validated subscription gateway inputs and isolated wire values.
 */
const SubscriptionGatewayValues = Object.freeze({
  publicPrincipal: Object.freeze({ id: "spine-gateway-public" }),
  discardUpdate(update: SubscriptionUpdateWire): Promise<void> {
    update.bytes.fill(0);
    return Promise.resolve();
  },
  copyPublic(wire: PublicSubscriptionWire): PublicSubscriptionWire {
    return { kind: wire.kind, bytes: wire.bytes.slice() };
  },
  subscribed(id: string, topicBytes: Uint8Array): SubscriptionGatewayResult {
    return {
      kind: "subscribed",
      wire: {
        kind: "public-subscription",
        bytes: toBinary(
          SubscriptionSchema,
          create(SubscriptionSchema, {
            id: { value: id },
            topic: fromBinary(TopicSchema, topicBytes),
          }),
        ),
      },
    };
  },
  decode(
    kind: "subscribe" | "activate" | "cancel",
    bytes: Uint8Array,
    transport: TransportRequestContext,
  ): Extract<IncomingRequest, { readonly kind: typeof kind }> | undefined {
    const result = IncomingRequests.decode({ kind, value: bytes.slice(), transport });
    return result?.kind === kind ? result : undefined;
  },
  trustedContext(context: Awaited<ReturnType<ContextResolver["resolve"]>>): ActorContext {
    return create(ActorContextSchema, {
      actor: context.actor,
      timestamp: context.timestamp,
      ...(context.tenant === undefined ? {} : { tenantId: context.tenant }),
      ...(context.zoneId === undefined ? {} : { zoneId: context.zoneId }),
      ...(context.language === undefined ? {} : { language: context.language }),
    });
  },
  matches(requested: ActorContext, trusted: ActorContext): boolean {
    return SubscriptionGatewayValues.contextsEqual(requested, trusted);
  },
  contextsEqual(left: ActorContext, right: ActorContext): boolean {
    if (left.actor?.value !== right.actor?.value) return false;
    if (left.tenantId === undefined || right.tenantId === undefined)
      return left.tenantId === right.tenantId;
    const first = toBinary(TenantIdSchema, left.tenantId);
    const second = toBinary(TenantIdSchema, right.tenantId);
    return (
      first.byteLength === second.byteLength && first.every((byte, index) => byte === second[index])
    );
  },
  rewrite(
    incoming: Extract<IncomingRequest, { readonly kind: "subscribe" | "activate" | "cancel" }>,
    context: ActorContext,
  ): Uint8Array {
    if (incoming.kind === "subscribe") {
      const topic = clone(TopicSchema, incoming.topic);
      topic.context = clone(ActorContextSchema, context);
      return toBinary(TopicSchema, topic);
    }
    const subscription = clone(SubscriptionSchema, incoming.subscription);
    const topic =
      subscription.topic === undefined
        ? create(TopicSchema)
        : clone(TopicSchema, subscription.topic);
    topic.context = clone(ActorContextSchema, context);
    subscription.topic = topic;
    return toBinary(SubscriptionSchema, subscription);
  },
  operationFor(
    request: SubscriptionGatewayRequest,
  ): "subscribe" | "activate" | "cancel" | undefined {
    if (request.service !== "spine.client.SubscriptionService") return undefined;
    if (request.method === "Subscribe" && request.wire.kind === "subscription-topic")
      return "subscribe";
    if (request.method === "Activate" && request.wire.kind === "public-subscription")
      return "activate";
    if (request.method === "Cancel" && request.wire.kind === "public-subscription") return "cancel";
    return undefined;
  },
  snapshotTransport(request: SubscriptionGatewayRequest): TransportRequestContext {
    return Object.freeze({
      service: request.service,
      method: request.method,
      ...(request.transport.origin === undefined ? {} : { origin: request.transport.origin }),
      ...(request.transport.requestId === undefined
        ? {}
        : { requestId: request.transport.requestId }),
      ...(request.transport.correlationId === undefined
        ? {}
        : { correlationId: request.transport.correlationId }),
      ...(request.transport.peerAddress === undefined
        ? {}
        : { peerAddress: request.transport.peerAddress }),
      ...(request.transport.userAgent === undefined
        ? {}
        : { userAgent: request.transport.userAgent }),
    });
  },
  rejected(
    reason: Extract<SubscriptionGatewayResult, { readonly kind: "rejected" }>["reason"],
  ): SubscriptionGatewayResult {
    return { kind: "rejected", reason };
  },
  timestampMs(seconds: bigint, nanos: number): number | undefined {
    const value = Number(seconds);
    if (
      !Number.isSafeInteger(value) ||
      !Number.isInteger(nanos) ||
      nanos < 0 ||
      nanos >= 1_000_000_000
    )
      return undefined;
    const result = value * 1_000 + Math.floor(nanos / 1_000_000);
    return Number.isSafeInteger(result) ? result : undefined;
  },
  limits(input: SubscriptionGatewayLimits | undefined): Required<SubscriptionGatewayLimits> {
    const value = { ...defaultLimits, ...input };
    for (const limit of Object.values(value))
      if (!Number.isSafeInteger(limit) || limit <= 0)
        throw new Error("subscription limits must be positive safe integers");
    return value;
  },
  admit(
    request: SubscriptionGatewayRequest,
    limit: Required<SubscriptionGatewayLimits>,
  ): SubscriptionGatewayRequest | undefined {
    if (request.wire.bytes.byteLength > limit.maxRequestBytes) return undefined;
    return {
      service: request.service,
      method: request.method,
      wire: { kind: request.wire.kind, bytes: request.wire.bytes.slice() },
      ...(request.credential === undefined
        ? {}
        : { credential: { kind: request.credential.kind, value: request.credential.value } }),
      transport: SubscriptionGatewayValues.snapshotTransport(request),
      ...(request.updates === undefined ? {} : { updates: request.updates }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
  },
  async withTimeout<T>(
    effect: Promise<T>,
    milliseconds: number,
    controller: AbortController,
  ): Promise<T> {
    if (controller.signal.aborted) throw new Error("subscription operation aborted");
    let handle: unknown;
    const expiry = new Promise<never>((_, reject) => {
      handle = setTimeout(() => {
        controller.abort();
        reject(new Error("subscription operation timed out"));
      }, milliseconds);
    });
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(new Error("subscription operation aborted"));
        },
        { once: true },
      );
    });
    try {
      return await Promise.race([effect, expiry, aborted]);
    } finally {
      clearTimeout(handle);
    }
  },
});
