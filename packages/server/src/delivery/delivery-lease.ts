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

/**
 * Validates delivery and shard lease durations.
 */
export const DeliveryLeases: Readonly<{
  requireMs(owner: "Delivery" | "ShardedWorkRegistry", value: unknown): number;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Validates one delivery or shard lease duration.
   *
   * @param owner Names the component that owns the lease.
   * @param value Supplies the requested lease duration.
   * @returns The validated lease duration in milliseconds.
   */
  requireMs(owner: "Delivery" | "ShardedWorkRegistry", value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
      throw new Error(`${owner} leaseMs must be a positive safe integer.`);
    return value;
  },
});
