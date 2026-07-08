import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { Delivery, ShardIndex, type InboxId, type InboxMessage } from "../../src/index.js";

describe("Delivery worker", () => {
  it("skips without dispatch when another worker owns the shard", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();

    await seed(first, "signal-1", 1n);
    const session = await first.shards.pickUp(shard, "node-a");
    const seen: string[] = [];

    const run = await second.drain(shard, {
      node: "node-b",
      deliver(message) {
        seen.push(message.signalId);
      },
    });

    expect(session).toBeDefined();
    expect(run).toMatchObject({
      status: "SKIPPED",
      processed: 0,
      delivered: 0,
      failed: 0,
    });
    expect(run.failures).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("marks successful messages delivered and reports run statistics", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-2", 2n);
    await seed(delivery, "signal-1", 1n);

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      deliver(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-1", "signal-2"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 2,
      delivered: 2,
      failed: 0,
    });
    expect(run.failures).toEqual([]);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
      { signalId: "signal-1", status: "DELIVERED" },
      { signalId: "signal-2", status: "DELIVERED" },
    ]);
  });

  it("honors a run limit and leaves later pending rows for another drain", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-1", 1n);
    await seed(delivery, "signal-2", 2n);
    await seed(delivery, "signal-3", 3n);

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      limit: 2,
      deliver(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-1", "signal-2"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 2,
      delivered: 2,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-3", status: "TO_DELIVER" },
    ]);
  });

  it("leaves failed messages pending for retry and records failures", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-fail", 1n);
    await seed(delivery, "signal-ok", 2n);

    const firstRun = await delivery.drain(shard, {
      node: "node-a",
      deliver(message) {
        if (message.signalId === "signal-fail") {
          throw new Error("endpoint failed");
        }
      },
    });

    expect(firstRun).toMatchObject({
      status: "DRAINED",
      processed: 2,
      delivered: 1,
      failed: 1,
    });
    expect(firstRun.failures).toHaveLength(1);
    expect(firstRun.failures[0]?.message.signalId).toBe("signal-fail");
    expect(firstRun.failures[0]?.error).toBeInstanceOf(Error);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-fail", status: "TO_DELIVER" },
    ]);

    const retried: string[] = [];
    const retryRun = await delivery.drain(shard, {
      node: "node-a",
      deliver(message) {
        retried.push(message.signalId);
      },
    });

    expect(retried).toEqual(["signal-fail"]);
    expect(retryRun).toMatchObject({
      status: "DRAINED",
      processed: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
  });

  it("releases the shard after endpoint failure", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-1", 1n);
    await delivery.drain(shard, {
      node: "node-a",
      deliver() {
        throw new Error("endpoint failed");
      },
    });

    await expect(delivery.shards.pickUp(shard, "node-b")).resolves.toMatchObject({
      node: "node-b",
      shard,
    });
  });

  it("keeps delivered rows with live retention as duplicate write guards", async () => {
    const now = { value: new Date("2026-07-08T09:00:00.000Z") };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => now.value,
    });
    const inboxId = targetInbox();
    const shard = ShardIndex.single();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");

    const written = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      keepUntil,
    });

    const delivered: string[] = [];
    await delivery.drain(shard, {
      node: "node-a",
      deliver(message) {
        delivered.push(message.signalId);
      },
    });

    const duplicate = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:01:00.000Z"),
      version: 2n,
    });

    expect(duplicate.outcome).toBe("DUPLICATE");
    expect(delivered).toEqual(["signal-1"]);
    expect(duplicate.message.id).toEqual(written.message.id);
    expect(duplicate.message.status).toBe("DELIVERED");
    expect(duplicate.message.keepUntil).toEqual(keepUntil);
  });

  it("keeps the delivered marker idempotent and ignores non-pending rows", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    const delivered = await seed(delivery, "signal-delivered", 1n);
    await delivery.drain(shard, {
      node: "node-a",
      deliver(message) {
        expect(message.signalId).toBe("signal-delivered");
      },
    });
    const deliveredRows = await delivery.inbox.read(shard, { statuses: ["DELIVERED"] });

    await expect(delivery.inbox.markDelivered(deliveredRows[0] ?? delivered)).resolves.toMatchObject(
      {
        signalId: "signal-delivered",
        status: "DELIVERED",
      },
    );

    const scheduled = await delivery.inbox.receive({
      inboxId: targetInbox(),
      signalId: "signal-scheduled",
      label: "UPDATE_SUBSCRIBER",
      status: "SCHEDULED",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 2n,
    });

    await expect(delivery.inbox.markDelivered(scheduled.message)).resolves.toBeUndefined();
    await expect(delivery.inbox.markDelivered(missingMessage())).resolves.toBeUndefined();
  });
});

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

function missingMessage(): InboxMessage {
  return Object.freeze({
    id: Object.freeze({
      value: "missing-message",
      shard: ShardIndex.single(),
    }),
    inboxId: targetInbox(),
    signalId: "signal-missing",
    label: "UPDATE_SUBSCRIBER" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
    whenReceived: new Date("2026-07-08T09:00:00.000Z"),
    version: 99n,
  });
}
