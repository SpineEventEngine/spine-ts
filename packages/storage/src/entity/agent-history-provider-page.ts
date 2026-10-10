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

import { clone, toBinary } from "@bufbuild/protobuf";
import { AgentHistoryEntrySchema, type AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import type { AgentHistoryRecord } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";

import { AgentHistoryKeys, type AgentHistoryPage } from "./agent-history.js";

/**

 * Combines bounded native query chunks into one byte-bounded history page.

 */
export const AgentHistoryPages = {
  /**
   * Reads complete-key native query chunks until a count or byte boundary.
   * @param input Positive count and byte bounds.
   * @param after Optional exclusive encoded boundary.
   * @param fetch Reads at most the requested count from one indexed provider view.
   * @returns Independent original entries and continuation status.
   */
  async read(
    input: { readonly count: number; readonly maxBytes: number },
    after: string | undefined,
    fetch: (after: string | undefined, limit: number) => Promise<readonly AgentHistoryRecord[]>,
  ): Promise<AgentHistoryPage> {
    AgentHistoryPages.validate(input);
    const entries: AgentHistoryEntry[] = [];
    let bytes = 0;
    let next = after;
    for (;;) {
      const limit = Math.min(128, input.count + 1 - entries.length);
      const records = await fetch(next, limit);
      if (records.length === 0) return { entries: Object.freeze(entries), hasMore: false };
      for (const record of records) {
        const entry = AgentHistoryPages.entry(record);
        const length = toBinary(AgentHistoryEntrySchema, entry).length;
        if (entries.length === input.count || length > input.maxBytes - bytes) {
          if (entries.length === 0)
            throw new RangeError("Agent history first entry exceeds maxBytes.");
          return { entries: Object.freeze(entries), hasMore: true };
        }
        entries.push(clone(AgentHistoryEntrySchema, entry));
        bytes += length;
        next = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry));
      }
      if (records.length < limit) return { entries: Object.freeze(entries), hasMore: false };
    }
  },

  /**
   * Rejects malformed provider read bounds before query work.
   * @param input Caller-supplied count and byte limits.
   */
  validate(input: { readonly count: number; readonly maxBytes: number }): void {
    if (!Number.isSafeInteger(input.count) || input.count <= 0)
      throw new RangeError("Agent history count must be a positive safe integer.");
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0)
      throw new RangeError("Agent history maxBytes must be a positive safe integer.");
  },

  /**
   * Reads a complete original entry from its internal envelope.
   * @param record Stored history envelope.
   * @returns Complete original entry.
   */
  entry(record: AgentHistoryRecord): AgentHistoryEntry {
    if (record.entry === undefined) throw new Error("Agent history stored record lacks its entry.");
    return record.entry;
  },
};
