import { create, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { RecordColumn, RecordSpec } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { MysqlRecordStorage } from "../src/mysql/record-storage.js";
import { MysqlTableResolver } from "../src/mysql/table-resolver.js";
import { MysqlStorageSchemaError } from "../src/mysql/errors.js";
import { CanonicalMysqlValues } from "../src/mysql/value-codec.js";

describe("MysqlRecordStorage", () => {
  it.each([
    ["missing primary key", { primary: [], columns: canonicalColumns() }, /primary key/i],
    [
      "reordered primary key",
      { primary: primaryKey(["ID", "_scope"]), columns: canonicalColumns() },
      /primary key/i,
    ],
    [
      "narrow required capacity",
      {
        primary: primaryKey(),
        columns: canonicalColumns({ _scope: { column_type: "varbinary(223)" } }),
      },
      /_scope type/i,
    ],
    [
      "wrong required type",
      { primary: primaryKey(), columns: canonicalColumns({ bytes: { column_type: "blob" } }) },
      /bytes type/i,
    ],
    [
      "nonbinary required collation",
      {
        primary: primaryKey(),
        columns: canonicalColumns({ _scope: { collation_name: "utf8mb4_general_ci" } }),
      },
      /_scope collation/i,
    ],
    [
      "nullable required column",
      { primary: primaryKey(), columns: canonicalColumns({ ID: { is_nullable: "YES" } }) },
      /nullable ID/i,
    ],
    [
      "missing revision default",
      { primary: primaryKey(), columns: canonicalColumns({ _revision: { column_default: null } }) },
      /_revision default/i,
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
      "harmful required extra column",
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
  ])("rejects %s without altering the existing table", async (_name, layout) => {
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
          _scope: { column_type: "varbinary(300)" },
          ID: { column_type: "varbinary(900)" },
        }),
      },
    ],
    [
      "nullable extra column",
      {
        primary: primaryKey(),
        columns: [
          ...canonicalColumns(),
          {
            column_name: "extra",
            column_type: "int",
            is_nullable: "YES",
            column_default: null,
            extra: "",
          },
        ],
      },
    ],
    [
      "defaulted extra column",
      {
        primary: primaryKey(),
        columns: [
          ...canonicalColumns(),
          {
            column_name: "extra",
            column_type: "int",
            is_nullable: "NO",
            column_default: "0",
            extra: "",
          },
        ],
      },
    ],
    [
      "generated extra column",
      {
        primary: primaryKey(),
        columns: [
          ...canonicalColumns(),
          {
            column_name: "extra",
            column_type: "int",
            is_nullable: "NO",
            column_default: null,
            extra: "VIRTUAL GENERATED",
          },
        ],
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
        indexes: [
          { index_name: "unique_scope_id", non_unique: 0, column_name: "_scope", seq_in_index: 1 },
          { index_name: "unique_scope_id", non_unique: 0, column_name: "ID", seq_in_index: 2 },
        ],
      },
    ],
  ])("accepts compatible %s", async (_name, layout) => {
    const storage = schemaStorage(schemaConnection([], layout));

    await expect(
      storage.write(create(StringValueSchema, { value: "one" })),
    ).resolves.toBeUndefined();
  });

  it("rejects an incompatible primary key instead of altering the table", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        if (sql.includes("columns"))
          return Promise.resolve([
            [
              { column_name: "_scope", column_type: "varbinary(224)" },
              { column_name: "ID", column_type: "varbinary(768)" },
              { column_name: "bytes", column_type: "mediumblob" },
              { column_name: "_revision", column_type: "bigint unsigned" },
            ],
            [],
          ] as never);
        if (sql.includes("statistics"))
          return Promise.resolve([[{ column_name: "ID", seq_in_index: 1 }], []] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
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
          return Promise.resolve([
            [
              { column_name: "_scope" },
              { column_name: "ID" },
              { column_name: "bytes" },
              { column_name: "_revision" },
            ],
            [],
          ] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );

    await expect(
      storage.assertImmutable(create(StringValueSchema, { value: "new" })),
    ).rejects.toThrow(/immutable record collides/i);

    expect(calls.some((call) => call.startsWith("INSERT"))).toBe(false);
  });

  it("rejects a divergent immutable insert race without an overwrite", async () => {
    let reads = 0;
    const calls: string[] = [];
    const connection = {
      query: (sql: string) =>
        sql.includes("columns")
          ? Promise.resolve([
              [
                { column_name: "_scope" },
                { column_name: "ID" },
                { column_name: "bytes" },
                { column_name: "_revision" },
              ],
              [],
            ] as never)
          : Promise.resolve([[], []] as never),
      execute: (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT bytes"))
          return Promise.resolve([
            reads++ === 0
              ? []
              : [
                  {
                    bytes: toBinary(
                      StringValueSchema,
                      create(StringValueSchema, { value: "other" }),
                    ),
                  },
                ],
            [],
          ] as never);
        if (sql.startsWith("INSERT IGNORE"))
          return Promise.resolve([{ affectedRows: 0 }, []] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );
    await expect(
      storage.writeImmutable(create(StringValueSchema, { value: "one" })),
    ).rejects.toThrow(/immutable record collides/i);
    expect(calls.some((sql) => sql.includes("ON DUPLICATE KEY UPDATE"))).toBe(false);
  });

  it("accepts an identical immutable insert race without an overwrite", async () => {
    let reads = 0;
    const record = create(StringValueSchema, { value: "one" });
    const connection = {
      query: (sql: string) =>
        sql.includes("columns")
          ? Promise.resolve([
              [
                { column_name: "_scope" },
                { column_name: "ID" },
                { column_name: "bytes" },
                { column_name: "_revision" },
              ],
              [],
            ] as never)
          : Promise.resolve([[], []] as never),
      execute: (sql: string) => {
        if (sql.startsWith("SELECT bytes"))
          return Promise.resolve([
            reads++ === 0 ? [] : [{ bytes: toBinary(StringValueSchema, record) }],
            [],
          ] as never);
        if (sql.startsWith("INSERT IGNORE"))
          return Promise.resolve([{ affectedRows: 0 }, []] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );
    await expect(storage.writeImmutable(record)).resolves.toBeUndefined();
  });

  it("lazily creates one resolved family table before the first write", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        return Promise.resolve([
          [
            { column_name: "_scope" },
            { column_name: "ID" },
            { column_name: "bytes" },
            { column_name: "_revision" },
          ],
          [],
        ] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    expect(calls[0]).toMatch(/CREATE TABLE IF NOT EXISTS `google_protobuf_StringValue`/);
    expect(calls.at(-1)).toMatch(/INSERT INTO `google_protobuf_StringValue`/);
  });

  it("encodes single and multitenant scopes injectively without aliases", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push({ sql });
        return Promise.resolve([
          [
            { column_name: "_scope" },
            { column_name: "ID" },
            { column_name: "bytes" },
            { column_name: "_revision" },
          ],
          [],
        ] as never);
      },
      execute: (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values });
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );
    const two = new MysqlRecordStorage(
      { name: "a", multitenant: true, tenantId: "" },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );
    await one.write(create(StringValueSchema, { value: "id" }));
    await two.write(create(StringValueSchema, { value: "id" }));
    const scopes = calls
      .filter((call) => call.sql.startsWith("INSERT"))
      .map((call) => call.values?.[0]);
    expect(scopes[0]).not.toEqual(scopes[1]);
    expect(calls[0]?.sql).toContain("`_scope` VARBINARY(224)");
  });

  it("creates declared columns and pushes an equality filter into the family SQL", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT ID, bytes")) return Promise.resolve([[], []] as never);
        return Promise.resolve([
          [
            { column_name: "_scope" },
            { column_name: "ID" },
            { column_name: "bytes" },
            { column_name: "_revision" },
            { column_name: "value" },
          ],
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
      columns: [new RecordColumn("value", (record): string => record.value, "string")],
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );

    await storage.queryEntries({ filters: [{ column: "value", value: "one" }], limit: 1 });

    expect(calls[0]).toMatch(/`value` VARCHAR\(1024\) NULL/);
    expect(calls.at(-1)).toMatch(/WHERE _scope=\? AND `value` <=> \?/);
  });

  it("executes a caller supplied create operation instead of the default DDL", async () => {
    const calls: string[] = [];
    const connection = {
      query: (sql: string) => {
        calls.push(sql);
        return Promise.resolve([
          [
            { column_name: "_scope" },
            { column_name: "ID" },
            { column_name: "bytes" },
            { column_name: "_revision" },
          ],
          [],
        ] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
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
              { column_name: "_scope", column_type: "varbinary(224)", is_nullable: "NO" },
              { column_name: "ID", column_type: "varbinary(768)", is_nullable: "NO" },
              { column_name: "bytes", column_type: "mediumblob", is_nullable: "NO" },
              { column_name: "_revision", column_type: "bigint unsigned", is_nullable: "NO" },
            ],
            [],
          ] as never);
        if (sql.includes("information_schema.statistics"))
          return Promise.resolve([[{ column_name: "ID", seq_in_index: 1 }], []] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
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
          return Promise.resolve([
            [{ ID: Buffer.from(CanonicalMysqlValues.encode("stored")), bytes: encoded }],
            [],
          ] as never);
        if (sql.includes("information_schema.columns"))
          return Promise.resolve([
            [
              { column_name: "_scope" },
              { column_name: "ID" },
              { column_name: "bytes" },
              { column_name: "_revision" },
            ],
            [],
          ] as never);
        if (sql.includes("information_schema.statistics"))
          return Promise.resolve([
            [
              { column_name: "_scope", seq_in_index: 1 },
              { column_name: "ID", seq_in_index: 2 },
            ],
            [],
          ] as never);
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
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

    expect(calls).toContain("BEGIN");
    expect(calls).toContain("COMMIT");
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
            ["_scope", "ID", "bytes", "_revision", "flag", "number", "count", "raw", "object"].map(
              (column_name) => ({ column_name }),
            ),
            [],
          ] as never);
        return Promise.resolve([[], []] as never);
      },
      execute: (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values });
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
        new RecordColumn("flag", () => true, "boolean"),
        new RecordColumn("number", () => 1, "number"),
        new RecordColumn("count", () => 1n, "bigint"),
        new RecordColumn("raw", () => raw, "bytes"),
        new RecordColumn("object", () => ({ nested: 1n }), "string"),
      ],
    });
    const storage = new MysqlRecordStorage(
      { name: "records", multitenant: false },
      spec,
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );

    await storage.write(create(StringValueSchema, { value: "one" }));

    expect(calls[0]?.sql).toContain("`flag` BOOLEAN NULL");
    expect(calls[0]?.sql).toContain("`number` DOUBLE NULL");
    expect(calls[0]?.sql).toContain("`count` BIGINT NULL");
    expect(calls[0]?.sql).toContain("`raw` MEDIUMBLOB NULL");
    const insert = calls.find((call) => call.sql.startsWith("INSERT"));
    expect(insert?.values).toEqual(expect.arrayContaining(["1", raw, '{"nested":"1"}']));
  });

  it("uses the bound connection for nested work and rolls back a stale compare-and-set", async () => {
    const calls: { sql: string; values?: readonly unknown[] }[] = [];
    const encoded = toBinary(StringValueSchema, create(StringValueSchema, { value: "actual" }));
    const connection = readyConnection(calls, {
      select: () => [{ bytes: encoded }],
    });
    let acquired = 0;
    const storage = stringStorage(connection, () => acquired++);

    await storage.withConnection(connection as never, () =>
      storage.withConnection(connection as never, () =>
        storage.write(create(StringValueSchema, { value: "one" })),
      ),
    );
    await expect(
      storage.compareAndSet(
        "actual",
        create(StringValueSchema, { value: "expected" }),
        create(StringValueSchema, { value: "next" }),
      ),
    ).resolves.toBe(false);

    expect(acquired).toBe(1);
    expect(calls.map((call) => call.sql)).toContain("ROLLBACK");
    expect(calls.map((call) => call.sql)).not.toContain("COMMIT");
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

  it("rejects undeclared query columns and oversized scope or record keys before acquisition", async () => {
    const calls: string[] = [];
    const connection = readyConnection(calls);
    let acquired = 0;
    const storage = stringStorage(connection, () => acquired++);

    await expect(
      storage.queryEntries({ filters: [{ column: "missing", value: "x" }] }),
    ).rejects.toThrow(/not declared/i);
    const oversizedScope = new MysqlRecordStorage(
      { name: "x".repeat(220), multitenant: false },
      new RecordSpec({
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
      new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );

    await expect(oversizedScope.write(create(StringValueSchema, { value: "one" }))).rejects.toThrow(
      /scope is too large/i,
    );
    await expect(
      storage.write(create(StringValueSchema, { value: "x".repeat(769) })),
    ).rejects.toThrow(/identifier is too large/i);
    await expect(storage.read("x".repeat(769))).rejects.toThrow(/identifier is too large/i);
    await expect(storage.delete("x".repeat(769))).rejects.toThrow(/identifier is too large/i);
    await expect(storage.queryEntries({ ids: ["x".repeat(769)] })).rejects.toThrow(
      /identifier is too large/i,
    );
    await expect(
      storage.compareAndSet(
        "x".repeat(769),
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
            ? ([
                [
                  { column_name: "_scope" },
                  { column_name: "ID" },
                  { column_name: "bytes" },
                  { column_name: "_revision" },
                ],
                [],
              ] as never)
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );

    await storage.query({
      sort: [{ field: "id" }],
      after: { values: [{ field: "id", value: "a" }], id: "a" },
    });

    expect(calls.at(-1)).toContain("ID > ?");
  });

  it("locks the existing row before compare-and-set", async () => {
    const calls: string[] = [];
    let acquired = 1;
    const connection = {
      query: (sql: string) =>
        Promise.resolve(
          sql.includes("information_schema.columns")
            ? ([
                [
                  { column_name: "_scope" },
                  { column_name: "ID" },
                  { column_name: "bytes" },
                  { column_name: "_revision" },
                ],
                [],
              ] as never)
            : sql.includes("information_schema.tables")
              ? ([[{ engine: "MyISAM" }], []] as never)
              : ([[], []] as never),
        ),
      execute: (sql: string) => {
        calls.push(sql);
        if (sql.startsWith("SELECT GET_LOCK"))
          return Promise.resolve([[{ acquired }], []] as never);
        return Promise.resolve(
          sql.startsWith("SELECT") ? ([[], []] as never) : ([{ affectedRows: 1 }, []] as never),
        );
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
      { acquire: () => Promise.resolve(connection as never), release: () => undefined },
      () => undefined,
    );
    await storage.compareAndSet("one", undefined, create(StringValueSchema, { value: "one" }));
    expect(calls.find((sql) => sql.startsWith("SELECT bytes"))).toContain("FOR UPDATE");
    expect(calls).toContain("SELECT GET_LOCK(?, ?) AS acquired");
    expect(calls).toContain("SELECT RELEASE_LOCK(?)");
    acquired = 0;
    await expect(
      storage.compareAndSet("two", undefined, create(StringValueSchema, { value: "two" })),
    ).rejects.toThrow(/acquire/i);
  });
});

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
    { acquire: () => Promise.resolve((acquired(), connection) as never), release: () => undefined },
    () => undefined,
  );
}

function readyConnection(
  calls: { sql: string; values?: readonly unknown[] }[],
  options: { select?: () => unknown[] } = {},
) {
  const record = (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
  };
  return {
    query: (sql: string, values?: readonly unknown[]) => {
      record(sql, values);
      if (sql.startsWith("SELECT ID, bytes")) return Promise.resolve([[], []] as never);
      if (sql.includes("information_schema.columns"))
        return Promise.resolve([
          ["_scope", "ID", "bytes", "_revision"].map((column_name) => ({ column_name })),
          [],
        ] as never);
      if (sql.includes("information_schema.statistics"))
        return Promise.resolve([
          [
            { column_name: "_scope", seq_in_index: 1 },
            { column_name: "ID", seq_in_index: 2 },
          ],
          [],
        ] as never);
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
      column_name: "_scope",
      column_type: "varbinary(224)",
      is_nullable: "NO",
      column_default: null,
      extra: "",
    },
    {
      column_name: "ID",
      column_type: "varbinary(768)",
      is_nullable: "NO",
      column_default: null,
      extra: "",
    },
    {
      column_name: "bytes",
      column_type: "mediumblob",
      is_nullable: "NO",
      column_default: null,
      extra: "",
    },
    {
      column_name: "_revision",
      column_type: "bigint unsigned",
      is_nullable: "NO",
      column_default: "0",
      extra: "",
    },
    {
      column_name: "value",
      column_type: "varchar(1024)",
      is_nullable: "YES",
      column_default: null,
      extra: "",
    },
  ].map((column) => ({ ...column, ...overrides[column.column_name] }));
}

function primaryKey(names: readonly string[] = ["_scope", "ID"]) {
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

function schemaStorage(connection: ReturnType<typeof schemaConnection>) {
  const spec = new RecordSpec<string, StringValue>({
    recordType: StringValueSchema,
    idKind: "string",
    extractId: (record) => record.value,
    columns: [new RecordColumn("value", (record): string => record.value, "string")],
  });
  return new MysqlRecordStorage(
    { name: "records", multitenant: false },
    spec,
    new MysqlTableResolver().resolve(StringValueSchema.typeName, undefined),
    { acquire: () => Promise.resolve(connection as never), release: () => undefined },
    () => undefined,
  );
}
