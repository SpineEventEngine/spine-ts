import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { Delivery, ShardIndex } from "../../src/index.js";

describe("ShardedWorkRegistry", () => {
  it("picks up one shard once across shared storage and releases it for the next worker", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 30_000,
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 30_000,
    });
    const shard = new ShardIndex(1, 4);
    const now = new Date("2026-07-02T09:00:00.000Z");

    const session = await first.shards.pickUp(shard, "node-a", now);
    if (session === undefined) {
      throw new Error("Expected first shard pickup to create a session.");
    }

    expect(session.node).toBe("node-a");
    await expect(second.shards.pickUp(shard, "node-b", now)).resolves.toBeUndefined();
    await expect(first.shards.release(session)).resolves.toBe(true);

    await expect(second.shards.pickUp(shard, "node-b", now)).resolves.toMatchObject({
      node: "node-b",
      shard,
    });
  });

  it("replaces expired shard sessions from storage-backed state", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 500,
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 500,
    });
    const shard = new ShardIndex(0, 2);

    const firstSession = await first.shards.pickUp(
      shard,
      "node-a",
      new Date("2026-07-02T09:10:00.000Z"),
    );
    const secondSession = await second.shards.pickUp(
      shard,
      "node-b",
      new Date("2026-07-02T09:10:01.000Z"),
    );

    expect(firstSession?.node).toBe("node-a");
    expect(secondSession).toMatchObject({
      node: "node-b",
      shard,
    });
  });
});
