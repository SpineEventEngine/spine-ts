import { create, toBinary, type Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Interceptor, Transport, UnaryRequest, UnaryResponse } from "@connectrpc/connect";
import { packAny } from "@spine-event-engine/core";
import {
  AckSchema,
  ActorContextSchema,
  CommandIdSchema,
  ErrorSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  ResponseSchema,
  StatusSchema,
  TenantIdSchema,
  UserIdSchema,
  ZoneIdSchema,
} from "@spine-event-engine/proto";
import {
  QueryResponseSchema,
  QueryIdSchema,
  QuerySchema,
  ResponseFormatSchema,
  EventUpdatesSchema,
  SubscriptionSchema,
  SubscriptionIdSchema,
  SubscriptionUpdateSchema,
  TargetSchema,
  type Topic,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  Client,
  type BrowserClientOptions,
  type CreateSubscriptionOptions,
  type SubscriptionLifecycle,
  type SubscriptionRetryPolicy,
} from "../src/index.js";

const browserFactories = vi.hoisted(() => ({
  connect: vi.fn(),
  grpcWeb: vi.fn(),
}));
const eventSubscription = { kind: "event" } as const;

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: browserFactories.connect,
  createGrpcWebTransport: browserFactories.grpcWeb,
}));

describe("Client", () => {
  it("requires explicit subscription kind and option validation without evaluating entity queries", async () => {
    const client = Client.usingTransport(source());
    const request = client.asGuest();
    const topic = create(TopicSchema);

    await expect(request.createSubscription(topic, undefined as never)).rejects.toThrow("kind");
    await expect(
      request.createSubscription(topic, {
        kind: "event",
        authoritativeQuery: () => create(QuerySchema),
      } as never),
    ).rejects.toThrow("authoritative");
    await expect(request.createSubscription(topic, { kind: "entity" } as never)).rejects.toThrow(
      "authoritative",
    );
    await expect(
      request.createSubscription(topic, {
        kind: "entity",
        authoritativeQuery: () => create(QuerySchema),
      }),
    ).resolves.toBeDefined();
    await client.close();
  });

  it("rejects invalid subscription capacities during client construction", () => {
    for (const subscriptions of [
      { updateBufferCapacity: 0 },
      { updateBufferByteCapacity: Number.POSITIVE_INFINITY },
      { lifecycleBufferCapacity: Number.NaN },
    ]) {
      expect(() => Client.usingTransport(source(), { subscriptions })).toThrow("subscription");
    }
  });

  it("freezes the discriminated lifecycle and finite retry configuration contract", () => {
    expectTypeOf<CreateSubscriptionOptions>().toMatchTypeOf<
      | { readonly kind: "event"; readonly signal?: AbortSignal }
      | {
          readonly kind: "entity";
          readonly authoritativeQuery: () => unknown;
          readonly signal?: AbortSignal;
        }
    >();
    expectTypeOf<SubscriptionLifecycle>().toMatchTypeOf<
      | { readonly state: "connecting"; readonly generation: number; readonly attempt: number }
      | { readonly state: "failed"; readonly generation: number; readonly error: Error }
      | {
          readonly state: "connected" | "resynchronizing" | "gapPossible" | "closed";
          readonly generation: number;
        }
    >();
    expectTypeOf<SubscriptionRetryPolicy>().toMatchTypeOf<{
      readonly maxAttempts: number;
      readonly maxElapsedMs: number;
      delayMs(attempt: number): number;
    }>();

    const validPolicy: SubscriptionRetryPolicy = {
      maxAttempts: 1,
      maxElapsedMs: 1,
      delayMs: () => 1,
    };
    expect(() =>
      Client.usingTransport(source(), {
        subscriptions: {
          retryPolicy: validPolicy,
          scheduler: { now: () => 0, wait: async () => {} },
        },
      }),
    ).not.toThrow();

    for (const retryPolicy of [
      { maxAttempts: 0, maxElapsedMs: 1, delayMs: () => 1 },
      { maxAttempts: 1, maxElapsedMs: Number.NaN, delayMs: () => 1 },
      { maxAttempts: 1, maxElapsedMs: 1, delayMs: () => Number.POSITIVE_INFINITY },
    ])
      expect(() => Client.usingTransport(source(), { subscriptions: { retryPolicy } })).toThrow(
        "retry",
      );

    expect(() =>
      Client.usingTransport(source(), {
        subscriptions: { scheduler: { now: () => Number.NaN, wait: async () => {} } },
      }),
    ).toThrow("scheduler");
  });

  it("rejects every invalid retry and scheduler validation branch at construction", () => {
    for (const retryPolicy of [
      { maxAttempts: 1.5, maxElapsedMs: 1, delayMs: () => 1 },
      { maxAttempts: 1, maxElapsedMs: 0, delayMs: () => 1 },
      { maxAttempts: 1, maxElapsedMs: 1, delayMs: () => 0 },
      { maxAttempts: 1, maxElapsedMs: 1, delayMs: undefined },
    ])
      expect(() => Client.usingTransport(source(), { subscriptions: { retryPolicy } })).toThrow(
        "retry",
      );

    for (const scheduler of [{ now: () => 0 }, { now: () => -1, wait: async () => {} }])
      expect(() => Client.usingTransport(source(), { subscriptions: { scheduler } })).toThrow(
        "scheduler",
      );
  });

  it("exposes separate single-consumer update and lifecycle streams", async () => {
    const client = Client.usingTransport(source());
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const streams = subscription as unknown as {
      updates: AsyncIterable<unknown>;
      lifecycle: AsyncIterable<unknown>;
    };

    expect(streams.updates).toBeDefined();
    expect(streams.lifecycle).toBeDefined();
    streams.updates[Symbol.asyncIterator]();
    expect(() => streams.updates[Symbol.asyncIterator]()).toThrow("single consumer");
    await subscription.cancel();
    await client.close();
  });

  it("fails both streams and cleans up on count or byte overflow", async () => {
    for (const subscriptions of [{ updateBufferCapacity: 1 }, { updateBufferByteCapacity: 1 }]) {
      const client = Client.usingTransport(
        { transport: updateTransport(), createRequestId: () => "overflow" },
        { subscriptions },
      );
      const subscription = await client
        .asGuest()
        .createSubscription(create(TopicSchema), eventSubscription);
      const updates = subscription.updates[Symbol.asyncIterator]();
      const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
      await subscription.activate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const updateError = await updates.next().catch((error: unknown) => error);
      const lifecycleError = await lifecycle.next().catch((error: unknown) => error);
      expect(updateError).toBe(lifecycleError);
      expect(updateError).toBeInstanceOf(Error);
      expect((updateError as Error).message).toContain("overflow");
      await subscription.cancel();
      await client.close();
    }
  });

  it("reclaims exactly one encoded delivery after dequeue and freezes delivery copies", async () => {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const topic = create(TopicSchema, {
      context: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "guest" }),
        zoneId: create(ZoneIdSchema, { value: "UTC" }),
        timestamp: create(TimestampSchema, { seconds: now }),
      }),
    });
    const encodedDeliveryBytes = toBinary(
      SubscriptionUpdateSchema,
      create(SubscriptionUpdateSchema, {
        subscription: create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "updates" }),
          topic,
        }),
      }),
    ).byteLength;
    let releaseSecond: (() => void) | undefined;
    const client = Client.usingTransport(
      {
        transport: updateTransport(
          2,
          () => new Promise<void>((resolve) => (releaseSecond = resolve)),
        ),
        createRequestId: () => "immutable",
      },
      {
        zoneId: "UTC",
        subscriptions: { updateBufferCapacity: 2, updateBufferByteCapacity: encodedDeliveryBytes },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const updates = subscription.updates[Symbol.asyncIterator]();
    await subscription.activate();
    const first = await updates.next();
    expect(first.done).toBe(false);
    if (!first.done && first.value.kind === "update") {
      expect(Object.isFrozen(first.value)).toBe(true);
      expect(Object.isFrozen(first.value.update)).toBe(true);
    }
    releaseSecond?.();
    await expect(updates.next()).resolves.toMatchObject({ done: false });
    await subscription.cancel();
    await client.close();
  });

  it("retries unexpected wire EOF once before emitting one terminal failure", async () => {
    const client = Client.usingTransport(
      { transport: updateTransport(2), createRequestId: () => "drain" },
      {
        subscriptions: {
          updateBufferCapacity: 10,
          updateBufferByteCapacity: 10_000,
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: async () => {} },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    await subscription.activate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const updates = subscription.updates[Symbol.asyncIterator]();
    const updateError = await updates.next().catch((error: unknown) => error);
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connected" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "gapPossible" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connected" } });
    const failed = await lifecycle.next();
    expect(failed).toMatchObject({ value: { state: "failed" } });
    if (!failed.done && failed.value.state === "failed")
      expect(failed.value.error).toBe(updateError);
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await client.close();
  });

  it("retries a rejected Subscribe and attaches the next accepted wire", async () => {
    let subscribes = 0;
    let cancels = 0;
    let active = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              if (subscribes === 2) throw new Error("transient subscribe failure");
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: `retry-${subscribes}` }),
                topic: input as Topic,
              });
            }
            if (method.name === "Cancel") cancels++;
            return create(ResponseSchema);
          },
          undefined,
          () => {
            active++;
            return active < 2 ? (async function* () {})() : neverEndingUpdates();
          },
        ),
        createRequestId: () => "retry-subscribe",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    await vi.waitFor(() => expect(subscribes).toBe(3));
    expect(cancels).toBe(1);
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connecting", generation: 1 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connected", generation: 1 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connecting", generation: 2, attempt: 1 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connecting", generation: 3, attempt: 2 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "gapPossible", generation: 3 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connected", generation: 3 },
    });
    await subscription.cancel();
    expect(cancels).toBe(2);
    await client.close();
  });

  it("retries an initial rejected Subscribe before exposing a connected stream", async () => {
    let subscribes = 0;
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              if (subscribes === 1) throw new Error("initial subscribe failure");
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "initial-subscribe" }),
                topic: input as Topic,
              });
            }
            return create(ResponseSchema);
          },
          undefined,
          () => neverEndingUpdates(),
        ),
        createRequestId: () => "initial-subscribe-retry",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await expect(subscription.activate()).resolves.toBeUndefined();
    expect(subscribes).toBe(2);
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connecting", generation: 1, attempt: 0 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connecting", generation: 2, attempt: 1 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "gapPossible", generation: 2 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connected", generation: 2 },
    });
    await subscription.cancel();
    await client.close();
  });

  it("resynchronizes an Entity subscription before delivering an update held during Read", async () => {
    let subscribes = 0;
    let active = 0;
    let topic: Topic | undefined;
    let queryCalls = 0;
    let readQuery: Message | undefined;
    let releaseRead: (() => void) | undefined;
    let queryFactoryCalls = 0;
    let builtQuery: Message | undefined;
    const target = create(TargetSchema, {
      type: "type.example/Entity",
      criterion: { case: "includeAll", value: true },
    });
    const entityTopic = create(TopicSchema, { target });
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              topic = input as Topic;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: `entity-${subscribes}` }),
                topic,
              });
            }
            return create(ResponseSchema);
          },
          (query) => {
            queryCalls++;
            readQuery = query;
            return new Promise<Message>((resolve) => {
              releaseRead = () => {
                const response = create(QueryResponseSchema, {
                  response: create(ResponseSchema, {
                    status: create(StatusSchema, { status: { case: "ok", value: {} } }),
                  }),
                });
                expect(response.response?.status?.status.case).toBe("ok");
                resolve(response);
              };
            });
          },
          () => {
            active++;
            if (active === 1) return (async function* () {})();
            return (async function* () {
              yield create(SubscriptionUpdateSchema, {
                subscription: create(SubscriptionSchema, {
                  id: create(SubscriptionIdSchema, { value: "entity-2" }),
                  topic: topic!,
                }),
              });
              await new Promise<void>(() => {});
            })();
          },
        ),
        createRequestId: () => "entity-recovery",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(entityTopic, {
      kind: "entity",
      authoritativeQuery: () => ({
        build: () => {
          queryFactoryCalls++;
          return (builtQuery = create(QuerySchema, {
            id: create(QueryIdSchema, { value: "authoritative-query" }),
            target,
            format: create(ResponseFormatSchema, { limit: 7 }),
          }));
        },
      }),
    });
    const updates = subscription.updates[Symbol.asyncIterator]();
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    expect(queryFactoryCalls).toBe(0);
    await subscription.activate();
    await vi.waitFor(() => expect(queryCalls).toBe(1));
    expect(queryFactoryCalls).toBe(1);
    expect(readQuery).toMatchObject({
      id: { value: "authoritative-query" },
      target,
      format: { limit: 7 },
      context: topic?.context,
    });
    expect(readQuery).not.toBe(builtQuery);
    expect((readQuery as { target?: unknown }).target).not.toBe(target);
    expect((readQuery as { context?: unknown }).context).not.toBe(topic?.context);
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connecting", generation: 1 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connected", generation: 1 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connecting", generation: 2 },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "resynchronizing", generation: 2 },
    });
    releaseRead?.();
    const resynchronization = await updates.next();
    expect(resynchronization).toMatchObject({ value: { kind: "resynchronization" } });
    if (!resynchronization.done && resynchronization.value.kind === "resynchronization") {
      expect(Object.isFrozen(resynchronization.value)).toBe(true);
      expect(Object.isFrozen(resynchronization.value.response)).toBe(true);
      expect(Object.isFrozen(resynchronization.value.response.response)).toBe(true);
      expect(Object.isFrozen(resynchronization.value.response.response?.status)).toBe(true);
    }
    await expect(updates.next()).resolves.toMatchObject({ value: { kind: "update" } });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connected", generation: 2 },
    });
    await subscription.cancel();
    await client.close();
  });

  it("treats Entity recovery query contract failures as terminal without retrying or rereading", async () => {
    const target = create(TargetSchema, {
      type: "type.example/Entity",
      criterion: { case: "includeAll", value: true },
    });
    const cases: readonly {
      readonly name: string;
      readonly query: () => unknown;
      readonly reads: number;
      readonly calls: number;
    }[] = [
      {
        name: "byte-different target",
        query: () =>
          create(QuerySchema, {
            target: create(TargetSchema, {
              type: "type.example/Entity",
              criterion: { case: "includeAll", value: false },
            }),
          }),
        reads: 0,
        calls: 1,
      },
      {
        name: "non-OK response",
        query: () => create(QuerySchema, { target }),
        reads: 1,
        calls: 1,
      },
      {
        name: "factory throw",
        query: () => {
          throw new Error("factory failed");
        },
        reads: 0,
        calls: 1,
      },
      {
        name: "builder throw",
        query: () => ({
          build: () => {
            throw new Error("builder failed");
          },
        }),
        reads: 0,
        calls: 1,
      },
    ];

    for (const testCase of cases) {
      let subscribes = 0;
      let reads = 0;
      let queryCalls = 0;
      const cancelled: string[] = [];
      const client = Client.usingTransport(
        {
          transport: unaryTransport(
            (method, input) => {
              if (method.name === "Subscribe") {
                subscribes++;
                return create(SubscriptionSchema, {
                  id: create(SubscriptionIdSchema, { value: `terminal-${subscribes}` }),
                  topic: input as Topic,
                });
              }
              if (method.name === "Cancel")
                cancelled.push((input as { id?: { value?: string } }).id?.value ?? "");
              return create(ResponseSchema);
            },
            () => {
              reads++;
              return create(QueryResponseSchema, {
                response: create(ResponseSchema, {
                  status: create(StatusSchema, {
                    status: { case: "error", value: create(ErrorSchema, { message: "not OK" }) },
                  }),
                }),
              });
            },
            () => (async function* () {})(),
          ),
          createRequestId: () => `terminal-${testCase.name}`,
        },
        {
          subscriptions: {
            retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
            scheduler: immediateScheduler(),
          },
        },
      );
      const subscription = await client
        .asGuest()
        .createSubscription(create(TopicSchema, { target }), {
          kind: "entity",
          authoritativeQuery: () => {
            queryCalls++;
            return testCase.query();
          },
        });
      const updates = subscription.updates[Symbol.asyncIterator]();

      await subscription.activate();
      await expect(updates.next()).rejects.toThrow();
      expect(queryCalls, testCase.name).toBe(testCase.calls);
      expect(reads, testCase.name).toBe(testCase.reads);
      expect(subscribes, testCase.name).toBe(2);
      expect(cancelled, testCase.name).toEqual(["terminal-1", "terminal-2"]);
      await client.close();
      expect(cancelled, testCase.name).toEqual(["terminal-1", "terminal-2"]);
    }
  });

  it("retries a transient authoritative Read on a fresh Entity wire and reevaluates the query", async () => {
    let subscribes = 0;
    let reads = 0;
    let queryCalls = 0;
    let activations = 0;
    const cancelled: string[] = [];
    const target = create(TargetSchema, {
      type: "type.example/Entity",
      criterion: { case: "includeAll", value: true },
    });
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: `read-retry-${subscribes}` }),
                topic: input as Topic,
              });
            }
            if (method.name === "Cancel")
              cancelled.push((input as { id?: { value?: string } }).id?.value ?? "");
            return create(ResponseSchema);
          },
          () => {
            reads++;
            if (reads === 1) throw new Error("transient read failure");
            return create(QueryResponseSchema, {
              response: create(ResponseSchema, {
                status: create(StatusSchema, { status: { case: "ok", value: {} } }),
              }),
            });
          },
          () => {
            activations++;
            return activations === 1 ? (async function* () {})() : neverEndingUpdates();
          },
        ),
        createRequestId: () => "read-retry",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema, { target }), {
        kind: "entity",
        authoritativeQuery: () => {
          queryCalls++;
          return create(QuerySchema, { target });
        },
      });
    const updates = subscription.updates[Symbol.asyncIterator]();
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    await vi.waitFor(() => expect(reads).toBe(2));
    expect(queryCalls).toBe(2);
    expect(subscribes).toBe(3);
    expect(cancelled).toEqual(["read-retry-1", "read-retry-2"]);
    await expect(updates.next()).resolves.toMatchObject({ value: { kind: "resynchronization" } });
    for (let index = 0; index < 6; index++) await lifecycle.next();
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "connected", generation: 3 },
    });
    await subscription.cancel();
    expect(cancelled).toEqual(["read-retry-1", "read-retry-2", "read-retry-3"]);
    await client.close();
  });

  it.each(["cancel", "close"] as const)(
    "%s during a pending Entity Read is terminal before iterator consumption or resynchronization delivery",
    async (operation) => {
      let subscribes = 0;
      let sourceCloses = 0;
      let nextCalls = 0;
      let activations = 0;
      let releaseRead: (() => void) | undefined;
      const cancelled: string[] = [];
      const target = create(TargetSchema, {
        type: "type.example/Entity",
        criterion: { case: "includeAll", value: true },
      });
      const client = Client.usingTransport(
        {
          transport: unaryTransport(
            (method, input) => {
              if (method.name === "Subscribe") {
                subscribes++;
                return create(SubscriptionSchema, {
                  id: create(SubscriptionIdSchema, { value: `pending-read-${subscribes}` }),
                  topic: input as Topic,
                });
              }
              if (method.name === "Cancel")
                cancelled.push((input as { id?: { value?: string } }).id?.value ?? "");
              return create(ResponseSchema);
            },
            () =>
              new Promise<Message>((resolve) => {
                releaseRead = () =>
                  resolve(
                    create(QueryResponseSchema, {
                      response: create(ResponseSchema, {
                        status: create(StatusSchema, { status: { case: "ok", value: {} } }),
                      }),
                    }),
                  );
              }),
            () => {
              activations++;
              if (activations === 1) return (async function* () {})();
              return {
                [Symbol.asyncIterator]: () => ({
                  next: () => {
                    nextCalls++;
                    return new Promise<IteratorResult<Message>>(() => {});
                  },
                }),
              };
            },
          ),
          createRequestId: () => `pending-read-${operation}`,
          close: () => sourceCloses++,
        },
        {
          subscriptions: {
            retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
            scheduler: immediateScheduler(),
          },
        },
      );
      const subscription = await client
        .asGuest()
        .createSubscription(create(TopicSchema, { target }), {
          kind: "entity",
          authoritativeQuery: () => create(QuerySchema, { target }),
        });
      const updates = subscription.updates[Symbol.asyncIterator]();
      const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

      await subscription.activate();
      await vi.waitFor(() => expect(releaseRead).toBeTypeOf("function"));
      if (operation === "cancel") await subscription.cancel();
      else await client.close();
      expect(nextCalls).toBe(0);
      expect(subscribes).toBe(2);
      expect(cancelled).toEqual(["pending-read-1", "pending-read-2"]);
      expect(sourceCloses).toBe(operation === "close" ? 1 : 0);
      releaseRead?.();
      await Promise.resolve();
      expect(nextCalls).toBe(0);
      await expect(updates.next()).resolves.toMatchObject({ done: true });
      for (let index = 0; index < 4; index++) await lifecycle.next();
      await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "closed" } });
      await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
      if (operation === "cancel") await client.close();
    },
  );

  it("uses the shared terminal overflow error when a decoded update follows Entity resynchronization", async () => {
    const target = create(TargetSchema, {
      type: "type.example/Entity",
      criterion: { case: "includeAll", value: true },
    });
    const response = create(QueryResponseSchema, {
      response: create(ResponseSchema, {
        status: create(StatusSchema, { status: { case: "ok", value: {} } }),
      }),
    });
    for (const subscriptions of [
      { updateBufferCapacity: 1 },
      { updateBufferByteCapacity: toBinary(QueryResponseSchema, response).byteLength },
    ]) {
      let subscribes = 0;
      let activations = 0;
      let acceptedTopic: Topic | undefined;
      let cancels = 0;
      const client = Client.usingTransport(
        {
          transport: unaryTransport(
            (method, input) => {
              if (method.name === "Subscribe") {
                subscribes++;
                acceptedTopic = input as Topic;
                return create(SubscriptionSchema, {
                  id: create(SubscriptionIdSchema, { value: `overflow-${subscribes}` }),
                  topic: acceptedTopic,
                });
              }
              if (method.name === "Cancel") cancels++;
              return create(ResponseSchema);
            },
            () => response,
            () => {
              activations++;
              if (activations === 1) return (async function* () {})();
              return (async function* () {
                yield create(SubscriptionUpdateSchema, {
                  subscription: create(SubscriptionSchema, {
                    id: create(SubscriptionIdSchema, { value: "overflow-2" }),
                    topic: acceptedTopic!,
                  }),
                });
              })();
            },
          ),
          createRequestId: () => "resync-overflow",
        },
        {
          subscriptions: {
            ...subscriptions,
            retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
            scheduler: immediateScheduler(),
          },
        },
      );
      const subscription = await client
        .asGuest()
        .createSubscription(create(TopicSchema, { target }), {
          kind: "entity",
          authoritativeQuery: () => create(QuerySchema, { target }),
        });
      const updates = subscription.updates[Symbol.asyncIterator]();
      const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
      await subscription.activate();
      await vi.waitFor(() => expect(cancels).toBe(2));
      const updateError = await updates.next().catch((error: unknown) => error);
      const lifecycleError = await lifecycle.next().catch((error: unknown) => error);
      expect(updateError).toBe(lifecycleError);
      expect((updateError as Error).message).toContain("overflow");
      expect(cancels).toBe(2);
      await client.close();
      expect(cancels).toBe(2);
    }
  });

  it("cleans an initially accepted wire when Activate iterator setup fails before retrying", async () => {
    let subscribes = 0;
    const cancelled: string[] = [];
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: `initial-wire-${subscribes}` }),
                topic: input as Topic,
              });
            }
            if (method.name === "Cancel")
              cancelled.push((input as { id?: { value?: string } }).id?.value ?? "");
            return create(ResponseSchema);
          },
          undefined,
          () =>
            subscribes === 1
              ? (() => {
                  throw new Error("initial Activate setup failed");
                })()
              : neverEndingUpdates(),
        ),
        createRequestId: () => "initial-activate-retry",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);

    await subscription.activate();
    await vi.waitFor(() => expect(subscribes).toBe(2));
    expect(cancelled).toEqual(["initial-wire-1"]);
    await subscription.cancel();
    expect(cancelled).toEqual(["initial-wire-1", "initial-wire-2"]);
    await client.close();
  });

  it("cleans each accepted retry wire once when Activate setup fails before a later retry", async () => {
    let subscribes = 0;
    const cancelled: string[] = [];
    let active = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: `wire-${subscribes}` }),
                topic: input as Topic,
              });
            }
            if (method.name === "Cancel")
              cancelled.push((input as { id?: { value?: string } }).id?.value ?? "");
            return create(ResponseSchema);
          },
          undefined,
          () => {
            active++;
            if (active === 2)
              return {
                [Symbol.asyncIterator]: () => {
                  throw new Error("iterator setup failed");
                },
              };
            return active === 3 ? neverEndingUpdates() : (async function* () {})();
          },
        ),
        createRequestId: () => "retry-activate",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);

    await subscription.activate();
    await vi.waitFor(() => expect(subscribes).toBe(3));
    expect(cancelled).toEqual(["wire-1", "wire-2"]);
    await subscription.cancel();
    expect(cancelled).toEqual(["wire-1", "wire-2", "wire-3"]);
    await client.close();
  });

  it("fails once after retry exhaustion and cleans the final accepted wire", async () => {
    let subscribes = 0;
    let cancels = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: `exhaust-${subscribes}` }),
                topic: input as Topic,
              });
            }
            if (method.name === "Cancel") cancels++;
            return create(ResponseSchema);
          },
          undefined,
          () => (async function* () {})(),
        ),
        createRequestId: () => "retry-exhaustion",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    const updates = subscription.updates[Symbol.asyncIterator]();
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    const error = await updates.next().catch((value: unknown) => value);
    await vi.waitFor(() => expect(subscribes).toBe(2));
    expect(cancels).toBe(2);
    for (let index = 0; index < 5; index++) await lifecycle.next();
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "failed", error } });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await client.close();
    expect(cancels).toBe(2);
  });

  it("expires elapsed retry time after the scheduler wait with one failure and cleanup", async () => {
    let now = 0;
    let subscribes = 0;
    let cancels = 0;
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "elapsed" }),
                topic: input as Topic,
              });
            }
            if (method.name === "Cancel") cancels++;
            return create(ResponseSchema);
          },
          undefined,
          () => (async function* () {})(),
        ),
        createRequestId: () => "retry-elapsed",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 5, delayMs: () => 1 },
          scheduler: {
            now: () => now,
            wait: async () => {
              now = 5;
            },
          },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const updates = subscription.updates[Symbol.asyncIterator]();
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    const error = await updates.next().catch((value: unknown) => value);
    expect(subscribes).toBe(1);
    expect(cancels).toBe(1);
    await lifecycle.next();
    await lifecycle.next();
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "failed", error } });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await client.close();
    expect(cancels).toBe(1);
  });

  it("cancels a scheduler wait promptly, emits only closed, and starts no later RPC", async () => {
    let subscribes = 0;
    let cancels = 0;
    let waiting: Promise<void> | undefined;
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "waiting" }),
                topic: input as Topic,
              });
            }
            if (method.name === "Cancel") cancels++;
            return create(ResponseSchema);
          },
          undefined,
          () => (async function* () {})(),
        ),
        createRequestId: () => "retry-wait-cancel",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: {
            now: () => 0,
            wait: (_delay, signal) =>
              (waiting = new Promise<void>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              )),
          },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    await vi.waitFor(() => expect(waiting).toBeDefined());
    await subscription.cancel();
    expect(subscribes).toBe(1);
    expect(cancels).toBe(1);
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connected" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "closed" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await Promise.resolve();
    expect(subscribes).toBe(1);
    await client.close();
  });

  it("client close aborts a scheduler wait promptly without starting a later retry RPC", async () => {
    let subscribes = 0;
    let waiting: Promise<void> | undefined;
    let sourceCloses = 0;
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "close-wait" }),
                topic: input as Topic,
              });
            }
            return create(ResponseSchema);
          },
          undefined,
          () => (async function* () {})(),
        ),
        createRequestId: () => "retry-wait-close",
        close: () => sourceCloses++,
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: {
            now: () => 0,
            wait: (_delay, signal) =>
              (waiting = new Promise<void>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              )),
          },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    await vi.waitFor(() => expect(waiting).toBeDefined());
    await client.close();
    expect(subscribes).toBe(1);
    expect(sourceCloses).toBe(1);
    await lifecycle.next();
    await lifecycle.next();
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "closed" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await Promise.resolve();
    expect(subscribes).toBe(1);
  });

  it("rejects pending initial activation when cancellation aborts its retry wait", async () => {
    let waiting: Promise<void> | undefined;
    const client = Client.usingTransport(
      {
        transport: unaryTransport((method) => {
          if (method.name === "Subscribe") throw new Error("initial retry failure");
          return create(ResponseSchema);
        }),
        createRequestId: () => "initial-wait-cancel",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: {
            now: () => 0,
            wait: (_delay, signal) =>
              (waiting = new Promise<void>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              )),
          },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    const activation = subscription.activate();

    await vi.waitFor(() => expect(waiting).toBeDefined());
    await subscription.cancel();
    await expect(activation).rejects.toThrow("aborted");
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "closed" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await client.close();
  });

  it("fences an abort-ignoring retry wait after caller activation abort", async () => {
    let subscribes = 0;
    let releaseWait: (() => void) | undefined;
    const client = Client.usingTransport(
      {
        transport: unaryTransport((method) => {
          if (method.name === "Subscribe") {
            subscribes++;
            throw new Error("initial retry failure");
          }
          return create(ResponseSchema);
        }),
        createRequestId: () => "abort-ignoring-wait",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: {
            now: () => 0,
            wait: () => new Promise<void>((resolve) => (releaseWait = resolve)),
          },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    const abort = new AbortController();
    const activation = subscription.activate({ signal: abort.signal });

    await vi.waitFor(() => expect(releaseWait).toBeTypeOf("function"));
    abort.abort(new Error("activation interrupted"));
    releaseWait?.();
    await expect(activation).rejects.toThrow("activation interrupted");
    expect(subscribes).toBe(1);
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: {
        state: "failed",
        error: expect.objectContaining({ message: "activation interrupted" }),
      },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await client.close();
    expect(subscribes).toBe(1);
  });

  it("settles an initial retry when its scheduler wait never observes caller abort", async () => {
    vi.useFakeTimers();
    let subscribes = 0;
    const client = Client.usingTransport(
      {
        transport: unaryTransport((method) => {
          if (method.name === "Subscribe") {
            subscribes++;
            throw new Error("initial retry failure");
          }
          return create(ResponseSchema);
        }),
        createRequestId: () => "never-settling-wait",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: () => new Promise<void>(() => {}) },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    const abort = new AbortController();
    const activation = subscription.activate({ signal: abort.signal });

    await vi.runAllTicks();
    abort.abort(new Error("activation interrupted"));
    const deadline = new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("activation did not settle")), 1),
    );
    const settlement = expect(Promise.race([activation, deadline])).rejects.toThrow(
      "activation interrupted",
    );
    await vi.advanceTimersByTimeAsync(1);
    await settlement;
    expect(subscribes).toBe(1);
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: {
        state: "failed",
        error: expect.objectContaining({ message: "activation interrupted" }),
      },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await expect(client.close()).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("preserves binary event payloads while freezing a delivered update", async () => {
    let topic: Topic | undefined;
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method, input) => {
          if (method.name !== "Subscribe") return create(ResponseSchema);
          topic = input as Topic;
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "binary" }),
            topic,
          });
        },
        undefined,
        () =>
          (async function* () {
            yield create(SubscriptionUpdateSchema, {
              subscription: create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "binary" }),
                topic: topic!,
              }),
              update: {
                case: "eventUpdates",
                value: create(EventUpdatesSchema, {
                  event: [
                    create(EventSchema, {
                      id: create(EventIdSchema, { value: "event" }),
                      context: create(EventContextSchema),
                      message: { typeUrl: "type.example/Binary", value: new Uint8Array([1, 2]) },
                    }),
                  ],
                }),
              },
            });
          })(),
      ),
      createRequestId: () => "binary",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    await subscription.activate();
    const next = await subscription.updates[Symbol.asyncIterator]().next();
    if (
      next.done ||
      next.value.kind !== "update" ||
      next.value.update.update.case !== "eventUpdates"
    )
      throw new Error("expected binary event update");
    const value = next.value.update.update.value.event[0]?.message.value;
    expect(value).toEqual(new Uint8Array([1, 2]));
    expect(Object.isFrozen(next.value)).toBe(true);
    await subscription.cancel();
    await client.close();
  });

  it("fails both streams deterministically when lifecycle capacity overflows", async () => {
    const client = Client.usingTransport(
      { transport: updateTransport(), createRequestId: () => "lifecycle" },
      { subscriptions: { lifecycleBufferCapacity: 1 } },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    await expect(subscription.activate()).rejects.toThrow("lifecycle buffer overflow");
    const lifecycleError = await lifecycle.next().catch((error: unknown) => error);
    const updateError = await subscription.updates[Symbol.asyncIterator]()
      .next()
      .catch((error: unknown) => error);
    expect(updateError).toBe(lifecycleError);
    expect((updateError as Error).message).toContain("lifecycle buffer overflow");
    await client.close();
  });

  beforeEach(() => browserFactories.connect.mockReset());
  beforeEach(() => browserFactories.grpcWeb.mockReset());

  it("selects each explicit protocol for post and read with fresh request metadata", async () => {
    const calls: BrowserCall[] = [];
    browserFactories.grpcWeb.mockImplementation((options) =>
      browserTransport("grpc-web", options?.interceptors ?? [], calls),
    );
    browserFactories.connect.mockImplementation((options) =>
      browserTransport("connect", options?.interceptors ?? [], calls),
    );
    let sequence = 0;
    const options: BrowserClientOptions = {
      onRequestMetadata: () => ({ "x-application-call": String(++sequence) }),
    };
    expectTypeOf(options).toMatchTypeOf<BrowserClientOptions>();

    const grpcWeb = Client.forGrpcWeb("https://gateway.example", options);
    const connect = Client.forConnect("https://gateway.example", options);
    await grpcWeb.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }));
    await grpcWeb.asGuest().send(create(QuerySchema));
    await connect.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }));
    await connect.asGuest().send(create(QuerySchema));

    expect(calls).toEqual([
      { protocol: "grpc-web", method: "Post", metadata: "1" },
      { protocol: "grpc-web", method: "Read", metadata: "2" },
      { protocol: "connect", method: "Post", metadata: "3" },
      { protocol: "connect", method: "Read", metadata: "4" },
    ]);
    expect(browserFactories.grpcWeb).toHaveBeenCalledTimes(1);
    expect(browserFactories.connect).toHaveBeenCalledTimes(1);
    expect(browserFactories.grpcWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://gateway.example",
        interceptors: [expect.any(Function)],
      }),
    );
    expect(browserFactories.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://gateway.example",
        interceptors: [expect.any(Function)],
      }),
    );
    await Promise.all([grpcWeb.close(), connect.close()]);
  });

  it("rejects a metadata provider failure before its selected transport executes", async () => {
    const calls: BrowserCall[] = [];
    browserFactories.grpcWeb.mockImplementation((options) =>
      browserTransport("grpc-web", options?.interceptors ?? [], calls),
    );
    const client = Client.forGrpcWeb("https://gateway.example", {
      onRequestMetadata: () => {
        throw new Error("metadata unavailable");
      },
    });

    await expect(client.asGuest().send(create(QuerySchema))).rejects.toThrow(
      "metadata unavailable",
    );
    expect(calls).toEqual([]);
    await client.close();
  });

  it("generates a UUID v4 with getRandomValues when randomUUID is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    const random = new Uint8Array(16).fill(0);
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set(random);
        return bytes;
      },
    });
    let id: string | undefined;
    browserFactories.grpcWeb.mockReturnValue(
      unaryTransport((method, input) => {
        if (method.name === "Post") {
          id = (input as { id?: { uuid?: string } }).id?.uuid;
          return create(AckSchema, {
            messageId: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: id })),
            status: create(StatusSchema, { status: { case: "ok", value: {} } }),
          });
        }
        return create(QueryResponseSchema);
      }),
    );
    const client = Client.forGrpcWeb("https://gateway.example");
    await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }));
    expect(id).toBe("00000000-0000-4000-8000-000000000000");
    await client.close();
    vi.stubGlobal("crypto", originalCrypto);
  });

  it("uses randomUUID before getRandomValues for browser request IDs", async () => {
    const originalCrypto = globalThis.crypto;
    const randomUUID = vi.fn(() => "6f75b67a-5f23-4b64-8a35-6ce5f8f97cf5");
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", { randomUUID, getRandomValues });
    let id: string | undefined;
    browserFactories.connect.mockReturnValue(
      unaryTransport((method, input) => {
        if (method.name === "Post") {
          id = (input as { id?: { uuid?: string } }).id?.uuid;
          return create(AckSchema, {
            messageId: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: id })),
            status: create(StatusSchema, { status: { case: "ok", value: {} } }),
          });
        }
        return create(QueryResponseSchema);
      }),
    );
    const client = Client.forConnect("https://gateway.example");
    await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }));
    expect(id).toBe("6f75b67a-5f23-4b64-8a35-6ce5f8f97cf5");
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
    await client.close();
    vi.stubGlobal("crypto", originalCrypto);
  });

  it("fails before invoking the selected transport when secure browser randomness is unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    const post = vi.fn();
    browserFactories.grpcWeb.mockReturnValue(
      unaryTransport((method) => {
        if (method.name === "Post") post();
        return create(QueryResponseSchema);
      }),
    );
    const client = Client.forGrpcWeb("https://gateway.example");
    await expect(
      client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" })),
    ).rejects.toThrow("secure random");
    expect(post).not.toHaveBeenCalled();
    await client.close();
    vi.stubGlobal("crypto", originalCrypto);
  });

  it("uses injected transport and request IDs for post and send", async () => {
    const calls: string[] = [];
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        calls.push(method.name);
        return create(QueryResponseSchema, {
          response: create(ResponseSchema, {
            status: create(StatusSchema),
          }),
        });
      }),
      createRequestId: () => "",
    });

    await expect(
      client.asGuest().post(ActorContextSchema, create(ActorContextSchema)),
    ).rejects.toThrow("request ID is missing");
    await client.onBehalfOf("alice").send(create(QuerySchema));

    expect(calls).toEqual(["Read"]);
    await client.close();
  });

  it("creates a subscription before activation and cancels it after activation", async () => {
    const calls: string[] = [];
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        calls.push(method.name);
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-1" }),
            topic: input as Topic,
          });
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-2",
    });

    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    expect(calls).toEqual([]);
    await subscription.activate();
    await subscription.cancel();

    expect(calls).toEqual(["Subscribe", "Cancel"]);
    await client.close();
  });

  it("closes admitted unary work and inactive subscriptions terminally", async () => {
    let resolveRead: (() => void) | undefined;
    let cancelled = 0;
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method) => {
          if (method.name === "Cancel") cancelled++;
          return create(ResponseSchema);
        },
        async () => {
          await new Promise<void>((resolve) => (resolveRead = resolve));
          return create(QueryResponseSchema);
        },
      ),
      createRequestId: () => "request-3",
    });
    const scope = client.asGuest();
    const read = scope.send(create(QuerySchema));
    const readResult = expect(read).rejects.toThrow("client is closing");
    const subscription = await scope.createSubscription(create(TopicSchema), eventSubscription);

    const closed = client.close();
    resolveRead?.();
    await closed;
    await readResult;
    await subscription.cancel();
    expect(cancelled).toBe(0);
    await expect(subscription.activate()).rejects.toThrow("client is closing");
  });

  it("rejects invalid accepted and delivered subscription identities and cancels the wire subscription", async () => {
    const topic = create(TopicSchema);
    const calls: string[] = [];
    const client = Client.usingTransport({
      transport: unaryTransport((method) => {
        calls.push(method.name);
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "" }),
            topic,
          });
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-4",
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await expect(subscription.activate()).rejects.toThrow("subscription ID");
    expect(calls).toEqual(["Subscribe", "Cancel"]);
    await client.close();
    expect(calls).toEqual(["Subscribe", "Cancel"]);
  });

  it("exhausts EOF retries and does not re-cancel accepted wires during client close", async () => {
    let cancels = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport(
      {
        transport: unaryTransport((method, input) => {
          if (method.name === "Subscribe")
            return create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "s-done" }),
              topic: input as Topic,
            });
          if (method.name === "Cancel") cancels++;
          return create(ResponseSchema);
        }),
        createRequestId: () => "request-done",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: async () => {} },
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await subscription.activate();
    await expect(subscription.updates[Symbol.asyncIterator]().next()).rejects.toThrow(
      "ended unexpectedly",
    );
    expect(cancels).toBe(2);
    await client.close();
    expect(cancels).toBe(2);
  });

  it("reconnects an event subscription after EOF through the injected scheduler", async () => {
    let subscribes = 0;
    let releaseRetry: (() => void) | undefined;
    const topic = create(TopicSchema);
    const client = Client.usingTransport(
      {
        transport: unaryTransport(
          (method, input) => {
            if (method.name === "Subscribe") {
              subscribes++;
              return create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: `s-${subscribes}` }),
                topic: input as Topic,
              });
            }
            return create(ResponseSchema);
          },
          undefined,
          () => (async function* () {})(),
        ),
        createRequestId: () => "event-reconnect",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: {
            now: () => 0,
            wait: () => new Promise<void>((resolve) => (releaseRetry = resolve)),
          },
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    await vi.waitFor(() => expect(releaseRetry).toBeTypeOf("function"));
    releaseRetry?.();
    await vi.waitFor(() => expect(subscribes).toBe(2));
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connected" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "gapPossible" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connected" } });
    await subscription.cancel();
    await client.close();
  });

  it("normalizes a non-Error stream rejection into one failed lifecycle notice", async () => {
    let cancels = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method, input) => {
          if (method.name === "Subscribe")
            return create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "s-non-error" }),
              topic: input as Topic,
            });
          if (method.name === "Cancel") cancels++;
          return create(ResponseSchema);
        },
        undefined,
        async function* () {
          throw "stream rejected without an Error";
        },
      ),
      createRequestId: () => "non-error-stream",
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    const updates = subscription.updates[Symbol.asyncIterator]();
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();

    await subscription.activate();
    const updateError = await updates.next().catch((error: unknown) => error);
    expect(updateError).toBeInstanceOf(Error);
    expect((updateError as Error).message).toBe("stream rejected without an Error");
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connected" } });
    await expect(lifecycle.next()).resolves.toMatchObject({
      value: { state: "failed", error: updateError },
    });
    expect(cancels).toBe(1);
    await client.close();
    expect(cancels).toBe(1);
  });

  it("bounds a stalled remote cancellation", async () => {
    vi.useFakeTimers();
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport((method, input, signal) => {
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-stall" }),
            topic: input as Topic,
          });
        if (method.name === "Cancel")
          return new Promise<Message>((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(new Error("cleanup timed out")), {
              once: true,
            }),
          );
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-stall",
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await subscription.activate();
    const cancellation = subscription.cancel();
    const rejected = expect(cancellation).rejects.toThrow("cleanup timed out");
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    vi.useRealTimers();
  });

  it("settles cancellation when a non-cooperative transport ignores abort", async () => {
    vi.useFakeTimers();
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-non-cooperative" }),
            topic: input as Topic,
          });
        if (method.name === "Cancel") return new Promise<Message>(() => {});
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-non-cooperative",
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await subscription.activate();
    const cancellation = subscription.cancel();
    const cancellationFailure = cancellation.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(cancellationFailure).resolves.toMatchObject({
      message: expect.stringContaining("timed out"),
    });
    await client.close().catch(() => undefined);
    vi.useRealTimers();
  });

  it("releases every owner and closes its source once after cleanup failures", async () => {
    let closed = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-cleanup-failure" }),
            topic: input as Topic,
          });
        if (method.name === "Cancel") throw new Error("cancel failed");
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-cleanup-failure",
      close: () => closed++,
    });
    const first = await client.asGuest().createSubscription(topic, eventSubscription);
    const second = await client.asGuest().createSubscription(topic, eventSubscription);
    await first.activate();
    await second.activate();
    await expect(client.close()).rejects.toThrow("cancel failed");
    expect(closed).toBe(1);
    await expect(client.close()).rejects.toThrow("cancel failed");
  });

  it("releases invalid activation ownership when compensating cancellation fails", async () => {
    let cancels = 0;
    let closed = 0;
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "" }),
            topic: input as Topic,
          });
        if (method.name === "Cancel") {
          cancels++;
          throw new Error("compensating cancel failed");
        }
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-invalid-cleanup",
      close: () => closed++,
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const failure = await subscription.activate().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toMatchObject([
      { message: expect.stringContaining("subscription ID") },
      { message: "compensating cancel failed" },
    ]);
    expect(cancels).toBe(1);
    await client.close();
    expect(cancels).toBe(1);
    expect(closed).toBe(1);
  });

  it("serializes activation and cancels a late accepted subscription once", async () => {
    let resolveSubscribe: ((value: Message) => void) | undefined;
    let subscribes = 0;
    let cancels = 0;
    let subscribedTopic: Topic | undefined;
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport(async (method, input) => {
        if (method.name === "Subscribe") {
          subscribes++;
          subscribedTopic = input as Topic;
          return await new Promise<Message>((resolve) => (resolveSubscribe = resolve));
        }
        if (method.name === "Cancel") cancels++;
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-5",
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    const pendingUpdate = subscription.updates[Symbol.asyncIterator]().next();
    const activation = subscription.activate();
    const duplicate = subscription.activate();
    const activationError = activation.catch((error: unknown) => error);
    const duplicateError = duplicate.catch((error: unknown) => error);
    const cancellation = subscription.cancel();
    expect(subscription.cancel()).toBe(cancellation);
    resolveSubscribe?.(
      create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "s-late" }),
        topic: subscribedTopic!,
      }),
    );
    await expect(activationError).resolves.toMatchObject({
      message: expect.stringContaining("aborted"),
    });
    await expect(duplicateError).resolves.toMatchObject({
      message: expect.stringContaining("aborted"),
    });
    await cancellation;
    await expect(pendingUpdate).resolves.toMatchObject({ done: true });
    expect(subscribes).toBe(1);
    expect(cancels).toBe(1);
    await client.close();
    expect(cancels).toBe(1);
  });

  it("settles client close when Subscribe ignores abort without retaining the source", async () => {
    let closed = 0;
    const client = Client.usingTransport({
      transport: unaryTransport((method) =>
        method.name === "Subscribe" ? new Promise<Message>(() => {}) : create(ResponseSchema),
      ),
      createRequestId: () => "subscribe-never-settles",
      close: () => closed++,
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    void subscription.activate().catch(() => undefined);
    await Promise.resolve();

    await expect(client.close()).resolves.toBeUndefined();
    expect(closed).toBe(1);
  });

  it("settles cancellation requested synchronously while Subscribe is dispatched", async () => {
    let subscription: Awaited<ReturnType<ReturnType<Client["asGuest"]>["createSubscription"]>>;
    let cancellation: Promise<void> | undefined;
    const client = Client.usingTransport({
      transport: unaryTransport((method) => {
        if (method.name === "Subscribe") {
          cancellation = subscription.cancel();
          return new Promise<Message>(() => {});
        }
        return create(ResponseSchema);
      }),
      createRequestId: () => "synchronous-cancel",
    });
    subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const activationError = subscription.activate().catch((error: unknown) => error);

    await expect(cancellation).resolves.toBeUndefined();
    await expect(activationError).resolves.toMatchObject({
      message: expect.stringContaining("aborted"),
    });
    await expect(subscription.updates[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: true,
    });
    await client.close();
  });

  it("cancels a wire accepted after client close exactly once", async () => {
    let resolveSubscribe: ((value: Message) => void) | undefined;
    let topic: Topic | undefined;
    let cancels = 0;
    const client = Client.usingTransport({
      transport: unaryTransport(async (method, input) => {
        if (method.name === "Subscribe") {
          topic = input as Topic;
          return await new Promise<Message>((resolve) => (resolveSubscribe = resolve));
        }
        if (method.name === "Cancel") cancels++;
        return create(ResponseSchema);
      }),
      createRequestId: () => "late-wire",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    void subscription.activate().catch(() => undefined);
    await Promise.resolve();
    await client.close();

    resolveSubscribe?.(
      create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "after-close" }),
        topic: topic!,
      }),
    );
    await vi.waitFor(() => expect(cancels).toBe(1));
    await client.close();
    expect(cancels).toBe(1);
  });

  it("settles local streams when update next ignores cancellation", async () => {
    let nextCalls = 0;
    let closed = 0;
    const topic = create(TopicSchema);
    const updates: AsyncIterable<Message> = {
      [Symbol.asyncIterator](): AsyncIterator<Message> {
        return {
          next: () => {
            nextCalls++;
            return new Promise<IteratorResult<Message>>(() => {});
          },
        };
      },
    };
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method, input) =>
          method.name === "Subscribe"
            ? create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "noncooperative-stream" }),
                topic: input as Topic,
              })
            : create(ResponseSchema),
        undefined,
        () => updates,
      ),
      createRequestId: () => "stream-never-settles",
      close: () => closed++,
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    const localUpdates = subscription.updates[Symbol.asyncIterator]();
    await subscription.activate();
    await vi.waitFor(() => expect(nextCalls).toBe(1));

    await expect(client.close()).resolves.toBeUndefined();
    expect(closed).toBe(1);
    await expect(localUpdates.next()).resolves.toMatchObject({ done: true });
  });

  it("preserves a full lifecycle queue before one observable closed terminal notice", async () => {
    const client = Client.usingTransport(
      {
        transport: unaryTransport((method, _input, signal) =>
          method.name === "Subscribe"
            ? new Promise<Message>((_resolve, reject) =>
                signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
              )
            : create(ResponseSchema),
        ),
        createRequestId: () => "closed-terminal",
      },
      { subscriptions: { lifecycleBufferCapacity: 1 } },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    const activation = subscription.activate();
    await Promise.resolve();
    await subscription.cancel();
    await expect(activation).rejects.toThrow("aborted");
    await expect(lifecycle.next()).resolves.toMatchObject({
      done: false,
      value: { state: "connecting" },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({
      done: false,
      value: { state: "closed" },
    });
    await expect(lifecycle.next()).resolves.toMatchObject({ done: true });
    await client.close();
  });

  it("rejects creation and activation through their caller-owned abort signals", async () => {
    let subscribes = 0;
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Subscribe") subscribes++;
        return create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "abort" }),
          topic: input as Topic,
        });
      }),
      createRequestId: () => "abort",
    });
    const creationAbort = new AbortController();
    creationAbort.abort(new Error("creation stopped"));
    await expect(
      client
        .asGuest()
        .createSubscription(create(TopicSchema), { kind: "event", signal: creationAbort.signal }),
    ).rejects.toThrow("creation stopped");

    const activationAbort = new AbortController();
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), { kind: "event", signal: activationAbort.signal });
    activationAbort.abort(new Error("subscription stopped"));
    await expect(subscription.activate({ signal: activationAbort.signal })).rejects.toThrow(
      "subscription stopped",
    );
    expect(subscribes).toBe(0);
    await subscription.cancel();
    await expect(subscription.activate()).rejects.toThrow("cancelled");
    await client.close();
  });

  it("aggregates subscription and source-close failures", async () => {
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "aggregate" }),
            topic: input as Topic,
          });
        if (method.name === "Cancel") throw new Error("cancel failed");
        return create(ResponseSchema);
      }),
      createRequestId: () => "aggregate",
      close: () => {
        throw new Error("source close failed");
      },
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await subscription.activate();
    const failure = await client.close().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toMatchObject([
      { message: "cancel failed" },
      { message: "source close failed" },
    ]);
  });

  it("fails activation without attempting cleanup when Subscribe rejects before a wire exists", async () => {
    let cancels = 0;
    const client = Client.usingTransport(
      {
        transport: unaryTransport((method) => {
          if (method.name === "Subscribe") throw new Error("subscribe failed");
          if (method.name === "Cancel") cancels++;
          return create(ResponseSchema);
        }),
        createRequestId: () => "subscribe-reject",
      },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: immediateScheduler(),
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    await expect(subscription.activate()).rejects.toThrow("subscribe failed");
    expect(cancels).toBe(0);
    await client.close();
  });

  it("emits one connecting transition for concurrent activation calls", async () => {
    const client = Client.usingTransport({
      transport: updateTransport(0),
      createRequestId: () => "one",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const lifecycle = subscription.lifecycle[Symbol.asyncIterator]();
    await Promise.all([subscription.activate(), subscription.activate()]);
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connecting" } });
    await expect(lifecycle.next()).resolves.toMatchObject({ value: { state: "connected" } });
    await subscription.cancel();
    await client.close();
  });

  it("rejects a concurrent pending next without stranding the first call", async () => {
    const client = Client.usingTransport({
      transport: updateTransport(2, () => new Promise<void>(() => {})),
      createRequestId: () => "pending",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    await subscription.activate();
    const updates = subscription.updates[Symbol.asyncIterator]();
    await updates.next();
    const first = updates.next();
    await expect(updates.next()).rejects.toThrow("one pending next");
    await subscription.cancel();
    await expect(first).resolves.toMatchObject({ done: true });
    await client.close();
  });

  it("settles a pending iterator locally when its transport ignores cancellation", async () => {
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method, input) =>
          method.name === "Subscribe"
            ? create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "s-pending" }),
                topic: input as Topic,
              })
            : create(ResponseSchema),
        undefined,
        () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<Message>>(() => {}),
          }),
        }),
      ),
      createRequestId: () => "request-6",
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await subscription.activate();
    const pending = subscription.updates[Symbol.asyncIterator]().next();
    await subscription.cancel();
    await expect(pending).resolves.toMatchObject({ done: true });
  });

  it("closes its source once when remote cancellation fails", async () => {
    let closed = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Subscribe")
          return create(SubscriptionSchema, {
            id: create(SubscriptionIdSchema, { value: "s-fail" }),
            topic: input as Topic,
          });
        if (method.name === "Cancel") throw new Error("cancel failed");
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-7",
      close: () => closed++,
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await subscription.activate();
    await expect(client.close()).rejects.toThrow("cancel failed");
    await expect(client.close()).rejects.toThrow("cancel failed");
    expect(closed).toBe(1);
  });

  it("maps accepted, error, and rejection acknowledgements for the posted command", async () => {
    const statuses = [
      create(StatusSchema, { status: { case: "ok", value: {} } }),
      create(StatusSchema, { status: { case: "error", value: create(ErrorSchema) } }),
      create(StatusSchema, { status: { case: "rejection", value: create(EventSchema) } }),
    ];
    let index = 0;
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        expect(method.name).toBe("Post");
        const command = input as { id?: { uuid?: string } };
        return create(AckSchema, {
          messageId: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: command.id?.uuid })),
          status: statuses[index++],
        });
      }),
      createRequestId: () => "post-1",
    });

    expect(
      (await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }))).kind,
    ).toBe("ok");
    expect(
      (await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }))).kind,
    ).toBe("error");
    expect(
      (await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }))).kind,
    ).toBe("rejection");
    await client.close();
  });

  it("rejects malformed and mismatched command acknowledgements", async () => {
    let malformed = true;
    const client = Client.usingTransport({
      transport: unaryTransport((_method, input) => {
        const command = input as { id?: { uuid?: string } };
        return create(AckSchema, {
          messageId: malformed
            ? undefined
            : packAny(
                CommandIdSchema,
                create(CommandIdSchema, { uuid: `${command.id?.uuid}-other` }),
              ),
          status: create(StatusSchema, { status: { case: "ok", value: {} } }),
        });
      }),
      createRequestId: () => "post-2",
    });
    const scope = client.asGuest();
    await expect(
      scope.post(UserIdSchema, create(UserIdSchema, { value: "command" })),
    ).rejects.toThrow("acknowledgement");
    malformed = false;
    await expect(
      scope.post(UserIdSchema, create(UserIdSchema, { value: "command" })),
    ).rejects.toThrow("does not match");
    await client.close();
  });

  it("rejects an acknowledgement without an application outcome", async () => {
    const client = Client.usingTransport({
      transport: unaryTransport((_method, input) => {
        const command = input as { id?: { uuid?: string } };
        return create(AckSchema, {
          messageId: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: command.id?.uuid })),
        });
      }),
      createRequestId: () => "post-no-status",
    });
    await expect(
      client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" })),
    ).rejects.toThrow("response status");
    await client.close();
  });

  it("validates and snapshots tenant, zone, and actor context for outbound work", async () => {
    expect(() => Client.usingTransport(source(), { tenant: "" })).toThrow(
      "tenant must not be empty",
    );
    expect(() => Client.usingTransport(source(), { zoneId: "" })).toThrow(
      "zoneId must not be empty",
    );
    expect(() => Client.usingTransport(source()).onBehalfOf("")).toThrow("actor must not be empty");
    expect(() => Client.usingTransport(source(), { tenant: create(TenantIdSchema) })).toThrow(
      "tenant",
    );
    expect(() => Client.usingTransport(source(), { zoneId: create(ZoneIdSchema) })).toThrow(
      "zoneId",
    );

    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const zoneId = create(ZoneIdSchema, { value: "Europe/Lisbon" });
    let received:
      | {
          context?: {
            tenantId?: { kind: { value?: string } };
            zoneId?: { value?: string };
            actor?: { value?: string };
          };
        }
      | undefined;
    const client = Client.usingTransport(
      {
        transport: unaryTransport((method, input) => {
          if (method.name === "Read") received = input as typeof received;
          return create(QueryResponseSchema);
        }),
        createRequestId: () => "context-1",
      },
      { tenant, zoneId },
    );
    tenant.kind = { case: "value", value: "changed" };
    zoneId.value = "changed";
    await client.onBehalfOf("alice").send(create(QuerySchema));
    expect(received?.context?.tenantId?.kind.value).toBe("tenant-a");
    expect(received?.context?.zoneId?.value).toBe("Europe/Lisbon");
    expect(received?.context?.actor?.value).toBe("alice");
    await client.close();

    const stringClient = Client.usingTransport(
      {
        transport: unaryTransport((method, input) => {
          if (method.name === "Read") received = input as typeof received;
          return create(QueryResponseSchema);
        }),
        createRequestId: () => "context-2",
      },
      { tenant: "tenant-string", zoneId: "Europe/Lisbon" },
    );
    await stringClient.asGuest().send(create(QuerySchema));
    expect(received?.context?.tenantId?.kind.value).toBe("tenant-string");
    await stringClient.close();
  });

  it("builds a query once, clones it, and rejects caller-aborted or closed sends", async () => {
    const query = create(QuerySchema);
    let reads = 0;
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Read") {
          reads++;
          expect(input).not.toBe(query);
        }
        return create(QueryResponseSchema);
      }),
      createRequestId: () => "send-1",
    });
    let builds = 0;
    await client.asGuest().send({ build: () => (builds++, query) });
    expect(builds).toBe(1);
    const abort = new AbortController();
    abort.abort(new Error("caller stopped"));
    await expect(client.asGuest().send(query, { signal: abort.signal })).rejects.toThrow(
      "caller stopped",
    );
    expect(reads).toBe(1);
    await client.close();
    await expect(client.asGuest().send(query)).rejects.toThrow("client is closing");
  });

  it("allows pre-activation iteration and validates subscription topic and delivered identity", async () => {
    const requested = create(TopicSchema);
    let phase = 0;
    let accepted: Topic | undefined;
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method, input) => {
          if (method.name === "Subscribe") {
            accepted = input as Topic;
            return create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "sub-1" }),
              topic: phase === 0 ? create(TopicSchema, { context: undefined }) : accepted,
            });
          }
          return create(ResponseSchema);
        },
        undefined,
        () =>
          (async function* () {
            yield create(SubscriptionUpdateSchema, {
              subscription: create(SubscriptionSchema, {
                id: create(SubscriptionIdSchema, { value: "wrong-id" }),
                topic: accepted!,
              }),
            });
          })(),
      ),
      createRequestId: () => "subscription-1",
    });
    const first = await client.asGuest().createSubscription(requested, eventSubscription);
    expect(() => first.updates[Symbol.asyncIterator]()).not.toThrow();
    await expect(first.activate()).rejects.toThrow("topic does not match");
    phase = 1;
    const second = await client.asGuest().createSubscription(requested, eventSubscription);
    await second.activate();
    await expect(second.updates[Symbol.asyncIterator]().next()).rejects.toThrow("does not match");
    await client.close();
  });

  it("delivers a matching subscription update and permits the caller to end iteration", async () => {
    let accepted: Topic | undefined;
    const calls: string[] = [];
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method, input) => {
          calls.push(method.name);
          if (method.name === "Subscribe") {
            accepted = input as Topic;
            return create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "sub-deliver" }),
              topic: accepted,
            });
          }
          return create(ResponseSchema);
        },
        undefined,
        () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => ({
              done: false,
              value: create(SubscriptionUpdateSchema, {
                subscription: create(SubscriptionSchema, {
                  id: create(SubscriptionIdSchema, { value: "sub-deliver" }),
                  topic: accepted!,
                }),
              }),
            }),
            return: async () => ({ done: true, value: undefined }),
          }),
        }),
      ),
      createRequestId: () => "subscription-deliver",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    await subscription.activate();
    const iterator = subscription.updates[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await subscription.cancel();
    expect(calls).toContain("Cancel");
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    await client.close();
  });

  it("honors an activation signal that was already aborted", async () => {
    let subscribes = 0;
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) => {
        if (method.name === "Subscribe") subscribes++;
        return create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "should-not-subscribe" }),
          topic: input as Topic,
        });
      }),
      createRequestId: () => "subscription-abort",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const abort = new AbortController();
    abort.abort(new Error("activation stopped"));
    await expect(subscription.activate({ signal: abort.signal })).rejects.toThrow(
      "activation stopped",
    );
    expect(subscribes).toBe(0);
    await client.close();
  });

  it("aborts an in-flight activation and forwards its abort reason to Subscribe", async () => {
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => (resolveStarted = resolve));
    const client = Client.usingTransport({
      transport: unaryTransport(
        (method, _input, signal) => {
          if (method.name !== "Subscribe") return create(ResponseSchema);
          resolveStarted?.();
          return new Promise<Message>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        undefined,
        undefined,
      ),
      createRequestId: () => "activation-abort",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    const abort = new AbortController();
    const activation = subscription.activate({ signal: abort.signal });
    await started;
    abort.abort(new Error("activation interrupted"));
    await expect(activation).rejects.toThrow("activation interrupted");
    await subscription.cancel();
    await client.close();
  });
});

function unaryTransport(
  handler: (
    method: { readonly name: string },
    input: Message,
    signal: AbortSignal,
  ) => Message | Promise<Message>,
  read?: (query: Message) => Message | Promise<Message>,
  updates?: () => AsyncIterable<Message>,
): Transport {
  return {
    async unary(method, signal, _timeoutMs, _header, input) {
      return {
        stream: false,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message:
          method.name === "Read" && read !== undefined
            ? await read(input as Message)
            : await handler(method, input, signal),
      } as never;
    },
    async stream(method) {
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: updates?.() ?? (async function* () {})(),
      } as never;
    },
  };
}

function source(): { transport: Transport; createRequestId(): string } {
  return {
    transport: unaryTransport(() => create(QueryResponseSchema)),
    createRequestId: () => "source",
  };
}

interface BrowserCall {
  readonly protocol: "connect" | "grpc-web";
  readonly method: string;
  readonly metadata: string | null;
}

function browserTransport(
  protocol: BrowserCall["protocol"],
  interceptors: readonly Interceptor[],
  calls: BrowserCall[],
): Transport {
  const invoke = runInterceptors(
    [...interceptors],
    async (request: UnaryRequest): Promise<UnaryResponse> => {
      calls.push({
        protocol,
        method: request.method.name,
        metadata: request.header.get("x-application-call"),
      });
      return {
        stream: false,
        method: request.method,
        header: new Headers(),
        trailer: new Headers(),
        service: request.service,
        message: browserResponse(request.method.name, request.message),
      } as never;
    },
  );
  return {
    async unary(method, signal, _timeoutMs, header, input) {
      return invoke({
        stream: false,
        method,
        service: method.parent,
        requestMethod: "POST",
        url: "https://gateway.example",
        signal: signal ?? new AbortController().signal,
        header: new Headers(header),
        contextValues: undefined,
        message: input,
      } as never) as never;
    },
    async stream(method) {
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: (async function* () {})(),
      } as never;
    },
  };
}

function runInterceptors(
  interceptors: readonly Interceptor[],
  next: (request: UnaryRequest) => Promise<UnaryResponse>,
): (request: UnaryRequest) => Promise<UnaryResponse> {
  return interceptors.reduceRight(
    (current, interceptor) => interceptor(current as never) as unknown as typeof current,
    next,
  );
}

function browserResponse(
  method: string,
  input: { readonly id?: { readonly uuid?: string } },
): Message {
  if (method !== "Post") return create(QueryResponseSchema);
  const command = input as { id?: { uuid?: string } };
  return create(AckSchema, {
    messageId: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: command.id?.uuid })),
    status: create(StatusSchema, { status: { case: "ok", value: {} } }),
  });
}

function updateTransport(count = 2, beforeSecond?: () => Promise<void>): Transport {
  let topic: Topic | undefined;
  return unaryTransport(
    (method, input) => {
      if (method.name !== "Subscribe") return create(ResponseSchema);
      topic = input as Topic;
      return create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "updates" }),
        topic,
      });
    },
    undefined,
    () =>
      (async function* () {
        for (let index = 0; index < count; index++) {
          if (index === 1 && beforeSecond !== undefined) await beforeSecond();
          yield create(SubscriptionUpdateSchema, {
            subscription: create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "updates" }),
              topic: topic!,
            }),
          });
        }
      })(),
  );
}

function immediateScheduler(): { now(): number; wait(): Promise<void> } {
  return { now: () => 0, wait: async () => {} };
}

function neverEndingUpdates(): AsyncIterable<Message> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Message> {
      return { next: () => new Promise<IteratorResult<Message>>(() => {}) };
    },
  };
}
