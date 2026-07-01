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
});

function createStorage(
  context: { name: string; multitenant: boolean; tenantId?: string } = {
    name: "Tasks",
    multitenant: false,
  },
) {
  return new InMemoryStorageFactory().createRecordStorage(context, createSpec());
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
    ],
  });
}

function createEvent(id: string, typeUrl: string, seconds: bigint) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, {
      typeUrl,
      value: new Uint8Array([1, 2, 3]),
    }),
    context: {
      timestamp: create(TimestampSchema, { seconds }),
    },
  });
}
