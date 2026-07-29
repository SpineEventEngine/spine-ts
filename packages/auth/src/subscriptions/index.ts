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
import { decodeIncomingRequest } from "../request/index.js";

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
  pending: number;
  expiring: boolean;
  cancelRequested: boolean;
}

/** Owned raw Topic protobuf bytes for the `SubscriptionService.Subscribe` RPC. The gateway copies them on admission. */
export interface SubscriptionTopicWire {
  readonly kind: "subscription-topic";
  readonly bytes: Uint8Array;
}
/** Owned raw Subscription protobuf bytes for the public Activate and Cancel RPCs. The gateway copies them on admission. */
export interface PublicSubscriptionWire {
  readonly kind: "public-subscription";
  readonly bytes: Uint8Array;
}
/** Owned serialized public update bytes admitted by the B4 relay. */
export interface SubscriptionUpdateWire {
  readonly kind: "subscription-update";
  readonly bytes: Uint8Array;
}
/** Asynchronous public-stream admission boundary. Resolving admits the next backend update. */
export type SubscriptionUpdateSink = (update: SubscriptionUpdateWire) => Promise<void>;
/** Trusted-infrastructure-only raw backend envelope. It is never returned in a gateway result or decoded browser result. */
export interface BackendSubscriptionEnvelope {
  readonly kind: "backend-subscription-envelope";
  readonly bytes: Uint8Array;
}
/** A gateway-controlled callback that receives a fresh private backend-envelope copy. Rejection leaves cancellation retryable. */
/** Standard event-capable cancellation signal supplied to every backend callback. */
export type SubscriptionAbortSignal = AbortSignal;
export type OnBackendSubscription = (
  envelope: BackendSubscriptionEnvelope,
  signal: SubscriptionAbortSignal,
) => Promise<void>;
/** Opaque result of an ownership transition. */
export type SubscriptionBindingTransition = { readonly kind: "activated" | "closed" | "denied" };
type SubscriptionOperation = "subscribe" | "activate" | "cancel";
type PreparedOperation = {
  readonly source: Extract<IncomingRequest, { readonly kind: SubscriptionOperation }>;
  readonly context: ActorContext;
  readonly fingerprint: string;
  readonly tenant: string | undefined;
  readonly expiresAtMs: number;
  readonly nowMs: number;
};

/** Finite B3 ownership limits. Every supplied value must be a positive safe integer. */
export interface SubscriptionGatewayLimits {
  readonly maxRequestBytes?: number;
  readonly maxBackendEnvelopeBytes?: number;
  readonly bindingLimit?: number;
  readonly pendingOperationLimit?: number;
  readonly operationTimeoutMs?: number;
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
/** A pre-Subscribe capacity lease. It must be released if creation does not retain a binding. */
export interface SubscriptionCapacityReservation {
  release(): void;
}

/**
 * Trusted infrastructure store for opaque subscription ownership. Results expose only transition state;
 * backend bytes enter at creation and reach only the gateway-supplied transition callback as copied envelopes.
 */
export interface SubscriptionBindings {
  create(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly expiresAtMs: number;
    readonly reservation?: SubscriptionCapacityReservation;
  }): Promise<{ readonly id: string }>;
  activate(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
    /** Active-effect cancellation signal. A pre-aborted signal starts no backend work. */
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition>;
  cancel(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
  }): Promise<SubscriptionBindingTransition>;
  reserveCapacity(): SubscriptionCapacityReservation;
  purgeExpired(nowMs: number): Promise<void>;
  close(): Promise<void>;
}

/** In-memory reference store. It serializes transitions, copies all ingress/egress bytes, and makes close terminal. */
export class InMemorySubscriptionBindings implements SubscriptionBindings {
  readonly #bindings = new Map<string, Binding>();
  readonly #nextId: () => string;
  readonly #disposeCallback: OnBackendSubscription;
  readonly #reservations = new Set<SubscriptionCapacityReservation>();
  #closed = false;
  readonly #limits: Required<SubscriptionGatewayLimits>;

  constructor(options: {
    readonly nextId: () => string;
    readonly limits?: SubscriptionGatewayLimits;
    readonly dispose: OnBackendSubscription;
  }) {
    this.#nextId = options.nextId;
    this.#limits = limits(options.limits);
    this.#disposeCallback = options.dispose;
  }
  /** Number of retained private bindings, exposed only for lifecycle observability. */
  get size(): number {
    return this.#bindings.size;
  }
  /** Atomically leases one finite slot before an asynchronous backend Subscribe effect. */
  reserveCapacity(): SubscriptionCapacityReservation {
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
      },
    };
    this.#reservations.add(reservation);
    return reservation;
  }
  /** Drops already-expired private envelopes without a background timer. */
  async purgeExpired(nowMs: number): Promise<void> {
    for (const [id, binding] of this.#bindings)
      if (binding.expiresAtMs <= nowMs) this.#expire(id, binding);
  }
  /** Permanently rejects later creation and zeroes every private envelope after in-flight work. */
  async close(): Promise<void> {
    this.#closed = true;
    const closing = [...this.#bindings.entries()];
    for (const [, binding] of closing) binding.controller.abort();
    const results = await Promise.allSettled(
      closing.map(([id, binding]) => this.#disposeWithCallback(id, binding)),
    );
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (failures.length > 0)
      throw new AggregateError(failures, "subscription shutdown cleanup failed");
  }
  /** Creates an inactive binding from a copied trusted backend envelope. */
  async create(input: {
    readonly backend: BackendSubscriptionEnvelope;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly expiresAtMs: number;
    readonly reservation?: SubscriptionCapacityReservation;
  }): Promise<{ readonly id: string }> {
    if (this.#closed) throw new Error("subscription bindings are closed");
    if (input.backend.bytes.byteLength > this.#limits.maxBackendEnvelopeBytes)
      throw new Error("backend-envelope-too-large");
    if (
      !this.#reservations.has(input.reservation as SubscriptionCapacityReservation) &&
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
      pending: 0,
      expiring: false,
      cancelRequested: false,
    });
    input.reservation?.release();
    return { id };
  }
  /** Activates only an owned inactive binding; callback failure restores the inactive retry state. */
  async activate(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
    readonly onBackend: OnBackendSubscription;
    readonly signal: AbortSignal;
  }): Promise<SubscriptionBindingTransition> {
    if (input.signal?.aborted) return { kind: "denied" };
    if (this.#precheck(input) !== "owned") return { kind: "denied" };
    return this.#coordinate(input.id, async () => {
      const binding = await this.#owned(input);
      if (input.signal?.aborted || binding === undefined || binding.state !== "inactive")
        return { kind: "denied" };
      binding.state = "active";
      binding.controller = new AbortController();
      const abort = () => binding.controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      try {
        await this.#runEffect(binding, input.onBackend);
      } catch (error) {
        if (binding.cancelRequested) return { kind: "activated" };
        binding.state = "inactive";
        throw error;
      } finally {
        input.signal?.removeEventListener("abort", abort);
      }
      return { kind: "activated" };
    });
  }
  /** Cancels an owned binding. A failed mandatory cleanup retains its envelope and `cancelling` state for retry. */
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
      try {
        await this.#runEffect(binding, input.onBackend);
      } catch (error) {
        throw error;
      }
      this.#dispose(input.id, binding);
      return { kind: "closed" };
    });
  }
  async #owned(input: {
    readonly id: string;
    readonly principalFingerprint: string;
    readonly tenant: string | undefined;
    readonly nowMs: number;
  }): Promise<Binding | undefined> {
    const binding = this.#bindings.get(input.id);
    if (binding === undefined) return undefined;
    if (binding.expiresAtMs <= input.nowMs) {
      this.#expire(input.id, binding);
      return undefined;
    }
    return binding.principalFingerprint === input.principalFingerprint &&
      binding.tenant === input.tenant
      ? binding
      : undefined;
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
    const previous = binding.tail;
    binding.tail = previous
      .then(() => this.#disposeWithCallback(id, binding))
      .catch(() => this.#disposeWithCallback(id, binding).catch(() => undefined));
  }
  #dispose(id: string, binding: Binding): void {
    binding.backend.fill(0);
    binding.state = "closed";
    this.#bindings.delete(id);
  }
  async #runEffect(binding: Binding, callback: OnBackendSubscription): Promise<void> {
    const privateCopy = envelope(binding.backend);
    try {
      await withTimeout(
        callback(privateCopy, binding.controller.signal),
        this.#limits.operationTimeoutMs,
        binding.controller,
      );
    } finally {
      privateCopy.bytes.fill(0);
    }
  }
  async #disposeWithCallback(id: string, binding: Binding): Promise<void> {
    if (this.#bindings.get(id) !== binding) return;
    const privateCopy = envelope(binding.backend);
    this.#dispose(id, binding);
    const controller = new AbortController();
    try {
      await withTimeout(
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

/** Admission input for one of the three SubscriptionService RPCs. `wire` is copied immediately and credential is never forwarded. */
export interface SubscriptionGatewayRequest {
  readonly service: string;
  readonly method: string;
  readonly wire: SubscriptionTopicWire | PublicSubscriptionWire;
  readonly credential: RequestCredential;
  readonly transport: TransportRequestContext;
  /** B4 public update admission seam; ignored for Subscribe and Cancel. */
  readonly updates?: SubscriptionUpdateSink;
  /** B4 downstream cancellation signal, copied only as a control capability. */
  readonly signal?: AbortSignal;
}
/** B4-mappable backend seam. It receives copied wire values; cleanup is mandatory so a backend subscription cannot be orphaned. */
export interface SubscriptionCreator {
  subscribe(
    request: SubscriptionTopicWire,
    signal: SubscriptionAbortSignal,
  ): Promise<BackendSubscriptionEnvelope>;
  activate(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly backend: BackendSubscriptionEnvelope;
      readonly updates: SubscriptionUpdateSink;
    },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;
  cancel(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly backend: BackendSubscriptionEnvelope;
    },
    signal: SubscriptionAbortSignal,
  ): Promise<void>;
  dispose(envelope: BackendSubscriptionEnvelope, signal: SubscriptionAbortSignal): Promise<void>;
}
/** Collaborators for independently authenticated and authorized subscription operations. */
export interface SubscriptionGatewayOptions {
  readonly bindings: SubscriptionBindings;
  readonly sessions: SessionResolver;
  readonly authorize: AuthorizationPolicy["authorize"];
  readonly contexts: ContextResolver;
  readonly clock: Clock;
  readonly fingerprint: (principal: AuthenticatedPrincipal) => string;
  readonly creator: SubscriptionCreator;
  readonly limits?: SubscriptionGatewayLimits;
}
/** Opaque browser-facing operation result. Only subscribed contains a copied public Subscription wire, never backend bytes. */
export type SubscriptionGatewayResult =
  | { readonly kind: "subscribed"; readonly wire: PublicSubscriptionWire }
  | { readonly kind: "activated" }
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "rejected";
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

/** B3 gateway. It serializes complete operations, admits one immutable transport snapshot, and never reveals backend envelopes. */
export class SubscriptionGateway {
  readonly #options: SubscriptionGatewayOptions;
  readonly #limits: Required<SubscriptionGatewayLimits>;
  readonly #pendingSubscribes = new Map<AbortController, SubscriptionCapacityReservation>();
  #closed = false;
  constructor(options: SubscriptionGatewayOptions) {
    this.#options = options;
    this.#limits = limits(options.limits);
  }
  async handle(request: SubscriptionGatewayRequest): Promise<SubscriptionGatewayResult> {
    if (this.#closed) return rejected("denied");
    const admitted = admit(request, this.#limits);
    if (admitted === undefined) return rejected("request-too-large");
    try {
      return await this.#handleOperation(admitted);
    } finally {
      admitted.wire.bytes.fill(0);
    }
  }
  /** Terminates admission, aborts pending pre-binding Subscribe effects, then closes retained bindings. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const [controller, reservation] of this.#pendingSubscribes) {
      controller.abort();
      reservation.release();
    }
    this.#pendingSubscribes.clear();
    await this.#options.bindings.close();
  }
  async #handleOperation(request: SubscriptionGatewayRequest): Promise<SubscriptionGatewayResult> {
    const kind = operationFor(request);
    if (kind === undefined) return rejected("unknown-operation");
    const now = this.#options.clock.now();
    const nowMs = timestampMs(now.seconds, now.nanos);
    if (nowMs === undefined) return rejected("denied");
    await this.#options.bindings.purgeExpired(nowMs);
    const prepared = await this.#prepareSecurity(kind, request, nowMs);
    if ("kind" in prepared) return prepared;
    return this.#perform(prepared, request.updates, request.signal);
  }
  async #prepareSecurity(
    kind: SubscriptionOperation,
    request: SubscriptionGatewayRequest,
    nowMs: number,
  ): Promise<PreparedOperation | SubscriptionGatewayResult> {
    const source = decode(kind, request.wire.bytes, request.transport);
    if (source === undefined) return rejected("malformed-request");
    const session = await this.#options.sessions.resolve(request.credential);
    if (session === undefined) return rejected("unauthenticated");
    const authorization = decode(kind, request.wire.bytes, request.transport);
    if (
      authorization === undefined ||
      !(await this.#options.authorize(session.principal, authorization))
    )
      return rejected("forbidden");
    return this.#resolveTrusted(kind, request, source, session, nowMs);
  }
  async #resolveTrusted(
    kind: SubscriptionOperation,
    request: SubscriptionGatewayRequest,
    source: Extract<IncomingRequest, { readonly kind: SubscriptionOperation }>,
    session: Awaited<ReturnType<SessionResolver["resolve"]>>,
    nowMs: number,
  ): Promise<PreparedOperation | SubscriptionGatewayResult> {
    if (session === undefined) return rejected("unauthenticated");
    const contextRequest = decode(kind, request.wire.bytes, request.transport);
    if (contextRequest === undefined) return rejected("malformed-request");
    const context = trustedContext(
      await this.#options.contexts.resolve(session.principal, contextRequest, this.#options.clock),
    );
    const expiresAtMs = timestampMs(session.expiresAt.seconds, session.expiresAt.nanos);
    if (
      expiresAtMs === undefined ||
      expiresAtMs <= nowMs ||
      !matches(source.requestedContext, context)
    )
      return rejected("denied");
    return {
      source,
      context,
      expiresAtMs,
      nowMs,
      fingerprint: this.#options.fingerprint(session.principal),
      tenant: context.tenantId === undefined ? undefined : tenantFingerprint(context.tenantId),
    };
  }
  async #perform(
    prepared: PreparedOperation,
    updates: SubscriptionUpdateSink | undefined,
    signal: AbortSignal | undefined,
  ): Promise<SubscriptionGatewayResult> {
    const { source, context, fingerprint, tenant, expiresAtMs, nowMs } = prepared;
    const rewritten = rewrite(source, context);
    if (source.kind === "subscribe")
      return this.#subscribe(rewritten, fingerprint, tenant, expiresAtMs);
    const id = source.subscription.id?.value;
    if (id === undefined || id.length === 0) return rejected("denied");
    const wire: PublicSubscriptionWire = { kind: "public-subscription", bytes: rewritten };
    return source.kind === "activate"
      ? this.#activate(
          id,
          fingerprint,
          tenant,
          nowMs,
          expiresAtMs,
          wire,
          updates ?? discardUpdate,
          signal,
        )
      : this.#cancel(id, fingerprint, tenant, nowMs, wire);
  }
  async #activate(
    id: string,
    fingerprint: string,
    tenant: string | undefined,
    nowMs: number,
    expiresAtMs: number,
    wire: PublicSubscriptionWire,
    updates: SubscriptionUpdateSink,
    signal: AbortSignal | undefined,
  ): Promise<SubscriptionGatewayResult> {
    const activeController = new AbortController();
    const active = activeController.signal;
    const abort = () => activeController.abort();
    if (signal?.aborted) return rejected("denied");
    signal?.addEventListener("abort", abort, { once: true });
    const expiry = setTimeout(() => activeController.abort(), Math.max(0, expiresAtMs - nowMs));
    try {
      const result = await this.#options.bindings.activate({
        id,
        principalFingerprint: fingerprint,
        tenant,
        nowMs,
        signal: active,
        onBackend: (backend, signal) => this.#forwardActivate(wire, backend, updates, signal),
      });
      if (result.kind !== "activated") return rejected("denied");
      await this.#cleanupAfterActivationFailure(id, fingerprint, tenant, nowMs, wire);
      return { kind: "activated" };
    } catch (error) {
      if (error instanceof Error && error.message === "binding-busy")
        return rejected("binding-busy");
      await this.#cleanupAfterActivationFailure(id, fingerprint, tenant, nowMs, wire);
      throw error;
    } finally {
      clearTimeout(expiry);
      signal?.removeEventListener("abort", abort);
    }
  }
  async #cancel(
    id: string,
    fingerprint: string,
    tenant: string | undefined,
    nowMs: number,
    wire: PublicSubscriptionWire,
  ): Promise<SubscriptionGatewayResult> {
    try {
      const result = await this.#options.bindings.cancel({
        id,
        principalFingerprint: fingerprint,
        tenant,
        nowMs,
        onBackend: (backend, signal) => this.#forwardCancel(wire, backend, signal),
      });
      return result.kind === "denied" ? rejected("denied") : { kind: "cancelled" };
    } catch (error) {
      if (error instanceof Error && error.message === "binding-busy")
        return rejected("binding-busy");
      throw error;
    }
  }
  async #subscribe(
    bytes: Uint8Array,
    fingerprint: string,
    tenant: string | undefined,
    expiresAtMs: number,
  ): Promise<SubscriptionGatewayResult> {
    const reservation = this.#reserveCapacity();
    if ("kind" in reservation) return reservation;
    const controller = new AbortController();
    this.#pendingSubscribes.set(controller, reservation);
    let backend: BackendSubscriptionEnvelope | undefined;
    try {
      backend = await this.#receiveBackend(bytes, controller);
      if (backend === undefined) return rejected("denied");
      return await this.#retainBackend(
        backend,
        bytes,
        fingerprint,
        tenant,
        expiresAtMs,
        reservation,
        controller,
      );
    } finally {
      this.#pendingSubscribes.delete(controller);
      reservation.release();
      backend?.bytes.fill(0);
    }
  }
  #reserveCapacity(): SubscriptionCapacityReservation | SubscriptionGatewayResult {
    try {
      return this.#options.bindings.reserveCapacity();
    } catch (error) {
      return rejected(
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
    return withTimeout(
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
    tenant: string | undefined,
    expiresAtMs: number,
    reservation: SubscriptionCapacityReservation,
    controller: AbortController,
  ): Promise<SubscriptionGatewayResult> {
    if (backend.bytes.byteLength > this.#limits.maxBackendEnvelopeBytes) {
      await this.#compensate(backend.bytes, controller);
      return rejected("backend-envelope-too-large");
    }
    try {
      const binding = await this.#options.bindings.create({
        backend: envelope(backend.bytes),
        principalFingerprint: fingerprint,
        tenant,
        expiresAtMs,
        reservation,
      });
      return subscribed(binding.id, bytes);
    } catch (error) {
      return this.#failedCreation(error, backend.bytes, controller);
    }
  }
  async #failedCreation(
    error: unknown,
    bytes: Uint8Array,
    controller: AbortController,
  ): Promise<SubscriptionGatewayResult> {
    try {
      await this.#compensate(bytes, controller);
    } catch (disposeError) {
      throw new AggregateError(
        [error, disposeError],
        "subscription binding creation and disposal failed",
      );
    }
    return rejected(
      error instanceof Error && error.message === "binding-capacity-exceeded"
        ? "binding-capacity-exceeded"
        : "denied",
    );
  }
  async #compensate(bytes: Uint8Array, controller: AbortController): Promise<void> {
    const privateCopy = envelope(bytes);
    const compensation = controller.signal.aborted ? new AbortController() : controller;
    const timeoutMs =
      compensation === controller
        ? this.#limits.operationTimeoutMs
        : this.#limits.shutdownTimeoutMs;
    try {
      await withTimeout(
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
    tenant: string | undefined,
    nowMs: number,
    wire: PublicSubscriptionWire,
  ): Promise<void> {
    try {
      await this.#options.bindings.cancel({
        id,
        principalFingerprint: fingerprint,
        tenant,
        nowMs,
        onBackend: (backend, signal) => this.#forwardCancel(wire, backend, signal),
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
  ): Promise<void> {
    const privateWire = copyPublic(wire);
    try {
      const publicSubscription = fromBinary(SubscriptionSchema, wire.bytes);
      await this.#options.creator.activate(
        {
          wire: privateWire,
          backend,
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
    wire: PublicSubscriptionWire,
    backend: BackendSubscriptionEnvelope,
    signal: SubscriptionAbortSignal,
  ): Promise<void> {
    const privateWire = copyPublic(wire);
    try {
      await this.#options.creator.cancel({ wire: privateWire, backend }, signal);
    } finally {
      privateWire.bytes.fill(0);
    }
  }
}
async function discardUpdate(update: SubscriptionUpdateWire): Promise<void> {
  update.bytes.fill(0);
}
function envelope(bytes: Uint8Array): BackendSubscriptionEnvelope {
  return { kind: "backend-subscription-envelope", bytes: bytes.slice() };
}
function copyPublic(wire: PublicSubscriptionWire): PublicSubscriptionWire {
  return { kind: wire.kind, bytes: wire.bytes.slice() };
}
function subscribed(id: string, topicBytes: Uint8Array): SubscriptionGatewayResult {
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
}
function decode(
  kind: "subscribe" | "activate" | "cancel",
  bytes: Uint8Array,
  transport: TransportRequestContext,
): Extract<IncomingRequest, { readonly kind: typeof kind }> | undefined {
  const result = decodeIncomingRequest({ kind, value: bytes.slice(), transport });
  return result?.kind === kind ? result : undefined;
}
function trustedContext(context: Awaited<ReturnType<ContextResolver["resolve"]>>): ActorContext {
  return create(ActorContextSchema, {
    actor: context.actor,
    timestamp: context.timestamp,
    ...(context.tenant === undefined ? {} : { tenantId: context.tenant }),
    ...(context.zoneId === undefined ? {} : { zoneId: context.zoneId }),
    ...(context.language === undefined ? {} : { language: context.language }),
  });
}
function matches(requested: ActorContext, trusted: ActorContext): boolean {
  return (
    requested.actor?.value === trusted.actor?.value &&
    tenantBytesEqual(requested.tenantId, trusted.tenantId)
  );
}
function tenantBytesEqual(
  left: Parameters<typeof toBinary<typeof TenantIdSchema>>[1] | undefined,
  right: Parameters<typeof toBinary<typeof TenantIdSchema>>[1] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const first = toBinary(TenantIdSchema, left);
  const second = toBinary(TenantIdSchema, right);
  return (
    first.byteLength === second.byteLength && first.every((byte, index) => byte === second[index])
  );
}
function rewrite(
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
    subscription.topic === undefined ? create(TopicSchema) : clone(TopicSchema, subscription.topic);
  topic.context = clone(ActorContextSchema, context);
  subscription.topic = topic;
  return toBinary(SubscriptionSchema, subscription);
}
function operationFor(
  request: SubscriptionGatewayRequest,
): "subscribe" | "activate" | "cancel" | undefined {
  if (request.service !== "spine.client.SubscriptionService") return undefined;
  if (request.method === "Subscribe" && request.wire.kind === "subscription-topic")
    return "subscribe";
  if (request.method === "Activate" && request.wire.kind === "public-subscription")
    return "activate";
  if (request.method === "Cancel" && request.wire.kind === "public-subscription") return "cancel";
  return undefined;
}
function snapshotTransport(request: SubscriptionGatewayRequest): TransportRequestContext {
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
}
function rejected(
  reason: Extract<SubscriptionGatewayResult, { readonly kind: "rejected" }>["reason"],
): SubscriptionGatewayResult {
  return { kind: "rejected", reason };
}
function tenantFingerprint(tenant: Parameters<typeof toBinary<typeof TenantIdSchema>>[1]): string {
  return [...toBinary(TenantIdSchema, tenant)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function timestampMs(seconds: bigint, nanos: number): number | undefined {
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
}
function limits(input: SubscriptionGatewayLimits | undefined): Required<SubscriptionGatewayLimits> {
  const value = { ...defaultLimits, ...input };
  for (const limit of Object.values(value))
    if (!Number.isSafeInteger(limit) || limit <= 0)
      throw new Error("subscription limits must be positive safe integers");
  return value;
}
function admit(
  request: SubscriptionGatewayRequest,
  limit: Required<SubscriptionGatewayLimits>,
): SubscriptionGatewayRequest | undefined {
  if (request.wire.bytes.byteLength > limit.maxRequestBytes) return undefined;
  return {
    service: `${request.service}`,
    method: `${request.method}`,
    wire: { kind: request.wire.kind, bytes: request.wire.bytes.slice() },
    credential: { kind: request.credential.kind, value: `${request.credential.value}` },
    transport: snapshotTransport(request),
    ...(request.updates === undefined ? {} : { updates: request.updates }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}
function timeout(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
async function withTimeout<T>(
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
      () => reject(new Error("subscription operation aborted")),
      { once: true },
    );
  });
  try {
    return await Promise.race([effect, expiry, aborted]);
  } finally {
    clearTimeout(handle);
  }
}
