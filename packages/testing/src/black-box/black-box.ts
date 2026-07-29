import { clone, create, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  Client as NodeClient,
  type ClientKernel,
  type ClientOperationOptions,
  type ClientOutcome,
  type ClientRequest,
  type Subscription,
  type CreateSubscriptionOptions,
} from "@spine-event-engine/client-node";
import { packEvent } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  EventContextSchema,
  EventIdSchema,
  TenantIdSchema,
  UserIdSchema,
  ZoneIdSchema,
  type TenantId,
  type ZoneId,
} from "@spine-event-engine/proto";
import type { Query, Topic } from "@spine-event-engine/proto/client";
import {
  BoundedContext,
  type BoundedContextBuilder,
  Server,
  type RunningServer,
} from "@spine-event-engine/server";
import { randomUUID } from "node:crypto";

/** Fixed configuration for one runner-neutral BlackBox session. */
export interface BlackBoxOptions {
  /** Fixed tenant for this BlackBox; required only by multitenant contexts. */
  readonly tenant?: string | TenantId;
  /** Fixed IANA time zone for every operation in this BlackBox. */
  readonly zoneId?: string | ZoneId;
  /** Maximum time an eventual read may wait, as a positive integer. Defaults to 500 milliseconds. */
  readonly timeoutMs?: number;
  /** Delay between eventual read attempts, as a positive integer. Defaults to 5 milliseconds. */
  readonly intervalMs?: number;
}

/** Stable error thrown when an eventual read cannot satisfy its predicate. */
export class BlackBoxTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`BlackBox eventually timed out after ${timeoutMs.toString()} milliseconds.`);
    this.name = "BlackBoxTimeoutError";
  }
}

/** Stable error thrown when an operation is attempted after BlackBox close begins. */
export class BlackBoxClosedError extends Error {
  constructor() {
    super("BlackBox is closed.");
    this.name = "BlackBoxClosedError";
  }
}

/** One immutable actor scope within a BlackBox. */
export interface BlackBoxScope extends ClientRequest {
  postEvent<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): Promise<void>;
}

interface BlackBoxInternal {
  assertOpen(): void;
  postEvent<Schema extends GenMessage<Message>>(
    actor: string,
    schema: Schema,
    message: MessageShape<Schema>,
  ): Promise<void>;
  track<Handle extends { cancel(): Promise<void> }>(handle: Handle): Handle;
  onRelease(handle: { cancel(): Promise<void> }): void;
}

const blackBoxInternals = new WeakMap<BlackBox, BlackBoxInternal>();

function internalsOf(blackBox: BlackBox): BlackBoxInternal {
  const internals = blackBoxInternals.get(blackBox);
  if (internals === undefined) throw new Error("BlackBox internals are unavailable.");
  return internals;
}

/** A runner-neutral public-client test facade over one local bounded context. */
export class BlackBox {
  readonly #context: BoundedContext;
  readonly #server: RunningServer;
  readonly #client: ClientKernel;
  readonly #tenant: TenantId | undefined;
  readonly #zoneId: ZoneId;
  readonly #timeoutMs: number;
  readonly #intervalMs: number;
  readonly #waits = new AbortController();
  readonly #subscriptions = new Set<{ cancel(): Promise<void> }>();
  #admitting = true;
  #closing: Promise<void> | undefined;

  private constructor(
    context: BoundedContext,
    server: RunningServer,
    client: ClientKernel,
    options: NormalizedBlackBoxOptions,
  ) {
    this.#context = context;
    this.#server = server;
    this.#client = client;
    this.#tenant = cloneTenant(options.tenant);
    this.#zoneId = clone(ZoneIdSchema, options.zoneId);
    this.#timeoutMs = options.timeoutMs;
    this.#intervalMs = options.intervalMs;
    blackBoxInternals.set(this, {
      assertOpen: () => {
        this.#assertOpen();
      },
      postEvent: (actor, schema, message) => this.#postEvent(actor, schema, message),
      track: (handle) => this.#track(handle),
      onRelease: (handle) => {
        this.#release(handle);
      },
    });
  }

  /** Start one ephemeral local server and one public client for a context or builder. */
  static async from(
    contextOrBuilder: BoundedContext | BoundedContextBuilder,
    options: BlackBoxOptions = {},
  ): Promise<BlackBox> {
    const normalized = normalizeOptions(contextOrBuilder, options);
    const context =
      contextOrBuilder instanceof BoundedContext
        ? contextOrBuilder
        : await contextOrBuilder.buildAsync();
    return openBlackBox(
      context,
      normalized,
      () => new Server({ contexts: [context] }).start(),
      (server) =>
        NodeClient.connectTo(server.baseUrl, {
          ...(normalized.tenant === undefined ? {} : { tenant: normalized.tenant }),
          zoneId: normalized.zoneId,
        }),
    );
  }

  /** Create the guest scope. */
  asGuest(): BlackBoxScope {
    this.#assertOpen();
    return new Request(this, this.#client.asGuest(), "guest");
  }

  /** Create an immutable scope for one actor. */
  onBehalfOf(actor: string): BlackBoxScope {
    this.#assertOpen();
    return new Request(this, this.#client.onBehalfOf(actor), actor);
  }

  /** Poll a read function until its predicate accepts or the bounded wait expires. */
  async eventually<Value>(
    read: () => Value | Promise<Value>,
    accept: (value: Value) => boolean,
    options: Pick<BlackBoxOptions, "timeoutMs" | "intervalMs"> = {},
  ): Promise<Value> {
    this.#assertOpen();
    const timeoutMs = positiveInteger(options.timeoutMs ?? this.#timeoutMs, "timeoutMs");
    const intervalMs = positiveInteger(options.intervalMs ?? this.#intervalMs, "intervalMs");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      this.#assertOpen();
      if (accept(value)) return value;
      if (Date.now() >= deadline) throw new BlackBoxTimeoutError(timeoutMs);
      await wait(Math.min(intervalMs, deadline - Date.now()), this.#waits.signal);
    }
  }

  /** Stop admission, cancel owned subscriptions, then close the client and server once. */
  close(): Promise<void> {
    this.#closing ??= this.closeOnce();
    return this.#closing;
  }

  #assertOpen(): void {
    if (!this.#admitting) throw new BlackBoxClosedError();
  }

  async #postEvent<Schema extends GenMessage<Message>>(
    actor: string,
    schema: Schema,
    message: MessageShape<Schema>,
  ): Promise<void> {
    this.#assertOpen();
    const id = create(EventIdSchema, { value: randomUUID() });
    await this.#context.eventBus().post(
      packEvent({
        id,
        context: create(EventContextSchema, {
          timestamp: timestamp(),
          origin: { case: "importContext", value: this.#actorContext(actor) },
        }),
        schema,
        message,
      }),
    );
  }

  #track<Handle extends { cancel(): Promise<void> }>(handle: Handle): Handle {
    this.#assertOpen();
    this.#subscriptions.add(handle);
    return handle;
  }

  #release(handle: { cancel(): Promise<void> }): void {
    this.#subscriptions.delete(handle);
  }

  #actorContext(actor: string) {
    return create(ActorContextSchema, {
      ...(this.#tenant === undefined ? {} : { tenantId: clone(TenantIdSchema, this.#tenant) }),
      actor: create(UserIdSchema, { value: actor }),
      zoneId: clone(ZoneIdSchema, this.#zoneId),
      timestamp: timestamp(),
    });
  }

  private async closeOnce(): Promise<void> {
    this.#admitting = false;
    this.#waits.abort(new BlackBoxClosedError());
    const failures = rejected(
      await Promise.allSettled([...this.#subscriptions].map((item) => item.cancel())),
    );
    for (const operation of [() => this.#client.close(), () => this.#server.close()]) {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "BlackBox cleanup failed.");
  }
}

/** @internal Internal lifecycle seam; intentionally omitted from the package entry point. */
export function createTestBlackBox(resources: {
  readonly client: { close(): Promise<void> };
  readonly server: { close(): Promise<void> };
  readonly subscriptions?: readonly { cancel(): Promise<void> }[];
}): BlackBox {
  const blackBox = instantiateBlackBox(
    {} as BoundedContext,
    resources.server as RunningServer,
    resources.client as ClientKernel,
    defaultNormalizedOptions(),
  );
  for (const subscription of resources.subscriptions ?? [])
    internalsOf(blackBox).track(subscription);
  return blackBox;
}

/** @internal Internal tracked-handle seam; intentionally omitted from the package entry point. */
export function trackTestHandle(
  blackBox: BlackBox,
  handle: { cancel(): Promise<void> } & AsyncIterable<unknown>,
): AsyncIterable<unknown> & { cancel(): Promise<void> } {
  const tracked = new Tracked(handle, () => {
    internalsOf(blackBox).onRelease(tracked);
  });
  return internalsOf(blackBox).track(tracked);
}

/** @internal Internal startup seam; intentionally omitted from the package entry point. */
export function openTestBlackBox(resources: {
  readonly start: () => Promise<{ close(): Promise<void> }>;
  readonly connect: (server: { close(): Promise<void> }) => { close(): Promise<void> };
}): Promise<BlackBox> {
  return openBlackBox(
    {} as BoundedContext,
    defaultNormalizedOptions(),
    resources.start as () => Promise<RunningServer>,
    resources.connect as unknown as (server: RunningServer) => ClientKernel,
  );
}

async function openBlackBox(
  context: BoundedContext,
  options: NormalizedBlackBoxOptions,
  start: () => Promise<RunningServer>,
  connect: (server: RunningServer) => ClientKernel,
): Promise<BlackBox> {
  let server: RunningServer | undefined;
  let client: ClientKernel | undefined;
  try {
    server = await start();
    client = connect(server);
    return instantiateBlackBox(context, server, client, options);
  } catch (error) {
    const failures: unknown[] = [error];
    for (const resource of [client, server]) {
      if (resource === undefined) continue;
      try {
        await resource.close();
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, "BlackBox startup cleanup failed.");
  }
}

function instantiateBlackBox(
  context: BoundedContext,
  server: RunningServer,
  client: ClientKernel,
  options: NormalizedBlackBoxOptions,
): BlackBox {
  const BlackBoxConstructor = BlackBox as unknown as new (
    context: BoundedContext,
    server: RunningServer,
    client: ClientKernel,
    options: NormalizedBlackBoxOptions,
  ) => BlackBox;
  return new BlackBoxConstructor(context, server, client, options);
}

class Request implements BlackBoxScope {
  readonly #internals: BlackBoxInternal;
  readonly #request: ClientRequest;
  readonly #actor: string;

  constructor(blackBox: BlackBox, request: ClientRequest, actor: string) {
    this.#internals = internalsOf(blackBox);
    this.#request = request;
    this.#actor = actor;
  }

  post<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: ClientOperationOptions = {},
  ): Promise<ClientOutcome> {
    this.#internals.assertOpen();
    return this.#request.post(schema, message, options);
  }

  postEvent<Schema extends GenMessage<Message>>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): Promise<void> {
    return this.#internals.postEvent(this.#actor, schema, message);
  }

  send(query: Query | { build(): Query }, options?: ClientOperationOptions) {
    this.#internals.assertOpen();
    return this.#request.send(query, options);
  }

  async createSubscription(
    topic: Topic,
    options: CreateSubscriptionOptions,
  ): Promise<Subscription> {
    this.#internals.assertOpen();
    const subscription = await this.#request.createSubscription(topic, options);
    const tracked = new TrackedSubscription(subscription, () => {
      this.#internals.onRelease(tracked);
    });
    return this.#internals.track(tracked);
  }
}

class TrackedSubscription implements Subscription {
  readonly #handle: Subscription;
  readonly #onRelease: () => void;
  #released = false;
  #cancellation: Promise<void> | undefined;

  constructor(handle: Subscription, onRelease: () => void) {
    this.#handle = handle;
    this.#onRelease = onRelease;
  }

  get updates(): AsyncIterable<import("@spine-event-engine/client-node").SubscriptionDelivery> {
    return this.trackStream(this.#handle.updates);
  }

  get lifecycle(): AsyncIterable<import("@spine-event-engine/client-node").SubscriptionLifecycle> {
    return this.trackStream(this.#handle.lifecycle);
  }

  activate(options?: ClientOperationOptions): Promise<void> {
    return this.#handle.activate(options);
  }

  async cancel(): Promise<void> {
    try {
      this.#cancellation ??= this.#handle.cancel();
      await this.#cancellation;
    } finally {
      this.release();
    }
  }

  private trackStream<Value>(source: AsyncIterable<Value>): AsyncIterable<Value> {
    const onRelease = () => {
      this.release();
    };
    const onCancel = () => this.cancel();
    return {
      [Symbol.asyncIterator](): AsyncIterator<Value> {
        const iterator = source[Symbol.asyncIterator]();
        return {
          next: async () => {
            try {
              const result = await iterator.next();
              if (result.done) onRelease();
              return result;
            } catch (error) {
              onRelease();
              throw error;
            }
          },
          return: async (value) => {
            try {
              await onCancel();
              const returned = await iterator.return?.(value);
              return returned ?? { done: true, value: undefined };
            } finally {
              onRelease();
            }
          },
          throw: async (error) => {
            try {
              await onCancel();
              if (iterator.throw === undefined) throw error;
              return await iterator.throw(error);
            } finally {
              onRelease();
            }
          },
        };
      },
    };
  }

  private release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#onRelease();
  }
}

class Tracked<Handle extends { cancel(): Promise<void> }> {
  readonly #handle: Handle;
  readonly #onRelease: () => void;
  #cancellation: Promise<void> | undefined;
  constructor(handle: Handle, onRelease: () => void) {
    this.#handle = handle;
    this.#onRelease = onRelease;
  }
  async activate(...arguments_: []): Promise<void> {
    const subscription = this.#handle as Handle & { activate?: () => Promise<void> };
    if (subscription.activate === undefined) {
      throw new TypeError("Tracked handle does not support activation.");
    }
    await subscription.activate(...arguments_);
  }
  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    const iterator = (this.#handle as Handle & AsyncIterable<unknown>)[Symbol.asyncIterator]();
    return {
      next: async (...arguments_) => {
        try {
          const result = await iterator.next(...arguments_);
          if (result.done) this.#onRelease();
          return result;
        } catch (error) {
          this.#onRelease();
          throw error;
        }
      },
      return: async (value) => {
        try {
          await this.cancel();
          const returned: unknown = await iterator.return?.(value);
          if (returned !== undefined) return returned as IteratorResult<unknown>;
          return { done: true, value: undefined };
        } finally {
          this.#onRelease();
        }
      },
      throw: async (error) => {
        try {
          await this.cancel();
          if (iterator.throw === undefined) throw error;
          return await iterator.throw(error);
        } finally {
          this.#onRelease();
        }
      },
    };
  }
  async cancel(): Promise<void> {
    try {
      this.#cancellation ??= this.#handle.cancel();
      await this.#cancellation;
    } finally {
      this.#onRelease();
    }
  }
}

interface NormalizedBlackBoxOptions {
  readonly tenant: TenantId | undefined;
  readonly zoneId: ZoneId;
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

function normalizeOptions(
  context: BoundedContext | BoundedContextBuilder,
  options: BlackBoxOptions,
): NormalizedBlackBoxOptions {
  const multi = context instanceof BoundedContext ? context.isMultitenant : context.isMultitenant();
  const selectedTenant = tenant(options.tenant);
  if (multi && selectedTenant === undefined)
    throw new TypeError("BlackBox multitenant context requires a tenant.");
  if (!multi && selectedTenant !== undefined)
    throw new TypeError("BlackBox single-tenant context rejects a tenant.");
  return Object.freeze({
    tenant: selectedTenant,
    zoneId: zoneId(options.zoneId),
    timeoutMs: positiveInteger(options.timeoutMs ?? 500, "timeoutMs"),
    intervalMs: positiveInteger(options.intervalMs ?? 5, "intervalMs"),
  });
}
function cloneTenant(value: TenantId | undefined): TenantId | undefined {
  return value === undefined ? undefined : clone(TenantIdSchema, value);
}
function defaultNormalizedOptions(): NormalizedBlackBoxOptions {
  return Object.freeze({
    tenant: undefined,
    zoneId: zoneId(undefined),
    timeoutMs: 500,
    intervalMs: 5,
  });
}
function tenant(value: string | TenantId | undefined): TenantId | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    if (value.kind.case !== "value" || value.kind.value.length === 0)
      throw new TypeError("BlackBox tenant must not be empty.");
    return clone(TenantIdSchema, value);
  }
  if (value.length === 0) throw new TypeError("BlackBox tenant must not be empty.");
  return create(TenantIdSchema, { kind: { case: "value", value } });
}
function zoneId(value: string | ZoneId | undefined): ZoneId {
  if (typeof value !== "string" && value !== undefined) {
    if (value.value.length === 0) throw new TypeError("BlackBox zoneId must not be empty.");
    return clone(ZoneIdSchema, value);
  }
  const zone = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone.length === 0) throw new TypeError("BlackBox zoneId must not be empty.");
  return create(ZoneIdSchema, { value: zone });
}
function timestamp() {
  return create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1_000)) });
}
function positiveInteger(value: number, name: "timeoutMs" | "intervalMs"): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new TypeError(`BlackBox ${name} must be a positive integer.`);
  return value;
}
function rejected(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  return failures;
}
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
