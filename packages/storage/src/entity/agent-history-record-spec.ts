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

import { create, ScalarType } from "@bufbuild/protobuf";
import { AgentHistoryEntrySchema, type AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import {
  AgentHistoryRecordSchema,
  AgentHistoryStorageKeySchema as AgentStorageKeySchema,
  type AgentHistoryRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";

import { RecordColumn } from "../record/record-column.js";
import { ColumnTypes } from "../record/column-type.js";
import { RecordSpec } from "../record/record-spec.js";
import { StorageGroup } from "../record/storage-group.js";
import { AgentHistoryKeys } from "./agent-history.js";

/**
 * Physical family shared by Agent state types within one tenant.
 */
const agentHistoryGroup: StorageGroup = new StorageGroup("agent_history");

/**
 * Describes materialization of original Agent history records and indexed columns.
 */
interface AgentHistoryRecordLayout {
  /**
   * Identifies the physical family shared within one tenant.
   */
  readonly group: StorageGroup;

  /**
   * Builds the complete internal envelope.
   * @param stateType Generated Agent state type name.
   * @param agentKey Canonical typed identifier key.
   * @param entry Complete original history entry.
   * @returns Internal storage envelope.
   */
  record(stateType: string, agentKey: string, entry: AgentHistoryEntry): AgentHistoryRecord;

  /**
   * Encodes the immutable logical record identity.
   * @param record Internal history envelope.
   * @returns Complete logical identity.
   */
  slot(record: AgentHistoryRecord): string;

  /**
   * Encodes the complete Agent repository scope.
   * @param stateType Generated Agent state type name.
   * @param agentKey Canonical typed identifier key.
   * @returns Complete logical scope.
   */
  scope(stateType: string, agentKey: string): string;

  /**
   * Builds provider columns with a fixed-width physical digest.
   * @param digest Provider digest of a complete logical identity.
   * @returns Shared native record specification.
   */
  spec(digest: (value: string) => string): RecordSpec<string, AgentHistoryRecord>;

  /**
   * Reads the validated repository scope from an envelope.
   * @param record Internal history envelope.
   * @returns Complete original scope.
   */
  requiredScope(record: AgentHistoryRecord): NonNullable<AgentHistoryRecord["scope"]>;

  /**
   * Reads the original history entry from an envelope.
   * @param record Internal history envelope.
   * @returns Complete original history entry.
   */
  requiredEntry(record: AgentHistoryRecord): AgentHistoryEntry;

  /**
   * Builds the materialized repository scope columns.
   * @param digest Provider digest of a complete logical identity.
   * @returns Complete scope columns.
   */
  scopeColumns(digest: (value: string) => string): RecordColumn<AgentHistoryRecord>[];

  /**
   * Builds the materialized order and conversation columns.
   * @param digest Provider digest of a complete logical identity.
   * @returns Complete order and conversation columns.
   */
  orderColumns(digest: (value: string) => string): RecordColumn<AgentHistoryRecord>[];
}

/**
 * Internal record layout for one tenant's shared Agent history family.
 */
export const AgentHistoryRecords: AgentHistoryRecordLayout = {
  /**
   * Physical family shared by Agent state types within one tenant.
   */
  group: agentHistoryGroup,

  /**
   * Stores one original entry with its canonical repository scope.
   * @param stateType Generated Agent state type name.
   * @param agentKey Canonical typed identifier key.
   * @param entry Complete original history entry.
   * @returns Internal storage envelope.
   */
  record(stateType: string, agentKey: string, entry: AgentHistoryEntry): AgentHistoryRecord {
    if (stateType.length === 0 || agentKey.length === 0)
      throw new TypeError("Agent history requires state type and Agent key.");
    AgentHistoryKeys.fromEntry(entry);
    return create(AgentHistoryRecordSchema, {
      scope: create(AgentStorageKeySchema, { stateType, agentKey }),
      entry,
    });
  },

  /**
   * Builds the full logical identity hashed into a provider physical ID.
   * @param record Internal history envelope.
   * @returns Unambiguous identity without an ordering position.
   */
  slot(record: AgentHistoryRecord): string {
    const scope = AgentHistoryRecords.requiredScope(record);
    const key = AgentHistoryKeys.fromEntry(AgentHistoryRecords.requiredEntry(record));
    return JSON.stringify([scope.stateType, scope.agentKey, key.category, key.recordId]);
  },

  /**
   * Encodes the complete repository scope before provider hashing.
   * @param stateType Generated Agent state type.
   * @param agentKey Canonical typed Agent key.
   * @returns Unambiguous complete scope identity.
   */
  scope(stateType: string, agentKey: string): string {
    return JSON.stringify([stateType, agentKey]);
  },

  /**
   * Builds materialized columns with one provider's bounded physical digest.
   * @param digest Maps a complete identity to a fixed-width digest.
   * @returns Shared record specification for native providers.
   */
  spec(digest: (value: string) => string): RecordSpec<string, AgentHistoryRecord> {
    return new RecordSpec({
      sourceType: AgentHistoryEntrySchema,
      recordType: AgentHistoryRecordSchema,
      idKind: "string",
      extractId: (record) => digest(AgentHistoryRecords.slot(record)),
      columns: [
        ...AgentHistoryRecords.scopeColumns(digest),
        ...AgentHistoryRecords.orderColumns(digest),
      ],
    });
  },

  /**
   * Reads the repository scope required by every stored history entry.
   * @param record Stored history envelope.
   * @returns Complete original scope.
   */
  requiredScope(record: AgentHistoryRecord): NonNullable<AgentHistoryRecord["scope"]> {
    if (
      record.scope === undefined ||
      record.scope.stateType.length === 0 ||
      record.scope.agentKey.length === 0
    )
      throw new TypeError("Agent history record requires a complete repository scope.");
    return record.scope;
  },

  /**
   * Reads the original history entry required by the storage envelope.
   * @param record Stored history envelope.
   * @returns Complete original history entry.
   */
  requiredEntry(record: AgentHistoryRecord): AgentHistoryEntry {
    if (record.entry === undefined) throw new TypeError("Agent history record requires an entry.");
    return record.entry;
  },

  /**
   * Builds complete scope columns and their bounded indexed digest.
   * @param digest Provider physical-identity digest.
   * @returns Native scope columns.
   */
  scopeColumns(digest: (value: string) => string): RecordColumn<AgentHistoryRecord>[] {
    const string = ColumnTypes.scalar(ScalarType.STRING);
    return [
      new RecordColumn(
        "state_type",
        string,
        (record) => AgentHistoryRecords.requiredScope(record).stateType,
      ),
      new RecordColumn(
        "agent_key",
        string,
        (record) => AgentHistoryRecords.requiredScope(record).agentKey,
      ),
      new RecordColumn("scope_digest", string, (record) =>
        digest(
          AgentHistoryRecords.scope(
            AgentHistoryRecords.requiredScope(record).stateType,
            AgentHistoryRecords.requiredScope(record).agentKey,
          ),
        ),
      ),
    ];
  },

  /**
   * Builds complete order and conversation selector columns.
   * @param digest Provider physical-identity digest.
   * @returns Native order and conversation columns.
   */
  orderColumns(digest: (value: string) => string): RecordColumn<AgentHistoryRecord>[] {
    const string = ColumnTypes.scalar(ScalarType.STRING);
    const conversation = (record: AgentHistoryRecord): string =>
      record.entry?.item.case === "conversationRecord"
        ? (record.entry.item.value.conversation?.value ?? "")
        : "";
    return [
      new RecordColumn(
        "category",
        string,
        (record) => AgentHistoryKeys.fromEntry(AgentHistoryRecords.requiredEntry(record)).category,
      ),
      new RecordColumn("conversation_key", string, conversation),
      new RecordColumn("conversation_digest", string, (record) => digest(conversation(record))),
      new RecordColumn("order_key", string, (record) =>
        AgentHistoryKeys.indexValue(
          AgentHistoryKeys.fromEntry(AgentHistoryRecords.requiredEntry(record)),
        ),
      ),
    ];
  },
};
