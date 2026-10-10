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
  readonly identity: string;
  readonly category: "conversation" | "system" | "domain";
  readonly conversation?: string;
  readonly bytes: Uint8Array;
}

/**
 * A validated batch applied and restored within a fenced mutation.
 */
export interface AgentHistoryUpdate {
  /**
   * The retained index receiving the new rows.
   */
  readonly index: AgentHistoryIndex;

  /**
   * Adds the validated rows once.
   */
  apply(): void;

  /**
   * Removes only rows added by this batch.
   */
  restore(): void;
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
   * Validates and serializes only the new entries before a fenced mutation.
   * @param entries Entries to append after the containing write is accepted.
   * @returns A reversible batch without copying retained rows.
   */
  withEntries(entries: readonly AgentHistoryEntry[]): AgentHistoryUpdate {
    const additions: IndexedEntry[] = [];
    const pending = new Map<string, IndexedEntry>();
    for (const entry of entries) {
      const indexed = this.#indexed(entry);
      const existing = pending.get(indexed.identity) ?? this.#byIdentity.get(indexed.identity);
      if (existing !== undefined) {
        if (!this.#sameBytes(existing.bytes, indexed.bytes))
          throw new Error("Agent history record ID conflicts with immutable content.");
        continue;
      }
      pending.set(indexed.identity, indexed);
      additions.push(indexed);
    }
    let applied = false;
    return {
      index: this,
      apply: () => {
        if (applied) return;
        try {
          for (const indexed of additions) this.#appendIndexed(indexed);
          applied = true;
        } catch (error) {
          for (const indexed of additions) this.#removeIndexed(indexed);
          throw error;
        }
      },
      restore: () => {
        if (!applied) return;
        for (const indexed of additions) this.#removeIndexed(indexed);
        applied = false;
      },
    };
  }

  /**
   * Adds an immutable entry to its indexed views.
   *
   * @param entry Complete Proto history record.
   */
  append(entry: AgentHistoryEntry): void {
    this.withEntries([entry]).apply();
  }

  /**
   * Serializes one entry after checking its complete history identity.
   * @param entry Complete history entry.
   * @returns Immutable indexed row.
   */
  #indexed(entry: AgentHistoryEntry): IndexedEntry {
    const key = AgentHistoryKeys.fromEntry(entry);
    const indexKey = AgentHistoryKeys.indexValue(key);
    const bytes = toBinary(AgentHistoryEntrySchema, entry);
    const identity = `${key.category}:${key.recordId}`;
    const conversation =
      entry.item.case === "conversationRecord" ? entry.item.value.conversation?.value : undefined;
    if (key.category === "conversation" && conversation === undefined)
      throw new TypeError("Conversation history requires a ConversationId.");
    return {
      indexKey,
      identity,
      category: key.category,
      ...(conversation === undefined ? {} : { conversation }),
      bytes,
    };
  }

  /**
   * Adds one already validated immutable entry to its indexed views.
   * @param indexed Serialized row to append.
   */
  #appendIndexed(indexed: IndexedEntry): void {
    this.#byIdentity.set(indexed.identity, indexed);
    this.#insert(this.#all, indexed);
    if (indexed.category === "system") this.#insert(this.#system, indexed);
    if (indexed.category === "domain") this.#insert(this.#domain, indexed);
    if (indexed.conversation !== undefined)
      this.#insert(this.#conversation(indexed.conversation), indexed);
  }

  /**
   * Reverses only rows appended by a failed containing mutation.
   * @param indexed Serialized row to remove.
   */
  #removeIndexed(indexed: IndexedEntry): void {
    if (this.#byIdentity.get(indexed.identity) !== indexed) return;
    this.#byIdentity.delete(indexed.identity);
    this.#remove(this.#all, indexed);
    if (indexed.category === "system") this.#remove(this.#system, indexed);
    if (indexed.category === "domain") this.#remove(this.#domain, indexed);
    if (indexed.conversation !== undefined) {
      const records = this.#conversations.get(indexed.conversation);
      if (records !== undefined) {
        this.#remove(records, indexed);
        if (records.length === 0) this.#conversations.delete(indexed.conversation);
      }
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
      after === undefined
        ? records.length - 1
        : this.#firstNotOlder(records, AgentHistoryKeys.indexValue(after)) - 1;
    const entries: AgentHistoryEntry[] = [];
    let bytes = 0;
    let index = start;
    while (index >= 0 && entries.length < count) {
      const record = records[index];
      if (record === undefined) throw new Error("Agent history index changed during read.");
      if (record.bytes.length > maxBytes - bytes) {
        if (entries.length === 0)
          throw new RangeError("Agent history first entry exceeds maxBytes.");
        break;
      }
      entries.push(fromBinary(AgentHistoryEntrySchema, record.bytes));
      bytes += record.bytes.length;
      index -= 1;
    }
    return { entries: Object.freeze(entries), hasMore: index >= 0 };
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
    records.splice(this.#firstNotOlder(records, entry.indexKey), 0, entry);
  }

  /**
   * Removes one exact indexed row when its containing mutation restores.
   * @param records Ordered view to update.
   * @param entry Exact appended row.
   */
  #remove(records: IndexedEntry[], entry: IndexedEntry): void {
    const index = records.indexOf(entry);
    if (index >= 0) records.splice(index, 1);
  }

  /**
   * Finds the first record strictly after the complete key.
   */
  #firstNotOlder(records: readonly IndexedEntry[], key: string): number {
    let low = 0;
    let high = records.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = records[middle];
      if (candidate === undefined) throw new Error("Agent history index changed during search.");
      if (candidate.indexKey > key) low = middle + 1;
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
