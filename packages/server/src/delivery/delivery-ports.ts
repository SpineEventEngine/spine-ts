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

import type {
  InboxMessage,
  InboxMessageId,
  InboxMessageInput,
  InboxReadOptions,
  InboxWriteResult,
} from "./inbox.js";
import type { WorkerId } from "@spine-event-engine/proto/delivery";
import type { ShardIndex } from "./shard-index.js";
import type { ShardSession } from "./sharded-work-registry.js";

/**
 * Cancellation and per-call deadline propagated through delivery port work.
 */
export interface DeliveryOperationOptions {
  // prettier-ignore

  /**
   * Cooperative cancellation propagated through reads, mutations, lease work, and completion.
   */
  readonly signal?: AbortSignal;

  /**
   * Non-negative safe-integer operation budget in milliseconds, measured from admission; zero is expired.
   */
  readonly timeoutMs?: number;
}

/**
 * Server-owned durable inbox boundary used by delivery drains.
 */
export interface DeliveryInbox {
  // prettier-ignore

  /**
   * Session fence kind this inbox accepts; ports supplied together must agree.
   */
  readonly sessionKind: DeliveryWorkSession["kind"];

  /**
   * Persists one incoming message before any worker observes it.
   *
   * @param input Describes the message to make durable.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns The write or deduplication outcome.
   */
  receive(input: InboxMessageInput, options?: DeliveryOperationOptions): Promise<InboxWriteResult>;

  /**
   * Reads one bounded continuation page for a shard.
   *
   * @param shard Selects the shard to inspect.
   * @param options Filters and bounds the ordered page.
   * @returns The matching message snapshots.
   */
  read(
    shard: ShardIndex,
    options?: InboxReadOptions & DeliveryOperationOptions,
  ): Promise<readonly InboxMessage[]>;

  /**
   * Finds one exact message without claiming delivery work.
   *
   * @param id Identifies the durable message.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns The message when it remains durable.
   */
  readMessage(
    id: InboxMessageId,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined>;

  /**
   * Marks one exact pending Inbox row delivered.
   *
   * @param message Supplies the expected pending row snapshot.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns The delivered row, or `undefined` when durable acknowledgement failed.
   */
  markDelivered(
    message: InboxMessage,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined>;

  /**
   * Removes one exact delivered snapshot atomically while a direct shard
   * session remains current.
   *
   * Built-in direct Inbox storage implements this through its provider-owned
   * ownership-and-delete operation. Custom structural ports may omit this
   * optional retention capability. RemoteInbox omits it because acknowledgement
   * already removes its pending row.
   *
   * @param message Supplies the expected delivered row snapshot.
   * @param session Supplies the currently owned shard session.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns `true` only when the exact snapshot was removed under current ownership.
   */
  removeDelivered?(
    message: InboxMessage,
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<boolean>;
}

/**
 * Server-owned exclusive shard-work boundary.
 */
export interface DeliveryWorkRegistry {
  // prettier-ignore

  /**
   * Session fence kind this registry issues; ports supplied together must agree.
   */
  readonly sessionKind: DeliveryWorkSession["kind"];

  /**
   * Acquires one shard work fence when it is available.
   *
   * @param shard Selects the shard to acquire.
   * @param worker Identifies the complete worker acquiring the fence.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns The acquired session, when the shard is available.
   */
  pickUp(
    shard: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryWorkSession | undefined>;

  /**
   * Updates a local leased session when it remains current.
   *
   * @param session Supplies the leased session to renew.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns The renewed session, when its fence remains valid.
   */
  renew?(
    session: LeasedDeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<LeasedDeliveryWorkSession | undefined>;

  /**
   * Validates ownership immediately before a guarded side effect.
   *
   * Leased registries return the renewed session. Exclusive registries return
   * the current session only while its authoritative remote fence still
   * matches.
   *
   * @param session Supplies the session to validate.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns The current session, or `undefined` after ownership loss.
   */
  validateOwnership(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryWorkSession | undefined>;

  /**
   * Removes a held work fence.
   *
   * @param session Supplies the session to release.
   * @param options Propagates cancellation and a delivery deadline.
   * @returns Whether the held fence was released.
   */
  release(session: DeliveryWorkSession, options?: DeliveryOperationOptions): Promise<boolean>;
}

/**
 * Local registry session that has renewable expiry fencing.
 */
export type LeasedDeliveryWorkSession = ShardSession;

/**
 * Remote exclusive session without a fictional lease or renewal timer.
 */
export interface ExclusiveDeliveryWorkSession {
  // prettier-ignore

  /**
   * Identifies an exclusive remote fence without renewal.
   */
  readonly kind: "EXCLUSIVE";

  /**
   * Selects the shard held by the exclusive fence.
   */
  readonly shard: ShardIndex;
}

/**
 * Honest session union accepted by delivery work.
 */
export type DeliveryWorkSession = LeasedDeliveryWorkSession | ExclusiveDeliveryWorkSession;
