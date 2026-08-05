import { create, toBinary, type Message } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  type Subscription,
  type SubscriptionId,
} from "@spine-event-engine/proto/client";
import {
  InMemoryStorageFactory,
  RecordSpec,
  RecordColumn,
  RecordStorage,
  StorageFactory,
  type RecordEntry,
  type RecordQuery,
  type StorageContext,
} from "@spine-event-engine/storage";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
  StandCapacityError,
  StandConflictError,
  type StandActivateResult,
  type StandCleanupResult,
  type StandCreateResult,
  type StandDeleteResult,
  type StandSubscriptionEntry,
  type StandSubscriptionRegistry,
} from "../../src/index.js";
import { StandSubscriptionRecords } from "../../src/stand/subscription-records.js";
// prettier-ignore
import {
  StandSubscriptionRecordSchema,
} from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";
// prettier-ignore
import type {
  StandSubscriptionRecord,
} from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";
import { SubscriptionPhase } from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";

const start = 1_000_000;
const stagingStorageKey = "spine.server.StandSubscriptionRecord:staging";

function id(value: string): SubscriptionId {
  return create(SubscriptionIdSchema, { value });
}

function subscription(value: string, topic = "topic"): Subscription {
  return create(SubscriptionSchema, { id: id(value), topic: { id: { value: topic } } });
}

function subscriptionAnyBytes(value: Subscription): Uint8Array {
  const criterion = value.topic?.target?.criterion;
  if (criterion?.case !== "filters") throw new Error("Expected target filters.");
  const bytes = criterion.value.idFilter?.id[0]?.value;
  if (bytes === undefined) throw new Error("Expected Any bytes.");
  return bytes;
}

describe("StandSubscriptionRecords", () => {
  const validRecord = (): StandSubscriptionRecord =>
    create(StandSubscriptionRecordSchema, {
      subscription: subscription("record"),
      phase: SubscriptionPhase.PENDING,
      createdAt: create(TimestampSchema, { seconds: 1_000n }),
      pendingUntil: create(TimestampSchema, { seconds: 1_030n }),
      revision: 1n,
      generation: new Uint8Array(16),
    });

  it("rejects malformed lifecycle fields", () => {
    const reject = (
      corrupt: (record: StandSubscriptionRecord) => void,
      expectedId = "record",
    ): void => {
      const record = validRecord();
      corrupt(record);
      expect(() => StandSubscriptionRecords.read(record, expectedId)).toThrow(
        "Stand subscription record is invalid.",
      );
    };

    reject((record) => {
      record.subscription = undefined;
    });
    reject((record) => {
      record.subscription = subscription("record");
    }, "different");
    reject((record) => {
      record.subscription = subscription("  ");
    });
    reject((record) => {
      record.subscription = subscription("record", "  ");
    });
    reject((record) => {
      record.generation = new Uint8Array();
    });
    reject((record) => {
      record.createdAt = undefined;
    });
    reject((record) => {
      record.createdAt = create(TimestampSchema, { seconds: -1n });
    });
    reject((record) => {
      record.revision = -1n;
    });
    reject((record) => {
      record.revision = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    });
    reject((record) => {
      record.createdAt = create(TimestampSchema, {
        seconds: BigInt(Number.MAX_SAFE_INTEGER),
      });
    });
    reject((record) => {
      record.pendingUntil = undefined;
    });
    reject((record) => {
      record.pendingUntil = create(TimestampSchema, {
        seconds: BigInt(Number.MAX_SAFE_INTEGER),
      });
    });
    reject((record) => {
      record.pendingUntil = create(TimestampSchema, { seconds: 999n });
    });
    reject((record) => {
      record.phase = SubscriptionPhase.SUBSCRIPTION_PHASE_UNSPECIFIED;
      record.pendingUntil = undefined;
    });
    reject((record) => {
      record.phase = SubscriptionPhase.ACTIVE;
    });
  });

  it("rejects invalid generation and time values before encoding", () => {
    const entry: StandSubscriptionEntry = {
      subscription: subscription("record"),
      phase: "pending",
      createdAt: start,
      pendingUntil: start + 30_000,
      revision: 1n,
    };

    expect(() => StandSubscriptionRecords.write(entry, new Uint8Array())).toThrow(RangeError);
    expect(() => StandSubscriptionRecords.write({ ...entry, createdAt: -1 })).toThrow(RangeError);
    expect(() => StandSubscriptionRecords.write({ ...entry, createdAt: 1.5 })).toThrow(RangeError);
  });

  it("reads an active record without a pending deadline", () => {
    const record = validRecord();
    record.phase = SubscriptionPhase.ACTIVE;
    record.pendingUntil = undefined;

    expect(StandSubscriptionRecords.read(record)).toMatchObject({
      phase: "active",
      revision: 1n,
    });
  });

  it("decodes a valid record and rejects malformed or oversized bytes", () => {
    const bytes = toBinary(StandSubscriptionRecordSchema, validRecord());

    expect(StandSubscriptionRecords.decode(bytes, "record")).toMatchObject({
      phase: "pending",
      revision: 1n,
    });
    expect(() => StandSubscriptionRecords.decode(Uint8Array.of(255))).toThrow(
      "Malformed Stand subscription record.",
    );
    expect(() => StandSubscriptionRecords.decode(new Uint8Array(1_048_577))).toThrow(
      "Malformed Stand subscription record.",
    );
  });
});

describe("InMemorySubscriptionRegistry", () => {
  it("creates a pending definition with the exact 30-second deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const registry = new InMemorySubscriptionRegistry();
      const result = await registry.create(subscription("one"));

      expect(result).toMatchObject({ kind: "created" });
      expect(result.entry).toMatchObject({
        phase: "pending",
        createdAt: start,
        pendingUntil: start + 30_000,
        revision: 1n,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns existing only for byte-equivalent definitions and rejects a conflict", async () => {
    const registry = new InMemorySubscriptionRegistry();
    await registry.create(subscription("one"));

    await expect(registry.create(subscription("one"))).resolves.toMatchObject({ kind: "existing" });
    await expect(registry.create(subscription("one", "other"))).rejects.toBeInstanceOf(
      StandConflictError,
    );
  });

  it("activates once and reports missing, expired, and already-active definitions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const registry = new InMemorySubscriptionRegistry();
      await expect(registry.activate(id("missing"))).resolves.toEqual({ kind: "missing" });

      await registry.create(subscription("active"));
      await expect(registry.activate(id("active"))).resolves.toMatchObject({
        kind: "activated",
        entry: { phase: "active", revision: 2n },
      });
      await expect(registry.activate(id("active"))).resolves.toMatchObject({
        kind: "active",
        entry: { phase: "active", revision: 2n },
      });

      await registry.create(subscription("expired"));
      vi.setSystemTime(start + 30_000);
      await expect(registry.activate(id("expired"))).resolves.toEqual({ kind: "expired" });
      await expect(registry.get(id("expired"))).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("physically deletes definitions and distinguishes stale revisions", async () => {
    const registry = new InMemorySubscriptionRegistry();
    await registry.create(subscription("one"));

    await expect(registry.delete(id("missing"))).resolves.toBe("missing");
    await expect(registry.delete(id("one"), 2n)).resolves.toBe("changed");
    await expect(registry.delete(id("one"), 1n)).resolves.toBe("deleted");
    await expect(registry.get(id("one"))).resolves.toBeUndefined();
  });

  it("enforces positive safe lower limits and the 100-definition maximum", async () => {
    expect(() => new InMemorySubscriptionRegistry(0)).toThrow(RangeError);
    expect(() => new InMemorySubscriptionRegistry(1.5)).toThrow(RangeError);
    expect(() => new InMemorySubscriptionRegistry(101)).toThrow(RangeError);
    const registry = new InMemorySubscriptionRegistry(1);
    await registry.create(subscription("one"));
    await expect(registry.create(subscription("two"))).rejects.toBeInstanceOf(StandCapacityError);
  });

  it("rejects malformed public inputs with TypeError or RangeError", async () => {
    const registry = new InMemorySubscriptionRegistry();
    await expect(
      registry.create(create(SubscriptionSchema, { id: id("missing-topic") })),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(registry.activate(id("  "))).rejects.toBeInstanceOf(TypeError);
    await registry.create(subscription("one"));
    await expect(registry.delete(id("one"), -1n)).rejects.toBeInstanceOf(RangeError);
  });

  it("rejects a topic without a non-blank identifier", async () => {
    const registry = new InMemorySubscriptionRegistry();

    await expect(
      registry.create(create(SubscriptionSchema, { id: id("missing-topic-id"), topic: {} })),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      registry.create(
        create(SubscriptionSchema, { id: id("blank-topic-id"), topic: { id: { value: "  " } } }),
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("accepts an encoded record at the 1 MiB boundary and rejects the next byte", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      let low = 1;
      let high = 1_048_576;
      while (low < high) {
        const length = Math.ceil((low + high) / 2);
        const entry = {
          subscription: subscription("x".repeat(length)),
          phase: "pending" as const,
          createdAt: start,
          pendingUntil: start + 30_000,
          revision: 1n,
        };
        try {
          toBinary(StandSubscriptionRecords.schema, StandSubscriptionRecords.write(entry));
          low = length;
        } catch {
          high = length - 1;
        }
      }

      const registry = new InMemorySubscriptionRegistry();
      await expect(registry.create(subscription("x".repeat(low)))).resolves.toMatchObject({
        kind: "created",
      });
      await expect(registry.create(subscription("x".repeat(low + 1)))).rejects.toThrow(RangeError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a deterministic bounded snapshot of cloned frozen entries", async () => {
    const registry = new InMemorySubscriptionRegistry();
    await registry.create(subscription("z"));
    await registry.create(subscription("a"));

    const snapshot = await registry.snapshot();
    const first = snapshot[0];
    if (first === undefined) throw new Error("Expected a subscription snapshot entry.");
    expect(snapshot.map((entry) => entry.subscription.id?.value)).toEqual(["a", "z"]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.subscription)).toBe(true);
    expect(first).not.toBe(await registry.get(id("a")));
  });

  it("cleans exactly one sorted page of expired pending entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const registry = new InMemorySubscriptionRegistry();
      for (let index = 29; index >= 0; index -= 1)
        await registry.create(subscription(`s-${String(index)}`));
      vi.setSystemTime(start + 30_000);

      await expect(registry.cleanup()).resolves.toEqual({ scanned: 25, deleted: 25, more: true });
      expect(await registry.snapshot()).toHaveLength(5);
      await expect(registry.cleanup()).resolves.toEqual({ scanned: 5, deleted: 5, more: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let active lexically-first definitions starve expired pending cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const registry = new InMemorySubscriptionRegistry();
      for (let index = 0; index < 25; index += 1) {
        await registry.create(subscription(`active-${String(index)}`));
        await registry.activate(id(`active-${String(index)}`));
      }
      for (let index = 0; index < 27; index += 1)
        await registry.create(subscription(`expired-${String(index)}`));
      vi.setSystemTime(start + 30_000);

      await expect(registry.cleanup()).resolves.toEqual({ scanned: 25, deleted: 25, more: true });
      await expect(registry.cleanup()).resolves.toEqual({ scanned: 2, deleted: 2, more: false });
      expect(await registry.snapshot()).toHaveLength(25);
    } finally {
      vi.useRealTimers();
    }
  });

  it("freezes clone-safe result objects and closes through one shared promise", async () => {
    const registry = new InMemorySubscriptionRegistry();
    const result = await registry.create(subscription("one"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entry)).toBe(true);
    expect(Object.isFrozen(result.entry.subscription)).toBe(true);

    const firstClose = registry.close();
    expect(registry.close()).toBe(firstClose);
    await firstClose;
    await expect(registry.create(subscription("after-close"))).rejects.toThrow("closed");
    await expect(registry.snapshot()).rejects.toThrow("closed");
  });

  it("exports the exact public registry contract", () => {
    expectTypeOf<StandSubscriptionEntry["subscription"]>().not.toEqualTypeOf<Subscription>();
    expectTypeOf<StandCreateResult>().toEqualTypeOf<
      | { readonly kind: "created"; readonly entry: StandSubscriptionEntry }
      | {
          readonly kind: "existing";
          readonly entry: StandSubscriptionEntry;
        }
    >();
    expectTypeOf<StandActivateResult>().toEqualTypeOf<
      | { readonly kind: "activated"; readonly entry: StandSubscriptionEntry }
      | { readonly kind: "active"; readonly entry: StandSubscriptionEntry }
      | { readonly kind: "missing" }
      | { readonly kind: "expired" }
    >();
    expectTypeOf<StandDeleteResult>().toEqualTypeOf<"deleted" | "missing" | "changed">();
    expectTypeOf<StandCleanupResult>().toEqualTypeOf<{
      readonly scanned: number;
      readonly deleted: number;
      readonly more: boolean;
    }>();
    expectTypeOf<InMemorySubscriptionRegistry>().toExtend<StandSubscriptionRegistry>();
  });
});

function proveSubscriptionEntryIsDeepReadonly(entry: StandSubscriptionEntry): void {
  const topic = entry.subscription.topic;
  if (topic?.id === undefined) return;
  // @ts-expect-error Public snapshots do not permit mutation of nested subscription fields.
  topic.id.value = "changed";
  const criterion = entry.subscription.topic?.target?.criterion;
  if (criterion?.case === "filters") {
    const bytes = criterion.value.idFilter?.id[0]?.value;
    if (bytes !== undefined) bytes[0] = 7;
  }
}

void proveSubscriptionEntryIsDeepReadonly;

describe("StorageSubscriptionRegistry", () => {
  it("physically removes an expired pending definition during activation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const registry = durableRegistry();
      await registry.create(subscription("expired"));
      vi.setSystemTime(start + 30_000);

      await expect(registry.activate(id("expired"))).resolves.toEqual({ kind: "expired" });
      await expect(registry.get(id("expired"))).resolves.toBeUndefined();
      await expect(registry.snapshot()).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects expired pending definitions rather than the first storage rows for cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const registry = durableRegistry();
      for (let index = 0; index < 25; index += 1) {
        await registry.create(subscription(`active-${String(index)}`));
        await registry.activate(id(`active-${String(index)}`));
      }
      for (let index = 0; index < 27; index += 1)
        await registry.create(subscription(`expired-${String(index)}`));
      vi.setSystemTime(start + 30_000);

      await expect(registry.cleanup()).resolves.toEqual({ scanned: 25, deleted: 25, more: true });
      await expect(registry.cleanup()).resolves.toEqual({ scanned: 2, deleted: 2, more: false });
      await expect(registry.snapshot()).resolves.toHaveLength(25);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares a close promise and rejects future durable operations", async () => {
    const registry = durableRegistry();
    const first = registry.close();

    expect(registry.close()).toBe(first);
    await first;
    await expect(registry.create(subscription("after-close"))).rejects.toThrow("closed");
  });

  it("admits exactly the shared lower capacity across independent handles", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "DurableRegistryCapacity", multitenant: false };
    const first = new StorageSubscriptionRegistry(context, factory, 1);
    const second = new StorageSubscriptionRegistry(context, factory, 1);

    const results = await Promise.allSettled([
      first.create(subscription("one")),
      second.create(subscription("two")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(first.snapshot()).resolves.toHaveLength(1);
  });

  it("recovers definitions through a replacement registry without adding a second row", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "DurableRegistryRestart", multitenant: false };
    const first = new StorageSubscriptionRegistry(context, factory);
    await expect(first.create(subscription("one"))).resolves.toMatchObject({ kind: "created" });
    await first.close();

    const restarted = new StorageSubscriptionRegistry(context, factory);
    await expect(restarted.create(subscription("one"))).resolves.toMatchObject({
      kind: "existing",
    });
    await expect(restarted.snapshot()).resolves.toHaveLength(1);
  });

  it("stores fifty active definitions as fifty rows and one separate control record", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "DurableRegistryShape", multitenant: false };
    const registry = new StorageSubscriptionRegistry(context, factory);
    for (let index = 0; index < 50; index += 1) {
      await registry.create(subscription(`subscription-${String(index)}`));
      await registry.activate(id(`subscription-${String(index)}`));
    }

    const definitions = factory.createRecordStorage(
      context,
      new RecordSpec<string, StandSubscriptionRecord>({
        schema: StandSubscriptionRecords.schema,
        storageKey: "spine.server.StandSubscriptionRecord:definition",
        idKind: "string",
        extractId: (record) => StandSubscriptionRecords.read(record).subscription.id?.value ?? "",
        columns: [
          new RecordColumn("admitted", (record) => record.revision > 0n, "boolean"),
          new RecordColumn(
            "pending",
            (record) => record.phase === SubscriptionPhase.PENDING,
            "boolean",
          ),
          new RecordColumn(
            "pendingUntil",
            (record) =>
              record.pendingUntil === undefined
                ? Number.MAX_SAFE_INTEGER
                : Number(record.pendingUntil.seconds) * 1000 +
                  Math.floor(record.pendingUntil.nanos / 1_000_000),
            "number",
          ),
        ],
      }),
    );
    const control = factory.createRecordStorage(
      context,
      new RecordSpec<string, Any>({
        schema: AnySchema,
        storageKey: "spine.server.StandSubscriptionRecord:control",
        idKind: "string",
        extractId: () => "control",
      }),
    );
    const stage = factory.createRecordStorage(
      context,
      new RecordSpec<string, StandSubscriptionRecord>({
        schema: StandSubscriptionRecords.schema,
        storageKey: "spine.server.StandSubscriptionRecord:staging",
        idKind: "string",
        extractId: () => "stage",
      }),
    );
    try {
      await expect(definitions.queryEntries({})).resolves.toHaveLength(50);
      await expect(control.queryEntries({})).resolves.toHaveLength(1);
      await expect(stage.queryEntries({})).resolves.toEqual([]);
    } finally {
      definitions.close();
      control.close();
      stage.close();
    }
  });

  it("clones nonempty Any bytes without freezing or aliasing them", async () => {
    const registry = durableRegistry();
    const input = create(SubscriptionSchema, {
      id: id("bytes"),
      topic: {
        id: { value: "topic" },
        target: {
          criterion: {
            case: "filters",
            value: {
              idFilter: {
                id: [
                  create(AnySchema, { typeUrl: "type.example/value", value: new Uint8Array([1]) }),
                ],
              },
            },
          },
        },
      },
    });
    const created = await registry.create(input);
    if (created.kind !== "created") throw new Error("Expected a new definition.");
    const callerBytes = subscriptionAnyBytes(input);
    const returnedBytes = subscriptionAnyBytes(created.entry.subscription as Subscription);

    callerBytes[0] = 9;
    expect(returnedBytes).toEqual(new Uint8Array([1]));
    returnedBytes[0] = 7;
    const stored = await registry.get(id("bytes"));
    if (stored === undefined) throw new Error("Expected a stored definition.");
    expect(subscriptionAnyBytes(stored.subscription as Subscription)).toEqual(new Uint8Array([1]));
  });

  it("does not reject an activate-delete race as malformed durable control", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "DurableRegistryRace", multitenant: false };
    const first = new StorageSubscriptionRegistry(context, factory);
    const second = new StorageSubscriptionRegistry(context, factory);
    const created = await first.create(subscription("one"));
    if (created.kind !== "created") throw new Error("Expected initial creation.");

    const results = await Promise.allSettled([
      first.activate(id("one")),
      second.delete(id("one"), created.entry.revision),
    ]);

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    const snapshot = await first.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ phase: "active", revision: 2n });
  });

  it.each(["create-stage", "create-definition"] as const)(
    "recovers staged %s after an applied CAS throws",
    async (phase) => {
      const factory = new StandRegistryScriptedStorageFactory(phase);
      const context = { name: `DurableRegistry${phase}`, multitenant: false };
      const interrupted = new StorageSubscriptionRegistry(context, factory);
      factory.arm();

      await expect(interrupted.create(subscription("one"))).rejects.toThrow("applied-then-thrown");

      const restarted = new StorageSubscriptionRegistry(context, factory);
      await expect(restarted.snapshot()).resolves.toHaveLength(1);
      await expect(restarted.create(subscription("two"))).resolves.toMatchObject({
        kind: "created",
      });
    },
  );

  it("lets a helper complete a held applied create stage before its owner resumes", async () => {
    const factory = new StandRegistryScriptedStorageFactory("create-stage");
    const context = { name: "DurableRegistryHeldCreateStage", multitenant: false };
    const owner = new StorageSubscriptionRegistry(context, factory, 1);
    const held = factory.hold("create-stage");
    const creating = owner.create(subscription("one"));

    await held.reached.promise;

    const helper = new StorageSubscriptionRegistry(context, factory, 1);
    await expect(helper.create(subscription("one"))).resolves.toMatchObject({ kind: "existing" });
    await expect(helper.snapshot()).resolves.toMatchObject([{ revision: 1n }]);
    await expect(helper.create(subscription("two"))).rejects.toBeInstanceOf(StandCapacityError);

    held.release.resolve(undefined);
    await expect(creating).resolves.toMatchObject({ kind: "created", entry: { revision: 1n } });
    await expect(owner.snapshot()).resolves.toMatchObject([
      { subscription: { id: { value: "one" } }, revision: 1n },
    ]);
  }, 5_000);

  it("rolls back a held control admission before its owner can write the fixed stage", async () => {
    const factory = new StandRegistryScriptedStorageFactory("create-reservation");
    const context = { name: "DurableRegistryHeldControl", multitenant: false };
    const owner = new StorageSubscriptionRegistry(context, factory, 1);
    const held = factory.hold("create-reservation");
    const creating = owner.create(subscription("one"));

    await held.reached.promise;
    const helper = new StorageSubscriptionRegistry(context, factory, 1);
    await expect(helper.create(subscription("two"))).resolves.toMatchObject({ kind: "created" });

    held.release.resolve(undefined);
    await expect(creating).rejects.toBeInstanceOf(StandCapacityError);
    await expect(helper.snapshot()).resolves.toMatchObject([
      { subscription: { id: { value: "two" } }, revision: 1n },
    ]);
  }, 5_000);

  it("fences a missing held stage at the liveness boundary and reuses its exact slot", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(start);
    try {
      const factory = new StandRegistryScriptedStorageFactory("create-reservation");
      const context = { name: "DurableRegistryMissingHeldStage", multitenant: false };
      const owner = new StorageSubscriptionRegistry(context, factory, 1);
      const held = factory.hold("create-reservation");
      const creating = owner.create(subscription("stale"));
      await held.reached.promise;

      const helper = new StorageSubscriptionRegistry(context, factory, 1);
      const recovered = helper.create(subscription("fresh"));
      await vi.advanceTimersByTimeAsync(25);
      await expect(recovered).resolves.toMatchObject({ kind: "created", entry: { revision: 1n } });

      held.release.resolve(undefined);
      await expect(creating).rejects.toBeInstanceOf(StandCapacityError);
      await expect(
        new StorageSubscriptionRegistry(context, factory, 1).snapshot(),
      ).resolves.toMatchObject([{ subscription: { id: { value: "fresh" } }, revision: 1n }]);
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("evicts a stale stage before a fresh owner can settle its fixed slot", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(start);
    try {
      const factory = new StandRegistryScriptedStorageFactory("create-reservation");
      const context = { name: "DurableRegistryStaleStageOwner", multitenant: false };
      const oldOwner = new StorageSubscriptionRegistry(context, factory, 1);
      const oldHold = factory.hold("create-reservation");
      const stale = oldOwner.create(subscription("stale"));
      const staleOutcome = stale.then(
        () => "created" as const,
        (error: unknown) => error,
      );
      await oldHold.reached.promise;

      const freshOwner = new StorageSubscriptionRegistry(context, factory, 1);
      const freshHold = factory.hold("create-reservation");
      const fresh = freshOwner.create(subscription("fresh"));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(25);
      await freshHold.reached.promise;

      oldHold.release.resolve(undefined);
      await Promise.resolve();
      freshHold.release.resolve(undefined);
      await vi.runAllTimersAsync();

      expect(await staleOutcome).toBeInstanceOf(StandCapacityError);
      await expect(fresh).resolves.toMatchObject({
        kind: "created",
        entry: { subscription: { id: { value: "fresh" } }, revision: 1n },
      });
      await expect(freshOwner.snapshot()).resolves.toMatchObject([
        { subscription: { id: { value: "fresh" } }, revision: 1n },
      ]);
      await expect(readDurableCount(factory, context)).resolves.toBe(1);
      await expect(readStage(factory, context)).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("admits only the limit while multiple creators wait behind one held control slot", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(start);
    try {
      const factory = new StandRegistryScriptedStorageFactory("create-reservation");
      const context = { name: "DurableRegistryManyHeldCreators", multitenant: false };
      const owner = new StorageSubscriptionRegistry(context, factory, 1);
      const held = factory.hold("create-reservation");
      const ownerCreate = owner.create(subscription("owner"));
      await held.reached.promise;

      const helpers = ["one", "two", "three"].map((value) =>
        new StorageSubscriptionRegistry(context, factory, 1).create(subscription(value)).then(
          () => "created" as const,
          () => "rejected" as const,
        ),
      );
      await vi.advanceTimersByTimeAsync(25);
      const results = await Promise.all(helpers);
      expect(results.filter((result) => result === "created")).toHaveLength(1);
      expect(results.filter((result) => result === "rejected")).toHaveLength(2);

      held.release.resolve(undefined);
      await expect(ownerCreate).rejects.toBeInstanceOf(StandCapacityError);
      await expect(
        new StorageSubscriptionRegistry(context, factory, 1).snapshot(),
      ).resolves.toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("retries a fenced same-ID admission with a fresh full pending lifetime", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(start);
    try {
      const factory = new StandRegistryScriptedStorageFactory("create-reservation");
      const context = { name: "DurableRegistryFreshRetry", multitenant: false };
      const owner = new StorageSubscriptionRegistry(context, factory, 1);
      const held = factory.hold("create-reservation");
      const stale = owner.create(subscription("one"));
      await held.reached.promise;

      const helper = new StorageSubscriptionRegistry(context, factory, 1);
      const retry = helper.create(subscription("one"));
      await vi.advanceTimersByTimeAsync(25);
      const created = await retry;
      expect(created).toMatchObject({
        kind: "created",
        entry: { createdAt: start + 25, pendingUntil: start + 30_025, revision: 1n },
      });
      await vi.advanceTimersByTimeAsync(29_999);
      await expect(helper.activate(id("one"))).resolves.toMatchObject({ kind: "activated" });

      held.release.resolve(undefined);
      await expect(stale).resolves.toMatchObject({ kind: "existing", entry: { revision: 2n } });
    } finally {
      vi.useRealTimers();
    }
  }, 5_000);

  it("hides and safely removes a legacy revision-zero definition from every public operation", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "DurableRegistryLegacyReservation", multitenant: false };
    await writeDefinition(
      factory,
      context,
      StandSubscriptionRecords.write({
        subscription: subscription("legacy"),
        phase: "pending",
        createdAt: start,
        pendingUntil: start + 30_000,
        revision: 0n,
      }),
      "legacy",
    );

    const registry = new StorageSubscriptionRegistry(context, factory);
    await expect(registry.get(id("legacy"))).resolves.toBeUndefined();
    await expect(registry.activate(id("legacy"))).resolves.toEqual({ kind: "missing" });
    await expect(registry.delete(id("legacy"))).resolves.toBe("missing");
    await expect(registry.snapshot()).resolves.toEqual([]);
    await expect(registry.cleanup()).resolves.toEqual({ scanned: 0, deleted: 0, more: false });
  });

  it.each(["create-reservation", "create-stage", "create-promote", "create-commit"] as const)(
    "settles an applied-then-thrown %s create without leaking a revision-zero reservation",
    async (phase) => {
      const factory = new StandRegistryScriptedStorageFactory(phase);
      const context = { name: `DurableRegistry${phase}`, multitenant: false };
      const interrupted = new StorageSubscriptionRegistry(context, factory, 1);
      factory.arm();

      await expect(interrupted.create(subscription("one"))).rejects.toThrow("applied-then-thrown");

      const helper = new StorageSubscriptionRegistry(context, factory, 1);
      await expect(helper.create(subscription("one"))).resolves.toMatchObject({
        kind: phase === "create-reservation" ? "created" : "existing",
      });
      await expect(helper.snapshot()).resolves.toMatchObject([{ revision: 1n }]);
      await expect(helper.create(subscription("two"))).rejects.toBeInstanceOf(StandCapacityError);
    },
  );

  it("releases a thrown revision-zero reservation for a distinct ID at limit one", async () => {
    const factory = new StandRegistryScriptedStorageFactory("create-reservation");
    const context = { name: "DurableRegistryReservationCapacity", multitenant: false };
    const interrupted = new StorageSubscriptionRegistry(context, factory, 1);
    factory.arm();

    await expect(interrupted.create(subscription("one"))).rejects.toThrow("applied-then-thrown");

    const helper = new StorageSubscriptionRegistry(context, factory, 1);
    await expect(helper.create(subscription("two"))).resolves.toMatchObject({ kind: "created" });
    await expect(helper.snapshot()).resolves.toMatchObject([
      { subscription: { id: { value: "two" } } },
    ]);
  });

  it("does not let an unexpired revision-zero reservation starve an expired definition", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const factory = new StandRegistryScriptedStorageFactory("create-reservation");
      const context = { name: "DurableRegistryUnexpiredReservation", multitenant: false };
      const registry = new StorageSubscriptionRegistry(context, factory);
      await registry.create(subscription("expired"));
      vi.setSystemTime(start + 1_000);
      factory.arm();
      await expect(registry.create(subscription("held"))).rejects.toThrow("applied-then-thrown");
      vi.setSystemTime(start + 30_000);

      await expect(new StorageSubscriptionRegistry(context, factory).cleanup()).resolves.toEqual({
        scanned: 1,
        deleted: 1,
        more: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["create-reservation", "create-stage", "create-definition", "create-commit"] as const)(
    "settles an applied-then-thrown %s fixed-stage admission",
    async (phase) => {
      const factory = new StandRegistryScriptedStorageFactory(phase);
      const context = { name: `DurableRegistry${phase}`, multitenant: false };
      const interrupted = new StorageSubscriptionRegistry(context, factory, 1);
      factory.arm();
      await expect(interrupted.create(subscription("one"))).rejects.toThrow("applied-then-thrown");

      const helper = new StorageSubscriptionRegistry(context, factory, 1);
      await expect(helper.create(subscription("one"))).resolves.toMatchObject({
        kind: phase === "create-reservation" ? "created" : "existing",
      });
      await expect(helper.snapshot()).resolves.toHaveLength(1);
    },
  );

  it.each([
    "activate-stage",
    "activate-definition",
    "activate-commit",
    "delete-stage",
    "delete-definition",
    "delete-commit",
  ] as const)(
    "settles an applied-then-thrown %s operation before same-ID recreation",
    async (phase) => {
      const factory = new StandRegistryScriptedStorageFactory(phase);
      const context = { name: `DurableRegistry${phase}`, multitenant: false };
      const interrupted = new StorageSubscriptionRegistry(context, factory);
      const created = await interrupted.create(subscription("one"));
      if (created.kind !== "created") throw new Error("Expected initial creation.");
      factory.arm();

      if (phase.startsWith("activate")) {
        await expect(interrupted.activate(id("one"))).rejects.toThrow("applied-then-thrown");
        const helper = new StorageSubscriptionRegistry(context, factory);
        await expect(helper.snapshot()).resolves.toMatchObject([{ phase: "active", revision: 2n }]);
      } else {
        await expect(interrupted.delete(id("one"), created.entry.revision)).rejects.toThrow(
          "applied-then-thrown",
        );
        const helper = new StorageSubscriptionRegistry(context, factory);
        await expect(helper.snapshot()).resolves.toEqual([]);
        await expect(helper.create(subscription("one", "recreated"))).resolves.toMatchObject({
          kind: "created",
        });
        await expect(helper.snapshot()).resolves.toMatchObject([
          { subscription: { topic: { id: { value: "recreated" } } }, revision: 1n },
        ]);
      }
    },
  );

  it.each(["delete-stage", "delete-definition"] as const)(
    "recovers staged %s after an applied CAS throws",
    async (phase) => {
      const factory = new StandRegistryScriptedStorageFactory(phase);
      const context = { name: `DurableRegistry${phase}`, multitenant: false };
      const interrupted = new StorageSubscriptionRegistry(context, factory);
      const created = await interrupted.create(subscription("one"));
      if (created.kind !== "created") throw new Error("Expected initial creation.");
      factory.arm();

      await expect(interrupted.delete(id("one"), created.entry.revision)).rejects.toThrow(
        "applied-then-thrown",
      );

      const restarted = new StorageSubscriptionRegistry(context, factory);
      await expect(restarted.snapshot()).resolves.toEqual([]);
      await expect(restarted.create(subscription("two"))).resolves.toMatchObject({
        kind: "created",
      });
    },
  );

  it("rejects malformed durable control and definition records with stable errors", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "DurableRegistryMalformed", multitenant: false };
    await writeControl(
      factory,
      context,
      create(AnySchema, { typeUrl: "invalid", value: new Uint8Array() }),
    );

    await expect(new StorageSubscriptionRegistry(context, factory).snapshot()).rejects.toThrow(
      "Malformed Stand subscription control record.",
    );

    const definitionContext = { name: "DurableRegistryMalformedDefinition", multitenant: false };
    await writeDefinition(factory, definitionContext, create(StandSubscriptionRecordSchema));
    await expect(
      new StorageSubscriptionRegistry(definitionContext, factory).snapshot(),
    ).rejects.toThrow("Stand subscription record is invalid.");
  });

  it("keeps snapshot/delete and concurrent cleanup finite and idempotent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const factory = new InMemoryStorageFactory();
      const context = { name: "DurableRegistryConcurrent", multitenant: false };
      const first = new StorageSubscriptionRegistry(context, factory);
      const second = new StorageSubscriptionRegistry(context, factory);
      const created = await first.create(subscription("one"));
      if (created.kind !== "created") throw new Error("Expected initial creation.");
      const [snapshot, deletion] = await Promise.all([
        first.snapshot(),
        second.delete(id("one"), created.entry.revision),
      ]);
      expect(snapshot).toHaveLength(0);
      expect(deletion).toBe("deleted");

      for (let index = 0; index < 27; index += 1)
        await first.create(subscription(`expired-${String(index)}`));
      vi.setSystemTime(start + 30_000);
      const pages = await Promise.all([first.cleanup(), second.cleanup()]);
      expect(pages.every((page) => page.scanned <= 25)).toBe(true);
      expect(pages.reduce((sum, page) => page.deleted + sum, 0)).toBe(25);
      await expect(first.cleanup()).resolves.toEqual({ scanned: 2, deleted: 2, more: false });
      await expect(first.cleanup()).resolves.toEqual({ scanned: 0, deleted: 0, more: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

function durableRegistry(): StorageSubscriptionRegistry {
  return new StorageSubscriptionRegistry(
    { name: "DurableRegistry", multitenant: false },
    new InMemoryStorageFactory(),
  );
}

async function writeControl(
  factory: StorageFactory,
  context: StorageContext,
  record: Any,
): Promise<void> {
  const storage = factory.createRecordStorage(
    context,
    new RecordSpec<string, Any>({
      schema: AnySchema,
      storageKey: "spine.server.StandSubscriptionRecord:control",
      idKind: "string",
      extractId: () => "control",
    }),
  );
  try {
    await storage.compareAndSet("control", undefined, record);
  } finally {
    storage.close();
  }
}

async function readDurableCount(factory: StorageFactory, context: StorageContext): Promise<number> {
  const storage = factory.createRecordStorage(
    context,
    new RecordSpec<string, Any>({
      schema: AnySchema,
      storageKey: "spine.server.StandSubscriptionRecord:control",
      idKind: "string",
      extractId: () => "control",
    }),
  );
  try {
    const control = await storage.read("control");
    if (control === undefined) throw new Error("Expected durable control.");
    return (JSON.parse(new TextDecoder().decode(control.value)) as { count: number }).count;
  } finally {
    storage.close();
  }
}

async function readStage(
  factory: StorageFactory,
  context: StorageContext,
): Promise<StandSubscriptionRecord | undefined> {
  const storage = factory.createRecordStorage(
    context,
    new RecordSpec<string, StandSubscriptionRecord>({
      schema: StandSubscriptionRecords.schema,
      storageKey: stagingStorageKey,
      idKind: "string",
      extractId: () => "stage",
    }),
  );
  try {
    return await storage.read("stage");
  } finally {
    storage.close();
  }
}

async function writeDefinition(
  factory: StorageFactory,
  context: StorageContext,
  record: StandSubscriptionRecord,
  entryId = "malformed",
): Promise<void> {
  const storage = factory.createRecordStorage(
    context,
    new RecordSpec<string, StandSubscriptionRecord>({
      schema: StandSubscriptionRecords.schema,
      storageKey: "spine.server.StandSubscriptionRecord:definition",
      idKind: "string",
      extractId: () => entryId,
      columns: [
        new RecordColumn("admitted", (entry) => entry.revision > 0n, "boolean"),
        new RecordColumn(
          "pending",
          (entry) => entry.phase === SubscriptionPhase.PENDING,
          "boolean",
        ),
        new RecordColumn(
          "pendingUntil",
          (entry) =>
            entry.pendingUntil === undefined
              ? Number.MAX_SAFE_INTEGER
              : Number(entry.pendingUntil.seconds) * 1000 +
                Math.floor(entry.pendingUntil.nanos / 1_000_000),
          "number",
        ),
      ],
    }),
  );
  try {
    await storage.compareAndSet(entryId, undefined, record);
  } finally {
    storage.close();
  }
}

type StandRegistryScriptPhase =
  | "create-reservation"
  | "create-stage"
  | "create-definition"
  | "create-promote"
  | "create-commit"
  | "activate-stage"
  | "activate-definition"
  | "activate-commit"
  | "delete-stage"
  | "delete-definition"
  | "delete-commit"
  | "discard-stage"
  | "discard-definition"
  | "discard-commit";

class StandRegistryScriptedStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  #armed = false;
  #held: StandRegistryCasHold | undefined;
  #phase: StandRegistryScriptPhase;

  constructor(phase: StandRegistryScriptPhase) {
    super();
    this.#phase = phase;
  }

  arm(): void {
    this.#armed = true;
  }

  setPhase(phase: StandRegistryScriptPhase): void {
    this.#phase = phase;
  }

  hold(phase: StandRegistryScriptPhase): StandRegistryCasHold {
    this.setPhase(phase);
    const held = new StandRegistryCasHold();
    this.#held = held;
    return held;
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new StandRegistryScriptedStorage(
      context,
      spec,
      this.#delegate.createRecordStorage(context, spec),
      () => this.#armed,
      () => {
        this.#armed = false;
      },
      () => this.#phase,
      () => this.#held,
    );
  }
}

class StandRegistryCasHold {
  readonly reached = Promise.withResolvers<undefined>();
  readonly release = Promise.withResolvers<undefined>();
  #claimed = false;

  claim(): boolean {
    if (this.#claimed) return false;
    this.#claimed = true;
    return true;
  }
}

class StandRegistryScriptedStorage<I, R extends Message> extends RecordStorage<I, R> {
  override readonly atomicCompareAndSet = true;
  constructor(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    private readonly delegate: RecordStorage<I, R>,
    private readonly armed: () => boolean,
    private readonly disarm: () => void,
    private readonly phase: () => StandRegistryScriptPhase,
    private readonly hold: () => StandRegistryCasHold | undefined,
  ) {
    super(context, spec);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.delegate.delete(id);
  }

  protected queryRecordEntries(query: RecordQuery<I>): Promise<readonly RecordEntry<I, R>[]> {
    return this.delegate.queryEntries(query);
  }

  protected readRecord(id: I): Promise<R | undefined> {
    return this.delegate.read(id);
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    return this.delegate.writeAll(records.map((entry) => entry.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    return this.delegate.write(record.record);
  }

  protected async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const applied = await this.delegate.compareAndSet(id, expected?.record, next?.record);
    if (applied && this.matches(String(id), expected?.record, next?.record)) {
      const held = this.hold();
      if (held?.claim()) {
        held.reached.resolve(undefined);
        await held.release.promise;
      }
      if (this.armed()) {
        this.disarm();
        throw new Error("applied-then-thrown");
      }
    }
    return applied;
  }

  private matches(id: string, expected: R | undefined, next: R | undefined): boolean {
    const control = id === "control" && next instanceof Object && "value" in next;
    const operation = control ? controlOperation(next as unknown as Any) : undefined;
    switch (this.phase()) {
      case "create-reservation":
        return control && operation === "create";
      case "create-stage":
        return id === "stage" && expected === undefined && revisionOf(next) === 1n;
      case "activate-stage":
        return operation === "activate";
      case "delete-stage":
        return operation === "delete";
      case "discard-stage":
        return operation === "discard";
      case "create-definition":
        return (
          id !== "control" && id !== "stage" && expected === undefined && revisionOf(next) === 1n
        );
      case "create-promote":
        return (
          id !== "control" && id !== "stage" && expected === undefined && revisionOf(next) === 1n
        );
      case "create-commit":
        return (
          control &&
          controlOperation(next as unknown as Any) === "create" &&
          controlState(next as unknown as Any) === "committed"
        );
      case "activate-definition":
        return id !== "control" && revisionOf(expected) === 1n && revisionOf(next) === 2n;
      case "activate-commit":
        return (
          control &&
          controlOperation(next as unknown as Any) === "activate" &&
          controlState(next as unknown as Any) === "committed"
        );
      case "delete-definition":
        return id !== "control" && expected !== undefined && next === undefined;
      case "discard-definition":
        return id !== "control" && revisionOf(expected) === 0n && next === undefined;
      case "delete-commit":
        return (
          control &&
          controlOperation(next as unknown as Any) === "delete" &&
          controlState(next as unknown as Any) === "committed"
        );
      case "discard-commit":
        return (
          control &&
          controlOperation(next as unknown as Any) === "discard" &&
          controlState(next as unknown as Any) === "committed"
        );
    }
  }
}

function controlState(record: Any): string | undefined {
  try {
    return (JSON.parse(new TextDecoder().decode(record.value)) as { state?: string }).state;
  } catch {
    return undefined;
  }
}

function controlOperation(record: Any): string | undefined {
  try {
    return (JSON.parse(new TextDecoder().decode(record.value)) as { operation?: { kind?: string } })
      .operation?.kind;
  } catch {
    return undefined;
  }
}

function revisionOf(record: unknown): bigint | undefined {
  if (record === null || typeof record !== "object" || !("revision" in record)) return undefined;
  const revision = record.revision;
  return typeof revision === "bigint" ? revision : undefined;
}
