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

import { toBinary } from "@bufbuild/protobuf";
import { ConversationIdSchema, AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import { create } from "@bufbuild/protobuf";
import type { AgentHistoryRecord } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import { AgentHistoryKeys, AgentHistoryRecords } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import {
  conversation,
  event,
  occurredAt,
  scope,
} from "../../storage/test/entity/agent-history-fixtures.js";
import { PostgresAgentHistory } from "../src/postgres/agent-history.js";

const indexes = {
  agent_history_full: 'scope_digest, order_key COLLATE "C"',
  agent_history_category: 'scope_digest, category, order_key COLLATE "C"',
  agent_history_conversation: 'scope_digest, conversation_digest, order_key COLLATE "C"',
};

function entry(record: AgentHistoryRecord) {
  if (record.entry === undefined) throw new Error("Stored history entry is required.");
  return record.entry;
}

describe("PostgreSQL Agent history provider boundary", () => {
  it("returns scoped original entries through indexed category and conversation pages", async () => {
    const stored = new Map<string, AgentHistoryRecord>();
    const query = vi.fn((_client: unknown, sql: string, values: (string | number)[]) => {
      expect(sql).toContain('"scope_digest" = $1 AND "state_type" = $2 AND "agent_key" = $3');
      expect(values[1]).toBe(scope.stateType);
      const after = sql.includes('"order_key" COLLATE "C" >')
        ? String(values[values.length - 2])
        : undefined;
      const selected = [...stored.values()].filter((record) => {
        const entry = record.entry;
        if (record.scope?.stateType !== values[1] || record.scope?.agentKey !== values[2])
          return false;
        if (entry === undefined) return false;
        const key = AgentHistoryKeys.fromEntry(entry);
        if (after !== undefined && AgentHistoryKeys.indexValue(key) <= after) return false;
        if (sql.includes('"conversation_digest" ='))
          return (
            entry.item.case === "conversationRecord" &&
            entry.item.value.conversation?.value === values[4]
          );
        if (sql.includes('"category" =')) return key.category === values[3];
        return true;
      });
      selected.sort((a, b) =>
        AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry(a))).localeCompare(
          AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry(b))),
        ),
      );
      return Promise.resolve(selected.slice(0, Number(values.at(-1))));
    });
    const client = {
      query: vi.fn((_sql: string, values?: [string, keyof typeof indexes]) =>
        Promise.resolve({
          rows:
            values === undefined
              ? []
              : [
                  {
                    definition: `CREATE INDEX ${values[1]} ON test USING btree (${indexes[values[1]]})`,
                    indisvalid: true,
                    indisready: true,
                  },
                ],
        }),
      ),
    };
    const executor = {
      prepare: vi.fn(() => Promise.resolve()),
      using: <T>(work: (connection: typeof client) => Promise<T>) => work(client),
      table: () => '"test_history"',
      query,
    };
    const writeImmutable = vi.fn((record: AgentHistoryRecord) => {
      const slot = AgentHistoryRecords.slot(record);
      const prior = stored.get(slot);
      if (
        prior !== undefined &&
        String(toBinary(AgentHistoryEntrySchema, entry(prior))) !==
          String(toBinary(AgentHistoryEntrySchema, entry(record)))
      )
        throw new Error("Immutable history content differs.");
      stored.set(slot, record);
      return Promise.resolve();
    });
    const close = vi.fn();
    const records = { historyExecutor: () => executor, writeImmutable, close };
    const history = new PostgresAgentHistory(scope, records as never);
    const time = occurredAt(1_789_000_001n, 123_456_789);
    const first = conversation("conversation-a", "thread-a", time);
    const system = event("system-a", time, true);
    const domain = event("domain-a", time, false);
    try {
      await history.append("ticket-a", domain);
      await history.append("ticket-a", first);
      await history.append("ticket-a", system);
      await history.append("ticket-a", first);
      expect(writeImmutable).toHaveBeenCalledTimes(4);
      const page = await history.read({
        entityId: "ticket-a",
        view: { kind: "full" },
        count: 1,
        maxBytes: 10_000,
      });
      expect(page.entries).toEqual([first]);
      expect(page.hasMore).toBe(true);
      const later = await history.read({
        entityId: "ticket-a",
        view: { kind: "full" },
        after: AgentHistoryKeys.fromEntry(first),
        count: 2,
        maxBytes: 10_000,
      });
      expect(later.entries).toEqual([system, domain]);
      expect(later.hasMore).toBe(false);
      const conversationPage = await history.read({
        entityId: "ticket-a",
        view: {
          kind: "conversation",
          conversation: create(ConversationIdSchema, { value: "thread-a" }),
        },
        count: 2,
        maxBytes: 10_000,
      });
      expect(conversationPage.entries).toEqual([first]);
      const systemPage = await history.read({
        entityId: "ticket-a",
        view: { kind: "system" },
        count: 2,
        maxBytes: 10_000,
      });
      expect(systemPage.entries).toEqual([system]);
      expect(
        (
          await history.read({
            entityId: "ticket-b",
            view: { kind: "full" },
            count: 2,
            maxBytes: 10_000,
          })
        ).entries,
      ).toEqual([]);
      expect(query).toHaveBeenCalledWith(
        client,
        expect.stringContaining('"conversation_key" ='),
        expect.arrayContaining(["thread-a"]),
      );
      const readsBeforeInvalidView = query.mock.calls.length;
      await expect(
        history.read({
          entityId: "ticket-a",
          view: { kind: "conversation", conversation: create(ConversationIdSchema) },
          count: 1,
          maxBytes: 10_000,
        }),
      ).rejects.toThrow(/ConversationId/i);
      await expect(
        history.read({
          entityId: "ticket-a",
          view: { kind: "system" },
          after: AgentHistoryKeys.fromEntry(domain),
          count: 1,
          maxBytes: 10_000,
        }),
      ).rejects.toThrow(/category does not match/i);
      expect(query).toHaveBeenCalledTimes(readsBeforeInvalidView);
      expect(client.query.mock.calls.filter(([, values]) => values !== undefined)).toHaveLength(3);
      await expect(
        history.append("ticket-a", event("domain-a", occurredAt(2n), false)),
      ).rejects.toThrow(/immutable/i);
    } finally {
      history.close();
    }
    await expect(
      history.read({ entityId: "ticket-a", view: { kind: "full" }, count: 1, maxBytes: 10_000 }),
    ).rejects.toThrow(/closed/i);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects an index that is present but unavailable for reads", async () => {
    const client = {
      query: vi.fn((_sql: string, values?: [string, keyof typeof indexes]) =>
        Promise.resolve({
          rows:
            values === undefined
              ? []
              : [
                  {
                    definition: `CREATE INDEX ${values[1]} ON test USING btree (${indexes[values[1]]})`,
                    indisvalid: false,
                    indisready: true,
                  },
                ],
        }),
      ),
    };
    const executor = {
      prepare: () => Promise.resolve(),
      using: <T>(work: (connection: typeof client) => Promise<T>) => work(client),
      table: () => '"test_history"',
    };
    const history = new PostgresAgentHistory(scope, {
      historyExecutor: () => executor,
      close: vi.fn(),
    } as never);
    await expect(
      history.read({ entityId: "ticket-a", view: { kind: "full" }, count: 1, maxBytes: 10_000 }),
    ).rejects.toThrow(/index is incompatible/i);
    history.close();
  });
});
