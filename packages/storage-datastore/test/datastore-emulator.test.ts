import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { DatastoreStorageFactory } from "../src/index.js";

const emulatorHost = process.env.DATASTORE_EMULATOR_HOST;

describe.skipIf(emulatorHost === undefined)("Datastore emulator", () => {
  it("stores and removes a record through the configured emulator", async () => {
    const factory = DatastoreStorageFactory.create({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const name = uniqueStorageName("Crud");
    const storage = factory.createRecordStorage(
      { name, multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    const record = create(StringValueSchema, { value: "emulator-record" });

    try {
      await storage.write(record);
      await expect(storage.read("emulator-record")).resolves.toEqual(record);
      await expect(storage.delete("emulator-record")).resolves.toBe(true);
    } finally {
      await storage.delete("emulator-record");
    }
  });

  it("uses canonical structured slots and namespaces without crossing tenant records", async () => {
    const factory = DatastoreStorageFactory.create({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const name = uniqueStorageName("Canonical");
    const spec = new RecordSpec({
      schema: StringValueSchema,
      extractId: (record) => ({ label: record.value, optional: undefined, sequence: 7n }),
    });
    const first = factory.createRecordStorage(
      { name, multitenant: true, tenantId: "tenant-a" },
      spec,
    );
    const second = factory.createRecordStorage(
      { name, multitenant: true, tenantId: "tenant-b" },
      spec,
    );
    const copiedSlot = { sequence: 7n, optional: undefined, label: "same-slot" };
    const record = create(StringValueSchema, { value: "same-slot" });

    try {
      await first.write(record);
      await second.write(create(StringValueSchema, { value: "same-slot" }));
      await expect(first.read(copiedSlot)).resolves.toEqual(record);
      await expect(first.queryEntries({ ids: [copiedSlot] })).resolves.toHaveLength(1);
      await expect(
        second.queryEntries({ filters: [{ column: "id", value: copiedSlot }] }),
      ).resolves.toHaveLength(1);
    } finally {
      await Promise.all([first.delete(copiedSlot), second.delete(copiedSlot)]);
    }
  });

  it("pushes typed query order and fails instead of materializing past the finite scan budget", async () => {
    const client = new Datastore({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const factory = new DatastoreStorageFactory({ client });
    const name = uniqueStorageName("Query");
    const storage = factory.createRecordStorage(
      { name, multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue>("number", (record) => Number(record.value)),
          new RecordColumn<StringValue>("integer", (record) => BigInt(record.value)),
        ],
      }),
    );

    try {
      await storage.writeAll([
        create(StringValueSchema, { value: "10" }),
        create(StringValueSchema, { value: "2" }),
      ]);
      await expect(
        storage.queryEntries({ sort: [{ field: "number" }], limit: 2 }),
      ).resolves.toMatchObject([{ id: "2" }, { id: "10" }]);
      await expect(storage.queryEntries({ ids: ["2"] })).resolves.toMatchObject([{ id: "2" }]);
      await expect(
        storage.queryEntries({ filters: [{ column: "id", value: ["10", "2"] }] }),
      ).resolves.toHaveLength(2);
      await expect(
        storage.queryEntries({
          filters: [{ column: "integer", value: 2n }],
          sort: [{ field: "integer" }],
        }),
      ).resolves.toMatchObject([{ id: "2" }]);
      await expect(storage.queryEntries({ sort: [{ field: "integer" }] })).resolves.toMatchObject([
        { id: "2" },
        { id: "10" },
      ]);
      await expect(
        storage.queryEntries({
          sort: [{ field: "integer" }],
          after: { values: [{ field: "integer", value: 2n }], id: "2" },
          limit: 1,
        }),
      ).resolves.toMatchObject([{ id: "10" }]);
      await expect(
        storage.queryEntries({ sort: [{ field: "number" }], offset: 1, limit: 1 }),
      ).resolves.toMatchObject([{ id: "10" }]);
      await expect(
        storage.queryEntries({
          sort: [{ field: "number" }],
          after: { values: [{ field: "number", value: 2 }], id: "2" },
          limit: 1,
        }),
      ).resolves.toMatchObject([{ id: "10" }]);
      const bounded = new DatastoreStorageFactory({ client, maxClientSideScan: 1 });
      const boundedStorage = bounded.createRecordStorage(
        { name, multitenant: false },
        new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
      );
      await expect(boundedStorage.queryEntries({})).rejects.toThrow("client-side scan limit of 1");
    } finally {
      await Promise.all([storage.delete("10"), storage.delete("2")]);
    }
  });

  it("round-trips signed-64 bigint boundaries through reads, queries, and CAS", async () => {
    const client = new Datastore({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const name = uniqueStorageName("Boundaries");
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
    const storage = new DatastoreStorageFactory({ client }).createRecordStorage(
      { name, multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue>("integer", (record) => values.get(record.value) ?? 0n),
          new RecordColumn<StringValue>("number", (record) => numbers.get(record.value) ?? 0),
        ],
      }),
    );
    const minimumRecord = create(StringValueSchema, { value: "minimum" });
    const maximumRecord = create(StringValueSchema, { value: "maximum" });

    try {
      await storage.writeAll([minimumRecord, maximumRecord]);
      await expect(storage.read("minimum")).resolves.toEqual(minimumRecord);
      await expect(
        storage.queryEntries({
          filters: [{ column: "integer", value: minimum }],
          sort: [{ field: "integer" }],
        }),
      ).resolves.toMatchObject([{ id: "minimum" }]);
      await expect(
        storage.queryEntries({ filters: [{ column: "number", value: unsafeNumber }] }),
      ).resolves.toMatchObject([{ id: "minimum" }]);
      await expect(storage.queryEntries({ sort: [{ field: "number" }] })).resolves.toMatchObject([
        { id: "minimum" },
        { id: "maximum" },
      ]);
      await expect(storage.queryEntries({ sort: [{ field: "integer" }] })).resolves.toMatchObject([
        { id: "minimum" },
        { id: "maximum" },
      ]);
      await expect(storage.compareAndSet("maximum", maximumRecord, undefined)).resolves.toBe(true);
    } finally {
      await Promise.all([storage.delete("minimum"), storage.delete("maximum")]);
    }
  });

  it("writes 501 records and keeps an injected client usable after adapter closure", async () => {
    const client = new Datastore({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const factory = new DatastoreStorageFactory({ client });
    const name = uniqueStorageName("BatchLifecycle");
    const spec = new RecordSpec({
      schema: StringValueSchema,
      extractId: (record) => record.value,
    });
    const storage = factory.createRecordStorage({ name, multitenant: false }, spec);
    const records = Array.from({ length: 501 }, (_, index) =>
      create(StringValueSchema, { value: `row-${String(index)}` }),
    );
    const kind = `${name}:${StringValueSchema.typeName}`;
    const keys = records.map((record) =>
      client.key({ path: [kind, JSON.stringify(["string", record.value])] }),
    );

    try {
      await storage.writeAll(records);
      await expect(storage.read("row-500")).resolves.toEqual(records[500]);
      storage.close();
      await expect(storage.read("row-0")).rejects.toThrow("RecordStorage is closed");
      factory.close();
      expect(() => factory.createRecordStorage({ name, multitenant: false }, spec)).toThrow(
        "StorageFactory is closed",
      );
      const lastKey = keys.at(-1);
      if (lastKey === undefined) throw new Error("Expected a cleanup key.");
      const response: unknown = await client.get(lastKey, { wrapNumbers: true });
      expect(Array.isArray(response) && response[0] !== undefined).toBe(true);
    } finally {
      await client.delete(keys.slice(0, 500));
      await client.delete(keys.slice(500));
    }
  }, 15_000);

  it("allows only one concurrent compare-and-set create for one canonical slot", async () => {
    const factory = DatastoreStorageFactory.create({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const name = uniqueStorageName("Cas");
    const spec = new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value });
    const first = factory.createRecordStorage({ name, multitenant: false }, spec);
    const second = factory.createRecordStorage({ name, multitenant: false }, spec);

    try {
      const results = await Promise.all([
        first.compareAndSet("slot", undefined, create(StringValueSchema, { value: "slot" })),
        second.compareAndSet("slot", undefined, create(StringValueSchema, { value: "slot" })),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      await first.delete("slot");
    }
  }, 15_000);

  it("redacts a malformed emulator entity", async () => {
    const client = new Datastore({
      projectId: process.env.DATASTORE_PROJECT_ID ?? "spine-ts-datastore-emulator",
    });
    const name = uniqueStorageName("Malformed");
    const storage = new DatastoreStorageFactory({ client }).createRecordStorage(
      { name, multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    const encodedId = JSON.stringify(["string", "malformed"]);
    const key = client.key({ path: [`${name}:google.protobuf.StringValue`, encodedId] });

    try {
      await client.save({
        key,
        data: {
          "$spine.id": encodedId,
          "$spine.payload": "credential=secret payload=private",
        },
      });
      await expect(storage.read("malformed")).rejects.toThrow(
        "Datastore entity cannot be decoded.",
      );
      await expect(storage.read("malformed")).rejects.not.toThrow("secret");
    } finally {
      await client.delete(key);
    }
  });
});

let storageSequence = 0;

function uniqueStorageName(label: string): string {
  storageSequence += 1;
  return `T0046${label}${String(Date.now())}${String(process.pid)}${String(storageSequence)}`;
}
