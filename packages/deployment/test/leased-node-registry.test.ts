import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { ApplicationNode, LeasedNodeRegistry } from "../src/index.js";

describe("LeasedNodeRegistry", () => {
  it("fences a stale registration after a node ID is reused", async () => {
    const factory = new InMemoryStorageFactory();
    const first = new LeasedNodeRegistry({ factory, namespace: "deployment-a" });
    const second = new LeasedNodeRegistry({ factory, namespace: "deployment-a" });
    const node = new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1:8080" });

    await expect(first.register({ node, registrationId: "first", expiresAt: 100 })).resolves.toBe(true);
    await expect(first.remove("node/a", "first")).resolves.toBe(true);
    await expect(second.register({ node, registrationId: "second", expiresAt: 200 })).resolves.toBe(true);
    await expect(first.renew("node/a", "first", 300)).resolves.toBe(false);
    await expect(first.remove("node/a", "first")).resolves.toBe(false);
    await expect(second.read(200)).resolves.toEqual([node]);
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
        node: new ApplicationNode({ id: `node/${String(index)}`, endpoint: `http://10.0.0.${String(index + 1)}` }),
        registrationId: `process-${String(index)}`,
        expiresAt: 1_000,
      });
    }

    await expect(registry.read(999)).resolves.toHaveLength(40);
  });
});
