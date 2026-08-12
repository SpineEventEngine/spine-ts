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
import { SignalEnvelopes } from "@spine-event-engine/core";
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

/**
 * Fixed configuration for one runner-neutral BlackBox session.
 */
export interface BlackBoxOptions {
  // prettier-ignore

  /**
   * Fixed tenant for this BlackBox; required only by multitenant contexts.
   */
  readonly tenant?: string | TenantId;

  /**
   * Fixed IANA time zone for every operation in this BlackBox.
   */
  readonly zoneId?: string | ZoneId;

  /**
   * Maximum time an eventual read may wait, as a positive integer. Defaults to 500 milliseconds.
   */
  readonly timeoutMs?: number;

  /**
   * Delay between eventual read attempts, as a positive integer. Defaults to 5 milliseconds.
   */
  readonly intervalMs?: number;
}

/**
 * Stable error thrown when an eventual read cannot satisfy its predicate.
 */
export class BlackBoxTimeoutError extends Error {
  // prettier-ignore

  /**
   * Creates a timeout error.
   *
   * @param timeoutMs The elapsed wait limit in milliseconds.
   */
  constructor(timeoutMs: number) {
    super(`BlackBox eventually timed out after ${timeoutMs.toString()} milliseconds.`);
    this.name = "BlackBoxTimeoutError";
  }
}

/**
 * Stable error thrown when an operation is attempted after BlackBox close begins.
 */
export class BlackBoxClosedError extends Error {
  // prettier-ignore

  /**
   * Creates a closed error.
   */
  constructor() {
    super("BlackBox is closed.");
    this.name = "BlackBoxClosedError";
  }
}

/**
 * One immutable actor scope within a BlackBox.
 */
export interface BlackBoxScope extends ClientRequest {
  // prettier-ignore

  /**
   * Posts a direct domain event through this actor scope.
   *
   * @param schema The schema of the event message.
   * @param message The event message to post.
   * @returns A promise that resolves after the event is posted.
   */
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

/**
 * A runner-neutral public-client test facade over one local bounded context.
 */
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
    this.#tenant = BlackBoxOptionsValues.cloneTenant(options.tenant);
    this.#zoneId = clone(ZoneIdSchema, options.zoneId);
    this.#timeoutMs = options.timeoutMs;
    this.#intervalMs = options.intervalMs;
    BlackBoxAccess.set(this, {
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

  /**
   * Starts an ephemeral local server and public client for a context or builder.
   *
   * @param contextOrBuilder The bounded context or builder to exercise.
   * @param options The tenant, zone, and eventual-wait options.
   * @returns A ready BlackBox.
   */
  static async from(
    contextOrBuilder: BoundedContext | BoundedContextBuilder,
    options: BlackBoxOptions = {},
  ): Promise<BlackBox> {
    const normalized = BlackBoxOptionsValues.normalize(contextOrBuilder, options);
    const context =
      contextOrBuilder instanceof BoundedContext
        ? contextOrBuilder
        : await contextOrBuilder.buildAsync();
    return BlackBoxLifecycle.open(
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

  /**
   * Creates the guest scope.
   *
   * @returns An immutable guest request scope.
   */
  asGuest(): BlackBoxScope {
    this.#assertOpen();
    return new Request(this, this.#client.asGuest(), "guest");
  }

  /**
   * Creates an immutable scope for one actor.
   *
   * @param actor The actor identifier for requests and direct events.
   * @returns An immutable actor request scope.
   */
  onBehalfOf(actor: string): BlackBoxScope {
    this.#assertOpen();
    return new Request(this, this.#client.onBehalfOf(actor), actor);
  }

  /**
   * Reads repeatedly until the predicate accepts or the bounded wait expires.
   *
   * @param read The value-producing operation to retry.
   * @param accept The predicate that accepts a produced value.
   * @param options Optional wait limits for this operation.
   * @returns The first accepted value.
   */
  async eventually<Value>(
    read: () => Value | Promise<Value>,
    accept: (value: Value) => boolean,
    options: Pick<BlackBoxOptions, "timeoutMs" | "intervalMs"> = {},
  ): Promise<Value> {
    this.#assertOpen();
    const timeoutMs = BlackBoxOptionsValues.positiveInteger(
      options.timeoutMs ?? this.#timeoutMs,
      "timeoutMs",
    );
    const intervalMs = BlackBoxOptionsValues.positiveInteger(
      options.intervalMs ?? this.#intervalMs,
      "intervalMs",
    );
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      this.#assertOpen();
      if (accept(value)) return value;
      if (Date.now() >= deadline) throw new BlackBoxTimeoutError(timeoutMs);
      await BlackBoxClock.wait(Math.min(intervalMs, deadline - Date.now()), this.#waits.signal);
    }
  }

  /**
   * Stops admission, cancels owned subscriptions, and closes the client and server once.
   *
   * @returns A shared promise that resolves after cleanup completes.
   */
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
      SignalEnvelopes.event({
        id,
        context: create(EventContextSchema, {
          timestamp: BlackBoxClock.timestamp(),
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
      timestamp: BlackBoxClock.timestamp(),
    });
  }

  private async closeOnce(): Promise<void> {
    this.#admitting = false;
    this.#waits.abort(new BlackBoxClosedError());
    const failures = BlackBoxFailures.rejected(
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

/**
 * Holds internal operations without exposing them through the BlackBox facade.
 */
const BlackBoxAccess = (() => {
  const values = new WeakMap<BlackBox, BlackBoxInternal>();
  return Object.freeze({
    // prettier-ignore

    /**
     * Associates internal operations with a BlackBox.
     */
    set(blackBox: BlackBox, internals: BlackBoxInternal): void {
      values.set(blackBox, internals);
    },

    /**
     * Obtains the internal operations for a BlackBox.
     */
    get(blackBox: BlackBox): BlackBoxInternal {
      const internals = values.get(blackBox);
      if (internals === undefined) throw new Error("BlackBox internals are unavailable.");
      return internals;
    },
  });
})();

/**
 * Internal operations exposed only through the unexported test-access module.
 */
export interface BlackBoxTestAccess {
  // prettier-ignore

  /**
   * Creates a BlackBox with supplied closeable resources.
   *
   * @param resources The test client, server, and optional subscriptions.
   * @returns A BlackBox that owns the supplied resources.
   */
  create(resources: BlackBoxTestResources): BlackBox;

  /**
   * Returns a generic subscription-like handle for lifecycle regression tests.
   *
   * @param blackBox The BlackBox that owns the handle.
   * @param handle The cancelable async handle to track.
   * @returns The tracked handle.
   */
  track(
    blackBox: BlackBox,
    handle: BlackBoxTestHandle,
  ): AsyncIterable<unknown> & { cancel(): Promise<void> };

  /**
   * Opens a BlackBox through supplied lifecycle seams for startup regression tests.
   *
   * @param resources The test startup and connection operations.
   * @returns A BlackBox created through the supplied operations.
   */
  open(resources: BlackBoxTestStartup): Promise<BlackBox>;
}

/**
 * Provides internal-only lifecycle seams for BlackBox regression tests.
 */
export const BlackBoxTestAccess: BlackBoxTestAccess = Object.freeze({
  // prettier-ignore

  /**
   * Creates a BlackBox with supplied closeable resources.
   *
   * @param resources The test client, server, and optional subscriptions.
   * @returns A BlackBox that owns the supplied resources.
   */
  create(resources: BlackBoxTestResources): BlackBox {
    const blackBox = BlackBoxLifecycle.instantiate(
      {} as BoundedContext,
      resources.server as RunningServer,
      resources.client as ClientKernel,
      BlackBoxOptionsValues.defaults(),
    );
    for (const subscription of resources.subscriptions ?? [])
      BlackBoxAccess.get(blackBox).track(subscription);
    return blackBox;
  },

  /**
   * Returns a generic subscription-like handle for lifecycle regression tests.
   *
   * @param blackBox The BlackBox that owns the handle.
   * @param handle The cancelable async handle to track.
   * @returns The tracked handle.
   */
  track(
    blackBox: BlackBox,
    handle: BlackBoxTestHandle,
  ): AsyncIterable<unknown> & { cancel(): Promise<void> } {
    const tracked = new Tracked(handle, () => {
      BlackBoxAccess.get(blackBox).onRelease(tracked);
    });
    return BlackBoxAccess.get(blackBox).track(tracked);
  },

  /**
   * Opens a BlackBox through supplied lifecycle seams for startup regression tests.
   *
   * @param resources The test startup and connection operations.
   * @returns A BlackBox created through the supplied operations.
   */
  open(resources: BlackBoxTestStartup): Promise<BlackBox> {
    return BlackBoxLifecycle.open(
      {} as BoundedContext,
      BlackBoxOptionsValues.defaults(),
      resources.start as () => Promise<RunningServer>,
      resources.connect as unknown as (server: RunningServer) => ClientKernel,
    );
  },
});

/**
 * Constructs BlackBox instances and compensates for failed startup.
 */
const BlackBoxLifecycle = Object.freeze({
  // prettier-ignore

  /**
   * Opens the server and client before constructing a BlackBox.
   */
  async open(
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
      return this.instantiate(context, server, client, options);
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
  },

  /**
   * Instantiates a BlackBox through its deliberately private constructor.
   */
  instantiate(
    context: BoundedContext,
    server: RunningServer,
    client: ClientKernel,
    options: NormalizedBlackBoxOptions,
  ): BlackBox {
    const Constructor = BlackBox as unknown as new (
      context: BoundedContext,
      server: RunningServer,
      client: ClientKernel,
      options: NormalizedBlackBoxOptions,
    ) => BlackBox;
    return new Constructor(context, server, client, options);
  },
});

/**
 * Internal resources accepted by the BlackBox lifecycle test seam.
 */
export interface BlackBoxTestResources {
  // prettier-ignore

  /**
   * Closes the test client.
   */
  readonly client: { close(): Promise<void> };

  /**
   * Closes the test server.
   */
  readonly server: { close(): Promise<void> };

  /**
   * Lists subscriptions to close with the BlackBox.
   */
  readonly subscriptions?: readonly { cancel(): Promise<void> }[];
}

/**
 * Internal async handle accepted by the BlackBox lifecycle test seam.
 */
export type BlackBoxTestHandle = {
  // prettier-ignore

  /**
   * Cancels the tracked handle.
   *
   * @returns A promise that resolves after cancellation completes.
   */
  cancel(): Promise<void>;
} & AsyncIterable<unknown>;

/**
 * Internal startup operations accepted by the BlackBox lifecycle test seam.
 */
export interface BlackBoxTestStartup {
  // prettier-ignore

  /**
   * Starts the test server.
   *
   * @returns A closeable test server.
   */
  readonly start: () => Promise<{ close(): Promise<void> }>;

  /**
   * Connects the test client to the started server.
   *
   * @param server The server returned by start.
   * @returns A closeable test client.
   */
  readonly connect: (server: { close(): Promise<void> }) => { close(): Promise<void> };
}

class Request implements BlackBoxScope {
  readonly #internals: BlackBoxInternal;
  readonly #request: ClientRequest;
  readonly #actor: string;

  constructor(blackBox: BlackBox, request: ClientRequest, actor: string) {
    this.#internals = BlackBoxAccess.get(blackBox);
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

/**
 * Normalizes BlackBox configuration and validates its tenant and timing rules.
 */
const BlackBoxOptionsValues = Object.freeze({
  // prettier-ignore

  /**
   * Normalizes options for one context.
   */
  normalize(
    context: BoundedContext | BoundedContextBuilder,
    options: BlackBoxOptions,
  ): NormalizedBlackBoxOptions {
    const multi =
      context instanceof BoundedContext ? context.isMultitenant : context.isMultitenant();
    const selectedTenant = this.tenant(options.tenant);
    if (multi && selectedTenant === undefined)
      throw new TypeError("BlackBox multitenant context requires a tenant.");
    if (!multi && selectedTenant !== undefined)
      throw new TypeError("BlackBox single-tenant context rejects a tenant.");
    return Object.freeze({
      tenant: selectedTenant,
      zoneId: this.zoneId(options.zoneId),
      timeoutMs: this.positiveInteger(options.timeoutMs ?? 500, "timeoutMs"),
      intervalMs: this.positiveInteger(options.intervalMs ?? 5, "intervalMs"),
    });
  },

  /**
   * Clones an optional tenant message.
   */
  cloneTenant(value: TenantId | undefined): TenantId | undefined {
    return value === undefined ? undefined : clone(TenantIdSchema, value);
  },

  /**
   * Creates default normalized options for internal test seams.
   */
  defaults(): NormalizedBlackBoxOptions {
    return Object.freeze({
      tenant: undefined,
      zoneId: this.zoneId(undefined),
      timeoutMs: 500,
      intervalMs: 5,
    });
  },

  /**
   * Converts a tenant option to its message form.
   */
  tenant(value: string | TenantId | undefined): TenantId | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      if (value.kind.case !== "value" || value.kind.value.length === 0)
        throw new TypeError("BlackBox tenant must not be empty.");
      return clone(TenantIdSchema, value);
    }
    if (value.length === 0) throw new TypeError("BlackBox tenant must not be empty.");
    return create(TenantIdSchema, { kind: { case: "value", value } });
  },

  /**
   * Converts a zone option to its message form.
   */
  zoneId(value: string | ZoneId | undefined): ZoneId {
    if (typeof value !== "string" && value !== undefined) {
      if (value.value.length === 0) throw new TypeError("BlackBox zoneId must not be empty.");
      return clone(ZoneIdSchema, value);
    }
    const zone = value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone.length === 0) throw new TypeError("BlackBox zoneId must not be empty.");
    return create(ZoneIdSchema, { value: zone });
  },

  /**
   * Validates a positive whole-number duration.
   */
  positiveInteger(value: number, name: "timeoutMs" | "intervalMs"): number {
    if (!Number.isInteger(value) || value <= 0)
      throw new TypeError(`BlackBox ${name} must be a positive integer.`);
    return value;
  },
});

/**
 * Supplies time values and cancellable delays for BlackBox operations.
 */
const BlackBoxClock = Object.freeze({
  // prettier-ignore

  /**
   * Creates the current Protobuf timestamp.
   */
  timestamp() {
    return create(TimestampSchema, { seconds: BigInt(Math.floor(Date.now() / 1_000)) });
  },

  /**
   * Waits for a delay or rejects when the supplied signal aborts.
   */
  wait(milliseconds: number, signal: AbortSignal): Promise<void> {
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
  },
});

/**
 * Collects rejected results while preserving their settlement order.
 */
const BlackBoxFailures = Object.freeze({
  // prettier-ignore

  /**
   * Returns reasons from rejected promises.
   */
  rejected(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === "rejected") failures.push(result.reason);
    }
    return failures;
  },
});
