import { createPool } from "mysql2/promise";
import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-ts/storage";
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
      const [tables] = await pool.query<
        { table_name: string; table_collation: string | null; engine: string | null }[]
      >(
        `SELECT TABLE_NAME AS table_name, TABLE_COLLATION AS table_collation, ENGINE AS engine
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_records', 'spine_ts_columns')
         ORDER BY table_name`,
      );
      const [version] = await pool.query<{ column_default: string | null }[]>(
        `SELECT COLUMN_DEFAULT AS column_default
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'spine_ts_records'
           AND column_name = 'schema_version'`,
      );
      const [columns] = await pool.query<
        { table_name: string; column_name: string; is_nullable: string }[]
      >(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, IS_NULLABLE AS is_nullable
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_records', 'spine_ts_columns')
         ORDER BY table_name, ordinal_position`,
      );
      const [indexes] = await pool.query<
        { table_name: string; index_name: string; column_name: string }[]
      >(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, COLUMN_NAME AS column_name
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_records', 'spine_ts_columns')
         ORDER BY table_name, index_name, seq_in_index`,
      );
      const [foreignKeys] = await pool.query<
        { column_name: string; referenced_column_name: string; delete_rule: string }[]
      >(
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
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>("group", (record) => record.value.slice(0, 1)),
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
    const spec = new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value });
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
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => ids.get(record.value) }),
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
      extractId: (record: StringValue): string => record.value,
      columns: [new RecordColumn("old", () => "old")],
    });
    const newColumns = new RecordSpec({
      schema: StringValueSchema,
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
      const [stale] = await pool.query<{ count: number }[]>(
        "SELECT COUNT(*) AS count FROM `spine_ts_columns` WHERE column_name = ?",
        [CanonicalMysqlValue.encode("old", 255)],
      );
      expect(stale).toEqual([{ count: 2 }]);
      expect(await oldStorage.delete("a")).toBe(true);
      expect(await oldStorage.delete("a")).toBe(false);
      const [orphans] = await pool.query<{ count: number }[]>(
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
        extractId: () => "constant-slot",
        columns: [
          new RecordColumn("value", (record) => {
            if (record.value === "min") return -(1n << 63n);
            if (record.value === "max") return (1n << 63n) - 1n;
            if (record.value === "string") return "x".repeat(256);
            return "old-column";
          }),
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
        "ALTER TABLE `spine_ts_columns` ADD CONSTRAINT `spine_ts_t0051_reject_column` CHECK (column_name <> X'5B22737472696E67222C2272656A656374225D')",
      );
      const rejected = factory.createRecordStorage(
        { name: "Rollback", multitenant: false },
        new RecordSpec({
          schema: StringValueSchema,
          extractId: () => "constant-slot",
          columns: [new RecordColumn("reject", () => "new-column")],
        }),
      );
      await expect(
        rejected.write(create(StringValueSchema, { value: "new-payload" })),
      ).rejects.toBeInstanceOf(MysqlStorageOperationError);
      await expect(indexed.read("constant-slot")).resolves.toEqual(
        create(StringValueSchema, { value: "old-payload" }),
      );
      const [columns] = await pool.query<{ value_data: Uint8Array }[]>(
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
      expect(new Uint8Array(columns[0]?.value_data)).toEqual(
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
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
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
        extractId: (record: StringValue) => `slot-${record.value}`,
        columns: [
          new RecordColumn<StringValue, string>(
            "state",
            (record) => record.value.split(":")[0] ?? "",
          ),
          new RecordColumn<StringValue, number>("priority", (record) =>
            Number(record.value.split(":")[1]),
          ),
          new RecordColumn<StringValue, boolean | string>("mixed", (record) =>
            record.value.startsWith("boolean:") ? true : "open",
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
      const [plan] = await pool.query<{ key: string | null }[]>(
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
      extractId: (record: StringValue) => `slot-${record.value}`,
      columns: [
        new RecordColumn<StringValue, string>(
          "group",
          (record) => record.value.split(":")[0] ?? "",
        ),
        new RecordColumn<StringValue, number>("rank", (record) =>
          Number(record.value.split(":")[1]),
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
        extractId: () => "shared-slot",
        columns: [new RecordColumn<StringValue, number>("rank", () => 1)],
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
});
