import { create, toBinary } from "@bufbuild/protobuf";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  type Subscription,
  type SubscriptionId,
} from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
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

const start = 1_000_000;

function id(value: string): SubscriptionId {
  return create(SubscriptionIdSchema, { value });
}

function subscription(value: string, topic = "topic"): Subscription {
  return create(SubscriptionSchema, { id: id(value), topic: { id: { value: topic } } });
}

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
    expect(snapshot.map((entry) => entry.subscription.id?.value)).toEqual(["a", "z"]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(Object.isFrozen(snapshot[0].subscription)).toBe(true);
    expect(snapshot[0]).not.toBe(await registry.get(id("a")));
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
    expectTypeOf<StandSubscriptionEntry>().toEqualTypeOf<{
      readonly subscription: Subscription;
      readonly phase: "pending" | "active";
      readonly createdAt: number;
      readonly pendingUntil?: number;
      readonly revision: bigint;
    }>();
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
});

function durableRegistry(): StorageSubscriptionRegistry {
  return new StorageSubscriptionRegistry(
    { name: "DurableRegistry", multitenant: false },
    new InMemoryStorageFactory(),
  );
}
