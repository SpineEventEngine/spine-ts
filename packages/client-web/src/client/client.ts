import { clone, create, toBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema, type Any } from "@bufbuild/protobuf/wkt";
import { createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";
import { packAny, packCommand, unpackAny, type MessageSchema } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  TenantIdSchema,
  UserIdSchema,
  ZoneIdSchema,
  type ActorContext,
  type Status,
  type TenantId,
  type ZoneId,
} from "@spine-event-engine/proto";
import {
  CommandService,
  QuerySchema,
  QueryService,
  SubscriptionService,
  SubscriptionUpdateSchema,
  TopicSchema,
  type Query,
  type QueryResponse,
  type Subscription as WireSubscription,
  type SubscriptionUpdate,
  type Topic,
} from "@spine-event-engine/proto/client";

/** A valid application-level command outcome. */
export type ClientOutcome =
  | Readonly<{ readonly kind: "ok" }>
  | Readonly<{ readonly kind: "error"; readonly error: Message }>
  | Readonly<{ readonly kind: "rejection"; readonly rejection: Message }>;

/** Options shared by client operations. */
export interface ClientOperationOptions {
  readonly signal?: AbortSignal;
}

/** Immutable context selected when a client is created. */
export interface ClientOptions {
  readonly tenant?: string | TenantId;
  readonly zoneId?: string | ZoneId;
  readonly subscriptions?: SubscriptionRuntimeOptions;
}

/** Bounded retry and scheduling configuration reserved for the A4 lifecycle runtime. */
export interface SubscriptionRuntimeOptions {
  readonly updateBufferCapacity?: number;
  readonly updateBufferByteCapacity?: number;
  readonly lifecycleBufferCapacity?: number;
  readonly retryPolicy?: SubscriptionRetryPolicy;
  readonly scheduler?: SubscriptionScheduler;
}

/** Finite retry settings for retries after the initial subscription attempt. */
export interface SubscriptionRetryPolicy {
  readonly maxAttempts: number;
  readonly maxElapsedMs: number;
  delayMs(attempt: number): number;
}

/** Timer seam reserved for deterministic A4 reconnect scheduling. */
export interface SubscriptionScheduler {
  now(): number;
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

/** An event subscription does not perform authoritative state recovery. */
export interface EventSubscriptionOptions extends ClientOperationOptions {
  readonly kind: "event";
}

/** An entity subscription supplies the query used for later authoritative recovery. */
export interface EntitySubscriptionOptions extends ClientOperationOptions {
  readonly kind: "entity";
  readonly authoritativeQuery: () => Query | { build(): Query };
}

/** Explicit kind and recovery information required to create a subscription. */
export type CreateSubscriptionOptions = EventSubscriptionOptions | EntitySubscriptionOptions;

/** A delivered raw wire update or an authoritative entity recovery result. */
export type SubscriptionDelivery =
  | Readonly<{ readonly kind: "update"; readonly update: SubscriptionUpdate }>
  | Readonly<{ readonly kind: "resynchronization"; readonly response: QueryResponse }>;

/** A lifecycle state emitted independently for one logical subscription. */
export type SubscriptionLifecycleState =
  "connecting" | "connected" | "resynchronizing" | "gapPossible" | "failed" | "closed";

export type SubscriptionLifecycle =
  /** A generation is starting; `attempt` counts retries after its initial attempt. */
  | Readonly<{
      readonly state: "connecting";
      readonly generation: number;
      readonly attempt: number;
    }>
  /** A non-terminal lifecycle transition, identified by its generation. */
  | Readonly<{
      readonly state: "connected" | "resynchronizing" | "gapPossible";
      readonly generation: number;
    }>
  /** A terminal cancellation for a generation. */
  | Readonly<{ readonly state: "closed"; readonly generation: number }>
  /** A terminal failure for a generation, carrying its exact failure object. */
  | Readonly<{ readonly state: "failed"; readonly generation: number; readonly error: Error }>;

/** Supplies fresh application-owned request metadata synchronously for one outbound call. */
export type OnRequestMetadata = () => HeadersInit;

/** Browser factory options, including an optional per-call metadata supplier. */
export interface BrowserClientOptions extends ClientOptions {
  readonly onRequestMetadata?: OnRequestMetadata;
}

/** Transport and request-ID source injected by an application or platform adapter. */
export interface ClientTransport {
  readonly transport: Transport;
  /** Creates a non-empty identifier for each outbound command. */
  createRequestId(): string;
  /** Releases a platform transport owned by this client, after client work settles. */
  close?(): void;
}

/** A manually activated protocol subscription. */
export interface Subscription {
  /** Raw updates and authoritative entity recovery results for one consumer. */
  readonly updates: AsyncIterable<SubscriptionDelivery>;
  /** Independent lifecycle notices for one consumer. */
  readonly lifecycle: AsyncIterable<SubscriptionLifecycle>;
  /** Starts the remote subscription and makes its updates available for iteration. */
  activate(options?: ClientOperationOptions): Promise<void>;
  /** Ends local iteration and performs one bounded remote cancellation. */
  cancel(): Promise<void>;
}

/** Thrown for a service response that violates the frozen wire contract. */
export class ClientProtocolError extends Error {
  constructor(message: string) {
    super(`Client protocol error: ${message}`);
    this.name = "ClientProtocolError";
  }
}

/** Internal marker selecting the terminal overflow path without inspecting error text. */
class SubscriptionBufferOverflowError extends ClientProtocolError {}

/** Browser-safe Spine client whose transport and ID source are supplied by the caller. */
export class Client {
  readonly #owner: ClientOwner;
  readonly #tenant: TenantId | undefined;
  readonly #zoneId: ZoneId;
  readonly #subscriptions: RequiredSubscriptionRuntimeOptions;

  protected constructor(source: ClientTransport, options: ClientOptions) {
    this.#owner = new ClientOwner(source);
    this.#tenant = tenant(options.tenant);
    this.#zoneId = zoneId(options.zoneId);
    this.#subscriptions = subscriptionRuntimeOptions(options.subscriptions);
  }

  /** Create a client from an injected transport and request-ID source. */
  static usingTransport(source: ClientTransport, options: ClientOptions = {}): Client {
    return new Client(source, options);
  }

  /** Create a browser client that always uses the gRPC-Web protocol. */
  static forGrpcWeb(baseUrl: string, options: BrowserClientOptions = {}): Client {
    return new Client(
      browserSource(createGrpcWebTransport(browserTransportOptions(baseUrl, options))),
      options,
    );
  }

  /** Create a browser client that always uses the Connect protocol. */
  static forConnect(baseUrl: string, options: BrowserClientOptions = {}): Client {
    return new Client(
      browserSource(createConnectTransport(browserTransportOptions(baseUrl, options))),
      options,
    );
  }

  /** Create an immutable request scope for the guest actor. */
  asGuest(): ClientRequest {
    return new Request(this.#owner, this.#tenant, this.#zoneId, this.#subscriptions, "guest");
  }

  /** Create an immutable request scope for one actor. */
  onBehalfOf(user: string): ClientRequest {
    if (user.length === 0) throw new TypeError("Client actor must not be empty.");
    return new Request(this.#owner, this.#tenant, this.#zoneId, this.#subscriptions, user);
  }

  /** Cancel open work and close an owned platform transport once. */
  close(): Promise<void> {
    return this.#owner.close();
  }
}

/** Immutable actor scope for one client lifecycle owner. */
export interface ClientRequest {
  /** Posts a command and returns its validated application-level outcome. */
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options?: ClientOperationOptions,
  ): Promise<ClientOutcome>;
  /** Sends a query after applying this scope's immutable actor context. */
  send(query: Query | { build(): Query }, options?: ClientOperationOptions): Promise<QueryResponse>;
  /** Creates an inactive topic subscription owned by this client lifecycle. */
  createSubscription(topic: Topic, options: CreateSubscriptionOptions): Promise<Subscription>;
}

class Request implements ClientRequest {
  readonly #owner: ClientOwner;
  readonly #tenant: TenantId | undefined;
  readonly #zoneId: ZoneId;
  readonly #subscriptions: RequiredSubscriptionRuntimeOptions;
  readonly #actor: string;

  constructor(
    owner: ClientOwner,
    selectedTenant: TenantId | undefined,
    selectedZoneId: ZoneId,
    subscriptions: RequiredSubscriptionRuntimeOptions,
    actor: string,
  ) {
    this.#owner = owner;
    this.#tenant = selectedTenant;
    this.#zoneId = selectedZoneId;
    this.#subscriptions = subscriptions;
    this.#actor = actor;
  }

  async post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientOperationOptions = {},
  ): Promise<ClientOutcome> {
    return this.#owner.run(options.signal, async (signal) => {
      const id = this.#owner.createRequestId();
      if (id.length === 0) throw new ClientProtocolError("request ID is missing or invalid.");
      const command = packCommand({
        id: create(CommandIdSchema, { uuid: id }),
        context: create(CommandContextSchema, { actorContext: this.#context() }),
        schema,
        message,
      });
      const ack = await createClient(CommandService, this.#owner.transport).post(command, {
        signal,
      });
      validateAckId(ack.messageId, id);
      return outcome(ack.status?.status);
    });
  }

  async send(
    queryOrBuilder: Query | { build(): Query },
    options: ClientOperationOptions = {},
  ): Promise<QueryResponse> {
    return this.#owner.run(options.signal, async (signal) => {
      const source = "build" in queryOrBuilder ? queryOrBuilder.build() : queryOrBuilder;
      const query = clone(QuerySchema, source);
      query.context = this.#context();
      return createClient(QueryService, this.#owner.transport).read(query, { signal });
    });
  }

  async createSubscription(
    topic: Topic,
    options: CreateSubscriptionOptions,
  ): Promise<Subscription> {
    validateSubscriptionOptions(topic, options);
    return this.#owner.run(options.signal, async (signal) => {
      const prepared = cloneTopic(topic, this.#context());
      return new TopicSubscription(this.#owner, prepared, signal, options, this.#subscriptions);
    });
  }

  #context(): ActorContext {
    return create(ActorContextSchema, {
      ...(this.#tenant === undefined ? {} : { tenantId: clone(TenantIdSchema, this.#tenant) }),
      zoneId: clone(ZoneIdSchema, this.#zoneId),
      actor: create(UserIdSchema, { value: this.#actor }),
      timestamp: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1_000)) }),
    });
  }
}

class ClientOwner {
  readonly transport: Transport;
  readonly #source: ClientTransport;
  readonly #controllers = new Set<AbortController>();
  readonly #subscriptions = new Set<TopicSubscription>();
  #closed = false;
  #close: Promise<void> | undefined;

  constructor(source: ClientTransport) {
    this.#source = source;
    this.transport = source.transport;
  }
  createRequestId(): string {
    return this.#source.createRequestId();
  }
  async run<Result>(
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    this.assertOpen();
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    this.#controllers.add(controller);
    try {
      const result = await work(controller.signal);
      this.assertOpen();
      return result;
    } finally {
      this.#controllers.delete(controller);
      signal?.removeEventListener("abort", abort);
    }
  }
  async close(): Promise<void> {
    return (this.#close ??= this.closeOwned());
  }
  add(subscription: TopicSubscription): void {
    this.assertOpen();
    this.#subscriptions.add(subscription);
  }
  remove(subscription: TopicSubscription): void {
    this.#subscriptions.delete(subscription);
  }
  assertOpen(): void {
    if (this.#closed) throw new ClientProtocolError("client is closing.");
  }
  async closeOwned(): Promise<void> {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort();
    const failures: unknown[] = [];
    try {
      const settled = await Promise.allSettled(
        [...this.#subscriptions].map((subscription) => subscription.cancel()),
      );
      failures.push(
        ...settled.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
      );
    } finally {
      try {
        this.#source.close?.();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        `Client close cleanup failed: ${failures.map((failure) => String(failure)).join("; ")}`,
      );
  }
}

class TopicSubscription implements Subscription {
  readonly #owner: ClientOwner;
  readonly #topic: Topic;
  readonly #signal: AbortSignal;
  /** Retained for generation-aware entity recovery in A4.3. */
  readonly #options: CreateSubscriptionOptions;
  /** Retained for generation-owned retry and scheduling in A4.2/A4.3. */
  readonly #runtime: RequiredSubscriptionRuntimeOptions;
  readonly #updates: BoundedChannel<SubscriptionDelivery>;
  readonly #lifecycle: BoundedChannel<SubscriptionLifecycle>;
  readonly #controller = new AbortController();
  #wire: WireSubscription | undefined;
  #cancelled = false;
  #generation = 0;
  #terminal = false;
  #wireCleanup: Readonly<{ wire: WireSubscription; promise: Promise<void> }> | undefined;
  #activation: Promise<void> | undefined;
  #cancellation: Promise<void> | undefined;
  #streamIterator: AsyncIterator<SubscriptionUpdate> | undefined;

  constructor(
    owner: ClientOwner,
    topic: Topic,
    signal: AbortSignal,
    options: CreateSubscriptionOptions,
    runtime: RequiredSubscriptionRuntimeOptions,
  ) {
    this.#owner = owner;
    this.#topic = topic;
    this.#signal = signal;
    this.#options = options;
    this.#runtime = runtime;
    this.#updates = new BoundedChannel(
      "subscription update",
      runtime.updateCapacity,
      runtime.updateByteCapacity,
    );
    this.#lifecycle = new BoundedChannel("subscription lifecycle", runtime.lifecycleCapacity);
    owner.add(this);
  }

  get updates(): AsyncIterable<SubscriptionDelivery> {
    return this.#updates;
  }
  get lifecycle(): AsyncIterable<SubscriptionLifecycle> {
    return this.#lifecycle;
  }

  async activate(options: ClientOperationOptions = {}): Promise<void> {
    this.#owner.assertOpen();
    if (this.#cancelled) throw new ClientProtocolError("subscription is cancelled.");
    await (this.#activation ??= this.#activateOwned(options.signal));
  }

  cancel(): Promise<void> {
    return (this.#cancellation ??= this.#cancelOwned());
  }

  async #activateOwned(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    if (this.#signal.aborted) throw this.#signal.reason;
    const generation = ++this.#generation;
    const abort = () => this.#controller.abort(signal?.reason ?? this.#signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    this.#signal.addEventListener("abort", abort, { once: true });
    try {
      this.#pushLifecycle({ state: "connecting", generation, attempt: 0 });
      const pendingSubscription = createClient(
        SubscriptionService,
        this.#owner.transport,
      ).subscribe(this.#topic, { signal: this.#controller.signal });
      const subscription = await raceTerminal(pendingSubscription, this.#controller.signal, () =>
        cancelLateSubscription(pendingSubscription, this.#owner.transport),
      );
      this.#wire = subscription;
      validateSubscription(subscription, this.#topic);
      if (this.#cancelled || generation !== this.#generation) {
        await this.#cancelWireOnce(subscription);
        throw new ClientProtocolError("subscription is cancelled.");
      }
      const updates = createClient(SubscriptionService, this.#owner.transport).activate(
        subscription,
        {
          signal: this.#controller.signal,
        },
      );
      const iterator = updates[Symbol.asyncIterator]();
      this.#streamIterator = iterator;
      void this.consumeUpdates(iterator, subscription, generation).catch(() => undefined);
      if (this.#cancelled || generation !== this.#generation) {
        await this.#cancelWireOnce(subscription);
        throw new ClientProtocolError("subscription is cancelled.");
      }
      this.#pushLifecycle({ state: "connected", generation });
    } catch (error) {
      if (this.#cancelled) throw error;
      this.#failStreams(error, generation);
      let cleanupFailure: unknown;
      try {
        if (this.#wire !== undefined && !this.#cancelled) await this.#cancelWireOnce(this.#wire);
      } catch (cleanupError) {
        cleanupFailure = cleanupError;
      } finally {
        this.#cancelled = true;
        this.#owner.remove(this);
      }
      if (cleanupFailure !== undefined)
        throw new AggregateError(
          [error, cleanupFailure],
          "Subscription activation cleanup failed.",
        );
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.#signal.removeEventListener("abort", abort);
    }
  }

  async #cancelOwned(): Promise<void> {
    this.#cancelled = true;
    this.#generation++;
    this.#updates.discard();
    this.#finishLifecycle({ state: "closed", generation: this.#generation - 1 });
    this.#controller.abort();
    this.#disposeLateIterator();
    try {
      if (this.#wire !== undefined) await this.#cancelWireOnce(this.#wire);
    } finally {
      this.#owner.remove(this);
    }
  }

  async consumeUpdates(
    updates: AsyncIterator<SubscriptionUpdate>,
    subscription: WireSubscription,
    generation: number,
  ): Promise<void> {
    try {
      while (true) {
        const next = await raceTerminal(updates.next(), this.#controller.signal);
        if (next.done) throw new ClientProtocolError("subscription stream ended unexpectedly.");
        if (this.#cancelled || generation !== this.#generation) return;
        const update = next.value;
        validateSubscription(update.subscription, subscription.topic!);
        if (update.subscription?.id?.value !== subscription.id?.value)
          throw new ClientProtocolError(
            "subscription update ID does not match the accepted subscription.",
          );
        this.#pushUpdate(
          freezeDelivery({ kind: "update", update: clone(SubscriptionUpdateSchema, update) }),
          toBinary(SubscriptionUpdateSchema, update).byteLength,
        );
      }
    } catch (error) {
      if (this.#cancelled) return;
      this.#failStreams(error, generation);
      try {
        await this.#cancelAfterFailure();
      } catch {
        // The stream's original terminal error remains observable; cleanup is best effort.
      }
    } finally {
      this.#updates.close();
      this.#lifecycle.close();
      this.#owner.remove(this);
      if (this.#streamIterator === updates) this.#streamIterator = undefined;
    }
  }

  async #cancelAfterFailure(): Promise<void> {
    this.#cancelled = true;
    try {
      if (this.#wire !== undefined) await this.#cancelWireOnce(this.#wire);
    } finally {
      this.#owner.remove(this);
    }
  }

  #pushUpdate(value: SubscriptionDelivery, bytes: number): void {
    const error = this.#updates.push(value, bytes);
    if (error !== undefined) throw error;
  }

  #pushLifecycle(value: SubscriptionLifecycle): void {
    const error = this.#lifecycle.push(value);
    if (error !== undefined) throw error;
  }

  #failStreams(error: unknown, generation: number): void {
    const terminalError = error instanceof Error ? error : new Error(String(error));
    this.#updates.fail(terminalError);
    if (terminalError instanceof SubscriptionBufferOverflowError) {
      this.#terminal = true;
      this.#lifecycle.fail(terminalError);
      return;
    }
    if (this.#terminal) return;
    this.#terminal = true;
    this.#finishLifecycle({
      state: "failed",
      generation,
      error: terminalError,
    });
  }

  #finishLifecycle(value: SubscriptionLifecycle): void {
    if (this.#terminal && value.state === "closed") return;
    this.#terminal = true;
    this.#lifecycle.finish(value);
  }

  #cancelWireOnce(subscription: WireSubscription): Promise<void> {
    if (this.#wireCleanup?.wire === subscription) return this.#wireCleanup.promise;
    const promise = cancelWire(this.#owner.transport, subscription);
    this.#wireCleanup = { wire: subscription, promise };
    return promise;
  }

  #disposeLateIterator(): void {
    const iterator = this.#streamIterator;
    if (iterator === undefined) return;
    try {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    } catch {
      // Local terminal state must not depend on a non-cooperative iterator.
    }
  }
}

const CLEANUP_TIMEOUT_MS = 1_000;

function raceTerminal<Value>(
  pending: Promise<Value>,
  signal: AbortSignal,
  onTerminal?: () => void,
): Promise<Value> {
  if (signal.aborted) {
    void pending.catch(() => undefined);
    onTerminal?.();
    return Promise.reject(signal.reason);
  }
  const terminal = Promise.withResolvers<never>();
  const abort = () => terminal.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  return Promise.race([pending, terminal.promise])
    .catch((error: unknown) => {
      if (signal.aborted) onTerminal?.();
      throw error;
    })
    .finally(() => signal.removeEventListener("abort", abort));
}

/** Cancels a wire accepted after its local subscription has already terminated. */
function cancelLateSubscription(pending: Promise<WireSubscription>, transport: Transport): void {
  void pending.then((subscription) => cancelWire(transport, subscription)).catch(() => undefined);
}

async function cancelWire(transport: Transport, subscription: WireSubscription): Promise<void> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ClientProtocolError("subscription cleanup timed out."));
    }, CLEANUP_TIMEOUT_MS);
  });
  const remote = createClient(SubscriptionService, transport).cancel(subscription, {
    signal: controller.signal,
  });
  void remote.catch(() => undefined);
  try {
    await Promise.race([remote, timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

interface RequiredSubscriptionRuntimeOptions {
  readonly updateCapacity: number;
  readonly updateByteCapacity: number;
  readonly lifecycleCapacity: number;
  readonly retryPolicy: SubscriptionRetryPolicy;
  readonly scheduler: SubscriptionScheduler;
}

function subscriptionRuntimeOptions(
  options: SubscriptionRuntimeOptions | undefined,
): RequiredSubscriptionRuntimeOptions {
  return {
    updateCapacity: positiveSubscriptionOption(
      options?.updateBufferCapacity,
      64,
      "update buffer capacity",
    ),
    updateByteCapacity: positiveSubscriptionOption(
      options?.updateBufferByteCapacity,
      1_048_576,
      "update buffer byte capacity",
    ),
    lifecycleCapacity: positiveSubscriptionOption(
      options?.lifecycleBufferCapacity,
      32,
      "lifecycle buffer capacity",
    ),
    retryPolicy: retryPolicy(options?.retryPolicy),
    scheduler: scheduler(options?.scheduler),
  };
}

const DEFAULT_RETRY_POLICY: SubscriptionRetryPolicy = {
  maxAttempts: 5,
  maxElapsedMs: 30_000,
  delayMs(attempt: number): number {
    const bounded = Math.min(5_000, 250 * 2 ** Math.max(0, attempt - 1));
    return Math.min(5_000, Math.max(1, Math.round(bounded * (0.8 + Math.random() * 0.4))));
  },
};

const DEFAULT_SUBSCRIPTION_SCHEDULER: SubscriptionScheduler = {
  now: () => Date.now(),
  wait: (delayMs, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timeout = setTimeout(resolve, delayMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(signal.reason);
        },
        { once: true },
      );
    }),
};

function retryPolicy(policy: SubscriptionRetryPolicy | undefined): SubscriptionRetryPolicy {
  const resolved = policy ?? DEFAULT_RETRY_POLICY;
  if (!Number.isSafeInteger(resolved.maxAttempts) || resolved.maxAttempts <= 0)
    throw new TypeError("Client subscription retry max attempts must be a positive safe integer.");
  if (!Number.isSafeInteger(resolved.maxElapsedMs) || resolved.maxElapsedMs <= 0)
    throw new TypeError(
      "Client subscription retry max elapsed time must be a positive safe integer.",
    );
  if (typeof resolved.delayMs !== "function")
    throw new TypeError("Client subscription retry delay must be a function.");
  for (let attempt = 1; attempt <= resolved.maxAttempts; attempt++) {
    const delay = resolved.delayMs(attempt);
    if (!Number.isSafeInteger(delay) || delay <= 0)
      throw new TypeError("Client subscription retry delay must be a positive safe integer.");
  }
  return resolved;
}

function scheduler(scheduler: SubscriptionScheduler | undefined): SubscriptionScheduler {
  const resolved = scheduler ?? DEFAULT_SUBSCRIPTION_SCHEDULER;
  if (typeof resolved.now !== "function" || typeof resolved.wait !== "function")
    throw new TypeError("Client subscription scheduler must provide now() and wait().");
  const now = resolved.now();
  if (!Number.isSafeInteger(now) || now < 0)
    throw new TypeError("Client subscription scheduler time must be a non-negative safe integer.");
  return resolved;
}

function positiveSubscriptionOption(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0)
    throw new TypeError(`Client subscription ${name} must be a positive safe integer.`);
  return resolved;
}

function validateSubscriptionOptions(
  topic: Topic,
  options: CreateSubscriptionOptions,
): CreateSubscriptionOptions {
  if (options === undefined || (options.kind !== "event" && options.kind !== "entity"))
    throw new TypeError("Subscription kind must be 'event' or 'entity'.");
  if (options.kind === "event") {
    if ("authoritativeQuery" in options)
      throw new TypeError("Event subscriptions must not provide an authoritative query.");
    return options;
  }
  if (typeof options.authoritativeQuery !== "function")
    throw new TypeError("Entity subscriptions require an authoritative query.");
  return options;
}

class BoundedChannel<Value> implements AsyncIterable<Value> {
  readonly #name: string;
  readonly #capacity: number;
  readonly #byteCapacity: number | undefined;
  readonly #values: Array<Readonly<{ value: Value; bytes: number }>> = [];
  #bytes = 0;
  #consumer = false;
  #closed = false;
  #error: unknown;
  #pending: PromiseWithResolvers<IteratorResult<Value>> | undefined;

  constructor(name: string, capacity: number, byteCapacity?: number) {
    this.#name = name;
    this.#capacity = capacity;
    this.#byteCapacity = byteCapacity;
  }

  push(value: Value, bytes = 0): ClientProtocolError | undefined {
    if (this.#closed || this.#error !== undefined)
      return new ClientProtocolError(`${this.#name} stream is closed.`);
    if (
      this.#values.length >= this.#capacity ||
      this.#bytes + bytes > (this.#byteCapacity ?? Infinity)
    ) {
      return new SubscriptionBufferOverflowError(`${this.#name} buffer overflow.`);
    }
    if (this.#pending !== undefined) {
      this.#pending.resolve({ done: false, value });
      this.#pending = undefined;
      return undefined;
    }
    this.#values.push({ value, bytes });
    this.#bytes += bytes;
    return undefined;
  }

  /** Ends after already accepted values have been consumed. */
  close(): void {
    this.#closed = true;
    if (this.#values.length === 0 && this.#error === undefined) {
      this.#pending?.resolve({ done: true, value: undefined });
      this.#pending = undefined;
    }
  }

  /** Discards buffered values for explicit local cancellation. */
  discard(): void {
    this.#closed = true;
    this.#values.length = 0;
    this.#bytes = 0;
    if (this.#error === undefined) {
      this.#pending?.resolve({ done: true, value: undefined });
      this.#pending = undefined;
    }
  }

  /**
   * Appends one terminal notice after the configured non-terminal capacity, then ends.
   * The terminal slot is bounded and never displaces an admitted lifecycle notice.
   */
  finish(value: Value): void {
    if (this.#error !== undefined) return;
    this.#closed = true;
    if (this.#pending !== undefined) {
      this.#pending.resolve({ done: false, value });
      this.#pending = undefined;
      return;
    }
    this.#values.push({ value, bytes: 0 });
  }

  fail(error: unknown): void {
    if (this.#error !== undefined) return;
    this.#error = error;
    this.#values.length = 0;
    this.#pending?.reject(error);
    this.#pending = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<Value> {
    if (this.#consumer)
      throw new ClientProtocolError(`${this.#name} stream has a single consumer.`);
    this.#consumer = true;
    return { next: () => this.next() };
  }

  next(): Promise<IteratorResult<Value>> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    const entry = this.#values.shift();
    if (entry !== undefined) {
      this.#bytes -= entry.bytes;
      return Promise.resolve({ done: false, value: entry.value });
    }
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    if (this.#pending !== undefined)
      return Promise.reject(
        new ClientProtocolError(`${this.#name} stream allows only one pending next() call.`),
      );
    this.#pending = Promise.withResolvers<IteratorResult<Value>>();
    return this.#pending.promise;
  }
}

function freezeDelivery(
  delivery: Extract<SubscriptionDelivery, { readonly kind: "update" }>,
): SubscriptionDelivery {
  return Object.freeze({ ...delivery, update: deepFreeze(delivery.update) });
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function browserSource(transport: Transport): ClientTransport {
  return { transport, createRequestId: browserRequestId };
}

function browserTransportOptions(
  baseUrl: string,
  options: BrowserClientOptions,
): { baseUrl: string; interceptors: Interceptor[] } {
  return {
    baseUrl,
    interceptors:
      options.onRequestMetadata === undefined ? [] : [requestMetadata(options.onRequestMetadata)],
  };
}

function requestMetadata(onRequestMetadata: OnRequestMetadata): Interceptor {
  return (next) => async (request) => {
    const metadata = new Headers(onRequestMetadata());
    for (const [name, value] of metadata) request.header.set(name, value);
    return next(request);
  };
}

function browserRequestId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== "function")
    throw new ClientProtocolError("secure random browser API is unavailable for request IDs.");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cloneTopic(topic: Topic, context: ActorContext): Topic {
  const prepared = structuredClone(topic);
  prepared.context = context;
  return prepared;
}

function validateSubscription(
  subscription: WireSubscription | undefined,
  expectedTopic: Topic,
): void {
  if (subscription === undefined || subscription.id?.value.length === 0)
    throw new ClientProtocolError("subscription ID is missing or invalid.");
  if (subscription.topic === undefined || !sameTopic(subscription.topic, expectedTopic))
    throw new ClientProtocolError("subscription topic does not match the requested topic.");
}

function sameTopic(left: Topic, right: Topic): boolean {
  const a = toBinary(TopicSchema, left);
  const b = toBinary(TopicSchema, right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function tenant(value: string | TenantId | undefined): TenantId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    if (value.kind.case !== "value" || value.kind.value.length === 0)
      throw new TypeError("Client tenant must not be empty.");
    return clone(TenantIdSchema, value);
  }
  if (value.length === 0) throw new TypeError("Client tenant must not be empty.");
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

function zoneId(value: string | ZoneId | undefined): ZoneId {
  if (typeof value !== "string" && value !== undefined) {
    if (value.value.length === 0) throw new TypeError("Client zoneId must not be empty.");
    return clone(ZoneIdSchema, value);
  }
  const zone = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone.length === 0) throw new TypeError("Client zoneId must not be empty.");
  return create(ZoneIdSchema, { value: zone });
}

function outcome(status: Status["status"] | undefined): ClientOutcome {
  if (status?.case === "ok") return Object.freeze({ kind: "ok" as const });
  if (status?.case === "error")
    return Object.freeze({ kind: "error" as const, error: cloneMessage(status.value) });
  if (status?.case === "rejection")
    return Object.freeze({ kind: "rejection" as const, rejection: cloneMessage(status.value) });
  throw new ClientProtocolError("response status is missing or invalid.");
}

function validateAckId(packed: Any | undefined, id: string): void {
  const commandId = packed === undefined ? undefined : unpackAny(packed, CommandIdSchema);
  if (commandId?.uuid !== id)
    throw new ClientProtocolError("acknowledgement command ID does not match the posted command.");
}

function cloneMessage(message: Message): Message {
  return structuredClone(message);
}
