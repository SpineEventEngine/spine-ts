import type { Message } from "@bufbuild/protobuf";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import {
  type RecordQuery,
  type RecordSpec,
  RecordStorage,
  StorageFactory,
  type StorageContext,
} from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import {
  DedupRecords,
  dedupRecordSpec,
  InboxRecords,
  inboxRecordSpec,
} from "../../src/delivery/inbox-records.js";
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

function messageKey(message: InboxMessage): string {
  return `${message.id.shard.key()}:${message.id.value}`;
}

function deliveryInboxRecords(storageFactory: InMemoryStorageFactory) {
  return storageFactory.createRecordStorage(
    { name: "Tasks.delivery.inbox", multitenant: false },
    inboxRecordSpec,
  );
}

interface DeliveryFaultPlan {
  throwDedupFinalizeOnce?: boolean;
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

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
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
