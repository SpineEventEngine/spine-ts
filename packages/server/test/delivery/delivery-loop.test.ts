import { InMemoryStorageFactory, type StorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import {
  Delivery,
  deliveryAccess,
  type DeliveryDrainOutcome,
  type DeliveryEndpointMessage,
} from "../../src/delivery/delivery.js";
import { deliveryAttemptCapacity } from "../../src/delivery/delivery-attempts.js";
import { DeliveryLoop, deliveryLoopAccess } from "../../src/delivery/delivery-loop.js";
import { InboxRecords } from "../../src/delivery/inbox-records.js";
import { ShardSession, ShardIndex, type InboxId, type InboxMessage } from "../../src/index.js";
import { inboxStorageAccess } from "../../src/delivery/inbox-storage.js";
import {
  deliveryInboxRecords,
  deliveryStorageFaults,
  messageKey,
  onInboxQueryNumber,
} from "./delivery-storage-fault-fixture.js";
import { oversizedText, oversizedVersion } from "./inbox-message-fixture.js";

describe("DeliveryLoop", () => {
  it("excludes normally ordered callback writes from the admitted epoch", async () => {
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

    expect(seen).toEqual(["signal-1"]);
    expect(run).toMatchObject({
      status: "IDLE",
      processed: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal-2", status: "TO_DELIVER" }]);

    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 1, failed: 0 });
    expect(seen).toEqual(["signal-1", "signal-2"]);
  });

  it("excludes backdated callback writes from the admitted epoch", async () => {
    const delivery = createDelivery();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      limit: 1,
      async onMessage(message) {
        seen.push(message.signalId);
        if (message.signalId === "signal-admitted") {
          await delivery.inbox.receive({
            inboxId: targetInbox(),
            signalId: "signal-backdated",
            label: "UPDATE_SUBSCRIBER",
            status: "TO_DELIVER",
            shard: ShardIndex.single(),
            whenReceived: new Date("2026-07-08T08:00:00.000Z"),
            version: 0n,
          });
        }
      },
    });

    await seed(delivery, "signal-admitted", 1n);

    await expect(loop.run()).resolves.toMatchObject({
      status: "IDLE",
      processed: 1,
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-admitted"]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal-backdated", status: "TO_DELIVER" }]);

    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 1, failed: 0 });
    expect(seen).toEqual(["signal-admitted", "signal-backdated"]);
  });

  it("drains a capped unsupported epoch with one query and no point reads", async () => {
    const faults = deliveryStorageFaults(onInboxQueryNumber(2, onInterPageQuery));
    const delivery = createDelivery(faults.storageFactory);
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    for (let index = 1; index <= inboxStorageAccess.maxReadLimit; index += 1) {
      await seed(delivery, `signal-prefix-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    const inboxReadsBeforeRun = faults.inboxReads;

    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 0 });
    expect(faults.inboxQueries).toBe(1);
    expect(faults.inboxReads - inboxReadsBeforeRun).toBe(0);
    expect(seen).toEqual([]);

    async function onInterPageQuery(): Promise<void> {
      await seed(delivery, "signal-between-pages", 1_001n);
    }
  });

  it("bounds useful work per start and resumes the admitted epoch explicitly", async () => {
    const delivery = createDelivery();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    await seed(delivery, "signal-1", 1n);
    await seed(delivery, "signal-2", 2n);
    await seed(delivery, "signal-3", 3n);

    await expect(loop.run()).resolves.toMatchObject({
      status: "PAUSED",
      runs: 2,
      accepted: 2,
      delivered: 2,
      failed: 0,
    });
    expect(seen).toEqual(["signal-1", "signal-2"]);

    await expect(loop.run()).resolves.toMatchObject({
      status: "IDLE",
      runs: 1,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-1", "signal-2", "signal-3"]);
  });

  it("does not deliver stale admitted rows after durable status and claim changes", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    await seed(delivery, "signal-first", 1n);
    await seed(delivery, "signal-second", 2n);
    const deliveredBeforeDrain = await seed(delivery, "signal-now-delivered", 3n);
    const claimedBeforeDrain = await seed(delivery, "signal-now-claimed", 4n);

    await expect(loop.run()).resolves.toMatchObject({
      status: "PAUSED",
      runs: 2,
      processed: 2,
      accepted: 2,
      delivered: 2,
      failed: 0,
    });
    await expect(delivery.inbox.markDelivered(deliveredBeforeDrain)).resolves.toMatchObject({
      signalId: "signal-now-delivered",
      status: "DELIVERED",
    });
    await expect(
      inboxStorageAccess.claim(
        delivery.inbox.storage,
        claimedBeforeDrain,
        new ShardSession(
          "competing-message-owner",
          shard,
          "node-b",
          new Date("2026-07-12T04:29:00.000Z"),
          new Date("2099-07-12T04:30:00.000Z"),
        ),
      ),
    ).resolves.toMatchObject({ signalId: "signal-now-claimed" });

    await expect(loop.run()).resolves.toMatchObject({
      status: "IDLE",
      runs: 1,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
    expect(seen).toEqual(["signal-first", "signal-second"]);
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

  it("skips a live-owned shard before validating a resume cursor", async () => {
    const faults = deliveryStorageFaults();
    const first = createDelivery(faults.storageFactory);
    const second = createDelivery(faults.storageFactory);
    const shard = ShardIndex.single();
    const session = await first.shards.pickUp(shard, "node-a");

    const outcome = await deliveryAccess.drain(
      second,
      shard,
      { node: "node-b", onMessage: () => undefined },
      { resume: "stale-cursor" as never },
    );

    expect(session).toBeDefined();
    expect(outcome.run).toMatchObject({
      status: "SKIPPED",
      processed: 0,
      delivered: 0,
      failed: 0,
    });
    expect(faults.inboxQueries).toBe(0);
  });

  it("continues a resumed scan after the saved inbox row key", async () => {
    const faults = deliveryStorageFaults();
    const delivery = createDelivery(faults.storageFactory);
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const boundary = await seed(delivery, "signal-resume-boundary", 1n, "CATCH_UP");

    await seed(delivery, "signal-resume-delivered", 2n);

    const outcome = await deliveryAccess.drain(
      delivery,
      shard,
      {
        node: "node-a",
        onMessage(message) {
          seen.push(message.signalId);
        },
      },
      { resume: { after: readContinuation(boundary) } },
    );

    expect(outcome.run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-resume-delivered"]);
    expect(faults.inboxQueries).toBe(1);
  });

  it("rejects oversized resume cursor message IDs before querying inbox storage", async () => {
    const faults = deliveryStorageFaults();
    const delivery = createDelivery(faults.storageFactory);
    const shard = ShardIndex.single();

    await expect(
      deliveryAccess.drain(
        delivery,
        shard,
        { node: "node-a", onMessage: () => undefined },
        {
          resume: {
            after: {
              messageId: oversizedText(16 * 1024 + 1),
              whenReceived: new Date("2026-07-08T09:00:00.000Z"),
              version: 1n,
            },
          },
        },
      ),
    ).rejects.toThrow(/message id exceeds 16384 bytes/i);
    expect(faults.inboxQueries).toBe(0);
  });

  it("rejects oversized resume cursor versions before querying inbox storage", async () => {
    const faults = deliveryStorageFaults();
    const delivery = createDelivery(faults.storageFactory);
    const shard = ShardIndex.single();

    await expect(
      deliveryAccess.drain(
        delivery,
        shard,
        { node: "node-a", onMessage: () => undefined },
        {
          resume: {
            after: {
              messageId: "message-1",
              whenReceived: new Date("2026-07-08T09:00:00.000Z"),
              version: oversizedVersion(),
            },
          },
        },
      ),
    ).rejects.toThrow(/version exceeds 16384 bytes/i);
    expect(faults.inboxQueries).toBe(0);
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

  it("continues across finite skipped epochs to reach a supported tail row", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();
    const unsupportedTail = inboxStorageAccess.maxReadLimit + 2;

    for (let index = 1; index <= unsupportedTail; index += 1) {
      await delivery.inbox.receive({
        inboxId: targetInbox(),
        signalId: `signal-catch-up-${String(index)}`,
        label: "CATCH_UP",
        status: "TO_DELIVER",
        shard,
        whenReceived: new Date("2026-07-08T09:00:00.000Z"),
        version: BigInt(index),
      });
    }
    await seed(delivery, "signal-supported-tail", BigInt(unsupportedTail + 1));
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1_000,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    await expectIdleWithoutDelivery(loop);
    await expectIdleWithoutDelivery(loop);
    const run = await loop.run();

    expect(seen).toEqual(["signal-supported-tail"]);
    expect(run).toMatchObject({ status: "IDLE", runs: 1, accepted: 1, delivered: 1, failed: 0 });
  });

  it("completes a finite skipped-only admitted epoch", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();
    const limit = 1;
    const admittedMessages = inboxStorageAccess.maxReadLimit;

    for (let index = 1; index <= admittedMessages; index += 1) {
      await seed(delivery, `signal-paused-${String(index)}`, BigInt(index), "CATCH_UP");
    }

    const run = await new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit,
      onMessage: () => undefined,
    }).run();

    expect(run).toMatchObject({
      status: "IDLE",
      runs: 1,
      processed: admittedMessages,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
  });

  it("advances the next epoch beyond a capped unsupported prefix", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1_000,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });
    const seen: string[] = [];
    const admissionChunk = inboxStorageAccess.maxReadLimit;
    const unsupportedPrefixEnd = admissionChunk + 1;
    const supportedTailVersion = unsupportedPrefixEnd + 1;

    for (let index = 1; index <= unsupportedPrefixEnd; index += 1) {
      await seed(delivery, `signal-capped-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    await seed(delivery, "signal-after-cap", BigInt(supportedTailVersion));

    await expectIdleWithoutDelivery(loop);
    await expectIdleWithoutDelivery(loop);
    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 1 });

    expect(seen).toEqual(["signal-after-cap"]);
  });

  it("restarts a growing capped admission sweep so later backdated rows stay eligible", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1_000,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });
    const admissionChunk = inboxStorageAccess.maxReadLimit;
    const unsupportedPrefixEnd = admissionChunk + 1;
    const forwardTailVersion = unsupportedPrefixEnd + 1;

    for (let index = 1; index <= unsupportedPrefixEnd; index += 1) {
      await seed(delivery, `signal-prefix-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    await seed(delivery, "signal-forward-tail", BigInt(forwardTailVersion));

    await expectIdleWithoutDelivery(loop);
    await delivery.inbox.receive({
      inboxId: targetInbox(),
      signalId: "signal-later-backdated",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T08:00:00.000Z"),
      version: 0n,
    });
    const growingTailEnd = forwardTailVersion + admissionChunk;
    for (let index = forwardTailVersion + 1; index <= growingTailEnd; index += 1) {
      await seed(delivery, `signal-growing-tail-${String(index)}`, BigInt(index), "CATCH_UP");
    }

    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 1 });
    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 1 });

    expect(seen).toEqual(["signal-later-backdated", "signal-forward-tail"]);
  });

  it("continues the admission sweep when earlier pending rows disappear", async () => {
    const delivery = createDelivery();
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    for (let index = 1; index <= 2_003; index += 1) {
      await seed(delivery, `signal-shifted-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    await seed(delivery, "signal-supported-tail", 2_004n);

    const paused = await loop.run();
    const pending = await delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] });

    expect(paused).toMatchObject({
      status: "IDLE",
      runs: 1,
      processed: inboxStorageAccess.maxReadLimit,
      delivered: 0,
      failed: 0,
    });
    expect(seen).toEqual([]);

    for (const message of pending) {
      await expect(delivery.inbox.markDelivered(message)).resolves.toMatchObject({
        id: message.id,
        status: "DELIVERED",
      });
    }

    await expectIdleWithoutDelivery(loop);
    const resumed = await loop.run();

    expect(resumed).toMatchObject({
      status: "IDLE",
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-supported-tail"]);
  });

  it("rescans before stopping after a resumed skipped-only drain once a head claim is cleared", async () => {
    let now = new Date("2026-07-08T09:00:00.000Z");
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => now,
    });
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    const claimedHead = await seed(delivery, "signal-now-supported", 1n);
    const claim = await inboxStorageAccess.claim(
      delivery.inbox.storage,
      claimedHead,
      new ShardSession(
        "message-owner",
        shard,
        "node-b",
        new Date("2026-07-08T09:00:00.000Z"),
        new Date("2026-07-08T09:01:00.000Z"),
      ),
    );

    for (let index = 2; index <= 2_002; index += 1) {
      await seed(delivery, `signal-paused-${String(index)}`, BigInt(index), "CATCH_UP");
    }

    const paused = await loop.run();

    expect(claim?.signalId).toBe("signal-now-supported");
    expect(paused).toMatchObject({
      status: "IDLE",
      runs: 1,
      processed: inboxStorageAccess.maxReadLimit,
      delivered: 0,
      failed: 0,
    });
    expect(seen).toEqual([]);

    now = new Date("2026-07-08T09:02:00.000Z");
    await clearClaimByRecord(storageFactory, claimedHead);
    await seed(delivery, "signal-skipped-tail", 2_003n, "CATCH_UP");

    const resumed = await loop.run();

    expect(resumed).toMatchObject({
      status: "IDLE",
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-now-supported"]);
  });

  it("advances after reconsidering a cleared head claim", async () => {
    let now = new Date("2026-07-08T09:00:00.000Z");
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => now,
    });
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    const claimedHead = await seed(delivery, "signal-cleared-head", 1n);
    const claim = await inboxStorageAccess.claim(
      delivery.inbox.storage,
      claimedHead,
      new ShardSession(
        "message-owner",
        shard,
        "node-b",
        new Date("2026-07-08T09:00:00.000Z"),
        new Date("2026-07-08T09:01:00.000Z"),
      ),
    );

    for (let index = 2; index <= 1_001; index += 1) {
      await seed(delivery, `signal-paused-${String(index)}`, BigInt(index), "CATCH_UP");
    }

    await expect(loop.run()).resolves.toMatchObject({
      status: "IDLE",
      delivered: 0,
      failed: 0,
    });
    expect(claim?.signalId).toBe("signal-cleared-head");

    now = new Date("2026-07-08T09:02:00.000Z");
    await clearClaimByRecord(storageFactory, claimedHead);
    for (let index = 1_002; index <= 1_004; index += 1) {
      await seed(delivery, `signal-supported-tail-${String(index)}`, BigInt(index));
    }

    await expect(loop.run()).resolves.toMatchObject({
      status: "IDLE",
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-cleared-head"]);

    await expect(loop.run()).resolves.toMatchObject({
      status: "PAUSED",
      delivered: 2,
      failed: 0,
    });
    expect(seen).toEqual([
      "signal-cleared-head",
      "signal-supported-tail-1002",
      "signal-supported-tail-1003",
    ]);

    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 1, failed: 0 });
  });

  it("restarts a pass so a cleared head claim is reconsidered", async () => {
    let now = new Date("2026-07-08T09:00:00.000Z");
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => now,
    });
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    const claimedHead = await seed(delivery, "signal-cleared-head", 1n);
    const claim = await inboxStorageAccess.claim(
      delivery.inbox.storage,
      claimedHead,
      new ShardSession(
        "message-owner",
        shard,
        "node-b",
        new Date("2026-07-08T09:00:00.000Z"),
        new Date("2026-07-08T09:01:00.000Z"),
      ),
    );

    for (let index = 2; index <= 2_002; index += 1) {
      await seed(delivery, `signal-paused-${String(index)}`, BigInt(index), "CATCH_UP");
    }

    const paused = await loop.run();

    expect(claim?.signalId).toBe("signal-cleared-head");
    expect(paused).toMatchObject({
      status: "IDLE",
      delivered: 0,
      failed: 0,
    });
    expect(seen).toEqual([]);

    now = new Date("2026-07-08T09:02:00.000Z");
    await clearClaimByRecord(storageFactory, claimedHead);
    for (let index = 2_003; index <= 4_005; index += 1) {
      await seed(delivery, `signal-skipped-tail-${String(index)}`, BigInt(index), "CATCH_UP");
    }

    const resumed = await loop.run();

    expect(resumed).toMatchObject({
      status: "IDLE",
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-cleared-head"]);
  });

  it("rescans when skipped rows disappear after boundary validation", async () => {
    const race = {
      clearSkippedRows: () => undefined as Promise<void> | void,
    };
    const faults = deliveryStorageFaults(
      onInboxQueryNumber(3, async () => {
        await race.clearSkippedRows();
      }),
    );
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    for (let index = 1; index <= 1_001; index += 1) {
      await seed(delivery, `signal-paused-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    await seed(delivery, "signal-supported-tail", 1_002n);
    const pending = await delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] });

    race.clearSkippedRows = async () => {
      for (const message of pending.slice(0, 1_001)) {
        await delivery.inbox.markDelivered(message);
      }
    };

    await expectIdleWithoutDelivery(loop);
    const run = await loop.run();

    expect(run).toMatchObject({
      status: "IDLE",
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-supported-tail"]);
  });

  it("continues after a skipped page when skipped head rows disappear", async () => {
    const race = {
      clearSkippedRows: () => undefined as Promise<void> | void,
    };
    const faults = deliveryStorageFaults(
      onInboxQueryNumber(3, async () => {
        await race.clearSkippedRows();
      }),
    );
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    for (let index = 1; index <= 1_000; index += 1) {
      await seed(delivery, `signal-disappearing-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    await seed(delivery, "signal-supported-head", 1_001n);
    for (let index = 1_002; index <= 2_001; index += 1) {
      await seed(delivery, `signal-stale-filler-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    const pending = await delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] });

    race.clearSkippedRows = async () => {
      for (const message of pending.slice(0, 1_000)) {
        await delivery.inbox.markDelivered(message);
      }
    };

    await expectIdleWithoutDelivery(loop);
    const run = await loop.run();

    expect(run).toMatchObject({
      status: "IDLE",
      delivered: 1,
      failed: 0,
    });
    expect(seen).toEqual(["signal-supported-head"]);
  });

  it("rejects loop-private drain access for non-owned delivery instances", () => {
    const fake = {
      drain() {
        throw new Error("public drain should not run");
      },
    } as unknown as Delivery;

    expect(() =>
      deliveryAccess.drain(
        fake,
        ShardIndex.single(),
        { node: "node-a", onMessage: () => undefined },
        {},
      ),
    ).toThrow("Loop drain access requires a Delivery instance.");
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

  it("stop during epoch admission prevents the first drain", async () => {
    const admissionStarted = deferred<undefined>();
    const resumeAdmission = deferred<undefined>();
    const faults = deliveryStorageFaults(
      onInboxQueryNumber(1, async () => {
        admissionStarted.resolve(undefined);
        await resumeAdmission.promise;
      }),
    );
    const delivery = createDelivery(faults.storageFactory);
    const seen: string[] = [];
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    await seed(delivery, "signal-admission-stop", 1n);
    const running = loop.run();
    await admissionStarted.promise;

    loop.stop();
    resumeAdmission.resolve(undefined);

    await expect(running).resolves.toMatchObject({ status: "STOPPED", runs: 0, delivered: 0 });
    expect(seen).toEqual([]);
  });

  it("rejects a concurrent run after stop while a drain is active", async () => {
    const delivery = createDelivery();
    const barrier = deferred<undefined>();
    const started = deferred<undefined>();
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage() {
        started.resolve(undefined);
        return barrier.promise;
      },
    });

    await seed(delivery, "signal-active-stop", 1n);
    const running = loop.run();
    await started.promise;

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
    const started = deferred<undefined>();
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage() {
        started.resolve(undefined);
        return barrier.promise;
      },
    });
    let closed = false;

    await seed(delivery, "signal-slow", 1n);
    const running = loop.run();
    await started.promise;
    const closing = loop.close().then(() => {
      closed = true;
    });

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
    const barrier = deferred<DeliveryDrainOutcome>();
    const drainStarted = deferred<undefined>();
    const delivery = createDelivery();
    const restore = deliveryAccess.replace(delivery, () => {
      drains += 1;
      drainStarted.resolve(undefined);
      return barrier.promise;
    });
    let drains = 0;
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage: () => undefined,
    });

    const running = loop.run();
    const runFailure = running.catch((error: unknown) => error);
    await drainStarted.promise;
    const closing = loop.close();
    const closeFailure = closing.catch((error: unknown) => error);

    barrier.reject(failure);

    await expect(closeFailure).resolves.toBe(failure);
    await expect(runFailure).resolves.toBe(failure);
    await expect(loop.run()).resolves.toMatchObject({
      status: "STOPPED",
      runs: 0,
    });
    expect(drains).toBe(1);
    restore();
  });

  it("resets last safe progress before a new epoch admission rejects", async () => {
    const admissionFailure = new Error("admission failed");
    const faults = deliveryStorageFaults(
      onInboxQueryNumber(2, () => {
        throw admissionFailure;
      }),
    );
    const delivery = createDelivery(faults.storageFactory);
    const loop = new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage: () => undefined,
    });

    await seed(delivery, "signal-first-epoch", 1n);
    await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 1 });
    expect(deliveryLoopAccess.progress(loop)).toMatchObject({ runs: 1, delivered: 1 });

    await expect(loop.run()).rejects.toThrow();
    expect(deliveryLoopAccess.progress(loop)).toMatchObject({
      runs: 0,
      processed: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
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

  it("marks an exhausted head without consuming the failure bound before retryable tail callbacks", async () => {
    const delivery = createDelivery();
    const exhausted = await seed(delivery, "signal-exhausted-head", 1n);
    await recordFailures(delivery, exhausted, deliveryAttemptCapacity);
    await seed(delivery, "signal-retryable-tail", 2n);
    const seen: string[] = [];

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      maxFailures: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    }).run();

    expect(seen).toEqual(["signal-retryable-tail"]);
    expect(run).toMatchObject({
      status: "IDLE",
      runs: 1,
      processed: 2,
      accepted: 1,
      delivered: 2,
      failed: 0,
    });
    expect(run.failures).toEqual([]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
  });

  it("keeps successful callbacks in one drain while stopping at the failure bound", async () => {
    const delivery = createDelivery();
    const attempts: string[] = [];

    await seed(delivery, "signal-succeeds-1", 1n);
    await seed(delivery, "signal-succeeds-2", 2n);
    await seed(delivery, "signal-fails-1", 3n);
    await seed(delivery, "signal-fails-2", 4n);

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      onMessage(message) {
        attempts.push(message.signalId);
        if (message.signalId === "signal-fails-1") {
          throw new Error("endpoint failed");
        }
      },
    }).run();

    expect(attempts).toEqual(["signal-succeeds-1", "signal-succeeds-2", "signal-fails-1"]);
    expect(run).toMatchObject({
      status: "FAILED",
      runs: 1,
      processed: 3,
      accepted: 3,
      delivered: 2,
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

  it("retries a failed head row before going idle after a later success", async () => {
    const delivery = createDelivery();
    const attempts: string[] = [];

    await seed(delivery, "signal-fails", 1n);
    await seed(delivery, "signal-succeeds", 2n);

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "node-a",
      maxFailures: 2,
      onMessage(message) {
        attempts.push(message.signalId);
        if (message.signalId === "signal-fails") {
          throw new Error("endpoint failed");
        }
      },
    }).run();

    expect(attempts).toEqual(["signal-fails", "signal-succeeds", "signal-fails"]);
    expect(run).toMatchObject({
      status: "FAILED",
      runs: 2,
      processed: 3,
      accepted: 3,
      delivered: 1,
      failed: 2,
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal-fails", status: "TO_DELIVER" }]);
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

function createDelivery(storageFactory: StorageFactory = new InMemoryStorageFactory()): Delivery {
  return new Delivery({
    context: { name: "Tasks", multitenant: false },
    storageFactory,
  });
}

async function expectIdleWithoutDelivery(loop: DeliveryLoop): Promise<void> {
  await expect(loop.run()).resolves.toMatchObject({ status: "IDLE", delivered: 0, failed: 0 });
}

async function seed(
  delivery: Delivery,
  signalId: string,
  version: bigint,
  label?: DeliveryEndpointMessage["label"],
): Promise<DeliveryEndpointMessage>;
async function seed(
  delivery: Delivery,
  signalId: string,
  version: bigint,
  label: InboxMessage["label"],
): Promise<InboxMessage>;
async function seed(
  delivery: Delivery,
  signalId: string,
  version: bigint,
  label: InboxMessage["label"] = "UPDATE_SUBSCRIBER",
): Promise<InboxMessage> {
  const result = await delivery.inbox.receive({
    inboxId: targetInbox(),
    signalId,
    label,
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived: new Date("2026-07-08T09:00:00.000Z"),
    version,
  });

  return result.message;
}

async function recordFailures(
  delivery: Delivery,
  message: DeliveryEndpointMessage,
  count: number,
): Promise<void> {
  for (let sequence = 1; sequence <= count; sequence += 1) {
    await delivery.attempts.recordFailure({
      message,
      node: `node-${String(sequence).padStart(3, "0")}`,
      attemptedAt: new Date(Date.UTC(2026, 6, 8, 9, 0, sequence)),
      accepted: true,
      stage: "ENDPOINT",
      reason: "ENDPOINT_REJECTED",
    });
  }
}

async function clearClaimByRecord(
  storageFactory: StorageFactory,
  message: InboxMessage,
): Promise<void> {
  const storage = deliveryInboxRecords(storageFactory);
  const key = messageKey(message);

  try {
    const current = await storage.read(key);
    if (current === undefined) {
      throw new Error(`Missing inbox row "${key}".`);
    }

    const unclaimed = withoutClaim(InboxRecords.read(current, key));
    await storage.compareAndSet(key, current, InboxRecords.write(unclaimed));
  } finally {
    storage.close();
  }
}

function withoutClaim(message: InboxMessage): InboxMessage {
  return Object.freeze({
    id: message.id,
    inboxId: message.inboxId,
    signalId: message.signalId,
    ...(message.signal === undefined ? {} : { signal: message.signal }),
    label: message.label,
    status: message.status,
    shard: message.shard,
    whenReceived: message.whenReceived,
    version: message.version,
    ...(message.keepUntil === undefined ? {} : { keepUntil: message.keepUntil }),
  });
}

function readContinuation(message: InboxMessage) {
  return Object.freeze({
    messageId: message.id.value,
    whenReceived: message.whenReceived,
    version: message.version,
  });
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
