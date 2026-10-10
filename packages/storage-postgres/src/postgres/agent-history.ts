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

import { PostgresRecordStorage } from "./record-storage.js";

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
 * Stores Agent history in the shared PostgreSQL immutable record family.
 * @typeParam Id Typed Agent identifier.
 */
export class PostgresAgentHistory<Id> implements AgentHistoryStorage<Id> {
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
    private readonly records: PostgresRecordStorage<string, AgentHistoryRecord>,
  ) {}

  /**
   * Writes one original entry or confirms byte-identical content.
   * @param entityId Typed Agent identifier.
   * @param entry Complete history entry.
   * @returns Completion after immutable storage confirms the entry.
   */
  async append(entityId: Id, entry: AgentHistoryEntry): Promise<void> {
    this.requireOpen();
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
    const executor = this.records.historyExecutor();
    await executor.prepare();
    await executor.using(async (client) => {
      const table = executor.table();
      await this.ensureIndex(
        client,
        table,
        "agent_history_full",
        'scope_digest, order_key COLLATE "C"',
      );
      await this.ensureIndex(
        client,
        table,
        "agent_history_category",
        'scope_digest, category, order_key COLLATE "C"',
      );
      await this.ensureIndex(
        client,
        table,
        "agent_history_conversation",
        'scope_digest, conversation_digest, order_key COLLATE "C"',
      );
    });
  }

  /**
   * Rejects an existing same-name index with incomplete columns or collation.
   * @param client Acquired PostgreSQL client.
   * @param table Validated physical table name.
   * @param name Fixed required index name.
   * @param columns Required complete binary-order columns.
   * @returns Completion after the index definition is checked.
   */
  private async ensureIndex(
    client: import("pg").PoolClient,
    table: string,
    name: string,
    columns: string,
  ): Promise<void> {
    await client.query(`CREATE INDEX IF NOT EXISTS "${name}" ON ${table} (${columns})`);
    const result = await client.query<{
      definition: string;
      indisvalid: boolean;
      indisready: boolean;
    }>(
      "SELECT pg_get_indexdef(i.indexrelid) AS definition, i.indisvalid, i.indisready " +
        "FROM pg_index i " +
        "JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass($1) AND c.relname=$2",
      [table, name],
    );
    const index = result.rows[0];
    const definition = index?.definition ?? "";
    if (
      !index?.indisvalid ||
      !index.indisready ||
      !definition.includes(" USING btree ") ||
      !definition.includes(`(${columns})`) ||
      definition.includes(" WHERE ")
    )
      throw new Error("PostgreSQL Agent history index is incompatible.");
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
    const executor = this.records.historyExecutor();
    const values: (string | number)[] = [
      AgentHistoryHash.value(AgentHistoryRecords.scope(this.input.stateType, agentKey)),
      this.input.stateType,
      agentKey,
    ];
    const clauses = ['"scope_digest" = $1', '"state_type" = $2', '"agent_key" = $3'];
    this.viewPredicate(request, clauses, values);
    if (after !== undefined) {
      values.push(after);
      clauses.push(`"order_key" COLLATE "C" > $${String(values.length)}`);
    }
    values.push(limit);
    const sql =
      `SELECT "bytes" FROM ${executor.table()} WHERE ${clauses.join(" AND ")} ` +
      `ORDER BY "order_key" COLLATE "C" ASC LIMIT $${String(values.length)}`;
    return executor.using((client) => executor.query(client, sql, values));
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
      clauses.push(`"conversation_digest" = $${String(values.length)}`);
      values.push(conversation);
      clauses.push(`"conversation_key" = $${String(values.length)}`);
      return;
    }
    values.push(request.view.kind);
    clauses.push(`"category" = $${String(values.length)}`);
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
