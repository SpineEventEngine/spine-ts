import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  StringValueSchema,
  TimestampSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/internal/entity-commit";
import { eventStoreRecordSpec } from "@spine-event-engine/storage/internal/event-store";
import { EventStore } from "@spine-event-engine/storage";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MysqlStorageFactory } from "../src/index.js";
import {
  mysqlCurrentRecordForTesting,
  mysqlCurrentRevisionForTesting,
  mysqlEntityHistoryCountsForTesting,
  mysqlEntityTableNamesForTesting,
  mysqlRecordTableNameForTesting,
} from "../src/mysql/testing.js";

const url = process.env.SPINE_TS_MYSQL_URL;
const adminUrl = process.env.SPINE_TS_MYSQL_ADMIN_URL;
const live = url === undefined ? describe.skip : describe;

live("MySQL-family record layout", () => {
  let factory: MysqlStorageFactory;

  beforeAll(async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    factory = await MysqlStorageFactory.newBuilder().setOptions({ url }).build();
  });
  afterAll(() => {
    factory.close();
  });

  it("creates a one-table family with native columns and SQL query behavior", async () => {
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record): string => record.value,
      columns: [new RecordColumn("value", (record): string => record.value, "string")],
    });
    const storage = factory.createRecordStorage(
      { name: `t0134_records_${String(Date.now())}`, multitenant: false },
      spec,
    );
    await storage.writeAll([
      create(StringValueSchema, { value: "b" }),
      create(StringValueSchema, { value: "a" }),
    ]);
    await expect(
      storage.query({
        filters: [{ column: "value", value: "a" }],
        sort: [{ field: "value" }],
        limit: 1,
      }),
    ).resolves.toEqual([create(StringValueSchema, { value: "a" })]);
    storage.close();
  });

  it("accepts the configured transactional or nontransactional engine", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const pool = createPool(url);
    try {
      const [rows] = await pool.query<{ engine: string }[]>(
        "SELECT ENGINE AS engine FROM information_schema.tables WHERE table_schema=DATABASE() LIMIT 1",
      );
      expect(rows).toBeDefined();
    } finally {
      await pool.end();
    }
  });

  it("rolls back or retains the exact immutable Entity prefix at each injected boundary", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const context = { name: `t0134_commit_${String(Date.now())}`, multitenant: false };
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
        ...mysqlEntityTableNamesForTesting(input),
        mysqlRecordTableNameForTesting(eventStoreRecordSpec),
      ];
      expect(actualTables).toHaveLength(4);
      for (const tableName of actualTables)
        await pool.query(`ALTER TABLE \`${tableName}\` ENGINE=${engine.toUpperCase()}`);
      const [engines] = await pool.query<{ table_name: string; engine: string }[]>(
        "SELECT table_name AS table_name, engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?, ?, ?, ?)",
        actualTables,
      );
      expect(engines).toHaveLength(actualTables.length);
      expect(engines.every((table) => table.engine.toLowerCase() === engine)).toBe(true);

      for (const [index, tableName] of actualTables.entries()) {
        const id = `boundary-${String(index)}`;
        const trigger = `t0134_fail_${String(Date.now())}_${String(index)}`;
        if (admin === undefined)
          throw new Error("SPINE_TS_MYSQL_ADMIN_URL is required for trigger injection.");
        await admin.query(
          `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`${tableName}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='t0134 injected'`,
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
        await expect(mysqlCurrentRecordForTesting(pool, input, id)).resolves.toBeUndefined();
        const history = await mysqlEntityHistoryCountsForTesting(pool, input, id);
        expect(history.states, `table ${String(index)} state prefix`).toBe(expected.states);
        expect(history.events, `table ${String(index)} event prefix`).toBe(expected.entityEvents);
        await expect(eventStore.read()).resolves.toHaveLength(
          initialEvents + index + expected.deliveryEvents,
        );
        await expect(commits.commit(mutation(context, input, id))).resolves.toBe("committed");
        const persisted = await mysqlCurrentRecordForTesting(pool, input, id);
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

  it("rejects closed, cross-source, conflicting, and identifier-less Entity commits", async () => {
    const context = { name: `t0134_commit_errors_${String(Date.now())}`, multitenant: false };
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
      ).rejects.toThrow(/scope is incompatible/i);
      await expect(
        commits.commit({
          ...mutation(context, input, "conflict"),
          expected: current("different"),
        }),
      ).resolves.toBe("conflict");
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
    const context = { name: `t0134_disabled_${String(Date.now())}`, multitenant: false };
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
    const context = { name: `t0134_nontransactional_${String(Date.now())}`, multitenant: false };
    const input = entityInput(context);
    const commits = EntityCommitStorageFactories.create(factory, input);
    const eventStore = new EventStore(context, factory);
    const eventRecords = factory.createRecordStorage(context, eventStoreRecordSpec);
    const pool = createPool(url);
    let tables: readonly string[] = [];
    try {
      await commits.commit(mutation(context, input, "seed"));
      tables = [
        ...mysqlEntityTableNamesForTesting(input),
        mysqlRecordTableNameForTesting(eventStoreRecordSpec),
      ];
      for (const table of tables) await pool.query(`ALTER TABLE \`${table}\` ENGINE=MyISAM`);

      await expect(commits.commit(mutation(context, input, "with-history"))).resolves.toBe(
        "committed",
      );
      await expect(
        commits.commit({
          ...mutation(context, input, "current-only"),
          states: undefined,
          diagnostics: undefined,
          events: undefined,
        }),
      ).resolves.toBe("committed");
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
    const context = { name: `t0134_cas_${String(Date.now())}`, multitenant: false };
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record): string => record.value.split(":", 1)[0] ?? "",
      columns: [new RecordColumn("value", (record): string => record.value, "string")],
    });
    const first = factory.createRecordStorage(context, spec);
    const second = factory.createRecordStorage(context, spec);
    const pool = createPool(url);
    const engine = process.env.SPINE_TS_MYSQL_ENGINE?.toUpperCase() ?? "INNODB";
    try {
      const initial = create(StringValueSchema, { value: "present:initial" });
      await first.write(initial);
      const table = mysqlRecordTableNameForTesting(spec);
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

  it("serializes conflicting InnoDB Entity commits from separate handles", async () => {
    if (url === undefined) throw new Error("SPINE_TS_MYSQL_URL is required.");
    const context = { name: `t0134_concurrent_${String(Date.now())}`, multitenant: false };
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
      expect(outcomes.filter((outcome) => outcome === "committed")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === "conflict")).toHaveLength(1);
      await expect(mysqlCurrentRecordForTesting(pool, input, "same")).resolves.toBeDefined();
    } finally {
      first.close();
      second.close();
      await pool.end();
    }
  });

  it("replays an identical Entity commit without replacing current state", async () => {
    const context = { name: `t0134_replay_${String(Date.now())}`, multitenant: false };
    const input = entityInput(context);
    const commits = EntityCommitStorageFactories.create(factory, input);
    const pool = createPool(url);
    try {
      const same = mutation(context, input, "same");
      await expect(commits.commit(same)).resolves.toBe("committed");
      const before = await mysqlCurrentRevisionForTesting(pool, input, "same");
      await expect(commits.commit(same)).resolves.toBe("committed");
      await expect(mysqlCurrentRevisionForTesting(pool, input, "same")).resolves.toBe(before);
    } finally {
      commits.close();
      await pool.end();
    }
  });
});

function entityInput(
  context: { name: string; multitenant: boolean },
  stateHistory = true,
  eventHistory = true,
) {
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
function mutation(
  context: { name: string; multitenant: boolean },
  input: ReturnType<typeof entityInput>,
  id: string,
) {
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
