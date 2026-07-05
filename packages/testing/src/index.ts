import { clone } from "@bufbuild/protobuf";
import { CommandSchema, EventSchema, type Command, type Event } from "@spine-ts/proto";
import {
  QuerySchema,
  QueryResponseSchema,
  type Query,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import {
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  TopicSchema,
  type SubscriptionUpdate,
  type Subscription,
  type Topic,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import { AckSchema, type Ack } from "@spine-ts/proto/generated/spine/core/ack_pb.js";
import { ResponseSchema, type Response } from "@spine-ts/proto/generated/spine/core/response_pb.js";
import { BoundedContext, SpineServices, type SpineServicesOptions } from "@spine-ts/server";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";

/** Options for an in-process bounded-context test fixture. */
export interface BoundedContextFixtureOptions {
  /** Milliseconds to wait in `readEventually()`. Defaults to 500. */
  readonly timeoutMs?: number;
  /** Milliseconds between `readEventually()` attempts. Defaults to 5. */
  readonly intervalMs?: number;
  /** Milliseconds before never-activated service subscriptions expire. */
  readonly inactiveTtlMs?: number;
  /** Maximum queued service subscription updates before delivery closes. */
  readonly queueLimit?: number;
}

/** Active in-process subscription handle returned by {@link BoundedContextFixture.subscribe}. */
export interface FixtureSubscription {
  /** Cloned service subscription returned by `SubscriptionService.Subscribe`. */
  readonly subscription: Subscription;
  /** Reads the next cloned `SubscriptionService.Activate` update, or `undefined` after close. */
  next(): Promise<SubscriptionUpdate | undefined>;
  /** Cancels the underlying service subscription and returns a cloned response. */
  cancel(): Promise<Response>;
  /** Stops activation and cancels the service subscription. Safe to call more than once. */
  close(): Promise<void>;
}

interface CommandHandlers {
  post(command: Command): Promise<Ack>;
}

interface QueryHandlers {
  read(query: Query): Promise<QueryResponse>;
}

interface SubscriptionHandlers {
  subscribe(topic: Topic): Subscription | Promise<Subscription>;
  activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
  cancel(subscription: Subscription): Response | Promise<Response>;
}

const defaultTimeoutMs = 500;
const defaultIntervalMs = 5;
const defaultQueueLimit = 100;

/** Minimal in-process black-box fixture over one built bounded context. */
export class BoundedContextFixture<Context extends BoundedContext = BoundedContext> {
  readonly #context: Context;
  readonly #commands: CommandHandlers;
  readonly #queries: QueryHandlers;
  readonly #subscriptions: SubscriptionHandlers;
  readonly #timeoutMs: number;
  readonly #intervalMs: number;
  readonly #queueLimit: number;

  /** Create a fixture over a built bounded context. */
  constructor(context: Context, options: BoundedContextFixtureOptions = {}) {
    this.#context = context;
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? defaultTimeoutMs);
    this.#intervalMs = positiveInteger(options.intervalMs ?? defaultIntervalMs);
    this.#queueLimit = positiveInteger(options.queueLimit ?? defaultQueueLimit);
    const handlers = captureHandlers(context, options);
    this.#commands = handlers.commands;
    this.#queries = handlers.queries;
    this.#subscriptions = handlers.subscriptions;
  }

  /** Post one command through the real in-process `CommandService` adapter. */
  async post(command: Command): Promise<Ack> {
    const ack = await this.#commands.post(clone(CommandSchema, command));

    return clone(AckSchema, ack);
  }

  /** Post one event through the built context's real event endpoint. */
  async postEvent(event: Event): Promise<void> {
    await this.#context.eventBus().post(clone(EventSchema, event));
  }

  /** Read one query through the real in-process `QueryService` adapter. */
  async read(query: Query): Promise<QueryResponse> {
    const response = await this.#queries.read(clone(QuerySchema, query));

    return clone(QueryResponseSchema, response);
  }

  /** Poll `QueryService.Read` until `accept` returns true or the fixture timeout expires. */
  async readEventually(
    query: Query,
    accept: (response: QueryResponse) => boolean = hasOkMessage,
  ): Promise<QueryResponse> {
    const deadline = Date.now() + this.#timeoutMs;
    let response = await this.read(query);

    while (!accept(response) && Date.now() < deadline) {
      await delay(this.#intervalMs);
      response = await this.read(query);
    }

    return response;
  }

  /** Subscribe and activate through the real in-process `SubscriptionService` adapter. */
  async subscribe(topic: Topic): Promise<FixtureSubscription> {
    const subscription = await this.#subscriptions.subscribe(clone(TopicSchema, topic));
    const copy = clone(SubscriptionSchema, subscription);
    const updates = this.#subscriptions.activate(copy);

    return new ActiveFixtureSubscription(copy, updates, this.#subscriptions, this.#queueLimit);
  }
}

class ActiveFixtureSubscription implements FixtureSubscription {
  readonly #handlers: SubscriptionHandlers;
  readonly #iterator: AsyncIterator<SubscriptionUpdate>;
  readonly #subscription: Subscription;
  readonly #queue: SubscriptionUpdate[] = [];
  readonly #waiters: OnSubscriptionUpdate[] = [];
  readonly #queueLimit: number;
  #closed = false;

  constructor(
    subscription: Subscription,
    updates: AsyncIterable<SubscriptionUpdate>,
    handlers: SubscriptionHandlers,
    queueLimit: number,
  ) {
    this.#subscription = clone(SubscriptionSchema, subscription);
    this.#iterator = updates[Symbol.asyncIterator]();
    this.#handlers = handlers;
    this.#queueLimit = queueLimit;
    void this.#pump();
  }

  get subscription(): Subscription {
    return clone(SubscriptionSchema, this.#subscription);
  }

  async next(): Promise<SubscriptionUpdate | undefined> {
    if (this.#closed) {
      return undefined;
    }

    const queued = this.#queue.shift();
    if (queued !== undefined) {
      return clone(SubscriptionUpdateSchema, queued);
    }

    return this.#nextQueued();
  }

  async cancel(): Promise<Response> {
    const response = await this.#handlers.cancel(clone(SubscriptionSchema, this.#subscription));
    await this.#iterator.return?.();
    this.#finish();

    return clone(ResponseSchema, response);
  }

  async close(): Promise<void> {
    if (!this.#closed) {
      await this.cancel();
    }
  }

  async #pump(): Promise<void> {
    try {
      while (!this.#closed) {
        const result = await this.#iterator.next();
        if (result.done === true) {
          break;
        }
        this.#push(result.value);
      }
    } finally {
      this.#finish();
    }
  }

  #push(update: SubscriptionUpdate): void {
    const copy = clone(SubscriptionUpdateSchema, update);
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      if (this.#queue.length >= this.#queueLimit) {
        void this.cancel();
        return;
      }
      this.#queue.push(copy);
    } else {
      waiter(copy);
    }
  }

  #nextQueued(): Promise<SubscriptionUpdate | undefined> {
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #finish(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#queue.splice(0);
    for (const waiter of this.#waiters.splice(0)) {
      waiter(undefined);
    }
  }
}

type OnSubscriptionUpdate = (update: SubscriptionUpdate | undefined) => void;

function captureHandlers(
  context: BoundedContext,
  options: BoundedContextFixtureOptions,
): {
  readonly commands: CommandHandlers;
  readonly queries: QueryHandlers;
  readonly subscriptions: SubscriptionHandlers;
} {
  const services = new SpineServices(serviceOptions(context, options));
  let commands: CommandHandlers | undefined;
  let queries: QueryHandlers | undefined;
  let subscriptions: SubscriptionHandlers | undefined;

  services.register({
    service(schema: unknown, implementation: unknown) {
      if (schema === CommandService) {
        commands = implementation as CommandHandlers;
      }
      if (schema === QueryService) {
        queries = implementation as QueryHandlers;
      }
      if (schema === SubscriptionService) {
        subscriptions = implementation as SubscriptionHandlers;
      }
      return this;
    },
  } as never);

  if (commands === undefined || queries === undefined || subscriptions === undefined) {
    throw new Error("Spine service handlers were not registered.");
  }

  return { commands, queries, subscriptions };
}

function serviceOptions(
  context: BoundedContext,
  options: BoundedContextFixtureOptions,
): SpineServicesOptions {
  return {
    contexts: [context],
    ...(options.inactiveTtlMs === undefined ? {} : { inactiveTtlMs: options.inactiveTtlMs }),
    ...(options.queueLimit === undefined ? {} : { queueLimit: options.queueLimit }),
  };
}

function hasOkMessage(response: QueryResponse): boolean {
  return response.response?.status?.status.case === "ok" && response.message.length > 0;
}

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
