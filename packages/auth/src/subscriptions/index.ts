import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ActorContextSchema, TenantIdSchema, type ActorContext } from "@spine-event-engine/proto";
import {
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import type {
  AuthenticatedPrincipal,
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
  readonly backend: Uint8Array;
  readonly principalFingerprint: string;
  readonly tenant: string | undefined;
  readonly expiresAtMs: number;
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
 * Processes a fresh private backend-envelope copy.
 *
 * @param envelope Supplies the copied private envelope.
 * @param signal Cancels the backend effect.
 * @param guard Checks whether a durable owner may continue. When supplied, a
 * false result stops the next backend effect or public update. When absent,
 * in-memory bindings continue normally.
 * @returns Completes after the backend effect ends.
 */
export type OnBackendSubscription = (
  envelope: BackendSubscriptionEnvelope,
  signal: SubscriptionAbortSignal,
  guard?: () => Promise<boolean>,
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
  readonly fingerprint: string;
  readonly tenant: string | undefined;
  readonly expiresAtMs: number;
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
   * Limits retained private backend-envelope bytes.
   */
  readonly maxBackendEnvelopeBytes?: number;

  /**
   * Limits retained subscription bindings.
   */
  readonly bindingLimit?: number;

  /**
   * Limits queued work per binding.
   */
  readonly pendingOperationLimit?: number;

  /**
   * Limits one backend operation duration in milliseconds.
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
  bindingLimit: 100,
  pendingOperationLimit: 1,
  operationTimeoutMs: 30_000,
  shutdownTimeoutMs: 1_000,
};

/**
 * A pre-Subscribe capacity lease. It must be released if creation does not retain a binding.
 */
export interface SubscriptionCapacityReservation {
  // prettier-ignore

  /**
   * Clears the previously reserved binding slot.
   *
   * @returns Completes after the slot is available again.
   */
  release(): Promise<void>;
}

/**
 * Trusted infrastructure store for opaque subscription ownership. Results expose only transition state;
 * backend bytes enter at creation and reach only the gateway-supplied transition callback as copied envelopes.
 */
export interface SubscriptionBindings {
  // prettier-ignore

  /**
   * Declares that a custom durable fan-in store persists and equality-fences topology identities.
   */
  readonly topologyFencing?: true;

  /**
   * Creates an inactive private binding.
   * @param input Supplies the copied backend envelope and ownership facts.
   * @returns Returns the new public binding identifier.
   */
  create(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;

    /**
     * Exact ordered topology identity persisted with the binding; omitted values use `legacy`.
     */
    readonly topology?: string;
    readonly tenant: string | undefined;
    readonly expiresAtMs: number;
    readonly reservation?: SubscriptionCapacityReservation;
  }): Promise<{ readonly id: string }>;

  /**
   * Activates an owned private binding.
   * @param input Supplies ownership facts and the backend callback.
   * @returns Returns the ownership transition outcome.
   */
  activate(input: {
    readonly id: string;
    readonly principalFingerprint: string;

    /**
     * Exact ordered topology identity equality-fenced before invoking the callback.
     */
    readonly topology?: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;

    /**
     * Active-effect cancellation signal. A pre-aborted signal starts no backend work.
     */
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition>;

  /**
   * Cancels an owned private binding.
   * @param input Supplies ownership facts and the backend callback.
   * @returns Returns the ownership transition outcome.
   */
  cancel(input: {
    readonly id: string;
    readonly principalFingerprint: string;

    /**
     * Exact ordered topology identity equality-fenced before invoking the callback.
     */
    readonly topology?: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
  }): Promise<SubscriptionBindingTransition>;

  /**
   * Acquires one finite binding slot.
   * @returns Returns the reservation to release when unused.
   */
  reserveCapacity(): Promise<SubscriptionCapacityReservation>;

  /**
   * Removes bindings expired at the supplied time.
   * @param nowMs Supplies the current time in milliseconds.
   * @returns Completes after expired bindings are removed.
   */
  purgeExpired(nowMs: number): Promise<void>;

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
  readonly #disposeCallback: OnBackendSubscription;
  readonly #reservations = new Set<SubscriptionCapacityReservation>();
  #closed = false;
  readonly #limits: Required<SubscriptionGatewayLimits>;

  /**
   * Creates the in-memory binding store.
   * @param options Supplies identifiers, limits, and disposal behavior.
   */
  constructor(options: {
    readonly nextId: () => string;
    readonly limits?: SubscriptionGatewayLimits;
    readonly dispose: OnBackendSubscription;
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
   * Acquires one finite slot before an asynchronous backend Subscribe effect.
   * @returns Returns the reservation to release when unused.
   */
  reserveCapacity(): Promise<SubscriptionCapacityReservation> {
    return Promise.resolve().then(() => {
      if (this.#closed) throw new Error("subscription bindings are closed");
      if (this.#bindings.size + this.#reservations.size >= this.#limits.bindingLimit)
        throw new Error("binding-capacity-exceeded");
      let released = false;
      const reservation: SubscriptionCapacityReservation = {
        release: () => {
          if (!released) {
            released = true;
            this.#reservations.delete(reservation);
          }
          return Promise.resolve();
        },
      };
      this.#reservations.add(reservation);
      return reservation;
    });
  }

  /**
   * Removes already-expired private envelopes without a background timer.
   * @param nowMs Supplies the current time in milliseconds.
   * @returns Completes after expired envelopes are removed.
   */
  purgeExpired(nowMs: number): Promise<void> {
    for (const [id, binding] of this.#bindings)
      if (binding.expiresAtMs <= nowMs) this.#expire(id, binding);
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
   * Creates an inactive binding from a copied trusted backend envelope.
   * @param input Supplies the envelope and ownership facts.
   * @returns Returns the new public binding identifier.
   */
  create(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly expiresAtMs: number;
    readonly reservation?: SubscriptionCapacityReservation;
  }): Promise<{ readonly id: string }> {
    try {
      if (this.#closed) throw new Error("subscription bindings are closed");
      if (input.backend.bytes.byteLength > this.#limits.maxBackendEnvelopeBytes)
        throw new Error("backend-envelope-too-large");
      const reservation = input.reservation;
      if (
        (reservation === undefined || !this.#reservations.has(reservation)) &&
        this.#bindings.size + this.#reservations.size >= this.#limits.bindingLimit
      )
        throw new Error("binding-capacity-exceeded");
      const id = this.#nextId();
      if (id.length === 0 || this.#bindings.has(id))
        throw new Error("subscription ID must be unique");
      this.#bindings.set(id, {
        backend: input.backend.bytes.slice(),
        principalFingerprint: input.principalFingerprint,
        tenant: input.tenant,
        expiresAtMs: input.expiresAtMs,
        state: "inactive",
        controller: new AbortController(),
        tail: Promise.resolve(),
        effectTail: Promise.resolve(),
        pending: 0,
        expiring: false,
        cancelRequested: false,
      });
      void input.reservation?.release();
      return Promise.resolve({ id });
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
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
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
        await this.#runEffect(binding, input.onBackend);
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
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
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
      await this.#runEffect(binding, input.onBackend);
      this.#dispose(input.id, binding);
      return { kind: "closed" };
    });
  }
  #owned(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
  }): Promise<Binding | undefined> {
    const binding = this.#bindings.get(input.id);
    if (binding === undefined) return Promise.resolve(undefined);
    if (binding.expiresAtMs <= input.nowMs) {
      this.#expire(input.id, binding);
      return Promise.resolve(undefined);
    }
    return binding.principalFingerprint === input.principalFingerprint &&
      binding.tenant === input.tenant
      ? Promise.resolve(binding)
      : Promise.resolve(undefined);
  }
  #precheck(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
  }): "owned" | "absent" | "denied" {
    const binding = this.#bindings.get(input.id);
    if (binding === undefined) return "absent";
    if (
      binding.principalFingerprint !== input.principalFingerprint ||
      binding.tenant !== input.tenant
    )
      return "denied";
    if (binding.expiring || binding.expiresAtMs <= input.nowMs) {
      this.#expire(input.id, binding);
      return "denied";
    }
    return "owned";
  }
  #expire(id: string, binding: Binding): void {
    if (binding.expiring || this.#bindings.get(id) !== binding) return;
    binding.expiring = true;
    binding.controller.abort();
    void this.#disposeAfterWork(id, binding).catch(() => undefined);
  }
  #dispose(id: string, binding: Binding): void {
    binding.backend.fill(0);
    binding.state = "closed";
    this.#bindings.delete(id);
  }
  async #runEffect(binding: Binding, callback: OnBackendSubscription): Promise<void> {
    const privateCopy = SubscriptionGatewayValues.envelope(binding.backend);
    let effect: Promise<void>;
    try {
      effect = Promise.resolve(callback(privateCopy, binding.controller.signal));
    } catch (error) {
      effect = Promise.reject(
        error instanceof Error
          ? error
          : new Error("Subscription backend callback threw a non-Error value.", { cause: error }),
      );
    }
    const settled = effect.then(
      () => undefined,
      () => undefined,
    );
    binding.effectTail = binding.effectTail.then(() => settled);
    try {
      await SubscriptionGatewayValues.withTimeout(
        effect,
        this.#limits.operationTimeoutMs,
        binding.controller,
      );
    } finally {
      void settled.then(() => privateCopy.bytes.fill(0));
    }
  }
  #disposeAfterWork(id: string, binding: Binding): Promise<void> {
    const cleanup = binding.tail
      .then(() => binding.effectTail)
      .then(() => this.#disposeWithCallback(id, binding));
    binding.tail = cleanup.catch(() => undefined);
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
    const privateCopy = SubscriptionGatewayValues.envelope(binding.backend);
    this.#dispose(id, binding);
    const controller = new AbortController();
    try {
      await SubscriptionGatewayValues.withTimeout(
        this.#disposeCallback(privateCopy, controller.signal),
        this.#limits.shutdownTimeoutMs,
        controller,
      );
    } finally {
      privateCopy.bytes.fill(0);
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
  readonly credential: RequestCredential;

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
   * Creates a backend subscription.
   * @param request Supplies the copied topic bytes.
   * @param signal Cancels the backend operation.
   * @returns Returns the trusted backend envelope.
   */
  subscribe(
    request: SubscriptionTopicWire,
    signal: SubscriptionAbortSignal,
  ): Promise<BackendSubscriptionEnvelope>;

  /**
   * Activates a backend subscription.
   * @param request Supplies copied subscription bytes, backend envelope, and update sink.
   * @param signal Cancels the backend operation.
   * @returns Completes after activation ends.
   */
  activate(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly backend: BackendSubscriptionEnvelope;
      readonly updates: SubscriptionUpdateSink;
    },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;

  /**
   * Cancels a backend subscription.
   * @param request Supplies copied subscription bytes and backend envelope.
   * @param signal Cancels the backend operation.
   * @returns Completes after cancellation ends.
   */
  cancel(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly backend: BackendSubscriptionEnvelope;
    },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;

  /**
   * Removes a backend subscription envelope.
   * @param envelope Supplies the copied backend envelope.
   * @param signal Cancels the backend operation.
   * @returns Completes after disposal ends.
   */
  dispose(envelope: BackendSubscriptionEnvelope, signal: SubscriptionAbortSignal): Promise<void>;
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
  readonly sessions: SessionResolver;

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
   * Returns a stable principal ownership fingerprint.
   * @param principal Supplies the authenticated principal.
   * @returns Returns the ownership fingerprint.
   */
  readonly fingerprint: (principal: AuthenticatedPrincipal) => string;

  /**
   *
   * Identifies the ordered backend topology used to fence durable bindings.
   */
  readonly topology?: string;

  /**
   * Creates and disposes backend subscriptions.
   */
  readonly creator: SubscriptionCreator;

  /**
   * Overrides finite gateway limits.
   */
  readonly limits?: SubscriptionGatewayLimits;
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
        | "binding-capacity-exceeded"
        | "binding-busy";
    };

/**
 * B3 gateway.
 * It serializes operations, admits one transport snapshot, and never reveals backend envelopes.
 */
export class SubscriptionGateway {
  readonly #options: SubscriptionGatewayOptions;
  readonly #limits: Required<SubscriptionGatewayLimits>;
  readonly #pendingSubscribes = new Map<AbortController, SubscriptionCapacityReservation>();
  #closed = false;

  /**
   * Creates the subscription gateway.
   * @param options Supplies authenticated gateway collaborators.
   */
  constructor(options: SubscriptionGatewayOptions) {
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
   * Closes admission, aborts pending Subscribe effects, and closes retained bindings.
   * @returns Completes after retained bindings close.
   */
  async close(): Promise<void> {
    this.#closed = true;
    for (const [controller, reservation] of this.#pendingSubscribes) {
      controller.abort();
      await reservation.release();
    }
    this.#pendingSubscribes.clear();
    await this.#options.bindings.close();
  }
  async #handleOperation(request: SubscriptionGatewayRequest): Promise<SubscriptionGatewayResult> {
    const kind = SubscriptionGatewayValues.operationFor(request);
    if (kind === undefined) return SubscriptionGatewayValues.rejected("unknown-operation");
    const nowMs = this.#nowMs();
    if (nowMs === undefined) return SubscriptionGatewayValues.rejected("denied");
    await this.#options.bindings.purgeExpired(nowMs);
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
    const session = await this.#options.sessions.resolve(request.credential);
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
    session: Awaited<ReturnType<SessionResolver["resolve"]>>,
  ): Promise<PreparedOperation | SubscriptionGatewayResult> {
    if (session === undefined) return SubscriptionGatewayValues.rejected("unauthenticated");
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
    const expiresAtMs = SubscriptionGatewayValues.timestampMs(
      session.expiresAt.seconds,
      session.expiresAt.nanos,
    );
    if (
      nowMs === undefined ||
      expiresAtMs === undefined ||
      expiresAtMs <= nowMs ||
      !SubscriptionGatewayValues.matches(source.requestedContext, context)
    )
      return SubscriptionGatewayValues.rejected("denied");
    return {
      source,
      context,
      expiresAtMs,
      nowMs,
      fingerprint: this.#options.fingerprint(session.principal),
      tenant:
        context.tenantId === undefined
          ? undefined
          : SubscriptionGatewayValues.tenantFingerprint(context.tenantId),
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
    const { source, context, fingerprint, tenant, expiresAtMs, nowMs } = prepared;
    const topology = this.#options.topology ?? "legacy";
    const rewritten = SubscriptionGatewayValues.rewrite(source, context);
    if (source.kind === "subscribe")
      return this.#subscribe(rewritten, fingerprint, topology, tenant, expiresAtMs);
    const id = source.subscription.id?.value;
    if (id === undefined || id.length === 0) return SubscriptionGatewayValues.rejected("denied");
    const wire: PublicSubscriptionWire = { kind: "public-subscription", bytes: rewritten };
    return source.kind === "activate"
      ? this.#activate(
          id,
          fingerprint,
          topology,
          tenant,
          nowMs,
          expiresAtMs,
          wire,
          updates ?? SubscriptionGatewayValues.discardUpdate,
          signal,
        )
      : this.#cancel(id, fingerprint, topology, tenant, nowMs, wire);
  }
  async #activate(
    id: string,
    fingerprint: string,
    topology: string,
    tenant: string | undefined,
    nowMs: number,
    expiresAtMs: number,
    wire: PublicSubscriptionWire,
    updates: SubscriptionUpdateSink,
    signal: AbortSignal | undefined,
  ): Promise<SubscriptionGatewayResult> {
    const activeController = new AbortController();
    const active = activeController.signal;
    const abort = () => {
      activeController.abort();
    };
    if (signal?.aborted) return SubscriptionGatewayValues.rejected("denied");
    signal?.addEventListener("abort", abort, { once: true });
    const expiry = setTimeout(
      () => {
        activeController.abort();
      },
      Math.max(0, expiresAtMs - nowMs),
    );
    try {
      const result = await this.#options.bindings.activate({
        id,
        principalFingerprint: fingerprint,
        topology,
        tenant,
        nowMs,
        signal: active,
        onBackend: (backend, signal, guard) =>
          this.#forwardActivate(wire, backend, updates, signal, guard),
      });
      if (result.kind !== "activated") return SubscriptionGatewayValues.rejected("denied");
      await this.#cleanupAfterActivationFailure(id, fingerprint, topology, tenant, nowMs, wire);
      return { kind: "activated" };
    } catch (error) {
      if (error instanceof Error && error.message === "binding-busy")
        return SubscriptionGatewayValues.rejected("binding-busy");
      await this.#cleanupAfterActivationFailure(id, fingerprint, topology, tenant, nowMs, wire);
      throw error;
    } finally {
      clearTimeout(expiry);
      signal?.removeEventListener("abort", abort);
    }
  }
  async #cancel(
    id: string,
    fingerprint: string,
    topology: string,
    tenant: string | undefined,
    nowMs: number,
    wire: PublicSubscriptionWire,
  ): Promise<SubscriptionGatewayResult> {
    try {
      const result = await this.#options.bindings.cancel({
        id,
        principalFingerprint: fingerprint,
        topology,
        tenant,
        nowMs,
        onBackend: (backend, signal, guard) => this.#forwardCancel(wire, backend, signal, guard),
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
    fingerprint: string,
    topology: string,
    tenant: string | undefined,
    expiresAtMs: number,
  ): Promise<SubscriptionGatewayResult> {
    const reservation = await this.#reserveCapacity();
    if ("kind" in reservation) return reservation;
    const controller = new AbortController();
    this.#pendingSubscribes.set(controller, reservation);
    let backend: BackendSubscriptionEnvelope | undefined;
    try {
      backend = await this.#receiveBackend(bytes, controller);
      const nowMs = this.#nowMs();
      if (nowMs === undefined || expiresAtMs <= nowMs) {
        await this.#compensate(backend.bytes, controller);
        return SubscriptionGatewayValues.rejected("denied");
      }
      return await this.#retainBackend(
        backend,
        bytes,
        fingerprint,
        topology,
        tenant,
        expiresAtMs,
        reservation,
        controller,
      );
    } finally {
      this.#pendingSubscribes.delete(controller);
      await reservation.release();
      backend?.bytes.fill(0);
    }
  }
  async #reserveCapacity(): Promise<SubscriptionCapacityReservation | SubscriptionGatewayResult> {
    try {
      return await this.#options.bindings.reserveCapacity();
    } catch (error) {
      return SubscriptionGatewayValues.rejected(
        error instanceof Error && error.message === "binding-capacity-exceeded"
          ? "binding-capacity-exceeded"
          : "denied",
      );
    }
  }
  async #receiveBackend(
    bytes: Uint8Array,
    controller: AbortController,
  ): Promise<BackendSubscriptionEnvelope> {
    return SubscriptionGatewayValues.withTimeout(
      this.#options.creator.subscribe(
        { kind: "subscription-topic", bytes: bytes.slice() },
        controller.signal,
      ),
      this.#limits.operationTimeoutMs,
      controller,
    );
  }
  async #retainBackend(
    backend: BackendSubscriptionEnvelope,
    bytes: Uint8Array,
    fingerprint: string,
    topology: string,
    tenant: string | undefined,
    expiresAtMs: number,
    reservation: SubscriptionCapacityReservation,
    controller: AbortController,
  ): Promise<SubscriptionGatewayResult> {
    if (backend.bytes.byteLength > this.#limits.maxBackendEnvelopeBytes) {
      await reservation.release();
      await this.#compensate(backend.bytes, controller);
      return SubscriptionGatewayValues.rejected("backend-envelope-too-large");
    }
    try {
      const binding = await this.#options.bindings.create({
        backend: SubscriptionGatewayValues.envelope(backend.bytes),
        principalFingerprint: fingerprint,
        topology,
        tenant,
        expiresAtMs,
        reservation,
      });
      return SubscriptionGatewayValues.subscribed(binding.id, bytes);
    } catch (error) {
      return this.#failedCreation(error, backend.bytes, controller, reservation);
    }
  }
  async #failedCreation(
    error: unknown,
    bytes: Uint8Array,
    controller: AbortController,
    reservation: SubscriptionCapacityReservation,
  ): Promise<SubscriptionGatewayResult> {
    try {
      await reservation.release();
      await this.#compensate(bytes, controller);
    } catch (disposeError) {
      throw new AggregateError(
        [error, disposeError],
        "subscription binding creation and disposal failed",
      );
    }
    return SubscriptionGatewayValues.rejected(
      error instanceof Error && error.message === "binding-capacity-exceeded"
        ? "binding-capacity-exceeded"
        : "denied",
    );
  }
  async #compensate(bytes: Uint8Array, controller: AbortController): Promise<void> {
    const privateCopy = SubscriptionGatewayValues.envelope(bytes);
    const compensation = controller.signal.aborted ? new AbortController() : controller;
    const timeoutMs =
      compensation === controller
        ? this.#limits.operationTimeoutMs
        : this.#limits.shutdownTimeoutMs;
    try {
      await SubscriptionGatewayValues.withTimeout(
        this.#options.creator.dispose(privateCopy, compensation.signal),
        timeoutMs,
        compensation,
      );
    } finally {
      privateCopy.bytes.fill(0);
    }
  }
  async #cleanupAfterActivationFailure(
    id: string,
    fingerprint: string,
    topology: string,
    tenant: string | undefined,
    nowMs: number,
    wire: PublicSubscriptionWire,
  ): Promise<void> {
    try {
      await this.#options.bindings.cancel({
        id,
        principalFingerprint: fingerprint,
        topology,
        tenant,
        nowMs,
        onBackend: (backend, signal, guard) => this.#forwardCancel(wire, backend, signal, guard),
      });
    } catch {
      // The activation failure remains authoritative; cancellation stays retryable.
    }
  }
  async #forwardActivate(
    wire: PublicSubscriptionWire,
    backend: BackendSubscriptionEnvelope,
    updates: SubscriptionUpdateSink,
    signal: SubscriptionAbortSignal,
    guard: (() => Promise<boolean>) | undefined,
  ): Promise<void> {
    const privateWire = SubscriptionGatewayValues.copyPublic(wire);
    try {
      if (!(await SubscriptionGatewayValues.canContinue(guard))) return;
      const publicSubscription = fromBinary(SubscriptionSchema, wire.bytes);
      await this.#options.creator.activate(
        {
          wire: privateWire,
          backend,
          updates: async (update) => {
            try {
              if (!(await SubscriptionGatewayValues.canContinue(guard))) return;
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
    wire: PublicSubscriptionWire,
    backend: BackendSubscriptionEnvelope,
    signal: SubscriptionAbortSignal,
    guard: (() => Promise<boolean>) | undefined,
  ): Promise<void> {
    const privateWire = SubscriptionGatewayValues.copyPublic(wire);
    try {
      if (!(await SubscriptionGatewayValues.canContinue(guard))) return;
      await this.#options.creator.cancel({ wire: privateWire, backend }, signal);
    } finally {
      privateWire.bytes.fill(0);
    }
  }
}

/**
 * Builds validated subscription gateway inputs and isolated wire values.
 */
const SubscriptionGatewayValues = Object.freeze({
  async canContinue(guard: (() => Promise<boolean>) | undefined): Promise<boolean> {
    return guard === undefined || (await guard());
  },

  discardUpdate(update: SubscriptionUpdateWire): Promise<void> {
    update.bytes.fill(0);
    return Promise.resolve();
  },
  envelope(bytes: Uint8Array): BackendSubscriptionEnvelope {
    return { kind: "backend-subscription-envelope", bytes: bytes.slice() };
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
    return (
      requested.actor?.value === trusted.actor?.value &&
      SubscriptionGatewayValues.tenantBytesEqual(requested.tenantId, trusted.tenantId)
    );
  },
  tenantBytesEqual(
    left: Parameters<typeof toBinary<typeof TenantIdSchema>>[1] | undefined,
    right: Parameters<typeof toBinary<typeof TenantIdSchema>>[1] | undefined,
  ): boolean {
    if (left === undefined || right === undefined) return left === right;
    const first = toBinary(TenantIdSchema, left);
    const second = toBinary(TenantIdSchema, right);
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
  tenantFingerprint(tenant: Parameters<typeof toBinary<typeof TenantIdSchema>>[1]): string {
    return [...toBinary(TenantIdSchema, tenant)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
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
      credential: { kind: request.credential.kind, value: request.credential.value },
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
