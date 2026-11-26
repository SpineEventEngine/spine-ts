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
import { afterEach, expect, it, vi } from "vitest";
import { RemoveMessageSchema, WriteMessageSchema } from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, InboxMessageStatus } from "@spine-event-engine/proto/delivery";
import { DeliveryAssembly } from "../../src/server/assembly.js";
import { AdminPublisher } from "../../src/admin/admin-service.js";
import { InMemoryDeliveryState } from "../../src/core/in-memory-delivery-state.js";
import { domainMessage, encodedBytes } from "../core/domain-message.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
const other = create(ShardIndexSchema, { index: 1, ofTotal: 2 });

afterEach(() => vi.useRealTimers());

it("reports stored completions and replays known shards after the ACK", async () => {
  const assembly = DeliveryAssembly.create();
  const completed = domainMessage("done", shard, 0, 1, InboxMessageStatus.DELIVERED);
  await assembly.inbox.writeOne(create(WriteMessageSchema, { message: completed }), context);
  expect(assembly.admin.getShardInfo(create(EmptySchema), context)).toMatchObject({
    shards: [{ index: shard, messages: 1 }],
  });
  const stream = assembly.admin
    .subscribeToShardUpdates(create(EmptySchema), context)
    [Symbol.asyncIterator]();
  await expect(stream.next()).resolves.toMatchObject({ value: { value: { case: "created" } } });
  await expect(stream.next()).resolves.toMatchObject({
    value: { value: { case: "update", value: { index: shard, newMessagesCount: 1 } } },
  });
  await stream.return?.();
  assembly.closeAdmin();
});

it("coalesces repeated changes independently by shard and sends final free empty state", async () => {
  vi.useFakeTimers();
  const assembly = DeliveryAssembly.create();
  const stream = assembly.admin
    .subscribeToShardUpdates(create(EmptySchema), context)
    [Symbol.asyncIterator]();
  await stream.next();
  const first = domainMessage("first", shard);
  const second = domainMessage("second", shard);
  const otherRow = domainMessage("other", other);
  await assembly.inbox.writeOne(create(WriteMessageSchema, { message: first }), context);
  await expect(stream.next()).resolves.toMatchObject({
    value: { value: { case: "update", value: { index: shard, newMessagesCount: 1 } } },
  });
  await assembly.inbox.writeOne(create(WriteMessageSchema, { message: second }), context);
  await assembly.inbox.writeOne(create(WriteMessageSchema, { message: otherRow }), context);
  await expect(stream.next()).resolves.toMatchObject({
    value: { value: { case: "update", value: { index: other, newMessagesCount: 1 } } },
  });
  const delayed = stream.next();
  await vi.advanceTimersByTimeAsync(25);
  await expect(delayed).resolves.toMatchObject({
    value: { value: { case: "update", value: { index: shard, newMessagesCount: 2 } } },
  });
  await assembly.inbox.removeOne(create(RemoveMessageSchema, { message: first }), context);
  await assembly.inbox.removeOne(create(RemoveMessageSchema, { message: second }), context);
  const empty = stream.next();
  await vi.advanceTimersByTimeAsync(25);
  await expect(empty).resolves.toMatchObject({
    value: { value: { case: "update", value: { index: shard, newMessagesCount: 0 } } },
  });
  await stream.return?.();
  assembly.closeAdmin();
});

it("keeps the 25 ms window independent for two subscribers that connect at different times", async () => {
  vi.useFakeTimers();
  const assembly = DeliveryAssembly.create();
  const first = assembly.admin
    .subscribeToShardUpdates(create(EmptySchema), context)
    [Symbol.asyncIterator]();
  await first.next();
  await assembly.inbox.writeOne(
    create(WriteMessageSchema, { message: domainMessage("one", shard) }),
    context,
  );
  await expect(first.next()).resolves.toMatchObject({
    value: { value: { case: "update", value: { newMessagesCount: 1 } } },
  });
  await vi.advanceTimersByTimeAsync(10);
  const second = assembly.admin
    .subscribeToShardUpdates(create(EmptySchema), context)
    [Symbol.asyncIterator]();
  await second.next();
  await expect(second.next()).resolves.toMatchObject({
    value: { value: { case: "update", value: { newMessagesCount: 1 } } },
  });
  await assembly.inbox.writeOne(
    create(WriteMessageSchema, { message: domainMessage("two", shard) }),
    context,
  );
  const firstUpdate = first.next();
  const secondUpdate = second.next();
  await vi.advanceTimersByTimeAsync(15);
  await expect(firstUpdate).resolves.toMatchObject({
    value: { value: { case: "update", value: { newMessagesCount: 2 } } },
  });
  let secondSettled = false;
  void secondUpdate.then(() => {
    secondSettled = true;
  });
  await Promise.resolve();
  expect(secondSettled).toBe(false);
  await vi.advanceTimersByTimeAsync(10);
  await expect(secondUpdate).resolves.toMatchObject({
    value: { value: { case: "update", value: { newMessagesCount: 2 } } },
  });
  await first.return?.();
  await second.return?.();
  assembly.closeAdmin();
});

it("reports the exact stored total after concurrent writes, rewrites, and repeated removals", async () => {
  const assembly = DeliveryAssembly.create();
  const one = domainMessage("one", shard);
  const two = domainMessage("two", shard);
  await Promise.all([
    assembly.inbox.writeOne(create(WriteMessageSchema, { message: one }), context),
    assembly.inbox.writeOne(create(WriteMessageSchema, { message: two }), context),
  ]);
  await assembly.inbox.writeOne(
    create(WriteMessageSchema, {
      message: domainMessage("one", shard, 1, 1, InboxMessageStatus.DELIVERED),
    }),
    context,
  );
  expect(assembly.admin.getShardInfo(create(EmptySchema), context)).toMatchObject({
    shards: [{ index: shard, messages: 2 }],
  });
  await Promise.all([
    assembly.inbox.removeOne(create(RemoveMessageSchema, { message: one }), context),
    assembly.inbox.removeOne(create(RemoveMessageSchema, { message: one }), context),
  ]);
  expect(assembly.admin.getShardInfo(create(EmptySchema), context)).toMatchObject({
    shards: [{ index: shard, messages: 1 }],
  });
  assembly.closeAdmin();
});

it("replays more than 100 known shards without consuming the bounded live buffer", async () => {
  const state = new InMemoryDeliveryState();
  for (let index = 0; index < 150; index++) {
    const at = create(ShardIndexSchema, { index, ofTotal: 151 });
    const row = domainMessage(`row-${String(index)}`, at);
    state.putAll([{ message: row, bytes: encodedBytes(row) }]);
  }
  const publisher = AdminPublisher.create(state);
  const stream = publisher.service
    .subscribeToShardUpdates(create(EmptySchema), context)
    [Symbol.asyncIterator]();
  await expect(stream.next()).resolves.toMatchObject({ value: { value: { case: "created" } } });
  const late = create(ShardIndexSchema, { index: 149, ofTotal: 151 });
  const newRow = domainMessage("late", late);
  state.putAll([{ message: newRow, bytes: encodedBytes(newRow) }]);
  publisher.publish(late);
  const live = create(ShardIndexSchema, { index: 150, ofTotal: 151 });
  const liveRow = domainMessage("live", live);
  state.putAll([{ message: liveRow, bytes: encodedBytes(liveRow) }]);
  publisher.publish(live);
  for (let index = 0; index < 150; index++) {
    const result = await stream.next();
    expect(result).toMatchObject({
      value: {
        value: {
          case: "update",
          value: { index: { index, ofTotal: 151 }, newMessagesCount: index === 149 ? 2 : 1 },
        },
      },
    });
  }
  await expect(stream.next()).resolves.toMatchObject({
    value: { value: { case: "update", value: { index: live, newMessagesCount: 1 } } },
  });
  await stream.return?.();
  publisher.close();
});

it("includes more than 1,000 known shards in a complete snapshot", async () => {
  const state = new InMemoryDeliveryState();
  const rows = Array.from({ length: 1_201 }, (_, index) => {
    const at = create(ShardIndexSchema, { index, ofTotal: 1_201 });
    const message = domainMessage(`snapshot-${String(index)}`, at);
    return { message, bytes: encodedBytes(message) };
  });
  state.putAll(rows);
  const publisher = AdminPublisher.create(state);
  const snapshot = await publisher.service.getShardInfo(create(EmptySchema), context);
  expect(snapshot.shards).toHaveLength(1_201);
  expect(snapshot.shards?.at(-1)?.index?.index).toBe(1_200);
  publisher.close();
});
