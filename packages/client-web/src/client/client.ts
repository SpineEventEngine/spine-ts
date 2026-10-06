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

import { clone, create, toBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { type Any } from "@bufbuild/protobuf/wkt";
import { createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { createConnectTransport, createGrpcWebTransport } from "@connectrpc/connect-web";
import { SignalEnvelopes, AnyMessages, Time } from "@spine-event-engine/core";
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
  QueryResponseSchema,
  QueryService,
  SubscriptionService,
  SubscriptionUpdateSchema,
  TargetSchema,
  TopicSchema,
  type Query,
  type QueryResponse,
  type Subscription as WireSubscription,
  type SubscriptionUpdate,
  type Topic,
} from "@spine-event-engine/proto/client";

/**
 * A valid application-level command outcome.
 */
export type ClientOutcome =
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a successful command.
       */
      readonly kind: "ok";
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a command that produced an application error.
       */
      readonly kind: "error";

      /**
       * Carries the application error message.
       */
      readonly error: Message;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a command rejected by application rules.
       */
      readonly kind: "rejection";

      /**
       * Carries the rejection message.
       */
      readonly rejection: Message;
    }>;

/**
 * Options shared by client operations.
 */
export interface ClientOperationOptions {
  // prettier-ignore

  /**
   * Cancels the operation when aborted.
   */
  readonly signal?: AbortSignal;
}

/**
 * Immutable context selected when a client is created.
 */
export interface ClientOptions {
  // prettier-ignore

  /**
   * Selects the tenant for all client requests.
   */
  readonly tenant?: string | TenantId;

  /**
   * Selects the time zone for all client requests.
   */
  readonly zoneId?: string | ZoneId;

  /**
   * Sets runtime behavior for created subscriptions.
   */
  readonly subscriptions?: SubscriptionRuntimeOptions;

  /**
   * Updates application credentials before one reconnect attempt.
   * @param signal Cancels the refresh when the reconnect attempt ends.
   * @returns Completes after the application refresh ends.
   */
  readonly onReauthenticateBeforeReconnect?: (signal: AbortSignal) => Promise<void>;
}

/**
 * Bounded queues, retry policy, and scheduling for subscription recovery.
 */
export interface SubscriptionRuntimeOptions {
  // prettier-ignore

  /**
   * Limits queued updates by count.
   */
  readonly updateBufferCapacity?: number;

  /**
   * Limits queued updates by serialized byte size.
   */
  readonly updateBufferByteCapacity?: number;

  /**
   * Limits queued lifecycle notices by count.
   */
  readonly lifecycleBufferCapacity?: number;

  /**
   * Sets bounded reconnect retries.
   */
  readonly retryPolicy?: SubscriptionRetryPolicy;

  /**
   * Supplies clock and wait behavior for retries.
   */
  readonly scheduler?: SubscriptionScheduler;
}

/**
 * Finite retry settings for retries after the initial subscription attempt.
 */
export interface SubscriptionRetryPolicy {
  // prettier-ignore

  /**
   * Limits retry attempts after the initial connection.
   */
  readonly maxAttempts: number;

  /**
   * Limits one recovery episode in milliseconds. A stream that remains
   * connected for at least this duration starts a fresh episode on its next
   * failure.
   */
  readonly maxElapsedMs: number;

  /**
   * Calculates the delay before a retry.
   * @param attempt Identifies the retry attempt starting at one.
   * @returns Returns the delay in milliseconds.
   */
  delayMs(attempt: number): number;
}

/**
 * Clock and abortable-wait seam used by deterministic reconnect scheduling.
 */
export interface SubscriptionScheduler {
  // prettier-ignore

  /**
   * Returns the current scheduler time in milliseconds.
   * @returns Returns the current time.
   */
  now(): number;

  /**
   * Waits for a retry delay unless cancelled.
   * @param delayMs Supplies the delay in milliseconds.
   * @param signal Cancels the wait.
   * @returns Completes when the delay ends or rejects on cancellation.
   */
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

/**
 * An event subscription does not perform authoritative state recovery.
 */
export interface EventSubscriptionOptions extends ClientOperationOptions {
  // prettier-ignore

  /**
   * Identifies this as an event subscription.
   */
  readonly kind: "event";
}

/**
 * An entity subscription supplies the query used for later authoritative recovery.
 */
export interface EntitySubscriptionOptions extends ClientOperationOptions {
  // prettier-ignore

  /**
   * Identifies this as an entity subscription.
   */
  readonly kind: "entity";

  /**
   * Builds the query used after a possible update gap.
   * @returns Returns the authoritative entity query.
   */
  readonly authoritativeQuery: () => Query | { build(): Query };
}

/**
 * Explicit kind and recovery information required to create a subscription.
 */
export type CreateSubscriptionOptions = EventSubscriptionOptions | EntitySubscriptionOptions;

/**
 * A delivered raw wire update or an authoritative entity recovery result.
 */
export type SubscriptionDelivery =
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a live subscription update.
       */
      readonly kind: "update";

      /**
       * Carries the live update.
       */
      readonly update: SubscriptionUpdate;
    }>
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies an authoritative recovery response.
       */
      readonly kind: "resynchronization";

      /**
       * Carries the recovered query response.
       */
      readonly response: QueryResponse;
    }>;

/**
 * A lifecycle state emitted independently for one logical subscription.
 */
export type SubscriptionLifecycleState =
  "connecting" | "connected" | "resynchronizing" | "gapPossible" | "failed" | "closed";

/**
 * Describes one lifecycle transition for a logical subscription.
 */
export type SubscriptionLifecycle =
  // prettier-ignore

  /**
   * A generation is starting; `attempt` counts retries after its initial attempt.
   */
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies initial connection.
       */
      readonly state: "connecting";

      /**
       * Identifies this logical subscription generation.
       */
      readonly generation: number;

      /**
       * Counts retries after the initial attempt.
       */
      readonly attempt: number;
    }>

  /**
   * A non-terminal lifecycle transition, identified by its generation.
   */
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies a non-terminal lifecycle transition.
       */
      readonly state: "connected" | "resynchronizing" | "gapPossible";

      /**
       * Identifies this logical subscription generation.
       */
      readonly generation: number;
    }>

  /**
   * A terminal cancellation for a generation.
   */
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies normal lifecycle closure.
       */ readonly state: "closed";

      /**
       * Identifies this logical subscription generation.
       */ readonly generation: number;
    }>

  /**
   * A terminal failure for a generation, carrying its exact failure object.
   */
  | Readonly<{
      // prettier-ignore

      /**
       * Identifies terminal lifecycle failure.
       */ readonly state: "failed";

      /**
       * Identifies this logical subscription generation.
       */ readonly generation: number;

      /**
       * Carries the terminal failure.
       */ readonly error: Error;
    }>;

/**
 * Returns fresh application-provided request metadata synchronously for one outbound call.
 * @returns Returns headers for the outbound call.
 */
export type OnRequestMetadata = () => HeadersInit;

/**
 * Browser factory options, including an optional per-call metadata supplier.
 */
export interface BrowserClientOptions extends ClientOptions {
  // prettier-ignore

  /**
   * Supplies request metadata for each browser transport call.
   */
  readonly onRequestMetadata?: OnRequestMetadata;

  /**
   * Browser Fetch credential mode for this explicit protocol transport.
   */
  readonly credentials?: RequestCredentials;
}

/**
 * Transport injected by an application or platform adapter.
 */
export interface ClientTransport {
  // prettier-ignore

  /**
   * Carries the Connect transport used for RPC calls.
   */
  readonly transport: Transport;

  /**
   * Closes the supplied platform transport after work settles.
   */
  close?(): void;
}

/**
 * A manually activated protocol subscription.
 */
export interface Subscription {
  // prettier-ignore

  /**
   * Raw updates and authoritative entity recovery results for one consumer.
   */
  readonly updates: AsyncIterable<SubscriptionDelivery>;

  /**
   * Independent lifecycle notices for one consumer.
   */
  readonly lifecycle: AsyncIterable<SubscriptionLifecycle>;

  /**
   * Starts the remote subscription and makes its updates available for iteration.
   * @param options Supplies cancellation options for activation.
   * @returns Completes after remote activation ends.
   */
  activate(options?: ClientOperationOptions): Promise<void>;

  /**
   * Cancels local iteration and performs one bounded remote cancellation.
   * @returns Completes after remote cancellation ends.
   */
  cancel(): Promise<void>;
}

/**
 * Thrown for a service response that violates the frozen wire contract.
 */
export class ClientProtocolError extends Error {
  // prettier-ignore

  /**
   * Creates an error for an invalid wire response.
   * @param message Explains the protocol violation.
   */
  constructor(message: string) {
    super(`Client protocol error: ${message}`);
    this.name = "ClientProtocolError";
  }
}

/**
 * Internal marker selecting the terminal overflow path without inspecting error text.
 */
class SubscriptionBufferOverflowError extends ClientProtocolError {}

/**
 * Internal marker for a transport stream that ended without terminal cancellation.
 */
class SubscriptionStreamEndedError extends ClientProtocolError {}

/**
 * Browser-safe Spine client whose transport is supplied by the caller.
 */
export class Client {
  readonly #owner: ClientOwner;

  readonly #tenant: TenantId | undefined;

  readonly #zoneId: ZoneId;

  readonly #subscriptions: RequiredSubscriptionRuntimeOptions;

  /**
   * Creates a browser client from a supplied transport and immutable options.
   *
   * @param source Supplies the browser-safe transport.
   * @param options Supplies optional tenant, zone, reconnect, and subscription settings.
   */
  protected constructor(source: ClientTransport, options: ClientOptions) {
    this.#owner = new ClientOwner(source, options.onReauthenticateBeforeReconnect);
    this.#tenant = BrowserClientValues.tenant(options.tenant);
    this.#zoneId = BrowserClientValues.zoneId(options.zoneId);
    this.#subscriptions = BrowserClientValues.subscriptionRuntimeOptions(options.subscriptions);
  }

  /**
   * Creates a client from an injected transport.
   * @param source Supplies the transport.
   * @param options Supplies immutable client options.
   * @returns Returns the created client.
   */
  static usingTransport(source: ClientTransport, options: ClientOptions = {}): Client {
    return new Client(source, options);
  }

  /**
   * Creates a browser client that always uses the gRPC-Web protocol.
   * @param baseUrl Supplies the gateway base URL.
   * @param options Supplies browser client options.
   * @returns Returns the created client.
   */
  static forGrpcWeb(baseUrl: string, options: BrowserClientOptions = {}): Client {
    return new Client(
      BrowserClientValues.browserSource(
        createGrpcWebTransport(BrowserClientValues.browserTransportOptions(baseUrl, options)),
      ),
      options,
    );
  }

  /**
   * Creates a browser client that always uses binary Connect (`application/proto`).
   *
   * The selected gateway must permit binary Connect, including packed `Any` command
   * and query values. Selection is explicit: this method never probes or falls back.
   * @param baseUrl Supplies the gateway base URL.
   * @param options Supplies browser client options.
   * @returns Returns the created client.
   */
  static forConnect(baseUrl: string, options: BrowserClientOptions = {}): Client {
    return new Client(
      BrowserClientValues.browserSource(
        createConnectTransport({
          ...BrowserClientValues.browserTransportOptions(baseUrl, options),
          useBinaryFormat: true,
        }),
      ),
      options,
    );
  }

  /**
   * Creates an immutable request scope for the guest actor.
   * @returns Returns the guest request scope.
   */
  asGuest(): ClientRequest {
    return new Request(this.#owner, this.#tenant, this.#zoneId, this.#subscriptions, "guest");
  }

  /**
   * Creates an immutable request scope for one actor.
   * @param user Identifies the actor for requests in the scope.
   * @returns Returns the actor request scope.
   */
  onBehalfOf(user: string): ClientRequest {
    if (user.length === 0) throw new TypeError("Client actor must not be empty.");
    return new Request(this.#owner, this.#tenant, this.#zoneId, this.#subscriptions, user);
  }

  /**
   * Closes the client by requesting open-work cancellation, awaiting subscription cleanup, and closing its transport.
   * @returns Completes after subscription cleanup and transport closure.
   */
  close(): Promise<void> {
    return this.#owner.close();
  }
}

/**
 * Immutable actor scope for one client lifecycle.
 */
export interface ClientRequest {
  // prettier-ignore

  /**
   * Posts a command and returns its validated application-level outcome.
   * @param schema Supplies the command message schema.
   * @param message Supplies the command message.
   * @param options Supplies cancellation options.
   * @returns Returns the validated command outcome.
   * @typeParam Schema The domain schema that determines the accepted message shape.
   */
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options?: ClientOperationOptions,
  ): Promise<ClientOutcome>;

  /**
   * Sends a query after applying this scope's immutable actor context.
   * @param query Supplies a query or its builder.
   * @param options Supplies cancellation options.
   * @returns Returns the query response.
   */
  send(query: Query | { build(): Query }, options?: ClientOperationOptions): Promise<QueryResponse>;

  /**
   * Creates an inactive topic subscription registered for client cleanup.
   * @param topic Supplies the subscription topic.
   * @param options Supplies the subscription kind and recovery options.
   * @returns Returns the inactive subscription.
   */
  createSubscription(topic: Topic, options: CreateSubscriptionOptions): Promise<Subscription>;
}

/**
 * Keeps an actor and fixed tenant and zone settings for fresh request contexts.
 */
class Request implements ClientRequest {
  readonly #owner: ClientOwner;

  readonly #tenant: TenantId | undefined;

  readonly #zoneId: ZoneId;

  readonly #subscriptions: RequiredSubscriptionRuntimeOptions;

  readonly #actor: string;

  /**
   * Captures the selected actor and immutable request settings.
   *
   * @param owner The client lifecycle coordinator for this scope.
   * @param selectedTenant The tenant copied into fresh actor contexts when present.
   * @param selectedZoneId The zone copied into fresh actor contexts.
   * @param subscriptions The validated queue and retry settings.
   * @param actor The actor identifier recorded in signal contexts.
   */
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

  /**
   * Posts a command with a fresh actor context and validates the acknowledged command ID.
   *
   * @typeParam Schema The domain schema that determines the accepted message shape.
   * @param schema The domain message schema used to encode the payload.
   * @param message The domain payload to post.
   * @param options The optional signal that cancels the command request.
   * @returns The acknowledged application outcome.
   */
  async post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientOperationOptions = {},
  ): Promise<ClientOutcome> {
    return this.#owner.run(options.signal, async (signal) => {
      const command = SignalEnvelopes.command({
        context: create(CommandContextSchema, { actorContext: this.#context() }),
        schema,
        message,
        validate: false,
      });
      const ack = await createClient(CommandService, this.#owner.transport).post(command, {
        signal,
      });
      BrowserClientValues.validateAckId(ack.messageId, command.id?.uuid ?? "");
      return BrowserClientValues.outcome(ack.status?.status);
    });
  }

  /**
   * Reads a cloned query after replacing its context with this actor scope.
   *
   * @param queryOrBuilder The query message or builder to clone.
   * @param options The optional signal that cancels the query request.
   * @returns The response to the contextualized query.
   */
  async send(
    queryOrBuilder:
      | Query
      | {
          /**
           * Builds the query message used for this read.
           *
           * @returns The query to contextualize before sending.
           */
          build(): Query;
        },
    options: ClientOperationOptions = {},
  ): Promise<QueryResponse> {
    return this.#owner.run(options.signal, async (signal) => {
      const source = "build" in queryOrBuilder ? queryOrBuilder.build() : queryOrBuilder;
      const query = clone(QuerySchema, source);
      query.context = this.#context();
      return createClient(QueryService, this.#owner.transport).read(query, { signal });
    });
  }

  /**
   * Validates the subscription kind and creates an inactive, client-managed topic stream.
   *
   * @param topic The requested topic with its target.
   * @param options The subscription kind, recovery query, and optional cancellation signal.
   * @returns The inactive tracked subscription.
   */
  async createSubscription(
    topic: Topic,
    options: CreateSubscriptionOptions,
  ): Promise<Subscription> {
    const validatedOptions = BrowserClientValues.validateSubscriptionOptions(options);
    return this.#owner.run(validatedOptions.signal, (signal) =>
      Promise.resolve(
        new TopicSubscription(
          this.#owner,
          BrowserClientValues.cloneTopic(topic, this.#context()),
          signal,
          validatedOptions,
          this.#subscriptions,
        ),
      ),
    );
  }

  /**
   * Creates an actor context with the selected tenant, zone, and current occurrence time.
   *
   * @returns A fresh actor context with the current occurrence Time.
   */
  #context(): ActorContext {
    return create(ActorContextSchema, {
      ...(this.#tenant === undefined ? {} : { tenantId: clone(TenantIdSchema, this.#tenant) }),
      zoneId: clone(ZoneIdSchema, this.#zoneId),
      actor: create(UserIdSchema, { value: this.#actor }),
      timestamp: Time.currentTime(),
    });
  }
}

/**
 * Coordinates operation cancellation, subscriptions, and transport closure for one client.
 */
class ClientOwner {
  readonly transport: Transport;

  readonly #source: ClientTransport;

  readonly #onReauthenticateBeforeReconnect: ((signal: AbortSignal) => Promise<void>) | undefined;

  readonly #controllers = new Set<AbortController>();

  readonly #subscriptions = new Set<TopicSubscription>();

  #closed = false;

  #close: Promise<void> | undefined;

  /**
   * Captures the transport and optional reconnect credential refresh callback.
   *
   * @param source The transport source used for RPC calls.
   * @param onReauthenticateBeforeReconnect The optional credential refresh callback used during reconnect.
   */
  constructor(
    source: ClientTransport,
    onReauthenticateBeforeReconnect: ((signal: AbortSignal) => Promise<void>) | undefined,
  ) {
    this.#source = source;
    this.#onReauthenticateBeforeReconnect = onReauthenticateBeforeReconnect;
    this.transport = source.transport;
  }

  /**
   * Executes credential refresh within the remaining retry budget and propagates cancellation.
   *
   * @param signal The abort signal for this operation.
   * @param remainingMs The retry budget still available for credential refresh.
   * @returns Completion after credential refresh within the retry budget.
   */
  async onReauthenticateBeforeReconnect(signal: AbortSignal, remainingMs: number): Promise<void> {
    this.assertOpen();
    const callback = this.#onReauthenticateBeforeReconnect;
    if (callback === undefined) return;
    if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0)
      throw new ClientProtocolError("subscription reauthentication retry deadline is exhausted.");
    const controller = new AbortController();
    const abort = () => {
      controller.abort(signal.reason);
    };
    const timeout = setTimeout(() => {
      controller.abort(new ClientProtocolError("subscription reauthentication timed out."));
    }, remainingMs);
    signal.addEventListener("abort", abort, { once: true });
    const pending = Promise.resolve().then(() => callback(controller.signal));
    const terminal = Promise.withResolvers<never>();
    const rejectTerminal = () => {
      terminal.reject(
        controller.signal.reason ??
          new ClientProtocolError("subscription reauthentication aborted."),
      );
    };
    controller.signal.addEventListener("abort", rejectTerminal, { once: true });
    try {
      await Promise.race([pending, terminal.promise]);
      this.assertOpen();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectTerminal);
      void pending.catch(() => undefined);
    }
  }

  /**
   * Executes one request under both caller cancellation and client closure.
   *
   * @typeParam Result The result type returned by the guarded request.
   * @param signal The abort signal for this operation.
   * @param work The operation invoked with a client-managed abort signal.
   * @returns The operation result if the client remains open.
   */
  async run<Result>(
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    this.assertOpen();
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => {
      controller.abort(signal?.reason);
    };
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

  /**
   * Returns a single cleanup promise across concurrent client close calls.
   *
   * @returns Completion after cleanup settles.
   */
  async close(): Promise<void> {
    return (this.#close ??= this.closeOwned());
  }

  /**
   * Registers an active logical subscription while the client remains open.
   *
   * @param subscription The accepted wire or logical subscription to clean up.
   */
  add(subscription: TopicSubscription): void {
    this.assertOpen();
    this.#subscriptions.add(subscription);
  }

  /**
   * Removes a subscription after its terminal cleanup.
   *
   * @param subscription The accepted wire or logical subscription to clean up.
   */
  remove(subscription: TopicSubscription): void {
    this.#subscriptions.delete(subscription);
  }

  /**
   * Rejects new work after client closure begins.
   */
  assertOpen(): void {
    if (this.#closed) throw new ClientProtocolError("client is closing.");
  }

  /**
   * Stops active requests, cancels subscriptions, then closes the transport.
   *
   * @returns Completion after resources close or a cleanup failure.
   */
  async closeOwned(): Promise<void> {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort();
    const failures: unknown[] = [];
    try {
      const settled = await Promise.allSettled(
        [...this.#subscriptions].map((subscription) => subscription.cancel()),
      );
      for (const result of settled)
        if (result.status === "rejected") failures.push(result.reason as unknown);
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

/**
 * Coordinates one logical topic stream across connection generations and retries.
 */
class TopicSubscription implements Subscription {
  readonly #owner: ClientOwner;

  readonly #topic: Topic;

  readonly #signal: AbortSignal;

  /**
   * Subscription kind and optional authoritative Entity recovery query.
   */
  readonly #options: CreateSubscriptionOptions;

  /**
   * Validated bounded-queue, retry, and scheduler settings.
   */
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

  #retryAttempt = 0;

  #retryStartedAt: number | undefined;

  #connectedAt: number | undefined;

  /**
   * Creates bounded update and lifecycle queues and registers the inactive stream.
   *
   * @param owner The client lifecycle coordinator for this scope.
   * @param topic The requested topic with its target.
   * @param signal The abort signal for this operation.
   * @param options The validated subscription kind and recovery query.
   * @param runtime The validated queue and recovery settings.
   */
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
    this.#updates = new BrowserClientValues.BoundedChannel(
      "subscription update",
      runtime.updateCapacity,
      runtime.updateByteCapacity,
    );
    this.#lifecycle = new BrowserClientValues.BoundedChannel(
      "subscription lifecycle",
      runtime.lifecycleCapacity,
    );
    owner.add(this);
  }

  /**
   * Exposes the single-consumer update queue for live and recovered values.
   *
   * @returns An iterable of live updates and authoritative recovery values.
   */
  get updates(): AsyncIterable<SubscriptionDelivery> {
    return this.#updates;
  }

  /**
   * Exposes lifecycle transitions independently from update delivery.
   *
   * @returns An iterable of lifecycle notices for this subscription.
   */
  get lifecycle(): AsyncIterable<SubscriptionLifecycle> {
    return this.#lifecycle;
  }

  /**
   * Starts one remote activation and shares its result with concurrent callers.
   *
   * @param options The optional signal that cancels activation.
   * @returns Completion after remote activation.
   */
  async activate(options: ClientOperationOptions = {}): Promise<void> {
    this.#owner.assertOpen();
    if (this.#cancelled) throw new ClientProtocolError("subscription is cancelled.");
    await (this.#activation ??= this.#activateOwned(options.signal));
  }

  /**
   * Returns cancellation and prevents further update delivery.
   *
   * @returns Completion after remote cleanup.
   */
  cancel(): Promise<void> {
    return (this.#cancellation ??= this.#cancelOwned());
  }

  /**
   * Subscribes and starts streaming while fencing responses from cancelled generations.
   *
   * @param signal The abort signal for this operation.
   * @returns Completion when the wire stream activates or a failure propagates.
   */
  async #activateOwned(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    if (this.#signal.aborted) throw this.#signal.reason;
    const generation = ++this.#generation;
    const abort = () => {
      this.#controller.abort(signal?.reason ?? this.#signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    this.#signal.addEventListener("abort", abort, { once: true });
    try {
      this.#pushLifecycle({ state: "connecting", generation, attempt: 0 });
      const pendingSubscription = createClient(
        SubscriptionService,
        this.#owner.transport,
      ).subscribe(this.#topic, { signal: this.#controller.signal });
      const subscription = await ClientTerminalValues.raceTerminal(
        pendingSubscription,
        this.#controller.signal,
        () => {
          ClientTerminalValues.cancelLateSubscription(pendingSubscription, this.#owner.transport);
        },
      );
      this.#wire = subscription;
      BrowserClientValues.validateSubscription(subscription, this.#topic, true);
      if (generation !== this.#generation) {
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
      this.#connectedAt = this.#runtime.scheduler.now();
    } catch (error) {
      if (this.#cancelled) throw error;
      if (this.#retryable(error) && this.#canRetry()) {
        await this.#recover(error, this.#wire);
        return;
      }
      this.#failStreams(error, generation);
      let cleanupFailure: unknown;
      try {
        if (this.#wire !== undefined) await this.#cancelWireOnce(this.#wire);
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

  /**
   * Clears updates, closes lifecycle, aborts work, and cancels the accepted wire once.
   *
   * @returns Completion after local and remote cancellation.
   */
  async #cancelOwned(): Promise<void> {
    this.#cancelled = true;
    this.#generation++;
    this.#updates.discard();
    this.#finishLifecycle({ state: "closed", generation: this.#generation - 1 });
    this.#controller.abort();
    await this.#disposeLateIterator();
    try {
      if (this.#wire !== undefined) await this.#cancelWireOnce(this.#wire);
    } finally {
      this.#owner.remove(this);
    }
  }

  /**
   * Validates streamed updates and either delivers them, retries, or terminates the stream.
   *
   * @param updates The active wire update iterator.
   * @param subscription The accepted wire or logical subscription to clean up.
   * @param generation The connection generation used to fence late results.
   * @returns Completion when streaming or recovery terminates.
   */
  async consumeUpdates(
    updates: AsyncIterator<SubscriptionUpdate>,
    subscription: WireSubscription,
    generation: number,
  ): Promise<void> {
    let recovering = false;
    try {
      for (;;) {
        const next = await ClientTerminalValues.raceTerminal(
          updates.next(),
          this.#controller.signal,
        );
        if (next.done)
          throw new SubscriptionStreamEndedError("subscription stream ended unexpectedly.");
        if (this.#cancelled || generation !== this.#generation) return;
        const update = next.value;
        const topic = subscription.topic;
        if (topic === undefined)
          throw new ClientProtocolError("accepted subscription topic is missing.");
        BrowserClientValues.validateSubscription(update.subscription, topic, true);
        if (update.subscription?.id?.value !== subscription.id?.value)
          throw new ClientProtocolError(
            "subscription update ID does not match the accepted subscription.",
          );
        if (
          update.response?.status?.status.case === "error" &&
          update.response.status.status.value.type === "backend-unavailable" &&
          update.update.case === undefined
        ) {
          this.#pushLifecycle({ state: "gapPossible", generation });
          continue;
        }
        const delivery = BrowserClientValues.freezeDelivery({
          kind: "update",
          update: clone(SubscriptionUpdateSchema, update),
        });
        const bytes = toBinary(SubscriptionUpdateSchema, update).byteLength;
        this.#pushUpdate(delivery, bytes);
      }
    } catch (error) {
      if (this.#cancelled) return;
      if (this.#retryable(error) && this.#canRetry()) {
        recovering = true;
        void this.#recover(error, subscription).catch(() => undefined);
        return;
      }
      this.#failStreams(error, generation);
      try {
        await this.#cancelAfterFailure();
      } catch {
        // The stream's original terminal error remains observable; cleanup is best effort.
      }
    } finally {
      if (!recovering) {
        this.#updates.close();
        this.#lifecycle.close();
        this.#owner.remove(this);
        if (this.#streamIterator === updates) this.#streamIterator = undefined;
      }
    }
  }

  /**
   * Accepts transport and unexpected stream-end errors for bounded recovery.
   *
   * @param error The failure to propagate or classify.
   * @returns Whether the failure permits another connection attempt.
   */
  #retryable(error: unknown): boolean {
    return (
      error instanceof SubscriptionStreamEndedError ||
      (error instanceof Error && !(error instanceof ClientProtocolError))
    );
  }

  /**
   * Restores the retry episode after a stable connection and checks attempt and time limits.
   *
   * @returns Whether the recovery episode still has attempts and time.
   */
  #canRetry(): boolean {
    const now = this.#runtime.scheduler.now();
    const connectedAt = this.#connectedAt;
    this.#connectedAt = undefined;
    if (connectedAt !== undefined && now - connectedAt >= this.#runtime.retryPolicy.maxElapsedMs) {
      this.#retryAttempt = 0;
      this.#retryStartedAt = undefined;
    }
    this.#retryStartedAt ??= now;
    return this.#retryAttempt < this.#runtime.retryPolicy.maxAttempts && !this.#elapsed();
  }

  /**
   * Checks whether the current recovery episode exhausted its time budget.
   *
   * @returns Whether the recovery deadline has elapsed.
   */
  #elapsed(): boolean {
    return (
      this.#runtime.scheduler.now() - (this.#retryStartedAt ?? 0) >=
      this.#runtime.retryPolicy.maxElapsedMs
    );
  }

  /**
   * Retries with bounded delays, refreshes credentials, and resynchronizes entity state.
   *
   * @param error The failure to propagate or classify.
   * @param previousWire The prior accepted wire to cancel before retry.
   * @returns Completion after reconnection or terminal failure.
   */
  async #recover(error: unknown, previousWire: WireSubscription | undefined): Promise<void> {
    let failure = error;
    let wire: WireSubscription | undefined = previousWire;
    let generation = this.#generation;
    try {
      while (this.#retryable(failure) && this.#canRetry()) {
        const attempt = ++this.#retryAttempt;
        generation = ++this.#generation;
        await this.#disposeLateIterator();
        if (wire !== undefined) await this.#cancelWireOnce(wire);
        const delay = this.#runtime.retryPolicy.delayMs(attempt);
        if (!Number.isSafeInteger(delay) || delay <= 0)
          throw new ClientProtocolError(
            "subscription retry delay must be a positive safe integer.",
          );
        await ClientTerminalValues.raceTerminal(
          this.#runtime.scheduler.wait(delay, this.#controller.signal),
          this.#controller.signal,
        );
        if (this.#controller.signal.aborted) throw this.#controller.signal.reason;
        if (this.#elapsed()) throw failure;
        await ClientTerminalValues.raceTerminal(
          this.#owner.onReauthenticateBeforeReconnect(
            this.#controller.signal,
            this.#remainingRetryMs(),
          ),
          this.#controller.signal,
        );
        if (this.#elapsed()) throw failure;
        this.#pushLifecycle({ state: "connecting", generation, attempt });
        try {
          const pending = createClient(SubscriptionService, this.#owner.transport).subscribe(
            this.#topic,
            { signal: this.#controller.signal },
          );
          const subscription = await ClientTerminalValues.raceTerminal(
            pending,
            this.#controller.signal,
            () => {
              ClientTerminalValues.cancelLateSubscription(pending, this.#owner.transport);
            },
          );
          this.#wire = subscription;
          BrowserClientValues.validateSubscription(subscription, this.#topic, true);
          const updates = createClient(SubscriptionService, this.#owner.transport).activate(
            subscription,
            { signal: this.#controller.signal },
          );
          const iterator = updates[Symbol.asyncIterator]();
          this.#streamIterator = iterator;
          if (this.#options.kind === "entity") await this.#resynchronize(generation);
          void this.consumeUpdates(iterator, subscription, generation).catch(() => undefined);
          if (this.#options.kind === "event")
            this.#pushLifecycle({ state: "gapPossible", generation });
          this.#pushLifecycle({ state: "connected", generation });
          this.#connectedAt = this.#runtime.scheduler.now();
          return;
        } catch (retryFailure) {
          failure = retryFailure;
          wire = this.#wire;
        }
      }
      throw failure;
    } catch (recoveryError) {
      if (this.#cancelled) throw recoveryError;
      const terminalError = recoveryError instanceof Error ? recoveryError : error;
      await this.#disposeLateIterator();
      this.#failStreams(terminalError, generation);
      try {
        await this.#cancelAfterFailure();
      } catch {
        // The terminal failure remains observable when cleanup fails.
      } finally {
        this.#updates.close();
        this.#lifecycle.close();
        this.#owner.remove(this);
      }
      throw terminalError;
    }
  }

  /**
   * Calculates the remaining credential refresh budget for this recovery episode.
   *
   * @returns Positive milliseconds left for credential refresh.
   */
  #remainingRetryMs(): number {
    const elapsed = this.#runtime.scheduler.now() - (this.#retryStartedAt ?? 0);
    const remaining = this.#runtime.retryPolicy.maxElapsedMs - elapsed;
    if (!Number.isSafeInteger(remaining) || remaining <= 0)
      throw new ClientProtocolError("subscription reauthentication retry deadline is exhausted.");
    return remaining;
  }

  /**
   * Reads authoritative entity state before resumed updates can enter the queue.
   *
   * @param generation The connection generation used to fence late results.
   * @returns Completion after authoritative state enters the update queue.
   */
  async #resynchronize(generation: number): Promise<void> {
    let query: Query;
    try {
      const source =
        this.#options.kind === "entity" ? this.#options.authoritativeQuery() : undefined;
      if (source === undefined) throw new Error("entity recovery query is missing.");
      query = clone(QuerySchema, "build" in source ? source.build() : source);
    } catch (error) {
      throw new ClientProtocolError(`authoritative query could not be prepared: ${String(error)}`);
    }
    if (!BrowserClientValues.sameTarget(query.target, this.#topic.target))
      throw new ClientProtocolError(
        "authoritative query target does not match the subscription topic.",
      );
    const topicContext = this.#topic.context;
    if (topicContext === undefined)
      throw new ClientProtocolError("subscription topic context is missing.");
    query.context = clone(ActorContextSchema, topicContext);
    this.#pushLifecycle({ state: "resynchronizing", generation });
    const pending = createClient(QueryService, this.#owner.transport).read(query, {
      signal: this.#controller.signal,
    });
    const response = await ClientTerminalValues.raceTerminal(pending, this.#controller.signal);
    if (response.response?.status?.status.case !== "ok")
      throw new ClientProtocolError("authoritative query response is not OK.");
    if (this.#cancelled || generation !== this.#generation) return;
    this.#pushUpdate(
      BrowserClientValues.freezeResynchronization({
        kind: "resynchronization",
        response: clone(QueryResponseSchema, response),
      }),
      toBinary(QueryResponseSchema, response).byteLength,
    );
  }

  /**
   * Cancels the accepted wire and unregisters a terminally failed stream.
   *
   * @returns Completion after wire cancellation and deregistration.
   */
  async #cancelAfterFailure(): Promise<void> {
    this.#cancelled = true;
    try {
      if (this.#wire !== undefined) await this.#cancelWireOnce(this.#wire);
    } finally {
      this.#owner.remove(this);
    }
  }

  /**
   * Rejects an update when the bounded delivery queue overflows.
   *
   * @param value The live update or authoritative recovery delivery.
   * @param bytes The serialized byte charge for this update.
   */
  #pushUpdate(value: SubscriptionDelivery, bytes: number): void {
    const error = this.#updates.push(value, bytes);
    if (error !== undefined) throw error;
  }

  /**
   * Rejects a lifecycle notice when its bounded queue overflows.
   *
   * @param value The lifecycle transition to announce.
   */
  #pushLifecycle(value: SubscriptionLifecycle): void {
    const error = this.#lifecycle.push(value);
    if (error !== undefined) throw error;
  }

  /**
   * Publishes one terminal failure, preserving overflow as a queue error.
   *
   * @param error The failure to propagate or classify.
   * @param generation The connection generation used to fence late results.
   */
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

  /**
   * Adds a terminal lifecycle notice without replacing admitted notices.
   *
   * @param value The final closed or failed lifecycle transition.
   */
  #finishLifecycle(value: SubscriptionLifecycle): void {
    if (this.#terminal && value.state === "closed") return;
    this.#terminal = true;
    this.#lifecycle.finish(value);
  }

  /**
   * Returns the remote cancellation promise for the current accepted wire.
   *
   * @param subscription The accepted wire or logical subscription to clean up.
   * @returns The shared remote cancellation promise for this wire.
   */
  #cancelWireOnce(subscription: WireSubscription): Promise<void> {
    if (this.#wireCleanup?.wire === subscription) return this.#wireCleanup.promise;
    const promise = ClientTerminalValues.cancelWire(this.#owner.transport, subscription);
    this.#wireCleanup = { wire: subscription, promise };
    return promise;
  }

  /**
   * Calls iterator return with a bounded wait so local termination can proceed.
   *
   * @returns Completion after bounded iterator disposal.
   */
  async #disposeLateIterator(): Promise<void> {
    const iterator = this.#streamIterator;
    if (iterator === undefined) return;
    this.#streamIterator = undefined;
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve(iterator.return?.()).catch(() => undefined),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    } catch {
      // Local terminal state must not depend on a non-cooperative iterator.
    }
  }
}

const CLEANUP_TIMEOUT_MS = 1_000;

const ClientTerminalValues = Object.freeze({
  /**
   * Completes an operation when it completes or its local abort signal fires.
   *
   * @typeParam Value The value type carried through reading or delivery.
   * @param pending The unresolved operation raced against cancellation.
   * @param signal The abort signal for this operation.
   * @param onTerminal The cleanup callback if cancellation wins.
   * @returns The operation result unless local cancellation settles first.
   */
  raceTerminal<Value>(
    pending: Promise<Value>,
    signal: AbortSignal,
    onTerminal?: () => void,
  ): Promise<Value> {
    if (signal.aborted) {
      void pending.catch(() => undefined);
      onTerminal?.();
      return Promise.reject(ClientTerminalValues.abortError(signal));
    }
    const terminal = Promise.withResolvers<never>();
    const abort = () => {
      terminal.reject(ClientTerminalValues.abortError(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    return Promise.race([pending, terminal.promise])
      .catch((error: unknown) => {
        if (signal.aborted) onTerminal?.();
        throw error;
      })
      .finally(() => {
        signal.removeEventListener("abort", abort);
      });
  },

  /**
   * Converts an abort reason into a stable Error for terminal propagation.
   *
   * @param signal The abort signal for this operation.
   * @returns An Error preserving a usable abort reason.
   */
  abortError(signal: AbortSignal): Error {
    const reason: unknown = signal.reason;
    if (reason instanceof Error) return reason;
    if (typeof reason === "string") return new Error(reason);
    if (typeof reason === "number" || typeof reason === "boolean" || typeof reason === "bigint")
      return new Error(String(reason));
    return new Error("operation aborted.");
  },

  /**
   * Cancels a wire accepted after its local subscription has already terminated.
   *
   * @param pending The unresolved operation raced against cancellation.
   * @param transport The Connect transport used for remote cancellation.
   */
  cancelLateSubscription(pending: Promise<WireSubscription>, transport: Transport): void {
    void pending
      .then((subscription) => ClientTerminalValues.cancelWire(transport, subscription))
      .catch(() => undefined);
  },

  /**
   * Sends remote cancellation with a bounded cleanup deadline.
   *
   * @param transport The Connect transport used for remote cancellation.
   * @param subscription The accepted wire or logical subscription to clean up.
   * @returns Completion after bounded remote cancellation.
   */
  async cancelWire(transport: Transport, subscription: WireSubscription): Promise<void> {
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
  },
});

/**
 * Holds validated subscription queue limits, retry policy, and scheduler.
 */
interface RequiredSubscriptionRuntimeOptions {
  readonly updateCapacity: number;
  readonly updateByteCapacity: number;
  readonly lifecycleCapacity: number;
  readonly retryPolicy: SubscriptionRetryPolicy;
  readonly scheduler: SubscriptionScheduler;
}

/**
 * Builds browser-client request, subscription, and immutable wire values.
 */
const BrowserClientValues = Object.freeze({
  /**
   * Applies validated queue limits, retry policy, and scheduler defaults.
   *
   * @param options The optional queue capacities, retry policy, and scheduler.
   * @returns Validated queue limits, retry policy, and scheduler.
   */
  subscriptionRuntimeOptions(
    options: SubscriptionRuntimeOptions | undefined,
  ): RequiredSubscriptionRuntimeOptions {
    return {
      updateCapacity: BrowserClientValues.positiveSubscriptionOption(
        options?.updateBufferCapacity,
        64,
        "update buffer capacity",
      ),
      updateByteCapacity: BrowserClientValues.positiveSubscriptionOption(
        options?.updateBufferByteCapacity,
        1_048_576,
        "update buffer byte capacity",
      ),
      lifecycleCapacity: BrowserClientValues.positiveSubscriptionOption(
        options?.lifecycleBufferCapacity,
        32,
        "lifecycle buffer capacity",
      ),
      retryPolicy: BrowserClientValues.retryPolicy(options?.retryPolicy),
      scheduler: BrowserClientValues.scheduler(options?.scheduler),
    };
  },

  DEFAULT_RETRY_POLICY: {
    maxAttempts: 5,
    maxElapsedMs: 30_000,

    /**
     * Calculates a capped exponential delay with bounded random jitter.
     *
     * @param attempt The retry attempt starting at one.
     * @returns A positive retry delay in milliseconds.
     */
    delayMs(attempt: number): number {
      const bounded = Math.min(5_000, 250 * 2 ** Math.max(0, attempt - 1));
      return Math.min(5_000, Math.max(1, Math.round(bounded * (0.8 + Math.random() * 0.4))));
    },
  },

  DEFAULT_SUBSCRIPTION_SCHEDULER: {
    now: () => Math.floor(Time.monotonicTime()),
    wait: (delayMs: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(ClientTerminalValues.abortError(signal));
          return;
        }
        const timeout = setTimeout(resolve, delayMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            reject(ClientTerminalValues.abortError(signal));
          },
          { once: true },
        );
      }),
  },

  /**
   * Checks retry counts, elapsed budget, and each produced delay.
   *
   * @param policy The supplied retry policy, if configured.
   * @returns A policy whose attempt limits and sampled delays are valid.
   */
  retryPolicy(policy: SubscriptionRetryPolicy | undefined): SubscriptionRetryPolicy {
    const resolved = policy ?? BrowserClientValues.DEFAULT_RETRY_POLICY;
    if (!Number.isSafeInteger(resolved.maxAttempts) || resolved.maxAttempts <= 0)
      throw new TypeError(
        "Client subscription retry max attempts must be a positive safe integer.",
      );
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
  },

  /**
   * Checks that a scheduler supplies a valid monotonic time and abortable wait.
   *
   * @param scheduler The supplied monotonic scheduler, if configured.
   * @returns A scheduler with valid time and wait functions.
   */
  scheduler(scheduler: SubscriptionScheduler | undefined): SubscriptionScheduler {
    const resolved = scheduler ?? BrowserClientValues.DEFAULT_SUBSCRIPTION_SCHEDULER;
    if (typeof resolved.now !== "function" || typeof resolved.wait !== "function")
      throw new TypeError("Client subscription scheduler must provide now() and wait().");
    const now = resolved.now();
    if (!Number.isSafeInteger(now) || now < 0)
      throw new TypeError(
        "Client subscription scheduler time must be a non-negative safe integer.",
      );
    return resolved;
  },

  /**
   * Returns a default and rejects invalid queue capacity values.
   *
   * @param value The configured capacity when present.
   * @param fallback The default value used when none was supplied.
   * @param name The queue label or option name used in errors.
   * @returns A positive safe integer capacity.
   */
  positiveSubscriptionOption(value: number | undefined, fallback: number, name: string): number {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved <= 0)
      throw new TypeError(`Client subscription ${name} must be a positive safe integer.`);
    return resolved;
  },

  /**
   * Validates an explicit event or entity kind and a query for entity recovery.
   *
   * @param options The candidate subscription kind and recovery query.
   * @returns Options with an explicit kind and valid recovery query contract.
   */
  validateSubscriptionOptions(options: unknown): CreateSubscriptionOptions {
    if (
      options === null ||
      typeof options !== "object" ||
      !("kind" in options) ||
      (options.kind !== "event" && options.kind !== "entity")
    )
      throw new TypeError("Subscription kind must be 'event' or 'entity'.");
    if (options.kind === "event") {
      if ("authoritativeQuery" in options)
        throw new TypeError("Event subscriptions must not provide an authoritative query.");
      return options as EventSubscriptionOptions;
    }
    if (!("authoritativeQuery" in options) || typeof options.authoritativeQuery !== "function")
      throw new TypeError("Entity subscriptions require an authoritative query.");
    return options as EntitySubscriptionOptions;
  },

  /**
   * Buffers one consumer stream within count and optional byte limits.
   *
   * @typeParam Value The value type carried through reading or delivery.
   */
  BoundedChannel: class BoundedChannel<Value> implements AsyncIterable<Value> {
    readonly #name: string;

    readonly #capacity: number;

    readonly #byteCapacity: number | undefined;

    readonly #values: Readonly<{ value: Value; bytes: number }>[] = [];

    #bytes = 0;

    #consumer = false;

    #closed = false;

    #error: Error | undefined;

    #pending: PromiseWithResolvers<IteratorResult<Value>> | undefined;

    /**
     * Sets the count and optional byte bounds for a single consumer queue.
     *
     * @param name The queue label or option name used in errors.
     * @param capacity The maximum count of buffered values.
     * @param byteCapacity The optional maximum buffered byte count.
     */
    constructor(name: string, capacity: number, byteCapacity?: number) {
      this.#name = name;
      this.#capacity = capacity;
      this.#byteCapacity = byteCapacity;
    }

    /**
     * Admits a value or reports a closed stream or capacity overflow.
     *
     * @param value The value offered to the bounded queue.
     * @param bytes The serialized byte charge for this update.
     * @returns A protocol error when admission fails, otherwise undefined.
     */
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

    /**
     * Closes iteration after already admitted values have been consumed.
     */
    close(): void {
      this.#closed = true;
      if (this.#values.length === 0 && this.#error === undefined) {
        this.#pending?.resolve({ done: true, value: undefined });
        this.#pending = undefined;
      }
    }

    /**
     * Clears admitted values and ends iteration after explicit cancellation.
     */
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
     * Adds one terminal notice after admitted nonterminal values.
     * The terminal slot is bounded and never displaces an admitted lifecycle notice.
     *
     * @param value The terminal lifecycle notice reserved after queued notices.
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

    /**
     * Rejects the pending consumer and discards queued values after a terminal error.
     *
     * @param error The failure to propagate or classify.
     */
    fail(error: Error): void {
      if (this.#error !== undefined) return;
      this.#error = error;
      this.#values.length = 0;
      this.#pending?.reject(error);
      this.#pending = undefined;
    }

    /**
     * Exposes the queue to a single iterator consumer.
     *
     * @returns An iterator that reads values from this queue.
     */
    [Symbol.asyncIterator](): AsyncIterator<Value> {
      if (this.#consumer)
        throw new ClientProtocolError(`${this.#name} stream has a single consumer.`);
      this.#consumer = true;
      return { next: () => this.next() };
    }

    /**
     * Reads one queued value, waits for a value, or reports closure or failure.
     *
     * @returns The next queued value or terminal iterator result.
     */
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
  },

  /**
   * Returns a cloned live update before exposing it to consumers.
   *
   * @param delivery The cloned update or recovery value to freeze.
   * @returns A frozen live update delivery.
   */
  freezeDelivery(
    delivery: Extract<SubscriptionDelivery, { readonly kind: "update" }>,
  ): SubscriptionDelivery {
    return Object.freeze({ ...delivery, update: BrowserClientValues.deepFreeze(delivery.update) });
  },

  /**
   * Returns an authoritative response before exposing it to consumers.
   *
   * @param delivery The cloned update or recovery value to freeze.
   * @returns A frozen authoritative recovery delivery.
   */
  freezeResynchronization(
    delivery: Extract<SubscriptionDelivery, { readonly kind: "resynchronization" }>,
  ): SubscriptionDelivery {
    return Object.freeze({
      ...delivery,
      response: BrowserClientValues.deepFreeze(delivery.response),
    });
  },

  /**
   * Returns the input after freezing nested message objects while leaving typed array views intact.
   *
   * @typeParam Value The value type carried through reading or delivery.
   * @param value The message value whose nested objects are frozen.
   * @returns The original value with nested message objects frozen.
   */
  deepFreeze<Value>(value: Value): Value {
    if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
    for (const child of Object.values(value)) BrowserClientValues.deepFreeze(child);
    return Object.freeze(value);
  },

  /**
   * Wraps a Connect transport for the client constructor.
   *
   * @param transport The Connect transport used for remote cancellation.
   * @returns The client transport wrapper.
   */
  browserSource(transport: Transport): ClientTransport {
    return { transport };
  },

  /**
   * Sets the base URL, credentials, and per-call metadata interceptor.
   *
   * @param baseUrl The service endpoint URL.
   * @param options The browser credentials and per-request metadata callback.
   * @returns Transport settings with credentials and request metadata.
   */
  browserTransportOptions(
    baseUrl: string,
    options: BrowserClientOptions,
  ): { baseUrl: string; interceptors: Interceptor[]; fetch?: typeof globalThis.fetch } {
    return {
      baseUrl,
      interceptors:
        options.onRequestMetadata === undefined
          ? []
          : [BrowserClientValues.requestMetadata(options.onRequestMetadata)],
      ...(options.credentials === undefined
        ? {}
        : { fetch: BrowserClientValues.credentialedFetch(options.credentials) }),
    };
  },

  /**
   * Returns Fetch with the configured browser credential mode.
   *
   * @param credentials The configured Fetch credential mode.
   * @returns Fetch configured with the selected credential mode.
   */
  credentialedFetch(credentials: unknown): typeof globalThis.fetch {
    if (credentials !== "omit" && credentials !== "same-origin" && credentials !== "include")
      throw new TypeError("Browser Fetch credentials must be omit, same-origin, or include.");
    return (input, init) => globalThis.fetch(input, { ...init, credentials });
  },

  /**
   * Adds fresh application headers to each outbound transport call.
   *
   * @param onRequestMetadata The callback supplying fresh headers per request.
   * @returns An interceptor that applies fresh headers to each request.
   */
  requestMetadata(onRequestMetadata: OnRequestMetadata): Interceptor {
    return (next) => async (request) => {
      const metadata = new Headers(onRequestMetadata());
      for (const [name, value] of metadata) request.header.set(name, value);
      return next(request);
    };
  },

  /**
   * Copies a topic and applies the current actor context.
   *
   * @param topic The requested topic with its target.
   * @param context The actor context applied to the cloned topic.
   * @returns A separate topic with this actor context.
   */
  cloneTopic(topic: Topic, context: ActorContext): Topic {
    const prepared = structuredClone(topic);
    prepared.context = context;
    return prepared;
  },

  /**
   * Checks the accepted topic, identifier, and optional server context rewrite.
   *
   * @param subscription The accepted wire or logical subscription to clean up.
   * @param expectedTopic The requested topic used to validate the server response.
   * @param allowRewrittenContext Whether a server-rewritten context is accepted.
   */
  validateSubscription(
    subscription: WireSubscription | undefined,
    expectedTopic: Topic,
    allowRewrittenContext = false,
  ): void {
    if (subscription === undefined || subscription.id?.value.length === 0)
      throw new ClientProtocolError("subscription ID is missing or invalid.");
    if (
      subscription.topic === undefined ||
      !BrowserClientValues.sameTopic(subscription.topic, expectedTopic, allowRewrittenContext)
    )
      throw new ClientProtocolError("subscription topic does not match the requested topic.");
  },

  /**
   * Compares topic targets and, when required, their actor contexts.
   *
   * @param left The first value to compare.
   * @param right The second value to compare.
   * @param ignoreContext Whether actor context is excluded from comparison.
   * @returns Whether topics match under the selected context rule.
   */
  sameTopic(left: Topic, right: Topic, ignoreContext = false): boolean {
    if (ignoreContext) {
      left = { ...left, context: undefined };
      right = { ...right, context: undefined };
    }
    const a = toBinary(TopicSchema, left);
    const b = toBinary(TopicSchema, right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  },

  /**
   * Compares query and subscription targets by their serialized identifiers.
   *
   * @param left The first value to compare.
   * @param right The second value to compare.
   * @returns Whether query and topic targets identify the same subject.
   */
  sameTarget(left: Query["target"], right: Topic["target"]): boolean {
    if (left === undefined || right === undefined) return left === right;
    const a = toBinary(TargetSchema, left);
    const b = toBinary(TargetSchema, right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
  },

  /**
   * Validates and clones a selected tenant identifier.
   *
   * @param value The optional tenant string or message to validate.
   * @returns A cloned tenant identifier or undefined.
   */
  tenant(value: string | TenantId | undefined): TenantId | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      if (value.kind.case !== "value" || value.kind.value.length === 0)
        throw new TypeError("Client tenant must not be empty.");
      return clone(TenantIdSchema, value);
    }
    if (value.length === 0) throw new TypeError("Client tenant must not be empty.");
    return create(TenantIdSchema, { kind: { case: "value", value } });
  },

  /**
   * Validates the zone or uses the current configured time zone.
   *
   * @param value The optional zone string or message to validate.
   * @returns A cloned zone identifier.
   */
  zoneId(value: string | ZoneId | undefined): ZoneId {
    if (typeof value !== "string" && value !== undefined) {
      if (value.value.length === 0) throw new TypeError("Client zoneId must not be empty.");
      return clone(ZoneIdSchema, value);
    }
    const zone = value ?? Time.currentTimeZone();
    if (zone.length === 0) throw new TypeError("Client zoneId must not be empty.");
    return create(ZoneIdSchema, { value: zone });
  },

  /**
   * Maps a wire command status to a validated application outcome.
   *
   * @param status The wire command status to interpret.
   * @returns The mapped application command outcome.
   */
  outcome(status: Status["status"] | undefined): ClientOutcome {
    if (status?.case === "ok") return Object.freeze({ kind: "ok" as const });
    if (status?.case === "error")
      return Object.freeze({
        kind: "error" as const,
        error: BrowserClientValues.cloneMessage(status.value),
      });
    if (status?.case === "rejection")
      return Object.freeze({
        kind: "rejection" as const,
        rejection: BrowserClientValues.cloneMessage(status.value),
      });
    throw new ClientProtocolError("response status is missing or invalid.");
  },

  /**
   * Rejects an acknowledgement with a missing or mismatched command ID.
   *
   * @param packed The acknowledgement identifier packed in Any.
   * @param id The posted command identifier expected in the acknowledgement.
   */
  validateAckId(packed: Any | undefined, id: string): void {
    const commandId =
      packed === undefined ? undefined : AnyMessages.unpack(packed, CommandIdSchema);
    if (commandId?.uuid !== id)
      throw new ClientProtocolError(
        "acknowledgement command ID does not match the posted command.",
      );
  },

  /**
   * Copies a Protobuf message before returning it to callers.
   *
   * @param message The domain payload to post.
   * @returns A separate message value for the caller.
   */
  cloneMessage(message: Message): Message {
    return structuredClone(message);
  },
});

/**
 * Buffers one consumer stream within count and optional byte limits.
 *
 * @typeParam Value The value type carried through reading or delivery.
 */
interface BoundedChannel<Value> extends AsyncIterable<Value> {
  /**
   * Admits a value or reports a closed stream or capacity overflow.
   *
   * @param value The value offered to the bounded queue.
   * @param bytes The serialized byte charge for this update.
   * @returns A protocol error when admission fails, otherwise undefined.
   */
  push(value: Value, bytes?: number): ClientProtocolError | undefined;

  /**
   * Closes iteration after already admitted values have been consumed.
   */
  close(): void;

  /**
   * Clears admitted values and ends iteration after explicit cancellation.
   */
  discard(): void;

  /**
   * Adds one terminal notice after admitted nonterminal values.
   *
   * @param value The terminal lifecycle notice reserved after queued notices.
   */
  finish(value: Value): void;

  /**
   * Rejects the pending consumer and discards queued values after a terminal error.
   *
   * @param error The failure to propagate or classify.
   */
  fail(error: Error): void;
}
