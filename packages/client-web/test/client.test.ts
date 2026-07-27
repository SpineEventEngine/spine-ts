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
  QuerySchema,
  EventUpdatesSchema,
  SubscriptionSchema,
  SubscriptionIdSchema,
  SubscriptionUpdateSchema,
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

  it("drains buffered updates after graceful wire completion", async () => {
    const client = Client.usingTransport(
      { transport: updateTransport(2), createRequestId: () => "drain" },
      { subscriptions: { updateBufferCapacity: 2, updateBufferByteCapacity: 10_000 } },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), eventSubscription);
    await subscription.activate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const updates = subscription.updates[Symbol.asyncIterator]();
    await expect(updates.next()).resolves.toMatchObject({ done: false });
    await expect(updates.next()).resolves.toMatchObject({ done: false });
    await expect(updates.next()).resolves.toMatchObject({ done: true });
    await client.close();
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

  it("does not re-cancel a naturally completed stream during client close", async () => {
    let cancels = 0;
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
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
    });
    const subscription = await client.asGuest().createSubscription(topic, eventSubscription);
    await subscription.activate();
    await expect(subscription.updates[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: true,
    });
    await client.close();
    expect(cancels).toBe(0);
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
    const cancellation = subscription.cancel();
    resolveSubscribe?.(
      create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "s-late" }),
        topic: subscribedTopic!,
      }),
    );
    await expect(activation).rejects.toThrow("cancelled");
    await expect(duplicate).rejects.toThrow("cancelled");
    await cancellation;
    await expect(pendingUpdate).resolves.toMatchObject({ done: true });
    expect(subscribes).toBe(1);
    expect(cancels).toBe(1);
    await client.close();
    expect(cancels).toBe(1);
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
    const client = Client.usingTransport({
      transport: unaryTransport((method) => {
        if (method.name === "Subscribe") throw new Error("subscribe failed");
        if (method.name === "Cancel") cancels++;
        return create(ResponseSchema);
      }),
      createRequestId: () => "subscribe-reject",
    });
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
  read?: () => Promise<Message>,
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
            ? await read()
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
