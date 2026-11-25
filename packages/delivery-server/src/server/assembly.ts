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
import type { ShardIndex } from "@spine-event-engine/proto/delivery";
import {
  AdminService,
  InboxService,
  ManagedShardService,
  GuardedInboxService,
  ShardObservingService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";

import { AdminPublisher } from "../admin/admin-service.js";
import {
  InMemoryDeliveryState,
  type DeliveryResourceUsage,
} from "../core/in-memory-delivery-state.js";
import { InboxHandlers } from "../core/inbox-service.js";
import { GuardedInboxRuntime } from "../core/guarded-inbox-service.js";
import { MutationAdmission } from "../core/mutation-admission.js";
import { ShardSessionRuntime } from "../core/shard-service.js";
import { ShardObserving } from "../core/shard-observing-service.js";
import { DEFAULT_DELIVERY_STATE_LIMITS } from "../core/limits.js";
import type { DeliveryConfiguration } from "./config.js";

/**
 * Groups handlers and shutdown boundaries that share delivery runtime state.
 */
export interface DeliveryAssembly {
  // prettier-ignore

  /**
   * Provides the canonical retained state for private child capacity accounting.
   */
  readonly state: InMemoryDeliveryState;

  /**
   * Provides Inbox handlers backed by the shared delivery state.
   */
  readonly inbox: ServiceImpl<typeof InboxService>;

  /**
   * Provides Shard handlers backed by the shared delivery state.
   */
  readonly shards: ServiceImpl<typeof ShardService>;

  /**
   * Serves typed raw and managed delivery sessions.
   */
  readonly managed: ServiceImpl<typeof ManagedShardService>;

  /**
   * Serves session-guarded Inbox acknowledgement and cleanup.
   */
  readonly guarded: ServiceImpl<typeof GuardedInboxService>;

  /**
   * Streams advisory notifications for free pending shards.
   */
  readonly observing: ServiceImpl<typeof ShardObservingService>;

  /**
   * Provides Admin handlers backed by the shared delivery state.
   */
  readonly admin: ServiceImpl<typeof AdminService>;

  /**
   * Closes the shared mutation-admission boundary.
   */
  closeAdmission(): void;

  /**
   * Closes the shared Admin publisher.
   */
  closeAdmin(): void;

  /**
   * Clears work-observation streams and reminders.
   */
  closeObserving(): void;

  /**
   * Cancels all session expiry timers.
   */
  closeSessions(): void;
}

/**
 * Provides assembly construction for the delivery RPC handlers.
 */
export const DeliveryAssembly: Readonly<{
  // prettier-ignore

  /**
   * Creates delivery handlers with one shared state and admission boundary.
   *
   * @param configuration Configures the shared state and shard timeout.
   * @returns The assembled delivery handlers and shutdown boundaries.
   */
  create: (configuration?: DeliveryAssemblyConfiguration) => DeliveryAssembly;
}> = Object.freeze({
  create: (
    configuration: DeliveryAssemblyConfiguration = DEFAULT_ASSEMBLY_CONFIGURATION,
  ): DeliveryAssembly => {
    const state = new InMemoryDeliveryState(configuration);
    const admission = new MutationAdmission();
    const admin = AdminPublisher.create(state);
    const observing = ShardObserving.create(state, configuration.reminderIntervalMs ?? 10_000);
    const onStoredChange = admin.publish.bind(admin);
    const onWorkChange = observing.changed.bind(observing);
    const onShardTransition = (shard: ShardIndex) => {
      admin.publish(shard);
      observing.changed(shard);
    };
    const { sessions, guarded } = DeliverySessionAssembly.create(
      state,
      admission,
      configuration,
      onShardTransition,
      onStoredChange,
      onWorkChange,
    );
    return Object.freeze({
      state,
      inbox: InboxHandlers.create(state, admission, onStoredChange, onWorkChange),
      shards: sessions.raw,
      managed: sessions.managed,
      guarded: guarded.service,
      admin: admin.service,
      observing: observing.service,
      closeAdmission: admission.close.bind(admission),
      closeAdmin: admin.close.bind(admin),
      closeObserving: observing.close.bind(observing),
      closeSessions: sessions.close.bind(sessions),
    });
  },
});

/**
 * Constructs the session and guarded Inbox handlers over one admission queue.
 */
const DeliverySessionAssembly = Object.freeze({
  /**
   * Creates coupled session and guarded Inbox handlers.
   *
   * @param state Stores canonical rows and sessions.
   * @param admission Serializes mutations.
   * @param configuration Supplies the session lifetime.
   * @param onShardTransition Publishes session changes.
   * @param onStoredChange Publishes retained row changes.
   * @param onWorkChange Publishes pending work changes.
   * @returns The coupled handlers.
   */
  create(
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    configuration: DeliveryAssemblyConfiguration,
    onShardTransition: (shard: ShardIndex) => void,
    onStoredChange: (shard: ShardIndex) => void,
    onWorkChange: (shard: ShardIndex) => void,
  ) {
    const sessions = new ShardSessionRuntime(
      state,
      admission,
      () => Time.currentTime(),
      configuration.processingTimeoutMs ?? 60_000,
      onShardTransition,
      () => Time.monotonicTime(),
      () => configuration.onAutonomousExpiry?.(state.usageSnapshot()),
    );
    const guarded = new GuardedInboxRuntime(
      state,
      admission,
      sessions,
      () => Time.currentTime(),
      onStoredChange,
      onWorkChange,
    );
    return { sessions, guarded };
  },
});

/**
 * Supplies the runtime settings used by one delivery assembly.
 */
type DeliveryAssemblyConfiguration = Partial<
  Pick<
    DeliveryConfiguration,
    | "processingTimeoutMs"
    | "reminderIntervalMs"
    | "maxRetainedMessages"
    | "maxRetainedBytes"
    | "maxTrackedShards"
  >
> & {
  /**
   * Reports exact usage and revision when a session expires without a caller request.
   */
  readonly onAutonomousExpiry?: (snapshot: {
    readonly revision: bigint;
    readonly usage: DeliveryResourceUsage;
  }) => void;
};

/**
 * Default settings for listener-free assembly tests and callers.
 */
const DEFAULT_ASSEMBLY_CONFIGURATION: DeliveryAssemblyConfiguration = Object.freeze({
  processingTimeoutMs: 60_000,
  reminderIntervalMs: 10_000,
  ...DEFAULT_DELIVERY_STATE_LIMITS,
});
