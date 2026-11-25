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
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PickUpShardSchema,
  ReleaseShardSchema,
  RemoveMessageSchema,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import { DeliveryAssembly } from "../../src/server/assembly.js";
import { DeliveryConfig } from "../../src/server/config.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 2, ofTotal: 4 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });

afterEach(() => vi.useRealTimers());

describe("ShardObservingService", () => {
  it("accepts a safe interval longer than one Node timer slot", () => {
    expect(DeliveryConfig.resolve({ workReminderSeconds: 3_000_000 }).reminderIntervalMs).toBe(
      3_000_000_000,
    );
  });

  it("waits through timer slots before a large configured reminder", async () => {
    vi.useFakeTimers();
    const assembly = DeliveryAssembly.create({ reminderIntervalMs: 2_147_484_000 });
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: message("one") }), context);
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { shard } });
    const reminder = stream.next();
    let settled = false;
    void reminder.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(353);
    await expect(reminder).resolves.toMatchObject({ value: { shard } });
    await stream.return?.();
    assembly.closeObserving();
  });

  it("discovers existing free work and reminds at the original interval despite further writes", async () => {
    vi.useFakeTimers();
    const assembly = DeliveryAssembly.create({ reminderIntervalMs: 10_000 });
    await assembly.inbox.writeOne({ message: message("one") }, context);
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { shard } });
    await vi.advanceTimersByTimeAsync(3_000);
    await assembly.inbox.writeOne({ message: message("two") }, context);
    await expect(stream.next()).resolves.toMatchObject({ value: { shard } });
    await vi.advanceTimersByTimeAsync(6_999);
    const reminder = stream.next();
    await vi.advanceTimersByTimeAsync(1);
    await expect(reminder).resolves.toMatchObject({ value: { shard } });
    await stream.return?.();
    assembly.closeObserving();
  });

  it("stays silent while held, then reports pending work on release", async () => {
    const assembly = DeliveryAssembly.create();
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: message("one") }), context);
    await assembly.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context);
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    const next = stream.next();
    await assembly.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await expect(next).resolves.toMatchObject({ value: { shard } });
    await stream.return?.();
    assembly.closeObserving();
  });

  it("stops reminders on pickup and final pending removal, then reports new availability", async () => {
    vi.useFakeTimers();
    const assembly = DeliveryAssembly.create({ reminderIntervalMs: 10_000 });
    const first = message("one");
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: first }), context);
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { shard } });
    await assembly.shards.pickShard(create(PickUpShardSchema, { shard, worker }), context);
    const afterPickup = stream.next();
    let settled = false;
    void afterPickup.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    await assembly.shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await expect(afterPickup).resolves.toMatchObject({ value: { shard } });
    await assembly.inbox.removeOne(create(RemoveMessageSchema, { message: first }), context);
    const afterRemoval = stream.next();
    settled = false;
    void afterRemoval.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: message("two") }), context);
    await expect(afterRemoval).resolves.toMatchObject({ value: { shard } });
    await stream.return?.();
    assembly.closeObserving();
  });

  it("discovers a never-picked pending shard for each new subscriber", async () => {
    const assembly = DeliveryAssembly.create();
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: message("one") }), context);
    const first = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(first.next()).resolves.toMatchObject({ value: { shard } });
    const second = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(second.next()).resolves.toMatchObject({ value: { shard } });
    await first.return?.();
    await second.return?.();
    assembly.closeObserving();
  });

  it("does not discover completed-only shards or repeat work after pending removal", async () => {
    vi.useFakeTimers();
    const assembly = DeliveryAssembly.create({ reminderIntervalMs: 10_000 });
    const pending = message("one");
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: pending }), context);
    await assembly.inbox.writeOne(
      create(WriteMessageSchema, {
        message: { ...pending, status: InboxMessageStatus.DELIVERED },
      }),
      context,
    );
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    const next = stream.next();
    await vi.advanceTimersByTimeAsync(20_000);
    let settled = false;
    void next.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: message("two") }), context);
    await expect(next).resolves.toMatchObject({ value: { shard } });
    await assembly.inbox.removeOne(
      create(RemoveMessageSchema, { message: message("two") }),
      context,
    );
    await stream.return?.();
    assembly.closeObserving();
  });
});

function message(uuid: string) {
  return create(InboxMessageSchema, {
    id: { uuid, index: shard },
    signalId: { value: "signal" },
    inboxId: { entityId: { id: { typeUrl: "example.Entity" } }, typeUrl: "example.State" },
    payload: { case: "command", value: {} },
    label: 1,
    whenReceived: { seconds: 0n, nanos: 0 },
    status: InboxMessageStatus.TO_DELIVER,
  });
}
