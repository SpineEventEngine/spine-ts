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
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { CommandIdSchema, CommandSchema } from "@spine-event-engine/proto";
import { CreateTaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";
import {
  DeliveryShardPickupSchema,
  RemoveMessageSchema,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageSchema,
  InboxMessageStatus,
  InboxLabel,
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
  it("reoffers pending work when a quiet held session expires on its own", async () => {
    vi.useFakeTimers();
    const assembly = DeliveryAssembly.create({ processingTimeoutMs: 50 });
    await assembly.inbox.writeOne({ message: message("expires") }, context);
    const picked = await assembly.managed.pickShardForDelivery(
      create(DeliveryShardPickupSchema, { shard, worker }),
      context,
    );
    expect(picked.result.case).toBe("pickedUp");
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    const next = stream.next();
    await vi.advanceTimersByTimeAsync(51);
    await expect(next).resolves.toMatchObject({ value: { shard } });
    await stream.return?.();
    assembly.closeSessions();
    assembly.closeObserving();
  });

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
    const pickup = await assembly.managed.pickShardRaw(
      create(DeliveryShardPickupSchema, { shard, worker }),
      context,
    );
    if (pickup.result.case !== "pickedUp") throw new Error("Expected a session.");
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    const next = stream.next();
    await assembly.managed.releaseShardSession(pickup.result.value, context);
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
    const pickup = await assembly.managed.pickShardRaw(
      create(DeliveryShardPickupSchema, { shard, worker }),
      context,
    );
    if (pickup.result.case !== "pickedUp") throw new Error("Expected a session.");
    const afterPickup = stream.next();
    let settled = false;
    void afterPickup.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);
    await assembly.managed.releaseShardSession(pickup.result.value, context);
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

  it("drops queued shards that become busy or empty while the reader is paused", async () => {
    const assembly = DeliveryAssembly.create();
    const busy = create(ShardIndexSchema, { index: 0, ofTotal: 4 });
    const removed = create(ShardIndexSchema, { index: 1, ofTotal: 4 });
    const valid = create(ShardIndexSchema, { index: 3, ofTotal: 4 });
    await assembly.inbox.writeOne({ message: message("initial") }, context);
    const stream = assembly.observing
      .observeAll(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { shard } });
    await assembly.inbox.writeOne({ message: message("busy", busy) }, context);
    await assembly.inbox.writeOne({ message: message("removed", removed) }, context);
    await assembly.managed.pickShardRaw(
      create(DeliveryShardPickupSchema, { shard: busy, worker }),
      context,
    );
    await assembly.inbox.removeOne({ message: message("removed", removed) }, context);
    await assembly.inbox.writeOne({ message: message("valid", valid) }, context);
    await expect(stream.next()).resolves.toMatchObject({ value: { shard: valid } });
    await stream.return?.();
    assembly.closeObserving();
  });

  it("finishes immediately when closed before subscription or called with an aborted signal", async () => {
    const assembly = DeliveryAssembly.create();
    await assembly.inbox.writeOne({ message: message("pending") }, context);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      assembly.observing
        .observeAll(create(EmptySchema), { signal: aborted.signal } as never)
        [Symbol.asyncIterator]()
        .next(),
    ).resolves.toMatchObject({ done: true });
    assembly.closeObserving();
    await expect(
      assembly.observing.observeAll(create(EmptySchema), context)[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({ done: true });
    const empty = DeliveryAssembly.create();
    empty.closeObserving();
    await expect(
      empty.observing.observeAll(create(EmptySchema), context)[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({ done: true });
  });

  it("detaches an active subscriber's abort listener on shutdown while its reader is paused", async () => {
    const assembly = DeliveryAssembly.create();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await assembly.inbox.writeOne({ message: message("pending") }, context);
    const stream = assembly.observing
      .observeAll(create(EmptySchema), { signal: controller.signal } as never)
      [Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { shard } });
    assembly.closeObserving();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    await expect(stream.next()).resolves.toMatchObject({ done: true });
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

function message(uuid: string, index = shard) {
  const taskId = create(TaskIdSchema, { value: `task-${uuid}` });
  const command = create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: `command-${uuid}` }),
    message: AnyPacker.pack(
      CreateTaskSchema,
      create(CreateTaskSchema, {
        id: taskId,
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
        title: "Observe delivery",
      }),
    ),
  });
  return create(InboxMessageSchema, {
    id: { uuid, index },
    signalId: { value: "signal" },
    inboxId: {
      entityId: { id: AnyPacker.pack(TaskIdSchema, taskId) },
      typeUrl: TypeUrls.derive(TaskSchema),
    },
    payload: { case: "command", value: command },
    label: InboxLabel.HANDLE_COMMAND,
    whenReceived: { seconds: 0n, nanos: 0 },
    status: InboxMessageStatus.TO_DELIVER,
  });
}
