import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { Delivery, ShardIndex } from "../../src/index.js";

describe("ShardedWorkRegistry", () => {
  it("picks up one shard once across shared storage and releases it for the next worker", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const now = { value: new Date("2026-07-02T09:00:00.000Z") };
    const first = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 30_000,
      now: () => now.value,
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 30_000,
      now: () => now.value,
    });
    const shard = new ShardIndex(1, 4);

    const session = await first.shards.pickUp(shard, "node-a");
    if (session === undefined) {
      throw new Error("Expected first shard pickup to create a session.");
    }

    expect(session.node).toBe("node-a");
    await expect(second.shards.pickUp(shard, "node-b")).resolves.toBeUndefined();
    await expect(first.shards.release(session)).resolves.toBe(true);

    await expect(second.shards.pickUp(shard, "node-b")).resolves.toMatchObject({
      node: "node-b",
      shard,
    });
  });

  it("replaces expired shard sessions from storage-backed state", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const firstNow = { value: new Date("2026-07-02T09:10:00.000Z") };
    const secondNow = { value: new Date("2026-07-02T09:10:00.000Z") };
    const first = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 500,
      now: () => firstNow.value,
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 500,
      now: () => secondNow.value,
    });
    const shard = new ShardIndex(0, 2);

    const firstSession = await first.shards.pickUp(shard, "node-a");
    secondNow.value = new Date("2026-07-02T09:10:01.000Z");
    const secondSession = await second.shards.pickUp(shard, "node-b");

    expect(firstSession?.node).toBe("node-a");
    expect(secondSession).toMatchObject({
      node: "node-b",
      shard,
    });
  });
});
