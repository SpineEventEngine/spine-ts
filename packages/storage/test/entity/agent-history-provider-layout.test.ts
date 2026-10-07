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
import { AgentHistoryEntrySchema } from "@spine-event-engine/proto/agent";
import { describe, expect, it } from "vitest";

import { AgentHistoryKeys } from "../../src/entity/agent-history.js";
import { AgentHistoryPages } from "../../src/entity/agent-history-provider-page.js";
import { AgentHistoryRecords } from "../../src/entity/agent-history-record-spec.js";
import { conversation, event, occurredAt, scope } from "./agent-history-fixtures.js";

const digest = (value: string): string => `digest:${value}`;
const at = occurredAt(1_789_000_001n, 123_456_789);

function materialized(name: string, entry: ReturnType<typeof event>) {
  const record = AgentHistoryRecords.record(scope.stateType, "ticket", entry);
  const spec = AgentHistoryRecords.spec(digest);
  return spec.columns.find((column) => column.name === name)?.valueIn(record);
}

describe("Agent history provider layout", () => {
  it("retains original scope and entries while materializing complete indexed keys", () => {
    const domain = event("event-id", at, false);
    const record = AgentHistoryRecords.record(scope.stateType, "ticket", domain);
    const spec = AgentHistoryRecords.spec(digest);
    expect(record.entry).toEqual(domain);
    expect(record.scope?.stateType).toBe(scope.stateType);
    expect(record.scope?.agentKey).toBe("ticket");
    expect(spec.idValueIn(record)).toBe(digest(AgentHistoryRecords.slot(record)));
    expect(materialized("state_type", domain)).toBe(scope.stateType);
    expect(materialized("agent_key", domain)).toBe("ticket");
    expect(materialized("scope_digest", domain)).toBe(
      digest(AgentHistoryRecords.scope(scope.stateType, "ticket")),
    );
    expect(materialized("category", domain)).toBe("domain");
    expect(materialized("conversation_key", domain)).toBe("");
    expect(materialized("conversation_digest", domain)).toBe(digest(""));
    expect(materialized("order_key", domain)).toBe(
      AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(domain)),
    );
    const conversationEntry = conversation("record-id", "conversation-id", at);
    expect(materialized("conversation_key", conversationEntry)).toBe("conversation-id");
    expect(materialized("conversation_digest", conversationEntry)).toBe(digest("conversation-id"));
    expect(AgentHistoryRecords.slot(record)).not.toBe(
      AgentHistoryRecords.slot(AgentHistoryRecords.record(scope.stateType, "other", domain)),
    );
  });

  it("rejects missing scope or original entry before provider writes", () => {
    const entry = event("event-id", at, false);
    expect(() => AgentHistoryRecords.record("", "ticket", entry)).toThrow();
    expect(() => AgentHistoryRecords.record(scope.stateType, "", entry)).toThrow();
    const valid = AgentHistoryRecords.record(scope.stateType, "ticket", entry);
    expect(() => AgentHistoryRecords.slot({ ...valid, scope: undefined })).toThrow();
    expect(() => AgentHistoryRecords.slot({ ...valid, entry: undefined })).toThrow();
  });
});

describe("Agent history native query paging", () => {
  const first = event("first", occurredAt(1_789_000_002n), false);
  const second = event("second", at, true);
  const records = [
    AgentHistoryRecords.record(scope.stateType, "ticket", first),
    AgentHistoryRecords.record(scope.stateType, "ticket", second),
  ];

  it("uses an exclusive full-key cursor and returns independent bounded entries", async () => {
    const calls: [string | undefined, number][] = [];
    const page = await AgentHistoryPages.read(
      { count: 1, maxBytes: 10000 },
      undefined,
      (after, limit) => {
        calls.push([after, limit]);
        return Promise.resolve(
          records
            .filter(
              (record) =>
                after === undefined ||
                AgentHistoryKeys.indexValue(
                  AgentHistoryKeys.fromEntry(AgentHistoryRecords.requiredEntry(record)),
                ) > after,
            )
            .slice(0, limit),
        );
      },
    );
    expect(page.entries).toEqual([first]);
    expect(page.hasMore).toBe(true);
    expect(calls).toEqual([[undefined, 2]]);
    expect(page.entries[0]).not.toBe(first);
    const boundary = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(first));
    const next = await AgentHistoryPages.read({ count: 1, maxBytes: 10000 }, boundary, (after) =>
      Promise.resolve(
        records.filter(
          (record) =>
            AgentHistoryKeys.indexValue(
              AgentHistoryKeys.fromEntry(AgentHistoryRecords.requiredEntry(record)),
            ) > (after ?? ""),
        ),
      ),
    );
    expect(next.entries).toEqual([second]);
    expect(next.hasMore).toBe(false);
  });

  it("stops at byte limits and rejects a first entry that cannot fit", async () => {
    const bytes = toBinary(AgentHistoryEntrySchema, first).length;
    const page = await AgentHistoryPages.read({ count: 2, maxBytes: bytes }, undefined, () =>
      Promise.resolve(records),
    );
    expect(page.entries).toEqual([first]);
    expect(page.hasMore).toBe(true);
    await expect(
      AgentHistoryPages.read({ count: 1, maxBytes: bytes - 1 }, undefined, () =>
        Promise.resolve(records),
      ),
    ).rejects.toThrow("first entry exceeds maxBytes");
  });

  it("rejects invalid bounds and missing stored entries", async () => {
    await expect(
      AgentHistoryPages.read({ count: 0, maxBytes: 100 }, undefined, () => Promise.resolve([])),
    ).rejects.toThrow("positive safe integer");
    await expect(
      AgentHistoryPages.read({ count: 1, maxBytes: 0 }, undefined, () => Promise.resolve([])),
    ).rejects.toThrow("positive safe integer");
    const missing = {
      ...AgentHistoryRecords.record(scope.stateType, "ticket", first),
      entry: undefined,
    };
    await expect(
      AgentHistoryPages.read({ count: 1, maxBytes: 100 }, undefined, () =>
        Promise.resolve([missing]),
      ),
    ).rejects.toThrow("lacks its entry");
  });
});
