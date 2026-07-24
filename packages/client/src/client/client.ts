import { clone, create, equals, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema, type Any } from "@bufbuild/protobuf/wkt";
import { createClient, type Transport } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { randomUUID } from "node:crypto";
import {
  deriveTypeUrl,
  packAny,
  packCommand,
  unpackAny,
  type MessageSchema,
} from "@spine-event-engine/core";
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
  type Version,
  type EventContext,
} from "@spine-event-engine/proto";
import {
  CommandService,
  QuerySchema,
  QueryService,
  SubscriptionService,
  SubscriptionSchema,
  IdFilterSchema,
  TargetFiltersSchema,
  TopicSchema,
  type Query,
  type Subscription,
  type SubscriptionUpdate,
  type TargetFilters,
  type Topic,
} from "@spine-event-engine/proto/client";
import type { ProjectionPredicate } from "../query/projection-query.js";
import { ProjectionQuery } from "../query/projection-query.js";
import { ProjectionColumn } from "../projection/projection-column.js";
import { BoundedStream, stopped } from "./bounded-stream.js";

/** A valid application-level command or query outcome. */
export type ClientOutcome =
  | Readonly<{ readonly kind: "ok" }>
  | Readonly<{ readonly kind: "error"; readonly error: Message }>
  | Readonly<{ readonly kind: "rejection"; readonly rejection: Message }>;

/** A command outcome whose accepted branch owns an immediate-event handle. */
export type ObservedClientOutcome =
  | Readonly<{ readonly kind: "ok"; readonly events: CommandEvents }>
  | Exclude<ClientOutcome, { readonly kind: "ok" }>;

/** A successfully decoded Projection state and its server version. */
export interface QueryState<Schema extends MessageSchema> {
  readonly state: DeepReadonly<MessageShape<Schema>>;
  readonly version: DeepReadonly<Version>;
}

/** A query outcome, whose successful branch is fully decoded. */
export type ClientQueryOutcome<Schema extends MessageSchema> =
  | Readonly<{ readonly kind: "ok"; readonly states: readonly QueryState<Schema>[] }>
  | Exclude<ClientOutcome, { readonly kind: "ok" }>;

/** Options shared by client operations. */
export interface ClientOperationOptions {
  readonly signal?: AbortSignal;
}

/** Options for posting a command. */
export interface ClientPostOptions extends ClientOperationOptions {
  readonly observe?: readonly MessageSchema[];
}

/** Posting options that request at least one immediate event type. */
export interface ClientObserveOptions extends ClientOperationOptions {
  readonly observe: readonly [MessageSchema, ...MessageSchema[]];
}

type UnobservedPostOptions = ClientOperationOptions & { readonly observe?: undefined };

/** A cancellable, bounded stream of events caused by one posted command. */
export interface CommandEvents extends AsyncIterable<CommandEvent> {
  cancel(): Promise<void>;
}

/** A decoded event and its immutable context. */
export interface CommandEvent {
  readonly message: DeepReadonly<Message>;
  readonly context: DeepReadonly<Message>;
}

/** A decoded state update from a Projection subscription. */
export type StateSubscriptionUpdate<Schema extends MessageSchema, IdSchema extends MessageSchema> =
  | Readonly<{ readonly kind: "state"; readonly state: DeepReadonly<MessageShape<Schema>> }>
  | Readonly<{
      readonly kind: "noLongerMatching";
      readonly id: DeepReadonly<MessageShape<IdSchema>>;
    }>;

/** A cancellable, bounded stream of Projection state updates. */
export interface StateSubscription<
  Schema extends MessageSchema,
  IdSchema extends MessageSchema,
> extends AsyncIterable<StateSubscriptionUpdate<Schema, IdSchema>> {
  /** End local iteration immediately and idempotently cancel the remote subscription. */
  cancel(): Promise<void>;
}

/** A decoded event and the immutable context in which it was emitted. */
export interface SubscriptionEvent<Schema extends MessageSchema> {
  readonly message: DeepReadonly<MessageShape<Schema>>;
  readonly context: DeepReadonly<EventContext>;
}

type DeepReadonly<Value> = Value extends (...arguments_: never[]) => unknown
  ? Value
  : Value extends Uint8Array
    ? ReadonlyBytes
    : Value extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
        : Value;

interface ReadonlyBytes extends Iterable<number> {
  readonly [index: number]: number;
  readonly length: number;
  slice(start?: number, end?: number): ReadonlyBytes;
  subarray(start?: number, end?: number): ReadonlyBytes;
}

/** A cancellable, bounded stream of events. */
export interface EventSubscription<Schema extends MessageSchema> extends AsyncIterable<
  SubscriptionEvent<Schema>
> {
  /** End local iteration immediately and idempotently cancel the remote subscription. */
  cancel(): Promise<void>;
}

/** Criteria supported by frozen Projection-state topic subscriptions. */
export interface StateSubscriptionOptions<
  Schema extends MessageSchema,
  IdSchema extends MessageSchema,
> extends ClientOperationOptions {
  readonly ids?: readonly MessageShape<IdSchema>[];
  readonly where?: ProjectionPredicate<ProjectionColumn<Schema>>;
  readonly mask?: readonly StateFieldName<Schema>[];
}

type StateFieldName<Schema extends MessageSchema> = Exclude<
  keyof MessageShape<Schema>,
  "$typeName" | "$unknown"
> &
  string;

/**
 * Immutable context selected when a client is created.
 *
 * Tenant and zone apply to every request scope for the client lifecycle. String
 * values must be nonempty; Protobuf values are validated and cloned, so later
 * caller mutation cannot change requests. When omitted, `zoneId` resolves once
 * to the current system IANA zone and remains fixed for that client.
 */
export interface ClientOptions {
  /** Optional client-wide tenant included in every request context. */
  readonly tenant?: string | TenantId;
  /** Fixed IANA time zone included in every request context. */
  readonly zoneId?: string | ZoneId;
}

/** Thrown for a service response that violates the frozen wire contract. */
export class ClientProtocolError extends Error {
  constructor(message: string) {
    super(`Client protocol error: ${message}`);
    this.name = "ClientProtocolError";
  }
}

/** Node-only entrypoint for Spine command and Projection-query calls. */
export class Client {
  readonly #owner: ClientOwner;
  readonly #tenant: TenantId | undefined;
  readonly #zoneId: ZoneId;

  private constructor(owner: ClientOwner, options: NormalizedClientOptions) {
    this.#owner = owner;
    this.#tenant = tenant(options.tenant);
    this.#zoneId = zoneId(options.zoneId);
  }

  /**
   * Connect to an endpoint using a client-owned HTTP/2 session.
   *
   * Options are validated before the owned session is created. `close()` aborts
   * that session; each request scope shares the client-wide fixed tenant and zone.
   */
  static connectTo(baseUrl: string, options: ClientOptions = {}): Client {
    const normalized = normalizeOptions(options);
    const sessions = new Http2SessionManager(baseUrl);
    return new Client(
      new ClientOwner(createGrpcTransport({ baseUrl, sessionManager: sessions }), () => {
        sessions.abort();
      }),
      normalized,
    );
  }

  /**
   * Use a caller-owned Connect transport.
   *
   * Options are cloned and validated at construction. `close()` does not close
   * the supplied transport.
   */
  static usingTransport(transport: Transport, options: ClientOptions = {}): Client {
    return new Client(new ClientOwner(transport), normalizeOptions(options));
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

  /** Start closing this client, cancelling its operations and owned session once. */
  close(): Promise<void> {
    return this.#owner.close();
  }
}

/** Immutable actor scope for one client lifecycle owner. */
export interface ClientRequest {
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientObserveOptions,
  ): Promise<ObservedClientOutcome>;
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options?: ClientOperationOptions & { readonly observe?: undefined },
  ): Promise<ClientOutcome>;
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientPostOptions,
  ): Promise<ClientOutcome | ObservedClientOutcome>;
  query<Schema extends GenMessage<Message>>(
    stateSchema: Schema,
    queryOrBuilder: Query | { build(): Query },
    options?: ClientOperationOptions,
  ): Promise<ClientQueryOutcome<Schema>>;
  /**
   * Activate one bounded, single-consumer Projection-state stream.
   *
   * The generated ID schema decodes `noLongerMatching` IDs. Options accept IDs,
   * equality predicates, a top-level mask, and an abort signal. Creation waits
   * after the activation consumer is locally attached; asynchronous activation
   * failures reject iterator reads. `cancel()` is idempotent and reports remote cleanup failure.
   */
  subscribeToState<Schema extends MessageSchema, IdSchema extends MessageSchema>(
    stateSchema: Schema,
    idSchema: IdSchema,
    options?: StateSubscriptionOptions<Schema, IdSchema>,
  ): Promise<StateSubscription<Schema, IdSchema>>;
  /**
   * Activate one bounded, single-consumer decoded event stream.
   *
   * The abort signal terminates locally and starts remote cleanup. Creation
   * returns after the activation consumer is locally attached, without claiming
   * a remote wire acknowledgement. Later activation failures reject iterator reads.
   * `cancel()` is idempotent and reports cleanup failure.
   */
  subscribeToEvents<Schema extends MessageSchema>(
    eventSchema: Schema,
    options?: ClientOperationOptions,
  ): Promise<EventSubscription<Schema>>;
}

class Request implements ClientRequest {
  readonly #owner: ClientOwner;
  readonly #tenant: TenantId | undefined;
  readonly #zoneId: ZoneId;
  readonly #actor: string;

  constructor(
    owner: ClientOwner,
    selectedTenant: TenantId | undefined,
    selectedZone: ZoneId,
    actor: string,
  ) {
    this.#owner = owner;
    this.#tenant = selectedTenant;
    this.#zoneId = clone(ZoneIdSchema, selectedZone);
    this.#actor = actor;
  }

  /** Post a generated command message. */
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientObserveOptions,
  ): Promise<ObservedClientOutcome>;
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options?: UnobservedPostOptions,
  ): Promise<ClientOutcome>;
  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientPostOptions,
  ): Promise<ClientOutcome | ObservedClientOutcome>;
  async post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientPostOptions | UnobservedPostOptions = {},
  ): Promise<ClientOutcome | ObservedClientOutcome> {
    return this.#owner.run(options.signal, async (signal) => {
      const context = this.#context();
      const command = packCommand({
        id: create(CommandIdSchema, { uuid: randomUUID() }),
        context: create(CommandContextSchema, { actorContext: context }),
        schema,
        message,
      });
      const events =
        options.observe === undefined
          ? undefined
          : await CommandEventStream.start(
              this.#owner,
              command.id?.uuid,
              options.observe,
              context,
              signal,
              options.signal,
            );
      try {
        const ack = await createClient(CommandService, this.#owner.transport).post(command, {
          signal,
        });
        validateAckId(ack.messageId, command.id?.uuid);
        const result = outcome(ack.status?.status);
        if (result.kind !== "ok") {
          await events?.cancel();
          return result;
        }
        return events === undefined ? result : Object.freeze({ kind: "ok" as const, events });
      } catch (error) {
        if (events !== undefined) {
          const cleanup = events.cancel();
          this.#owner.trackLateCleanup(cleanup);
          await cleanup.catch(() => undefined);
        }
        throw error;
      }
    });
  }

  /** Execute a frozen Projection query with this scope's actor context. */
  async query<Schema extends GenMessage<Message>>(
    stateSchema: Schema,
    queryOrBuilder: Query | { build(): Query },
    options: ClientOperationOptions = {},
  ): Promise<ClientQueryOutcome<Schema>> {
    return this.#owner.run(options.signal, async (signal) => {
      const source = "build" in queryOrBuilder ? queryOrBuilder.build() : queryOrBuilder;
      const query = clone(QuerySchema, source);
      query.context = this.#context();
      const response = await createClient(QueryService, this.#owner.transport).read(query, {
        signal,
      });
      const status = outcome(response.response?.status?.status);
      if (status.kind !== "ok") return status;
      const states = response.message.map((entry) =>
        decodeState(entry.state, entry.version, stateSchema),
      );
      return Object.freeze({ kind: "ok" as const, states: Object.freeze(states) });
    });
  }

  async subscribeToState<Schema extends MessageSchema, IdSchema extends MessageSchema>(
    stateSchema: Schema,
    idSchema: IdSchema,
    options: StateSubscriptionOptions<Schema, IdSchema> = {},
  ): Promise<StateSubscription<Schema, IdSchema>> {
    validateSubscriptionMask(stateSchema, options.mask);
    return this.#owner.run(options.signal, (signal) =>
      TopicStream.start(this.#owner, {
        schema: stateSchema,
        context: this.#context(),
        signal,
        callerSignal: options.signal,
        mask: options.mask,
        filters: stateSubscriptionFilters(stateSchema, idSchema, options),
        decode: (update) => decodeStateUpdates(update, stateSchema, idSchema),
        name: "state subscription",
      }),
    );
  }

  async subscribeToEvents<Schema extends MessageSchema>(
    eventSchema: Schema,
    options: ClientOperationOptions = {},
  ): Promise<EventSubscription<Schema>> {
    return this.#owner.run(options.signal, (signal) =>
      TopicStream.start(this.#owner, {
        schema: eventSchema,
        context: this.#context(),
        signal,
        callerSignal: options.signal,
        decode: (update) => decodeEventUpdates(update, eventSchema),
        name: "event subscription",
      }),
    );
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
  readonly #onCloseTransport: (() => void) | undefined;
  readonly #operations = new Map<AbortController, Promise<unknown>>();
  readonly #activeStreams = new Set<CancellableStream>();
  readonly #lateCleanup = new Set<Promise<void>>();
  readonly #trackedCleanup = new WeakSet<Promise<void>>();
  readonly #closingCleanup = new WeakSet<Promise<void>>();
  #backgroundCleanupFailure: unknown;
  #backgroundCleanupFailureCount = 0;
  #state: "open" | "closing" | "closed" = "open";
  #closing: Promise<void> | undefined;

  constructor(transport: Transport, onCloseTransport?: () => void) {
    this.transport = transport;
    this.#onCloseTransport = onCloseTransport;
  }

  async run<Result>(
    callerSignal: AbortSignal | undefined,
    execute: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    if (this.#state !== "open") throw new ClientProtocolError("client is closing.");
    if (callerSignal?.aborted) throw callerSignal.reason;
    const controller = new AbortController();
    const abort = () => {
      controller.abort(callerSignal?.reason);
    };
    callerSignal?.addEventListener("abort", abort, { once: true });
    const completion = execute(controller.signal);
    this.#operations.set(controller, completion);
    try {
      return await completion;
    } finally {
      callerSignal?.removeEventListener("abort", abort);
      this.#operations.delete(controller);
    }
  }

  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#state = "closing";
    const operations = [...this.#operations];
    for (const [operation] of operations) operation.abort();
    const events = [...this.#activeStreams];
    const cleanup = events.map((event) => event.cancel());
    for (const promise of cleanup) this.#closingCleanup.add(promise);
    this.#closing = this.finishClose(
      operations.map(([, completion]) => completion),
      cleanup,
    );
    return this.#closing;
  }

  async finishClose(
    operations: readonly Promise<unknown>[],
    cleanup: readonly Promise<void>[],
  ): Promise<void> {
    await Promise.allSettled(operations);
    const cleanupPromises = [...new Set([...cleanup, ...this.#lateCleanup])];
    for (const promise of cleanupPromises) this.#closingCleanup.add(promise);
    const cleanupResults = await Promise.allSettled(cleanupPromises);
    let closeFailure: unknown;
    try {
      this.#onCloseTransport?.();
    } catch (error) {
      closeFailure = error;
    } finally {
      this.#state = "closed";
    }
    const failures = rejectedReasons(cleanupResults);
    if (this.#backgroundCleanupFailureCount > 0) failures.push(this.backgroundCleanupFailure());
    if (closeFailure !== undefined) failures.push(closeFailure);
    throwFailures(failures, "Client cleanup failed.");
  }

  addStream(stream: CancellableStream): void {
    this.#activeStreams.add(stream);
  }

  removeStream(stream: CancellableStream): void {
    this.#activeStreams.delete(stream);
  }

  trackLateCleanup(cleanup: Promise<void>): void {
    if (this.#trackedCleanup.has(cleanup)) return;
    this.#trackedCleanup.add(cleanup);
    this.#lateCleanup.add(cleanup);
    void cleanup.then(
      () => {
        this.#lateCleanup.delete(cleanup);
      },
      (error: unknown) => {
        this.#lateCleanup.delete(cleanup);
        if (this.#closingCleanup.has(cleanup)) return;
        if (this.#backgroundCleanupFailureCount === 0) this.#backgroundCleanupFailure = error;
        this.#backgroundCleanupFailureCount += 1;
      },
    );
  }

  private backgroundCleanupFailure(): unknown {
    if (this.#backgroundCleanupFailureCount === 0) return undefined;
    if (this.#backgroundCleanupFailureCount === 1) return this.#backgroundCleanupFailure;
    return new AggregateError(
      [asError(this.#backgroundCleanupFailure)],
      `${String(this.#backgroundCleanupFailureCount)} background client cleanups failed.`,
    );
  }
}

class CommandEventStream implements CommandEvents {
  readonly #owner: ClientOwner;
  readonly #commandId: string | undefined;
  readonly #schemas: readonly MessageSchema[];
  readonly #stream = new BoundedStream<CommandEvent>(
    EVENT_QUEUE_LIMIT,
    () => new ClientProtocolError("command events allow only one iterator consumer."),
    () => new ClientProtocolError("a command event read is already pending."),
  );
  readonly #subscriptions: Subscription[] = [];
  readonly #consumers = new Set<Promise<void>>();

  private constructor(
    owner: ClientOwner,
    commandId: string | undefined,
    schemas: readonly MessageSchema[],
  ) {
    this.#owner = owner;
    this.#commandId = commandId;
    this.#schemas = schemas;
  }

  static async start(
    owner: ClientOwner,
    commandId: string | undefined,
    schemas: readonly MessageSchema[],
    context: ActorContext,
    signal: AbortSignal,
    callerSignal: AbortSignal | undefined,
  ): Promise<CommandEventStream> {
    const events = new CommandEventStream(owner, commandId, schemas);
    owner.addStream(events);
    events.listenForAbort(signal);
    if (callerSignal !== undefined) events.listenForAbort(callerSignal);
    try {
      for (const schema of schemas) {
        await events.subscribe(schema, context);
        events.assertOpen(callerSignal?.aborted ? callerSignal.reason : signal.reason);
      }
      return events;
    } catch (error) {
      const cleanup = events.cancel();
      owner.trackLateCleanup(cleanup);
      await cleanup.catch(() => undefined);
      throw error;
    }
  }

  async subscribe(schema: MessageSchema, context: ActorContext): Promise<void> {
    const service = createClient(SubscriptionService, this.#owner.transport);
    const subscription = await service.subscribe(
      create(TopicSchema, {
        id: { value: `t-${randomUUID()}` },
        target: { type: deriveTypeUrl(schema), criterion: { case: "includeAll", value: true } },
        context,
      }),
      { signal: this.#stream.controller.signal },
    );
    if (this.#stream.closed) {
      const cleanup = this.cancelRemote(subscription);
      this.#owner.trackLateCleanup(cleanup);
      await cleanup.catch(() => undefined);
      return;
    }
    this.#subscriptions.push(subscription);
    const consuming = this.consume(
      service.activate(subscription, { signal: this.#stream.controller.signal }),
    );
    this.#consumers.add(consuming);
    void consuming.finally(() => this.#consumers.delete(consuming));
  }

  cancel(): Promise<void> {
    return this.#stream.cancel(() => this.finishCancellation(), false);
  }

  async finishCancellation(): Promise<void> {
    try {
      const results = await Promise.allSettled([
        ...this.#subscriptions.map(async (subscription) => this.cancelRemote(subscription)),
        ...this.#consumers,
      ]);
      throwFailures(rejectedReasons(results), "Command-event cleanup failed.");
    } finally {
      this.#owner.removeStream(this);
    }
  }

  async cancelRemote(subscription: Subscription): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new ClientProtocolError("subscription cancellation timed out.");
        controller.abort(error);
        reject(error);
      }, SUBSCRIPTION_CANCEL_TIMEOUT_MS);
    });
    try {
      const service = createClient(SubscriptionService, this.#owner.transport);
      await Promise.race([service.cancel(subscription, { signal: controller.signal }), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CommandEvent> {
    return this.#stream.iterator();
  }

  async consume(
    updates: AsyncIterable<import("@spine-event-engine/proto/client").SubscriptionUpdate>,
  ): Promise<void> {
    const iterator = updates[Symbol.asyncIterator]();
    try {
      while (!this.#stream.closed) {
        const next = await this.#stream.race(iterator.next());
        if (next === stopped) return;
        if (next.done) break;
        const update = next.value;
        if (update.update.case !== "eventUpdates") continue;
        for (const event of update.update.value.event) this.push(event);
      }
      if (!this.#stream.closed) {
        this.#stream.finish();
        this.cancelInBackground();
      }
    } catch (error) {
      if (!this.#stream.closed) {
        this.#stream.finish(error, false);
        this.cancelInBackground();
      }
    }
  }

  push(event: import("@spine-event-engine/proto").Event): void {
    const context = event.context;
    if (context === undefined) return;
    // `originId` preserves a frozen wire field whose generated accessor is deprecated.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    if (context.originId.case !== "commandId" || context.originId.value.uuid !== this.#commandId) {
      return;
    }
    const packed = event.message;
    if (packed === undefined) return;
    const schema = this.#schemas.find((candidate) => unpackAny(packed, candidate) !== undefined);
    if (schema === undefined) return;
    const message = unpackAny(packed, schema);
    if (message === undefined) return;
    const item = Object.freeze({
      message: deepClone(schema, message),
      context: deepFreeze(cloneMessage(context)),
    });
    if (!this.#stream.push(item)) {
      const error = new ClientProtocolError("command event buffer overflowed.");
      this.#stream.finish(error, false);
      this.cancelInBackground();
    }
  }

  assertOpen(abortReason: unknown): void {
    if (this.#stream.closed || this.#stream.terminal) {
      if (abortReason !== undefined) throw asError(abortReason);
      throw new ClientProtocolError("command event activation ended before posting.");
    }
  }

  listenForAbort(signal: AbortSignal): void {
    const listener = () => {
      this.cancelInBackground();
    };
    this.#stream.listen(signal, listener);
  }

  private cancelInBackground(): void {
    this.#owner.trackLateCleanup(this.cancel());
  }
}

interface CancellableStream {
  cancel(): Promise<void>;
}

interface TopicStreamInput<Value> {
  readonly schema: MessageSchema;
  readonly context: ActorContext;
  readonly signal: AbortSignal;
  readonly callerSignal: AbortSignal | undefined;
  readonly decode: (update: SubscriptionUpdate) => readonly Value[];
  readonly name: string;
  readonly filters?: TargetFilters | undefined;
  readonly mask?: readonly string[] | undefined;
}

/** Shared bounded lifecycle for public state and event topics. */
class TopicStream<Value> implements AsyncIterable<Value>, CancellableStream {
  readonly #owner: ClientOwner;
  readonly #decode: (update: SubscriptionUpdate) => readonly Value[];
  readonly #name: string;
  readonly #stream: BoundedStream<Value>;
  #subscription: Subscription | undefined;
  #consumer: Promise<void> | undefined;

  private constructor(owner: ClientOwner, input: TopicStreamInput<Value>) {
    this.#owner = owner;
    this.#decode = input.decode;
    this.#name = input.name;
    this.#stream = new BoundedStream(
      EVENT_QUEUE_LIMIT,
      () => new ClientProtocolError(`${input.name} allows only one iterator consumer.`),
      () => new ClientProtocolError(`a ${input.name} read is already pending.`),
    );
  }

  static async start<Value>(
    owner: ClientOwner,
    input: TopicStreamInput<Value>,
  ): Promise<TopicStream<Value>> {
    const stream = new TopicStream(owner, input);
    owner.addStream(stream);
    const abort = () => {
      stream.cancelInBackground();
    };
    stream.listenForAbort(input.signal, abort);
    if (input.callerSignal !== undefined) stream.listenForAbort(input.callerSignal, abort);
    try {
      const service = createClient(SubscriptionService, owner.transport);
      const topic = create(TopicSchema, {
        id: { value: `t-${randomUUID()}` },
        target: {
          type: deriveTypeUrl(input.schema),
          criterion:
            input.filters === undefined
              ? { case: "includeAll", value: true }
              : { case: "filters", value: input.filters },
        },
        ...(input.mask === undefined || input.mask.length === 0
          ? {}
          : { fieldMask: { paths: [...input.mask] } }),
        context: input.context,
      });
      const subscription = await service.subscribe(topic, {
        signal: stream.#stream.controller.signal,
      });
      stream.#subscription = subscription;
      validateSubscription(subscription, topic);
      if (stream.#stream.closed) {
        const cleanup = stream.cancelSubscription(subscription);
        owner.trackLateCleanup(cleanup);
        await cleanup.catch(() => undefined);
        throw (
          input.callerSignal?.reason ??
          input.signal.reason ??
          new ClientProtocolError(`${input.name} activation ended.`)
        );
      }
      const updates = service.activate(subscription, { signal: stream.#stream.controller.signal });
      const iterator = updates[Symbol.asyncIterator]();
      const first = iterator.next();
      const attachment = await observeLocalAttachment(first);
      if (attachment.kind === "error") throw attachment.error;
      stream.#consumer = stream.consume(iterator, first);
      return stream;
    } catch (error) {
      const cleanup = stream.cancel();
      owner.trackLateCleanup(cleanup);
      await cleanup.catch(() => undefined);
      throw error;
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Value> {
    return this.#stream.iterator();
  }

  cancel(): Promise<void> {
    return this.#stream.cancel(async () => {
      try {
        const work: Promise<unknown>[] = [];
        if (this.#subscription !== undefined)
          work.push(this.cancelSubscription(this.#subscription));
        if (this.#consumer !== undefined) work.push(this.#consumer);
        const results = await Promise.allSettled(work);
        throwFailures(rejectedReasons(results), `${this.#name} cleanup failed.`);
      } finally {
        this.#owner.removeStream(this);
      }
    });
  }

  private async consume(
    iterator: AsyncIterator<SubscriptionUpdate>,
    first: Promise<IteratorResult<SubscriptionUpdate>>,
  ): Promise<void> {
    let pending = first;
    try {
      while (!this.#stream.closed) {
        const next = await this.#stream.race(pending);
        if (next === stopped) return;
        if (next.done) break;
        validateUpdateSubscription(next.value, this.#subscription);
        for (const value of this.#decode(next.value)) {
          if (!this.push(value)) return;
        }
        pending = iterator.next();
      }
      if (!this.#stream.closed) {
        this.#stream.finish(undefined, false);
        this.#stream.removeListeners();
        this.#owner.removeStream(this);
      }
    } catch (error) {
      if (!this.#stream.closed) {
        this.#stream.finish(error);
        this.#stream.removeListeners();
        this.cancelInBackground();
      }
    }
  }

  private push(value: Value): boolean {
    if (this.#stream.push(value)) return true;
    this.#stream.finish(new ClientProtocolError(`${this.#name} buffer overflowed.`));
    this.cancelInBackground();
    return false;
  }

  private async cancelSubscription(subscription: Subscription): Promise<void> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new ClientProtocolError("subscription cancellation timed out.");
        controller.abort(error);
        reject(error);
      }, SUBSCRIPTION_CANCEL_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        createClient(SubscriptionService, this.#owner.transport).cancel(subscription, {
          signal: controller.signal,
        }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private cancelInBackground(): void {
    this.#owner.trackLateCleanup(this.cancel());
  }

  private listenForAbort(signal: AbortSignal, onAbort: () => void): void {
    this.#stream.listen(signal, onAbort);
  }
}

function stateSubscriptionFilters<Schema extends MessageSchema, IdSchema extends MessageSchema>(
  schema: Schema,
  idSchema: IdSchema,
  options: StateSubscriptionOptions<Schema, IdSchema>,
): TargetFilters | undefined {
  const predicate = options.where;
  const columns = predicate === undefined ? {} : subscriptionPredicateColumns(predicate);
  const query = ProjectionQuery.select({
    schema,
    columns: columns as never,
    context: create(ActorContextSchema),
  });
  if (predicate !== undefined) query.where(predicate as never);
  const built = query.build();
  const compiled =
    built.target?.criterion.case === "filters"
      ? clone(TargetFiltersSchema, built.target.criterion.value)
      : create(TargetFiltersSchema);
  if (options.ids !== undefined && options.ids.length > 0) {
    compiled.idFilter = create(IdFilterSchema, {
      id: options.ids.map((id) => packAny(idSchema, id)),
    });
  }
  return compiled.idFilter === undefined && compiled.filter.length === 0 ? undefined : compiled;
}

function subscriptionPredicateColumns(
  predicate: ProjectionPredicate,
): Record<string, ProjectionColumn> {
  const result: Record<string, ProjectionColumn> = {};
  const visited = new WeakSet<object>();
  const pending: { readonly predicate: ProjectionPredicate; readonly depth: number }[] = [
    { predicate, depth: 0 },
  ];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (visited.has(current.predicate)) {
      throw new TypeError("Subscription predicate must not contain cycles.");
    }
    visited.add(current.predicate);
    count += 1;
    if (count > SUBSCRIPTION_MAX_PREDICATE_NODES) {
      throw new TypeError(
        `Subscription predicate exceeds maximum node count ${String(SUBSCRIPTION_MAX_PREDICATE_NODES)}.`,
      );
    }
    if (current.depth > SUBSCRIPTION_MAX_PREDICATE_DEPTH) {
      throw new TypeError(
        `Subscription predicate exceeds maximum depth ${String(SUBSCRIPTION_MAX_PREDICATE_DEPTH)}.`,
      );
    }
    if (current.predicate.kind === "comparison") {
      if (current.predicate.operator !== "equal") {
        throw new TypeError("Subscription predicates support equality comparisons only.");
      }
      result[current.predicate.column.name] = current.predicate.column;
      continue;
    }
    if (current.predicate.predicates.length === 0) {
      throw new TypeError(`${current.predicate.kind.toUpperCase()} predicate must not be empty.`);
    }
    for (const child of current.predicate.predicates) {
      pending.push({ predicate: child, depth: current.depth + 1 });
    }
  }
  return result;
}

function validateSubscriptionMask(
  schema: MessageSchema,
  mask: readonly string[] | undefined,
): void {
  if (mask === undefined) return;
  for (const path of mask) {
    if (
      schema.fields.find((field) => field.name === path || field.localName === path) === undefined
    ) {
      throw new TypeError(`Subscription mask path "${path}" is not a state field.`);
    }
  }
}

function decodeStateUpdates<Schema extends MessageSchema, IdSchema extends MessageSchema>(
  update: SubscriptionUpdate,
  schema: Schema,
  idSchema: IdSchema,
): readonly StateSubscriptionUpdate<Schema, IdSchema>[] {
  validateSubscriptionUpdateResponse(update);
  if (update.update.case !== "entityUpdates") {
    throw new ClientProtocolError("state subscription received a non-entity update.");
  }
  return update.update.value.update.flatMap<StateSubscriptionUpdate<Schema, IdSchema>>((entry) => {
    if (entry.kind.case === "state") {
      const state = unpackAny(entry.kind.value, schema);
      if (state === undefined)
        throw new ClientProtocolError("subscription state does not match its requested schema.");
      return [
        Object.freeze({
          kind: "state" as const,
          state: deepClone(schema, state) as DeepReadonly<MessageShape<Schema>>,
        }),
      ];
    }
    if (entry.kind.case === "noLongerMatching") {
      const id = entry.id === undefined ? undefined : unpackAny(entry.id, idSchema);
      if (id === undefined)
        throw new ClientProtocolError(
          "subscription no-longer-matching ID does not match its requested schema.",
        );
      return [
        Object.freeze({
          kind: "noLongerMatching" as const,
          id: deepClone(idSchema, id) as DeepReadonly<MessageShape<IdSchema>>,
        }),
      ];
    }
    throw new ClientProtocolError("subscription state update kind is missing or invalid.");
  });
}

function decodeEventUpdates<Schema extends MessageSchema>(
  update: SubscriptionUpdate,
  schema: Schema,
): readonly SubscriptionEvent<Schema>[] {
  validateSubscriptionUpdateResponse(update);
  if (update.update.case !== "eventUpdates") {
    throw new ClientProtocolError("event subscription received a non-event update.");
  }
  return update.update.value.event.flatMap((event) => {
    const message = event.message === undefined ? undefined : unpackAny(event.message, schema);
    if (message === undefined) {
      throw new ClientProtocolError("subscription event does not match its requested schema.");
    }
    if (event.context === undefined)
      throw new ClientProtocolError("subscription event context is missing.");
    return [
      Object.freeze({
        message: deepClone(schema, message) as DeepReadonly<MessageShape<Schema>>,
        context: deepFreeze(cloneMessage(event.context)),
      }),
    ];
  });
}

function validateSubscription(subscription: Subscription, topic: Topic): void {
  if (subscription.id?.value.length === 0 || subscription.id === undefined) {
    throw new ClientProtocolError("subscription ID is missing or invalid.");
  }
  if (subscription.topic === undefined || !equals(TopicSchema, subscription.topic, topic)) {
    throw new ClientProtocolError("subscription topic does not match the submitted topic.");
  }
}

function validateUpdateSubscription(
  update: SubscriptionUpdate,
  subscription: Subscription | undefined,
): void {
  if (subscription === undefined || update.subscription === undefined) {
    throw new ClientProtocolError("subscription update identity is missing.");
  }
  if (!equals(SubscriptionSchema, update.subscription, subscription)) {
    throw new ClientProtocolError(
      "subscription update identity does not match the accepted subscription.",
    );
  }
}

function validateSubscriptionUpdateResponse(update: SubscriptionUpdate): void {
  if (update.response?.status?.status.case !== "ok") {
    throw new ClientProtocolError("subscription update response is missing or not OK.");
  }
}

async function observeLocalAttachment<Value>(
  first: Promise<IteratorResult<Value>>,
): Promise<
  | Readonly<{ readonly kind: "pending" }>
  | Readonly<{ readonly kind: "error"; readonly error: unknown }>
> {
  const failure = first.then(
    () => new Promise<never>(() => undefined),
    (error: unknown) => Promise.resolve(Object.freeze({ kind: "error" as const, error })),
  );
  let boundary = Promise.resolve();
  for (let turn = 0; turn < 4; turn += 1) boundary = boundary.then(() => undefined);
  return Promise.race([failure, boundary.then(() => Object.freeze({ kind: "pending" as const }))]);
}

const EVENT_QUEUE_LIMIT = 32;
const SUBSCRIPTION_MAX_PREDICATE_DEPTH = 64;
const SUBSCRIPTION_MAX_PREDICATE_NODES = 10_000;
/** One-second bound prevents a caller-owned transport from deadlocking cleanup. */
const SUBSCRIPTION_CANCEL_TIMEOUT_MS = 1_000;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function rejectedReasons(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      failures.push(reason);
    }
  }
  return failures;
}

function throwFailures(failures: readonly unknown[], message: string): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw asError(failures[0]);
  throw new AggregateError(failures.map(asError), message);
}

function tenant(value: string | TenantId | undefined): TenantId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    if (value.kind.case !== "value" || value.kind.value.length === 0) {
      throw new TypeError("Client tenant must not be empty.");
    }
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

interface NormalizedClientOptions {
  readonly tenant: TenantId | undefined;
  readonly zoneId: ZoneId;
}

function normalizeOptions(options: ClientOptions): NormalizedClientOptions {
  return Object.freeze({
    tenant: tenant(options.tenant),
    zoneId: zoneId(options.zoneId),
  });
}

function outcome(status: Status["status"] | undefined): ClientOutcome {
  if (status?.case === "ok") return Object.freeze({ kind: "ok" as const });
  if (status?.case === "error") {
    return Object.freeze({ kind: "error" as const, error: deepFreeze(cloneMessage(status.value)) });
  }
  if (status?.case === "rejection") {
    return Object.freeze({
      kind: "rejection" as const,
      rejection: deepFreeze(cloneMessage(status.value)),
    });
  }
  throw new ClientProtocolError("response status is missing or invalid.");
}

function validateAckId(packed: Any | undefined, commandUuid: string | undefined): void {
  if (packed === undefined || commandUuid === undefined) {
    throw new ClientProtocolError("acknowledgement command ID is missing.");
  }
  const id = unpackAny(packed, CommandIdSchema);
  if (id === undefined || id.uuid.length === 0) {
    throw new ClientProtocolError("acknowledgement command ID is malformed.");
  }
  if (id.uuid !== commandUuid) {
    throw new ClientProtocolError("acknowledgement command ID does not match the posted command.");
  }
}

function decodeState<Schema extends MessageSchema>(
  packed: Any | undefined,
  version: Version | undefined,
  schema: Schema,
): QueryState<Schema> {
  if (packed === undefined) throw new ClientProtocolError("query state is missing.");
  const state = unpackAny(packed, schema);
  if (state === undefined)
    throw new ClientProtocolError("query state does not match its requested schema.");
  if (version === undefined) throw new ClientProtocolError("query state version is missing.");
  return Object.freeze({
    state: deepClone(schema, state) as DeepReadonly<MessageShape<Schema>>,
    version: deepFreeze(cloneMessage(version)),
  });
}

function cloneMessage<MessageValue extends Message>(message: MessageValue): MessageValue {
  return structuredClone(message);
}

function deepClone<Schema extends MessageSchema>(
  schema: Schema,
  message: MessageShape<Schema>,
): MessageShape<Schema> {
  return deepFreeze(clone(schema, message));
}

function deepFreeze<Value>(value: Value, seen = new WeakMap<object, unknown>()): Value {
  if (typeof value !== "object" || value === null) return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing as Value;
  if (value instanceof Uint8Array) {
    const bytes = immutableBytes(value);
    seen.set(value, bytes);
    return bytes as Value;
  }
  seen.set(value, value);
  for (const key of Reflect.ownKeys(value)) {
    const child: unknown = Reflect.get(value, key);
    const frozen = deepFreeze(child, seen);
    if (frozen !== child) Reflect.set(value, key, frozen);
  }
  return Object.freeze(value);
}

function immutableBytes(source: Uint8Array): Uint8Array {
  const bytes = source.slice();
  const blocked = new Set<PropertyKey>(["copyWithin", "fill", "reverse", "set", "sort"]);
  const readonly = new Proxy(bytes, {
    defineProperty: immutableBytesError,
    deleteProperty: immutableBytesError,
    get(target, property) {
      if (property === "buffer") return target.buffer.slice(0);
      if (property === "valueOf") return () => immutableBytes(target);
      if (property === "slice" || property === "subarray") {
        return (start?: number, end?: number) => immutableBytes(target.slice(start, end));
      }
      if (blocked.has(property)) return immutableBytesError;
      const snapshot = target.slice();
      const member: unknown = Reflect.get(snapshot, property, snapshot);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => Reflect.apply(member, snapshot, args) as unknown;
    },
    set: immutableBytesError,
  });
  return readonly;
}

function immutableBytesError(): never {
  throw new TypeError("Client result bytes are immutable.");
}
