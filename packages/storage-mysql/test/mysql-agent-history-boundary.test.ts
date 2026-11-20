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

import { create, toBinary } from "@bufbuild/protobuf";
import { AgentHistoryEntrySchema, ConversationIdSchema } from "@spine-event-engine/proto/agent";
import type { AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import { AgentHistoryKeys, AgentHistoryRecords } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import {
  conversation,
  event,
  occurredAt,
  scope,
} from "../../storage/test/entity/agent-history-fixtures.js";
import { MysqlAgentHistory } from "../src/mysql/agent-history.js";

/**
 * Expected stored entry includes the identity supplied by the repository.
 */
function saved(entry: AgentHistoryEntry): AgentHistoryEntry {
  return create(AgentHistoryEntrySchema, { ...entry, agent: scope.agent("ticket-a") });
}

describe("MySQL Agent history provider boundary", () => {
  it("reads binary ordered original entries through scoped native views", async () => {
    const stored = new Map<string, AgentHistoryEntry>();
    const historyPage = vi.fn((sql: string, values: (string | number)[]) => {
      expect(sql).toContain("`scope_digest` = ? AND BINARY `agent_key` = BINARY ?");
      const after = sql.includes("`order_key` > ?") ? String(values[values.length - 2]) : undefined;
      const selected = [...stored.values()].filter((record) => {
        const entry = record;
        if (AgentHistoryRecords.scope(AgentHistoryRecords.requiredAgent(record)) !== values[1])
          return false;
        const key = AgentHistoryKeys.fromEntry(entry);
        if (after !== undefined && AgentHistoryKeys.indexValue(key) <= after) return false;
        if (sql.includes("`conversation_digest` = ?"))
          return (
            entry.item.case === "conversationRecord" &&
            entry.item.value.conversation?.value === values[3]
          );
        if (sql.includes("`category` = ?")) return key.category === values[2];
        return true;
      });
      selected.sort((a, b) =>
        AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(a)).localeCompare(
          AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(b)),
        ),
      );
      return Promise.resolve(selected.slice(0, Number(values.at(-1))));
    });
    const ensureHistoryIndex = vi.fn(() => Promise.resolve());
    const writeImmutable = vi.fn((record: AgentHistoryEntry) => {
      const slot = AgentHistoryRecords.slot(record);
      const prior = stored.get(slot);
      if (
        prior !== undefined &&
        String(toBinary(AgentHistoryEntrySchema, prior)) !==
          String(toBinary(AgentHistoryEntrySchema, record))
      )
        throw new Error("Immutable history content differs.");
      stored.set(slot, record);
      return Promise.resolve();
    });
    const close = vi.fn();
    const records = {
      prepare: vi.fn(() => Promise.resolve()),
      ensureHistoryIndex,
      historyPage,
      writeImmutable,
      tableName: "test_history",
      close,
    };
    const history = new MysqlAgentHistory(scope, records as never);
    const time = occurredAt(1_789_000_001n, 123_456_789);
    const first = conversation("conversation-a", "thread-a", time);
    const system = event("system-a", time, true);
    const domain = event("domain-a", time, false);
    try {
      await history.append("ticket-a", domain);
      await history.append("ticket-a", first);
      await history.append("ticket-a", system);
      await history.append("ticket-a", first);
      const page = await history.read({
        entityId: "ticket-a",
        view: { kind: "full" },
        count: 1,
        maxBytes: 10_000,
      });
      expect(page.entries).toEqual([saved(first)]);
      expect(page.hasMore).toBe(true);
      const later = await history.read({
        entityId: "ticket-a",
        view: { kind: "full" },
        after: AgentHistoryKeys.fromEntry(first),
        count: 2,
        maxBytes: 10_000,
      });
      expect(later.entries).toEqual([saved(system), saved(domain)]);
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
      expect(conversationPage.entries).toEqual([saved(first)]);
      expect(
        (
          await history.read({
            entityId: "ticket-a",
            view: { kind: "domain" },
            count: 2,
            maxBytes: 10_000,
          })
        ).entries,
      ).toEqual([saved(domain)]);
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
      expect(historyPage).toHaveBeenCalledWith(
        expect.stringContaining("BINARY `conversation_key` = BINARY ?"),
        expect.arrayContaining(["thread-a"]),
      );
      const readsBeforeInvalidView = historyPage.mock.calls.length;
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
          view: { kind: "domain" },
          after: AgentHistoryKeys.fromEntry(system),
          count: 1,
          maxBytes: 10_000,
        }),
      ).rejects.toThrow(/category does not match/i);
      expect(historyPage).toHaveBeenCalledTimes(readsBeforeInvalidView);
      expect(ensureHistoryIndex).toHaveBeenCalledTimes(3);
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

  it("refuses reads when required native index preparation fails", async () => {
    const historyPage = vi.fn(() => Promise.resolve([]));
    const records = {
      prepare: () => Promise.resolve(),
      ensureHistoryIndex: () => Promise.reject(new Error("Native ordered index unavailable.")),
      historyPage,
      close: vi.fn(),
    };
    const history = new MysqlAgentHistory(scope, records as never);
    await expect(
      history.read({ entityId: "ticket-a", view: { kind: "full" }, count: 1, maxBytes: 10_000 }),
    ).rejects.toThrow(/index unavailable/i);
    expect(historyPage).not.toHaveBeenCalled();
    history.close();
  });

  it("rejects a history ID whose complete order key exceeds the native index", async () => {
    const prepare = vi.fn(() => Promise.resolve());
    const writeImmutable = vi.fn(() => Promise.resolve());
    const history = new MysqlAgentHistory(scope, {
      prepare,
      writeImmutable,
      close: vi.fn(),
    } as never);
    await expect(
      history.append("ticket-a", event("x".repeat(3_000), occurredAt(2n), false)),
    ).rejects.toThrow(/index capacity/i);
    expect(prepare).not.toHaveBeenCalled();
    expect(writeImmutable).not.toHaveBeenCalled();
    history.close();
  });
});
