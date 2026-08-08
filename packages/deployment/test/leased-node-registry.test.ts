import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ApplicationNodeLeaseSchema,
  type ApplicationNodeLease,
} from "@spine-event-engine/proto/generated/spine/deployment/node_discovery_pb.js";
import {
  NodeIdSchema,
  type NodeId,
} from "@spine-event-engine/proto/generated/spine/server/server_environment_pb.js";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { ApplicationNode, LeasedNodeRegistry } from "../src/index.js";
import { leaseRecordSpec } from "../src/registry/leased-node-registry.js";

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

  it("allows exactly one simultaneous registration for one node ID", async () => {
    const factory = new InMemoryStorageFactory();
    const first = new LeasedNodeRegistry({ factory, namespace: "collision" });
    const second = new LeasedNodeRegistry({ factory, namespace: "collision" });
    const node = new ApplicationNode({ id: "node/collision", endpoint: "http://10.0.0.1" });

    const results = await Promise.all([
      first.register({ node, registrationId: "first", expiresAt: 100 }),
      second.register({ node, registrationId: "second", expiresAt: 100 }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("uses the approved node-discovery record family and NodeId storage identity", () => {
    expect(leaseRecordSpec.sourceType).toBe(ApplicationNodeLeaseSchema);
    expect(leaseRecordSpec.recordType).toBe(ApplicationNodeLeaseSchema);
    expect(leaseRecordSpec.idType).toBe(NodeIdSchema);
    expect(leaseRecordSpec).not.toHaveProperty("storageKey");
    expect(JSON.stringify(leaseRecordSpec)).not.toContain("encodingVersion");
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

  it("round-trips an explicit normalized HTTPS TLS authority", async () => {
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "tls",
    });
    const node = new ApplicationNode({
      id: "node/tls",
      endpoint: "https://10.0.0.1",
      tlsServerName: "Api.Example.Test",
    });

    await registry.register({ node, registrationId: "tls-process", expiresAt: 100 });
    await expect(registry.read(99)).resolves.toEqual([node]);
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

  it("reads a complete snapshot through bounded provider pages", async () => {
    const factory = new CappedQueryFactory();
    const registry = new LeasedNodeRegistry({
      factory,
      namespace: "pages",
    });
    for (let index = 0; index < 1_002; index++) {
      await registry.register({
        node: new ApplicationNode({
          id: `node/${String(index)}`,
          endpoint: `http://10.2.${String(Math.floor(index / 250))}.${String((index % 250) + 1)}`,
        }),
        registrationId: `page-${String(index)}`,
        expiresAt: 1_000,
      });
    }
    await expect(registry.read(0)).resolves.toHaveLength(1_002);
    expect(factory.limits).toEqual([256, 256, 256, 256]);
  });

  it("stops pagination when cancellation arrives between lease pages", async () => {
    const controller = new AbortController();
    const factory = new AbortBetweenPagesFactory(() => {
      controller.abort();
    });
    const registry = new LeasedNodeRegistry({ factory, namespace: "cancel-between-pages" });
    for (let index = 0; index < 257; index++) {
      await registry.register({
        node: new ApplicationNode({
          id: `node/${String(index)}`,
          endpoint: `http://10.4.0.${String((index % 250) + 1)}`,
        }),
        registrationId: `process-${String(index)}`,
        expiresAt: 1_000,
      });
    }

    await expect(registry.read(0, controller.signal)).rejects.toThrow("aborted");
    expect(factory.queries).toBe(1);
  });

  it("rejects an atomicity-free factory before accepting lease lifecycle work", () => {
    expect(
      () => new LeasedNodeRegistry({ factory: new NonAtomicFactory(), namespace: "no-atomic" }),
    ).toThrow("atomic compare-and-set");
  });

  it("rejects invalid local lease inputs and reports absent ownership", async () => {
    const factory = new InMemoryStorageFactory();
    expect(() => new LeasedNodeRegistry({ factory, namespace: " " })).toThrow("namespace");
    const registry = new LeasedNodeRegistry({ factory, namespace: "validation" });
    const node = new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1" });
    await expect(registry.renew("missing", "owner", 1)).resolves.toBe(false);
    await expect(registry.remove("missing", "owner")).resolves.toBe(false);
    await expect(registry.register({ node, registrationId: " ", expiresAt: 1 })).rejects.toThrow(
      "identity",
    );
    await expect(
      registry.register({ node, registrationId: "owner", expiresAt: -1 }),
    ).rejects.toThrow("expiry");
    await expect(registry.read(-1)).rejects.toThrow("expiry");
  });

  it("renews the current owner and distinguishes live from expired lookup", async () => {
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "renew-and-lookup",
    });
    const node = new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1" });

    await registry.register({ node, registrationId: "owner", expiresAt: 10 });
    await expect(registry.renew(node.id, "owner", 20)).resolves.toBe(true);
    await expect(registry.lookup(node.id, 19)).resolves.toMatchObject({
      registrationId: "owner",
      expiresAt: 20,
      node,
    });
    await expect(registry.lookup(node.id, 20)).resolves.toBeUndefined();
    await expect(registry.lookup("missing", 0)).resolves.toBeUndefined();
  });

  it("revalidates structurally supplied nodes before persisting a lease", async () => {
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "spoofed-node",
    });
    const node = { id: "node/a", endpoint: "http://10.0.0.1/not-an-origin" } as ApplicationNode;

    await expect(
      registry.register({ node, registrationId: "owner", expiresAt: 100 }),
    ).rejects.toThrow("endpoint");
    await expect(registry.read(0)).resolves.toEqual([]);
  });

  it("uses the validated serialized node identity as the registration slot", async () => {
    let reads = 0;
    const node = {
      get id() {
        reads += 1;
        return reads === 1 ? "node/a" : "node/b";
      },
      endpoint: "http://10.0.0.1",
      tlsServerName: undefined,
    } as ApplicationNode;
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "volatile-node-id",
    });

    await expect(
      registry.register({ node, registrationId: "owner", expiresAt: 100 }),
    ).resolves.toBe(true);
    await expect(registry.read(0)).resolves.toMatchObject([{ id: "node/a" }]);
  });

  it("rejects an invalid cleanup bound before allocating a storage handle", () => {
    const factory = new CountingFactory();

    expect(
      () => new LeasedNodeRegistry({ factory, namespace: "invalid-bound", cleanupBatchSize: 0 }),
    ).toThrow("cleanup batch size");
    expect(
      () =>
        new LeasedNodeRegistry({ factory, namespace: "oversized-bound", cleanupBatchSize: 257 }),
    ).toThrow("cleanup batch size");
    expect(factory.created).toBe(0);

    void new LeasedNodeRegistry({ factory, namespace: "maximum-bound", cleanupBatchSize: 256 });
    expect(factory.created).toBe(1);
  });

  it("preserves the supported Protobuf Timestamp millisecond boundary", async () => {
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "timestamp-boundary",
    });
    const node = new ApplicationNode({ id: "node/boundary", endpoint: "http://10.0.0.1" });

    await expect(
      registry.register({ node, registrationId: "maximum", expiresAt: 253_402_300_799_999 }),
    ).resolves.toBe(true);
    await expect(
      registry.register({
        node: new ApplicationNode({ id: "node/too-late", endpoint: "http://10.0.0.2" }),
        registrationId: "too-late",
        expiresAt: 253_402_300_800_000,
      }),
    ).rejects.toThrow("expiry");
  });

  it("fails an entire malformed snapshot without modifying its rows", async () => {
    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "invalid-row" });
    const storage = factory.createRecordStorage(
      { name: "invalid-row", multitenant: false },
      leaseRecordSpec,
    );
    await storage.write(create(ApplicationNodeLeaseSchema, { nodeId: nodeId("node/a") }));

    await expect(registry.read(0)).rejects.toThrow("invalid");
    await expect(storage.query()).resolves.toHaveLength(1);
  });

  it("fails a non-millisecond expiry snapshot without modifying its rows", async () => {
    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "unknown-version" });
    const storage = factory.createRecordStorage(
      { name: "unknown-version", multitenant: false },
      leaseRecordSpec,
    );
    await storage.write(leaseRecord("node/a", 1));

    await expect(registry.read(0)).rejects.toThrow("invalid");
    await expect(storage.query()).resolves.toHaveLength(1);
  });

  it("rejects missing node IDs and invalid or unrepresentable persisted values", async () => {
    expect(() => leaseRecordSpec.idValueIn(create(ApplicationNodeLeaseSchema))).toThrow("node ID");

    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "invalid-values" });
    const storage = factory.createRecordStorage(
      { name: "invalid-values", multitenant: false },
      leaseRecordSpec,
    );
    await storage.write(
      create(ApplicationNodeLeaseSchema, {
        nodeId: nodeId("invalid-endpoint"),
        endpoint: { origin: "http://10.0.0.1/not-an-origin" },
        whenExpires: create(TimestampSchema, { seconds: 0n, nanos: 100_000_000 }),
        registrationId: { value: "process" },
      }),
    );

    await expect(registry.read(0)).rejects.toThrow("invalid");
    await storage.delete(nodeId("invalid-endpoint"));
    await storage.write(
      create(ApplicationNodeLeaseSchema, {
        nodeId: nodeId("large-time"),
        endpoint: { origin: "http://10.0.0.1" },
        whenExpires: create(TimestampSchema, { seconds: BigInt(Number.MAX_SAFE_INTEGER) }),
        registrationId: { value: "process" },
      }),
    );
    await expect(registry.read(0)).rejects.toThrow("invalid");
  });

  it("rejects an out-of-range persisted Protobuf Timestamp without rewriting it", async () => {
    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "timestamp-overflow" });
    const storage = factory.createRecordStorage(
      { name: "timestamp-overflow", multitenant: false },
      leaseRecordSpec,
    );
    await storage.write(
      create(ApplicationNodeLeaseSchema, {
        nodeId: nodeId("node/too-late"),
        endpoint: { origin: "http://10.0.0.1" },
        whenExpires: create(TimestampSchema, { seconds: 253_402_300_800n }),
        registrationId: { value: "process" },
      }),
    );

    await expect(registry.read(0)).rejects.toThrow("invalid");
    await expect(storage.query()).resolves.toHaveLength(1);
  });

  it("fails a snapshot row whose embedded node ID differs from its storage slot", async () => {
    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "wrong-slot" });
    const storage = factory.createRecordStorage(
      { name: "wrong-slot", multitenant: false },
      leaseRecordSpec,
    );
    await storage.compareAndSet(nodeId("node/a"), undefined, leaseRecord("node/b"));

    await expect(registry.read(0)).rejects.toThrow("invalid");
    await expect(storage.read(nodeId("node/a"))).resolves.toBeDefined();
  });

  it("returns false when a compare-and-set renewal loses its race", async () => {
    const factory = new InMemoryStorageFactory();
    const registry = new LeasedNodeRegistry({ factory, namespace: "lost-renewal" });
    const node = new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1" });
    await registry.register({ node, registrationId: "owner", expiresAt: 10 });
    const storage = factory.createRecordStorage(
      { name: "lost-renewal", multitenant: false },
      leaseRecordSpec,
    );
    const current = await storage.read(nodeId("node/a"));
    await storage.compareAndSet(nodeId("node/a"), current, leaseRecord("node/a"));
    await expect(registry.renew("node/a", "owner", 20)).resolves.toBe(false);
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

  it("advances past a live prefix to clean later expired rows", async () => {
    const registry = new LeasedNodeRegistry({
      factory: new InMemoryStorageFactory(),
      namespace: "cleanup-prefix",
      cleanupBatchSize: 2,
    });
    for (const [id, expiresAt] of [
      ["a-live", 100],
      ["b-live", 100],
      ["z-expired", 0],
    ] as const) {
      await registry.register({
        node: new ApplicationNode({
          id,
          endpoint: `http://10.3.0.${id.endsWith("a") ? "1" : "2"}`,
        }),
        registrationId: id,
        expiresAt,
      });
    }
    await expect(registry.cleanup(1)).resolves.toBe(0);
    await expect(registry.cleanup(1)).resolves.toBe(1);
    await expect(registry.read(1)).resolves.toHaveLength(2);
  });

  it("joins an in-flight operation before closing and rejects later work", async () => {
    const factory = new DelayedQueryFactory();
    const registry = new LeasedNodeRegistry({
      factory,
      namespace: "closed",
    });
    const reading = registry.read(0);
    await Promise.resolve();
    const closing = registry.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    expect(closed).toBe(false);
    await expect(registry.read(0)).rejects.toThrow("closed");
    factory.resolveQuery();
    await reading;
    await closing;
    expect(factory.storage?.isOpen()).toBe(false);
    await expect(registry.read(0)).rejects.toThrow("closed");
  });
});

function nodeId(value: string): NodeId {
  return create(NodeIdSchema, { value });
}

function leaseRecord(node: string, nanos = 0): ApplicationNodeLease {
  return create(ApplicationNodeLeaseSchema, {
    nodeId: nodeId(node),
    endpoint: { origin: "http://10.0.0.1" },
    whenExpires: create(TimestampSchema, { seconds: 0n, nanos: 100_000_000 + nanos }),
    registrationId: { value: "process" },
  });
}

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

class CountingFactory extends InMemoryStorageFactory {
  created = 0;

  override createRecordStorage<I, R extends import("@bufbuild/protobuf").Message>(
    context: import("@spine-event-engine/storage").StorageContext,
    recordSpec: import("@spine-event-engine/storage").RecordSpec<I, R>,
  ): import("@spine-event-engine/storage").RecordStorage<I, R> {
    this.created++;
    return super.createRecordStorage(context, recordSpec);
  }
}

class CappedQueryFactory extends InMemoryStorageFactory {
  readonly limits: number[] = [];

  override createRecordStorage<I, R extends import("@bufbuild/protobuf").Message>(
    context: import("@spine-event-engine/storage").StorageContext,
    recordSpec: import("@spine-event-engine/storage").RecordSpec<I, R>,
  ): import("@spine-event-engine/storage").RecordStorage<I, R> {
    const storage = super.createRecordStorage(context, recordSpec);
    const queryEntries = storage.queryEntries.bind(storage);
    Object.defineProperty(storage, "queryEntries", {
      value: async (query: import("@spine-event-engine/storage").RecordQuery<I>) => {
        if (query.limit === undefined || query.limit > 256)
          throw new Error("Provider requires a bounded page.");
        this.limits.push(query.limit);
        return queryEntries(query);
      },
    });
    return storage;
  }
}

class DelayedQueryFactory extends InMemoryStorageFactory {
  storage:
    import("@spine-event-engine/storage").RecordStorage<NodeId, ApplicationNodeLease> | undefined;
  #resolve: (() => void) | undefined;

  override createRecordStorage<I, R extends import("@bufbuild/protobuf").Message>(
    context: import("@spine-event-engine/storage").StorageContext,
    recordSpec: import("@spine-event-engine/storage").RecordSpec<I, R>,
  ): import("@spine-event-engine/storage").RecordStorage<I, R> {
    const storage = super.createRecordStorage(context, recordSpec);
    if (this.storage === undefined) {
      this.storage = storage as unknown as typeof this.storage;
      const queryEntries = storage.queryEntries.bind(storage);
      Object.defineProperty(storage, "queryEntries", {
        value: (query: import("@spine-event-engine/storage").RecordQuery<I>) =>
          new Promise<void>((resolve) => (this.#resolve = resolve)).then(() => queryEntries(query)),
      });
    }
    return storage;
  }

  resolveQuery(): void {
    this.#resolve?.();
  }
}

class AbortBetweenPagesFactory extends InMemoryStorageFactory {
  queries = 0;

  constructor(private readonly abortAfterFirstPage: () => void) {
    super();
  }

  override createRecordStorage<I, R extends import("@bufbuild/protobuf").Message>(
    context: import("@spine-event-engine/storage").StorageContext,
    recordSpec: import("@spine-event-engine/storage").RecordSpec<I, R>,
  ): import("@spine-event-engine/storage").RecordStorage<I, R> {
    const storage = super.createRecordStorage(context, recordSpec);
    const queryEntries = storage.queryEntries.bind(storage);
    Object.defineProperty(storage, "queryEntries", {
      value: async (query: import("@spine-event-engine/storage").RecordQuery<I>) => {
        const page = await queryEntries(query);
        this.queries += 1;
        if (this.queries === 1) this.abortAfterFirstPage();
        return page;
      },
    });
    return storage;
  }
}
