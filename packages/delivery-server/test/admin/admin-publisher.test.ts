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
import { describe, expect, it } from "vitest";

import { ShardIndexSchema } from "@spine-event-engine/proto/delivery";

import { AdminPublisher } from "../../src/admin/admin-service.js";
import { InMemoryDeliveryState } from "../../src/core/in-memory-delivery-state.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });

describe("Admin publisher", () => {
  it("drops changes before the acknowledgement and publishes complete later observations", async () => {
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({
      value: { value: { case: "created", value: true } },
    });
    const update = stream.next();
    await Promise.resolve();
    publisher.publish(shard);
    await expect(update).resolves.toMatchObject({
      value: { value: { case: "update", value: { index: shard, newMessagesCount: 0 } } },
    });
    publisher.publish(shard);
    await expect(stream.next()).resolves.toMatchObject({
      value: { value: { case: "update", value: { index: shard } } },
    });
    await requireReturn(stream)(undefined);
  });

  it("completes immediately after acknowledging an already aborted caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), { signal: controller.signal } as never)
      [Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({
      value: { value: { case: "created", value: true } },
    });
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
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

  it("rejects the 101st pending update with the stable resource error", async () => {
    const publisher = AdminPublisher.create(new InMemoryDeliveryState());
    const stream = publisher.service
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await stream.next();
    const delivered = stream.next();
    await Promise.resolve();
    for (let index = 0; index < 102; index++) publisher.publish(shard);
    await expect(delivered).resolves.toMatchObject({ done: false });
    await expect(stream.next()).rejects.toMatchObject({
      code: Code.ResourceExhausted,
      rawMessage: "Delivery shard update buffer is full.",
    });
    expect(publisher.subscriberCount).toBe(0);
    publisher.publish(shard);
    expect(publisher.subscriberCount).toBe(0);
  });

  it("maintains exact message counts without scanning canonical messages", () => {
    const state = new InMemoryDeliveryState();
    const publisher = AdminPublisher.create(state);
    publisher.recordMessageTransition(shard, 1);
    publisher.recordMessageTransition(shard, 1);
    publisher.recordMessageTransition(shard, -1);
    expect(publisher.service.getShardInfo(create(EmptySchema), context)).toMatchObject({
      shards: [{ index: shard, status: 2, messages: 1 }],
    });
    const invalid = AdminPublisher.create(new InMemoryDeliveryState());
    expect(() => {
      invalid.recordMessageTransition(shard, -1);
    }).toThrow("Delivery shard message count is invalid.");
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
