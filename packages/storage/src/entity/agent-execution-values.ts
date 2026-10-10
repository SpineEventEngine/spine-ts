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

import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionRecordSchema,
  AgentInvocationStatus,
  type AgentAcceptedInvocation,
  type AgentExecutionCompletion,
  type AgentExecutionHead,
  type AgentExecutionRecord,
  type AgentExecutionScope,
  type AgentInboxOrder,
  type AgentInvocationKey,
  type AgentSignalKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

import { AgentExecutionRecords } from "./agent-execution-record-spec.js";

/**
 * Reads and compares original Agent execution values across storage providers.
 */
export const AgentExecutionValues = {
  /**
   * Validates a present value at a provider trust boundary.
   * @param value Optional decoded or selected value.
   * @returns The present value.
   * @typeParam T Value type.
   */
  require<T>(value: T | undefined): T {
    if (value === undefined) throw new TypeError("Agent execution value is missing.");
    return value;
  },

  /**
   * Validates an invocation in the configured state family.
   * @param key Complete original invocation key.
   * @param stateType Configured generated state type.
   * @returns Validated key.
   */
  requiredKey(key: AgentInvocationKey | undefined, stateType: string): AgentInvocationKey {
    if (
      key?.scope?.stateType !== stateType ||
      !key.scope.agentKey ||
      key.sourceSignal === undefined
    )
      throw new TypeError(
        "Agent execution requires configured state type, Agent key and source ID.",
      );
    AgentExecutionRecords.invocation(key);
    return key;
  },

  /**
   * Validates immutable source facts and original Inbox order.
   * @param record Persisted execution record.
   * @returns Complete accepted source facts.
   */
  requiredAccepted(record: AgentExecutionRecord): AgentAcceptedInvocation {
    if (record.accepted?.key?.scope === undefined || record.accepted.order === undefined)
      throw new TypeError("Agent execution requires accepted source facts and Inbox order.");
    return record.accepted;
  },

  /**
   * Reads the accepted invocation key.
   * @param record Persisted execution record.
   * @returns Complete key.
   */
  requiredInvocation(record: AgentExecutionRecord): AgentInvocationKey {
    const key = this.requiredAccepted(record).key;
    if (key === undefined) throw new TypeError("Agent invocation key is missing.");
    return key;
  },

  /**
   * Validates the generated state type and Agent key.
   * @param key Original invocation identity.
   * @returns Complete instance scope.
   */
  requiredScope(key: AgentInvocationKey | undefined): AgentExecutionScope {
    if (key?.scope === undefined) throw new TypeError("Agent execution scope is missing.");
    return key.scope;
  },

  /**
   * Validates the scope stored in one per-instance head.
   * @param head Persisted claim and discovery head.
   * @returns Complete instance scope.
   */
  requiredHeadScope(head: AgentExecutionHead): AgentExecutionScope {
    if (head.scope === undefined) throw new TypeError("Agent execution head scope is missing.");
    return head.scope;
  },

  /**
   * Reads original Inbox order from immutable acceptance.
   * @param record Persisted execution record.
   * @returns Complete Inbox order.
   */
  requiredOrder(record: AgentExecutionRecord): AgentInboxOrder {
    const order = this.requiredAccepted(record).order;
    if (order === undefined) throw new TypeError("Agent Inbox order is missing.");
    return order;
  },

  /**
   * Validates completed output obligations.
   * @param record Persisted execution record.
   * @returns Complete result.
   */
  requiredCompletion(record: AgentExecutionRecord): AgentExecutionCompletion {
    if (record.completion === undefined) throw new TypeError("Agent completion is missing.");
    return record.completion;
  },

  /**
   * Compares binary indexed strings without locale collation.
   * @param left First full index key.
   * @param right Second full index key.
   * @returns Negative, zero, or positive order.
   */
  compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Compares complete accepted source facts.
   * @param left Previous accepted facts.
   * @param right Proposed accepted facts.
   * @returns Whether all original bytes match.
   */
  sameAccepted(
    left: AgentAcceptedInvocation | undefined,
    right: AgentAcceptedInvocation | undefined,
  ): boolean {
    return (
      left !== undefined &&
      right !== undefined &&
      this.sameBytes(
        toBinary(AgentAcceptedInvocationSchema, left),
        toBinary(AgentAcceptedInvocationSchema, right),
      )
    );
  },

  /**
   * Compares exact binary images without integer conversion.
   * @param left Previous Protobuf image.
   * @param right Proposed Protobuf image.
   * @returns Whether each byte matches.
   */
  sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  },

  /**
   * Returns an independent exact execution record.
   * @param record Persisted record.
   * @returns Binary round-tripped record.
   */
  cloneRecord(record: AgentExecutionRecord): AgentExecutionRecord {
    return fromBinary(AgentExecutionRecordSchema, toBinary(AgentExecutionRecordSchema, record));
  },

  /**
   * Compares full seconds and nanos.
   * @param left First Timestamp.
   * @param right Second Timestamp.
   * @returns Negative, zero, or positive order.
   */
  compareTime(left: Timestamp, right: Timestamp): number {
    return left.seconds < right.seconds
      ? -1
      : left.seconds > right.seconds
        ? 1
        : left.nanos - right.nanos;
  },

  /**
   * Checks whether accepted or expired work is claimable now.
   * @param record Persisted invocation.
   * @param now Fresh provider Timestamp.
   * @returns Whether a claim may attempt it.
   */
  isPending(record: AgentExecutionRecord, now: Timestamp): boolean {
    if (
      record.status === AgentInvocationStatus.AGENT_INVOCATION_ACCEPTED ||
      record.status === AgentInvocationStatus.AGENT_INVOCATION_COMPLETED_PENDING_DELIVERY
    )
      return true;
    return (
      record.status === AgentInvocationStatus.AGENT_INVOCATION_ACTIVE &&
      record.claimExpiresAt !== undefined &&
      this.compareTime(record.claimExpiresAt, now) <= 0
    );
  },

  /**
   * Clears the resolved claim while retaining original order.
   * @param head Per-instance claim and discovery record.
   * @param order Original Inbox order of resolved work.
   */
  release(head: AgentExecutionHead, order: AgentInboxOrder): void {
    head.active = undefined;
    head.claimToken = "";
    head.claimExpiresAt = undefined;
    head.lastResolved = order;
  },

  /**
   * Updates a discoverable head for earlier original Inbox work without resetting eligibility.
   * @param head Current per-instance claim and discovery row.
   * @param record Newly accepted original invocation.
   */
  offerCandidate(head: AgentExecutionHead, record: AgentExecutionRecord): void {
    const order = this.requiredOrder(record);
    if (
      head.pendingOrder !== undefined &&
      AgentExecutionRecords.order(head.pendingOrder) <= AgentExecutionRecords.order(order)
    )
      return;
    head.pending = this.requiredInvocation(record);
    head.pendingOrder = order;
    if (head.active === undefined) head.eligibleAt ??= Time.currentTime();
    else if (head.claimExpiresAt !== undefined) head.eligibleAt = head.claimExpiresAt;
    else throw new Error("Agent active head requires lease expiry.");
  },

  /**
   * Updates the resolved head with its earliest unresolved successor.
   * @param head Current per-instance claim and discovery row.
   * @param order Original Inbox order of resolved work.
   * @param next Earliest remaining invocation when present.
   */
  advanceCandidate(
    head: AgentExecutionHead,
    order: AgentInboxOrder,
    next: AgentExecutionRecord | undefined,
  ): void {
    this.release(head, order);
    head.pending = next === undefined ? undefined : this.requiredInvocation(next);
    head.pendingOrder = next === undefined ? undefined : this.requiredOrder(next);
    head.eligibleAt = next === undefined ? undefined : Time.currentTime();
  },

  /**
   * Marks one original recorded outgoing ID delivered.
   * @param record Completion carrying original outputs.
   * @param signal Typed Event or Command ID.
   */
  markSignal(record: AgentExecutionCompletion, signal: AgentSignalKey): void {
    const outgoing = record.outgoing.find(
      (item) =>
        (signal.id.case === "event" &&
          item.signal.case === "event" &&
          item.signal.value.id?.value === signal.id.value.value) ||
        (signal.id.case === "command" &&
          item.signal.case === "command" &&
          item.signal.value.id?.uuid === signal.id.value.uuid),
    );
    if (outgoing === undefined) throw new Error("Agent outgoing signal ID was not recorded.");
    outgoing.delivered = true;
  },
};
