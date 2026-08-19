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

import {
  deliveryControls,
  type Delivery,
  type DeliveryResult,
  type DeliveryRunOptions,
} from "./delivery-builder.js";
import type { ShardIndex } from "./shard-index.js";
import type { InboxMessage } from "./inbox.js";

/**
 * Controls admission for one finite delivery run.
 */
export class DeliveryRunControl {
  readonly #runControlled: (options: DeliveryControlledRun) => Promise<DeliveryResult>;

  /**
   * Creates controlled admission for a builder-created delivery.
   *
   * @param delivery The builder-created delivery to control.
   */
  constructor(delivery: Delivery) {
    const runControlled = deliveryControls.runner(delivery);
    if (runControlled === undefined) {
      throw new TypeError("DeliverySupervisor requires a Delivery built by DeliveryBuilder.");
    }
    this.#runControlled = runControlled;
  }

  /**
   * Executes one controlled delivery until it settles or its signal aborts.
   *
   * @param options The finite shard run and its cancellation signal.
   * @returns The delivery result, or an abort error.
   */
  run(options: DeliveryControlledRun): Promise<DeliveryResult> {
    if (options.signal.aborted) return Promise.reject(this.#abortError(options.signal));
    const settled = this.#runControlled(options);
    let aborted: Error | undefined;
    const abort = () => {
      aborted = this.#abortError(options.signal);
    };
    options.signal.addEventListener("abort", abort, { once: true });
    // spine-log-boundary: server.delivery_control_settlement_observer
    void settled.catch(() => undefined);
    return settled
      .then(
        (result) => {
          if (aborted !== undefined) throw aborted;
          return result;
        },
        (error: unknown) => {
          throw error;
        },
      )
      .finally(() => {
        options.signal.removeEventListener("abort", abort);
      });
  }

  #abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error("Delivery run was aborted.");
  }
}

/**
 * Describes one controlled finite delivery request.
 */
export interface DeliveryControlledRun extends DeliveryRunOptions {
  // prettier-ignore

  /**
   * Identifies the shard to drain.
   */
  readonly shard: ShardIndex;

  /**
   * Cancels the controlled run.
   */
  readonly signal: AbortSignal;

  /**
   * Selects pending rows owned by the private controlled run before dispatch or acknowledgment.
   *
   * @internal
   */
  readonly acceptMessage?: (message: InboxMessage) => boolean;
}
