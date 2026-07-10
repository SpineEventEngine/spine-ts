import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import {
  Delivery,
  deliveryAccess,
  type DeliveryDrainOutcome,
  type DeliveryRun,
} from "../../src/delivery/delivery.js";
import { DeliveryWorker, deliveryWorkerAccess } from "../../src/delivery/delivery-worker.js";
import type { DeliveryLoopRun } from "../../src/delivery/delivery-loop.js";
import { ShardIndex, type InboxId, type InboxMessage } from "../../src/index.js";

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

  it("forwards optional limit and maxFailures to each configured shard loop", async () => {
    const delivery = createDelivery();
    const calls: Array<{ shard: ShardIndex; limit: number | undefined; maxFailures: number }> = [];
    const restore = deliveryAccess.replace(delivery, (shard, options, controls) => {
      calls.push({ shard, limit: options.limit, maxFailures: controls.maxFailures ?? 0 });

      return Promise.resolve(deliveryOutcome());
    });
    const shards = [new ShardIndex(0, 2), new ShardIndex(1, 2)];
    const worker = new DeliveryWorker({
      delivery,
      shards,
      node: "worker-a",
      limit: 7,
      maxFailures: 3,
      onMessage: () => undefined,
    });

    const run = await worker.start();

    expect(run).toMatchObject({
      status: "IDLE",
      loops: [
        { status: "IDLE", runs: 1 },
        { status: "IDLE", runs: 1 },
      ],
    });
    expect(calls).toEqual([
      { shard: shards[0], limit: 7, maxFailures: 3 },
      { shard: shards[1], limit: 7, maxFailures: 3 },
    ]);
    restore();
  });

  it("uses loop defaults when optional limit and maxFailures are omitted", async () => {
    const delivery = createDelivery();
    const calls: Array<{ limit: number | undefined; maxFailures: number | undefined }> = [];
    const restore = deliveryAccess.replace(delivery, (_shard, options, controls) => {
      calls.push({ limit: options.limit, maxFailures: controls.maxFailures });

      return Promise.resolve(deliveryOutcome());
    });
    const worker = new DeliveryWorker({
      delivery,
      shards: [ShardIndex.single()],
      node: "worker-a",
      onMessage: () => undefined,
    });

    await worker.start();

    expect(calls).toEqual([{ limit: 100, maxFailures: 1 }]);
    restore();
  });

  it("rejects invalid shard lists before starting loops", () => {
    const delivery = createDelivery();
    const options = {
      delivery,
      node: "worker-a",
      onMessage: () => undefined,
    };

    expect(() => new DeliveryWorker({ ...options, shards: [] })).toThrow(
      "DeliveryWorker shards must be a non-empty array.",
    );
    expect(
      () =>
        new DeliveryWorker({
          ...options,
          shards: undefined as unknown as readonly ShardIndex[],
        }),
    ).toThrow("DeliveryWorker shards must be a non-empty array.");
  });

  it("rejects a second start while loops are still running", async () => {
    const delivery = createDelivery();
    const activeDrain = deferred<DeliveryDrainOutcome>();
    const restore = deliveryAccess.replace(delivery, () => activeDrain.promise);
    const worker = new DeliveryWorker({
      delivery,
      shards: [ShardIndex.single()],
      node: "worker-a",
      onMessage: () => undefined,
    });

    const running = worker.start();

    expect(() => worker.start()).toThrow("DeliveryWorker is already running.");
    activeDrain.resolve(deliveryOutcome());
    await expect(running).resolves.toMatchObject({ status: "IDLE" });
    restore();
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
    const activeDrain = deferred<DeliveryDrainOutcome>();
    const delivery = createDelivery();
    const restore = deliveryAccess.replace(delivery, (shard: ShardIndex) => {
      if (shard.index === 0) {
        return Promise.reject(failure);
      }

      return activeDrain.promise;
    });
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

    activeDrain.resolve(deliveryOutcome());

    await expect(closing).rejects.toBe(failure);
    await expect(startFailure).resolves.toBe(failure);
    expect(closed).toBe(true);
    restore();
  });

  it("reports all shard drain rejections when multiple loops fail", async () => {
    const first = new Error("first shard failed");
    const second = new Error("second shard failed");
    const delivery = createDelivery();
    const restore = deliveryAccess.replace(delivery, (shard: ShardIndex) => {
      return Promise.reject(shard.index === 0 ? first : second);
    });
    const worker = new DeliveryWorker({
      delivery,
      shards: [new ShardIndex(0, 2), new ShardIndex(1, 2)],
      node: "worker-a",
      onMessage: () => undefined,
    });

    const thrown = await worker.start().catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([first, second]);
    restore();
  });

  it("preserves PAUSED over SKIPPED when aggregating mixed loop outcomes", () => {
    const loops = [
      loopRun("SKIPPED"),
      loopRun("PAUSED"),
      loopRun("IDLE"),
    ] satisfies readonly DeliveryLoopRun[];

    expect(deliveryWorkerAccess.status(loops)).toBe("PAUSED");
  });

  it("preserves FAILED over lower-priority statuses when aggregating mixed loop outcomes", () => {
    const loops = [
      loopRun("SKIPPED"),
      loopRun("STOPPED"),
      loopRun("FAILED"),
    ] satisfies readonly DeliveryLoopRun[];

    expect(deliveryWorkerAccess.status(loops)).toBe("FAILED");
  });

  it("reports SKIPPED when every configured loop skips or idles", () => {
    const loops = [loopRun("IDLE"), loopRun("SKIPPED")] satisfies readonly DeliveryLoopRun[];

    expect(deliveryWorkerAccess.status(loops)).toBe("SKIPPED");
  });
});

function createDelivery(): Delivery {
  return new Delivery({
    context: { name: "Tasks", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
  });
}

async function seed(
  delivery: Delivery,
  signalId: string,
  version: bigint,
  shard = ShardIndex.single(),
  label: InboxMessage["label"] = "UPDATE_SUBSCRIBER",
): Promise<InboxMessage> {
  const result = await delivery.inbox.receive({
    inboxId: targetInbox(),
    signalId,
    label,
    status: "TO_DELIVER",
    shard,
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
    accepted: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
  });
}

function deliveryOutcome(run = deliveryRun()): DeliveryDrainOutcome {
  return Object.freeze({
    run,
    resumeCursor: Object.freeze({ offset: 0 }),
    exhaustedSkippedScan: false,
  });
}

function loopRun(status: DeliveryLoopRun["status"]): DeliveryLoopRun {
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
