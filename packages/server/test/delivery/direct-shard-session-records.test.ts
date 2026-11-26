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

import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import {
  ShardIndexSchema,
  ShardSessionRecordSchema,
  WorkerIdSchema,
  type ShardIndex as WireShardIndex,
  type ShardSessionRecord,
} from "@spine-event-engine/proto/delivery";

import {
  ShardSession,
  ShardedWorkRegistry,
  shardSessionRecordSpec,
  shardedWorkRegistryAccess,
} from "../../src/delivery/sharded-work-registry.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { tenant } from "../tenant-fixture.js";

describe("direct ShardSessionRecord storage", () => {
  it("cancels pickup before a CAS attempt and renewal after repeated conflicts", async () => {
    const delegate = new InMemoryStorageFactory().createRecordStorage(
      { name: "Canceled.delivery.shards", multitenant: false },
      shardSessionRecordSpec,
    );
    let conflicts = false;
    let attempts = 0;
    const handle = {
      atomicCompareAndSet: true,
      read: (id: WireShardIndex) => delegate.read(id),
      compareAndSet: (
        id: WireShardIndex,
        prior: ShardSessionRecord | undefined,
        next: ShardSessionRecord | undefined,
      ) => {
        attempts += 1;
        return conflicts ? Promise.resolve(false) : delegate.compareAndSet(id, prior, next);
      },
      close: () => {
        delegate.close();
      },
    };
    const shards = new ShardedWorkRegistry({
      context: { name: "Canceled", multitenant: false },
      storageFactory: { createRecordStorage: () => handle } as never,
      now: () => new Date(0),
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      shards.pickUp(ShardIndex.single(), worker("node", "worker"), {
        signal: controller.signal,
      }),
    ).rejects.toThrow("canceled");
    expect(attempts).toBe(0);

    const current = await shards.pickUp(ShardIndex.single(), worker("node", "worker"));
    if (current === undefined) throw new Error("Expected shard pickup.");
    conflicts = true;
    const renewal = new AbortController();
    const pending = shards.renew(current, { signal: renewal.signal });
    await vi.waitFor(() => {
      expect(attempts).toBeGreaterThan(9);
    });
    renewal.abort();
    await expect(pending).rejects.toThrow("canceled");
    await shards.close();
  });

  it("tries to release a held session once after cancellation", async () => {
    const delegate = new InMemoryStorageFactory().createRecordStorage(
      { name: "ReleaseCanceled.delivery.shards", multitenant: false },
      shardSessionRecordSpec,
    );
    let conflict = false;
    let attempts = 0;
    const handle = {
      atomicCompareAndSet: true,
      read: (id: WireShardIndex) => delegate.read(id),
      compareAndSet: (
        id: WireShardIndex,
        prior: ShardSessionRecord | undefined,
        next: ShardSessionRecord | undefined,
      ) => {
        attempts += 1;
        return conflict ? Promise.resolve(false) : delegate.compareAndSet(id, prior, next);
      },
      close: () => {
        delegate.close();
      },
    };
    const shards = new ShardedWorkRegistry({
      context: { name: "ReleaseCanceled", multitenant: false },
      storageFactory: { createRecordStorage: () => handle } as never,
      now: () => new Date(0),
    });
    const current = await shards.pickUp(ShardIndex.single(), worker("node", "worker"));
    if (current === undefined) throw new Error("Expected shard pickup.");
    const controller = new AbortController();
    controller.abort();
    await expect(shards.release(current, { signal: controller.signal })).resolves.toBe(true);
    expect(attempts).toBe(2);
    const held = await shards.pickUp(ShardIndex.single(), worker("node", "worker"));
    if (held === undefined) throw new Error("Expected shard pickup.");
    conflict = true;
    await expect(shards.release(held, { signal: controller.signal })).rejects.toThrow("canceled");
    expect(attempts).toBe(4);
    await shards.close();
  });

  it("completes pickup, renewal, and release after nine CAS conflicts each", async () => {
    const delegate = new InMemoryStorageFactory().createRecordStorage(
      { name: "Conflicts.delivery.shards", multitenant: false },
      shardSessionRecordSpec,
    );
    let clashes = 9;
    let attempts = 0;
    const handle = {
      atomicCompareAndSet: true,
      read: (id: WireShardIndex) => delegate.read(id),
      compareAndSet: (
        id: WireShardIndex,
        prior: ShardSessionRecord | undefined,
        next: ShardSessionRecord | undefined,
      ) => {
        attempts += 1;
        if (clashes-- > 0) return Promise.resolve(false);
        return delegate.compareAndSet(id, prior, next);
      },
      close: () => {
        delegate.close();
      },
    };
    let now = 0;
    const shards = new ShardedWorkRegistry({
      context: { name: "Conflicts", multitenant: false },
      storageFactory: { createRecordStorage: () => handle } as never,
      leaseMs: 1_000,
      now: () => new Date(now),
    });
    const shard = ShardIndex.single();
    const first = await shards.pickUp(shard, worker("node", "worker"));
    expect(first).toBeDefined();
    expect(attempts).toBe(10);
    if (first === undefined) throw new Error("Expected shard pickup.");
    clashes = 9;
    now = 100;
    const renewed = await shards.renew(first);
    expect(renewed).toBeDefined();
    expect(attempts).toBe(20);
    if (renewed === undefined) throw new Error("Expected shard renewal.");
    clashes = 9;
    await expect(shards.release(renewed)).resolves.toBe(true);
    expect(attempts).toBe(30);
    await shards.close();
  });

  it("observes a changed worker after repeated conflicts", async () => {
    const delegate = new InMemoryStorageFactory().createRecordStorage(
      { name: "Closing.delivery.shards", multitenant: false },
      shardSessionRecordSpec,
    );
    let attempts = 0;
    let replace = true;
    const otherWorker = worker("node-b", "worker-b");
    const handle = {
      atomicCompareAndSet: true,
      read: (id: WireShardIndex) => delegate.read(id),
      compareAndSet: async (
        id: WireShardIndex,
        prior: ShardSessionRecord | undefined,
        next: ShardSessionRecord | undefined,
      ) => {
        attempts += 1;
        if (replace && attempts === 9) {
          await delegate.compareAndSet(
            id,
            prior,
            create(ShardSessionRecordSchema, {
              index: id,
              whenLastPicked: { seconds: 0n },
              worker: otherWorker,
            }),
          );
          return false;
        }
        if (replace) return false;
        return delegate.compareAndSet(id, prior, next);
      },
      close: () => {
        delegate.close();
      },
    };
    const shards = new ShardedWorkRegistry({
      context: { name: "Closing", multitenant: false },
      storageFactory: { createRecordStorage: () => handle } as never,
      leaseMs: 1_000,
      now: () => new Date(0),
    });
    await expect(
      shards.pickUp(ShardIndex.single(), worker("node-a", "worker-a")),
    ).resolves.toBeUndefined();
    expect(attempts).toBe(9);
    replace = false;
    const other = await shards.pickUp(ShardIndex.single(), otherWorker);
    expect(other?.worker?.value).toBe("worker-b");
    await shards.close();
  });

  it("closes an admitted pickup despite continued CAS conflicts", async () => {
    let attempts = 0;
    const handle = {
      atomicCompareAndSet: true,
      read: () => Promise.resolve(undefined),
      compareAndSet: () => {
        attempts += 1;
        return Promise.resolve(false);
      },
      close: vi.fn(() => undefined),
    };
    const shards = new ShardedWorkRegistry({
      context: { name: "ClosingConflicts", multitenant: false },
      storageFactory: { createRecordStorage: () => handle } as never,
      leaseMs: 1_000,
      now: () => new Date(0),
    });
    const settled = shards.pickUp(ShardIndex.single(), worker("node", "worker")).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => {
      expect(attempts).toBeGreaterThan(8);
    });
    const closing = shards.close();
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("Shard registry is closed.");
    await expect(closing).resolves.toBeUndefined();
    expect(handle.close).toHaveBeenCalledOnce();
  });
  it("retains one record handle across shard operations until close", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const shards = registry(factory, () => new Date(0), "RetainedShards");
    const shard = ShardIndex.single();
    const current = await shards.pickUp(shard, worker("node", "retained"));
    expect(current).toBeDefined();
    if (current === undefined) throw new Error("Expected the shard session.");
    await shards.renew(current);
    expect(opened).toHaveBeenCalledTimes(1);
    await shards.close();
    await expect(shards.pickUp(shard, worker("node", "new"))).rejects.toThrow("closed");
  });

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

  it("rejects non-ShardIndex input before opening durable shard storage", async () => {
    const shards = registry(new InMemoryStorageFactory(), () => new Date(0), "InvalidShard");

    await expect(shards.pickUp({} as ShardIndex, worker("node", "worker"))).rejects.toThrow(
      "Shard index is invalid.",
    );
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

  it("rejects a persisted session whose embedded shard differs from its storage key", async () => {
    const handle = {
      atomicCompareAndSet: true,
      read: vi.fn(() =>
        Promise.resolve(
          create(ShardSessionRecordSchema, {
            index: create(ShardIndexSchema, { index: 1, ofTotal: 2 }),
            whenLastPicked: { seconds: 0n, nanos: 0 },
            worker: worker("node", "worker"),
          }),
        ),
      ),
      close: vi.fn(),
    };
    const shards = new ShardedWorkRegistry({
      context: { name: "Mismatched", multitenant: false },
      storageFactory: { createRecordStorage: () => handle } as never,
      now: () => new Date(0),
    });

    await expect(shards.pickUp(ShardIndex.single(), worker("node", "worker"))).rejects.toThrow(
      "does not match its storage ID",
    );
    expect(handle.close).not.toHaveBeenCalled();
    await shards.close();
    expect(handle.close).toHaveBeenCalledOnce();
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

  it("rejects a local lease whose expiry cannot be represented as a Date", async () => {
    const factory = new InMemoryStorageFactory();
    const shards = new ShardedWorkRegistry({
      context: { name: "LocalDateLimit", multitenant: false },
      storageFactory: factory,
      leaseMs: 8_640_000_000_000_001,
      now: () => new Date(0),
    });
    await expect(shards.pickUp(ShardIndex.single(), worker("node", "worker"))).rejects.toThrow(
      "Shard lease expiry is invalid.",
    );
    const records = factory.createRecordStorage(
      { name: "LocalDateLimit.delivery.shards", multitenant: false },
      shardSessionRecordSpec,
    );
    await expect(
      records.read(create(ShardIndexSchema, { index: 0, ofTotal: 1 })),
    ).resolves.toBeUndefined();
    await shards.close();
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

    expect(
      () =>
        new ShardedWorkRegistry({
          context: { name: "Tenanted", multitenant: true, tenantId: tenant("tenant-a") },
          storageFactory: storage,
          now: () => new Date(0),
        }),
    ).toThrow("Shard registry requires a single-tenant Delivery context.");
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
