import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import {
  Delivery,
  DeliveryLoop,
  ShardSession,
  ShardIndex,
  type InboxId,
  type InboxMessage,
  type DeliveryRun,
} from "../../src/index.js";
import { inboxStorageAccess } from "../../src/delivery/inbox-storage.js";

describe("DeliveryLoop", () => {
  it("drains multiple pages and rows appended during delivery", async () => {
    const delivery = createDelivery();
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      limit: 1,
      async onMessage(message) {
        seen.push(message.signalId);
        if (message.signalId === "signal-1") {
          await seed(delivery, "signal-2", 2n);
        }
      },
    });
    const seen: string[] = [];

    await seed(delivery, "signal-1", 1n);

    const run = await loop.run();

    expect(seen).toEqual(["signal-1", "signal-2"]);
    expect(run).toMatchObject({
      status: "IDLE",
      runs: 3,
      processed: 2,
      delivered: 2,
      failed: 0,
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
  });

  it("retries a previously failed row on a later run", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();

    await seed(delivery, "signal-retry", 1n);

    const failed = await new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      onMessage() {
        throw new Error("endpoint failed");
      },
    }).run();

    expect(failed).toMatchObject({
      status: "FAILED",
      runs: 1,
      processed: 1,
      delivered: 0,
      failed: 1,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-retry", status: "TO_DELIVER" },
    ]);

    const retried: string[] = [];
    const retriedRun = await new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      onMessage(message) {
        retried.push(message.signalId);
      },
    }).run();

    expect(retried).toEqual(["signal-retry"]);
    expect(retriedRun).toMatchObject({
      status: "IDLE",
      delivered: 1,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
  });

  it("reports a skipped shard without invoking endpoints", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = createDelivery(storageFactory);
    const second = createDelivery(storageFactory);
    const shard = ShardIndex.single();
    const seen: string[] = [];

    await seed(first, "signal-claimed", 1n);
    const session = await first.shards.pickUp(shard, "node-a");
    const run = await new DeliveryLoop({
      delivery: second,
      shard,
      node: "node-b",
      onMessage(message) {
        seen.push(message.signalId);
      },
    }).run();

    expect(session).toBeDefined();
    expect(seen).toEqual([]);
    expect(run).toMatchObject({
      status: "SKIPPED",
      runs: 1,
      processed: 0,
      delivered: 0,
      failed: 0,
    });
  });

  it("stops idle when pending rows are already claimed", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-08T09:00:30.000Z"),
    });
    const shard = ShardIndex.single();
    const stored = await seed(delivery, "signal-row-claimed", 1n);
    const claimed = await inboxStorageAccess.claim(
      delivery.inbox.storage,
      stored,
      new ShardSession(
        "message-owner",
        shard,
        "node-a",
        new Date("2026-07-08T09:00:00.000Z"),
        new Date("2026-07-08T09:01:00.000Z"),
      ),
    );
    const seen: string[] = [];

    const run = await new DeliveryLoop({
      delivery,
      shard,
      node: "node-b",
      onMessage(message) {
        seen.push(message.signalId);
      },
    }).run();

    expect(claimed?.signalId).toBe("signal-row-claimed");
    expect(seen).toEqual([]);
    expect(run).toMatchObject({
      status: "IDLE",
      runs: 1,
      processed: 1,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
  });

  it("stop prevents starting a new drain", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    await seed(delivery, "signal-stopped", 1n);
    loop.stop();

    const run = await loop.run();

    expect(seen).toEqual([]);
    expect(run).toMatchObject({
      status: "STOPPED",
      runs: 0,
      processed: 0,
      delivered: 0,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-stopped", status: "TO_DELIVER" },
    ]);
  });

  it("rejects a concurrent run after stop while a drain is active", async () => {
    const delivery = createDelivery();
    const barrier = deferred<undefined>();
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage: () => barrier.promise,
    });

    await seed(delivery, "signal-active-stop", 1n);
    const running = loop.run();
    await Promise.resolve();

    loop.stop();

    expect(() => loop.run()).toThrow("DeliveryLoop is already running.");

    barrier.resolve(undefined);
    await expect(running).resolves.toMatchObject({
      status: "STOPPED",
      runs: 1,
      delivered: 1,
    });
  });

  it("close waits for the current drain before resolving", async () => {
    const delivery = createDelivery();
    const barrier = deferred<undefined>();
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage: () => barrier.promise,
    });
    let closed = false;

    await seed(delivery, "signal-slow", 1n);
    const running = loop.run();
    const closing = loop.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);

    barrier.resolve(undefined);
    await closing;
    const run = await running;

    expect(closed).toBe(true);
    expect(run).toMatchObject({
      status: "STOPPED",
      runs: 1,
      delivered: 1,
    });
  });

  it("propagates current drain rejection through close without starting another drain", async () => {
    const failure = new Error("storage failed");
    const barrier = deferred<DeliveryRun>();
    const delivery = {
      drain() {
        drains += 1;
        return barrier.promise;
      },
    } as unknown as Delivery;
    let drains = 0;
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage: () => undefined,
    });

    const running = loop.run();
    const closing = loop.close();
    await Promise.resolve();

    barrier.reject(failure);

    await expect(closing).rejects.toBe(failure);
    await expect(running).rejects.toBe(failure);
    await expect(loop.run()).resolves.toMatchObject({
      status: "STOPPED",
      runs: 0,
    });
    expect(drains).toBe(1);
  });

  it("stops at the configured failure bound", async () => {
    const delivery = createDelivery();
    const attempts: string[] = [];

    await seed(delivery, "signal-fails", 1n);

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      maxFailures: 2,
      onMessage(message) {
        attempts.push(message.signalId);
        throw new Error("still failing");
      },
    }).run();

    expect(attempts).toEqual(["signal-fails", "signal-fails"]);
    expect(run).toMatchObject({
      status: "FAILED",
      runs: 2,
      processed: 2,
      delivered: 0,
      failed: 2,
    });
    expect(run.failures).toHaveLength(2);
  });

  it("caps each drain by the remaining failure budget", async () => {
    const delivery = createDelivery();
    const attempts: string[] = [];

    await seed(delivery, "signal-fails-1", 1n);
    await seed(delivery, "signal-fails-2", 2n);

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage(message) {
        attempts.push(message.signalId);
        throw new Error("endpoint failed");
      },
    }).run();

    expect(attempts).toEqual(["signal-fails-1"]);
    expect(run).toMatchObject({
      status: "FAILED",
      runs: 1,
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    expect(run.failures).toHaveLength(1);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      { signalId: "signal-fails-1", status: "TO_DELIVER" },
      { signalId: "signal-fails-2", status: "TO_DELIVER" },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid loop limits before a run starts: %s",
    (limit) => {
      expect(
        () =>
          new DeliveryLoop({
            delivery: createDelivery(),
            shard: ShardIndex.single(),
            node: "node-a",
            limit,
            onMessage: () => undefined,
          }),
      ).toThrow("DeliveryLoop limit must be a positive safe integer.");
    },
  );

  it("rejects maxFailures above the practical loop bound before a run starts", () => {
    expect(
      () =>
        new DeliveryLoop({
          delivery: createDelivery(),
          shard: ShardIndex.single(),
          node: "node-a",
          maxFailures: 1_001,
          onMessage: () => undefined,
        }),
    ).toThrow("DeliveryLoop maxFailures must be a positive safe integer at most 1000.");
  });

  it("rejects loop read limits above the storage bound", async () => {
    const loop = new DeliveryLoop({
      delivery: createDelivery(),
      shard: ShardIndex.single(),
      node: "node-a",
      limit: 1_001,
      onMessage: () => undefined,
    });

    await expect(loop.run()).rejects.toThrow(
      "Inbox read limit must be a positive safe integer at most 1000.",
    );
  });
});

function createDelivery(storageFactory = new InMemoryStorageFactory()): Delivery {
  return new Delivery({
    context: { name: "Tasks", multitenant: false },
    storageFactory,
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
