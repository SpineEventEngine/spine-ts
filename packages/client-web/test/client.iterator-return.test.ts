import { create } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { QuerySchema, TargetSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => ({
  iterator: undefined as AsyncIterator<unknown> | undefined,
  iterators: [] as AsyncIterator<unknown>[],
  cancel: vi.fn(async () => {}),
  read: vi.fn(async () => ({ response: { status: { status: { case: "ok" } } } })),
}));

vi.mock("@connectrpc/connect", () => ({
  createClient: () => ({
    subscribe: async (topic: unknown) => ({ id: { value: "wire" }, topic }),
    activate: () => ({
      [Symbol.asyncIterator]: () => connect.iterators.shift() ?? connect.iterator,
    }),
    cancel: connect.cancel,
    read: connect.read,
  }),
}));

import { Client } from "../src/index.js";

describe("Client iterator disposal", () => {
  beforeEach(() => {
    connect.iterator = undefined;
    connect.iterators = [];
    connect.cancel.mockClear();
    connect.read.mockReset();
    connect.read.mockResolvedValue({ response: { status: { status: { case: "ok" } } } });
  });

  it("settles cancellation when iterator return rejects after a non-cooperative next", async () => {
    let returns = 0;
    let closed = 0;
    connect.iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => {}),
      return: () => {
        returns++;
        return Promise.reject(new Error("iterator return rejected"));
      },
    };
    const client = Client.usingTransport({
      transport: {} as Transport,
      createRequestId: () => "iterator-return",
      close: () => closed++,
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), { kind: "event" });
    const updates = subscription.updates[Symbol.asyncIterator]();

    await subscription.activate();
    await expect(subscription.cancel()).resolves.toBeUndefined();

    expect(returns).toBe(1);
    expect(connect.cancel).toHaveBeenCalledTimes(1);
    await expect(updates.next()).resolves.toMatchObject({ done: true });
    await expect(client.close()).resolves.toBeUndefined();
    expect(closed).toBe(1);
  });

  it("waits for a cooperative iterator return before cancelling its wire", async () => {
    let settle: (() => void) | undefined;
    connect.iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => {}),
      return: () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          settle = () => resolve({ done: true, value: undefined });
        }),
    };
    const client = Client.usingTransport({
      transport: {} as Transport,
      createRequestId: () => "ordered",
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), { kind: "event" });
    await subscription.activate();
    const cancelling = subscription.cancel();
    await vi.waitFor(() => expect(settle).toBeDefined());
    expect(connect.cancel).not.toHaveBeenCalled();
    settle?.();
    await cancelling;
    expect(connect.cancel).toHaveBeenCalledTimes(1);
  });

  it("disposes a retryable failed stream once before reconnect and never returns it again", async () => {
    const firstReturn = vi.fn(() => Promise.reject(new Error("first return rejected")));
    const secondReturn = vi.fn(() => new Promise<IteratorResult<unknown>>(() => {}));
    connect.iterators = [
      { next: () => Promise.reject(new Error("retryable stream failure")), return: firstReturn },
      { next: () => new Promise<IteratorResult<unknown>>(() => {}), return: secondReturn },
    ];
    const client = Client.usingTransport(
      { transport: {} as Transport, createRequestId: () => "retry-return" },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: async () => {} },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), { kind: "event" });

    await subscription.activate();
    await vi.waitFor(() => expect(firstReturn).toHaveBeenCalledTimes(1));
    await expect(subscription.cancel()).resolves.toBeUndefined();
    expect(firstReturn).toHaveBeenCalledTimes(1);
    expect(secondReturn).toHaveBeenCalledTimes(1);
    await client.close();
    expect(firstReturn).toHaveBeenCalledTimes(1);
    expect(secondReturn).toHaveBeenCalledTimes(1);
  });

  it("disposes each Entity replacement iterator once through Read retry exhaustion", async () => {
    const returns = [vi.fn(), vi.fn(() => Promise.reject(new Error("ignored"))), vi.fn()];
    connect.iterators = [
      { next: () => Promise.reject(new Error("retryable stream failure")), return: returns[0] },
      { next: () => new Promise<IteratorResult<unknown>>(() => {}), return: returns[1] },
      { next: () => new Promise<IteratorResult<unknown>>(() => {}), return: returns[2] },
    ];
    connect.read
      .mockRejectedValueOnce(new Error("transient Read failure"))
      .mockResolvedValueOnce({ response: { status: { status: { case: "error" } } } });
    const target = create(TargetSchema, { type: "type.example/Entity" });
    const client = Client.usingTransport(
      { transport: {} as Transport, createRequestId: () => "entity-return" },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: async () => {} },
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

    await subscription.activate();
    await expect(updates.next()).rejects.toThrow("not OK");
    expect(connect.read).toHaveBeenCalledTimes(2);
    for (const iteratorReturn of returns) expect(iteratorReturn).toHaveBeenCalledTimes(1);
    await client.close();
    for (const iteratorReturn of returns) expect(iteratorReturn).toHaveBeenCalledTimes(1);
  });
});
