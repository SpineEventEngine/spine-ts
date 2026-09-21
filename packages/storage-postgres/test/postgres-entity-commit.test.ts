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
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

const driver = vi.hoisted(() => {
  let commitFailure: Error | undefined;
  let current: Uint8Array | undefined;
  const query = vi.fn((sql: string, values: readonly unknown[] = []) => {
    if (sql.includes("schemata")) return Promise.resolve({ rowCount: 1, rows: [] });
    if (sql.includes("columns WHERE")) return Promise.resolve({ rows: columns(String(values[1])) });
    if (sql.includes("PRIMARY KEY"))
      return Promise.resolve({ rows: [{ column_name: "ID", ordinal_position: 1 }] });
    if (sql.startsWith('SELECT "bytes"'))
      return Promise.resolve({ rows: current === undefined ? [] : [{ bytes: current }] });
    if (sql === "COMMIT" && commitFailure !== undefined) {
      const failure = commitFailure;
      commitFailure = undefined;
      return Promise.reject(failure);
    }
    return Promise.resolve({ rowCount: 1, rows: [] });
  });
  const release = vi.fn();
  const connect = vi.fn(() => Promise.resolve({ query, release }));
  const Pool = vi.fn(function Pool() {
    return { connect, end: vi.fn(() => Promise.resolve()) };
  });
  return {
    Pool,
    connect,
    query,
    release,
    failCommit: (error: Error | undefined) => (commitFailure = error),
    setCurrent: (record: EntityRecord | undefined) =>
      (current = record === undefined ? undefined : toBinary(EntityRecordSchema, record)),
  };
});

vi.mock("pg", () => ({ Pool: driver.Pool }));

import { PostgresStorageFactory } from "../src/index.js";

describe("PostgreSQL Entity commit", () => {
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

  it("returns conflict from a locked current record without writes", async () => {
    const factory = await postgresFactory();
    const entity = entityInput();
    const commit = EntityCommitStorageFactories.create(factory, entity);
    driver.setCurrent(record("task"));
    const writes = driver.query.mock.calls.filter(([sql]) =>
      String(sql).startsWith("INSERT"),
    ).length;

    await expect(
      commit.commit({
        context: entity.context,
        entity,
        entityId: "task",
        next: record("task", "next"),
      }),
    ).resolves.toBe("conflict");

    expect(
      driver.query.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT")),
    ).toHaveLength(writes);
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
        entity: { ...entity, stateSchema: Int32ValueSchema } as never,
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
});

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

function event(id: string): Event {
  return create(EventSchema, { id: { value: id } });
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
  return sql === "google_protobuf_stringvalue"
    ? base
    : [
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
      ];
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
