import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import { ShardIndex } from "../../src/index.js";

describe("DeliveryLoop", () => {
  it("stops before beginning work", async () => {
    const loop = new DeliveryLoop({
      delivery: delivery(),
      shard: ShardIndex.single(),
      onMessage: () => {
        throw new Error("must not dispatch");
      },
    });
    loop.stop();
    await expect(loop.run()).resolves.toMatchObject({ status: "STOPPED", runs: 0 });
  });

  it("maps one direct drained run to IDLE", async () => {
    const loop = new DeliveryLoop({
      delivery: delivery(),
      shard: ShardIndex.single(),
      onMessage: () => undefined,
    });
    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", runs: 1 });
  });

  it("rejects a concurrent run", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loop = new DeliveryLoop({
      delivery: delivery(),
      shard: ShardIndex.single(),
      onMessage: async () => blocked,
    });
    const first = loop.run();
    await expect(loop.run()).rejects.toThrow("DeliveryLoop is already running.");
    release?.();
    await first;
  });

  it("waits for a current run during close", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loop = new DeliveryLoop({
      delivery: delivery(),
      shard: ShardIndex.single(),
      onMessage: async () => blocked,
    });
    const run = loop.run();
    const close = loop.close();
    let settled = false;
    void close.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release?.();
    await close;
    await run;
  });
});

function delivery(): Delivery {
  return new Delivery({
    context: { name: "Loop", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
}
