import { describe, expect, it } from "vitest";

import {
  InMemoryStorageAdapter,
  type StorageAdapter,
  type WriteSideRecordStore,
  StorageVersionConflictError,
  createInMemoryStorageAdapter,
} from "./index.js";

interface TaskState {
  readonly title: string;
  readonly done?: boolean;
}

interface DomainEvent {
  readonly id: string;
  readonly typeUrl: string;
  readonly payload: { readonly title?: string; readonly value?: Uint8Array };
}

describe("@spine-ts/storage", () => {
  it("binds payload types to stores instead of read calls", () => {
    const storage: StorageAdapter<TaskState> = createInMemoryStorageAdapter<TaskState>();
    const entityStore: WriteSideRecordStore<TaskState, "entity"> = storage.writeEntities;

    expect(entityStore).toBe(storage.writeEntities);
  });

  it("returns empty reads for all record-oriented stores", async () => {
    const storage = createInMemoryStorageAdapter();

    await expect(storage.writeEntities.get("Task:missing")).resolves.toBeUndefined();
    await expect(storage.aggregateEvents.readStream("Task:missing")).resolves.toEqual([]);
    await expect(storage.aggregateSnapshots.get("Task:missing")).resolves.toBeUndefined();
    await expect(storage.readProjections.get("TaskView:missing")).resolves.toBeUndefined();
    await expect(storage.deliveryRecords.get("delivery-missing")).resolves.toBeUndefined();
    await expect(storage.tenantIndex.list()).resolves.toEqual([]);
    await expect(storage.diagnostics.read()).resolves.toEqual([]);
  });

  it("writes entity records with optimistic version checks", async () => {
    const storage = createInMemoryStorageAdapter<TaskState>();

    const created = await storage.writeEntities.put({
      key: "Task:1",
      payload: { title: "draft" },
      expectedVersion: "absent",
    });

    expect(created.version).toBe(1);
    expect(created.recordKind).toBe("entity");
    await expect(storage.writeEntities.get("Task:1")).resolves.toMatchObject({
      key: "Task:1",
      payload: { title: "draft" },
      version: 1,
    });

    const updated = await storage.writeEntities.put({
      key: "Task:1",
      payload: { title: "done", done: true },
      expectedVersion: created.version,
    });

    expect(updated.version).toBe(2);
    await expect(
      storage.writeEntities.put({
        key: "Task:1",
        payload: { title: "stale" },
        expectedVersion: created.version,
      }),
    ).rejects.toBeInstanceOf(StorageVersionConflictError);
  });

  it("snapshots stored records so callers cannot mutate adapter state", async () => {
    const storage = createInMemoryStorageAdapter<
      unknown,
      unknown,
      unknown,
      { title: string; labels: string[] }
    >();
    const payload: { title: string; labels: string[] } = {
      title: "original",
      labels: ["one"],
    };

    const written = await storage.readProjections.put({
      key: "TaskView:1",
      payload,
      expectedVersion: "absent",
    });
    payload.title = "mutated outside";
    payload.labels.push("two");
    written.payload.labels.push("three");

    const read = await storage.readProjections.get("TaskView:1");

    expect(read?.payload).toEqual({ title: "original", labels: ["one"] });
    read?.payload.labels.push("four");
    await expect(storage.readProjections.get("TaskView:1")).resolves.toMatchObject({
      payload: { title: "original", labels: ["one"] },
    });
  });

  it("appends aggregate events in deterministic stream order with expected versions", async () => {
    const storage = createInMemoryStorageAdapter<unknown, DomainEvent>();

    const appended = await storage.aggregateEvents.append({
      streamId: "Task:1",
      expectedVersion: 0,
      events: [
        { id: "event-1", typeUrl: "type.spine.io/tasks.TaskCreated", payload: { title: "one" } },
        { id: "event-2", typeUrl: "type.spine.io/tasks.TaskRenamed", payload: { title: "two" } },
      ],
    });

    expect(appended.map((event) => event.streamVersion)).toEqual([1, 2]);
    expect(appended.map((event) => event.globalPosition)).toEqual([1, 2]);
    await expect(storage.aggregateEvents.readStream("Task:1")).resolves.toEqual(appended);

    await expect(
      storage.aggregateEvents.append({
        streamId: "Task:1",
        expectedVersion: 1,
        events: [{ id: "event-3", typeUrl: "type.spine.io/tasks.TaskClosed", payload: {} }],
      }),
    ).rejects.toBeInstanceOf(StorageVersionConflictError);
  });

  it("preserves byte payloads without caller mutation corrupting stored records", async () => {
    const storage = createInMemoryStorageAdapter<
      { value: Uint8Array },
      { id: string; value: Uint8Array }
    >();
    const entityPayload = { value: new Uint8Array([1, 2, 3]) };
    const eventPayload = { id: "event-with-bytes", value: new Uint8Array([4, 5, 6]) };

    const written = await storage.writeEntities.put({
      key: "Task:bytes",
      payload: entityPayload,
      expectedVersion: "absent",
    });
    const appended = await storage.aggregateEvents.append({
      streamId: "Task:bytes",
      expectedVersion: 0,
      events: [eventPayload],
    });

    entityPayload.value[0] = 9;
    eventPayload.value[0] = 9;
    written.payload.value[1] = 9;
    appended[0]?.payload.value.set([9, 9, 9]);

    const readEntity = await storage.writeEntities.get("Task:bytes");
    const readEvents = await storage.aggregateEvents.readStream("Task:bytes");
    const readEntityValue = readEntity?.payload.value;
    const readEventValue = readEvents[0]?.payload.value;

    expect(readEntityValue).toBeInstanceOf(Uint8Array);
    expect([...(readEntityValue ?? [])]).toEqual([1, 2, 3]);
    expect(readEventValue).toBeInstanceOf(Uint8Array);
    expect([...(readEventValue ?? [])]).toEqual([4, 5, 6]);
  });

  it("reports non-cloneable payloads without leaking payload contents", async () => {
    const storage = createInMemoryStorageAdapter<{ readonly action: () => string }>();
    const leakedSecret = "token_live_do_not_log";

    let thrown: unknown;
    try {
      await storage.writeEntities.put({
        key: "Task:unsafe",
        payload: {
          action: () => leakedSecret,
        },
        expectedVersion: "absent",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("StoragePayloadCloneError");
    expect((thrown as Error).message).toContain("structured-clone-compatible");
    expect((thrown as Error).message).not.toContain(leakedSecret);
  });

  it("validates empty aggregate appends without retaining an empty stream", async () => {
    const storage = createInMemoryStorageAdapter<unknown, DomainEvent>();

    await expect(
      storage.aggregateEvents.append({
        streamId: "Task:empty",
        expectedVersion: 0,
        events: [],
      }),
    ).resolves.toEqual([]);
    await expect(storage.aggregateEvents.readStream("Task:empty")).resolves.toEqual([]);
    await expect(storage.aggregateEvents.scan()).resolves.toEqual([]);
    await expect(
      storage.aggregateEvents.append({
        streamId: "Task:empty",
        expectedVersion: 1,
        events: [],
      }),
    ).rejects.toBeInstanceOf(StorageVersionConflictError);
  });

  it("keeps tenant indexes and diagnostics deterministic without storing payload bytes", async () => {
    const storage = createInMemoryStorageAdapter();

    await storage.tenantIndex.add("tenant-b");
    await storage.tenantIndex.add("tenant-a");
    await storage.tenantIndex.add("tenant-b");
    await storage.diagnostics.append({
      message: "projection caught up",
      severity: "info",
      attributes: { projection: "TaskView" },
    });

    await expect(storage.tenantIndex.list()).resolves.toEqual(["tenant-a", "tenant-b"]);
    await expect(storage.diagnostics.read()).resolves.toEqual([
      {
        id: "diagnostic-1",
        sequence: 1,
        message: "projection caught up",
        severity: "info",
        attributes: { projection: "TaskView" },
      },
    ]);
  });

  it("isolates every in-memory adapter instance", async () => {
    const first = new InMemoryStorageAdapter();
    const second = new InMemoryStorageAdapter();

    await first.writeEntities.put({
      key: "Task:1",
      payload: { title: "first" },
      expectedVersion: "absent",
    });
    await first.aggregateEvents.append({
      streamId: "Task:1",
      expectedVersion: 0,
      events: [{ id: "event-1", typeUrl: "type.spine.io/tasks.TaskCreated", payload: {} }],
    });

    await expect(second.writeEntities.get("Task:1")).resolves.toBeUndefined();
    await expect(second.aggregateEvents.readStream("Task:1")).resolves.toEqual([]);
    expect(first.durability.durable).toBe(false);
    expect(first.durability.description).toMatch(/not durable/i);
  });

  it("scans and deletes record stores with deterministic revision order", async () => {
    const storage = createInMemoryStorageAdapter();

    await storage.deliveryRecords.put({
      key: "delivery-2",
      payload: { status: "pending" },
      expectedVersion: "absent",
    });
    await storage.deliveryRecords.put({
      key: "delivery-1",
      payload: { status: "pending" },
      expectedVersion: "absent",
    });

    await expect(storage.deliveryRecords.scan()).resolves.toMatchObject([
      { key: "delivery-2", recordKind: "delivery", version: 1 },
      { key: "delivery-1", recordKind: "delivery", version: 1 },
    ]);
    await expect(
      storage.deliveryRecords.put({
        key: "delivery-1",
        payload: { status: "leased" },
        expectedVersion: "any",
      }),
    ).resolves.toMatchObject({ version: 2 });
    await expect(
      storage.deliveryRecords.delete({ key: "delivery-1", expectedVersion: 2 }),
    ).resolves.toBe(true);
    await expect(storage.deliveryRecords.delete({ key: "delivery-missing" })).resolves.toBe(false);
    await expect(storage.deliveryRecords.get("delivery-1")).resolves.toBeUndefined();
  });

  it("scans aggregate events globally and snapshots aggregate records", async () => {
    const storage = createInMemoryStorageAdapter();

    await storage.aggregateEvents.append({
      streamId: "Task:2",
      expectedVersion: "any",
      events: [{ id: "event-2", payload: { title: "two" } }],
    });
    await storage.aggregateEvents.append({
      streamId: "Task:1",
      expectedVersion: 0,
      events: [{ id: "event-1", payload: { title: "one" } }],
    });
    await storage.aggregateSnapshots.put({
      key: "Task:1",
      payload: { version: 1, state: { title: "one" } },
      expectedVersion: "absent",
    });

    await expect(storage.aggregateEvents.scan()).resolves.toMatchObject([
      { streamId: "Task:2", globalPosition: 1 },
      { streamId: "Task:1", globalPosition: 2 },
    ]);
    await expect(storage.aggregateSnapshots.scan()).resolves.toMatchObject([
      { key: "Task:1", recordKind: "aggregate-snapshot", version: 1 },
    ]);
  });

  it("keeps diagnostics without attributes valid", async () => {
    const storage = createInMemoryStorageAdapter();

    await storage.diagnostics.append({ message: "started", severity: "debug" });
    await expect(storage.diagnostics.read()).resolves.toEqual([
      { id: "diagnostic-1", sequence: 1, message: "started", severity: "debug" },
    ]);
  });
});
