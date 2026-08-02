import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DurableSubscriptionBindings } from "../../src/index.js";

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
    first.close();

    const reopened = registry(factory, "messageboard");
    let callbackBytes: Uint8Array | undefined;
    const activated = await reopened.activate({
      id: binding.id,
      principalFingerprint: "principal-a",
      tenant: "tenant-a",
      nowMs: 1,
      signal: new AbortController().signal,
      onBackend: async (value) => {
        callbackBytes = value.bytes.slice();
        value.bytes[0] = 88;
      },
    });

    expect(activated).toEqual({ kind: "activated" });
    expect(callbackBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(factory.isOpen()).toBe(true);
    reopened.close();
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
        onBackend: async () => undefined,
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      first.activate({
        id: binding.id,
        principalFingerprint: "principal-b",
        tenant: undefined,
        nowMs: 1,
        signal: new AbortController().signal,
        onBackend: async () => undefined,
      }),
    ).resolves.toEqual({ kind: "denied" });
    first.close();
    second.close();
  });

  it.each([
    { namespace: "", leaseMs: 10, cleanupBatchSize: 1, recordLimit: 1, maxRecordBytes: 1 },
    { namespace: "valid", leaseMs: Infinity, cleanupBatchSize: 1, recordLimit: 1, maxRecordBytes: 1 },
    { namespace: "valid", leaseMs: 10, cleanupBatchSize: 0, recordLimit: 1, maxRecordBytes: 1 },
    { namespace: "valid", leaseMs: 10, cleanupBatchSize: 1, recordLimit: 0, maxRecordBytes: 1 },
    { namespace: "valid", leaseMs: 10, cleanupBatchSize: 1, recordLimit: 1, maxRecordBytes: 0 },
  ])("rejects invalid finite options %#", (options) => {
    expect(
      () =>
        new DurableSubscriptionBindings({
          storageFactory: new InMemoryStorageFactory(),
          nextId: () => "binding",
          dispose: async () => undefined,
          ...options,
        }),
    ).toThrow();
  });
});

function registry(storageFactory: InMemoryStorageFactory, namespace: string): DurableSubscriptionBindings {
  return new DurableSubscriptionBindings({
    storageFactory,
    namespace,
    nextId: () => "binding-a",
    dispose: async () => undefined,
    leaseMs: 1_000,
    cleanupBatchSize: 10,
    recordLimit: 10,
    maxRecordBytes: 1_024,
  });
}
