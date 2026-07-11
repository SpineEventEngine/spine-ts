import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory, type StorageFactory } from "@spine-ts/storage";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { DedupRecords, dedupRecordSpec, InboxRecords } from "../../src/delivery/inbox-records.js";
import { inboxStorageAccess } from "../../src/delivery/inbox-storage.js";
import { DeliveryStorageCorruptionError } from "../../src/delivery/delivery-storage-error.js";
import {
  Delivery,
  type DeliveryDrainOptions,
  type DeliveryEndpointMessage,
  type DeliveryMessageDrainOptions,
  type OnDeliveryMessage,
} from "../../src/delivery/delivery.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import {
  InboxMessageError,
  ShardIndex,
  ShardSession,
  type InboxId,
  type InboxMessage,
} from "../../src/index.js";
import {
  blockInboxClaimOnce,
  blockInboxRenewalOnce,
  deliveryDedupRecords,
  deliveryInboxRecords,
  deliveryStorageFaults,
  messageKey,
  onInboxReadOnce,
  onInboxQuery,
  packStoredRecord,
  recordAttemptQueries,
  recordAttemptReads,
  recordInboxQueries,
  skipDedupFinalizeOnce,
  skipInboxClearOnce,
  skipInboxRepairOnce,
  targetInbox,
  throwAttemptReadOnce,
  throwAttemptWriteOnce,
  throwDedupFinalizeOnce,
  throwInboxClaimOnce,
  throwInboxClearOnce,
  unpackStoredRecord,
} from "./delivery-storage-fault-fixture.js";

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
        leaseMs: 1_000,
        now: () => new Date(Date.now()),
      });
      const second = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 1_000,
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
      await vi.advanceTimersByTimeAsync(1_000);
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
        leaseMs: 1_000,
        now: () => new Date(Date.now()),
      });
      const second = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
        leaseMs: 1_000,
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
      await vi.advanceTimersByTimeAsync(500);

      const competingClaim = await inboxStorageAccess.claim(
        second.inbox.storage,
        stored,
        new ShardSession(
          "competing-message-owner",
          shard,
          "node-b",
          new Date(Date.now()),
          new Date(Date.now() + 1_000),
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

  it("renews a row claim acquired after a concurrent shard renewal before dispatch", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const blockedClaim = blockInboxClaimOnce();
      const faults = deliveryStorageFaults(blockedClaim);
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: faults.storageFactory,
        leaseMs: 1_000,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();
      const stored = await seed(delivery, "signal-claim-renew-race", 1n);
      const inboxRecords = deliveryInboxRecords(faults.storageFactory);
      const inboxKey = messageKey(stored);
      const seen: string[] = [];
      let observedClaimExpiresAt: Date | undefined;

      const runPromise = delivery.drain(shard, {
        node: "node-a",
        async onMessage(message) {
          seen.push(message.signalId);
          const record = await inboxRecords.read(inboxKey);
          observedClaimExpiresAt =
            record === undefined ? undefined : InboxRecords.read(record, inboxKey).claim?.expiresAt;
        },
      });

      await blockedClaim.blocked;
      await vi.advanceTimersByTimeAsync(500);
      blockedClaim.resume();

      const run = await runPromise;

      expect(blockedClaim.count).toBe(1);
      expect(seen).toEqual(["signal-claim-renew-race"]);
      expect(observedClaimExpiresAt).toEqual(new Date("2026-07-08T09:00:01.500Z"));
      expect(run).toMatchObject({
        status: "DRAINED",
        processed: 1,
        accepted: 1,
        delivered: 1,
        failed: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one drain on its original tenant when the caller-owned context mutates mid-callback", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      let tenantId = "tenant-a";
      const storageFactory = new InMemoryStorageFactory();
      const delivery = new Delivery({
        context: {
          name: "Tasks",
          multitenant: true,
          get tenantId() {
            return tenantId;
          },
        },
        storageFactory,
        leaseMs: 1_000,
        now: () => new Date(Date.now()),
      });
      const tenantA = new Delivery({
        context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
        storageFactory,
        leaseMs: 1_000,
        now: () => new Date(Date.now()),
      });
      const tenantB = new Delivery({
        context: { name: "Tasks", multitenant: true, tenantId: "tenant-b" },
        storageFactory,
        leaseMs: 1_000,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();
      const started = deferred<undefined>();
      const barrier = deferred<undefined>();
      const seen: string[] = [];

      await seed(delivery, "signal-tenant-snapshot", 1n);
      const runPromise = delivery.drain(shard, {
        node: "node-a",
        onMessage(message) {
          seen.push(message.signalId);
          tenantId = "tenant-b";
          started.resolve(undefined);

          return barrier.promise;
        },
      });

      await started.promise;
      await vi.advanceTimersByTimeAsync(500);
      barrier.resolve(undefined);
      const run = await runPromise;

      expect(seen).toEqual(["signal-tenant-snapshot"]);
      expect(run).toMatchObject({
        status: "DRAINED",
        processed: 1,
        accepted: 1,
        delivered: 1,
        failed: 0,
      });
      await expect(tenantA.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
      await expect(tenantA.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
        { signalId: "signal-tenant-snapshot", status: "DELIVERED" },
      ]);
      await expect(
        tenantB.inbox.read(shard, { statuses: ["TO_DELIVER", "DELIVERED"] }),
      ).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks delivered with the renewed row claim when renewal races final marking", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const blockedRenewal = blockInboxRenewalOnce();
      const faults = deliveryStorageFaults(blockedRenewal);
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: faults.storageFactory,
        leaseMs: 1_000,
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
      vi.advanceTimersByTime(500);
      await blockedRenewal.blocked;

      barrier.resolve(undefined);
      await Promise.resolve();
      blockedRenewal.resume();

      const run = await runPromise;

      expect(blockedRenewal.count).toBe(1);
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
      const blockedClaim = blockInboxClaimOnce();
      const faults = deliveryStorageFaults(blockedClaim);
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: faults.storageFactory,
        leaseMs: 1_000,
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

      await blockedClaim.blocked;
      vi.setSystemTime(new Date("2026-07-08T09:00:01.001Z"));
      blockedClaim.resume();

      const run = await runPromise;

      expect(blockedClaim.count).toBe(1);
      expect(seen).toEqual([]);
      expect(run).toMatchObject({
        status: "DRAINED",
        processed: 1,
        accepted: 0,
        delivered: 0,
        failed: 1,
      });
      expect(run.failures).toHaveLength(1);
      await expect(requireAttempts(delivery).read()).resolves.toMatchObject([
        {
          signalId: "signal-claim-expired",
          accepted: false,
          stage: "LEASE",
          reason: "LEASE_INACTIVE",
        },
      ]);
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

  it("reclaims an expired row claim during delivery CAS", async () => {
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
    expect(seen).toEqual(["signal-expired-claim"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
      { signalId: "signal-expired-claim", status: "DELIVERED" },
    ]);
  });

  it("scans past unavailable head rows to deliver a later row in the same drain", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();
    const unavailable = await seed(delivery, "signal-unavailable-head", 1n);
    await seed(delivery, "signal-available-tail", 2n);
    const claimed = await inboxStorageAccess.claim(
      delivery.inbox.storage,
      unavailable,
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
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(claimed?.signalId).toBe("signal-unavailable-head");
    expect(seen).toEqual(["signal-available-tail"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 2,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-unavailable-head", status: "TO_DELIVER" },
    ]);
  });

  it("scans past a full unavailable head page before declaring the shard idle", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();
    const unavailable: InboxMessage[] = [];

    for (let index = 0; index < 1_000; index += 1) {
      unavailable.push(
        await seed(delivery, `signal-unavailable-${String(index)}`, BigInt(index + 1)),
      );
    }
    await seed(delivery, "signal-available-tail", 1_001n);

    for (const message of unavailable) {
      const claimed = await inboxStorageAccess.claim(
        delivery.inbox.storage,
        message,
        new ShardSession(
          `message-owner-${message.signalId}`,
          shard,
          "node-a",
          new Date("2026-07-08T09:00:00.000Z"),
          new Date("2026-07-08T09:01:00.000Z"),
        ),
      );
      expect(claimed?.signalId).toBe(message.signalId);
    }

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-b",
      limit: 1_000,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-available-tail"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1_001,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
  });

  it("leaves a row pending when the foreground lease check observes expiry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-08T09:00:00.000Z"));
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
        leaseMs: 1_000,
        now: () => new Date(Date.now()),
      });
      const shard = ShardIndex.single();

      await seed(delivery, "signal-expired", 1n);
      const run = await delivery.drain(shard, {
        node: "node-a",
        onMessage() {
          vi.setSystemTime(new Date("2026-07-08T09:00:01.001Z"));
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

  it("keeps the internal claim snapshot private from endpoint mutations", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();
    const signalBytes = new Uint8Array([1, 2, 3]);
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");

    await delivery.inbox.receive({
      inboxId: targetInbox(),
      signalId: "signal-mutable-public-copy",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      signal: create(AnySchema, {
        typeUrl: "type.example.dev/tasks.Signal",
        value: signalBytes,
      }),
      keepUntil,
    });

    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage(message) {
        message.whenReceived.setTime(Date.parse("2026-07-08T09:30:00.000Z"));
        message.keepUntil?.setTime(Date.parse("2026-07-08T10:30:00.000Z"));
        message.signal?.value.fill(9);
      },
    });

    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
    const delivered = await delivery.inbox.read(shard, { statuses: ["DELIVERED"] });
    expect(delivered).toMatchObject([
      {
        signalId: "signal-mutable-public-copy",
        whenReceived: new Date("2026-07-08T09:00:00.000Z"),
        keepUntil,
      },
    ]);
    expect(Array.from(delivered[0]?.signal?.value ?? [])).toEqual([1, 2, 3]);
  });

  it("keeps the internal pending row private from failure message mutations", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");

    await delivery.inbox.receive({
      inboxId: targetInbox(),
      signalId: "signal-mutable-failure-copy",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      signal: create(AnySchema, {
        typeUrl: "type.example.dev/tasks.Signal",
        value: new Uint8Array([1, 2, 3]),
      }),
      keepUntil,
    });

    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage() {
        throw new Error("endpoint failed");
      },
    });

    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    const failure = run.failures[0];
    expect(failure).toBeDefined();
    if (failure === undefined) {
      throw new Error("Expected one delivery failure.");
    }

    failure.message.whenReceived.setTime(Date.parse("2026-07-08T09:30:00.000Z"));
    failure.message.keepUntil?.setTime(Date.parse("2026-07-08T10:30:00.000Z"));
    failure.message.signal?.value.fill(9);

    const pending = await delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] });
    expect(pending).toMatchObject([
      {
        signalId: "signal-mutable-failure-copy",
        whenReceived: new Date("2026-07-08T09:00:00.000Z"),
        keepUntil,
      },
    ]);
    expect(Array.from(pending[0]?.signal?.value ?? [])).toEqual([1, 2, 3]);
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
    const faults = deliveryStorageFaults();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });

    await expect(
      delivery.drain(ShardIndex.single(), {
        node: "node-a",
        limit: 1_001,
        onMessage: () => undefined,
      }),
    ).rejects.toThrow("Inbox read limit must be a positive safe integer at most 1000.");

    expect(faults.opens).toBe(0);
    expect(faults.compareAndSets).toBe(0);
  });

  it("uses exact-message options without a drain limit for drainMessage", () => {
    type DrainMessageOptions = Parameters<Delivery["drainMessage"]>[1];

    expectTypeOf<DeliveryDrainOptions>().toEqualTypeOf<Parameters<Delivery["drain"]>[1]>();
    expectTypeOf<DeliveryDrainOptions>().not.toHaveProperty("scanOffset");
    expectTypeOf<DeliveryDrainOptions>().not.toHaveProperty("maxFailures");
    expectTypeOf<DrainMessageOptions>().toEqualTypeOf<DeliveryMessageDrainOptions>();
    expectTypeOf<DrainMessageOptions>().not.toHaveProperty("limit");
    void ({
      node: "node-a",
      onMessage: () => undefined,
      // @ts-expect-error Loop scan continuation is not part of the internal direct-drain API.
      scanOffset: 1,
    } satisfies DeliveryDrainOptions);
    void ({
      node: "node-a",
      onMessage: () => undefined,
      // @ts-expect-error Loop failure controls are not part of the internal direct-drain API.
      maxFailures: 1,
    } satisfies DeliveryDrainOptions);
  });

  it("narrows endpoint callbacks and delivery failures to supported worker labels", () => {
    expectTypeOf<Parameters<OnDeliveryMessage>[0]>().toEqualTypeOf<DeliveryEndpointMessage>();
    expectTypeOf<Parameters<OnDeliveryMessage>[0]>().not.toHaveProperty("claim");
    expectTypeOf<DeliveryEndpointMessage["label"]>().toEqualTypeOf<
      "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT"
    >();
    expectTypeOf<DeliveryEndpointMessage["status"]>().toEqualTypeOf<"TO_DELIVER">();
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

  it("retains sanitized attempt records for supported endpoint failures", async () => {
    const attemptedAt = new Date("2026-07-08T09:00:30.000Z");
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => attemptedAt,
    });
    const shard = ShardIndex.single();
    const payloadText = "raw-payload-secret";
    const failure = new Error(`endpoint failed with ${payloadText}`);
    failure.stack = `stack with ${payloadText}`;
    const stored = await delivery.inbox.receive({
      inboxId: targetInbox(),
      signalId: "signal-retained",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
      signal: create(AnySchema, {
        typeUrl: "type.example.dev/tasks.Signal",
        value: Buffer.from(payloadText, "utf8"),
      }),
    });

    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage() {
        throw failure;
      },
    });

    expect(run).toMatchObject({
      status: "DRAINED",
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-retained", status: "TO_DELIVER" },
    ]);

    const attempts = await requireAttempts(delivery).read();

    expect(attempts).toEqual([
      {
        messageId: stored.message.id,
        inboxId: stored.message.inboxId,
        signalId: "signal-retained",
        label: "UPDATE_SUBSCRIBER",
        shard,
        node: "node-a",
        attemptedAt,
        accepted: true,
        stage: "ENDPOINT",
        reason: "ENDPOINT_REJECTED",
      },
    ]);
    const retainedJson = JSON.stringify(attempts);
    expect(retainedJson).not.toContain(payloadText);
    expect(retainedJson).not.toContain("stack");
    expect(attempts[0]).not.toHaveProperty("signal");
    expect(attempts[0]).not.toHaveProperty("error");
  });

  it("reports delivery failures even when attempt retention cannot be written", async () => {
    const attemptFault = throwAttemptWriteOnce();
    const faults = deliveryStorageFaults(attemptFault);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-attempt-write-fails", 1n);

    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage() {
        throw new Error("endpoint failed");
      },
    });

    expect(attemptFault.count).toBe(1);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0]?.message.signalId).toBe("signal-attempt-write-fails");
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-attempt-write-fails", status: "TO_DELIVER" },
    ]);
  });

  it("propagates retained attempt storage corruption during endpoint-failure retention", async () => {
    const readFault = throwAttemptReadOnce(
      new DeliveryStorageCorruptionError("Delivery attempt record contains malformed JSON."),
      { armed: false },
    );
    const faults = deliveryStorageFaults(readFault);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();
    await seed(delivery, "signal-attempt-corruption", 1n);

    const firstRun = await delivery.drain(shard, {
      node: "node-a",
      onMessage() {
        throw new Error("endpoint failed");
      },
    });
    expect(firstRun.failed).toBe(1);

    readFault.arm();
    let error: unknown;
    try {
      await delivery.drain(shard, {
        node: "node-a",
        onMessage() {
          throw new Error("endpoint failed");
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DeliveryStorageCorruptionError);
    expect(error).toHaveProperty("message", expect.stringMatching(/attempt/i));
    expect(readFault.count).toBe(1);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-attempt-corruption", status: "TO_DELIVER" },
    ]);
  });

  it("applies loop failure accounting when attempt retention cannot be written", async () => {
    const attemptFault = throwAttemptWriteOnce();
    const faults = deliveryStorageFaults(attemptFault);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-loop-attempt-write-fails", 1n);

    const run = await new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      maxFailures: 1,
      onMessage() {
        throw new Error("endpoint failed");
      },
    }).run();

    expect(attemptFault.count).toBe(1);
    expect(run).toMatchObject({
      status: "FAILED",
      runs: 1,
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0]?.message.signalId).toBe("signal-loop-attempt-write-fails");
  });

  it("retains only the newest 100 attempts for one repeatedly failing message", async () => {
    let attempt = 0;
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date(Date.UTC(2026, 6, 8, 9, 0, attempt)),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-bounded-attempts", 1n);

    for (let index = 0; index < 105; index += 1) {
      attempt = index + 1;
      const run = await delivery.drain(shard, {
        node: "node-a",
        onMessage() {
          throw new Error(`endpoint failed ${String(index)}`);
        },
      });
      expect(run.failed).toBe(1);
    }

    const attempts = await requireAttempts(delivery).read();

    expect(attempts).toHaveLength(100);
    expect(attempts[0]).toMatchObject({
      signalId: "signal-bounded-attempts",
      attemptedAt: new Date("2026-07-08T09:00:06.000Z"),
    });
    expect(attempts.at(-1)).toMatchObject({
      signalId: "signal-bounded-attempts",
      attemptedAt: new Date("2026-07-08T09:01:45.000Z"),
    });
  });

  it("uses bounded slot reads when recording repeated attempts", async () => {
    const attemptQueries: { limit?: number; messageKey?: unknown }[] = [];
    const faults = deliveryStorageFaults(recordAttemptQueries(attemptQueries));
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-bounded-lookup", 1n);

    for (let index = 0; index < 2; index += 1) {
      await delivery.drain(shard, {
        node: "node-a",
        onMessage() {
          throw new Error("endpoint failed");
        },
      });
    }

    expect(attemptQueries).toEqual([]);
  });

  it("summarizes one exact message from bounded retained attempt slots without querying attempts", async () => {
    const attemptQueries: { broad?: boolean; limit?: number; messageKey?: unknown }[] = [];
    const attemptReads: unknown[] = [];
    const faults = deliveryStorageFaults(
      recordAttemptQueries(attemptQueries),
      recordAttemptReads(attemptReads),
    );
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const target = await seed(delivery, "signal-summary-target", 1n);
    const other = await seed(delivery, "signal-summary-other", 2n);

    await requireAttempts(delivery).recordFailure({
      message: other,
      node: "node-b",
      attemptedAt: new Date("2026-07-08T09:00:05.000Z"),
      accepted: true,
      stage: "ENDPOINT",
      reason: "ENDPOINT_REJECTED",
    });
    await requireAttempts(delivery).recordFailure({
      message: target,
      node: "node-a",
      attemptedAt: new Date("2026-07-08T09:00:01.000Z"),
      accepted: true,
      stage: "ENDPOINT",
      reason: "ENDPOINT_REJECTED",
    });
    await requireAttempts(delivery).recordFailure({
      message: target,
      node: "node-a",
      attemptedAt: new Date("2026-07-08T09:00:02.000Z"),
      accepted: false,
      stage: "LEASE",
      reason: "LEASE_INACTIVE",
    });
    attemptQueries.length = 0;
    attemptReads.length = 0;

    const summary = await requireAttempts(delivery).summarize(target.id);

    expect(summary.count).toBe(2);
    expect(summary.attempts.map((attempt) => attempt.signalId)).toEqual([
      "signal-summary-target",
      "signal-summary-target",
    ]);
    expect(summary.latestAttempt).toMatchObject({
      signalId: "signal-summary-target",
      accepted: false,
      stage: "LEASE",
      reason: "LEASE_INACTIVE",
    });
    expect(summary.latestStage).toBe("LEASE");
    expect(summary.latestReason).toBe("LEASE_INACTIVE");
    expect(summary.latestAccepted).toBe(false);
    expect(attemptQueries).toEqual([]);
    expect(attemptReads).toHaveLength(100);
    expect(attemptReads[0]).toBe(`${messageKey(target)}:attempt:000000000001`);
    expect(attemptReads.at(-1)).toBe(`${messageKey(target)}:attempt:000000000100`);
    expect(
      attemptReads.every((key) => typeof key === "string" && key.startsWith(messageKey(target))),
    ).toBe(true);
  });

  it("summarizes retained attempts in sequence order after the attempt ring wraps", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const message = await seed(delivery, "signal-summary-wrap", 1n);

    for (let sequence = 1; sequence <= 105; sequence += 1) {
      await requireAttempts(delivery).recordFailure({
        message,
        node: `node-${String(sequence).padStart(3, "0")}`,
        attemptedAt: new Date(Date.UTC(2026, 6, 8, 9, 0, sequence)),
        accepted: sequence % 2 === 0,
        stage: sequence === 105 ? "STATUS_UPDATE" : sequence === 100 ? "CLEANUP" : "ENDPOINT",
        reason:
          sequence === 105
            ? "STATUS_UPDATE_FAILED"
            : sequence === 100
              ? "CLEANUP_FAILED"
              : "ENDPOINT_REJECTED",
      });
    }

    const summary = await requireAttempts(delivery).summarize(message.id);

    expect(summary.count).toBe(100);
    expect(summary.attempts.map((attempt) => attempt.node)).toEqual(
      Array.from({ length: 100 }, (_, index) => `node-${String(index + 6).padStart(3, "0")}`),
    );
    expect(summary.attempts[0]).toMatchObject({
      node: "node-006",
      attemptedAt: new Date("2026-07-08T09:00:06.000Z"),
    });
    expect(summary.latestAttempt).toMatchObject({
      node: "node-105",
      attemptedAt: new Date("2026-07-08T09:01:45.000Z"),
      accepted: false,
      stage: "STATUS_UPDATE",
      reason: "STATUS_UPDATE_FAILED",
    });
    expect(summary.latestStage).toBe("STATUS_UPDATE");
    expect(summary.latestReason).toBe("STATUS_UPDATE_FAILED");
    expect(summary.latestAccepted).toBe(false);
  });

  it("returns an explicit empty attempt summary for messages with no retained attempts", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const message = await seed(delivery, "signal-summary-empty", 1n);

    await expect(requireAttempts(delivery).summarize(message.id)).resolves.toStrictEqual({
      attempts: [],
      count: 0,
      latestAttempt: undefined,
      latestStage: undefined,
      latestReason: undefined,
      latestAccepted: undefined,
    });
  });

  it("returns attempt summary snapshots that do not share mutable objects", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const message = await seed(delivery, "signal-summary-copies", 1n);

    await requireAttempts(delivery).recordFailure({
      message,
      node: "node-a",
      attemptedAt: new Date("2026-07-08T09:00:01.000Z"),
      accepted: true,
      stage: "ENDPOINT",
      reason: "ENDPOINT_REJECTED",
    });

    const first = await requireAttempts(delivery).summarize(message.id);
    const firstAttempt = first.attempts[0];

    expect(first.latestAttempt).not.toBe(firstAttempt);
    expect(first.latestAttempt?.attemptedAt).not.toBe(firstAttempt?.attemptedAt);
    expect(first.latestAttempt?.messageId).not.toBe(firstAttempt?.messageId);
    expect(first.latestAttempt?.inboxId).not.toBe(firstAttempt?.inboxId);

    first.latestAttempt?.attemptedAt.setFullYear(1999);
    firstAttempt?.attemptedAt.setFullYear(1998);

    const second = await requireAttempts(delivery).summarize(message.id);

    expect(second.latestAttempt?.attemptedAt).toEqual(new Date("2026-07-08T09:00:01.000Z"));
    expect(second.attempts[0]?.attemptedAt).toEqual(new Date("2026-07-08T09:00:01.000Z"));
    expect(second.latestAttempt?.attemptedAt).not.toBe(first.latestAttempt?.attemptedAt);
    expect(second.attempts[0]?.attemptedAt).not.toBe(firstAttempt?.attemptedAt);
  });

  it("keeps delivery attempt summaries isolated from mutable multitenant contexts", async () => {
    const storageFactory = new InMemoryStorageFactory();
    let tenantId = "tenant-a";
    const context = {
      name: "Tasks",
      multitenant: true,
      get tenantId() {
        return tenantId;
      },
    };
    const delivery = new Delivery({
      context,
      storageFactory,
    });
    const message = await seed(delivery, "signal-summary-tenant", 1n);

    await requireAttempts(delivery).recordFailure({
      message,
      node: "node-before-mutation",
      attemptedAt: new Date("2026-07-08T09:00:01.000Z"),
      accepted: true,
      stage: "ENDPOINT",
      reason: "ENDPOINT_REJECTED",
    });
    tenantId = "tenant-b";
    await requireAttempts(delivery).recordFailure({
      message,
      node: "node-after-mutation",
      attemptedAt: new Date("2026-07-08T09:00:02.000Z"),
      accepted: false,
      stage: "LEASE",
      reason: "LEASE_INACTIVE",
    });

    const summary = await requireAttempts(delivery).summarize(message.id);
    const attempts = await requireAttempts(delivery).read();
    const tenantB = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-b" },
      storageFactory,
    });

    expect(summary.attempts.map((attempt) => attempt.node)).toEqual([
      "node-before-mutation",
      "node-after-mutation",
    ]);
    expect(summary.latestAttempt).toMatchObject({
      node: "node-after-mutation",
      stage: "LEASE",
      reason: "LEASE_INACTIVE",
    });
    expect(attempts.map((attempt) => attempt.node)).toEqual([
      "node-before-mutation",
      "node-after-mutation",
    ]);
    await expect(requireAttempts(tenantB).summarize(message.id)).resolves.toMatchObject({
      attempts: [],
      count: 0,
    });
    await expect(requireAttempts(tenantB).read()).resolves.toEqual([]);
  });

  it("does not retain attempts for successes, catch-up skips, or live-owned rows", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();
    const unavailable = await seed(delivery, "signal-live-owned", 1n);

    await seed(delivery, "signal-catch-up-skip", 2n, "CATCH_UP");
    await seed(delivery, "signal-success", 3n);
    await inboxStorageAccess.claim(
      delivery.inbox.storage,
      unavailable,
      new ShardSession(
        "message-owner",
        shard,
        "node-b",
        new Date("2026-07-08T09:00:00.000Z"),
        new Date("2026-07-08T09:01:00.000Z"),
      ),
    );

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-success"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 3,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(requireAttempts(delivery).read()).resolves.toEqual([]);
  });

  it("classifies framework cleanup and status-update failures in retained attempts", async () => {
    const cleanupFault = throwInboxClearOnce();
    const cleanupDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: deliveryStorageFaults(cleanupFault).storageFactory,
    });
    await seed(cleanupDelivery, "signal-cleanup-attempt", 1n);

    await cleanupDelivery.drain(ShardIndex.single(), {
      node: "node-a",
      onMessage() {
        throw new Error("endpoint failed");
      },
    });

    await expect(requireAttempts(cleanupDelivery).read()).resolves.toMatchObject([
      {
        signalId: "signal-cleanup-attempt",
        accepted: true,
        stage: "CLEANUP",
        reason: "CLEANUP_FAILED",
      },
    ]);

    const statusFault = throwDedupFinalizeOnce({ armed: false });
    const statusFaults = deliveryStorageFaults(statusFault);
    const statusDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: statusFaults.storageFactory,
    });
    await seed(statusDelivery, "signal-status-attempt", 1n);
    statusFault.arm();

    await statusDelivery.drain(ShardIndex.single(), {
      node: "node-a",
      onMessage() {
        return undefined;
      },
    });

    await expect(requireAttempts(statusDelivery).read()).resolves.toMatchObject([
      {
        signalId: "signal-status-attempt",
        accepted: true,
        stage: "STATUS_UPDATE",
        reason: "STATUS_UPDATE_FAILED",
      },
    ]);
  });

  it("reports framework cleanup failures after endpoint failure instead of implying retryability", async () => {
    const failedClear = throwInboxClearOnce();
    const faults = deliveryStorageFaults(failedClear);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-clear-fail", 1n);

    const firstRun = await delivery.drain(shard, {
      node: "node-a",
      onMessage() {
        throw new Error("endpoint failed");
      },
    });

    expect(firstRun).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    expect(firstRun.failures).toHaveLength(1);
    expect(firstRun.failures[0]?.message.signalId).toBe("signal-clear-fail");
    expect(firstRun.failures[0]?.error).toBeInstanceOf(AggregateError);
    expect((firstRun.failures[0]?.error as AggregateError).message).toBe(
      "Delivery failed and framework cleanup failed.",
    );
    expect((firstRun.failures[0]?.error as AggregateError).errors).toMatchObject([
      { message: "endpoint failed" },
      { message: "Inbox claim clear failed." },
    ]);
    expect(failedClear.count).toBe(1);

    const retried: string[] = [];
    const retryRun = await delivery.drain(shard, {
      node: "node-a",
      onMessage(message) {
        retried.push(message.signalId);
      },
    });

    expect(retried).toEqual([]);
    expect(retryRun).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-clear-fail", status: "TO_DELIVER" },
    ]);
  });

  it("reports framework cleanup failures when cleanup does not clear the row", async () => {
    const skippedClear = skipInboxClearOnce();
    const faults = deliveryStorageFaults(skippedClear);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-clear-skipped", 1n);

    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage() {
        throw new Error("endpoint failed");
      },
    });

    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0]?.message.signalId).toBe("signal-clear-skipped");
    expect(run.failures[0]?.error).toBeInstanceOf(AggregateError);
    expect((run.failures[0]?.error as AggregateError).message).toBe(
      "Delivery failed and framework cleanup failed.",
    );
    expect((run.failures[0]?.error as AggregateError).errors).toMatchObject([
      { message: "endpoint failed" },
      { message: "Framework cleanup did not clear the pending row." },
    ]);
    expect(skippedClear.count).toBe(1);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-clear-skipped", status: "TO_DELIVER" },
    ]);
  });

  it("skips CATCH_UP rows without starving supported rows", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-catch-up", 1n, "CATCH_UP");
    await seed(delivery, "signal-supported", 2n);

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-supported"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 2,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    expect(run.failures).toEqual([]);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-catch-up", status: "TO_DELIVER" },
    ]);
  });

  it("scans past unsupported rows before delivering up to the accepted-work limit", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-catch-up-1", 1n, "CATCH_UP");
    await seed(delivery, "signal-catch-up-2", 2n, "CATCH_UP");
    await seed(delivery, "signal-catch-up-3", 3n, "CATCH_UP");
    await seed(delivery, "signal-supported-tail", 4n);

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-supported-tail"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 4,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-catch-up-1", status: "TO_DELIVER" },
      { signalId: "signal-catch-up-2", status: "TO_DELIVER" },
      { signalId: "signal-catch-up-3", status: "TO_DELIVER" },
    ]);
  });

  it("does not consume the accepted-work limit when a pre-callback failure leaves the row pending", async () => {
    const failedClaim = throwInboxClaimOnce();
    const faults = deliveryStorageFaults(failedClaim);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-pre-callback-fails", 1n);
    await seed(delivery, "signal-pre-callback-tail", 2n);

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-pre-callback-tail"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 2,
      accepted: 1,
      delivered: 1,
      failed: 1,
    });
    expect(failedClaim.count).toBe(1);
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0]?.message.signalId).toBe("signal-pre-callback-fails");
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-pre-callback-fails", status: "TO_DELIVER" },
    ]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
      { signalId: "signal-pre-callback-tail", status: "DELIVERED" },
    ]);
  });

  it("reclaims a claim that expires while the claim-row read is pending", async () => {
    const now = { value: new Date("2026-07-08T09:00:00.999Z") };
    const readProbe = onInboxReadOnce(() => {
      now.value = new Date("2026-07-08T09:00:01.001Z");
    });
    const faults = deliveryStorageFaults(readProbe);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
      leaseMs: 60_000,
      now: () => now.value,
    });
    const shard = ShardIndex.single();
    const message = await seed(delivery, "signal-expiry-during-read", 1n);
    const claimed = await inboxStorageAccess.claim(
      delivery.inbox.storage,
      message,
      new ShardSession(
        "message-owner",
        shard,
        "node-a",
        new Date("2026-07-08T09:00:00.000Z"),
        new Date("2026-07-08T09:00:01.000Z"),
      ),
    );

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-b",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(claimed?.signalId).toBe("signal-expiry-during-read");
    expect(seen).toEqual(["signal-expiry-during-read"]);
    expect(run).toMatchObject({ accepted: 1, delivered: 1, failed: 0 });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
      { signalId: "signal-expiry-during-read", status: "DELIVERED" },
    ]);
  });

  it("does not exceed the loop failure budget before a callback is accepted", async () => {
    const failedClaim = throwInboxClaimOnce();
    const faults = deliveryStorageFaults(failedClaim);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();
    await seed(delivery, "signal-pre-callback-failure", 1n);
    await seed(delivery, "signal-after-failure", 2n);
    const seen: string[] = [];

    const run = await new DeliveryLoop({
      delivery,
      shard,
      node: "node-a",
      maxFailures: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    }).run();

    expect(seen).toEqual([]);
    expect(run).toMatchObject({
      status: "FAILED",
      processed: 1,
      accepted: 0,
      delivered: 0,
      failed: 1,
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-pre-callback-failure" },
      { signalId: "signal-after-failure" },
    ]);
    expect(failedClaim.count).toBe(1);
  });

  it("reads skipped head rows in bounded pages instead of one query per row when limit is 1", async () => {
    const faults = deliveryStorageFaults();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();
    const unavailable: InboxMessage[] = [];

    for (let index = 0; index < 1_000; index += 1) {
      unavailable.push(
        await seed(delivery, `signal-bounded-skip-${String(index)}`, BigInt(index + 1)),
      );
    }
    await seed(delivery, "signal-bounded-tail", 1_001n);

    for (const message of unavailable) {
      const claimed = await inboxStorageAccess.claim(
        delivery.inbox.storage,
        message,
        new ShardSession(
          `message-owner-${message.signalId}`,
          shard,
          "node-a",
          new Date("2026-07-08T09:00:00.000Z"),
          new Date("2026-07-08T09:01:00.000Z"),
        ),
      );
      expect(claimed?.signalId).toBe(message.signalId);
    }

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-b",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-bounded-tail"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1_001,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    expect(faults.inboxQueries).toBe(2);
  });

  it("continues skipped-head scans with a keyset cursor instead of offset probes", async () => {
    const inboxQueries: {
      readonly limit?: number;
      readonly offset?: number;
      readonly after?: boolean;
    }[] = [];
    const faults = deliveryStorageFaults(recordInboxQueries(inboxQueries));
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();

    for (let index = 0; index < 1_000; index += 1) {
      await seed(delivery, `signal-keyset-skip-${String(index)}`, BigInt(index + 1), "CATCH_UP");
    }
    await seed(delivery, "signal-keyset-supported", 1_001n);

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-keyset-supported"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1_001,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    expect(faults.inboxQueries).toBe(2);
    expect(inboxQueries).toEqual([{ limit: 1_000 }, { limit: 1, after: true }]);
  });

  it("does not skip a supported row when skipped head rows disappear between page reads", async () => {
    let queries = 0;
    let unavailable: readonly InboxMessage[] = [];
    const faults = deliveryStorageFaults(
      onInboxQuery(async () => {
        queries += 1;
        if (queries !== 2) {
          return;
        }

        await Promise.all(
          unavailable.map((message) => markDeliveredByRecord(faults.storageFactory, message)),
        );
      }),
    );
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
      leaseMs: 60_000,
      now: () => new Date("2026-07-08T09:00:00.000Z"),
    });
    const shard = ShardIndex.single();

    const head: InboxMessage[] = [];
    for (let index = 0; index < 1_000; index += 1) {
      head.push(await seed(delivery, `signal-disappearing-${String(index)}`, BigInt(index + 1)));
    }
    unavailable = head;
    await seed(delivery, "signal-reachable-tail", 1_001n);

    for (const message of head) {
      const claimed = await inboxStorageAccess.claim(
        delivery.inbox.storage,
        message,
        new ShardSession(
          `message-owner-${message.signalId}`,
          shard,
          "node-a",
          new Date("2026-07-08T09:00:00.000Z"),
          new Date("2026-07-08T09:01:00.000Z"),
        ),
      );
      expect(claimed?.signalId).toBe(message.signalId);
    }

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-b",
      limit: 1,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual(["signal-reachable-tail"]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1_001,
      accepted: 1,
      delivered: 1,
      failed: 0,
    });
    expect(faults.inboxQueries).toBe(2);
  });

  it("stops unsupported-row scanning at the storage read cap", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    for (let index = 1; index <= 2_001; index += 1) {
      await seed(delivery, `signal-catch-up-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    await seed(delivery, "signal-supported-after-budget", 2_002n);

    const seen: string[] = [];
    const run = await delivery.drain(shard, {
      node: "node-a",
      limit: 1_000,
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(seen).toEqual([]);
    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 2_000,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
    await expect(
      delivery.inbox.read(shard, { statuses: ["TO_DELIVER"], offset: 2_001 }),
    ).resolves.toMatchObject([{ signalId: "signal-supported-after-budget", status: "TO_DELIVER" }]);
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
    const failedDedupFinalize = throwDedupFinalizeOnce({ armed: false });
    const faults = deliveryStorageFaults(failedDedupFinalize);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: faults.storageFactory,
    });
    const shard = ShardIndex.single();

    await seed(delivery, "signal-guard-fails", 1n);
    failedDedupFinalize.arm();

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
    expect(failedDedupFinalize.count).toBe(1);
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

  it("skips exact-message drains when the row is no longer pending", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const stored = await seed(delivery, "signal-exact-already-delivered", 1n);
    const inboxRecords = deliveryInboxRecords(storageFactory);
    const inboxKey = messageKey(stored);
    const originalRecord = await inboxRecords.read(inboxKey);
    const delivered = Object.freeze({
      ...stored,
      status: "DELIVERED" as const,
    });
    const seen: string[] = [];
    expect(originalRecord).toBeDefined();
    await expect(
      inboxRecords.compareAndSet(inboxKey, originalRecord, InboxRecords.write(delivered)),
    ).resolves.toBe(true);

    const run = await delivery.drainMessage(stored, {
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
    expect(seen).toEqual([]);
  });

  it("skips exact-message drains for worker-unsupported labels", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const stored = await seed(delivery, "signal-exact-catch-up", 1n, "CATCH_UP");
    const seen: string[] = [];

    const run = await delivery.drainMessage(stored, {
      node: "node-a",
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(run).toMatchObject({
      status: "DRAINED",
      processed: 1,
      accepted: 0,
      delivered: 0,
      failed: 0,
    });
    expect(run.failures).toEqual([]);
    expect(seen).toEqual([]);
    await expect(delivery.inbox.read(stored.shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([
      stored,
    ]);
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
    const skippedDedupFinalize = skipDedupFinalizeOnce({ armed: false });
    const storageFactory = deliveryStorageFaults(skippedDedupFinalize).storageFactory;
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

    skippedDedupFinalize.arm();
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

    expect(skippedDedupFinalize.count).toBe(1);
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
    const skippedRepair = skipInboxRepairOnce({ armed: false });
    const storageFactory = deliveryStorageFaults(skippedRepair).storageFactory;
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

    skippedRepair.arm();
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

    expect(skippedRepair.count).toBe(1);
    expect(duplicate.outcome).toBe("DUPLICATE");
    expect(duplicate.message.status).toBe("DELIVERED");
    await expect(inboxRecords.read(messageKey(stored.message))).resolves.toEqual(
      InboxRecords.write(delivered),
    );
  });

  it("retries when pending claim recovery finalization loses a race", async () => {
    const skippedDedupFinalize = skipDedupFinalizeOnce({ armed: false });
    const storageFactory = deliveryStorageFaults(skippedDedupFinalize).storageFactory;
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

    skippedDedupFinalize.arm();
    const result = await delivery.inbox.receive({
      inboxId: pending.inboxId,
      signalId: pending.signalId,
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: pending.shard,
      whenReceived: new Date("2026-07-08T09:01:00.000Z"),
      version: 100n,
    });

    expect(skippedDedupFinalize.count).toBe(1);
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

function seed(
  delivery: Delivery,
  signalId: string,
  version: bigint,
): Promise<DeliveryEndpointMessage>;
function seed(
  delivery: Delivery,
  signalId: string,
  version: bigint,
  label: DeliveryEndpointMessage["label"],
): Promise<DeliveryEndpointMessage>;
function seed(
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

function requireAttempts(delivery: Delivery): DeliveryAttemptReader {
  const attempts = (delivery as DeliveryAttemptOwner).attempts;

  expect(attempts).toBeDefined();
  if (attempts === undefined) {
    throw new Error("Expected Delivery to expose retained attempts.");
  }

  return attempts;
}

interface DeliveryAttemptOwner {
  readonly attempts?: DeliveryAttemptReader;
}

interface DeliveryAttemptReader {
  read(): Promise<readonly DeliveryAttemptSnapshot[]>;
  recordFailure(input: {
    readonly message: DeliveryEndpointMessage;
    readonly node: string;
    readonly attemptedAt: Date;
    readonly accepted: boolean;
    readonly stage: DeliveryAttemptFailureStage;
    readonly reason: DeliveryAttemptFailureReason;
  }): Promise<void>;
  summarize(messageId: InboxMessage["id"]): Promise<DeliveryAttemptSummarySnapshot>;
}

type DeliveryAttemptFailureStage = "CLAIM" | "LEASE" | "ENDPOINT" | "CLEANUP" | "STATUS_UPDATE";

type DeliveryAttemptFailureReason =
  | "CLAIM_FAILED"
  | "LEASE_INACTIVE"
  | "ENDPOINT_REJECTED"
  | "CLEANUP_FAILED"
  | "STATUS_UPDATE_FAILED";

interface DeliveryAttemptSnapshot {
  readonly messageId: InboxMessage["id"];
  readonly inboxId: InboxId;
  readonly signalId: string;
  readonly label: DeliveryEndpointMessage["label"];
  readonly shard: ShardIndex;
  readonly node: string;
  readonly attemptedAt: Date;
  readonly accepted: boolean;
  readonly stage: DeliveryAttemptFailureStage;
  readonly reason: DeliveryAttemptFailureReason;
}

interface DeliveryAttemptSummarySnapshot {
  readonly attempts: readonly DeliveryAttemptSnapshot[];
  readonly count: number;
  readonly latestAttempt: DeliveryAttemptSnapshot | undefined;
  readonly latestStage: DeliveryAttemptFailureStage | undefined;
  readonly latestReason: DeliveryAttemptFailureReason | undefined;
  readonly latestAccepted: boolean | undefined;
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

async function markDeliveredByRecord(
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

    const pending = withoutClaim(InboxRecords.read(current, key));
    const delivered = Object.freeze({
      ...pending,
      status: "DELIVERED" as const,
    });
    await storage.compareAndSet(key, current, InboxRecords.write(delivered));
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
  });
}
