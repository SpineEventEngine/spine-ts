import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DurableSubscriptionBindings, isDurableSubscriptionBindings } from "../../src/index.js";
import { BrowserServer } from "../../src/server/browser-server.js";
import { DurableSubscriptionBindingRecords } from "../../src/server/durable-subscription-bindings.js";

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
      BrowserServer.requireDurableBindings({}, true);
    }).toThrow("requires durable subscription bindings");
    expect(() => {
      BrowserServer.requireDurableBindings({ bindings }, true);
    }).not.toThrow();
    expect(() => {
      BrowserServer.requireDurableBindings({}, false);
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
    ).resolves.toEqual({ kind: "closed" });
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
