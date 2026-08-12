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
import {
  AdminService,
  InboxService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";

import { AdminPublisher } from "../admin/admin-service.js";
import { InMemoryDeliveryState } from "../core/in-memory-delivery-state.js";
import { InboxHandlers } from "../core/inbox-service.js";
import { MutationAdmission } from "../core/mutation-admission.js";
import { ShardHandlers } from "../core/shard-service.js";
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
  create: (
    configuration?: Pick<
      DeliveryConfiguration,
      "processingTimeoutMs" | "maxRetainedMessages" | "maxRetainedBytes" | "maxTrackedShards"
    >,
  ) => DeliveryAssembly;
}> = Object.freeze({
  create: (
    configuration: Pick<
      DeliveryConfiguration,
      "processingTimeoutMs" | "maxRetainedMessages" | "maxRetainedBytes" | "maxTrackedShards"
    > = {
      processingTimeoutMs: 0,
      ...DEFAULT_DELIVERY_STATE_LIMITS,
    },
  ): DeliveryAssembly => {
    const state = new InMemoryDeliveryState(configuration);
    const admission = new MutationAdmission();
    const admin = AdminPublisher.create(state);
    return Object.freeze({
      inbox: InboxHandlers.create(state, admission, (shard, delta) => {
        admin.recordMessageTransition(shard, delta);
      }),
      shards: ShardHandlers.create(
        state,
        admission,
        Date.now,
        configuration.processingTimeoutMs,
        (shard) => {
          admin.publish(shard);
        },
      ),
      admin: admin.service,
      closeAdmission: () => {
        admission.close();
      },
      closeAdmin: () => {
        admin.close();
      },
    });
  },
});
