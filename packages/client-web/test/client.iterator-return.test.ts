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

import { create } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { ResponseSchema, StatusSchema } from "@spine-event-engine/proto";
import {
  QuerySchema,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  type SubscriptionUpdate,
  TargetSchema,
  type Subscription,
  type Topic,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => ({
  iterator: undefined as AsyncIterator<unknown> | undefined,
  iterators: [] as AsyncIterator<unknown>[],
  cancel: vi.fn(() => Promise.resolve()),
  read: vi.fn(() => Promise.resolve({ response: { status: { status: { case: "ok" } } } })),
  holdAck: false,
  ackOverride: undefined as SubscriptionUpdate | undefined,
  ackStarted: vi.fn(),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    subscribe: (topic: unknown) =>
      Promise.resolve(
        create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "wire" }),
          topic: topic as Topic,
        }),
      ),
    activate: (wire: unknown) => ({
      [Symbol.asyncIterator]: () => {
        const source = connect.iterators.shift() ?? connect.iterator;
        if (source === undefined) throw new Error("Expected a test subscription iterator.");
        let acknowledged = false;
        return {
          next: () => {
            if (!acknowledged) {
              acknowledged = true;
              if (connect.holdAck) {
                connect.ackStarted();
                return new Promise<IteratorResult<unknown>>(() => undefined);
              }
              return Promise.resolve({
                done: false,
                value:
                  connect.ackOverride ??
                  create(SubscriptionUpdateSchema, {
                    subscription: wire as Subscription,
                    response: create(ResponseSchema, {
                      status: create(StatusSchema, { status: { case: "ok", value: {} } }),
                    }),
                  }),
              });
            }
            return source.next();
          },
          return: () => source.return?.() ?? Promise.resolve({ done: true, value: undefined }),
        };
      },
    }),
    cancel: connect.cancel,
    read: connect.read,
  }),
}));

import { Client, ClientProtocolError } from "../src/index.js";

describe("Client iterator disposal", () => {
  beforeEach(() => {
    connect.iterator = undefined;
    connect.iterators = [];
    connect.cancel.mockClear();
    connect.read.mockReset();
    connect.read.mockResolvedValue({ response: { status: { status: { case: "ok" } } } });
    connect.holdAck = false;
    connect.ackOverride = undefined;
    connect.ackStarted.mockClear();
  });

  it("settles cancellation when iterator return rejects after a non-cooperative next", async () => {
    let returns = 0;
    let closed = 0;
    connect.iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => undefined),
      return: () => {
        returns++;
        return Promise.reject(new Error("iterator return rejected"));
      },
    };
    const client = Client.usingTransport({
      transport: {} as Transport,
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
      next: () => new Promise<IteratorResult<unknown>>(() => undefined),
      return: () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          settle = () => {
            resolve({ done: true, value: undefined });
          };
        }),
    };
    const client = Client.usingTransport({
      transport: {} as Transport,
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), { kind: "event" });
    await subscription.activate();
    const cancelling = subscription.cancel();
    await vi.waitFor(() => {
      expect(settle).toBeDefined();
    });
    expect(connect.cancel).not.toHaveBeenCalled();
    settle?.();
    await cancelling;
    expect(connect.cancel).toHaveBeenCalledTimes(1);
  });

  it("disposes a retryable failed stream once before reconnect and never returns it again", async () => {
    const firstReturn = vi.fn(() => Promise.reject(new Error("first return rejected")));
    const secondReturn = vi.fn(() => new Promise<IteratorResult<unknown>>(() => undefined));
    connect.iterators = [
      { next: () => Promise.reject(new Error("retryable stream failure")), return: firstReturn },
      { next: () => new Promise<IteratorResult<unknown>>(() => undefined), return: secondReturn },
    ];
    const client = Client.usingTransport(
      { transport: {} as Transport },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: () => Promise.resolve() },
        },
      },
    );
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), { kind: "event" });

    await subscription.activate();
    await vi.waitFor(() => {
      expect(firstReturn).toHaveBeenCalledTimes(1);
    });
    await expect(subscription.cancel()).resolves.toBeUndefined();
    expect(firstReturn).toHaveBeenCalledTimes(1);
    expect(secondReturn).toHaveBeenCalledTimes(1);
    await client.close();
    expect(firstReturn).toHaveBeenCalledTimes(1);
    expect(secondReturn).toHaveBeenCalledTimes(1);
  });

  it("disposes each Entity replacement iterator once through Read retry exhaustion", async () => {
    const returns = [
      vi.fn(() => Promise.resolve({ done: true, value: undefined })),
      vi.fn(() => Promise.reject(new Error("ignored"))),
      vi.fn(() => Promise.resolve({ done: true, value: undefined })),
    ];
    connect.iterators = [
      {
        next: () => Promise.reject(new Error("retryable stream failure")),
        return: requireReturn(returns, 0),
      },
      {
        next: () => new Promise<IteratorResult<unknown>>(() => undefined),
        return: requireReturn(returns, 1),
      },
      {
        next: () => new Promise<IteratorResult<unknown>>(() => undefined),
        return: requireReturn(returns, 2),
      },
    ];
    connect.read
      .mockRejectedValueOnce(new Error("transient Read failure"))
      .mockResolvedValueOnce({ response: { status: { status: { case: "error" } } } });
    const target = create(TargetSchema, { type: "type.example/Entity" });
    const client = Client.usingTransport(
      { transport: {} as Transport },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 2, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: () => Promise.resolve() },
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

  it.each([
    { description: "string", reason: "caller stopped", message: "caller stopped" },
    { description: "number", reason: 17, message: "17" },
    { description: "boolean", reason: false, message: "false" },
    { description: "bigint", reason: 19n, message: "19" },
    { description: "object", reason: { stopped: true }, message: "operation aborted." },
  ])("turns a $description activation abort into a terminal Error", async ({ reason, message }) => {
    connect.iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => undefined),
      return: () => Promise.resolve({ done: true, value: undefined }),
    };
    connect.holdAck = true;
    const caller = new AbortController();
    const client = Client.usingTransport({ transport: {} as Transport });
    const subscription = await client.asGuest().createSubscription(create(TopicSchema), {
      kind: "event",
    });
    const activation = subscription.activate({ signal: caller.signal });
    void activation.catch(() => undefined);
    await vi.waitFor(() => {
      expect(connect.ackStarted).toHaveBeenCalledTimes(1);
    });
    caller.abort(reason);
    await expect(activation).rejects.toThrow(message);
    await expect(client.close()).resolves.toBeUndefined();
    expect(connect.cancel).toHaveBeenCalledTimes(1);
  });

  it("terminates a failed stream when a dynamic retry policy returns an invalid delay", async () => {
    connect.iterator = {
      next: () => Promise.reject(new Error("stream disconnected")),
      return: () => Promise.resolve({ done: true, value: undefined }),
    };
    const delayMs = vi.fn().mockReturnValueOnce(1).mockReturnValue(0);
    const client = Client.usingTransport(
      { transport: {} as Transport },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs },
          scheduler: { now: () => 0, wait: () => Promise.resolve() },
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(create(TopicSchema), {
      kind: "event",
    });
    const updates = subscription.updates[Symbol.asyncIterator]();
    await subscription.activate();

    await expect(updates.next()).rejects.toThrow("retry delay must be a positive safe integer");
    expect(connect.cancel).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it("preserves a stream failure when terminal remote cleanup also fails", async () => {
    connect.iterator = {
      next: () => Promise.reject(new ClientProtocolError("stream response invalid")),
      return: () => Promise.resolve({ done: true, value: undefined }),
    };
    connect.cancel.mockRejectedValueOnce(new Error("remote cleanup failed"));
    const client = Client.usingTransport(
      { transport: {} as Transport },
      {
        subscriptions: {
          retryPolicy: { maxAttempts: 1, maxElapsedMs: 1_000, delayMs: () => 1 },
          scheduler: { now: () => 0, wait: () => Promise.resolve() },
        },
      },
    );
    const subscription = await client.asGuest().createSubscription(create(TopicSchema), {
      kind: "event",
    });
    const updates = subscription.updates[Symbol.asyncIterator]();
    await subscription.activate();

    await expect(updates.next()).rejects.toThrow("stream response invalid");
    expect(connect.cancel).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it.each([
    {
      description: "mismatched subscription ID",
      response: create(SubscriptionUpdateSchema, {
        subscription: create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "different" }),
          topic: create(TopicSchema),
        }),
        response: create(ResponseSchema, {
          status: create(StatusSchema, { status: { case: "ok", value: {} } }),
        }),
      }),
      message: "ACK ID does not match",
    },
    {
      description: "non-OK response",
      response: create(SubscriptionUpdateSchema, {
        subscription: create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "wire" }),
          topic: create(TopicSchema),
        }),
        response: create(ResponseSchema, {
          status: create(StatusSchema, { status: { case: "error", value: {} } }),
        }),
      }),
      message: "activation ACK",
    },
  ])(
    "rejects a $description before exposing subscription readiness",
    async ({ response, message }) => {
      connect.ackOverride = response;
      connect.iterator = {
        next: () => new Promise<IteratorResult<unknown>>(() => undefined),
        return: () => Promise.resolve({ done: true, value: undefined }),
      };
      const client = Client.usingTransport({ transport: {} as Transport });
      const subscription = await client.asGuest().createSubscription(create(TopicSchema), {
        kind: "event",
      });
      await expect(subscription.activate()).rejects.toThrow(message);
      expect(connect.cancel).toHaveBeenCalledTimes(1);
      await client.close();
    },
  );
});

function requireReturn(
  returns: readonly (() => Promise<IteratorResult<unknown>>)[],
  index: number,
): () => Promise<IteratorResult<unknown>> {
  const iteratorReturn = returns[index];
  if (iteratorReturn === undefined) throw new Error("iterator return is missing");
  return iteratorReturn;
}
