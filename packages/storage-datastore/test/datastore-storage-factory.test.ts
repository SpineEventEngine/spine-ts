import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory } from "../src/index.js";

describe("DatastoreStorageFactory", () => {
  it("constructs an explicitly configured client without selecting credentials itself", () => {
    const factory = DatastoreStorageFactory.create({ projectId: "spine-ts-adapter-test" });

    expect(factory.isOpen()).toBe(true);
  });

  it("is selected through the StorageFactory port and creates independent handles", () => {
    const factory = new DatastoreStorageFactory({ client: {} as never });
    const spec = new RecordSpec({
      schema: StringValueSchema,
      extractId: (record) => record.value,
    });
    const context = { name: "Tasks", multitenant: false };

    const first = factory.createRecordStorage(context, spec);
    const second = factory.createRecordStorage(context, spec);

    first.close();

    expect(first.isOpen()).toBe(false);
    expect(second.isOpen()).toBe(true);
    expect(factory.isOpen()).toBe(true);
  });

  it("writes and reads canonical protobuf records through its injected client", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
      }),
    );

    await storage.write(create(StringValueSchema, { value: "task-1" }));

    await expect(storage.read("task-1")).resolves.toEqual(
      create(StringValueSchema, { value: "task-1" }),
    );
    expect(client.saved).toHaveLength(1);
    expect(client.saved[0]?.data["$spine.payload"]).toBeInstanceOf(Uint8Array);
  });

  it("deletes a record through its injected client", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
      }),
    );

    await storage.write(create(StringValueSchema, { value: "task-1" }));

    await expect(storage.delete("task-1")).resolves.toBe(true);
    await expect(storage.read("task-1")).resolves.toBeUndefined();
  });

  it("writes all records through one injected-client mutation", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
      }),
    );

    await storage.writeAll([
      create(StringValueSchema, { value: "task-1" }),
      create(StringValueSchema, { value: "task-2" }),
    ]);

    await expect(storage.read("task-1")).resolves.toEqual(
      create(StringValueSchema, { value: "task-1" }),
    );
    await expect(storage.read("task-2")).resolves.toEqual(
      create(StringValueSchema, { value: "task-2" }),
    );
    expect(client.saveCalls).toBe(1);
  });

  it("splits writeAll into bounded injected-client mutations", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
      }),
    );

    await storage.writeAll(
      Array.from({ length: 501 }, (_, index) =>
        create(StringValueSchema, { value: `task-${String(index)}` }),
      ),
    );

    expect(client.saveCalls).toBe(2);
    await expect(storage.read("task-500")).resolves.toEqual(
      create(StringValueSchema, { value: "task-500" }),
    );
  });

  it("queries storage slots by IDs and column equality in stable continued order", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
        columns: [new RecordColumn<StringValue>("group", (record) => record.value.slice(0, 1))],
      }),
    );

    await storage.writeAll([
      create(StringValueSchema, { value: "a-2" }),
      create(StringValueSchema, { value: "a-1" }),
      create(StringValueSchema, { value: "b-1" }),
    ]);

    await expect(
      storage.queryEntries({
        ids: ["a-1", "a-2"],
        filters: [{ column: "group", value: "a" }],
        sort: [{ field: "group" }],
        limit: 1,
      }),
    ).resolves.toMatchObject([{ id: "a-1", record: { value: "a-1" } }]);

    await expect(
      storage.queryEntries({
        filters: [{ column: "group", value: ["a"] }],
        sort: [{ field: "group" }],
        after: { values: [{ field: "group", value: "a" }], id: "a-1" },
        limit: 1,
      }),
    ).resolves.toMatchObject([{ id: "a-2", record: { value: "a-2" } }]);
  });

  it("atomically creates, replaces, deletes, and rejects stale compare-and-set values", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value.slice(0, 1),
      }),
    );
    const created = create(StringValueSchema, { value: "a:first" });
    const replaced = create(StringValueSchema, { value: "a:second" });

    await expect(storage.compareAndSet("a", undefined, created)).resolves.toBe(true);
    await expect(storage.compareAndSet("a", undefined, replaced)).resolves.toBe(false);
    await expect(storage.compareAndSet("a", created, replaced)).resolves.toBe(true);
    await expect(storage.compareAndSet("a", created, undefined)).resolves.toBe(false);
    await expect(storage.compareAndSet("a", replaced, undefined)).resolves.toBe(true);
    await expect(storage.read("a")).resolves.toBeUndefined();
  });

  it("redacts malformed entity payloads behind one decoding error", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );

    client.putRaw("Tasks:google.protobuf.StringValue", "task-1", {
      "$spine.id": JSON.stringify("task-1"),
      "$spine.payload": "credential=top-secret payload=do-not-disclose",
    });

    await expect(storage.read("task-1")).rejects.toThrow("Datastore entity cannot be decoded.");
    await expect(storage.read("task-1")).rejects.not.toThrow("top-secret");
    await expect(storage.read("task-1")).rejects.not.toThrow("do-not-disclose");
  });
});

class MemoryDatastoreClient {
  readonly KEY = Symbol("key");
  readonly saved: { key: MemoryKey; data: Record<string, unknown> }[] = [];
  saveCalls = 0;
  readonly entities = new Map<string, Record<string, unknown>>();

  key(input: { namespace?: string; path: readonly [string, string] }): MemoryKey {
    return { namespace: input.namespace, path: [...input.path] as [string, string] };
  }

  putRaw(kind: string, id: string, data: Record<string, unknown>): void {
    this.entities.set(keyString({ path: [kind, JSON.stringify(id)] }), data);
  }

  get(key: MemoryKey): Promise<[Record<string | symbol, unknown> | undefined]> {
    const entity = this.entities.get(keyString(key));
    return Promise.resolve(entity === undefined ? [undefined] : [{ ...entity, [this.KEY]: key }]);
  }

  save(
    input:
      | { key: MemoryKey; data: Record<string, unknown> }
      | readonly { key: MemoryKey; data: Record<string, unknown> }[],
  ): Promise<[]> {
    this.saveCalls += 1;
    const entities = "key" in input ? [input] : input;

    for (const entity of entities) {
      this.saved.push(entity);
      this.entities.set(keyString(entity.key), { ...entity.data });
    }
    return Promise.resolve([]);
  }

  delete(key: MemoryKey): Promise<[]> {
    this.entities.delete(keyString(key));
    return Promise.resolve([]);
  }

  createQuery(): MemoryQuery {
    return new MemoryQuery();
  }

  runQuery(): Promise<[Record<string | symbol, unknown>[]]> {
    return Promise.resolve([
      [...this.entities.entries()].map(([serializedKey, entity]) => ({
        ...entity,
        [this.KEY]: JSON.parse(serializedKey) as unknown as MemoryKey,
      })),
    ]);
  }

  transaction(): MemoryTransaction {
    return new MemoryTransaction(this);
  }
}

class MemoryQuery {
  filter(): this {
    return this;
  }

  order(): this {
    return this;
  }
}

class MemoryTransaction {
  readonly #writes: { key: MemoryKey; data: Record<string, unknown> }[] = [];
  readonly #deletes: MemoryKey[] = [];

  constructor(private readonly client: MemoryDatastoreClient) {}

  run(): Promise<[]> {
    return Promise.resolve([]);
  }

  get(key: MemoryKey): Promise<[Record<string | symbol, unknown> | undefined]> {
    return this.client.get(key);
  }

  save(entity: { key: MemoryKey; data: Record<string, unknown> }): void {
    this.#writes.push(entity);
  }

  delete(key: MemoryKey): void {
    this.#deletes.push(key);
  }

  commit(): Promise<[]> {
    for (const key of this.#deletes) this.client.entities.delete(keyString(key));
    for (const entity of this.#writes)
      this.client.entities.set(keyString(entity.key), { ...entity.data });
    return Promise.resolve([]);
  }

  rollback(): Promise<[]> {
    return Promise.resolve([]);
  }
}

interface MemoryKey {
  readonly namespace?: string;
  readonly path: [string, string];
}

function keyString(key: MemoryKey): string {
  return JSON.stringify([key.namespace, ...key.path]);
}
