import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-ts/storage";

import { CanonicalMysqlValue } from "../src/mysql/value-codec.js";

const calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
let endCalls = 0;
let poolOptions: unknown;
let operationError: Error | undefined;
let operationRows: unknown[] = [];
let connectionAcquires = 0;

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn((options) => {
    poolOptions = options;
    return {
      async getConnection() {
        connectionAcquires += 1;
        await Promise.resolve();
        if (connectError !== undefined) {
          throw connectError;
        }
        return {
          async query(sql: string, values?: readonly unknown[]) {
            await Promise.resolve();
            calls.push({ sql, values });
            if (sql.includes("information_schema.columns")) {
              return [schemaRows, []];
            }
            if (sql.includes("information_schema.tables")) {
              return [tableRows, []];
            }
            if (sql.includes("information_schema.statistics")) {
              return [indexRows, []];
            }
            if (sql.includes("information_schema.key_column_usage")) {
              return [foreignKeyRows, []];
            }
            if (sql.includes("SELECT r.slot_key, r.payload")) return [operationRows, []];
            return [[], []];
          },
          async execute(sql: string, values?: readonly unknown[]) {
            await Promise.resolve();
            calls.push({ sql, values });
            if (operationError !== undefined) throw operationError;
            if (sql.includes("SELECT payload")) {
              return [operationRows, []];
            }
            return [{ affectedRows: 1 }, []];
          },
          beginTransaction() {
            return Promise.resolve();
          },
          commit() {
            return Promise.resolve();
          },
          rollback() {
            return Promise.resolve();
          },
          release() {
            return undefined;
          },
        };
      },
      async end() {
        await Promise.resolve();
        endCalls += 1;
      },
    };
  }),
}));

const compatibleSchemaRows = [
  { table_name: "spine_ts_records", column_name: "scope_key", column_type: "varbinary(512)" },
  { table_name: "spine_ts_records", column_name: "tenant_key", column_type: "varbinary(255)" },
  { table_name: "spine_ts_records", column_name: "slot_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_records", column_name: "payload", column_type: "mediumblob" },
  { table_name: "spine_ts_records", column_name: "revision", column_type: "bigint unsigned" },
  {
    table_name: "spine_ts_records",
    column_name: "schema_version",
    column_type: "smallint unsigned",
    column_default: "3",
  },
  { table_name: "spine_ts_columns", column_name: "scope_key", column_type: "varbinary(512)" },
  { table_name: "spine_ts_columns", column_name: "tenant_key", column_type: "varbinary(255)" },
  { table_name: "spine_ts_columns", column_name: "slot_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_columns", column_name: "column_name", column_type: "varbinary(255)" },
  { table_name: "spine_ts_columns", column_name: "value_kind", column_type: "tinyint unsigned" },
  { table_name: "spine_ts_columns", column_name: "value_data", column_type: "varbinary(768)" },
].map((row) => ({ ...row, is_nullable: "NO" }));
let schemaRows = compatibleSchemaRows;
const compatibleTableRows = [
  { table_name: "spine_ts_records", engine: "InnoDB" },
  { table_name: "spine_ts_columns", engine: "InnoDB" },
];
let tableRows = compatibleTableRows;
const compatibleIndexRows = Object.entries({
  "spine_ts_records.PRIMARY": ["scope_key", "tenant_key", "slot_key"],
  "spine_ts_columns.PRIMARY": ["scope_key", "tenant_key", "slot_key", "column_name"],
  "spine_ts_columns.spine_ts_columns_lookup": [
    "scope_key",
    "tenant_key",
    "column_name",
    "value_kind",
    "value_data",
    "slot_key",
  ],
}).flatMap(([index, columns]) => {
  const [table_name, index_name] = index.split(".");
  return columns.map((column_name, index) => ({
    table_name,
    index_name,
    column_name,
    seq_in_index: index + 1,
  }));
});
let indexRows = compatibleIndexRows;
const compatibleForeignKeyRows = [
  { column_name: "scope_key", referenced_column_name: "scope_key", ordinal_position: 1 },
  { column_name: "tenant_key", referenced_column_name: "tenant_key", ordinal_position: 2 },
  { column_name: "slot_key", referenced_column_name: "slot_key", ordinal_position: 3 },
].map((row) => ({
  ...row,
  table_name: "spine_ts_columns",
  constraint_name: "spine_ts_columns_record_fk",
  referenced_table_name: "spine_ts_records",
  delete_rule: "CASCADE",
}));
let foreignKeyRows = compatibleForeignKeyRows;
let connectError: Error | undefined;

describe("MysqlStorageFactory", () => {
  beforeEach(() => {
    calls.length = 0;
    endCalls = 0;
    schemaRows = compatibleSchemaRows;
    tableRows = compatibleTableRows;
    indexRows = compatibleIndexRows;
    foreignKeyRows = compatibleForeignKeyRows;
    connectError = undefined;
    operationError = undefined;
    operationRows = [];
    connectionAcquires = 0;
    poolOptions = undefined;
  });

  it("initializes exactly two fixed binary-comparison tables and closes its owned pool once", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");

    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_1",
    });
    const handle = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    const firstClose = factory.close();
    const secondClose = factory.close();

    expect(factory.isOpen()).toBe(false);
    expect(handle.isOpen()).toBe(false);
    expect(firstClose).toBe(secondClose);
    await firstClose;
    expect(endCalls).toBe(1);
    expect(calls.filter(({ sql }) => /^\s*CREATE TABLE/u.test(sql))).toHaveLength(2);
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("COLLATE utf8mb4_bin");
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("`spine_ts_records`");
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("`spine_ts_columns`");
    expect({
      recordsPrimary: 512 + 255 + 768,
      columnsPrimary: 512 + 255 + 768 + 255,
      columnsLookup: 512 + 255 + 255 + 1 + 768 + 768,
    }).toEqual({ recordsPrimary: 1535, columnsPrimary: 1790, columnsLookup: 2559 });
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("scope_key VARBINARY(512)");
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("tenant_key VARBINARY(255)");
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("slot_key VARBINARY(768)");
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("value_data VARBINARY(768) NOT NULL");
  });

  it("fails closed when a fixed table has an incompatible schema", async () => {
    schemaRows = compatibleSchemaRows.map((row, index) =>
      index === 0
        ? { table_name: "spine_ts_records", column_name: "scope_key", column_type: "varchar(768)" }
        : row,
    );
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");

    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_1" }),
    ).rejects.toBeInstanceOf(MysqlStorageSchemaError);
  });

  it("fails closed when the adapter schema version default is incompatible", async () => {
    schemaRows = compatibleSchemaRows.map((row) =>
      row.column_name === "schema_version" ? { ...row, column_default: "2" } : row,
    );
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");

    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_1" }),
    ).rejects.toBeInstanceOf(MysqlStorageSchemaError);
  });

  it("redacts credential-bearing connection failures", async () => {
    connectError = new Error(
      "Access denied for mysql://spine:secret@localhost:3306/spine_packet_1",
    );
    const { MysqlStorageConnectionError, MysqlStorageFactory } = await import("../src/index.js");

    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_1" }),
    ).rejects.toBeInstanceOf(MysqlStorageConnectionError);
    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_1" }),
    ).rejects.not.toThrow("secret");
  });

  it("maps explicit TLS settings and rejects silently ignored URL settings", async () => {
    const { MysqlStorageConfigurationError, MysqlStorageFactory } = await import("../src/index.js");

    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_1",
      tls: { ca: "test-ca", rejectUnauthorized: true },
    });
    await factory.close();

    expect(poolOptions).toMatchObject({ ssl: { ca: "test-ca", rejectUnauthorized: true } });
    await expect(
      MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_1?ssl=0",
      }),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
  });

  it("requires exact primary-key, lookup-index, and cascade-foreign-key metadata", async () => {
    indexRows = compatibleIndexRows.map((row) =>
      row.index_name === "spine_ts_columns_lookup" && row.seq_in_index === 6
        ? { ...row, seq_in_index: 5 }
        : row,
    );
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");

    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_1" }),
    ).rejects.toBeInstanceOf(MysqlStorageSchemaError);
    expect(calls.map(({ sql }) => sql).join("\n")).toContain(
      "INDEX spine_ts_columns_lookup (scope_key, tenant_key, column_name, value_kind, value_data, slot_key)",
    );
    expect(calls.map(({ sql }) => sql).join("\n")).toContain(
      "PRIMARY KEY (scope_key, tenant_key, slot_key)",
    );
    expect(calls.map(({ sql }) => sql).join("\n")).toContain(
      "PRIMARY KEY (scope_key, tenant_key, slot_key, column_name)",
    );
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("ON DELETE CASCADE");
  });

  it("fails closed when the record cascade foreign-key metadata is absent", async () => {
    foreignKeyRows = [];
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");

    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_1" }),
    ).rejects.toBeInstanceOf(MysqlStorageSchemaError);
  });

  it("fails closed when the sortable value bytes are nullable", async () => {
    schemaRows = compatibleSchemaRows.map((row) =>
      row.column_name === "value_data" ? { ...row, is_nullable: "YES" } : row,
    );
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");

    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_1" }),
    ).rejects.toBeInstanceOf(MysqlStorageSchemaError);
  });

  it("distinguishes malformed present payloads from sanitized provider operation failures", async () => {
    const { MysqlStorageDataError, MysqlStorageFactory, MysqlStorageOperationError } =
      await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_1",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );

    operationRows = [{ payload: "not-bytes" }];
    await expect(storage.read("slot")).rejects.toBeInstanceOf(MysqlStorageDataError);
    operationError = new Error("provider secret");
    await expect(storage.read("slot")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await factory.close();
  });

  it("rejects scope, tenant, slot, column, and value bounds before acquiring an operation connection", async () => {
    const { MysqlStorageConfigurationError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_1",
    });
    connectionAcquires = 0;
    expect(() =>
      factory.createRecordStorage(
        { name: "x".repeat(600), multitenant: false },
        new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
      ),
    ).toThrow("too large");
    const tenantStorage = factory.createRecordStorage(
      { name: "Tasks", multitenant: true, tenantId: " " },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    await expect(tenantStorage.read("slot")).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    const oversizedSlotStorage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    await expect(oversizedSlotStorage.read("x".repeat(768))).rejects.toThrow("too large");
    const oversizedColumnStorage = factory.createRecordStorage(
      { name: "Columns", multitenant: false },
      new RecordSpec<string, StringValue>({
        schema: StringValueSchema,
        extractId: (record: StringValue): string => record.value,
        columns: [new RecordColumn<StringValue, string>("x".repeat(256), () => "value")],
      }),
    );
    await expect(
      oversizedColumnStorage.write(create(StringValueSchema, { value: "slot" })),
    ).rejects.toThrow("too large");
    const oversizedValueStorage = factory.createRecordStorage(
      { name: "Values", multitenant: false },
      new RecordSpec<string, StringValue>({
        schema: StringValueSchema,
        extractId: (record: StringValue): string => record.value,
        columns: [new RecordColumn<StringValue, string>("value", () => "x".repeat(257))],
      }),
    );
    await expect(
      oversizedValueStorage.write(create(StringValueSchema, { value: "slot" })),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    expect(connectionAcquires).toBe(0);
    await factory.close();
  });

  it("pushes scoped typed ID and column equality predicates into one bound SQL query", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_3",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        extractId: (record) => record.value,
        columns: [new RecordColumn<StringValue, string>("state", () => "open")],
      }),
    );

    operationRows = [];
    await expect(
      storage.queryEntries({ ids: ["slot-1"], filters: [{ column: "state", value: "open" }] }),
    ).resolves.toEqual([]);

    const query = calls.find(({ sql }) => sql.includes("SELECT r.slot_key, r.payload"));
    expect(query?.sql).toContain("INNER JOIN `spine_ts_columns` AS f0");
    expect(query?.sql).toContain("r.slot_key IN (?)");
    expect(query?.sql).toContain("f0.value_kind = ? AND f0.value_data IN (?)");
    expect(query?.sql).toContain("ORDER BY r.slot_key ASC");
    expect(query?.values).toHaveLength(6);
    expect(query?.values?.[0]).toEqual(CanonicalMysqlValue.encode("state", 255));
    expect(query?.values?.[3]).toEqual(
      CanonicalMysqlValue.encode(["Tasks", false, StringValueSchema.typeName], 512),
    );
    expect(query?.values?.[5]).toEqual(CanonicalMysqlValue.encode("slot-1", 768));
    await factory.close();
  });

  it("short-circuits an empty column IN filter before acquiring a pool connection", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_3",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({ schema: StringValueSchema, extractId: (record) => record.value }),
    );
    connectionAcquires = 0;

    await expect(storage.query({ filters: [{ column: "state", value: [] }] })).resolves.toEqual([]);
    expect(connectionAcquires).toBe(0);
    await factory.close();
  });
});
