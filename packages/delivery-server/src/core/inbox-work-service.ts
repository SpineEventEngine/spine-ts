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

import { clone, create } from "@bufbuild/protobuf";
import { EmptySchema, TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  InboxWorkResultSchema,
  ManagedShardService,
  type DeliverySessionHandle,
  type InboxWorkRequest,
  type InboxWorkResult,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageStatus,
  type InboxMessage,
  type ShardIndex,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { MutationAdmission } from "./mutation-admission.js";
import { ShardSessionRuntime } from "./shard-service.js";
import { DeliveryShards } from "./wire-values.js";

/**
 * Applies inbox work mutations under the current managed shard session.
 */
export class InboxWorkRuntime {
  /**
   * Creates inbox work handlers that share the managed session's mutation queue.
   *
   * @param state Stores the canonical inbox messages.
   * @param admission Serializes server mutations.
   * @param sessions Checks the active managed session.
   * @param now Supplies server wall time.
   * @param onStoredChange Publishes stored message changes.
   * @param onWorkChange Publishes pending work changes.
   */
  constructor(
    private readonly state: InMemoryDeliveryState,
    private readonly admission: MutationAdmission,
    private readonly sessions: ShardSessionRuntime,
    private readonly now: () => Timestamp,
    private readonly onStoredChange?: (shard: ShardIndex) => void,
    private readonly onWorkChange?: (shard: ShardIndex) => void,
  ) {}

  /**
   * Returns the inbox methods included in the managed shard service.
   *
   * @returns Session-checked inbox handlers.
   */
  handlers(): Pick<
    ServiceImpl<typeof ManagedShardService>,
    "markDelivered" | "removeDuplicate" | "removeExpiredDelivered"
  > {
    return {
      markDelivered: (request, context) => this.#admit(request, context.signal, "DELIVER"),
      removeDuplicate: (request, context) => this.#admit(request, context.signal, "DUPLICATE"),
      removeExpiredDelivered: (session, context) => this.#cleanup(session, context.signal),
    };
  }

  /**
   * Checks the live session and changes the current message at the supplied ID.
   *
   * @param request Names the session and complete inbox message ID.
   * @param signal Cancels before mutation admission.
   * @param operation Selects completion or pending duplicate removal.
   * @returns The current mutation result.
   */
  #admit(
    request: InboxWorkRequest,
    signal: AbortSignal,
    operation: "DELIVER" | "DUPLICATE",
  ): Promise<InboxWorkResult> {
    const session = request.session;
    const id = request.id;
    if (session === undefined || id?.index === undefined || !id.uuid)
      throw new ConnectError(
        "Managed session and inbox message ID are required.",
        Code.InvalidArgument,
      );
    return this.admission.run(signal, () => {
      const shard = this.sessions.requireManaged(session);
      if (id.index?.index !== shard.index || id.index.ofTotal !== shard.ofTotal)
        throw new ConnectError("Inbox message shard differs from session.", Code.InvalidArgument);
      const key = `${DeliveryShards.key(shard)}:${id.uuid}`;
      const current = this.state.messages.get(key);
      if (operation === "DELIVER") return this.#markDelivered(current, shard);
      if (current?.status === InboxMessageStatus.TO_DELIVER) {
        this.state.delete(current);
        this.onStoredChange?.(shard);
        this.onWorkChange?.(shard);
      }
      return create(InboxWorkResultSchema, {
        matched: current === undefined || current.status === InboxMessageStatus.TO_DELIVER,
      });
    });
  }

  /**
   * Retains the first completion deadline for the current inbox message.
   *
   * @param current Stored message at the acknowledged ID, when present.
   * @param shard Session shard containing the message.
   * @returns Whether the ID was marked delivered, with its retention deadline when present.
   */
  #markDelivered(current: InboxMessage | undefined, shard: ShardIndex): InboxWorkResult {
    if (current === undefined) return create(InboxWorkResultSchema);
    if (current.status === InboxMessageStatus.DELIVERED)
      return create(InboxWorkResultSchema, {
        matched: true,
        whenKeepUntil: current.keepUntil && clone(TimestampSchema, current.keepUntil),
      });
    if (current.status !== InboxMessageStatus.TO_DELIVER) return create(InboxWorkResultSchema);
    const now = this.now();
    const keepUntil = create(TimestampSchema, { seconds: now.seconds + 5n, nanos: now.nanos });
    this.state.markDelivered(current, keepUntil);
    this.onStoredChange?.(shard);
    this.onWorkChange?.(shard);
    return create(InboxWorkResultSchema, {
      matched: true,
      whenKeepUntil: clone(TimestampSchema, keepUntil),
    });
  }

  /**
   * Removes all expired delivered messages in one admitted shard operation.
   *
   * @param session Authorizes work in its shard.
   * @param signal Cancels before mutation admission.
   * @returns Completion after the shard predicate is applied.
   */
  #cleanup(session: DeliverySessionHandle, signal: AbortSignal) {
    return this.admission.run(signal, () => {
      const shard = this.sessions.requireManaged(session);
      if (this.state.removeExpiredDelivered(shard, this.now())) this.onStoredChange?.(shard);
      return create(EmptySchema);
    });
  }
}
