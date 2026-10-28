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

import { create, fromBinary, ScalarType, toBinary, type Message } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { createPool } from "mysql2/promise";
import {
  AnyPacker,
  Identifiers,
  StringifierRegistry,
  TypeRegistry,
} from "@spine-event-engine/core";
import {
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
// prettier-ignore
import {
  AgentModelPreferencesRecordSchema,
} from "@spine-event-engine/proto/generated/spine/server/agent/model_preferences_record_pb.js";
import {
  AgentHistoryStorageFactories,
  AgentHistoryRecords,
  eventStoreRecordSpec,
  EntityCommitStorageFactories,
  StoragePreparations,
  TenantBoundary,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import {
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  StorageGroup,
  type StorageContext,
} from "@spine-event-engine/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import {
  TaskSchema,
  type Task,
} from "../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";
import { conversation, scope } from "../../storage/test/entity/agent-history-fixtures.js";
import { entityInput as supportAgentInput } from "../../storage/test/entity/agent-live-fixtures.js";
import { eventHistorySpec, stateHistorySpec } from "../../storage/src/internal/entity-history.js";
import type {
  SupportReplyAgentId,
  SupportReplyAgentState,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
// prettier-ignore
import {
  SupportReplyAgentIdSchema,
  SupportReplyAgentStateSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";

import {
  MysqlStorageFactory,
  type CreateOperationFactory,
  type MysqlStorageFactoryBuilder,
  type MysqlTableSpec,
} from "../src/index.js";
import { MysqlRecordStorage } from "../src/mysql/record-storage.js";
import { AgentHistoryIndexes } from "../src/mysql/agent-history.js";
// prettier-ignore
import {
  SupportReplyDraftedSchema,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_events_pb.js";

vi.mock("mysql2/promise", () => ({ createPool: vi.fn() }));

describe("MysqlStorageFactory builder contract", () => {
  beforeEach(() => {
    vi.mocked(createPool).mockReset();
  });
  it("checks Agent families without DDL and leaves a missing audit column retryable", async () => {
    let repaired = false;
    const query = vi.fn((sql: string, values: readonly unknown[] = []) => {
      if (!sql.trimStart().startsWith("SELECT"))
        throw new Error(`Read-only Agent preparation attempted mutation: ${sql}`);
      return agentMetadataQuery(sql, values, repaired);
    });
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(mysqlConnection(query))),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/agent_check" })
      .build();
    const layout = supportAgentInput() as unknown as EntityStorageInput<
      SupportReplyAgentId,
      SupportReplyAgentState
    >;
    const preparation = StoragePreparations.for(factory);
    try {
      await expect(preparation.prepareAgentCommit(layout, "check")).rejects.toMatchObject({
        cause: { message: "MySQL table agent_history_AgentHistoryRecord lacks state_type." },
      });
      const auditColumns = () =>
        query.mock.calls.filter(
          ([sql, values]) =>
            sql.includes("information_schema.columns") &&
            typeof values?.[0] === "string" &&
            values[0].includes("agent_history"),
        ).length;
      const inspectionsBeforeRepair = auditColumns();
      expect(inspectionsBeforeRepair).toBeGreaterThan(0);
      expect(query.mock.calls.every(([sql]) => sql.trimStart().startsWith("SELECT"))).toBe(true);
      repaired = true;
      await preparation.prepareAgentCommit(layout, "check");
      expect(auditColumns()).toBeGreaterThan(inspectionsBeforeRepair);
      expect(query.mock.calls.every(([sql]) => sql.trimStart().startsWith("SELECT"))).toBe(true);
    } finally {
      await factory.close();
    }
  });
  it("rolls back stale Agent admission and optional writes after a late audit failure", async () => {
    const rows = new Map<string, Uint8Array>();
    let staged: Map<string, Uint8Array> | undefined;
    let failAuditWrite = false;
    const query = vi.fn((sql: string, values: readonly unknown[] = []) =>
      agentMetadataQuery(sql, values, true),
    );
    const execute = vi.fn((sql: string, values: readonly unknown[] = []) => {
      const table = /(?:FROM|INTO) `([^`]+)`/u.exec(sql)?.[1];
      if (table === undefined) throw new Error(`Agent SQL lacks a table: ${sql}`);
      const key = `${table}/${String(values[0])}`;
      if (sql.startsWith("SELECT")) {
        const bytes = (staged ?? rows).get(key);
        return Promise.resolve([bytes === undefined ? [] : [{ bytes }], []]);
      }
      if (sql.startsWith("INSERT") && values[1] instanceof Uint8Array) {
        if (failAuditWrite && table.includes("agent_history"))
          throw new Error("late Agent audit write failed");
        (staged ?? rows).set(key, values[1]);
        return Promise.resolve([{ affectedRows: 1 }, []]);
      }
      throw new Error(`Unexpected Agent SQL: ${sql}`);
    });
    const rollback = vi.fn(() => {
      staged = undefined;
      return Promise.resolve();
    });
    const connection = {
      query,
      execute,
      beginTransaction: () => {
        if (staged !== undefined) throw new Error("Prior Agent transaction was not rolled back.");
        staged = new Map(rows);
        return Promise.resolve();
      },
      commit: () => {
        if (staged !== undefined) {
          rows.clear();
          for (const [key, value] of staged) rows.set(key, value);
          staged = undefined;
        }
        return Promise.resolve();
      },
      rollback,
      release: vi.fn(),
    };
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(connection)),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(new TypeRegistry([SupportReplyAgentIdSchema]));
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/agent_transaction" })
      .setStringifierRegistry(stringifiers)
      .build();
    const layout = {
      ...supportAgentInput(),
      stateHistory: true,
      eventHistory: true,
    } as unknown as EntityStorageInput<SupportReplyAgentId, SupportReplyAgentState>;
    const commits = EntityCommitStorageFactories.create(factory, layout);
    const id = create(SupportReplyAgentIdSchema, { ticketNumber: "T-stale" });
    const input = {
      entityId: id,
      expectedVersion: 1,
      expectedPreferences: undefined,
      preferences: [],
      historyEntries: [conversation("stale", "support", create(TimestampSchema, { seconds: 1n }))],
    };
    try {
      await expect(commits.commitAgent(input)).rejects.toThrow("Version");
      expect(execute.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(true);
      expect(rollback).toHaveBeenCalledTimes(1);
      expect(rows.size).toBe(0);
      await commits.commitAgent({ ...input, expectedVersion: 0 });
      expect(rows.size).toBe(2);
      expect([...rows.keys()].some((key) => key.includes("agent_history"))).toBe(true);
      expect([...rows.keys()].some((key) => key.includes("agent_model"))).toBe(true);
      const auditBytes = [...rows].find(([key]) => key.includes("agent_history"))?.[1];
      const preferenceBytes = [...rows].find(([key]) => key.includes("agent_model"))?.[1];
      expect(auditBytes).toBeInstanceOf(Uint8Array);
      expect(preferenceBytes).toBeInstanceOf(Uint8Array);
      if (!(auditBytes instanceof Uint8Array) || !(preferenceBytes instanceof Uint8Array))
        throw new Error("The retry did not persist both Agent records.");
      expect(fromBinary(AgentHistoryRecordSchema, auditBytes).entry).toEqual(
        input.historyEntries[0],
      );
      expect(fromBinary(AgentModelPreferencesRecordSchema, preferenceBytes).key?.stateType).toBe(
        layout.stateSchema.typeName,
      );
      const before = new Map(rows);
      const next = create(EntityRecordSchema, {
        entityId: layout.id.pack(id),
        state: AnyPacker.pack(
          layout.stateSchema,
          create(layout.stateSchema, { id, proposedReply: "ready" }),
        ),
        version: { number: 1 },
      });
      const finalInput = {
        ...input,
        expectedVersion: 0,
        expectedPreferences: [],
        entityCommit: {
          context: layout.context,
          entity: layout,
          entityId: id,
          next,
          states: [next],
          diagnostics: [supportDraftedEvent("diagnostic", id, "diagnostic", 1)],
          events: [supportDraftedEvent("delivery", id, "delivery", 1)],
        },
        historyEntries: [
          conversation("final", "support", create(TimestampSchema, { seconds: 2n })),
        ],
      };
      failAuditWrite = true;
      const attemptedBefore = execute.mock.calls.length;
      await expect(commits.commitAgent(finalInput)).rejects.toThrow(
        "late Agent audit write failed",
      );
      const attemptedInserts = execute.mock.calls
        .slice(attemptedBefore)
        .map(([sql]) => sql)
        .filter((sql) => sql.startsWith("INSERT"));
      expect(attemptedInserts.some((sql) => sql.includes("_EntityRecord"))).toBe(true);
      expect(attemptedInserts.filter((sql) => sql.includes("_Event"))).toHaveLength(2);
      expect(rows).toEqual(before);
      expect(rollback).toHaveBeenCalledTimes(2);
      failAuditWrite = false;
      const currentTable = layout.stateSchema.typeName.replaceAll(".", "_");
      await commits.commitAgent(finalInput);
      const currentBytes = [...rows].find(([key]) => key.startsWith(`${currentTable}/`))?.[1];
      const stateHistoryBytes = [...rows].find(([key]) =>
        key.split("/")[0]?.endsWith("_EntityRecord"),
      )?.[1];
      const diagnosticBytes = [...rows].find(
        ([key, bytes]) =>
          key.split("/")[0]?.endsWith("_Event") &&
          fromBinary(EventSchema, bytes).id?.value === "diagnostic",
      )?.[1];
      expect(currentBytes).toBeInstanceOf(Uint8Array);
      expect(stateHistoryBytes).toBeInstanceOf(Uint8Array);
      expect(diagnosticBytes).toBeInstanceOf(Uint8Array);
      if (!(currentBytes instanceof Uint8Array)) throw new Error("The Agent state was not stored.");
      expect(fromBinary(EntityRecordSchema, currentBytes)).toEqual(next);
      expect(stateHistoryBytes).toEqual(toBinary(EntityRecordSchema, next));
      const expectedDiagnostic = finalInput.entityCommit.diagnostics[0];
      if (expectedDiagnostic === undefined) throw new Error("The diagnostic Event is missing.");
      expect(diagnosticBytes).toEqual(toBinary(EventSchema, expectedDiagnostic));
      expect(rows.size).toBeGreaterThan(before.size);
    } finally {
      await commits.close();
      await factory.close();
    }
  });
  it("checks a declared family without opening Storage, then reuses readiness without DDL", async () => {
    const query = vi.fn(mysqlQuery);
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() =>
        Promise.resolve({ query, execute: vi.fn(() => [[], []]), release: vi.fn() }),
      ),
      end,
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/prepared" })
      .build();
    const extractId = vi.fn((record: import("@bufbuild/protobuf/wkt").StringValue) => record.value);
    const spec = new RecordSpec({ recordType: StringValueSchema, idKind: "string", extractId });
    await StoragePreparations.for(factory).prepareRecord(
      { name: "records", multitenant: false },
      spec,
      undefined,
      "check",
    );
    expect(extractId).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.map(([sql]) => sql)).not.toContainEqual(
      expect.stringContaining("CREATE"),
    );
    const records = factory.createRecordStorage({ name: "records", multitenant: false }, spec);
    await records.read("absent");
    expect(query.mock.calls.map(([sql]) => sql)).not.toContainEqual(
      expect.stringContaining("CREATE"),
    );
    records.close();
    await factory.close();
  });

  it("does not escalate a pending read-only check and retries its missing table later", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let missing = true;
    const sql: string[] = [];
    const query = vi.fn(async (statement: string) => {
      sql.push(statement);
      if (statement.includes("information_schema.columns") && missing) {
        entered.resolve(undefined);
        await release.promise;
        return [[], []];
      }
      return mysqlQuery(statement);
    });
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockImplementation(
      () =>
        ({
          getConnection: vi.fn(() => Promise.resolve({ query, release: vi.fn() })),
          end,
        }) as never,
    );
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/prepared" })
      .build();
    const preparation = StoragePreparations.for(factory);
    const context = { name: "pending", multitenant: false } as const;
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const checking = preparation.prepareRecord(context, spec, undefined, "check");
    await entered.promise;
    const creating = preparation.prepareRecord(context, spec, undefined, "create");
    release.resolve(undefined);
    await expect(checking).rejects.toMatchObject({
      cause: { message: "MySQL table google_protobuf_StringValue lacks ID." },
    });
    await expect(creating).rejects.toThrow(/schema is incompatible/i);
    expect(sql.some((statement) => statement.includes("CREATE"))).toBe(false);
    missing = false;
    await preparation.prepareRecord(context, spec, undefined, "create");
    expect(sql.filter((statement) => statement.includes("CREATE"))).toHaveLength(1);
    expect(end).toHaveBeenCalledTimes(3);
    await factory.close();
  });

  it("drains admitted physical preparation before factory cleanup", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const end = vi.fn(() => Promise.resolve());
    const query = vi.fn(async (statement: string) => {
      if (statement.includes("information_schema.columns")) {
        entered.resolve(undefined);
        await release.promise;
      }
      return mysqlQuery(statement);
    });
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ query, release: vi.fn() })),
      end,
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/prepared" })
      .build();
    const preparation = StoragePreparations.for(factory);
    const context = { name: "pending", multitenant: false } as const;
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const pending = preparation.prepareRecord(context, spec, undefined, "check");
    await entered.promise;
    const closing = factory.close();
    await expect(preparation.prepareRecord(context, spec, undefined, "check")).rejects.toThrow(
      /closed/i,
    );
    expect(end).toHaveBeenCalledOnce();
    release.resolve(undefined);
    await pending;
    await closing;
    expect(end).toHaveBeenCalledTimes(2);
  });

  it("reuses equivalent reordered Task columns and rejects a conflicting declaration", async () => {
    const query = vi.fn((statement: string) => {
      if (statement.includes("information_schema.columns"))
        return Promise.resolve([
          [
            { column_name: "ID", column_type: "varchar(512)", is_nullable: "NO" },
            { column_name: "bytes", column_type: "blob", is_nullable: "NO" },
            { column_name: "title", column_type: "text", is_nullable: "YES" },
            { column_name: "completed", column_type: "tinyint(1)", is_nullable: "YES" },
          ],
          [],
        ]);
      return mysqlQuery(statement);
    });
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ query, release: vi.fn() })),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/prepared" })
      .build();
    const context = { name: "task", multitenant: false } as const;
    const title = new RecordColumn(
      "title",
      ColumnTypes.scalar(ScalarType.STRING),
      (task: Task) => task.title,
    );
    const completed = new RecordColumn(
      "completed",
      ColumnTypes.scalar(ScalarType.BOOL),
      (task: Task) => task.completed,
    );
    const spec = (columns: readonly RecordColumn<Task>[]) =>
      new RecordSpec({
        recordType: TaskSchema,
        idSchema: TaskIdSchema,
        extractId: (task: Task) => {
          if (task.id === undefined) throw new Error("Task ID is required.");
          return task.id;
        },
        columns,
      });
    const preparation = StoragePreparations.for(factory);
    await preparation.prepareRecord(context, spec([title, completed]), undefined, "check");
    await preparation.prepareRecord(context, spec([completed, title]), undefined, "create");
    await expect(
      preparation.prepareRecord(context, spec([title]), undefined, "create"),
    ).rejects.toThrow(/conflicts/i);
    expect(query.mock.calls.some(([statement]) => statement.includes("CREATE"))).toBe(false);
    await factory.close();
  });

  it("releases a temporary pool for each tenant without binding runtime pools", async () => {
    const ends: ReturnType<typeof vi.fn>[] = [];
    vi.mocked(createPool).mockImplementation(() => {
      const end = vi.fn(() => Promise.resolve());
      ends.push(end);
      return {
        getConnection: vi.fn(() =>
          Promise.resolve({
            query: vi.fn(mysqlQuery),
            release: vi.fn(),
          }),
        ),
        end,
      } as never;
    });
    const tenantA = tenant("prepared-a");
    const tenantB = tenant("prepared-b");
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/shared" })
      .setTenantOptions([
        { tenantId: tenantA, options: { url: "mysql://db.example/tenant_a" } },
        { tenantId: tenantB, options: { url: "mysql://db.example/tenant_b" } },
      ])
      .build();
    const preparation = StoragePreparations.for(factory);
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (value) => value.value,
    });
    await Promise.all(
      [tenantA, tenantB].map((tenantId) =>
        preparation.prepareRecord(
          { name: "audit", multitenant: true, tenantId },
          spec,
          undefined,
          "check",
        ),
      ),
    );
    expect(createPool).toHaveBeenCalledTimes(4);
    expect(ends).toHaveLength(4);
    for (const end of ends) expect(end).toHaveBeenCalledOnce();
    await factory.close();
    for (const end of ends) expect(end).toHaveBeenCalledOnce();
  });

  it("does not cache a physical proof when temporary pool cleanup fails", async () => {
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary cleanup failed"))
      .mockResolvedValue(undefined);
    vi.mocked(createPool).mockImplementation(
      () =>
        ({
          getConnection: vi.fn(() =>
            Promise.resolve({ query: vi.fn(mysqlQuery), release: vi.fn() }),
          ),
          end: cleanup,
        }) as never,
    );
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/prepared" })
      .build();
    const preparation = StoragePreparations.for(factory);
    const context = { name: "prepared", multitenant: false } as const;
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (value) => value.value,
    });
    await expect(preparation.prepareRecord(context, spec, undefined, "check")).rejects.toThrow(
      /pool cleanup/i,
    );
    await preparation.prepareRecord(context, spec, undefined, "check");
    expect(cleanup).toHaveBeenCalledTimes(3);
    await factory.close();
  });

  it("shares one deferred tenant destination across different preparation families and runtime use", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<{ url: string }>();
    const resolver = vi.fn(() => {
      entered.resolve(undefined);
      return release.promise;
    });
    const selected: string[] = [];
    vi.mocked(createPool).mockImplementation((options) => {
      selected.push(String((options as { database?: string }).database));
      return {
        getConnection: vi.fn(() => Promise.resolve(mysqlConnection(vi.fn(mysqlQuery)))),
        end: vi.fn(() => Promise.resolve()),
      } as never;
    });
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/shared" })
      .setTenantResolver(resolver)
      .build();
    const context = { name: "prepared", multitenant: true, tenantId: tenant("deferred") } as const;
    const first = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (value) => value.value,
    });
    const second = new RecordSpec({
      recordType: TimestampSchema,
      idKind: "string",
      extractId: (value) => String(value.seconds),
    });
    const preparation = StoragePreparations.for(factory);
    const a = preparation.prepareRecord(context, first, undefined, "check");
    const b = preparation.prepareRecord(context, second, undefined, "check");
    const records = factory.createRecordStorage(context, first);
    const reading = records.read("missing");
    await entered.promise;
    expect(resolver).toHaveBeenCalledOnce();
    release.resolve({ url: "mysql://db.example/tenant_deferred" });
    await Promise.all([a, b, reading]);
    expect(resolver).toHaveBeenCalledOnce();
    expect(selected.every((database) => database === "tenant_deferred")).toBe(true);
    records.close();
    await factory.close();
  });
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

  it("builds offline and checks the shared destination without retaining its probe pool", async () => {
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
    expect(createPool).not.toHaveBeenCalled();
    await factory.checkConnection();
    await factory.close();
    await factory.close();
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

  it("resolves a dynamic tenant once for concurrent first use, then keeps its destination", async () => {
    const resolver = vi.fn(() => Promise.resolve({ url: "mysql://db.example/resolved" }));
    const query = vi.fn(mysqlQuery);
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(mysqlConnection(query))),
      end,
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/shared" })
      .setTenantResolver(resolver)
      .build();
    const identity = tenant("dynamic");
    await expect(factory.tenantCatalog().contains(TenantBoundary.from(identity))).resolves.toBe(
      false,
    );
    await expect(factory.tenantCatalog().keep(TenantBoundary.from(identity))).rejects.toThrow(
      /no configured tenant/,
    );
    const context = { name: "dynamic", multitenant: true, tenantId: identity } as const;
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const first = factory.createRecordStorage(context, spec);
    const second = factory.createRecordStorage(context, spec);
    expect(resolver).not.toHaveBeenCalled();
    expect(createPool).not.toHaveBeenCalled();
    await Promise.all([
      first.write(create(StringValueSchema, { value: "one" })),
      second.write(create(StringValueSchema, { value: "two" })),
    ]);
    expect(resolver).toHaveBeenCalledOnce();
    expect(createPool).toHaveBeenCalledOnce();
    await first.read("one");
    expect(resolver).toHaveBeenCalledOnce();
    first.close();
    second.close();
    await factory.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it("retries a failed dynamic tenant lookup without querying it in shared connection checks", async () => {
    const resolver = vi
      .fn()
      .mockRejectedValueOnce(new Error("directory unavailable"))
      .mockResolvedValue({ url: "mysql://db.example/retry" });
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(mysqlConnection(vi.fn(mysqlQuery)))),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/shared" })
      .setTenantResolver(resolver)
      .build();
    await factory.checkConnection();
    expect(resolver).not.toHaveBeenCalled();
    const context = { name: "retry", multitenant: true, tenantId: tenant("retry") } as const;
    const records = factory.createRecordStorage(
      context,
      new RecordSpec({
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    await expect(records.read("one")).rejects.toThrow();
    await expect(records.read("one")).resolves.toBeUndefined();
    expect(resolver).toHaveBeenCalledTimes(2);
    records.close();
    await factory.close();
  });

  it("rejects shared and tenant access to one physical table in a shared database", async () => {
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve(mysqlConnection(vi.fn(mysqlQuery)))),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/shared" })
      .setTenantOptions([
        { tenantId: tenant("one"), options: { url: "mysql://db.example/shared" } },
      ])
      .build();
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const shared = factory.createRecordStorage({ name: "shared", multitenant: false }, spec);
    const selected = factory.createRecordStorage(
      {
        name: "tenant",
        multitenant: true,
        tenantId: tenant("one"),
      },
      spec,
    );
    await shared.read("one");
    await expect(selected.read("one")).rejects.toThrow(/tables collide/i);
    shared.close();
    selected.close();
    await factory.close();
  });

  it("drains an admitted two-record batch while fencing new public record calls", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let writes = 0;
    const query = vi.fn(mysqlQuery);
    const execute = vi.fn(async () => {
      writes += 1;
      if (writes === 1) {
        entered.resolve(undefined);
        await release.promise;
      }
      return [{ affectedRows: 1 }, []];
    });
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ query, execute, release: vi.fn() })),
      end,
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/batch" })
      .build();
    const records = factory.createRecordStorage(
      { name: "batch", multitenant: false },
      new RecordSpec({
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => record.value,
      }),
    );
    const batch = records.writeAll([
      create(StringValueSchema, { value: "one" }),
      create(StringValueSchema, { value: "two" }),
    ]);
    await entered.promise;
    const closing = factory.close();
    await expect(records.write(create(StringValueSchema, { value: "late" }))).rejects.toThrow(
      /closed/i,
    );
    expect(end).not.toHaveBeenCalled();
    release.resolve(undefined);
    await batch;
    await closing;
    expect(writes).toBe(2);
    expect(end).toHaveBeenCalledOnce();
  });

  it("drains current and state-history writes admitted before Entity close", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let writes = 0;
    const write = vi.spyOn(MysqlRecordStorage.prototype, "write").mockImplementation(async () => {
      writes += 1;
      entered.resolve(undefined);
      await release.promise;
    });
    const history = vi
      .spyOn(MysqlRecordStorage.prototype, "writeImmutable")
      .mockImplementation(async () => {
        writes += 1;
        await release.promise;
      });
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/entity" })
      .build();
    const internal = factory as unknown as {
      createEntityStorage(input: ReturnType<typeof entityInput>): {
        current: {
          write(record: ReturnType<typeof create<typeof EntityRecordSchema>>): Promise<void>;
        };
        states: {
          append(record: ReturnType<typeof create<typeof EntityRecordSchema>>): Promise<void>;
        };
      };
    };
    try {
      const storage = internal.createEntityStorage(
        entityInput({ name: "tasks", multitenant: false }),
      );
      const taskId = create(TaskIdSchema, { value: "entity-1" });
      const record = create(EntityRecordSchema, {
        entityId: Identifiers.pack(TaskIdSchema, taskId),
        state: AnyPacker.pack(
          TaskSchema,
          create(TaskSchema, {
            id: taskId,
            title: "Entity",
            taskListId: create(TaskListIdSchema, { value: "list-1" }),
          }),
        ),
      });
      const current = storage.current.write(record);
      const state = storage.states.append(record);
      await entered.promise;
      const closing = factory.close();
      await expect(storage.current.write(record)).rejects.toThrow(/closed/i);
      await expect(storage.states.append(record)).rejects.toThrow(/closed/i);
      release.resolve(undefined);
      await Promise.all([current, state, closing]);
      expect(writes).toBe(2);
    } finally {
      release.resolve(undefined);
      write.mockRestore();
      history.mockRestore();
      await factory.close();
    }
  });

  it("admits a batch before its ID callback closes the factory", async () => {
    const execute = vi.fn(() => Promise.resolve([{ affectedRows: 1 }, []]));
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() =>
        Promise.resolve({
          query: vi.fn(mysqlQuery),
          execute,
          release: vi.fn(),
        }),
      ),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/callback" })
      .build();
    let closing: Promise<void> | undefined;
    const records = factory.createRecordStorage(
      { name: "callback", multitenant: false },
      new RecordSpec({
        recordType: StringValueSchema,
        idKind: "string",
        extractId: (record) => {
          closing ??= factory.close();
          return record.value;
        },
      }),
    );
    await expect(
      records.writeAll([create(StringValueSchema, { value: "first" })]),
    ).resolves.toBeUndefined();
    await closing;
    expect(execute).toHaveBeenCalledOnce();
  });

  it("retains shared probe and temporary-pool cleanup failures", async () => {
    const endFailure = new Error("pool disposal failed");
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.reject(new Error("connection refused"))),
      end: vi.fn(() => Promise.reject(endFailure)),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/probe" })
      .build();
    const error = await factory.checkConnection().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "Unable to connect to MySQL." }),
      endFailure,
    ]);
    await factory.close();
  });

  it("fences escaped Agent history calls when the factory closes", async () => {
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/agent" })
      .build();
    const history = AgentHistoryStorageFactories.create(factory, scope);
    expect(createPool).not.toHaveBeenCalled();
    await factory.close();
    await expect(
      history.read({ entityId: "agent-1", view: { kind: "full" }, count: 1, maxBytes: 1024 }),
    ).rejects.toThrow(/closed/i);
    expect(createPool).not.toHaveBeenCalled();
  });

  it("sanitizes connection failures and closes the failed pool", async () => {
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.reject(new Error("credential leak"))),
      end,
    } as never);

    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/database" })
      .build();
    await expect(factory.checkConnection()).rejects.toThrow("Unable to connect to MySQL.");
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
    await factory.checkConnection();
    await factory.close();
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
    await factory.close();
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
      .setOptions({ url: "mysql://db.example/shared" })
      .setTenantOptions([
        { tenantId: tenantOne, options: { url: "mysql://db.example/tenant_one" } },
        { tenantId: tenantTwo, options: { url: "mysql://db.example/tenant_two" } },
      ])
      .build();

    await expect(factory.tenantCatalog().all()).resolves.toEqual([
      expect.objectContaining({ single: false, tenantId: tenantOne }),
      expect.objectContaining({ single: false, tenantId: tenantTwo }),
    ]);
    const catalog = factory.tenantCatalog();
    await expect(catalog.contains(TenantBoundary.from(tenantOne))).resolves.toBe(true);
    await expect(
      catalog.contains(
        TenantBoundary.from(create(TenantIdSchema, { kind: { case: "value", value: "missing" } })),
      ),
    ).resolves.toBe(false);
    const signal = new AbortController().signal;
    const firstPage = await catalog.page({ count: 1, signal });
    expect(firstPage.boundaries).toHaveLength(1);
    if (firstPage.after === undefined) throw new Error("Expected MySQL catalog cursor.");
    await expect(
      catalog.page({
        count: 1,
        signal,
        after: {
          [Symbol.toStringTag]: "TenantCatalogCursor",
        },
      }),
    ).rejects.toThrow(/continuation/);
    const constructed = Reflect.construct(firstPage.after.constructor, [
      catalog,
      1,
      2,
    ]) as typeof firstPage.after;
    await expect(catalog.page({ count: 1, signal, after: constructed })).rejects.toThrow();
    const finalPage = await catalog.page({ count: 1, signal, after: firstPage.after });
    expect(finalPage.boundaries).toHaveLength(1);
    expect(finalPage.hasMore).toBe(false);
    await expect(catalog.page({ count: 129, signal })).resolves.toMatchObject({ hasMore: false });
    await expect(catalog.page({ count: 0, signal })).rejects.toThrow(/count/);
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
    await factory.close();
    await Promise.resolve();
    expect(firstEnd).toHaveBeenCalledOnce();
    expect(secondEnd).toHaveBeenCalledOnce();
  });

  it("keeps a successful tenant usable when another first-use connection fails", async () => {
    const firstEnd = vi.fn(() => Promise.resolve());
    const secondEnd = vi.fn(() => Promise.resolve());
    vi.mocked(createPool)
      .mockReturnValueOnce({
        getConnection: vi.fn(() => Promise.resolve(mysqlConnection(vi.fn(mysqlQuery)))),
        end: firstEnd,
      } as never)
      .mockReturnValueOnce({
        getConnection: vi.fn(() => Promise.reject(new Error("credential leak"))),
        end: secondEnd,
      } as never);

    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/shared" })
      .setTenantOptions([
        { tenantId: tenant("one"), options: { url: "mysql://db.example/one" } },
        { tenantId: tenant("two"), options: { url: "mysql://db.example/two" } },
      ])
      .build();
    const spec = new RecordSpec({
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const first = factory.createRecordStorage(
      { name: "first", multitenant: true, tenantId: tenant("one") },
      spec,
    );
    const second = factory.createRecordStorage(
      { name: "second", multitenant: true, tenantId: tenant("two") },
      spec,
    );
    await first.write(create(StringValueSchema, { value: "one" }));
    await expect(second.write(create(StringValueSchema, { value: "two" }))).rejects.toThrow(
      "Unable to connect to MySQL.",
    );
    expect(firstEnd).not.toHaveBeenCalled();
    expect(secondEnd).toHaveBeenCalledOnce();
    first.close();
    second.close();
    await factory.close();
    expect(firstEnd).toHaveBeenCalledOnce();
  });

  it("checks connection without scanning unrelated retired-layout columns", async () => {
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

    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/legacy" })
      .build();
    await expect(factory.checkConnection()).resolves.toBeUndefined();

    expect(release).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(query.mock.calls.some(([sql]) => sql.includes("information_schema"))).toBe(false);
    await factory.close();
  });

  it("rejects duplicate tenants and physical targets while allowing shared plus tenant settings", async () => {
    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "one" } });
    const other = create(TenantIdSchema, { kind: { case: "value", value: "two" } });

    await expect(
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: "mysql://db.example/shared" })
        .setTenantOptions([
          { tenantId: tenant, options: { url: "mysql://db.example/one" } },
          { tenantId: tenant, options: { url: "mysql://db.example/two" } },
        ])
        .build(),
    ).rejects.toThrow(/duplicate tenant/i);
    await expect(
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: "mysql://db.example/shared-other" })
        .setTenantOptions([
          { tenantId: tenant, options: { url: "mysql://db.example/shared" } },
          { tenantId: other, options: { url: "mysql://DB.EXAMPLE:3306/shared" } },
        ])
        .build(),
    ).rejects.toThrow(/physical database/i);
    await expect(
      MysqlStorageFactory.newBuilder()
        .setOptions({ url: "mysql://db.example/shared-other" })
        .setTenantOptions([
          { tenantId: tenant, options: { url: "mysql://db.example/Shared" } },
          { tenantId: other, options: { url: "mysql://db.example/shared" } },
        ])
        .build(),
    ).rejects.toThrow(/physical database/i);
    const combined = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/single" })
      .setTenantOptions([{ tenantId: tenant, options: { url: "mysql://db.example/tenant" } }])
      .build();
    await combined.close();
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
    const taskId = create(TaskIdSchema, { value: "entity" });
    const mutation = {
      context: entity.context,
      entity,
      entityId: taskId,
      next: create(EntityRecordSchema, {
        entityId: Identifiers.pack(TaskIdSchema, taskId),
        state: Identifiers.pack(
          TaskSchema,
          create(TaskSchema, {
            id: taskId,
            title: "Task",
            taskListId: create(TaskListIdSchema, { value: "list-1" }),
          }),
        ),
      }),
    };
    const closed = EntityCommitStorageFactories.create(factory, entity);
    await closed.close();
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
    await commits.close();

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
    await disabled.close();

    const missingId = EntityCommitStorageFactories.create(factory, entity);
    await expect(missingId.commit({ ...mutation, events: [create(EventSchema)] })).rejects.toThrow(
      /requires non-blank unique delivery event IDs/i,
    );
    await missingId.close();
    await factory.close();
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
    await factory.close();
  });
});

function entityInput(context: StorageContext, stateHistory = true, eventHistory = true) {
  const recordSpec = new RecordSpec({
    sourceType: TaskSchema,
    recordType: EntityRecordSchema,
    idSchema: TaskIdSchema,
    extractId: (record) => {
      if (record.entityId === undefined) throw new Error("Task Entity ID is required.");
      return AnyPacker.unpack(record.entityId, TaskIdSchema);
    },
  });
  return {
    context,
    id: {
      clone: (id: ReturnType<typeof create<typeof TaskIdSchema>>) => create(TaskIdSchema, id),
      key: (id: ReturnType<typeof create<typeof TaskIdSchema>>) => id.value,
      pack: (id: ReturnType<typeof create<typeof TaskIdSchema>>) =>
        Identifiers.pack(TaskIdSchema, id),
      unpack: (packed: ReturnType<typeof create<typeof AnySchema>>) =>
        AnyPacker.tryUnpack(packed, TaskIdSchema),
    },
    columns: [],
    recordSpec,
    sourceType: TaskSchema,
    stateSchema: TaskSchema,
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

function agentMetadataQuery(sql: string, values: readonly unknown[], repaired: boolean) {
  const table = values[0];
  if (repaired && sql.includes("information_schema.columns") && typeof table === "string") {
    const extra = table.includes("agent_history")
      ? AgentHistoryRecords.spec((value) => value).columns
      : table.endsWith("_EntityRecord")
        ? stateHistorySpec(SupportReplyAgentStateSchema).spec.columns
        : table.endsWith("_Event")
          ? table.startsWith("es_")
            ? eventStoreRecordSpec.columns
            : eventHistorySpec(SupportReplyAgentStateSchema).spec.columns
          : [];
    if (extra.length)
      return Promise.resolve([
        [
          { column_name: "ID" },
          { column_name: "bytes" },
          ...extra.map((column) => ({ column_name: column.name })),
        ],
        [],
      ]);
  }
  if (repaired && sql.includes("AND index_name=?")) {
    const columns = AgentHistoryIndexes.find(([name]) => name === values[1])?.[1] ?? [];
    return Promise.resolve([
      columns.map((column_name, index) => ({
        index_name: values[1],
        column_name,
        seq_in_index: index + 1,
        non_unique: 1,
        sub_part: null,
        collation: "A",
        index_type: "BTREE",
      })),
      [],
    ]);
  }
  if (repaired && sql.includes("table_name IN (?)"))
    return Promise.resolve([(values[0] as string[]).map(() => ({ engine: "InnoDB" })), []]);
  return mysqlQuery(sql);
}

function supportDraftedEvent(
  id: string,
  agent: SupportReplyAgentId,
  reply: string,
  version: number,
) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: AnyPacker.pack(
      SupportReplyDraftedSchema,
      create(SupportReplyDraftedSchema, { agent, reply }),
    ),
    context: {
      producerId: AnyPacker.pack(SupportReplyAgentIdSchema, agent),
      version: { number: version },
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
    },
  });
}

function userStringifier(prefix: string) {
  return {
    toString: (value: import("@spine-event-engine/proto").UserId) => `${prefix}${value.value}`,
    fromString: (value: string) => create(UserIdSchema, { value: value.slice(prefix.length) }),
  };
}
