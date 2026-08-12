/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import { create, toBinary, type Message } from "@bufbuild/protobuf";
import {
  SubscriptionIdSchema,
  SubscriptionRecordSchema,
  SubscriptionSchema,
  SubscriptionStatus,
  type SubscriptionId,
  type SubscriptionRecord,
} from "@spine-event-engine/proto/client";
import {
  InMemoryStorageFactory,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
} from "../../src/stand/subscription-registry.js";
import { StandSubscriptionRecords } from "../../src/stand/subscription-records.js";

function id(value: string) {
  return create(SubscriptionIdSchema, { value });
}
function subscription(value: string) {
  return create(SubscriptionSchema, { id: id(value), topic: { id: { value: "topic" } } });
}

describe("SubscriptionRecord codec", () => {
  it("uses the explicit ID, approved status, and activation deadline", () => {
    const entry = {
      subscription: subscription("one"),
      phase: "pending" as const,
      createdAt: 1_000,
      pendingUntil: 31_000,
    };
    const record = StandSubscriptionRecords.write(entry);
    expect(record).toMatchObject({ id: { value: "one" }, status: SubscriptionStatus.PENDING });
    expect(StandSubscriptionRecords.read(record, "one")).toEqual(entry);
  });
  it("rejects unspecified status and mismatched IDs", () => {
    const record = create(SubscriptionRecordSchema, {
      id: id("one"),
      subscription: subscription("two"),
      status: SubscriptionStatus.SS_UNSPECIFIED,
      whenCreated: { seconds: 1n },
    });
    expect(() => StandSubscriptionRecords.read(record)).toThrow(
      "Stand subscription record is invalid.",
    );
  });
  it("rejects malformed timestamps, expiry order, and malformed bytes", () => {
    const pending = create(SubscriptionRecordSchema, {
      id: id("one"),
      subscription: subscription("one"),
      status: SubscriptionStatus.PENDING,
      whenCreated: { seconds: -1n },
      whenActivationExpires: { seconds: 1n },
    });
    expect(() => StandSubscriptionRecords.read(pending)).toThrow("invalid");
    const active = create(SubscriptionRecordSchema, {
      id: id("one"),
      subscription: subscription("one"),
      status: SubscriptionStatus.ACTIVE,
      whenCreated: { seconds: 1n },
      whenActivationExpires: { seconds: 2n },
    });
    expect(() => StandSubscriptionRecords.read(active)).toThrow("invalid");
    expect(() =>
      StandSubscriptionRecords.read(
        create(SubscriptionRecordSchema, { status: SubscriptionStatus.ACTIVE }),
      ),
    ).toThrow("invalid");
    expect(() =>
      StandSubscriptionRecords.read(
        create(SubscriptionRecordSchema, {
          id: id("one"),
          subscription: subscription("one"),
          status: SubscriptionStatus.PENDING,
          whenCreated: { seconds: 1n },
        }),
      ),
    ).toThrow("invalid");
    expect(() => StandSubscriptionRecords.decode(new Uint8Array([255]))).toThrow("Malformed");
    expect(() =>
      StandSubscriptionRecords.decode(toBinary(SubscriptionRecordSchema, active), "two"),
    ).toThrow("Malformed");
  });
  it("rejects invalid write times and a pending entry without expiry", () => {
    expect(() =>
      StandSubscriptionRecords.write({
        subscription: subscription("one"),
        phase: "active",
        createdAt: -1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      StandSubscriptionRecords.write({
        subscription: subscription("one"),
        phase: "pending",
        createdAt: 1,
      } as never),
    ).toThrow("invalid");
  });
  it("round-trips active records and rejects records beyond the durable size limit", () => {
    const active = StandSubscriptionRecords.write({
      subscription: subscription("active"),
      phase: "active",
      createdAt: 1_500,
    });

    expect(StandSubscriptionRecords.read(active)).toMatchObject({ phase: "active" });
    expect(() => StandSubscriptionRecords.decode(new Uint8Array(1_048_577))).toThrow("Malformed");
  });
  it("rejects timestamps that cannot be represented as a safe millisecond value", () => {
    expect(() =>
      StandSubscriptionRecords.read(
        create(SubscriptionRecordSchema, {
          id: id("one"),
          subscription: subscription("one"),
          status: SubscriptionStatus.ACTIVE,
          whenCreated: { seconds: BigInt(Number.MAX_SAFE_INTEGER), nanos: 0 },
        }),
      ),
    ).toThrow("invalid");
  });
  it("rejects pending expiry before creation and entries without an identifier", () => {
    expect(() =>
      StandSubscriptionRecords.read(
        create(SubscriptionRecordSchema, {
          id: id("one"),
          subscription: subscription("one"),
          status: SubscriptionStatus.PENDING,
          whenCreated: { seconds: 2n },
          whenActivationExpires: { seconds: 1n },
        }),
      ),
    ).toThrow("invalid");
    expect(() =>
      StandSubscriptionRecords.write({
        subscription: create(SubscriptionSchema, { topic: { id: { value: "topic" } } }),
        phase: "active",
        createdAt: 1,
      }),
    ).toThrow("ID must be non-blank");
  });
});

describe.each([
  ["memory", () => new InMemorySubscriptionRegistry()],
  [
    "storage",
    () =>
      new StorageSubscriptionRegistry(
        { name: "subscriptions", multitenant: false },
        new InMemoryStorageFactory(),
      ),
  ],
] as const)("%s subscription registry", (_name, make) => {
  afterEach(() => vi.useRealTimers());
  it("creates, activates, physically deletes, and recreates one subscription", async () => {
    const registry = make();
    await expect(registry.create(subscription("one"))).resolves.toMatchObject({
      kind: "created",
      entry: { phase: "pending" },
    });
    await expect(registry.activate(id("one"))).resolves.toMatchObject({
      kind: "activated",
      entry: { phase: "active" },
    });
    await expect(registry.delete(id("one"))).resolves.toBe("deleted");
    await expect(registry.create(subscription("one"))).resolves.toMatchObject({ kind: "created" });
    await registry.close();
  });
  it("keeps same-content create idempotent and rejects distinct content", async () => {
    const registry = make();
    await registry.create(subscription("one"));
    await expect(registry.create(subscription("one"))).resolves.toMatchObject({ kind: "existing" });
    await expect(
      registry.create(
        create(SubscriptionSchema, { id: id("one"), topic: { id: { value: "other" } } }),
      ),
    ).rejects.toThrow("different content");
    await registry.close();
  });
  it("treats a bigint ActorContext timestamp as canonical duplicate subscription content", async () => {
    const registry = make();
    const definition = create(SubscriptionSchema, {
      id: id("actor-context"),
      topic: {
        id: { value: "topic" },
        context: { actor: { value: "tester" }, timestamp: { seconds: 1n, nanos: 7 } },
      },
    });
    await expect(registry.create(definition)).resolves.toMatchObject({ kind: "created" });
    await expect(registry.create(cloneSubscription(definition))).resolves.toMatchObject({
      kind: "existing",
    });
    await registry.close();
  });
  it("rejects blank identifiers and incomplete definitions", async () => {
    const registry = make();
    await expect(
      registry.create(create(SubscriptionSchema, { topic: { id: { value: "topic" } } })),
    ).rejects.toThrow(TypeError);
    await expect(registry.create(create(SubscriptionSchema, { id: id("one") }))).rejects.toThrow(
      TypeError,
    );
    await expect(registry.get(id(" "))).rejects.toThrow(TypeError);
    await registry.close();
    await expect(registry.snapshot()).rejects.toThrow("closed");
  });
  it("expires pending entries at the activation boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const registry = make();
    await registry.create(subscription("one"));
    vi.setSystemTime(31_000);
    await expect(registry.activate(id("one"))).resolves.toEqual({ kind: "expired" });
    await expect(registry.get(id("one"))).resolves.toBeUndefined();
    await registry.close();
  });
  it("reports missing and already-active definitions without changing them", async () => {
    const registry = make();
    await expect(registry.activate(id("missing"))).resolves.toEqual({ kind: "missing" });
    await expect(registry.delete(id("missing"))).resolves.toBe("missing");
    await registry.create(subscription("active"));
    await registry.activate(id("active"));
    await expect(registry.activate(id("active"))).resolves.toMatchObject({ kind: "active" });
    await expect(registry.get(id("active"))).resolves.toMatchObject({ phase: "active" });
    await registry.close();
  });
  it("leaves active and unexpired pending definitions outside cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const registry = make();
    await registry.create(subscription("pending"));
    await registry.create(subscription("active"));
    await registry.activate(id("active"));
    await expect(registry.cleanup()).resolves.toEqual({ scanned: 0, deleted: 0, more: false });
    await expect(registry.snapshot()).resolves.toHaveLength(2);
    await registry.close();
  });
  it("cleans exactly one full page without reporting more", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const registry = make();
    for (let index = 0; index < 25; index += 1) await registry.create(subscription(String(index)));
    vi.setSystemTime(31_000);
    await expect(registry.cleanup()).resolves.toEqual({ scanned: 25, deleted: 25, more: false });
    await registry.close();
  });
  it("cleans at most 25 expired rows and reports the observed lookahead row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const registry = make();
    for (let index = 0; index < 26; index += 1)
      await registry.create(subscription(String(index).padStart(2, "0")));
    vi.setSystemTime(31_000);
    await expect(registry.cleanup()).resolves.toEqual({ scanned: 25, deleted: 25, more: true });
    await registry.close();
  });
});

describe("storage registry compare-and-set retries", () => {
  it("requests and validates one 25-plus-one pending cleanup page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let query: unknown;
    const registry = controllableRegistry((storage) => {
      const queryEntries = storage.queryEntries.bind(storage);
      storage.queryEntries = async (input) => {
        query = input;
        return await queryEntries(input);
      };
    });
    try {
      for (let index = 0; index < 25; index += 1)
        await registry.create(subscription(String(index).padStart(2, "0")));
      vi.setSystemTime(2_000);
      await registry.create(subscription("unexpired"));
      vi.setSystemTime(31_000);

      await expect(registry.cleanup()).resolves.toEqual({ scanned: 25, deleted: 25, more: false });
      expect(query).toMatchObject({
        filters: [{ column: "status", value: SubscriptionStatus.PENDING }],
        limit: 26,
        sort: [{ field: "when_activation_expires" }, { field: "id" }],
      });
    } finally {
      await registry.close();
      vi.useRealTimers();
    }
  });

  it("rejects a malformed pending row returned by the cleanup query", async () => {
    const registry = controllableRegistry((storage) => {
      storage.queryEntries = () =>
        Promise.resolve([
          {
            id: id("malformed"),
            record: create(SubscriptionRecordSchema, {
              id: id("malformed"),
              subscription: subscription("malformed"),
              status: SubscriptionStatus.PENDING,
              whenCreated: { seconds: 1n },
            }),
          },
        ]);
    });
    await expect(registry.cleanup()).rejects.toThrow("invalid");
    await registry.close();
  });

  it("retries an observed create, activation, deletion, and cleanup race", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const factory = new InMemoryStorageFactory();
    const open = factory.createRecordStorage.bind(factory);
    let losses = 4;
    factory.createRecordStorage = ((
      ...args: [StorageContext, RecordSpec<unknown, Message>, StorageGroup?]
    ) => {
      const storage = open(...args);
      const compareAndSet = storage.compareAndSet.bind(storage);
      storage.compareAndSet = async (...values) => {
        if (losses > 0) {
          losses -= 1;
          return false;
        }
        return compareAndSet(...values);
      };
      return storage;
    }) as never;
    const registry = new StorageSubscriptionRegistry(
      { name: "races", multitenant: false },
      factory,
    );
    await expect(registry.create(subscription("one"))).resolves.toMatchObject({ kind: "created" });
    await expect(registry.activate(id("one"))).resolves.toMatchObject({ kind: "activated" });
    await expect(registry.delete(id("one"))).resolves.toBe("deleted");
    await registry.create(subscription("expired"));
    vi.setSystemTime(31_000);
    await expect(registry.cleanup()).resolves.toEqual({ scanned: 1, deleted: 1, more: false });
    await registry.close();
  });

  it("rejects a storage handle that does not guarantee atomic compare-and-set", () => {
    const factory = new InMemoryStorageFactory();
    const open = factory.createRecordStorage.bind(factory);
    factory.createRecordStorage = ((
      ...args: [StorageContext, RecordSpec<unknown, Message>, StorageGroup?]
    ) => {
      const storage = open(...args);
      Object.defineProperty(storage, "atomicCompareAndSet", { value: false });
      return storage;
    }) as never;

    expect(
      () => new StorageSubscriptionRegistry({ name: "non-atomic", multitenant: false }, factory),
    ).toThrow("atomic compare-and-set");
  });

  it("preserves the original create failure when its reread is absent or conflicting", async () => {
    const absent = controllableRegistry((storage) => {
      storage.compareAndSet = () => Promise.reject(new Error("create lost"));
    });
    await expect(absent.create(subscription("one"))).rejects.toThrow("create lost");
    await absent.close();

    const conflicting = controllableRegistry((storage) => {
      const compareAndSet = storage.compareAndSet.bind(storage);
      storage.compareAndSet = async (recordId, expected, next) => {
        if (expected === undefined && next !== undefined) {
          await compareAndSet(
            recordId,
            undefined,
            StandSubscriptionRecords.write({
              subscription: subscription("one"),
              phase: "pending",
              createdAt: 1_000,
              pendingUntil: 31_000,
            }),
          );
          throw new Error("create conflicted");
        }
        return compareAndSet(recordId, expected, next);
      };
    });
    await expect(
      conflicting.create(
        create(SubscriptionSchema, { id: id("one"), topic: { id: { value: "other" } } }),
      ),
    ).rejects.toThrow("create conflicted");
    await conflicting.close();
  });

  it("accepts a matching create reread after the storage mutation reports failure", async () => {
    const registry = controllableRegistry((storage) => {
      const compareAndSet = storage.compareAndSet.bind(storage);
      storage.compareAndSet = async (recordId, expected, next) => {
        if (expected === undefined && next !== undefined) {
          await compareAndSet(recordId, expected, next);
          throw new Error("response lost");
        }
        return compareAndSet(recordId, expected, next);
      };
    });

    await expect(registry.create(subscription("one"))).resolves.toMatchObject({ kind: "created" });
    await registry.close();
  });

  it("retries false conditional mutations and reports only the rows it removed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let activationLosses = 1;
    let deletionLosses = 2;
    const registry = controllableRegistry((storage) => {
      const compareAndSet = storage.compareAndSet.bind(storage);
      storage.compareAndSet = async (recordId, expected, next) => {
        if (expected !== undefined && next !== undefined && activationLosses > 0) {
          activationLosses -= 1;
          return false;
        }
        if (expected !== undefined && next === undefined && deletionLosses > 0) {
          deletionLosses -= 1;
          return false;
        }
        return compareAndSet(recordId, expected, next);
      };
    });
    try {
      await registry.create(subscription("active"));
      await registry.activate(id("active"));
      await registry.delete(id("active"));
      await registry.create(subscription("expired"));
      vi.setSystemTime(31_000);

      await expect(registry.cleanup()).resolves.toEqual({ scanned: 1, deleted: 1, more: false });
    } finally {
      await registry.close();
      vi.useRealTimers();
    }
  });

  it("rejects malformed stored records observed through the public storage seam", async () => {
    const registry = controllableRegistry((storage) => {
      storage.read = () =>
        Promise.resolve(
          create(SubscriptionRecordSchema, {
            id: id("other"),
            subscription: subscription("other"),
            status: SubscriptionStatus.ACTIVE,
            whenCreated: { seconds: 1n },
          }),
        );
    });

    await expect(registry.get(id("one"))).rejects.toThrow("invalid");
    await registry.close();
    await registry.close();
  });
});

function controllableRegistry(
  configure: (storage: RecordStorage<SubscriptionId, SubscriptionRecord>) => void,
): StorageSubscriptionRegistry {
  const factory = new InMemoryStorageFactory();
  const open = factory.createRecordStorage.bind(factory);
  factory.createRecordStorage = ((
    ...args: [StorageContext, RecordSpec<unknown, Message>, StorageGroup?]
  ) => {
    const storage = open(...args);
    configure(storage as never);
    return storage;
  }) as never;
  return new StorageSubscriptionRegistry({ name: "controlled", multitenant: false }, factory);
}

function cloneSubscription(value: ReturnType<typeof subscription>) {
  return create(SubscriptionSchema, {
    id: value.id,
    topic: value.topic,
  });
}
