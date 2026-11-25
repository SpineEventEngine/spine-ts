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

import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { TaskIdSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

import {
  type DeliveryReady,
  DeliveryReadiness,
  InboxHandoff,
} from "../../src/context/local-inbox-handoff.js";
import { Delivery } from "../../src/delivery/delivery.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { createMessage } from "../delivery/inbox-message-fixture.js";
import { tenant } from "../tenant-fixture.js";

describe("DeliveryReadiness", () => {
  it("ignores notifications after closure and routes local wakes to the selected Delivery", async () => {
    const delivery = new Delivery({
      context: { name: "LocalReadiness", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const wake = vi.spyOn(Delivery.prototype, "wake").mockImplementation(() => undefined);
    const readiness = new DeliveryReadiness();
    expect(readiness.route(delivery)).toBe(delivery);
    readiness.notify(ready());
    expect(wake).toHaveBeenCalledExactlyOnceWith(ShardIndex.single());
    readiness.notify(ready("another-tenant"));
    expect(wake).toHaveBeenCalledOnce();
    await readiness.close();
    readiness.notify(ready());
    expect(wake).toHaveBeenCalledOnce();
    wake.mockRestore();
  });

  it("passes a full persisted row to a custom observer without starting a direct drain", async () => {
    const onMessage = vi.fn();
    const onDrain = vi.fn().mockResolvedValue(undefined);
    const readiness = new DeliveryReadiness(undefined, undefined, undefined, false, onMessage);
    const row = createMessage("observed-row", "observed-event", 1n);
    await readiness.claim(ready(), row).complete(onDrain);
    expect(onMessage).toHaveBeenCalledExactlyOnceWith(row);
    expect(onDrain).not.toHaveBeenCalled();
    await readiness.close();
  });

  it("coalesces a direct claim and allows an unstarted claim to be abandoned", async () => {
    const readiness = new DeliveryReadiness();
    const onDrain = vi.fn().mockResolvedValue(undefined);
    const handoff = readiness.claim(ready());
    const first = handoff.complete(onDrain);
    expect(handoff.complete(onDrain)).toBe(first);
    handoff.abandon();
    await first;
    expect(onDrain).toHaveBeenCalledOnce();

    const abandoned = readiness.claim(ready());
    abandoned.abandon();
    abandoned.abandon();
    await abandoned.complete(onDrain);
    expect(onDrain).toHaveBeenCalledOnce();
    await readiness.close();
  });

  it("propagates a synchronous direct drain failure and finishes its claim", async () => {
    const readiness = new DeliveryReadiness();
    const failure = new Error("direct admission failed");
    const completion = readiness.claim(ready()).complete(() => {
      throw failure;
    });
    await expect(completion).rejects.toBe(failure);
    await expect(readiness.drain()).resolves.toBe(false);
    await readiness.close();
  });

  it("coalesces the same persisted handoff and clears only its completed entry", async () => {
    const handoffs = new Map<string, Promise<InboxMessage>>();
    const released = Promise.withResolvers<InboxMessage>();
    const row = createMessage("coalesced", "event-coalesced", 1n);
    const onHandoff = vi.fn(() => released.promise);
    const first = InboxHandoff.coordinate({ handoffs, key: "row", onHandoff });
    const second = InboxHandoff.coordinate({ handoffs, key: "row", onHandoff });
    expect(onHandoff).toHaveBeenCalledOnce();
    released.resolve(row);
    await expect(Promise.all([first, second])).resolves.toEqual([row, row]);
    expect(handoffs.size).toBe(0);

    const newer = Promise.resolve(row);
    const older = Promise.withResolvers<InboxMessage>();
    const overlapping = InboxHandoff.coordinate({
      handoffs,
      key: "row",
      onHandoff: () => older.promise,
    });
    handoffs.set("row", newer);
    older.resolve(row);
    await overlapping;
    expect(handoffs.get("row")).toBe(newer);
  });

  it("retries deferred and unresolved local outcomes before acknowledging the exact row", async () => {
    const row = createMessage("retried", "event-retried", 1n);
    const drainMessage = vi
      .fn()
      .mockResolvedValueOnce({ acknowledged: false, outcome: { kind: "deferred" } })
      .mockResolvedValueOnce({ acknowledged: false, outcome: { kind: "unresolved" } })
      .mockResolvedValueOnce({ acknowledged: true, outcome: { kind: "acknowledged" } });
    const delivery = { drainMessage } as unknown as Delivery;
    await InboxHandoff.runDrain({
      delivery,
      received: row,
      node: "Tasks",
      onDispatch: () => undefined,
      deliveryFailureMessage: "delivery failed",
      skippedMessage: "skipped",
      unfinishedMessage: "unfinished",
    });
    expect(drainMessage).toHaveBeenCalledTimes(3);
  });

  it("accepts a delivered readback after an unresolved local result", async () => {
    const row = createMessage("delivered-readback", "event-readback", 1n);
    const readMessage = vi.fn().mockResolvedValue({ ...row, status: "DELIVERED" });
    const delivery = {
      drainMessage: vi.fn().mockResolvedValue({
        acknowledged: false,
        outcome: {
          kind: "unresolved",
          run: {
            status: "STOPPED",
            processed: 1,
            accepted: 1,
            delivered: 0,
            failed: 0,
            failures: [],
          },
        },
      }),
      inbox: { readMessage },
    } as unknown as Delivery;
    await InboxHandoff.runDrain({
      delivery,
      received: row,
      node: "Tasks",
      onDispatch: () => undefined,
      deliveryFailureMessage: "delivery failed",
      skippedMessage: "skipped",
      unfinishedMessage: "unfinished",
    });
    expect(readMessage).toHaveBeenCalledWith(row.id);
  });

  it("uses the shared Delivery wake when no custom wake callback was installed", async () => {
    const shared = new Delivery({
      context: { name: "SharedReadiness", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const wake = vi.spyOn(Delivery.prototype, "wake").mockImplementation(() => undefined);
    try {
      const readiness = new DeliveryReadiness(undefined, shared);
      readiness.notify(ready());
      expect(wake).toHaveBeenCalledExactlyOnceWith(ShardIndex.single());
      await readiness.close();
      await shared.close();
    } finally {
      wake.mockRestore();
    }
  });

  it.each(["throws", "rejects"])(
    "keeps an admitted local claim complete when a standalone observer %s",
    async (failureMode) => {
      const observer = vi.fn(() => {
        if (failureMode === "throws") throw new Error("observer threw");
        return Promise.reject(new Error("observer rejected"));
      });
      const readiness = new DeliveryReadiness(observer);
      const onDrain = vi.fn().mockResolvedValue(undefined);
      await expect(readiness.claim(ready()).complete(onDrain)).resolves.toBeUndefined();
      expect(observer).toHaveBeenCalledOnce();
      expect(onDrain).toHaveBeenCalledOnce();
      await readiness.close();
    },
  );

  it.each(["skipped", "idle"])(
    "reports an unresolved %s direct run without claiming a delivery",
    async (status) => {
      const row = createMessage(`unresolved-${status}`, `event-${status}`, 1n);
      const run = {
        status: status === "skipped" ? "SKIPPED" : "DRAINED",
        processed: 0,
        accepted: 0,
        delivered: 0,
        failed: 0,
        failures: [],
      };
      const drainMessage = vi.fn().mockResolvedValue({ acknowledged: false, run });
      const readMessage = vi.fn().mockResolvedValue(row);
      const delivery = {
        drainMessage,
        inbox: { readMessage },
      } as unknown as Delivery;
      await expect(
        InboxHandoff.runDrain({
          delivery,
          received: row,
          node: "Tasks",
          onDispatch: () => undefined,
          deliveryFailureMessage: "delivery failed",
          skippedMessage: "skipped",
          unfinishedMessage: "unfinished",
        }),
      ).rejects.toThrow(status === "skipped" ? "skipped" : "unfinished");
      expect(readMessage).toHaveBeenCalledWith(row.id);
      expect(drainMessage).toHaveBeenCalledOnce();
    },
  );

  it("completes a supervised remote handoff after notification without draining", async () => {
    const sharedWake = vi.fn();
    const shared = { wake: sharedWake } as unknown as Delivery;
    const onWake = vi.fn();
    const readiness = new DeliveryReadiness(undefined, shared, onWake, true);
    const onDrain = vi.fn().mockResolvedValue(undefined);

    expect(readiness.route(shared)).toBe(shared);
    await readiness.claim(ready()).complete(onDrain);

    expect(onWake).toHaveBeenCalledExactlyOnceWith(ShardIndex.single());
    expect(onDrain).not.toHaveBeenCalled();
    expect(sharedWake).not.toHaveBeenCalled();
  });

  it("does not turn an explicit receipt failure into success through delivered readback", async () => {
    const message = {
      id: { value: "failed-agent", shard: ShardIndex.single() },
    } as InboxMessage;
    const failure = new Error("receipt compare-and-set failed");
    const delivery = {
      drainMessage: () =>
        Promise.resolve({ acknowledged: false, outcome: { kind: "failed", error: failure } }),
      inbox: { readMessage: () => Promise.resolve({ ...message, status: "DELIVERED" }) },
    } as unknown as Delivery;
    await expect(
      InboxHandoff.runDrain({
        delivery,
        received: message,
        node: "AgentReceipts",
        onDispatch: () => undefined,
        deliveryFailureMessage: "delivery failed",
        skippedMessage: "skipped",
        unfinishedMessage: "unfinished",
      }),
    ).rejects.toBe(failure);
  });
  it("stops a direct handoff when an older row for the same signal fails", async () => {
    const shard = ShardIndex.single();
    const received = {
      id: { value: "new-row", shard },
      inboxId: {
        targetId: AnyPacker.pack(TaskIdSchema, create(TaskIdSchema, { value: "task-1" })),
        targetTypeUrl: TypeUrls.derive(TaskSchema),
      },
      signalId: "event-1",
      label: "REACT_UPON_EVENT",
      shard,
    } as InboxMessage;
    const older = { ...received, id: { value: "older-row", shard } };
    const cause = new Error("subscriber rejected the signal");
    const drainMessage = vi.fn().mockResolvedValue({
      acknowledged: false,
      run: {
        status: "STOPPED",
        processed: 1,
        accepted: 1,
        delivered: 0,
        failed: 1,
        failures: [{ message: older, error: cause }],
      },
    });
    const delivery = {
      drainMessage,
      inbox: { readMessage: vi.fn().mockResolvedValue(received) },
    } as unknown as Delivery;

    await expect(
      InboxHandoff.runDrain({
        delivery,
        received,
        node: "Tasks",
        onDispatch: () => undefined,
        deliveryFailureMessage: "delivery failed",
        skippedMessage: "skipped",
        unfinishedMessage: "unfinished",
      }),
    ).rejects.toBe(cause);
    expect(drainMessage).toHaveBeenCalledOnce();
  });

  it("continues a direct handoff past a failed row for another signal", async () => {
    const shard = ShardIndex.single();
    const received = {
      id: { value: "new-row", shard },
      inboxId: {
        targetId: AnyPacker.pack(TaskIdSchema, create(TaskIdSchema, { value: "task-1" })),
        targetTypeUrl: TypeUrls.derive(TaskSchema),
      },
      signalId: "event-1",
      label: "REACT_UPON_EVENT",
      shard,
    } as InboxMessage;
    const other = {
      ...received,
      id: { value: "older-row", shard },
      signalId: "event-2",
    };
    const failed = {
      acknowledged: false,
      run: {
        status: "STOPPED",
        processed: 1,
        accepted: 1,
        delivered: 0,
        failed: 1,
        failures: [{ message: other, error: new Error("other signal failed") }],
      },
    };
    const acknowledged = { ...failed, acknowledged: true };
    const drainMessage = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(acknowledged);
    const delivery = {
      drainMessage,
      inbox: { readMessage: vi.fn().mockResolvedValue(received) },
    } as unknown as Delivery;

    await InboxHandoff.runDrain({
      delivery,
      received,
      node: "Tasks",
      onDispatch: () => undefined,
      deliveryFailureMessage: "delivery failed",
      skippedMessage: "skipped",
      unfinishedMessage: "unfinished",
    });
    expect(drainMessage).toHaveBeenCalledTimes(2);
  });

  it("omits optional drain observers when exact acknowledgement needs none", async () => {
    const received = {
      id: { value: "target", shard: ShardIndex.single() },
    } as InboxMessage;
    const drainMessage = vi.fn().mockResolvedValue({
      acknowledged: true,
      run: {
        status: "DRAINED",
        processed: 1,
        accepted: 1,
        delivered: 1,
        failed: 0,
        failures: [],
      },
    });
    const delivery = { drainMessage } as unknown as Delivery;

    await InboxHandoff.runDrain({
      delivery,
      received,
      node: "Tasks",
      onDispatch: () => undefined,
      deliveryFailureMessage: "delivery failed",
      skippedMessage: "skipped",
      unfinishedMessage: "unfinished",
    });

    expect(drainMessage).toHaveBeenCalledOnce();
    expect(drainMessage.mock.calls[0]?.[1]).not.toHaveProperty("acceptMessage");
    expect(drainMessage.mock.calls[0]?.[1]).not.toHaveProperty("onDelivered");
  });

  it("waits for admitted direct work and preserves its original failure", async () => {
    const readiness = new DeliveryReadiness();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const failure = new Error("direct delivery failed");
    const draining = readiness.claim(ready()).complete(async () => {
      entered.resolve(undefined);
      await release.promise;
      throw failure;
    });
    await entered.promise;
    const closing = readiness.close();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve(undefined);
    await expect(draining).rejects.toBe(failure);
    await closing;
    expect(settled).toBe(true);
  });

  it("waits for a second admitted handoff started during close drainage", async () => {
    const readiness = new DeliveryReadiness();
    const firstEntered = Promise.withResolvers<undefined>();
    const releaseFirst = Promise.withResolvers<undefined>();
    const secondEntered = Promise.withResolvers<undefined>();
    const releaseSecond = Promise.withResolvers<undefined>();
    const first = readiness.claim(ready()).complete(async () => {
      firstEntered.resolve(undefined);
      await releaseFirst.promise;
      void readiness.claim(ready()).complete(async () => {
        secondEntered.resolve(undefined);
        await releaseSecond.promise;
      });
    });
    await firstEntered.promise;
    const closing = readiness.close();
    releaseFirst.resolve(undefined);
    await secondEntered.promise;
    await first;
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    releaseSecond.resolve(undefined);
    await closing;
    expect(closed).toBe(true);
  });
});

function ready(tenantId?: string): DeliveryReady {
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId: tenant(tenantId) }),
    label: "HANDLE_COMMAND",
    targetTypeUrl: "type.example.dev/Tasks.ProcessManager",
    shard: ShardIndex.single(),
  });
}
