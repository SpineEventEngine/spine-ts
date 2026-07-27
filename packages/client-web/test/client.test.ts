import { create, type Message } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { packAny } from "@spine-event-engine/core";
import {
  AckSchema,
  ActorContextSchema,
  CommandIdSchema,
  ErrorSchema,
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
  SubscriptionSchema,
  SubscriptionIdSchema,
  SubscriptionUpdateSchema,
  type Topic,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it, vi } from "vitest";

import { Client } from "../src/index.js";

describe("Client", () => {
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

    const subscription = await client.asGuest().createSubscription(create(TopicSchema));
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
      transport: unaryTransport((method) => {
        if (method.name === "Cancel") cancelled++;
        return create(ResponseSchema);
      }, async () => {
        await new Promise<void>((resolve) => (resolveRead = resolve));
        return create(QueryResponseSchema);
      }),
      createRequestId: () => "request-3",
    });
    const scope = client.asGuest();
    const read = scope.send(create(QuerySchema));
    const readResult = expect(read).rejects.toThrow("client is closing");
    const subscription = await scope.createSubscription(create(TopicSchema));

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
    const subscription = await client.asGuest().createSubscription(topic);
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
    const subscription = await client.asGuest().createSubscription(topic);
    await subscription.activate();
    await expect(subscription[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: true });
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
            signal.addEventListener("abort", () => reject(new Error("cleanup timed out")), { once: true }),
          );
        return create(ResponseSchema);
      }),
      createRequestId: () => "request-stall",
    });
    const subscription = await client.asGuest().createSubscription(topic);
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
    const subscription = await client.asGuest().createSubscription(topic);
    await subscription.activate();
    const cancellation = subscription.cancel();
    const cancellationFailure = cancellation.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(cancellationFailure).resolves.toMatchObject({ message: expect.stringContaining("timed out") });
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
    const first = await client.asGuest().createSubscription(topic);
    const second = await client.asGuest().createSubscription(topic);
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
    const subscription = await client.asGuest().createSubscription(create(TopicSchema));
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
    const subscription = await client.asGuest().createSubscription(topic);
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
    expect(subscribes).toBe(1);
    expect(cancels).toBe(1);
    await client.close();
    expect(cancels).toBe(1);
  });

  it("settles a pending iterator locally when its transport ignores cancellation", async () => {
    const topic = create(TopicSchema);
    const client = Client.usingTransport({
      transport: unaryTransport((method, input) =>
        method.name === "Subscribe"
          ? create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "s-pending" }),
              topic: input as Topic,
            })
          : create(ResponseSchema),
        undefined,
        () => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Message>>(() => {}) }),
        }),
      ),
      createRequestId: () => "request-6",
    });
    const subscription = await client.asGuest().createSubscription(topic);
    await subscription.activate();
    const pending = subscription[Symbol.asyncIterator]().next();
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
    const subscription = await client.asGuest().createSubscription(topic);
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

    expect((await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }))).kind).toBe("ok");
    expect((await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }))).kind).toBe("error");
    expect((await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }))).kind).toBe(
      "rejection",
    );
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
            : packAny(CommandIdSchema, create(CommandIdSchema, { uuid: `${command.id?.uuid}-other` })),
          status: create(StatusSchema, { status: { case: "ok", value: {} } }),
        });
      }),
      createRequestId: () => "post-2",
    });
    const scope = client.asGuest();
    await expect(scope.post(UserIdSchema, create(UserIdSchema, { value: "command" }))).rejects.toThrow("acknowledgement");
    malformed = false;
    await expect(scope.post(UserIdSchema, create(UserIdSchema, { value: "command" }))).rejects.toThrow("does not match");
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
    expect(() => Client.usingTransport(source(), { tenant: "" })).toThrow("tenant must not be empty");
    expect(() => Client.usingTransport(source(), { zoneId: "" })).toThrow("zoneId must not be empty");
    expect(() => Client.usingTransport(source()).onBehalfOf("")).toThrow("actor must not be empty");
    expect(() => Client.usingTransport(source(), { tenant: create(TenantIdSchema) })).toThrow("tenant");
    expect(() => Client.usingTransport(source(), { zoneId: create(ZoneIdSchema) })).toThrow("zoneId");

    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const zoneId = create(ZoneIdSchema, { value: "Europe/Lisbon" });
    let received: { context?: { tenantId?: { kind: { value?: string } }; zoneId?: { value?: string }; actor?: { value?: string } } } | undefined;
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
    await expect(client.asGuest().send(query, { signal: abort.signal })).rejects.toThrow("caller stopped");
    expect(reads).toBe(1);
    await client.close();
    await expect(client.asGuest().send(query)).rejects.toThrow("client is closing");
  });

  it("rejects unactivated iteration and validates subscription topic and delivered identity", async () => {
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
    const first = await client.asGuest().createSubscription(requested);
    expect(() => first[Symbol.asyncIterator]()).toThrow("not activated");
    await expect(first.activate()).rejects.toThrow("topic does not match");
    phase = 1;
    const second = await client.asGuest().createSubscription(requested);
    await second.activate();
    await expect(second[Symbol.asyncIterator]().next()).rejects.toThrow("does not match");
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
    const subscription = await client.asGuest().createSubscription(create(TopicSchema));
    await subscription.activate();
    const iterator = subscription[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    await iterator.return?.();
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
    const subscription = await client.asGuest().createSubscription(create(TopicSchema));
    const abort = new AbortController();
    abort.abort(new Error("activation stopped"));
    await expect(subscription.activate({ signal: abort.signal })).rejects.toThrow("activation stopped");
    expect(subscribes).toBe(0);
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
          method.name === "Read" && read !== undefined ? await read() : await handler(method, input, signal),
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
  return { transport: unaryTransport(() => create(QueryResponseSchema)), createRequestId: () => "source" };
}
