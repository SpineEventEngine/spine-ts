import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  RecordStorage,
  type RecordQuery,
  type RecordSpec,
  type StorageContext,
  StorageFactory,
} from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { DeliveryStorageCorruptionError } from "../../src/delivery/delivery-storage-error.js";
import { Delivery, ShardIndex, ShardSession } from "../../src/index.js";

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

  it("rejects invalid lease durations", () => {
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: 0,
        }),
    ).toThrow(/positive integer/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: -1,
        }),
    ).toThrow(/positive integer/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: 1.5,
        }),
    ).toThrow(/positive integer/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(/positive integer/);
  });

  it("returns false when releasing a missing or mismatched shard session", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:20:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);
    const session = await delivery.shards.pickUp(shard, "node-a");

    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }

    await expect(
      delivery.shards.release(
        new ShardSession(
          "other-session",
          session.shard,
          session.node,
          session.pickedUpAt,
          session.expiresAt,
        ),
      ),
    ).resolves.toBe(false);
    await expect(
      delivery.shards.release(
        new ShardSession(
          session.id,
          session.shard,
          "node-b",
          session.pickedUpAt,
          session.expiresAt,
        ),
      ),
    ).resolves.toBe(false);
    await expect(delivery.shards.release(session)).resolves.toBe(true);
    await expect(delivery.shards.release(session)).resolves.toBe(false);
  });

  it("rejects corrupted stored shard sessions", async () => {
    const storageFactory = new CorruptibleStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:30:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);

    await delivery.shards.pickUp(shard, "seed-node");
    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/WrongShardSessionRecord",
      value: Buffer.from("{}"),
    });
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );

    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: Buffer.from("[]", "utf8"),
    });
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );

    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: Buffer.from(
        JSON.stringify({
          key: "1/1",
          id: "session-1",
          node: "node-a",
          shardIndex: 0,
          shardTotal: 1,
          pickedUpAtMs: 1,
          expiresAtMs: 2,
        }),
        "utf8",
      ),
    });
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );

    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: Buffer.from(
        JSON.stringify({
          key: "0/1",
          id: "session-1",
          node: "node-a",
          shardIndex: "bad",
          shardTotal: 1,
          pickedUpAtMs: 1,
          expiresAtMs: 2,
        }),
        "utf8",
      ),
    });
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );

    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: Buffer.from(
        JSON.stringify({
          key: "0/1",
          id: "session-1",
          node: " ",
          shardIndex: 0,
          shardTotal: 1,
          pickedUpAtMs: 1,
          expiresAtMs: 2,
        }),
        "utf8",
      ),
    });
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );

    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: Buffer.from(
        JSON.stringify({
          key: "0/1",
          id: "session-1",
          node: "node-a",
          shardIndex: 0,
          shardTotal: 1,
          pickedUpAtMs: 1,
          expiresAtMs: "bad",
        }),
        "utf8",
      ),
    });
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );

    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: Buffer.from("{", "utf8"),
    });
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects oversized stored shard sessions before parsing JSON", async () => {
    const storageFactory = new CorruptibleStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:35:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);

    await delivery.shards.pickUp(shard, "seed-node");
    storageFactory.writeStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: Buffer.concat([Buffer.from("{", "utf8"), Buffer.alloc(512 * 1024)]),
    });

    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toThrow(/record exceeds/i);
  });

  it("rejects oversized shard nodes before building a session record", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:36:00.000Z"),
    });

    await expect(
      delivery.shards.pickUp(new ShardIndex(0, 1), oversizedText(20 * 1024)),
    ).rejects.toThrow(/node/i);
  });

  it("rejects a shard session record stored under another shard slot during pickup", async () => {
    const storageFactory = new CorruptibleStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:37:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);

    await delivery.shards.pickUp(shard, "seed-node");
    storageFactory.writeStoredSession(
      storedSessionRecord("1/2", "session-1", "node-a", {
        pickedUpAtMs: Date.parse("2026-07-02T09:36:30.000Z"),
        expiresAtMs: Date.parse("2026-07-02T09:37:30.000Z"),
      }),
    );

    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects a shard session record stored under another shard slot during release", async () => {
    const storageFactory = new CorruptibleStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:38:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);

    await delivery.shards.pickUp(shard, "seed-node");
    storageFactory.writeStoredSession(
      storedSessionRecord("1/2", "other-session", "node-b", {
        pickedUpAtMs: Date.parse("2026-07-02T09:37:30.000Z"),
        expiresAtMs: Date.parse("2026-07-02T09:38:30.000Z"),
      }),
    );

    await expect(
      delivery.shards.release(
        new ShardSession("session-1", shard, "node-a", new Date(1), new Date(2)),
      ),
    ).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
  });

  it("keeps multitenant shard sessions isolated by tenant", async () => {
    const storageFactory = new InMemoryStorageFactory();
    let tenantId = "tenant-a";
    const createDelivery = () =>
      new Delivery({
        context: {
          name: "Tasks",
          multitenant: true,
          get tenantId() {
            return tenantId;
          },
        },
        storageFactory,
        now: () => new Date("2026-07-02T09:40:00.000Z"),
      });
    const shard = new ShardIndex(0, 1);
    const tenantA = createDelivery();

    const first = await tenantA.shards.pickUp(shard, "node-a");
    tenantId = "tenant-b";
    const tenantB = createDelivery();
    const second = await tenantB.shards.pickUp(shard, "node-b");

    expect(first?.node).toBe("node-a");
    expect(second?.node).toBe("node-b");
  });

  it("rejects invalid pickup inputs before claiming a shard", async () => {
    const shard = new ShardIndex(0, 1);
    const blankNodeDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:45:00.000Z"),
    });
    const invalidTimeDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date(Number.NaN),
    });

    await expect(blankNodeDelivery.shards.pickUp(shard, "   ")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(invalidTimeDelivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("uses the default clock and retries a failed claim compare-and-set", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new RetryingStorageFactory({ failCreateOnce: true }),
    });
    const before = Date.now();
    const session = await delivery.shards.pickUp(new ShardIndex(0, 1), "node-a");
    const after = Date.now();

    expect(session).toMatchObject({
      node: "node-a",
      shard: new ShardIndex(0, 1),
    });
    expect(session?.pickedUpAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(session?.pickedUpAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("retries shard release when compare-and-set loses one race", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new RetryingStorageFactory({ failReleaseOnce: true }),
      now: () => new Date("2026-07-02T09:50:00.000Z"),
    });
    const session = await delivery.shards.pickUp(new ShardIndex(0, 1), "node-a");

    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }

    await expect(delivery.shards.release(session)).resolves.toBe(true);
  });

  it("passes multitenant shard contexts through to storage validation", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:55:00.000Z"),
    });

    await expect(delivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toThrow(
      /tenantId/,
    );
  });
});

class CorruptibleStorageFactory extends StorageFactory {
  readonly #records = new Map<string, Message>();
  #capturedStorage = false;

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    if (context.name === "Tasks.delivery.shards") {
      this.#capturedStorage = true;
    }

    return new CorruptibleRecordStorage(context, recordSpec, this.#records);
  }

  writeStoredSession(record: { typeUrl: string; value: Uint8Array }): void {
    if (!this.#capturedStorage) {
      throw new Error("Expected shard storage to be captured.");
    }

    this.#records.set(JSON.stringify("0/1"), create(AnySchema, record));
  }
}

class CorruptibleRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #records: Map<string, Message>;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    records: Map<string, Message>,
  ) {
    super(context, recordSpec);
    this.#records = records;
  }

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const key = JSON.stringify(id);
    const current = this.#records.get(key);

    if (current !== expected?.record && !(current === undefined && expected === undefined)) {
      return Promise.resolve(false);
    }

    if (next === undefined) {
      this.#records.delete(key);
      return Promise.resolve(true);
    }

    this.#records.set(key, next.record);
    return Promise.resolve(true);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return Promise.resolve(this.#records.delete(JSON.stringify(id)));
  }

  protected queryRecords(): Promise<readonly R[]> {
    return Promise.resolve([...this.#records.values()] as R[]);
  }

  protected readRecord(id: I): Promise<R | undefined> {
    return Promise.resolve(this.#records.get(JSON.stringify(id)) as R | undefined);
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    for (const record of records) {
      this.#records.set(JSON.stringify(record.id), record.record);
    }
    return Promise.resolve();
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    this.#records.set(JSON.stringify(record.id), record.record);
    return Promise.resolve();
  }
}

class RetryingStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  readonly #plan: {
    failCreateOnce?: boolean;
    failReleaseOnce?: boolean;
  };

  constructor(plan: { failCreateOnce?: boolean; failReleaseOnce?: boolean }) {
    super();
    this.#plan = plan;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = this.#delegate.createRecordStorage(context, recordSpec);

    return new RetryingRecordStorage(context, recordSpec, storage, this.#plan);
  }
}

class RetryingRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #plan: {
    failCreateOnce?: boolean;
    failReleaseOnce?: boolean;
  };

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    plan: { failCreateOnce?: boolean; failReleaseOnce?: boolean },
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
    if (this.context.name.endsWith(".delivery.shards")) {
      if (expected === undefined && next !== undefined && this.#plan.failCreateOnce === true) {
        this.#plan.failCreateOnce = false;
        return Promise.resolve(false);
      }

      if (expected !== undefined && next === undefined && this.#plan.failReleaseOnce === true) {
        this.#plan.failReleaseOnce = false;
        return Promise.resolve(false);
      }
    }

    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected queryRecords(query: RecordQuery<I>): Promise<readonly R[]> {
    return this.#delegate.query(query);
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

function oversizedText(length: number): string {
  return "x".repeat(length);
}

function storedSessionRecord(
  key: string,
  id: string,
  node: string,
  times: { pickedUpAtMs: number; expiresAtMs: number } = {
    pickedUpAtMs: 1,
    expiresAtMs: 2,
  },
) {
  const [shardIndex, shardTotal] = key.split("/").map((value) => Number.parseInt(value, 10));
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
    value: Buffer.from(
      JSON.stringify({
        key,
        id,
        node,
        shardIndex,
        shardTotal,
        pickedUpAtMs: times.pickedUpAtMs,
        expiresAtMs: times.expiresAtMs,
      }),
      "utf8",
    ),
  });
}
