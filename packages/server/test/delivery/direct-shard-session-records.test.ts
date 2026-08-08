import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import {
  ShardIndexSchema,
  ShardSessionRecordSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";

import {
  ShardSession,
  ShardedWorkRegistry,
  shardSessionRecordSpec,
  shardedWorkRegistryAccess,
} from "../../src/delivery/sharded-work-registry.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

describe("direct ShardSessionRecord storage", () => {
  it("uses the generated session record and shard index directly", () => {
    expect(shardSessionRecordSpec.sourceType).toBe(ShardSessionRecordSchema);
    expect(shardSessionRecordSpec.recordType).toBe(ShardSessionRecordSchema);
    expect(shardSessionRecordSpec.idType).toBe(ShardIndexSchema);
    expect(shardSessionRecordSpec.columns).toEqual([]);
  });

  it("rejects shard ownership mutations on a non-atomic handle", async () => {
    const factory = new InMemoryStorageFactory();
    const original = factory.createRecordStorage.bind(factory);
    let atomic = true;
    vi.spyOn(factory, "createRecordStorage").mockImplementation((context, spec) => {
      const storage = original(context, spec);
      Object.defineProperty(storage, "atomicCompareAndSet", { get: () => atomic });
      return storage;
    });
    const shards = registry(factory, () => new Date(0), "Atomic");
    const session = await shards.pickUp(ShardIndex.single(), worker("node", "worker"));
    if (session === undefined) throw new Error("Expected initial shard ownership.");
    atomic = false;
    await expect(shards.pickUp(ShardIndex.single(), worker("node", "worker"))).rejects.toThrow(
      "atomic",
    );
    await expect(shards.renew(session)).rejects.toThrow("atomic");
    await expect(shards.release(session)).rejects.toThrow("atomic");
  });

  it("fences a stale complete worker after exact derived-lease expiry", async () => {
    let now = 1_000;
    const clock = () => new Date(now);
    const storageFactory = new InMemoryStorageFactory();
    const firstRegistry = registry(storageFactory, clock, "Tasks");
    const secondRegistry = registry(storageFactory, clock, "Tasks");
    const shard = ShardIndex.single();
    const first = await firstRegistry.pickUp(shard, worker("node-a", "worker-a"));

    expect(first).toBeInstanceOf(ShardSession);
    if (first === undefined) throw new Error("First worker did not acquire the shard.");
    await expect(
      secondRegistry.pickUp(shard, worker("node-b", "worker-b")),
    ).resolves.toBeUndefined();
    now = 2_000;
    const takeover = await secondRegistry.pickUp(shard, worker("node-b", "worker-b"));
    expect(takeover?.worker?.nodeId?.value).toBe("node-b");
    expect(takeover?.worker?.value).toBe("worker-b");
    await expect(firstRegistry.renew(first)).resolves.toBeUndefined();
    await expect(firstRegistry.release(first)).resolves.toBe(false);
  });

  it("uses the supplied WorkerId unchanged across pickups and accepts a new restart identity", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = registry(storageFactory, () => new Date(0), "Tasks");
    const second = registry(storageFactory, () => new Date(0), "Other");
    const current = worker("node-a", "worker-a");

    const firstPickup = await first.pickUp(new ShardIndex(0, 2), current);
    const secondPickup = await first.pickUp(new ShardIndex(1, 2), current);
    const restartedPickup = await second.pickUp(ShardIndex.single(), worker("node-a", "worker-b"));

    expect(firstPickup?.worker?.value).toBe("worker-a");
    expect(secondPickup?.worker?.value).toBe("worker-a");
    expect(restartedPickup?.worker?.value).toBe("worker-b");
  });

  it("converges lost acquisition, renewal, and release acknowledgements for the same worker", async () => {
    let now = 0;
    const workRegistry = registry(new InMemoryStorageFactory(), () => new Date(now), "Tasks");
    const shard = ShardIndex.single();
    const currentWorker = worker("node-a", "worker-a");
    const pickup = await workRegistry.pickUp(shard, currentWorker);
    if (pickup === undefined) throw new Error("Worker did not acquire the shard.");

    expect(await workRegistry.pickUp(shard, currentWorker)).toMatchObject({
      worker: currentWorker,
    });

    now = 100;
    const renewed = await workRegistry.renew(pickup);
    expect(await workRegistry.renew(pickup)).toMatchObject({ pickedUpAt: new Date(100) });
    if (renewed === undefined) throw new Error("Worker did not renew the shard.");

    expect(await workRegistry.release(renewed)).toBe(true);
    await expect(workRegistry.release(renewed)).resolves.toBe(true);
  });

  it("drains a shard until a rescan sees no pending work, including an arrival during the drain", async () => {
    const shards = registry(new InMemoryStorageFactory(), () => new Date(0), "Tasks");
    const pending = ["first"];
    const delivered: string[] = [];

    await shards.drainUntilEmpty(
      ShardIndex.single(),
      worker("node-a", "worker-a"),
      () => Promise.resolve(Object.freeze([...pending])),
      (message) => {
        delivered.push(message);
        pending.splice(pending.indexOf(message), 1);
        if (message === "first") pending.push("second");
        return Promise.resolve();
      },
    );

    expect(delivered).toEqual(["first", "second"]);
  });

  it("returns cleanly when a replacement takes ownership during a drain", async () => {
    let now = 0;
    const storageFactory = new InMemoryStorageFactory();
    const first = registry(storageFactory, () => new Date(now), "Tasks");
    const replacement = registry(storageFactory, () => new Date(now), "Tasks");
    const pending = ["first", "second"];

    await expect(
      first.drainUntilEmpty(
        ShardIndex.single(),
        worker("node-a", "worker-a"),
        () => Promise.resolve(Object.freeze([...pending])),
        async (message) => {
          pending.splice(pending.indexOf(message), 1);
          now = 1_000;
          await replacement.pickUp(ShardIndex.single(), worker("node-b", "worker-b"));
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid worker, clock, and lease inputs before durable mutation", async () => {
    const storage = new InMemoryStorageFactory();
    const shards = registry(storage, () => new Date(0), "Tasks");

    await expect(shards.pickUp(ShardIndex.single(), worker("", "worker"))).rejects.toThrow(
      "worker",
    );
    await expect(
      registry(storage, () => new Date(Number.NaN), "Invalid").pickUp(
        ShardIndex.single(),
        worker("node", "worker"),
      ),
    ).rejects.toThrow("time");
    expect(() => registry(storage, () => new Date(0), "Invalid")).not.toThrow();
  });

  it("fails closed for corrupt records and identifies its exact storage configuration", async () => {
    const storage = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false } as const;
    const shards = new ShardedWorkRegistry({
      context,
      storageFactory: storage,
      now: () => new Date(0),
    });
    const records = storage.createRecordStorage(
      { name: "Tasks.delivery.shards", multitenant: false },
      shardSessionRecordSpec,
    );
    await records.write(
      create(ShardSessionRecordSchema, {
        index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        whenLastPicked: { seconds: 0n, nanos: -1 },
      }),
    );
    await expect(shards.pickUp(ShardIndex.single(), worker("node", "worker"))).rejects.toThrow(
      "time",
    );
    expect(shardedWorkRegistryAccess.matches(shards, context, storage)).toBe(true);
    expect(
      shardedWorkRegistryAccess.matches(shards, { name: "Other", multitenant: false }, storage),
    ).toBe(false);
    expect(shardedWorkRegistryAccess.matches(shards, context, new InMemoryStorageFactory())).toBe(
      false,
    );
  });

  it("rejects a persisted pickup whose derived lease runs beyond the Date limit", async () => {
    const record = create(ShardSessionRecordSchema, {
      index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
      whenLastPicked: { seconds: 8_640_000_000_000n, nanos: 0 },
      worker: worker("node", "worker"),
    });
    const handle = {
      atomicCompareAndSet: true,
      read: vi.fn(() => Promise.resolve(record)),
      close: vi.fn(),
    };
    const shards = new ShardedWorkRegistry({
      context: { name: "Limit", multitenant: false },
      storageFactory: { createRecordStorage: () => handle } as never,
      leaseMs: 1_000,
      now: () => new Date(0),
    });

    await expect(shards.pickUp(ShardIndex.single(), worker("node", "worker"))).rejects.toThrow(
      "lease expiry",
    );
  });

  it("handles absent, expired, unowned, and malformed direct session rows", async () => {
    let now = 0;
    const storage = new InMemoryStorageFactory();
    const shards = registry(storage, () => new Date(now), "Tasks");
    const shard = ShardIndex.single();
    const expected = new ShardSession(
      shard,
      worker("node", "worker"),
      new Date(0),
      new Date(1_000),
    );

    await expect(shards.renew(expected)).resolves.toBeUndefined();
    await expect(shards.release(expected)).resolves.toBe(false);
    await shards.pickUp(shard, worker("node", "worker"));
    now = 1_000;
    await expect(shards.renew(expected)).resolves.toBeUndefined();

    const records = storage.createRecordStorage(
      { name: "Unowned.delivery.shards", multitenant: false },
      shardSessionRecordSpec,
    );
    await records.write(
      create(ShardSessionRecordSchema, {
        index: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
        whenLastPicked: { seconds: 0n, nanos: 0 },
      }),
    );
    const unowned = registry(storage, () => new Date(0), "Unowned");
    await expect(unowned.release(expected)).resolves.toBe(true);
  });

  it("releases an empty drain and rejects every incomplete WorkerId form", async () => {
    const shards = registry(new InMemoryStorageFactory(), () => new Date(0), "Tasks");
    await expect(
      shards.drainUntilEmpty(
        ShardIndex.single(),
        worker("node", "worker"),
        () => Promise.resolve([]),
        () => Promise.resolve(),
      ),
    ).resolves.toBeUndefined();
    for (const invalid of [
      create(WorkerIdSchema),
      create(WorkerIdSchema, { nodeId: { value: "node" } }),
      create(WorkerIdSchema, { nodeId: { value: " " }, value: "worker" }),
    ]) {
      await expect(shards.pickUp(ShardIndex.single(), invalid)).rejects.toThrow("worker");
    }
  });

  it("returns without draining unavailable ownership and retains an expired owned row", async () => {
    let now = 0;
    const storage = new InMemoryStorageFactory();
    const first = registry(storage, () => new Date(now), "Tasks");
    const second = registry(storage, () => new Date(now), "Tasks");
    const shard = ShardIndex.single();
    const session = await first.pickUp(shard, worker("node-a", "worker-a"));
    if (session === undefined) throw new Error("First worker did not acquire the shard.");
    let reads = 0;

    await second.drainUntilEmpty(
      shard,
      worker("node-b", "worker-b"),
      () => {
        reads += 1;
        return Promise.resolve([]);
      },
      () => Promise.resolve(),
    );
    expect(reads).toBe(0);
    now = 1_000;
    await expect(first.release(session)).resolves.toBe(false);

    const defaultLease = new ShardedWorkRegistry({
      context: { name: "Tenanted", multitenant: true, tenantId: "tenant-a" },
      storageFactory: storage,
      now: () => new Date(0),
    });
    await expect(defaultLease.pickUp(shard, worker("node-c", "worker-c"))).resolves.toBeTruthy();
  });
});

function worker(node: string, value: string) {
  return create(WorkerIdSchema, { nodeId: { value: node }, value });
}

function registry(storageFactory: InMemoryStorageFactory, now: () => Date, name: string) {
  return new ShardedWorkRegistry({
    context: { name, multitenant: false },
    storageFactory,
    leaseMs: 1_000,
    now,
  });
}
