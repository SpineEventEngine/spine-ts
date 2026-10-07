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
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  AgentExecutionRecords,
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
import type { PoolClient } from "pg";

import { AgentHistoryHash } from "./agent-history.js";
import { PostgresRecordStorage, type PostgresRecordExecutor } from "./record-storage.js";
import { PostgresEntityCommitStorage } from "./entity-commit.js";

/**
 * PostgreSQL record families participating in one Agent execution transaction.
 */
interface ExecutionRows {
  readonly invocation: PostgresRecordExecutor<string, AgentExecutionRecord>;
  readonly head: PostgresRecordExecutor<string, AgentExecutionHead>;
  readonly history: PostgresRecordExecutor<string, AgentHistoryRecord>;
}

/**
 * Persists accepted Agent work, exclusive claims and deterministic evidence.
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export class PostgresAgentExecution<I, S extends Message> implements AgentExecutionStorage<I, S> {
  #open = true;

  #ready: Promise<void> | undefined;

  /**
   * PostgreSQL has no tighter fixed row limit in this provider contract.
   */
  readonly capacity: AgentExecutionCapacity = Object.freeze({});

  /**
   * Binds prepared record families to one Agent repository and tenant boundary.
   * @param input Agent repository and current Entity layout.
   * @param invocation Mutable invocation records.
   * @param head Per-instance claim and current preference records.
   * @param history Immutable Agent conversation, System and domain entries.
   * @param current Existing Entity current records used for no-op version checks.
   * @param commits Opens the existing conditional Entity commit coordinator.
   */
  constructor(
    private readonly input: AgentExecutionStorageInput<I, S>,
    private readonly invocation: PostgresRecordStorage<string, AgentExecutionRecord>,
    private readonly head: PostgresRecordStorage<string, AgentExecutionHead>,
    private readonly history: PostgresRecordStorage<string, AgentHistoryRecord>,
    private readonly current: PostgresRecordStorage<I, EntityRecord>,
    private readonly commits: () => PostgresEntityCommitStorage<I, S>,
  ) {}

  /**
   * Persists original accepted work idempotently under its per-instance lock.
   * @param accepted Complete source signal and selected bindings.
   * @returns Detached stored invocation.
   */
  async admit(accepted: AgentAcceptedInvocation): Promise<AgentExecutionRecord> {
    this.requireOpen();
    const rows = await this.ready();
    const key = AgentExecutionValues.requiredKey(accepted.key, this.input.stateType);
    return rows.head.transaction(async (client) => {
      await this.lockHead(client, rows, key);
      const prior = await this.existing(client, rows, key);
      if (prior !== undefined) {
        if (!AgentExecutionValues.sameAccepted(prior.accepted, accepted))
          throw new Error("Agent execution admission conflicts with immutable source facts.");
        return AgentExecutionValues.cloneRecord(prior);
      }
      const record = create(AgentExecutionRecordSchema, {
        accepted,
        status: AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
      });
      const head =
        (await this.currentHead(client, rows, key)) ??
        create(AgentExecutionHeadSchema, { scope: key.scope });
      this.offerCandidate(head, record);
      await rows.head.write(client, head);
      await rows.invocation.appendImmutable(client, record);
      return AgentExecutionValues.cloneRecord(record);
    });
  }

  /**
   * Reads a bounded indexed page of eligible accepted or interrupted work.
   * @param request Complete continuation and page count.
   * @returns Detached records and continuation state.
   */
  async pending(request: AgentPendingRead): Promise<AgentPendingPage> {
    this.requireOpen();
    const rows = await this.ready();
    if (!Number.isSafeInteger(request.count) || request.count < 1 || request.count > 127)
      throw new RangeError("Agent pending count must be between 1 and 127.");
    const asOf = request.after?.asOf ?? Time.currentTime();
    const { sql, values } = this.pendingQuery(request, asOf, rows.head.table());
    return rows.head.using(async (client) => {
      const found = await rows.head.query(client, sql, values);
      const observed = found.slice(0, request.count);
      const records = [] as AgentExecutionRecord[];
      for (const head of observed) {
        if (head.scope?.stateType !== this.input.stateType || head.pending === undefined)
          throw new Error("PostgreSQL Agent execution head scope or candidate is invalid.");
        const record = await this.existing(client, rows, head.pending);
        if (record !== undefined) records.push(AgentExecutionValues.cloneRecord(record));
      }
      const last = observed.at(-1);
      return {
        records,
        hasMore: found.length > request.count,
        ...(last?.scope === undefined || last.eligibleAt === undefined
          ? {}
          : { after: { asOf, key: { scope: last.scope, eligibleAt: last.eligibleAt } } }),
      };
    });
  }

  /**
   * Builds one binary-collated native pending-head query.
   * @param request Bounded pending-page request.
   * @param asOf Fixed provider-time eligibility cutoff.
   * @param table Resolved head table in the current schema.
   * @returns Native SQL and exact bound values.
   */
  private pendingQuery(request: AgentPendingRead, asOf: Timestamp, table: string) {
    const values: (string | number)[] = [
      AgentHistoryHash.value(this.input.stateType),
      this.input.stateType,
      AgentExecutionRecords.pendingLower(asOf),
    ];
    const where = ['"state_digest" = $1', '"state_type" = $2', '"pending_key" COLLATE "C" < $3'];
    if (request.after !== undefined) {
      values.push(
        AgentExecutionRecords.pendingKey(request.after.key.eligibleAt, request.after.key.scope),
      );
      where.push(`"pending_key" COLLATE "C" > $${String(values.length)}`);
    }
    values.push(request.count + 1);
    const sql =
      `SELECT "bytes" FROM ${table} WHERE ${where.join(" AND ")} ` +
      `ORDER BY "pending_key" COLLATE "C" LIMIT $${String(values.length)}`;
    return { sql, values };
  }

  /**
   * Reads one complete persisted invocation.
   * @param key Original source and Agent instance identity.
   * @returns Detached record if present.
   */
  async read(key: AgentInvocationKey): Promise<AgentExecutionRecord | undefined> {
    this.requireOpen();
    const rows = await this.ready();
    AgentExecutionValues.requiredKey(key, this.input.stateType);
    return rows.invocation.using(async (client) => {
      const found = await this.existing(client, rows, key);
      return found === undefined ? undefined : AgentExecutionValues.cloneRecord(found);
    });
  }

  /**
   * Acquires only earliest unresolved same-instance work under a fresh transaction clock.
   * @param key Original source and Agent instance identity.
   * @param token New exclusive token.
   * @param expiresAt Requested future expiry.
   * @returns Claimed record and current preferences, when eligible.
   */
  async claim(
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): Promise<AgentExecutionClaim | undefined> {
    this.requireOpen();
    const rows = await this.ready();
    AgentExecutionValues.requiredKey(key, this.input.stateType);
    return rows.head.transaction(async (client) => {
      await this.lockHead(client, rows, key);
      return this.claimLocked(client, rows, key, token, expiresAt);
    });
  }

  /**
   * Checks the locked instance and persists one exclusive lease.
   * @param client Native client in the current transaction.
   * @param rows Tenant record executors.
   * @param key Original Agent invocation identity.
   * @param token New exclusive token.
   * @param expiresAt Requested future lease expiry.
   * @returns Claimed record and preferences when eligible.
   */
  private async claimLocked(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): Promise<AgentExecutionClaim | undefined> {
    const now = Time.currentTime();
    if (!token || AgentExecutionValues.compareTime(expiresAt, now) <= 0)
      throw new TypeError("Agent claim requires a future expiry and token.");
    const head = await this.currentHead(client, rows, key);
    const record = await this.existing(client, rows, key);
    if (head === undefined || record === undefined || !AgentExecutionValues.isPending(record, now))
      return undefined;
    if (!(await this.eligibleClaim(client, rows, head, key, now))) return undefined;
    record.claimToken = token;
    record.claimExpiresAt = expiresAt;
    if (record.status === AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED)
      record.status = AgentInvocationStatus.AGENT_INVOCATION_ACTIVE;
    head.active = key;
    head.claimToken = token;
    head.claimExpiresAt = expiresAt;
    head.eligibleAt = expiresAt;
    await rows.invocation.write(client, record);
    await rows.head.write(client, head);
    return {
      record: AgentExecutionValues.cloneRecord(record),
      preferences: head.preferences.map((item) => item),
    };
  }

  /**
   * Checks the current head and earliest same-instance source.
   * @param client Native client in the current transaction.
   * @param rows Tenant record executors.
   * @param head Per-instance pending and lease record.
   * @param key Original Agent invocation identity.
   * @param now Fresh time read under the per-instance lock.
   * @returns Whether this invocation may receive the next lease.
   */
  private async eligibleClaim(
    client: PoolClient,
    rows: ExecutionRows,
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
      (await this.earliest(client, rows, key))
    );
  }

  /**
   * Updates one still-current lease under the per-instance transaction lock.
   * @param key Original source and Agent instance identity.
   * @param token Current exclusive token.
   * @param expiresAt Requested later expiry.
   * @returns Whether renewal succeeded.
   */
  async renew(key: AgentInvocationKey, token: string, expiresAt: Timestamp): Promise<boolean> {
    this.requireOpen();
    const rows = await this.ready();
    return rows.head.transaction(async (client) => {
      await this.lockHead(client, rows, key);
      const pair = await this.claimed(client, rows, key, token);
      if (
        pair?.record.claimExpiresAt === undefined ||
        AgentExecutionValues.compareTime(expiresAt, pair.record.claimExpiresAt) <= 0
      )
        return false;
      pair.record.claimExpiresAt = expiresAt;
      pair.head.claimExpiresAt = expiresAt;
      pair.head.eligibleAt = expiresAt;
      await rows.invocation.write(client, pair.record);
      await rows.head.write(client, pair.head);
      return true;
    });
  }

  /**
   * Persists one execution update and its immutable history rows in the same transaction.
   * @param input Exact read image, next execution record and history entries.
   * @returns Completion after fenced evidence is persisted.
   */
  async update(input: AgentExecutionUpdate): Promise<void> {
    this.requireOpen();
    const rows = await this.ready();
    await rows.head.transaction(async (client) => {
      await this.lockHead(client, rows, input.key);
      const pair = await this.expected(client, rows, input);
      AgentExecutionTransitions.assertUpdate(pair.record, input.next);
      for (const entry of input.historyEntries ?? [])
        await rows.history.assertImmutable(client, historyRecord(input.key, entry));
      for (const entry of input.historyEntries ?? [])
        await rows.history.appendImmutable(client, historyRecord(input.key, entry));
      await rows.invocation.write(client, input.next);
      if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_TERMINATED) {
        await this.advanceCandidate(
          client,
          rows,
          pair.head,
          input.key,
          AgentExecutionValues.requiredOrder(pair.record),
        );
        await rows.head.write(client, pair.head);
      }
    });
  }

  /**
   * Commits Entity state, history, preferences and outgoing obligations together.
   * @param input Complete conditional transition.
   * @returns Completion after conditional Entity and evidence commit.
   */
  async complete(input: AgentExecutionComplete<I, S>): Promise<void> {
    this.requireOpen();
    const rows = await this.ready();
    const coordinator = input.entityCommit === undefined ? undefined : this.commits();
    const prepared =
      input.entityCommit === undefined
        ? undefined
        : await AgentExecutionValues.require(coordinator).prepareConditional(input.entityCommit);
    try {
      await rows.head.transaction((client) => this.completeLocked(client, rows, input, prepared));
    } finally {
      prepared?.close();
      coordinator?.close();
    }
  }

  /**
   * Applies every conditional completion row on one transaction client.
   * @param client Native database client in the current transaction.
   * @param input Requested fenced execution change.
   * @param prepared Prepared Entity state and Version write.
   * @param rows Provider record handles bound to the tenant.
   * @returns Completion after Entity and execution evidence commit.
   */
  private async completeLocked(
    client: PoolClient,
    rows: ExecutionRows,
    input: AgentExecutionComplete<I, S>,
    prepared:
      Awaited<ReturnType<PostgresEntityCommitStorage<I, S>["prepareConditional"]>> | undefined,
  ): Promise<void> {
    await this.lockHead(client, rows, input.key);
    const pair = await this.expected(client, rows, input);
    const expectedVersion = this.validateCompletion(input, pair.record);
    AgentExecutionTransitions.assertCompletion(input.next);
    await this.completeEntity(client, input, expectedVersion, prepared);
    for (const entry of input.historyEntries ?? [])
      await rows.history.appendImmutable(client, historyRecord(input.key, entry));
    await rows.invocation.write(client, input.next);
    pair.head.preferences = AgentExecutionValues.require(input.next.completion).preferences.map(
      (item) => item,
    );
    if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_COMPLETED)
      await this.advanceCandidate(
        client,
        rows,
        pair.head,
        input.key,
        AgentExecutionValues.requiredOrder(pair.record),
      );
    await rows.head.write(client, pair.head);
  }

  /**
   * Validates one Version increment or no-op and a nonterminal prior phase.
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
   * Marks original outgoing IDs accepted by normal delivery.
   * @param key Original source and Agent instance identity.
   * @param token Current exclusive token.
   * @param expectedRecordBytes Exact previous record bytes.
   * @param signals Original accepted output IDs.
   * @returns Completion after original output IDs are marked delivered.
   */
  async markDelivered(
    key: AgentInvocationKey,
    token: string,
    expectedRecordBytes: Uint8Array,
    signals: readonly AgentSignalKey[],
  ): Promise<void> {
    this.requireOpen();
    const rows = await this.ready();
    await rows.head.transaction(async (client) => {
      await this.lockHead(client, rows, key);
      await this.deliverLocked(client, rows, key, token, expectedRecordBytes, signals);
    });
  }

  /**
   * Marks original output IDs while the per-instance native lock is held.
   * @param client Native client in the current transaction.
   * @param rows Tenant record executors.
   * @param key Original Agent invocation identity.
   * @param token Current exclusive claim token.
   * @param expectedRecordBytes Exact prior execution record bytes.
   * @param signals Original accepted output IDs.
   * @returns Completion after persisted output status is updated.
   */
  private async deliverLocked(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
    token: string,
    expectedRecordBytes: Uint8Array,
    signals: readonly AgentSignalKey[],
  ): Promise<void> {
    const pair = await this.expected(
      client,
      rows,
      { key, token, expectedRecordBytes, next: create(AgentExecutionRecordSchema) },
      false,
    );
    if (pair.record.completion === undefined)
      throw new Error("Agent execution has no completed output.");
    AgentExecutionTransitions.assertDelivery(pair.record, signals);
    for (const signal of signals)
      AgentExecutionValues.markSignal(AgentExecutionValues.requiredCompletion(pair.record), signal);
    if (pair.record.completion.outgoing.every((item) => item.delivered)) {
      pair.record.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
      await this.advanceCandidate(
        client,
        rows,
        pair.head,
        key,
        AgentExecutionValues.requiredOrder(pair.record),
      );
    }
    await rows.invocation.write(client, pair.record);
    await rows.head.write(client, pair.head);
  }

  /**
   * Closes all provider record handles without deleting persisted work.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.invocation.close();
    this.head.close();
    this.history.close();
    this.current.close();
  }

  /**
   * Rejects calls after handle closure.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Agent execution storage handle is closed.");
  }

  /**
   * Prepares three existing record families and required native indexes once.
   * @returns Completion after provider capabilities are checked.
   */
  private ready(): Promise<ExecutionRows> {
    this.requireOpen();
    return (this.#ready ??= this.initialize()).then(() => ({
      invocation: this.invocation.historyExecutor(),
      head: this.head.historyExecutor(),
      history: this.history.historyExecutor(),
    }));
  }

  /**
   * Ensures full scoped order and expiry indexes before accepted work.
   * @returns Completion after native tables and indexes are prepared.
   */
  private async initialize(): Promise<void> {
    const rows = [this.invocation, this.head, this.history, this.current].map((storage) =>
      storage.historyExecutor(),
    );
    for (const row of rows) await row.prepare();
    const invocation = this.invocation.historyExecutor();
    await invocation.using(async (client) => {
      await ensureIndex(
        client,
        this.head.historyExecutor().table(),
        "agent_execution_pending",
        'state_digest, pending_key COLLATE "C"',
      );
      await ensureIndex(
        client,
        invocation.table(),
        "agent_execution_instance",
        'scope_digest, status, order_key COLLATE "C"',
      );
    });
  }

  /**
   * Acquires a transaction-scoped lock even when the head row is absent.
   * @param client Native database client in the current transaction.
   * @param key Original Agent invocation identity.
   * @param rows Provider record handles bound to the tenant.
   * @returns Completion after locking the per-instance head.
   */
  private async lockHead(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
  ): Promise<void> {
    const scope = AgentExecutionRecords.scope(
      AgentExecutionValues.require(
        AgentExecutionValues.requiredKey(key, this.input.stateType).scope,
      ),
    );
    await client.query("SELECT pg_advisory_xact_lock($1)", [rows.head.lock("agent-head", scope)]);
  }

  /**
   * Reads one head and rejects a physical digest collision.
   * @param client Native database client in the current transaction.
   * @param key Original Agent invocation identity.
   * @param rows Provider record handles bound to the tenant.
   * @returns Per-instance head when present.
   */
  private async currentHead(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
  ): Promise<AgentExecutionHead | undefined> {
    const scope = AgentExecutionValues.require(
      AgentExecutionValues.requiredKey(key, this.input.stateType).scope,
    );
    const found = await rows.head.read(
      client,
      AgentHistoryHash.value(AgentExecutionRecords.scope(scope)),
      "for-update",
    );
    if (
      found !== undefined &&
      AgentExecutionRecords.scope(AgentExecutionValues.require(found.scope)) !==
        AgentExecutionRecords.scope(scope)
    )
      throw new Error("Agent execution head physical ID conflicts with another scope.");
    return found;
  }

  /**
   * Reads one invocation and rejects a physical digest collision.
   * @param client Native database client in the current transaction.
   * @param key Original Agent invocation identity.
   * @param rows Provider record handles bound to the tenant.
   * @returns Stored invocation when present.
   */
  private async existing(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
  ): Promise<AgentExecutionRecord | undefined> {
    const id = AgentHistoryHash.value(
      AgentExecutionRecords.invocation(AgentExecutionValues.requiredKey(key, this.input.stateType)),
    );
    const found = await rows.invocation.read(client, id, "for-update");
    if (
      found !== undefined &&
      AgentExecutionRecords.invocation(AgentExecutionValues.requiredInvocation(found)) !==
        AgentExecutionRecords.invocation(key)
    )
      throw new Error("Agent execution physical ID conflicts with another invocation.");
    return found;
  }

  /**
   * Checks fresh Time, exact token and complete previous record bytes.
   * @param checkNext Whether to validate the proposed next record.
   * @param client Native database client in the current transaction.
   * @param input Requested fenced execution change.
   * @param rows Provider record handles bound to the tenant.
   * @returns Current fenced record and head.
   */
  private async expected(
    client: PoolClient,
    rows: ExecutionRows,
    input: AgentExecutionUpdate,
    checkNext = true,
  ) {
    const pair = await this.claimed(client, rows, input.key, input.token);
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
   * Reads claimed rows under the already acquired per-instance lock.
   * @param client Native database client in the current transaction.
   * @param key Original Agent invocation identity.
   * @param rows Provider record handles bound to the tenant.
   * @param token Exclusive claim token.
   * @returns Current record and head if the token remains valid.
   */
  private async claimed(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
    token: string,
  ) {
    const head = await this.currentHead(client, rows, key);
    const record = await this.existing(client, rows, key);
    const now = Time.currentTime();
    if (
      !token ||
      head?.claimToken !== token ||
      record?.claimToken !== token ||
      head.claimExpiresAt === undefined ||
      AgentExecutionValues.compareTime(head.claimExpiresAt, now) <= 0
    )
      return undefined;
    return { head, record };
  }

  /**
   * Checks no earlier unresolved signal in the same full Agent scope.
   * @param client Native database client in the current transaction.
   * @param key Original Agent invocation identity.
   * @param rows Provider record handles bound to the tenant.
   * @returns Whether this invocation is earliest unresolved work.
   */
  private async earliest(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
  ): Promise<boolean> {
    const first = await this.successor(client, rows, key);
    return (
      first !== undefined &&
      AgentExecutionRecords.invocation(AgentExecutionValues.requiredInvocation(first)) ===
        AgentExecutionRecords.invocation(key)
    );
  }

  /**
   * Adds an earlier accepted source without resetting an existing eligibility.
   * @param head Per-instance pending and lease record.
   * @param record Persisted Agent execution record.
   */
  private offerCandidate(head: AgentExecutionHead, record: AgentExecutionRecord): void {
    AgentExecutionValues.offerCandidate(head, record);
  }

  /**
   * Updates the head to one bounded native successor before terminal publication.
   * @param client Native database client in the current transaction.
   * @param head Per-instance pending and lease record.
   * @param key Original Agent invocation identity.
   * @param order Original Inbox order.
   * @param rows Provider record handles bound to the tenant.
   * @returns Completion after updating the next pending head.
   */
  private async advanceCandidate(
    client: PoolClient,
    rows: ExecutionRows,
    head: AgentExecutionHead,
    key: AgentInvocationKey,
    order: NonNullable<AgentAcceptedInvocation["order"]>,
  ): Promise<void> {
    const next = await this.successor(client, rows, key, key);
    AgentExecutionValues.advanceCandidate(head, order, next);
  }

  /**
   * Reads at most two rows per unresolved status in original Inbox order.
   * @param client Native database client in the current transaction.
   * @param exclude Invocation omitted while selecting the successor.
   * @param key Original Agent invocation identity.
   * @param rows Provider record handles bound to the tenant.
   * @returns Earliest unresolved invocation when present.
   */
  private async successor(
    client: PoolClient,
    rows: ExecutionRows,
    key: AgentInvocationKey,
    exclude?: AgentInvocationKey,
  ): Promise<AgentExecutionRecord | undefined> {
    const scope = AgentExecutionValues.require(key.scope);
    const candidates: AgentExecutionRecord[] = [];
    for (const status of ["1", "2", "3"]) {
      const sql = this.successorSql(rows.invocation.table());
      candidates.push(
        ...(await rows.invocation.query(client, sql, [
          AgentHistoryHash.value(AgentExecutionRecords.scope(scope)),
          scope.stateType,
          scope.agentKey,
          status,
        ])),
      );
    }
    return candidates
      .filter(
        (item) =>
          item.accepted?.key !== undefined &&
          (exclude === undefined ||
            AgentExecutionRecords.invocation(item.accepted.key) !==
              AgentExecutionRecords.invocation(exclude)),
      )
      .sort((left, right) =>
        AgentExecutionValues.compareText(
          AgentExecutionRecords.order(AgentExecutionValues.requiredOrder(left)),
          AgentExecutionRecords.order(AgentExecutionValues.requiredOrder(right)),
        ),
      )[0];
  }

  /**
   * Builds the bounded native query for one unresolved invocation status.
   * @param table Resolved invocation table in the current schema.
   * @returns Complete indexed successor query.
   */
  private successorSql(table: string): string {
    return (
      `SELECT "bytes" FROM ${table} WHERE "scope_digest"=$1 ` +
      'AND "state_type"=$2 AND "agent_key"=$3 AND "status"=$4 ' +
      'ORDER BY "order_key" COLLATE "C" LIMIT 2'
    );
  }

  /**
   * Validates current Version and applies optional Entity rows in this transaction.
   * @param client Native database client in the current transaction.
   * @param expectedVersion Expected current Entity Version.
   * @param input Requested fenced execution change.
   * @param prepared Prepared Entity state and Version write.
   * @returns Completion after conditional Entity state and Version write.
   */
  private async completeEntity(
    client: PoolClient,
    input: AgentExecutionComplete<I, S>,
    expectedVersion: number,
    prepared:
      Awaited<ReturnType<PostgresEntityCommitStorage<I, S>["prepareConditional"]>> | undefined,
  ): Promise<void> {
    if (prepared !== undefined) {
      await prepared.apply(client, expectedVersion);
      return;
    }
    const recipient = AgentExecutionValues.require(input.next.accepted).recipientId;
    const id = recipient === undefined ? undefined : this.input.entity.id.unpack(recipient);
    if (id === undefined) throw new TypeError("Agent completion recipient ID has the wrong type.");
    const current = await this.current.historyExecutor().read(client, id, "for-update");
    if ((current?.version?.number ?? 0) !== expectedVersion)
      throw new Error("Agent execution initial Entity Version is no longer current.");
  }
}

/**
 * Wraps original Agent history without changing its category or identity.
 */
function historyRecord(key: AgentInvocationKey, entry: AgentHistoryEntry): AgentHistoryRecord {
  return AgentHistoryRecords.record(
    AgentExecutionValues.require(key.scope).stateType,
    AgentExecutionValues.require(key.scope).agentKey,
    entry,
  );
}

/**
 * Creates and validates one required fixed PostgreSQL composite index.
 */
async function ensureIndex(
  client: PoolClient,
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
      "FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid " +
      "WHERE i.indrelid=to_regclass($1) AND c.relname=$2",
    [table, name],
  );
  const index = result.rows[0];
  if (
    !index?.indisvalid ||
    !index.indisready ||
    !index.definition.includes(`(${columns})`) ||
    !index.definition.includes(" USING btree ") ||
    index.definition.includes(" WHERE ")
  )
    throw new Error("PostgreSQL Agent execution index is incompatible.");
}
