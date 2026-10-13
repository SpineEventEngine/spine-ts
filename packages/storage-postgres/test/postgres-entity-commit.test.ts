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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { Identifiers, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { RecordSpec } from "@spine-event-engine/storage";
import {
  EntityCommitStorageFactories,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import {
  TaskCreatedSchema,
  TaskRenamedSchema,
} from "../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import { TaskListSchema } from "../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";
import { TaskSchema } from "../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

const driver = vi.hoisted(() => {
  let commitFailure: Error | undefined;
  let failure: { readonly sql: string; readonly after: number; readonly error: Error } | undefined;
  let current: Uint8Array | undefined;
  let immutable: Uint8Array | undefined;
  let immutableConflict = false;
  let pending: (() => void)[] = [];
  let durableWrites = 0;
  let transaction = false;
  let activeClients = 0;
  let blocker: { readonly sql: string; release: () => void; reached: () => void } | undefined;
  let blocked: Promise<void> = Promise.resolve();
  let drained: (() => void)[] = [];
  const query = vi.fn((sql: string, values: readonly unknown[] = []) => {
    if (failure !== undefined && sql.includes(failure.sql)) {
      const next = failure;
      failure = next.after === 1 ? undefined : { ...next, after: next.after - 1 };
      if (next.after === 1) return Promise.reject(next.error);
    }
    if (blocker !== undefined && sql.includes(blocker.sql)) {
      const blockedQuery = blocker;
      blockedQuery.reached();
      return new Promise((resolve) => {
        blockedQuery.release = () => {
          resolve({ rows: [] });
        };
      });
    }
    if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
    if (sql.includes("columns WHERE")) return Promise.resolve({ rows: columns(String(values[1])) });
    if (sql.includes("PRIMARY KEY"))
      return Promise.resolve({ rows: [{ column_name: "ID", ordinal_position: 1 }] });
    if (sql === "BEGIN") {
      transaction = true;
      pending = [];
      return Promise.resolve({ rows: [] });
    }
    if (sql === "ROLLBACK") {
      transaction = false;
      pending = [];
      return Promise.resolve({ rows: [] });
    }
    if (sql.startsWith('SELECT "bytes"')) {
      const bytes = sql.includes('"spine_examples_todo_task"') ? current : immutable;
      return Promise.resolve({ rows: bytes === undefined ? [] : [{ bytes }] });
    }
    if (sql === "COMMIT" && commitFailure !== undefined) {
      const failure = commitFailure;
      commitFailure = undefined;
      return Promise.reject(failure);
    }
    if (sql === "COMMIT") {
      for (const write of pending) write();
      transaction = false;
      pending = [];
      return Promise.resolve({ rows: [] });
    }
    if (sql.startsWith("INSERT")) {
      const isImmutable = sql.includes("DO NOTHING");
      if (isImmutable && immutableConflict) return Promise.resolve({ rowCount: 0, rows: [] });
      const bytes = values[1] as Uint8Array;
      const write = () => {
        durableWrites += 1;
        if (sql.includes('"spine_examples_todo_task"')) current = bytes;
        else immutable = bytes;
      };
      if (transaction) pending.push(write);
      else write();
      return Promise.resolve({ rowCount: 1, rows: [] });
    }
    return Promise.resolve({ rowCount: 1, rows: [] });
  });
  const release = vi.fn(() => {
    activeClients -= 1;
    if (activeClients === 0) for (const resolve of drained.splice(0)) resolve();
  });
  const connect = vi.fn(() => {
    activeClients += 1;
    return Promise.resolve({ query, release });
  });
  const end = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        if (activeClients === 0) resolve();
        else drained.push(resolve);
      }),
  );
  const Pool = vi.fn(function Pool() {
    return { connect, end };
  });
  return {
    Pool,
    connect,
    query,
    release,
    failCommit: (error: Error | undefined) => (commitFailure = error),
    setCurrent: (record: EntityRecord | undefined) =>
      (current = record === undefined ? undefined : toBinary(EntityRecordSchema, record)),
    reset: () => {
      commitFailure = undefined;
      current = undefined;
      immutable = undefined;
      immutableConflict = false;
      pending = [];
      durableWrites = 0;
      transaction = false;
      activeClients = 0;
      blocker = undefined;
      blocked = Promise.resolve();
      drained = [];
      failure = undefined;
      query.mockClear();
      connect.mockClear();
      release.mockClear();
      end.mockClear();
    },
    fail: (sql: string, error: Error, after = 1) => (failure = { sql, after, error }),
    setImmutable: (record: Event | EntityRecord | undefined) => {
      immutable =
        record === undefined
          ? undefined
          : toBinary(
              record.$typeName === EventSchema.typeName ? EventSchema : EntityRecordSchema,
              record as never,
            );
      immutableConflict = record !== undefined;
    },
    durableWrites: () => durableWrites,
    block: (sql: string) => {
      let reached: () => void = () => undefined;
      blocked = new Promise<void>((resolve) => (reached = resolve));
      blocker = { sql, reached, release: () => undefined };
    },
    unblock: () => {
      blocker?.release();
      blocker = undefined;
    },
    waitUntilBlocked: () => blocked,
    waitUntilDrained: () => new Promise<void>((resolve) => drained.push(resolve)),
    end,
  };
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";

describe("PostgreSQL Entity commit", () => {
  beforeEach(() => {
    driver.reset();
  });
  it("rejects disabled state history before preparing or acquiring a client", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const connections = driver.connect.mock.calls.length;

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        states: [record("task")],
      }),
    ).rejects.toThrow("state history is disabled");

    expect(driver.connect).toHaveBeenCalledTimes(connections);
  });

  it("writes current state without a locked read", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    await expect(
      commit.commit({ context: entity.context, entity, entityId: "task", next: record("task") }),
    ).resolves.toBeUndefined();

    expect(driver.query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(false);
  });

  it("persists captured Entity bytes when the caller mutates input during I/O", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const next = record("task", "prepared");
    driver.block('SELECT "bytes"');

    const pending = commit.commit({ context: entity.context, entity, entityId: "task", next });
    await driver.waitUntilBlocked();
    next.state = record("task", "mutated").state;
    driver.unblock();
    await expect(pending).resolves.toBeUndefined();

    const insert = driver.query.mock.calls.findLast(([sql]) => sql.startsWith("INSERT"));
    const stored = fromBinary(EntityRecordSchema, insert?.[1]?.[1] as Uint8Array);
    expect(stored.state).toEqual(record("task", "prepared").state);
  });

  it("closes idempotently and rejects a later commit before client acquisition", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);

    commit.close();
    commit.close();
    const connections = driver.connect.mock.calls.length;

    await expect(
      commit.commit({ context: entity.context, entity, entityId: "task", next: record("task") }),
    ).rejects.toThrow("closed");
    expect(driver.connect).toHaveBeenCalledTimes(connections);
  });

  it("prepares and writes state history independently of current state", async () => {
    const factory = await postgresFactory();
    const entity = entityInput(true);
    const commit = EntityCommitStorageFactories.create(factory, entity);
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        states: [record("task")],
      }),
    ).resolves.toBeUndefined();

    expect(driver.durableWrites()).toBe(2);
  });

  it("releases the client after a current-record write failure", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const rollbackCount = driver.query.mock.calls.filter(([sql]) => sql === "ROLLBACK").length;
    driver.fail("INSERT INTO", new Error("write failed"));

    const failure = commit.commit({
      context: entity.context,
      entity,
      entityId: "task",
      next: record("task"),
    });
    await expect(failure).rejects.toThrow("PostgreSQL record operation failed.");
    await expect(failure).rejects.not.toThrow("write failed");

    expect(driver.query.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(
      rollbackCount,
    );
    expect(driver.release).toHaveBeenCalledTimes(driver.connect.mock.calls.length);
  });

  it("replaces a current record", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    driver.setCurrent(record("task"));
    const writes = driver.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT")).length;

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task", "next"),
      }),
    ).resolves.toBeUndefined();

    expect(
      driver.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT")).length,
    ).toBeGreaterThan(writes);
    driver.setCurrent(undefined);
  });

  it("rejects incompatible state schema and next Entity identity before acquisition", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const connections = driver.connect.mock.calls.length;

    await expect(
      commit.commit({
        context: entity.context,
        entity: { ...entity, stateSchema: TaskListSchema },
        entityId: "task",
        next: record("task"),
      }),
    ).rejects.toThrow("state schema");
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("other"),
      }),
    ).rejects.toThrow("does not identify");
    expect(driver.connect).toHaveBeenCalledTimes(connections);
  });

  it("validates diagnostic and delivery IDs independently before acquisition", async () => {
    const factory = await postgresFactory();
    const entity = entityInput(false, true);
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const connections = driver.connect.mock.calls.length;

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        diagnostics: [event("same"), event("same")],
      }),
    ).rejects.toThrow("duplicate diagnostic");
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        events: [event(""), event("other")],
      }),
    ).rejects.toThrow("blank delivery");
    expect(driver.connect).toHaveBeenCalledTimes(connections);
  });

  it("writes all families only after immutable preflight succeeds", async () => {
    const factory = await postgresFactory();
    const entity = entityInput(true, true);
    const commit = EntityCommitStorageFactories.create(factory, entity);

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        states: [record("task")],
        diagnostics: [event("diagnostic")],
        events: [event("delivery")],
      }),
    ).resolves.toBeUndefined();

    expect(driver.durableWrites()).toBe(4);
    expect(driver.query.mock.calls.filter(([sql]) => sql.includes("DO NOTHING"))).toHaveLength(3);
    factory.close();
  });

  it("retains state history when a later diagnostic append fails", async () => {
    const factory = await postgresFactory();
    const entity = entityInput(true, true);
    const commit = EntityCommitStorageFactories.create(factory, entity);
    driver.fail("DO NOTHING", new Error("diagnostic insert failed"), 2);

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        states: [record("task")],
        diagnostics: [event("diagnostic")],
      }),
    ).rejects.toThrow();

    expect(driver.durableWrites()).toBe(1);
    expect(driver.query.mock.calls.map(([sql]) => sql)).not.toContain("ROLLBACK");
    factory.close();
  });

  it("replays captured records once after a deadlock without changing Event IDs", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const delivery = event("stable-delivery");
    const deadlock = Object.assign(new Error("driver deadlock detail"), { code: "40P01" });
    driver.fail("DO NOTHING", deadlock);

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        events: [delivery],
      }),
    ).resolves.toBeUndefined();

    const attempts = driver.query.mock.calls.filter(([sql]) => sql.includes("DO NOTHING"));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.[1]).toEqual(attempts[1]?.[1]);
  });

  it("accepts byte-identical immutable replay and rejects a divergent collision", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const replay = event("delivery");
    const collision = event("delivery", true);
    expect(toBinary(EventSchema, replay)).not.toEqual(toBinary(EventSchema, collision));
    driver.setImmutable(replay);

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        events: [replay],
      }),
    ).resolves.toBeUndefined();

    const before = driver.durableWrites();
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task", "changed"),
        events: [collision],
      }),
    ).rejects.toThrow("collides");
    expect(driver.durableWrites()).toBe(before);
    factory.close();
  });

  it("coordinates independent factory handles through current-record replay", async () => {
    const firstFactory = await postgresFactory();
    const secondFactory = await postgresFactory();
    const entity = entityInput();
    const first = EntityCommitStorageFactories.create(firstFactory, entity);
    const second = EntityCommitStorageFactories.create(secondFactory, entity);
    const next = record("task");

    await expect(
      first.commit({ context: entity.context, entity, entityId: "task", next }),
    ).resolves.toBeUndefined();
    await expect(
      second.commit({ context: entity.context, entity, entityId: "task", next }),
    ).resolves.toBeUndefined();
    await expect(
      second.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task", "different"),
      }),
    ).resolves.toBeUndefined();

    firstFactory.close();
    secondFactory.close();
  });

  it("lets started work release before the factory drain completes", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    driver.block('INSERT INTO "spine"."spine_examples_todo_task"');
    const inFlight = commit.commit({
      context: entity.context,
      entity,
      entityId: "task",
      next: record("task"),
    });
    await driver.waitUntilBlocked();

    factory.close();
    await Promise.resolve();
    await Promise.resolve();
    const drained = driver.waitUntilDrained();
    expect(driver.end).toHaveBeenCalledTimes(1);
    driver.unblock();

    await expect(inFlight).resolves.toBeUndefined();
    await drained;
    await expect(
      commit.commit({ context: entity.context, entity, entityId: "task", next: record("task") }),
    ).rejects.toThrow("closed");
  });
});

function entityInput(
  stateHistory = false,
  eventHistory = false,
): EntityStorageInput<string, ReturnType<typeof task>> {
  return {
    context: { name: "Tasks", multitenant: false },
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => Identifiers.pack(TaskIdSchema, create(TaskIdSchema, { value: id })),
      unpack: (packed) =>
        packed.typeUrl.endsWith(`/${TaskIdSchema.typeName}`)
          ? fromBinary(TaskIdSchema, packed.value).value
          : undefined,
    },
    columns: [],
    recordSpec: new RecordSpec({
      sourceType: TaskSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: () => "",
    }),
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
    stateHistory,
    eventHistory,
  };
}

function event(id: string, alternate = false): Event {
  const taskId = create(TaskIdSchema, { value: "task" });
  const message = alternate
    ? create(AnySchema, {
        typeUrl: `type.spine.io/${TaskRenamedSchema.typeName}`,
        value: toBinary(
          TaskRenamedSchema,
          create(TaskRenamedSchema, { id: taskId, title: "Changed" }),
        ),
      })
    : create(AnySchema, {
        typeUrl: `type.spine.io/${TaskCreatedSchema.typeName}`,
        value: toBinary(
          TaskCreatedSchema,
          create(TaskCreatedSchema, {
            id: taskId,
            title: "Created",
            taskListId: create(TaskListIdSchema, { value: "list-1" }),
          }),
        ),
      });
  return create(EventSchema, {
    id: { value: id },
    message,
  });
}

function columns(sql: string) {
  const base = [
    {
      column_name: "ID",
      data_type: "character varying",
      character_maximum_length: 512,
      is_nullable: "NO",
      column_default: null,
    },
    {
      column_name: "bytes",
      data_type: "bytea",
      character_maximum_length: null,
      is_nullable: "NO",
      column_default: null,
    },
  ];
  if (sql === "spine_core_event") {
    return [
      ...base,
      {
        column_name: "created",
        data_type: "bigint",
        character_maximum_length: null,
        is_nullable: "YES",
        column_default: null,
      },
      {
        column_name: "type",
        data_type: "text",
        character_maximum_length: null,
        is_nullable: "YES",
        column_default: null,
      },
    ];
  }
  return sql.endsWith("_entityrecord") || sql.endsWith("_event")
    ? [
        ...base,
        {
          column_name: "entity_id",
          data_type: "text",
          character_maximum_length: null,
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "created",
          data_type: "bigint",
          character_maximum_length: null,
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "version",
          data_type: "integer",
          character_maximum_length: null,
          is_nullable: "YES",
          column_default: null,
        },
      ]
    : base;
}

function record(id: string, state?: string): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: Identifiers.pack(TaskIdSchema, create(TaskIdSchema, { value: id })),
    state: Identifiers.pack(TaskSchema, task(state ?? id, id)),
  });
}

function task(title: string, id = "task") {
  return create(TaskSchema, {
    id: create(TaskIdSchema, { value: id }),
    title,
    taskListId: create(TaskListIdSchema, { value: "list-1" }),
  });
}

function postgresFactory() {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([TaskIdSchema, TaskSchema]));
  return PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
    .setStringifierRegistry(stringifiers)
    .build();
}
