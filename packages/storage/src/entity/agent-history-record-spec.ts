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

import { clone, ScalarType, toBinary } from "@bufbuild/protobuf";
import {
  AgentHistoryEntrySchema,
  AgentIdSchema,
  type AgentHistoryEntry,
  type AgentId,
} from "@spine-event-engine/proto/agent";

import { AgentIdentity } from "../internal/agent-identity.js";
import { RecordColumn } from "../record/record-column.js";
import { ColumnTypes } from "../record/column-type.js";
import { RecordSpec } from "../record/record-spec.js";
import { StorageGroup } from "../record/storage-group.js";
import { AgentHistoryKeys } from "./agent-history.js";

/**
 * Physical family shared by Agent state types within one tenant.
 */
const agentHistoryGroup = new StorageGroup("agent_history");

/**
 * Provides the direct entry layout and complete identity checks for providers.
 */
interface AgentHistoryLayout {
  /**
   * Physical history family shared within one tenant.
   */
  readonly group: StorageGroup;

  /**
   * Captures and validates one entry for a typed Agent.
   * @param agent Expected Agent identity.
   * @param entry Prepared entry.
   * @returns Complete detached entry.
   */
  capture(agent: AgentId, entry: AgentHistoryEntry): AgentHistoryEntry;

  /**
   * Checks stored identity without repairing a decoded entry.
   * @param entry Decoded entry.
   * @param agent Requested Agent identity.
   * @returns Validated entry.
   */
  requireIdentity(entry: AgentHistoryEntry, agent: AgentId): AgentHistoryEntry;

  /**
   * Calculates the exact stored bytes after identity capture.
   * @param agent Expected Agent identity.
   * @param entry Prepared entry.
   * @returns Encoded byte count.
   */
  bytes(agent: AgentId, entry: AgentHistoryEntry): number;

  /**
   * Encodes the immutable entry identity before hashing.
   * @param entry Complete entry.
   * @returns Exact logical slot.
   */
  slot(entry: AgentHistoryEntry): string;

  /**
   * Encodes a prepared request identity for direct lookup.
   * @param agent Complete Agent identity.
   * @param callId Logical model call identifier.
   * @returns Exact logical slot.
   */
  requestSlot(agent: AgentId, callId: string): string;

  /**
   * Validates one directly read prepared request.
   * @param entry Decoded entry.
   * @param agent Requested Agent identity.
   * @param callId Logical model call identifier.
   * @returns Validated request entry.
   */
  requestEntry(entry: AgentHistoryEntry, agent: AgentId, callId: string): AgentHistoryEntry;

  /**
   * Encodes the complete typed Agent scope.
   * @param agent Complete Agent identity.
   * @returns Exact scope text.
   */
  scope(agent: AgentId): string;

  /**
   * Builds physical columns for direct stored entries.
   * @param digest Provider identity digest.
   * @returns Native record specification.
   */
  spec(digest: (value: string) => string): RecordSpec<string, AgentHistoryEntry>;

  /**
   * Reads the validated Agent identity from a complete entry.
   * @param entry Complete entry.
   * @returns Typed Agent identity.
   */
  requiredAgent(entry: AgentHistoryEntry): AgentId;
}

/**
 * Materializes direct Agent history entries and their indexed columns.
 */
export const AgentHistoryRecords: AgentHistoryLayout = Object.freeze({
  /**
   * Physical family shared by Agent state types within one tenant.
   */
  group: agentHistoryGroup,

  /**
   * Detaches an entry, stamps an absent Agent identity, and rejects a different identity.
   * @param agent Expected complete typed Agent identity.
   * @param entry Prepared history entry.
   * @returns Independent complete entry for storage.
   */
  capture(agent: AgentId, entry: AgentHistoryEntry): AgentHistoryEntry {
    const expected = AgentIdentity.text(agent);
    const captured = clone(AgentHistoryEntrySchema, entry);
    if (captured.agent !== undefined && AgentIdentity.text(captured.agent) !== expected)
      throw new TypeError("Agent history identity conflict.");
    captured.agent ??= clone(AgentIdSchema, agent);
    AgentHistoryKeys.fromEntry(captured);
    return captured;
  },

  /**
   * Rejects a decoded entry without the requested complete Agent identity.
   * @param entry Decoded stored entry.
   * @param agent Requested Agent identity.
   * @returns The validated stored entry.
   */
  requireIdentity(entry: AgentHistoryEntry, agent: AgentId): AgentHistoryEntry {
    if (entry.agent === undefined || AgentIdentity.text(entry.agent) !== AgentIdentity.text(agent))
      throw new Error("Agent history identity conflict.");
    AgentHistoryKeys.fromEntry(entry);
    return entry;
  },

  /**
   * Counts the exact bytes stored for a complete direct entry.
   * @param agent Expected Agent identity.
   * @param entry Prepared history entry.
   * @returns Serialized byte count after identity capture.
   */
  bytes(agent: AgentId, entry: AgentHistoryEntry): number {
    return toBinary(AgentHistoryEntrySchema, this.capture(agent, entry)).length;
  },

  /**
   * Encodes one immutable logical record identity.
   * @param entry Complete history entry.
   * @returns Identity before provider hashing.
   */
  slot(entry: AgentHistoryEntry): string {
    const agent = entry.agent;
    if (agent === undefined) throw new TypeError("Agent history requires identity.");
    const key = AgentHistoryKeys.fromEntry(entry);
    return JSON.stringify([AgentIdentity.text(agent), key.category, key.recordId]);
  },

  /**
   * Encodes a prepared model request identity for direct lookup.
   * @param agent Complete Agent identity.
   * @param callId Logical model call identifier.
   * @returns Identity before provider hashing.
   */
  requestSlot(agent: AgentId, callId: string): string {
    if (!callId) throw new TypeError("Agent model request lookup requires call identity.");
    return JSON.stringify([AgentIdentity.text(agent), "request", callId]);
  },

  /**
   * Validates a directly read prepared model request.
   * @param entry Decoded stored entry.
   * @param agent Requested Agent identity.
   * @param callId Logical model call identifier.
   * @returns Complete validated entry.
   */
  requestEntry(entry: AgentHistoryEntry, agent: AgentId, callId: string): AgentHistoryEntry {
    this.requireIdentity(entry, agent);
    if (this.slot(entry) !== this.requestSlot(agent, callId) || entry.item.case !== "modelRequest")
      throw new Error("Agent model request identity conflict.");
    return entry;
  },

  /**
   * Encodes the complete Agent scope before provider hashing.
   * @param agent Complete typed Agent identity.
   * @returns Exact logical scope.
   */
  scope(agent: AgentId): string {
    return AgentIdentity.text(agent);
  },

  /**
   * Builds indexed provider columns for direct history entries.
   * @param digest Provider digest of a complete logical identity.
   * @returns Native record specification.
   */
  spec(digest: (value: string) => string): RecordSpec<string, AgentHistoryEntry> {
    const string = ColumnTypes.scalar(ScalarType.STRING);
    const conversation = (entry: AgentHistoryEntry): string =>
      entry.item.case === "conversationRecord" ? (entry.item.value.conversation?.value ?? "") : "";
    return new RecordSpec({
      sourceType: AgentHistoryEntrySchema,
      recordType: AgentHistoryEntrySchema,
      idKind: "string",
      extractId: (entry) => digest(this.slot(entry)),
      columns: [
        new RecordColumn("agent_key", string, (entry) => this.scope(this.requiredAgent(entry))),
        new RecordColumn("scope_digest", string, (entry) =>
          digest(this.scope(this.requiredAgent(entry))),
        ),
        new RecordColumn("category", string, (entry) => AgentHistoryKeys.fromEntry(entry).category),
        new RecordColumn("conversation_key", string, conversation),
        new RecordColumn("conversation_digest", string, (entry) => digest(conversation(entry))),
        new RecordColumn("order_key", string, (entry) =>
          AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry)),
        ),
      ],
    });
  },

  /**
   * Reads the complete Agent identity required by a stored entry.
   * @param entry Complete history entry.
   * @returns Validated typed Agent identity.
   */
  requiredAgent(entry: AgentHistoryEntry): AgentId {
    if (entry.agent === undefined) throw new TypeError("Agent history requires identity.");
    AgentIdentity.text(entry.agent);
    return entry.agent;
  },
});
