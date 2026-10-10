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

import type { Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { AgentHistoryEntry, ModelPreference } from "@spine-event-engine/proto/agent";
import type {
  AgentAcceptedInvocation,
  AgentExecutionRecord,
  AgentExecutionScope,
  AgentInvocationKey,
  AgentSignalKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

import type { EntityCommitInput } from "../internal/entity-commit.js";
import type { EntityStorageInput } from "../internal/entity-history.js";

/**
 * Defines one Agent repository scope for a provider handle.
 *
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export interface AgentExecutionStorageInput<I, S extends Message> {
  /**
   * Entity layout and complete tenant boundary used by conditional completion.
   */
  readonly entity: EntityStorageInput<I, S>;

  /**
   * Generated Agent state type named in every execution scope.
   */
  readonly stateType: string;
}

/**
 * Selects a bounded page of provider-observed candidate heads in one Agent state type.
 */
export interface AgentPendingRead {
  /**
   * Provider-observed continuation and fixed time boundary from the preceding page.
   */
  readonly after?: AgentPendingCursor;

  /**
   * Maximum number of observed candidates returned.
   */
  readonly count: number;
}

/**
 * Orders observed candidate heads without allocating a history position.
 */
export interface AgentPendingKey {
  /**
   * Complete Agent instance identity.
   */
  readonly scope: AgentExecutionScope;

  /**
   * Provider time at which this instance became eligible.
   */
  readonly eligibleAt: Timestamp;
}

/**
 * Fixed sweep time and complete index key observed by a provider page.
 */
export interface AgentPendingCursor {
  /**
   * Time sampled once when the sweep began.
   */
  readonly asOf: Timestamp;

  /**
   * Last examined head index key, before any concurrent mutation.
   */
  readonly key: AgentPendingKey;
}

/**
 * Returns detached records for observed candidates and their continuation.
 * A concurrent mutation can make a record stale; claim decides whether work is current.
 */
export interface AgentPendingPage {
  /**
   * Candidate records observed through the pending-head index.
   */
  readonly records: readonly AgentExecutionRecord[];

  /**
   * Last examined provider index key; advance it even when no claim succeeds.
   */
  readonly after?: AgentPendingCursor;

  /**
   * Whether another indexed candidate was observed during this page read.
   */
  readonly hasMore: boolean;
}

/**
 * Provides a claimed record and queryable current model preferences.
 */
export interface AgentExecutionClaim {
  /**
   * Complete claimed execution record.
   */
  readonly record: AgentExecutionRecord;

  /**
   * Current per-instance preferences at the claim boundary.
   */
  readonly preferences: readonly ModelPreference[];
}

/**
 * Replaces one fenced execution record and appends its conversation or System history.
 */
export interface AgentExecutionUpdate {
  /**
   * Exact accepted invocation identity.
   */
  readonly key: AgentInvocationKey;

  /**
   * Exclusive token granted by the current per-instance claim.
   */
  readonly token: string;

  /**
   * Exact binary image read before constructing this update.
   */
  readonly expectedRecordBytes: Uint8Array;

  /**
   * Complete next record with immutable acceptance unchanged.
   */
  readonly next: AgentExecutionRecord;

  /**
   * Original conversation or System entries committed with the journal.
   */
  readonly historyEntries?: readonly AgentHistoryEntry[];
}

/**
 * Commits an Agent transition and its fenced execution record together.
 *
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export interface AgentExecutionComplete<I, S extends Message> extends AgentExecutionUpdate {
  /**
   * Current-state and framework history mutation; absent for a no-op.
   */
  readonly entityCommit?: EntityCommitInput<I, S>;
}

/**
 * Native serialized payload bounds available before model or tool dispatch.
 *
 * Every limit applies to the complete internal Protobuf record, including its
 * scope and metadata. An absent limit means this provider enforces no tighter
 * fixed bound for that record.
 */
export interface AgentExecutionCapacity {
  /**
   * Maximum serialized AgentExecutionRecord bytes.
   */
  readonly executionRecordBytes?: number;

  /**
   * Maximum serialized AgentExecutionHead bytes.
   */
  readonly executionHeadBytes?: number;

  /**
   * Maximum serialized AgentHistoryRecord bytes.
   */
  readonly historyRecordBytes?: number;

  /**
   * Maximum aggregate staged native transaction payload bytes.
   */
  readonly transactionPayloadBytes?: number;
}

/**
 * Provider-only durable execution capability for one Agent repository scope.
 *
 * @typeParam I Typed Agent identifier.
 * @typeParam S Generated Agent state.
 */
export interface AgentExecutionStorage<I, S extends Message> {
  /**
   * Native bounds used to reject unjournalable work before external dispatch.
   */
  readonly capacity: AgentExecutionCapacity;

  /**
   * Persists accepted source work before its Inbox handoff is acknowledged.
   * @param accepted Exact source envelope and selected handler bindings.
   * @returns Stored record, accepting an identical repeat only.
   */
  admit(accepted: AgentAcceptedInvocation): Promise<AgentExecutionRecord>;

  /**
   * Reads bounded, time-eligible unresolved work through a provider index.
   * @param request Page count and complete continuation.
   * @returns Independent records and continuation state.
   */
  pending(request: AgentPendingRead): Promise<AgentPendingPage>;

  /**
   * Reads a complete execution record after reconstruction.
   * @param key Exact source and Agent instance identity.
   * @returns Stored record, if present.
   */
  read(key: AgentInvocationKey): Promise<AgentExecutionRecord | undefined>;

  /**
   * Acquires the earliest unresolved invocation with a fresh provider-side time check.
   * @param key Exact source and Agent instance identity.
   * @param token New unpredictable exclusive token.
   * @param expiresAt Requested claim expiry.
   * @returns Claimed record and current preferences, if eligible.
   */
  claim(
    key: AgentInvocationKey,
    token: string,
    expiresAt: Timestamp,
  ): Promise<AgentExecutionClaim | undefined>;

  /**
   * Updates the same unexpired token under the per-instance claim lock.
   * @param key Exact source and Agent instance identity.
   * @param token Current exclusive token.
   * @param expiresAt Requested later expiry.
   * @returns Whether the current token was renewed.
   */
  renew(key: AgentInvocationKey, token: string, expiresAt: Timestamp): Promise<boolean>;

  /**
   * Persists fenced budgets, evidence and conversation/System history atomically.
   * @param input Expected exact record and next retained evidence.
   * @returns Completion after fenced evidence is persisted.
   */
  update(input: AgentExecutionUpdate): Promise<void>;

  /**
   * Persists Entity, history, preferences, execution result and output obligations atomically.
   * @param input Expected exact record and complete transition.
   * @returns Completion after conditional Entity and evidence commit.
   */
  complete(input: AgentExecutionComplete<I, S>): Promise<void>;

  /**
   * Marks output IDs accepted by normal delivery without rerunning handlers.
   * @param key Exact source and Agent instance identity.
   * @param token Current exclusive token.
   * @param expectedRecordBytes Exact binary image before acknowledgement.
   * @param signals Original IDs accepted by delivery.
   * @returns Completion after original output IDs are marked delivered.
   */
  markDelivered(
    key: AgentInvocationKey,
    token: string,
    expectedRecordBytes: Uint8Array,
    signals: readonly AgentSignalKey[],
  ): Promise<void>;

  /**
   * Closes this handle without deleting any persisted work.
   */
  close(): void;
}
