import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  RecordStorage,
  type RecordEntry,
  RecordSpec,
  type RecordQuery,
  StorageFactory,
  type StorageContext,
} from "@spine-event-engine/storage";
import type { OnBackendSubscription } from "@spine-event-engine/auth";
import { describe, expect, it, vi } from "vitest";

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

    await reservation.release();
    await reservation.release();

    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("releases an expired durable reservation through the finite cleanup page", async () => {
    const bindings = capacityRegistry(new InMemoryStorageFactory(), "reservation-expiry", 1);
    const expired = await bindings.reserveCapacity();

    await bindings.purgeExpired(Number.MAX_SAFE_INTEGER - 10);

    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await expired.release();
    await expect(bindings.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
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
      const factory = new ApplyThenThrowFactory(phase);
      factory.arm();
      const bindings = capacityRegistry(factory, `fault-${phase}`, 1);
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

  it("resumes a bounded paged repair across independently reopened registries", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "repair");
    await seedRepair(store, 0, undefined);
    await store.compareAndSet("binding-a", undefined, repairRecord("binding-a", "reserved"));
    await store.compareAndSet("binding-b", undefined, malformedRepairRecord("binding-b"));
    await store.compareAndSet("binding-c", undefined, repairRecord("binding-c", "retired"));
    store.close();

    const first = capacityRegistry(factory, "repair", 4);
    await expect(first.reserveCapacity()).resolves.toBeDefined();
    await first.close();

    const reopened = capacityRegistry(factory, "repair", 4);
    await expect(reopened.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
    await reopened.close();
  });

  it("converges concurrent helpers on one durable paged repair", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "repair-race");
    await seedRepair(store, 0, undefined);
    await store.compareAndSet("binding-a", undefined, repairRecord("binding-a", "reserved"));
    await store.compareAndSet("binding-b", undefined, repairRecord("binding-b", "reserved"));
    await store.compareAndSet("binding-c", undefined, repairRecord("binding-c", "retired"));
    store.close();
    const first = capacityRegistry(factory, "repair-race", 4);
    const second = capacityRegistry(factory, "repair-race", 4);

    const results = await Promise.allSettled([first.reserveCapacity(), second.reserveCapacity()]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await first.close();
    await second.close();
  });

  it.each([
    { afterId: undefined, count: 0 },
    { afterId: "binding-a", count: 1 },
    { afterId: "binding-b", count: 2 },
  ])("restarts repair from durable cursor %#", async ({ afterId, count }) => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, `restart-${count.toString()}`);
    await seedRepair(store, count, afterId);
    await store.compareAndSet("binding-a", undefined, repairRecord("binding-a", "reserved"));
    await store.compareAndSet("binding-b", undefined, repairRecord("binding-b", "reserved"));
    await store.compareAndSet("binding-c", undefined, repairRecord("binding-c", "retired"));
    store.close();
    const bindings = capacityRegistry(factory, `restart-${count.toString()}`, 3);
    await expect(bindings.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
    await bindings.close();
  });

  it.each(["repair-page", "repair-final"] as const)(
    "reconciles an applied repair %s after reopening",
    async (phase) => {
      const factory = new ApplyThenThrowFactory(phase);
      const store = repairStore(factory, phase);
      await seedRepair(store, 0, undefined);
      await store.compareAndSet("binding-a", undefined, repairRecord("binding-a", "reserved"));
      await store.compareAndSet("binding-b", undefined, repairRecord("binding-b", "retired"));
      store.close();
      factory.arm();
      const first = capacityRegistry(factory, phase, 3);
      await expect(first.reserveCapacity()).resolves.toBeDefined();
      await first.close();
      const reopened = capacityRegistry(factory, phase, 3);
      await expect(reopened.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
      await reopened.close();
    },
  );

  it("converts a preallocated reservation without allocating another slot", async () => {
    const bindings = limitedRegistry(new InMemoryStorageFactory(), "same-slot");
    const reservation = await bindings.reserveCapacity();

    const created = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 1_000,
      reservation,
    });
    expect(created.id).not.toHaveLength(0);
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

  it("reconciles an applied-then-thrown activation claim before running the backend", async () => {
    const factory = new ApplyThenThrowFactory("claim");
    const bindings = capacityRegistry(factory, "claim", 2);
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    factory.arm();
    let calls = 0;
    await expect(
      bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => {
          calls += 1;
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "activated" });
    expect(calls).toBe(1);
    await bindings.close();
  });

  it("finalizes a settled active callback under a new durable cancellation fence", async () => {
    const disposed: number[] = [];
    const bindings = cleanupRegistry(new InMemoryStorageFactory(), "activation-final", (value) => {
      disposed.push(value.bytes[0] ?? 0);
      return Promise.resolve();
    });
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([7]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });

    await expect(
      bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "activated" });

    expect(disposed).toEqual([7]);
    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "closed" });
    await bindings.close();
  });

  it("allows one local cancellation callback and fences a stale active callback", async () => {
    const factory = new InMemoryStorageFactory();
    const first = registry(factory, "cancel-fence");
    const second = registry(factory, "cancel-fence");
    const binding = await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    let activeGuard: (() => Promise<boolean>) | undefined;
    let resumeActive: (() => void) | undefined;
    let activeStarted: (() => void) | undefined;
    const activeReady = new Promise<void>((resolve) => {
      activeStarted = resolve;
    });
    const active = first.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1,
      signal: new AbortController().signal,
      onBackend: (_value, _signal, guard) =>
        new Promise<void>((resolve) => {
          activeGuard = guard;
          resumeActive = resolve;
          activeStarted?.();
        }),
    });
    await activeReady;
    let releaseCancel: (() => void) | undefined;
    let calls = 0;
    let started: (() => void) | undefined;
    const callbackStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cancel = () =>
      second.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2_000,
        onBackend: (_value, _signal, guard) =>
          new Promise<void>((resolve) => {
            calls += 1;
            expect(guard).toBeDefined();
            releaseCancel = resolve;
            started?.();
          }),
      });
    const one = cancel();
    const two = cancel();
    await callbackStarted;
    expect(calls).toBe(1);
    await expect(activeGuard?.()).resolves.toBe(false);
    resumeActive?.();
    await expect(active).resolves.toEqual({ kind: "denied" });
    releaseCancel?.();
    await expect(Promise.all([one, two])).resolves.toEqual([
      { kind: "closed" },
      { kind: "closed" },
    ]);
    await first.close();
    await second.close();
  });

  it("retries a failed cancellation callback with its durable fence", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "cancel-retry");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.reject(new Error("transient private failure")),
      }),
    ).resolves.toEqual({ kind: "denied" });
    let calls = 0;
    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2,
        onBackend: () => {
          calls += 1;
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "closed" });
    expect(calls).toBe(1);
    await bindings.close();
  });

  it.each(["cancellation", "retirement"] as const)(
    "reconciles an applied-then-thrown %s before another cancellation effect",
    async (phase) => {
      const factory = new ApplyThenThrowFactory(phase);
      const bindings = capacityRegistry(factory, `cancel-${phase}`, 2);
      const binding = await bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 10_000,
      });
      factory.arm();
      let calls = 0;

      await expect(
        bindings.cancel({
          id: binding.id,
          principalFingerprint: "principal-a",
          tenant: undefined,
          nowMs: 1,
          onBackend: () => {
            calls += 1;
            return Promise.resolve();
          },
        }),
      ).resolves.toEqual({ kind: "closed" });
      expect(calls).toBe(1);
      await bindings.close();
    },
  );

  it("takes over an expired cancellation lease with a new durable fence", async () => {
    const factory = new InMemoryStorageFactory();
    const first = timedRegistry(factory, "cancel-takeover");
    const second = timedRegistry(factory, "cancel-takeover");
    const binding = await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    let releaseFirst: (() => void) | undefined;
    const firstCancel = first.cancel({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1,
      onBackend: () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    });
    await Promise.resolve();
    let secondCalls = 0;

    await expect(
      second.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 101,
        onBackend: () => {
          secondCalls += 1;
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "closed" });
    expect(secondCalls).toBe(1);
    releaseFirst?.();
    await expect(firstCancel).resolves.toEqual({ kind: "closed" });
    await first.close();
    await second.close();
  });

  it("renews a live lease and aborts local work after a durable renewal loss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const factory = new InMemoryStorageFactory();
      const first = timedRegistry(factory, "renew");
      const second = timedRegistry(factory, "renew");
      const binding = await first.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 10_000,
      });
      let signal: AbortSignal | undefined;
      let finish: (() => void) | undefined;
      const active = first.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1_000,
        signal: new AbortController().signal,
        onBackend: (_value, current) =>
          new Promise<void>((resolve) => {
            signal = current;
            finish = resolve;
          }),
      });
      await vi.advanceTimersByTimeAsync(51);
      await expect(
        second.activate({
          id: binding.id,
          principalFingerprint: "principal-a",
          tenant: undefined,
          nowMs: 1_101,
          signal: new AbortController().signal,
          onBackend: () => Promise.resolve(),
        }),
      ).resolves.toEqual({ kind: "denied" });
      await vi.advanceTimersByTimeAsync(1_100);
      await expect(
        second.cancel({
          id: binding.id,
          principalFingerprint: "principal-a",
          tenant: undefined,
          nowMs: 2_201,
          onBackend: () => Promise.resolve(),
        }),
      ).resolves.toEqual({ kind: "closed" });
      await vi.advanceTimersByTimeAsync(51);
      expect(signal?.aborted).toBe(true);
      finish?.();
      await expect(active).resolves.toEqual({ kind: "denied" });
      await first.close();
      await second.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconciles an applied-then-thrown renewal without abandoning its active callback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const factory = new ApplyThenThrowFactory("renewal");
      const bindings = timedRegistry(factory, "renewal-fault");
      const binding = await bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 10_000,
      });
      let signal: AbortSignal | undefined;
      let finish: (() => void) | undefined;
      const active = bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1_000,
        signal: new AbortController().signal,
        onBackend: (_value, current) =>
          new Promise<void>((resolve) => {
            signal = current;
            finish = resolve;
          }),
      });
      await Promise.resolve();
      factory.arm();

      await vi.advanceTimersByTimeAsync(51);

      expect(signal?.aborted).toBe(false);
      finish?.();
      await expect(active).resolves.toEqual({ kind: "activated" });
      await bindings.close();
    } finally {
      vi.useRealTimers();
    }
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

  it("persists a finite cleanup continuation and resumes after reopening", async () => {
    const factory = new InMemoryStorageFactory();
    const first = cleanupRegistry(factory, "cleanup-page", () => Promise.resolve());
    await first.create(expiredInput());
    await first.create(expiredInput());
    await first.create(expiredInput());

    await first.purgeExpired(2);
    expect(await cleanupControl(factory, "cleanup-page")).toMatchObject({ afterId: "binding-1" });
    await first.close();

    const reopened = cleanupRegistry(factory, "cleanup-page", () => Promise.resolve());
    await reopened.purgeExpired(12);
    expect(await cleanupControl(factory, "cleanup-page")).toMatchObject({ afterId: "binding-2" });
    await reopened.purgeExpired(12);
    expect(await cleanupControl(factory, "cleanup-page")).toMatchObject({ afterId: "binding-3" });
    await reopened.purgeExpired(12);
    expect(await cleanupControl(factory, "cleanup-page")).not.toHaveProperty("afterId");
    await reopened.close();
  });

  it("fences an expired session into cancellation before durable release", async () => {
    const disposed: number[] = [];
    let current: boolean | undefined;
    const bindings = cleanupRegistry(
      new InMemoryStorageFactory(),
      "cleanup-expired",
      async (value, _signal, guard) => {
        disposed.push(value.bytes[0] ?? 0);
        current = await guard?.();
      },
    );
    const binding = await bindings.create(expiredInput());

    await bindings.purgeExpired(2);

    expect(disposed).toEqual([1]);
    expect(current).toBe(true);
    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "closed" });
    await bindings.close();
  });

  it("fences an active expired session before cleanup disposal", async () => {
    const factory = new InMemoryStorageFactory();
    let disposed = 0;
    const bindings = cleanupRegistry(factory, "cleanup-active", () => {
      disposed += 1;
      return Promise.resolve();
    });
    const binding = await bindings.create(expiredInput());
    let guard: (() => Promise<boolean>) | undefined;
    let resume: (() => void) | undefined;
    const active = bindings.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 0,
      signal: new AbortController().signal,
      onBackend: (_value, _signal, current) =>
        new Promise<void>((resolve) => {
          guard = current;
          resume = resolve;
        }),
    });
    await Promise.resolve();

    await bindings.purgeExpired(2);

    expect(disposed).toBe(1);
    await expect(guard?.()).resolves.toBe(false);
    resume?.();
    await expect(active).resolves.toEqual({ kind: "denied" });
    await bindings.close();
  });

  it("permits only one durable cleaner callback across two registry handles", async () => {
    const factory = new InMemoryStorageFactory();
    let calls = 0;
    const dispose = () => {
      calls += 1;
      return Promise.resolve();
    };
    const first = cleanupRegistry(factory, "cleanup-race", dispose);
    const second = cleanupRegistry(factory, "cleanup-race", dispose);
    await first.create(expiredInput());

    await Promise.all([first.purgeExpired(2), second.purgeExpired(2)]);

    expect(calls).toBe(1);
    await first.close();
    await second.close();
  });

  it("reconciles an applied-then-thrown cleanup claim before disposal", async () => {
    const factory = new ApplyThenThrowFactory("cleanup-claim");
    let calls = 0;
    const bindings = cleanupRegistry(factory, "cleanup-claim", () => {
      calls += 1;
      return Promise.resolve();
    });
    await bindings.create(expiredInput());
    factory.arm();

    await bindings.purgeExpired(2);

    expect(calls).toBe(1);
    await bindings.close();
  });

  it("persists bounded cleanup backoff before retrying a failed callback", async () => {
    const factory = new InMemoryStorageFactory();
    let calls = 0;
    const bindings = cleanupRegistry(factory, "cleanup-backoff", () => {
      calls += 1;
      return Promise.reject(new Error("private backend failure"));
    });
    await bindings.create(expiredInput());

    await bindings.purgeExpired(10);
    expect(calls).toBe(1);
    expect(await cleanupControl(factory, "cleanup-backoff")).toMatchObject({
      failureCount: 1,
      retryAfterMs: 20,
    });
    expect(await cleanupControl(factory, "cleanup-backoff")).not.toHaveProperty("ownerId");
    await bindings.purgeExpired(19);
    expect(calls).toBe(1);
    await bindings.purgeExpired(20);
    expect(calls).toBe(2);
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
    const forged = { release: (): Promise<void> => Promise.resolve() };

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

function timedRegistry(
  storageFactory: StorageFactory,
  namespace: string,
): DurableSubscriptionBindings {
  return new DurableSubscriptionBindings({
    storageFactory,
    namespace,
    nextId: () => crypto.randomUUID(),
    dispose: () => Promise.resolve(),
    leaseMs: 100,
    cleanupBatchSize: 1,
    recordLimit: 10,
    maxRecordBytes: 1_024,
  });
}

function cleanupRegistry(
  storageFactory: StorageFactory,
  namespace: string,
  dispose: OnBackendSubscription,
): DurableSubscriptionBindings {
  let nextId = 0;
  return new DurableSubscriptionBindings({
    storageFactory,
    namespace,
    nextId: () => `binding-${(++nextId).toString()}`,
    dispose,
    leaseMs: 10,
    cleanupBatchSize: 1,
    recordLimit: 10,
    maxRecordBytes: 1_024,
  });
}

function expiredInput(): {
  readonly backend: { readonly kind: "backend-subscription-envelope"; readonly bytes: Uint8Array };
  readonly principalFingerprint: string;
  readonly tenant: undefined;
  readonly expiresAtMs: number;
} {
  return {
    backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
    principalFingerprint: "principal-a",
    tenant: undefined,
    expiresAtMs: 1,
  };
}

async function cleanupControl(
  factory: StorageFactory,
  namespace: string,
): Promise<Record<string, unknown>> {
  const store = repairStore(factory, namespace);
  const record = await store.read("!subscription-cleanup");
  store.close();
  if (record === undefined) throw new Error("cleanup control is absent");
  return JSON.parse(new TextDecoder().decode(record.value)) as Record<string, unknown>;
}

function repairStore(factory: StorageFactory, namespace: string): RecordStorage<string, Any> {
  return factory.createRecordStorage(
    { name: `spine.gateway.${namespace}`, multitenant: false },
    new RecordSpec({
      schema: AnySchema,
      storageKey: "spine.gateway.SubscriptionBinding:v2",
      idKind: "string",
      extractId: (record) => repairId(record),
    }),
  );
}

function repairId(record: Any): string {
  const value: unknown = JSON.parse(new TextDecoder().decode(record.value));
  if (
    value === null ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string"
  )
    throw new Error("repair record has no ID");
  return value.id;
}

async function seedRepair(
  store: RecordStorage<string, Any>,
  count: number,
  afterId: string | undefined,
): Promise<void> {
  const operation = {
    kind: "repair",
    operationId: "repair-test",
    count,
    ...(afterId === undefined ? {} : { afterId }),
  };
  await store.compareAndSet(
    "!subscription-quota",
    undefined,
    create(AnySchema, {
      typeUrl: "type.spine-event-engine.gateway/SubscriptionBindingQuota",
      value: new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          family: "quota",
          id: "!subscription-quota",
          revision: 1,
          used: 0,
          operation,
        }),
      ),
    }),
  );
}

function repairRecord(id: string, lifecycle: "reserved" | "retired"): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
    value: new TextEncoder().encode(
      JSON.stringify({
        version: 2,
        family: "binding",
        id,
        revision: 1,
        admissionToken: `${id}-token`,
        lifecycle,
        fence: 0,
        ...(lifecycle === "reserved" ? { reservationOwner: "owner", reservationUntilMs: 999 } : {}),
      }),
    ),
  });
}

function malformedRepairRecord(id: string): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-event-engine.gateway/DurableSubscriptionBinding",
    value: new TextEncoder().encode(
      JSON.stringify({ version: 2, family: "binding", id, revision: 1 }),
    ),
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
  #armed = false;

  constructor(
    private readonly phase:
      | "quota"
      | "slot"
      | "conversion"
      | "deletion"
      | "completion"
      | "repair-page"
      | "repair-final"
      | "claim"
      | "cancellation"
      | "retirement"
      | "cleanup-claim"
      | "renewal",
  ) {
    super();
  }

  arm(): void {
    this.#armed = true;
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
            !text.includes('"operation"')) ||
          (this.phase === "repair-page" &&
            id === "!subscription-quota" &&
            text.includes('"kind":"repair"') &&
            text.includes('"afterId"')) ||
          (this.phase === "repair-final" &&
            id === "!subscription-quota" &&
            !text.includes('"operation"')) ||
          (this.phase === "claim" &&
            id !== "!subscription-quota" &&
            text.includes('"lifecycle":"active"')) ||
          (this.phase === "cancellation" &&
            id !== "!subscription-quota" &&
            text.includes('"lifecycle":"cancelling"')) ||
          (this.phase === "retirement" &&
            id !== "!subscription-quota" &&
            text.includes('"lifecycle":"retired"')) ||
          (this.phase === "cleanup-claim" &&
            id === "!subscription-cleanup" &&
            text.includes('"ownerId"')) ||
          (this.phase === "renewal" &&
            id !== "!subscription-quota" &&
            text.includes('"lifecycle":"active"') &&
            text.includes('"revision":4'));
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
