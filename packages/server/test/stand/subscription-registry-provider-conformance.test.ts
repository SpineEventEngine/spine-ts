import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  type Subscription,
  type SubscriptionId,
} from "@spine-event-engine/proto/client";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";
import {
  InMemoryStorageFactory,
  RecordSpec,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StandCapacityError,
  StorageSubscriptionRegistry,
  type StandSubscriptionRegistry,
} from "../../src/index.js";

const provider = process.env.STAND_REGISTRY_PROVIDER ?? "memory";
const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
const datastoreHost = process.env.DATASTORE_EMULATOR_HOST;
const datastoreProject = process.env.DATASTORE_PROJECT_ID ?? "spine-t0108";
let sequence = 0;

interface RegistryFixture {
  readonly name: string;
  readonly factory: StorageFactory;
  readonly context: StorageContext;
  registry(limit?: number): StorageSubscriptionRegistry;
  dispose(): Promise<void>;
}

function id(value: string): SubscriptionId {
  return create(SubscriptionIdSchema, { value });
}

function subscription(value: string, topic = "topic"): Subscription {
  return create(SubscriptionSchema, { id: id(value), topic: { id: { value: topic } } });
}

async function createFixture(): Promise<RegistryFixture> {
  sequence += 1;
  const name = `T0108Provider${provider}${String(process.pid)}${String(sequence)}`;
  const context = { name, multitenant: false };
  const factory = await providerFactory();
  const registries = new Set<StorageSubscriptionRegistry>();
  const registry = (limit?: number): StorageSubscriptionRegistry => {
    const created = new StorageSubscriptionRegistry(context, factory, limit);
    registries.add(created);
    return created;
  };
  return {
    name,
    factory,
    context,
    registry,
    async dispose(): Promise<void> {
      try {
        const cleaner = registry();
        for (const entry of await cleaner.snapshot())
          await cleaner.delete(requiredId(entry.subscription), entry.revision);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("closed")) throw error;
        const cleaner = registry();
        for (const entry of await cleaner.snapshot())
          await cleaner.delete(requiredId(entry.subscription), entry.revision);
      } finally {
        await Promise.all([...registries].map(async (value) => await value.close()));
        await closeFactory(factory);
      }
    },
  };
}

async function closeFactory(factory: StorageFactory): Promise<void> {
  const closable: { close(): void | Promise<void> } = factory;
  await closable.close();
}

function requiredId(value: Subscription): SubscriptionId {
  if (value.id === undefined) throw new Error("Expected a subscription ID.");
  return value.id;
}

async function providerFactory(): Promise<StorageFactory> {
  switch (provider) {
    case "memory":
      return new InMemoryStorageFactory();
    case "mysql":
      if (mysqlUrl === undefined)
        throw new Error("SPINE_TS_MYSQL_URL is required for MySQL conformance.");
      return await MysqlStorageFactory.create({ url: mysqlUrl });
    case "datastore":
      if (datastoreHost === undefined)
        throw new Error("DATASTORE_EMULATOR_HOST is required for Datastore conformance.");
      return DatastoreStorageFactory.create({ projectId: datastoreProject });
    default:
      throw new Error(`Unknown Stand registry provider: ${provider}.`);
  }
}

describe(`StorageSubscriptionRegistry ${provider} conformance`, () => {
  let fixture: RegistryFixture;
  let registry: StandSubscriptionRegistry;

  beforeEach(async () => {
    fixture = await createFixture();
    registry = fixture.registry();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fixture.dispose();
  });

  it("is persistent and creates, reads, snapshots, and activates a pending definition", async () => {
    expect(registry.persistent).toBe(true);
    await expect(registry.create(subscription("one"))).resolves.toMatchObject({
      kind: "created",
      entry: { phase: "pending", revision: 1n },
    });
    await expect(registry.get(id("one"))).resolves.toMatchObject({ phase: "pending" });
    await expect(registry.snapshot()).resolves.toMatchObject([
      { subscription: { id: { value: "one" } }, phase: "pending" },
    ]);
    await expect(registry.activate(id("one"))).resolves.toMatchObject({
      kind: "activated",
      entry: { phase: "active", revision: 2n },
    });
  });

  it("uses an atomic compare-and-set provider", () => {
    const storage = fixture.factory.createRecordStorage(
      fixture.context,
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "spine.server.T0108ProviderCapability",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    expect(storage.atomicCompareAndSet).toBe(true);
    storage.close();
  });

  it("physically deletes a definition and permits same-ID recreation", async () => {
    const created = await registry.create(subscription("reusable"));
    if (created.kind !== "created") throw new Error("Expected a new definition.");
    await expect(registry.delete(id("reusable"), created.entry.revision)).resolves.toBe("deleted");
    await expect(registry.get(id("reusable"))).resolves.toBeUndefined();
    await expect(registry.create(subscription("reusable", "replacement"))).resolves.toMatchObject({
      kind: "created",
      entry: { revision: 1n },
    });
  });

  it("expires pending definitions, cleans them up, and releases capacity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    registry = fixture.registry(1);
    await registry.create(subscription("expired"));
    vi.setSystemTime(1_030_000);
    await expect(registry.cleanup()).resolves.toEqual({ scanned: 1, deleted: 1, more: false });
    await expect(registry.create(subscription("replacement"))).resolves.toMatchObject({
      kind: "created",
    });
  });

  it("rejects capacity above the configured limit and invalid public revisions", async () => {
    expect(() => fixture.registry(101)).toThrow(RangeError);
    registry = fixture.registry(1);
    await registry.create(subscription("one"));
    await expect(registry.create(subscription("two"))).rejects.toBeInstanceOf(StandCapacityError);
    await expect(
      registry.create(create(SubscriptionSchema, { id: id("missing-topic") })),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(registry.delete(id("one"), -1n)).rejects.toBeInstanceOf(RangeError);
    await expect(registry.activate(id(" "))).rejects.toBeInstanceOf(TypeError);
  });

  it("admits one concurrent create and leaves capacity recoverable", async () => {
    const first = fixture.registry(1);
    const second = fixture.registry(1);
    registry = first;
    const results = await Promise.allSettled([
      first.create(subscription("first")),
      second.create(subscription("second")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const admitted = await first.snapshot();
    expect(admitted).toHaveLength(1);
    const entry = admitted[0];
    if (entry === undefined) throw new Error("Expected an admitted definition.");
    await expect(first.delete(requiredId(entry.subscription), entry.revision)).resolves.toBe(
      "deleted",
    );
    await expect(second.create(subscription("recovered"))).resolves.toMatchObject({
      kind: "created",
    });
    await second.close();
  });

  it("closes permanently after admitted work settles", async () => {
    await registry.create(subscription("one"));
    await registry.close();
    await expect(registry.create(subscription("after-close"))).rejects.toThrow("closed");
    await expect(registry.snapshot()).rejects.toThrow("closed");
  });
});
