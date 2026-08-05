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
  it("exposes its validated namespace for standalone gateway production admission", () => {
    const bindings = registry(new InMemoryStorageFactory(), "standalone-gateway");

    expect(bindings.namespace).toBe("standalone-gateway");
  });
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

  it("fences durable callbacks by exact ordered topology identity", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "topology");
    const createBinding = () =>
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal",
        topology: "a,b",
        tenant: undefined,
        expiresAtMs: 1_000,
      });
    const matching = await createBinding();
    let callbacks = 0;
    await expect(
      bindings.activate({
        id: matching.id,
        principalFingerprint: "principal",
        topology: "a,b",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => {
          callbacks++;
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "activated" });
    const rejected = await createBinding();
    for (const topology of ["b,a", "a,c", undefined]) {
      await expect(
        bindings.cancel({
          id: rejected.id,
          principalFingerprint: "principal",
          ...(topology === undefined ? {} : { topology }),
          tenant: undefined,
          nowMs: 1,
          onBackend: () => {
            callbacks++;
            return Promise.resolve();
          },
        }),
      ).resolves.toEqual({ kind: "denied" });
    }
    expect(callbacks).toBe(1);
    await bindings.close();
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

  it("serializes competing capacity claims at their quota CAS boundary", async () => {
    const factory = new ScriptedStorageFactory("quota-stage", "pass");
    factory.barrier();
    const first = capacityRegistry(factory, "barrier-capacity", 1);
    const second = capacityRegistry(factory, "barrier-capacity", 1);

    const results = await Promise.allSettled([first.reserveCapacity(), second.reserveCapacity()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
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

  it("serializes competing activation claims at their binding CAS boundary", async () => {
    const factory = new ScriptedStorageFactory("claim", "pass");
    factory.barrier();
    const first = registry(factory, "barrier-owner");
    const second = registry(factory, "barrier-owner");
    const binding = await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 1_000,
    });

    const outcomes = await Promise.all([
      first.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
      second.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.kind === "activated")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "denied")).toHaveLength(1);
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
      await vi.advanceTimersByTimeAsync(0);
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

  it("serializes competing cleaner claims at their cleanup CAS boundary", async () => {
    const factory = new ScriptedStorageFactory("cleanup-claim", "pass");
    factory.barrier();
    let calls = 0;
    const dispose = () => {
      calls += 1;
      return Promise.resolve();
    };
    const first = cleanupRegistry(factory, "barrier-cleaner", dispose);
    const second = cleanupRegistry(factory, "barrier-cleaner", dispose);
    await first.create(expiredInput());

    await Promise.all([first.purgeExpired(2), second.purgeExpired(2)]);
    expect(calls).toBe(1);
    await first.close();
    await second.close();
  });

  it("renews a cleaner lease before a blocked disposal can be taken over", async () => {
    const factory = new InMemoryStorageFactory();
    let release: (() => void) | undefined;
    let calls = 0;
    const dispose = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const first = cleanupRegistry(factory, "blocked-cleaner", dispose);
    const second = cleanupRegistry(factory, "blocked-cleaner", dispose);
    await first.create(expiredInput());
    const cleaning = first.purgeExpired(1);
    await new Promise<void>((resolve) => {
      const wait = () => {
        if (release === undefined) setTimeout(wait, 1);
        else resolve();
      };
      wait();
    });

    await second.purgeExpired(11);
    expect(calls).toBe(1);
    release?.();
    await cleaning;
    await first.close();
    await second.close();
  });

  it("keeps cleaner ownership while a disposal outlives multiple lease intervals", async () => {
    vi.useFakeTimers();
    try {
      const factory = new InMemoryStorageFactory();
      const started = Promise.withResolvers<undefined>();
      const released = Promise.withResolvers<undefined>();
      let calls = 0;
      const dispose = () => {
        calls += 1;
        started.resolve(undefined);
        return released.promise;
      };
      const first = cleanupRegistry(factory, "slow-cleaner", dispose);
      const second = cleanupRegistry(factory, "slow-cleaner", dispose);
      await first.create(expiredInput());
      const cleaning = first.purgeExpired(1);
      await started.promise;
      await vi.advanceTimersByTimeAsync(20);

      await second.purgeExpired(22);
      expect(calls).toBe(1);
      released.resolve(undefined);
      await cleaning;
      await first.close();
      await second.close();
    } finally {
      vi.useRealTimers();
    }
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

  it.each([
    ["applied-then-thrown", () => new ApplyThenThrowFactory("cleaner-renewal")],
    ["rejected", () => new RejectOnceFactory("cleaner-renewal")],
  ] as const)(
    "backs off when a %s cleaner renewal cannot be confirmed",
    async (_outcome, createFactory) => {
      const factory = createFactory();
      let calls = 0;
      const bindings = cleanupRegistry(factory, "cleaner-renewal", () => {
        calls += 1;
        return Promise.resolve();
      });
      await bindings.create(expiredInput());
      factory.arm();

      await bindings.purgeExpired(2);
      expect(calls).toBe(_outcome === "applied-then-thrown" ? 1 : 0);

      await bindings.purgeExpired(20);
      expect(calls).toBe(1);
      await bindings.close();
    },
  );

  it.each([
    ["applied-then-thrown", () => new ApplyThenThrowFactory("cleaner-shorten")],
    ["rejected", () => new RejectOnceFactory("cleaner-shorten")],
  ] as const)("reconciles a %s cleaner lease shortening race", async (_outcome, createFactory) => {
    const factory = createFactory();
    let calls = 0;
    const bindings = cleanupRegistry(factory, "cleaner-shorten", () => {
      calls += 1;
      return Promise.resolve();
    });
    await bindings.create(expiredInput());
    factory.arm();

    await bindings.purgeExpired(2);
    expect(calls).toBe(1);
    await bindings.close();
  });

  it("reconciles an applied cleaner cursor advancement", async () => {
    const factory = new ApplyThenThrowFactory("cleanup-advance");
    let calls = 0;
    const bindings = cleanupRegistry(factory, "cleanup-advance-applied", () => {
      calls += 1;
      return Promise.resolve();
    });
    await bindings.create(expiredInput());
    factory.arm();

    await bindings.purgeExpired(2);
    expect(calls).toBe(1);
    await bindings.close();
  });

  it("keeps cleanup finite when its durable backoff write loses a race", async () => {
    const factory = new RejectOnceFactory("cleanup-fail");
    const bindings = cleanupRegistry(factory, "cleanup-fail", () =>
      Promise.reject(new Error("private backend failure")),
    );
    await bindings.create(expiredInput());
    factory.arm();

    await expect(bindings.purgeExpired(2)).resolves.toBeUndefined();
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

  it("accepts each durable record family and rejects incompatible private state", () => {
    const valid = [
      durableRecord("binding", {
        id: "reserved",
        revision: 1,
        admissionToken: "reserved-token",
        lifecycle: "reserved",
        fence: 0,
        reservationOwner: "gateway",
        reservationUntilMs: 10,
      }),
      durableRecord("binding", {
        id: "inactive",
        revision: 1,
        admissionToken: "inactive-token",
        lifecycle: "inactive",
        fence: 0,
        principalFingerprint: "principal",
        topology: "legacy",
        tenant: "tenant",
        expiresAtMs: 10,
        backend: "AQ==",
        backendBytes: 1,
      }),
      durableRecord("binding", {
        id: "active",
        revision: 1,
        admissionToken: "active-token",
        lifecycle: "active",
        fence: 1,
        principalFingerprint: "principal",
        topology: "legacy",
        expiresAtMs: 10,
        backend: "AQ==",
        backendBytes: 1,
        ownerId: "gateway",
        leaseUntilMs: 9,
      }),
      durableRecord("binding", {
        id: "cancelling",
        revision: 1,
        admissionToken: "cancelling-token",
        lifecycle: "cancelling",
        fence: 2,
        principalFingerprint: "principal",
        topology: "legacy",
        expiresAtMs: 10,
        backend: "AQ==",
        backendBytes: 1,
        ownerId: "gateway",
        leaseUntilMs: 9,
      }),
      durableRecord("binding", {
        id: "retired",
        revision: 1,
        admissionToken: "retired-token",
        lifecycle: "retired",
        fence: 2,
      }),
      durableRecord("quota", { id: "!subscription-quota", revision: 1, used: 0 }),
      durableRecord("cleanup", {
        id: "!subscription-cleanup",
        revision: 1,
        fence: 0,
        failureCount: 0,
        retryAfterMs: 0,
      }),
    ];
    for (const record of valid)
      expect(() => {
        DurableSubscriptionBindingRecords.validate(record);
      }).not.toThrow();

    const invalid = [
      durableRecord("binding", {
        id: "!private",
        revision: 1,
        admissionToken: "token",
        lifecycle: "reserved",
        fence: 0,
      }),
      durableRecord("binding", {
        id: "missing",
        revision: 1,
        admissionToken: "token",
        lifecycle: "active",
        fence: 0,
        principalFingerprint: "principal",
        expiresAtMs: 1,
        backend: "AQ==",
        backendBytes: 1,
      }),
      durableRecord("binding", {
        id: "bad-bytes",
        revision: 1,
        admissionToken: "token",
        lifecycle: "inactive",
        fence: 0,
        principalFingerprint: "principal",
        expiresAtMs: 1,
        backend: "not-base64",
        backendBytes: 1,
      }),
      durableRecord("binding", {
        id: "retired-private",
        revision: 1,
        admissionToken: "token",
        lifecycle: "retired",
        fence: 0,
        principalFingerprint: "principal",
      }),
      durableRecord("quota", { id: "wrong", revision: 1, used: 0 }),
      durableRecord("quota", { id: "!subscription-quota", revision: 1, used: -1 }),
      durableRecord("cleanup", {
        id: "wrong",
        revision: 1,
        fence: 0,
        failureCount: 0,
        retryAfterMs: 0,
      }),
      durableRecord("cleanup", {
        id: "!subscription-cleanup",
        revision: 1,
        fence: -1,
        failureCount: 0,
        retryAfterMs: 0,
      }),
    ];
    for (const record of invalid)
      expect(() => {
        DurableSubscriptionBindingRecords.validate(record);
      }).toThrow("Durable subscription registry record is invalid.");
  });

  it.each([
    [
      durableRecord("binding", {
        id: "id",
        revision: 0,
        admissionToken: "token",
        lifecycle: "reserved",
        fence: 0,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "",
        lifecycle: "reserved",
        fence: 0,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "unknown",
        fence: 0,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "reserved",
        fence: -1,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "inactive",
        expiresAtMs: 1,
        backend: "AQ==",
        backendBytes: 1,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "inactive",
        principalFingerprint: "p",
        backend: "AQ==",
        backendBytes: 1,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "inactive",
        principalFingerprint: "p",
        expiresAtMs: 1,
        backendBytes: 1,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "inactive",
        principalFingerprint: "p",
        expiresAtMs: 1,
        backend: "AQ==",
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "inactive",
        principalFingerprint: "p",
        expiresAtMs: 1,
        backend: "AQ==",
        backendBytes: 2,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "active",
        principalFingerprint: "p",
        expiresAtMs: 1,
        backend: "AQ==",
        backendBytes: 1,
        ownerId: "",
        leaseUntilMs: 1,
      }),
    ],
    [
      durableRecord("binding", {
        id: "id",
        revision: 1,
        admissionToken: "token",
        lifecycle: "active",
        principalFingerprint: "p",
        expiresAtMs: 1,
        backend: "AQ==",
        backendBytes: 1,
        ownerId: "owner",
        leaseUntilMs: 0.1,
      }),
    ],
    [durableRecord("quota", { id: "!subscription-quota", revision: 1, used: 0.1 })],
    [
      durableRecord("cleanup", {
        id: "!subscription-cleanup",
        revision: 1,
        fence: 0,
        failureCount: 0.1,
        retryAfterMs: 0,
      }),
    ],
    [
      durableRecord("cleanup", {
        id: "!subscription-cleanup",
        revision: 1,
        fence: 0,
        failureCount: 0,
        retryAfterMs: 0.1,
      }),
    ],
  ])("fails closed for each malformed durable invariant %#", (record) => {
    expect(() => {
      DurableSubscriptionBindingRecords.validate(record);
    }).toThrow("Durable subscription registry record is invalid.");
  });

  it("rejects mismatched durable keys and bounded records", () => {
    const record = durableRecord("quota", { id: "!subscription-quota", revision: 1, used: 0 });
    expect(() => {
      DurableSubscriptionBindingRecords.validate(record, "other");
    }).toThrow("Durable subscription registry record is invalid.");
    expect(() => {
      DurableSubscriptionBindingRecords.validate(record, undefined, 1);
    }).toThrow("Durable subscription registry record is invalid.");
  });

  it("returns closed or denied for missing, expired, and already retired operations", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "terminal-operations");
    await expect(
      bindings.cancel({
        id: "missing",
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "closed" });
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 100,
    });
    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "closed" });
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

  it("fails closed when an atomic cancellation claim loses its race", async () => {
    const factory = new RejectOnceFactory("cancellation");
    const bindings = registry(factory, "cancel-race");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 100,
    });
    factory.arm();

    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await bindings.close();
  });

  it("does not run a backend callback when activation loses its atomic claim", async () => {
    const factory = new RejectOnceFactory("claim");
    const bindings = registry(factory, "activation-race");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 100,
    });
    factory.arm();
    const backend = vi.fn(() => Promise.resolve());

    await expect(
      bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: backend,
      }),
    ).resolves.toEqual({ kind: "denied" });

    expect(backend).not.toHaveBeenCalled();
    await bindings.close();
  });

  it("returns a finite denial when retirement loses its atomic update", async () => {
    const factory = new RejectOnceFactory("retirement");
    const bindings = registry(factory, "retirement-race");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 100,
    });
    factory.arm();

    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await bindings.close();
  });

  it("recovers cleanup after a competing control-row update", async () => {
    const factory = new RejectOnceFactory("cleanup-advance");
    let calls = 0;
    const bindings = cleanupRegistry(factory, "cleanup-race-loss", () => {
      calls += 1;
      return Promise.resolve();
    });
    await bindings.create(expiredInput());
    factory.arm();

    await bindings.purgeExpired(2);
    await bindings.purgeExpired(20);
    await bindings.purgeExpired(20);
    await bindings.purgeExpired(20);

    expect(calls).toBeGreaterThanOrEqual(1);
    await bindings.close();
  });

  it("rejects a reserved control ID from the identifier generator", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "invalid-id",
      nextId: () => "!subscription-quota",
      dispose: () => Promise.resolve(),
      leaseMs: 1,
      cleanupBatchSize: 1,
      recordLimit: 2,
      maxRecordBytes: 1_024,
    });

    await expect(bindings.reserveCapacity()).rejects.toThrow("subscription ID must be unique");
    await bindings.close();
  });

  it.each(["quota-stage", "slot", "quota-completion"] as const)(
    "converges a rejected %s admission update",
    async (phase) => {
      const factory = new RejectOnceFactory(phase);
      const bindings = capacityRegistry(factory, `rejected-${phase}`, 2);
      const initial = await bindings.reserveCapacity();
      await initial.release();
      factory.arm();

      await expect(bindings.reserveCapacity()).resolves.toBeDefined();
      await bindings.close();
    },
  );

  it("converges a rejected release update without retaining capacity", async () => {
    const factory = new RejectOnceFactory("release-stage");
    const bindings = capacityRegistry(factory, "rejected-release", 1);
    const reservation = await bindings.reserveCapacity();
    factory.arm();

    await reservation.release();
    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("fails closed when a reservation conversion loses its atomic replacement", async () => {
    const factory = new RejectOnceFactory("conversion");
    const bindings = capacityRegistry(factory, "conversion-race", 1);
    const reservation = await bindings.reserveCapacity();
    factory.arm();

    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 100,
        reservation,
      }),
    ).rejects.toThrow("binding-capacity-exceeded");
    await bindings.close();
  });

  it("releases an internally acquired reservation after failed durable creation", async () => {
    const factory = new RejectOnceFactory("conversion");
    const bindings = capacityRegistry(factory, "failed-internal-create", 1);
    factory.arm();

    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 100,
      }),
    ).rejects.toThrow("binding-capacity-exceeded");
    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("treats a vanished cancellation row as already closed after its callback", async () => {
    const factory = new VanishingFactory("binding-1", 2);
    const bindings = registry(factory, "cancel-vanished");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 100,
    });
    factory.arm();

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

  it("does not finalize an activation after its durable row disappears", async () => {
    const factory = new VanishingFactory("binding-1", 2);
    const bindings = registry(factory, "activation-vanished");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 100,
    });
    factory.arm();

    await expect(
      bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await bindings.close();
  });

  it("treats an unexpired cleanup lease held by another gateway as authoritative", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "foreign-cleaner");
    await seedRecord(
      store,
      "!subscription-cleanup",
      durableRecord("cleanup", {
        id: "!subscription-cleanup",
        revision: 1,
        ownerId: "other-gateway",
        fence: 1,
        leaseUntilMs: 100,
        failureCount: 0,
        retryAfterMs: 0,
      }),
    );
    store.close();
    const bindings = cleanupRegistry(factory, "foreign-cleaner", () => {
      throw new Error("foreign cleanup must not run");
    });

    await expect(bindings.purgeExpired(1)).resolves.toBeUndefined();
    await bindings.close();
  });

  it("keeps malformed, live reserved, and retired rows finite during cleanup", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "cleanup-row-kinds");
    await seedRecord(
      store,
      "!subscription-quota",
      durableRecord("quota", {
        id: "!subscription-quota",
        revision: 1,
        used: 2,
      }),
    );
    await seedRecord(store, "a-malformed", malformedRepairRecord("a-malformed"));
    await seedRecord(store, "b-live", repairRecord("b-live", "reserved"));
    await seedRecord(store, "c-retired", repairRecord("c-retired", "retired"));
    store.close();
    const bindings = cleanupRegistry(factory, "cleanup-row-kinds", () => Promise.resolve());

    await bindings.purgeExpired(1);
    await bindings.purgeExpired(1);
    await bindings.purgeExpired(1);

    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("keeps cleanup finite when a selected binding disappears before reading", async () => {
    const factory = new VanishingFactory("binding-1", 1);
    const bindings = cleanupRegistry(factory, "vanished-cleanup", () => Promise.resolve());
    await bindings.create(expiredInput());
    factory.arm();

    await expect(bindings.purgeExpired(2)).resolves.toBeUndefined();
    await bindings.close();
  });

  it("rejects non-finite operation times and empty private envelopes", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "invalid-inputs");
    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array() },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 1,
      }),
    ).rejects.toThrow("subscription owner and backend are required");
    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: -1,
      }),
    ).rejects.toThrow("Subscription time must be a safe integer");
    await expect(bindings.purgeExpired(-1)).rejects.toThrow(
      "Subscription time must be a safe integer",
    );
    await bindings.close();
  });

  it("retries expired cleanup after its cancellation fence loses a race", async () => {
    const factory = new RejectOnceFactory("expired-cancellation");
    let calls = 0;
    const bindings = cleanupRegistry(factory, "expired-race", () => {
      calls += 1;
      return Promise.resolve();
    });
    await bindings.create(expiredInput());
    factory.arm();

    await bindings.purgeExpired(2);
    await bindings.purgeExpired(20);
    await bindings.purgeExpired(20);
    await bindings.purgeExpired(20);

    expect(calls).toBe(1);
    await bindings.close();
  });

  it("does not resurrect an activation whose final cancellation update loses a race", async () => {
    const factory = new RejectOnceFactory("activation-finalize");
    const bindings = registry(factory, "finalize-race");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 100,
    });
    factory.arm();

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
    await bindings.close();
  });

  it("completes a pending release before admitting another slot", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "pending-release");
    await seedRecord(
      store,
      "!subscription-quota",
      durableRecord("quota", {
        id: "!subscription-quota",
        revision: 1,
        used: 1,
        operation: {
          kind: "release",
          operationId: "release",
          bindingId: "missing",
          token: "token",
        },
      }),
    );
    store.close();
    const bindings = capacityRegistry(factory, "pending-release", 1);

    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("fails closed when a pending reservation operation finds a replacement token", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "replacement-token");
    await seedRecord(
      store,
      "!subscription-quota",
      durableRecord("quota", {
        id: "!subscription-quota",
        revision: 1,
        used: 0,
        operation: {
          kind: "reserve",
          operationId: "reserve",
          bindingId: "slot",
          token: "expected",
        },
      }),
    );
    await seedRecord(store, "slot", repairRecord("slot", "reserved"));
    store.close();
    const bindings = capacityRegistry(factory, "replacement-token", 1);

    await expect(bindings.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
    await bindings.close();
  });

  it("fails closed when fresh quota or cleanup control creation loses its atomic race", async () => {
    const quotaFactory = new RejectOnceFactory("quota-create");
    quotaFactory.arm();
    const quotaBindings = capacityRegistry(quotaFactory, "quota-create-race", 1);
    await expect(quotaBindings.reserveCapacity()).rejects.toThrow(
      "Subscription quota was not created",
    );
    await quotaBindings.close();

    const cleanupFactory = new RejectOnceFactory("cleanup-create");
    cleanupFactory.arm();
    const cleanupBindings = cleanupRegistry(cleanupFactory, "cleanup-create-race", () =>
      Promise.resolve(),
    );
    await expect(cleanupBindings.purgeExpired(1)).rejects.toThrow(
      "Subscription cleanup was not created",
    );
    await cleanupBindings.close();
  });

  it("finishes an empty durable repair before admitting capacity", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "empty-repair");
    await seedRepair(store, 0, undefined);
    store.close();
    const bindings = capacityRegistry(factory, "empty-repair", 1);

    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("bounds cleanup retry arithmetic at the durable safe-integer limit", async () => {
    const factory = new InMemoryStorageFactory();
    const bindings = cleanupRegistry(factory, "overflow-backoff", () =>
      Promise.reject(new Error("private failure")),
    );
    await bindings.create(expiredInput());
    const now = Number.MAX_SAFE_INTEGER - 1;

    await bindings.purgeExpired(now);

    expect(await cleanupControl(factory, "overflow-backoff")).toMatchObject({
      failureCount: 1,
      retryAfterMs: Number.MAX_SAFE_INTEGER,
    });
    await bindings.close();
  });

  it("saturates finite activation and cancellation leases", async () => {
    const bindings = timedRegistry(new InMemoryStorageFactory(), "saturated-lease");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    });
    await expect(
      bindings.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: Number.MAX_SAFE_INTEGER - 1,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "closed" });
    await bindings.close();
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
    [
      '{"version":1,"id":"binding","principalFingerprint":"owner","expiresAtMs":1,',
      '"lifecycle":"inactive","leaseUntilMs":0,"cancellationFence":0,"backend":"AQ","encodedBytes":2}',
    ].join(""),
    [
      '{"version":1,"id":"binding","principalFingerprint":"owner","expiresAtMs":1,',
      '"lifecycle":"inactive","leaseUntilMs":0,"cancellationFence":0,"backend":"AQ==","encodedBytes":3}',
    ].join(""),
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
        [
          '{"version":1,"id":"binding","principalFingerprint":"owner","expiresAtMs":1,',
          '"lifecycle":"inactive","leaseUntilMs":0,"cancellationFence":0,"backend":"AQ==","encodedBytes":99}',
        ].join(""),
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

  it("fails closed when a reserved durable row vanishes before conversion", async () => {
    const factory = new VanishingFactory("binding", 1);
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "vanished-conversion",
      nextId: () => "binding",
      dispose: () => Promise.resolve(),
      leaseMs: 10,
      cleanupBatchSize: 1,
      recordLimit: 1,
      maxRecordBytes: 1_024,
    });
    const reservation = await bindings.reserveCapacity();
    factory.arm();

    await expect(
      bindings.create({
        backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
        principalFingerprint: "principal-a",
        tenant: undefined,
        expiresAtMs: 100,
        reservation,
      }),
    ).rejects.toThrow("binding-capacity-exceeded");
    await bindings.close();
  });

  it("does not return a reservation whose durable slot disappears after admission", async () => {
    const factory = new VanishingFactory("binding", 2);
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "vanished-admission",
      nextId: () => "binding",
      dispose: () => Promise.resolve(),
      leaseMs: 10,
      cleanupBatchSize: 1,
      recordLimit: 1,
      maxRecordBytes: 1_024,
    });
    factory.arm();

    await expect(bindings.reserveCapacity()).rejects.toThrow();
    await bindings.close();
  });

  it("keeps the newer local activation while an expired callback finishes", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "overlapping-activation");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    let resume: (() => void) | undefined;
    let started: (() => void) | undefined;
    const first = bindings.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1,
      signal: new AbortController().signal,
      onBackend: () =>
        new Promise<void>((resolve) => {
          started?.();
          resume = resolve;
        }),
    });
    await new Promise<void>((resolve) => {
      started = resolve;
    });

    await expect(
      bindings.activate({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2_000,
        signal: new AbortController().signal,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "activated" });
    resume?.();
    await expect(first).resolves.toEqual({ kind: "denied" });
    await bindings.close();
  });

  it("denies a foreign gateway while a failed cancellation retains its lease", async () => {
    const factory = new InMemoryStorageFactory();
    const first = registry(factory, "foreign-cancellation");
    const second = registry(factory, "foreign-cancellation");
    const binding = await first.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    await expect(
      first.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 1,
        onBackend: () => Promise.reject(new Error("backend failure")),
      }),
    ).resolves.toEqual({ kind: "denied" });

    await expect(
      second.cancel({
        id: binding.id,
        principalFingerprint: "principal-a",
        tenant: undefined,
        nowMs: 2,
        onBackend: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await first.close();
    await second.close();
  });

  it("repairs a legacy incomplete quota operation conservatively", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "repair-without-count");
    await seedRecord(
      store,
      "!subscription-quota",
      durableRecord("quota", {
        id: "!subscription-quota",
        revision: 1,
        used: 0,
        operation: { kind: "repair", operationId: "repair" },
      }),
    );
    await seedRecord(store, "binding", repairRecord("binding", "reserved"));
    store.close();
    const bindings = capacityRegistry(factory, "repair-without-count", 1);

    await expect(bindings.reserveCapacity()).rejects.toThrow("binding-capacity-exceeded");
    await bindings.close();
  });

  it("treats incomplete durable expiry facts as expired without retaining capacity", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "incomplete-expiry");
    await seedRecord(
      store,
      "binding",
      durableRecord("binding", {
        id: "binding",
        revision: 1,
        admissionToken: "token",
        lifecycle: "reserved",
        fence: 0,
      }),
    );
    await seedRecord(
      store,
      "!subscription-cleanup",
      durableRecord("cleanup", {
        id: "!subscription-cleanup",
        revision: 1,
        fence: 1,
        ownerId: "other-gateway",
        failureCount: 0,
        retryAfterMs: 0,
      }),
    );
    store.close();
    const bindings = capacityRegistry(factory, "incomplete-expiry", 1);

    await bindings.purgeExpired(1);
    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("cleans an expired binding whose ID sorts before durable control rows", async () => {
    const factory = new InMemoryStorageFactory();
    const store = repairStore(factory, "low-cleanup-id");
    await seedRecord(
      store,
      "\u0000binding",
      durableRecord("binding", {
        id: "\u0000binding",
        revision: 1,
        admissionToken: "token",
        lifecycle: "reserved",
        fence: 0,
      }),
    );
    await seedRecord(
      store,
      "!subscription-quota",
      durableRecord("quota", { id: "!subscription-quota", revision: 1, used: 1 }),
    );
    store.close();
    const bindings = capacityRegistry(factory, "low-cleanup-id", 1);

    await bindings.purgeExpired(1);
    await expect(bindings.reserveCapacity()).resolves.toBeDefined();
    await bindings.close();
  });

  it("converges a deferred activation before closing its durable storage", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "close-activation");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    let started: (() => void) | undefined;
    const active = bindings.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1,
      signal: new AbortController().signal,
      onBackend: (_value, signal) =>
        new Promise<void>((resolve) => {
          started = resolve;
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        }),
    });
    await new Promise<void>((resolve) => {
      const wait = () => {
        if (started === undefined) queueMicrotask(wait);
        else resolve();
      };
      wait();
    });

    await expect(Promise.all([active, bindings.close()])).resolves.toHaveLength(2);
  });

  it("aborts every overlapping activation fence when closing one binding", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "close-overlapping-activation");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    let started = 0;
    let aborted = 0;
    const callback: OnBackendSubscription = (_value, signal) =>
      new Promise<void>((resolve) => {
        started += 1;
        signal.addEventListener(
          "abort",
          () => {
            aborted += 1;
            resolve();
          },
          { once: true },
        );
      });
    const first = bindings.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1,
      signal: new AbortController().signal,
      onBackend: callback,
    });
    await new Promise<void>((resolve) => {
      const wait = () => {
        if (started < 1) setTimeout(wait, 1);
        else resolve();
      };
      wait();
    });
    const second = bindings.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1_001,
      signal: new AbortController().signal,
      onBackend: callback,
    });
    await new Promise<void>((resolve) => {
      const wait = () => {
        if (started < 2) setTimeout(wait, 1);
        else resolve();
      };
      wait();
    });

    await expect(Promise.all([first, second, bindings.close()])).resolves.toHaveLength(3);
    expect(aborted).toBe(2);
  });

  it("converges a deferred cancellation before closing its durable storage", async () => {
    const bindings = registry(new InMemoryStorageFactory(), "close-cancellation");
    const binding = await bindings.create({
      backend: { kind: "backend-subscription-envelope", bytes: new Uint8Array([1]) },
      principalFingerprint: "principal-a",
      tenant: undefined,
      expiresAtMs: 10_000,
    });
    let started: (() => void) | undefined;
    const cancelling = bindings.cancel({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: undefined,
      nowMs: 1,
      onBackend: (_value, signal) =>
        new Promise<void>((resolve) => {
          started = resolve;
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        }),
    });
    await new Promise<void>((resolve) => {
      const wait = () => {
        if (started === undefined) queueMicrotask(wait);
        else resolve();
      };
      wait();
    });

    await expect(Promise.all([cancelling, bindings.close()])).resolves.toHaveLength(2);
  });
});

function registry(storageFactory: StorageFactory, namespace: string): DurableSubscriptionBindings {
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
      storageKey: "spine.gateway.SubscriptionBinding:v3",
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

async function seedRecord(
  store: RecordStorage<string, Any>,
  id: string,
  record: Any,
): Promise<void> {
  await store.compareAndSet(id, undefined, record);
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
        version: 3,
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
      JSON.stringify({ version: 3, family: "binding", id, revision: 1 }),
    ),
  });
}

function durableRecord(
  family: "binding" | "quota" | "cleanup",
  value: Record<string, unknown>,
): Any {
  const typeUrl =
    family === "binding"
      ? "type.spine-event-engine.gateway/DurableSubscriptionBinding"
      : family === "quota"
        ? "type.spine-event-engine.gateway/SubscriptionBindingQuota"
        : "type.spine-event-engine.gateway/SubscriptionBindingCleanup";
  return create(AnySchema, {
    typeUrl,
    value: new TextEncoder().encode(
      JSON.stringify({ version: family === "binding" ? 3 : 1, family, ...value }),
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

type ScriptPhase =
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
  | "cleaner-renewal"
  | "cleaner-shorten"
  | "cleanup-fail"
  | "renewal"
  | "cleanup-advance"
  | "quota-stage"
  | "quota-completion"
  | "release-stage"
  | "expired-cancellation"
  | "activation-finalize"
  | "quota-create"
  | "cleanup-create";

type ScriptOutcome = "apply-then-throw" | "reject" | "pass";

/**
 * Holds a fixed number of storage operations at the same atomic mutation boundary.
 */
class StorageScriptBarrier {
  #arrivals = 0;
  readonly #released = Promise.withResolvers<undefined>();

  constructor(private readonly parties = 2) {}

  async wait(): Promise<void> {
    this.#arrivals += 1;
    if (this.#arrivals === this.parties) this.#released.resolve(undefined);
    await this.#released.promise;
  }
}

/**
 * Scripts one semantic registry transition without depending on serialized JSON text.
 */
class ScriptedStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  #armed = false;
  #barrier: StorageScriptBarrier | undefined;

  constructor(
    private readonly phase: ScriptPhase,
    private readonly outcome: ScriptOutcome,
  ) {
    super();
  }

  arm(): void {
    this.#armed = true;
  }

  barrier(): StorageScriptBarrier {
    this.#barrier ??= new StorageScriptBarrier();
    return this.#barrier;
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new ScriptedStorage(
      context,
      spec,
      this.#delegate.createRecordStorage(context, spec),
      this.outcome,
      async (id, expected, next) => {
        if (
          this.#barrier !== undefined &&
          scriptedTransition(
            this.phase,
            String(id),
            expected as unknown as Any | undefined,
            next as unknown as Any | undefined,
          )
        )
          await this.#barrier.wait();
      },
      (id, expected, next) =>
        this.#take(
          String(id),
          expected as unknown as Any | undefined,
          next as unknown as Any | undefined,
        ),
    );
  }

  #take(id: string, expected: Any | undefined, next: Any | undefined): boolean {
    if (!this.#armed || !scriptedTransition(this.phase, id, expected, next)) return false;
    this.#armed = false;
    return true;
  }
}

/**
 * Preserves concise test setup while delegating all scripting to one semantic decorator.
 */
class ApplyThenThrowFactory extends ScriptedStorageFactory {
  constructor(
    phase: Extract<
      ScriptPhase,
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
      | "cleaner-renewal"
      | "cleaner-shorten"
      | "cleanup-advance"
      | "renewal"
    >,
  ) {
    super(phase, "apply-then-throw");
  }
}

/**
 * Preserves concise test setup while delegating all scripting to one semantic decorator.
 */
class RejectOnceFactory extends ScriptedStorageFactory {
  constructor(
    phase: Exclude<
      ScriptPhase,
      "deletion" | "completion" | "repair-page" | "repair-final" | "cleanup-claim"
    >,
  ) {
    super(phase, "reject");
  }
}

/**
 * Delegates record storage while forcing one named registry transition to fail deterministically.
 */
class ScriptedStorage<I, R extends Message> extends RecordStorage<I, R> {
  override readonly atomicCompareAndSet = true;

  constructor(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    private readonly delegate: RecordStorage<I, R>,
    private readonly outcome: ScriptOutcome,
    private readonly before: (id: I, expected: R | undefined, next: R | undefined) => Promise<void>,
    private readonly take: (id: I, expected: R | undefined, next: R | undefined) => boolean,
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
    await this.before(id, expected?.record, next?.record);
    if (this.outcome === "reject" && this.take(id, expected?.record, next?.record)) return false;
    const applied = await this.delegate.compareAndSet(id, expected?.record, next?.record);
    if (
      applied &&
      this.outcome === "apply-then-throw" &&
      this.take(id, expected?.record, next?.record)
    )
      throw new Error("applied-then-thrown");
    return applied;
  }
}

function scriptedTransition(
  phase: ScriptPhase,
  id: string,
  expected: Any | undefined,
  next: Any | undefined,
): boolean {
  const prior = scriptedFact(expected);
  const fact = scriptedFact(next);
  const operation = fact?.operation as Record<string, unknown> | undefined;
  const binding = fact?.family === "binding";
  const quota = id === "!subscription-quota" && fact?.family === "quota";
  const cleanup = id === "!subscription-cleanup" && fact?.family === "cleanup";
  switch (phase) {
    case "quota":
      return quota && operation !== undefined;
    case "slot":
      return binding && fact.lifecycle === "reserved";
    case "conversion":
      return binding && fact.lifecycle === "inactive";
    case "deletion":
      return id !== "!subscription-quota" && id !== "!subscription-cleanup" && next === undefined;
    case "completion":
    case "repair-final":
      return quota && operation === undefined;
    case "repair-page":
      return quota && operation?.kind === "repair" && operation.afterId !== undefined;
    case "claim":
      return binding && fact.lifecycle === "active";
    case "cancellation":
      return binding && fact.lifecycle === "cancelling";
    case "retirement":
      return binding && fact.lifecycle === "retired";
    case "cleanup-claim":
      return cleanup && fact.ownerId !== undefined;
    case "cleaner-renewal":
      return (
        cleanup &&
        prior !== undefined &&
        prior.ownerId === fact.ownerId &&
        prior.fence === fact.fence &&
        Number(fact.leaseUntilMs) > Number(prior.leaseUntilMs)
      );
    case "cleaner-shorten":
      return (
        cleanup &&
        prior !== undefined &&
        prior.ownerId === fact.ownerId &&
        prior.fence === fact.fence &&
        Number(fact.leaseUntilMs) < Number(prior.leaseUntilMs)
      );
    case "cleanup-fail":
      return cleanup && fact.ownerId === undefined && fact.failureCount === 1;
    case "renewal":
      return binding && fact.lifecycle === "active";
    case "cleanup-advance":
      return cleanup && fact.afterId !== undefined;
    case "quota-stage":
      return quota && operation?.kind === "reserve";
    case "quota-completion":
      return quota && operation === undefined;
    case "release-stage":
      return quota && operation?.kind === "release";
    case "expired-cancellation":
      return binding && fact.reason === "expired";
    case "activation-finalize":
      return binding && fact.reason === "activation-end";
    case "quota-create":
      return quota && operation === undefined;
    case "cleanup-create":
      return cleanup && fact.ownerId === undefined;
  }
}

function scriptedFact(next: Any | undefined): Record<string, unknown> | undefined {
  if (next === undefined) return undefined;
  return JSON.parse(new TextDecoder().decode(next.value)) as Record<string, unknown>;
}

class VanishingFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  #armed = false;

  constructor(
    private readonly id: string,
    private readonly afterReads: number,
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
    return new VanishingStorage(
      context,
      spec,
      this.#delegate.createRecordStorage(context, spec),
      this.id as unknown as I,
      () => this.#armed,
      this.afterReads,
    );
  }
}

class VanishingStorage<I, R extends Message> extends RecordStorage<I, R> {
  override readonly atomicCompareAndSet = true;
  #reads = 0;

  constructor(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    private readonly delegate: RecordStorage<I, R>,
    private readonly target: I,
    private readonly armed: () => boolean,
    private readonly afterReads: number,
  ) {
    super(context, spec);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.delegate.delete(id);
  }
  protected queryRecordEntries(query: RecordQuery<I>) {
    return this.delegate.queryEntries(query);
  }
  protected async readRecord(id: I): Promise<R | undefined> {
    if (this.armed() && id === this.target && ++this.#reads >= this.afterReads) {
      await this.delegate.delete(id);
      return undefined;
    }
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
  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    return this.delegate.compareAndSet(id, expected?.record, next?.record);
  }
}
