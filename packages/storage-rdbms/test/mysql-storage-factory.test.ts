import { beforeEach, describe, expect, it, vi } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/internal/entity-history";
import { assertCurrentQueryConformance } from "../../storage/src/entity/history-conformance.js";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";

import { CanonicalMysqlValue, SortableMysqlColumnValue } from "../src/mysql/value-codec.js";
import { entityHistorySchema } from "../src/mysql/entity-history.js";
import {
  assertQueryProviderConformance,
  queryProviderConformanceRecords,
} from "../../storage/test/query/query-provider-conformance.js";

const calls: {
  readonly connectionId: number;
  readonly sql: string;
  readonly values?: readonly unknown[];
}[] = [];
let endCalls = 0;
let poolOptions: unknown;
let operationError: Error | undefined;
let operationRows: unknown[] = [];
let connectionAcquires = 0;
let connectionFailureAt: number | undefined;
let queryFailure: ((sql: string) => Error | undefined) | undefined;
let executeFailure: ((sql: string) => Error | undefined) | undefined;
let commitFailure: Error | undefined;
const commitResponses: (Error | undefined)[] = [];
let rollbackFailure: Error | undefined;
let transactionStarts = 0;
let commits = 0;
let rollbacks = 0;
let releases = 0;
let releaseFailureAt: number | undefined;
let endFailure: Error | undefined;
let executeGate: ((sql: string) => Promise<void>) | undefined;
let endGate: Promise<void> | undefined;
let onRelease: (() => void) | undefined;
let getConnectionGate: (() => Promise<void>) | undefined;
let nextConnectionId = 1;
let destroys = 0;
const userLocks = new Map<string, number>();
const lockResponses: (number | null | Error)[] = [];
const lockWaiters = new Map<string, (() => void)[]>();
const trimSelections: unknown[][] = [];
const truncateSelections: unknown[][] = [];
const truncateRows: {
  readonly table: "states" | "events";
  readonly write_order: bigint;
  readonly entity_key?: Uint8Array;
  readonly event_key?: Uint8Array;
  readonly version?: bigint;
}[] = [];
let afterTruncateCutoff: (() => void) | undefined;
const entitySpecifications = new Map<string, Uint8Array>();
const entityCurrent = new Map<
  string,
  {
    readonly scope: Uint8Array;
    readonly entity: Uint8Array;
    readonly payload: Uint8Array;
    readonly version: bigint;
    readonly archived: boolean;
    readonly deleted: boolean;
  }
>();

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn((options) => {
    poolOptions = options;
    return {
      async getConnection() {
        const connectionId = nextConnectionId++;
        connectionAcquires += 1;
        await Promise.resolve();
        await getConnectionGate?.();
        if (connectError !== undefined) {
          throw connectError;
        }
        if (connectionAcquires === connectionFailureAt) throw new Error("provider secret");
        return {
          async query(sql: string, values?: readonly unknown[]) {
            await Promise.resolve();
            calls.push(
              values === undefined ? { connectionId, sql } : { connectionId, sql, values },
            );
            const failure = queryFailure?.(sql);
            if (failure !== undefined) throw failure;
            if (sql.includes("information_schema.columns") && sql.includes("spine_ts_entity")) {
              return [entitySchemaRows, []];
            }
            if (sql.includes("information_schema.columns")) {
              return [schemaRows, []];
            }
            if (sql.includes("information_schema.tables") && sql.includes("spine_ts_entity")) {
              return [entityTableRows, []];
            }
            if (sql.includes("information_schema.tables")) {
              return [tableRows, []];
            }
            if (sql.includes("information_schema.statistics") && sql.includes("spine_ts_entity")) {
              return [entityIndexRows, []];
            }
            if (sql.includes("information_schema.statistics")) {
              return [indexRows, []];
            }
            if (sql.includes("information_schema.key_column_usage")) {
              return [foreignKeyRows, []];
            }
            if (sql.includes("SELECT r.slot_key, r.payload")) return [operationRows, []];
            if (
              entityCurrent.size > 0 &&
              sql.startsWith(
                "SELECT payload, version, archived, deleted FROM spine_ts_entity_current",
              )
            ) {
              const row = entityCurrent.get(`${fakeKey(values?.[0])}:${fakeKey(values?.[1])}`);
              return [row === undefined ? [] : [row], []];
            }
            if (
              entityCurrent.size > 0 &&
              sql.includes("FROM spine_ts_entity_current WHERE scope_key=? AND deleted=0")
            ) {
              const scope = fakeKey(values?.[0]);
              return [
                [...entityCurrent.values()]
                  .filter((row) => fakeKey(row.scope) === scope && !row.deleted)
                  .map((row) => ({
                    entity_key: row.entity,
                    payload: row.payload,
                    version: row.version,
                    archived: row.archived,
                    deleted: row.deleted,
                  })),
                [],
              ];
            }
            return [[], []];
          },
          async execute(sql: string, values?: readonly unknown[]) {
            await Promise.resolve();
            calls.push(
              values === undefined ? { connectionId, sql } : { connectionId, sql, values },
            );
            await executeGate?.(sql);
            const failure = executeFailure?.(sql);
            if (failure !== undefined) throw failure;
            if (operationError !== undefined) throw operationError;
            if (sql.includes("GET_LOCK")) {
              const scripted = lockResponses.shift();
              if (scripted instanceof Error) throw scripted;
              if (scripted !== undefined) return [[{ acquired: scripted }], []];
              const name = String(values?.[0]);
              const owner = userLocks.get(name);
              if (owner === undefined || owner === connectionId) {
                userLocks.set(name, connectionId);
                return [[{ acquired: 1 }], []];
              }
              await new Promise<void>((resolve) => {
                const waiters = lockWaiters.get(name) ?? [];
                waiters.push(resolve);
                lockWaiters.set(name, waiters);
              });
              userLocks.set(name, connectionId);
              return [[{ acquired: 1 }], []];
            }
            if (sql.includes("RELEASE_LOCK")) {
              const name = String(values?.[0]);
              const released = userLocks.get(name) === connectionId ? 1 : 0;
              if (released === 1) {
                userLocks.delete(name);
                lockWaiters.get(name)?.shift()?.();
              }
              return [[{ released }], []];
            }
            if (sql.startsWith("INSERT IGNORE INTO spine_ts_entity_specs")) {
              const scope = fakeKey(values?.[0]);
              const fingerprint = values?.[1];
              if (fingerprint instanceof Uint8Array && !entitySpecifications.has(scope))
                entitySpecifications.set(scope, fingerprint);
              return [{ affectedRows: 1 }, []];
            }
            if (sql.startsWith("SELECT fingerprint FROM spine_ts_entity_specs")) {
              const fingerprint = entitySpecifications.get(fakeKey(values?.[0]));
              return [fingerprint === undefined ? [] : [{ fingerprint }], []];
            }
            if (
              entityCurrent.size > 0 &&
              sql.startsWith(
                "SELECT payload, version, archived, deleted FROM spine_ts_entity_current",
              )
            ) {
              const row = entityCurrent.get(`${fakeKey(values?.[0])}:${fakeKey(values?.[1])}`);
              return [row === undefined ? [] : [row], []];
            }
            if (
              entityCurrent.size > 0 &&
              sql.includes("FROM spine_ts_entity_current WHERE scope_key=? AND deleted=0")
            ) {
              const scope = fakeKey(values?.[0]);
              return [
                [...entityCurrent.values()]
                  .filter((row) => fakeKey(row.scope) === scope && !row.deleted)
                  .map((row) => ({
                    entity_key: row.entity,
                    payload: row.payload,
                    version: row.version,
                    archived: row.archived,
                    deleted: row.deleted,
                  })),
                [],
              ];
            }
            if (sql.startsWith("INSERT INTO spine_ts_entity_current")) {
              const scope = values?.[0];
              const entity = values?.[1];
              const payload = values?.[2];
              if (
                !(scope instanceof Uint8Array) ||
                !(entity instanceof Uint8Array) ||
                !(payload instanceof Uint8Array)
              ) {
                throw new Error("invalid current entity fixture row");
              }
              entityCurrent.set(`${fakeKey(scope)}:${fakeKey(entity)}`, {
                scope,
                entity,
                payload,
                version: BigInt(String(values?.[3])),
                archived: Boolean(values?.[4]),
                deleted: Boolean(values?.[5]),
              });
              return [{ affectedRows: 1 }, []];
            }
            if (sql.includes("SELECT version FROM spine_ts_entity_states")) {
              return [trimSelections.shift() ?? [], []];
            }
            if (
              sql.startsWith("SELECT write_order FROM spine_ts_entity_states") ||
              sql.startsWith("SELECT write_order FROM spine_ts_entity_events")
            ) {
              const table = sql.includes("spine_ts_entity_states") ? "states" : "events";
              const rows = truncateRows.filter((row) => row.table === table);
              if (rows.length > 0) {
                const write_order = rows.reduce((highest, row) =>
                  row.write_order > highest.write_order ? row : highest,
                ).write_order;
                afterTruncateCutoff?.();
                return [[{ write_order }], []];
              }
              return [truncateSelections.shift() ?? [], []];
            }
            if (
              sql.startsWith("SELECT entity_key,version FROM spine_ts_entity_states") ||
              sql.startsWith("SELECT event_key FROM spine_ts_entity_events")
            ) {
              const table = sql.includes("spine_ts_entity_states") ? "states" : "events";
              const cutoff = BigInt(String(values?.at(-1)));
              const rows = truncateRows.filter(
                (row) => row.table === table && row.write_order <= cutoff,
              );
              if (rows.length > 0)
                return [
                  rows.map(({ entity_key, event_key, version }) => ({
                    ...(entity_key === undefined ? {} : { entity_key }),
                    ...(event_key === undefined ? {} : { event_key }),
                    ...(version === undefined ? {} : { version }),
                  })),
                  [],
                ];
              return [truncateSelections.shift() ?? [], []];
            }
            if (
              sql.includes("SELECT payload") ||
              sql.includes("SELECT seconds,nanos,payload") ||
              sql.includes("SELECT version,seconds,nanos,payload")
            ) {
              return [operationRows, []];
            }
            if (sql.startsWith("SELECT entity_key,producer_version,seconds,nanos,payload")) {
              return [operationRows, []];
            }
            if (sql.startsWith("DELETE FROM spine_ts_entity_states") && truncateRows.length > 0) {
              const entity = values?.[1];
              const version = values?.[2];
              const index = truncateRows.findIndex(
                (row) =>
                  row.table === "states" &&
                  sameBytes(row.entity_key, entity) &&
                  row.version === version,
              );
              if (index >= 0) truncateRows.splice(index, 1);
            }
            if (sql.startsWith("DELETE FROM spine_ts_entity_events") && truncateRows.length > 0) {
              const event = values?.[1];
              const index = truncateRows.findIndex(
                (row) => row.table === "events" && sameBytes(row.event_key, event),
              );
              if (index >= 0) truncateRows.splice(index, 1);
            }
            return [{ affectedRows: 1 }, []];
          },
          beginTransaction() {
            transactionStarts += 1;
            return Promise.resolve();
          },
          commit() {
            commits += 1;
            const scripted = commitResponses.shift();
            if (scripted !== undefined) return Promise.reject(scripted);
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
            if (releases === releaseFailureAt) throw new Error("provider secret");
            onRelease?.();
            return undefined;
          },
          destroy() {
            destroys += 1;
            for (const [name, owner] of userLocks) {
              if (owner === connectionId) {
                userLocks.delete(name);
                lockWaiters.get(name)?.shift()?.();
              }
            }
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
const entitySchemaRows = entityHistorySchema.tables.flatMap((table) =>
  table.columns.map((column) => {
    return {
      table_name: table.name,
      column_name: column.name,
      column_type: column.mysqlType,
      is_nullable: entityHistorySchema.columnNullable ? "YES" : "NO",
      extra: column.autoIncrement === true ? "auto_increment" : "",
    };
  }),
);
const entityTableRows = entityHistorySchema.tables.map((table) => ({
  table_name: table.name,
  engine: entityHistorySchema.engine,
}));
const entityIndexRows = entityHistorySchema.tables.flatMap((table) =>
  table.indexes.flatMap((index) =>
    index.columns.map((column, position) => ({
      table_name: table.name,
      index_name: index.name,
      column_name: column.name,
      seq_in_index: position + 1,
      non_unique: index.primary === true || index.unique === true ? 0 : 1,
      collation: column.direction === "DESC" ? "D" : "A",
    })),
  ),
);
let connectError: Error | undefined;

describe("MysqlStorageFactory", () => {
  it("creates the frozen entity current/state/event history storage seam", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_history",
    });
    try {
      const storage = factory.createEntityStorage(entityHistoryInput());
      expect(storage.current).toBeDefined();
      expect(storage.states).toBeDefined();
      expect(storage.events).toBeDefined();
    } finally {
      await factory.close();
    }
  });
  it("runs the shared durable current-query conformance contract", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_current_conformance",
    });
    try {
      await assertCurrentQueryConformance({
        create: (input) =>
          factory.createEntityStorage(input as unknown as EntityStorageInput<string, StringValue>),
        reopen: (input) =>
          factory.createEntityStorage(input as unknown as EntityStorageInput<string, StringValue>),
      });
    } finally {
      await factory.close();
    }
  });
  it("rejects invalid entity-history scope configuration before provider access", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_history_scope_validation",
    });
    const baseline = connectionAcquires;
    try {
      expect(() => factory.createEntityStorage({ ...entityHistoryInput(), layout: " " })).toThrow(
        /non-blank/,
      );
      expect(() =>
        factory.createEntityStorage({
          ...entityHistoryInput(),
          id: {
            clone: (id: string) => id,
            fingerprint: " ",
            key: (id: string) => id,
          },
        }),
      ).toThrow(/non-blank/);
      for (const tenantId of [undefined, " "]) {
        expect(() =>
          factory.createEntityStorage({
            ...entityHistoryInput(),
            context: {
              name: "History",
              multitenant: true,
              ...(tenantId === undefined ? {} : { tenantId }),
            },
          }),
        ).toThrow(/tenantId/);
      }
      expect(connectionAcquires).toBe(baseline);
    } finally {
      await factory.close();
    }
  });
  it("fails closed before entity row access when the state identity key is malformed", async () => {
    const saved = entityIndexRows.slice();
    entityIndexRows.splice(
      0,
      entityIndexRows.length,
      ...saved.filter(
        (row) => row.index_name !== "PRIMARY" || row.table_name !== "spine_ts_entity_states",
      ),
    );
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_schema",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    try {
      await expect(storage.states.backward("task", 1)).rejects.toBeInstanceOf(
        MysqlStorageSchemaError,
      );
      expect(calls.some((call) => call.sql.includes("spine_ts_entity_states WHERE"))).toBe(false);
    } finally {
      entityIndexRows.splice(0, entityIndexRows.length, ...saved);
      await factory.close();
    }
  });
  it.each([
    [
      "specification fingerprint column",
      () => {
        const row = entitySchemaRows.find(
          (candidate) =>
            candidate.table_name === "spine_ts_entity_specs" &&
            candidate.column_name === "fingerprint",
        );
        if (row !== undefined) row.column_type = "varchar(1024)";
      },
    ],
    [
      "event read index",
      () => {
        const index = entityIndexRows.findIndex(
          (row) =>
            row.table_name === "spine_ts_entity_events" &&
            row.index_name === "spine_ts_entity_events_read" &&
            row.seq_in_index === 6,
        );
        if (index >= 0) entityIndexRows.splice(index, 1);
      },
    ],
    [
      "write-order auto-increment",
      () => {
        const row = entitySchemaRows.find((candidate) => candidate.column_name === "write_order");
        if (row !== undefined) row.extra = "";
      },
    ],
    [
      "required column nullability",
      () => {
        const row = entitySchemaRows.find(
          (candidate) =>
            candidate.table_name === "spine_ts_entity_current" &&
            candidate.column_name === "payload",
        );
        if (row !== undefined) row.is_nullable = "YES";
      },
    ],
    [
      "InnoDB engine",
      () => {
        const row = entityTableRows.find(
          (candidate) => candidate.table_name === "spine_ts_entity_events",
        );
        if (row !== undefined) row.engine = "MyISAM";
      },
    ],
    [
      "write-order uniqueness",
      () => {
        const row = entityIndexRows.find((candidate) =>
          candidate.index_name.endsWith("_write_order"),
        );
        if (row !== undefined) row.non_unique = 1;
      },
    ],
    [
      "event read ordering",
      () => {
        const row = entityIndexRows.find(
          (candidate) =>
            candidate.table_name === "spine_ts_entity_events" &&
            candidate.index_name === "spine_ts_entity_events_read" &&
            candidate.seq_in_index === 3,
        );
        if (row !== undefined) row.collation = "A";
      },
    ],
  ])(
    "fails closed before entity row access when %s metadata is malformed",
    async (_name, corrupt) => {
      const savedColumns = entitySchemaRows.map((row) => ({ ...row }));
      const savedIndexes = entityIndexRows.map((row) => ({ ...row }));
      const savedTables = entityTableRows.map((row) => ({ ...row }));
      corrupt();
      const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");
      const factory = await MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_entity_schema",
      });
      const storage = factory.createEntityStorage(entityHistoryInput());
      try {
        await expect(storage.events.backward("task", 1)).rejects.toBeInstanceOf(
          MysqlStorageSchemaError,
        );
        expect(calls.some((call) => call.sql.includes("spine_ts_entity_events WHERE"))).toBe(false);
      } finally {
        entitySchemaRows.splice(0, entitySchemaRows.length, ...savedColumns);
        entityIndexRows.splice(0, entityIndexRows.length, ...savedIndexes);
        entityTableRows.splice(0, entityTableRows.length, ...savedTables);
        await factory.close();
      }
    },
  );

  it("rejects an invalid provider write-order cutoff as malformed data", async () => {
    const { MysqlStorageDataError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_invalid_write_order",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    truncateSelections.push([{ write_order: 0n }]);

    await expect(storage.states.truncate(create(TimestampSchema))).rejects.toBeInstanceOf(
      MysqlStorageDataError,
    );
    await factory.close();
  });
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
    connectionFailureAt = undefined;
    queryFailure = undefined;
    executeFailure = undefined;
    commitFailure = undefined;
    commitResponses.length = 0;
    rollbackFailure = undefined;
    transactionStarts = 0;
    commits = 0;
    rollbacks = 0;
    releases = 0;
    releaseFailureAt = undefined;
    endFailure = undefined;
    executeGate = undefined;
    endGate = undefined;
    onRelease = undefined;
    getConnectionGate = undefined;
    nextConnectionId = 1;
    destroys = 0;
    userLocks.clear();
    lockResponses.length = 0;
    lockWaiters.clear();
    trimSelections.length = 0;
    truncateSelections.length = 0;
    truncateRows.length = 0;
    afterTruncateCutoff = undefined;
    entitySpecifications.clear();
    entityCurrent.clear();
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

  it("drains an admitted entity-history acquisition before ending the pool", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_close",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    connectionAcquires = 0;
    let releaseAcquisition: (() => void) | undefined;
    getConnectionGate = () =>
      new Promise<void>((resolve) => {
        releaseAcquisition = resolve;
      });

    const operation = storage.current.read("pending");
    await Promise.resolve();
    expect(connectionAcquires).toBe(1);
    const closing = factory.close();
    await Promise.resolve();
    expect(endCalls).toBe(0);

    getConnectionGate = undefined;
    releaseAcquisition?.();
    await expect(operation).rejects.toThrow();
    await expect(closing).resolves.toBeUndefined();
    await expect(storage.current.read("later")).rejects.toThrow(/closed|operation/i);
  });

  it("rejects entity-history handle creation after factory close", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_closed",
    });
    await factory.close();
    expect(() => factory.createEntityStorage(entityHistoryInput())).toThrow(
      MysqlStorageOperationError,
    );
  });

  it("requires a provider user lock before a state-history append mutation", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_lock_red",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    await expect(
      storage.states.append({
        entityId: "task",
        state: create(StringValueSchema, { value: "state" }),
        version: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).resolves.toBeUndefined();
    expect(calls.some((call) => call.sql.includes("GET_LOCK"))).toBe(true);
    await factory.close();
  });

  it("keeps one connection from lock acquisition through an identical state retry", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_lock_connection",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO spine_ts_entity_states")
        ? Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" })
        : undefined;
    operationRows = [
      {
        seconds: 1n,
        nanos: 0,
        payload: toBinary(StringValueSchema, create(StringValueSchema, { value: "state" })),
      },
    ];
    await expect(
      storage.states.append({
        entityId: "task",
        state: create(StringValueSchema, { value: "state" }),
        version: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).resolves.toBeUndefined();
    const protectedCalls = calls.filter((call) =>
      /GET_LOCK|INSERT INTO spine_ts_entity_states|SELECT seconds,nanos,payload|RELEASE_LOCK/u.test(
        call.sql,
      ),
    );
    expect([...new Set(protectedCalls.map((call) => call.connectionId))]).toHaveLength(1);
    expect(commits).toBe(1);
    await factory.close();
  });

  it("does not compare a non-duplicate state append failure", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_lock_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO spine_ts_entity_states")
        ? new Error("provider secret")
        : undefined;
    await expect(
      storage.states.append({
        entityId: "task",
        state: create(StringValueSchema, { value: "state" }),
        version: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).rejects.toThrow("could not complete");
    expect(calls.some((call) => call.sql.includes("SELECT seconds,nanos,payload"))).toBe(false);
    expect(rollbacks).toBe(1);
    await factory.close();
  });

  it("does not look up an event after a non-duplicate append failure", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_event_append_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO spine_ts_entity_events")
        ? new Error("provider secret")
        : undefined;

    await expect(
      storage.events.append({
        entityId: "task",
        event: create(EventSchema, { id: create(EventIdSchema, { value: "event-1" }) }),
        producerVersion: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);
    expect(calls.some((call) => call.sql.startsWith("SELECT entity_key,producer_version"))).toBe(
      false,
    );
    await factory.close();
  });

  it.each([0, null, Object.assign(new Error("deadlock"), { code: "ER_USER_LOCK_DEADLOCK" })])(
    "does not mutate when GET_LOCK cannot be acquired",
    async (response) => {
      const { MysqlStorageFactory } = await import("../src/index.js");
      const factory = await MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_entity_lock_unavailable",
      });
      const storage = factory.createEntityStorage(entityHistoryInput());
      lockResponses.push(response);
      await expect(
        storage.states.append({
          entityId: "task",
          state: create(StringValueSchema, { value: "state" }),
          version: 1n,
          createdAt: create(TimestampSchema, { seconds: 1n }),
        }),
      ).rejects.toThrow("could not complete");
      expect(transactionStarts).toBe(0);
      expect(calls.some((call) => call.sql.startsWith("INSERT INTO spine_ts_entity_states"))).toBe(
        false,
      );
      await factory.close();
    },
  );

  it("retains a trim user lock across committed chunks while another entity proceeds", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const first = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_trim_lock",
    });
    const second = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_trim_lock",
    });
    const trimming = first.createEntityStorage(entityHistoryInput());
    const appending = second.createEntityStorage(entityHistoryInput());
    trimSelections.push([{ version: 2n }], [{ version: 1n }], []);
    let releaseDelete: (() => void) | undefined;
    const deleteEntered = new Promise<void>((resolve) => {
      executeGate = async (sql) => {
        if (!sql.startsWith("DELETE FROM spine_ts_entity_states") || releaseDelete !== undefined)
          return;
        resolve();
        await new Promise<void>((unblock) => {
          releaseDelete = unblock;
        });
      };
    });
    const trim = trimming.states.trim("same", 0);
    await deleteEntered;
    const waitingAppend = appending.states.append(stateRecord("same", 3n));
    const otherAppend = appending.states.append(stateRecord("other", 1n));
    await expect(otherAppend).resolves.toBeUndefined();
    expect(
      calls.some(
        (call) =>
          call.sql.startsWith("INSERT INTO spine_ts_entity_states") && call.values?.[2] === 3n,
      ),
    ).toBe(false);
    releaseDelete?.();
    await expect(trim).resolves.toBeUndefined();
    await expect(waitingAppend).resolves.toBeUndefined();
    const trimCalls = calls.filter((call) =>
      /SELECT version FROM spine_ts_entity_states|DELETE FROM spine_ts_entity_states/u.test(
        call.sql,
      ),
    );
    expect(new Set(trimCalls.map((call) => call.connectionId)).size).toBe(1);
    expect(commits).toBeGreaterThanOrEqual(3);
    await Promise.all([first.close(), second.close()]);
  });

  it("destroys an entity connection when RELEASE_LOCK is uncertain and drains close once", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_release_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    const releasesBefore = releases;
    executeFailure = (sql) =>
      sql.includes("RELEASE_LOCK") ? new Error("release failed") : undefined;
    await expect(storage.states.append(stateRecord("same", 1n))).resolves.toBeUndefined();
    expect(destroys).toBe(1);
    expect(releases - releasesBefore).toBe(3);
    await expect(factory.close()).resolves.toBeUndefined();
    expect(endCalls).toBe(1);
  });

  it("lets a gated trim chunk commit during close but starts no later selection", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_trim_close",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    trimSelections.push([{ version: 1n }], [{ version: 0n }]);
    let unblock: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      executeGate = async (sql) => {
        if (!sql.startsWith("DELETE FROM spine_ts_entity_states") || unblock !== undefined) return;
        resolve();
        await new Promise<void>((release) => {
          unblock = release;
        });
      };
    });
    const trim = storage.states.trim("same", 0);
    await entered;
    const closing = factory.close();
    expect(endCalls).toBe(0);
    unblock?.();
    await expect(trim).rejects.toThrow(/closed/i);
    await expect(closing).resolves.toBeUndefined();
    expect(
      calls.filter((call) => call.sql.startsWith("SELECT version FROM spine_ts_entity_states")),
    ).toHaveLength(1);
    expect(commits).toBe(1);
    expect(endCalls).toBe(1);
  });

  it("preserves committed trim chunks and requires a caller retry after an uncertain later commit", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_trim_resume",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    trimSelections.push([{ version: 3n }], [{ version: 2n }]);
    commitResponses.push(undefined, new Error("commit outcome unknown"));
    await expect(storage.states.trim("same", 1)).rejects.toThrow("could not complete");
    expect(commits).toBe(2);
    expect(rollbacks).toBe(1);
    expect(
      calls.filter((call) => call.sql.startsWith("SELECT version FROM spine_ts_entity_states")),
    ).toHaveLength(2);

    await expect(storage.states.append(stateRecord("same", 4n))).resolves.toBeUndefined();
    trimSelections.push([{ version: 2n }], []);
    await expect(storage.states.trim("same", 1)).resolves.toBeUndefined();
    expect(
      calls.filter((call) => call.sql.startsWith("DELETE FROM spine_ts_entity_states")),
    ).toHaveLength(3);
    await factory.close();
  });

  it(
    "truncates state only through its captured strict-boundary high-water " +
      "and resumes after a later commit failure",
    async () => {
      const { MysqlStorageFactory } = await import("../src/index.js");
      const factory = await MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_state_truncate",
      });
      const storage = factory.createEntityStorage(entityHistoryInput());
      const first = { entity_key: new Uint8Array([1]), version: 1n };
      const cutoff = { write_order: 2n };
      truncateSelections.push([cutoff], [first]);
      commitResponses.push(undefined, new Error("unknown commit"));
      const boundary = create(TimestampSchema, { seconds: 5n, nanos: 7 });
      await expect(storage.states.truncate(boundary)).rejects.toThrow("could not complete");
      const selects = calls.filter((call) =>
        /SELECT write_order FROM spine_ts_entity_states|SELECT entity_key,version/u.test(call.sql),
      );
      expect(selects).toHaveLength(3);
      expect(selects[0]?.sql).toContain("ORDER BY write_order DESC LIMIT 1");
      expect(selects[1]?.sql).toContain("ORDER BY write_order LIMIT 128");
      expect(selects[1]?.values?.at(-1)).toBe(cutoff.write_order);
      expect(commits).toBe(2);
      expect(rollbacks).toBe(1);
      truncateSelections.push([{ write_order: 1n }], [first], []);
      await expect(storage.states.truncate(boundary)).resolves.toBeUndefined();
      expect(
        calls.filter((call) => call.sql.startsWith("DELETE FROM spine_ts_entity_states")),
      ).toHaveLength(2);
      await factory.close();
    },
  );

  it("uses an event-key high-water and strict timestamp predicate without chasing later keys", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_event_truncate",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    const highWater = { write_order: 9n };
    truncateSelections.push([highWater], [{ event_key: new Uint8Array([1]) }], []);
    const boundary = create(TimestampSchema, { seconds: 8n, nanos: 3 });
    await expect(storage.events.truncate(boundary)).resolves.toBeUndefined();
    const selects = calls.filter((call) =>
      /SELECT write_order FROM spine_ts_entity_events|SELECT event_key/u.test(call.sql),
    );
    expect(selects).toHaveLength(3);
    expect(selects[0]?.sql).toContain("write_order DESC LIMIT 1");
    expect(selects[1]?.sql).toContain("write_order<=?");
    expect(selects[1]?.values?.slice(-1)).toEqual([highWater.write_order]);
    expect(selects[1]?.values?.slice(1, 4)).toEqual([8n, 8n, 3]);
    await factory.close();
  });

  it.each([
    ["state", "spine_ts_entity_states", { entity_key: new Uint8Array([1]), version: 1n }],
    ["event", "spine_ts_entity_events", { event_key: new Uint8Array([1]) }],
  ])(
    "uses a provider write-order cutoff rather than identity-key order for %s truncate",
    async (_name, table, key) => {
      const { MysqlStorageFactory } = await import("../src/index.js");
      const factory = await MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_write_order_truncate",
      });
      const storage = factory.createEntityStorage(entityHistoryInput());
      const cutoff = 7n;
      truncateSelections.push([{ write_order: cutoff }], [key], []);

      const boundary = create(TimestampSchema, { seconds: 8n, nanos: 3 });
      const operation =
        table === "spine_ts_entity_states"
          ? storage.states.truncate(boundary)
          : storage.events.truncate(boundary);
      await expect(operation).resolves.toBeUndefined();

      const selections = calls.filter((call) => call.sql.includes(`FROM ${table}`));
      expect(selections[0]?.sql).toContain("SELECT write_order");
      expect(selections[0]?.sql).toContain("ORDER BY write_order DESC LIMIT 1");
      expect(selections[1]?.sql).toContain("write_order<=?");
      expect(selections[1]?.values?.at(-1)).toBe(cutoff);
      await factory.close();
    },
  );

  it.each([
    [
      "state",
      { table: "states" as const, write_order: 5n, entity_key: new Uint8Array([9]), version: 1n },
      { table: "states" as const, write_order: 6n, entity_key: new Uint8Array([1]), version: 1n },
    ],
    [
      "event",
      { table: "events" as const, write_order: 5n, event_key: new Uint8Array([9]) },
      { table: "events" as const, write_order: 6n, event_key: new Uint8Array([1]) },
    ],
  ])(
    "keeps a lexically lower eligible %s append after its write-order cutoff",
    async (name, existing, late) => {
      const { MysqlStorageFactory } = await import("../src/index.js");
      const factory = await MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_write_order_race",
      });
      const storage = factory.createEntityStorage(entityHistoryInput());
      truncateRows.push(existing);
      afterTruncateCutoff = () => truncateRows.push(late);

      const boundary = create(TimestampSchema, { seconds: 8n, nanos: 3 });
      await expect(
        name === "state" ? storage.states.truncate(boundary) : storage.events.truncate(boundary),
      ).resolves.toBeUndefined();

      const deletes = calls.filter((call) =>
        call.sql.startsWith(`DELETE FROM spine_ts_entity_${name}s`),
      );
      expect(deletes).toHaveLength(1);
      const existingKey = "entity_key" in existing ? existing.entity_key : existing.event_key;
      const lateKey = "entity_key" in late ? late.entity_key : late.event_key;
      expect(deletes[0]?.values).toContainEqual(existingKey);
      expect(deletes[0]?.values).not.toContainEqual(lateKey);
      await factory.close();
    },
  );

  it("sanitizes duplicate event reconciliation acquisition and lookup failures", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_event_reconcile_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    executeFailure = (sql) => {
      if (sql.startsWith("INSERT INTO spine_ts_entity_events"))
        return Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
      if (sql.startsWith("SELECT entity_key,producer_version")) return new Error("provider secret");
      return undefined;
    };

    await expect(
      storage.events.append({
        entityId: "task",
        event: create(EventSchema, { id: create(EventIdSchema, { value: "event-1" }) }),
        producerVersion: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await expect(
      storage.events.append({
        entityId: "task",
        event: create(EventSchema, { id: create(EventIdSchema, { value: "event-2" }) }),
        producerVersion: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).rejects.not.toThrow("provider secret");
    await factory.close();
  });

  it("sanitizes current-read acquisition and cleanup failures after readiness", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_current_cleanup_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    await storage.current.read("warm");

    connectionFailureAt = connectionAcquires + 2;
    await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    connectionFailureAt = undefined;
    releaseFailureAt = releases + 2;
    await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await factory.close();
  });

  it.each([undefined, "   "])("rejects a missing or blank event ID before pool use", async (id) => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_event_id_validation",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    connectionAcquires = 0;
    await expect(
      storage.events.append({
        entityId: "task",
        event: create(EventSchema, {
          id: id === undefined ? undefined : create(EventIdSchema, { value: id }),
        }),
        producerVersion: 1n,
        createdAt: create(TimestampSchema),
      }),
    ).rejects.toThrow("event ID");
    expect(connectionAcquires).toBe(0);
    await factory.close();
  });

  it("uses exclusive history cursors and returns no state when no version matches", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_history_cursor",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    await expect(storage.states.stateAt("task", create(TimestampSchema))).resolves.toBeUndefined();
    await storage.states.backward("task", 1, 3n);
    await storage.events.backward("task", 1, 4n);
    const state = calls.find((call) => call.sql.includes("AND version < ?"));
    const event = calls.find((call) => call.sql.includes("AND producer_version < ?"));
    expect(state?.values?.at(-1)).toBe(3n);
    expect(event?.values?.at(-1)).toBe(4n);
    await factory.close();
  });

  it("keeps entity handles idempotently closeable and scopes a tenant separately", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_scope",
    });
    const singleTenant = factory.createEntityStorage(entityHistoryInput());
    const tenant = factory.createEntityStorage({
      ...entityHistoryInput(),
      context: { name: "History", multitenant: true, tenantId: "green" },
    });
    await singleTenant.current.read("task");
    await tenant.current.read("task");
    const scopes = calls
      .filter((call) => call.sql.startsWith("INSERT IGNORE INTO spine_ts_entity_specs"))
      .map((call) => call.values?.[0]);
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).not.toEqual(scopes[1]);
    singleTenant.close();
    singleTenant.close();
    expect(singleTenant.isOpen()).toBe(false);
    await factory.close();
  });

  it("sanitizes a ready fingerprint cleanup-only failure", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_ready_cleanup_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    releaseFailureAt = releases + 2;
    await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await factory.close();
  });

  it("preserves an incompatible fingerprint when ready cleanup also fails", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_ready_fingerprint_precedence",
    });
    const first = factory.createEntityStorage(entityHistoryInput());
    await first.current.read("warm");
    const incompatible = factory.createEntityStorage({
      ...entityHistoryInput(),
      id: {
        clone: (id: string) => id,
        fingerprint: "other-string",
        key: (id: string) => id,
      },
    });
    releaseFailureAt = releases + 2;
    await expect(incompatible.current.read("task")).rejects.toThrow(
      "incompatible record specification",
    );
    await factory.close();
  });

  it("preserves an entity schema error when schema cleanup also fails", async () => {
    const { MysqlStorageFactory, MysqlStorageSchemaError } = await import("../src/index.js");
    const savedTables = entityTableRows.map((row) => ({ ...row }));
    const events = entityTableRows.find((row) => row.table_name === "spine_ts_entity_events");
    if (events !== undefined) events.engine = "MyISAM";
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_schema_cleanup_precedence",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    releaseFailureAt = releases + 1;
    try {
      await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageSchemaError);
    } finally {
      entityTableRows.splice(0, entityTableRows.length, ...savedTables);
      await factory.close();
    }
  });

  it.each(["state backward", "state at", "event backward"] as const)(
    "sanitizes %s cleanup failure after readiness",
    async (name) => {
      const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
      const factory = await MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_history_read_cleanup_failure",
      });
      const storage = factory.createEntityStorage(entityHistoryInput());
      await storage.current.read("warm");
      releaseFailureAt = releases + 2;
      const operation =
        name === "state backward"
          ? storage.states.backward("task", 1)
          : name === "state at"
            ? storage.states.stateAt("task", create(TimestampSchema))
            : storage.events.backward("task", 1);
      await expect(operation).rejects.toBeInstanceOf(MysqlStorageOperationError);
      await factory.close();
    },
  );

  it("preserves a state backward data error when its cleanup also fails", async () => {
    const { MysqlStorageDataError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_history_read_data_cleanup_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    await storage.current.read("warm");
    operationRows = [{ payload: "not-bytes", version: 1n, seconds: 0n, nanos: 0 }];
    releaseFailureAt = releases + 2;
    await expect(storage.states.backward("task", 1)).rejects.toBeInstanceOf(MysqlStorageDataError);
    await factory.close();
  });

  it.each(["state append", "state trim", "state truncate", "event truncate"] as const)(
    "sanitizes provider acquisition and release failures during %s",
    async (name) => {
      const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
      const factory = await MysqlStorageFactory.create({
        url: "mysql://spine:secret@localhost:3306/spine_packet_entity_cleanup_failure",
      });
      const storage = factory.createEntityStorage(entityHistoryInput());
      await storage.current.read("warm");
      const operation = () =>
        name === "state append"
          ? storage.states.append(stateRecord("task", 1n))
          : name === "state trim"
            ? storage.states.trim("task", 0)
            : name === "state truncate"
              ? storage.states.truncate(create(TimestampSchema))
              : storage.events.truncate(create(TimestampSchema));

      connectionFailureAt = connectionAcquires + 2;
      await expect(operation()).rejects.toBeInstanceOf(MysqlStorageOperationError);
      connectionFailureAt = undefined;
      releaseFailureAt = releases + 2;
      await expect(operation()).rejects.toBeInstanceOf(MysqlStorageOperationError);
      await factory.close();
    },
  );

  it("sanitizes duplicate-event reconciliation acquisition and release failures", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_event_reconcile_cleanup_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    await storage.current.read("warm");
    const event = create(EventSchema, { id: create(EventIdSchema, { value: "event-cleanup" }) });
    executeFailure = (sql) =>
      sql.startsWith("INSERT INTO spine_ts_entity_events")
        ? Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" })
        : undefined;
    connectionFailureAt = connectionAcquires + 3;
    await expect(
      storage.events.append({
        entityId: "task",
        event,
        producerVersion: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);
    connectionFailureAt = undefined;
    operationRows = [
      {
        entity_key: CanonicalMysqlValue.encode("task", 768),
        producer_version: 1n,
        seconds: 1n,
        nanos: 0,
        payload: toBinary(EventSchema, event),
      },
    ];
    releaseFailureAt = releases + 3;
    await expect(
      storage.events.append({
        entityId: "task",
        event,
        producerVersion: 1n,
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await factory.close();
  });

  it.each([
    ["DDL", (sql: string) => sql.startsWith("CREATE TABLE IF NOT EXISTS spine_ts_entity")],
    ["entity metadata", (sql: string) => sql.includes("information_schema.columns")],
  ])("sanitizes an entity %s provider failure before row access", async (_name, fail) => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_provider_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    queryFailure = (sql) => (fail(sql) ? new Error("provider secret") : undefined);

    await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await expect(storage.current.read("task")).rejects.not.toThrow("provider secret");
    expect(calls.some((call) => call.sql.includes("spine_ts_entity_current WHERE"))).toBe(false);
    expect(releases).toBe(connectionAcquires);
    await factory.close();
  });

  it.each([
    [
      "fingerprint insert",
      (sql: string) => sql.startsWith("INSERT IGNORE INTO spine_ts_entity_specs"),
    ],
    [
      "fingerprint lookup",
      (sql: string) => sql.startsWith("SELECT fingerprint FROM spine_ts_entity_specs"),
    ],
  ])("sanitizes an entity %s provider failure before row access", async (_name, fail) => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_provider_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    executeFailure = (sql) => (fail(sql) ? new Error("provider secret") : undefined);

    await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await expect(storage.current.read("task")).rejects.not.toThrow("provider secret");
    expect(calls.some((call) => call.sql.includes("spine_ts_entity_current WHERE"))).toBe(false);
    expect(releases).toBe(connectionAcquires);
    await factory.close();
  });

  it("sanitizes an entity pool-acquisition failure before row access", async () => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_provider_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    connectionAcquires = 0;
    releases = 0;
    connectError = new Error("provider secret");

    await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await expect(storage.current.read("task")).rejects.not.toThrow("provider secret");
    expect(calls.some((call) => call.sql.includes("spine_ts_entity_current WHERE"))).toBe(false);
    expect(releases).toBe(0);
    await factory.close();
  });

  it.each([
    ["state backward", "SELECT version,seconds,nanos,payload FROM spine_ts_entity_states"],
    ["event backward", "SELECT payload FROM spine_ts_entity_events"],
    ["state at", "SELECT payload FROM spine_ts_entity_states"],
    ["state truncate", "SELECT write_order FROM spine_ts_entity_states"],
    ["event truncate", "SELECT write_order FROM spine_ts_entity_events"],
  ])("sanitizes a provider failure from %s", async (name, sqlPrefix) => {
    const { MysqlStorageFactory, MysqlStorageOperationError } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_provider_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    executeFailure = (sql) =>
      sql.startsWith(sqlPrefix) ? new Error("provider secret") : undefined;

    const operation =
      name === "state backward"
        ? storage.states.backward("task", 1)
        : name === "event backward"
          ? storage.events.backward("task", 1)
          : name === "state at"
            ? storage.states.stateAt("task", create(TimestampSchema))
            : name === "state truncate"
              ? storage.states.truncate(create(TimestampSchema))
              : storage.events.truncate(create(TimestampSchema));
    await expect(operation).rejects.toBeInstanceOf(MysqlStorageOperationError);
    await expect(operation).rejects.not.toThrow("provider secret");
    await factory.close();
  });

  it("preserves malformed entity current, state, and event payloads as data errors", async () => {
    const { MysqlStorageDataError, MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_data_failure",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    operationRows = [
      {
        payload: "not-bytes",
        version: 1n,
        seconds: 0n,
        nanos: 0,
        archived: 0,
        deleted: 0,
      },
    ];

    await expect(storage.current.read("task")).rejects.toBeInstanceOf(MysqlStorageDataError);
    await expect(storage.states.backward("task", 1)).rejects.toBeInstanceOf(MysqlStorageDataError);
    await expect(storage.events.backward("task", 1)).rejects.toBeInstanceOf(MysqlStorageDataError);
    await factory.close();
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

  it("rejects invalid entity numeric values before readiness or pool acquisition", async () => {
    const { MysqlStorageFactory } = await import("../src/index.js");
    const factory = await MysqlStorageFactory.create({
      url: "mysql://spine:secret@localhost:3306/spine_packet_entity_numbers",
    });
    const storage = factory.createEntityStorage(entityHistoryInput());
    connectionAcquires = 0;
    await expect(
      storage.states.append({
        ...stateRecord("task", 1n << 63n),
        createdAt: create(TimestampSchema, { seconds: 1n }),
      }),
    ).rejects.toThrow(/64-bit/i);
    await expect(
      storage.states.append({
        ...stateRecord("task", 1n),
        createdAt: create(TimestampSchema, { seconds: 1n, nanos: 1_000_000_000 }),
      }),
    ).rejects.toThrow(/nanos/i);
    expect(connectionAcquires).toBe(0);
    await factory.close();
  });
});

function entityHistoryInput(): EntityStorageInput<string, StringValue> {
  return {
    context: { name: "History", multitenant: false },
    id: { clone: (id) => id, fingerprint: "string", key: (id) => id },
    extractId: () => "task",
    columns: [],
    layout: "entity-v1",
    stateSchema: StringValueSchema,
    storageKey: "history.Task:current",
  };
}

function stateRecord(entityId: string, version: bigint) {
  return {
    entityId,
    state: create(StringValueSchema, { value: `state-${version.toString()}` }),
    version,
    createdAt: create(TimestampSchema, { seconds: version }),
  };
}

function fakeKey(value: unknown): string {
  return value instanceof Uint8Array ? [...value].join(",") : String(value);
}

function sameBytes(left: Uint8Array | undefined, right: unknown): boolean {
  return (
    left instanceof Uint8Array &&
    right instanceof Uint8Array &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
