import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import {
  type RecordQuery,
  type RecordSpec,
  RecordStorage,
  StorageFactory,
  type StorageContext,
} from "@spine-ts/storage";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  DedupRecords,
  dedupRecordSpec,
  InboxRecords,
  inboxRecordSpec,
} from "../../src/delivery/inbox-records.js";
import { inboxStorageAccess } from "../../src/delivery/inbox-storage.js";
import {
  Delivery,
  InboxMessageError,
  ShardIndex,
  ShardSession,
  type DeliveryMessageDrainOptions,
  type InboxId,
  type InboxMessage,
} from "../../src/index.js";

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
      onMessage(message) {
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

  it("keeps active shard ownership while endpoint callbacks await past the original lease", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const storageFactory = new InMemoryStorageFactory();
      const first = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 20,
        now: () => new Date(Date.now()),
      });
      const second = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 20,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();
      const started = deferred<undefined>();
      const barrier = deferred<undefined>();
      const seen: string[] = [];

      await seed(first, "signal-lease", 1n);
      const firstRun = first.drain(shard, {
        node: "node-a",
        onMessage(message) {
          seen.push(`node-a:${message.signalId}`);
          started.resolve(undefined);

          return barrier.promise;
        },
      });

      await started.promise;
      await vi.advanceTimersByTimeAsync(20);
      const secondRun = await second.drain(shard, {
        node: "node-b",
        onMessage(message) {
          seen.push(`node-b:${message.signalId}`);
        },
      });

      barrier.resolve(undefined);
      await firstRun;

      expect(secondRun).toMatchObject({
        status: "SKIPPED",
        processed: 0,
        delivered: 0,
        failed: 0,
      });
      expect(seen).toEqual(["node-a:signal-lease"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews the active row claim while an endpoint callback awaits", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const storageFactory = new InMemoryStorageFactory();
      const first = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 20,
        now: () => new Date(Date.now()),
      });
      const second = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 20,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();
      const stored = await seed(first, "signal-row-lease", 1n);
      const started = deferred<undefined>();
      const barrier = deferred<undefined>();
      const seen: string[] = [];

      const firstRun = first.drain(shard, {
        node: "node-a",
        onMessage(message) {
          seen.push(`node-a:${message.signalId}`);
          started.resolve(undefined);

          return barrier.promise;
        },
      });

      await started.promise;
      await vi.advanceTimersByTimeAsync(25);

      const competingClaim = await inboxStorageAccess.claim(
        second.inbox.storage,
        stored,
        new ShardSession(
          "competing-message-owner",
          shard,
          "node-b",
          new Date(Date.now()),
          new Date(Date.now() + 20),
        ),
      );

      barrier.resolve(undefined);
      const run = await firstRun;

      expect(competingClaim).toBeUndefined();
      expect(seen).toEqual(["node-a:signal-row-lease"]);
      expect(run).toMatchObject({
        status: "DRAINED",
        processed: 1,
        delivered: 1,
        failed: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks delivered with the renewed row claim when renewal races final marking", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const faultPlan: DeliveryFaultPlan = {
        blockInboxRenewalOnce: true,
        inboxRenewalBlocked: deferred<undefined>(),
        resumeInboxRenewal: deferred<undefined>(),
      };
      const storageFactory = new FaultyDeliveryStorageFactory(faultPlan);
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 20,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();

      await seed(delivery, "signal-renew-mark-race", 1n);
      const started = deferred<undefined>();
      const barrier = deferred<undefined>();
      const seen: string[] = [];

      const runPromise = delivery.drain(shard, {
        node: "node-a",
        onMessage(message) {
          seen.push(message.signalId);
          started.resolve(undefined);

          return barrier.promise;
        },
      });

      await started.promise;
      vi.advanceTimersByTime(15);
      await faultPlan.inboxRenewalBlocked.promise;

      barrier.resolve(undefined);
      await Promise.resolve();
      faultPlan.resumeInboxRenewal.resolve(undefined);

      const run = await runPromise;

      expect(faultPlan.blockedInboxRenewals).toBe(1);
      expect(seen).toEqual(["signal-renew-mark-race"]);
      expect(run).toMatchObject({
        status: "DRAINED",
        processed: 1,
        accepted: 1,
        delivered: 1,
        failed: 0,
      });
      await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
      await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
        { signalId: "signal-renew-mark-race", status: "DELIVERED" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears row acceptance without dispatch when claim completion crosses shard expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const faultPlan: DeliveryFaultPlan = {
        blockInboxClaimOnce: true,
        inboxClaimBlocked: deferred<undefined>(),
        resumeInboxClaim: deferred<undefined>(),
      };
      const storageFactory = new FaultyDeliveryStorageFactory(faultPlan);
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 20,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();

      await seed(delivery, "signal-claim-expired", 1n);
      const seen: string[] = [];
      const runPromise = delivery.drain(shard, {
        node: "node-a",
        onMessage(message) {
          seen.push(message.signalId);
        },
      });

      await faultPlan.inboxClaimBlocked.promise;
      vi.setSystemTime(new Date("2026-07-08T09:00:00.021Z"));
      faultPlan.resumeInboxClaim.resolve(undefined);

      const run = await runPromise;

      expect(faultPlan.blockedInboxClaims).toBe(1);
      expect(seen).toEqual([]);
      expect(run).toMatchObject({
        status: "DRAINED",
        processed: 1,
        accepted: 1,
        delivered: 0,
        failed: 1,
      });
      expect(run.failures).toHaveLength(1);
      await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject(
        [{ signalId: "signal-claim-expired", status: "TO_DELIVER" }],
      );
      await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips a row already claimed by another drain before invoking the endpoint", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();
    const stored = await seed(delivery, "signal-claimed", 1n);
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

    const duplicateSeen: string[] = [];
    const secondRun = await delivery.drain(shard, {
      node: "node-b",
      onMessage(message) {
        duplicateSeen.push(`node-b:${message.signalId}`);
      },
    });

    expect(claimed?.signalId).toBe("signal-claimed");
    expect(duplicateSeen).toEqual([]);
    expect(secondRun).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
  });

  it("skips a claimed row after the claim expiry instead of duplicate dispatching", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:05:00.000Z"),
    });
    const shard = ShardIndex.single();
    const stored = await seed(delivery, "signal-expired-claim", 1n);
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
    const run = await delivery.drain(shard, {
      node: "node-b",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(claimed?.signalId).toBe("signal-expired-claim");
    expect(seen).toEqual([]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-expired-claim", status: "TO_DELIVER" },
    ]);
  });

  it("leaves a row pending when the foreground lease check observes expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
        leaseMs: 20,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();

      await seed(delivery, "signal-expired", 1n);
      const run = await delivery.drain(shard, {
        node: "node-a",
        onMessage() {
          vi.setSystemTime(new Date("2026-07-08T09:00:00.021Z"));
        },
      });

      expect(run).toMatchObject({
        status: "DRAINED",
        processed: 1,
        delivered: 0,
        failed: 1,
      });
      expect(run.failures).toHaveLength(1);
      await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject(
        [{ signalId: "signal-expired", status: "TO_DELIVER" }],
      );
      await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
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
      onMessage(message) {
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
      onMessage(message) {
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

  it("rejects drain read limits above the storage bound", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    await expect(
      delivery.drain(ShardIndex.single(), {
        node: "node-a",
        limit: 1_001,
        onMessage: () => undefined,
      }),
    ).rejects.toThrow("Inbox read limit must be a positive safe integer at most 1000.");
  });

  it("rejects invalid drain limits before shard storage access", async () => {
    const faultPlan: DeliveryFaultPlan = {};
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyDeliveryStorageFactory(faultPlan),
    });

    await expect(
      delivery.drain(ShardIndex.single(), {
        node: "node-a",
        limit: 1_001,
        onMessage: () => undefined,
      }),
    ).rejects.toThrow("Inbox read limit must be a positive safe integer at most 1000.");

    expect(faultPlan.opens).toBeUndefined();
    expect(faultPlan.compareAndSets).toBeUndefined();
  });

  it("uses exact-message options without a drain limit for drainMessage", () => {
    type DrainMessageOptions = Parameters<Delivery["drainMessage"]>[1];

    expectTypeOf<DrainMessageOptions>().toEqualTypeOf<DeliveryMessageDrainOptions>();
    expectTypeOf<DrainMessageOptions>().not.toHaveProperty("limit");
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
      onMessage(message) {
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
      onMessage(message) {
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

  it("rejects CATCH_UP rows before invoking the endpoint", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-catch-up", 1n, "CATCH_UP");

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual([]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    expect(run.failures[0]?.error).toBeInstanceOf(Error);
    expect((run.failures[0]?.error as Error | undefined)?.message).toBe(
      'Delivery worker does not support "CATCH_UP" messages.',
    );
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-catch-up", status: "TO_DELIVER" },
    ]);
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
      onMessage() {
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
      onMessage(message) {
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

  it("fails duplicate retention checks when the delivery clock is not a Date", async () => {
    const now: { value: unknown } = {
      value: new Date("2026-07-08T09:00:00.000Z"),
    };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      leaseMs: 900_000,
      now: () => now.value as Date,
    });
    const inboxId = targetInbox();
    const shard = ShardIndex.single();

    await delivery.inbox.receive({
      inboxId,
      signalId: "signal-clock",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      keepUntil: new Date("2026-07-08T10:00:00.000Z"),
    });
    await delivery.drain(shard, {
      node: "node-a",
      onMessage() {
        now.value = new Date("2026-07-08T09:10:00.000Z");
      },
    });

    now.value = "not-a-date";
    await expect(
      delivery.inbox.receive({
        inboxId,
        signalId: "signal-clock",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard,
        whenReceived: new Date("2026-07-08T09:01:00.000Z"),
        version: 2n,
      }),
    ).rejects.toThrow("Inbox storage clock must return a Date.");
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
      onMessage(message) {
        expect(message.signalId).toBe("signal-delivered");
      },
    });
    const deliveredRows = await delivery.inbox.read(shard, { statuses: ["DELIVERED"] });

    await expect(
      delivery.inbox.markDelivered(deliveredRows[0] ?? delivered),
    ).resolves.toMatchObject({
      signalId: "signal-delivered",
      status: "DELIVERED",
    });
    await expect(
      delivery.inbox.markDelivered(
        Object.freeze({
          ...(deliveredRows[0] ?? delivered),
          signalId: "signal-forged",
        }),
      ),
    ).resolves.toBeUndefined();

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

  it("rejects public markDelivered snapshots with internal claim metadata", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const stored = await seed(delivery, "signal-mark-claim", 1n);

    await expect(delivery.inbox.markDelivered(withClaim(stored))).rejects.toBeInstanceOf(
      InboxMessageError,
    );
    await expect(delivery.inbox.markDelivered(withClaim(stored))).rejects.toThrow(
      "Inbox message claim is internal.",
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toHaveLength(1);
  });

  it("rejects corrupted inbox record snapshots at decode boundaries", () => {
    const valid = InboxRecords.write(missingMessage());
    const stored = unpackStoredRecord(valid);
    const cases: readonly (readonly [Any, string])[] = [
      [
        create(AnySchema, {
          typeUrl: "type.example.dev/InvalidInboxRecord",
          value: valid.value,
        }),
        "Inbox message record type URL",
      ],
      [
        Object.freeze({
          ...valid,
          value: "not-bytes" as unknown as Uint8Array,
        }),
        "Inbox message record value must be a Uint8Array.",
      ],
      [packStoredRecord(valid, "{"), "Inbox message record contains malformed JSON."],
      [packStoredRecord(valid, []), "Inbox message record is not a JSON object."],
      [
        packStoredRecord(valid, {
          ...stored,
          key: "wrong-key",
        }),
        "Inbox message record key does not match message identity.",
      ],
      [
        packStoredRecord(valid, {
          ...stored,
          shard: "1/1",
        }),
        "Inbox message record shard key does not match shard.",
      ],
      [
        packStoredRecord(valid, {
          ...stored,
          inbox: "wrong-inbox",
        }),
        "Inbox message record inbox key does not match target identity.",
      ],
      [
        packStoredRecord(valid, {
          ...stored,
          inboxId: null,
        }),
        "Inbox target identity is invalid.",
      ],
      [
        packStoredRecord(valid, {
          ...stored,
          signal: null,
        }),
        "Inbox signal payload is invalid.",
      ],
      [
        packStoredRecord(valid, {
          ...stored,
          signal: { typeUrl: "type.example.dev/Signal", valueBase64: "not-base64!" },
        }),
        "Inbox signal payload base64 is invalid.",
      ],
      [
        packStoredRecord(valid, {
          ...stored,
          label: "UNKNOWN",
        }),
        'Inbox delivery label "UNKNOWN" is invalid.',
      ],
      [
        packStoredRecord(valid, {
          ...stored,
          status: "UNKNOWN",
        }),
        'Inbox delivery status "UNKNOWN" is invalid.',
      ],
    ];

    for (const [record, message] of cases) {
      expect(() => InboxRecords.read(record)).toThrow(message);
    }
  });

  it("rejects corrupted dedup record snapshots at decode boundaries", () => {
    const message = missingMessage();
    const pending = DedupRecords.writeClaim(message);
    const final = DedupRecords.writeFinal(message);
    const pendingStored = unpackStoredRecord(pending);
    const finalStored = unpackStoredRecord(final);
    const cases: readonly (readonly [Any, string])[] = [
      [
        packStoredRecord(pending, {
          ...pendingStored,
          state: "UNKNOWN",
        }),
        'Inbox dedup state "UNKNOWN" is invalid.',
      ],
      [
        packStoredRecord(pending, {
          ...pendingStored,
          message: {
            ...(pendingStored.message as Record<string, unknown>),
            signalId: "different-signal",
          },
        }),
        "Inbox dedup pending message does not match the guard key.",
      ],
      [
        packStoredRecord(final, {
          ...finalStored,
          signalId: "different-signal",
        }),
        "Inbox dedup final record does not match the guard key.",
      ],
      [
        packStoredRecord(final, {
          ...finalStored,
          shardIndex: "0",
        }),
        "Inbox dedup shard index must be a finite integer.",
      ],
      [
        packStoredRecord(final, {
          ...finalStored,
          keepUntilMs: Number.POSITIVE_INFINITY,
        }),
        "Inbox dedup keep-until time must be a finite integer.",
      ],
    ];

    for (const [record, message] of cases) {
      expect(() => DedupRecords.readGuard(record)).toThrow(message);
    }

    expect(() => DedupRecords.readGuard(final, "wrong-key")).toThrow(
      'Inbox dedup guard "wrong-key" does not match its storage key.',
    );
    expect(DedupRecords.readPendingMessage(final)).toBeUndefined();
  });

  it("records a marker failure when the stored row changes after dispatch", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const shard = ShardIndex.single();
    const stored = await seed(delivery, "signal-original", 1n);
    const inboxRecords = deliveryInboxRecords(storageFactory);
    const inboxKey = messageKey(stored);
    const originalRecord = await inboxRecords.read(inboxKey);
    expect(originalRecord).toBeDefined();

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      async onMessage(message) {
        seen.push(message.signalId);
        const tampered = Object.freeze({
          ...message,
          signalId: "signal-tampered",
        });
        await expect(
          inboxRecords.compareAndSet(inboxKey, originalRecord, InboxRecords.write(tampered)),
        ).resolves.toBe(true);
      },
    });

    expect(seen).toEqual(["signal-original"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      delivered: 0,
      failed: 1,
    });
    expect(run.failures[0]?.message.signalId).toBe("signal-original");
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("leaves a row pending when the dedup guard cannot be marked delivered", async () => {
    const faultPlan: DeliveryFaultPlan = {};
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyDeliveryStorageFactory(faultPlan),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-guard-fails", 1n);
    faultPlan.throwDedupFinalizeOnce = true;

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-guard-fails"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      delivered: 0,
      failed: 1,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-guard-fails", status: "TO_DELIVER" },
    ]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("rejects forged delivered markers that only reuse an inbox message id", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();
    const stored = await seed(delivery, "signal-original", 1n);

    const forged = Object.freeze({
      ...stored,
      signalId: "signal-forged",
      version: 99n,
    });

    await expect(delivery.inbox.markDelivered(forged)).resolves.toBeUndefined();
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-original", status: "TO_DELIVER" },
    ]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("rejects exact-message drains with mismatched message and id shards", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const stored = await seed(delivery, "signal-original", 1n);
    const forged = Object.freeze({
      ...stored,
      shard: new ShardIndex(1, 2),
    });
    const seen: string[] = [];

    await expect(
      delivery.drainMessage(forged, {
        node: "node-a",
        onMessage(message) {
          seen.push(message.signalId);
        },
      }),
    ).rejects.toThrow("Inbox message ID shard does not match message shard.");

    expect(seen).toEqual([]);
    await expect(delivery.inbox.read(stored.shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([
      stored,
    ]);
  });

  it("rejects exact-message drains when a forged message shard key lies", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const stored = await seed(delivery, "signal-original", 1n);
    const forgedShard = Object.freeze({
      index: 1,
      ofTotal: 2,
      key() {
        return stored.id.shard.key();
      },
    }) as ShardIndex;
    const forged = Object.freeze({
      ...stored,
      shard: forgedShard,
    });
    const seen: string[] = [];

    await expect(
      delivery.drainMessage(forged, {
        node: "node-a",
        onMessage(message) {
          seen.push(message.signalId);
        },
      }),
    ).rejects.toThrow("Inbox message ID shard does not match message shard.");

    expect(seen).toEqual([]);
    await expect(delivery.inbox.read(stored.shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([
      stored,
    ]);
    await expect(delivery.shards.pickUp(new ShardIndex(1, 2), "node-b")).resolves.toBeDefined();
  });

  it("rejects exact-message drains with invalid structural ID shards", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const stored = await seed(delivery, "signal-invalid-id-shard", 1n);
    const forged = Object.freeze({
      ...stored,
      id: Object.freeze({
        ...stored.id,
        shard: null as unknown as ShardIndex,
      }),
    });

    await expect(
      delivery.drainMessage(forged, {
        node: "node-a",
        onMessage() {
          throw new Error("invalid shard should fail before replay");
        },
      }),
    ).rejects.toThrow("Inbox message ID shard is invalid.");
  });

  it("rejects exact-message drains with invalid structural row shards", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const stored = await seed(delivery, "signal-invalid-row-shard", 1n);
    const forged = Object.freeze({
      ...stored,
      shard: { index: "0", ofTotal: 1 } as unknown as ShardIndex,
    });

    await expect(
      delivery.drainMessage(forged, {
        node: "node-a",
        onMessage() {
          throw new Error("invalid shard should fail before replay");
        },
      }),
    ).rejects.toThrow("Inbox message shard is invalid.");
  });

  it("rejects exact-message drains when the stored row no longer matches its key", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const stored = await seed(delivery, "signal-row-shard-tampered", 1n);
    const inboxRecords = deliveryInboxRecords(storageFactory);
    const inboxKey = messageKey(stored);
    const originalRecord = await inboxRecords.read(inboxKey);
    const otherShard = Object.freeze({
      index: 1,
      ofTotal: 2,
      key() {
        return stored.shard.key();
      },
    }) as ShardIndex;
    const tampered = Object.freeze({
      ...stored,
      id: Object.freeze({
        ...stored.id,
        shard: otherShard,
      }),
      shard: otherShard,
    });
    const seen: string[] = [];
    expect(originalRecord).toBeDefined();
    await expect(
      inboxRecords.compareAndSet(inboxKey, originalRecord, InboxRecords.write(tampered)),
    ).resolves.toBe(true);

    await expect(
      delivery.drainMessage(stored, {
        node: "node-a",
        onMessage(message) {
          seen.push(message.signalId);
        },
      }),
    ).rejects.toThrow("does not match storage key");

    expect(seen).toEqual([]);
    await expect(delivery.shards.pickUp(stored.shard, "node-b")).resolves.toBeDefined();
  });

  it("records an exact-message marker failure when the stored row changes after replay", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const stored = await seed(delivery, "signal-exact-marker-original", 1n);
    const inboxRecords = deliveryInboxRecords(storageFactory);
    const inboxKey = messageKey(stored);
    const originalRecord = await inboxRecords.read(inboxKey);
    const seen: string[] = [];
    expect(originalRecord).toBeDefined();

    const run = await delivery.drainMessage(stored, {
      node: "node-a",
      async onMessage(message) {
        seen.push(message.signalId);
        const tampered = Object.freeze({
          ...message,
          signalId: "signal-exact-marker-tampered",
        });
        await expect(
          inboxRecords.compareAndSet(inboxKey, originalRecord, InboxRecords.write(tampered)),
        ).resolves.toBe(true);
      },
    });

    expect(seen).toEqual(["signal-exact-marker-original"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      delivered: 0,
      failed: 1,
    });
    expect(run.failures[0]?.message.signalId).toBe("signal-exact-marker-original");
    expect(run.failures[0]?.error).toBeInstanceOf(Error);
    await expect(delivery.inbox.read(stored.shard, { statuses: ["DELIVERED"] })).resolves.toEqual(
      [],
    );
  });

  it("repairs the delivered-row stale-guard race during duplicate receive", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-08T09:30:00.000Z"),
    });
    const shard = ShardIndex.single();
    const inboxId = targetInbox();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");
    const stored = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-race",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      keepUntil,
    });
    const delivered = Object.freeze({
      ...stored.message,
      status: "DELIVERED" as const,
    });

    const inboxRecords = deliveryInboxRecords(storageFactory);
    const dedupRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox-dedup", multitenant: false },
      dedupRecordSpec,
    );
    const inboxKey = messageKey(stored.message);
    const dedupKey = DedupRecords.guardKey(stored.message);
    const pendingInbox = await inboxRecords.read(inboxKey);
    const staleGuard = await dedupRecords.read(dedupKey);
    expect(pendingInbox).toBeDefined();
    expect(staleGuard).toBeDefined();
    await expect(
      inboxRecords.compareAndSet(inboxKey, pendingInbox, InboxRecords.write(delivered)),
    ).resolves.toBe(true);

    const duplicate = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-race",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:01:00.000Z"),
      version: 2n,
      keepUntil,
    });

    expect(duplicate.outcome).toBe("DUPLICATE");
    expect(duplicate.message).toMatchObject({
      id: stored.message.id,
      signalId: "signal-race",
      status: "DELIVERED",
    });
    await expect(dedupRecords.read(dedupKey)).resolves.toEqual(DedupRecords.writeFinal(delivered));
  });

  it("retries when stale delivered-row guard repair loses a race", async () => {
    const faultPlan: DeliveryFaultPlan = {};
    const storageFactory = new FaultyDeliveryStorageFactory(faultPlan);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-08T09:30:00.000Z"),
    });
    const shard = ShardIndex.single();
    const inboxId = targetInbox();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");
    const stored = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-stale-guard-retry",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      keepUntil,
    });
    const delivered = Object.freeze({
      ...stored.message,
      status: "DELIVERED" as const,
    });

    const inboxRecords = deliveryInboxRecords(storageFactory);
    const dedupRecords = deliveryDedupRecords(storageFactory);
    const inboxKey = messageKey(stored.message);
    const pendingInbox = await inboxRecords.read(inboxKey);
    expect(pendingInbox).toBeDefined();
    await expect(
      inboxRecords.compareAndSet(inboxKey, pendingInbox, InboxRecords.write(delivered)),
    ).resolves.toBe(true);

    faultPlan.skipDedupFinalizeOnce = true;
    const duplicate = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-stale-guard-retry",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:01:00.000Z"),
      version: 2n,
      keepUntil,
    });

    expect(faultPlan.skippedDedupFinalizations).toBe(1);
    expect(duplicate.outcome).toBe("DUPLICATE");
    expect(duplicate.message.status).toBe("DELIVERED");
    await expect(dedupRecords.read(DedupRecords.guardKey(stored.message))).resolves.toEqual(
      DedupRecords.writeFinal(delivered),
    );
  });

  it("repairs the guard-delivered row-pending race during duplicate receive", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-08T09:30:00.000Z"),
    });
    const shard = ShardIndex.single();
    const inboxId = targetInbox();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");
    const stored = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-guard-delivered",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      keepUntil,
    });
    const delivered = Object.freeze({
      ...stored.message,
      status: "DELIVERED" as const,
    });

    const inboxRecords = deliveryInboxRecords(storageFactory);
    const dedupRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox-dedup", multitenant: false },
      dedupRecordSpec,
    );
    const inboxKey = messageKey(stored.message);
    const dedupKey = DedupRecords.guardKey(stored.message);
    const pendingGuard = await dedupRecords.read(dedupKey);
    expect(pendingGuard).toBeDefined();
    await expect(
      dedupRecords.compareAndSet(dedupKey, pendingGuard, DedupRecords.writeFinal(delivered)),
    ).resolves.toBe(true);

    const duplicate = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-guard-delivered",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:01:00.000Z"),
      version: 2n,
      keepUntil,
    });

    expect(duplicate.outcome).toBe("DUPLICATE");
    expect(duplicate.message).toMatchObject({
      id: stored.message.id,
      signalId: "signal-guard-delivered",
      status: "DELIVERED",
    });
    await expect(inboxRecords.read(inboxKey)).resolves.toEqual(InboxRecords.write(delivered));
    await expect(dedupRecords.read(dedupKey)).resolves.toEqual(DedupRecords.writeFinal(delivered));
  });

  it("retries when guard-delivered row repair loses a race", async () => {
    const faultPlan: DeliveryFaultPlan = {};
    const storageFactory = new FaultyDeliveryStorageFactory(faultPlan);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-08T09:30:00.000Z"),
    });
    const shard = ShardIndex.single();
    const inboxId = targetInbox();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");
    const stored = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-row-repair-retry",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      keepUntil,
    });
    const delivered = Object.freeze({
      ...stored.message,
      status: "DELIVERED" as const,
    });

    const inboxRecords = deliveryInboxRecords(storageFactory);
    const dedupRecords = deliveryDedupRecords(storageFactory);
    const dedupKey = DedupRecords.guardKey(stored.message);
    const pendingGuard = await dedupRecords.read(dedupKey);
    expect(pendingGuard).toBeDefined();
    await expect(
      dedupRecords.compareAndSet(dedupKey, pendingGuard, DedupRecords.writeFinal(delivered)),
    ).resolves.toBe(true);

    faultPlan.skipInboxRepairOnce = true;
    const duplicate = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-row-repair-retry",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:01:00.000Z"),
      version: 2n,
      keepUntil,
    });

    expect(faultPlan.skippedInboxRepairs).toBe(1);
    expect(duplicate.outcome).toBe("DUPLICATE");
    expect(duplicate.message.status).toBe("DELIVERED");
    await expect(inboxRecords.read(messageKey(stored.message))).resolves.toEqual(
      InboxRecords.write(delivered),
    );
  });

  it("retries when pending claim recovery finalization loses a race", async () => {
    const faultPlan: DeliveryFaultPlan = {};
    const storageFactory = new FaultyDeliveryStorageFactory(faultPlan);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const pending = missingMessage();
    const dedupRecords = deliveryDedupRecords(storageFactory);

    await expect(
      dedupRecords.compareAndSet(
        DedupRecords.guardKey(pending),
        undefined,
        DedupRecords.writeClaim(pending),
      ),
    ).resolves.toBe(true);

    faultPlan.skipDedupFinalizeOnce = true;
    const result = await delivery.inbox.receive({
      inboxId: pending.inboxId,
      signalId: pending.signalId,
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: pending.shard,
      whenReceived: new Date("2026-07-08T09:01:00.000Z"),
      version: 100n,
    });

    expect(faultPlan.skippedDedupFinalizations).toBe(1);
    expect(result).toMatchObject({
      outcome: "DUPLICATE",
      message: {
        id: { value: "missing-message" },
        signalId: "signal-missing",
        status: "TO_DELIVER",
      },
    });
    await expect(dedupRecords.read(DedupRecords.guardKey(pending))).resolves.toEqual(
      DedupRecords.writeFinal(pending),
    );
  });
});

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

function withClaim(message: InboxMessage): InboxMessage {
  return Object.freeze({
    ...message,
    claim: {
      id: "external-claim",
      node: "node-a",
      expiresAt: new Date("2026-07-08T09:01:00.000Z"),
    },
  }) as unknown as InboxMessage;
}

function messageKey(message: InboxMessage): string {
  return `${message.id.shard.key()}:${message.id.value}`;
}

function unpackStoredRecord(record: Any): Record<string, unknown> {
  return JSON.parse(Buffer.from(record.value).toString("utf8")) as Record<string, unknown>;
}

function packStoredRecord(template: Any, value: unknown): Any {
  return create(AnySchema, {
    typeUrl: template.typeUrl,
    value: Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8"),
  });
}

function deliveryInboxRecords(storageFactory: StorageFactory) {
  return storageFactory.createRecordStorage(
    { name: "Tasks.delivery.inbox", multitenant: false },
    inboxRecordSpec,
  );
}

function deliveryDedupRecords(storageFactory: StorageFactory) {
  return storageFactory.createRecordStorage(
    { name: "Tasks.delivery.inbox-dedup", multitenant: false },
    dedupRecordSpec,
  );
}

function isInboxClaimCreation<I, R extends Message>(id: I, expected: R, next: R): boolean {
  if (typeof id !== "string") {
    return false;
  }

  const current = InboxRecords.read(expected as Any, id);
  const claimed = InboxRecords.read(next as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    claimed.status === "TO_DELIVER" &&
    current.claim === undefined &&
    claimed.claim !== undefined
  );
}

function isInboxClaimRenewal<I, R extends Message>(id: I, expected: R, next: R): boolean {
  if (typeof id !== "string") {
    return false;
  }

  const current = InboxRecords.read(expected as Any, id);
  const renewed = InboxRecords.read(next as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    renewed.status === "TO_DELIVER" &&
    current.claim !== undefined &&
    renewed.claim !== undefined &&
    current.claim.id === renewed.claim.id &&
    current.claim.node === renewed.claim.node &&
    current.claim.expiresAt.getTime() !== renewed.claim.expiresAt.getTime()
  );
}

interface DeliveryFaultPlan {
  blockInboxClaimOnce?: boolean;
  blockInboxRenewalOnce?: boolean;
  skipDedupFinalizeOnce?: boolean;
  skipInboxRepairOnce?: boolean;
  throwDedupFinalizeOnce?: boolean;
  inboxClaimBlocked?: ReturnType<typeof deferred<undefined>>;
  resumeInboxClaim?: ReturnType<typeof deferred<undefined>>;
  inboxRenewalBlocked?: ReturnType<typeof deferred<undefined>>;
  resumeInboxRenewal?: ReturnType<typeof deferred<undefined>>;
  blockedInboxClaims?: number;
  blockedInboxRenewals?: number;
  skippedDedupFinalizations?: number;
  skippedInboxRepairs?: number;
  opens?: number;
  compareAndSets?: number;
}

class FaultyDeliveryStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  readonly #plan: DeliveryFaultPlan;

  constructor(plan: DeliveryFaultPlan) {
    super();
    this.#plan = plan;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.#plan.opens = (this.#plan.opens ?? 0) + 1;
    const storage = this.#delegate.createRecordStorage(context, recordSpec);

    return new FaultyDeliveryRecordStorage(context, recordSpec, storage, this.#plan);
  }
}

class FaultyDeliveryRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #plan: DeliveryFaultPlan;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    plan: DeliveryFaultPlan,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#plan = plan;
  }

  override close(): void {
    this.#delegate.close();
    super.close();
  }

  protected async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    this.#plan.compareAndSets = (this.#plan.compareAndSets ?? 0) + 1;
    if (
      this.context.name.endsWith(".delivery.inbox") &&
      expected !== undefined &&
      next !== undefined &&
      this.#plan.blockInboxClaimOnce === true &&
      isInboxClaimCreation(id, expected.record, next.record)
    ) {
      this.#plan.blockInboxClaimOnce = false;
      this.#plan.blockedInboxClaims = (this.#plan.blockedInboxClaims ?? 0) + 1;
      this.#plan.inboxClaimBlocked?.resolve(undefined);
      await this.#plan.resumeInboxClaim?.promise;
    }

    if (
      this.context.name.endsWith(".delivery.inbox") &&
      expected !== undefined &&
      next !== undefined &&
      this.#plan.blockInboxRenewalOnce === true &&
      isInboxClaimRenewal(id, expected.record, next.record)
    ) {
      this.#plan.blockInboxRenewalOnce = false;
      this.#plan.blockedInboxRenewals = (this.#plan.blockedInboxRenewals ?? 0) + 1;
      this.#plan.inboxRenewalBlocked?.resolve(undefined);
      await this.#plan.resumeInboxRenewal?.promise;
    }

    if (
      this.context.name.endsWith(".delivery.inbox") &&
      expected !== undefined &&
      next !== undefined &&
      this.#plan.skipInboxRepairOnce === true
    ) {
      this.#plan.skipInboxRepairOnce = false;
      this.#plan.skippedInboxRepairs = (this.#plan.skippedInboxRepairs ?? 0) + 1;
      return Promise.resolve(false);
    }

    if (
      this.context.name.endsWith(".delivery.inbox-dedup") &&
      expected !== undefined &&
      next !== undefined &&
      this.#plan.skipDedupFinalizeOnce === true
    ) {
      this.#plan.skipDedupFinalizeOnce = false;
      this.#plan.skippedDedupFinalizations = (this.#plan.skippedDedupFinalizations ?? 0) + 1;
      return Promise.resolve(false);
    }

    if (
      this.context.name.endsWith(".delivery.inbox-dedup") &&
      expected !== undefined &&
      next !== undefined &&
      this.#plan.throwDedupFinalizeOnce === true
    ) {
      this.#plan.throwDedupFinalizeOnce = false;
      return Promise.reject(new Error("Dedup finalize failed."));
    }

    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected override queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly { id: I; record: R }[]> {
    return this.#delegate.queryEntries(query);
  }

  protected readRecord(id: I): Promise<R | undefined> {
    return this.#delegate.read(id);
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    return this.#delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    return this.#delegate.write(record.record);
  }
}
