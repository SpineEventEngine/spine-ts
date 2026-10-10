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

import { ScalarType } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  AgentExecutionHeadSchema,
  AgentExecutionRecordSchema,
  type AgentExecutionHead,
  type AgentExecutionRecord,
  type AgentExecutionScope,
  type AgentInboxOrder,
  type AgentInvocationKey,
  type AgentSignalKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

import { RecordColumn } from "../record/record-column.js";
import { ColumnTypes } from "../record/column-type.js";
import { RecordSpec } from "../record/record-spec.js";
import { StorageGroup } from "../record/storage-group.js";

const string = ColumnTypes.scalar(ScalarType.STRING);
const invocationGroup = new StorageGroup("agent_execution");
const headGroup = new StorageGroup("agent_execution_head");

/**
 * Describes physical execution record families and their indexed keys.
 */
interface AgentExecutionRecordLayout {
  /**
   * Shared invocation record family.
   */
  readonly invocationGroup: StorageGroup;

  /**
   * Shared per-instance claim and preference family.
   */
  readonly headGroup: StorageGroup;

  /**
   * Encodes the complete Agent instance scope.
   * @param scope Generated state type and Agent key.
   * @returns Complete encoded Agent instance scope.
   */
  scope(scope: AgentExecutionScope): string;

  /**
   * Encodes full Agent scope for binary-collated continuations.
   * @param scope Generated state type and Agent key.
   * @returns Binary-collated Agent instance scope key.
   */
  scopeOrder(scope: AgentExecutionScope): string;

  /**
   * Encodes the original source and Agent scope.
   * @param key Original Agent invocation identity.
   * @returns Complete immutable invocation key.
   */
  invocation(key: AgentInvocationKey): string;

  /**
   * Encodes the typed original Command or Event ID.
   * @param signal Original signal identity.
   * @returns Complete typed source signal key.
   */
  signal(signal: AgentSignalKey): string;

  /**
   * Encodes full Inbox time, version and source ID for binary order.
   * @param order Original Inbox order.
   * @returns Complete binary-collated Inbox order key.
   */
  order(order: AgentInboxOrder): string;

  /**
   * Encodes provider eligibility time and complete Agent scope.
   * @param eligibleAt Time when this head becomes eligible.
   * @param scope Generated state type and Agent key.
   * @returns Complete binary-collated eligibility and scope key.
   */
  pendingKey(eligibleAt: Timestamp, scope: AgentExecutionScope): string;

  /**
   * Encodes the strict upper bound before all scopes at this time.
   * @param asOf Fixed eligibility cutoff for the page.
   * @returns Strict eligibility upper-bound key.
   */
  pendingLower(asOf: Timestamp): string;

  /**
   * Creates the indexed invocation record specification.
   * @param digest Fixed-width digest of the complete indexed value.
   * @returns Invocation record layout and complete native index columns.
   */
  invocationSpec(digest: (value: string) => string): RecordSpec<string, AgentExecutionRecord>;

  /**
   * Creates the indexed per-instance head specification.
   * @param digest Fixed-width digest of the complete indexed value.
   * @returns Per-instance head layout and complete native index columns.
   */
  headSpec(digest: (value: string) => string): RecordSpec<string, AgentExecutionHead>;
}

/**
 * Materializes complete Agent execution records and full indexed identities.
 */
export const AgentExecutionRecords: AgentExecutionRecordLayout = {
  /**
   * Shared physical invocation family inside one provider tenant.
   */
  invocationGroup: invocationGroup,

  /**
   * Shared physical per-instance head family inside one provider tenant.
   */
  headGroup: headGroup,

  /**
   * Encodes complete Agent scope without truncation.
   * @param scope Generated state type and canonical typed Agent key.
   * @returns Unambiguous complete scope text.
   */
  scope(scope: AgentExecutionScope): string {
    if (!scope.stateType || !scope.agentKey)
      throw new TypeError("Agent execution requires complete state type and Agent key.");
    return JSON.stringify([scope.stateType, scope.agentKey]);
  },

  /**
   * Encodes every scope byte for unambiguous binary continuation order.
   * @param scope Generated state type and canonical typed Agent key.
   * @returns Prefix-safe full ordering text.
   */
  scopeOrder(scope: AgentExecutionScope): string {
    this.scope(scope);
    return `${utf8Hex(scope.stateType)}!${utf8Hex(scope.agentKey)}`;
  },

  /**
   * Encodes one original source identity within its Agent scope.
   * @param key Agent instance and original Command or Event ID.
   * @returns Complete immutable invocation identity.
   */
  invocation(key: AgentInvocationKey): string {
    if (key.scope === undefined || key.sourceSignal === undefined)
      throw new TypeError("Agent execution requires scope and original source ID.");
    return JSON.stringify([this.scope(key.scope), this.signal(key.sourceSignal)]);
  },

  /**
   * Encodes a typed source ID without optional MessageId Version metadata.
   * @param signal Original Command or Event identity.
   * @returns Complete typed source identity.
   */
  signal(signal: AgentSignalKey): string {
    const id = signal.id;
    if (id.case === "command" && id.value.uuid) return JSON.stringify(["command", id.value.uuid]);
    if (id.case === "event" && id.value.value) return JSON.stringify(["event", id.value.value]);
    throw new TypeError("Agent execution requires an original Command or Event ID.");
  },

  /**
   * Encodes full Timestamp, Inbox version and source ID for native binary order.
   * @param order Existing Inbox acceptance order.
   * @returns Prefix-safe order text.
   */
  order(order: AgentInboxOrder): string {
    const at = order.receivedAt;
    if (
      at === undefined ||
      order.sourceSignal === undefined ||
      order.inboxVersion < 0n ||
      order.inboxVersion > 18_446_744_073_709_551_615n
    )
      throw new TypeError("Agent execution requires complete Inbox order.");
    if (
      at.seconds < -62_135_596_800n ||
      at.seconds > 253_402_300_799n ||
      at.nanos < 0 ||
      at.nanos > 999_999_999
    )
      throw new RangeError("Agent Inbox Timestamp is out of range.");
    const seconds = (at.seconds + 62_135_596_800n).toString().padStart(12, "0");
    const nanos = at.nanos.toString().padStart(9, "0");
    const version = order.inboxVersion.toString().padStart(20, "0");
    const signal = order.sourceSignal.id;
    const id =
      signal.case === "command"
        ? signal.value.uuid
        : signal.case === "event"
          ? signal.value.value
          : undefined;
    if (!id) throw new TypeError("Agent Inbox order requires an original source ID.");
    const rank = signal.case === "command" ? "0" : "1";
    return `${seconds}:${nanos}:${version}:${rank}${utf8Hex(id)}`;
  },

  /**
   * Encodes full provider eligibility time and complete instance scope.
   * @param eligibleAt Time when this head becomes eligible.
   * @param scope Generated state type and Agent key.
   * @returns Complete binary-collated eligibility and scope key.
   */
  pendingKey(eligibleAt: Timestamp, scope: AgentExecutionScope): string {
    return `${timestampKey(eligibleAt)}!${this.scopeOrder(scope)}`;
  },

  /**
   * Returns an exclusive upper bound before all scopes at the sampled time.
   * @param asOf Fixed eligibility cutoff for the page.
   * @returns Strict eligibility upper-bound key.
   */
  pendingLower(asOf: Timestamp): string {
    return `${timestampKey(asOf)}!`;
  },

  /**
   * Builds materialized invocation columns under one fixed-width provider digest.
   * @param digest Physical identity digest of the full logical key.
   * @returns Shared native record specification.
   */
  invocationSpec(digest: (value: string) => string): RecordSpec<string, AgentExecutionRecord> {
    return new RecordSpec({
      sourceType: AgentExecutionRecordSchema,
      recordType: AgentExecutionRecordSchema,
      idKind: "string",
      extractId: (record) => digest(this.invocation(requiredInvocation(record))),
      columns: [
        new RecordColumn(
          "state_type",
          string,
          (record) => requiredInvocation(record).scope.stateType,
        ),
        new RecordColumn(
          "agent_key",
          string,
          (record) => requiredInvocation(record).scope.agentKey,
        ),
        new RecordColumn("scope_digest", string, (record) =>
          digest(this.scope(requiredInvocation(record).scope)),
        ),
        new RecordColumn("status", string, (record) => String(record.status)),
        new RecordColumn("order_key", string, (record) => this.order(requiredOrder(record))),
      ],
    });
  },

  /**
   * Builds materialized current-head columns under one provider digest.
   * @param digest Physical identity digest of the full Agent scope.
   * @returns Shared native head specification.
   */
  headSpec(digest: (value: string) => string): RecordSpec<string, AgentExecutionHead> {
    return new RecordSpec({
      sourceType: AgentExecutionHeadSchema,
      recordType: AgentExecutionHeadSchema,
      idKind: "string",
      extractId: (record) => digest(this.scope(requiredScope(record))),
      columns: [
        new RecordColumn("state_type", string, (record) => requiredScope(record).stateType),
        new RecordColumn("agent_key", string, (record) => requiredScope(record).agentKey),
        new RecordColumn("scope_digest", string, (record) =>
          digest(this.scope(requiredScope(record))),
        ),
        new RecordColumn("state_digest", string, (record) =>
          digest(requiredScope(record).stateType),
        ),
        new RecordColumn("pending_key", string, (record) => headPendingKey(record, this)),
      ],
    });
  },
};

/**
 * Reads the immutable accepted invocation identity from a record.
 */
function requiredInvocation(
  record: AgentExecutionRecord,
): AgentInvocationKey & { scope: AgentExecutionScope } {
  const key = record.accepted?.key;
  if (key?.scope === undefined || key.sourceSignal === undefined)
    throw new TypeError("Agent execution record requires its original invocation key.");
  return key as AgentInvocationKey & { scope: AgentExecutionScope };
}

/**
 * Reads the original Inbox order from a record.
 */
function requiredOrder(record: AgentExecutionRecord): AgentInboxOrder {
  const order = record.accepted?.order;
  if (order === undefined) throw new TypeError("Agent execution record requires Inbox order.");
  return order;
}

/**
 * Reads the complete Agent instance scope from a head.
 */
function requiredScope(head: AgentExecutionHead): AgentExecutionScope {
  if (head.scope === undefined) throw new TypeError("Agent execution head requires its scope.");
  return head.scope;
}

/**
 * Encodes an optional lease expiry for native index eligibility.
 */
function timestampKey(value: Timestamp): string {
  if (
    value.seconds < -62_135_596_800n ||
    value.seconds > 253_402_300_799n ||
    value.nanos < 0 ||
    value.nanos > 999_999_999
  )
    throw new RangeError("Agent execution Timestamp is out of range.");
  return `${(value.seconds + 62_135_596_800n).toString().padStart(12, "0")}:${value.nanos.toString().padStart(9, "0")}`;
}

/**
 * Materializes the head candidate or a value beyond every valid Timestamp.
 */
function headPendingKey(head: AgentExecutionHead, layout: AgentExecutionRecordLayout): string {
  const present = [head.pending, head.pendingOrder, head.eligibleAt].filter(
    (value) => value !== undefined,
  ).length;
  if (present === 0) return "~";
  if (present !== 3 || head.eligibleAt === undefined)
    throw new TypeError("Agent execution head has incomplete discovery metadata.");
  return layout.pendingKey(head.eligibleAt, requiredScope(head));
}

/**
 * Encodes every UTF-8 byte without locale-dependent collation.
 */
function utf8Hex(value: string): string {
  const encoder = new (
    globalThis as unknown as {
      TextEncoder: new () => {
        /**
         * Encodes a complete string as UTF-8 bytes.
         * @param text Original string.
         * @returns Exact UTF-8 byte sequence.
         */
        encode(text: string): Uint8Array;
      };
    }
  ).TextEncoder();
  return [...encoder.encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
