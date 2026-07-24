import { beforeEach, describe, expect, it, vi } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";

import { CanonicalMysqlValue, SortableMysqlColumnValue } from "../src/mysql/value-codec.js";
import {
  assertQueryProviderConformance,
  queryProviderConformanceRecords,
} from "../../storage/test/query/query-provider-conformance.js";

const calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
let endCalls = 0;
let poolOptions: unknown;
let operationError: Error | undefined;
let operationRows: unknown[] = [];
let connectionAcquires = 0;
let executeFailure: ((sql: string) => Error | undefined) | undefined;
let commitFailure: Error | undefined;
let rollbackFailure: Error | undefined;
let transactionStarts = 0;
let commits = 0;
let rollbacks = 0;
let releases = 0;
let endFailure: Error | undefined;
let executeGate: ((sql: string) => Promise<void>) | undefined;
let endGate: Promise<void> | undefined;
let onRelease: (() => void) | undefined;
let getConnectionGate: (() => Promise<void>) | undefined;

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn((options) => {
    poolOptions = options;
    return {
      async getConnection() {
        connectionAcquires += 1;
        await Promise.resolve();
        await getConnectionGate?.();
        if (connectError !== undefined) {
          throw connectError;
        }
        return {
          async query(sql: string, values?: readonly unknown[]) {
            await Promise.resolve();
            calls.push(values === undefined ? { sql } : { sql, values });
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
            calls.push(values === undefined ? { sql } : { sql, values });
            await executeGate?.(sql);
            const failure = executeFailure?.(sql);
            if (failure !== undefined) throw failure;
            if (operationError !== undefined) throw operationError;
            if (sql.includes("SELECT payload")) {
              return [operationRows, []];
            }
            return [{ affectedRows: 1 }, []];
          },
          beginTransaction() {
            transactionStarts += 1;
            return Promise.resolve();
          },
          commit() {
            commits += 1;
            if (commitFailure !== undefined) return Promise.reject(commitFailure);
            return Promise.resolve();
          },
          rollback() {
            rollbacks += 1;
            if (rollbackFailure !== undefined) return Promise.reject(rollbackFailure);
            return Promise.resolve();
          },
          release() {
            releases += 1;
            onRelease?.();
            return undefined;
          },
        };
      },
      async end() {
        await Promise.resolve();
        endCalls += 1;
        await endGate;
        if (endFailure !== undefined) throw endFailure;
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
  it("conforms to the shared normalized query provider fixture", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_query_conformance",
    });
    const storage = factory.createRecordStorage(
      { name: "QueryConformance", multitenant: false },
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

    await assertQueryProviderConformance({
      name: "mysql",
      storage,
      providerCalls: () => connectionAcquires,
      beforeRead: () => {
        operationRows = queryProviderConformanceRecords.map((value) => ({
          slot_key: CanonicalMysqlValue.encode(value, 768),
          payload: toBinary(StringValueSchema, create(StringValueSchema, { value })),
        }));
      },
    });
    await factory.close();
  });
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
    executeFailure = undefined;
    commitFailure = undefined;
    rollbackFailure = undefined;
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;
    releases = 0;
    endFailure = undefined;
    executeGate = undefined;
    endGate = undefined;
    onRelease = undefined;
    getConnectionGate = undefined;
    poolOptions = undefined;
  });

  it("initializes exactly two fixed binary-comparison tables and closes its owned pool once", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");

    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_1",
    });
    const handle = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
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

  it("leaves a manually closed handle closed while factory close closes the remaining handle", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const first = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const live = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    first.close();
    expect(first.isOpen()).toBe(false);
    expect(endCalls).toBe(0);
    const closed = factory.close();
    expect(factory.isOpen()).toBe(false);
    expect(live.isOpen()).toBe(false);
    expect(() =>
      factory.createRecordStorage(
        { name: "Tasks", multitenant: false },
        new RecordSpec({
          schema: StringValueSchema,
          storageKey: "StringValueSchema:legacy",
          idKind: "string",
          extractId: (record) => record.value,
        }),
      ),
    ).toThrow("StorageFactory is closed");
    await closed;
    expect(endCalls).toBe(1);
  });

  it("shares an observable pool-close failure without unhandled replacement promises", async () => {
    const { MysqlStorageConnectionError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    endFailure = new Error("pool end failure");

    const first = factory.close();
    const second = factory.close();
    expect(first).toBe(second);
    await expect(first).rejects.toBeInstanceOf(MysqlStorageConnectionError);
    await expect(first).rejects.not.toThrow("pool end failure");
    await expect(second).rejects.toBeInstanceOf(MysqlStorageConnectionError);
    expect(endCalls).toBe(1);
  });

  it("lets an admitted operation release before factory close settles", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    let releaseExecute: (() => void) | undefined;
    let enteredExecute: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredExecute = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseExecute = resolve;
    });
    executeGate = (sql) => {
      if (!sql.startsWith("INSERT INTO `spine_ts_records`")) return Promise.resolve();
      enteredExecute?.();
      return gate;
    };
    const write = storage.write(create(StringValueSchema, { value: "admitted" }));
    await entered;
    const closing = factory.close();
    let closeSettled = false;
    void closing.then(
      () => {
        closeSettled = true;
      },
      () => {
        closeSettled = true;
      },
    );
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    expect(endCalls).toBe(0);
    await expect(storage.read("admitted")).rejects.toThrow("RecordStorage is closed");
    expect(() =>
      factory.createRecordStorage(
        { name: "Tasks", multitenant: false },
        new RecordSpec({
          schema: StringValueSchema,
          storageKey: "StringValueSchema:legacy",
          idKind: "string",
          extractId: (record) => record.value,
        }),
      ),
    ).toThrow("StorageFactory is closed");
    releaseExecute?.();
    await write;
    expect(closeSettled).toBe(false);
    await closing;
    expect(closeSettled).toBe(true);
    expect(endCalls).toBe(1);
    expect(releases).toBeGreaterThanOrEqual(1);
  });

  it("drains an admitted pool acquisition that rejects during factory close", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    connectionAcquires = 0;
    let acquisitionPending = false;
    let rejectAcquisition: ((reason: Error) => void) | undefined;
    getConnectionGate = () => {
      acquisitionPending = true;
      return new Promise<void>((_resolve, reject) => {
        rejectAcquisition = reject;
      });
    };

    const operation = storage.read("pending");
    await Promise.resolve();
    expect(acquisitionPending).toBe(true);
    expect(connectionAcquires).toBe(1);
    const closing = factory.close();
    let closeSettled = false;
    void closing.then(
      () => {
        closeSettled = true;
      },
      () => {
        closeSettled = true;
      },
    );
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    expect(endCalls).toBe(0);

    rejectAcquisition?.(new Error("provider secret"));
    await expect(operation).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await expect(operation).rejects.not.toThrow("provider secret");
    await closing;
    expect(closeSettled).toBe(true);
    expect(endCalls).toBe(1);
  });

  it("fails closed when a fixed table has an incompatible schema", async () => {
    schemaRows = compatibleSchemaRows.map((row, index) =>
      index === 0 ? { ...row, column_type: "varchar(768)" } : row,
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
      connectionLimit: 4,
      connectTimeoutMs: 2_000,
      tls: { ca: "test-ca", rejectUnauthorized: true },
    });
    await factory.close();

    expect(poolOptions).toMatchObject({
      connectionLimit: 4,
      connectTimeout: 2_000,
      ssl: { ca: "test-ca", rejectUnauthorized: true },
    });
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

  it("fails closed when either fixed table is not InnoDB", async () => {
    tableRows = compatibleTableRows.map((table) =>
      table.table_name === "spine_ts_columns" ? { ...table, engine: "MyISAM" } : table,
    );
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");

    await expect(
      MysqlStorageFactory.create({ url: "mysql://spine:secret@localhost:3306/spine_packet_5" }),
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
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
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
        new RecordSpec({
          schema: StringValueSchema,
          storageKey: "StringValueSchema:legacy",
          idKind: "string",
          extractId: (record) => record.value,
        }),
      ),
    ).toThrow("too large");
    const tenantStorage = factory.createRecordStorage(
      { name: "Tasks", multitenant: true, tenantId: " " },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await expect(tenantStorage.read("slot")).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    const oversizedSlotStorage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await expect(oversizedSlotStorage.read("x".repeat(768))).rejects.toThrow("too large");
    const oversizedColumnStorage = factory.createRecordStorage(
      { name: "Columns", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record: StringValue): string => record.value,
        columns: [new RecordColumn<StringValue, string>("x".repeat(256), () => "value", "string")],
      }),
    );
    await expect(
      oversizedColumnStorage.write(create(StringValueSchema, { value: "slot" })),
    ).rejects.toThrow("too large");
    const oversizedValueStorage = factory.createRecordStorage(
      { name: "Values", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record: StringValue): string => record.value,
        columns: [new RecordColumn<StringValue, string>("value", () => "x".repeat(257), "string")],
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
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [new RecordColumn<StringValue, string>("state", () => "open", "string")],
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

  it("compiles nested normalized comparisons, ordering, and limits with bound values", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_query",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>("state", (record) => record.value, "string"),
        ],
      }),
    );

    await storage.queryPlan({
      predicate: {
        kind: "either",
        predicates: [
          { kind: "comparison", column: "state", operator: "greaterThan", value: "private-value" },
          { kind: "ids", ids: ["slot-1"] },
        ],
      },
      order: [{ column: "state", direction: "desc" }],
      limit: 3,
    });

    const query = calls.find(({ sql }) => sql.includes("SELECT r.slot_key, r.payload"));
    expect(query?.sql).toContain("LEFT JOIN `spine_ts_columns` AS p0");
    expect(query?.sql).toContain("LEFT JOIN `spine_ts_columns` AS s0");
    expect(query?.sql).toContain(" OR ");
    expect(query?.sql).toContain("LIMIT ?");
    expect(query?.sql).not.toContain("private-value");
    expect(query?.values).toContain(3);
    await factory.close();
  });

  it("parameterizes every normalized comparison and conjunctive ID shape", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_query_operators",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>("state", (record) => record.value, "string"),
        ],
      }),
    );

    await storage.queryPlan({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "ids", ids: ["slot-1", "slot-2"] },
          { kind: "comparison", column: "state", operator: "equal", value: "a" },
          { kind: "comparison", column: "state", operator: "lessThan", value: "b" },
          { kind: "comparison", column: "state", operator: "greaterOrEqual", value: "c" },
          { kind: "comparison", column: "state", operator: "lessOrEqual", value: "d" },
        ],
      },
      order: [{ column: "state", direction: "asc" }],
    });

    const query = calls.findLast(({ sql }) => sql.includes("SELECT r.slot_key, r.payload"));
    expect(query?.sql).toContain(" AND ");
    expect(query?.sql).toContain("r.slot_key IN (?, ?)");
    expect(query?.sql).toContain("value_data = ?");
    expect(query?.sql).toContain("value_data < ?");
    expect(query?.sql).toContain("value_data >= ?");
    expect(query?.sql).toContain("value_data <= ?");
    expect(query?.sql).toContain("value_data ASC");
    expect(query?.sql).not.toContain("LIMIT ?");
    await factory.close();
  });

  it("binds a candidate sentinel limit before materializing a semantically limited plan", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_query_candidate_limit",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );

    await storage.queryPlan({
      candidateLimit: 2,
      limit: 1,
      order: [{ column: "id", direction: "asc" }],
    });

    const query = calls.findLast(({ sql }) => sql.includes("SELECT r.slot_key, r.payload"));
    expect(query?.sql).toContain("LIMIT ?");
    expect(query?.values?.at(-1)).toBe(3);
    await factory.close();
  });

  it("short-circuits an empty column IN filter before acquiring a pool connection", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_3",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    connectionAcquires = 0;

    await expect(storage.query({ filters: [{ column: "state", value: [] }] })).resolves.toEqual([]);
    expect(connectionAcquires).toBe(0);
    await factory.close();
  });

  it("pre-encodes a whole batch before acquiring its single transaction connection", async () => {
    const { MysqlStorageConfigurationError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Batch", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>("value", (record) => record.value, "string"),
        ],
      }),
    );
    connectionAcquires = 0;

    await expect(
      storage.writeAll([
        create(StringValueSchema, { value: "first" }),
        create(StringValueSchema, { value: "x".repeat(257) }),
      ]),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);

    expect(connectionAcquires).toBe(0);
    await factory.close();
  });

  it("uses one transaction and preserves batch statement order", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Batch", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    calls.length = 0;
    connectionAcquires = 0;
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;
    releases = 0;

    await storage.writeAll([
      create(StringValueSchema, { value: "first" }),
      create(StringValueSchema, { value: "second" }),
      create(StringValueSchema, { value: "first" }),
    ]);

    expect(connectionAcquires).toBe(1);
    expect(transactionStarts).toBe(1);
    expect(commits).toBe(1);
    expect(rollbacks).toBe(0);
    expect(releases).toBe(1);
    expect(
      calls
        .filter(({ sql }) => sql.startsWith("INSERT INTO `spine_ts_records`"))
        .map(({ values }) => values?.[2]),
    ).toEqual([
      CanonicalMysqlValue.encode("first", 768),
      CanonicalMysqlValue.encode("second", 768),
      CanonicalMysqlValue.encode("first", 768),
    ]);
    await factory.close();
  });

  it("rolls a failed later batch statement back exactly once before releasing", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Batch", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;
    releases = 0;
    let inserts = 0;
    executeFailure = (sql) => {
      if (!sql.startsWith("INSERT INTO `spine_ts_records`")) return undefined;
      inserts += 1;
      return inserts === 2 ? new Error("later record failure") : undefined;
    };

    await expect(
      storage.writeAll([
        create(StringValueSchema, { value: "first" }),
        create(StringValueSchema, { value: "second" }),
      ]),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);

    expect({ transactionStarts, commits, rollbacks, releases }).toEqual({
      transactionStarts: 1,
      commits: 0,
      rollbacks: 1,
      releases: 1,
    });
    await factory.close();
  });

  it("rolls a failed batch commit back exactly once before releasing", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Batch", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;
    releases = 0;
    commitFailure = new Error("commit failure");

    await expect(
      storage.writeAll([create(StringValueSchema, { value: "one" })]),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);

    expect({ transactionStarts, commits, rollbacks, releases }).toEqual({
      transactionStarts: 1,
      commits: 1,
      rollbacks: 1,
      releases: 1,
    });
    await factory.close();
  });

  it("sanitizes a pool-acquisition failure for transactional writes", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Batch", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;
    releases = 0;
    connectError = new Error("provider secret");

    await expect(
      storage.writeAll([create(StringValueSchema, { value: "one" })]),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);
    expect({ transactionStarts, rollbacks, releases }).toEqual({
      transactionStarts: 0,
      rollbacks: 0,
      releases: 0,
    });
    await factory.close();
  });

  it("returns false only after rolling back an exact duplicate absent-create claim", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Cas", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;
    releases = 0;
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO `spine_ts_records`")
        ? Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" })
        : undefined;

    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "next" })),
    ).resolves.toBe(false);

    expect({ transactionStarts, commits, rollbacks, releases }).toEqual({
      transactionStarts: 1,
      commits: 0,
      rollbacks: 1,
      releases: 1,
    });
    await factory.close();
  });

  it("sanitizes a duplicate claim when its rollback fails", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Cas", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    transactionStarts = 0;
    rollbacks = 0;
    releases = 0;
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO `spine_ts_records`")
        ? Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" })
        : undefined;
    rollbackFailure = new Error("rollback failure");

    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "next" })),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);

    expect({ transactionStarts, rollbacks, releases }).toEqual({
      transactionStarts: 1,
      rollbacks: 1,
      releases: 1,
    });
    await factory.close();
  });

  it("sanitizes a nonduplicate absent-create claim failure after one rollback", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Cas", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    transactionStarts = 0;
    rollbacks = 0;
    releases = 0;
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO `spine_ts_records`") ? new Error("deadlock") : undefined;

    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "next" })),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);

    expect({ transactionStarts, rollbacks, releases }).toEqual({
      transactionStarts: 1,
      rollbacks: 1,
      releases: 1,
    });
    await factory.close();
  });

  it("rolls stale and corrupt locked CAS rows back once before releasing", async () => {
    const { MysqlStorageDataError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_4",
    });
    const storage = factory.createRecordStorage(
      { name: "Cas", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const expected = create(StringValueSchema, { value: "expected" });
    transactionStarts = 0;
    rollbacks = 0;
    releases = 0;
    operationRows = [{ payload: new Uint8Array([1]) }];

    await expect(storage.compareAndSet("slot", expected, undefined)).resolves.toBe(false);
    expect({ transactionStarts, rollbacks, releases }).toEqual({
      transactionStarts: 1,
      rollbacks: 1,
      releases: 1,
    });

    transactionStarts = 0;
    rollbacks = 0;
    releases = 0;
    operationRows = [{ payload: "corrupt" }];
    await expect(storage.compareAndSet("slot", expected, undefined)).rejects.toBeInstanceOf(
      MysqlStorageDataError,
    );
    expect({ transactionStarts, rollbacks, releases }).toEqual({
      transactionStarts: 1,
      rollbacks: 1,
      releases: 1,
    });
    await factory.close();
  });

  it("commits delete and absent-create CAS operations while replacing their indexed columns", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
        columns: [
          new RecordColumn<StringValue, string>("state", (record) => record.value, "string"),
        ],
      }),
    );
    calls.length = 0;
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;

    await expect(storage.delete("gone")).resolves.toBe(true);
    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "open" })),
    ).resolves.toBe(true);

    expect({ transactionStarts, commits, rollbacks }).toEqual({
      transactionStarts: 2,
      commits: 2,
      rollbacks: 0,
    });
    expect(calls.map(({ sql }) => sql).join("\n")).toContain(
      "DELETE FROM `spine_ts_records` WHERE scope_key = ? AND tenant_key = ? AND slot_key = ?",
    );
    expect(calls.map(({ sql }) => sql).join("\n")).toContain("INSERT INTO `spine_ts_columns`");
    await factory.close();
  });

  it("returns decoded records and rejects corrupt query rows without exposing provider errors", async () => {
    const { MysqlStorageDataError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const payload = create(StringValueSchema, { value: "ready" });
    const encodedPayload = new Uint8Array([10, 5, 114, 101, 97, 100, 121]);

    operationRows = [{ payload: encodedPayload }];
    await expect(storage.read("ready")).resolves.toEqual(payload);
    operationRows = [
      { slot_key: CanonicalMysqlValue.encode("ready"), payload: encodedPayload },
      { slot_key: "corrupt", payload: encodedPayload },
    ];
    await expect(storage.queryEntries({})).rejects.toBeInstanceOf(MysqlStorageDataError);
    await factory.close();
  });

  it("pushes multi-kind filters, descending keysets, and offset-only windows into bound SQL", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    calls.length = 0;
    operationRows = [];

    await expect(
      storage.queryEntries({
        filters: [{ column: "state", value: ["open", "open", 2] }],
        sort: [{ field: "state", direction: "desc" }],
        after: { values: [{ field: "state", value: "open" }], id: "slot" },
        offset: 3,
      }),
    ).resolves.toEqual([]);

    const query = calls.find(({ sql }) => sql.includes("SELECT r.slot_key, r.payload"));
    expect(query?.sql).toContain("f0.value_kind = ? AND f0.value_data IN (?) OR f0.value_kind = ?");
    expect(query?.sql).toContain("s0.value_kind DESC, s0.value_data DESC");
    expect(query?.sql).toContain("s0.value_kind < ?");
    expect(query?.sql).toContain("LIMIT 18446744073709551615 OFFSET ?");
    const open = SortableMysqlColumnValue.encode("open");
    const two = SortableMysqlColumnValue.encode(2);
    expect(query?.values).toEqual([
      CanonicalMysqlValue.encode("state", 255),
      open.kind,
      open.data,
      two.kind,
      two.data,
      CanonicalMysqlValue.encode("state", 255),
      CanonicalMysqlValue.encode(["Tasks", false, StringValueSchema.typeName], 512),
      CanonicalMysqlValue.encode(null, 255),
      open.kind,
      open.kind,
      open.data,
      open.kind,
      open.data,
      CanonicalMysqlValue.encode("slot", 768),
      3,
    ]);
    await factory.close();
  });

  it("rejects invalid query columns before acquiring a connection and releases failed deletes", async () => {
    const { MysqlStorageConfigurationError, MysqlStorageFactory, MysqlStorageOperationError } =
      await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    connectionAcquires = 0;

    await expect(
      storage.query({ sort: [{ field: "payload.state", direction: "asc" }] }),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    expect(connectionAcquires).toBe(0);
    executeFailure = (sql) =>
      sql.startsWith("DELETE FROM `spine_ts_records`") ? new Error("lost") : undefined;
    rollbacks = 0;
    releases = 0;
    await expect(storage.delete("slot")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    expect({ rollbacks, releases }).toEqual({ rollbacks: 1, releases: 1 });
    await factory.close();
  });

  it("preserves optional pool defaults and rejects each invalid factory option before connection", async () => {
    const { MysqlStorageConfigurationError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({ url: "mysql://localhost/spine_packet_5" });
    expect(poolOptions).not.toHaveProperty("port");
    expect(poolOptions).not.toHaveProperty("user");
    expect(poolOptions).not.toHaveProperty("password");
    expect(poolOptions).not.toHaveProperty("connectionLimit");
    expect(poolOptions).not.toHaveProperty("connectTimeout");
    await factory.close();

    for (const options of [
      { url: "not a url" },
      { url: "postgres://localhost/spine_packet_5" },
      { url: "mysql://localhost/" },
      { url: "mysql://localhost/spine_packet_5#fragment" },
      { url: "mysql://localhost/spine_packet_5", connectionLimit: 0 },
      { url: "mysql://localhost/spine_packet_5", connectTimeoutMs: 1.5 },
    ]) {
      await expect(MysqlStorageFactory.create(options)).rejects.toBeInstanceOf(
        MysqlStorageConfigurationError,
      );
    }
  });

  it("handles each locked CAS state without leaking its transaction", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const expected = create(StringValueSchema, { value: "expected" });

    operationRows = [];
    await expect(storage.compareAndSet("slot", undefined, undefined)).resolves.toBe(true);
    operationRows = [{ payload: toBinary(StringValueSchema, expected) }];
    await expect(storage.compareAndSet("slot", undefined, undefined)).resolves.toBe(false);
    await expect(storage.compareAndSet("slot", expected, undefined)).resolves.toBe(true);
    expect(rollbacks).toBeGreaterThanOrEqual(1);
    await factory.close();
  });

  it("uses a dynamic tenant and parameterized limit/offset for an ID-only query", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const context = { name: "Tasks", multitenant: true, tenantId: "blue" };
    const storage = factory.createRecordStorage(
      context,
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    calls.length = 0;
    await storage.queryEntries({
      filters: [{ column: "id", value: ["a", "b"] }],
      sort: [{ field: "id", direction: "asc" }],
      limit: 2,
      offset: 1,
    });
    const query = calls.find(({ sql }) => sql.includes("SELECT r.slot_key, r.payload"));
    expect(query?.sql).toContain("r.slot_key IN (?, ?)");
    expect(query?.sql).toContain("ORDER BY r.slot_key ASC, r.slot_key ASC LIMIT ? OFFSET ?");
    expect(query?.values).toContain(2);
    expect(query?.values).toContain(1);
    context.tenantId = "green";
    await storage.read("slot");
    await factory.close();
  });

  it("closes a handle idempotently and sanitizes write failures after rollback", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Tasks", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    storage.close();
    storage.close();
    expect(storage.isOpen()).toBe(false);
    const writable = factory.createRecordStorage(
      { name: "Writable", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO `spine_ts_records`") ? new Error("lost") : undefined;
    await expect(
      writable.write(create(StringValueSchema, { value: "slot" })),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);
    expect(rollbacks).toBe(1);
    await factory.close();
  });

  it("accepts each documented query-structure boundary", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Bounds", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    connectionAcquires = 0;

    await storage.query({ ids: Array.from({ length: 256 }, (_, index) => `id-${String(index)}`) });
    await storage.query({
      filters: Array.from({ length: 32 }, (_, index) => ({
        column: `column-${String(index)}`,
        value: index,
      })),
    });
    await storage.query({
      filters: [
        {
          column: "state",
          value: Array.from({ length: 64 }, (_, index) => `value-${String(index)}`),
        },
      ],
    });
    await storage.query({
      sort: Array.from({ length: 8 }, (_, index) => ({
        field: `column-${String(index)}`,
        direction: "asc" as const,
      })),
    });
    await storage.query({
      filters: Array.from({ length: 31 }, (_, filter) => ({
        column: `bound-${String(filter)}`,
        value: Array.from(
          { length: 64 },
          (_, value) => `bound-${String(filter)}-value-${String(value)}`,
        ),
      })),
    });

    expect(connectionAcquires).toBe(5);
    await factory.close();
  });

  it("rejects query-structure overflow before pool acquisition", async () => {
    const { MysqlStorageConfigurationError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Bounds", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    connectionAcquires = 0;

    await expect(
      storage.query({ ids: Array.from({ length: 257 }, (_, index) => `id-${String(index)}`) }),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    await expect(
      storage.query({
        filters: Array.from({ length: 33 }, (_, index) => ({
          column: `column-${String(index)}`,
          value: index,
        })),
      }),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    await expect(
      storage.query({
        filters: [
          {
            column: "state",
            value: Array.from({ length: 65 }, (_, index) => `value-${String(index)}`),
          },
        ],
      }),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    await expect(
      storage.query({
        sort: Array.from({ length: 9 }, (_, index) => ({
          field: `column-${String(index)}`,
          direction: "asc" as const,
        })),
      }),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    expect(connectionAcquires).toBe(0);
    await factory.close();
  });

  it("rejects a query exceeding the total bind limit before pool acquisition", async () => {
    const { MysqlStorageConfigurationError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_5",
    });
    const storage = factory.createRecordStorage(
      { name: "Bounds", multitenant: false },
      new RecordSpec({
        schema: StringValueSchema,
        storageKey: "StringValueSchema:legacy",
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    connectionAcquires = 0;

    await expect(
      storage.query({
        filters: Array.from({ length: 32 }, (_, filter) => ({
          column: `column-${String(filter)}`,
          value: Array.from(
            { length: 64 },
            (_, value) => `filter-${String(filter)}-value-${String(value)}`,
          ),
        })),
      }),
    ).rejects.toBeInstanceOf(MysqlStorageConfigurationError);
    expect(connectionAcquires).toBe(0);
    await factory.close();
  });
});
