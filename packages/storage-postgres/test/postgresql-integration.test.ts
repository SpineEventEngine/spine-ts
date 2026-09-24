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

import { create, fromBinary, type Message, ScalarType } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import {
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { ColumnTypes, RecordColumn, RecordSpec, StorageGroup } from "@spine-event-engine/storage";
import {
  EntityCommitStorageFactories,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { Identifiers, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { entityStorage } from "./postgres-entity-seam.js";

import { PostgresStorageFactory, type PostgresTableSpec } from "../src/index.js";

const url = requireUrl("SPINE_TS_POSTGRESQL_URL");
const tenantAUrl = requireUrl("SPINE_TS_POSTGRESQL_TENANT_A_URL");
const tenantBUrl = requireUrl("SPINE_TS_POSTGRESQL_TENANT_B_URL");
const expectedMajor = process.env.SPINE_TS_POSTGRESQL_EXPECTED_MAJOR;
const run = `${String(Date.now())}_${String(process.pid)}`;

interface SingleContext {
  readonly name: string;
  readonly multitenant: false;
}

describe("PostgreSQL live storage acceptance", () => {
  let factory: PostgresStorageFactory;

  beforeAll(async () => {
    await Promise.all([
      assertSupportedServer(url, expectedMajor),
      assertSupportedServer(tenantAUrl, expectedMajor),
      assertSupportedServer(tenantBUrl, expectedMajor),
    ]);
    factory = await postgresBuilder().setOptions({ url }).build();
  });

  afterAll(() => {
    factory.close();
  });

  it("creates catalog-compatible tables and performs CRUD, query, and compare-and-set", async () => {
    const storage = factory.createRecordStorage(context("records"), stringSpec(), group("records"));
    try {
      await storage.writeAll([value("b"), value("a")]);
      await expect(storage.read("a")).resolves.toEqual(value("a"));
      await expect(storage.query({ filters: [{ column: "value", value: "a" }] })).resolves.toEqual([
        value("a"),
      ]);
      await expect(
        storage.queryPlan({
          predicate: {
            kind: "comparison",
            column: "value",
            operator: "greaterOrEqual",
            value: "a",
          },
          order: [{ column: "value", direction: "desc" }],
          limit: 1,
        }),
      ).resolves.toEqual([value("b")]);
      await expect(storage.compareAndSet("a", value("a"), value("updated"))).resolves.toBe(true);
      await expect(storage.compareAndSet("a", value("a"), value("other"))).resolves.toBe(false);
      await expect(storage.read("a")).resolves.toEqual(value("updated"));
    } finally {
      storage.close();
    }
  });

  it("creates custom DDL in an explicit non-public schema", async () => {
    const schema = `t0230_pg_${run}_custom`;
    const catalog = new Pool({ connectionString: url });
    await catalog.query(`CREATE SCHEMA "${schema}"`);
    await catalog.end();
    const custom = await postgresBuilder()
      .setOptions({ url, schema })
      .useOperationFactory((table) => ({ sql: customCreate(table) }))
      .build();
    const storage = custom.createRecordStorage(context("custom"), stringSpec(), group("custom"));
    try {
      await storage.write(value("custom"));
      await expect(storage.read("custom")).resolves.toEqual(value("custom"));
    } finally {
      storage.close();
      custom.close();
    }
  });

  it("serializes competing compare-and-set operations from independent factories", async () => {
    const second = await postgresBuilder().setOptions({ url }).build();
    const scope = context("cas");
    const records = factory.createRecordStorage(scope, stringSpec(), group("cas"));
    const other = second.createRecordStorage(scope, stringSpec(), group("cas"));
    try {
      await records.write(value("before"));
      const results = await Promise.all([
        records.compareAndSet("before", value("before"), value("first")),
        other.compareAndSet("before", value("before"), value("second")),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      await expect(records.read("before")).resolves.toSatisfy(
        (stored: StringValue | undefined) =>
          stored?.value === "first" || stored?.value === "second",
      );
    } finally {
      records.close();
      other.close();
      second.close();
    }
  });

  it("keeps equal record families in their configured tenant databases", async () => {
    const tenantA = tenant("a");
    const tenantB = tenant("b");
    const tenants = await postgresBuilder()
      .setTenantOptions([
        { tenantId: tenantA, options: { url: tenantAUrl } },
        { tenantId: tenantB, options: { url: tenantBUrl } },
      ])
      .build();
    const storageGroup = group("tenants");
    const first = tenants.createRecordStorage(
      tenantContext("tenants", tenantA),
      stringSpec(),
      storageGroup,
    );
    const second = tenants.createRecordStorage(
      tenantContext("tenants", tenantB),
      stringSpec(),
      storageGroup,
    );
    try {
      await first.write(value("tenant-a"));
      await second.write(value("tenant-b"));
      await expect(
        first.queryPlan({ predicate: { kind: "ids", ids: ["tenant-a", "tenant-b"] } }),
      ).resolves.toEqual([value("tenant-a")]);
      await expect(
        second.queryPlan({ predicate: { kind: "ids", ids: ["tenant-a", "tenant-b"] } }),
      ).resolves.toEqual([value("tenant-b")]);
    } finally {
      first.close();
      second.close();
      tenants.close();
    }
  });

  it("commits Entity state and event histories atomically and maintains them in bounded pages", async () => {
    const scope = context("entity");
    const input = entityInput(scope);
    const id = entityId("history");
    const commits = EntityCommitStorageFactories.create(factory, input);
    const entity = entityStorage(factory, input);
    try {
      await expect(commits.commit(entityMutation(scope, input, id))).resolves.toBe("committed");
      await expect(entity.current.read(id)).resolves.toEqual(current(id, "next", 1));
      await expect(entity.states.backward(id, 10)).resolves.toHaveLength(1);
      await expect(entity.events.backward(id, 10)).resolves.toHaveLength(1);

      for (let version = 2; version <= 130; version += 1)
        await entity.states.append(current(id, `state-${String(version)}`, version));
      await entity.states.trim(id, 1);
      await expect(entity.states.backward(id, 200)).resolves.toEqual([
        current(id, "state-130", 130),
      ]);

      const truncationId = entityId("history-truncate");
      for (let version = 1; version <= 130; version += 1)
        await entity.states.append(current(truncationId, `state-${String(version)}`, version));
      await entity.states.truncate(create(TimestampSchema, { seconds: 131n }));
      await expect(entity.states.backward(id, 10)).resolves.toEqual([]);
      await expect(entity.states.backward(truncationId, 200)).resolves.toEqual([]);
    } finally {
      commits.close();
      entity.close();
    }
  });

  it("allows only one concurrent Entity commit with the same expected record", async () => {
    const second = await postgresBuilder().setOptions({ url }).build();
    const scope = context("entity_cas");
    const input = entityInput(scope, false, false);
    const id = entityId("cas");
    const firstCommit = EntityCommitStorageFactories.create(factory, input);
    const secondCommit = EntityCommitStorageFactories.create(second, input);
    try {
      const results = await Promise.all([
        firstCommit.commit({
          context: scope,
          entity: input,
          entityId: id,
          next: current(id, "a", 1),
        }),
        secondCommit.commit({
          context: scope,
          entity: input,
          entityId: id,
          next: current(id, "b", 1),
        }),
      ]);
      expect(results.filter((result) => result === "committed")).toHaveLength(1);
      expect(results.filter((result) => result === "conflict")).toHaveLength(1);
    } finally {
      firstCommit.close();
      secondCommit.close();
      second.close();
    }
  });

  it("closes live record handles and rejects new ones after pool draining begins", async () => {
    const closing = await postgresBuilder().setOptions({ url }).build();
    const scope = context("lifecycle");
    const records = closing.createRecordStorage(scope, stringSpec(), group("lifecycle"));
    closing.close();
    await Promise.resolve();

    expect(records.isOpen()).toBe(false);
    expect(() => closing.createRecordStorage(scope, stringSpec(), group("later"))).toThrow(
      /closed/i,
    );
  });
});

function stringSpec(): RecordSpec<string, StringValue> {
  return new RecordSpec({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
    columns: [
      new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
    ],
  });
}

function context(name: string): SingleContext {
  return { name: `t0230_pg_${run}_${name}`, multitenant: false };
}

function tenantContext(name: string, tenantId: ReturnType<typeof tenant>) {
  return { name: `t0230_pg_${run}_${name}`, multitenant: true, tenantId } as const;
}

function group(name: string): StorageGroup {
  return new StorageGroup(`t0230_pg_${run}_${name}`);
}

function entityId(name: string): string {
  return `t0230_pg_${run}_${name}`;
}

function postgresBuilder() {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
  return PostgresStorageFactory.newBuilder().setStringifierRegistry(stringifiers);
}

function value(text: string): StringValue {
  return create(StringValueSchema, { value: text });
}

function customCreate<I, R extends Message>(table: PostgresTableSpec<I, R>): string {
  const columns = table.columns
    .map(
      (column) =>
        `${quoted(column.name)} ${column.postgresType}${column.nullable ? "" : " NOT NULL"}`,
    )
    .join(", ");
  const target = `${quoted(table.schema)}.${quoted(table.tableName)}`;
  const primary = table.primaryKey.map(quoted).join(", ");
  return `CREATE TABLE IF NOT EXISTS ${target} (${columns}, PRIMARY KEY (${primary}))`;
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tenant(text: string) {
  return create(TenantIdSchema, { kind: { case: "value", value: text } });
}

function entityInput(
  context: SingleContext,
  stateHistory = true,
  eventHistory = true,
): EntityStorageInput<string, StringValue> {
  return {
    context,
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => Identifiers.pack(StringValueSchema, value(id)),
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
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("Entity record ID is required.");
        return fromBinary(StringValueSchema, record.entityId.value).value;
      },
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
    eventHistory,
  };
}

function current(id: string, state: string, version: number): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: Identifiers.pack(StringValueSchema, value(id)),
    state: Identifiers.pack(StringValueSchema, value(state)),
    lifecycleFlags: { archived: false, deleted: false },
    version: create(VersionSchema, {
      number: version,
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
    }),
  });
}

function entityMutation(
  context: SingleContext,
  entity: EntityStorageInput<string, StringValue>,
  id: string,
) {
  return {
    context,
    entity,
    entityId: id,
    next: current(id, "next", 1),
    states: [current(id, "next", 1)],
    diagnostics: [event(`${id}-diagnostic`, id)],
    events: [event(`${id}-delivery`, id)],
  };
}

function event(id: string, entityId: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: {
      producerId: Identifiers.pack(StringValueSchema, value(entityId)),
      version: create(VersionSchema, {
        number: 1,
        timestamp: create(TimestampSchema, { seconds: 1n }),
      }),
    },
  });
}

async function assertSupportedServer(
  databaseUrl: string,
  expected: string | undefined,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{ readonly server_version_num: string }>(
      "SHOW server_version_num",
    );
    const version = Number(result.rows[0]?.server_version_num);
    const major = Math.floor(version / 10_000);
    expect(Number.isInteger(major)).toBe(true);
    expect(major).toBeGreaterThanOrEqual(16);
    if (expected !== undefined) expect(major).toBe(Number(expected));
  } finally {
    await pool.end();
  }
}

function requireUrl(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}
