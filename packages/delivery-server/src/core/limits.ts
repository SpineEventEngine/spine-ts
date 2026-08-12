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
 * Delivery-server resource limits. They deliberately remain well below the
 * 4 MiB delivery RPC ceiling, so one bounded shard response can be encoded.
 */
export interface DeliveryStateLimits {
  // prettier-ignore

  /**
   * Limits retained messages.
   */
  readonly maxRetainedMessages: number;

  /**
   * Limits retained serialized bytes.
   */
  readonly maxRetainedBytes: number;

  /**
   * Limits tracked shards.
   */
  readonly maxTrackedShards: number;
}

/**
 * Limits encoded delivery RPC bytes.
 */
export const MAX_DELIVERY_RPC_BYTES = 4_194_304;

/**
 * Limits messages accepted in one batch.
 */
export const MAX_DELIVERY_BATCH_MESSAGES = 100;

/**
 * Limits encoded Inbox payload bytes.
 */
export const MAX_INBOX_PAYLOAD_BYTES = 1_048_576;

/**
 * Leaves room for the optional/page response wrapper below the RPC ceiling.
 */
export const MAX_INBOX_RECORD_BYTES: number = MAX_DELIVERY_RPC_BYTES - 64;

/**
 * Limits shards in a delivery response.
 */
export const MAX_DELIVERY_RESPONSE_SHARDS = 1_000;

/**
 * Keeps one bounded 1,000-session expiration response below the 4 MiB RPC ceiling.
 */
export const MAX_DELIVERY_WORKER_BYTES = 128;

/**
 * Limits generic delivery integer values.
 */
export const MAX_DELIVERY_LIMIT = 2_147_483_647;

/**
 * Provides default retained-state bounds.
 */
export const DEFAULT_DELIVERY_STATE_LIMITS: DeliveryStateLimits = Object.freeze({
  maxRetainedMessages: 10_000,
  maxRetainedBytes: 32 * 1_024 * 1_024,
  maxTrackedShards: MAX_DELIVERY_RESPONSE_SHARDS,
});

/**
 * Provides delivery limit validation.
 */
export const DeliveryLimits: Readonly<{
  // prettier-ignore

  /**
   * Resolves and validates retained-state limits.
   *
   * @param options Overrides default retained-state bounds.
   * @returns Provides frozen validated limits.
   */
  resolve(options?: Partial<DeliveryStateLimits>): DeliveryStateLimits;
  require(value: number, maximum: number, name: string): void;
}> = Object.freeze({
  resolve(options: Partial<DeliveryStateLimits> = {}): DeliveryStateLimits {
    const limits = {
      maxRetainedMessages:
        options.maxRetainedMessages ?? DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedMessages,
      maxRetainedBytes: options.maxRetainedBytes ?? DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedBytes,
      maxTrackedShards: options.maxTrackedShards ?? DEFAULT_DELIVERY_STATE_LIMITS.maxTrackedShards,
    };
    DeliveryLimits.require(limits.maxRetainedMessages, MAX_DELIVERY_LIMIT, "maxRetainedMessages");
    DeliveryLimits.require(limits.maxRetainedBytes, MAX_DELIVERY_LIMIT, "maxRetainedBytes");
    DeliveryLimits.require(
      limits.maxTrackedShards,
      MAX_DELIVERY_RESPONSE_SHARDS,
      "maxTrackedShards",
    );
    return Object.freeze(limits);
  },

  /**
   * Requires a bounded positive integer limit.
   */
  require(value: number, maximum: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new RangeError(`Delivery server ${name} is invalid.`);
  },
});
