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

import { clone, create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  GuardedInboxResultSchema,
  GuardedInboxService,
  type GuardedInboxRequest,
  type GuardedInboxResult,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageSchema,
  InboxMessageStatus,
  type ShardIndex,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { InboxMessages } from "./inbox-service.js";
import { MutationAdmission } from "./mutation-admission.js";
import { ShardSessionRuntime } from "./shard-service.js";
import { DeliveryMessages } from "./wire-values.js";

/**
 * Applies worker Inbox changes only with a current session and exact read row.
 */
export class GuardedInboxRuntime {
  /**
   * Serves the guarded Inbox RPC descriptor.
   */
  readonly service: ServiceImpl<typeof GuardedInboxService>;

  /**
   * Creates guarded mutations over the same session and row admission queue.
   *
   * @param state Stores the canonical wire rows.
   * @param admission Serializes server mutations.
   * @param sessions Checks the active managed session.
   * @param now Supplies full-precision server wall time.
   * @param onStoredChange Publishes retained-row changes.
   * @param onWorkChange Publishes pending-work changes.
   */
  constructor(
    private readonly state: InMemoryDeliveryState,
    private readonly admission: MutationAdmission,
    private readonly sessions: ShardSessionRuntime,
    private readonly now: () => Timestamp,
    private readonly onStoredChange?: (shard: ShardIndex) => void,
    private readonly onWorkChange?: (shard: ShardIndex) => void,
  ) {
    this.service = {
      acknowledge: (request, context) => this.#admit(request, context.signal, "ACK"),
      removePendingDuplicate: (request, context) => this.#admit(request, context.signal, "PENDING"),
      removeExpiredDelivered: (request, context) => this.#admit(request, context.signal, "EXPIRED"),
    };
  }

  /**
   * Admits one guarded mutation and checks its live session inside admission.
   *
   * @param request Supplies the handle and original row.
   * @param signal Cancels before admission.
   * @param operation Selects acknowledgement or one cleanup path.
   * @returns A matched row result or a stale-row result.
   */
  #admit(
    request: GuardedInboxRequest,
    signal: AbortSignal,
    operation: "ACK" | "PENDING" | "EXPIRED",
  ): Promise<GuardedInboxResult> {
    const expected = InboxMessages.required(request.expected).message;
    const session = request.session;
    if (session === undefined)
      throw new ConnectError("Managed session handle is required.", Code.InvalidArgument);
    return this.admission.run(signal, () => {
      const shard = this.sessions.requireManaged(session);
      if (expected.id?.index?.index !== shard.index || expected.id.index.ofTotal !== shard.ofTotal)
        throw new ConnectError("Inbox row shard differs from session.", Code.InvalidArgument);
      return this.#apply(expected, shard, operation);
    });
  }

  /**
   * Checks the exact row and applies one status-specific change.
   *
   * @param expected Supplies the original wire snapshot.
   * @param shard Identifies the authorized shard.
   * @param operation Selects the status transition.
   * @returns The guarded mutation result.
   */
  #apply(
    expected: NonNullable<GuardedInboxRequest["expected"]>,
    shard: ShardIndex,
    operation: "ACK" | "PENDING" | "EXPIRED",
  ): GuardedInboxResult {
    const key = DeliveryMessages.key(expected);
    const current = this.state.messages.get(key);
    if (operation === "ACK") return this.#acknowledge(key, expected, current, shard);
    if (operation === "PENDING" && expected.status !== InboxMessageStatus.TO_DELIVER)
      return create(GuardedInboxResultSchema);
    if (operation === "EXPIRED" && expected.status !== InboxMessageStatus.DELIVERED)
      return create(GuardedInboxResultSchema);
    if (current === undefined) return create(GuardedInboxResultSchema, { matched: true });
    if (!GuardedWire.same(current, expected)) return create(GuardedInboxResultSchema);
    if (operation === "PENDING" && current.status !== InboxMessageStatus.TO_DELIVER)
      return create(GuardedInboxResultSchema);
    if (operation === "EXPIRED" && !this.#expired(current)) return create(GuardedInboxResultSchema);
    this.state.delete(current);
    this.onStoredChange?.(shard);
    if (operation === "PENDING") this.onWorkChange?.(shard);
    return create(GuardedInboxResultSchema, { matched: true });
  }

  /**
   * Completes the original pending row or returns its first completion.
   *
   * @param key Identifies the stored row.
   * @param expected Supplies the read pending snapshot.
   * @param current Supplies the stored row, when present.
   * @param shard Identifies the authorized shard.
   * @returns The completed row on an exact match.
   */
  #acknowledge(
    key: string,
    expected: NonNullable<GuardedInboxRequest["expected"]>,
    current: NonNullable<GuardedInboxRequest["expected"]> | undefined,
    shard: ShardIndex,
  ): GuardedInboxResult {
    if (expected.status !== InboxMessageStatus.TO_DELIVER || current === undefined)
      return create(GuardedInboxResultSchema);
    if (
      current.status === InboxMessageStatus.DELIVERED &&
      this.state.sameAcknowledgement(key, GuardedWire.bytes(expected))
    )
      return create(GuardedInboxResultSchema, {
        matched: true,
        message: DeliveryMessages.copy(current),
      });
    if (!GuardedWire.same(current, expected)) return create(GuardedInboxResultSchema);
    const completed = this.#completed(current, this.now());
    const record = InboxMessages.required(completed);
    this.state.put(record.message);
    this.state.rememberAcknowledgement(key, GuardedWire.bytes(expected));
    this.onStoredChange?.(shard);
    this.onWorkChange?.(shard);
    return create(GuardedInboxResultSchema, { matched: true, message: completed });
  }

  /**
   * Clones the canonical row with its first completion deadline and unknown fields.
   */
  #completed(current: NonNullable<GuardedInboxRequest["expected"]>, now: Timestamp) {
    const completed = clone(InboxMessageSchema, current);
    completed.status = InboxMessageStatus.DELIVERED;
    completed.keepUntil = create(TimestampSchema, { seconds: now.seconds + 5n, nanos: now.nanos });
    return completed;
  }

  /**
   * Checks a completed row's retention deadline against full server time.
   *
   * @param row Supplies the stored completed row.
   * @returns Whether this row is eligible for deletion.
   */
  #expired(row: NonNullable<GuardedInboxRequest["expected"]>): boolean {
    if (row.status !== InboxMessageStatus.DELIVERED) return false;
    const until = row.keepUntil;
    if (until === undefined) return true;
    const now = this.now();
    return (
      until.seconds < now.seconds || (until.seconds === now.seconds && until.nanos <= now.nanos)
    );
  }
}

/**
 * Compares canonical encodings including unknown Protobuf fields.
 */
const GuardedWire = Object.freeze({
  /**
   * Encodes an Inbox row with unknown fields intact.
   *
   * @param row Supplies the row.
   * @returns Its canonical wire bytes.
   */
  bytes(row: NonNullable<GuardedInboxRequest["expected"]>): Uint8Array {
    return toBinary(InboxMessageSchema, row);
  },

  /**
   * Checks exact wire equality.
   *
   * @param left Supplies the stored row.
   * @param right Supplies the read row.
   * @returns Whether the encodings match.
   */
  same(
    left: NonNullable<GuardedInboxRequest["expected"]>,
    right: NonNullable<GuardedInboxRequest["expected"]>,
  ): boolean {
    const a = GuardedWire.bytes(left);
    const b = GuardedWire.bytes(right);
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
  },
});
