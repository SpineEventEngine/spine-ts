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

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Result of one Agent-specific admission inside ordinary Inbox delivery.
 */
export type AgentDeliveryOutcome =
  | {
      /**
       * Indicates capacity deferral before receipt admission.
       */
      readonly kind: "deferred";
    }
  | {
      /**
       * Indicates a provider error that must not acknowledge the row.
       */
      readonly kind: "error";

      /**
       * Original provider or admission error.
       */
      readonly error: unknown;
    }
  | {
      /**
       * Indicates a previously accepted exact signal.
       */
      readonly kind: "duplicate";
    }
  | {
      /**
       * Indicates a newly accepted exact signal.
       */
      readonly kind: "accepted";

      /**
       * Executes the admitted live turn after Inbox acknowledgement.
       *
       * @param signal Cancellation signal for the admitted turn.
       * @param checkSession Validates the current shard session before commit.
       * @returns Completion of the admitted Agent turn.
       */
      readonly run: (signal: AbortSignal, checkSession: () => Promise<void>) => Promise<void>;

      /**
       * Clears the capacity reservation when acknowledgement does not complete.
       */
      readonly discard: () => void;
    };

interface ScopedOutcome {
  value?: AgentDeliveryOutcome;
  readonly signal: AbortSignal;
}

const dispatches = new AsyncLocalStorage<ScopedOutcome>();

interface AgentDeliveryScopeAccess {
  /**
   * Executes one endpoint callback inside its exact Agent outcome scope.
   *
   * @param onDispatch Endpoint callback to run in the scoped context.
   * @param signal Cancellation signal for this delivery attempt.
   * @returns Recorded Agent outcome, when the endpoint admitted one.
   */
  run(
    onDispatch: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<AgentDeliveryOutcome | undefined>;

  /**
   * Returns the current delivery cancellation fence.
   * @returns Cancellation signal for the current delivery attempt, if present.
   */
  signal(): AbortSignal | undefined;

  /**
   * Records the exact Agent admission outcome.
   * @param outcome Exact admission outcome for the current delivery attempt.
   */
  record(outcome: AgentDeliveryOutcome): void;
}

/**
 * Carries an internal Agent outcome through the existing void endpoint callback.
 */
export const AgentDeliveryScope: AgentDeliveryScopeAccess = Object.freeze({
  /**
   * Executes one endpoint callback and returns its Agent outcome, if one was recorded.
   */
  async run(
    onDispatch: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<AgentDeliveryOutcome | undefined> {
    const scoped: ScopedOutcome = { signal };
    await dispatches.run(scoped, onDispatch);
    return scoped.value;
  },

  /**
   * Returns the cancellation fence for the current ordinary delivery attempt.
   */
  signal(): AbortSignal | undefined {
    return dispatches.getStore()?.signal;
  },

  /**
   * Records one Agent admission result for the current ordinary delivery attempt.
   */
  record(outcome: AgentDeliveryOutcome): void {
    const scoped = dispatches.getStore();
    if (scoped === undefined || scoped.value !== undefined)
      throw new Error("Agent admission requires one current delivery attempt.");
    scoped.value = outcome;
  },
});
