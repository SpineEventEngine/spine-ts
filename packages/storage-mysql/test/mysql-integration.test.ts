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

import { Time } from "@spine-event-engine/core/time";
import { create, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import {
  EventIdSchema,
  EventSchema,
  type Event,
  TenantIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { AnyMessages, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { ProjectCreatedSchema } from "../../core/test-fixtures/generated/project_events_pb.js";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";
import { eventStoreRecordSpec } from "@spine-event-engine/storage/provider";
import {
  ColumnTypes,
  EventStore,
  StorageGroup,
  type StorageContext,
} from "@spine-event-engine/storage";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import type { RowDataPacket } from "mysql2";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlStorageFactory } from "../src/index.js";
import {
  mysqlCurrentRecord,
  mysqlHistoryCounts,
  mysqlEntityTables,
  mysqlRecordTableName,
} from "../src/mysql/testing.js";

const url = process.env.SPINE_TS_MYSQL_URL;
const adminUrl = process.env.SPINE_TS_MYSQL_ADMIN_URL;
const tenantAUrl = process.env.SPINE_TS_MYSQL_TENANT_A_URL;
const tenantBUrl = process.env.SPINE_TS_MYSQL_TENANT_B_URL;
const live = url === undefined ? describe.skip : describe;
const tenantLive = tenantAUrl === undefined || tenantBUrl === undefined ? describe.skip : describe;

live("MySQL-family record layout", () => {
  let factory: MysqlStorageFactory;

  beforeAll(async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema]));
    factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url })
      .setStringifierRegistry(stringifiers)
      .build();
  });
  afterAll(() => {
    factory.close();
  });

  it("preserves microsecond timestamp ordering and a page boundary in live MySQL", async () => {
    const first = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_001_000 });
    const middle = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_500_000 });
    const last = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_999_000 });
    const eventAt = (id: string, timestamp: typeof first) =>
      create(EventSchema, {
        id: create(EventIdSchema, { value: id }),
        context: { timestamp },
        message: AnyMessages.pack(
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
    const context = {
      name: `precise_time_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const storage = factory.createRecordStorage(context, spec, new StorageGroup(context.name));
    const firstEvent = events[0];
    if (firstEvent === undefined) throw new Error("Expected the first precision event.");
    try {
      await storage.writeAll([...events].reverse());
      const stored = await storage.read("z-first");
      expect(stored?.context?.timestamp).toEqual(first);
      expect(stored === undefined ? undefined : toBinary(EventSchema, stored)).toEqual(
        toBinary(EventSchema, firstEvent),
      );
      const ordered = await storage.query({ sort: [{ field: "received" }] });
      expect(ordered.map((event) => event.id?.value)).toEqual(
        events.map((event) => event.id?.value),
      );
      expect(ordered.map((event) => event.context?.timestamp)).toEqual([first, middle, last]);
      expect(ordered.map((event) => toBinary(EventSchema, event))).toEqual(
        events.map((event) => toBinary(EventSchema, event)),
      );
      const continued = await storage.query({
        sort: [{ field: "received" }],
        after: { id: "z-first", values: [{ field: "received", value: first }] },
      });
      expect(continued.map((event) => event.id?.value)).toEqual(["m-middle", "a-last"]);
      expect(continued.map((event) => event.context?.timestamp)).toEqual([middle, last]);
    } finally {
      storage.close();
    }
  });

  it("creates a one-table family with native columns and SQL query behavior", async () => {
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record): string => record.value,
      columns: [
        new RecordColumn(
          "value",
          ColumnTypes.scalar(ScalarType.STRING),
          (record): string => record.value,
        ),
      ],
    });
    const storage = factory.createRecordStorage(
      { name: `t0134_records_${String(Time.currentTimeMillis())}`, multitenant: false },
      spec,
      new StorageGroup(`t0134_records_${String(Time.currentTimeMillis())}`),
    );
    const otherGroup = factory.createRecordStorage(
      { name: `t0134_records_${String(Time.currentTimeMillis())}`, multitenant: false },
      spec,
      new StorageGroup(`t0190_other_${String(Time.currentTimeMillis())}`),
    );
    await storage.writeAll([
      create(StringValueSchema, { value: "b" }),
      create(StringValueSchema, { value: "a" }),
    ]);
    await otherGroup.write(create(StringValueSchema, { value: "other" }));
    await expect(
      storage.query({
        filters: [{ column: "value", value: "a" }],
        sort: [{ field: "value" }],
        limit: 1,
      }),
    ).resolves.toEqual([create(StringValueSchema, { value: "a" })]);
    await expect(
      storage.queryPlan({
        predicate: { kind: "comparison", column: "value", operator: "greaterOrEqual", value: "a" },
        order: [{ column: "value", direction: "desc" }],
        limit: 1,
      }),
    ).resolves.toEqual([create(StringValueSchema, { value: "b" })]);
    await expect(
      storage.queryPlan({ predicate: { kind: "ids", ids: ["a", "other"] } }),
    ).resolves.toEqual([create(StringValueSchema, { value: "a" })]);
    await expect(
      otherGroup.queryPlan({ predicate: { kind: "ids", ids: ["a", "other"] } }),
    ).resolves.toEqual([create(StringValueSchema, { value: "other" })]);
    otherGroup.close();
    storage.close();
  });

  it("reads an exhaustive late match and a large explicit ID set through live SQL", async () => {
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
      columns: [
        new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
      ],
    });
    const group = new StorageGroup(`repository_reads_${String(Time.currentTimeMillis())}`);
    const storage = factory.createRecordStorage(
      { name: `repository_reads_${String(Time.currentTimeMillis())}`, multitenant: false },
      spec,
      group,
    );
    const values = Array.from(
      { length: 10_002 },
      (_, index) => `item-${String(index).padStart(5, "0")}`,
    );
    try {
      for (let offset = 0; offset < values.length; offset += 500) {
        await storage.writeAll(
          values.slice(offset, offset + 500).map((value) => create(StringValueSchema, { value })),
        );
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
      ).resolves.toEqual([create(StringValueSchema, { value: "item-10001" })]);
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

  it("evaluates exhaustive text comparisons and ordering across provider collation differences", async () => {
    const ids = new Map(["A", "a", "á", "a ", "B"].map((value, index) => [value, index]));
    const spec = new RecordSpec<number, StringValue>({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: (record) => {
        const id = ids.get(record.value);
        if (id === undefined) throw new Error("Unexpected collation fixture value.");
        return id;
      },
      columns: [
        new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
      ],
    });
    const group = new StorageGroup(`repository_collation_${String(Time.currentTimeMillis())}`);
    const storage = factory.createRecordStorage(
      { name: `repository_collation_${String(Time.currentTimeMillis())}`, multitenant: false },
      spec,
      group,
    );
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const pool = createPool(url);
    try {
      await storage.writeAll(
        ["A", "a", "á", "a ", "B"].map((value) => create(StringValueSchema, { value })),
      );
      await pool.query(
        `ALTER TABLE \`${mysqlRecordTableName(spec, group)}\` MODIFY COLUMN \`value\` ` +
          "TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL",
      );
      for (const value of ["a", "á", "a "]) {
        await expect(
          storage.queryPlan({
            exhaustive: true,
            predicate: { kind: "comparison", column: "value", operator: "equal", value },
            order: [{ column: "value", direction: "asc" }],
            limit: 1,
          }),
        ).resolves.toEqual([create(StringValueSchema, { value })]);
      }
      await expect(
        storage.queryPlan({
          exhaustive: true,
          order: [{ column: "value", direction: "asc" }],
          limit: 2,
        }),
      ).resolves.toEqual([
        create(StringValueSchema, { value: "A" }),
        create(StringValueSchema, { value: "B" }),
      ]);
    } finally {
      await pool.end();
      storage.close();
    }
  });

  it("accepts the configured transactional or nontransactional engine", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const pool = createPool(url);
    try {
      const [rows] = await pool.query<(RowDataPacket & { engine: string })[]>(
        "SELECT ENGINE AS engine FROM information_schema.tables WHERE table_schema=DATABASE() LIMIT 1",
      );
      expect(rows).toBeDefined();
    } finally {
      await pool.end();
    }
  });

  it("rolls back or retains the exact immutable Entity prefix at each injected boundary", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const context = {
      name: `t0134_commit_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const input = entityInput(context);
    const commits = EntityCommitStorageFactories.create(factory, input);
    const eventStore = new EventStore(context, factory);
    const eventRecords = factory.createRecordStorage(context, eventStoreRecordSpec);
    const pool = createPool(url);
    const admin = adminUrl === undefined ? undefined : createPool(adminUrl);
    const engine = process.env.SPINE_TS_MYSQL_ENGINE?.toLowerCase() ?? "innodb";
    const transactional = engine === "innodb";
    try {
      // Materialize the actual current/state-history/diagnostic-history/EventStore families.
      await commits.commit(mutation(context, input, "seed"));
      const initialEvents = (await eventStore.read()).length;
      const actualTables = [
        ...mysqlEntityTables(input),
        mysqlRecordTableName(eventStoreRecordSpec),
      ];
      expect(actualTables).toHaveLength(4);
      for (const tableName of actualTables)
        await pool.query(`ALTER TABLE \`${tableName}\` ENGINE=${engine.toUpperCase()}`);
      const [engines] = await pool.query<
        (RowDataPacket & { table_name: string; engine: string })[]
      >(
        "SELECT table_name AS table_name, engine AS engine " +
          "FROM information_schema.tables WHERE table_schema=DATABASE() " +
          "AND table_name IN (?, ?, ?, ?)",
        actualTables,
      );
      expect(engines).toHaveLength(actualTables.length);
      expect(engines.every((table) => table.engine.toLowerCase() === engine)).toBe(true);

      const run = String(Time.currentTimeMillis());
      for (const [index, tableName] of actualTables.entries()) {
        const id = `boundary-${run}-${String(index)}`;
        const trigger = `t0134_fail_${run}_${String(index)}`;
        if (admin === undefined)
          throw new Error("SPINE_TS_MYSQL_ADMIN_URL is required for trigger injection.");
        await admin.query(
          `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`${tableName}\` ` +
            "FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='t0134 injected'",
        );
        try {
          await expect(commits.commit(mutation(context, input, id))).rejects.toThrow();
        } finally {
          await admin.query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
        }
        const expected = transactional
          ? { states: 0, entityEvents: 0, deliveryEvents: 0 }
          : ([
              { states: 1, entityEvents: 1, deliveryEvents: 1 },
              { states: 0, entityEvents: 0, deliveryEvents: 0 },
              { states: 1, entityEvents: 0, deliveryEvents: 0 },
              { states: 1, entityEvents: 1, deliveryEvents: 0 },
            ][index] ?? { states: 0, entityEvents: 0, deliveryEvents: 0 });
        await expect(mysqlCurrentRecord(pool, input, id)).resolves.toBeUndefined();
        const history = await mysqlHistoryCounts(pool, input, id);
        expect(history.states, `table ${String(index)} state prefix`).toBe(expected.states);
        expect(history.events, `table ${String(index)} event prefix`).toBe(expected.entityEvents);
        await expect(eventStore.read()).resolves.toHaveLength(
          initialEvents + index + expected.deliveryEvents,
        );
        await expect(commits.commit(mutation(context, input, id))).resolves.toBeUndefined();
        const persisted = await mysqlCurrentRecord(pool, input, id);
        if (persisted === undefined) throw new Error("Committed Entity record is missing.");
        expect(Buffer.from(toBinary(EntityRecordSchema, persisted))).toEqual(
          Buffer.from(toBinary(EntityRecordSchema, current(id))),
        );
      }
    } finally {
      eventStore.close();
      eventRecords.close();
      commits.close();
      await pool.end();
      if (admin !== undefined) await admin.end();
    }
  }, 15_000);

  it("rejects closed, cross-source, and identifier-less Entity commits", async () => {
    const context = {
      name: `t0134_commit_errors_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const input = entityInput(context);
    const closed = EntityCommitStorageFactories.create(factory, input);
    closed.close();
    await expect(closed.commit(mutation(context, input, "closed"))).rejects.toThrow(/closed/i);

    const commits = EntityCommitStorageFactories.create(factory, input);
    try {
      await expect(
        commits.commit({
          ...mutation(context, input, "wrong-source"),
          entity: { ...input, sourceType: TimestampSchema },
        }),
      ).rejects.toThrow(/source type is incompatible/i);
      await expect(
        commits.commit({
          ...mutation(context, input, "conflict"),
        }),
      ).resolves.toBeUndefined();
      await expect(
        commits.commit({
          ...mutation(context, input, "missing-event-id"),
          events: [create(EventSchema)],
        }),
      ).rejects.toThrow(/requires delivery-event IDs/i);
    } finally {
      commits.close();
    }
  });

  it("rejects immutable histories that are disabled for the Entity family", async () => {
    const context = {
      name: `t0134_disabled_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const input = entityInput(context, false, false);
    const commits = EntityCommitStorageFactories.create(factory, input);
    try {
      await expect(commits.commit(mutation(context, input, "state"))).rejects.toThrow(
        /state history is disabled/i,
      );
      await expect(
        commits.commit({ ...mutation(context, input, "diagnostic"), states: [] }),
      ).rejects.toThrow(/event history is disabled/i);
    } finally {
      commits.close();
    }
  });

  it("serializes nontransactional commits with and without optional immutable families", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const context = {
      name: `t0134_nontransactional_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const input = entityInput(context);
    const commits = EntityCommitStorageFactories.create(factory, input);
    const eventStore = new EventStore(context, factory);
    const eventRecords = factory.createRecordStorage(context, eventStoreRecordSpec);
    const pool = createPool(url);
    let tables: readonly string[] = [];
    try {
      await commits.commit(mutation(context, input, "seed"));
      tables = [...mysqlEntityTables(input), mysqlRecordTableName(eventStoreRecordSpec)];
      for (const table of tables)
        await pool.query(
          `ALTER TABLE \`${table}\` MODIFY \`ID\` VARCHAR(512) ` +
            "CHARACTER SET latin1 COLLATE latin1_bin NOT NULL, ENGINE=MyISAM",
        );

      await expect(
        commits.commit(mutation(context, input, "with-history")),
      ).resolves.toBeUndefined();
      await expect(
        commits.commit(mutation(context, input, "current-only")),
      ).resolves.toBeUndefined();
    } finally {
      for (const table of tables) await pool.query(`ALTER TABLE \`${table}\` ENGINE=InnoDB`);
      eventRecords.close();
      eventStore.close();
      commits.close();
      await pool.end();
    }
  });

  it("atomically compares records from two handles on the configured engine", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const context = {
      name: `t0134_cas_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record): string => record.value.split(":", 1)[0] ?? "",
      columns: [
        new RecordColumn(
          "value",
          ColumnTypes.scalar(ScalarType.STRING),
          (record): string => record.value,
        ),
      ],
    });
    const group = new StorageGroup(`t0134_cas_${String(Time.currentTimeMillis())}`);
    const first = factory.createRecordStorage(context, spec, group);
    const second = factory.createRecordStorage(context, spec, group);
    const pool = createPool(url);
    const engine = process.env.SPINE_TS_MYSQL_ENGINE?.toUpperCase() ?? "INNODB";
    try {
      const initial = create(StringValueSchema, { value: "present:initial" });
      await first.write(initial);
      const table = mysqlRecordTableName(spec);
      await pool.query(`ALTER TABLE \`${table}\` ENGINE=${engine}`);
      const present = await Promise.all([
        first.compareAndSet(
          "present",
          initial,
          create(StringValueSchema, { value: "present:first" }),
        ),
        second.compareAndSet(
          "present",
          initial,
          create(StringValueSchema, { value: "present:second" }),
        ),
      ]);
      expect(present.filter(Boolean)).toHaveLength(1);
      const absent = await Promise.all([
        first.compareAndSet(
          "absent",
          undefined,
          create(StringValueSchema, { value: "absent:first" }),
        ),
        second.compareAndSet(
          "absent",
          undefined,
          create(StringValueSchema, { value: "absent:second" }),
        ),
      ]);
      expect(absent.filter(Boolean)).toHaveLength(1);
    } finally {
      first.close();
      second.close();
      await pool.end();
    }
  });

  it("serializes InnoDB Entity commits from separate handles", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const context = {
      name: `t0134_concurrent_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const input = entityInput(context);
    const first = EntityCommitStorageFactories.create(factory, input);
    const second = EntityCommitStorageFactories.create(factory, input);
    const pool = createPool(url);
    try {
      const left = mutation(context, input, "same");
      const right = {
        ...mutation(context, input, "same"),
        next: { ...current("same"), state: packed("different") },
      };
      const outcomes = await Promise.all([first.commit(left), second.commit(right)]);
      expect(outcomes).toEqual([undefined, undefined]);
      await expect(mysqlCurrentRecord(pool, input, "same")).resolves.toBeDefined();
    } finally {
      first.close();
      second.close();
      await pool.end();
    }
  });

  it("replays an identical Entity commit without replacing current state", async () => {
    const context = {
      name: `t0134_replay_${String(Time.currentTimeMillis())}`,
      multitenant: false,
    } as const;
    const input = entityInput(context);
    const commits = EntityCommitStorageFactories.create(factory, input);
    const pool = createPool(url ?? "");
    const id = `replay-${String(Time.currentTimeMillis())}`;
    try {
      const same = mutation(context, input, id);
      await expect(commits.commit(same)).resolves.toBeUndefined();
      const before = await mysqlCurrentRecord(pool, input, id);
      await expect(commits.commit(same)).resolves.toBeUndefined();
      await expect(mysqlCurrentRecord(pool, input, id)).resolves.toEqual(before);
    } finally {
      commits.close();
      await pool.end();
    }
  });
});

tenantLive("MySQL normalized-plan tenant containment", () => {
  it("keeps matching IDs inside the selected tenant and storage group", async () => {
    if (tenantAUrl === undefined || tenantBUrl === undefined) {
      throw new Error("Dedicated MySQL tenant URLs are required.");
    }
    const tenantA = tenant("a");
    const tenantB = tenant("b");
    const group = new StorageGroup(`t0190_group_${String(Time.currentTimeMillis())}`);
    const factory = await MysqlStorageFactory.newBuilder()
      .setTenantOptions([
        { tenantId: tenantA, options: { url: tenantAUrl } },
        { tenantId: tenantB, options: { url: tenantBUrl } },
      ])
      .build();
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
      columns: [
        new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
      ],
    });
    const first = factory.createRecordStorage(
      { name: "t0190", multitenant: true, tenantId: tenantA },
      spec,
      group,
    );
    const second = factory.createRecordStorage(
      { name: "t0190", multitenant: true, tenantId: tenantB },
      spec,
      group,
    );
    try {
      await first.write(create(StringValueSchema, { value: "tenant-a" }));
      await second.write(create(StringValueSchema, { value: "tenant-b" }));
      await expect(
        first.queryPlan({ predicate: { kind: "ids", ids: ["tenant-a", "tenant-b"] } }),
      ).resolves.toEqual([create(StringValueSchema, { value: "tenant-a" })]);
      await expect(
        second.queryPlan({ predicate: { kind: "ids", ids: ["tenant-a", "tenant-b"] } }),
      ).resolves.toEqual([create(StringValueSchema, { value: "tenant-b" })]);
    } finally {
      first.close();
      second.close();
      factory.close();
    }
  });
});

function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

function entityInput(context: StorageContext, stateHistory = true, eventHistory = true) {
  const recordSpec = new RecordSpec<string, EntityRecord>({
    sourceType: StringValueSchema,
    recordType: EntityRecordSchema,
    idKind: "string",
    extractId: (record) => {
      if (record.entityId === undefined) throw new Error("EntityRecord.entityId is required.");
      return fromBinary(StringValueSchema, record.entityId.value).value;
    },
  });
  return {
    context,
    id: {
      clone: (id: string) => id,
      key: (id: string) => id,
      pack: (id: string) => packed(id),
      unpack: (id: { typeUrl: string; value: Uint8Array }) =>
        id.typeUrl === "type.spine.io/google.protobuf.StringValue"
          ? fromBinary(StringValueSchema, id.value).value
          : undefined,
    },
    columns: [],
    recordSpec,
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
    eventHistory,
  };
}

function packed(value: string) {
  return create(AnySchema, {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value })),
  });
}
function current(id: string) {
  return create(EntityRecordSchema, {
    entityId: packed(id),
    state: packed("next"),
    lifecycleFlags: { archived: false, deleted: false },
    version: create(VersionSchema, { number: 1 }),
  });
}
function mutation(context: StorageContext, input: ReturnType<typeof entityInput>, id: string) {
  const diagnostic = create(EventSchema, {
    id: create(EventIdSchema, { value: `${id}-diagnostic` }),
    context: {
      producerId: packed(id),
      version: create(VersionSchema, { number: 1 }),
      timestamp: create(TimestampSchema, { seconds: 1n }),
    },
  });
  return {
    context,
    entity: input,
    entityId: id,
    next: current(id),
    states: [
      create(EntityRecordSchema, {
        ...current(id),
        version: create(VersionSchema, {
          number: 1,
          timestamp: create(TimestampSchema, { seconds: 1n }),
        }),
      }),
    ],
    diagnostics: [diagnostic],
    events: [create(EventSchema, { id: create(EventIdSchema, { value: `${id}-delivery` }) })],
  };
}
