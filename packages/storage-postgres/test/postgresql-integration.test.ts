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

import { create, toBinary, type Message, ScalarType } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import {
  EventIdSchema,
  EventSchema,
  type Event,
  TenantIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  ColumnTypes,
  EventStore,
  RecordColumn,
  RecordSpec,
  StorageGroup,
} from "@spine-event-engine/storage";
import {
  EntityCommitStorageFactories,
  AgentHistoryStorageFactories,
  StoragePreparations,
  eventHistorySpec,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import {
  AnyPacker,
  Identifiers,
  StringifierRegistry,
  TypeRegistry,
} from "@spine-event-engine/core";
import { ProjectCreatedSchema } from "../../core/test-fixtures/generated/project_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskCreatedSchema } from "../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import { TaskSchema } from "../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { entityStorage } from "./postgres-entity-seam.js";
import {
  scope as agentScope,
  event as agentEvent,
  occurredAt,
} from "../../storage/test/entity/agent-history-fixtures.js";

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

  afterAll(async () => {
    await factory.close();
  });

  it("checks a physical family read-only and prepares the surviving Agent audit indexes", async () => {
    const preparation = StoragePreparations.for(factory);
    const scope = context("preparation");
    const group = new StorageGroup(`pg_prep_${run}`);
    const spec = new RecordSpec({
      recordType: EventSchema,
      idSchema: EventIdSchema,
      extractId: (value: Event) => {
        if (value.id === undefined) throw new Error("Event ID is required.");
        return value.id;
      },
    });
    await expect(preparation.prepareRecord(scope, spec, group, "check")).rejects.toThrow();
    await preparation.prepareRecord(scope, spec, group, "create");
    await preparation.prepareRecord(scope, spec, group, "check");
    const records = factory.createRecordStorage(scope, spec, group);
    try {
      const stored = event(`prepared-${run}`, "task");
      if (stored.id === undefined) throw new Error("Event ID is required.");
      await records.write(stored);
      await expect(records.read(stored.id)).resolves.toEqual(stored);
    } finally {
      records.close();
    }
    await preparation.prepareAgentHistory(agentScope, "create");
    await preparation.prepareAgentHistory(agentScope, "check");
    const entity = entityInput(context("prepared_entity"));
    await preparation.prepareEntity(entity, "create");
    await preparation.prepareEntity(entity, "check");
    const history = AgentHistoryStorageFactories.create(factory, agentScope);
    try {
      const entry = agentEvent(`prepared-${run}`, occurredAt(1_789_000_011n), false);
      await history.append(`ticket-${run}`, entry);
      const page = await history.read({
        entityId: `ticket-${run}`,
        view: { kind: "full" },
        count: 2,
        maxBytes: 100_000,
      });
      expect(page.entries).toEqual([entry]);
    } finally {
      history.close();
    }
  });

  it("keeps an immutable EventStore prefix and admits the same complete Events on retry", async () => {
    const scope = context("event_retry");
    const first = new EventStore(scope, factory);
    const second = new EventStore(scope, factory);
    const firstEvent = event(`${run}-first`, "task-1");
    const secondEvent = event(`${run}-second`, "task-2");
    if (firstEvent.id === undefined || secondEvent.id === undefined)
      throw new Error("Expected Event IDs.");
    const records = [firstEvent, secondEvent];
    const query = { ids: [firstEvent.id, secondEvent.id] };
    try {
      await first.append(firstEvent);
      if (process.env.SPINE_TS_TRACE_MARKERS === "1") {
        const marker = new Pool({ connectionString: url });
        try {
          await marker.query("SELECT 'spine_trace_begin_immutable_append' AS marker");
        } finally {
          await marker.end();
        }
      }
      await expect(second.appendAll(records)).resolves.toBeUndefined();
      await expect(first.read(query)).resolves.toEqual(records);
      const identical = await Promise.allSettled([
        first.append(secondEvent),
        second.append(secondEvent),
      ]);
      expect(identical.every(({ status }) => status === "fulfilled")).toBe(true);
      await expect(second.append(event(`${run}-second`, "other-task"))).rejects.toThrow(
        /unique event IDs/,
      );
      await expect(first.read(query)).resolves.toEqual(records);
      if (process.env.SPINE_TS_TRACE_MARKERS === "1") {
        const marker = new Pool({ connectionString: url });
        try {
          await marker.query("SELECT 'spine_trace_end_immutable_append' AS marker");
        } finally {
          await marker.end();
        }
      }
    } finally {
      await first.close();
      await second.close();
    }
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

  it("preserves microsecond timestamp ordering and a page boundary in live PostgreSQL", async () => {
    const first = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_001_000 });
    const middle = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_500_000 });
    const last = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_999_000 });
    const eventAt = (id: string, timestamp: typeof first) =>
      create(EventSchema, {
        id: create(EventIdSchema, { value: id }),
        context: { timestamp },
        message: AnyPacker.pack(
          ProjectCreatedSchema,
          create(ProjectCreatedSchema, {
            memberId: [`member-${id}`],
          }),
        ),
      });
    const events = [
      eventAt("z-first", first),
      eventAt("m-middle", middle),
      eventAt("a-last", last),
    ];
    const spec = new RecordSpec<string, Event>({
      recordType: EventSchema,
      idKind: "string",
      extractId: (record) => record.id?.value ?? "",
      columns: [
        new RecordColumn(
          "received",
          ColumnTypes.message(TimestampSchema),
          (record) => record.context?.timestamp,
        ),
      ],
    });
    const storage = factory.createRecordStorage(
      context("precise_time"),
      spec,
      group("precise_time"),
    );
    try {
      await storage.writeAll([...events].reverse());
      await expect(storage.read("z-first")).resolves.toEqual(events[0]);
      await expect(storage.query({ sort: [{ field: "received" }] })).resolves.toEqual([...events]);
      await expect(
        storage.query({
          sort: [{ field: "received" }],
          after: { id: "z-first", values: [{ field: "received", value: first }] },
        }),
      ).resolves.toEqual(events.slice(1));
    } finally {
      storage.close();
    }
  });

  it("reads an exhaustive late match and a large explicit ID set through live SQL", async () => {
    const storage = factory.createRecordStorage(
      context("repository_reads"),
      stringSpec(),
      group("repository_reads"),
    );
    const values = Array.from(
      { length: 10_002 },
      (_, index) => `item-${String(index).padStart(5, "0")}`,
    );
    try {
      for (let offset = 0; offset < values.length; offset += 500) {
        await storage.writeAll(values.slice(offset, offset + 500).map(value));
      }
      expect(
        (
          await storage.queryPlan({
            exhaustive: true,
            order: [{ column: "value", direction: "asc" }],
          })
        ).map((record) => record.value),
      ).toEqual(values);
      await expect(
        storage.queryPlan({
          exhaustive: true,
          predicate: {
            kind: "comparison",
            column: "value",
            operator: "greaterThan",
            value: "item-10000",
          },
          order: [{ column: "value", direction: "asc" }],
          limit: 1,
        }),
      ).resolves.toEqual([value("item-10001")]);
      await expect(
        storage.queryPlan({
          exhaustive: true,
          predicate: { kind: "ids", ids: values.slice(0, 1_001) },
        }),
      ).resolves.toHaveLength(1_001);
    } finally {
      storage.close();
    }
  }, 120_000);

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
      await custom.close();
    }
  });

  it("serializes competing compare-and-set operations from independent factories", async () => {
    const second = await postgresBuilder().setOptions({ url }).build();
    const scope = context("cas");
    const records = factory.createRecordStorage(scope, stringSpec(), group("cas"));
    const other = second.createRecordStorage(scope, stringSpec(), group("cas"));
    const pool = new Pool({ connectionString: url });
    try {
      await records.write(value("before"));
      const encoded = Buffer.from(toBinary(StringValueSchema, value("before")));
      const table = (records as unknown as { tableName: string }).tableName;
      await pool.query(`UPDATE ${quoted(table)} SET "bytes"=$1 WHERE "ID"=$2`, [
        Buffer.concat([encoded, encoded]),
        "before",
      ]);
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
      await second.close();
      await pool.end();
    }
  });

  it("retains an Event batch prefix after a later SQL constraint failure", async () => {
    const spec = new RecordSpec<string, Event>({
      recordType: EventSchema,
      idKind: "string",
      extractId: (event) => event.id?.value ?? "",
    });
    const records = factory.createRecordStorage(
      context("partial_events"),
      spec,
      group("partial_events"),
    );
    const pool = new Pool({ connectionString: url });
    const event = (id: string, member = id) =>
      create(EventSchema, {
        id: create(EventIdSchema, { value: id }),
        message: AnyPacker.pack(
          ProjectCreatedSchema,
          create(ProjectCreatedSchema, { memberId: [member] }),
        ),
      });
    try {
      await records.write(event("seed"));
      const table = (records as unknown as { tableName: string }).tableName;
      const schema = (await pool.query<{ schema: string }>("SELECT current_schema() AS schema"))
        .rows[0]?.schema;
      if (schema === undefined) throw new Error("Expected the active PostgreSQL schema.");
      await pool.query(
        `ALTER TABLE ${quoted(schema)}.${quoted(table)} ADD CONSTRAINT "reject_second" CHECK ("ID" <> 'second')`,
      );
      await expect(records.writeAll([event("first"), event("second")])).rejects.toThrow();
      await expect(records.read("first")).resolves.toEqual(event("first"));
      await expect(records.read("second")).resolves.toBeUndefined();
      const immutable = records as unknown as { writeImmutable(record: Event): Promise<void> };
      await expect(immutable.writeImmutable(event("first"))).resolves.toBeUndefined();
      await expect(immutable.writeImmutable(event("first", "conflict"))).rejects.toThrow(
        /collides/i,
      );
      await expect(records.read("first")).resolves.toEqual(event("first"));
      const contenders = [event("race", "left"), event("race", "right")];
      const results = await Promise.allSettled(
        contenders.map((candidate) => immutable.writeImmutable(candidate)),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const winner = await records.read("race");
      expect(contenders.map((candidate) => toBinary(EventSchema, candidate))).toContainEqual(
        winner === undefined ? undefined : toBinary(EventSchema, winner),
      );
    } finally {
      records.close();
      await pool.end();
    }
  });

  it("keeps equal record families in their configured tenant databases", async () => {
    const tenantA = tenant("a");
    const tenantB = tenant("b");
    const tenants = await postgresBuilder()
      .setOptions({ url })
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
      await tenants.close();
    }
  });

  it("writes Entity state and event histories and maintains them in bounded pages", async () => {
    const scope = context("entity");
    const input = entityInput(scope);
    const id = entityId("history");
    const commits = EntityCommitStorageFactories.create(factory, input);
    const entity = entityStorage(factory, input);
    try {
      await expect(commits.commit(entityMutation(scope, input, id))).resolves.toBeUndefined();
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
      await commits.close();
      entity.close();
    }
  });

  it("retains Entity state history when a later diagnostic insert fails", async () => {
    const scope = context("entity_partial");
    const input = entityInput(scope);
    const entity = entityStorage(factory, input);
    const commits = EntityCommitStorageFactories.create(factory, input);
    const events = new EventStore(scope, factory);
    const layout = eventHistorySpec(TaskSchema);
    const diagnosticRecords = factory.createRecordStorage(scope, layout.spec, layout.group);
    const pool = new Pool({ connectionString: url });
    const mutation = entityMutation(scope, input, "partial");
    const diagnostic = mutation.diagnostics[0];
    const constraint = `reject_partial_${run}`;
    let target: string | undefined;
    if (diagnostic === undefined) throw new Error("Expected a diagnostic Event.");
    try {
      await diagnosticRecords.write(event("seed-diagnostic", "seed"));
      const table = (diagnosticRecords as unknown as { tableName: string }).tableName;
      const schema = (await pool.query<{ schema: string }>("SELECT current_schema() AS schema"))
        .rows[0]?.schema;
      if (schema === undefined) throw new Error("Expected the active PostgreSQL schema.");
      target = `${quoted(schema)}.${quoted(table)}`;
      await pool.query(
        `ALTER TABLE ${target} DROP CONSTRAINT IF EXISTS "reject_partial_diagnostic"`,
      );
      const rejectedBytes = Buffer.from(toBinary(EventSchema, diagnostic)).toString("hex");
      await pool.query(
        `ALTER TABLE ${target} ` +
          `ADD CONSTRAINT ${quoted(constraint)} CHECK ("bytes" <> decode('${rejectedBytes}', 'hex'))`,
      );
      await expect(commits.commit(mutation)).rejects.toThrow();
      await expect(entity.states.backward("partial", 1)).resolves.toEqual(mutation.states);
      await expect(entity.events.backward("partial", 1)).resolves.toEqual([]);
      await expect(entity.current.read("partial")).resolves.toBeUndefined();
      await expect(
        events.read({ ids: [create(EventIdSchema, { value: "partial-delivery" })] }),
      ).resolves.toEqual([]);
    } finally {
      if (target !== undefined)
        await pool.query(`ALTER TABLE ${target} DROP CONSTRAINT IF EXISTS ${quoted(constraint)}`);
      diagnosticRecords.close();
      await events.close();
      await commits.close();
      entity.close();
      await pool.end();
    }
  });

  it("persists a completed Entity state from concurrent handles", async () => {
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
      expect(results).toEqual([undefined, undefined]);
      const reader = entityStorage(second, input);
      try {
        const stored = await reader.current.read(id);
        const allowed = [current(id, "a", 1), current(id, "b", 1)].map((record) =>
          toBinary(EntityRecordSchema, record),
        );
        expect(allowed).toContainEqual(
          stored === undefined ? undefined : toBinary(EntityRecordSchema, stored),
        );
        await expect(reader.states.backward(id, 1)).resolves.toEqual([]);
        await expect(reader.events.backward(id, 1)).resolves.toEqual([]);
      } finally {
        reader.close();
      }
    } finally {
      await firstCommit.close();
      await secondCommit.close();
      await second.close();
    }
  });

  it("closes live record handles and rejects new ones after pool draining begins", async () => {
    const closing = await postgresBuilder().setOptions({ url }).build();
    const scope = context("lifecycle");
    const records = closing.createRecordStorage(scope, stringSpec(), group("lifecycle"));
    await closing.close();
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
  stringifiers.setTypeRegistry(
    new TypeRegistry([
      StringValueSchema,
      TaskIdSchema,
      TaskListIdSchema,
      TaskSchema,
      TaskCreatedSchema,
    ]),
  );
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
): EntityStorageInput<string, ReturnType<typeof task>> {
  return {
    context,
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => Identifiers.pack(TaskIdSchema, create(TaskIdSchema, { value: id })),
      unpack: (packed) =>
        packed.typeUrl.endsWith(`/${TaskIdSchema.typeName}`)
          ? AnyPacker.tryUnpack(packed, TaskIdSchema)?.value
          : undefined,
    },
    columns: [],
    recordSpec: new RecordSpec({
      sourceType: TaskSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("Entity record ID is required.");
        return AnyPacker.unpack(record.entityId, TaskIdSchema).value;
      },
    }),
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
    stateHistory,
    eventHistory,
  };
}

function current(id: string, state: string, version: number): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: Identifiers.pack(TaskIdSchema, create(TaskIdSchema, { value: id })),
    state: Identifiers.pack(TaskSchema, task(state, id)),
    lifecycleFlags: { archived: false, deleted: false },
    version: create(VersionSchema, {
      number: version,
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
    }),
  });
}

function entityMutation(
  context: SingleContext,
  entity: EntityStorageInput<string, ReturnType<typeof task>>,
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
      producerId: Identifiers.pack(TaskIdSchema, create(TaskIdSchema, { value: entityId })),
      version: create(VersionSchema, {
        number: 1,
        timestamp: create(TimestampSchema, { seconds: 1n }),
      }),
    },
    message: AnyPacker.pack(
      TaskCreatedSchema,
      create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: entityId }),
        title: "Created",
        taskListId: create(TaskListIdSchema, { value: "list-1" }),
      }),
    ),
  });
}

function task(title: string, id: string) {
  return create(TaskSchema, {
    id: create(TaskIdSchema, { value: id }),
    title,
    taskListId: create(TaskListIdSchema, { value: "list-1" }),
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
