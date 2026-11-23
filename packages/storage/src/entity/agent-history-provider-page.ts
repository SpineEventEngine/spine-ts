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
import {
  AgentHistoryEntrySchema,
  type AgentHistoryEntry,
  type AgentId,
} from "@spine-event-engine/proto/agent";

import { AgentHistoryKeys, type AgentHistoryPage } from "./agent-history.js";
import { AgentHistoryRecords } from "./agent-history-record-spec.js";

/**

 * Combines bounded native query chunks into one byte-bounded history page.

 */
export const AgentHistoryPages = {
  /**
   * Reads complete-key native query chunks until a count or byte boundary.
   *
   * @param input Positive count and byte bounds.
   * @param agent Requested complete Agent identity.
   * @param after Optional exclusive encoded boundary.
   * @param fetch Reads at most the requested count from one indexed provider view.
   * @returns Independent original entries and continuation status.
   */
  async read(
    input: { readonly count: number; readonly maxBytes?: number },
    agent: AgentId,
    after: string | undefined,
    fetch: (after: string | undefined, limit: number) => Promise<readonly AgentHistoryEntry[]>,
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
        const entry = AgentHistoryPages.entry(record, agent);
        const length = toBinary(AgentHistoryEntrySchema, entry).length;
        if (
          entries.length === input.count ||
          (input.maxBytes !== undefined && length > input.maxBytes - bytes)
        ) {
          if (entries.length === 0)
            throw new RangeError("Agent history first entry exceeds maxBytes.");
          return { entries: Object.freeze(entries), hasMore: true };
        }
        entries.push(entry);
        bytes += length;
        next = AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry));
      }
      if (records.length < limit) return { entries: Object.freeze(entries), hasMore: false };
    }
  },

  /**
   * Rejects malformed provider read bounds before query work.
   *
   * @param input Caller-supplied count and byte limits.
   */
  validate(input: { readonly count: number; readonly maxBytes?: number }): void {
    if (!Number.isSafeInteger(input.count) || input.count <= 0)
      throw new RangeError("Agent history count must be a positive safe integer.");
    if (
      input.maxBytes !== undefined &&
      (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0)
    )
      throw new RangeError("Agent history maxBytes must be a positive safe integer.");
  },

  /**
   * Validates a complete directly stored entry against the requested Agent.
   *
   * @param record Stored history entry.
   * @param agent Requested complete Agent identity.
   * @returns Complete original entry.
   */
  entry(record: AgentHistoryEntry, agent: AgentId): AgentHistoryEntry {
    return AgentHistoryRecords.requireIdentity(record, agent);
  },
};
