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

import { clone, create } from "@bufbuild/protobuf";
import { ConversationIdSchema } from "@spine-event-engine/proto/agent";
import {
  AgentHistoryRecordSchema,
  type AgentHistoryRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import { AgentHistoryKeys, AgentHistoryRecords } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import {
  conversation,
  event,
  occurredAt,
  scope,
} from "../../storage/test/entity/agent-history-fixtures.js";
import { AgentHistoryHash, DatastoreAgentHistory } from "../src/datastore/agent-history.js";

function entry(record: AgentHistoryRecord) {
  if (record.entry === undefined) throw new Error("Stored history entry is required.");
  return record.entry;
}

describe("Datastore Agent history provider boundary", () => {
  it("returns scoped original entries through ordered native views and immutable append", async () => {
    const stored = new Map<string, AgentHistoryRecord>();
    const compareAndSet = vi.fn((id: string, _expected: undefined, record: AgentHistoryRecord) => {
      if (stored.has(id)) return Promise.resolve(false);
      stored.set(id, clone(AgentHistoryRecordSchema, record));
      return Promise.resolve(true);
    });
    const queryProviderPage = vi.fn(
      (request: {
        filters: readonly { property: string; operator: string; value: string }[];
        order: readonly { property: string; direction: string }[];
        limit: number;
      }) => {
        const match = (name: string) => request.filters.find((filter) => filter.property === name);
        const selected = [...stored.values()].filter((record) => {
          const entry = record.entry;
          if (entry === undefined) return false;
          const key = AgentHistoryKeys.fromEntry(entry);
          if (
            match("scope_digest")?.value !==
            AgentHistoryHash.value(
              AgentHistoryRecords.scope(
                record.scope?.stateType ?? "",
                record.scope?.agentKey ?? "",
              ),
            )
          )
            return false;
          const after = match("order_key");
          if (after !== undefined && AgentHistoryKeys.indexValue(key) <= after.value) return false;
          if (match("category") !== undefined && key.category !== match("category")?.value)
            return false;
          if (
            match("conversation_digest") !== undefined &&
            (entry.item.case !== "conversationRecord" ||
              entry.item.value.conversation?.value !== "thread-a")
          )
            return false;
          return true;
        });
        selected.sort((a, b) =>
          AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry(a))).localeCompare(
            AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry(b))),
          ),
        );
        return Promise.resolve({
          entries: selected.slice(0, request.limit).map((record) => ({ record })),
          hasMore: selected.length > request.limit,
        });
      },
    );
    const close = vi.fn();
    const records = {
      compareAndSet,
      read: vi.fn((id: string) => Promise.resolve(stored.get(id))),
      queryProviderPage,
      close,
    };
    const history = new DatastoreAgentHistory(scope, records as never);
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
      expect(
        (
          await history.read({
            entityId: "ticket-a",
            view: { kind: "system" },
            count: 2,
            maxBytes: 10_000,
          })
        ).entries,
      ).toEqual([system]);
      expect(
        (
          await history.read({
            entityId: "ticket-a",
            view: {
              kind: "conversation",
              conversation: create(ConversationIdSchema, { value: "thread-a" }),
            },
            count: 2,
            maxBytes: 10_000,
          })
        ).entries,
      ).toEqual([first]);
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
      expect(queryProviderPage).toHaveBeenCalledWith(
        expect.objectContaining({
          order: [{ property: "order_key", direction: "asc" }],
        }),
      );
      const readsBeforeInvalidView = queryProviderPage.mock.calls.length;
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
      expect(queryProviderPage).toHaveBeenCalledTimes(readsBeforeInvalidView);
      expect(compareAndSet).toHaveBeenCalledTimes(4);
      await expect(
        history.append("ticket-a", event("domain-a", occurredAt(2n), false)),
      ).rejects.toThrow(/immutable content/i);
    } finally {
      history.close();
    }
    await expect(
      history.read({ entityId: "ticket-a", view: { kind: "full" }, count: 1, maxBytes: 10_000 }),
    ).rejects.toThrow(/closed/i);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects a native result with a different original repository scope", async () => {
    const wrong = AgentHistoryRecords.record(
      scope.stateType,
      "other-ticket",
      event("mis-scoped", occurredAt(9n), false),
    );
    const queryProviderPage = vi.fn(() =>
      Promise.resolve({ entries: [{ record: wrong }], hasMore: false }),
    );
    const history = new DatastoreAgentHistory(scope, {
      queryProviderPage,
      close: vi.fn(),
    } as never);
    await expect(
      history.read({ entityId: "ticket-a", view: { kind: "full" }, count: 1, maxBytes: 10_000 }),
    ).rejects.toThrow(/scope digest collides/i);
    history.close();
  });

  it("rejects a native conversation result from a different original conversation", async () => {
    const wrong = AgentHistoryRecords.record(
      scope.stateType,
      "ticket-a",
      conversation("conversation-b", "thread-b", occurredAt(9n)),
    );
    const queryProviderPage = vi.fn(() =>
      Promise.resolve({ entries: [{ record: wrong }], hasMore: false }),
    );
    const history = new DatastoreAgentHistory(scope, {
      queryProviderPage,
      close: vi.fn(),
    } as never);
    await expect(
      history.read({
        entityId: "ticket-a",
        view: {
          kind: "conversation",
          conversation: create(ConversationIdSchema, { value: "thread-a" }),
        },
        count: 1,
        maxBytes: 10_000,
      }),
    ).rejects.toThrow(/conversation digest collides/i);
    history.close();
  });

  it("refuses an ordering key that cannot fit the native indexed value", async () => {
    const compareAndSet = vi.fn(() => Promise.resolve(true));
    const history = new DatastoreAgentHistory(scope, { compareAndSet, close: vi.fn() } as never);
    await expect(
      history.append("ticket-a", event("x".repeat(1_000), occurredAt(9n), false)),
    ).rejects.toThrow(/indexed-value limit/i);
    expect(compareAndSet).not.toHaveBeenCalled();
    history.close();
  });
});
