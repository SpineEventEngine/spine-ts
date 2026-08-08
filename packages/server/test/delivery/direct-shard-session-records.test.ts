import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
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
} from "../../src/delivery/sharded-work-registry.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";

describe("direct ShardSessionRecord storage", () => {
  it("uses the generated session record and shard index directly", () => {
    expect(shardSessionRecordSpec.sourceType).toBe(ShardSessionRecordSchema);
    expect(shardSessionRecordSpec.recordType).toBe(ShardSessionRecordSchema);
    expect(shardSessionRecordSpec.idType).toBe(ShardIndexSchema);
    expect(shardSessionRecordSpec.columns).toEqual([]);
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
    await expect(
      secondRegistry.pickUp(shard, worker("node-b", "worker-b")),
    ).resolves.toBeUndefined();
    now = 2_000;
    const takeover = await secondRegistry.pickUp(shard, worker("node-b", "worker-b"));
    expect(takeover?.worker?.nodeId?.value).toBe("node-b");
    expect(takeover?.worker?.value).toBe("worker-b");
    await expect(firstRegistry.renew(first!)).resolves.toBeUndefined();
    await expect(firstRegistry.release(first!)).resolves.toBe(false);
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

  it("drains a shard until a rescan sees no pending work, including an arrival during the drain", async () => {
    const shards = registry(new InMemoryStorageFactory(), () => new Date(0), "Tasks");
    const pending = ["first"];
    const delivered: string[] = [];

    await shards.drainUntilEmpty(
      ShardIndex.single(),
      worker("node-a", "worker-a"),
      async () => Object.freeze([...pending]),
      async (message) => {
        delivered.push(message);
        pending.splice(pending.indexOf(message), 1);
        if (message === "first") pending.push("second");
      },
    );

    expect(delivered).toEqual(["first", "second"]);
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
