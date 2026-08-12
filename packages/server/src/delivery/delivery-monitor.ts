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

import type { InboxMessage } from "./inbox.js";
import type { ShardIndex } from "./shard-index.js";

/**
 * Executes a monitor-selected asynchronous reception outcome.
 */
export interface ReceptionAction {
  // prettier-ignore

  /**
   * Executes the selected reception outcome.
   *
   * @returns A promise that settles when the outcome has completed.
   */
  execute(): Promise<void>;
}

/**
 * Executes a monitor-selected pickup outcome.
 */
export interface PickUpAction {
  // prettier-ignore

  /**
   * Executes the selected pickup outcome.
   *
   * @returns A promise that settles when the outcome has completed.
   */
  execute(): Promise<void>;
}

/**
 * Describes a failed dispatch of one Inbox message.
 */
export class FailedReception {
  // prettier-ignore

  /**
   * Creates facts and fallback actions for a failed reception.
   *
   * @param message The message whose dispatch failed.
   * @param error The dispatch failure.
   * @param mark Marks the message delivered under the current shard session.
   * @param repeat Repeats dispatch once under the current shard session.
   */
  constructor(
    readonly message: InboxMessage,
    readonly error: unknown,
    private readonly mark: () => Promise<void>,
    private readonly repeat: () => Promise<void>,
  ) {}

  /**
   * Returns durable acknowledgement of the failed row.
   *
   * @returns The acknowledgement action.
   */
  markDelivered(): ReceptionAction {
    return Object.freeze({ execute: this.mark });
  }

  /**
   * Returns one immediate repeat of the failed dispatch.
   *
   * @returns The repeat-dispatch action.
   */
  repeatDispatching(): ReceptionAction {
    return Object.freeze({ execute: this.repeat });
  }
}

/**
 * Describes a failed shard acquisition.
 */
export class FailedPickUp {
  // prettier-ignore

  /**
   * Creates facts for a failed shard acquisition.
   *
   * @param shard The shard whose acquisition failed.
   * @param error The acquisition failure.
   */
  constructor(
    readonly shard: ShardIndex,
    readonly error: unknown,
  ) {}

  /**
   * Returns a failed delivery result without acquiring ownership.
   *
   * @returns The failed-result action.
   */
  fail(): PickUpAction {
    return Object.freeze({ execute: () => Promise.resolve() });
  }
}

/**
 * Describes a shard already owned by another worker.
 */
export class AlreadyPickedUp {
  // prettier-ignore

  /**
   * Creates facts for an already-owned shard.
   *
   * @param shard The shard already owned by another worker.
   */
  constructor(readonly shard: ShardIndex) {}

  /**
   * Returns a skipped delivery result without acquiring ownership.
   *
   * @returns The skipped-result action.
   */
  skip(): PickUpAction {
    return Object.freeze({ execute: () => Promise.resolve() });
  }
}

/**
 * Identifies a point at which a monitor can stop finite delivery.
 */
export type DeliveryStage = "DELIVERY" | "PAGE";

/**
 * Summarizes one completed finite delivery.
 */
export interface DeliveryStatistics {
  // prettier-ignore

  /**
   * Counts messages considered for endpoint dispatch.
   */
  readonly processed: number;

  /**
   * Counts messages durably acknowledged as delivered.
   */
  readonly delivered: number;

  /**
   * Counts dispatch or acknowledgement failures observed by the run.
   */
  readonly failed: number;
}

/**
 * Controls finite delivery failure actions without scheduling retries.
 *
 * Subclasses can return direct values or promises from every hook. The default
 * reception policy marks the failed row delivered so independent targets keep
 * draining; it never persists attempts, receipts, markers, or quarantine data.
 */
export class DeliveryMonitor {
  // prettier-ignore

  /**
   * Checks whether delivery can continue after a lifecycle stage.
   *
   * @param stage The stage that has just been reached.
   * @returns Whether the current finite delivery should continue.
   */
  shouldContinueAfter(stage: DeliveryStage): boolean | Promise<boolean> {
    void stage;
    return true;
  }

  /**
   * Handles successful shard ownership before Inbox reads begin.
   *
   * @param shard The owned shard about to drain.
   * @returns A promise that settles after the hook completes.
   */
  onDeliveryStarted(shard: ShardIndex): void | Promise<void> {
    void shard;
  }

  /**
   * Handles a delivery after shard ownership has been released.
   *
   * @param statistics The immutable result counts for the finished delivery.
   * @returns A promise that settles after the hook completes.
   */
  onDeliveryCompleted(statistics: DeliveryStatistics): void | Promise<void> {
    void statistics;
  }

  /**
   * Returns an action after endpoint dispatch or acknowledgement fails.
   *
   * @param reception The failure facts and one-shot actions.
   * @returns The selected asynchronous reception action.
   */
  onReceptionFailure(reception: FailedReception): ReceptionAction | Promise<ReceptionAction> {
    return reception.markDelivered();
  }

  /**
   * Returns an action after shard acquisition fails.
   *
   * @param failure The failed acquisition facts.
   * @returns The selected pickup action.
   */
  onShardPickUpFailure(failure: FailedPickUp): PickUpAction | Promise<PickUpAction> {
    return failure.fail();
  }

  /**
   * Returns an action when another worker already owns the shard.
   *
   * @param failure The already-owned shard facts.
   * @returns The selected pickup action.
   */
  onShardAlreadyPicked(failure: AlreadyPickedUp): PickUpAction | Promise<PickUpAction> {
    return failure.skip();
  }
}
