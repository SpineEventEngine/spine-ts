import { beforeEach, describe, expect, it, vi } from "vitest";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec } from "@spine-ts/storage";

const calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
let endCalls = 0;
let poolOptions: unknown;

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn((options) => {
    poolOptions = options;
    return {
      async getConnection() {
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
            return [[], []];
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
  { table_name: "spine_ts_records", column_name: "scope_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_records", column_name: "tenant_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_records", column_name: "slot_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_records", column_name: "payload", column_type: "mediumblob" },
  { table_name: "spine_ts_records", column_name: "revision", column_type: "bigint unsigned" },
  {
    table_name: "spine_ts_records",
    column_name: "schema_version",
    column_type: "smallint unsigned",
    column_default: "1",
  },
  { table_name: "spine_ts_columns", column_name: "scope_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_columns", column_name: "tenant_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_columns", column_name: "slot_key", column_type: "varbinary(768)" },
  { table_name: "spine_ts_columns", column_name: "column_name", column_type: "varbinary(768)" },
  { table_name: "spine_ts_columns", column_name: "value_kind", column_type: "tinyint unsigned" },
  { table_name: "spine_ts_columns", column_name: "value_data", column_type: "mediumblob" },
];
let schemaRows = compatibleSchemaRows;
const compatibleTableRows = [
  { table_name: "spine_ts_records", engine: "InnoDB" },
  { table_name: "spine_ts_columns", engine: "InnoDB" },
];
let tableRows = compatibleTableRows;
let connectError: Error | undefined;

describe("MysqlStorageFactory", () => {
  beforeEach(() => {
    calls.length = 0;
    endCalls = 0;
    schemaRows = compatibleSchemaRows;
    tableRows = compatibleTableRows;
    connectError = undefined;
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
});
