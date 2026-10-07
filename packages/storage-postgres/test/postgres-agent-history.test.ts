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

import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import { describe, expect, it } from "vitest";
import {
  AgentHistoryConformance,
  AgentHistoryStorageFactories,
} from "@spine-event-engine/storage/provider";
import { AgentHistoryRecords } from "@spine-event-engine/storage/provider";

import {
  conversation,
  response,
  event,
  occurredAt,
  scope,
} from "../../storage/test/entity/agent-history-fixtures.js";
import { PostgresStorageFactory } from "../src/index.js";
import { AgentHistoryHash } from "../src/postgres/agent-history.js";

const url = process.env.SPINE_TS_POSTGRESQL_URL;
const tenantAUrl = process.env.SPINE_TS_POSTGRESQL_TENANT_A_URL;
const tenantBUrl = process.env.SPINE_TS_POSTGRESQL_TENANT_B_URL;

function required(value: string | undefined): string {
  if (value === undefined) throw new Error("Agent history provider test URL is required.");
  return value;
}

describe.runIf(url !== undefined)("PostgreSQL Agent history", () => {
  it("rejects creation of an Agent history handle after factory closure", async () => {
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: required(url) })
      .build();
    factory.close();
    expect(() => AgentHistoryStorageFactories.create(factory, scope)).toThrow(
      "StorageFactory is closed.",
    );
  });

  it.runIf(tenantAUrl !== undefined && tenantBUrl !== undefined)(
    "passes provider conformance against persisted indexed records",
    async () => {
      const factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: required(url) })
        .build();
      const tenants = await PostgresStorageFactory.newBuilder()
        .setTenantOptions([
          {
            tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }),
            options: { url: required(tenantAUrl) },
          },
          {
            tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-b" } }),
            options: { url: required(tenantBUrl) },
          },
        ])
        .build();
      try {
        const run = randomUUID();
        await AgentHistoryConformance.check({
          scope: { ...scope, id: { key: (id) => (id.length === 0 ? "" : `${run}:${id}`) } },
          open: (input) =>
            AgentHistoryStorageFactories.create(
              input.context.multitenant ? tenants : factory,
              input,
            ),
          conversation,
          response,
          system: (id, time) => event(id, time, true),
          domain: (id, time) => event(id, time, false),
          occurredAt,
        });
      } finally {
        factory.close();
        tenants.close();
      }
    },
    120_000,
  );

  it("creates complete scoped order indexes and preserves history after reopening", async () => {
    const schema = `agent_history_${randomUUID().replaceAll("-", "")}`;
    const table = "agent_history_records";
    const pool = new Pool({ connectionString: required(url) });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: required(url), schema })
      .setTableName(AgentHistoryEntrySchema, AgentHistoryRecordSchema, table)
      .build();
    const run = randomUUID();
    const input = { ...scope, id: { key: (id: string) => `${run}:${id}` } };
    const entry = event("reopen-pg", occurredAt(1_789_000_001n, 123_456_789), false);
    const first = AgentHistoryStorageFactories.create(factory, input);
    await first.append("ticket-pg", entry);
    first.close();
    factory.close();
    const reopened = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: required(url), schema })
      .setTableName(AgentHistoryEntrySchema, AgentHistoryRecordSchema, table)
      .build();
    try {
      const history = AgentHistoryStorageFactories.create(reopened, input);
      const page = await history.read({
        entityId: "ticket-pg",
        view: { kind: "full" },
        count: 1,
        maxBytes: 10000,
      });
      expect(page.entries).toEqual([entry]);
      const indexes = await pool.query<{ indexname: string; indexdef: string }>(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 " +
          "AND indexname IN ('agent_history_full','agent_history_category'," +
          "'agent_history_conversation')",
        [schema, table],
      );
      const definitions = Object.fromEntries(
        indexes.rows.map((row) => [row.indexname, row.indexdef]),
      );
      expect(Object.keys(definitions).sort()).toEqual(
        ["agent_history_full", "agent_history_category", "agent_history_conversation"].sort(),
      );
      expect(definitions.agent_history_full).toContain('(scope_digest, order_key COLLATE "C")');
      expect(definitions.agent_history_category).toContain(
        '(scope_digest, category, order_key COLLATE "C")',
      );
      expect(definitions.agent_history_conversation).toContain(
        '(scope_digest, conversation_digest, order_key COLLATE "C")',
      );
      history.close();
    } finally {
      reopened.close();
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  }, 120_000);

  it("rejects a pre-existing same-name index with incomplete order columns", async () => {
    const schema = `agent_bad_${randomUUID().replaceAll("-", "")}`;
    const pool = new Pool({ connectionString: url });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const factory = await PostgresStorageFactory.newBuilder()
      .setOptions({ url: required(url), schema })
      .build();
    try {
      const records = factory.createRecordStorage(
        scope.context,
        AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value)),
        AgentHistoryRecords.group,
      );
      await records.read("absent");
      records.close();
      const tables = await pool.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname=$1",
        [schema],
      );
      const table = tables.rows[0]?.tablename;
      if (table === undefined) throw new Error("Expected Agent history table.");
      await pool.query(
        `CREATE INDEX "agent_history_full" ON "${schema}"."${table}" ("scope_digest")`,
      );
      const history = AgentHistoryStorageFactories.create(factory, scope);
      await expect(
        history.read({ entityId: "ticket", view: { kind: "full" }, count: 1, maxBytes: 1000 }),
      ).rejects.toThrow("PostgreSQL record operation failed");
      history.close();
    } finally {
      factory.close();
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  }, 120_000);

  it.each(["indisvalid", "indisready"])(
    "rejects a complete index whose %s catalog state is false",
    async (flag) => {
      const schema = `agent_bad_${randomUUID().replaceAll("-", "")}`;
      const pool = new Pool({ connectionString: required(url) });
      await pool.query(`CREATE SCHEMA "${schema}"`);
      const factory = await PostgresStorageFactory.newBuilder()
        .setOptions({ url: required(url), schema })
        .build();
      try {
        const records = factory.createRecordStorage(
          scope.context,
          AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value)),
          AgentHistoryRecords.group,
        );
        await records.read("absent");
        records.close();
        const tables = await pool.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname=$1",
          [schema],
        );
        const table = tables.rows[0]?.tablename;
        if (table === undefined) throw new Error("Expected Agent history table.");
        await pool.query(
          `CREATE INDEX "agent_history_full" ON "${schema}"."${table}" ` +
            '("scope_digest", "order_key" COLLATE "C")',
        );
        await pool.query(`UPDATE pg_index SET ${flag}=false WHERE indexrelid=$1::regclass`, [
          `${schema}.agent_history_full`,
        ]);
        const history = AgentHistoryStorageFactories.create(factory, scope);
        await expect(
          history.read({ entityId: "ticket", view: { kind: "full" }, count: 1, maxBytes: 1000 }),
        ).rejects.toThrow("PostgreSQL record operation failed");
        history.close();
      } finally {
        factory.close();
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        await pool.end();
      }
    },
    120_000,
  );
});
