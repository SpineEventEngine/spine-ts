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

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { AgentHistoryEntry, ConversationId } from "@spine-event-engine/proto/agent";

import type { StorageContext } from "../storage/storage.js";

/**
 * Converts a typed Agent identifier to its canonical storage key.
 *
 * @typeParam Id Typed Agent identifier.
 */
interface AgentHistoryIdCodec<Id> {
  /**
   * Maps one typed Agent identifier to its canonical key.
   *
   * @param id Typed Agent identifier.
   * @returns Canonical key within the repository scope.
   */
  readonly key: (id: Id) => string;
}

/**
 * Identifies one existing record in the Agent history order.
 */
export interface AgentHistoryOrderKey {
  /**
   * Original occurrence timestamp, with full seconds and nanoseconds.
   */
  readonly occurredAt: Timestamp;

  /**
   * Selects the category tie-break after equal timestamps.
   */
  readonly category: "conversation" | "system" | "domain";

  /**
   * Immutable record or Event ID.
   */
  readonly recordId: string;
}

/**
 * Selects one indexed view of the Agent's append-only history.
 */
export type AgentHistoryView =
  | AgentHistoryFullView
  | AgentHistoryConversationView
  | AgentHistorySystemView
  | AgentHistoryDomainView;

/**
 * Selects every recorded category.
 */
interface AgentHistoryFullView {
  /**
   * Identifies the full view.
   */
  readonly kind: "full";
}

/**
 * Selects records of one conversation.
 */
interface AgentHistoryConversationView {
  /**
   * Identifies the conversation view.
   */
  readonly kind: "conversation";

  /**
   * Existing conversation identifier.
   */
  readonly conversation: ConversationId;
}

/**
 * Selects recorded Agent System Events.
 */
interface AgentHistorySystemView {
  /**
   * Identifies the System view.
   */
  readonly kind: "system";
}

/**
 * Selects recorded Agent domain Events.
 */
interface AgentHistoryDomainView {
  /**
   * Identifies the domain view.
   */
  readonly kind: "domain";
}

/**
 * Identifies a repository and its complete tenant boundary for Agent history.
 *
 * @typeParam Id Typed Agent identifier.
 */
export interface AgentHistoryStorageInput<Id> {
  /**
   * Bounded Context and complete tenant selection.
   */
  readonly context: StorageContext;

  /**
   * Generated Agent state type name.
   */
  readonly stateType: string;

  /**
   * Canonical typed Entity ID conversion supplied by the repository.
   */
  readonly id: AgentHistoryIdCodec<Id>;
}

/**
 * Selects a bounded provider page after an optional complete ordering key.
 *
 * @typeParam Id Typed Agent identifier.
 */
export interface AgentHistoryRead<Id> {
  /**
   * Typed Agent identifier in the configured repository scope.
   */
  readonly entityId: Id;

  /**
   * Full, conversation, System, or domain index.
   */
  readonly view: AgentHistoryView;

  /**
   * Last returned key from the preceding page, when continuing.
   */
  readonly after?: AgentHistoryOrderKey;

  /**
   * Maximum number of entries to return; any positive safe integer is allowed.
   */
  readonly count: number;

  /**
   * Maximum sum of serialized AgentHistoryEntry byte lengths.
   */
  readonly maxBytes: number;
}

/**
 * Returns one bounded page and indicates whether older entries remain.
 */
export interface AgentHistoryPage {
  /**
   * Independent copies of complete Proto history entries.
   */
  readonly entries: readonly AgentHistoryEntry[];

  /**
   * True when another entry follows this page in the selected view.
   */
  readonly hasMore: boolean;
}

/**
 * Provider handle for one repository state type and tenant boundary.
 *
 * @typeParam Id Typed Agent identifier.
 */
export interface AgentHistoryStorage<Id> {
  /**
   * Adds one immutable occurrence, or accepts an identical repeated append.
   *
   * @param entityId Typed Agent identifier.
   * @param entry Complete conversation, System, or domain entry.
   * @returns Resolves after the occurrence is recorded.
   */
  append(entityId: Id, entry: AgentHistoryEntry): Promise<void>;

  /**
   * Reads a bounded live continuation from one indexed view.
   *
   * @param request Scope, view, complete-key boundary, and response bounds.
   * @returns Independent entries and whether older results remain.
   */
  read(request: AgentHistoryRead<Id>): Promise<AgentHistoryPage>;

  /**
   * Closes this handle without deleting any recorded history.
   */
  close(): void;
}

const minSeconds = -62135596800n;
const maxSeconds = 253402300799n;
const categoryRank: Readonly<Record<string, string | undefined>> = {
  conversation: "0",
  system: "1",
  domain: "2",
};

/**
 * Operations on the complete, provider-independent ordering key.
 */
export interface AgentHistoryKeyOperations {
  /**
   * Reads the original ordering key from a history entry.
   *
   * @param entry Complete history entry.
   * @returns Original complete ordering key.
   */
  fromEntry(entry: AgentHistoryEntry): AgentHistoryOrderKey;

  /**
   * Encodes a key for binary-collated provider indexes.
   *
   * @param key Original complete ordering key.
   * @returns Prefix-safe sortable index value.
   */
  indexValue(key: AgentHistoryOrderKey): string;

  /**
   * Compares two keys in newest-first order.
   *
   * @param left First complete key.
   * @param right Second complete key.
   * @returns Negative, zero, or positive comparison.
   */
  compare(left: AgentHistoryOrderKey, right: AgentHistoryOrderKey): number;
}

/**
 * Builds and compares the provider-independent complete Agent history key.
 */
export const AgentHistoryKeys: AgentHistoryKeyOperations = Object.freeze({
  /**
   * Validates enclosed time and identity while reading the complete key.
   *
   * @param entry Recorded Proto oneof.
   * @returns Complete key after validating the enclosed occurrence time.
   */
  fromEntry(entry: AgentHistoryEntry): AgentHistoryOrderKey {
    const occurredAt = entry.occurredAt;
    const item = entry.item;
    if (occurredAt === undefined || item.case === undefined)
      throw new TypeError("Agent history requires an occurrence time and one item.");
    if (item.case === "conversationRecord") {
      const record = item.value;
      if (record.conversation?.value === undefined || record.conversation.value.length === 0)
        throw new TypeError("Conversation history requires a ConversationId.");
      HistoryValidation.sameTime(occurredAt, record.occurredAt);
      return { occurredAt, category: "conversation", recordId: record.id?.value ?? "" };
    }
    const event = item.value;
    HistoryValidation.sameTime(occurredAt, event.context?.timestamp);
    return {
      occurredAt,
      category: item.case === "systemEvent" ? "system" : "domain",
      recordId: event.id?.value ?? "",
    };
  },

  /**
   * Encodes the full key for binary-collated SQL and Datastore range indexes.
   *
   * @param key Original complete history key.
   * @returns Fixed-width reverse time, category rank, and prefix-safe UTF-8 hex ID.
   */
  indexValue(key: AgentHistoryOrderKey): string {
    HistoryValidation.timestamp(key.occurredAt);
    if (key.recordId.length === 0) throw new TypeError("Agent history record ID is required.");
    const seconds = (maxSeconds - key.occurredAt.seconds).toString().padStart(12, "0");
    const nanos = (999999999 - key.occurredAt.nanos).toString().padStart(9, "0");
    const rank = categoryRank[key.category];
    if (rank === undefined) throw new TypeError("Agent history category is required.");
    const id = Utf8Ids.hex(key.recordId);
    return `${seconds}${nanos}${rank}${id}!`;
  },

  /**
   * Compares complete keys in newest-first Agent history order.
   *
   * @param left First complete key.
   * @param right Second complete key.
   * @returns Negative, zero, or positive key comparison.
   */
  compare(left: AgentHistoryOrderKey, right: AgentHistoryOrderKey): number {
    const first = this.indexValue(left);
    const second = this.indexValue(right);
    return first < second ? -1 : first > second ? 1 : 0;
  },
});

/**
 * Encodes valid Unicode IDs as unsigned UTF-8 byte hex for prefix-safe keys.
 */
const Utf8Ids = Object.freeze({
  /**
   * Encodes an identifier without locale collation or platform byte APIs.
   *
   * @param value Existing immutable record ID.
   * @returns Lowercase two-digit hex for every UTF-8 byte.
   */
  hex(value: string): string {
    const encoded = encodeURIComponent(value);
    let result = "";
    for (let index = 0; index < encoded.length; index += 1) {
      if (encoded[index] === "%") {
        result += encoded.slice(index + 1, index + 3).toLowerCase();
        index += 2;
      } else {
        result += encoded.charCodeAt(index).toString(16).padStart(2, "0");
      }
    }
    return result;
  },
});

/**
 * Validates original occurrence times before indexing.
 */
const HistoryValidation = Object.freeze({
  /**
   * Verifies an enclosed occurrence time.
   *
   * @param wrapper History wrapper occurrence time.
   * @param enclosed Enclosed record or Event occurrence time.
   */
  sameTime(wrapper: Timestamp, enclosed: Timestamp | undefined): void {
    this.timestamp(wrapper);
    if (wrapper.seconds !== enclosed?.seconds || wrapper.nanos !== enclosed.nanos)
      throw new TypeError("Agent history wrapper time must equal its recorded occurrence time.");
  },

  /**
   * Checks the complete Protobuf Timestamp range.
   *
   * @param value Original occurrence time.
   */
  timestamp(value: Timestamp): void {
    if (
      typeof value.seconds !== "bigint" ||
      value.seconds < minSeconds ||
      value.seconds > maxSeconds
    )
      throw new RangeError("Agent history timestamp seconds are outside the Protobuf range.");
    if (!Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos > 999999999)
      throw new RangeError("Agent history timestamp nanoseconds are outside the Protobuf range.");
  },
});
