import { clone, create, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema, type Any } from "@bufbuild/protobuf/wkt";
import { createClient, type Transport } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { randomUUID } from "node:crypto";
import { deriveTypeUrl, packCommand, unpackAny, type MessageSchema } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type Status,
  type TenantId,
  type Version,
} from "@spine-ts/proto";
import {
  CommandService,
  QuerySchema,
  QueryService,
  SubscriptionService,
  TopicSchema,
  type Query,
  type Subscription,
} from "@spine-ts/proto/client";

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
  readonly state: MessageShape<Schema>;
  readonly version: Version;
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
  readonly message: Message;
  readonly context: Message;
}

/** Options for creating a client. */
export interface ClientOptions {
  readonly tenant?: string | TenantId;
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

  private constructor(owner: ClientOwner, options: ClientOptions) {
    this.#owner = owner;
    this.#tenant = tenant(options.tenant);
  }

  /** Connect to an endpoint using a client-owned HTTP/2 session. */
  static connectTo(baseUrl: string, options: ClientOptions = {}): Client {
    const sessions = new Http2SessionManager(baseUrl);
    return new Client(
      new ClientOwner(createGrpcTransport({ baseUrl, sessionManager: sessions }), () => {
        sessions.abort();
      }),
      options,
    );
  }

  /** Use a caller-owned Connect transport. */
  static usingTransport(transport: Transport, options: ClientOptions = {}): Client {
    return new Client(new ClientOwner(transport), options);
  }

  /** Create an immutable request scope for the guest actor. */
  asGuest(): ClientRequest {
    return new Request(this.#owner, this.#tenant, "guest");
  }

  /** Create an immutable request scope for one actor. */
  onBehalfOf(user: string): ClientRequest {
    if (user.length === 0) throw new TypeError("Client actor must not be empty.");
    return new Request(this.#owner, this.#tenant, user);
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
}

class Request implements ClientRequest {
  readonly #owner: ClientOwner;
  readonly #tenant: TenantId | undefined;
  readonly #actor: string;

  constructor(owner: ClientOwner, selectedTenant: TenantId | undefined, actor: string) {
    this.#owner = owner;
    this.#tenant = selectedTenant;
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
      const events = options.observe === undefined
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
        const ack = await createClient(CommandService, this.#owner.transport).post(command, { signal });
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
      const response = await createClient(QueryService, this.#owner.transport).read(query, { signal });
      const status = outcome(response.response?.status?.status);
      if (status.kind !== "ok") return status;
      const states = response.message.map((entry) => decodeState(entry.state, entry.version, stateSchema));
      return Object.freeze({ kind: "ok" as const, states: Object.freeze(states) });
    });
  }

  #context(): ActorContext {
    return create(ActorContextSchema, {
      ...(this.#tenant === undefined ? {} : { tenantId: clone(TenantIdSchema, this.#tenant) }),
      actor: create(UserIdSchema, { value: this.#actor }),
      timestamp: create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1_000)) }),
    });
  }
}

class ClientOwner {
  readonly transport: Transport;
  readonly #closeTransport: (() => void) | undefined;
  readonly #operations = new Map<AbortController, Promise<unknown>>();
  readonly #events = new Set<CommandEventStream>();
  readonly #lateCleanup = new Set<Promise<void>>();
  readonly #trackedCleanup = new WeakSet<Promise<void>>();
  readonly #closingCleanup = new WeakSet<Promise<void>>();
  #backgroundCleanupFailure: unknown;
  #backgroundCleanupFailureCount = 0;
  #state: "open" | "closing" | "closed" = "open";
  #closing: Promise<void> | undefined;

  constructor(transport: Transport, closeTransport?: () => void) {
    this.transport = transport;
    this.#closeTransport = closeTransport;
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
    const events = [...this.#events];
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
      this.#closeTransport?.();
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

  addEvents(events: CommandEventStream): void {
    this.#events.add(events);
  }

  removeEvents(events: CommandEventStream): void {
    this.#events.delete(events);
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
  readonly #controller = new AbortController();
  readonly #queue: CommandEvent[] = [];
  readonly #subscriptions: Subscription[] = [];
  readonly #consumers = new Set<Promise<void>>();
  readonly #abortListeners: { readonly signal: AbortSignal; readonly listener: () => void }[] = [];
  readonly #stopped: Promise<typeof STREAM_STOPPED>;
  #stop!: () => void;
  #waiter: {
    readonly resolve: (result: IteratorResult<CommandEvent>) => void;
    readonly reject: (error: unknown) => void;
  } | undefined;
  #terminal: Readonly<{ readonly error?: Error }> | undefined;
  #iteratorClaimed = false;
  #cancelling: Promise<void> | undefined;
  #closed = false;

  private constructor(owner: ClientOwner, commandId: string | undefined, schemas: readonly MessageSchema[]) {
    this.#owner = owner;
    this.#commandId = commandId;
    this.#schemas = schemas;
    this.#stopped = new Promise((resolve) => {
      this.#stop = () => {
        resolve(STREAM_STOPPED);
      };
    });
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
    owner.addEvents(events);
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
      { signal: this.#controller.signal },
    );
    if (this.#closed) {
      const cleanup = this.cancelRemote(subscription);
      this.#owner.trackLateCleanup(cleanup);
      await cleanup.catch(() => undefined);
      return;
    }
    this.#subscriptions.push(subscription);
    const consuming = this.consume(service.activate(subscription, { signal: this.#controller.signal }));
    this.#consumers.add(consuming);
    void consuming.finally(() => this.#consumers.delete(consuming));
  }

  cancel(): Promise<void> {
    if (this.#cancelling !== undefined) return this.#cancelling;
    this.#closed = true;
    this.finish();
    this.#stop();
    this.#controller.abort();
    for (const { signal, listener } of this.#abortListeners.splice(0)) {
      signal.removeEventListener("abort", listener);
    }
    this.#cancelling = this.finishCancellation();
    return this.#cancelling;
  }

  async finishCancellation(): Promise<void> {
    try {
      const results = await Promise.allSettled([
        ...this.#subscriptions.map(async (subscription) => this.cancelRemote(subscription)),
        ...this.#consumers,
      ]);
      throwFailures(rejectedReasons(results), "Command-event cleanup failed.");
    } finally {
      this.#owner.removeEvents(this);
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
    if (this.#iteratorClaimed) {
      throw new ClientProtocolError("command events allow only one iterator consumer.");
    }
    this.#iteratorClaimed = true;
    return { next: () => this.next() };
  }

  async consume(updates: AsyncIterable<import("@spine-ts/proto/client").SubscriptionUpdate>): Promise<void> {
    const iterator = updates[Symbol.asyncIterator]();
    try {
      while (!this.#closed) {
        const next = await Promise.race([iterator.next(), this.#stopped]);
        if (next === STREAM_STOPPED) return;
        if (next.done) break;
        const update = next.value;
        if (update.update.case !== "eventUpdates") continue;
        for (const event of update.update.value.event) this.push(event);
      }
      if (!this.#closed) {
        this.finish();
        this.cancelInBackground();
      }
    } catch (error) {
      if (!this.#closed) {
        this.finish(error);
        this.cancelInBackground();
      }
    }
  }

  push(event: import("@spine-ts/proto").Event): void {
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
    const waiter = this.#waiter;
    if (waiter !== undefined) {
      this.#waiter = undefined;
      waiter.resolve({ done: false, value: item });
    } else if (this.#queue.length < EVENT_QUEUE_LIMIT) {
      this.#queue.push(item);
    } else {
      const error = new ClientProtocolError("command event buffer overflowed.");
      this.finish(error);
      this.cancelInBackground();
    }
  }

  next(): Promise<IteratorResult<CommandEvent>> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return Promise.resolve({ done: false, value: queued });
    if (this.#terminal !== undefined) {
      return this.#terminal.error === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.#terminal.error);
    }
    if (this.#waiter !== undefined) {
      return Promise.reject(new ClientProtocolError("a command event read is already pending."));
    }
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  finish(error?: unknown): void {
    if (this.#terminal !== undefined) return;
    const failure = error === undefined ? undefined : asError(error);
    this.#terminal = failure === undefined ? Object.freeze({}) : Object.freeze({ error: failure });
    const waiter = this.#waiter;
    this.#waiter = undefined;
    if (waiter === undefined) return;
    if (failure === undefined) waiter.resolve({ done: true, value: undefined });
    else waiter.reject(failure);
  }

  assertOpen(abortReason: unknown): void {
    if (this.#closed || this.#terminal !== undefined) {
      if (abortReason !== undefined) throw asError(abortReason);
      throw new ClientProtocolError("command event activation ended before posting.");
    }
  }

  listenForAbort(signal: AbortSignal): void {
    const listener = () => {
      this.cancelInBackground();
    };
    this.#abortListeners.push({ signal, listener });
    signal.addEventListener("abort", listener, { once: true });
  }

  private cancelInBackground(): void {
    this.#owner.trackLateCleanup(this.cancel());
  }
}

const EVENT_QUEUE_LIMIT = 32;
/** One-second bound prevents a caller-owned transport from deadlocking cleanup. */
const SUBSCRIPTION_CANCEL_TIMEOUT_MS = 1_000;
const STREAM_STOPPED = Symbol("stream stopped");

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
  if (typeof value !== "string") return clone(TenantIdSchema, value);
  if (value.length === 0) throw new TypeError("Client tenant must not be empty.");
  return create(TenantIdSchema, { kind: { case: "value", value } });
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
  if (state === undefined) throw new ClientProtocolError("query state does not match its requested schema.");
  if (version === undefined) throw new ClientProtocolError("query state version is missing.");
  return Object.freeze({ state: deepClone(schema, state), version: deepFreeze(cloneMessage(version)) });
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
