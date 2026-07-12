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
    const calls: { shard: ShardIndex; limit: number | undefined; maxFailures: number }[] = [];
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
    const calls: { limit: number | undefined; maxFailures: number | undefined }[] = [];
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

  it("rejects an internal start while shard evidence is still settling", async () => {
    const delivery = createDelivery();
    const activeDrain = deferred<DeliveryDrainOutcome>();
    const restore = deliveryAccess.replace(delivery, () => activeDrain.promise);
    const worker = new DeliveryWorker({
      delivery,
      shards: [ShardIndex.single()],
      node: "worker-a",
      onMessage: () => undefined,
    });
    const obligation = Object.freeze({ kind: "notification" });
    const running = deliveryWorkerAccess.start(worker, obligation);

    expect(() => deliveryWorkerAccess.start(worker, obligation)).toThrow(
      "DeliveryWorker is already running.",
    );

    activeDrain.resolve(deliveryOutcome());
    await expect(running).resolves.toMatchObject({ obligation });
    restore();
  });

  it("rejects internal worker access for non-worker instances", () => {
    expect(() =>
      deliveryWorkerAccess.start({} as DeliveryWorker, Object.freeze({ kind: "notification" })),
    ).toThrow("Delivery worker access requires a DeliveryWorker instance.");
  });

  it("close waits for active loop drains", async () => {
    const delivery = createDelivery();
    const barrier = deferred<undefined>();
    const started = deferred<undefined>();
    const worker = new DeliveryWorker({
      delivery,
      shards: [ShardIndex.single()],
      node: "worker-a",
      onMessage() {
        started.resolve(undefined);
        return barrier.promise;
      },
    });
    let closed = false;

    await seed(delivery, "signal-slow", 1n);
    const running = worker.start();
    await started.promise;
    const closing = worker.close().then(() => {
      closed = true;
    });

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

  it("selectively continues only paused fulfilled shards for the same obligation", async () => {
    const delivery = createDelivery();
    const shards = [new ShardIndex(0, 3), new ShardIndex(1, 3), new ShardIndex(2, 3)];
    const calls: number[] = [];
    const restore = deliveryAccess.replace(delivery, (shard) => {
      calls.push(shard.index);
      if (shard.index === 0) {
        return Promise.resolve(
          Object.freeze({
            ...deliveryOutcome(),
            exhaustedSkippedScan: true,
            epochProgress: Object.freeze({ next: 0, complete: false }),
          }),
        );
      }
      if (shard.index === 1) {
        return Promise.resolve(deliveryOutcome(deliveryRun({ failed: 1 })));
      }
      return Promise.resolve(deliveryOutcome(deliveryRun({ status: "SKIPPED" })));
    });
    const worker = new DeliveryWorker({
      delivery,
      shards,
      node: "worker-a",
      onMessage: () => undefined,
    });
    const obligation = Object.freeze({ kind: "startup" });

    const first = await deliveryWorkerAccess.start(worker, obligation);

    expect(first.shards.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      first.shards.map((result) => (result.status === "fulfilled" ? result.run.status : undefined)),
    ).toEqual(["PAUSED", "FAILED", "SKIPPED"]);
    expect(first.shards.map(({ shard }) => shard)).toEqual(shards);
    expect(first.shards.every((result) => result.obligation === obligation)).toBe(true);
    expect(calls).toEqual([0, 1, 2, 0]);

    calls.length = 0;
    const continued = await deliveryWorkerAccess.start(worker, obligation);

    expect(continued.shards).toHaveLength(1);
    expect(continued.shards[0]).toMatchObject({
      status: "fulfilled",
      shard: shards[0],
      obligation,
      run: { status: "PAUSED" },
    });
    expect(calls).toEqual([0, 0]);
    restore();
  });

  it("starts all terminal shards again for a new obligation", async () => {
    const delivery = createDelivery();
    const shards = [new ShardIndex(0, 2), new ShardIndex(1, 2)];
    const calls: number[] = [];
    const restore = deliveryAccess.replace(delivery, (shard) => {
      calls.push(shard.index);
      return Promise.resolve(
        deliveryOutcome(deliveryRun({ status: shard.index === 0 ? "SKIPPED" : "DRAINED" })),
      );
    });
    const worker = new DeliveryWorker({
      delivery,
      shards,
      node: "worker-a",
      onMessage: () => undefined,
    });
    const firstObligation = Object.freeze({ kind: "startup" });
    const nextObligation = Object.freeze({ kind: "notification" });

    await expect(deliveryWorkerAccess.start(worker, firstObligation)).resolves.toMatchObject({
      shards: [{ run: { status: "SKIPPED" } }, { run: { status: "IDLE" } }],
    });
    await expect(deliveryWorkerAccess.start(worker, firstObligation)).resolves.toMatchObject({
      shards: [],
    });
    await expect(deliveryWorkerAccess.start(worker, nextObligation)).resolves.toMatchObject({
      obligation: nextObligation,
      shards: [{ run: { status: "SKIPPED" } }, { run: { status: "IDLE" } }],
    });
    expect(calls).toEqual([0, 1, 0, 1]);
    restore();
  });

  it("keeps ordered rejected causes with fulfilled sibling progress and obligation", async () => {
    const firstCause = new Error("first shard failed");
    const secondCause = new Error("third shard failed");
    const delivery = createDelivery();
    const shards = [new ShardIndex(0, 3), new ShardIndex(1, 3), new ShardIndex(2, 3)];
    const restore = deliveryAccess.replace(delivery, (shard) => {
      if (shard.index === 0) {
        return Promise.reject(firstCause);
      }
      if (shard.index === 2) {
        return Promise.reject(secondCause);
      }
      return Promise.resolve(deliveryOutcome());
    });
    const worker = new DeliveryWorker({
      delivery,
      shards,
      node: "worker-a",
      onMessage: () => undefined,
    });
    const obligation = Object.freeze({ kind: "notification" });

    const evidence = await deliveryWorkerAccess.start(worker, obligation);

    expect(evidence.shards.map(({ status }) => status)).toEqual([
      "rejected",
      "fulfilled",
      "rejected",
    ]);
    expect(evidence.shards.map(({ shard }) => shard)).toEqual(shards);
    expect(evidence.shards.every((result) => result.obligation === obligation)).toBe(true);
    expect(
      evidence.shards.map((result) =>
        result.status === "rejected" ? result.cause : result.run.status,
      ),
    ).toEqual([firstCause, "IDLE", secondCause]);
    expect(evidence.shards[0]).toMatchObject({
      status: "rejected",
      cause: firstCause,
      progress: { runs: 0, processed: 0, accepted: 0, delivered: 0, failed: 0 },
    });
    restore();
  });

  it("retries a rejected shard only after a later explicit invocation", async () => {
    const cause = new Error("first shard failed once");
    const delivery = createDelivery();
    const shards = [new ShardIndex(0, 2), new ShardIndex(1, 2)];
    const calls: number[] = [];
    let rejectFirstShard = true;
    const restore = deliveryAccess.replace(delivery, (shard) => {
      calls.push(shard.index);
      if (shard.index === 0 && rejectFirstShard) {
        rejectFirstShard = false;
        return Promise.reject(cause);
      }
      return Promise.resolve(deliveryOutcome());
    });
    const worker = new DeliveryWorker({
      delivery,
      shards,
      node: "worker-a",
      onMessage: () => undefined,
    });
    const obligation = Object.freeze({ kind: "retry" });

    const first = await deliveryWorkerAccess.start(worker, obligation);

    expect(first.shards.map(({ status }) => status)).toEqual(["rejected", "fulfilled"]);
    expect(calls).toEqual([0, 1]);
    await Promise.resolve();
    expect(calls).toEqual([0, 1]);

    const retried = await deliveryWorkerAccess.start(worker, obligation);

    expect(retried.shards).toMatchObject([
      { status: "fulfilled", shard: shards[0], obligation, run: { status: "IDLE" } },
    ]);
    expect(calls).toEqual([0, 1, 0]);
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

function deliveryRun(overrides: Partial<DeliveryRun> = {}): DeliveryRun {
  return Object.freeze({
    status: "DRAINED",
    processed: 0,
    accepted: 0,
    delivered: 0,
    failed: 0,
    failures: Object.freeze([]),
    ...overrides,
  });
}

function deliveryOutcome(run = deliveryRun()): DeliveryDrainOutcome {
  return Object.freeze({
    run,
    resumeCursor: Object.freeze({}),
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
