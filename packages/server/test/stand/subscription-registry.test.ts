import { create, toBinary, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  type Subscription,
  type SubscriptionId,
} from "@spine-event-engine/proto/client";
import {
  InMemoryStorageFactory,
  RecordSpec,
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
    try {
      await expect(definitions.queryEntries({})).resolves.toHaveLength(50);
      await expect(control.queryEntries({})).resolves.toHaveLength(1);
    } finally {
      definitions.close();
      control.close();
    }
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
      await expect(restarted.snapshot()).resolves.toHaveLength(phase === "create-stage" ? 0 : 1);
      await expect(restarted.create(subscription("two"))).resolves.toMatchObject({
        kind: "created",
      });
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
      expect(snapshot).toHaveLength(1);
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

async function writeDefinition(
  factory: StorageFactory,
  context: StorageContext,
  record: StandSubscriptionRecord,
): Promise<void> {
  const storage = factory.createRecordStorage(
    context,
    new RecordSpec<string, StandSubscriptionRecord>({
      schema: StandSubscriptionRecords.schema,
      storageKey: "spine.server.StandSubscriptionRecord:definition",
      idKind: "string",
      extractId: () => "malformed",
    }),
  );
  try {
    await storage.compareAndSet("malformed", undefined, record);
  } finally {
    storage.close();
  }
}

type StandRegistryScriptPhase =
  "create-stage" | "create-definition" | "delete-stage" | "delete-definition";

class StandRegistryScriptedStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  #armed = false;

  constructor(private readonly phase: StandRegistryScriptPhase) {
    super();
  }

  arm(): void {
    this.#armed = true;
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
      this.phase,
    );
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
    private readonly phase: StandRegistryScriptPhase,
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
    if (applied && this.armed() && this.matches(String(id), expected?.record, next?.record)) {
      this.disarm();
      throw new Error("applied-then-thrown");
    }
    return applied;
  }

  private matches(id: string, expected: R | undefined, next: R | undefined): boolean {
    const control = id === "control" && next instanceof Object && "value" in next;
    const operation = control ? controlOperation(next as unknown as Any) : undefined;
    switch (this.phase) {
      case "create-stage":
        return operation === "create";
      case "delete-stage":
        return operation === "delete";
      case "create-definition":
        return id !== "control" && expected === undefined && next !== undefined;
      case "delete-definition":
        return id !== "control" && expected !== undefined && next === undefined;
    }
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
