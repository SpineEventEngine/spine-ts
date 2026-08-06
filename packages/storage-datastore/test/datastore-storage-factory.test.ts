import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import { DatastoreStorageFactory } from "../src/index.js";
import { CanonicalValue } from "../src/datastore/value-codec.js";
import { assertQueryProviderConformance } from "../../storage/test/query/query-provider-conformance.js";

describe("DatastoreStorageFactory", () => {
  it("conforms to the shared normalized query provider fixture", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "QueryConformance", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>(
            "group",
            (record) => record.value.slice(0, 1),
            "string",
          ),
        ],
      }),
    );

    await assertQueryProviderConformance({
      name: "datastore",
      storage,
      providerCalls: () => client.runQueryCalls,
    });
  });
  it("constructs an explicitly configured client without selecting credentials itself", () => {
    const factory = DatastoreStorageFactory.create({ projectId: "spine-ts-adapter-test" });

    expect(factory.isOpen()).toBe(true);
  });

  it("is selected through the StorageFactory port and creates independent handles", () => {
    const factory = new DatastoreStorageFactory({ client: {} as never });
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
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

  it("keeps injected-client ownership external and guards factory and handle operations after close", async () => {
    const client = new MemoryDatastoreClient();
    let clientCloseCalls = 0;
    Object.assign(client, { close: () => (clientCloseCalls += 1) });
    const factory = new DatastoreStorageFactory({ client: client as never });
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record) => record.value,
    });
    const first = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const second = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);

    first.close();
    await expect(first.read("closed")).rejects.toThrow("RecordStorage is closed");
    await second.write(create(StringValueSchema, { value: "open" }));
    factory.close();

    expect(() => factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec)).toThrow(
      "StorageFactory is closed",
    );
    await expect(second.read("open")).resolves.toBeDefined();
    expect(clientCloseCalls).toBe(0);
  });

  it("writes and reads canonical protobuf records through its injected client", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
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
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    await storage.write(create(StringValueSchema, { value: "task-1" }));

    await expect(storage.delete("task-1")).resolves.toBe(true);
    await expect(storage.read("task-1")).resolves.toBeUndefined();
    await expect(storage.delete("task-1")).resolves.toBe(false);
  });

  it("uses tenant namespaces and rejects missing tenants or non-queryable columns", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const tenantStorage = factory.createRecordStorage(
      { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const missingTenantStorage = factory.createRecordStorage(
      { name: "Tasks", multitenant: true },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const unsupportedColumnStorage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue>(
            "unsupported",
            () => ({ value: "not-indexable" }),
            "object",
          ),
        ],
      }),
    );

    await tenantStorage.write(create(StringValueSchema, { value: "task-1" }));
    expect(client.saved[0]?.key.namespace).toBe("tenant-a");
    await expect(
      missingTenantStorage.write(create(StringValueSchema, { value: "task-2" })),
    ).rejects.toThrow("requires context.tenantId");
    await expect(
      unsupportedColumnStorage.write(create(StringValueSchema, { value: "task-3" })),
    ).rejects.toThrow('column "unsupported" has an unsupported value');
  });

  it("writes all records through one injected-client mutation", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
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
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
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

  it("stops writeAll after a second-group failure without retrying the failed or later group", async () => {
    const client = new MemoryDatastoreClient();
    client.failSaveCall = 2;
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    await expect(
      storage.writeAll(
        Array.from({ length: 1_001 }, (_, index) =>
          create(StringValueSchema, { value: `task-${String(index)}` }),
        ),
      ),
    ).rejects.toThrow("save group failed");

    expect(client.saveCalls).toBe(2);
    await expect(storage.read("task-499")).resolves.toBeDefined();
    await expect(storage.read("task-500")).resolves.toBeUndefined();
    await expect(storage.read("task-1000")).resolves.toBeUndefined();
  });

  it("queries storage slots by IDs and column equality in stable continued order", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue>("group", (record) => record.value.slice(0, 1), "string"),
        ],
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

  it("translates descending, offset, and invalid query-filter paths", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await storage.writeAll([
      create(StringValueSchema, { value: "a" }),
      create(StringValueSchema, { value: "b" }),
      create(StringValueSchema, { value: "c" }),
    ]);

    await expect(
      storage.queryEntries({ sort: [{ field: "id", direction: "desc" }], offset: 1, limit: 1 }),
    ).resolves.toMatchObject([{ id: "b" }]);
    await expect(
      storage.queryEntries({ filters: [{ column: "unsupported", value: { invalid: true } }] }),
    ).rejects.toThrow('filter "unsupported" has an unsupported value');
  });

  it("uses one reversible canonical codec for copied structured storage slots", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record) => ({ label: record.value, optional: undefined, sequence: 7n }),
    });
    const first = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const second = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const copiedSlot = { sequence: 7n, optional: undefined, label: "task-1" };

    await first.write(create(StringValueSchema, { value: "task-1" }));

    await expect(second.read(copiedSlot)).resolves.toMatchObject({ value: "task-1" });
    await expect(second.queryEntries({ ids: [copiedSlot] })).resolves.toMatchObject([
      { id: copiedSlot, record: { value: "task-1" } },
    ]);
    await expect(
      second.queryEntries({ filters: [{ column: "id", value: copiedSlot }] }),
    ).resolves.toMatchObject([{ id: copiedSlot, record: { value: "task-1" } }]);
    expect(client.saved[0]?.key.path[1]).not.toContain("[object Object]");
  });

  it("round-trips every supported storage-slot kind through independent handles", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const ids = new Map<string, unknown>([
      ["undefined", undefined],
      ["null", null],
      ["false", false],
      ["true", true],
      ["zero", 0],
      ["nan", Number.NaN],
      ["positive-infinity", Number.POSITIVE_INFINITY],
      ["negative-infinity", Number.NEGATIVE_INFINITY],
      ["string", "slot"],
      ["bigint", 9n],
      ["bytes", new Uint8Array([0, 255])],
      ["array", ["slot", 1]],
      ["object", { second: 2, first: 1 }],
    ]);
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record) => ids.get(record.value),
    });
    const first = factory.createRecordStorage({ name: "Kinds", multitenant: false }, spec);
    const second = factory.createRecordStorage({ name: "Kinds", multitenant: false }, spec);
    const records = [...ids.keys()].map((value) => create(StringValueSchema, { value }));

    await first.writeAll(records);

    for (const record of records) {
      await expect(second.read(ids.get(record.value))).resolves.toEqual(record);
    }
    await expect(second.queryEntries({ sort: [{ field: "id" }] })).resolves.toHaveLength(ids.size);
  });

  it("keeps tagged primitives distinct from sentinel-shaped objects and preserves __proto__", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const protoSlot = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(protoSlot, "__proto__", { value: "own-value", enumerable: true });
    const ids: Record<string, unknown> = {
      bigint: 7n,
      bigintObject: { kind: "bigint", value: "7" },
      bytes: new Uint8Array([7]),
      bytesObject: { kind: "bytes", value: [7] },
      proto: protoSlot,
    };
    const storage = factory.createRecordStorage(
      { name: "Canonical", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => ids[record.value],
      }),
    );

    await storage.writeAll(Object.keys(ids).map((value) => create(StringValueSchema, { value })));

    expect(new Set(client.saved.map((entry) => entry.key.path[1]))).toHaveLength(5);
    const entries = await storage.queryEntries({ sort: [{ field: "id" }] });
    const returnedProto = entries.find((entry) => entry.record.value === "proto")?.id;
    expect(Object.prototype.hasOwnProperty.call(returnedProto, "__proto__")).toBe(true);
    expect(Reflect.get(returnedProto as object, "__proto__")).toBe("own-value");
  });

  it("preserves typed values for equality, numeric ordering, and indexed bigint bounds", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "number",
        extractId: (record) => Number(record.value),
        columns: [
          new RecordColumn<StringValue>("number", (record) => Number(record.value), "number"),
          new RecordColumn<StringValue>(
            "indexedBigint",
            (record) => BigInt(record.value),
            "bigint",
          ),
        ],
      }),
    );

    await storage.writeAll([
      create(StringValueSchema, { value: "10" }),
      create(StringValueSchema, { value: "2" }),
    ]);

    expect(isDatastoreInt(client.saved[0]?.data["$spine.column.indexedBigint"])).toBe(true);
    expect(client.saved[0]?.data["$spine.columnType.indexedBigint"]).toBe("bigint");
    expect(client.saved[0]?.excludeFromIndexes).toContain("$spine.columnType.indexedBigint");

    await expect(
      storage.queryEntries({
        filters: [{ column: "number", value: 2 }],
        sort: [{ field: "number" }],
      }),
    ).resolves.toMatchObject([{ id: 2 }]);
    await expect(storage.queryEntries({ sort: [{ field: "number" }] })).resolves.toMatchObject([
      { id: 2 },
      { id: 10 },
    ]);
    await expect(
      storage.queryEntries({ filters: [{ column: "indexedBigint", value: 2n }] }),
    ).resolves.toMatchObject([{ id: 2 }]);
    expect(isDatastoreInt(client.lastQuery?.filters.at(-1)?.[2])).toBe(true);
    await expect(
      storage.queryEntries({ sort: [{ field: "indexedBigint" }] }),
    ).resolves.toMatchObject([{ id: 2 }, { id: 10 }]);
    await expect(
      storage.queryEntries({
        sort: [{ field: "indexedBigint" }],
        after: { values: [{ field: "indexedBigint", value: 2n }], id: 2 },
        limit: 1,
      }),
    ).resolves.toMatchObject([{ id: 10 }]);

    const outOfRange = factory.createRecordStorage(
      { name: "Overflow", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [new RecordColumn<StringValue>("indexedBigint", () => 1n << 63n, "bigint")],
      }),
    );
    const savesBeforeOverflow = client.saveCalls;
    await expect(outOfRange.write(create(StringValueSchema, { value: "bad" }))).rejects.toThrow(
      "signed 64-bit",
    );
    expect(client.saveCalls).toBe(savesBeforeOverflow);
  });

  it("requests wrapped provider integers for signed-64 bigint reads, queries, and CAS", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const minimum = -(1n << 63n);
    const maximum = (1n << 63n) - 1n;
    const unsafeNumber = Number.MAX_SAFE_INTEGER + 1;
    const values = new Map([
      ["minimum", minimum],
      ["maximum", maximum],
    ]);
    const numbers = new Map([
      ["minimum", unsafeNumber],
      ["maximum", unsafeNumber + 2],
    ]);
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record) => record.value,
      columns: [
        new RecordColumn<StringValue>(
          "integer",
          (record) => values.get(record.value) ?? 0n,
          "bigint",
        ),
        new RecordColumn<StringValue>(
          "number",
          (record) => numbers.get(record.value) ?? 0,
          "number",
        ),
      ],
    });
    const storage = factory.createRecordStorage({ name: "Boundaries", multitenant: false }, spec);
    const minimumRecord = create(StringValueSchema, { value: "minimum" });
    const maximumRecord = create(StringValueSchema, { value: "maximum" });
    await storage.writeAll([minimumRecord, maximumRecord]);

    await expect(storage.read("minimum")).resolves.toEqual(minimumRecord);
    expect(client.lastGetOptions).toEqual({ wrapNumbers: true });
    await expect(
      storage.queryEntries({
        filters: [{ column: "integer", value: minimum }],
        sort: [{ field: "integer" }],
      }),
    ).resolves.toMatchObject([{ id: "minimum" }]);
    expect(client.lastRunQueryOptions).toEqual({ wrapNumbers: true });
    await expect(
      storage.queryEntries({ filters: [{ column: "number", value: unsafeNumber }] }),
    ).resolves.toMatchObject([{ id: "minimum" }]);
    await expect(storage.queryEntries({ sort: [{ field: "number" }] })).resolves.toMatchObject([
      { id: "minimum" },
      { id: "maximum" },
    ]);
    expect(isDatastoreDouble(client.saved[0]?.data["$spine.column.number"])).toBe(true);
    await expect(storage.queryEntries({ sort: [{ field: "integer" }] })).resolves.toMatchObject([
      { id: "minimum" },
      { id: "maximum" },
    ]);
    await expect(storage.compareAndSet("maximum", maximumRecord, undefined)).resolves.toBe(true);
    expect(client.lastTransactionGetOptions).toEqual({ wrapNumbers: true });
  });

  it("rejects non-finite indexed numbers and filters before provider calls", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Finite", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [new RecordColumn<StringValue>("number", () => Number.NaN, "number")],
      }),
    );

    await expect(storage.write(create(StringValueSchema, { value: "nan" }))).rejects.toThrow(
      "finite",
    );
    expect(client.saveCalls).toBe(0);
    await expect(
      storage.queryEntries({ filters: [{ column: "number", value: Number.POSITIVE_INFINITY }] }),
    ).rejects.toThrow("finite");
    expect(client.runQueryCalls).toBe(0);
  });

  it("reconciles typed ID order before applying offset and limit exactly once", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "TypedIds", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => Number(record.value),
      }),
    );
    await storage.writeAll([
      create(StringValueSchema, { value: "10" }),
      create(StringValueSchema, { value: "2" }),
      create(StringValueSchema, { value: "3" }),
    ]);

    await expect(
      storage.queryEntries({ sort: [{ field: "id" }], offset: 1, limit: 1 }),
    ).resolves.toMatchObject([{ id: 3 }]);
    await expect(
      storage.queryEntries({
        sort: [{ field: "id" }],
        after: { values: [{ field: "id", value: 2 }], id: 2 },
        limit: 1,
      }),
    ).resolves.toMatchObject([{ id: 3 }]);
    expect(client.lastQuery?.offsetValue).toBeUndefined();
    expect(client.lastQuery?.limitValue).toBe(1_001);
  });

  it("pushes provider query bounds and rejects client-side scans beyond its finite budget", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never, maxClientSideScan: 1 });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await storage.writeAll([
      create(StringValueSchema, { value: "a" }),
      create(StringValueSchema, { value: "b" }),
    ]);

    await expect(storage.queryEntries({})).rejects.toThrow(
      "Datastore query exceeded the client-side scan limit of 1",
    );
    await expect(
      storage.queryEntries({ sort: [{ field: "id" }], limit: 1 }),
    ).resolves.toMatchObject([{ id: "a" }]);
    expect(client.lastQuery?.limitValue).toBe(1);
    await expect(
      storage.queryEntries({
        sort: [{ field: "id" }],
        after: { values: [{ field: "id", value: "a" }], id: "a" },
        limit: 1,
      }),
    ).resolves.toMatchObject([{ id: "b" }]);
    expect(client.lastQuery?.limitValue).toBe(1);
    expect(client.lastQuery?.orders).toContainEqual(["__key__", { descending: false }]);
    expect(client.lastQuery?.filters).toContainEqual(["__key__", ">", expect.anything()]);
  });

  it("returns every string key across an exact keyset page boundary", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never, maxClientSideScan: 1 });
    const storage = factory.createRecordStorage(
      { name: "KeysetBoundary", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:keyset-boundary",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const ids = [
      "\nnode",
      ...Array.from({ length: 256 }, (_, index) => ` ${String(index)}`),
    ].sort();
    await storage.writeAll(ids.map((value) => create(StringValueSchema, { value })));
    const first = await storage.queryEntries({ sort: [{ field: "id" }], limit: 256 });
    const last = first.at(-1);
    const second = await storage.queryEntries({
      sort: [{ field: "id" }],
      after: { values: [{ field: "id", value: last?.id }], id: last?.id ?? "" },
      limit: 256,
    });
    expect([...first, ...second].map(({ id }) => id)).toEqual(ids);
  });

  it("does not duplicate an explicit identifier order", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:id-order",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await storage.write(create(StringValueSchema, { value: "task" }));

    await expect(storage.queryEntries({ sort: [{ field: "id" }] })).resolves.toHaveLength(1);

    expect(client.lastQuery?.orders).toEqual([["__key__", { descending: false }]]);
  });

  it("pushes a limit-only record query directly to Datastore", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never, maxClientSideScan: 10 });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:limit-only",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await storage.writeAll([
      create(StringValueSchema, { value: "a" }),
      create(StringValueSchema, { value: "b" }),
    ]);

    await expect(storage.queryEntries({ limit: 1 })).resolves.toHaveLength(1);

    expect(client.lastQuery?.limitValue).toBe(1);
  });

  it("pushes only legal normalized predicates and post-filters within the finite scan", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never, maxClientSideScan: 3 });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue>("group", (record) => record.value.slice(0, 1), "string"),
        ],
      }),
    );
    await storage.writeAll([
      create(StringValueSchema, { value: "a-1" }),
      create(StringValueSchema, { value: "b-1" }),
      create(StringValueSchema, { value: "c-1" }),
    ]);

    await expect(
      storage.queryPlan({
        predicate: {
          kind: "either",
          predicates: [
            { kind: "comparison", column: "group", operator: "equal", value: "a" },
            { kind: "comparison", column: "group", operator: "equal", value: "c" },
          ],
        },
        order: [{ column: "group", direction: "desc" }],
        limit: 2,
      }),
    ).resolves.toMatchObject([{ value: "c-1" }, { value: "a-1" }]);
    expect(client.lastQuery?.filters).toEqual([]);
    expect(client.lastQuery?.limitValue).toBe(4);

    await storage.queryPlan({
      predicate: { kind: "comparison", column: "group", operator: "greaterOrEqual", value: "b" },
      order: [{ column: "group", direction: "asc" }],
    });
    expect(client.lastQuery?.filters).toContainEqual(["$spine.column.group", ">=", "b"]);

    await storage.queryPlan({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "ids", ids: ["a-1"] },
          { kind: "comparison", column: "group", operator: "equal", value: "a" },
        ],
      },
      order: [{ column: "group", direction: "asc" }],
    });
    expect(client.lastQuery?.filters).toEqual(
      expect.arrayContaining([
        ["__key__", "=", expect.anything()],
        ["$spine.column.group", "=", "a"],
      ]),
    );
    expect(client.lastQuery?.orders).toContainEqual(["$spine.column.group", { descending: false }]);

    await storage.queryPlan({ predicate: { kind: "ids", ids: ["a-1", "c-1"] } });
    expect(client.lastQuery?.filters).toContainEqual(["__key__", "IN", expect.any(Array)]);

    for (const [operator, providerOperator] of [
      ["greaterThan", ">"],
      ["lessThan", "<"],
      ["lessOrEqual", "<="],
    ] as const) {
      await storage.queryPlan({
        predicate: { kind: "comparison", column: "group", operator, value: "b" },
        order: [{ column: "group", direction: "asc" }],
      });
      expect(client.lastQuery?.filters).toContainEqual([
        "$spine.column.group",
        providerOperator,
        "b",
      ]);
    }

    await storage.queryPlan({
      predicate: { kind: "comparison", column: "group", operator: "greaterThan", value: "a" },
      order: [{ column: "id", direction: "asc" }],
    });
    expect(client.lastQuery?.filters).toEqual([]);

    await storage.queryPlan({
      predicate: {
        kind: "ids",
        ids: Array.from({ length: 31 }, (_, index) => `${String(index)}-missing`),
      },
    });
    expect(client.lastQuery?.filters).toEqual([]);
  });

  it("atomically creates, replaces, deletes, and rejects stale compare-and-set values", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
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

  it("rolls back a compare-and-set transaction when commit fails", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    let rolledBack = false;
    Object.assign(client, {
      transaction: () => ({
        run: () => Promise.resolve([]),
        get: () => Promise.resolve([undefined]),
        save: () => undefined,
        delete: () => undefined,
        commit: () => Promise.reject(new Error("commit failed")),
        rollback: () => {
          rolledBack = true;
          return Promise.resolve([]);
        },
      }),
    });

    await expect(
      storage.compareAndSet("task-1", undefined, create(StringValueSchema, { value: "task-1" })),
    ).rejects.toThrow("commit failed");
    expect(rolledBack).toBe(true);
  });

  it("retries one retriable transaction conflict and returns stale after rereading the slot", async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    let transactionCalls = 0;
    Object.assign(client, {
      transaction: () => {
        transactionCalls += 1;
        const conflict = Object.assign(new Error("ABORTED: Transaction lock timeout"), {
          code: 10,
        });
        return transactionCalls === 1
          ? {
              run: () => Promise.resolve([]),
              get: () => Promise.resolve([undefined]),
              save: (): void => undefined,
              delete: (): void => undefined,
              commit: () => Promise.reject(conflict),
              rollback: () => Promise.resolve([]),
            }
          : {
              run: () => Promise.resolve([]),
              get: () => Promise.resolve([{ "$spine.payload": new Uint8Array([10, 0]) }]),
              save: (): void => undefined,
              delete: (): void => undefined,
              commit: () => Promise.resolve([]),
              rollback: () => Promise.resolve([]),
            };
      },
    });

    try {
      const result = storage.compareAndSet(
        "task-1",
        undefined,
        create(StringValueSchema, { value: "task-1" }),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(transactionCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(149);
      expect(transactionCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe(false);
      expect(transactionCalls).toBe(2);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  it("redacts credential-like transaction failures without hiding the original rollback attempt", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    let rollbackAttempts = 0;
    Object.assign(client, {
      transaction: () => ({
        run: () => Promise.resolve([]),
        get: () => Promise.resolve([undefined]),
        save: () => undefined,
        delete: () => undefined,
        commit: () => Promise.reject(new Error("credential=top-secret payload=private-record")),
        rollback: () => {
          rollbackAttempts += 1;
          return Promise.reject(new Error("credential=rollback-secret"));
        },
      }),
    });

    await expect(
      storage.compareAndSet("task-1", undefined, create(StringValueSchema, { value: "task-1" })),
    ).rejects.toThrow("Datastore transaction failed.");
    await expect(
      storage.compareAndSet("task-1", undefined, create(StringValueSchema, { value: "task-1" })),
    ).rejects.not.toThrow("top-secret");
    expect(rollbackAttempts).toBe(2);
  });

  it("redacts malformed entity payloads behind one decoding error", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    const kind = CanonicalValue.encode(["Tasks", false, "StringValueSchema:legacy"]);
    client.putRaw(kind, "task-1", {
      "$spine.id": JSON.stringify("task-1"),
      "$spine.payload": "credential=top-secret payload=do-not-disclose",
    });

    await expect(storage.read("task-1")).rejects.toThrow("Datastore entity cannot be decoded.");
    await expect(storage.read("task-1")).rejects.not.toThrow("top-secret");
    await expect(storage.read("task-1")).rejects.not.toThrow("do-not-disclose");
    await storage.delete("task-1");

    client.putRaw(kind, "task-2", {
      "$spine.id": "not-json",
      "$spine.payload": new Uint8Array([255]),
    });
    await expect(storage.queryEntries({})).rejects.toThrow(
      "Datastore entity has no valid Spine record identifier.",
    );
    await expect(storage.read("task-2")).rejects.toThrow("Datastore entity cannot be decoded.");
    await storage.delete("task-2");
    client.putRaw(kind, "task-3", {
      "$spine.id": 3,
      "$spine.payload": new Uint8Array([10, 0]),
    });
    await expect(storage.queryEntries({})).rejects.toThrow(
      "Datastore entity has no valid Spine record identifier.",
    );
  });

  it("sanitizes every malformed persisted canonical identifier shape", async () => {
    const invalidValues: readonly unknown[] = [
      "not-an-array",
      [1],
      ["undefined", "extra"],
      ["null", "extra"],
      ["boolean", "true"],
      ["boolean", true, "extra"],
      ["number", 1],
      ["number", "not-a-number"],
      ["number", "1", "extra"],
      ["string", 1],
      ["string", "value", "extra"],
      ["bigint", 1],
      ["bigint", "not-a-bigint"],
      ["bigint", "01"],
      ["bigint", "-0"],
      ["bigint", "1", "extra"],
      ["bytes", "not-bytes"],
      ["bytes", [0, 256]],
      ["bytes", [1], "extra"],
      ["object", "not-an-entry"],
      ["object", ["field", ["number", "1"], "extra"]],
      ["object", ["field", ["number", "1"]], ["field", ["number", "2"]]],
      ["object", ["second", ["number", "2"]], ["first", ["number", "1"]]],
      ["object", ["nested", ["unknown"]]],
      ["unknown"],
    ];

    for (const [index, invalid] of invalidValues.entries()) {
      const client = new MemoryDatastoreClient();
      const storage = new DatastoreStorageFactory({ client: client as never }).createRecordStorage(
        { name: "MalformedIds", multitenant: false },
        new RecordSpec({
          schema: StringValueSchema,
          storageKey: "StringValueSchema:legacy",
          idKind: "string",
          extractId: (record) => record.value,
        }),
      );
      const id = `invalid-${String(index)}`;
      client.putRaw(
        CanonicalValue.encode(["MalformedIds", false, "StringValueSchema:legacy"]),
        id,
        {
          "$spine.id": JSON.stringify(invalid),
          "$spine.payload": new Uint8Array([10, 0]),
        },
      );

      await expect(storage.queryEntries({})).rejects.toThrow(
        "Datastore entity has no valid Spine record identifier.",
      );
    }
  });

  it("rejects invalid Datastore protocol responses without exposing their contents", async () => {
    const client = new MemoryDatastoreClient();
    const factory = new DatastoreStorageFactory({ client: client as never });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    Object.assign(client, { get: () => Promise.resolve({ invalid: "response" }) });
    await expect(storage.read("task-1")).rejects.toThrow(
      "Datastore returned an invalid entity response.",
    );

    Object.assign(client, { runQuery: () => Promise.resolve([{}]) });
    await expect(storage.queryEntries({})).rejects.toThrow(
      "Datastore returned an invalid query response.",
    );

    Object.assign(client, { get: () => Promise.resolve([null]) });
    await expect(storage.read("task-1")).rejects.toThrow(
      "Datastore returned an invalid entity response.",
    );
  });
});

describe("CanonicalValue", () => {
  it("round-trips supported kinds and canonicalizes object property order", () => {
    const values: readonly unknown[] = [
      undefined,
      null,
      false,
      true,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "",
      "text",
      0n,
      7n,
      new Uint8Array(),
      new Uint8Array([1, 2]),
      [],
      [undefined, 1],
      {},
      { second: 2, first: 1 },
    ];

    for (const value of values) {
      expect(CanonicalValue.decode(CanonicalValue.encode(value))).toEqual(value);
      expect(CanonicalValue.equal(value, value)).toBe(true);
    }
    expect(CanonicalValue.equal({ first: 1, second: 2 }, { second: 2, first: 1 })).toBe(true);
    expect(CanonicalValue.equal({ first: 1 }, { first: 2 })).toBe(false);
  });

  it("orders primitives, byte and array prefixes, elements, and object keys and values", () => {
    const ascendingPairs: readonly (readonly [unknown, unknown])[] = [
      [null, undefined],
      [false, true],
      [Number.NEGATIVE_INFINITY, -1],
      [-1, Number.NaN],
      ["a", "b"],
      [1n, 2n],
      [new Uint8Array([1]), new Uint8Array([1, 0])],
      [new Uint8Array([1]), new Uint8Array([2])],
      [[1], [1, 0]],
      [[1], [2]],
      [{ a: 1 }, { a: 1, b: 0 }],
      [{ a: 1 }, { b: 1 }],
      [{ a: 1 }, { a: 2 }],
    ];

    for (const [left, right] of ascendingPairs) {
      expect(CanonicalValue.compare(left, right)).toBeLessThan(0);
      expect(CanonicalValue.compare(right, left)).toBeGreaterThan(0);
    }
    for (const value of [undefined, null, false, 1, Number.NaN, "a", 1n, [1], { a: 1 }]) {
      expect(CanonicalValue.compare(value, value)).toBe(0);
    }
  });

  it("rejects symbol and function identifiers instead of colliding with undefined", () => {
    const unsupported = [Symbol("slot"), (): void => undefined];

    for (const value of unsupported) {
      expect(() => CanonicalValue.equal(value, undefined)).toThrow(
        "Datastore record identifier has an unsupported value type.",
      );
      expect(() => CanonicalValue.encode(value)).toThrow(
        "Datastore record identifier has an unsupported value type.",
      );
    }
  });
});

class MemoryDatastoreClient {
  readonly KEY = Symbol("key");
  readonly saved: {
    key: MemoryKey;
    data: Record<string, unknown>;
    excludeFromIndexes?: readonly string[];
  }[] = [];
  saveCalls = 0;
  runQueryCalls = 0;
  getCalls = 0;
  failSaveCall: number | undefined;
  deleteCalls = 0;
  failDeleteCall: number | undefined;
  readonly entities = new Map<string, Record<string, unknown>>();
  lastQuery: MemoryQuery | undefined;
  lastGetOptions: MemoryReadOptions | undefined;
  lastRunQueryOptions: MemoryReadOptions | undefined;
  lastTransactionGetOptions: MemoryReadOptions | undefined;

  key(input: { namespace?: string; path: readonly [string, string] }): MemoryKey {
    return input.namespace === undefined
      ? { path: [...input.path] as [string, string] }
      : { namespace: input.namespace, path: [...input.path] as [string, string] };
  }

  putRaw(kind: string, id: string, data: Record<string, unknown>): void {
    this.entities.set(keyString({ path: [kind, JSON.stringify(["string", id])] }), data);
  }

  get(
    key: MemoryKey,
    options?: MemoryReadOptions,
  ): Promise<[Record<string | symbol, unknown> | undefined]> {
    this.getCalls += 1;
    this.lastGetOptions = options;
    const entity = this.entities.get(keyString(key));
    return Promise.resolve(
      entity === undefined
        ? [undefined]
        : [{ ...decodeProviderIntegers(entity, options), [this.KEY]: key }],
    );
  }

  save(
    input:
      | { key: MemoryKey; data: Record<string, unknown>; excludeFromIndexes?: readonly string[] }
      | readonly {
          key: MemoryKey;
          data: Record<string, unknown>;
          excludeFromIndexes?: readonly string[];
        }[],
  ): Promise<[]> {
    this.saveCalls += 1;
    if (this.saveCalls === this.failSaveCall) return Promise.reject(new Error("save group failed"));
    const entities = "key" in input ? [input] : input;

    for (const entity of entities) {
      this.saved.push(entity);
      this.entities.set(keyString(entity.key), encodeProviderNumbers(entity.data));
    }
    return Promise.resolve([]);
  }

  delete(key: MemoryKey | readonly MemoryKey[]): Promise<[]> {
    const keys: readonly MemoryKey[] = Array.isArray(key) ? key : [key];
    for (const value of keys) this.entities.delete(keyString(value));
    return Promise.resolve([]);
  }

  createQuery(): MemoryQuery {
    const query = new MemoryQuery();
    this.lastQuery = query;
    return query;
  }

  runQuery(
    query: MemoryQuery,
    options?: MemoryReadOptions,
  ): Promise<
    [
      Record<string | symbol, unknown>[],
      { readonly endCursor: Buffer; readonly moreResults: string },
    ]
  > {
    this.runQueryCalls += 1;
    this.lastRunQueryOptions = options;
    const entities: Record<string | symbol, unknown>[] = [...this.entities.entries()].map(
      ([serializedKey, entity]) => ({
        ...decodeProviderIntegers(entity, options),
        [this.KEY]: memoryKey(serializedKey),
      }),
    );
    const keyAfter = query.filters.find(
      (filter) => filter[0] === "__key__" && filter[1] === ">",
    )?.[2] as MemoryKey | undefined;
    const filtered =
      keyAfter === undefined
        ? entities
        : entities.filter(
            (entity) =>
              (memoryKeyId(entity[this.KEY] as MemoryKey) as string) >
              (memoryKeyId(keyAfter) as string),
          );
    if (
      query.orders.some((order) => order[0] === "__key__") &&
      filtered.every((entity) => typeof memoryKeyId(entity[this.KEY] as MemoryKey) === "string")
    ) {
      filtered.sort((left, right) =>
        (memoryKeyId(left[this.KEY] as MemoryKey) as string).localeCompare(
          memoryKeyId(right[this.KEY] as MemoryKey) as string,
        ),
      );
    }
    const offset =
      query.startCursor === undefined
        ? (query.offsetValue ?? 0)
        : Number(query.startCursor.toString());
    const end = query.limitValue === undefined ? undefined : offset + query.limitValue;
    const page = filtered.slice(offset, end);
    const next = offset + page.length;
    return Promise.resolve([
      page,
      {
        endCursor: Buffer.from(String(next)),
        moreResults: next < entities.length ? "MORE_RESULTS_AFTER_LIMIT" : "NO_MORE_RESULTS",
      },
    ]);
  }

  transaction(): MemoryTransaction {
    return new MemoryTransaction(this);
  }
}

class MemoryTransaction {
  readonly #writes: { key: MemoryKey; data: Record<string, unknown> }[] = [];
  readonly #deletes: MemoryKey[] = [];
  constructor(private readonly client: MemoryDatastoreClient) {}
  run(): Promise<[]> {
    return Promise.resolve([]);
  }
  get(
    key: MemoryKey,
    options?: MemoryReadOptions,
  ): Promise<[Record<string | symbol, unknown> | undefined]> {
    this.client.lastTransactionGetOptions = options;
    return this.client.get(key, options);
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
      this.client.entities.set(keyString(entity.key), encodeProviderNumbers(entity.data));
    return Promise.resolve([]);
  }
  rollback(): Promise<[]> {
    return Promise.resolve([]);
  }
}

class MemoryQuery {
  readonly filters: unknown[][] = [];
  readonly orders: unknown[][] = [];
  limitValue: number | undefined;
  offsetValue: number | undefined;
  startCursor: Buffer | string | undefined;
  filter(...input: unknown[]): this {
    this.filters.push(input);
    return this;
  }
  order(...input: unknown[]): this {
    this.orders.push(input);
    return this;
  }
  limit(value: number): this {
    this.limitValue = value;
    return this;
  }
  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }
  start(cursor: Buffer | string): this {
    this.startCursor = cursor;
    return this;
  }
}

interface MemoryKey {
  readonly namespace?: string;
  readonly path: [string, string];
}
interface MemoryReadOptions {
  readonly wrapNumbers?: boolean;
}
function keyString(key: MemoryKey): string {
  return JSON.stringify([key.namespace, ...key.path]);
}
function memoryKeyId(key: MemoryKey): unknown {
  return (JSON.parse(key.path[1]) as [string, unknown])[1];
}
function memoryKey(serialized: string): MemoryKey {
  const [namespace, kind, id] = JSON.parse(serialized) as [string | null, string, string];
  return namespace === null ? { path: [kind, id] } : { namespace, path: [kind, id] };
}

function isDatastoreInt(value: unknown): boolean {
  return typeof value === "object" && value !== null && Datastore.isInt(value);
}

function isDatastoreDouble(value: unknown): boolean {
  return typeof value === "object" && value !== null && Datastore.isDouble(value);
}

function encodeProviderNumbers(entity: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).map(([name, value]) => {
      if (typeof value === "object" && value !== null && Datastore.isDouble(value)) {
        return [name, value.value];
      }
      if (typeof value === "number" && Number.isInteger(value)) {
        return [name, Datastore.int(value.toString())];
      }
      return [name, value];
    }),
  );
}

function decodeProviderIntegers(
  entity: Readonly<Record<string, unknown>>,
  options?: MemoryReadOptions,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).map(([name, value]) => {
      if (!isDatastoreInt(value)) return [name, value];
      if (options?.wrapNumbers === true) return [name, value];
      const integer = Number((value as { readonly value: string }).value);
      if (!Number.isSafeInteger(integer))
        throw new Error("Integer value is outside the safe range.");
      return [name, integer];
    }),
  );
}
