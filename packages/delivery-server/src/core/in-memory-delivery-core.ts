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

import type { ServiceImpl } from "@connectrpc/connect";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  InboxService,
  ManagedShardService,
  ShardService,
  ShardObservingService,
} from "@spine-event-engine/proto/delivery-server";

import { DeliveryAssembly } from "../server/assembly.js";

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
   * Milliseconds between notices while a shard is free with pending work. Defaults to 10,000.
   */
  readonly reminderIntervalMs?: number;

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
   * Streams free shards with pending work to application nodes.
   */
  readonly observing: ServiceImpl<typeof ShardObservingService>;

  /**
   * Closes active work streams, rejects pending mutations, and cancels timers.
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
   * @param options Configures stale pickup expiry and work reminders.
   * @returns Provides the handlers without owning a listener or process lifecycle.
   * @throws {RangeError} When the processing timeout is not a positive safe integer.
   */
  create(options?: DeliveryCoreOptions): DeliveryCore;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Creates an empty Inbox and Shard core.
   *
   * @param options Configures stale pickup expiry and work reminders.
   * @returns Provides the handlers without owning a listener or process lifecycle.
   * @throws {RangeError} When the processing timeout is not a positive safe integer.
   */
  create(options: DeliveryCoreOptions = {}): DeliveryCore {
    const timeout = options.processingTimeoutMs ?? 60_000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0)
      throw new RangeError("Processing timeout is invalid.");
    const assembly = DeliveryAssembly.create(options);
    return Object.freeze({
      inbox: assembly.inbox,
      shards: assembly.shards,
      managed: assembly.managed,
      observing: assembly.observing,
      close() {
        assembly.closeAdmission();
        assembly.closeObserving();
        assembly.closeSessions();
        assembly.closeAdmin();
      },
    });
  },
});
