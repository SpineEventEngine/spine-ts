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

import { clone, create, toBinary, type Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core";
import { ModelPreferenceSchema, type AgentHistoryEntry } from "@spine-event-engine/proto/agent";
import {
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  AgentInvocationStatus,
  type AgentAcceptedInvocation,
  type AgentExecutionHead,
  type AgentExecutionRecord,
  type AgentInboxOrder,
  type AgentInvocationKey,
  type AgentSignalKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

import type {
  AgentExecutionClaim,
  AgentExecutionComplete,
  AgentExecutionStorage,
  AgentExecutionStorageInput,
  AgentExecutionUpdate,
  AgentPendingPage,
  AgentPendingRead,
} from "../entity/agent-execution.js";
import { TenantBoundary } from "../internal/tenancy.js";
import { AgentExecutionRecords } from "../entity/agent-execution-record-spec.js";
import { AgentExecutionTransitions } from "../entity/agent-execution-transitions.js";
import { AgentExecutionValues } from "../entity/agent-execution-values.js";
import { AgentHistoryIndex, type AgentHistoryUpdate } from "./agent-history-index.js";
import { AgentHistoryMutationQueue } from "./agent-history-mutation-queue.js";
import { MemoryPendingHeadIndex } from "./agent-execution-head-index.js";
import { InMemoryStorageBackend } from "./in-memory-storage-backend.js";
import { KeyedSerialQueue } from "./in-memory-entity-history.js";
import type { StorageFactory } from "../storage/storage-factory.js";
import { EntityCommitStorageFactories } from "../internal/entity-commit.js";
import { MemoryEntityCommitStorage } from "./in-memory-entity-commit.js";

interface MemoryExecutionState {
  readonly records: Map<string, AgentExecutionRecord>;
  readonly heads: Map<string, AgentExecutionHead>;
  readonly unresolved: Map<string, string[]>;
  readonly pending: MemoryPendingHeadIndex;
  readonly queue: KeyedSerialQueue;
  readonly history: Map<string, AgentHistoryIndex>;
  readonly historyQueue: KeyedSerialQueue;
}

const utf8 = new (
  globalThis as unknown as {
    TextEncoder: new () => {
      /**
       * Encodes a complete string as UTF-8 bytes.
       * @param value Original string.
       * @returns Exact UTF-8 byte sequence.
       */
      encode(value: string): Uint8Array;
    };
  }
).TextEncoder();

/**
 * Opens a shared in-memory execution family within a complete tenant boundary.
 */
export const MemoryAgentExecution = {
  /**
   * Opens a closeable Agent execution handle.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   * @param backend Shared memory backend.
   * @param factory Storage factory supplying Entity commits.
   * @param input Agent repository and state type.
   * @returns Closeable provider handle.
   */
  open<I, S extends Message>(
    backend: InMemoryStorageBackend,
    factory: StorageFactory,
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S> {
    const tenant = TenantBoundary.of(input.entity.context);
    const state = InMemoryStorageBackend.bind(
      backend,
      "entity",
      tenant,
      `agent-execution:${input.stateType}`,
      () =>
        ({
          records: new Map<string, AgentExecutionRecord>(),
          heads: new Map<string, AgentExecutionHead>(),
          unresolved: new Map<string, string[]>(),
          pending: new MemoryPendingHeadIndex(),
          queue: new KeyedSerialQueue(),
          historyQueue: AgentHistoryMutationQueue.bind(backend, tenant),
          history: InMemoryStorageBackend.bind(
            backend,
            "entity",
            tenant,
            `agent-history:${input.stateType}`,
            () => new Map<string, AgentHistoryIndex>(),
          ),
        }) satisfies MemoryExecutionState,
    );
    return new MemoryAgentExecutionHandle(state, factory, input);
  },
};

/**
 * Serializes Agent execution mutations against one shared memory backend.
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
class MemoryAgentExecutionHandle<I, S extends Message> implements AgentExecutionStorage<I, S> {
  #open = true;

  /**
   * Memory storage has no provider-imposed serialized row limit.
   */
  readonly capacity = Object.freeze({});

  /**
   * Binds shared execution state and existing Entity commit facilities.
   * @param state Tenant execution records and lock.
   * @param factory Existing storage factory.
   * @param input Agent repository layout.
   */
  constructor(
    private readonly state: MemoryExecutionState,
    private readonly factory: StorageFactory,
    private readonly input: AgentExecutionStorageInput<I, S>,
  ) {}

  /**
   * Persists immutable accepted work, including exact original signal bytes.
   * @param accepted Complete source envelope and handler bindings.
   * @returns Detached accepted record.
   */
  admit(accepted: AgentAcceptedInvocation): Promise<AgentExecutionRecord> {
    this.requireOpen();
    const scope = this.scope(accepted.key);
    return this.state.queue.run(scope, () => {
      this.requireOpen();
      const key = this.key(accepted.key);
      const prior = this.state.records.get(key);
      if (prior !== undefined) {
        if (!AgentExecutionValues.sameAccepted(prior.accepted, accepted))
          throw new Error("Agent execution admission conflicts with immutable source facts.");
        return AgentExecutionValues.cloneRecord(prior);
      }
      const record = create(AgentExecutionRecordSchema, {
        accepted,
        status: AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED,
      });
      this.state.records.set(key, AgentExecutionValues.cloneRecord(record));
      if (!this.state.heads.has(scope))
        this.state.heads.set(
          scope,
          create(AgentExecutionHeadSchema, {
            scope: AgentExecutionValues.require(accepted.key).scope,
          }),
        );
      this.addUnresolved(scope, key);
      this.selectCandidate(scope);
      return AgentExecutionValues.cloneRecord(record);
    });
  }

  /**
   * Returns bounded unresolved records in acceptance order.
   * @param request Complete continuation and count.
   * @returns Detached page.
   */
  pending(request: AgentPendingRead): Promise<AgentPendingPage> {
    this.requireOpen();
    if (!Number.isSafeInteger(request.count) || request.count <= 0)
      throw new RangeError("Agent pending count must be a positive safe integer.");
    if (request.count > 127) throw new RangeError("Agent pending count cannot exceed 127.");
    const asOf = request.after?.asOf ?? Time.currentTime();
    const after = request.after?.key;
    if (after !== undefined && after.scope.stateType !== this.input.stateType)
      throw new TypeError("Agent pending continuation belongs to another state type.");
    const encoded =
      after === undefined
        ? undefined
        : AgentExecutionRecords.pendingKey(after.eligibleAt, after.scope);
    const examined = this.state.pending.page(encoded, asOf, request.count);
    const observed = examined.slice(0, request.count);
    const records = observed.flatMap(({ head }) => {
      const record =
        head.pending === undefined ? undefined : this.state.records.get(this.key(head.pending));
      return record === undefined ? [] : [AgentExecutionValues.cloneRecord(record)];
    });
    const last = observed.at(-1)?.head;
    return Promise.resolve({
      records,
      ...(last?.scope === undefined || last.eligibleAt === undefined
        ? {}
        : { after: { asOf, key: { scope: last.scope, eligibleAt: last.eligibleAt } } }),
      hasMore: examined.length > request.count,
    });
  }

  /**
   * Reads one complete detached execution record.
   * @param key Original source and Agent instance key.
   * @returns Stored record if present.
   */
  read(key: AgentInvocationKey): Promise<AgentExecutionRecord | undefined> {
    this.requireOpen();
    const record = this.state.records.get(this.key(key));
    return Promise.resolve(
      record === undefined ? undefined : AgentExecutionValues.cloneRecord(record),
    );
  }

  /**
   * Acquires the earliest unresolved same-instance invocation.
   * @param key Original source and Agent instance key.
   * @param token New exclusive token.
   * @param expiresAt Requested expiry.
   * @returns Claimed record and current preferences if eligible.
   */
  claim(
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): Promise<AgentExecutionClaim | undefined> {
    this.requireOpen();
    const scope = this.scope(key);
    return this.state.queue.run(scope, () => this.claimLocked(key, token, expiresAt));
  }

  /**
   * Updates the same token before its previous expiry.
   * @param key Original source and Agent instance key.
   * @param token Existing exclusive token.
   * @param expiresAt Requested later expiry.
   * @returns Whether renewal succeeded.
   */
  renew(key: AgentInvocationKey, token: string, expiresAt: Timestamp): Promise<boolean> {
    this.requireOpen();
    const scope = this.scope(key);
    return this.state.queue.run(scope, () => {
      const record = this.requireClaim(key, token);
      if (
        record === undefined ||
        AgentExecutionValues.compareTime(
          expiresAt,
          AgentExecutionValues.require(record.claimExpiresAt),
        ) <= 0
      )
        return false;
      record.claimExpiresAt = expiresAt;
      const head = this.head(scope);
      head.claimExpiresAt = expiresAt;
      head.eligibleAt = expiresAt;
      this.state.pending.set(scope, head);
      return true;
    });
  }

  /**
   * Writes fenced journal and history changes under one memory lock.
   * @param input Expected record, next record and history entries.
   * @returns Completion after fenced evidence is persisted.
   */
  update(input: AgentExecutionUpdate): Promise<void> {
    this.requireOpen();
    const scope = this.scope(input.key);
    return this.state.queue.run(scope, () =>
      this.state.historyQueue.run(AgentExecutionValues.require(input.key.scope).agentKey, () => {
        const prior = this.checkExpected(input);
        AgentExecutionTransitions.assertUpdate(prior, input.next);
        const staged = this.stageHistory(input.key, input.historyEntries ?? []);
        const next = AgentExecutionValues.cloneRecord(input.next);
        staged?.apply();
        this.state.records.set(this.key(input.key), next);
        if (staged !== undefined)
          this.state.history.set(
            AgentExecutionValues.require(input.key.scope).agentKey,
            staged.index,
          );
        if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_TERMINATED)
          this.release(scope, input.key);
      }),
    );
  }

  /**
   * Executes one fenced completion with existing Entity commit facilities.
   * @param input Complete transition and expected execution record.
   * @returns Completion after conditional Entity and evidence commit.
   */
  complete(input: AgentExecutionComplete<I, S>): Promise<void> {
    this.requireOpen();
    const scope = this.scope(input.key);
    return this.state.queue.run(scope, () =>
      this.state.historyQueue.run(AgentExecutionValues.require(input.key.scope).agentKey, () =>
        this.completeLocked(input, scope),
      ),
    );
  }

  /**
   * Applies the conditional Entity transition and prepared execution publication.
   * @param input Requested fenced execution change.
   * @param scope Generated state type and Agent key.
   * @returns Completion after Entity and execution evidence commit.
   */
  private async completeLocked(input: AgentExecutionComplete<I, S>, scope: string): Promise<void> {
    const prior = this.checkExpected(input);
    if (prior.status !== AgentInvocationStatus.AGENT_INVOCATION_ACTIVE)
      throw new Error("Agent completion requires a prior active invocation.");
    AgentExecutionTransitions.assertCompletion(input.next);
    const expectedVersion = this.validateCompletion(input);
    const staged = this.stageHistory(input.key, input.historyEntries ?? []);
    const entityId = this.input.entity.id.unpack(
      AgentExecutionValues.require(AgentExecutionValues.require(input.next.accepted).recipientId),
    );
    if (entityId === undefined)
      throw new TypeError("Agent execution recipient ID has the wrong type.");
    const commits = EntityCommitStorageFactories.create(this.factory, this.input.entity);
    if (!(commits instanceof MemoryEntityCommitStorage))
      throw new Error("Memory Agent execution requires its memory Entity commit coordinator.");
    try {
      await commits.commitConditional(
        this.input.entity,
        entityId,
        expectedVersion,
        input.entityCommit,
        this.publication(input, scope, staged),
      );
    } finally {
      commits.close();
    }
  }

  /**
   * Validates completion status and one-version/no-op relationship.
   * @param input Requested fenced execution change.
   * @returns Expected initial Entity Version.
   */
  private validateCompletion(input: AgentExecutionComplete<I, S>): number {
    const result = input.next.completion;
    if (result?.initialVersion === undefined || result.resultingVersion === undefined)
      throw new TypeError("Agent completion requires initial and resulting Entity Versions.");
    if (
      input.next.status !== AgentInvocationStatus.AGENT_INVOCATION_COMPLETED &&
      input.next.status !== AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY
    )
      throw new TypeError("Agent completion requires a completed execution status.");
    const initial = result.initialVersion.number;
    const final = result.resultingVersion.number;
    if (
      input.entityCommit === undefined
        ? final !== initial
        : final !== initial + 1 || input.entityCommit.next.version?.number !== final
    )
      throw new Error("Agent completion must commit exactly one Version or a no-op.");
    return initial;
  }

  /**
   * Prepares execution, preference and history replacements with restoration.
   * @param input Requested fenced execution change.
   * @param scope Generated state type and Agent key.
   * @param staged Rows staged for the native transaction.
   * @returns Prepared state and history publication callback.
   */
  private publication(
    input: AgentExecutionComplete<I, S>,
    scope: string,
    staged: AgentHistoryUpdate | undefined,
  ) {
    const key = this.key(input.key);
    const historyKey = AgentExecutionValues.require(input.key.scope).agentKey;
    const prior = this.state.records.get(key);
    const priorHistory = this.state.history.get(historyKey);
    const priorHead = create(AgentExecutionHeadSchema, this.head(scope));
    const priorUnresolved = [...(this.state.unresolved.get(scope) ?? [])];
    return {
      apply: () => {
        staged?.apply();
        this.state.records.set(key, AgentExecutionValues.cloneRecord(input.next));
        if (staged !== undefined) this.state.history.set(historyKey, staged.index);
        this.head(scope).preferences = AgentExecutionValues.require(
          input.next.completion,
        ).preferences.map((item) => clone(ModelPreferenceSchema, item));
        if (input.next.status === AgentInvocationStatus.AGENT_INVOCATION_COMPLETED)
          this.release(scope, input.key);
        else this.state.pending.set(scope, this.head(scope));
      },
      restore: () => {
        staged?.restore();
        if (prior === undefined) this.state.records.delete(key);
        else this.state.records.set(key, prior);
        if (priorHistory === undefined) this.state.history.delete(historyKey);
        else this.state.history.set(historyKey, priorHistory);
        this.state.heads.set(scope, priorHead);
        this.state.unresolved.set(scope, priorUnresolved);
        this.state.pending.set(scope, priorHead);
      },
    };
  }

  /**
   * Marks original signal IDs delivered without replaying handlers.
   * @param key Original source and Agent instance key.
   * @param token Current exclusive token.
   * @param expectedRecordBytes Exact previously read record.
   * @param signals Original delivered message IDs.
   * @returns Completion after original output IDs are marked delivered.
   */
  markDelivered(
    key: AgentInvocationKey,
    token: string,
    expectedRecordBytes: Uint8Array,
    signals: readonly AgentSignalKey[],
  ): Promise<void> {
    this.requireOpen();
    const scope = this.scope(key);
    return this.state.queue.run(scope, () => {
      const record = this.requireClaim(key, token);
      if (
        record === undefined ||
        !AgentExecutionValues.sameBytes(
          toBinary(AgentExecutionRecordSchema, record),
          expectedRecordBytes,
        )
      )
        throw new Error("Agent execution claim or expected record is no longer current.");
      if (record.completion === undefined)
        throw new Error("Agent execution has no completed output.");
      AgentExecutionTransitions.assertDelivery(record, signals);
      for (const signal of signals)
        AgentExecutionValues.markSignal(AgentExecutionValues.requiredCompletion(record), signal);
      if (record.completion.outgoing.every((item) => item.delivered)) {
        record.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
        this.release(scope, key);
      }
    });
  }

  /**
   * Closes this handle without deleting backend records.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Rejects operations after handle closure.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Agent execution storage handle is closed.");
  }

  /**
   * Reads and validates the full Agent instance scope.
   * @param key Original Agent invocation identity.
   * @returns Complete encoded Agent instance scope.
   */
  private scope(key: AgentInvocationKey | undefined): string {
    if (key?.scope?.stateType !== this.input.stateType || !key.scope.agentKey)
      throw new TypeError("Agent execution requires the configured state type and Agent key.");
    return JSON.stringify([key.scope.stateType, key.scope.agentKey]);
  }

  /**
   * Encodes the original typed signal identity without an Inbox row ID.
   * @param key Original Agent invocation identity.
   * @returns Complete encoded invocation identity.
   */
  private key(key: AgentInvocationKey | undefined): string {
    const scope = this.scope(key);
    const signal = key?.sourceSignal?.id;
    if (
      signal?.case === undefined ||
      (signal.case === "command" ? !signal.value.uuid : !signal.value.value)
    )
      throw new TypeError("Agent execution requires an original Command or Event ID.");
    return JSON.stringify([
      scope,
      signal.case,
      signal.case === "command" ? signal.value.uuid : signal.value.value,
    ]);
  }

  /**
   * Reads or creates the per-instance claim and preference row.
   * @param scope Generated state type and Agent key.
   * @returns Per-instance head when present.
   */
  private head(scope: string): AgentExecutionHead {
    const head = this.state.heads.get(scope);
    if (head === undefined) throw new Error("Agent execution head is missing.");
    return head;
  }

  /**
   * Checks fresh Time and exact token after the instance lock is acquired.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @returns Current claimed record when the token is valid.
   */
  private requireClaim(key: AgentInvocationKey, token: string): AgentExecutionRecord | undefined {
    const record = this.state.records.get(this.key(key));
    const head = this.head(this.scope(key));
    const now = Time.currentTime();
    if (
      !token ||
      record?.claimToken !== token ||
      head.claimToken !== token ||
      record.claimExpiresAt === undefined ||
      AgentExecutionValues.compareTime(record.claimExpiresAt, now) <= 0
    )
      return undefined;
    return record;
  }

  /**
   * Checks the immutable read image before any state or history mutation.
   * @param input Requested fenced execution change.
   * @returns Current record after exact-byte validation.
   */
  private checkExpected(input: AgentExecutionUpdate): AgentExecutionRecord {
    const prior = this.requireClaim(input.key, input.token);
    if (
      prior === undefined ||
      !AgentExecutionValues.sameBytes(
        toBinary(AgentExecutionRecordSchema, prior),
        input.expectedRecordBytes,
      )
    )
      throw new Error("Agent execution claim or expected record is no longer current.");
    if (!AgentExecutionValues.sameAccepted(prior.accepted, input.next.accepted))
      throw new Error("Agent execution cannot change immutable accepted source facts.");
    return prior;
  }

  /**
   * Prepares immutable history rows before publishing any mutation.
   * @param entries Immutable history entries to append.
   * @param key Original Agent invocation identity.
   * @returns Staged immutable history index when entries are present.
   */
  private stageHistory(
    key: AgentInvocationKey,
    entries: readonly AgentHistoryEntry[],
  ): AgentHistoryUpdate | undefined {
    if (entries.length === 0) return undefined;
    const agentKey = AgentExecutionValues.require(key.scope).agentKey;
    return (this.state.history.get(agentKey) ?? new AgentHistoryIndex()).withEntries(entries);
  }

  /**
   * Clears a resolved invocation's claim so its next signal can run.
   * @param key Original Agent invocation identity.
   * @param scope Generated state type and Agent key.
   */
  private release(scope: string, key: AgentInvocationKey): void {
    const head = this.head(scope);
    head.active = undefined;
    head.claimToken = "";
    head.claimExpiresAt = undefined;
    head.lastResolved = this.state.records.get(this.key(key))?.accepted?.order;
    const unresolved = this.state.unresolved.get(scope) ?? [];
    this.state.unresolved.set(
      scope,
      unresolved.filter((item) => item !== this.key(key)),
    );
    this.selectCandidate(scope);
  }

  /**
   * Acquires only the earliest unresolved work for one Agent instance.
   * @param expiresAt Requested future lease expiry.
   * @param key Original Agent invocation identity.
   * @param token Exclusive claim token.
   * @returns Claimed record and preferences when eligible.
   */
  private claimLocked(
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): AgentExecutionClaim | undefined {
    this.requireOpen();
    const now = Time.currentTime();
    if (!token || AgentExecutionValues.compareTime(expiresAt, now) <= 0)
      throw new TypeError("Agent claim requires a future expiry and token.");
    const scope = this.scope(key);
    const record = this.state.records.get(this.key(key));
    if (record === undefined || !AgentExecutionValues.isPending(record, now)) return undefined;
    const head = this.head(scope);
    if (head.pending === undefined || this.key(head.pending) !== this.key(key)) return undefined;
    if (
      head.active !== undefined &&
      head.claimExpiresAt !== undefined &&
      AgentExecutionValues.compareTime(head.claimExpiresAt, now) > 0
    )
      return undefined;
    record.claimToken = token;
    record.claimExpiresAt = expiresAt;
    if (record.status === AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED)
      record.status = AgentInvocationStatus.AGENT_INVOCATION_ACTIVE;
    head.active = key;
    head.claimToken = token;
    head.claimExpiresAt = expiresAt;
    head.eligibleAt = expiresAt;
    this.state.pending.set(scope, head);
    return {
      record: AgentExecutionValues.cloneRecord(record),
      preferences: head.preferences.map((item) => clone(ModelPreferenceSchema, item)),
    };
  }

  /**
   * Adds one unresolved source in original Inbox order.
   * @param key Original Agent invocation identity.
   * @param scope Generated state type and Agent key.
   */
  private addUnresolved(scope: string, key: string): void {
    const keys = this.state.unresolved.get(scope) ?? [];
    keys.push(key);
    keys.sort((left, right) =>
      compareRecords(
        AgentExecutionValues.require(this.state.records.get(left)),
        AgentExecutionValues.require(this.state.records.get(right)),
      ),
    );
    this.state.unresolved.set(scope, keys);
  }

  /**
   * Updates the discoverable head while retaining every invocation row.
   * @param scope Generated state type and Agent key.
   */
  private selectCandidate(scope: string): void {
    const head = this.head(scope);
    const key = this.state.unresolved.get(scope)?.[0];
    const record = key === undefined ? undefined : this.state.records.get(key);
    const prior = head.pending === undefined ? undefined : this.key(head.pending);
    if (record === undefined) {
      head.pending = undefined;
      head.pendingOrder = undefined;
      head.eligibleAt = undefined;
    } else {
      head.pending = AgentExecutionValues.require(record.accepted).key;
      head.pendingOrder = AgentExecutionValues.require(record.accepted).order;
      if (prior !== key || head.eligibleAt === undefined)
        head.eligibleAt = head.active === undefined ? Time.currentTime() : head.claimExpiresAt;
    }
    this.state.pending.set(scope, head);
  }
}

/**
 * Orders by complete Inbox time, version, source signal and Agent scope.
 */
function compareRecords(left: AgentExecutionRecord, right: AgentExecutionRecord): number {
  const order = compareOrder(
    AgentExecutionValues.requiredOrder(left),
    AgentExecutionValues.requiredOrder(right),
  );
  if (order !== 0) return order;
  return compareScope(
    AgentExecutionValues.requiredScope(AgentExecutionValues.requiredInvocation(left)),
    AgentExecutionValues.requiredScope(AgentExecutionValues.requiredInvocation(right)),
  );
}

/**
 * Compares complete Inbox ordering fields without locale collation.
 */
function compareOrder(left: AgentInboxOrder, right: AgentInboxOrder): number {
  const time = AgentExecutionValues.compareTime(
    AgentExecutionValues.require(left.receivedAt),
    AgentExecutionValues.require(right.receivedAt),
  );
  if (time !== 0) return time;
  if (left.inboxVersion !== right.inboxVersion)
    return left.inboxVersion < right.inboxVersion ? -1 : 1;
  return compareSignal(
    AgentExecutionValues.require(left.sourceSignal),
    AgentExecutionValues.require(right.sourceSignal),
  );
}

/**
 * Compares full original source IDs by UTF-8 bytes.
 */
function compareSignal(left: AgentSignalKey, right: AgentSignalKey): number {
  if (left.id.case === undefined || right.id.case === undefined)
    throw new TypeError("Agent Inbox order requires typed source IDs.");
  const first = left.id.case === "command" ? `0${left.id.value.uuid}` : `1${left.id.value.value}`;
  const second =
    right.id.case === "command" ? `0${right.id.value.uuid}` : `1${right.id.value.value}`;
  return compareUtf8(first, second);
}

/**
 * Compares full Agent scope, including state type and canonical ID.
 */
function compareScope(
  left: NonNullable<AgentInvocationKey["scope"]>,
  right: NonNullable<AgentInvocationKey["scope"]>,
): number {
  return compareUtf8(left.stateType, right.stateType) || compareUtf8(left.agentKey, right.agentKey);
}

/**
 * Compares UTF-8 bytes using native binary order.
 */
function compareUtf8(left: string, right: string): number {
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i])
      return AgentExecutionValues.require(a[i]) - AgentExecutionValues.require(b[i]);
  return a.length - b.length;
}
