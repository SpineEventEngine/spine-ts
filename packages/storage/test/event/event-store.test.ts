import { create } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";
import { describe, expect, it } from "vitest";

import { EventStore, InMemoryStorageFactory } from "../../src/index.js";

describe("EventStore", () => {
  it("persists generated Spine events through record storage", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    const earlier = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const later = createEvent("event-2", "type.spine.io/tasks.TaskRenamed", 2n);

    await store.appendAll([later, earlier]);

    const read = await store.read({
      sort: [{ field: "timestamp", direction: "asc" }],
    });

    expect(read.map((event) => event.id?.value)).toEqual(["event-1", "event-2"]);
    expect(read[0]).not.toBe(earlier);
    expect(read[1]).not.toBe(later);
  });

  it("uses the current tenant slice from the storage context", async () => {
    let currentTenantId = "tenant-a";
    const factory = new InMemoryStorageFactory();
    const store = new EventStore(
      {
        name: "Tasks",
        multitenant: true,
        get tenantId() {
          return currentTenantId;
        },
      },
      factory,
    );

    await store.append(createEvent("event-a", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = "tenant-b";
    await store.append(createEvent("event-b", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = "tenant-a";

    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-a" } }]);
    currentTenantId = "tenant-b";
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-b" } }]);
  });

  it("supports empty appends and closes with the delegated record storage", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(store.appendAll([])).resolves.toBeUndefined();
    expect(store.isOpen()).toBe(true);

    store.close();

    expect(store.isOpen()).toBe(false);
    await expect(store.read()).rejects.toThrow(/closed/);
  });

  it("rejects events without IDs and persists none from the batch", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.appendAll([
        create(EventSchema, {
          message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskCreated" }),
        }),
        create(EventSchema, {
          message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskClosed" }),
        }),
      ]),
    ).rejects.toThrow(/event\.id/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rejects events with blank IDs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.append(
        create(EventSchema, {
          id: create(EventIdSchema),
          message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskCreated" }),
        }),
      ),
    ).rejects.toThrow(/non-empty event\.id\.value/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rejects duplicate event IDs across stores sharing one factory and context", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    const first = new EventStore(context, factory);
    const second = new EventStore(context, factory);

    await first.append(createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n));

    await expect(
      second.append(createEvent("event-1", "type.spine.io/tasks.TaskRenamed", 2n)),
    ).rejects.toThrow(/unique event IDs/);
    await expect(first.read()).resolves.toHaveLength(1);
  });

  it("rejects duplicate event IDs within one append batch", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.appendAll([
        createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
        createEvent("event-1", "type.spine.io/tasks.TaskRenamed", 2n),
      ]),
    ).rejects.toThrow(/unique event IDs/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("snapshots events before queued append work runs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("event-before-mutation", "type.spine.io/tasks.TaskCreated", 1n);

    const append = store.append(event);
    event.id = create(EventIdSchema, { value: "event-after-mutation" });

    await append;

    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-before-mutation" } }]);
  });
});

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
