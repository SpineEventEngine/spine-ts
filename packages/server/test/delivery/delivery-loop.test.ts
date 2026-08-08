/* eslint-disable @typescript-eslint/require-await */

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

  it("forwards an operation and preserves a non-drained terminal status", async () => {
    const controller = new AbortController();
    let received: unknown;
    const loop = new DeliveryLoop({
      delivery: {
        drain: async (_shard: ShardIndex, options: Parameters<Delivery["drain"]>[1]) => {
          received = options.operation;
          return {
            status: "FAILED" as const,
            processed: 0,
            accepted: 0,
            delivered: 0,
            failed: 1,
            failures: [],
          };
        },
      } as unknown as Delivery,
      shard: ShardIndex.single(),
      operation: { signal: controller.signal },
      onMessage: () => undefined,
    });
    await expect(loop.run()).resolves.toMatchObject({ status: "FAILED" });
    expect(received).toEqual({ signal: controller.signal });
  });

  it("snapshots caller options before later mutation", async () => {
    const originalShard = new ShardIndex(0, 2);
    const controller = new AbortController();
    let receivedShard: ShardIndex | undefined;
    let receivedSignal: AbortSignal | undefined;
    let originalCalls = 0;
    const original = {
      drain: async (
        shard: ShardIndex,
        options: { onMessage: () => void; operation?: { signal?: AbortSignal } },
      ) => {
        receivedShard = shard;
        receivedSignal = options.operation?.signal;
        options.onMessage();
        return {
          status: "DRAINED" as const,
          processed: 0,
          accepted: 0,
          delivered: 0,
          failed: 0,
          failures: [],
        };
      },
    } as unknown as Delivery;
    const options = {
      delivery: original,
      shard: originalShard,
      onMessage: () => {
        originalCalls += 1;
      },
      operation: { signal: controller.signal },
    };
    const loop = new DeliveryLoop(options);
    options.delivery = delivery();
    options.shard = new ShardIndex(1, 2);
    options.onMessage = () => {
      throw new Error("mutated callback");
    };
    options.operation = { signal: new AbortController().signal };
    await loop.run();
    expect(receivedShard).toMatchObject({ index: 0, ofTotal: 2 });
    expect(receivedSignal).toBe(controller.signal);
    expect(originalCalls).toBe(1);
  });
});

function delivery(): Delivery {
  return new Delivery({
    context: { name: "Loop", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
}
