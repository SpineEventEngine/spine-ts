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
  ShardObservingService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";

import { AdminPublisher } from "../admin/admin-service.js";
import { InMemoryDeliveryState } from "../core/in-memory-delivery-state.js";
import { InboxHandlers } from "../core/inbox-service.js";
import { MutationAdmission } from "../core/mutation-admission.js";
import { ShardHandlers } from "../core/shard-service.js";
import { ShardObserving } from "../core/shard-observing-service.js";
import { DEFAULT_DELIVERY_STATE_LIMITS } from "../core/limits.js";
import type { DeliveryConfiguration } from "./config.js";

/**
 * Groups handlers and shutdown boundaries that share delivery runtime state.
 */
export interface DeliveryAssembly {
  // prettier-ignore

  /**
   * Provides Inbox handlers backed by the shared delivery state.
   */
  readonly inbox: ServiceImpl<typeof InboxService>;

  /**
   * Provides Shard handlers backed by the shared delivery state.
   */
  readonly shards: ServiceImpl<typeof ShardService>;

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
    configuration: DeliveryAssemblyConfiguration = {
      processingTimeoutMs: 0,
      reminderIntervalMs: 10_000,
      ...DEFAULT_DELIVERY_STATE_LIMITS,
    },
  ): DeliveryAssembly => {
    const state = new InMemoryDeliveryState(configuration);
    const admission = new MutationAdmission();
    const admin = AdminPublisher.create(state);
    const observing = ShardObserving.create(state, configuration.reminderIntervalMs ?? 10_000);
    const onMessageTransition = (shard: ShardIndex, delta: 1 | -1) => {
      admin.recordMessageTransition(shard, delta);
      observing.changed(shard);
    };
    const onShardTransition = (shard: ShardIndex) => {
      admin.publish(shard);
      observing.changed(shard);
    };
    return Object.freeze({
      inbox: InboxHandlers.create(state, admission, onMessageTransition),
      shards: ShardHandlers.create(
        state,
        admission,
        () => Time.currentTimeMillis(),
        configuration.processingTimeoutMs ?? 0,
        onShardTransition,
      ),
      admin: admin.service,
      observing: observing.service,
      closeAdmission: () => admission.close(),
      closeAdmin: () => admin.close(),
      closeObserving: () => observing.close(),
    });
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
>;
