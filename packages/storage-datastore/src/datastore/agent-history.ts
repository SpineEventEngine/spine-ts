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

import { createHash } from "node:crypto";
import { toBinary } from "@bufbuild/protobuf";
import { AgentHistoryRecordSchema } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import type { AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import type { AgentHistoryRecord } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import {
  AgentHistoryKeys,
  AgentHistoryPages,
  type AgentHistoryPage,
  type AgentHistoryRead,
  type AgentHistoryStorage,
  type AgentHistoryStorageInput,
} from "@spine-event-engine/storage/provider";
import { AgentHistoryRecords } from "@spine-event-engine/storage/provider";

import {
  DatastoreRecordStorage,
  type DatastorePageCursor,
  type DatastoreRangeFilter,
} from "./record-storage.js";

/**
 * Hashes complete identities into bounded physical IDs and indexed scope keys.
 */
export const AgentHistoryHash = {
  /**
   * Calculates the fixed-width digest of a complete logical identity.
   * @param value Complete logical identity.
   * @returns Full SHA-256 hex digest.
   */
  value(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  },
};

/**
 * Stores Agent history in the shared Datastore immutable record kind.
 * @typeParam Id Typed Agent identifier.
 */
export class DatastoreAgentHistory<Id> implements AgentHistoryStorage<Id> {
  /**
   * Records whether this handle accepts calls.
   */
  #open = true;

  /**
   * Binds one typed Agent repository to the provider record handle.
   * @param input Repository and complete tenant scope.
   * @param records Native record-family storage.
   */
  constructor(
    private readonly input: AgentHistoryStorageInput<Id>,
    private readonly records: DatastoreRecordStorage<string, AgentHistoryRecord>,
  ) {}

  /**
   * Writes one original entry or confirms byte-identical content.
   * @param entityId Typed Agent identifier.
   * @param entry Complete history entry.
   * @returns Completion after immutable storage confirms the entry.
   */
  async append(entityId: Id, entry: AgentHistoryEntry): Promise<void> {
    this.requireOpen();
    if (AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry)).length > 1500)
      throw new RangeError("Agent history ordering key exceeds the Datastore indexed-value limit.");
    const record = AgentHistoryRecords.record(this.input.stateType, this.key(entityId), entry);
    const id = AgentHistoryHash.value(AgentHistoryRecords.slot(record));
    if (await this.records.compareAndSet(id, undefined, record)) return;
    const stored = await this.records.read(id);
    if (stored !== undefined && this.sameRecord(stored, record)) return;
    throw new Error("Datastore Agent history record ID conflicts with immutable content.");
  }

  /**
   * Reads a bounded indexed page in full Timestamp/category/UTF-8 order.
   * @param request Typed Agent, view, continuation, and response limits.
   * @returns Original entries and continuation status.
   */
  async read(request: AgentHistoryRead<Id>): Promise<AgentHistoryPage> {
    this.requireOpen();
    const agentKey = this.key(request.entityId);
    const after =
      request.after === undefined ? undefined : AgentHistoryKeys.indexValue(request.after);
    this.validateView(request);
    return AgentHistoryPages.read(request, after, (cursor, limit) =>
      this.fetch(agentKey, request, cursor, limit),
    );
  }

  /**

   * Closes this handle without deleting stored records.

   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.records.close();
  }

  /**
   * Reads bounded native pages with complete scope and view predicates.
   * @param agentKey Canonical Agent key.
   * @param request View and response bounds.
   * @param after Exclusive encoded order key.
   * @param limit Maximum native rows for this chunk.
   * @returns Complete original stored records.
   */
  private async fetch(
    agentKey: string,
    request: AgentHistoryRead<Id>,
    after: string | undefined,
    limit: number,
  ): Promise<readonly AgentHistoryRecord[]> {
    const filters: DatastoreRangeFilter[] = [
      {
        property: "scope_digest",
        operator: "=",
        value: AgentHistoryHash.value(AgentHistoryRecords.scope(this.input.stateType, agentKey)),
      },
    ];
    this.viewPredicate(request, filters);
    if (after !== undefined) filters.push({ property: "order_key", operator: ">", value: after });
    const result: AgentHistoryRecord[] = [];
    let cursor: DatastorePageCursor | undefined;
    do {
      const page = await this.records.queryProviderPage({
        filters,
        order: [{ property: "order_key", direction: "asc" }],
        limit: limit - result.length,
        ...(cursor === undefined ? {} : { cursor }),
      });
      result.push(...page.entries.map(({ record }) => this.assertScope(record, agentKey, request)));
      cursor = page.cursor;
      if (!page.hasMore) break;
    } while (result.length < limit && cursor !== undefined);
    return result;
  }

  /**
   * Adds one indexed category or conversation predicate.
   * @param request Selected history view.
   * @param filters Mutable native Datastore filters.
   */
  private viewPredicate(request: AgentHistoryRead<Id>, filters: DatastoreRangeFilter[]): void {
    if (request.view.kind === "full") return;
    if (request.view.kind === "conversation") {
      const conversation = request.view.conversation.value;
      filters.push({
        property: "conversation_digest",
        operator: "=",
        value: AgentHistoryHash.value(conversation),
      });
      return;
    }
    filters.push({ property: "category", operator: "=", value: request.view.kind });
  }

  /**
   * Rejects a digest collision rather than exposing another repository's row.
   * @param record Decoded original storage envelope.
   * @param agentKey Complete requested Agent key.
   * @param request Selected view and conversation.
   * @returns Record after its complete scope is checked.
   */
  private assertScope(
    record: AgentHistoryRecord,
    agentKey: string,
    request: AgentHistoryRead<Id>,
  ): AgentHistoryRecord {
    if (record.scope?.stateType !== this.input.stateType || record.scope.agentKey !== agentKey)
      throw new Error("Datastore Agent history scope digest collides.");
    if (
      request.view.kind === "conversation" &&
      (record.entry?.item.case !== "conversationRecord" ||
        record.entry.item.value.conversation?.value !== request.view.conversation.value)
    )
      throw new Error("Datastore Agent history conversation digest collides.");
    return record;
  }

  /**
   * Validates view identity and complete-key continuation category.
   * @param request View and continuation key.
   */
  private validateView(request: AgentHistoryRead<Id>): void {
    const kind = request.view.kind;
    if (kind === "conversation" && request.view.conversation.value.length === 0)
      throw new TypeError("Conversation history requires a ConversationId.");
    if (request.after !== undefined && kind !== "full" && request.after.category !== kind)
      throw new TypeError("Agent history boundary category does not match the view.");
  }

  /**
   * Converts a typed Agent ID to its canonical key.
   * @param id Typed Agent identifier.
   * @returns Canonical storage key.
   */
  private key(id: Id): string {
    const key = this.input.id.key(id);
    if (key.length === 0) throw new TypeError("Agent history Entity ID is required.");
    return key;
  }

  /**

   * Rejects calls after this handle closes.

   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Agent history storage handle is closed.");
  }

  /**
   * Compares complete stored Proto bytes for immutable repeats.
   * @param left Existing complete storage record.
   * @param right Requested complete storage record.
   * @returns Whether both records have identical serialized bytes.
   */
  private sameRecord(left: AgentHistoryRecord, right: AgentHistoryRecord): boolean {
    const first = toBinary(AgentHistoryRecordSchema, left);
    const second = toBinary(AgentHistoryRecordSchema, right);
    return first.length === second.length && first.every((byte, index) => byte === second[index]);
  }
}
