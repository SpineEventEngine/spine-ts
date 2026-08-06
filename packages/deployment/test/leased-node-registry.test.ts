import { create } from "@bufbuild/protobuf";
import { StructSchema, ValueSchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { ApplicationNode, LeasedNodeRegistry } from "../src/index.js";
import { leaseRecordSpec } from "../src/leased-node-registry.js";

describe("LeasedNodeRegistry", () => {
  it("fences a stale registration after a node ID is reused", async () => {
    const factory = new InMemoryStorageFactory();
    const first = new LeasedNodeRegistry({ factory, namespace: "deployment-a" });
    const second = new LeasedNodeRegistry({ factory, namespace: "deployment-a" });
    const node = new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1:8080" });

    await expect(first.register({ node, registrationId: "first", expiresAt: 100 })).resolves.toBe(
      true,
    );
    await expect(first.remove("node/a", "first")).resolves.toBe(true);
    await expect(second.register({ node, registrationId: "second", expiresAt: 200 })).resolves.toBe(
      true,
    );
    await expect(first.renew("node/a", "first", 300)).resolves.toBe(false);
    await expect(first.remove("node/a", "first")).resolves.toBe(false);
    await expect(second.read(199)).resolves.toEqual([node]);
  });

  it("omits a lease exactly at its expiry and keeps namespaces isolated", async () => {
    const factory = new InMemoryStorageFactory();
    const left = new LeasedNodeRegistry({ factory, namespace: "left" });
    const right = new LeasedNodeRegistry({ factory, namespace: "right" });
    const node = new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1" });

    await left.register({ node, registrationId: "left-process", expiresAt: 100 });
    await expect(left.read(99)).resolves.toEqual([node]);
    await expect(left.read(100)).resolves.toEqual([]);
    await expect(right.read(99)).resolves.toEqual([]);
  });

  it("returns every live node beyond the expected operational count", async () => {
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "forty-nodes",
    });
    for (let index = 0; index < 40; index++) {
      await registry.register({
        node: new ApplicationNode({
          id: `node/${String(index)}`,
          endpoint: `http://10.0.0.${String(index + 1)}`,
        }),
        registrationId: `process-${String(index)}`,
        expiresAt: 1_000,
      });
    }

    await expect(registry.read(999)).resolves.toHaveLength(40);
  });

  it("rejects an atomicity-free factory before accepting lease lifecycle work", () => {
    expect(
      () => new LeasedNodeRegistry({ factory: new NonAtomicFactory(), namespace: "no-atomic" }),
    ).toThrow("atomic compare-and-set");
  });

  it("fails an entire malformed snapshot without modifying its rows", async () => {
    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "invalid-row" });
    const storage = factory.createRecordStorage(
      { name: "invalid-row", multitenant: false },
      leaseRecordSpec,
    );
    await storage.write(
      create(StructSchema, {
        fields: { nodeId: create(ValueSchema, { kind: { case: "stringValue", value: "node/a" } }) },
      }),
    );

    await expect(registry.read(0)).rejects.toThrow("invalid");
    await expect(storage.query()).resolves.toHaveLength(1);
  });

  it("cleans expired rows in finite repeatable batches under concurrent callers", async () => {
    const factory = new InMemoryStorageFactory();
    const first = new LeasedNodeRegistry({ factory, namespace: "cleanup", cleanupBatchSize: 2 });
    const second = new LeasedNodeRegistry({ factory, namespace: "cleanup", cleanupBatchSize: 2 });
    for (let index = 0; index < 3; index++) {
      await first.register({
        node: new ApplicationNode({
          id: `expired/${String(index)}`,
          endpoint: `http://10.0.1.${String(index + 1)}`,
        }),
        registrationId: `expired-process-${String(index)}`,
        expiresAt: 10,
      });
    }

    await Promise.all([first.cleanup(10), second.cleanup(10)]);
    await first.cleanup(10);
    await expect(first.read(10)).resolves.toEqual([]);
    await expect(first.cleanup(10)).resolves.toBe(0);
  });

  it("closes its handle deterministically and rejects later work", async () => {
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "closed",
    });
    registry.close();
    registry.close();
    await expect(registry.read(0)).rejects.toThrow("closed");
  });
});

class NonAtomicFactory extends InMemoryStorageFactory {
  override createRecordStorage<I, R extends import("@bufbuild/protobuf").Message>(
    context: import("@spine-event-engine/storage").StorageContext,
    recordSpec: import("@spine-event-engine/storage").RecordSpec<I, R>,
  ): import("@spine-event-engine/storage").RecordStorage<I, R> {
    const storage = super.createRecordStorage(context, recordSpec);
    Object.defineProperty(storage, "atomicCompareAndSet", { value: false });
    return storage;
  }
}
