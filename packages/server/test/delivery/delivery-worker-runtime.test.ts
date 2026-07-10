import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import {
  Delivery,
  DeliveryWorker,
  ShardIndex,
  type DeliveryRun,
  type InboxId,
  type InboxMessage,
} from "../../src/index.js";

describe("DeliveryWorker", () => {
  it("starts configured shard loops and reports their run results", async () => {
    const delivery = createDelivery();
    const seen: string[] = [];

    await seed(delivery, "signal-1", 1n);

    const worker = new DeliveryWorker({
      delivery,
      shards: [ShardIndex.single()],
      node: "worker-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    const run = await worker.start();

    expect(seen).toEqual(["signal-1"]);
    expect(run).toMatchObject({
      status: "IDLE",
      loops: [{ status: "IDLE", processed: 1, delivered: 1, failed: 0 }],
    });
    await worker.close();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
  });

  it("close waits for active loop drains", async () => {
    const delivery = createDelivery();
    const barrier = deferred<undefined>();
    const worker = new DeliveryWorker({
      delivery,
      shards: [ShardIndex.single()],
      node: "worker-a",
      onMessage: () => barrier.promise,
    });
    let closed = false;

    await seed(delivery, "signal-slow", 1n);
    const running = worker.start();
    const closing = worker.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);

    barrier.resolve(undefined);
    await closing;
    await expect(running).resolves.toMatchObject({
      status: "STOPPED",
      loops: [{ status: "STOPPED", delivered: 1 }],
    });
    expect(closed).toBe(true);
  });

  it("close waits for active shard drains after another shard rejects", async () => {
    const failure = new Error("storage failed");
    const activeDrain = deferred<DeliveryRun>();
    const delivery = {
      drain(shard: ShardIndex) {
        if (shard.index === 0) {
          return Promise.reject(failure);
        }

        return activeDrain.promise;
      },
    } as unknown as Delivery;
    const worker = new DeliveryWorker({
      delivery,
      shards: [new ShardIndex(0, 2), new ShardIndex(1, 2)],
      node: "worker-a",
      onMessage: () => undefined,
    });
    let closed = false;
    const running = worker.start();
    const startFailure = running.catch((error: unknown) => error);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const closing = worker.close().finally(() => {
      closed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);

    activeDrain.resolve(deliveryRun());

    await expect(closing).rejects.toBe(failure);
    await expect(startFailure).resolves.toBe(failure);
    expect(closed).toBe(true);
  });

  it("reports all shard drain rejections when multiple loops fail", async () => {
    const first = new Error("first shard failed");
    const second = new Error("second shard failed");
    const delivery = {
      drain(shard: ShardIndex) {
        return Promise.reject(shard.index === 0 ? first : second);
      },
    } as unknown as Delivery;
    const worker = new DeliveryWorker({
      delivery,
      shards: [new ShardIndex(0, 2), new ShardIndex(1, 2)],
      node: "worker-a",
      onMessage: () => undefined,
    });

    const thrown = await worker.start().catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([first, second]);
  });
});

function createDelivery(): Delivery {
  return new Delivery({
    context: { name: "Tasks", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
}

async function seed(delivery: Delivery, signalId: string, version: bigint): Promise<InboxMessage> {
  const result = await delivery.inbox.receive({
    inboxId: targetInbox(),
    signalId,
    label: "UPDATE_SUBSCRIBER",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived: new Date("2026-07-08T09:00:00.000Z"),
    version,
  });

  return result.message;
}

function targetInbox(): InboxId {
  return {
    targetId: "projection-1",
    targetTypeUrl: "type.example.dev/tasks.Projection",
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function deliveryRun(): DeliveryRun {
  return Object.freeze({
    status: "DRAINED",
    processed: 0,
    claimed: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
  });
}
