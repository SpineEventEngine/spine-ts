import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryWorker } from "../../src/delivery/delivery-worker.js";
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
});
function delivery(): Delivery {
  return new Delivery({
    context: { name: "WorkerRuntime", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
}
