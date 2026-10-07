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

import { create, toBinary, type Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core";
import type { Event, EventId } from "@spine-event-engine/proto";
import type { AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import {
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentInvocationStatus,
  type AgentAcceptedInvocation,
  type AgentExecutionHead,
  type AgentExecutionRecord,
  type AgentInvocationKey,
  type AgentSignalKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { AgentHistoryRecord } from "@spine-event-engine/proto/generated/spine/server/agent/history_record_pb.js";
import {
  AgentExecutionRecords,
  AgentExecutionSizes,
  AgentExecutionTransitions,
  AgentExecutionValues,
  AgentHistoryRecords,
  type AgentExecutionStorage,
  type AgentExecutionCapacity,
  type AgentExecutionStorageInput,
  type AgentExecutionClaim,
  type AgentExecutionUpdate,
  type AgentExecutionComplete,
  type AgentPendingRead,
  type AgentPendingPage,
} from "@spine-event-engine/storage/provider";

import { AgentHistoryHash } from "./agent-history.js";
import { mysqlEntityLockKey, MysqlEntityCommitCoordinator } from "./entity-commit.js";
import { MysqlEntityStorage } from "./entity-history.js";
import { MysqlRecordStorage } from "./record-storage.js";
import { AgentExecutionIndexBytes } from "./table-spec.js";

/**
 * Native records that participate in every Agent execution transaction.
 * @typeParam I Typed entity identifier.
 * @typeParam S Generated Entity state.
 */
interface ExecutionRows<I, S extends Message> {
  readonly invocation: MysqlRecordStorage<string, AgentExecutionRecord>;
  readonly head: MysqlRecordStorage<string, AgentExecutionHead>;
  readonly history: MysqlRecordStorage<string, AgentHistoryRecord>;
  readonly entity: MysqlEntityStorage<I, S>;
  readonly events: MysqlRecordStorage<EventId, Event>;
}

/**
 * Persists Agent claims and evidence through one required InnoDB transaction.
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export class MysqlAgentExecution<I, S extends Message> implements AgentExecutionStorage<I, S> {
  /**
   * Native BLOB row limits for complete internal Protobuf wrappers.
   */
  readonly capacity: Required<
    Pick<
      AgentExecutionCapacity,
      "executionRecordBytes" | "executionHeadBytes" | "historyRecordBytes"
    >
  > = Object.freeze({
    executionRecordBytes: 65_535,
    executionHeadBytes: 65_535,
    historyRecordBytes: 65_535,
  });

  #open = true;

  #ready: Promise<void> | undefined;

  /**
   * Binds tenant-scoped record families and the native transaction coordinator.
   * @param coordinator Native transaction coordinator.
   * @param databaseName Tenant database name.
   * @param input Requested fenced execution change.
   * @param rows Provider record handles bound to the tenant.
   */
  constructor(
    private readonly input: AgentExecutionStorageInput<I, S>,
    private readonly rows: ExecutionRows<I, S>,
    private readonly coordinator: MysqlEntityCommitCoordinator,
    private readonly databaseName: string,
  ) {}

  /**
   * Persists original accepted work once under the per-instance row lock.
   * @param accepted Original accepted signal and selected bindings.
   * @returns Persisted invocation with the original accepted facts.
   */
  async admit(accepted: AgentAcceptedInvocation): Promise<AgentExecutionRecord> {
    const key = AgentExecutionValues.requiredKey(accepted.key, this.input.stateType);
    await this.ready();
    const record = create(AgentExecutionRecordSchema, {
      accepted,
      status: AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
    });
    this.validateRecord(record);
    return this.transaction(key, async () => {
      const head =
        (await this.currentHead(key)) ?? create(AgentExecutionHeadSchema, { scope: key.scope });
      const prior = await this.existing(key);
      if (prior !== undefined) {
        if (!AgentExecutionValues.sameAccepted(prior.accepted, accepted))
          throw new Error("Agent execution admission conflicts with immutable source facts.");
        return AgentExecutionValues.cloneRecord(prior);
      }
      this.offerCandidate(head, record);
      await this.rows.head.write(head);
      await this.rows.invocation.writeImmutable(record);
      return AgentExecutionValues.cloneRecord(record);
    });
  }

  /**
   * Reads one bounded page from complete native pending indexes.
   * @param request Bounded pending-page request.
   * @returns Bounded eligible work and continuation cursor.
   */
  async pending(request: AgentPendingRead): Promise<AgentPendingPage> {
    await this.ready();
    if (!Number.isSafeInteger(request.count) || request.count < 1 || request.count > 127)
      throw new RangeError("Agent pending count must be between 1 and 127.");
    const asOf = request.after?.asOf ?? Time.currentTime();
    const { sql, values } = this.pendingQuery(request, asOf);
    const found = await this.rows.head.historyPage(sql, values);
    const observed = found.slice(0, request.count);
    const records: AgentExecutionRecord[] = [];
    for (const head of observed) {
      if (head.scope?.stateType !== this.input.stateType || head.pending === undefined)
        throw new Error("MySQL Agent execution head scope or candidate is invalid.");
      const record = await this.read(head.pending);
      if (record !== undefined) records.push(record);
    }
    const last = observed.at(-1);
    return {
      records,
      hasMore: found.length > request.count,
      ...(last?.scope === undefined || last.eligibleAt === undefined
        ? {}
        : { after: { asOf, key: { scope: last.scope, eligibleAt: last.eligibleAt } } }),
    };
  }

  /**
   * Builds the indexed native query for one fixed eligibility cutoff.
   * @param request Bounded pending-page request.
   * @param asOf Fixed provider-time eligibility cutoff.
   * @returns Native SQL and exact bound values.
   */
  private pendingQuery(request: AgentPendingRead, asOf: Timestamp) {
    const after = request.after?.key;
    const values: (string | number)[] = [
      AgentHistoryHash.value(this.input.stateType),
      this.input.stateType,
      AgentExecutionRecords.pendingLower(asOf),
    ];
    const clauses = ["`state_digest`=?", "BINARY `state_type`=BINARY ?", "`pending_key`<?"];
    if (after !== undefined) {
      clauses.push("`pending_key`>?");
      values.push(AgentExecutionRecords.pendingKey(after.eligibleAt, after.scope));
    }
    values.push(request.count + 1);
    const sql =
      `SELECT \`bytes\` FROM \`${this.rows.head.tableName}\` WHERE ${clauses.join(" AND ")} ` +
      "ORDER BY `pending_key` ASC LIMIT ?";
    return { sql, values };
  }

  /**
   * Reads one complete invocation after provider reconstruction.
   * @param key Original Agent invocation identity.
   * @returns Complete stored invocation when present.
   */
  async read(key: AgentInvocationKey): Promise<AgentExecutionRecord | undefined> {
    await this.ready();
    const record = await this.rows.invocation.read(
      invocationId(AgentExecutionValues.requiredKey(key, this.input.stateType)),
    );
    this.checkIdentity(record, key);
    return record === undefined ? undefined : AgentExecutionValues.cloneRecord(record);
  }

  /**
   * Acquires earliest unresolved work and records the current exclusive token.
   * @param expiresAt Requested future lease expiry.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @returns Claimed work and preferences when eligible.
   */
  async claim(
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): Promise<AgentExecutionClaim | undefined> {
    await this.ready();
    return this.transaction(key, () => this.claimLocked(key, token, expiresAt));
  }

  /**
   * Checks the locked instance and writes one current lease.
   * @param key Original Agent invocation identity.
   * @param token New exclusive claim token.
   * @param expiresAt Requested future lease expiry.
   * @returns Claimed record and preferences when eligible.
   */
  private async claimLocked(
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): Promise<AgentExecutionClaim | undefined> {
    const now = Time.currentTime();
    if (!token || AgentExecutionValues.compareTime(expiresAt, now) <= 0)
      throw new TypeError("Agent claim requires a future expiry and token.");
    const head = await this.currentHead(key);
    const record = await this.existing(key);
    if (head === undefined || record === undefined || !AgentExecutionValues.isPending(record, now))
      return undefined;
    if (!(await this.eligibleClaim(head, key, now))) return undefined;
    record.claimToken = token;
    record.claimExpiresAt = expiresAt;
    if (record.status === AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED)
      record.status = AgentInvocationStatus.AGENT_INVOCATION_ACTIVE;
    head.active = key;
    head.claimToken = token;
    head.claimExpiresAt = expiresAt;
    head.eligibleAt = expiresAt;
    await this.rows.invocation.write(record);
    await this.rows.head.write(head);
    return {
      record: AgentExecutionValues.cloneRecord(record),
      preferences: head.preferences.map((item) => item),
    };
  }

  /**
   * Checks the current head and earliest same-instance source.
   * @param head Per-instance pending and lease record.
   * @param key Original Agent invocation identity.
   * @param now Fresh time read in the locked transaction.
   * @returns Whether this invocation may receive the next lease.
   */
  private async eligibleClaim(
    head: AgentExecutionHead,
    key: AgentInvocationKey,
    now: Timestamp,
  ): Promise<boolean> {
    if (
      head.active !== undefined &&
      head.claimExpiresAt !== undefined &&
      AgentExecutionValues.compareTime(head.claimExpiresAt, now) > 0
    )
      return false;
    return (
      head.pending !== undefined &&
      AgentExecutionRecords.invocation(head.pending) === AgentExecutionRecords.invocation(key) &&
      (await this.earliest(key))
    );
  }

  /**
   * Updates a still-live token under a fresh transaction clock.
   * @param expiresAt Requested future lease expiry.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @returns Whether the current lease was extended.
   */
  async renew(key: AgentInvocationKey, token: string, expiresAt: Timestamp): Promise<boolean> {
    await this.ready();
    return this.transaction(key, async () => {
      const pair = await this.claimed(key, token);
      if (
        pair?.record.claimExpiresAt === undefined ||
        AgentExecutionValues.compareTime(expiresAt, pair.record.claimExpiresAt) <= 0
      )
        return false;
      pair.record.claimExpiresAt = expiresAt;
      pair.head.claimExpiresAt = expiresAt;
      pair.head.eligibleAt = expiresAt;
      await this.rows.invocation.write(pair.record);
      await this.rows.head.write(pair.head);
      return true;
    });
  }

  /**
   * Persists a journal update and its immutable history under one transaction.
   * @param input Requested fenced execution change.
   * @returns Completion after fenced evidence is persisted.
   */
  async update(input: AgentExecutionUpdate): Promise<void> {
    await this.ready();
    this.validateRecord(input.next);
    await this.transaction(input.key, async () => {
      const pair = await this.expected(input);
      AgentExecutionTransitions.assertUpdate(pair.record, input.next);
      await this.appendHistory(input.key, input.historyEntries ?? []);
      await this.rows.invocation.write(input.next);
      if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_TERMINATED) {
        await this.advanceCandidate(
          pair.head,
          input.key,
          AgentExecutionValues.requiredOrder(pair.record),
        );
        await this.rows.head.write(pair.head);
      }
    });
  }

  /**
   * Commits state, history, preferences and outgoing obligations together.
   * @param input Requested fenced execution change.
   * @returns Completion after conditional Entity and evidence commit.
   */
  async complete(input: AgentExecutionComplete<I, S>): Promise<void> {
    await this.ready();
    this.validateRecord(input.next);
    await this.transaction(input.key, async () => {
      const pair = await this.expected(input);
      const expectedVersion = this.validateCompletion(input, pair.record);
      AgentExecutionTransitions.assertCompletion(input.next);
      await this.completeEntity(input, expectedVersion);
      await this.appendHistory(input.key, input.historyEntries ?? []);
      await this.rows.invocation.write(input.next);
      pair.head.preferences = AgentExecutionValues.requiredCompletion(input.next).preferences.map(
        (item) => item,
      );
      if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_COMPLETED)
        await this.advanceCandidate(
          pair.head,
          input.key,
          AgentExecutionValues.requiredOrder(pair.record),
        );
      await this.rows.head.write(pair.head);
    });
  }

  /**
   * Marks original outgoing IDs delivered under the still-current token.
   * @param expectedRecordBytes Exact prior execution record bytes.
   * @param key Original Agent invocation identity.
   * @param signals Original outgoing signal identities.
   * @param token Exclusive claim token.
   * @returns Completion after original output IDs are marked delivered.
   */
  async markDelivered(
    key: AgentInvocationKey,
    token: string,
    expectedRecordBytes: Uint8Array,
    signals: readonly AgentSignalKey[],
  ): Promise<void> {
    await this.ready();
    await this.transaction(key, () => this.deliverLocked(key, token, expectedRecordBytes, signals));
  }

  /**
   * Marks exact saved output IDs within the current per-instance transaction.
   * @param key Original Agent invocation identity.
   * @param token Current exclusive claim token.
   * @param expectedRecordBytes Exact prior execution record bytes.
   * @param signals Original accepted output IDs.
   * @returns Completion after persisted output status is updated.
   */
  private async deliverLocked(
    key: AgentInvocationKey,
    token: string,
    expectedRecordBytes: Uint8Array,
    signals: readonly AgentSignalKey[],
  ): Promise<void> {
    const pair = await this.expected(
      {
        key,
        token,
        expectedRecordBytes,
        next: create(AgentExecutionRecordSchema),
      },
      false,
    );
    if (pair.record.completion === undefined)
      throw new Error("Agent execution has no completed output.");
    AgentExecutionTransitions.assertDelivery(pair.record, signals);
    for (const signal of signals)
      AgentExecutionValues.markSignal(AgentExecutionValues.requiredCompletion(pair.record), signal);
    if (pair.record.completion.outgoing.every((item) => item.delivered)) {
      pair.record.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      await this.advanceCandidate(pair.head, key, AgentExecutionValues.requiredOrder(pair.record));
    }
    await this.rows.invocation.write(pair.record);
    await this.rows.head.write(pair.head);
  }

  /**
   * Closes record handles without deleting accepted work.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.rows.invocation.close();
    this.rows.head.close();
    this.rows.history.close();
    this.rows.entity.close();
    this.rows.events.close();
  }

  /**
   * Prepares existing record families and verifies complete binary indexes.
   * @returns Completion after provider capabilities are checked.
   */
  private ready(): Promise<void> {
    if (!this.#open) throw new Error("Agent execution storage handle is closed.");
    return (this.#ready ??= this.initialize());
  }

  /**
   * Prepares every table before transactions and checks the native indexes.
   * @returns Completion after native tables and indexes are prepared.
   */
  private async initialize(): Promise<void> {
    await Promise.all([
      this.rows.invocation.prepare(),
      this.rows.head.prepare(),
      this.rows.history.prepare(),
      this.rows.entity.prepare(),
      this.rows.events.prepare(),
    ]);
    await this.rows.head.ensureHistoryIndex("agent_execution_pending", [
      "state_digest",
      "pending_key",
    ]);
    await this.rows.invocation.ensureHistoryIndex("agent_execution_instance", [
      "scope_digest",
      "status",
      "order_key",
    ]);
  }

  /**
   * Executes all record-family work on one required InnoDB connection.
   * @param key Original Agent invocation identity.
   * @param work Operation executed inside the transaction.
   * @returns Callback result after the native transaction commits.
   * @typeParam T Result returned by the transaction callback.
   */
  private async transaction<T>(key: AgentInvocationKey, work: () => Promise<T>): Promise<T> {
    AgentExecutionValues.requiredKey(key, this.input.stateType);
    const rows = this.rows;
    const tables = [
      rows.invocation.tableName,
      rows.head.tableName,
      rows.history.tableName,
      ...rows.entity.tableNames(),
      rows.events.tableName,
    ];
    const lock = mysqlEntityLockKey({
      databaseName: this.databaseName,
      entityKey: AgentExecutionRecords.scope(AgentExecutionValues.requiredScope(key)),
      sourceTypeName: this.input.stateType,
    });
    return this.coordinator.commit(
      tables,
      lock,
      (connection) =>
        rows.invocation.withConnection(connection, () =>
          rows.head.withConnection(connection, () =>
            rows.history.withConnection(connection, () =>
              rows.entity.withConnection(connection, () =>
                rows.events.withConnection(connection, work),
              ),
            ),
          ),
        ),
      { requireTransaction: true },
    );
  }

  /**
   * Reads a head under the transaction lock and verifies the full scope.
   * @param key Original Agent invocation identity.
   * @returns Per-instance head when present.
   */
  private async currentHead(key: AgentInvocationKey): Promise<AgentExecutionHead | undefined> {
    const scope = AgentExecutionValues.requiredScope(key);
    const found = await this.rows.head.readLocked(
      AgentHistoryHash.value(AgentExecutionRecords.scope(scope)),
    );
    if (
      found !== undefined &&
      AgentExecutionRecords.scope(AgentExecutionValues.requiredHeadScope(found)) !==
        AgentExecutionRecords.scope(scope)
    )
      throw new Error("Agent execution head physical ID conflicts with another scope.");
    return found;
  }

  /**
   * Reads the invocation under the transaction lock and verifies its identity.
   * @param key Original Agent invocation identity.
   * @returns Stored invocation when present.
   */
  private async existing(key: AgentInvocationKey): Promise<AgentExecutionRecord | undefined> {
    const found = await this.rows.invocation.readLocked(invocationId(key));
    this.checkIdentity(found, key);
    return found;
  }

  /**
   * Rejects a physical digest collision on an invocation row.
   * @param found Stored record read in this transaction.
   * @param key Original Agent invocation identity.
   */
  private checkIdentity(found: AgentExecutionRecord | undefined, key: AgentInvocationKey): void {
    if (
      found !== undefined &&
      AgentExecutionRecords.invocation(
        AgentExecutionValues.requiredKey(
          AgentExecutionValues.requiredAccepted(found).key,
          this.input.stateType,
        ),
      ) !== AgentExecutionRecords.invocation(key)
    )
      throw new Error("Agent execution physical ID conflicts with another invocation.");
  }

  /**
   * Checks this is the earliest unresolved invocation in the full scope.
   * @param key Original Agent invocation identity.
   * @returns Whether this invocation is earliest unresolved work.
   */
  private async earliest(key: AgentInvocationKey): Promise<boolean> {
    const first = await this.successor(key);
    return (
      first !== undefined &&
      AgentExecutionRecords.invocation(AgentExecutionValues.requiredInvocation(first)) ===
        AgentExecutionRecords.invocation(key)
    );
  }

  /**
   * Reads at most two native rows for each unresolved status.
   * @param exclude Invocation omitted while selecting the successor.
   * @param key Original Agent invocation identity.
   * @returns Earliest unresolved invocation when present.
   */
  private async successor(
    key: AgentInvocationKey,
    exclude?: AgentInvocationKey,
  ): Promise<AgentExecutionRecord | undefined> {
    const scope = AgentExecutionValues.requiredScope(key);
    const candidates: AgentExecutionRecord[] = [];
    for (const status of ["1", "2", "3"]) {
      const sql =
        `SELECT \`bytes\` FROM \`${this.rows.invocation.tableName}\` WHERE ` +
        "`scope_digest`=? AND BINARY `state_type`=BINARY ? AND BINARY `agent_key`=BINARY ? " +
        "AND `status`=? ORDER BY `order_key` ASC LIMIT 2";
      candidates.push(
        ...(await this.rows.invocation.historyPage(sql, [
          AgentHistoryHash.value(AgentExecutionRecords.scope(scope)),
          scope.stateType,
          scope.agentKey,
          status,
        ])),
      );
    }
    return candidates
      .filter(
        (record) =>
          exclude === undefined ||
          AgentExecutionRecords.invocation(AgentExecutionValues.requiredInvocation(record)) !==
            AgentExecutionRecords.invocation(exclude),
      )
      .sort((left, right) =>
        AgentExecutionValues.compareText(
          AgentExecutionRecords.order(AgentExecutionValues.requiredOrder(left)),
          AgentExecutionRecords.order(AgentExecutionValues.requiredOrder(right)),
        ),
      )[0];
  }

  /**
   * Adds an earlier source while retaining the prior eligibility value.
   * @param head Per-instance pending and lease record.
   * @param record Persisted Agent execution record.
   */
  private offerCandidate(head: AgentExecutionHead, record: AgentExecutionRecord): void {
    AgentExecutionValues.offerCandidate(head, record);
    this.validateHead(head);
  }

  /**
   * Updates terminal work to the next same-instance source in one transaction.
   * @param head Per-instance pending and lease record.
   * @param key Original Agent invocation identity.
   * @param order Original Inbox order.
   * @returns Completion after updating the next pending head.
   */
  private async advanceCandidate(
    head: AgentExecutionHead,
    key: AgentInvocationKey,
    order: NonNullable<AgentAcceptedInvocation["order"]>,
  ): Promise<void> {
    const next = await this.successor(key, key);
    AgentExecutionValues.advanceCandidate(head, order, next);
    this.validateHead(head);
  }

  /**
   * Reads the current claim with fresh Time inside the native transaction.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @returns Current record and head if the token remains valid.
   */
  private async claimed(key: AgentInvocationKey, token: string) {
    const head = await this.currentHead(key);
    const record = await this.existing(key);
    if (
      !token ||
      head?.claimToken !== token ||
      record?.claimToken !== token ||
      head.claimExpiresAt === undefined ||
      AgentExecutionValues.compareTime(head.claimExpiresAt, Time.currentTime()) <= 0
    )
      return undefined;
    return { head, record };
  }

  /**
   * Checks exact prior bytes and preserves immutable source facts.
   * @param checkNext Whether to validate the proposed next record.
   * @param input Requested fenced execution change.
   * @returns Current fenced record and head.
   */
  private async expected(input: AgentExecutionUpdate, checkNext = true) {
    const pair = await this.claimed(input.key, input.token);
    if (
      pair === undefined ||
      !AgentExecutionValues.sameBytes(
        toBinary(AgentExecutionRecordSchema, pair.record),
        input.expectedRecordBytes,
      )
    )
      throw new Error("Agent execution claim or expected record is no longer current.");
    if (checkNext && !AgentExecutionValues.sameAccepted(pair.record.accepted, input.next.accepted))
      throw new Error("Agent execution cannot change immutable accepted source facts.");
    return pair;
  }

  /**
   * Prepares immutable history records under the same fenced transaction.
   * @param entries Immutable history entries to append.
   * @param key Original Agent invocation identity.
   * @returns Completion after immutable history is appended.
   */
  private async appendHistory(
    key: AgentInvocationKey,
    entries: readonly AgentHistoryEntry[],
  ): Promise<void> {
    const scope = AgentExecutionValues.requiredScope(key);
    for (const entry of entries)
      if (AgentExecutionSizes.history(scope, entry) > this.capacity.historyRecordBytes)
        throw new RangeError("Agent history record exceeds MySQL BLOB capacity.");
    const records = entries.map((entry) =>
      AgentHistoryRecords.record(scope.stateType, scope.agentKey, entry),
    );
    for (const record of records) await this.rows.history.assertImmutable(record);
    for (const record of records) await this.rows.history.writeImmutable(record);
  }

  /**
   * Rejects a changed initial Version and applies Entity rows in this transaction.
   * @param expectedVersion Expected current Entity Version.
   * @param input Requested fenced execution change.
   * @returns Completion after conditional Entity state and Version write.
   */
  private async completeEntity(
    input: AgentExecutionComplete<I, S>,
    expectedVersion: number,
  ): Promise<void> {
    const recipient = AgentExecutionValues.requiredAccepted(input.next).recipientId;
    const id = recipient === undefined ? undefined : this.input.entity.id.unpack(recipient);
    if (id === undefined) throw new TypeError("Agent completion recipient ID has the wrong type.");
    const current = await this.rows.entity.readCurrentLocked(id);
    if ((current?.version?.number ?? 0) !== expectedVersion)
      throw new Error("Agent execution initial Entity Version is no longer current.");
    const commit = input.entityCommit;
    if (commit === undefined) return;
    if (
      commit.entity.sourceType.typeName !== this.input.entity.sourceType.typeName ||
      this.input.entity.id.key(commit.entityId) !== this.input.entity.id.key(id)
    )
      throw new TypeError("Agent Entity commit scope differs from accepted recipient.");
    if (!this.input.entity.stateHistory && (commit.states?.length ?? 0) > 0)
      throw new Error("Agent Entity state history is disabled.");
    if (!this.input.entity.eventHistory && (commit.diagnostics?.length ?? 0) > 0)
      throw new Error("Agent Entity diagnostic history is disabled.");
    for (const state of commit.states ?? [])
      await this.rows.entity.commitCapability().appendStateImmutable(state);
    for (const diagnostic of commit.diagnostics ?? [])
      await this.rows.entity.commitCapability().appendDiagnosticImmutable(diagnostic);
    for (const event of commit.events ?? []) await this.rows.events.writeImmutable(event);
    await this.rows.entity.current.write(commit.next);
  }

  /**
   * Checks exactly one Version advance or a no-op completion.
   * @param input Requested fenced execution change.
   * @param prior Previously persisted execution record.
   * @returns Expected initial Entity Version.
   */
  private validateCompletion(
    input: AgentExecutionComplete<I, S>,
    prior: AgentExecutionRecord,
  ): number {
    const completion = input.next.completion;
    if (
      completion?.initialVersion === undefined ||
      completion.resultingVersion === undefined ||
      input.next.accepted === undefined ||
      !AgentExecutionValues.sameAccepted(prior.accepted, input.next.accepted)
    )
      throw new TypeError("Agent completion requires immutable acceptance and both Versions.");
    if (
      prior.status !== AgentInvocationStatus.AGENT_INVOCATION_ACTIVE ||
      ![
        AgentInvocationStatus.AGENT_INVOCATION_COMPLETED,
        AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY,
      ].includes(input.next.status)
    )
      throw new Error("Agent completion requires active work and completed status.");
    const initial = completion.initialVersion.number;
    const final = completion.resultingVersion.number;
    if (
      input.entityCommit === undefined
        ? final !== initial
        : final !== initial + 1 || input.entityCommit.next.version?.number !== final
    )
      throw new Error("Agent completion must commit exactly one Version or a no-op.");
    return initial;
  }

  /**
   * Rejects values outside the full InnoDB index or record payload budget.
   * @param record Persisted Agent execution record.
   */
  private validateRecord(record: AgentExecutionRecord): void {
    const key = record.accepted?.key;
    if (key?.scope === undefined || record.accepted?.order === undefined)
      throw new TypeError("Agent execution requires immutable acceptance and Inbox order.");
    if (AgentExecutionRecords.order(record.accepted.order).length > AgentExecutionIndexBytes)
      throw new RangeError("Agent execution key exceeds the complete MySQL index capacity.");
    if (AgentExecutionSizes.record(record) > this.capacity.executionRecordBytes)
      throw new RangeError("Agent execution record exceeds the MySQL BLOB capacity.");
  }

  /**
   * Checks complete indexed discovery and native record payload budgets.
   * @param head Per-instance pending and lease record.
   */
  private validateHead(head: AgentExecutionHead): void {
    if (
      head.pending !== undefined &&
      head.eligibleAt !== undefined &&
      AgentExecutionRecords.pendingKey(
        head.eligibleAt,
        AgentExecutionValues.requiredHeadScope(head),
      ).length > AgentExecutionIndexBytes
    )
      throw new RangeError("Agent head key exceeds complete MySQL index capacity.");
    if (AgentExecutionSizes.head(head) > this.capacity.executionHeadBytes)
      throw new RangeError("Agent execution head exceeds MySQL BLOB capacity.");
  }
}

/**
 * Maps a complete immutable invocation identity to one physical row.
 */
function invocationId(key: AgentInvocationKey): string {
  return AgentHistoryHash.value(AgentExecutionRecords.invocation(key));
}
