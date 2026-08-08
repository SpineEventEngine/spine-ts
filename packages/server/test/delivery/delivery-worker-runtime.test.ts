import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
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

  it.each([
    [[{ status: "FAILED" }], "FAILED"],
    [[{ status: "STOPPED" }], "STOPPED"],
    [[{ status: "SKIPPED" }], "SKIPPED"],
    [[{ status: "IDLE" }], "IDLE"],
  ] as const)("prioritizes %s terminal loop status", (loops, expected) => {
    expect(deliveryWorkerAccess.status(loops)).toBe(expected);
  });

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
