import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  RecordSpec,
  RecordStorage,
  type RecordQuery,
  type StorageContext,
  StorageFactory,
} from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { DeliveryStorageCorruptionError } from "../../src/delivery/delivery-storage-error.js";
import { ShardedWorkRegistry } from "../../src/delivery/sharded-work-registry.js";
import { Delivery } from "../../src/delivery/delivery.js";
import { ShardIndex, ShardSession } from "../../src/index.js";

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
      leaseMs: 1_000,
      now: () => firstNow.value,
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 1_000,
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

  it("replaces a shard session when storage read delay crosses expiry during pickup", async () => {
    const storageFactory = new DelayedReadStorageFactory();
    const now = { value: new Date("2026-07-02T09:11:00.000Z") };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 1_000,
      now: () => now.value,
    });
    const shard = new ShardIndex(0, 2);

    const firstSession = await delivery.shards.pickUp(shard, "node-a");
    if (firstSession === undefined) {
      throw new Error("Expected first shard pickup to create a session.");
    }
    now.value = new Date("2026-07-02T09:11:00.999Z");
    storageFactory.onShardRead = () => {
      now.value = new Date("2026-07-02T09:11:01.001Z");
    };

    await expect(delivery.shards.pickUp(shard, "node-b")).resolves.toMatchObject({
      node: "node-b",
      shard,
      pickedUpAt: new Date("2026-07-02T09:11:01.001Z"),
      expiresAt: new Date("2026-07-02T09:11:02.001Z"),
    });
  });

  it("does not renew a delayed shard session after expiry", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const firstNow = { value: new Date("2026-07-02T09:12:00.000Z") };
    const secondNow = { value: new Date("2026-07-02T09:12:01.001Z") };
    const first = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 1_000,
      now: () => firstNow.value,
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 1_000,
      now: () => secondNow.value,
    });
    const shard = new ShardIndex(0, 2);

    const session = await first.shards.pickUp(shard, "node-a");
    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }
    firstNow.value = new Date("2026-07-02T09:12:01.001Z");

    await expect(first.shards.renew(session)).resolves.toBeUndefined();
    await expect(second.shards.pickUp(shard, "node-b")).resolves.toMatchObject({
      node: "node-b",
      shard,
    });
  });

  it("does not renew when storage read delay crosses expiry", async () => {
    const storageFactory = new DelayedReadStorageFactory();
    const now = { value: new Date("2026-07-02T09:13:00.000Z") };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 1_000,
      now: () => now.value,
    });
    const shard = new ShardIndex(0, 2);

    const session = await delivery.shards.pickUp(shard, "node-a");
    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }
    storageFactory.onShardRead = () => {
      now.value = new Date("2026-07-02T09:13:01.001Z");
    };

    await expect(delivery.shards.renew(session)).resolves.toBeUndefined();
  });

  it("does not release a delayed shard session after expiry", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const now = { value: new Date("2026-07-02T09:14:00.000Z") };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 1_000,
      now: () => now.value,
    });
    const shard = new ShardIndex(0, 2);

    const session = await delivery.shards.pickUp(shard, "node-a");
    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }
    now.value = new Date("2026-07-02T09:14:01.001Z");

    await expect(delivery.shards.release(session)).resolves.toBe(false);
    await expect(delivery.shards.pickUp(shard, "node-b")).resolves.toMatchObject({
      node: "node-b",
      shard,
    });
  });

  it("does not release when storage read delay crosses expiry", async () => {
    const storageFactory = new DelayedReadStorageFactory();
    const now = { value: new Date("2026-07-02T09:15:00.000Z") };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      leaseMs: 1_000,
      now: () => now.value,
    });
    const shard = new ShardIndex(0, 2);

    const session = await delivery.shards.pickUp(shard, "node-a");
    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }
    storageFactory.onShardRead = () => {
      now.value = new Date("2026-07-02T09:15:01.001Z");
    };

    await expect(delivery.shards.release(session)).resolves.toBe(false);
    await expect(delivery.shards.pickUp(shard, "node-b")).resolves.toMatchObject({
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
          leaseMs: 1,
        }),
    ).toThrow(/at least 1000/);
    expect(
      () =>
        new ShardedWorkRegistry({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: 1,
        }),
    ).toThrow(/at least 1000/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: 0,
        }),
    ).toThrow(/positive safe integer/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: -1,
        }),
    ).toThrow(/positive safe integer/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: 1.5,
        }),
    ).toThrow(/positive safe integer/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(/positive safe integer/);
    expect(
      () =>
        new Delivery({
          context: { name: "Tasks", multitenant: false },
          storageFactory: new InMemoryStorageFactory(),
          leaseMs: 2_147_483_648,
        }),
    ).toThrow(/at most 2147483647/);
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

  it("fails closed when stored shard sessions contain invalid UTF-8", async () => {
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
      value: invalidUtf8JsonBytes(
        {
          key: "0/1",
          id: "session-1",
          node: "node-a",
          shardIndex: 0,
          shardTotal: 1,
          pickedUpAtMs: Date.parse("2026-07-02T09:34:30.000Z"),
          expiresAtMs: Date.parse("2026-07-02T09:35:30.000Z"),
        },
        "node-a",
      ),
    });

    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("classifies corrupt stored shard-session Any envelopes as storage corruption", async () => {
    const storageFactory = new CorruptibleStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:35:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);

    await delivery.shards.pickUp(shard, "seed-node");
    storageFactory.writeRawStoredSession({
      typeUrl: "type.spine-ts.dev/internal/ShardSessionRecord",
      value: undefined as unknown as Uint8Array,
    } as unknown as Any);

    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("classifies stored shard-session type URL accessor failures as storage corruption", async () => {
    const storageFactory = new RawSessionFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:35:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);

    await delivery.shards.pickUp(shard, "seed-node");
    storageFactory.writeRawSession({
      get typeUrl() {
        throw new Error("type URL getter failed");
      },
      value: Buffer.from("{}", "utf8"),
    } as unknown as Any);

    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toThrow(/type url/i);
  });

  it("classifies shard-session value clone failures during pickup as storage corruption", async () => {
    const storageFactory = new CloneFailureStorageFactory({
      throwReadError: new Error("Storage value could not be cloned."),
    });
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:35:00.000Z"),
    });

    await expect(delivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("classifies corrupt stored shard-session coordinates as storage corruption", async () => {
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
      value: Buffer.from(
        JSON.stringify({
          key: "0/0",
          id: "session-1",
          node: "node-a",
          shardIndex: 0,
          shardTotal: 0,
          pickedUpAtMs: Date.parse("2026-07-02T09:34:30.000Z"),
          expiresAtMs: Date.parse("2026-07-02T09:35:30.000Z"),
        }),
        "utf8",
      ),
    });

    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("fails closed when stored shard-session text fields exceed storage limits", async () => {
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
      value: Buffer.from(
        JSON.stringify({
          key: "0/1",
          id: oversizedText(20 * 1024),
          node: "node-a",
          shardIndex: 0,
          shardTotal: 1,
          pickedUpAtMs: Date.parse("2026-07-02T09:34:30.000Z"),
          expiresAtMs: Date.parse("2026-07-02T09:35:30.000Z"),
        }),
        "utf8",
      ),
    });

    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(delivery.shards.pickUp(shard, "node-a")).rejects.toThrow(/session id/i);
  });

  it("rejects oversized shard nodes before building a session record", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:36:00.000Z"),
    });

    const pickUp = delivery.shards.pickUp(new ShardIndex(0, 1), oversizedText(20 * 1024));

    await expect(pickUp).rejects.toThrow(/node/i);
    await expect(pickUp).rejects.not.toBeInstanceOf(DeliveryStorageCorruptionError);
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

  it("fails closed when a stored shard-session expiry time is out of range", async () => {
    const storageFactory = new CorruptibleStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:38:00.000Z"),
    });
    const shard = new ShardIndex(0, 1);

    await delivery.shards.pickUp(shard, "seed-node");
    storageFactory.writeStoredSession(
      storedSessionRecord("0/1", "session-1", "node-a", {
        pickedUpAtMs: Date.parse("2026-07-02T09:37:30.000Z"),
        expiresAtMs: Number.MAX_SAFE_INTEGER,
      }),
    );

    const pickup = delivery.shards.pickUp(shard, "node-a");

    await expect(pickup).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(pickup).rejects.toThrow(/expiry time/i);
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

    const blankNodePickup = blankNodeDelivery.shards.pickUp(shard, "   ");
    const invalidTimePickup = invalidTimeDelivery.shards.pickUp(shard, "node-a");

    await expect(blankNodePickup).rejects.toThrow(/node/i);
    await expect(blankNodePickup).rejects.not.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(invalidTimePickup).rejects.toThrow(/pickup time/i);
    await expect(invalidTimePickup).rejects.not.toBeInstanceOf(DeliveryStorageCorruptionError);
  });

  it("rejects invalid pickup inputs before opening shard storage", async () => {
    const storageFactory = new CountingStorageFactory();
    const blankNodeDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:45:00.000Z"),
    });
    const invalidTimeDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date(Number.NaN),
    });

    await expect(blankNodeDelivery.shards.pickUp(new ShardIndex(0, 1), "   ")).rejects.toThrow(
      /node/i,
    );
    await expect(invalidTimeDelivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toThrow(
      /pickup time/i,
    );

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
  });

  it("rejects non-Date pickup clocks before opening shard storage", async () => {
    const storageFactory = new CountingStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: (() => "2026-07-02T09:45:00.000Z") as unknown as () => Date,
    });

    await expect(delivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toThrow(
      "Shard pickup time is invalid.",
    );

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
  });

  it("rejects throwing pickup clocks before opening shard storage", async () => {
    const storageFactory = new CountingStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () =>
        new (class extends Date {
          override getTime(): number {
            throw new Error("pickup clock getter failed");
          }
        })("2026-07-02T09:45:00.000Z"),
    });

    await expect(delivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toThrow(
      "Shard pickup time is invalid.",
    );

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
  });

  it("rejects pickup shard accessor failures with a stable error before opening storage", async () => {
    const storageFactory = new CountingStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:45:00.000Z"),
    });

    const indexRejection = await delivery.shards
      .pickUp(
        {
          get index() {
            throw new Error("Shard index confidential getter failed");
          },
          ofTotal: 2,
        } as unknown as ShardIndex,
        "node-a",
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const totalRejection = await delivery.shards
      .pickUp(
        {
          index: 0,
          get ofTotal() {
            throw new Error("Shard index total confidential getter failed");
          },
        } as unknown as ShardIndex,
        "node-a",
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(indexRejection).toBeInstanceOf(Error);
    expect(totalRejection).toBeInstanceOf(Error);
    expect(indexRejection).toMatchObject({ message: "Shard index is invalid." });
    expect(totalRejection).toMatchObject({ message: "Shard index is invalid." });
    expect(JSON.stringify(indexRejection)).not.toContain("confidential getter failed");
    expect(JSON.stringify(totalRejection)).not.toContain("confidential getter failed");
    expect((indexRejection as Error & { cause?: unknown }).cause).toBeUndefined();
    expect((totalRejection as Error & { cause?: unknown }).cause).toBeUndefined();

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
  });

  it("rejects non-object pickup shards before opening shard storage", async () => {
    const storageFactory = new CountingStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:46:00.000Z"),
    });

    await expect(
      delivery.shards.pickUp(undefined as unknown as ShardIndex, "node-a"),
    ).rejects.toThrow("Shard index is invalid.");

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
  });

  it("rejects non-integer pickup shard coordinates before opening shard storage", async () => {
    const storageFactory = new CountingStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:46:00.000Z"),
    });

    await expect(
      delivery.shards.pickUp({ index: "0", ofTotal: 1 } as unknown as ShardIndex, "node-a"),
    ).rejects.toThrow(/finite integer/);

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
  });

  it("rejects out-of-range pickup shard coordinates before opening shard storage", async () => {
    const storageFactory = new CountingStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:46:00.000Z"),
    });

    await expect(
      delivery.shards.pickUp({ index: 0, ofTotal: 0 } as unknown as ShardIndex, "node-a"),
    ).rejects.toThrow("Shard index is invalid.");

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
  });

  it("sanitizes shard pickup input once when caller key disagrees with shard coordinates", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:46:00.000Z"),
    });
    const fakeShard = Object.freeze({
      index: 1,
      ofTotal: 2,
      key: () => "0/2",
    });

    const session = await delivery.shards.pickUp(fakeShard, "node-a");

    expect(session).toMatchObject({
      node: "node-a",
      shard: new ShardIndex(1, 2),
    });
    await expect(delivery.shards.pickUp(new ShardIndex(1, 2), "node-b")).resolves.toBeUndefined();
    await expect(delivery.shards.pickUp(new ShardIndex(0, 2), "node-c")).resolves.toMatchObject({
      node: "node-c",
      shard: new ShardIndex(0, 2),
    });
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

  it("fails clearly when shard pickup compare-and-set keeps missing", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new RetryingStorageFactory({ failCreateAlways: true }),
      now: () => new Date("2026-07-02T09:50:00.000Z"),
    });

    await expect(delivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toThrow(
      /shard pickup could not be completed due to concurrent changes/i,
    );
  });

  it("fails clearly when shard release compare-and-set keeps missing", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new RetryingStorageFactory({ failReleaseAlways: true }),
      now: () => new Date("2026-07-02T09:50:00.000Z"),
    });
    const session = await delivery.shards.pickUp(new ShardIndex(0, 1), "node-a");

    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }

    await expect(delivery.shards.release(session)).rejects.toThrow(
      /shard release could not be completed due to concurrent changes/i,
    );
  });

  it("propagates shard pickup compare-and-set failures", async () => {
    const storageFactory = new RetryingStorageFactory({
      throwCreateError: new Error("Shard pickup storage failed."),
    });
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:50:00.000Z"),
    });

    await expect(delivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toThrow(
      /shard pickup storage failed/i,
    );
    expect(storageFactory.createAttempts).toBe(1);
  });

  it("classifies shard pickup compare-and-set clone failures as storage corruption", async () => {
    const storageFactory = new RetryingStorageFactory({
      throwCreateError: new Error("Storage value could not be cloned."),
    });
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:50:00.000Z"),
    });

    await expect(delivery.shards.pickUp(new ShardIndex(0, 1), "node-a")).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    expect(storageFactory.createAttempts).toBe(1);
  });

  it("propagates shard release compare-and-set failures", async () => {
    const storageFactory = new RetryingStorageFactory({
      throwReleaseError: new Error("Shard release storage failed."),
    });
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:50:00.000Z"),
    });
    const session = await delivery.shards.pickUp(new ShardIndex(0, 1), "node-a");

    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }

    await expect(delivery.shards.release(session)).rejects.toThrow(/shard release storage failed/i);
    expect(storageFactory.releaseAttempts).toBe(1);
  });

  it("classifies shard release compare-and-set clone failures as storage corruption", async () => {
    const storageFactory = new RetryingStorageFactory({
      throwReleaseError: new Error("Storage value could not be cloned."),
    });
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:50:00.000Z"),
    });
    const session = await delivery.shards.pickUp(new ShardIndex(0, 1), "node-a");

    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }

    await expect(delivery.shards.release(session)).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    expect(storageFactory.releaseAttempts).toBe(1);
  });

  it("uses one canonical release snapshot when caller session shard drifts", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:52:00.000Z"),
    });
    const shard = new ShardIndex(0, 2);
    const otherShard = new ShardIndex(1, 2);
    const session = await delivery.shards.pickUp(shard, "node-a");
    let shardReads = 0;

    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }

    const driftingSession: ShardSession = {
      get id() {
        return session.id;
      },
      get shard() {
        shardReads += 1;
        return shardReads <= 2 ? shard : otherShard;
      },
      get node() {
        return session.node;
      },
      get pickedUpAt() {
        return session.pickedUpAt;
      },
      get expiresAt() {
        return session.expiresAt;
      },
    };

    await expect(delivery.shards.release(driftingSession)).resolves.toBe(true);
    await expect(delivery.shards.pickUp(shard, "node-b")).resolves.toMatchObject({
      node: "node-b",
      shard,
    });
  });

  it("rejects release session accessor failures with a stable invalid-session error", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T09:54:00.000Z"),
    });
    const session = await delivery.shards.pickUp(new ShardIndex(0, 1), "node-a");

    if (session === undefined) {
      throw new Error("Expected shard pickup to create a session.");
    }

    await expect(
      delivery.shards.release({
        get shard() {
          throw new Error("session shard getter failed");
        },
      } as unknown as ShardSession),
    ).rejects.toThrow("Shard session is invalid.");
    await expect(
      delivery.shards.release({
        shard: session.shard,
        get id() {
          throw new Error("session id getter failed");
        },
        node: session.node,
      } as unknown as ShardSession),
    ).rejects.toThrow("Shard session is invalid.");
    await expect(
      delivery.shards.release({
        shard: session.shard,
        id: session.id,
        get node() {
          throw new Error("session node getter failed");
        },
      } as unknown as ShardSession),
    ).rejects.toThrow("Shard session is invalid.");
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

  writeRawStoredSession(record: Message): void {
    if (!this.#capturedStorage) {
      throw new Error("Expected shard storage to be captured.");
    }

    this.#records.set(JSON.stringify("0/1"), record);
  }
}

class RawSessionFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  #raw: Message | undefined;

  writeRawSession(record: Message): void {
    this.#raw = record;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new RawSessionStorage(
      context,
      recordSpec,
      this.#delegate.createRecordStorage(context, recordSpec),
      () => this.#raw,
    );
  }
}

class RawSessionStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #raw: () => Message | undefined;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    raw: () => Message | undefined,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#raw = raw;
  }

  override close(): void {
    this.#delegate.close();
    super.close();
  }

  override read(id: I): Promise<R | undefined> {
    const raw = this.#raw();

    return raw === undefined ? this.#delegate.read(id) : Promise.resolve(raw as R);
  }

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected queryRecordEntries(query: RecordQuery<I>): Promise<readonly { id: I; record: R }[]> {
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

class DelayedReadStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  onShardRead: (() => void) | undefined;

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new DelayedReadRecordStorage(
      context,
      recordSpec,
      this.#delegate.createRecordStorage(context, recordSpec),
      () => this.onShardRead,
    );
  }
}

class DelayedReadRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #onShardRead: () => (() => void) | undefined;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    onShardRead: () => (() => void) | undefined,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#onShardRead = onShardRead;
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
    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected queryRecordEntries(query: RecordQuery<I>): Promise<readonly { id: I; record: R }[]> {
    return this.#delegate.queryEntries(query);
  }

  protected async readRecord(id: I): Promise<R | undefined> {
    const record = await this.#delegate.read(id);
    if (this.context.name.endsWith(".delivery.shards")) {
      this.#onShardRead()?.();
    }

    return record;
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

  protected queryRecordEntries(): Promise<readonly { id: I; record: R }[]> {
    return Promise.resolve(
      [...this.#records.entries()].map(([key, record]) => ({
        id: JSON.parse(key) as I,
        record: record as R,
      })),
    );
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
    failCreateAlways?: boolean;
    failReleaseOnce?: boolean;
    failReleaseAlways?: boolean;
    throwCreateError?: Error;
    throwReleaseError?: Error;
  };
  createAttempts = 0;
  releaseAttempts = 0;

  constructor(plan: {
    failCreateOnce?: boolean;
    failCreateAlways?: boolean;
    failReleaseOnce?: boolean;
    failReleaseAlways?: boolean;
    throwCreateError?: Error;
    throwReleaseError?: Error;
  }) {
    super();
    this.#plan = plan;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = this.#delegate.createRecordStorage(context, recordSpec);

    return new RetryingRecordStorage(
      context,
      recordSpec,
      storage,
      this.#plan,
      () => {
        this.createAttempts += 1;
      },
      () => {
        this.releaseAttempts += 1;
      },
    );
  }
}

class CloneFailureStorageFactory extends StorageFactory {
  readonly #error: Error | undefined;

  constructor(plan: { throwReadError?: Error }) {
    super();
    this.#error = plan.throwReadError;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new CloneFailureRecordStorage(context, recordSpec, this.#error);
  }
}

class CloneFailureRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #error: Error | undefined;

  constructor(context: StorageContext, recordSpec: RecordSpec<I, R>, error: Error | undefined) {
    super(context, recordSpec);
    this.#error = error;
  }

  protected compareAndSetRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected queryRecordEntries(): Promise<readonly { id: I; record: R }[]> {
    return Promise.resolve([]);
  }

  protected readRecord(): Promise<R | undefined> {
    if (this.#error !== undefined) {
      return Promise.reject(this.#error);
    }

    return Promise.resolve(undefined);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

class RetryingRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #plan: {
    failCreateOnce?: boolean;
    failCreateAlways?: boolean;
    failReleaseOnce?: boolean;
    failReleaseAlways?: boolean;
    throwCreateError?: Error;
    throwReleaseError?: Error;
  };
  readonly #countCreateAttempt: () => void;
  readonly #countReleaseAttempt: () => void;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    plan: {
      failCreateOnce?: boolean;
      failCreateAlways?: boolean;
      failReleaseOnce?: boolean;
      failReleaseAlways?: boolean;
      throwCreateError?: Error;
      throwReleaseError?: Error;
    },
    countCreateAttempt: () => void,
    countReleaseAttempt: () => void,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#plan = plan;
    this.#countCreateAttempt = countCreateAttempt;
    this.#countReleaseAttempt = countReleaseAttempt;
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
      if (expected === undefined && next !== undefined && this.#plan.failCreateAlways === true) {
        this.#countCreateAttempt();
        return Promise.resolve(false);
      }

      if (expected === undefined && next !== undefined && this.#plan.failCreateOnce === true) {
        this.#countCreateAttempt();
        this.#plan.failCreateOnce = false;
        return Promise.resolve(false);
      }

      if (
        expected === undefined &&
        next !== undefined &&
        this.#plan.throwCreateError !== undefined
      ) {
        this.#countCreateAttempt();
        throw this.#plan.throwCreateError;
      }

      if (expected !== undefined && next === undefined && this.#plan.failReleaseAlways === true) {
        this.#countReleaseAttempt();
        return Promise.resolve(false);
      }

      if (expected !== undefined && next === undefined && this.#plan.failReleaseOnce === true) {
        this.#countReleaseAttempt();
        this.#plan.failReleaseOnce = false;
        return Promise.resolve(false);
      }

      if (
        expected !== undefined &&
        next === undefined &&
        this.#plan.throwReleaseError !== undefined
      ) {
        this.#countReleaseAttempt();
        throw this.#plan.throwReleaseError;
      }
    }

    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected queryRecordEntries(query: RecordQuery<I>): Promise<readonly { id: I; record: R }[]> {
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

class CountingStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  opens = 0;
  closes = 0;

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.opens += 1;
    const storage = this.#delegate.createRecordStorage(context, recordSpec);
    return new CountingRecordStorage(context, recordSpec, storage, () => {
      this.closes += 1;
    });
  }
}

class CountingRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #onClose: () => void;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    onClose: () => void,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#onClose = onClose;
  }

  override close(): void {
    this.#delegate.close();
    this.#onClose();
    super.close();
  }

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected queryRecordEntries(query: RecordQuery<I>): Promise<readonly { id: I; record: R }[]> {
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

function invalidUtf8JsonBytes(value: Record<string, unknown>, marker: string): Buffer {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  const markerBytes = Buffer.from(marker, "utf8");
  const markerIndex = encoded.indexOf(markerBytes);

  if (markerIndex < 0) {
    throw new Error(`Expected marker "${marker}" in encoded JSON.`);
  }

  return Buffer.concat([
    encoded.subarray(0, markerIndex),
    Buffer.from([0x80]),
    encoded.subarray(markerIndex + 1),
  ]);
}
