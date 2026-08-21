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

import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { createPool } from "mysql2/promise";
import { StringifierRegistry } from "@spine-event-engine/core";
import { EventSchema, TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  StorageGroup,
  type StorageContext,
} from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import {
  MysqlStorageFactory,
  type CreateOperationFactory,
  type MysqlStorageFactoryBuilder,
  type MysqlTableSpec,
} from "../src/index.js";

vi.mock("mysql2/promise", () => ({ createPool: vi.fn() }));

describe("MysqlStorageFactory builder contract", () => {
  it("exposes the JVM-style builder without a static create alias", () => {
    const builder: MysqlStorageFactoryBuilder = MysqlStorageFactory.newBuilder();

    expect(builder.setTableName(StringValueSchema, "records")).toBe(builder);
    expect("create" in MysqlStorageFactory).toBe(false);
  });

  it("rejects a missing options value and malformed or database-less URLs before connecting", async () => {
    await expect(MysqlStorageFactory.newBuilder().build()).rejects.toThrow(/options are required/i);
    await expect(
      MysqlStorageFactory.newBuilder().setOptions({ url: "not a URL" }).build(),
    ).rejects.toThrow(/valid URL/i);
    await expect(
      MysqlStorageFactory.newBuilder().setOptions({ url: "mysql://user:pass@localhost" }).build(),
    ).rejects.toThrow(/database/i);
  });

  it("validates table registrations while preserving independent record names", () => {
    const builder = MysqlStorageFactory.newBuilder();

    builder.setTableName(StringValueSchema, "string_values");
    expect(builder.setTableName(TimestampSchema, "timestamps")).toBe(builder);
    expect(() => builder.setTableName(StringValueSchema, "bad-name")).toThrow(/invalid/i);
    expect(() => builder.setTableName(TimestampSchema, "string_values")).toThrow(/collides/i);
  });

  it("keeps grouped registrations separate from a record-only registration", () => {
    const builder = MysqlStorageFactory.newBuilder();

    expect(builder.setTableName(StringValueSchema, "ungrouped_values")).toBe(builder);
    expect(builder.setTableName(TimestampSchema, StringValueSchema, "grouped_values")).toBe(
      builder,
    );
  });

  it("connects with parsed options, releases its probe, and closes its pool once", async () => {
    const release = vi.fn();
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ query: vi.fn(mysqlQuery), release })),
      end,
    } as never);

    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({
        url: "mysql://user:secret@db.example:3307/test_db",
        connectionLimit: 2,
        connectTimeoutMs: 10,
        tls: { rejectUnauthorized: false },
      })
      .build();
    factory.close();
    factory.close();
    await Promise.resolve();

    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "db.example",
        port: 3307,
        database: "test_db",
        user: "user",
        password: "secret",
        connectionLimit: 2,
        connectTimeout: 10,
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("sanitizes connection failures and closes the failed pool", async () => {
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.reject(new Error("credential leak"))),
      end,
    } as never);

    await expect(
      MysqlStorageFactory.newBuilder().setOptions({ url: "mysql://db.example/database" }).build(),
    ).rejects.toThrow("Unable to connect to MySQL.");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("connects with only required URL fields without inventing optional pool settings", async () => {
    const release = vi.fn();
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ query: vi.fn(mysqlQuery), release })),
      end: vi.fn(() => Promise.resolve()),
    } as never);

    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/defaults" })
      .build();
    factory.close();
    await Promise.resolve();

    expect(createPool).toHaveBeenLastCalledWith({
      host: "db.example",
      database: "defaults",
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("snapshots custom message stringifiers for record IDs and query columns", async () => {
    const calls: { readonly sql: string; readonly values?: readonly unknown[] }[] = [];
    const query = vi.fn((sql: string, values?: readonly unknown[]) => {
      calls.push(values === undefined ? { sql } : { sql, values });
      if (sql.includes("LOWER(column_name) IN ('_scope', '_revision')")) {
        return Promise.resolve([[], []]);
      }
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve([
          [
            { column_name: "ID", column_type: "varchar(512)", is_nullable: "NO" },
            { column_name: "bytes", column_type: "blob", is_nullable: "NO" },
            { column_name: "owner", column_type: "text", is_nullable: "YES" },
          ],
          [],
        ]);
      }
      return mysqlQuery(sql);
    });
    const execute = vi.fn((sql: string, values?: readonly unknown[]) => {
      calls.push(values === undefined ? { sql } : { sql, values });
      return Promise.resolve([{ affectedRows: 1 }, []]);
    });
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ ...mysqlConnection(query), query, execute })),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const registry = new StringifierRegistry();
    registry.register(UserIdSchema, userStringifier("user:"));
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/stringifiers" })
      .setStringifierRegistry(registry)
      .build();
    registry.register(UserIdSchema, userStringifier("changed:"));
    const spec = new RecordSpec({
      recordType: UserIdSchema,
      idSchema: UserIdSchema,
      extractId: (record) => record,
      columns: [new RecordColumn("owner", ColumnTypes.message(UserIdSchema), (record) => record)],
    });
    const records = factory.createRecordStorage({ name: "users", multitenant: false }, spec);
    const id = create(UserIdSchema, { value: "42" });

    await records.write(id);
    await records.query({ filters: [{ column: "owner", value: id }] });
    await records.query({
      sort: [{ field: "owner" }],
      after: { values: [{ field: "owner", value: id }], id },
    });

    const selects = calls.filter((call) => call.sql.startsWith("SELECT ID, bytes"));
    expect(selects[0]?.values).toContain("user:42");
    expect(selects[1]?.sql).toContain("`owner` > ?");
    expect(selects[1]?.values).toEqual(["user:42", "user:42", "user:42"]);
    expect(calls.flatMap((call) => call.values ?? [])).not.toContain("changed:42");
    records.close();
    factory.close();
  });

  it("builds one pool per complete configured tenant and enumerates those boundaries", async () => {
    const firstEnd = vi.fn(() => Promise.resolve());
    const secondEnd = vi.fn(() => Promise.resolve());
    const firstQuery = vi.fn(mysqlQuery);
    const secondQuery = vi.fn(mysqlQuery);
    vi.mocked(createPool)
      .mockReturnValueOnce({
        getConnection: vi.fn(() => Promise.resolve(mysqlConnection(firstQuery))),
        end: firstEnd,
      } as never)
      .mockReturnValueOnce({
        getConnection: vi.fn(() => Promise.resolve(mysqlConnection(secondQuery))),
        end: secondEnd,
      } as never);
    const tenantOne = create(TenantIdSchema, { kind: { case: "value", value: "one" } });
    const tenantTwo = create(TenantIdSchema, { kind: { case: "value", value: "two" } });

    const factory = await MysqlStorageFactory.newBuilder()
      .setTenantOptions([
        { tenantId: tenantOne, options: { url: "mysql://db.example/tenant_one" } },
        { tenantId: tenantTwo, options: { url: "mysql://db.example/tenant_two" } },
      ])
      .build();

    await expect(factory.tenantCatalog().all()).resolves.toEqual([
      expect.objectContaining({ single: false, tenantId: tenantOne }),
      expect.objectContaining({ single: false, tenantId: tenantTwo }),
    ]);
    firstQuery.mockClear();
    secondQuery.mockClear();
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const first = factory.createRecordStorage(
      { name: "first", multitenant: true, tenantId: tenantOne },
      spec,
    );
    const second = factory.createRecordStorage(
      { name: "second", multitenant: true, tenantId: tenantTwo },
      spec,
    );
    await first.write(create(StringValueSchema, { value: "one" }));
    expect(firstQuery).toHaveBeenCalled();
    expect(secondQuery).not.toHaveBeenCalled();
    firstQuery.mockClear();
    await second.write(create(StringValueSchema, { value: "two" }));
    expect(secondQuery).toHaveBeenCalled();
    expect(firstQuery).not.toHaveBeenCalled();
    expect(() =>
      factory.createRecordStorage(
        {
          name: "diagnostic-only",
          multitenant: true,
          tenantId: create(TenantIdSchema, { kind: { case: "value", value: "unknown" } }),
        },
        new RecordSpec({
          recordType: StringValueSchema,
          idKind: "string",
          extractId: (record) => record.value,
        }),
      ),
    ).toThrow(/no configured database/i);
    first.close();
    second.close();
    factory.close();
    await Promise.resolve();
    expect(firstEnd).toHaveBeenCalledOnce();
    expect(secondEnd).toHaveBeenCalledOnce();
  });

  it("closes successful and failed tenant pools once after a partial build failure", async () => {
    const firstEnd = vi.fn(() => Promise.resolve());
    const secondEnd = vi.fn(() => Promise.resolve());
    vi.mocked(createPool)
      .mockReturnValueOnce({
        getConnection: vi.fn(() => Promise.resolve({ query: vi.fn(mysqlQuery), release: vi.fn() })),
        end: firstEnd,
      } as never)
      .mockReturnValueOnce({
        getConnection: vi.fn(() => Promise.reject(new Error("credential leak"))),
        end: secondEnd,
      } as never);

    await expect(
      MysqlStorageFactory.newBuilder()
        .setTenantOptions([
          { tenantId: tenant("one"), options: { url: "mysql://db.example/one" } },
          { tenantId: tenant("two"), options: { url: "mysql://db.example/two" } },
        ])
        .build(),
    ).rejects.toThrow("Unable to connect to MySQL.");
    expect(firstEnd).toHaveBeenCalledOnce();
    expect(secondEnd).toHaveBeenCalledOnce();
  });

  it("rejects a configured database that still contains the retired physical layout", async () => {
    const release = vi.fn();
    const end = vi.fn(() => Promise.resolve());
    const query = vi.fn((sql: string) => {
      if (sql.includes("information_schema.columns")) {
        return Promise.resolve([[{ table_name: "messages", column_name: "_scope" }], []]);
      }
      return Promise.resolve([[], []]);
    });
    vi.mocked(createPool).mockReturnValueOnce({
      getConnection: vi.fn(() => Promise.resolve({ query, release })),
      end,
    } as never);

    await expect(
      MysqlStorageFactory.newBuilder().setOptions({ url: "mysql://db.example/legacy" }).build(),
    ).rejects.toThrow(/retired MySQL storage layout/i);

    expect(release).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });

  it("rejects duplicate tenants, shared physical targets, and mixed tenancy modes", async () => {
    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "one" } });
    const other = create(TenantIdSchema, { kind: { case: "value", value: "two" } });

    await expect(
      MysqlStorageFactory.newBuilder()
        .setTenantOptions([
          { tenantId: tenant, options: { url: "mysql://db.example/one" } },
          { tenantId: tenant, options: { url: "mysql://db.example/two" } },
        ])
        .build(),
    ).rejects.toThrow(/duplicate tenant/i);
    await expect(
      MysqlStorageFactory.newBuilder()
        .setTenantOptions([
          { tenantId: tenant, options: { url: "mysql://db.example/shared" } },
          { tenantId: other, options: { url: "mysql://DB.EXAMPLE:3306/shared" } },
        ])
        .build(),
    ).rejects.toThrow(/physical database/i);
    await expect(
      MysqlStorageFactory.newBuilder()
        .setTenantOptions([
          { tenantId: tenant, options: { url: "mysql://db.example/Shared" } },
          { tenantId: other, options: { url: "mysql://db.example/shared" } },
        ])
        .build(),
    ).rejects.toThrow(/physical database/i);
    await expect(
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: "mysql://db.example/single" })
        .setTenantOptions([{ tenantId: tenant, options: { url: "mysql://db.example/tenant" } }])
        .build(),
    ).rejects.toThrow(/either single-tenant or multitenant/i);
  });

  it("enforces MySQL Entity-commit source, history, event-ID, and close guards before opening tables", async () => {
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ query: vi.fn(mysqlQuery), release: vi.fn() })),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/commits" })
      .build();
    const entity = entityInput({ name: "commits", multitenant: false });
    const mutation = {
      context: entity.context,
      entity,
      entityId: "entity",
      next: create(EntityRecordSchema),
    };
    const closed = EntityCommitStorageFactories.create(factory, entity);
    closed.close();
    await expect(closed.commit(mutation)).rejects.toThrow(/closed/i);

    const commits = EntityCommitStorageFactories.create(factory, entity);
    await expect(
      commits.commit({ ...mutation, entity: { ...entity, sourceType: TimestampSchema } }),
    ).rejects.toThrow(/source type is incompatible/i);
    await expect(
      commits.commit({
        ...mutation,
        context: { name: "other", multitenant: true, tenantId: tenant("other") },
      }),
    ).rejects.toThrow(/context is incompatible/i);
    commits.close();

    const noHistory = entityInput({ name: "no-history", multitenant: false }, false, false);
    const disabled = EntityCommitStorageFactories.create(factory, noHistory);
    await expect(
      disabled.commit({
        ...mutation,
        context: noHistory.context,
        entity: noHistory,
        states: [create(EntityRecordSchema)],
      }),
    ).rejects.toThrow(/state history is disabled/i);
    await expect(
      disabled.commit({
        ...mutation,
        context: noHistory.context,
        entity: noHistory,
        diagnostics: [create(EventSchema)],
      }),
    ).rejects.toThrow(/event history is disabled/i);
    disabled.close();

    const missingId = EntityCommitStorageFactories.create(factory, entity);
    await expect(missingId.commit({ ...mutation, events: [create(EventSchema)] })).rejects.toThrow(
      /requires delivery-event IDs/i,
    );
    missingId.close();
    factory.close();
  });

  it("uses a configured create operation for a grouped record family before inspecting its layout", async () => {
    let table: MysqlTableSpec<string, import("@bufbuild/protobuf/wkt").StringValue> | undefined;
    const query = vi.fn((sql: string) => {
      if (sql.includes("information_schema.columns"))
        return Promise.resolve([table?.columns.map(({ name }) => ({ column_name: name })) ?? []]);
      if (sql.includes("index_name='PRIMARY'"))
        return Promise.resolve([table?.primaryKey.map((column_name) => ({ column_name })) ?? []]);
      if (sql.includes("information_schema.statistics")) return Promise.resolve([[]]);
      if (sql.includes("information_schema.tables"))
        return Promise.resolve([[{ engine: "InnoDB" }]]);
      return Promise.resolve([[]]);
    });
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ query, release: vi.fn() })),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    let operationCalls = 0;
    const operation: CreateOperationFactory = <I, R extends Message>(
      resolved: MysqlTableSpec<I, R>,
    ) => {
      operationCalls += 1;
      table = resolved as unknown as MysqlTableSpec<
        string,
        import("@bufbuild/protobuf/wkt").StringValue
      >;
      return { sql: `CREATE TABLE \`${resolved.tableName}\` (test INT)` };
    };
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/grouped" })
      .useOperationFactory(operation)
      .build();
    const records = factory.createRecordStorage(
      { name: "grouped", multitenant: false },
      new RecordSpec({
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
      new StorageGroup("history"),
    );

    await (records as unknown as { prepare(): Promise<void> }).prepare();

    expect(operationCalls).toBe(1);
    expect(table?.groupName).toBe("history");
    expect(table?.tableName).toContain("history");
    expect(query.mock.calls.some(([sql]) => sql.includes("CREATE TABLE"))).toBe(true);
    records.close();
    factory.close();
  });
});

function entityInput(context: StorageContext, stateHistory = true, eventHistory = true) {
  const recordSpec = new RecordSpec({
    sourceType: StringValueSchema,
    recordType: EntityRecordSchema,
    idKind: "string",
    extractId: () => "entity",
  });
  return {
    context,
    id: {
      clone: (id: string) => id,
      key: (id: string) => id,
      pack: () => create(AnySchema),
      unpack: () => undefined,
    },
    columns: [],
    recordSpec,
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
    stateHistory,
    eventHistory,
  };
}

function tenant(value: string) {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

function mysqlConnection(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    execute: () => Promise.resolve([{ affectedRows: 1 }, []]),
    beginTransaction: () => Promise.resolve(),
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
    release: vi.fn(),
  };
}

function mysqlQuery(sql: string) {
  if (sql.includes("LOWER(column_name) IN ('_scope', '_revision')")) {
    return Promise.resolve([[], []]);
  }
  if (sql.includes("ORDER BY table_name, seq_in_index")) {
    return Promise.resolve([[], []]);
  }
  if (sql.includes("information_schema.columns")) {
    return Promise.resolve([
      [
        { column_name: "ID", column_type: "varchar(512)", is_nullable: "NO" },
        { column_name: "bytes", column_type: "blob", is_nullable: "NO" },
      ],
      [],
    ]);
  }
  if (sql.includes("information_schema.statistics") && sql.includes("index_name='PRIMARY'")) {
    return Promise.resolve([[{ column_name: "ID", seq_in_index: 1 }], []]);
  }
  if (sql.includes("information_schema.statistics")) return Promise.resolve([[], []]);
  if (sql.includes("information_schema.tables"))
    return Promise.resolve([[{ engine: "InnoDB" }], []]);
  return Promise.resolve([[], []]);
}

function userStringifier(prefix: string) {
  return {
    toString: (value: import("@spine-event-engine/proto").UserId) => `${prefix}${value.value}`,
    fromString: (value: string) => create(UserIdSchema, { value: value.slice(prefix.length) }),
  };
}
