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
import { Int32ValueSchema, StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { Identifiers, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { RecordSpec } from "@spine-event-engine/storage";
import {
  EntityCommitStorageFactories,
  type EntityCommitInput,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    if (failure !== undefined && sql.includes(failure.sql) && failure.after-- === 1) {
      const next = failure.error;
      failure = undefined;
      return Promise.reject(next);
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
      const bytes = sql.includes('"google_protobuf_stringvalue"') ? current : immutable;
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
        if (sql.includes('"google_protobuf_stringvalue"')) current = bytes;
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

  it("prepares the current table before acquiring one transaction client", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const before = driver.connect.mock.calls.length;

    await expect(
      commit.commit({ context: entity.context, entity, entityId: "task", next: record("task") }),
    ).resolves.toBe("committed");

    expect(driver.connect).toHaveBeenCalledTimes(before + 2);
    expect(driver.query.mock.calls.map(([sql]) => sql)).toContain(
      'SELECT "bytes" FROM "spine"."google_protobuf_stringvalue" WHERE "ID" = $1 FOR UPDATE',
    );
  });

  it("retries a serialization failure once with a fresh transaction client", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const before = driver.connect.mock.calls.length;
    driver.failCommit(Object.assign(new Error("serialization"), { code: "40001" }));

    await expect(
      commit.commit({ context: entity.context, entity, entityId: "task", next: record("task") }),
    ).resolves.toBe("committed");

    expect(driver.connect).toHaveBeenCalledTimes(before + 3);
    expect(driver.query.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(1);
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

  it("prepares state history before acquiring its one operation client", async () => {
    const factory = await postgresFactory();
    const entity = entityInput(true);
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const before = driver.connect.mock.calls.length;

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task"),
        states: [record("task")],
      }),
    ).resolves.toBe("committed");

    expect(driver.connect).toHaveBeenCalledTimes(before + 3);
  });

  it("uses the same family and Entity advisory keys as state history", async () => {
    const factory = await postgresFactory();
    const entity = entityInput(true);
    const history = factory.createEntityStorage(entity);
    await history.states.append(record("task"));
    const historyKeys = driver.query.mock.calls
      .filter(([sql]) => sql.includes("pg_advisory_xact_lock"))
      .map(([, values]) => values[0]);
    driver.query.mockClear();
    const commit = EntityCommitStorageFactories.create(factory, entity);

    await commit.commit({
      context: entity.context,
      entity,
      entityId: "task",
      next: record("task"),
      states: [record("task")],
    });

    const commitKeys = driver.query.mock.calls
      .filter(([sql]) => sql.includes("pg_advisory_xact_lock"))
      .map(([, values]) => values[0]);
    expect(commitKeys).toEqual(expect.arrayContaining(historyKeys));
  });

  it("rolls back and releases after an Entity lock failure", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    driver.fail("pg_advisory_xact_lock($1)", new Error("lock failed"));

    await expect(
      commit.commit({ context: entity.context, entity, entityId: "task", next: record("task") }),
    ).rejects.toThrow("lock failed");

    expect(driver.query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
    expect(driver.release).toHaveBeenCalledTimes(2);
  });

  it("returns conflict from a locked current record without writes", async () => {
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
    ).resolves.toBe("conflict");

    expect(driver.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(
      writes,
    );
    driver.setCurrent(undefined);
  });

  it("rejects incompatible state schema and expected Entity identity before acquisition", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    const connections = driver.connect.mock.calls.length;

    await expect(
      commit.commit({
        context: entity.context,
        entity: { ...entity, stateSchema: Int32ValueSchema },
        entityId: "task",
        next: record("task"),
      }),
    ).rejects.toThrow("state schema");
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        expected: record("other"),
        next: record("task"),
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

  it("rolls back every transaction boundary without publishing a partial commit", async () => {
    const cases = transactionFailures();
    for (const candidate of cases) {
      driver.reset();
      const factory = await postgresFactory();
      const input = candidate.input();
      const commit = EntityCommitStorageFactories.create(factory, input.entity);
      driver.fail(candidate.sql, new Error(candidate.name), candidate.after);

      await expect(commit.commit(input)).rejects.toThrow();

      expect(driver.query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
      expect(driver.durableWrites()).toBe(0);
      factory.close();
    }
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
    ).resolves.toBe("committed");

    expect(driver.durableWrites()).toBe(4);
    expect(driver.query.mock.calls.filter(([sql]) => sql.includes("DO NOTHING"))).toHaveLength(3);
    factory.close();
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
    ).resolves.toBe("committed");

    const before = driver.durableWrites();
    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        expected: record("task"),
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
    ).resolves.toBe("committed");
    await expect(
      second.commit({ context: entity.context, entity, entityId: "task", next }),
    ).resolves.toBe("committed");
    await expect(
      second.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task", "different"),
      }),
    ).resolves.toBe("conflict");

    firstFactory.close();
    secondFactory.close();
  });

  it("lets started work release before the factory drain completes", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    driver.block("FOR UPDATE");
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

    await expect(inFlight).resolves.toBe("committed");
    await drained;
    await expect(
      commit.commit({ context: entity.context, entity, entityId: "task", next: record("task") }),
    ).rejects.toThrow("closed");
  });
});

function transactionFailures() {
  return [
    transactionFailure("state family lock", "pg_advisory_xact_lock_shared", stateCommit),
    transactionFailure("diagnostic family lock", "pg_advisory_xact_lock_shared", diagnosticCommit),
    transactionFailure("Entity lock", "pg_advisory_xact_lock($1)", currentCommit),
    transactionFailure("locked current read", "FOR UPDATE", currentCommit),
    transactionFailure("state preflight", 'SELECT "bytes"', stateCommit, 2),
    transactionFailure("diagnostic preflight", 'SELECT "bytes"', diagnosticCommit, 2),
    transactionFailure("delivery preflight", 'SELECT "bytes"', deliveryCommit, 2),
    transactionFailure("state append", "DO NOTHING", stateCommit),
    transactionFailure("diagnostic append", "DO NOTHING", diagnosticCommit),
    transactionFailure("delivery append", "DO NOTHING", deliveryCommit),
    transactionFailure("current write", "DO UPDATE", currentCommit),
    transactionFailure("commit", "COMMIT", currentCommit),
  ];
}

function transactionFailure(
  name: string,
  sql: string,
  input: () => EntityCommitInput<string, StringValue>,
  after = 1,
) {
  return { name, sql, input, after };
}

function currentCommit(): EntityCommitInput<string, StringValue> {
  const entity = entityInput();
  return { context: entity.context, entity, entityId: "task", next: record("task") };
}

function stateCommit(): EntityCommitInput<string, StringValue> {
  const entity = entityInput(true);
  return {
    context: entity.context,
    entity,
    entityId: "task",
    next: record("task"),
    states: [record("task")],
  };
}

function diagnosticCommit(): EntityCommitInput<string, StringValue> {
  const entity = entityInput(false, true);
  return {
    context: entity.context,
    entity,
    entityId: "task",
    next: record("task"),
    diagnostics: [event("diagnostic")],
  };
}

function deliveryCommit(): EntityCommitInput<string, StringValue> {
  const entity = entityInput();
  return {
    context: entity.context,
    entity,
    entityId: "task",
    next: record("task"),
    events: [event("delivery")],
  };
}

function entityInput(
  stateHistory = false,
  eventHistory = false,
): EntityStorageInput<string, StringValue> {
  return {
    context: { name: "Tasks", multitenant: false },
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => Identifiers.pack(StringValueSchema, create(StringValueSchema, { value: id })),
      unpack: (packed) =>
        packed.typeUrl.endsWith(`/${StringValueSchema.typeName}`)
          ? fromBinary(StringValueSchema, packed.value).value
          : undefined,
    },
    columns: [],
    recordSpec: new RecordSpec({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: () => "",
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
    eventHistory,
  };
}

function event(id: string, alternate = false): Event {
  return create(EventSchema, {
    id: { value: id },
    ...(alternate
      ? { message: { typeUrl: "type.spine.test/Changed", value: Uint8Array.of(1) } }
      : {}),
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
    entityId: Identifiers.pack(StringValueSchema, create(StringValueSchema, { value: id })),
    ...(state === undefined
      ? {}
      : {
          state: Identifiers.pack(StringValueSchema, create(StringValueSchema, { value: state })),
        }),
  });
}

function postgresFactory() {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
  return PostgresStorageFactory.newBuilder()
    .setOptions({ url: "postgresql://db.example/spine", schema: "spine" })
    .setStringifierRegistry(stringifiers)
    .build();
}
