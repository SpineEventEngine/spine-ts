import { createPool, type RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MysqlStorageDataError,
  MysqlStorageFactory,
  MysqlStorageOperationError,
} from "../src/index.js";
import { CanonicalMysqlValue, SortableMysqlColumnValue } from "../src/mysql/value-codec.js";

const url = process.env.SPINE_TS_MYSQL_URL ?? "";
const mysqlDescribe = url.length > 0 ? describe : describe.skip;

mysqlDescribe("MySQL Packet 2 storage", () => {
  const factories: MysqlStorageFactory[] = [];

  beforeAll(async () => {
    const pool = createPool({ uri: url });
    try {
      await pool.query("DROP TABLE IF EXISTS `spine_ts_columns`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_records`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_events`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_states`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_current`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_specs`");
    } finally {
      await pool.end();
    }
  });

  afterAll(async () => {
    await Promise.all(factories.map((factory) => factory.close()));
    const pool = createPool({ uri: url });
    try {
      await pool.query("DROP TABLE IF EXISTS `spine_ts_columns`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_records`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_events`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_states`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_current`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_entity_specs`");
    } finally {
      await pool.end();
    }
  });

  it("reopens durable entity history and rejects an incompatible fingerprint before reads", async () => {
    const input = {
      context: { name: "T0070R Entity Integration", multitenant: false },
      id: { clone: (id: string) => id, fingerprint: "string", key: (id: string) => id },
      layout: "entity-v1",
      stateSchema: StringValueSchema,
      storageKey: "integration.Task:current",
    };
    const first = await MysqlStorageFactory.create({ url });
    factories.push(first);
    const storage = first.createEntityStorage(input);
    await storage.current.write({
      id: "task",
      state: create(StringValueSchema, { value: "current" }),
      version: 2n,
      archived: false,
      deleted: false,
    });
    await storage.states.append({
      entityId: "task",
      state: create(StringValueSchema, { value: "state" }),
      version: 2n,
      createdAt: create(TimestampSchema, { seconds: 2n }),
    });
    for (let version = 3; version <= 132; version += 1) {
      await storage.states.append({
        entityId: "task",
        state: create(StringValueSchema, { value: String(version) }),
        version: BigInt(version),
        createdAt: create(TimestampSchema, { seconds: BigInt(version) }),
      });
    }
    await storage.events.append({
      entityId: "task",
      event: create(EventSchema, { id: create(EventIdSchema, { value: "event" }) }),
      producerVersion: 2n,
      createdAt: create(TimestampSchema, { seconds: 2n }),
    });
    await first.close();
    const second = await MysqlStorageFactory.create({ url });
    factories.push(second);
    const reopened = second.createEntityStorage(input);
    await expect(reopened.current.read("task")).resolves.toMatchObject({
      state: { value: "current" },
    });
    const longHistory = await reopened.states.backward("task", 130);
    expect(longHistory).toHaveLength(130);
    expect(longHistory.slice(0, 2)).toMatchObject([{ value: "132" }, { value: "131" }]);
    await expect(reopened.events.backward("task", 1)).resolves.toMatchObject([
      { id: { value: "event" } },
    ]);
    const incompatible = second.createEntityStorage({ ...input, layout: "entity-v2" });
    await expect(incompatible.current.read("task")).rejects.toThrow(/incompatible/i);
  });

  it("verifies the lazy entity schema and truncates only strict pre-boundary history", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const storage = factory.createEntityStorage({
      context: { name: "T0070R Entity Schema", multitenant: false },
      id: { clone: (id: string) => id, fingerprint: "string", key: (id: string) => id },
      layout: "entity-v1",
      stateSchema: StringValueSchema,
      storageKey: "integration.EntitySchema:current",
    });
    await storage.states.append({
      entityId: "task",
      state: create(StringValueSchema, { value: "old" }),
      version: 1n,
      createdAt: create(TimestampSchema, { seconds: 1n }),
    });
    await storage.states.append({
      entityId: "task",
      state: create(StringValueSchema, { value: "boundary" }),
      version: 2n,
      createdAt: create(TimestampSchema, { seconds: 2n }),
    });
    await storage.events.append({
      entityId: "task",
      event: create(EventSchema, { id: create(EventIdSchema, { value: "old-event" }) }),
      producerVersion: 1n,
      createdAt: create(TimestampSchema, { seconds: 1n }),
    });
    await storage.events.append({
      entityId: "task",
      event: create(EventSchema, { id: create(EventIdSchema, { value: "boundary-event" }) }),
      producerVersion: 2n,
      createdAt: create(TimestampSchema, { seconds: 2n }),
    });

    await storage.states.truncate(create(TimestampSchema, { seconds: 2n }));
    await storage.events.truncate(create(TimestampSchema, { seconds: 2n }));

    await expect(storage.states.backward("task", 2)).resolves.toMatchObject([
      { value: "boundary" },
    ]);
    await expect(storage.events.backward("task", 2)).resolves.toMatchObject([
      { id: { value: "boundary-event" } },
    ]);
    const pool = createPool({ uri: url });
    try {
      const [indexes] = await pool.query<EntityIndexMetadataRow[]>(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, COLUMN_NAME AS column_name,
                NON_UNIQUE AS non_unique, COLLATION AS collation
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name IN (
             'spine_ts_entity_specs', 'spine_ts_entity_current',
             'spine_ts_entity_states', 'spine_ts_entity_events'
           )
         ORDER BY table_name, index_name, seq_in_index`,
      );
      expect(indexes).toContainEqual(
        expect.objectContaining({
          table_name: "spine_ts_entity_states",
          index_name: "spine_ts_entity_states_trim",
          column_name: "version",
        }),
      );
      expect(indexes).toContainEqual(
        expect.objectContaining({
          table_name: "spine_ts_entity_events",
          index_name: "spine_ts_entity_events_read",
          column_name: "event_key",
          collation: "D",
        }),
      );
      expect(indexes).toContainEqual(
        expect.objectContaining({
          table_name: "spine_ts_entity_states",
          index_name: "spine_ts_entity_states_write_order",
          column_name: "write_order",
          non_unique: 0,
        }),
      );
      expect(indexes).toContainEqual(
        expect.objectContaining({
          table_name: "spine_ts_entity_events",
          index_name: "spine_ts_entity_events_write_order",
          column_name: "write_order",
          non_unique: 0,
        }),
      );
      const [writeOrderColumns] = await pool.query<EntityColumnMetadataRow[]>(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, EXTRA AS extra
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_entity_states', 'spine_ts_entity_events')
           AND column_name = 'write_order'`,
      );
      expect(writeOrderColumns).toHaveLength(2);
      expect(writeOrderColumns.every((column) => column.extra === "auto_increment")).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("creates and verifies the two fixed normalized tables concurrently", async () => {
    const created = await Promise.all(
      Array.from({ length: 4 }, () => MysqlStorageFactory.create({ url })),
    );
    factories.push(...created);
    const pool = createPool({ uri: url });

    try {
      const [tables] = await pool.query<TableMetadataRow[]>(
        `SELECT TABLE_NAME AS table_name, TABLE_COLLATION AS table_collation, ENGINE AS engine
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_records', 'spine_ts_columns')
         ORDER BY table_name`,
      );
      const [version] = await pool.query<SchemaVersionRow[]>(
        `SELECT COLUMN_DEFAULT AS column_default
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'spine_ts_records'
           AND column_name = 'schema_version'`,
      );
      const [columns] = await pool.query<ColumnMetadataRow[]>(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, IS_NULLABLE AS is_nullable
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_records', 'spine_ts_columns')
         ORDER BY table_name, ordinal_position`,
      );
      const [indexes] = await pool.query<IndexMetadataRow[]>(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, COLUMN_NAME AS column_name
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_records', 'spine_ts_columns')
         ORDER BY table_name, index_name, seq_in_index`,
      );
      const [foreignKeys] = await pool.query<ForeignKeyMetadataRow[]>(
        `SELECT kcu.COLUMN_NAME AS column_name, kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
                rc.DELETE_RULE AS delete_rule
         FROM information_schema.key_column_usage AS kcu
         INNER JOIN information_schema.referential_constraints AS rc
           ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND rc.TABLE_NAME = kcu.TABLE_NAME
          AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
           AND kcu.CONSTRAINT_NAME = 'spine_ts_columns_record_fk'
         ORDER BY kcu.ORDINAL_POSITION`,
      );

      expect(tables).toEqual([
        { table_name: "spine_ts_columns", table_collation: "utf8mb4_bin", engine: "InnoDB" },
        { table_name: "spine_ts_records", table_collation: "utf8mb4_bin", engine: "InnoDB" },
      ]);
      expect(version).toEqual([{ column_default: "3" }]);
      expect(columns.every((column) => column.is_nullable === "NO")).toBe(true);
      expect(indexes).toEqual([
        { table_name: "spine_ts_columns", index_name: "PRIMARY", column_name: "scope_key" },
        { table_name: "spine_ts_columns", index_name: "PRIMARY", column_name: "tenant_key" },
        { table_name: "spine_ts_columns", index_name: "PRIMARY", column_name: "slot_key" },
        { table_name: "spine_ts_columns", index_name: "PRIMARY", column_name: "column_name" },
        {
          table_name: "spine_ts_columns",
          index_name: "spine_ts_columns_lookup",
          column_name: "scope_key",
        },
        {
          table_name: "spine_ts_columns",
          index_name: "spine_ts_columns_lookup",
          column_name: "tenant_key",
        },
        {
          table_name: "spine_ts_columns",
          index_name: "spine_ts_columns_lookup",
          column_name: "column_name",
        },
        {
          table_name: "spine_ts_columns",
          index_name: "spine_ts_columns_lookup",
          column_name: "value_kind",
        },
        {
          table_name: "spine_ts_columns",
          index_name: "spine_ts_columns_lookup",
          column_name: "value_data",
        },
        {
          table_name: "spine_ts_columns",
          index_name: "spine_ts_columns_lookup",
          column_name: "slot_key",
        },
        { table_name: "spine_ts_records", index_name: "PRIMARY", column_name: "scope_key" },
        { table_name: "spine_ts_records", index_name: "PRIMARY", column_name: "tenant_key" },
        { table_name: "spine_ts_records", index_name: "PRIMARY", column_name: "slot_key" },
      ]);
      expect(foreignKeys).toEqual([
        { column_name: "scope_key", referenced_column_name: "scope_key", delete_rule: "CASCADE" },
        { column_name: "tenant_key", referenced_column_name: "tenant_key", delete_rule: "CASCADE" },
        { column_name: "slot_key", referenced_column_name: "slot_key", delete_rule: "CASCADE" },
      ]);
    } finally {
      await pool.end();
    }
  });

  it("atomically replaces one record and its materialized columns", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>(
            "group",
            (record) => record.value.slice(0, 1),
            "string",
          ),
        ],
      }),
    );

    await storage.write(create(StringValueSchema, { value: "a-first" }));
    await storage.write(create(StringValueSchema, { value: "a-first" }));

    await expect(storage.read("a-first")).resolves.toEqual(
      create(StringValueSchema, { value: "a-first" }),
    );
    await expect(storage.delete("a-first")).resolves.toBe(true);
    await expect(storage.read("a-first")).resolves.toBeUndefined();
  });

  it("isolates independent handles and operation-time tenant changes", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const context = { name: "TenantTasks", multitenant: true, tenantId: "one" };
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record) => record.value,
    });
    const first = factory.createRecordStorage(context, spec);
    const second = factory.createRecordStorage(context, spec);

    await first.write(create(StringValueSchema, { value: "same" }));
    await expect(second.read("same")).resolves.toEqual(
      create(StringValueSchema, { value: "same" }),
    );
    context.tenantId = "two";
    await expect(second.read("same")).resolves.toBeUndefined();
    await second.write(create(StringValueSchema, { value: "same" }));
    context.tenantId = "one";
    await expect(first.read("same")).resolves.toEqual(create(StringValueSchema, { value: "same" }));
    context.tenantId = "two";
    await expect(first.read("same")).resolves.toEqual(create(StringValueSchema, { value: "same" }));
  });

  it("persists every canonical ID kind and binary-distinct identifier boundaries", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const ids = new Map<string, unknown>([
      ["undefined", undefined],
      ["null", null],
      ["false", false],
      ["number", -1.5],
      ["bigint", -1n],
      ["string", "A"],
      ["bytes", new Uint8Array([0, 255])],
      ["array", ["x", 1]],
      ["object", { b: 2, a: 1 }],
    ]);
    const storage = factory.createRecordStorage(
      { name: "CanonicalIds", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => ids.get(record.value),
      }),
    );
    for (const [value, id] of ids) {
      await storage.write(create(StringValueSchema, { value }));
      await expect(storage.read(id)).resolves.toEqual(create(StringValueSchema, { value }));
    }
    const exactSlot = "x".repeat(755);
    expect(CanonicalMysqlValue.encode(exactSlot)).toHaveLength(768);
    ids.set(exactSlot, exactSlot);
    await storage.write(create(StringValueSchema, { value: exactSlot }));
    await expect(storage.read(exactSlot)).resolves.toEqual(
      create(StringValueSchema, { value: exactSlot }),
    );
    await expect(storage.read("x".repeat(756))).rejects.toThrow("too large");
  });

  it("keeps case and accent IDs distinct, replaces stale columns, and cascades deletes", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const oldColumns = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record: StringValue): string => record.value,
      columns: [new RecordColumn("old", () => "old", "string")],
    });
    const newColumns = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record) => record.value,
    });
    const oldStorage = factory.createRecordStorage(
      { name: "Columns", multitenant: false },
      oldColumns,
    );
    const newStorage = factory.createRecordStorage(
      { name: "Columns", multitenant: false },
      newColumns,
    );
    for (const value of ["A", "a", "á"])
      await oldStorage.write(create(StringValueSchema, { value }));
    await expect(oldStorage.read("A")).resolves.toEqual(create(StringValueSchema, { value: "A" }));
    await expect(oldStorage.read("a")).resolves.toEqual(create(StringValueSchema, { value: "a" }));
    await expect(oldStorage.read("á")).resolves.toEqual(create(StringValueSchema, { value: "á" }));
    await newStorage.write(create(StringValueSchema, { value: "A" }));
    const pool = createPool({ uri: url });
    try {
      const [stale] = await pool.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM `spine_ts_columns` WHERE column_name = ?",
        [CanonicalMysqlValue.encode("old", 255)],
      );
      expect(stale).toEqual([{ count: 2 }]);
      expect(await oldStorage.delete("a")).toBe(true);
      expect(await oldStorage.delete("a")).toBe(false);
      const [orphans] = await pool.query<CountRow[]>(
        `SELECT COUNT(*) AS count FROM \`spine_ts_columns\` AS c
         LEFT JOIN \`spine_ts_records\` AS r USING (scope_key, tenant_key, slot_key)
         WHERE r.slot_key IS NULL`,
      );
      expect(orphans).toEqual([{ count: 0 }]);
    } finally {
      await pool.end();
    }
  });

  it("accepts exact sortable boundaries and rolls back a column insert failure", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const indexed = factory.createRecordStorage(
      { name: "Rollback", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: () => "constant-slot",
        columns: [
          new RecordColumn(
            "value",
            (record: StringValue) => {
              if (record.value === "min") return -(1n << 63n);
              if (record.value === "max") return (1n << 63n) - 1n;
              if (record.value === "string") return "x".repeat(256);
              return "old-column";
            },
            "string-or-bigint",
          ),
        ],
      }),
    );
    await indexed.write(create(StringValueSchema, { value: "min" }));
    await indexed.write(create(StringValueSchema, { value: "max" }));
    await indexed.write(create(StringValueSchema, { value: "string" }));
    await indexed.write(create(StringValueSchema, { value: "old-payload" }));
    const pool = createPool({ uri: url });
    try {
      await pool.query(
        "ALTER TABLE `spine_ts_columns` ADD CONSTRAINT `spine_ts_t0051_reject_column` " +
          "CHECK (column_name <> X'5B22737472696E67222C2272656A656374225D')",
      );
      const rejected = factory.createRecordStorage(
        { name: "Rollback", multitenant: false },
        new RecordSpec({
          schema: StringValueSchema,
          storageKey: "StringValueSchema:legacy",
          idKind: "string",
          extractId: () => "constant-slot",
          columns: [new RecordColumn("reject", () => "new-column", "string")],
        }),
      );
      await expect(
        rejected.write(create(StringValueSchema, { value: "new-payload" })),
      ).rejects.toBeInstanceOf(MysqlStorageOperationError);
      await expect(indexed.read("constant-slot")).resolves.toEqual(
        create(StringValueSchema, { value: "old-payload" }),
      );
      const [columns] = await pool.query<ValueDataRow[]>(
        `SELECT value_data FROM \`spine_ts_columns\`
         WHERE scope_key = ? AND tenant_key = ? AND slot_key = ? AND column_name = ?`,
        [
          CanonicalMysqlValue.encode(["Rollback", false, StringValueSchema.typeName], 512),
          CanonicalMysqlValue.encode(null, 255),
          CanonicalMysqlValue.encode("constant-slot", 768),
          CanonicalMysqlValue.encode("value", 255),
        ],
      );
      expect(columns).toHaveLength(1);
      const [column] = columns;
      if (column === undefined) throw new Error("Expected the retained materialized column.");
      expect(new Uint8Array(column.value_data)).toEqual(
        SortableMysqlColumnValue.encode("old-column").data,
      );
    } finally {
      await pool
        .query("ALTER TABLE `spine_ts_columns` DROP CHECK `spine_ts_t0051_reject_column`")
        .catch(() => undefined);
      await pool.end();
    }
  });

  it("raises a data error for invalid bytes in an existing row", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const context = { name: "Malformed", multitenant: false };
    const storage = factory.createRecordStorage(
      context,
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await storage.write(create(StringValueSchema, { value: "bad" }));
    const pool = createPool({ uri: url });
    try {
      await pool.query(
        "UPDATE `spine_ts_records` SET payload = ? WHERE scope_key = ? AND tenant_key = ? AND slot_key = ?",
        [
          new Uint8Array([255]),
          CanonicalMysqlValue.encode([context.name, false, StringValueSchema.typeName], 512),
          CanonicalMysqlValue.encode(null, 255),
          CanonicalMysqlValue.encode("bad", 768),
        ],
      );
      await expect(storage.read("bad")).rejects.toBeInstanceOf(MysqlStorageDataError);
    } finally {
      await pool.end();
    }
  });

  it("pushes typed AND/IN filters, deterministic ordering, continuation, and windows into MySQL", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const storage = factory.createRecordStorage(
      { name: "Queries", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record: StringValue) => `slot-${record.value}`,
        columns: [
          new RecordColumn<StringValue, string>(
            "state",
            (record) => record.value.split(":")[0] ?? "",
            "string",
          ),
          new RecordColumn<StringValue, number>(
            "priority",
            (record) => Number(record.value.split(":")[1]),
            "number",
          ),
          new RecordColumn<StringValue, boolean | string>(
            "mixed",
            (record) => (record.value.startsWith("boolean:") ? true : "open"),
            "boolean-or-string",
          ),
        ],
      }),
    );
    for (const value of ["open:2", "open:1", "closed:0", "boolean:3"]) {
      await storage.write(create(StringValueSchema, { value }));
    }

    const first = await storage.queryEntries({
      filters: [
        { column: "state", value: "open" },
        { column: "mixed", value: ["open", true] },
      ],
      sort: [{ field: "priority", direction: "asc" }],
      limit: 1,
    });
    const second = await storage.queryEntries({
      filters: [
        { column: "state", value: "open" },
        { column: "mixed", value: ["open", true] },
      ],
      sort: [{ field: "priority", direction: "asc" }],
      after: {
        values: [{ field: "priority", value: 1 }],
        id: first[0]?.id ?? "slot-open:1",
      },
      offset: 0,
      limit: 1,
    });

    expect(first).toMatchObject([{ id: "slot-open:1", record: { value: "open:1" } }]);
    expect(second).toMatchObject([{ id: "slot-open:2", record: { value: "open:2" } }]);
    const mixedFirst = await storage.queryEntries({
      filters: [{ column: "mixed", value: [true, "open"] }],
      sort: [{ field: "mixed", direction: "asc" }],
      limit: 1,
    });
    const mixedSecond = await storage.queryEntries({
      filters: [{ column: "mixed", value: [true, "open"] }],
      sort: [{ field: "mixed", direction: "asc" }],
      after: { values: [{ field: "mixed", value: true }], id: "slot-boolean:3" },
      limit: 1,
    });
    const unsorted = await storage.queryEntries({ limit: 1 });
    const unsortedNext = await storage.queryEntries({
      after: { values: [], id: unsorted[0]?.id ?? "slot-boolean:3" },
      limit: 1,
    });
    expect(mixedFirst).toMatchObject([{ id: "slot-boolean:3" }]);
    expect(mixedSecond).toHaveLength(1);
    expect(mixedSecond[0]?.id).not.toBe("slot-boolean:3");
    await expect(
      storage.query({
        filters: [
          { column: "state", value: "open" },
          { column: "state", value: "closed" },
        ],
      }),
    ).resolves.toEqual([]);
    expect(unsortedNext[0]?.id).not.toBe(unsorted[0]?.id);
    await expect(storage.query({ filters: [{ column: "missing", value: "x" }] })).resolves.toEqual(
      [],
    );
    await expect(
      storage.query({ filters: [{ column: "state.name", value: "open" }] }),
    ).rejects.toThrow("materialized column or id");

    const pool = createPool({ uri: url });
    try {
      const [plan] = await pool.query<QueryPlanRow[]>(
        `EXPLAIN SELECT slot_key FROM \`spine_ts_columns\`
         WHERE scope_key = ? AND tenant_key = ? AND column_name = ? AND value_kind = ? AND value_data = ?
         ORDER BY slot_key ASC`,
        [
          CanonicalMysqlValue.encode(["Queries", false, StringValueSchema.typeName], 512),
          CanonicalMysqlValue.encode(null, 255),
          CanonicalMysqlValue.encode("state", 255),
          SortableMysqlColumnValue.encode("open").kind,
          SortableMysqlColumnValue.encode("open").data,
        ],
      );
      expect(plan.some((row) => row.key === "spine_ts_columns_lookup")).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("orders complete tuples, continues descending pages, windows in SQL, and isolates query tenants", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record: StringValue) => `slot-${record.value}`,
      columns: [
        new RecordColumn<StringValue, string>(
          "group",
          (record) => record.value.split(":")[0] ?? "",
          "string",
        ),
        new RecordColumn<StringValue, number>(
          "rank",
          (record) => Number(record.value.split(":")[1]),
          "number",
        ),
      ],
    });
    const single = factory.createRecordStorage({ name: "TupleQueries", multitenant: false }, spec);
    for (const value of ["A:2:beta", "A:2:alpha", "A:1:z", "B:1:a"]) {
      await single.write(create(StringValueSchema, { value }));
    }
    const tupleSort = [
      { field: "group", direction: "asc" as const },
      { field: "rank", direction: "desc" as const },
    ];
    const ordered = await single.queryEntries({ sort: tupleSort });
    const page = await single.queryEntries({ sort: tupleSort, offset: 1, limit: 2 });
    const descending = await single.queryEntries({
      sort: [{ field: "rank", direction: "desc" }],
      after: { values: [{ field: "rank", value: 2 }], id: "slot-A:2:beta" },
    });

    expect(ordered.map((entry) => entry.id)).toEqual([
      "slot-A:2:alpha",
      "slot-A:2:beta",
      "slot-A:1:z",
      "slot-B:1:a",
    ]);
    expect(page.map((entry) => entry.id)).toEqual(["slot-A:2:beta", "slot-A:1:z"]);
    expect(descending.map((entry) => entry.id)).toEqual(["slot-A:1:z", "slot-B:1:a"]);

    const mutableTenant = { name: "TenantQueries", multitenant: true, tenantId: "a" };
    const tenantStorage = factory.createRecordStorage(
      mutableTenant,
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: () => "shared-slot",
        columns: [new RecordColumn<StringValue, number>("rank", () => 1, "number")],
      }),
    );
    await tenantStorage.write(create(StringValueSchema, { value: "tenant-a-payload" }));
    mutableTenant.tenantId = "b";
    await tenantStorage.write(create(StringValueSchema, { value: "tenant-b-payload" }));
    await expect(
      tenantStorage.queryEntries({ filters: [{ column: "rank", value: 1 }] }),
    ).resolves.toMatchObject([{ id: "shared-slot", record: { value: "tenant-b-payload" } }]);
    mutableTenant.tenantId = "a";
    await expect(
      tenantStorage.queryEntries({ filters: [{ column: "rank", value: 1 }] }),
    ).resolves.toMatchObject([{ id: "shared-slot", record: { value: "tenant-a-payload" } }]);
  });

  it("commits ordered batches and applies payload-based compare-and-set", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const storage = factory.createRecordStorage(
      { name: "PacketFour", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record: StringValue) => record.value.slice(0, 1),
        columns: [
          new RecordColumn<StringValue, string>("value", (record) => record.value, "string"),
        ],
      }),
    );
    await storage.writeAll(
      ["a-first", "b-first", "a-last"].map((value) => create(StringValueSchema, { value })),
    );
    await expect(storage.read("a")).resolves.toEqual(
      create(StringValueSchema, { value: "a-last" }),
    );
    await expect(storage.read("b")).resolves.toEqual(
      create(StringValueSchema, { value: "b-first" }),
    );

    const created = create(StringValueSchema, { value: "c-created" });
    const replacement = create(StringValueSchema, { value: "c-replaced" });
    await expect(storage.compareAndSet("c", undefined, created)).resolves.toBe(true);
    await expect(storage.compareAndSet("c", created, replacement)).resolves.toBe(true);
    await expect(storage.compareAndSet("c", created, undefined)).resolves.toBe(false);
    await expect(storage.compareAndSet("c", replacement, undefined)).resolves.toBe(true);
    await expect(storage.read("c")).resolves.toBeUndefined();
  });

  it("serializes independent absent creates and keeps a CAS replacement at its addressed slot", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const spec = new RecordSpec({
      schema: StringValueSchema,
      storageKey: "StringValueSchema:legacy",
      idKind: "string",
      extractId: (record: StringValue) => record.value,
    });
    const first = factory.createRecordStorage({ name: "CasRace", multitenant: false }, spec);
    const second = factory.createRecordStorage({ name: "CasRace", multitenant: false }, spec);
    const next = create(StringValueSchema, { value: "body-id" });
    let releaseStart: (() => void) | undefined;
    const start = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    let ready = 0;
    const race = (storage: typeof first) =>
      new Promise<boolean>((resolve, reject) => {
        ready += 1;
        void start
          .then(() => storage.compareAndSet("addressed-slot", undefined, next))
          .then(resolve, reject);
      });
    const firstAttempt = race(first);
    const secondAttempt = race(second);
    expect(ready).toBe(2);
    releaseStart?.();
    const raced = await Promise.all([firstAttempt, secondAttempt]);
    expect(raced.sort()).toEqual([false, true]);
    await expect(first.read("addressed-slot")).resolves.toEqual(next);
    await expect(first.queryEntries({ ids: ["addressed-slot"] })).resolves.toMatchObject([
      { id: "addressed-slot", record: { value: "body-id" } },
    ]);
    await expect(first.index({ ids: ["addressed-slot"] })).resolves.toEqual(["body-id"]);
  });

  it("waits for an admitted write to release before factory close resolves", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const storage = factory.createRecordStorage(
      { name: "CloseRace", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const controlPool = createPool({ uri: url, connectionLimit: 2 });
    const lock = await controlPool.getConnection();
    let released = false;
    let write: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    try {
      await storage.write(create(StringValueSchema, { value: "admitted" }));
      await lock.beginTransaction();
      await lock.query(
        `SELECT payload FROM \`spine_ts_records\`
         WHERE scope_key = ? AND tenant_key = ? AND slot_key = ? FOR UPDATE`,
        [
          CanonicalMysqlValue.encode(["CloseRace", false, StringValueSchema.typeName], 512),
          CanonicalMysqlValue.encode(null, 255),
          CanonicalMysqlValue.encode("admitted", 768),
        ],
      );
      write = storage.write(create(StringValueSchema, { value: "admitted" }));
      await waitForBlockedInsert(controlPool);

      closing = factory.close();
      let closeSettled = false;
      void closing.then(
        () => {
          closeSettled = true;
        },
        () => {
          closeSettled = true;
        },
      );
      await expect(storage.read("admitted")).rejects.toThrow("RecordStorage is closed");
      expect(() =>
        factory.createRecordStorage(
          { name: "CloseRace", multitenant: false },
          new RecordSpec({
            schema: StringValueSchema,
            storageKey: "StringValueSchema:legacy",
            idKind: "string",
            extractId: (record) => record.value,
          }),
        ),
      ).toThrow("StorageFactory is closed");
      await Promise.resolve();
      expect(closeSettled).toBe(false);

      await lock.commit();
      released = true;
      await write;
      expect(closeSettled).toBe(false);
      await closing;
      expect(closeSettled).toBe(true);
    } finally {
      if (!released) await lock.rollback().catch(() => undefined);
      await write?.catch(() => undefined);
      await closing?.catch(() => undefined);
      lock.release();
      await controlPool.end();
    }
  });

  it("serializes independent entity trim and append with the provider user lock", async () => {
    const input = {
      context: { name: "T0070R lock integration", multitenant: false },
      id: { clone: (id: string) => id, fingerprint: "string", key: (id: string) => id },
      layout: "entity-lock-v1",
      stateSchema: StringValueSchema,
      storageKey: "integration.LockTask:current",
    };
    const first = await MysqlStorageFactory.create({ url });
    const second = await MysqlStorageFactory.create({ url });
    factories.push(first, second);
    const source = first.createEntityStorage(input);
    const peer = second.createEntityStorage(input);
    for (let version = 1; version <= 130; version += 1) {
      await source.states.append({
        entityId: "same",
        state: create(StringValueSchema, { value: String(version) }),
        version: BigInt(version),
        createdAt: create(TimestampSchema, { seconds: BigInt(version) }),
      });
    }
    const scope = CanonicalMysqlValue.encode(
      [input.context.name, "single-tenant", input.storageKey],
      512,
    );
    const entity = CanonicalMysqlValue.encode("same", 768);
    const lockName = entityLockName(new URL(url).pathname.slice(1), scope, entity);
    const controlPool = createPool({ uri: url });
    const control = await controlPool.getConnection();
    let committed = false;
    try {
      await control.beginTransaction();
      await control.execute(
        "SELECT version FROM spine_ts_entity_states WHERE scope_key=? AND entity_key=? AND version=? FOR UPDATE",
        [scope, entity, 130n],
      );
      const trim = source.states.trim("same", 0);
      await waitForUserLock(controlPool, lockName);
      const append = peer.states.append({
        entityId: "same",
        state: create(StringValueSchema, { value: "retained" }),
        version: 131n,
        createdAt: create(TimestampSchema, { seconds: 131n }),
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const [before] = await controlPool.query<CountRow[]>(
        "SELECT COUNT(*) AS count FROM spine_ts_entity_states WHERE scope_key=? AND entity_key=? AND version=?",
        [scope, entity, 131n],
      );
      expect(before[0]?.count).toBe(0);
      await control.commit();
      committed = true;
      await expect(trim).resolves.toBeUndefined();
      await expect(append).resolves.toBeUndefined();
      await expect(peer.states.backward("same", 1)).resolves.toMatchObject([{ value: "retained" }]);

      const exact = {
        entityId: "exact",
        state: create(StringValueSchema, { value: "same" }),
        version: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      };
      await expect(
        Promise.all([source.states.append(exact), peer.states.append(exact)]),
      ).resolves.toEqual([undefined, undefined]);
      await expect(
        Promise.all([
          source.states.append({
            ...exact,
            entityId: "divergent",
            state: create(StringValueSchema, { value: "a" }),
          }),
          peer.states.append({
            ...exact,
            entityId: "divergent",
            state: create(StringValueSchema, { value: "b" }),
          }),
        ]),
      ).rejects.toThrow(/divergent/i);
    } finally {
      if (!committed) await control.rollback().catch(() => undefined);
      control.release();
      await controlPool.end();
    }
  });

  it("rolls a later batch column failure back without changing prior rows", async () => {
    const factory = await MysqlStorageFactory.create({ url });
    factories.push(factory);
    const storage = factory.createRecordStorage(
      { name: "BatchRollback", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value.slice(0, 1),
        columns: [
          new RecordColumn<StringValue, string>("value", (record) => record.value, "string"),
        ],
      }),
    );
    await storage.write(create(StringValueSchema, { value: "a-old" }));
    await storage.write(create(StringValueSchema, { value: "b-old" }));
    const pool = createPool({ uri: url });
    try {
      const rejectedValue = SortableMysqlColumnValue.encode("b-new").data;
      const hex = [...rejectedValue].map((value) => value.toString(16).padStart(2, "0")).join("");
      await pool.query(
        `ALTER TABLE \`spine_ts_columns\` ` +
          `ADD CONSTRAINT \`spine_ts_t0051_reject_batch_column\` CHECK (value_data <> X'${hex}')`,
      );

      await expect(
        storage.writeAll(
          ["a-new", "b-new", "c-new"].map((value) => create(StringValueSchema, { value })),
        ),
      ).rejects.toBeInstanceOf(MysqlStorageOperationError);

      await expect(storage.read("a")).resolves.toEqual(
        create(StringValueSchema, { value: "a-old" }),
      );
      await expect(storage.read("b")).resolves.toEqual(
        create(StringValueSchema, { value: "b-old" }),
      );
      await expect(storage.read("c")).resolves.toBeUndefined();
      const [columns] = await pool.query<StoredColumnRow[]>(
        `SELECT slot_key, value_data FROM \`spine_ts_columns\`
         WHERE scope_key = ? AND tenant_key = ? ORDER BY slot_key ASC`,
        [
          CanonicalMysqlValue.encode(["BatchRollback", false, StringValueSchema.typeName], 512),
          CanonicalMysqlValue.encode(null, 255),
        ],
      );
      expect(
        columns.map(({ slot_key, value_data }) => ({
          slot_key: new Uint8Array(slot_key),
          value_data: new Uint8Array(value_data),
        })),
      ).toEqual([
        {
          slot_key: CanonicalMysqlValue.encode("a", 768),
          value_data: SortableMysqlColumnValue.encode("a-old").data,
        },
        {
          slot_key: CanonicalMysqlValue.encode("b", 768),
          value_data: SortableMysqlColumnValue.encode("b-old").data,
        },
      ]);
    } finally {
      await pool
        .query("ALTER TABLE `spine_ts_columns` DROP CHECK `spine_ts_t0051_reject_batch_column`")
        .catch(() => undefined);
      await pool.end();
    }
  });
});

async function waitForBlockedInsert(pool: ReturnType<typeof createPool>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [rows] = await pool.query<ProcessRow[]>(
      "SELECT INFO AS info FROM information_schema.processlist WHERE DB = DATABASE() " +
        "AND INFO LIKE 'INSERT INTO `spine\\_ts\\_records`%'",
    );
    if (rows.length > 0) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("The admitted MySQL write did not reach the server.");
}

async function waitForUserLock(pool: ReturnType<typeof createPool>, name: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [rows] = await pool.execute<LockOwnerRow[]>("SELECT IS_USED_LOCK(?) AS owner", [name]);
    if (rows[0]?.owner !== null && rows[0]?.owner !== undefined) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("The entity trim did not acquire its MySQL user lock.");
}

function entityLockName(database: string, scope: Uint8Array, entity: Uint8Array): string {
  const hash = createHash("sha256")
    .update(decodeURIComponent(database))
    .update("\0")
    .update(scope)
    .update("\0")
    .update(entity)
    .digest("hex");
  return `spine_ts_${hash.slice(0, 55)}`;
}

interface ProcessRow extends RowDataPacket {
  readonly info: string | null;
}

interface LockOwnerRow extends RowDataPacket {
  readonly owner: number | null;
}

interface TableMetadataRow extends RowDataPacket {
  readonly table_name: string;
  readonly table_collation: string | null;
  readonly engine: string | null;
}

interface SchemaVersionRow extends RowDataPacket {
  readonly column_default: string | null;
}

interface ColumnMetadataRow extends RowDataPacket {
  readonly table_name: string;
  readonly column_name: string;
  readonly is_nullable: string;
}

interface IndexMetadataRow extends RowDataPacket {
  readonly table_name: string;
  readonly index_name: string;
  readonly column_name: string;
}

interface EntityIndexMetadataRow extends RowDataPacket {
  readonly table_name: string;
  readonly index_name: string;
  readonly column_name: string;
  readonly non_unique: number;
  readonly collation: string | null;
}

interface EntityColumnMetadataRow extends RowDataPacket {
  readonly table_name: string;
  readonly column_name: string;
  readonly extra: string;
}

interface ForeignKeyMetadataRow extends RowDataPacket {
  readonly column_name: string;
  readonly referenced_column_name: string;
  readonly delete_rule: string;
}

interface CountRow extends RowDataPacket {
  readonly count: number;
}

interface ValueDataRow extends RowDataPacket {
  readonly value_data: Uint8Array;
}

interface QueryPlanRow extends RowDataPacket {
  readonly key: string | null;
}

interface StoredColumnRow extends RowDataPacket {
  readonly slot_key: Uint8Array;
  readonly value_data: Uint8Array;
}
