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
  DeliveryOperationOptions,
  DeliveryWorkRegistry,
  DeliveryWorkSession,
} from "./delivery-ports.js";
import type { WorkerId } from "@spine-event-engine/proto/delivery";
import type { ShardIndex } from "./shard-index.js";

type OnConditionalPickUp = (
  shard: ShardIndex,
  worker: WorkerId,
  options?: DeliveryOperationOptions,
) => Promise<DeliveryWorkSession | undefined>;
const pickups = new WeakMap<DeliveryWorkRegistry, OnConditionalPickUp>();

/**
 * Provides framework-private conditional pickup for registries that support it.
 */
export const conditionalPickUp: Readonly<{
  // prettier-ignore

  /**
   * Records a registry's conditional pickup implementation.
   *
   * @param registry Identifies the supporting work registry.
   * @param pickUp Acquires only when remote pending work exists.
   */
  register: (registry: DeliveryWorkRegistry, pickUp: OnConditionalPickUp) => void;

  /**
   * Finds a registry's conditional pickup implementation.
   *
   * @param registry Identifies the work registry.
   * @returns The conditional pickup when the registry supports it.
   */
  for: (registry: DeliveryWorkRegistry) => OnConditionalPickUp | undefined;
}> = Object.freeze({
  register(registry: DeliveryWorkRegistry, pickUp: OnConditionalPickUp): void {
    pickups.set(registry, pickUp);
  },
  for(registry: DeliveryWorkRegistry): OnConditionalPickUp | undefined {
    return pickups.get(registry);
  },
});
