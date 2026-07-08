import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl } from "@spine-ts/core";
import { VersionSchema, file_spine_options } from "@spine-ts/proto";
import {
  InMemoryStorageFactory,
  RecordStorage,
  StorageFactory,
  type RecordEntry,
  type RecordSpec,
  type StorageContext,
} from "@spine-ts/storage";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  Stand,
  StandStateTypeError,
  type StandSubscription,
  type StandUpdate,
} from "../../src/index.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Stand fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;

describe("Stand", () => {
  it("registers known entity state types and rejects unknown reads and subscriptions", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    stand.register(ProjectionStateSchema);
    stand.register(ProjectionStateSchema);

    expect(stand.stateTypes()).toEqual([deriveTypeUrl(ProjectionStateSchema)]);
    await expect(stand.read(AggregateStateSchema, "task-1")).rejects.toThrow(StandStateTypeError);
    expect(() => stand.subscribe(AggregateStateSchema, () => undefined)).toThrow(
      StandStateTypeError,
    );
  });

  it("records entity state updates, reads latest state, and notifies subscribers", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const updates: StandUpdate<typeof ProjectionStateSchema>[] = [];
    stand.register(ProjectionStateSchema);
    const subscription = stand.subscribe(ProjectionStateSchema, (update) => {
      updates.push(update);
    });
    const state = create(ProjectionStateSchema, {
      id: "task-1",
      name: "First",
      priority: 1,
    });

    expectTypeOf(subscription).toEqualTypeOf<StandSubscription>();
    await stand.update(ProjectionStateSchema, state, {
      version: create(VersionSchema, { number: 3 }),
    });
    state.name = "mutated outside";

    const stored = await stand.read(ProjectionStateSchema, "task-1");

    expect(stored).toEqual(
      create(ProjectionStateSchema, {
        id: "task-1",
        name: "First",
        priority: 1,
      }),
    );
    expect(stored).not.toBe(state);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe("task-1");
    expect(updates[0]?.typeUrl).toBe(deriveTypeUrl(ProjectionStateSchema));
    expect(updates[0]?.version).toEqual(create(VersionSchema, { number: 3 }));
    expect(updates[0]?.state).toEqual(stored);
    expect(updates[0]?.state).not.toBe(stored);
  });

  it("returns undefined when a known state has no stored entity", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await expect(stand.read(ProjectionStateSchema, "missing-task")).resolves.toBeUndefined();
  });

  it("reads all stored entity states with their versions in storage order", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-2", "Second"), {
      version: create(VersionSchema, { number: 2 }),
    });
    await stand.update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 1 }),
    });

    const results = await stand.readAllVersioned(ProjectionStateSchema);

    expect(results).toEqual([
      {
        state: createState("task-1", "First"),
        version: create(VersionSchema, { number: 1 }),
      },
      {
        state: createState("task-2", "Second"),
        version: create(VersionSchema, { number: 2 }),
      },
    ]);
  });

  it("returns copy-safe list read results for state and version", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });

    const results = await stand.readAllVersioned(ProjectionStateSchema);
    const first = results[0];
    if (first !== undefined) {
      first.state.name = "Mutated";
      if (first.version !== undefined) {
        first.version.number = 99;
      }
    }

    const reread = await stand.readAllVersioned(ProjectionStateSchema);

    expect(reread).toEqual([
      {
        state: createState("task-1", "First"),
        version: create(VersionSchema, { number: 7 }),
      },
    ]);
  });

  it("keeps version metadata in the Stand process-local map", async () => {
    const storageFactory = new SharedStateStorageFactory();
    const firstStand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const secondStand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    firstStand.register(ProjectionStateSchema);
    secondStand.register(ProjectionStateSchema);

    await firstStand.update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });

    await expect(firstStand.readVersioned(ProjectionStateSchema, "task-1")).resolves.toEqual({
      state: createState("task-1", "First"),
      version: create(VersionSchema, { number: 7 }),
    });
    await expect(secondStand.readVersioned(ProjectionStateSchema, "task-1")).resolves.toEqual({
      state: createState("task-1", "First"),
    });
  });

  it("rejects updates whose registered ID field is absent from the state", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema, { idField: "missingId" });

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "First")),
    ).rejects.toThrow(/requires ID field/);
  });

  it("cleans up subscribers explicitly and deterministically", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    let deliveries = 0;
    stand.register(ProjectionStateSchema);
    const subscription = stand.subscribe(ProjectionStateSchema, () => {
      deliveries += 1;
    });

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    subscription.unsubscribe();
    subscription.unsubscribe();
    await stand.update(ProjectionStateSchema, createState("task-1", "Second"));

    expect(subscription.closed).toBe(true);
    expect(deliveries).toBe(1);
  });

  it("delivers to a snapshot when subscribers mutate subscriptions during delivery", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const deliveries: string[] = [];
    const subscriptions: StandSubscription[] = [];
    let lateSubscribed = false;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, () => {
      deliveries.push("first");
      subscriptions[0]?.unsubscribe();
      if (!lateSubscribed) {
        lateSubscribed = true;
        stand.subscribe(ProjectionStateSchema, () => {
          deliveries.push("late");
        });
      }
    });
    subscriptions.push(
      stand.subscribe(ProjectionStateSchema, () => {
        deliveries.push("second");
      }),
    );

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    expect(deliveries).toEqual(["first", "second"]);

    deliveries.length = 0;
    await stand.update(ProjectionStateSchema, createState("task-1", "Second"));
    expect(deliveries).toEqual(["first", "late"]);
  });

  it("closes storage handles opened for reads and updates", async () => {
    const storageFactory = new ClosingStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    await stand.read(ProjectionStateSchema, "task-1");

    expect(storageFactory.storages).toHaveLength(2);
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
  });

  it("closes the storage handle after successful list reads", async () => {
    const storageFactory = new ClosingStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));
    await stand.readAllVersioned(ProjectionStateSchema);

    expect(storageFactory.storages).toHaveLength(2);
    expect(storageFactory.storages[1]?.isOpen()).toBe(false);
  });

  it("closes the storage handle when list reads reject", async () => {
    const storageFactory = new RejectingQueryStorageFactory();
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    stand.register(ProjectionStateSchema);

    await expect(stand.readAllVersioned(ProjectionStateSchema)).rejects.toThrow("query failed");

    expect(storageFactory.storages).toHaveLength(1);
    expect(storageFactory.storages[0]?.isOpen()).toBe(false);
  });

  it("keeps multitenant state and subscribers isolated by tenant", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: true },
      storageFactory: new InMemoryStorageFactory(),
    });
    const tenantAUpdates: string[] = [];
    const tenantBUpdates: string[] = [];
    stand.register(ProjectionStateSchema);
    stand.subscribe(
      ProjectionStateSchema,
      (update) => {
        tenantAUpdates.push(update.state.name);
      },
      { tenantId: "tenant-a" },
    );
    stand.subscribe(
      ProjectionStateSchema,
      (update) => {
        tenantBUpdates.push(update.state.name);
      },
      { tenantId: "tenant-b" },
    );

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "No Tenant")),
    ).rejects.toThrow(/tenantId/);
    await stand.update(ProjectionStateSchema, createState("task-1", "Tenant A"), {
      tenantId: "tenant-a",
    });
    await stand.update(ProjectionStateSchema, createState("task-1", "Tenant B"), {
      tenantId: "tenant-b",
    });

    await expect(
      stand.read(ProjectionStateSchema, "task-1", { tenantId: "tenant-a" }),
    ).resolves.toMatchObject({ name: "Tenant A" });
    await expect(
      stand.read(ProjectionStateSchema, "task-1", { tenantId: "tenant-b" }),
    ).resolves.toMatchObject({ name: "Tenant B" });
    expect(tenantAUpdates).toEqual(["Tenant A"]);
    expect(tenantBUpdates).toEqual(["Tenant B"]);
  });

  it("rejects tenant options for single-tenant stands", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "Tenant"), {
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow(/single-tenant/i);
    await expect(
      stand.read(ProjectionStateSchema, "task-1", { tenantId: "tenant-a" }),
    ).rejects.toThrow(/single-tenant/i);
    expect(() =>
      stand.subscribe(ProjectionStateSchema, () => undefined, { tenantId: "tenant-a" }),
    ).toThrow(/single-tenant/i);
  });

  it("returns cloned updates to each subscriber", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    let firstUpdate: StandUpdate<typeof ProjectionStateSchema> | undefined;
    let secondUpdate: StandUpdate<typeof ProjectionStateSchema> | undefined;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, (update) => {
      firstUpdate = update;
      update.state.name = "changed by first subscriber";
    });
    stand.subscribe(ProjectionStateSchema, (update) => {
      secondUpdate = update;
    });

    await stand.update(ProjectionStateSchema, createState("task-1", "First"));

    expect(firstUpdate?.state.name).toBe("changed by first subscriber");
    expect(secondUpdate?.state.name).toBe("First");
    expect(secondUpdate?.state).not.toBe(firstUpdate?.state);
    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toMatchObject({
      name: "First",
    });
  });

  it("continues delivery when subscribers throw and reports delivery failures", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    let delivered = 0;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, () => {
      throw new Error("first subscriber failed");
    });
    stand.subscribe(ProjectionStateSchema, () => {
      delivered += 1;
    });

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "First")),
    ).rejects.toThrow("first subscriber failed");
    expect(delivered).toBe(1);
    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toMatchObject({
      name: "First",
    });
  });

  it("aggregates multiple subscriber delivery failures", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, () => {
      throw new Error("first subscriber failed");
    });
    stand.subscribe(ProjectionStateSchema, () => {
      throw new Error("second subscriber failed");
    });

    await expect(
      stand.update(ProjectionStateSchema, createState("task-1", "First")),
    ).rejects.toThrow(AggregateError);
  });

  it("uses generated clone APIs for state and version payloads", async () => {
    const stand = new Stand({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const version = create(VersionSchema, { number: 7 });
    const expectedVersion = clone(VersionSchema, version);
    let observed: StandUpdate<typeof ProjectionStateSchema> | undefined;
    stand.register(ProjectionStateSchema);
    stand.subscribe(ProjectionStateSchema, (update) => {
      observed = update;
    });

    await stand.update(ProjectionStateSchema, createState("task-1", "First"), { version });
    version.number = 99;

    expect(observed?.version).toEqual(expectedVersion);
  });
});

function createState(id: string, name: string): ProjectionState {
  return create(ProjectionStateSchema, {
    id,
    name,
    priority: 1,
  });
}

class ClosingStorageFactory extends InMemoryStorageFactory {
  readonly storages: RecordStorage<unknown, Message>[] = [];

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec);
    this.storages.push(storage);
    return storage;
  }
}

class RejectingQueryStorageFactory extends ClosingStorageFactory {
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec);
    storage.query = async () => Promise.reject(new Error("query failed"));
    return storage;
  }
}

class SharedStateStorageFactory extends StorageFactory {
  readonly #records = new Map<string, { readonly id: unknown; readonly record: Message }>();

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new SharedStateStorage(context, recordSpec, this.#records);
  }
}

class SharedStateStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #records: Map<string, { readonly id: unknown; readonly record: Message }>;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    records: Map<string, { readonly id: unknown; readonly record: Message }>,
  ) {
    super(context, recordSpec);
    this.#records = records;
  }

  protected override deleteRecord(id: I): Promise<boolean> {
    return Promise.resolve(this.#records.delete(sharedIdKey(id)));
  }

  protected override queryRecordEntries(): Promise<readonly RecordEntry<I, R>[]> {
    return Promise.resolve(
      [...this.#records.values()].map((entry) => ({
        id: this.recordSpec.cloneId(entry.id as I),
        record: this.recordSpec.cloneRecord(entry.record as R),
      })),
    );
  }

  protected override readRecord(id: I): Promise<R | undefined> {
    const entry = this.#records.get(sharedIdKey(id));

    return Promise.resolve(
      entry === undefined ? undefined : this.recordSpec.cloneRecord(entry.record as R),
    );
  }

  protected override compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const current = this.#records.get(sharedIdKey(id));
    if (JSON.stringify(current?.record) !== JSON.stringify(expected?.record)) {
      return Promise.resolve(false);
    }
    if (next === undefined) {
      this.#records.delete(sharedIdKey(id));
    } else {
      this.#records.set(sharedIdKey(next.id), next);
    }

    return Promise.resolve(true);
  }

  protected override async writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    for (const record of records) {
      await this.writeRecord(record);
    }
  }

  protected override writeRecord(
    record: ReturnType<RecordSpec<I, R>["materialize"]>,
  ): Promise<void> {
    this.#records.set(sharedIdKey(record.id), record);

    return Promise.resolve();
  }
}

function sharedIdKey(id: unknown): string {
  return typeof id === "object" && id !== null ? JSON.stringify(id) : `${typeof id}:${String(id)}`;
}
