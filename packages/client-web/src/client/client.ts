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
}

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
export interface Subscription extends AsyncIterable<SubscriptionUpdate> {
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

/** Browser-safe Spine client whose transport and ID source are supplied by the caller. */
export class Client {
  readonly #owner: ClientOwner;
  readonly #tenant: TenantId | undefined;
  readonly #zoneId: ZoneId;

  protected constructor(source: ClientTransport, options: ClientOptions) {
    this.#owner = new ClientOwner(source);
    this.#tenant = tenant(options.tenant);
    this.#zoneId = zoneId(options.zoneId);
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
    return new Request(this.#owner, this.#tenant, this.#zoneId, "guest");
  }

  /** Create an immutable request scope for one actor. */
  onBehalfOf(user: string): ClientRequest {
    if (user.length === 0) throw new TypeError("Client actor must not be empty.");
    return new Request(this.#owner, this.#tenant, this.#zoneId, user);
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
  createSubscription(topic: Topic, options?: ClientOperationOptions): Promise<Subscription>;
}

class Request implements ClientRequest {
  readonly #owner: ClientOwner;
  readonly #tenant: TenantId | undefined;
  readonly #zoneId: ZoneId;
  readonly #actor: string;

  constructor(
    owner: ClientOwner,
    selectedTenant: TenantId | undefined,
    selectedZoneId: ZoneId,
    actor: string,
  ) {
    this.#owner = owner;
    this.#tenant = selectedTenant;
    this.#zoneId = selectedZoneId;
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
    options: ClientOperationOptions = {},
  ): Promise<Subscription> {
    return this.#owner.run(options.signal, async (signal) => {
      const prepared = cloneTopic(topic, this.#context());
      return new TopicSubscription(this.#owner, prepared, signal);
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
  readonly #controller = new AbortController();
  #wire: WireSubscription | undefined;
  #updates: AsyncIterable<SubscriptionUpdate> | undefined;
  #cancelled = false;
  #activation: Promise<void> | undefined;
  #cancellation: Promise<void> | undefined;
  #streamIterator: AsyncIterator<SubscriptionUpdate> | undefined;
  readonly #terminated = Promise.withResolvers<void>();

  constructor(owner: ClientOwner, topic: Topic, signal: AbortSignal) {
    this.#owner = owner;
    this.#topic = topic;
    this.#signal = signal;
    owner.add(this);
  }

  async activate(options: ClientOperationOptions = {}): Promise<void> {
    this.#owner.assertOpen();
    if (this.#cancelled) throw new ClientProtocolError("subscription is cancelled.");
    await (this.#activation ??= this.#activateOwned(options.signal));
  }

  async cancel(): Promise<void> {
    return (this.#cancellation ??= this.#cancelOwned());
  }

  async #activateOwned(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    if (this.#signal.aborted) throw this.#signal.reason;
    const abort = () => this.#controller.abort(signal?.reason ?? this.#signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    this.#signal.addEventListener("abort", abort, { once: true });
    try {
      const subscription = await createClient(SubscriptionService, this.#owner.transport).subscribe(
        this.#topic,
        { signal: this.#controller.signal },
      );
      this.#wire = subscription;
      validateSubscription(subscription, this.#topic);
      if (this.#cancelled) {
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
      this.#updates = this.validatedUpdates(iterator, subscription);
    } catch (error) {
      let cleanupFailure: unknown;
      try {
        if (this.#wire !== undefined && !this.#cancelled) await this.cancelWire(this.#wire);
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
    this.#terminated.resolve();
    if (this.#updates === undefined) this.#controller.abort();
    try {
      try {
        await this.#activation;
      } catch {
        // Terminal cancellation owns activation failure and preserves its own completion.
      }
      if (this.#wire !== undefined) await this.cancelWire(this.#wire);
    } finally {
      this.#owner.remove(this);
    }
  }

  async cancelWire(subscription: WireSubscription): Promise<void> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new ClientProtocolError("subscription cleanup timed out."));
      }, CLEANUP_TIMEOUT_MS);
    });
    const remote = createClient(SubscriptionService, this.#owner.transport).cancel(subscription, {
      signal: controller.signal,
    });
    void remote.catch(() => undefined);
    try {
      await Promise.race([remote, timedOut]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async *validatedUpdates(
    updates: AsyncIterator<SubscriptionUpdate>,
    subscription: WireSubscription,
  ): AsyncIterable<SubscriptionUpdate> {
    try {
      while (true) {
        const next = await updates.next();
        if (next.done) return;
        const update = next.value;
        validateSubscription(update.subscription, subscription.topic!);
        if (update.subscription?.id?.value !== subscription.id?.value)
          throw new ClientProtocolError(
            "subscription update ID does not match the accepted subscription.",
          );
        yield update;
      }
    } catch (error) {
      if (this.#cancelled) return;
      await this.#cancelAfterFailure();
      throw error;
    } finally {
      this.#owner.remove(this);
      if (this.#streamIterator === updates) this.#streamIterator = undefined;
    }
  }

  async #cancelAfterFailure(): Promise<void> {
    this.#cancelled = true;
    try {
      if (this.#wire !== undefined) await this.cancelWire(this.#wire);
    } finally {
      this.#owner.remove(this);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SubscriptionUpdate> {
    if (this.#updates === undefined)
      throw new ClientProtocolError("subscription is not activated.");
    const iterator = this.#updates[Symbol.asyncIterator]();
    return {
      next: async () => {
        if (this.#cancelled) return { done: true, value: undefined };
        return Promise.race([
          iterator.next(),
          this.#terminated.promise.then(() => ({ done: true as const, value: undefined })),
        ]);
      },
      return: async () => {
        await this.cancel();
        await iterator.return?.();
        return { done: true as const, value: undefined };
      },
    };
  }
}

const CLEANUP_TIMEOUT_MS = 1_000;

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
