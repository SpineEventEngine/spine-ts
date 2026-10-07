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

import { MysqlRecordStorage } from "./record-storage.js";
import { AgentHistoryIndexBytes } from "./table-spec.js";

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
 * Stores Agent history in the shared MySQL immutable record family.
 * @typeParam Id Typed Agent identifier.
 */
export class MysqlAgentHistory<Id> implements AgentHistoryStorage<Id> {
  /**
   * Records whether this handle accepts calls.
   */
  #open = true;

  /**

   * Reuses one table and index preparation promise.

   */
  #ready: Promise<void> | undefined;

  /**
   * Binds one typed Agent repository to the provider record handle.
   * @param input Repository and complete tenant scope.
   * @param records Native record-family storage.
   */
  constructor(
    private readonly input: AgentHistoryStorageInput<Id>,
    private readonly records: MysqlRecordStorage<string, AgentHistoryRecord>,
  ) {}

  /**
   * Writes one original entry or confirms byte-identical content.
   * @param entityId Typed Agent identifier.
   * @param entry Complete history entry.
   * @returns Completion after immutable storage confirms the entry.
   */
  async append(entityId: Id, entry: AgentHistoryEntry): Promise<void> {
    this.requireOpen();
    if (
      AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry)).length > AgentHistoryIndexBytes
    )
      throw new RangeError("Agent history ordering key exceeds the MySQL index capacity.");
    await this.ready();
    await this.records.writeImmutable(
      AgentHistoryRecords.record(this.input.stateType, this.key(entityId), entry),
    );
  }

  /**
   * Reads a bounded indexed page in full Timestamp/category/UTF-8 order.
   * @param request Typed Agent, view, continuation, and response limits.
   * @returns Original entries and continuation status.
   */
  async read(request: AgentHistoryRead<Id>): Promise<AgentHistoryPage> {
    this.requireOpen();
    await this.ready();
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
   * Prepares fixed composite indexes after canonical table initialization.
   * @returns Shared preparation promise for this handle.
   */
  private ready(): Promise<void> {
    return (this.#ready ??= this.initialize());
  }

  /**
   * Creates each native index idempotently on the shared record family.
   * @returns Completion after all three definitions are validated.
   */
  private async initialize(): Promise<void> {
    await this.records.prepare();
    await this.records.ensureHistoryIndex("agent_history_full", ["scope_digest", "order_key"]);
    await this.records.ensureHistoryIndex("agent_history_category", [
      "scope_digest",
      "category",
      "order_key",
    ]);
    await this.records.ensureHistoryIndex("agent_history_conversation", [
      "scope_digest",
      "conversation_digest",
      "order_key",
    ]);
  }

  /**
   * Reads a bounded native page with complete scope and view predicates.
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
    const values: (string | number)[] = [
      AgentHistoryHash.value(AgentHistoryRecords.scope(this.input.stateType, agentKey)),
      this.input.stateType,
      agentKey,
    ];
    const clauses = [
      "`scope_digest` = ?",
      "BINARY `state_type` = BINARY ?",
      "BINARY `agent_key` = BINARY ?",
    ];
    this.viewPredicate(request, clauses, values);
    if (after !== undefined) {
      values.push(after);
      clauses.push("`order_key` > ?");
    }
    values.push(limit);
    const sql =
      `SELECT \`bytes\` FROM \`${this.records.tableName}\` WHERE ${clauses.join(" AND ")} ` +
      "ORDER BY `order_key` ASC LIMIT ?";
    return this.records.historyPage(sql, values);
  }

  /**
   * Adds the indexed view predicate and exact original selector.
   * @param request Selected history view.
   * @param clauses Mutable bound SQL predicates.
   * @param values Mutable bound SQL values.
   */
  private viewPredicate(
    request: AgentHistoryRead<Id>,
    clauses: string[],
    values: (string | number)[],
  ): void {
    if (request.view.kind === "full") return;
    if (request.view.kind === "conversation") {
      const conversation = request.view.conversation.value;
      values.push(AgentHistoryHash.value(conversation));
      clauses.push("`conversation_digest` = ?");
      values.push(conversation);
      clauses.push("BINARY `conversation_key` = BINARY ?");
      return;
    }
    values.push(request.view.kind);
    clauses.push("`category` = ?");
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
}
