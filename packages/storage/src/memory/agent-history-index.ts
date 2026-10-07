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

import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { AgentHistoryEntrySchema, type AgentHistoryEntry } from "@spine-event-engine/proto/agent";

import {
  AgentHistoryKeys,
  type AgentHistoryOrderKey,
  type AgentHistoryPage,
  type AgentHistoryView,
} from "../entity/agent-history.js";

interface IndexedEntry {
  readonly indexKey: string;
  readonly bytes: Uint8Array;
}

/**
 * Maintains ordered category and conversation indexes for one Agent ID.
 */
export class AgentHistoryIndex {
  readonly #all: IndexedEntry[] = [];

  readonly #system: IndexedEntry[] = [];

  readonly #domain: IndexedEntry[] = [];

  readonly #conversations = new Map<string, IndexedEntry[]>();

  readonly #byIdentity = new Map<string, IndexedEntry>();

  /**
   * Prepares new immutable entries without mutating the current index.
   * @param entries Entries to add to a private copy.
   * @returns Complete replacement index after validation.
   */
  withEntries(entries: readonly AgentHistoryEntry[]): AgentHistoryIndex {
    const next = new AgentHistoryIndex();
    for (const indexed of this.#all)
      next.append(fromBinary(AgentHistoryEntrySchema, indexed.bytes));
    for (const entry of entries) next.append(entry);
    return next;
  }

  /**
   * Adds an immutable entry to its indexed views.
   *
   * @param entry Complete Proto history record.
   */
  append(entry: AgentHistoryEntry): void {
    const key = AgentHistoryKeys.fromEntry(entry);
    const indexKey = AgentHistoryKeys.indexValue(key);
    const bytes = toBinary(AgentHistoryEntrySchema, entry);
    const identity = `${key.category}:${key.recordId}`;
    const existing = this.#byIdentity.get(identity);
    if (existing !== undefined) {
      if (!this.#sameBytes(existing.bytes, bytes))
        throw new Error("Agent history record ID conflicts with immutable content.");
      return;
    }
    const indexed = { indexKey, bytes };
    this.#byIdentity.set(identity, indexed);
    this.#insert(this.#all, indexed);
    if (key.category === "system") this.#insert(this.#system, indexed);
    if (key.category === "domain") this.#insert(this.#domain, indexed);
    if (entry.item.case === "conversationRecord") {
      const conversation = entry.item.value.conversation;
      if (conversation === undefined)
        throw new TypeError("Conversation history requires a ConversationId.");
      this.#insert(this.#conversation(conversation.value), indexed);
    }
  }

  /**
   * Reads the selected index after a complete ordering key.
   *
   * @param view Full, category, or conversation selection.
   * @param after Last returned complete key, when continuing.
   * @param count Maximum returned records.
   * @param maxBytes Maximum serialized wrapper bytes.
   * @returns Bounded independent entries and continuation flag.
   */
  read(
    view: AgentHistoryView,
    after: AgentHistoryOrderKey | undefined,
    count: number,
    maxBytes: number,
  ): AgentHistoryPage {
    const records = this.#view(view);
    const start =
      after === undefined ? 0 : this.#upperBound(records, AgentHistoryKeys.indexValue(after));
    const entries: AgentHistoryEntry[] = [];
    let bytes = 0;
    let index = start;
    while (index < records.length && entries.length < count) {
      const record = records[index];
      if (record === undefined) throw new Error("Agent history index changed during read.");
      if (record.bytes.length > maxBytes - bytes) {
        if (entries.length === 0)
          throw new RangeError("Agent history first entry exceeds maxBytes.");
        break;
      }
      entries.push(fromBinary(AgentHistoryEntrySchema, record.bytes));
      bytes += record.bytes.length;
      index += 1;
    }
    return { entries: Object.freeze(entries), hasMore: index < records.length };
  }

  /**
   * Selects one already ordered index without scanning unrelated categories.
   */
  #view(view: AgentHistoryView): readonly IndexedEntry[] {
    if (view.kind === "full") return this.#all;
    if (view.kind === "system") return this.#system;
    if (view.kind === "domain") return this.#domain;
    if (view.conversation.value.length === 0)
      throw new TypeError("Conversation history requires a ConversationId.");
    return this.#conversations.get(view.conversation.value) ?? [];
  }

  /**
   * Finds or creates the ordered index for one conversation.
   */
  #conversation(id: string): IndexedEntry[] {
    let records = this.#conversations.get(id);
    if (records === undefined) {
      records = [];
      this.#conversations.set(id, records);
    }
    return records;
  }

  /**
   * Inserts one immutable record at its sorted position.
   */
  #insert(records: IndexedEntry[], entry: IndexedEntry): void {
    records.splice(this.#upperBound(records, entry.indexKey), 0, entry);
  }

  /**
   * Finds the first record strictly after the complete key.
   */
  #upperBound(records: readonly IndexedEntry[], key: string): number {
    let low = 0;
    let high = records.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = records[middle];
      if (candidate === undefined) throw new Error("Agent history index changed during search.");
      if (candidate.indexKey <= key) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /**
   * Compares immutable serialized Proto bytes.
   */
  #sameBytes(first: Uint8Array, second: Uint8Array): boolean {
    return first.length === second.length && first.every((byte, index) => byte === second[index]);
  }
}
