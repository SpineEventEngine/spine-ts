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
import type { ShardIndex } from "@spine-event-engine/proto/delivery";
import {
  AdminService,
  InboxService,
  ShardObservingService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";

import { AdminPublisher, type AdminPublisherHandle } from "../admin/admin-service.js";
import { InMemoryDeliveryState } from "../core/in-memory-delivery-state.js";
import { InboxHandlers } from "../core/inbox-service.js";
import { MutationAdmission } from "../core/mutation-admission.js";
import { ShardSessionRuntime } from "../core/shard-service.js";
import { ShardObserving, type ShardObservingHandle } from "../core/shard-observing-service.js";
import type { DeliveryConfiguration } from "./config.js";

/**
 * Groups handlers and shutdown boundaries that share delivery runtime state.
 */
export interface DeliveryAssembly {
  // prettier-ignore

  /**
   * Provides the canonical retained state for local service handlers.
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
   * Exposes session revision operations used by local service handlers.
   */
  readonly sessionRuntime: ShardSessionRuntime;

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
    configuration: DeliveryAssemblyConfiguration = DEFAULT_ASSEMBLY_CONFIGURATION,
  ): DeliveryAssembly => {
    const state = new InMemoryDeliveryState();
    const admission = new MutationAdmission();
    const admin = AdminPublisher.create(state);
    const observing = ShardObserving.create(state, configuration.reminderIntervalMs ?? 10_000);
    const sessions = DeliverySessionAssembly.create(
      state,
      admission,
      configuration,
      (shard: ShardIndex) => {
        admin.publish(shard);
        observing.changed(shard);
      },
    );
    return DeliveryAssemblyWiring.create(state, admission, admin, observing, sessions);
  },
});

/**
 * Connects the shared storage, session, observation, and close handlers.
 */
const DeliveryAssemblyWiring = Object.freeze({
  /**
   * Builds the complete in-process service assembly.
   *
   * @param state Stores retained rows and sessions.
   * @param admission Serializes local mutations.
   * @param admin Publishes stored shard changes.
   * @param observing Publishes available work.
   * @param sessions Serves shard session calls.
   * @returns The complete in-process service assembly.
   */
  create(
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    admin: AdminPublisherHandle,
    observing: ShardObservingHandle,
    sessions: ShardSessionRuntime,
  ): DeliveryAssembly {
    return Object.freeze({
      state,
      inbox: InboxHandlers.create(
        state,
        admission,
        admin.publish.bind(admin),
        observing.changed.bind(observing),
      ),
      shards: sessions.service,
      sessionRuntime: sessions,
      admin: admin.service,
      observing: observing.service,
      closeAdmission: admission.close.bind(admission),
      closeAdmin: admin.close.bind(admin),
      closeObserving: observing.close.bind(observing),
    });
  },
});

/**
 * Constructs session and inbox work handlers over one admission queue.
 */
const DeliverySessionAssembly = Object.freeze({
  /**
   * Creates coupled session and inbox work handlers.
   *
   * @param state Stores canonical rows and sessions.
   * @param admission Serializes mutations.
   * @param configuration Supplies the session lifetime.
   * @param onShardTransition Publishes session changes.
   * @returns The shard session handler.
   */
  create(
    state: InMemoryDeliveryState,
    admission: MutationAdmission,
    configuration: DeliveryAssemblyConfiguration,
    onShardTransition: (shard: ShardIndex) => void,
  ) {
    const now = configuration.now ?? (() => Time.currentTime());
    const sessions = new ShardSessionRuntime(
      state,
      admission,
      now,
      configuration.processingTimeoutMs ?? 0,
      onShardTransition,
    );
    return sessions;
  },
});

/**
 * Supplies the runtime settings used by one delivery assembly.
 */
type DeliveryAssemblyConfiguration = Partial<
  Pick<DeliveryConfiguration, "processingTimeoutMs" | "reminderIntervalMs">
> & {
  /**
   * Samples the wall clock for session and acknowledgement timestamps.
   */
  readonly now?: () => Timestamp;

  /**
   * Measures lease duration independently of wall-clock changes.
   */
  readonly monotonicNow?: () => number;
};

/**
 * Default settings for listener-free assembly tests and callers.
 */
const DEFAULT_ASSEMBLY_CONFIGURATION: DeliveryAssemblyConfiguration = Object.freeze({
  processingTimeoutMs: 0,
  reminderIntervalMs: 10_000,
});
