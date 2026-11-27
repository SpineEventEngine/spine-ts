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

import type { DeliveryRunOptions } from "./delivery-builder.js";
import type { DeliveryRun } from "./delivery.js";
import type { InboxMessage } from "./inbox.js";
import type { ShardIndex } from "./shard-index.js";

/**
 * Describes one framework-controlled finite delivery request.
 */
export interface DeliveryControlledRun extends DeliveryRunOptions {
  /**
   * Identifies the shard to drain.
   */
  readonly shard: ShardIndex;

  /**
   * Cancels the controlled run.
   */
  readonly signal: AbortSignal;

  /**
   * Checks whether the private run accepts a pending row.
   *
   * @param message Supplies the pending row.
   * @returns Whether this run accepts the pending row.
   */
  readonly acceptMessage?: (message: InboxMessage) => boolean;

  /**
   * Observes one settled message attempt.
   *
   * @param message Supplies the attempted row.
   */
  readonly onMessageSettled?: (message: InboxMessage) => void;

  /**
   * Completes private admission cleanup when the run settles.
   */
  readonly onRunSettled?: () => void;

  /**
   * Observes the full finite result before reducing its public status.
   *
   * @param result Supplies the physical drain result.
   */
  readonly onDrainResult?: (result: DeliveryRun) => void;
}
