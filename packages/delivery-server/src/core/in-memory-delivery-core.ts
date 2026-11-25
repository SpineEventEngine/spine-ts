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

import { Time } from "@spine-event-engine/core/time";
import type { ServiceImpl } from "@connectrpc/connect";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  InboxService,
  ManagedShardService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";

import { InboxHandlers } from "./inbox-service.js";
import { InMemoryDeliveryState } from "./in-memory-delivery-state.js";
import { MutationAdmission } from "./mutation-admission.js";
import { ShardSessionRuntime } from "./shard-service.js";

/**
 * Configures the listener-free in-memory delivery core.
 */
export interface DeliveryCoreOptions {
  // prettier-ignore

  /**
   * Positive session lifetime in milliseconds; defaults to 60 seconds.
   */
  readonly processingTimeoutMs?: number;

  /**
   * Returns a deterministic full-precision Protobuf timestamp.
   *
   * @returns Provides the current timestamp.
   */
  readonly now?: () => Timestamp;

  /**
   * Returns monotonic milliseconds for deterministic lease-expiry tests.
   *
   * @returns An elapsed-time reading independent of wall-clock changes.
   */
  readonly monotonicNow?: () => number;

  /**
   * Maximum retained records; integer from 1 through 2,147,483,647.
   */
  readonly maxRetainedMessages?: number;

  /**
   * Maximum retained serialized record bytes; integer from 1 through 2,147,483,647.
   */
  readonly maxRetainedBytes?: number;

  /**
   * Maximum tracked shards; integer from 1 through 1,000.
   */
  readonly maxTrackedShards?: number;
}

/**
 * Provides handler implementations for caller-owned Connect router registration.
 */
export interface DeliveryCore {
  // prettier-ignore

  /**
   * Serves Inbox RPCs.
   */
  readonly inbox: ServiceImpl<typeof InboxService>;

  /**
   * Serves Shard RPCs.
   */
  readonly shards: ServiceImpl<typeof ShardService>;

  /**
   * Serves typed raw and managed session calls.
   */
  readonly managed: ServiceImpl<typeof ManagedShardService>;

  /**
   * Cancels pending expiry timers.
   */
  close(): void;
}

/**
 * Creates listener-free in-memory delivery cores.
 */
export const InMemoryDelivery: Readonly<{
  // prettier-ignore

  /**
   * Creates an empty Inbox and Shard core.
   *
   * @param options Configures state limits and stale pickup expiry.
   * @returns Provides the handlers without owning a listener or process lifecycle.
   * @throws {RangeError} When the processing timeout is not a positive safe integer.
   */
  create(options?: DeliveryCoreOptions): DeliveryCore;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Creates an empty Inbox and Shard core.
   *
   * @param options Configures state limits and stale pickup expiry.
   * @returns Provides the handlers without owning a listener or process lifecycle.
   * @throws {RangeError} When the processing timeout is not a positive safe integer.
   */
  create(options: DeliveryCoreOptions = {}): DeliveryCore {
    const timeout = options.processingTimeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0)
      throw new RangeError("Processing timeout is invalid.");
    const state = new InMemoryDeliveryState(options);
    const admission = new MutationAdmission();
    const now = options.now ?? (() => Time.currentTime());
    const sessions = new ShardSessionRuntime(
      state,
      admission,
      now,
      timeout,
      undefined,
      options.monotonicNow ?? (() => Time.monotonicTime()),
    );
    return Object.freeze({
      inbox: InboxHandlers.create(state, admission),
      shards: sessions.raw,
      managed: sessions.managed,
      close: sessions.close.bind(sessions),
    });
  },
});
