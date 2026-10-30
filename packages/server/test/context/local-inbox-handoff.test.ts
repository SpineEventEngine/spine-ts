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
import { tenant } from "../tenant-fixture.js";

describe("DeliveryReadiness", () => {
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
        onReplay: () => undefined,
        replayFailureMessage: "replay failed",
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
        onReplay: () => undefined,
        replayFailureMessage: "replay failed",
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
      onReplay: () => undefined,
      replayFailureMessage: "replay failed",
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
      onReplay: () => undefined,
      replayFailureMessage: "replay failed",
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
    const failure = new Error("direct replay failed");
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

  it("keeps deferred routes until capacity is available and discards them on close", async () => {
    const sharedWake = vi.fn();
    const shared = { wake: sharedWake } as unknown as Delivery;
    const onWake = vi.fn();
    const readiness = new DeliveryReadiness(undefined, shared, onWake);
    readiness.defer(ready());
    expect(onWake).not.toHaveBeenCalled();
    readiness.retryDeferred();
    expect(onWake).toHaveBeenCalledOnce();
    readiness.defer(ready());
    await readiness.close();
    readiness.retryDeferred();
    expect(onWake).toHaveBeenCalledOnce();
    expect(sharedWake).not.toHaveBeenCalled();
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
