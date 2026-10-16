/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create, fromBinary, ScalarType } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { Identifiers, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
  type TaskId,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskSchema,
  type Task,
} from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

import { DatastoreStorageFactory } from "../../src/index.js";
import { DatastoreEntityStorage } from "../../src/datastore/entity-history.js";
import { HistoryDatastoreBackend } from "./entity-history-fixture.js";

function taskId(value: string): TaskId {
  return create(TaskIdSchema, { value });
}
function input(
  histories = true,
  columns: readonly RecordColumn<ReturnType<typeof create<typeof EntityRecordSchema>>>[] = [],
): EntityStorageInput<TaskId, Task> {
  const unpack = (id: ReturnType<typeof create<typeof AnySchema>>) =>
    id.typeUrl.endsWith(TaskIdSchema.typeName) ? fromBinary(TaskIdSchema, id.value) : undefined;
  return {
    context: { name: "GeneratedEntity", multitenant: false },
    id: {
      clone: (id) => create(TaskIdSchema, id),
      key: (id) => id.value,
      pack: (id) => packId(id.value),
      unpack,
    },
    columns,
    recordSpec: new RecordSpec({
      sourceType: TaskSchema,
      recordType: EntityRecordSchema,
      idSchema: TaskIdSchema,
      extractId: (record) => {
        const id = record.entityId === undefined ? undefined : unpack(record.entityId);
        if (id === undefined) throw new Error("Entity record has no matching ID.");
        return id;
      },
      columns,
    }),
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
    ...(histories ? { stateHistory: true, eventHistory: true } : {}),
  };
}
function packId(value: string) {
  return Identifiers.pack(TaskIdSchema, taskId(value));
}
function packState(title: string) {
  return Identifiers.pack(TaskSchema, create(TaskSchema, { id: taskId("task"), title }));
}
function record(value: string, version: number) {
  return create(EntityRecordSchema, {
    entityId: packId("task"),
    state: packState(value),
    version: { number: version, timestamp: create(TimestampSchema, { seconds: BigInt(version) }) },
  });
}
function event(id: string, version: number) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: Identifiers.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: taskId("task"),
        title: id,
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
      }),
    ),
    context: {
      producerId: packId("task"),
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      version: { number: version },
    },
  });
}
function factory(backend: HistoryDatastoreBackend) {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
  return DatastoreStorageFactory.newBuilder()
    .setClient(backend.client() as never)
    .setStringifierRegistry(stringifiers)
    .build();
}

describe("Datastore generated Entity records", () => {
  it("retries an immutable history insert when a colliding row disappears before inspection", async () => {
    const compareAndSet = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const read = vi.fn().mockResolvedValue(undefined);
    const entity = input();
    const storage = new DatastoreEntityStorage(
      entity,
      (spec) =>
        ({
          recordSpec: spec,
          compareAndSet,
          read,
          isOpen: () => true,
          close: () => undefined,
        }) as never,
    );

    await expect(storage.states.append(record("one", 1))).resolves.toBeUndefined();
    expect(compareAndSet).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
  });

  it("bounds immutable history insert attempts when each collision disappears", async () => {
    const compareAndSet = vi.fn().mockResolvedValue(false);
    const read = vi.fn().mockResolvedValue(undefined);
    const entity = input();
    const storage = new DatastoreEntityStorage(
      entity,
      (spec) =>
        ({
          recordSpec: spec,
          compareAndSet,
          read,
          isOpen: () => true,
          close: () => undefined,
        }) as never,
    );

    await expect(storage.states.append(record("one", 1))).rejects.toThrow(/not retained/);
    expect(compareAndSet).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("stores current, state history, diagnostic history, and Event Store in separate generated families", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input());
    await storage.current.write(record("current", 1));
    await storage.states.append(record("state", 2));
    await storage.events.append(event("diagnostic", 3));
    expect(
      [...backend.entities.keys()].map(
        (key) => (JSON.parse(key) as [unknown, [string, string]])[1][0],
      ),
    ).toEqual(
      expect.arrayContaining([
        "spine.examples.todo.Task",
        "spine.examples.todo.Task_EntityRecord",
        "spine.examples.todo.Task_Event",
      ]),
    );
    expect([...backend.entities.values()].every((row) => Object.hasOwn(row.data, "bytes"))).toBe(
      true,
    );
    expect([...backend.entities.values()].every((row) => !Object.hasOwn(row.data, "_scope"))).toBe(
      true,
    );
  });

  it("commits current state with enabled but empty optional history and delivery families", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = factory(backend);
    const entity = input(true);
    const commits = EntityCommitStorageFactories.create(store, entity);

    await commits.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("current-only", 1),
      states: [],
      diagnostics: [],
      events: [],
    });

    const stored = await store.createEntityStorage(entity).current.read(taskId("task"));
    expect(stored?.version?.number).toBe(1);
    expect(stored?.state?.typeUrl).toContain(TaskSchema.typeName);
    expect(backend.entities).toHaveLength(1);
  });

  it("does not open or write disabled history families", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input(false));
    await expect(storage.states.append(record("state", 1))).rejects.toThrow("disabled");
    await expect(storage.events.append(event("event", 1))).rejects.toThrow("disabled");
    expect(backend.entities).toHaveLength(0);
  });

  it("rejects a commit that tries to append disabled history", async () => {
    const backend = new HistoryDatastoreBackend();
    const entity = input(false);
    const client = backend.client();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();

    await expect(
      EntityCommitStorageFactories.create(store, entity).commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("current", 1),
        states: [record("retained", 1)],
      }),
    ).rejects.toThrow("disabled");
    expect(client.transactionCalls).toBe(0);
  });

  it("cannot enable history by changing the commit input after opening its handle", async () => {
    const backend = new HistoryDatastoreBackend();
    const commits = EntityCommitStorageFactories.create(factory(backend), input(false));
    const enabled = input(true);

    await expect(
      commits.commit({
        context: enabled.context,
        entity: enabled,
        entityId: taskId("task"),
        next: record("current", 1),
        states: [record("retained", 1)],
      }),
    ).rejects.toThrow("disabled");
    expect(backend.entities).toHaveLength(0);
  });

  it("allows an empty disabled-history commit but rejects disabled diagnostic events", async () => {
    const backend = new HistoryDatastoreBackend();
    const entity = input(false);
    const store = factory(backend);
    const commits = EntityCommitStorageFactories.create(store, entity);

    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("current", 1),
        states: [],
        diagnostics: [],
      }),
    ).resolves.toBeUndefined();
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("next", 2),
        diagnostics: [event("diagnostic", 2)],
      }),
    ).rejects.toThrow("disabled");
  });

  it("rejects commits from another Entity source or storage tenancy", async () => {
    const entity = input();
    const commits = EntityCommitStorageFactories.create(
      factory(new HistoryDatastoreBackend()),
      entity,
    );
    const differentSource = { ...entity, sourceType: TimestampSchema };
    const differentTenancy = {
      ...entity,
      context: {
        name: entity.context.name,
        multitenant: true as const,
        tenantId: create(TenantIdSchema, { kind: { case: "value", value: "acme" } }),
      },
    };

    await expect(
      commits.commit({
        context: differentSource.context,
        entity: differentSource,
        entityId: taskId("task"),
        next: record("current", 1),
      } as never),
    ).rejects.toThrow("another Entity source or tenant");
    await expect(
      commits.commit({
        context: differentTenancy.context,
        entity: differentTenancy,
        entityId: taskId("task"),
        next: record("current", 1),
      }),
    ).rejects.toThrow("another Entity source or tenant");
  });

  it("rejects malformed event IDs and excludes events without the requested producer", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());

    await expect(storage.events.append(create(EventSchema))).rejects.toThrow("requires Event.id");
    await storage.events.append(
      create(EventSchema, { id: create(EventIdSchema, { value: "other" }) }),
    );

    await expect(storage.events.backward(taskId("task"), 1)).resolves.toEqual([]);
  });

  it("rejects a current record whose ID cannot be unpacked", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const missing = create(EntityRecordSchema, {
      state: packState("current"),
      version: { number: 1 },
    });
    const invalid = create(EntityRecordSchema, {
      entityId: create(AnySchema, { typeUrl: "type.spine.test/Other", value: new Uint8Array() }),
      state: packState("current"),
      version: { number: 1 },
    });

    await expect(storage.current.write(missing)).rejects.toThrow("does not match");
    await expect(storage.current.write(invalid)).rejects.toThrow("does not match");
    const entity = input();
    const commits = EntityCommitStorageFactories.create(
      factory(new HistoryDatastoreBackend()),
      entity,
    );
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: invalid,
      }),
    ).rejects.toThrow("does not match");
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: missing,
      }),
    ).rejects.toThrow("does not match");
  });

  it("returns declared current-record columns with query results", async () => {
    const columns = [
      new RecordColumn(
        "state_type",
        ColumnTypes.scalar(ScalarType.STRING),
        (record: ReturnType<typeof create<typeof EntityRecordSchema>>) => record.state?.typeUrl,
      ),
    ];
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(
      input(true, columns),
    );
    await storage.current.write(record("current", 1));

    const entries = await storage.current.query({});

    expect(entries).toHaveLength(1);
    expect(entries[0]?.columns.get("state_type")).toBe(
      `type.spine.examples.todo/${TaskSchema.typeName}`,
    );
  });

  it("honors layouts for Entity families without using record creators", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(backend.client() as never)
      .organizeRecords(TaskSchema, EntityRecordSchema, { kind: "CurrentTasks" })
      .build();
    await store.createEntityStorage(input()).current.write(record("one", 1));
    expect(
      [...backend.entities.keys()].map(
        (key) => (JSON.parse(key) as [unknown, [string, string]])[1][0],
      ),
    ).toContain("CurrentTasks");
  });

  it("keeps immutable history and maintains backward, stateAt, trim, and truncate", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(record("one", 1));
    await storage.states.append(record("two", 2));
    await expect(storage.states.append(record("changed", 2))).rejects.toThrow("divergent");
    await expect(storage.states.backward(taskId("task"), 1)).resolves.toMatchObject([
      { version: { number: 2 } },
    ]);
    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 1n })),
    ).resolves.toMatchObject({ title: "one" });
    await storage.states.trim(taskId("task"), 1);
    await expect(storage.states.backward(taskId("task"), 2)).resolves.toHaveLength(1);
    await storage.states.truncate(create(TimestampSchema, { seconds: 3n }));
    await expect(storage.states.backward(taskId("task"), 1)).resolves.toEqual([]);
  });

  it("compares Timestamp nanos when selecting and truncating retained states", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const early = create(EntityRecordSchema, {
      entityId: packId("task"),
      state: packState("early"),
      version: { number: 1, timestamp: create(TimestampSchema, { seconds: 4n, nanos: 100 }) },
    });
    const late = create(EntityRecordSchema, {
      entityId: packId("task"),
      state: packState("late"),
      version: { number: 2, timestamp: create(TimestampSchema, { seconds: 4n, nanos: 900 }) },
    });
    await storage.states.append(early);
    await storage.states.append(late);

    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 4n, nanos: 500 })),
    ).resolves.toMatchObject({ title: "early" });
    await storage.states.truncate(create(TimestampSchema, { seconds: 4n, nanos: 500 }));
    await expect(storage.states.backward(taskId("task"), 2)).resolves.toHaveLength(1);
  });

  it("selects the state at an exact nanosecond and rejects invalid history retention", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(
      create(EntityRecordSchema, {
        entityId: packId("task"),
        state: packState("exact"),
        version: {
          number: 1,
          timestamp: create(TimestampSchema, { seconds: 4n, nanos: 500 }),
        },
      }),
    );

    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 4n, nanos: 500 })),
    ).resolves.toMatchObject({ title: "exact" });
    await expect(storage.states.backward(taskId("task"), 0)).rejects.toThrow(
      "positive safe integer",
    );
    await expect(storage.states.trim(taskId("task"), -1)).rejects.toThrow(
      "non-negative safe integer",
    );
  });

  it("reads an unversioned retained state at version zero without duplicating it", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    const unversioned = create(EntityRecordSchema, {
      entityId: packId("task"),
      state: packState("initial"),
    });
    await storage.states.append(unversioned);
    await storage.states.append(unversioned);

    await expect(storage.states.backward(taskId("task"), 1, 0n)).resolves.toHaveLength(1);
  });

  it("reads retained states and diagnostic events across a 128-record keyset boundary", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1) {
      await storage.states.append(record(`state-${String(version)}`, version));
      await storage.events.append(event(`event-${String(version)}`, version));
    }

    const states = await storage.states.backward(taskId("task"), 129);
    const events = await storage.events.backward(taskId("task"), 129);

    expect(states).toHaveLength(129);
    expect(states.at(0)).toMatchObject({ version: { number: 129 } });
    expect(states.at(-1)).toMatchObject({ version: { number: 1 } });
    expect(events).toHaveLength(129);
    expect(events.at(0)).toMatchObject({ id: { value: "event-129" } });
    expect(events.at(-1)).toMatchObject({ id: { value: "event-1" } });
  });

  it("fails closed when a later provider page cannot advance its explicit continuation", async () => {
    const backend = new HistoryDatastoreBackend();
    const storage = factory(backend).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1)
      await storage.states.append(record(`state-${String(version)}`, version));

    backend.malformedQueryAt = 2;
    await expect(storage.states.backward(taskId("task"), 129)).rejects.toThrow(
      "continuation is malformed",
    );
  });

  it("returns no state when the requested time precedes retained history", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.states.append(record("first", 2));

    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 1n })),
    ).resolves.toBeUndefined();
  });

  it("maintains state and event histories across a 128-record keyset boundary", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1) {
      await storage.states.append(record(`state-${String(version)}`, version));
      await storage.events.append(event(`event-${String(version)}`, version));
    }

    await storage.states.trim(taskId("task"), 2);
    await storage.events.truncate(create(TimestampSchema, { seconds: 128n }));

    await expect(storage.states.backward(taskId("task"), 3)).resolves.toMatchObject([
      { version: { number: 129 } },
      { version: { number: 128 } },
    ]);
    await expect(storage.events.backward(taskId("task"), 3, 129n)).resolves.toMatchObject([
      { id: { value: "event-129" } },
      { id: { value: "event-128" } },
    ]);
  });

  it("keeps provider history reads and retention work bounded to 128-row pages", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
    const storage = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build()
      .createEntityStorage(input());
    for (let version = 1; version <= 129; version += 1)
      await storage.states.append(record(`state-${String(version)}`, version));

    const beforeRead = client.queryCalls;
    await expect(storage.states.backward(taskId("task"), 129)).resolves.toHaveLength(129);
    expect(client.queryCalls - beforeRead).toBe(2);
    expect(client.queryLimits.slice(-2)).toEqual([128, 1]);
    expect(
      client.queries
        .slice(-2)
        .every((query) =>
          query.filters.some((filter) => Array.isArray(filter) && filter[0] === "entity_id"),
        ),
    ).toBe(true);

    await storage.states.trim(taskId("task"), 17);
    await expect(storage.states.backward(taskId("task"), 129)).resolves.toHaveLength(17);
    expect(client.queryLimits.every((limit) => limit <= 128)).toBe(true);
    expect(client.deleteCalls).toBeGreaterThan(0);
  });

  it("resumes a large time-based deletion without an unbounded scan", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const storage = factory(backend).createEntityStorage(input());
    for (let version = 1; version <= 1_129; version += 1)
      await storage.events.append(event(`old-${String(version)}`, version));

    backend.failDeleteAt = 2;
    await expect(
      storage.events.truncate(create(TimestampSchema, { seconds: 2_000n })),
    ).rejects.toThrow("Datastore provider operation failed");
    backend.failDeleteAt = undefined;
    await storage.events.truncate(create(TimestampSchema, { seconds: 2_000n }));

    await expect(storage.events.backward(taskId("task"), 1)).resolves.toEqual([]);
    expect(client.queryLimits.every((limit) => limit <= 128)).toBe(true);
  }, 30_000);

  it("writes generated families independently and converges an identical retry", async () => {
    const backend = new HistoryDatastoreBackend();
    const store = factory(backend);
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    const mutation = {
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: record("one", 1),
      states: [record("one", 1)],
      diagnostics: [event("diagnostic", 1)],
      events: [event("delivery", 1)],
    };
    await expect(commit.commit(mutation)).resolves.toBeUndefined();
    await expect(commit.commit(mutation)).resolves.toBeUndefined();
    expect(backend.entities).toHaveLength(4);
  });

  it("retains completed Task state history when the next record write fails", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const original = client.transaction.bind(client);
    client.transaction = () => {
      const transaction = original();
      if (client.transactionCalls === 2)
        transaction.commit = () => Promise.reject(new Error("later record failed"));
      return transaction;
    };
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("next", 1),
        states: [record("next", 1)],
        diagnostics: [event("diagnostic", 1)],
      }),
    ).rejects.toThrow();
    expect(backend.entities).toHaveLength(1);
    const records = store.createEntityStorage(entity);
    await expect(records.current.read(taskId("task"))).resolves.toBeUndefined();
  });

  it("reuses captured Task bytes when a completed current write reports an abort", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const originalSave = client.save.bind(client);
    let ambiguous = true;
    client.save = async (input) => {
      const saved = await originalSave(input);
      if (ambiguous) {
        ambiguous = false;
        throw Object.assign(new Error("completed write reported aborted"), { code: 10 });
      }
      return saved;
    };
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema, TaskCreatedSchema]));
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .setStringifierRegistry(stringifiers)
      .build();
    const entity = input();
    const next = record("captured", 1);
    const commit = EntityCommitStorageFactories.create(store, entity);
    const pending = commit.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next,
    });
    next.state = packState("mutated");
    await expect(pending).resolves.toBeUndefined();
    const stored = await store.createEntityStorage(entity).current.read(taskId("task"));
    expect(fromBinary(TaskSchema, stored?.state?.value ?? new Uint8Array()).title).toBe("captured");
    expect(client.saveCalls).toBe(1);
  });

  it("rejects a divergent immutable history row inside an Entity commit", async () => {
    const entity = input();
    const commits = EntityCommitStorageFactories.create(
      factory(new HistoryDatastoreBackend()),
      entity,
    );
    const current = record("current", 1);
    await commits.commit({
      context: entity.context,
      entity,
      entityId: taskId("task"),
      next: current,
      states: [record("retained", 1)],
    });

    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: current,
        states: [record("changed", 1)],
      }),
    ).rejects.toThrow("divergent");
  });

  it("treats an event without version or timestamp as version zero for its producer", async () => {
    const storage = factory(new HistoryDatastoreBackend()).createEntityStorage(input());
    await storage.events.append(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "unversioned" }),
        context: { producerId: packId("task") },
      }),
    );
    await storage.events.append(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "unversioned-second" }),
        context: { producerId: packId("task") },
      }),
    );

    await expect(storage.events.backward(taskId("task"), 2, 0n)).resolves.toHaveLength(2);
    await storage.events.truncate(create(TimestampSchema, { seconds: 1n }));
    await expect(storage.events.backward(taskId("task"), 1)).resolves.toEqual([]);
  });

  it("rejects empty and duplicate delivery IDs before a transaction", async () => {
    const backend = new HistoryDatastoreBackend();
    const client = backend.client();
    const store = DatastoreStorageFactory.newBuilder()
      .setClient(client as never)
      .build();
    const entity = input();
    const commit = EntityCommitStorageFactories.create(store, entity);
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("one", 1),
        events: [event("", 1)],
      }),
    ).rejects.toThrow("non-blank");
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("one", 1),
        events: [event("same", 1), event("same", 1)],
      }),
    ).rejects.toThrow("unique");
    expect(client.transactionCalls).toBe(0);
  });

  it("closes Entity and commit handles idempotently", async () => {
    const entity = input();
    const store = factory(new HistoryDatastoreBackend());
    const handle = store.createEntityStorage(entity);

    handle.close();
    handle.close();
    expect(handle.isOpen()).toBe(false);
    await expect(handle.current.read(taskId("task"))).rejects.toThrow("closed");
    await expect(handle.states.backward(taskId("task"), 1)).rejects.toThrow("closed");
    await expect(handle.events.backward(taskId("task"), 1)).rejects.toThrow("closed");

    const commits = EntityCommitStorageFactories.create(store, entity);
    commits.close();
    commits.close();
    await expect(
      commits.commit({
        context: entity.context,
        entity,
        entityId: taskId("task"),
        next: record("current", 1),
      }),
    ).rejects.toThrow("closed");
  });
});
