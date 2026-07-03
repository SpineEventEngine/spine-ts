import { create } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Event, EventId } from "@spine-ts/proto";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";
import { describe, expect, it } from "vitest";

import { InMemoryStorageFactory, RecordColumn, RecordSpec } from "../../src/index.js";

describe("InMemoryRecordStorage", () => {
  it("reads back cloned protobuf records and applies simple masks", async () => {
    const storage = createStorage();
    const event = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 3n);

    await storage.write(event);
    if (event.message === undefined) {
      throw new Error("Expected test event message.");
    }
    event.message.typeUrl = "type.spine.io/tasks.MutatedOutside";

    const masked = await storage.read(create(EventIdSchema, { value: "event-1" }), {
      mask: ["id", "context.timestamp"],
    });
    const stored = await storage.read(create(EventIdSchema, { value: "event-1" }));

    expect(masked).toMatchObject({
      id: { value: "event-1" },
      context: { timestamp: { seconds: 3n } },
    });
    expect(masked?.message).toBeUndefined();
    expect(stored?.message?.typeUrl).toBe("type.spine.io/tasks.TaskCreated");
  });

  it("filters, sorts, and limits by record ids and columns deterministically", async () => {
    const storage = createStorage();

    await storage.writeAll([
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 3n),
    ]);

    const ids = await storage.index({
      filters: [{ column: "typeUrl", value: "type.spine.io/tasks.TaskClosed" }],
      sort: [{ field: "timestamp", direction: "desc" }],
      limit: 1,
    });
    const records = await storage.query({
      ids: [
        create(EventIdSchema, { value: "event-2" }),
        create(EventIdSchema, { value: "event-1" }),
      ],
      sort: [{ field: "id", direction: "asc" }],
    });

    expect(ids).toMatchObject([{ value: "event-3" }]);
    expect(records.map((record) => record.id?.value)).toEqual(["event-1", "event-2"]);
  });

  it("sorts numeric and bigint values numerically for multi-digit values", async () => {
    const storage = createStorage();

    await storage.writeAll([
      createEvent("event-10", "type.spine.io/tasks.TaskClosed", 10n, 10),
      createEvent("event-2", "type.spine.io/tasks.TaskCreated", 2n, 2),
    ]);

    const bigintOrder = await storage.index({
      sort: [{ field: "timestamp", direction: "asc" }],
    });
    const numberOrder = await storage.index({
      sort: [{ field: "nanos", direction: "asc" }],
    });

    expect(bigintOrder.map((id) => id.value)).toEqual(["event-2", "event-10"]);
    expect(numberOrder.map((id) => id.value)).toEqual(["event-2", "event-10"]);
  });

  it("sorts mixed value kinds deterministically", async () => {
    const storage = createLookupStorage({
      "event-array": [],
      "event-bigint": 0n,
      "event-boolean": false,
      "event-bytes": new Uint8Array([]),
      "event-null": null,
      "event-number": 0,
      "event-object": {},
      "event-string": "",
      "event-undefined": undefined,
    });

    await storage.writeAll(
      createLookupEvents([
        "event-object",
        "event-number",
        "event-bigint",
        "event-null",
        "event-string",
        "event-array",
        "event-boolean",
        "event-undefined",
        "event-bytes",
      ]),
    );

    const ids = await storage.index({
      sort: [{ field: "value", direction: "asc" }],
    });

    expect(ids.map((id) => id.value)).toEqual([
      "event-array",
      "event-bigint",
      "event-boolean",
      "event-bytes",
      "event-null",
      "event-number",
      "event-object",
      "event-string",
      "event-undefined",
    ]);
  });

  it("sorts booleans, strings, bytes, arrays, objects, nulls, undefined, and NaN deterministically", async () => {
    const booleanStorage = createLookupStorage({
      "event-true": true,
      "event-false": false,
    });
    await booleanStorage.writeAll(createLookupEvents(["event-true", "event-false"]));
    await expect(
      booleanStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-false" }, { value: "event-true" }]);

    const stringStorage = createLookupStorage({
      "event-b": "b",
      "event-a": "a",
    });
    await stringStorage.writeAll(createLookupEvents(["event-b", "event-a"]));
    await expect(
      stringStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-a" }, { value: "event-b" }]);

    const bytesStorage = createLookupStorage({
      "event-10": new Uint8Array([10]),
      "event-2": new Uint8Array([2]),
    });
    await bytesStorage.writeAll(createLookupEvents(["event-10", "event-2"]));
    await expect(
      bytesStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-2" }, { value: "event-10" }]);

    const arrayStorage = createLookupStorage({
      "event-10": [10],
      "event-2": [2],
    });
    await arrayStorage.writeAll(createLookupEvents(["event-10", "event-2"]));
    await expect(
      arrayStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-2" }, { value: "event-10" }]);

    const objectStorage = createLookupStorage({
      "event-10": { rank: 10 },
      "event-2": { rank: 2 },
    });
    await objectStorage.writeAll(createLookupEvents(["event-10", "event-2"]));
    await expect(
      objectStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-2" }, { value: "event-10" }]);

    const undefinedStorage = createLookupStorage({
      "event-2": undefined,
      "event-1": undefined,
    });
    await undefinedStorage.writeAll(createLookupEvents(["event-2", "event-1"]));
    await expect(
      undefinedStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-1" }, { value: "event-2" }]);

    const nullStorage = createLookupStorage({
      "event-2": null,
      "event-1": null,
    });
    await nullStorage.writeAll(createLookupEvents(["event-2", "event-1"]));
    await expect(
      nullStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([{ value: "event-1" }, { value: "event-2" }]);

    const nanStorage = createLookupStorage({
      "event-nan-2": Number.NaN,
      "event-2": 2,
      "event-nan-1": Number.NaN,
    });
    await nanStorage.writeAll(createLookupEvents(["event-nan-2", "event-2", "event-nan-1"]));
    await expect(
      nanStorage.index({ sort: [{ field: "value", direction: "asc" }] }),
    ).resolves.toMatchObject([
      { value: "event-2" },
      { value: "event-nan-1" },
      { value: "event-nan-2" },
    ]);
  });

  it("keeps tied sort keys stable before applying the limit", async () => {
    const first = createStorage();
    const second = createStorage();
    const records = [
      createEvent("event-2", "type.spine.io/tasks.TaskClosed", 5n),
      createEvent("event-1", "type.spine.io/tasks.TaskCreated", 5n),
      createEvent("event-3", "type.spine.io/tasks.TaskClosed", 5n),
    ];

    await first.writeAll(records);
    await second.writeAll([...records].reverse());

    const query = {
      sort: [{ field: "timestamp", direction: "desc" as const }],
      limit: 2,
    };

    const firstIds = await first.index(query);
    const secondIds = await second.index(query);

    expect(firstIds.map((id) => id.value)).toEqual(["event-1", "event-2"]);
    expect(secondIds.map((id) => id.value)).toEqual(["event-1", "event-2"]);
  });

  it("keeps multitenant slices separate inside one storage", async () => {
    let currentTenantId = "tenant-a";
    const storage = createStorage({
      name: "Tasks",
      multitenant: true,
      get tenantId() {
        return currentTenantId;
      },
    });

    await storage.write(createEvent("event-a", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = "tenant-b";
    await storage.write(createEvent("event-b", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = "tenant-a";

    await expect(storage.query()).resolves.toMatchObject([{ id: { value: "event-a" } }]);
    currentTenantId = "tenant-b";
    await expect(storage.query()).resolves.toMatchObject([{ id: { value: "event-b" } }]);
  });

  it("rejects invalid limits, missing tenant IDs, and post-close operations", async () => {
    const storage = createStorage();

    await expect(storage.query({ limit: 0 })).rejects.toThrow(/positive/);
    await expect(storage.query({ limit: Number.NaN })).rejects.toThrow(/positive/);
    await expect(storage.query({ limit: Number.POSITIVE_INFINITY })).rejects.toThrow(/positive/);
    await expect(storage.query({ limit: 1.5 })).rejects.toThrow(/positive/);

    const multitenant = createStorage({ name: "Tasks", multitenant: true });
    await expect(multitenant.query()).rejects.toThrow(/tenantId/);

    storage.close();
    expect(storage.isOpen()).toBe(false);
    await expect(storage.read(create(EventIdSchema, { value: "event-1" }))).rejects.toThrow(
      /closed/,
    );
  });

  it("does not persist earlier records when later materialization fails", async () => {
    const storage = new InMemoryStorageFactory().createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec<EventId, Event>({
        schema: EventSchema,
        idSchema: EventIdSchema,
        extractId: (event) => {
          if (event.id?.value === "event-2") {
            throw new Error("Second record rejected.");
          }

          if (event.id === undefined) {
            throw new Error("Expected test event ID.");
          }

          return event.id;
        },
        columns: [new RecordColumn<Event>("typeUrl", (event) => event.message?.typeUrl)],
      }),
    );

    await expect(
      storage.writeAll([
        createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
        createEvent("event-2", "type.spine.io/tasks.TaskClosed", 2n),
      ]),
    ).rejects.toThrow(/Second record rejected/);
    await expect(storage.query()).resolves.toEqual([]);
  });

  it("supports compare-and-set for create, replace, and delete by record id", async () => {
    const storage = createStorage();
    const created = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const replaced = createEvent("event-1", "type.spine.io/tasks.TaskUpdated", 2n);
    const createdId = created.id;
    const replacedId = replaced.id;

    if (createdId === undefined || replacedId === undefined) {
      throw new Error("Expected compare-and-set test event IDs.");
    }

    await expect(storage.compareAndSet(createdId, undefined, created)).resolves.toBe(true);
    await expect(
      storage.compareAndSet(
        createdId,
        undefined,
        createEvent("event-1", "type.spine.io/tasks.TaskClosed", 3n),
      ),
    ).resolves.toBe(false);
    await expect(storage.compareAndSet(createdId, created, replaced)).resolves.toBe(true);
    await expect(
      storage.compareAndSet(
        createdId,
        created,
        createEvent("event-1", "type.spine.io/tasks.TaskClosed", 4n),
      ),
    ).resolves.toBe(false);
    await expect(storage.compareAndSet(replacedId, replaced, undefined)).resolves.toBe(true);
    await expect(storage.read(createdId)).resolves.toBeUndefined();
  });

  it("reports query entry ids from the actual storage slot", async () => {
    const storage = createStorage();
    const stored = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const copiedId = create(EventIdSchema, { value: "event-copy" });

    await storage.compareAndSet(copiedId, undefined, stored);

    await expect(storage.queryEntries()).resolves.toMatchObject([
      {
        id: { value: "event-copy" },
        record: { id: { value: "event-1" } },
      },
    ]);
  });
});

function createStorage(
  context: { name: string; multitenant: boolean; tenantId?: string } = {
    name: "Tasks",
    multitenant: false,
  },
) {
  return new InMemoryStorageFactory().createRecordStorage(context, createSpec());
}

function createLookupEvents(ids: readonly string[]) {
  return ids.map((id) => createEvent(id, `type.spine.io/tasks.${id}`, 0n));
}

function createLookupStorage(values: Record<string, unknown>) {
  return new InMemoryStorageFactory().createRecordStorage(
    { name: "Tasks", multitenant: false },
    new RecordSpec<EventId, Event>({
      schema: EventSchema,
      idSchema: EventIdSchema,
      extractId: (event) => {
        if (event.id === undefined) {
          throw new Error("Expected event.id.");
        }

        return event.id;
      },
      columns: [new RecordColumn<Event>("value", (event) => values[event.id?.value ?? "missing"])],
    }),
  );
}

function createSpec() {
  return new RecordSpec<EventId, Event>({
    schema: EventSchema,
    idSchema: EventIdSchema,
    extractId: (event) => {
      if (event.id === undefined) {
        throw new Error("Expected event.id.");
      }

      return event.id;
    },
    columns: [
      new RecordColumn<Event>("typeUrl", (event) => event.message?.typeUrl),
      new RecordColumn<Event>("timestamp", (event) => event.context?.timestamp?.seconds ?? 0n),
      new RecordColumn<Event>("nanos", (event) => event.context?.timestamp?.nanos ?? 0),
    ],
  });
}

function createEvent(id: string, typeUrl: string, seconds: bigint, nanos = 0) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, {
      typeUrl,
      value: new Uint8Array([1, 2, 3]),
    }),
    context: {
      timestamp: create(TimestampSchema, { seconds, nanos }),
    },
  });
}
