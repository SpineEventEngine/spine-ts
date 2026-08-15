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

import type { Event } from "@spine-event-engine/proto";
import type { MessageSchema } from "@spine-event-engine/core";

/**
 * Small multicast event-dispatch seam for bus and repository adapters.
 *
 * Dispatchers declare the event message schemas they accept and perform
 * handling behind the bus seam. Repository-backed adapters own projection or
 * subscriber invocation; the bus validates, stores, and routes event envelopes.
 */
export interface EventDispatcher {
  // prettier-ignore

  /**
   * Lists generated event message schemas accepted by this dispatcher.
   *
   * @returns the accepted message schemas.
   */
  messageSchemas(): readonly MessageSchema[];

  /**
   * Optional subset of accepted schemas whose receptors accept imported events.
   * Omission preserves the established domestic-only default.
   *
   * @returns schemas accepted when `EventContext.external` is true.
   */
  externalEventSchemas?(): readonly MessageSchema[];

  /**
   * Performs dispatcher-specific acceptance before dispatch.
   *
   * The bus gives each dispatcher its own Event snapshot. After successful
   * acceptance, the same snapshot is passed to this dispatcher's `dispatch()`.
   * For a newly posted Event on a storing bus, acceptance occurs before Event
   * Store append. Already-stored and forgetting buses perform no new append.
   *
   * @param event the event envelope to validate.
   * @returns A promise that resolves after validation completes.
   */
  accept?(event: Event): Promise<void>;

  /**
   * Dispatches one generated Spine event envelope.
   *
   * When `accept()` is present, this receives the dispatcher-local snapshot
   * that acceptance validated.
   *
   * @param event the event envelope to dispatch.
   * @returns A promise that resolves after the event is dispatched.
   */
  dispatch(event: Event): Promise<void>;
}
