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
import { type Event, type EventId } from "@spine-event-engine/proto";
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
  AgentExecutionSizes,
  AgentExecutionTransitions,
  AgentExecutionValues,
  AgentHistoryRecords,
  AgentHistoryKeys,
  type AgentExecutionStorage,
  type AgentExecutionCapacity,
  type AgentExecutionStorageInput,
  type AgentExecutionClaim,
  type AgentExecutionUpdate,
  type AgentExecutionComplete,
  type AgentPendingRead,
  type AgentPendingPage,
} from "@spine-event-engine/storage/provider";
import { Datastore } from "@google-cloud/datastore";

import { AgentHistoryHash } from "./agent-history.js";
import { DatastoreRecordStorage, type DatastoreRangeFilter } from "./record-storage.js";

/**
 * Existing native record families participating in one Agent transaction.
 * @typeParam I Typed entity identifier.
 */
export interface DatastoreExecutionRows<I> {
  /**
   * Mutable execution evidence.
   */
  readonly invocation: DatastoreRecordStorage<string, AgentExecutionRecord>;

  /**
   * Per-instance discovery and claim row.
   */
  readonly head: DatastoreRecordStorage<string, AgentExecutionHead>;

  /**
   * Immutable conversation, System and domain history.
   */
  readonly history: DatastoreRecordStorage<string, AgentHistoryRecord>;

  /**
   * Current Entity state and Version.
   */
  readonly current: DatastoreRecordStorage<I, EntityRecord>;

  /**
   * Optional retained state-history records.
   */
  readonly states?: DatastoreRecordStorage<unknown, EntityRecord>;

  /**
   * Optional retained diagnostic Event records.
   */
  readonly diagnostics?: DatastoreRecordStorage<unknown, Event>;

  /**
   * Canonical outgoing Event envelopes.
   */
  readonly events: DatastoreRecordStorage<EventId, Event>;
}

type Transaction = ReturnType<Datastore["transaction"]>;
type NativeRow = ReturnType<
  DatastoreRecordStorage<string, AgentExecutionRecord>["transactionEntity"]
>;

/**
 * Persists Agent execution evidence through native namespace-scoped transactions.
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export class DatastoreAgentExecution<I, S extends Message> implements AgentExecutionStorage<I, S> {
  /**
   * Entity and staged-transaction limits for complete internal Protobuf wrappers.
   */
  readonly capacity: Required<AgentExecutionCapacity> = Object.freeze({
    executionRecordBytes: 1_000_000,
    executionHeadBytes: 1_000_000,
    historyRecordBytes: 1_000_000,
    transactionPayloadBytes: 9 * 1024 * 1024,
  });

  #open = true;

  #ready: Promise<void> | undefined;

  readonly #staged = new WeakMap<Transaction, NativeRow[]>();

  /**
   * Binds one complete tenant and generated state type to native record kinds.
   * @param input Requested fenced execution change.
   * @param rows Provider record handles bound to the tenant.
   */
  constructor(
    private readonly input: AgentExecutionStorageInput<I, S>,
    private readonly rows: DatastoreExecutionRows<I>,
  ) {}

  /**
   * Persists source facts once after proving transaction-query capability.
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
    return this.transaction(async (tx) => {
      const head =
        (await this.head(tx, key)) ?? create(AgentExecutionHeadSchema, { scope: key.scope });
      const prior = await this.invocation(tx, key);
      if (prior !== undefined) {
        if (!AgentExecutionValues.sameAccepted(prior.accepted, accepted))
          throw new Error("Agent execution admission conflicts with immutable source facts.");
        return AgentExecutionValues.cloneRecord(prior);
      }
      this.offerCandidate(head, record);
      this.save(tx, this.rows.head, head);
      this.save(tx, this.rows.invocation, record);
      return AgentExecutionValues.cloneRecord(record);
    });
  }

  /**
   * Reads a bounded native head page before a fixed provider-time cutoff.
   * @param request Bounded pending-page request.
   * @returns Bounded eligible work and continuation cursor.
   */
  async pending(request: AgentPendingRead): Promise<AgentPendingPage> {
    this.requireOpen();
    if (!Number.isSafeInteger(request.count) || request.count < 1 || request.count > 127)
      throw new RangeError("Agent pending count must be between 1 and 127.");
    if (request.after !== undefined && request.after.key.scope.stateType !== this.input.stateType)
      throw new TypeError("Agent pending cursor belongs to another state type.");
    const asOf = request.after?.asOf ?? Time.currentTime();
    const page = await this.pendingHeads(request, asOf);
    const observed = page.entries.slice(0, request.count).map((item) => item.record);
    const records: AgentExecutionRecord[] = [];
    for (const head of observed) {
      if (head.scope?.stateType !== this.input.stateType || head.pending === undefined)
        throw new Error("Datastore Agent execution head scope or candidate is invalid.");
      const record = await this.read(head.pending);
      if (record !== undefined) records.push(record);
    }
    const last = observed.at(-1);
    return {
      records,
      hasMore: page.entries.length > request.count || page.hasMore,
      ...(last?.scope === undefined || last.eligibleAt === undefined
        ? {}
        : { after: { asOf, key: { scope: last.scope, eligibleAt: last.eligibleAt } } }),
    };
  }

  /**
   * Reads no more than count plus one complete native head keys.
   * @param asOf Fixed eligibility cutoff for the page.
   * @param request Bounded pending-page request.
   * @returns Bounded native page of eligible per-instance heads.
   */
  private pendingHeads(request: AgentPendingRead, asOf: Timestamp) {
    const filters: DatastoreRangeFilter[] = [
      {
        property: "state_digest",
        operator: "=",
        value: AgentHistoryHash.value(this.input.stateType),
      },
      { property: "pending_key", operator: "<", value: AgentExecutionRecords.pendingLower(asOf) },
    ];
    if (request.after !== undefined)
      filters.push({
        property: "pending_key",
        operator: ">",
        value: AgentExecutionRecords.pendingKey(
          request.after.key.eligibleAt,
          request.after.key.scope,
        ),
      });
    return this.rows.head.queryProviderPage({
      filters,
      order: [{ property: "pending_key", direction: "asc" }],
      limit: request.count + 1,
    });
  }

  /**
   * Reads one complete retained invocation after reconstruction.
   * @param key Original Agent invocation identity.
   * @returns Complete stored invocation when present.
   */
  async read(key: AgentInvocationKey): Promise<AgentExecutionRecord | undefined> {
    this.requireOpen();
    const found = await this.rows.invocation.read(
      invocationId(AgentExecutionValues.requiredKey(key, this.input.stateType)),
    );
    checkIdentity(found, key);
    return found === undefined ? undefined : AgentExecutionValues.cloneRecord(found);
  }

  /**
   * Acquires the earliest same-instance candidate with a fresh transaction clock.
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
    return this.transaction((tx) => this.claimLocked(tx, key, token, expiresAt));
  }

  /**
   * Checks the current head and invocation before writing one exclusive lease.
   * @param expiresAt Requested future lease expiry.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @param tx Native transaction that fences the change.
   * @returns Claimed record and preferences when eligible.
   */
  private async claimLocked(
    tx: Transaction,
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): Promise<AgentExecutionClaim | undefined> {
    const head = await this.head(tx, key);
    const record = await this.invocation(tx, key);
    const now = Time.currentTime();
    if (!token || AgentExecutionValues.compareTime(expiresAt, now) <= 0)
      throw new TypeError("Agent claim requires a future expiry and token.");
    if (head === undefined || record === undefined || !AgentExecutionValues.isPending(record, now))
      return undefined;
    if (!(await this.eligibleClaim(tx, head, key, now))) return undefined;
    record.claimToken = token;
    record.claimExpiresAt = expiresAt;
    if (record.status === AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED)
      record.status = AgentInvocationStatus.AGENT_INVOCATION_ACTIVE;
    head.active = key;
    head.claimToken = token;
    head.claimExpiresAt = expiresAt;
    head.eligibleAt = expiresAt;
    this.save(tx, this.rows.invocation, record);
    this.save(tx, this.rows.head, head);
    return {
      record: AgentExecutionValues.cloneRecord(record),
      preferences: head.preferences.map((item) => item),
    };
  }

  /**
   * Checks the current per-instance head and earliest unresolved source.
   * @param tx Native transaction that fences the claim.
   * @param head Per-instance pending and lease record.
   * @param key Original Agent invocation identity.
   * @param now Fresh time read inside the transaction.
   * @returns Whether this invocation may receive the next lease.
   */
  private async eligibleClaim(
    tx: Transaction,
    head: AgentExecutionHead,
    key: AgentInvocationKey,
    now: Timestamp,
  ): Promise<boolean> {
    if (
      head.pending === undefined ||
      AgentExecutionRecords.invocation(head.pending) !== AgentExecutionRecords.invocation(key) ||
      (head.active !== undefined &&
        head.claimExpiresAt !== undefined &&
        AgentExecutionValues.compareTime(head.claimExpiresAt, now) > 0)
    )
      return false;
    const first = await this.successor(tx, key);
    return (
      first !== undefined &&
      AgentExecutionRecords.invocation(AgentExecutionValues.requiredInvocation(first)) ===
        AgentExecutionRecords.invocation(key)
    );
  }

  /**
   * Updates the same live token inside a fresh native transaction.
   * @param expiresAt Requested future lease expiry.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @returns Whether the current lease was extended.
   */
  async renew(key: AgentInvocationKey, token: string, expiresAt: Timestamp): Promise<boolean> {
    await this.ready();
    return this.transaction(async (tx) => {
      const pair = await this.claimed(tx, key, token);
      if (
        pair?.record.claimExpiresAt === undefined ||
        AgentExecutionValues.compareTime(expiresAt, pair.record.claimExpiresAt) <= 0
      )
        return false;
      pair.record.claimExpiresAt = expiresAt;
      pair.head.claimExpiresAt = expiresAt;
      pair.head.eligibleAt = expiresAt;
      this.save(tx, this.rows.invocation, pair.record);
      this.save(tx, this.rows.head, pair.head);
      return true;
    });
  }

  /**
   * Persists evidence and immutable history inside one native transaction.
   * @param input Requested fenced execution change.
   * @returns Completion after fenced evidence is persisted.
   */
  async update(input: AgentExecutionUpdate): Promise<void> {
    await this.ready();
    this.validateRecord(input.next);
    await this.transaction(async (tx) => {
      const pair = await this.expected(tx, input);
      AgentExecutionTransitions.assertUpdate(pair.record, input.next);
      await this.appendHistory(tx, input.key, input.historyEntries ?? []);
      this.save(tx, this.rows.invocation, input.next);
      if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_TERMINATED) {
        await this.advance(
          tx,
          pair.head,
          input.key,
          AgentExecutionValues.requiredOrder(pair.record),
        );
        this.save(tx, this.rows.head, pair.head);
      }
    });
  }

  /**
   * Commits Entity, history, preferences and outgoing IDs together.
   * @param input Requested fenced execution change.
   * @returns Completion after conditional Entity and evidence commit.
   */
  async complete(input: AgentExecutionComplete<I, S>): Promise<void> {
    await this.ready();
    this.validateRecord(input.next);
    await this.transaction(async (tx) => {
      const pair = await this.expected(tx, input);
      const expectedVersion = this.validateCompletion(input, pair.record);
      AgentExecutionTransitions.assertCompletion(input.next);
      await this.completeEntity(tx, input, expectedVersion);
      await this.appendHistory(tx, input.key, input.historyEntries ?? []);
      pair.head.preferences = AgentExecutionValues.requiredCompletion(input.next).preferences.map(
        (item) => item,
      );
      if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_COMPLETED)
        await this.advance(
          tx,
          pair.head,
          input.key,
          AgentExecutionValues.requiredOrder(pair.record),
        );
      this.save(tx, this.rows.invocation, input.next);
      this.save(tx, this.rows.head, pair.head);
    });
  }

  /**
   * Marks original output IDs delivered without rerunning completed handlers.
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
    await this.transaction(async (tx) => {
      const pair = await this.expected(
        tx,
        { key, token, expectedRecordBytes, next: create(AgentExecutionRecordSchema) },
        false,
      );
      const completion = AgentExecutionValues.requiredCompletion(pair.record);
      AgentExecutionTransitions.assertDelivery(pair.record, signals);
      for (const signal of signals) AgentExecutionValues.markSignal(completion, signal);
      if (completion.outgoing.every((item) => item.delivered)) {
        pair.record.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
        await this.advance(tx, pair.head, key, AgentExecutionValues.requiredOrder(pair.record));
      }
      this.save(tx, this.rows.invocation, pair.record);
      this.save(tx, this.rows.head, pair.head);
    });
  }

  /**
   * Closes provider handles without deleting accepted work.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.rows.invocation.close();
    this.rows.head.close();
    this.rows.history.close();
    this.rows.current.close();
    this.rows.states?.close();
    this.rows.diagnostics?.close();
    this.rows.events.close();
  }

  /**
   * Rejects use after closure and probes native transaction-query support once.
   * @returns Completion after provider capabilities are checked.
   */
  private ready(): Promise<void> {
    this.requireOpen();
    return (this.#ready ??= this.checkCapability().catch((error: unknown) => {
      this.#ready = undefined;
      throw error;
    }));
  }

  /**
   * Checks flat scoped successor and head queries before accepting a signal.
   * @returns Completion after native query support is verified.
   */
  private async checkCapability(): Promise<void> {
    const tx = this.rows.head.transaction();
    try {
      await tx.run();
      await this.rows.invocation.queryTransactionSuccessors(
        tx,
        [
          {
            property: "scope_digest",
            operator: "=",
            value: AgentHistoryHash.value("capability-probe"),
          },
          { property: "status", operator: "=", value: "1" },
        ],
        "order_key",
      );
      await this.checkHeadCapability();
    } finally {
      await tx.rollback().catch(() => undefined);
    }
  }

  /**
   * Checks that native indexed head pagination is available.
   * @returns Completion after the indexed query succeeds.
   */
  private async checkHeadCapability(): Promise<void> {
    await this.rows.head.queryProviderPage({
      filters: [
        {
          property: "state_digest",
          operator: "=",
          value: AgentHistoryHash.value(this.input.stateType),
        },
        {
          property: "pending_key",
          operator: "<",
          value: AgentExecutionRecords.pendingLower(Time.currentTime()),
        },
      ],
      order: [{ property: "pending_key", direction: "asc" }],
      limit: 1,
    });
  }

  /**
   * Executes one namespace-scoped transaction and retries native contention.
   * @param work Operation executed inside the transaction.
   * @returns Callback result after the native transaction commits.
   * @typeParam T Result returned by the transaction callback.
   */
  private async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    this.requireOpen();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tx = this.rows.head.transaction();
      try {
        await tx.run();
        this.#staged.set(tx, []);
        const result = await work(tx);
        const staged = this.#staged.get(tx) ?? [];
        validateTransactionRows(staged);
        for (const row of staged) tx.save(row);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback().catch(() => undefined);
        if (attempt < 2 && isAborted(error)) continue;
        throw error;
      } finally {
        this.#staged.delete(tx);
      }
    }
    throw new Error("Datastore Agent transaction did not complete.");
  }

  /**
   * Reads one head by complete scope inside the active transaction.
   * @param key Original Agent invocation identity.
   * @param tx Native transaction that fences the change.
   * @returns Per-instance head when present.
   */
  private async head(
    tx: Transaction,
    key: AgentInvocationKey,
  ): Promise<AgentExecutionHead | undefined> {
    const scope = AgentExecutionValues.requiredScope(key);
    const found = await this.readRow(
      tx,
      this.rows.head,
      AgentHistoryHash.value(AgentExecutionRecords.scope(scope)),
    );
    if (
      found !== undefined &&
      AgentExecutionRecords.scope(AgentExecutionValues.requiredHeadScope(found)) !==
        AgentExecutionRecords.scope(scope)
    )
      throw new Error("Datastore Agent head physical ID conflicts with another scope.");
    return found;
  }

  /**
   * Reads one invocation by original source and complete scope.
   * @param key Original Agent invocation identity.
   * @param tx Native transaction that fences the change.
   * @returns Stored invocation when present.
   */
  private async invocation(
    tx: Transaction,
    key: AgentInvocationKey,
  ): Promise<AgentExecutionRecord | undefined> {
    const found = await this.readRow(tx, this.rows.invocation, invocationId(key));
    checkIdentity(found, key);
    return found;
  }

  /**
   * Reads a materialized key and decodes exact original Protobuf bytes.
   * @param id Complete persisted record identity.
   * @param storage Native record storage for this row.
   * @param tx Native transaction that fences the change.
   * @returns Stored typed row when present.
   * @typeParam Id Typed record identifier.
   * @typeParam R Typed persisted record.
   */
  private async readRow<Id, R extends Message>(
    tx: Transaction,
    storage: DatastoreRecordStorage<Id, R>,
    id: Id,
  ): Promise<R | undefined> {
    const raw = first(
      (await tx.get(storage.transactionKey(id), { wrapNumbers: true })) as unknown,
    ) as Record<string | symbol, unknown> | undefined;
    return raw === undefined ? undefined : storage.decodeTransactionEntity(raw);
  }

  /**
   * Queues one validated native row for the current short transaction.
   * @param record Persisted Agent execution record.
   * @param storage Native record storage for this row.
   * @param tx Native transaction that fences the change.
   * @typeParam Id Typed record identifier.
   * @typeParam R Typed persisted record.
   */
  private save<Id, R extends Message>(
    tx: Transaction,
    storage: DatastoreRecordStorage<Id, R>,
    record: R,
  ): void {
    if (record.$typeName === AgentExecutionRecordSchema.typeName)
      this.validateRecord(record as unknown as AgentExecutionRecord);
    if (record.$typeName === AgentExecutionHeadSchema.typeName)
      this.validateHead(record as unknown as AgentExecutionHead);
    const row = storage.transactionEntity(record);
    this.#staged.get(tx)?.push(row);
  }

  /**
   * Checks fresh Time, exact token, and the persisted claim image.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @param tx Native transaction that fences the change.
   * @returns Current record and head if the token remains valid.
   */
  private async claimed(tx: Transaction, key: AgentInvocationKey, token: string) {
    const head = await this.head(tx, key);
    const record = await this.invocation(tx, key);
    if (
      !token ||
      head?.claimToken !== token ||
      record?.claimToken !== token ||
      head.active === undefined ||
      AgentExecutionRecords.invocation(head.active) !== AgentExecutionRecords.invocation(key) ||
      head.claimExpiresAt === undefined ||
      AgentExecutionValues.compareTime(head.claimExpiresAt, Time.currentTime()) <= 0
    )
      return undefined;
    return { head, record };
  }

  /**
   * Checks exact prior bytes and unchanged immutable source facts.
   * @param checkNext Whether to validate the proposed next record.
   * @param input Requested fenced execution change.
   * @param tx Native transaction that fences the change.
   * @returns Current fenced record and head.
   */
  private async expected(tx: Transaction, input: AgentExecutionUpdate, checkNext = true) {
    const pair = await this.claimed(tx, input.key, input.token);
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
   * Updates the pending head for one earlier accepted source without resetting existing eligibility.
   * @param head Per-instance pending and lease record.
   * @param record Persisted Agent execution record.
   */
  private offerCandidate(head: AgentExecutionHead, record: AgentExecutionRecord): void {
    AgentExecutionValues.offerCandidate(head, record);
    this.validateHead(head);
  }

  /**
   * Reads up to two same-instance rows per unresolved status inside the transaction.
   * @param exclude Invocation omitted while selecting the successor.
   * @param key Original Agent invocation identity.
   * @param tx Native transaction that fences the change.
   * @returns Earliest unresolved invocation when present.
   */
  private async successor(
    tx: Transaction,
    key: AgentInvocationKey,
    exclude?: AgentInvocationKey,
  ): Promise<AgentExecutionRecord | undefined> {
    const scope = AgentExecutionValues.requiredScope(key);
    const records: AgentExecutionRecord[] = [];
    for (const status of ["1", "2", "3"])
      records.push(...(await this.successorsForStatus(tx, scope, status)));
    return records
      .filter(
        (record) =>
          AgentExecutionRecords.scope(
            AgentExecutionValues.requiredScope(AgentExecutionValues.requiredInvocation(record)),
          ) === AgentExecutionRecords.scope(scope) &&
          (exclude === undefined ||
            AgentExecutionRecords.invocation(AgentExecutionValues.requiredInvocation(record)) !==
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
   * Reads the first two rows of one unresolved status under the instance scope.
   * @param tx Native transaction that fences successor selection.
   * @param scope Generated state type and canonical Agent key.
   * @param status Persisted unresolved invocation status.
   * @returns Native rows in complete Inbox order.
   */
  private successorsForStatus(
    tx: Transaction,
    scope: NonNullable<AgentInvocationKey["scope"]>,
    status: string,
  ): Promise<readonly AgentExecutionRecord[]> {
    return this.rows.invocation.queryTransactionSuccessors(
      tx,
      [
        {
          property: "scope_digest",
          operator: "=",
          value: AgentHistoryHash.value(AgentExecutionRecords.scope(scope)),
        },
        { property: "status", operator: "=", value: status },
      ],
      "order_key",
    );
  }

  /**
   * Updates the next original Inbox source after terminal work.
   * @param head Per-instance pending and lease record.
   * @param key Original Agent invocation identity.
   * @param order Original Inbox order.
   * @param tx Native transaction that fences the change.
   * @returns Completion after updating the next pending head.
   */
  private async advance(
    tx: Transaction,
    head: AgentExecutionHead,
    key: AgentInvocationKey,
    order: NonNullable<AgentAcceptedInvocation["order"]>,
  ): Promise<void> {
    const next = await this.successor(tx, key, key);
    AgentExecutionValues.advanceCandidate(head, order, next);
    this.validateHead(head);
  }

  /**
   * Reads immutable history keys before queuing any transaction writes.
   * @param entries Immutable history entries to append.
   * @param key Original Agent invocation identity.
   * @param tx Native transaction that fences the change.
   * @returns Completion after immutable history is appended.
   */
  private async appendHistory(
    tx: Transaction,
    key: AgentInvocationKey,
    entries: readonly AgentHistoryEntry[],
  ): Promise<void> {
    for (const entry of entries) {
      if (AgentHistoryKeys.indexValue(AgentHistoryKeys.fromEntry(entry)).length > 1500)
        throw new RangeError("Agent history order exceeds Datastore indexed-value capacity.");
      const record = AgentHistoryRecords.record(
        AgentExecutionValues.requiredScope(key).stateType,
        AgentExecutionValues.requiredScope(key).agentKey,
        entry,
      );
      if (
        AgentExecutionSizes.history(AgentExecutionValues.requiredScope(key), entry) >
        this.capacity.historyRecordBytes
      )
        throw new RangeError("Agent history record exceeds Datastore entity payload capacity.");
      await this.immutable(tx, this.rows.history, record);
    }
  }

  /**
   * Persists one missing immutable row or rejects divergent existing bytes.
   * @param record Persisted Agent execution record.
   * @param storage Native record storage for this row.
   * @param tx Native transaction that fences the change.
   * @returns Completion after immutable row insertion or exact-byte verification.
   * @typeParam Id Typed record identifier.
   * @typeParam R Typed persisted record.
   */
  private async immutable<Id, R extends Message>(
    tx: Transaction,
    storage: DatastoreRecordStorage<Id, R>,
    record: R,
  ): Promise<void> {
    const raw = first(
      (await tx.get(storage.transactionEntity(record).key, { wrapNumbers: true })) as unknown,
    ) as Record<string | symbol, unknown> | undefined;
    if (raw === undefined) {
      this.save(tx, storage, record);
      return;
    }
    if (!storage.matchesTransactionEntity(raw, record))
      throw new Error("Immutable Agent execution record has divergent content.");
  }

  /**
   * Checks initial Version and stages Entity records in this transaction.
   * @param expected Expected current Entity Version.
   * @param input Requested fenced execution change.
   * @param tx Native transaction that fences the change.
   * @returns Completion after conditional Entity state and Version write.
   */
  private async completeEntity(
    tx: Transaction,
    input: AgentExecutionComplete<I, S>,
    expected: number,
  ): Promise<void> {
    const recipient = AgentExecutionValues.requiredAccepted(input.next).recipientId;
    const id = recipient === undefined ? undefined : this.input.entity.id.unpack(recipient);
    if (id === undefined) throw new TypeError("Agent completion recipient ID has the wrong type.");
    const current = await this.readRow(tx, this.rows.current, id);
    if ((current?.version?.number ?? 0) !== expected)
      throw new Error("Agent execution initial Entity Version is no longer current.");
    const commit = input.entityCommit;
    if (commit === undefined) return;
    this.validateEntityCommit(commit, id);
    for (const state of commit.states ?? [])
      await this.immutable(tx, requiredStorage(this.rows.states), state);
    for (const event of commit.diagnostics ?? [])
      await this.immutable(tx, requiredStorage(this.rows.diagnostics), event);
    for (const event of commit.events ?? []) await this.immutable(tx, this.rows.events, event);
    this.save(tx, this.rows.current, commit.next);
  }

  /**
   * Rejects cross-Entity completion and disabled framework histories.
   * @param commit Conditional Entity state and Version write.
   * @param id Complete persisted record identity.
   */
  private validateEntityCommit(
    commit: NonNullable<AgentExecutionComplete<I, S>["entityCommit"]>,
    id: I,
  ): void {
    if (
      commit.entity.sourceType.typeName !== this.input.entity.sourceType.typeName ||
      this.input.entity.id.key(commit.entityId) !== this.input.entity.id.key(id)
    )
      throw new TypeError("Agent Entity commit scope differs from accepted recipient.");
    if (!this.input.entity.stateHistory && (commit.states?.length ?? 0) > 0)
      throw new Error("Agent Entity state history is disabled.");
    if (!this.input.entity.eventHistory && (commit.diagnostics?.length ?? 0) > 0)
      throw new Error("Agent Entity diagnostic history is disabled.");
  }

  /**
   * Checks exactly one Version advance or an unchanged state.
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
   * Checks native indexed metadata and per-entity payload limits.
   * @param record Persisted Agent execution record.
   */
  private validateRecord(record: AgentExecutionRecord): void {
    const accepted = AgentExecutionValues.requiredAccepted(record);
    const scope = AgentExecutionValues.requiredScope(accepted.key);
    if (
      AgentExecutionRecords.order(AgentExecutionValues.requiredOrder(record)).length > 1500 ||
      Buffer.byteLength(scope.stateType, "utf8") > 1500 ||
      Buffer.byteLength(scope.agentKey, "utf8") > 1500
    )
      throw new RangeError("Agent execution indexed value exceeds Datastore capacity.");
    if (AgentExecutionSizes.record(record) > this.capacity.executionRecordBytes)
      throw new RangeError("Agent execution record exceeds Datastore entity payload capacity.");
  }

  /**
   * Checks complete head discovery key and per-entity payload limits.
   * @param head Per-instance pending and lease record.
   */
  private validateHead(head: AgentExecutionHead): void {
    if (
      head.pending !== undefined &&
      head.eligibleAt !== undefined &&
      AgentExecutionRecords.pendingKey(
        head.eligibleAt,
        AgentExecutionValues.requiredHeadScope(head),
      ).length > 1500
    )
      throw new RangeError("Agent execution head key exceeds Datastore indexed-value capacity.");
    if (AgentExecutionSizes.head(head) > this.capacity.executionHeadBytes)
      throw new RangeError("Agent execution head exceeds Datastore entity payload capacity.");
  }

  /**
   * Rejects provider calls after closure.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Agent execution storage handle is closed.");
  }
}

/**
 * Maps one complete invocation identity to a fixed physical row ID.
 */
function invocationId(key: AgentInvocationKey): string {
  return AgentHistoryHash.value(AgentExecutionRecords.invocation(key));
}

/**
 * Rejects a physical ID collision across different invocation identities.
 */
function checkIdentity(record: AgentExecutionRecord | undefined, key: AgentInvocationKey): void {
  if (
    record !== undefined &&
    AgentExecutionRecords.invocation(AgentExecutionValues.requiredInvocation(record)) !==
      AgentExecutionRecords.invocation(key)
  )
    throw new Error("Agent invocation physical ID conflicts with another source.");
}

/**
 * Returns the first native entity when Datastore returns an array.
 */
function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Requires an enabled native record handle for this Entity.
 * @typeParam I Typed entity identifier.
 * @typeParam R Typed persisted record.
 */
function requiredStorage<I, R extends Message>(
  storage: DatastoreRecordStorage<I, R> | undefined,
): DatastoreRecordStorage<I, R> {
  if (storage === undefined) throw new Error("Agent Entity history storage is disabled.");
  return storage;
}

/**
 * Checks provider mutation, entity-group and payload budgets before committing.
 */
function validateTransactionRows(rows: readonly NativeRow[]): void {
  const keys = rows.map((row) => JSON.stringify(row.key));
  if (rows.length > 500)
    throw new Error("Agent execution exceeds Datastore transaction mutation limit.");
  if (new Set(keys).size > 25)
    throw new Error("Agent execution exceeds Datastore entity-group limit.");
  const bytes = rows.reduce(
    (total, row) =>
      total +
      Buffer.byteLength(
        JSON.stringify(row.data, (_key, value: unknown) =>
          value instanceof Uint8Array
            ? Buffer.from(value).toString("base64")
            : typeof value === "bigint"
              ? value.toString()
              : value,
        ),
        "utf8",
      ),
    0,
  );
  if (bytes > 9 * 1024 * 1024)
    throw new Error("Agent execution exceeds Datastore transaction payload limit.");
}

/**
 * Identifies native write contention eligible for a bounded retry.
 */
function isAborted(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === 10;
}
