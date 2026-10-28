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

import { create, ScalarType, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, VersionSchema, type Event } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  type NormalizedQueryPlan,
} from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { MysqlRecordStorage } from "../src/mysql/record-storage.js";
import { MysqlTableResolver } from "../src/mysql/table-resolver.js";
import { resolvedMysqlTableSpec } from "../src/mysql/table-spec.js";
import { MysqlStorageSchemaError } from "../src/mysql/errors.js";

describe("MysqlRecordStorage", () => {
  it("binds each legacy scalar-list member and makes an empty list match no rows", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const storage = schemaStorage(
      readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
    );

    await storage.queryEntries({ filters: [{ column: "value", value: ["one", "two", "one"] }] });
    const listed = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(listed?.sql).toContain("(`value` <=> ? OR `value` <=> ? OR `value` <=> ?)");
    expect(listed?.values?.slice(0, 3)).toEqual(["one", "two", "one"]);

    calls.length = 0;
    await storage.queryEntries({ filters: [{ column: "value", value: [] }] });
    const empty = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(empty?.sql).toContain("WHERE 1=0");
    expect(empty?.values).not.toContain([]);
  });
  it("pushes an admitted normalized equality plan into bound SQL through production execution", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const storage = schemaStorage(
      readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
    );

    await storage.queryPlan({
      predicate: { kind: "comparison", column: "value", operator: "equal", value: "two" },
      order: [{ column: "value", direction: "asc" }],
      limit: 1,
    });

    const query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain("WHERE `value` = ?");
    expect(query?.sql).toContain("ORDER BY `value` ASC, ID ASC");
    expect(query?.sql).toContain("LIMIT ?");
    expect(query?.values).toEqual(["two", 1]);
  });

  it("pushes IDs and every admitted comparison operator into bound MySQL predicates", async () => {
    const cases: readonly [string, NormalizedQueryPlan<string>, string, readonly unknown[]][] = [
      [
        "IDs",
        { predicate: { kind: "ids", ids: ["one", "two"] } },
        "WHERE ID IN (?, ?)",
        ["one", "two", 10_001],
      ],
      [
        "equality",
        { predicate: { kind: "comparison", column: "value", operator: "equal", value: "two" } },
        "WHERE `value` = ?",
        ["two", 10_001],
      ],
      [
        "greater than",
        {
          predicate: { kind: "comparison", column: "value", operator: "greaterThan", value: "two" },
        },
        "WHERE `value` > ?",
        ["two", 10_001],
      ],
      [
        "less than",
        { predicate: { kind: "comparison", column: "value", operator: "lessThan", value: "two" } },
        "WHERE `value` < ?",
        ["two", 10_001],
      ],
      [
        "greater or equal",
        {
          predicate: {
            kind: "comparison",
            column: "value",
            operator: "greaterOrEqual",
            value: "two",
          },
        },
        "WHERE `value` >= ?",
        ["two", 10_001],
      ],
      [
        "less or equal",
        {
          predicate: {
            kind: "comparison",
            column: "value",
            operator: "lessOrEqual",
            value: "two",
          },
        },
        "WHERE `value` <= ?",
        ["two", 10_001],
      ],
    ];

    for (const [name, plan, clause, values] of cases) {
      const calls: { sql: string; values?: readonly unknown[] }[] = [];
      const storage = schemaStorage(
        readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
      );

      await storage.queryPlan(plan);

      const query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
      expect(query?.sql, name).toContain(clause);
      expect(query?.values, name).toEqual(values);
    }
  });

  it("pushes flat and nested ALL/EITHER plans into parenthesized SQL", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const storage = schemaStorage(
      readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
    );

    await storage.queryPlan({
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "value", operator: "greaterOrEqual", value: "b" },
          {
            kind: "either",
            predicates: [
              { kind: "ids", ids: ["two"] },
              {
                kind: "all",
                predicates: [
                  { kind: "comparison", column: "value", operator: "lessOrEqual", value: "z" },
                ],
              },
            ],
          },
        ],
      },
      order: [{ column: "value", direction: "desc" }],
      limit: 8,
      candidateLimit: 2,
    });

    const query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain("WHERE (`value` >= ? AND (ID IN (?) OR (`value` <= ?)))");
    expect(query?.sql).toContain("ORDER BY `value` DESC, ID ASC LIMIT ?");
    expect(query?.values).toEqual(["b", "two", "z", 3]);
  });

  it("runs exhaustive plans without a provider limit and scans for oversized ID sets", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const storage = schemaStorage(
      readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
    );
    await storage.queryPlan({
      exhaustive: true,
      predicate: { kind: "comparison", column: "value", operator: "greaterThan", value: "a" },
      order: [{ column: "value", direction: "asc" }],
      limit: 1,
    });
    let query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).not.toContain("WHERE");
    expect(query?.sql).toContain("ORDER BY `value` ASC, ID ASC");
    expect(query?.sql).not.toContain("LIMIT");
    expect(query?.values).toEqual([]);

    calls.length = 0;
    await storage.queryPlan({
      exhaustive: true,
      predicate: {
        kind: "ids",
        ids: Array.from({ length: 1_001 }, (_, index) => String(index)),
      },
    });
    query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).not.toContain("WHERE");
    expect(query?.sql).not.toContain("LIMIT");

    calls.length = 0;
    await storage.queryPlan({
      exhaustive: true,
      predicate: {
        kind: "all",
        predicates: [
          { kind: "comparison", column: "value", operator: "equal", value: "one" },
          { kind: "ids", ids: Array.from({ length: 1_001 }, (_, index) => String(index)) },
        ],
      },
    });
    query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).not.toContain("WHERE");

    calls.length = 0;
    await storage.queryPlan({ exhaustive: true });
    query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).not.toContain("LIMIT");
  });

  it("evaluates exhaustive text and ID order after fetching all collation-sensitive rows", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const values = ["A", "a", "á", "a ", "\uE000", "😀"];
    const storage = schemaStorage(
      readyConnection(calls, {
        columns: ["ID", "bytes", "value"],
        planRows: values.map((value) => ({
          ID: value,
          bytes: toBinary(
            StringValueSchema,
            create(StringValueSchema, {
              value: value === "\uE000" || value === "😀" ? "tie" : value,
            }),
          ),
        })),
      }) as never,
    );
    for (const value of ["a", "á", "a "]) {
      expect(
        await storage.queryPlan({
          exhaustive: true,
          predicate: { kind: "comparison", column: "value", operator: "equal", value },
          order: [{ column: "value", direction: "asc" }],
          limit: 1,
        }),
      ).toEqual([create(StringValueSchema, { value })]);
    }
    expect(
      await storage.queryPlanEntries({
        exhaustive: true,
        predicate: { kind: "ids", ids: ["\uE000", "😀"] },
        order: [{ column: "value", direction: "asc" }],
        limit: 1,
      }),
    ).toMatchObject([{ id: "😀" }]);
    const queries = calls.filter((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(query.sql).not.toContain("WHERE");
      expect(query.sql).not.toContain("LIMIT");
    }
  });

  it("retains exact numeric SQL criteria, order, and application limit", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const spec = new RecordSpec<number, StringValue>({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: (record) => Number(record.value),
      columns: [
        new RecordColumn("number", ColumnTypes.scalar(ScalarType.INT32), (record) =>
          Number(record.value),
        ),
      ],
    });
    const storage = new MysqlRecordStorage(
      { name: "numeric-records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(readyConnection(calls, { columns: ["ID", "bytes", "number"] })),
      () => undefined,
    );
    await storage.queryPlan({
      exhaustive: true,
      predicate: { kind: "comparison", column: "number", operator: "greaterThan", value: 2 },
      order: [{ column: "number", direction: "asc" }],
      limit: 1,
    });
    const query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain("WHERE `number` > ? ORDER BY `number` ASC, ID ASC LIMIT ?");
    expect(query?.values).toEqual([2, 1]);
  });

  it("keeps rewritten nested conjunctions and disjunctions safe under text collation", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const spec = new RecordSpec<number, StringValue>({
      recordType: StringValueSchema,
      idKind: "int32",
      extractId: (record) => Number(record.value),
      columns: [
        new RecordColumn("number", ColumnTypes.scalar(ScalarType.INT32), (record) =>
          Number(record.value),
        ),
        new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
      ],
    });
    const storage = new MysqlRecordStorage(
      { name: "nested-records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(readyConnection(calls, { columns: ["ID", "bytes", "number", "value"] })),
      () => undefined,
    );
    const number = { kind: "comparison", column: "number", operator: "equal", value: 2 } as const;
    const text = { kind: "comparison", column: "value", operator: "equal", value: "a" } as const;
    await storage.queryPlan({
      exhaustive: true,
      predicate: {
        kind: "all",
        predicates: [{ kind: "all", predicates: [number, text] }, { ...number }],
      },
    });
    let query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain("WHERE");
    expect(query?.sql).not.toContain("`value` =");
    expect(query?.values).toEqual([2, 2]);

    calls.length = 0;
    await storage.queryPlan({
      exhaustive: true,
      predicate: {
        kind: "all",
        predicates: [number, { kind: "either", predicates: [{ ...number }, text] }],
      },
    });
    query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain("WHERE (`number` = ?)");
    expect(query?.sql).not.toContain(" OR ");
    expect(query?.values).toEqual([2]);
  });

  it("does not narrow or limit logically textual values through custom numeric SQL columns", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
      columns: [
        new RecordColumn("value", ColumnTypes.scalar(ScalarType.STRING), (record) => record.value),
      ],
    });
    const table = new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined);
    const canonical = resolvedMysqlTableSpec({
      tableName: table.tableName,
      sourceType: spec.sourceType,
      recordType: spec.recordType,
      idType: spec.idType,
      declaredColumns: spec.columns,
    });
    const storage = new MysqlRecordStorage(
      { name: "custom-numeric", multitenant: false },
      spec,
      table,
      lifecycle(readyConnection(calls, { columns: ["ID", "bytes", "value"] })),
      () => undefined,
      undefined,
      {
        ...canonical,
        columns: canonical.columns.map((column) =>
          column.name === "ID" || column.name === "value"
            ? { ...column, mysqlType: "INT" }
            : column,
        ),
      },
    );
    await storage.queryPlan({
      exhaustive: true,
      predicate: { kind: "comparison", column: "value", operator: "equal", value: "2" },
      order: [{ column: "value", direction: "asc" }],
      limit: 1,
    });
    const query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).not.toContain("WHERE");
    expect(query?.sql).not.toContain("LIMIT");
    calls.length = 0;
    await storage.queryPlan({ exhaustive: true, predicate: { kind: "ids", ids: ["2"] } });
    expect(calls.find((call) => call.sql.startsWith("SELECT ID, bytes"))?.sql).not.toContain(
      "WHERE",
    );
  });

  it.each([
    [undefined, undefined, "ORDER BY ID ASC", 10_001],
    [[{ column: "value", direction: "asc" }], 1, "ORDER BY `value` ASC, ID ASC", 1],
    [[{ column: "value", direction: "desc" }], 5, "ORDER BY `value` DESC, ID ASC", 3],
  ] as const)(
    "bounds an unfiltered plan with order %o and limit %s",
    async (order, limit, expectedOrder, expectedBound) => {
      const calls: { sql: string; values?: readonly unknown[] }[] = [];
      const storage = schemaStorage(
        readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
      );

      await storage.queryPlan({
        ...(order === undefined ? {} : { order }),
        ...(limit === undefined ? {} : { limit }),
        ...(limit === 5 ? { candidateLimit: 2 } : {}),
      });

      const query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
      expect(query?.sql).not.toContain("WHERE");
      expect(query?.sql).toContain(expectedOrder);
      expect(query?.values).toEqual([expectedBound]);
    },
  );

  it("rejects undeclared normalized columns before issuing a provider query", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const storage = schemaStorage(
      readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
    );

    await expect(
      storage.queryPlan({
        predicate: { kind: "comparison", column: "missing", operator: "equal", value: "two" },
      }),
    ).rejects.toThrow("not declared");
    expect(calls.some((call) => call.sql.startsWith("SELECT ID, bytes"))).toBe(false);
  });

  it("rejects an oversized normalized SQL bind budget before acquiring a connection", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    let acquires = 0;
    const storage = schemaStorage(
      readyConnection(calls, { columns: ["ID", "bytes", "value"] }) as never,
      () => {
        acquires += 1;
      },
    );

    await expect(
      storage.queryPlan({
        predicate: { kind: "ids", ids: Array.from({ length: 1_000 }, (_, index) => String(index)) },
      }),
    ).rejects.toThrow("bind budget");
    expect(acquires).toBe(0);
    expect(calls).toEqual([]);
  });

  it.each([
    ["missing primary key", { primary: [], columns: canonicalColumns() }, /primary key/i],
    [
      "wrong primary key",
      { primary: primaryKey(["bytes"]), columns: canonicalColumns() },
      /primary key/i,
    ],
    [
      "narrow required capacity",
      {
        primary: primaryKey(),
        columns: canonicalColumns({ ID: { column_type: "varchar(511)" } }),
      },
      /ID type/i,
    ],
    [
      "wrong required type",
      { primary: primaryKey(), columns: canonicalColumns({ bytes: { column_type: "text" } }) },
      /bytes type/i,
    ],
    [
      "nullable required column",
      { primary: primaryKey(), columns: canonicalColumns({ ID: { is_nullable: "YES" } }) },
      /nullable ID/i,
    ],
    [
      "wrong declared native type",
      {
        primary: primaryKey(),
        columns: canonicalColumns({ value: { column_type: "varchar(32)" } }),
      },
      /value type/i,
    ],
    [
      "extra column",
      {
        primary: primaryKey(),
        columns: [
          ...canonicalColumns(),
          {
            column_name: "required_extra",
            column_type: "int",
            is_nullable: "NO",
            column_default: null,
            extra: "",
          },
        ],
      },
      /required_extra/i,
    ],
    [
      "harmful unique constraint",
      {
        primary: primaryKey(),
        columns: canonicalColumns(),
        indexes: [
          { index_name: "unique_bytes", non_unique: 0, column_name: "bytes", seq_in_index: 1 },
        ],
      },
      /unique/i,
    ],
  ])("rejects %s without altering the existing table", async (_name, layout, _error) => {
    void _error;
    const calls: string[] = [];
    const connection = schemaConnection(calls, layout);
    const storage = schemaStorage(connection);

    await expect(storage.write(create(StringValueSchema, { value: "one" }))).rejects.toBeInstanceOf(
      MysqlStorageSchemaError,
    );
    expect(calls.some((sql) => /^ALTER\s/i.test(sql))).toBe(false);
  });

  it.each([
    [
      "wider binary capacity",
      {
        primary: primaryKey(),
        columns: canonicalColumns({
          ID: { column_type: "varchar(768)" },
          bytes: { column_type: "mediumblob" },
        }),
      },
    ],
    [
      "nonunique index",
      {
        primary: primaryKey(),
        columns: canonicalColumns(),
        indexes: [{ index_name: "by_value", non_unique: 1, column_name: "value", seq_in_index: 1 }],
      },
    ],
    [
      "redundant primary-key unique index",
      {
        primary: primaryKey(),
        columns: canonicalColumns(),
        indexes: [{ index_name: "unique_id", non_unique: 0, column_name: "ID", seq_in_index: 1 }],
      },
    ],
  ])("accepts compatible %s", async (_name, layout) => {
    const storage = schemaStorage(schemaConnection([], layout));

    await expect(
      storage.write(create(StringValueSchema, { value: "one" })),
    ).resolves.toBeUndefined();
  });

  it("accepts MySQL-normalized Entity attribute defaults", async () => {
    const storage = entitySchemaStorage("tinyint(1)");

    await expect(storage.prepare()).resolves.toBeUndefined();
  });

  it("rejects a non-boolean MySQL integer width for an Entity attribute", async () => {
    const storage = entitySchemaStorage("tinyint(2)");

    await expect(storage.prepare()).rejects.toBeInstanceOf(MysqlStorageSchemaError);
  });

  it("rejects an incompatible primary key instead of altering the table", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        if (sql.includes("columns"))
          return Promise.resolve([
            [
              { column_name: "ID", column_type: "varchar(512)" },
              { column_name: "bytes", column_type: "blob" },
            ],
            [],
          ] as never);
        if (sql.includes("statistics"))
          return Promise.resolve([[{ column_name: "bytes", seq_in_index: 1 }], []] as never);
        return Promise.resolve([[{ engine: "InnoDB" }], []] as never);
      },
      execute: () => Promise.resolve([{ affectedRows: 1 }, []] as never),
    };
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );
    await expect(storage.read("one")).rejects.toBeInstanceOf(MysqlStorageSchemaError);
    expect(calls.some((sql) => /^ALTER\s/i.test(sql))).toBe(false);
  });
  it("rejects a divergent immutable preflight before issuing a prefix write", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        if (sql.includes("information_schema.columns"))
          return Promise.resolve([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never);
        if (sql.includes("information_schema.statistics"))
          return Promise.resolve([[], []] as never);
        if (sql.includes("information_schema.tables"))
          return Promise.resolve([[{ engine: "InnoDB" }], []] as never);
        return Promise.resolve([[], []] as never);
      },
      execute: (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT bytes"))
          return Promise.resolve([
            [{ bytes: Buffer.from([10, 8, ...Buffer.from("existing")]) }],
            [],
          ] as never);
        return Promise.resolve([{ affectedRows: 1 }, []] as never);
      },
    };
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );

    await expect(
      storage.assertImmutable(create(StringValueSchema, { value: "new" })),
    ).rejects.toThrow(/immutable record collides/i);

    expect(calls.some((call) => call.startsWith("INSERT"))).toBe(false);
  });

  it("rejects a divergent immutable insert race without an overwrite", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) =>
        sql.includes("columns")
          ? Promise.resolve([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never)
          : Promise.resolve([[], []] as never),
      execute: (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT bytes"))
          return Promise.resolve([
            [{ bytes: toBinary(StringValueSchema, create(StringValueSchema, { value: "other" })) }],
            [],
          ] as never);
        if (sql.startsWith("INSERT INTO"))
          return Promise.reject(
            Object.assign(new Error("duplicate"), {
              code: "ER_DUP_ENTRY",
              errno: 1062,
              sqlMessage: "Duplicate entry for key 'PRIMARY'",
            }),
          );
        return Promise.resolve([{ affectedRows: 1 }, []] as never);
      },
    };
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );
    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "one" })),
    ).rejects.toThrow(/immutable record collides/i);
    expect(calls.some((sql) => sql.includes("ON DUPLICATE KEY UPDATE"))).toBe(false);
  });

  it("accepts an identical immutable insert race without an overwrite", async () => {
    const record = create(StringValueSchema, { value: "one" });
    const connection = {
      query: (sql: string) =>
        sql.includes("columns")
          ? Promise.resolve([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never)
          : Promise.resolve([[], []] as never),
      execute: (sql: string) => {
        if (sql.startsWith("SELECT bytes"))
          return Promise.resolve([[{ bytes: toBinary(StringValueSchema, record) }], []] as never);
        if (sql.startsWith("INSERT INTO"))
          return Promise.reject(
            Object.assign(new Error("duplicate"), {
              code: "ER_DUP_ENTRY",
              errno: 1062,
              sqlMessage: "Duplicate entry for key 'PRIMARY'",
            }),
          );
        throw new Error(sql);
      },
    };
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (value) => value.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );
    await expect(storage.writeImmutable(record)).resolves.toBeUndefined();
  });

  it("retries an immutable insert when the colliding row disappears", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls, { select: () => [] });
    const originalExecute = connection.execute;
    let inserts = 0;
    connection.execute = (sql: string, values?: readonly unknown[]) => {
      if (sql.startsWith("INSERT INTO") && ++inserts === 1)
        return Promise.reject(
          Object.assign(new Error("duplicate"), {
            code: "ER_DUP_ENTRY",
            errno: 1062,
            sqlMessage: "Duplicate entry for key 'PRIMARY'",
          }),
        );
      return originalExecute(sql, values);
    };
    const storage = stringStorage(connection);

    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "one" })),
    ).resolves.toBeUndefined();
    expect(inserts).toBe(2);
  });

  it("bounds immutable insert contention when every collision disappears", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls, { select: () => [] });
    const originalExecute = connection.execute;
    let inserts = 0;
    connection.execute = (sql: string, values?: readonly unknown[]) => {
      if (sql.startsWith("INSERT INTO")) {
        inserts += 1;
        return Promise.reject(
          Object.assign(new Error("duplicate"), {
            code: "ER_DUP_ENTRY",
            errno: 1062,
            sqlMessage: "Duplicate entry for key 'PRIMARY'",
          }),
        );
      }
      return originalExecute(sql, values);
    };
    const storage = stringStorage(connection);

    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "one" })),
    ).rejects.toThrow(/contention exceeded/i);
    expect(inserts).toBe(3);
  });

  it("preserves an unrelated uniqueness failure instead of treating it as an ID race", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls);
    const originalExecute = connection.execute;
    const duplicate = Object.assign(new Error("driver detail"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlMessage: "Duplicate entry for key 'other_unique'",
    });
    connection.execute = (sql: string, values?: readonly unknown[]) =>
      sql.startsWith("INSERT INTO") ? Promise.reject(duplicate) : originalExecute(sql, values);
    const storage = stringStorage(connection);

    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "one" })),
    ).rejects.toMatchObject({ cause: duplicate });
    await expect(
      storage.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" })),
    ).rejects.toMatchObject({ cause: duplicate });
  });

  it("lazily creates one resolved family table before the first write", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push({ sql });
        return Promise.resolve([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never);
      },
      execute: (sql: string) => {
        calls.push({ sql });
        return Promise.resolve([{ affectedRows: 1 }, []] as never);
      },
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    expect(calls[0]?.sql).toMatch(/CREATE TABLE IF NOT EXISTS `google_protobuf_StringValue`/);
    expect(calls.at(-1)?.sql).toMatch(/INSERT INTO `google_protobuf_StringValue`/);
  });

  it("does not persist the bounded context name in family rows", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push({ sql });
        return Promise.resolve([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never);
      },
      execute: (sql: string, values?: readonly unknown[]) => {
        calls.push(values === undefined ? { sql } : { sql, values });
        return Promise.resolve([{ affectedRows: 1 }, []] as never);
      },
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const one = new MysqlRecordStorage(
      { name: "a", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );
    const two = new MysqlRecordStorage(
      { name: "b", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );
    await one.write(create(StringValueSchema, { value: "id" }));
    await two.write(create(StringValueSchema, { value: "id" }));
    const ids = calls
      .filter((call) => call.sql.startsWith("INSERT"))
      .map((call) => call.values?.[0]);
    expect(ids).toEqual(["id", "id"]);
    expect(calls[0]?.sql).toContain("`ID` VARCHAR(512)");
  });

  it("creates declared columns and pushes an equality filter into the family SQL", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT ID, bytes")) return Promise.resolve([[], []] as never);
        return Promise.resolve([
          [{ column_name: "ID" }, { column_name: "bytes" }, { column_name: "value" }],
          [],
        ] as never);
      },
      execute: (sql: string) => {
        calls.push(sql);
        return Promise.resolve([[], []] as never);
      },
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
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
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );

    await storage.queryEntries({ filters: [{ column: "value", value: "one" }], limit: 1 });

    expect(calls[0]).toMatch(/`value` TEXT NULL/);
    expect(calls.at(-1)).toMatch(/WHERE `value` <=> \?/);
  });

  it("executes a caller supplied create operation instead of the default DDL", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        return Promise.resolve([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never);
      },
      execute: (sql: string) => {
        calls.push(sql);
        return Promise.resolve([{ affectedRows: 1 }, []] as never);
      },
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
      () => "CREATE TABLE `provided_table` (ID INT)",
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    expect(calls[0]).toBe("CREATE TABLE `provided_table` (ID INT)");
  });

  it("rejects an existing family table whose primary key is incompatible", async () => {
    const connection = {
      query: (sql: string) => {
        if (sql.includes("information_schema.columns"))
          return Promise.resolve([
            [
              { column_name: "ID", column_type: "varchar(512)", is_nullable: "NO" },
              { column_name: "bytes", column_type: "blob", is_nullable: "NO" },
            ],
            [],
          ] as never);
        if (sql.includes("information_schema.statistics"))
          return Promise.resolve([[{ column_name: "bytes", seq_in_index: 1 }], []] as never);
        if (sql.includes("information_schema.tables"))
          return Promise.resolve([[{ engine: "InnoDB" }], []] as never);
        return Promise.resolve([[], []] as never);
      },
      execute: () => Promise.resolve([{ affectedRows: 1 }, []] as never),
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );

    await expect(storage.write(create(StringValueSchema, { value: "one" }))).rejects.toBeInstanceOf(
      MysqlStorageSchemaError,
    );
  });

  it("reads, deletes, queries, batches, and compares records through parameterized family operations", async () => {
    const calls: string[] = [];
    const encoded = toBinary(StringValueSchema, create(StringValueSchema, { value: "stored" }));
    let reads = 0;
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT ID, bytes"))
          return Promise.resolve([[{ ID: "stored", bytes: encoded }], []] as never);
        if (sql.includes("information_schema.columns"))
          return Promise.resolve([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never);
        if (sql.includes("information_schema.statistics"))
          return Promise.resolve([[{ column_name: "ID", seq_in_index: 1 }], []] as never);
        if (sql.includes("information_schema.tables"))
          return Promise.resolve([[{ engine: "InnoDB" }], []] as never);
        return Promise.resolve([[], []] as never);
      },
      execute: (sql: string) => {
        calls.push(sql);
        if (sql.includes("SELECT bytes"))
          return Promise.resolve([reads++ === 0 ? [{ bytes: encoded }] : [], []] as never);
        return Promise.resolve([{ affectedRows: 1 }, []] as never);
      },
      beginTransaction: () => Promise.resolve(calls.push("BEGIN")),
      commit: () => Promise.resolve(calls.push("COMMIT")),
      rollback: () => Promise.resolve(calls.push("ROLLBACK")),
    };
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );

    await expect(storage.read("stored")).resolves.toEqual(
      create(StringValueSchema, { value: "stored" }),
    );
    await expect(storage.delete("stored")).resolves.toBe(true);
    await expect(storage.queryEntries({ ids: [] })).resolves.toEqual([]);
    await expect(storage.queryEntries({ ids: ["stored"] })).resolves.toEqual([
      { id: "stored", record: create(StringValueSchema, { value: "stored" }) },
    ]);
    await expect(
      storage.compareAndSet("next", undefined, create(StringValueSchema, { value: "next" })),
    ).resolves.toBe(true);
    await storage.writeAll([
      create(StringValueSchema, { value: "one" }),
      create(StringValueSchema, { value: "two" }),
    ]);

    expect(calls).not.toContain("BEGIN");
    expect(calls).not.toContain("COMMIT");
    expect(calls.some((call) => call.startsWith("DELETE FROM"))).toBe(true);
    expect(calls.some((call) => call.startsWith("SELECT ID, bytes"))).toBe(true);
  });

  it("writes every supported native column representation without coercing byte values", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push({ sql });
        if (sql.includes("information_schema.columns"))
          return Promise.resolve([
            ["ID", "bytes", "flag", "number", "count", "raw", "object"].map((column_name) => ({
              column_name,
            })),
            [],
          ] as never);
        return Promise.resolve([[], []] as never);
      },
      execute: (sql: string, values?: readonly unknown[]) => {
        calls.push(values === undefined ? { sql } : { sql, values });
        return Promise.resolve([{ affectedRows: 1 }, []] as never);
      },
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const raw = new Uint8Array([1, 2]);
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
      columns: [
        new RecordColumn("flag", ColumnTypes.scalar(ScalarType.BOOL), () => true),
        new RecordColumn("number", ColumnTypes.scalar(ScalarType.INT32), () => 1),
        new RecordColumn("count", ColumnTypes.scalar(ScalarType.INT64), () => 1n),
        new RecordColumn("raw", ColumnTypes.scalar(ScalarType.BYTES), () => raw),
        new RecordColumn("object", ColumnTypes.message(VersionSchema), () =>
          create(VersionSchema, { number: 7 }),
        ),
      ],
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    expect(calls[0]?.sql).toContain("`flag` BOOLEAN NULL");
    expect(calls[0]?.sql).toContain("`number` INT NULL");
    expect(calls[0]?.sql).toContain("`count` BIGINT NULL");
    expect(calls[0]?.sql).toContain("`raw` BLOB NULL");
    expect(calls[0]?.sql).toContain("`object` INT NULL");
    const insert = calls.find((call) => call.sql.startsWith("INSERT"));
    expect(insert?.values).toEqual(expect.arrayContaining([true, 1, 1n, raw, 7]));
  });

  it("keeps a completed batch prefix without beginning a transaction", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls);
    const originalExecute = connection.execute;
    connection.execute = (sql: string, values?: readonly unknown[]) => {
      if (sql.startsWith("INSERT INTO") && values?.[0] === "second") {
        calls.push({ sql, values });
        return Promise.reject(new Error("later write failed"));
      }
      return originalExecute(sql, values);
    };
    const storage = stringStorage(connection);

    await expect(
      storage.writeAll([
        create(StringValueSchema, { value: "first" }),
        create(StringValueSchema, { value: "second" }),
      ]),
    ).rejects.toThrow(/record operation failed/i);
    expect(calls.filter(({ sql }) => sql.startsWith("INSERT INTO"))).toHaveLength(2);
    expect(calls.map(({ sql }) => sql)).not.toContain("BEGIN");
    expect(calls.map(({ sql }) => sql)).not.toContain("ROLLBACK");
  });

  it("guards a semantically equivalent stored encoding with its exact raw bytes", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const raw = Uint8Array.of(10, 1, 97, 10, 1, 97);
    const storage = stringStorage(readyConnection(calls, { select: () => [{ bytes: raw }] }));

    await expect(
      storage.compareAndSet(
        "slot",
        create(StringValueSchema, { value: "a" }),
        create(StringValueSchema, { value: "b" }),
      ),
    ).resolves.toBe(true);

    const update = calls.find(({ sql }) => sql.startsWith("UPDATE"));
    expect(update?.sql).toContain("WHERE ID=? AND bytes=?");
    expect(update?.values).toContain(raw);
    expect(calls.map(({ sql }) => sql)).not.toContain("BEGIN");
    expect(calls.some(({ sql }) => sql.includes("GET_LOCK"))).toBe(false);
  });

  it("rereads after a guard miss and rejects a changed expected record", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    let reads = 0;
    const connection = readyConnection(calls, {
      select: () => [
        {
          bytes: toBinary(
            StringValueSchema,
            create(StringValueSchema, { value: reads++ === 0 ? "first" : "rival" }),
          ),
        },
      ],
    });
    const originalExecute = connection.execute;
    connection.execute = (sql: string, values?: readonly unknown[]) =>
      sql.startsWith("UPDATE")
        ? (calls.push({ sql, ...(values === undefined ? {} : { values }) }),
          Promise.resolve([{ affectedRows: 0 }, []] as never))
        : originalExecute(sql, values);
    const storage = stringStorage(connection);

    await expect(
      storage.compareAndSet(
        "slot",
        create(StringValueSchema, { value: "first" }),
        create(StringValueSchema, { value: "next" }),
      ),
    ).resolves.toBe(false);
    expect(reads).toBe(2);
    expect(calls.filter(({ sql }) => sql.startsWith("UPDATE"))).toHaveLength(1);
  });

  it("bounds repeated guard misses and accepts a same-value no-op", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const current = create(StringValueSchema, { value: "first" });
    const connection = readyConnection(calls, {
      select: () => [{ bytes: toBinary(StringValueSchema, current) }],
    });
    const originalExecute = connection.execute;
    connection.execute = (sql: string, values?: readonly unknown[]) =>
      sql.startsWith("UPDATE")
        ? (calls.push({ sql, ...(values === undefined ? {} : { values }) }),
          Promise.resolve([{ affectedRows: 0 }, []] as never))
        : originalExecute(sql, values);
    const storage = stringStorage(connection);

    await expect(storage.compareAndSet("slot", current, current)).resolves.toBe(true);
    expect(calls.some(({ sql }) => sql.startsWith("UPDATE"))).toBe(false);
    await expect(
      storage.compareAndSet("slot", current, create(StringValueSchema, { value: "next" })),
    ).rejects.toThrow(/contention exceeded/i);
    expect(calls.filter(({ sql }) => sql.startsWith("UPDATE"))).toHaveLength(3);
  });

  it("treats an absent delete as a no-op and rereads a primary-key insert collision", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    let reads = 0;
    const rival = create(StringValueSchema, { value: "rival" });
    const connection = readyConnection(calls, {
      select: () => (reads++ < 2 ? [] : [{ bytes: toBinary(StringValueSchema, rival) }]),
    });
    const originalExecute = connection.execute;
    connection.execute = (sql: string, values?: readonly unknown[]) => {
      if (sql.startsWith("INSERT INTO")) {
        calls.push({ sql, ...(values === undefined ? {} : { values }) });
        return Promise.reject(
          Object.assign(new Error("duplicate"), {
            code: "ER_DUP_ENTRY",
            errno: 1062,
            sqlMessage: "Duplicate entry for key 'PRIMARY'",
          }),
        );
      }
      return originalExecute(sql, values);
    };
    const storage = stringStorage(connection);

    await expect(storage.compareAndSet("slot", undefined, undefined)).resolves.toBe(true);
    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "next" })),
    ).resolves.toBe(false);
    expect(calls.filter(({ sql }) => sql.startsWith("INSERT INTO"))).toHaveLength(1);
  });

  it("rereads a conditional delete miss before reporting a changed expected record", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    let reads = 0;
    const connection = readyConnection(calls, {
      select: () => {
        const value = reads++ === 0 ? "first" : "rival";
        return [{ bytes: toBinary(StringValueSchema, create(StringValueSchema, { value })) }];
      },
    });
    const originalExecute = connection.execute;
    connection.execute = (sql: string, values?: readonly unknown[]) => {
      if (sql.startsWith("DELETE")) {
        calls.push({ sql, ...(values === undefined ? {} : { values }) });
        return Promise.resolve([{ affectedRows: 0 }, []] as never);
      }
      return originalExecute(sql, values);
    };
    const storage = stringStorage(connection);

    await expect(
      storage.compareAndSet("slot", create(StringValueSchema, { value: "first" }), undefined),
    ).resolves.toBe(false);
    expect(reads).toBe(2);
    expect(calls.filter(({ sql }) => sql.startsWith("DELETE"))).toHaveLength(1);
  });

  it("deletes a matching row through its raw-byte guard", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const current = create(StringValueSchema, { value: "first" });
    const storage = stringStorage(
      readyConnection(calls, { select: () => [{ bytes: toBinary(StringValueSchema, current) }] }),
    );

    await expect(storage.compareAndSet("slot", current, undefined)).resolves.toBe(true);
    expect(calls.find(({ sql }) => sql.startsWith("DELETE"))?.sql).toContain(
      "WHERE ID=? AND bytes=?",
    );
  });

  it("preserves a non-Error connection failure without retrying it", async () => {
    const spec = new RecordSpec<string, StringValue>({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      {
        // Drivers may reject with a non-Error value; exercise cause preservation.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        acquire: () => Promise.reject("connection unavailable"),
        release: () => undefined,
      },
      () => undefined,
    );

    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "next" })),
    ).rejects.toMatchObject({ cause: "connection unavailable" });
  });

  it("rejects a non-object immutable insert failure without classifying it as a collision", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls);
    const originalExecute = connection.execute;
    connection.execute = (sql: string, values?: readonly unknown[]) =>
      // Drivers may reject with a non-Error value; exercise collision classification.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      sql.startsWith("INSERT INTO") ? Promise.reject(null) : originalExecute(sql, values);
    const storage = stringStorage(connection);

    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "one" })),
    ).rejects.toMatchObject({ cause: null });
  });

  it("retries a deadlock with a fresh conditional attempt", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls);
    const originalExecute = connection.execute;
    let reads = 0;
    connection.execute = (sql: string, values?: readonly unknown[]) => {
      if (sql.startsWith("SELECT bytes") && reads++ === 0)
        return Promise.reject(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }));
      return originalExecute(sql, values);
    };
    const storage = stringStorage(connection);

    await expect(
      storage.compareAndSet("slot", undefined, create(StringValueSchema, { value: "next" })),
    ).resolves.toBe(true);
    expect(reads).toBe(2);
    expect(calls.some(({ sql }) => sql === "BEGIN" || sql === "ROLLBACK")).toBe(false);
  });

  it("pushes ID filtering, descending ID order, and offset-only windows into SQL", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls);
    const storage = stringStorage(connection);

    await storage.queryEntries({
      filters: [{ column: "id", value: "two" }],
      sort: [{ field: "id", direction: "desc" }],
      offset: 3,
    });

    const query = calls.find((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain("`ID` <=> ?");
    expect(query?.sql).toContain("`ID` DESC, ID ASC");
    expect(query?.sql).toContain("LIMIT 18446744073709551615 OFFSET ?");
    expect(query?.values?.at(-1)).toBe(3);
  });

  it("rejects undeclared query columns and oversized record keys before acquisition", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls);
    let acquired = 0;
    const storage = stringStorage(connection, () => acquired++);

    await expect(
      storage.queryEntries({ filters: [{ column: "missing", value: "x" }] }),
    ).rejects.toThrow(/not declared/i);
    await expect(
      storage.write(create(StringValueSchema, { value: "x".repeat(513) })),
    ).rejects.toThrow(/identifier is too large/i);
    await expect(storage.read("x".repeat(513))).rejects.toThrow(/identifier is too large/i);
    await expect(storage.delete("x".repeat(513))).rejects.toThrow(/identifier is too large/i);
    await expect(storage.queryEntries({ ids: ["x".repeat(513)] })).rejects.toThrow(
      /identifier is too large/i,
    );
    await expect(
      storage.compareAndSet(
        "x".repeat(513),
        undefined,
        create(StringValueSchema, { value: "next" }),
      ),
    ).rejects.toThrow(/identifier is too large/i);
    expect(acquired).toBe(0);
  });

  it("adds a keyset predicate for an ascending continuation", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        return Promise.resolve(
          sql.includes("information_schema.columns")
            ? ([[{ column_name: "ID" }, { column_name: "bytes" }], []] as never)
            : ([[], []] as never),
        );
      },
      execute: () => Promise.resolve([{ affectedRows: 1 }, []] as never),
      beginTransaction: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      rollback: () => Promise.resolve(),
    };
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
      columns: [],
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      lifecycle(connection),
      () => undefined,
    );

    await storage.query({
      sort: [{ field: "id" }],
      after: { values: [{ field: "id", value: "a" }], id: "a" },
    });

    expect(calls.at(-1)).toContain("ID > ?");
  });

  it("binds a mixed-direction Event cursor in lexicographic order", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const received = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_500_000 });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "middle" }),
      context: { timestamp: received },
    });
    const spec = new RecordSpec<string, Event>({
      recordType: EventSchema,
      idKind: "string",
      extractId: (value) => value.id?.value ?? "",
      columns: [
        new RecordColumn(
          "received",
          ColumnTypes.message(TimestampSchema),
          (value) => value.context?.timestamp,
        ),
      ],
    });
    const storage = new MysqlRecordStorage(
      { name: "events", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(EventSchema.typeName, undefined),
      lifecycle(readyConnection(calls, { columns: ["ID", "bytes", "received"] })),
      () => undefined,
    );

    await storage.query({
      sort: [
        { field: "received", direction: "asc" },
        { field: "id", direction: "desc" },
      ],
      after: {
        values: [
          { field: "received", value: event.context?.timestamp },
          { field: "id", value: event.id?.value },
        ],
        id: "middle",
      },
      limit: 2,
    });

    const query = calls.find(({ sql }) => sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain(
      "WHERE (`received` > ? OR `received` <=> ? AND `ID` < ? OR " +
        "`received` <=> ? AND `ID` <=> ? AND ID > ?)",
    );
    expect(query?.sql).toContain("ORDER BY `received` ASC, `ID` DESC, ID ASC LIMIT ?");
    const nanos = 1_789_000_000_123_500_000n;
    expect(query?.values).toEqual([nanos, nanos, "middle", nanos, "middle", "middle", 2]);
  });

  it("continues an unsorted record page by ID alone", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const storage = stringStorage(readyConnection(calls));

    await storage.query({ after: { values: [], id: "middle" }, limit: 2 });

    const query = calls.find(({ sql }) => sql.startsWith("SELECT ID, bytes"));
    expect(query?.sql).toContain("WHERE (ID > ?) ORDER BY ID ASC LIMIT ?");
    expect(query?.values).toEqual(["middle", 2]);
  });

  it("uses a conditional insert without session locks", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = readyConnection(calls);
    const storage = stringStorage(connection);

    await expect(
      storage.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" })),
    ).resolves.toBe(true);
    expect(calls.some(({ sql }) => sql.startsWith("INSERT INTO"))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes("GET_LOCK") || sql.includes("FOR UPDATE"))).toBe(
      false,
    );
  });
});

function lifecycle(connection: unknown) {
  return {
    databaseName: "test",
    acquire: () => Promise.resolve(connection as never),
    release: () => undefined,
  };
}

function stringStorage(
  connection: ReturnType<typeof readyConnection>,
  acquired: () => unknown = () => undefined,
): MysqlRecordStorage<string, StringValue> {
  return new MysqlRecordStorage(
    { name: "records", multitenant: false },
    new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    }),
    new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
    {
      acquire: () => Promise.resolve((acquired(), connection) as never),
      release: () => undefined,
    },
    () => undefined,
  );
}

function readyConnection(
  calls: { sql: string; values?: readonly unknown[] }[],
  options: { select?: () => unknown[]; columns?: readonly string[]; planRows?: unknown[] } = {},
) {
  const record = (sql: string, values?: readonly unknown[]) => {
    calls.push(values === undefined ? { sql } : { sql, values });
  };
  return {
    query: (sql: string, values?: readonly unknown[]) => {
      record(sql, values);
      if (sql.startsWith("SELECT ID, bytes"))
        return Promise.resolve([options.planRows ?? [], []] as never);
      if (sql.includes("information_schema.columns"))
        return Promise.resolve([
          (options.columns ?? ["ID", "bytes"]).map((column_name) => ({ column_name })),
          [],
        ] as never);
      if (sql.includes("information_schema.statistics"))
        return Promise.resolve([[{ column_name: "ID", seq_in_index: 1 }], []] as never);
      if (sql.includes("information_schema.tables"))
        return Promise.resolve([[{ engine: "InnoDB" }], []] as never);
      return Promise.resolve([[], []] as never);
    },
    execute: (sql: string, values?: readonly unknown[]) => {
      record(sql, values);
      if (sql.startsWith("SELECT bytes"))
        return Promise.resolve([options.select?.() ?? [], []] as never);
      return Promise.resolve([{ affectedRows: 1 }, []] as never);
    },
    beginTransaction: () => {
      record("BEGIN");
      return Promise.resolve();
    },
    commit: () => {
      record("COMMIT");
      return Promise.resolve();
    },
    rollback: () => {
      record("ROLLBACK");
      return Promise.resolve();
    },
  };
}

interface SchemaColumn {
  readonly column_name: string;
  readonly column_type: string;
  readonly is_nullable: string;
  readonly column_default: string | null;
  readonly collation_name?: string | null;
  readonly extra: string;
}

interface SchemaLayout {
  readonly columns: readonly SchemaColumn[];
  readonly primary: readonly { readonly column_name: string; readonly seq_in_index: number }[];
  readonly indexes?: readonly {
    readonly index_name: string;
    readonly non_unique: number;
    readonly column_name: string;
    readonly seq_in_index: number;
  }[];
}

function canonicalColumns(overrides: Record<string, Partial<SchemaColumn>> = {}): SchemaColumn[] {
  return [
    {
      column_name: "ID",
      column_type: "varchar(512)",
      is_nullable: "NO",
      column_default: null,
      extra: "",
    },
    {
      column_name: "bytes",
      column_type: "blob",
      is_nullable: "NO",
      column_default: null,
      extra: "",
    },
    {
      column_name: "value",
      column_type: "text",
      is_nullable: "YES",
      column_default: null,
      extra: "",
    },
  ].map((column) => ({ ...column, ...overrides[column.column_name] }));
}

function primaryKey(names: readonly string[] = ["ID"]) {
  return names.map((column_name, index) => ({ column_name, seq_in_index: index + 1 }));
}

function schemaConnection(calls: string[], layout: SchemaLayout) {
  return {
    query: (sql: string) => {
      calls.push(sql);
      if (sql.includes("information_schema.columns"))
        return Promise.resolve([layout.columns, []] as never);
      if (sql.includes("information_schema.statistics") && sql.includes("index_name='PRIMARY'"))
        return Promise.resolve([layout.primary, []] as never);
      if (sql.includes("information_schema.statistics"))
        return Promise.resolve([layout.indexes ?? [], []] as never);
      if (sql.includes("information_schema.tables"))
        return Promise.resolve([[{ engine: "InnoDB" }], []] as never);
      return Promise.resolve([[], []] as never);
    },
    execute: () => Promise.resolve([{ affectedRows: 1 }, []] as never),
    beginTransaction: () => Promise.resolve(),
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
  };
}

function schemaStorage(
  connection: ReturnType<typeof schemaConnection>,
  onAcquire: () => void = () => undefined,
) {
  const spec = new RecordSpec<string, StringValue>({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
    columns: [
      new RecordColumn(
        "value",
        ColumnTypes.scalar(ScalarType.STRING),
        (record): string => record.value,
      ),
    ],
  });
  return new MysqlRecordStorage(
    { name: "records", multitenant: false },
    spec,
    new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
    {
      acquire: () => Promise.resolve((onAcquire(), connection) as never),
      release: () => undefined,
    },
    () => undefined,
  );
}

function entitySchemaStorage(booleanType: string) {
  const columns: SchemaColumn[] = [
    ...canonicalColumns().slice(0, 2),
    {
      column_name: "archived",
      column_type: booleanType,
      is_nullable: "NO",
      column_default: "0",
      extra: "",
    },
    {
      column_name: "deleted",
      column_type: booleanType,
      is_nullable: "NO",
      column_default: "0",
      extra: "",
    },
    {
      column_name: "version",
      column_type: "int",
      is_nullable: "NO",
      column_default: "0",
      extra: "",
    },
  ];
  const connection = schemaConnection([], { columns, primary: primaryKey() });
  const spec = new RecordSpec<string, EntityRecord>({
    sourceType: StringValueSchema,
    recordType: EntityRecordSchema,
    idKind: "string",
    extractId: () => "entity",
    columns: [
      new RecordColumn("archived", ColumnTypes.scalar(ScalarType.BOOL), () => false),
      new RecordColumn("deleted", ColumnTypes.scalar(ScalarType.BOOL), () => false),
      new RecordColumn("version", ColumnTypes.message(VersionSchema), () => create(VersionSchema)),
    ],
  });
  return new MysqlRecordStorage(
    { name: "records", multitenant: false },
    spec,
    new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
    {
      acquire: () => Promise.resolve(connection as never),
      release: () => undefined,
    },
    () => undefined,
  );
}
