import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  RecordStorage,
  type RecordEntry,
  type RecordSpec,
  type RecordQuery,
  StorageFactory,
  type StorageContext,
} from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DurableSubscriptionBindings, isDurableSubscriptionBindings } from "../../src/index.js";
import { BrowserServer } from "../../src/server/browser-server.js";
import { DurableSubscriptionBindingRecords } from "../../src/server/durable-subscription-bindings.js";
import type { BrowserServerOptions } from "../../src/server/server.js";

describe("DurableSubscriptionBindings", () => {
  it("round-trips an owned private envelope across an independently closed registry", async () => {
    const factory = new InMemoryStorageFactory();
    const first = registry(factory, "messageboard");
    const backend = new Uint8Array([1, 2, 3]);
    const binding = await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: backend },
      principalFingerprint: "principal-a",
      tenant: "tenant-a",
      expiresAtMs: 1_000,
    });
    backend[0] = 99;
    await first.close();

    const reopened = registry(factory, "messageboard");
    let callbackBytes: Uint8Array | undefined;
    const activated = await reopened.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: "tenant-a",
      nowMs: 1,
      signal: new AbortController().signal,
      onBackend: (value) => {
        callbackBytes = value.bytes.slice();
        value.bytes[0] = 88;
        return Promise.resolve();
      },
    });

    expect(activated).toEqual({ kind: "activated" });
    expect(callbackBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(factory.isOpen()).toBe(true);
    await reopened.close();
  });

  it("keeps namespaces and ownership facts isolated", async () => {
    const factory = new InMemoryStorageFactory();
    const first = registry(factory, "first");
    const second = registry(factory, "second");
    const binding = await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 1_000,
    });

    await expect(
      second.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      first.activate({
        id: binding.id,
        principalFingerprint: "principal-b",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await first.close();
    await second.close();
  });

  it("releases an unused asynchronous reservation exactly once", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "messageboard");
    const reservation = await bindings.reserveCapacity();

    reservation.release();
    reservation.release();

    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("enforces capacity across independently opened registries", async () => {
    const factory = new InMemoryStorageFactory();
    const first = capacityRegistry(factory, "shared", 1);
    const second = capacityRegistry(factory, "shared", 1);
    const held = await first.reserveCapacity();

    await expect(second.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
    await held.release();
    await expect(second.reserveCapacity()).resolves.toBeDefined();

    await first.close();
    await second.close();
  });

  it.each(["quota", "slot", "conversion", "deletion", "completion"] as const)(
    "reconciles an applied-then-thrown %s mutation",
    async (phase) => {
      const bindings = capacityRegistry(new ApplyThenThrowFactory(phase), `fault-${phase}`, 1);
      const reservation = await bindings.reserveCapacity();
      if (phase === "conversion") {
        await expect(
          bindings.create({
            backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
            principalFingerprint: "principal-a",
            tenant: undefined,
            expiresAtMs: 1_000,
            reservation,
          }),
        ).resolves.toBeDefined();
      } else await reservation.release();
      await bindings.close();
    },
  );

  it("converts a preallocated reservation without allocating another slot", async () => {
    const bindings = limitedRegistry(new InMemoryStorageFactory(), "same-slot");
    const reservation = await bindings.reserveCapacity();

    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 1_000,
        reservation,
      }),
    ).resolves.toMatchObject({ id: expect.any(String) });
    await expect(bindings.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
    await bindings.close();
  });

  it("fences a stale gateway after another gateway claims an expired lease", async () => {
    const factory = new InMemoryStorageFactory();
    const first = registry(factory, "lease");
    const second = registry(factory, "lease");
    const binding = await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    let resume: (() => void) | undefined;
    let guard: (() => Promise<boolean>) | undefined;
    const pending = first.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1,
      signal: new AbortController().signal,
      onBackend: (_backend, _signal, current) => {
        guard = current;
        return new Promise<void>((resolve) => {
          resume = resolve;
        });
      },
    });
    await Promise.resolve();

    await expect(
      second.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      second.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2_000,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "activated" });
    await expect(guard?.()).resolves.toBe(false);
    resume?.();
    await expect(pending).resolves.toEqual({ kind: "denied" });

    await first.close();
    await second.close();
  });

  it("declares durable capability without treating in-memory bindings as durable", () => {
    const bindings = registry(new InMemoryStorageFactory(), "messageboard");

    expect(isDurableSubscriptionBindings(bindings)).toBe(true);
    expect(isDurableSubscriptionBindings(undefined)).toBe(false);
    expect(isDurableSubscriptionBindings({} as never)).toBe(false);
    void bindings.close();
  });

  it("rejects volatile browser bindings before production listener assembly", () => {
    const bindings = registry(new InMemoryStorageFactory(), "messageboard");
    expect(() => {
      BrowserServer.requireDurableBindings({} as BrowserServerOptions, true);
    }).toThrow("requires durable subscription bindings");
    expect(() => {
      BrowserServer.requireDurableBindings({ bindings } as unknown as BrowserServerOptions, true);
    }).not.toThrow();
    expect(() => {
      BrowserServer.requireDurableBindings({} as BrowserServerOptions, false);
    }).not.toThrow();
    void bindings.close();
  });

  it("cancels and purges expired private bindings without closing the storage factory", async () => {
    const factory = new InMemoryStorageFactory();
    const bindings = registry(factory, "messageboard");
    const cancelled = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: "tenant-a",
      expiresAtMs: 1_000,
    });
    const expired = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([2]) },
      principalFingerprint: "principal-a",
      tenant: "tenant-a",
      expiresAtMs: 2,
    });
    const disposed: number[] = [];

    await expect(
      bindings.cancel({
        id: cancelled.id,
        principalFingerprint: "principal-a",
        tenant: "tenant-a",
        nowMs: 1,
        onBackend: (backend) => {
          disposed.push(backend.bytes[0] ?? 0);
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "closed" });
    await bindings.purgeExpired(3);
    await expect(
      bindings.cancel({
        id: expired.id,
        principalFingerprint: "principal-a",
        tenant: "tenant-a",
        nowMs: 3,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "closed" });
    expect(disposed).toEqual([1]);
    expect(factory.isOpen()).toBe(true);
    await bindings.close();
  });

  it("rejects expired, aborted, oversized, and unauthorised private operations", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "messageboard");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 2,
    });
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: aborted.signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-b",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await bindings.close();
    await expect(bindings.reserveCapacity()).rejects.toThrow("closed");
  });

  it("rejects an oversized encoded record before persistence", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "messageboard",
      nextId: () => "binding",
      dispose: () => Promise.resolve(),
      leaseMs: 1,
      cleanupBatchSize: 1,
      recordLimit: 1,
      maxRecordBytes: 1,
    });

    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 1,
      }),
    ).rejects.toThrow("backend-envelope-too-large");
    await bindings.close();
  });

  it("rejects invalid private creation and a full finite registry", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "messageboard",
      nextId: () => "binding",
      dispose: () => Promise.resolve(),
      leaseMs: 1,
      cleanupBatchSize: 1,
      recordLimit: 1,
      maxRecordBytes: 1_024,
    });

    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array() },
        principalFingerprint: "",
        tenant: undefined,
        expiresAtMs: 1,
      }),
    ).rejects.toThrow("subscription owner");
    await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 1,
    });
    await expect(bindings.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
    await bindings.close();
  });

  it("rejects forged and released reservations before creation", async () => {
    const factory = new InMemoryStorageFactory();
    const first = limitedRegistry(factory, "first");
    const released = await first.reserveCapacity();
    await released.release();
    const forged = { release: async () => undefined };

    await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 1_000,
    });
    await expect(
      first.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([2]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 1_000,
        reservation: released,
      }),
    ).rejects.toThrow("binding-capacity-exceeded");
    await expect(
      first.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([3]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 1_000,
        reservation: forged,
      }),
    ).rejects.toThrow("binding-capacity-exceeded");
    await first.close();
  });

  it("does not consume a live reservation owned by another registry", async () => {
    const factory = new InMemoryStorageFactory();
    const first = capacityRegistry(factory, "messageboard", 2);
    const second = capacityRegistry(factory, "messageboard", 2);
    const foreign = await second.reserveCapacity();

    await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 1_000,
      reservation: foreign,
    });
    await expect(
      second.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([2]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 1_000,
        reservation: foreign,
      }),
    ).resolves.toBeDefined();
    await first.close();
    await second.close();
  });

  it("admits at most one concurrent creation with the same reservation", async () => {
    const bindings = limitedRegistry(new InMemoryStorageFactory(), "messageboard");
    const reservation = await bindings.reserveCapacity();
    const input = {
      backend: { kind: "backend-subscription-envelope" as const, bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 1_000,
      reservation,
    };

    const results = await Promise.allSettled([bindings.create(input), bindings.create(input)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await bindings.close();
  });

  it("rejects a storage handle without atomic compare-and-set capability", () => {
    expect(
      () =>
        new DurableSubscriptionBindings({
          storageFactory: new UnprovenStorageFactory(),
          namespace: "messageboard",
          nextId: () => "binding",
          dispose: () => Promise.resolve(),
          leaseMs: 1,
          cleanupBatchSize: 1,
          recordLimit: 1,
          maxRecordBytes: 1_024,
        }),
    ).toThrow("requires atomic compare-and-set");
  });

  it.each([
    create(AnySchema, { typeUrl: "wrong", value: new Uint8Array([1]) }),
    create(AnySchema, {
      typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
      value: new TextEncoder().encode("not-json"),
    }),
    create(AnySchema, {
      typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
      value: new TextEncoder().encode("null"),
    }),
    create(AnySchema, {
      typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
      value: new TextEncoder().encode('{"version":2}'),
    }),
  ])("fails closed for malformed private record %#", (record) => {
    expect(() => {
      DurableSubscriptionBindingRecords.validate(record);
    }).toThrow("Durable subscription registry record is invalid.");
  });

  it.each([
    '{"version":1,"id":"binding","principalFingerprint":"owner","expiresAtMs":1,"lifecycle":"inactive","leaseUntilMs":0,"cancellationFence":0,"backend":"AQ","encodedBytes":2}',
    '{"version":1,"id":"binding","principalFingerprint":"owner","expiresAtMs":1,"lifecycle":"inactive","leaseUntilMs":0,"cancellationFence":0,"backend":"AQ==","encodedBytes":3}',
  ])("rejects noncanonical or mismatched byte accounting %#", (value) => {
    const record = create(AnySchema, {
      typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
      value: new TextEncoder().encode(value),
    });

    expect(() => {
      DurableSubscriptionBindingRecords.validate(record);
    }).toThrow("Durable subscription registry record is invalid.");
  });

  it.each([
    create(AnySchema, { typeUrl: "wrong", value: new Uint8Array([1]) }),
    create(AnySchema, {
      typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
      value: new TextEncoder().encode("null"),
    }),
    create(AnySchema, {
      typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
      value: new TextEncoder().encode(
        '{"version":1,"id":"binding","principalFingerprint":"owner","expiresAtMs":1,"lifecycle":"inactive","leaseUntilMs":0,"cancellationFence":0,"backend":"AQ==","encodedBytes":99}',
      ),
    }),
  ])("fails closed before admitting a seeded invalid row %#", async (record) => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new SeededStorageFactory([{ id: "binding", record }]),
      namespace: "messageboard",
      nextId: () => "new-binding",
      dispose: () => Promise.resolve(),
      leaseMs: 1,
      cleanupBatchSize: 1,
      recordLimit: 1,
      maxRecordBytes: 1_024,
    });

    await expect(bindings.reserveCapacity()).rejects.toThrow(
      "Durable subscription registry record is invalid.",
    );
    await bindings.close();
  });

  it.each([
    { namespace: "", leaseMs: 10, cleanupBatchSize: 1, recordLimit: 1, maxRecordBytes: 1 },
    {
      namespace: "valid",
      leaseMs: Infinity,
      cleanupBatchSize: 1,
      recordLimit: 1,
      maxRecordBytes: 1,
    },
    { namespace: "valid", leaseMs: 10, cleanupBatchSize: 0, recordLimit: 1, maxRecordBytes: 1 },
    { namespace: "valid", leaseMs: 10, cleanupBatchSize: 1, recordLimit: 0, maxRecordBytes: 1 },
    { namespace: "valid", leaseMs: 10, cleanupBatchSize: 1, recordLimit: 1, maxRecordBytes: 0 },
  ])("rejects invalid finite options %#", (options) => {
    expect(
      () =>
        new DurableSubscriptionBindings({
          storageFactory: new InMemoryStorageFactory(),
          nextId: () => "binding",
          dispose: () => Promise.resolve(),
          ...options,
        }),
    ).toThrow();
  });
});

function registry(
  storageFactory: InMemoryStorageFactory,
  namespace: string,
): DurableSubscriptionBindings {
  let nextId = 0;
  return new DurableSubscriptionBindings({
    storageFactory,
    namespace,
    nextId: () => `binding-${(++nextId).toString()}`,
    dispose: () => Promise.resolve(),
    leaseMs: 1_000,
    cleanupBatchSize: 10,
    recordLimit: 10,
    maxRecordBytes: 1_024,
  });
}

function limitedRegistry(
  storageFactory: InMemoryStorageFactory,
  namespace: string,
): DurableSubscriptionBindings {
  return capacityRegistry(storageFactory, namespace, 1);
}

function capacityRegistry(
  storageFactory: StorageFactory,
  namespace: string,
  recordLimit: number,
): DurableSubscriptionBindings {
  return new DurableSubscriptionBindings({
    storageFactory,
    namespace,
    nextId: () => crypto.randomUUID(),
    dispose: () => Promise.resolve(),
    leaseMs: 1,
    cleanupBatchSize: 1,
    recordLimit,
    maxRecordBytes: 1_024,
  });
}

class SeededStorageFactory extends StorageFactory {
  constructor(private readonly entries: readonly RecordEntry<string, Any>[]) {
    super();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new SeededRecordStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
      this.entries,
    ) as unknown as RecordStorage<I, R>;
  }
}

class SeededRecordStorage extends RecordStorage<string, Any> {
  override readonly atomicCompareAndSet: boolean = true;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<string, Any>,
    private readonly entries: readonly RecordEntry<string, Any>[],
  ) {
    super(context, recordSpec);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected queryRecordEntries(): Promise<readonly RecordEntry<string, Any>[]> {
    return Promise.resolve(this.entries);
  }

  protected readRecord(): Promise<Any | undefined> {
    return Promise.resolve(undefined);
  }

  protected compareAndSetRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

class UnprovenStorageFactory extends StorageFactory {
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new UnprovenRecordStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
    ) as unknown as RecordStorage<I, R>;
  }
}

class UnprovenRecordStorage extends SeededRecordStorage {
  override readonly atomicCompareAndSet = false;

  constructor(context: StorageContext, recordSpec: RecordSpec<string, Any>) {
    super(context, recordSpec, []);
  }
}

class ApplyThenThrowFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  #armed = true;

  constructor(private readonly phase: "quota" | "slot" | "conversion" | "deletion" | "completion") {
    super();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new ApplyThenThrowStorage(
      context,
      spec,
      this.#delegate.createRecordStorage(context, spec),
      (id, next) => {
        if (!this.#armed) return false;
        const text =
          next === undefined ? "" : new TextDecoder().decode((next as unknown as Any).value);
        const hit =
          (this.phase === "slot" && id !== "!subscription-quota" && text.includes('"reserved"')) ||
          (this.phase === "conversion" &&
            id !== "!subscription-quota" &&
            text.includes('"inactive"')) ||
          (this.phase === "deletion" && id !== "!subscription-quota" && next === undefined) ||
          (this.phase === "quota" &&
            id === "!subscription-quota" &&
            text.includes('"operation"')) ||
          (this.phase === "completion" &&
            id === "!subscription-quota" &&
            !text.includes('"operation"'));
        if (hit) this.#armed = false;
        return hit;
      },
    );
  }
}

class ApplyThenThrowStorage<I, R extends Message> extends RecordStorage<I, R> {
  override readonly atomicCompareAndSet = true;

  constructor(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    private readonly delegate: RecordStorage<I, R>,
    private readonly shouldThrow: (id: I, next: R | undefined) => boolean,
  ) {
    super(context, spec);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.delegate.delete(id);
  }
  protected queryRecordEntries(query: RecordQuery<I>) {
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
    if (applied && this.shouldThrow(id, next?.record)) throw new Error("applied-then-thrown");
    return applied;
  }
}
