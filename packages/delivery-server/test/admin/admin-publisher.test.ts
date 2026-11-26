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
import { Code } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { ShardIndexSchema } from "@spine-event-engine/proto/delivery";

import { AdminPublisher } from "../../src/admin/admin-service.js";
import { InMemoryDeliveryState } from "../../src/core/in-memory-delivery-state.js";
import { domainMessage } from "../core/domain-message.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });

describe("Admin publisher", () => {
  it("publishes one complete state per shard and suppresses repeated identical states", async () => {
    const state = new InMemoryDeliveryState();
    const publisher = AdminPublisher.create(state);
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({
      value: { value: { case: "created", value: true } },
    });
    const update = stream.next();
    await Promise.resolve();
    state.putAll([{ message: domainMessage("first", shard) }]);
    publisher.publish(shard);
    await expect(update).resolves.toMatchObject({
      value: { value: { case: "update", value: { index: shard, newMessagesCount: 1 } } },
    });
    publisher.publish(shard);
    const next = stream.next();
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    state.putAll([{ message: domainMessage("other", other) }]);
    publisher.publish(other);
    await expect(next).resolves.toMatchObject({
      value: { value: { case: "update", value: { index: other } } },
    });
    await requireReturn(stream)(undefined);
  });

  it("does not register or acknowledge a call aborted before subscription starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), { signal: controller.signal } as never)
      [Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
    expect(publisher.subscriberCount).toBe(0);
    publisher.close();
  });

  it("completes a waiting stream during publisher shutdown", async () => {
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await stream.next();
    const waiting = stream.next();
    publisher.close();
    await expect(waiting).resolves.toMatchObject({ done: true });
  });

  it("keeps close terminal for later idle and pending subscribers", async () => {
    for (const seeded of [false, true]) {
      const state = new InMemoryDeliveryState();
      if (seeded) {
        const row = domainMessage("pending", shard);
        state.putAll([{ message: row }]);
      }
      const publisher = AdminPublisher.create(state);
      publisher.close();
      const stream = publisher.service
        .subscribeToShardUpdates(create(EmptySchema), context)
        [Symbol.asyncIterator]();
      await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
      publisher.publish(shard);
      expect(publisher.subscriberCount).toBe(0);
    }
  });

  it("detaches a paused subscriber's abort listener when the publisher closes", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), { signal: controller.signal } as never)
      [Symbol.asyncIterator]();
    await stream.next();
    expect(publisher.subscriberCount).toBe(1);
    publisher.close();
    expect(publisher.subscriberCount).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("retires a final empty state after equivalent changes during cooldown", async () => {
    vi.useFakeTimers();
    const state = new InMemoryDeliveryState();
    const publisher = AdminPublisher.create(state);
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await stream.next();
    const initial = domainMessage("initial", shard);
    state.putAll([{ message: initial }]);
    publisher.publish(shard);
    await expect(stream.next()).resolves.toMatchObject({
      value: { value: { case: "update", value: { newMessagesCount: 1 } } },
    });
    state.delete(initial);
    publisher.publish(shard);
    const row = domainMessage("churn", shard);
    state.putAll([{ message: row }]);
    publisher.publish(shard);
    state.delete(row);
    publisher.publish(shard);
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(25);
    expect(vi.getTimerCount()).toBe(0);
    await expect(stream.next()).resolves.toMatchObject({
      value: { value: { case: "update", value: { newMessagesCount: 0 } } },
    });
    publisher.publish(shard);
    const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    state.putAll([{ message: domainMessage("other-after-empty", other) }]);
    publisher.publish(other);
    await expect(stream.next()).resolves.toMatchObject({
      value: { value: { case: "update", value: { index: other } } },
    });
    await stream.return?.();
    publisher.close();
    vi.useRealTimers();
  });

  it("keeps the latest state for a dashboard that pauses across several updates", async () => {
    vi.useFakeTimers();
    const state = new InMemoryDeliveryState();
    const publisher = AdminPublisher.create(state);
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    try {
      await stream.next();
      for (const id of ["one", "two", "three"]) {
        state.putAll([{ message: domainMessage(id, shard) }]);
        publisher.publish(shard);
        await vi.advanceTimersByTimeAsync(25);
      }
      await expect(stream.next()).resolves.toMatchObject({
        value: { value: { value: { newMessagesCount: 3 } } },
      });
    } finally {
      await stream.return?.();
      publisher.close();
      vi.useRealTimers();
    }
  });

  it("suppresses unread changes that return to a shard state the dashboard already received", async () => {
    vi.useFakeTimers();
    const state = new InMemoryDeliveryState();
    const publisher = AdminPublisher.create(state);
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    try {
      await stream.next();
      const first = domainMessage("first", shard);
      const second = domainMessage("second", shard);
      state.putAll([{ message: first }]);
      publisher.publish(shard);
      await stream.next();
      await vi.advanceTimersByTimeAsync(25);
      state.putAll([{ message: second }]);
      publisher.publish(shard);
      await vi.advanceTimersByTimeAsync(25);
      state.delete(second);
      publisher.publish(shard);
      const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
      state.putAll([{ message: domainMessage("other-unread", other) }]);
      publisher.publish(other);
      await expect(stream.next()).resolves.toMatchObject({
        value: { value: { value: { index: other } } },
      });
    } finally {
      await stream.return?.();
      publisher.close();
      vi.useRealTimers();
    }
  });

  it("delivers more than 100 queued shard updates in publication order", async () => {
    const state = new InMemoryDeliveryState();
    const publisher = AdminPublisher.create(state);
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await stream.next();
    const delivered = stream.next();
    await Promise.resolve();
    for (let index = 0; index < 102; index++) {
      const current = create(ShardIndexSchema, { index, ofTotal: 102 });
      state.putAll([{ message: domainMessage(`queued-${String(index)}`, current) }]);
      publisher.publish(current);
    }
    await expect(delivered).resolves.toMatchObject({
      value: { value: { case: "update", value: { index: { index: 0 } } } },
    });
    for (let index = 1; index < 102; index++) {
      await expect(stream.next()).resolves.toMatchObject({
        value: { value: { case: "update", value: { index: { index } } } },
      });
    }
    expect(publisher.subscriberCount).toBe(1);
    await stream.return?.();
    expect(publisher.subscriberCount).toBe(0);
  });

  it("reads exact stored counts without scanning canonical messages", () => {
    const state = new InMemoryDeliveryState();
    const publisher = AdminPublisher.create(state);
    const one = domainMessage("one", shard);
    state.putAll([{ message: one }]);
    const values = vi.spyOn(state.messages, "values").mockImplementation(() => {
      throw new Error("global Inbox scan");
    });
    expect(publisher.service.getShardInfo(create(EmptySchema), context)).toMatchObject({
      shards: [{ index: shard, status: 2, messages: 1 }],
    });
    values.mockRestore();
  });

  it("removes an iterator returned by its caller", async () => {
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await stream.next();
    await requireReturn(stream)(undefined);
    publisher.publish(shard);
    await expect(stream.next()).resolves.toMatchObject({ done: true });
  });

  it("unregisters and clears a waiting subscriber on caller cancellation", async () => {
    const controller = new AbortController();
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), { signal: controller.signal } as never)
      [Symbol.asyncIterator]();
    await stream.next();
    const waiting = stream.next();
    await Promise.resolve();
    expect(publisher.subscriberCount).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: Code.Canceled });
    expect(publisher.subscriberCount).toBe(0);
  });
});

function requireReturn<T>(iterator: AsyncIterator<T>): NonNullable<AsyncIterator<T>["return"]> {
  if (iterator.return === undefined) throw new TypeError("Admin stream cannot be returned.");
  return iterator.return.bind(iterator);
}
