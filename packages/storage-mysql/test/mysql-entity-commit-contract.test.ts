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

import { create, isMessage, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Identifiers } from "@spine-event-engine/core";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { EntityStateKeySchema } from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";
import { ColumnTypes, RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
  type TaskId,
} from "../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskSchema,
  type Task,
} from "../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";
import { MysqlEntityStorage } from "../src/mysql/entity-history.js";
import { mysqlCurrentRecord, mysqlEntityTables } from "../src/mysql/testing.js";

describe("MysqlEntityStorage independent histories", () => {
  it("opens commit history families lazily and rolls back a failed upgrade", () => {
    const current = fakeRecords([]);
    const failedState = fakeRecords([]);
    const closeFailedState = vi.spyOn(failedState, "close");
    const retainedState = fakeRecords([]);
    const diagnostics = fakeRecords([]);
    const ports = [current, failedState, retainedState, diagnostics];
    let attempts = 0;
    const open = vi.fn(() => {
      attempts += 1;
      if (attempts === 3) throw new Error("diagnostic acquisition failed");
      return ports.shift() as never;
    });
    const storage = new MysqlEntityStorage(entityInput(true, true), open, () => undefined, true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(() => {
      storage.ensure(true, true);
    }).toThrow(/diagnostic acquisition failed/);
    expect(closeFailedState).toHaveBeenCalledTimes(1);
    expect(storage.isOpen()).toBe(true);
    storage.ensure(true, true);
    storage.ensure(true, true);
    expect(open).toHaveBeenCalledTimes(5);
    storage.close();
  });
  it("attempts every retained MySQL family close and preserves all failures", () => {
    const failures = [
      new Error("current close"),
      new Error("state close"),
      new Error("event close"),
    ];
    const closeRecords = failures.map((failure) => ({
      ...fakeRecords([]),
      close: vi.fn(() => {
        throw failure;
      }),
    }));
    const ports = [...closeRecords];
    const released = vi.fn();
    const storage = new MysqlEntityStorage(
      entityInput(true, true),
      () => ports.shift() as never,
      released,
    );
    try {
      storage.close();
      throw new Error("Expected close failure.");
    } catch (error) {
      expect(error).toMatchObject({ errors: failures });
    }
    for (const record of closeRecords) expect(record.close).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledTimes(1);
  });
  it("resolves only enabled Task families", () => {
    expect(mysqlEntityTables(entityInput(false, false))).toHaveLength(1);
    expect(mysqlEntityTables(entityInput(true, true))).toHaveLength(3);
  });

  it("reads current Task records by TaskId", async () => {
    const value = record("task", 1, 1n);
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[], []])
        .mockResolvedValueOnce([[{ bytes: toBinary(EntityRecordSchema, value) }], []]),
    };
    const input = entityInput(false, false);
    await expect(
      mysqlCurrentRecord(pool as never, input, taskId("missing")),
    ).resolves.toBeUndefined();
    await expect(mysqlCurrentRecord(pool as never, input, taskId("task"))).resolves.toEqual(value);
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.any(String), ['{"value":"missing"}']);
    expect(pool.query).toHaveBeenNthCalledWith(2, expect.any(String), ['{"value":"task"}']);
  });

  it("maps public current reads and queries to typed Task IDs and declared columns", async () => {
    const value = record("task", 1, 1n);
    const column = new RecordColumn(
      "entity_id",
      ColumnTypes.message(AnySchema),
      (entry: EntityRecord) => entry.entityId,
    );
    const base = entityInput(false, false);
    const input = {
      ...base,
      columns: [column],
      recordSpec: new RecordSpec({
        sourceType: TaskSchema,
        recordType: EntityRecordSchema,
        idSchema: TaskIdSchema,
        extractId: (entry: EntityRecord) =>
          entry.entityId === undefined
            ? taskId("")
            : AnyPacker.unpack(entry.entityId, TaskIdSchema),
        columns: [column],
      }),
    };
    const read = vi.fn((id: TaskId) => Promise.resolve(id.value === "task" ? value : undefined));
    const queryPlanEntries = vi.fn(() => Promise.resolve([{ record: value }]));
    const current = { ...fakeRecords([]), read, queryPlanEntries };
    const storage = new MysqlEntityStorage(input, () => current as never);
    try {
      await expect(storage.current.read(taskId("missing"))).resolves.toBeUndefined();
      await expect(storage.current.read(taskId("task"))).resolves.toEqual(value);
      await expect(storage.current.query({})).resolves.toEqual([
        { id: taskId("task"), record: value, columns: new Map([["entity_id", value.entityId]]) },
      ]);
      expect(read).toHaveBeenCalledWith(taskId("task"));
      expect(queryPlanEntries).toHaveBeenCalledWith({});
    } finally {
      storage.close();
    }
  });

  it("keeps disabled histories inert and rejects appends", async () => {
    const storage = new MysqlEntityStorage(
      entityInput(false, false),
      () => fakeRecords([]) as never,
    );
    await expect(storage.states.backward(taskId("task"), 10)).resolves.toEqual([]);
    await expect(storage.events.backward(taskId("task"), 10)).resolves.toEqual([]);
    await expect(storage.states.append(record("task", 1, 1n))).rejects.toThrow(/disabled/i);
    await expect(storage.events.append(event("task", "event", 1, 1n))).rejects.toThrow(/disabled/i);
    storage.close();
  });

  it("uses immutable insertion for state and diagnostic Event histories", async () => {
    const current = fakeRecords([]);
    const states = fakeRecords([]);
    const diagnostics = fakeRecords([]);
    const stores = [current, states, diagnostics];
    const storage = new MysqlEntityStorage(entityInput(true, true), () => stores.shift() as never);
    const state = record("task", 1, 1n);
    const diagnostic = event("task", "event", 1, 1n);
    await storage.states.append(state);
    await storage.events.append(diagnostic);
    expect(states.immutable).toEqual([state]);
    expect(diagnostics.immutable).toEqual([diagnostic]);
    storage.close();
  });

  it("reads and trims ordered Task histories without touching another Task", async () => {
    const current = fakeRecords([]);
    const states = fakeRecords([
      record("task", 1, 1n),
      record("task", 2, 2n),
      record("other", 3, 3n),
    ]);
    const diagnostics = fakeRecords([
      event("task", "first", 1, 1n),
      event("task", "second", 2, 2n),
      event("other", "third", 3, 3n),
    ]);
    const stores = [current, states, diagnostics];
    const storage = new MysqlEntityStorage(entityInput(true, true), () => stores.shift() as never);
    await expect(storage.states.backward(taskId("task"), 10)).resolves.toMatchObject([
      { version: { number: 2 } },
      { version: { number: 1 } },
    ]);
    await expect(
      storage.states.stateAt(taskId("task"), create(TimestampSchema, { seconds: 1n })),
    ).resolves.toEqual(create(TaskSchema, { id: taskId("task"), title: "state-1" }));
    await expect(storage.events.backward(taskId("task"), 1)).resolves.toMatchObject([
      { id: { value: "second" } },
    ]);
    await storage.states.trim(taskId("task"), 1);
    expect(states.values).toHaveLength(2);
    expect(states.values.map(versionOf)).toContain(3);
    storage.close();
  });

  it("selects the exact state timestamp and truncates older Task histories across IDs", async () => {
    const current = fakeRecords([]);
    const states = fakeRecords([
      record("other", 1, 7n, 500),
      record("task", 1, 7n, 400),
      record("task", 2, 7n, 500),
      record("task", 3, 7n, 600),
      record("other", 3, 7n, 300),
    ]);
    const diagnostics = fakeRecords([
      event("other", "other-exact", 1, 7n, 500),
      event("task", "task-early", 1, 7n, 400),
      event("task", "task-exact", 2, 7n, 500),
      event("task", "task-late", 3, 7n, 600),
      event("other", "other-early", 3, 7n, 300),
    ]);
    const stores = [current, states, diagnostics];
    const storage = new MysqlEntityStorage(entityInput(true, true), () => stores.shift() as never);
    const cutoff = create(TimestampSchema, { seconds: 7n, nanos: 500 });
    try {
      await expect(storage.states.stateAt(taskId("task"), cutoff)).resolves.toEqual(
        create(TaskSchema, { id: taskId("task"), title: "state-2" }),
      );
      await expect(
        storage.states.stateAt(
          taskId("task"),
          create(TimestampSchema, { seconds: 7n, nanos: 499 }),
        ),
      ).resolves.toEqual(create(TaskSchema, { id: taskId("task"), title: "state-1" }));
      await storage.states.truncate(cutoff);
      await storage.events.truncate(cutoff);
      await expect(storage.states.backward(taskId("task"), 10)).resolves.toMatchObject([
        { version: { number: 3 } },
        { version: { number: 2 } },
      ]);
      await expect(storage.states.backward(taskId("other"), 10)).resolves.toMatchObject([
        { version: { number: 1 } },
      ]);
      await expect(storage.events.backward(taskId("task"), 10)).resolves.toMatchObject([
        { id: { value: "task-late" } },
        { id: { value: "task-exact" } },
      ]);
      await expect(storage.events.backward(taskId("other"), 10)).resolves.toMatchObject([
        { id: { value: "other-exact" } },
      ]);
      expect(states.values).toHaveLength(3);
      expect(diagnostics.values).toHaveLength(3);
    } finally {
      storage.close();
    }
  });
});

function taskId(value: string): TaskId {
  return create(TaskIdSchema, { value });
}

function entityInput(
  stateHistory: boolean,
  eventHistory: boolean,
): EntityStorageInput<TaskId, Task> {
  return {
    context: { name: "Tasks", multitenant: false },
    id: {
      clone: (value) => create(TaskIdSchema, value),
      key: (value) => value.value,
      pack: (value) => Identifiers.pack(TaskIdSchema, value),
      unpack: (value) => AnyPacker.tryUnpack(value, TaskIdSchema),
    },
    columns: [],
    recordSpec: new RecordSpec({
      sourceType: TaskSchema,
      recordType: EntityRecordSchema,
      idSchema: TaskIdSchema,
      extractId: (value) =>
        value.entityId === undefined ? taskId("") : AnyPacker.unpack(value.entityId, TaskIdSchema),
    }),
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
    stateHistory,
    eventHistory,
  };
}

function record(id: string, version: number, seconds: bigint, nanos = 0): EntityRecord {
  const value = taskId(id);
  return create(EntityRecordSchema, {
    entityId: Identifiers.pack(TaskIdSchema, value),
    state: Identifiers.pack(
      TaskSchema,
      create(TaskSchema, { id: value, title: `state-${String(version)}` }),
    ),
    version: create(VersionSchema, {
      number: version,
      timestamp: create(TimestampSchema, { seconds, nanos }),
    }),
  });
}

function event(id: string, value: string, version: number, seconds: bigint, nanos = 0) {
  const task = taskId(id);
  return create(EventSchema, {
    id: create(EventIdSchema, { value }),
    message: Identifiers.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: task,
        title: "Task",
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
      }),
    ),
    context: {
      producerId: Identifiers.pack(TaskIdSchema, task),
      version: create(VersionSchema, { number: version }),
      timestamp: create(TimestampSchema, { seconds, nanos }),
    },
  });
}

function fakeRecords(values: object[]) {
  return {
    values,
    immutable: [] as object[],
    read: () => Promise.resolve(undefined),
    write: () => Promise.reject(new Error("Mutable history write is forbidden.")),
    writeImmutable(value: object) {
      this.immutable.push(value);
      return Promise.resolve();
    },
    query: () => Promise.resolve([...values].sort((a, b) => versionOf(b) - versionOf(a))),
    delete: (key: object) => {
      const index = values.findIndex((value) => {
        if (isMessage(key, EntityStateKeySchema) && isMessage(value, EntityRecordSchema))
          return (
            key.version === value.version?.number &&
            AnyPacker.tryUnpack(key.entityId, TaskIdSchema)?.value ===
              AnyPacker.tryUnpack(value.entityId, TaskIdSchema)?.value
          );
        if (isMessage(key, EventIdSchema) && isMessage(value, EventSchema))
          return key.value === value.id?.value;
        return false;
      });
      if (index >= 0) values.splice(index, 1);
      return Promise.resolve(index >= 0);
    },
    prepare: () => Promise.resolve(),
    close: () => undefined,
  };
}

function versionOf(value: object): number {
  const record = value as {
    version?: { number?: number };
    context?: { version?: { number?: number } };
  };
  return record.version?.number ?? record.context?.version?.number ?? 0;
}
