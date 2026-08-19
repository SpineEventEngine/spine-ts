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
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { ShardIndex } from "@spine-event-engine/server";
import {
  LiquorPickUpOutcomeSchema,
  ShardPickedUpSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  ShardInfoListSchema,
  ShardInfoSchema,
  ShardInfoUpdateSchema,
  ShardStatus,
  SubscriptionResponseSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { describe, expect, it, vi } from "vitest";
import {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryProtocolError,
  DeliveryShardObservationError,
  ShardObservationOverflowError,
  RemoteWorkRegistry,
} from "../src/index.js";
import { ShardObservationStream } from "../src/client/shard-observation.js";
import { echoPickup, transport } from "./shared-fixtures.js";

describe("DeliveryClient shard observation", () => {
  it("returns a frozen validated Admin shard snapshot through safe reads", async () => {
    const fake = transport();
    fake.fail(new Error("temporary transport failure"));
    fake.reply(
      create(ShardInfoListSchema, {
        shards: [
          create(ShardInfoSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            status: ShardStatus.PICKED,
            lastPicked: { seconds: 1n, nanos: 0 },
            messages: 2,
          }),
        ],
      }),
    );
    const client = DeliveryClient.usingTransport(fake.transport, { readRetries: 1 });

    const snapshot = await client.shardSnapshot();

    expect(snapshot).toMatchObject([{ status: "PICKED", messages: 2 }]);
    expect(snapshot[0]?.lastPicked).toEqual(new Date(1_000));
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("rejects an Admin snapshot above the requested public collection bound", async () => {
    const fake = transport();
    fake.reply(
      create(ShardInfoListSchema, {
        shards: Array.from({ length: 1_001 }, () =>
          create(ShardInfoSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            status: ShardStatus.NOT_PICKED,
            messages: 0,
          }),
        ),
      }),
    );

    await expect(
      DeliveryClient.usingTransport(fake.transport).shardSnapshot(),
    ).rejects.toBeInstanceOf(DeliveryProtocolError);
  });

  it("yields only validated Admin updates after exactly one successful ACK", async () => {
    const fake = transport();
    fake.streamReplyAndHold([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      create(SubscriptionResponseSchema, {
        value: {
          case: "update",
          value: create(ShardInfoUpdateSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            newStatus: ShardStatus.NOT_PICKED,
            whenLastPicked: { seconds: 2n, nanos: 0 },
            newMessagesCount: 3,
          }),
        },
      }),
    ]);
    const client = DeliveryClient.usingTransport(fake.transport);

    const updates = client.observeShardUpdates();
    await expect(updates[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: { status: "NOT_PICKED", messages: 3 },
    });
    updates.cancel();
    expect(fake.stream).toHaveBeenCalledWith(
      expect.objectContaining({ name: "SubscribeToShardUpdates" }),
      expect.anything(),
      undefined,
      undefined,
      expect.anything(),
    );
  });

  it("keeps an acknowledged Admin stream alive past its bounded setup interval", async () => {
    vi.useFakeTimers();
    try {
      const fake = transport();
      fake.streamReplyAndHold([
        create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      ]);
      const stream = DeliveryClient.usingTransport(fake.transport).observeShardUpdates({
        timeoutMs: 5,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(fake.streamStarted).toBe(1);
      await vi.advanceTimersByTimeAsync(6);
      expect(fake.streamAborts).toBe(0);
      stream.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers an update emitted after the bounded setup interval", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const update = create(SubscriptionResponseSchema, {
        value: {
          case: "update",
          value: create(ShardInfoUpdateSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            newStatus: ShardStatus.NOT_PICKED,
            newMessagesCount: 1,
          }),
        },
      });
      let emit!: (frame: typeof update) => void;
      const stream = new ShardObservationStream({
        signal: controller.signal,
        setupTimeoutMs: 5,
        capacity: 1,
        reconnects: 0,
        reconnectBackoffMs: 0,
        open: async function* (signal) {
          yield create(SubscriptionResponseSchema, { value: { case: "created", value: true } });
          yield await new Promise<typeof update>((resolve) => {
            emit = resolve;
          });
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          );
        },
        acknowledge: (frame) => frame.value.case === "created",
        decodeUpdate: (frame) => {
          if (frame.value.case !== "update") throw new DeliveryProtocolError();
          return { shard: ShardIndex.single(), status: "NOT_PICKED", messages: 1 };
        },
        finish: () => undefined,
        cancel: () => controller.abort(),
      });

      const next = stream[Symbol.asyncIterator]().next();
      await vi.advanceTimersByTimeAsync(6);
      emit(update);
      await expect(next).resolves.toMatchObject({ done: false, value: { messages: 1 } });
      stream.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a stream that does not acknowledge before its setup interval", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const stream = new ShardObservationStream({
        signal: controller.signal,
        setupTimeoutMs: 5,
        capacity: 1,
        reconnects: 0,
        reconnectBackoffMs: 0,
        open: async function* (signal) {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", resolve, { once: true }),
          );
        },
        acknowledge: () => true,
        decodeUpdate: () => ({ shard: ShardIndex.single(), status: "NOT_PICKED", messages: 0 }),
        finish: () => undefined,
        cancel: () => controller.abort(),
      });

      const next = stream[Symbol.asyncIterator]().next();
      const rejected = expect(next).rejects.toBeInstanceOf(DeliveryShardObservationError);
      await vi.advanceTimersByTimeAsync(5);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on a false or repeated Admin subscription ACK", async () => {
    const fake = transport();
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: false } }),
    ]);
    const falseAck = DeliveryClient.usingTransport(fake.transport).observeShardUpdates();
    await expect(falseAck[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      DeliveryProtocolError,
    );

    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    ]);
    const repeatedAck = DeliveryClient.usingTransport(fake.transport).observeShardUpdates();
    await expect(repeatedAck[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      DeliveryProtocolError,
    );
  });

  it("bounds a slow Admin observation consumer with a stable sanitized overflow error", async () => {
    const fake = transport();
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      ...[1, 2].map((messages) =>
        create(SubscriptionResponseSchema, {
          value: {
            case: "update",
            value: create(ShardInfoUpdateSchema, {
              index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
              newStatus: ShardStatus.PICKED,
              newMessagesCount: messages,
            }),
          },
        }),
      ),
    ]);
    const stream = DeliveryClient.usingTransport(fake.transport, {
      observationBufferSize: 1,
    }).observeShardUpdates();

    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      ShardObservationOverflowError,
    );
  });

  it("bounds pending observation next waiters with the same stable overflow error", async () => {
    const fake = transport();
    fake.streamReplyAndHold([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    ]);
    const stream = DeliveryClient.usingTransport(fake.transport, {
      observationBufferSize: 1,
    }).observeShardUpdates();
    const iterator = stream[Symbol.asyncIterator]();

    const first = iterator.next();
    await vi.waitFor(() => {
      expect(fake.streamStarted).toBe(1);
    });
    await expect(iterator.next()).rejects.toBeInstanceOf(ShardObservationOverflowError);
    await expect(first).rejects.toBeInstanceOf(ShardObservationOverflowError);
  });

  it("reconnects a transient Admin stream ending only through a fresh ACK", async () => {
    const fake = transport();
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    ]);
    fake.streamReplyAndHold([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      create(SubscriptionResponseSchema, {
        value: {
          case: "update",
          value: create(ShardInfoUpdateSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            newStatus: ShardStatus.PICKED,
            newMessagesCount: 1,
          }),
        },
      }),
    ]);
    const stream = DeliveryClient.usingTransport(fake.transport, {
      observationReconnects: 1,
    }).observeShardUpdates();

    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { status: "PICKED", messages: 1 },
    });
    expect(fake.stream).toHaveBeenCalledTimes(2);
    stream.cancel();
  });

  it("keeps public Admin observation reconnect configured for direct clients", async () => {
    const fake = transport();
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    ]);
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      create(SubscriptionResponseSchema, {
        value: {
          case: "update",
          value: create(ShardInfoUpdateSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            newStatus: ShardStatus.NOT_PICKED,
            newMessagesCount: 1,
          }),
        },
      }),
    ]);
    const client = DeliveryClient.usingTransport(fake.transport, { observationReconnects: 2 });

    await expect(
      client.observeShardUpdates()[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({
      value: { status: "NOT_PICKED", messages: 1 },
    });
    expect(fake.stream).toHaveBeenCalledTimes(3);
    client.close();
  });

  it.each(["cancel", "return", "close"] as const)(
    "%s terminates one active Admin producer, settles iteration, and prevents reconnect",
    async (termination) => {
      const fake = transport();
      fake.streamReplyAndHold([
        create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
        create(SubscriptionResponseSchema, {
          value: {
            case: "update",
            value: create(ShardInfoUpdateSchema, {
              index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
              newStatus: ShardStatus.PICKED,
              newMessagesCount: 1,
            }),
          },
        }),
      ]);
      const client = DeliveryClient.usingTransport(fake.transport, {
        observationReconnects: 1,
        observationReconnectBackoffMs: 10,
      });
      const updates = client.observeShardUpdates();
      const iterator = updates[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({ done: false });
      const pending = iterator.next();
      await vi.waitFor(() => {
        expect(fake.streamStarted).toBe(1);
      });

      if (termination === "cancel") updates.cancel();
      else if (termination === "return") await iterator.return?.();
      else client.close();

      await expect(pending).resolves.toEqual({ done: true, value: undefined });
      await vi.waitFor(() => {
        expect(fake.streamAborts).toBe(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fake.stream).toHaveBeenCalledTimes(1);
      expect(fake.streamFinished).toBe(1);
      expect(fake.streamAborts).toBe(1);
    },
  );

  it("keeps cancellation idempotent and subsequent iterator reads completed", async () => {
    const fake = transport();
    fake.streamReplyAndHold([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    ]);
    const stream = DeliveryClient.usingTransport(fake.transport).observeShardUpdates();
    const iterator = stream[Symbol.asyncIterator]();
    await vi.waitFor(() => {
      expect(fake.streamStarted).toBe(1);
    });

    stream.cancel();
    stream.cancel();

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("stops an acknowledged Admin stream when its caller cancels", async () => {
    const fake = transport();
    const caller = new AbortController();
    fake.streamReplyAndHold([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    ]);
    const stream = DeliveryClient.usingTransport(fake.transport).observeShardUpdates({
      signal: caller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();

    await vi.waitFor(() => {
      expect(fake.streamStarted).toBe(1);
    });
    caller.abort(new Error("caller stopped observation"));

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await vi.waitFor(() => {
      expect(fake.streamAborts).toBe(1);
    });
  });

  it("delivers an update buffered before the consumer asks for it", async () => {
    const controller = new AbortController();
    let processed!: () => void;
    const updateProcessed = new Promise<void>((resolve) => {
      processed = resolve;
    });
    const created = create(SubscriptionResponseSchema, {
      value: { case: "created", value: true },
    });
    const update = create(SubscriptionResponseSchema, {
      value: { case: "update", value: create(ShardInfoUpdateSchema) },
    });
    const observation = Object.freeze({
      shard: ShardIndex.single(),
      status: "PICKED" as const,
      messages: 4,
    });
    const stream = new ShardObservationStream({
      signal: controller.signal,
      setupTimeoutMs: 1,
      capacity: 1,
      reconnects: 0,
      reconnectBackoffMs: 0,
      open: async function* () {
        yield created;
        yield update;
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
      },
      acknowledge: (frame) => frame.value.case === "created",
      decodeUpdate: () => {
        processed();
        return observation;
      },
      finish: () => undefined,
      cancel: () => {
        controller.abort();
      },
    });

    await updateProcessed;

    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      done: false,
      value: observation,
    });
    stream.cancel();
  });

  it("reports a stream that exhausts its configured reconnects", async () => {
    const fake = transport();
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    ]);
    const stream = DeliveryClient.usingTransport(fake.transport, {
      observationReconnects: 0,
    }).observeShardUpdates();

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
      DeliveryShardObservationError,
    );
  });

  it("resumes observation after a positive reconnect backoff", async () => {
    vi.useFakeTimers();
    try {
      const fake = transport();
      fake.streamReply([
        create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      ]);
      fake.streamReplyAndHold([
        create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
        create(SubscriptionResponseSchema, {
          value: {
            case: "update",
            value: create(ShardInfoUpdateSchema, {
              index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
              newStatus: ShardStatus.NOT_PICKED,
              newMessagesCount: 2,
            }),
          },
        }),
      ]);
      const stream = DeliveryClient.usingTransport(fake.transport, {
        observationReconnects: 1,
        observationReconnectBackoffMs: 100,
      }).observeShardUpdates();
      const pending = stream[Symbol.asyncIterator]().next();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      await expect(pending).resolves.toMatchObject({
        done: false,
        value: { status: "NOT_PICKED", messages: 2 },
      });
      stream.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not open an Admin stream for a pre-aborted caller signal", () => {
    const fake = transport();
    const aborted = new AbortController();
    aborted.abort(new Error("caller diagnostic must not reach transport"));

    expect(() =>
      DeliveryClient.usingTransport(fake.transport).observeShardUpdates({ signal: aborted.signal }),
    ).toThrow("caller diagnostic must not reach transport");
    expect(fake.stream).not.toHaveBeenCalled();
  });

  it("rejects malformed Admin observations and malformed shard-session replies as protocol errors", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const worker = { nodeId: "node", value: "worker" };
    for (const shard of [
      create(ShardInfoSchema, { messages: 1 }),
      create(ShardInfoSchema, {
        index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        messages: -1,
      }),
      create(ShardInfoSchema, {
        index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        messages: 1,
        lastPicked: { seconds: 1n, nanos: -1 },
      }),
    ]) {
      fake.reply(create(ShardInfoListSchema, { shards: [shard] }));
      await expect(client.shardSnapshot()).rejects.toBeInstanceOf(DeliveryProtocolError);
    }
    fake.reply(
      create(LiquorPickUpOutcomeSchema, {
        value: { case: "pickedUp", value: create(ShardPickedUpSchema) },
      }),
    );
    await expect(client.pickUp(ShardIndex.single(), worker)).rejects.toBeInstanceOf(
      DeliveryProtocolError,
    );
    fake.reply(
      create(LiquorPickUpOutcomeSchema, {
        value: {
          case: "pickedUp",
          value: create(ShardPickedUpSchema, {
            shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            worker: create(WorkerIdSchema, { nodeId: { value: "wrong" }, value: "worker" }),
            whenPicked: { seconds: 1n, nanos: 0 },
          }),
        },
      }),
    );
    await expect(client.pickUp(ShardIndex.single(), worker)).rejects.toBeInstanceOf(
      DeliveryProtocolError,
    );
  });

  it("cancels an Admin reconnect backoff without opening another observation stream", async () => {
    vi.useFakeTimers();
    try {
      const fake = transport();
      fake.streamReply([
        create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      ]);
      const stream = DeliveryClient.usingTransport(fake.transport, {
        observationReconnects: 1,
        observationReconnectBackoffMs: 100,
      }).observeShardUpdates();
      const iterator = stream[Symbol.asyncIterator]();
      const pending = iterator.next();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      stream.cancel();
      await expect(pending).resolves.toEqual({ done: true, value: undefined });
      expect(vi.getTimerCount()).toBe(0);
      expect(fake.stream).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains no local release marker after an unknown outcome", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();
    await expect(registry.release({ kind: "EXCLUSIVE", shard })).resolves.toBe(false);
    echoPickup(fake);
    const session = await registry.pickUp(
      shard,
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker-1" }),
    );
    if (session === undefined) throw new Error("Remote session was not acquired.");
    fake.fail(new Error("release response lost"));
    await expect(registry.release(session)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(registry.release(session)).resolves.toBe(false);
    registry.reconcile(
      Object.freeze({ shard, status: "PICKED" as const, messages: 0, lastPicked: new Date(1_000) }),
    );
    await expect(registry.release(session)).resolves.toBe(false);
    registry.reconcile(Object.freeze({ shard, status: "NOT_PICKED" as const, messages: 0 }));
    await expect(registry.release(session)).resolves.toBe(false);
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("invalidates a remote session before its release awaits so concurrent callers cannot release twice", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    const registry = new RemoteWorkRegistry(client);
    const shard = ShardIndex.single();
    echoPickup(fake);
    const session = await registry.pickUp(
      shard,
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker-1" }),
    );
    if (session === undefined) throw new Error("Remote session was not acquired.");
    let release: (() => void) | undefined;
    const pendingRelease = new Promise((resolve) => {
      release = () => {
        resolve(create(EmptySchema));
      };
    });
    fake.unary.mockReturnValueOnce(pendingRelease);

    const first = registry.release(session);
    await expect(registry.release(session)).resolves.toBe(false);
    release?.();
    await expect(first).resolves.toBe(true);
    expect(fake.unary).toHaveBeenCalledTimes(2);
  });

  it("rejects closed observations and malformed release snapshots before contacting the server", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    client.close();

    expect(() => client.observeShardUpdates()).toThrow("Delivery client is closed.");
    await expect(
      client.release({
        kind: "EXCLUSIVE",
        shard: ShardIndex.single(),
        worker: { nodeId: "node", value: "worker" },
        whenPicked: new Date("invalid"),
      }),
    ).rejects.toThrow("Delivery shard session is invalid.");
    expect(fake.unary).not.toHaveBeenCalled();
  });

  it("preserves absent optional shard timestamps in Admin snapshots and updates", async () => {
    const fake = transport();
    fake.reply(
      create(ShardInfoListSchema, {
        shards: [
          create(ShardInfoSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            status: ShardStatus.NOT_PICKED,
            messages: 0,
          }),
        ],
      }),
    );
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      create(SubscriptionResponseSchema, {
        value: {
          case: "update",
          value: create(ShardInfoUpdateSchema, {
            index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
            newStatus: ShardStatus.NOT_PICKED,
            newMessagesCount: 0,
          }),
        },
      }),
    ]);
    const client = DeliveryClient.usingTransport(fake.transport);

    await expect(client.shardSnapshot()).resolves.toEqual([
      expect.objectContaining({ status: "NOT_PICKED", messages: 0 }),
    ]);
    const stream = client.observeShardUpdates();
    const update = await stream[Symbol.asyncIterator]().next();
    expect(update.done).toBe(false);
    if (update.done) throw new Error("Expected an Admin shard update.");
    expect(update.value).toMatchObject({ status: "NOT_PICKED", messages: 0 });
    stream.cancel();
  });

  it("fails closed on unknown Admin update values and unrepresentable observation timestamps", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport);
    for (const shard of [
      create(ShardInfoSchema, {
        index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        status: 0 as ShardStatus,
        messages: 0,
      }),
      create(ShardInfoSchema, {
        index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        status: ShardStatus.PICKED,
        lastPicked: { seconds: BigInt(Number.MAX_SAFE_INTEGER), nanos: 0 },
        messages: 0,
      }),
    ]) {
      fake.reply(create(ShardInfoListSchema, { shards: [shard] }));
      await expect(client.shardSnapshot()).rejects.toBeInstanceOf(DeliveryProtocolError);
    }
    fake.streamReply([
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
      create(SubscriptionResponseSchema, {
        value: { case: "update", value: create(ShardInfoUpdateSchema) },
      }),
    ]);
    await expect(
      client.observeShardUpdates()[Symbol.asyncIterator]().next(),
    ).rejects.toBeInstanceOf(DeliveryProtocolError);
  });
});
