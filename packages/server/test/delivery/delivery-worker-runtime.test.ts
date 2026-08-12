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
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import type { DeliveryLoopRun, DeliveryLoopStatus } from "../../src/delivery/delivery-loop.js";
import { deliveryWorkerAccess, DeliveryWorker } from "../../src/delivery/delivery-worker.js";
import { ShardIndex } from "../../src/index.js";

describe("DeliveryWorker", () => {
  it("starts configured shards and reports ordered terminal results", async () => {
    const worker = new DeliveryWorker({
      delivery: delivery(),
      shards: [new ShardIndex(0, 2), new ShardIndex(1, 2)],
      onMessage: () => undefined,
    });
    await expect(worker.start()).resolves.toMatchObject({
      status: "IDLE",
      loops: [{ status: "IDLE" }, { status: "IDLE" }],
    });
  });

  it("rejects a second start while the current worker settlement is pending", async () => {
    const worker = new DeliveryWorker({
      delivery: delivery(),
      shards: [ShardIndex.single()],
      onMessage: () => undefined,
    });
    const running = worker.start();
    expect(() => worker.start()).toThrow("DeliveryWorker is already running.");
    await running;
  });

  it("rejects an empty shard selection", () => {
    expect(
      () =>
        new DeliveryWorker({
          delivery: delivery(),
          shards: [],
          onMessage: () => undefined,
        }),
    ).toThrow("DeliveryWorker shards must be a non-empty array.");
  });

  it.each(["FAILED", "STOPPED", "SKIPPED", "IDLE"] as const)(
    "prioritizes %s terminal loop status",
    (status) => {
      expect(deliveryWorkerAccess.status([loopRun(status)])).toBe(status);
    },
  );

  it("rejects internal lifecycle access for non-worker values", () => {
    expect(() => deliveryWorkerAccess.awaitSettled({} as DeliveryWorker)).toThrow(
      "Delivery worker access requires a DeliveryWorker instance.",
    );
  });

  it("settles an idle worker and requires stop before permanent retirement", async () => {
    const worker = new DeliveryWorker({
      delivery: delivery(),
      shards: [ShardIndex.single()],
      onMessage: () => undefined,
    });
    await expect(deliveryWorkerAccess.awaitSettled(worker)).resolves.toBeUndefined();
    await expect(deliveryWorkerAccess.retire(worker)).rejects.toThrow(
      "DeliveryWorker must be stopped before retirement.",
    );
    worker.stop();
    await expect(deliveryWorkerAccess.retire(worker)).resolves.toBeUndefined();
  });
});
function delivery(): Delivery {
  return new Delivery({
    context: { name: "WorkerRuntime", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
}

function loopRun(status: DeliveryLoopStatus): DeliveryLoopRun {
  return Object.freeze({
    status,
    runs: 0,
    processed: 0,
    accepted: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
  });
}
