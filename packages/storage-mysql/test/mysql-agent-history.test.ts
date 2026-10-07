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

import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { create, toBinary } from "@bufbuild/protobuf";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import { describe, expect, it } from "vitest";
import {
  AgentHistoryConformance,
  AgentHistoryKeys,
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
import { MysqlStorageFactory } from "../src/index.js";
import { AgentHistoryHash } from "../src/mysql/agent-history.js";
import { AgentHistoryIndexBytes } from "../src/mysql/table-spec.js";

const url = process.env.SPINE_TS_MYSQL_URL;
const tenantAUrl = process.env.SPINE_TS_MYSQL_TENANT_A_URL;
const tenantBUrl = process.env.SPINE_TS_MYSQL_TENANT_B_URL;

function required(value: string | undefined): string {
  if (value === undefined) throw new Error("Agent history provider test URL is required.");
  return value;
}

describe.runIf(url !== undefined)("MySQL Agent history", () => {
  it("rejects creation of an Agent history handle after factory closure", async () => {
    const factory = await MysqlStorageFactory.newBuilder()
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
      const factory = await MysqlStorageFactory.newBuilder()
        .setOptions({ url: required(url) })
        .build();
      const tenants = await MysqlStorageFactory.newBuilder()
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
    const table = `agent_history_${randomUUID().replaceAll("-", "")}`;
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: required(url) })
      .setTableName(AgentHistoryEntrySchema, AgentHistoryRecordSchema, table)
      .build();
    const run = randomUUID();
    const input = { ...scope, id: { key: (id: string) => `${run}:${id}` } };
    const entry = event("reopen-mysql", occurredAt(1_789_000_001n, 123_456_789), false);
    const first = AgentHistoryStorageFactories.create(factory, input);
    await first.append("ticket-mysql", entry);
    first.close();
    factory.close();
    const reopened = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: required(url) })
      .setTableName(AgentHistoryEntrySchema, AgentHistoryRecordSchema, table)
      .build();
    const pool = createPool(required(url));
    try {
      const history = AgentHistoryStorageFactories.create(reopened, input);
      const page = await history.read({
        entityId: "ticket-mysql",
        view: { kind: "full" },
        count: 1,
        maxBytes: 10000,
      });
      expect(page.entries.map((value) => toBinary(AgentHistoryEntrySchema, value))).toEqual([
        toBinary(AgentHistoryEntrySchema, entry),
      ]);
      const [indexes] = await pool.query(
        "SELECT index_name AS indexname, column_name AS columnname, " +
          "sub_part AS prefix_length FROM information_schema.statistics " +
          "WHERE table_schema=DATABASE() AND table_name=? AND index_name IN " +
          "('agent_history_full','agent_history_category','agent_history_conversation') " +
          "ORDER BY index_name, seq_in_index",
        [table],
      );
      const rows = indexes as {
        indexname: string;
        columnname: string;
        prefix_length: number | null;
      }[];
      expect(rows.every((row) => row.prefix_length === null)).toBe(true);
      const columns = Object.fromEntries(
        [...new Set(rows.map((row) => row.indexname))].map((name) => [
          name,
          rows.filter((row) => row.indexname === name).map((row) => row.columnname),
        ]),
      );
      expect(columns).toEqual({
        agent_history_full: ["scope_digest", "order_key"],
        agent_history_category: ["scope_digest", "category", "order_key"],
        agent_history_conversation: ["scope_digest", "conversation_digest", "order_key"],
      });
      history.close();
    } finally {
      reopened.close();
      await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
      await pool.end();
    }
  }, 120_000);

  it("rejects a pre-existing prefix index under the required name", async () => {
    const table = `agent_history_bad_${randomUUID().replaceAll("-", "")}`;
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: required(url) })
      .setTableName(AgentHistoryEntrySchema, AgentHistoryRecordSchema, table)
      .build();
    const pool = createPool(required(url));
    try {
      const records = factory.createRecordStorage(
        scope.context,
        AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value)),
        AgentHistoryRecords.group,
      );
      await records.read("absent");
      records.close();
      await pool.query(
        `CREATE INDEX \`agent_history_full\` ON \`${table}\` (\`scope_digest\`(8), \`order_key\`(8))`,
      );
      const history = AgentHistoryStorageFactories.create(factory, scope);
      await expect(
        history.read({ entityId: "ticket", view: { kind: "full" }, count: 1, maxBytes: 1000 }),
      ).rejects.toThrow("index is incompatible");
      history.close();
    } finally {
      factory.close();
      await pool.query(`DROP TABLE IF EXISTS \`${table}\``);
      await pool.end();
    }
  }, 120_000);

  it("indexes the complete largest permitted order key and rejects the next one", async () => {
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: required(url) })
      .build();
    const run = randomUUID();
    const input = { ...scope, id: { key: (id: string) => `${run}:${id}` } };
    const history = AgentHistoryStorageFactories.create(factory, input);
    const entry = event("a".repeat(1460), occurredAt(6n, 987_654_321), false);
    const tooLong = event("a".repeat(1461), occurredAt(6n, 987_654_321), false);
    try {
      expect(AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry))).toHaveLength(
        AgentHistoryIndexBytes - 1,
      );
      expect(AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(tooLong))).toHaveLength(
        AgentHistoryIndexBytes + 1,
      );
      await history.append("long-id", entry);
      await expect(history.append("long-id", tooLong)).rejects.toThrow("index capacity");
      const page = await history.read({
        entityId: "long-id",
        view: { kind: "full" },
        count: 1,
        maxBytes: 10000,
      });
      expect(page.entries.map((value) => toBinary(AgentHistoryEntrySchema, value))).toEqual([
        toBinary(AgentHistoryEntrySchema, entry),
      ]);
    } finally {
      history.close();
      factory.close();
    }
  }, 120_000);
});
