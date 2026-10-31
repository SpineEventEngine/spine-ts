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

import { clone } from "@bufbuild/protobuf";
import {
  SubscriptionUpdateSchema,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import type { ReadSideContext } from "./read-side-filter.js";
import type { ReadSideFilterEngine } from "./read-side-filter-engine.js";

/**
 * Carries original matched data and its lazy BC filtering capability to native admission.
 */
export interface SubscriptionReadWork {
  /**
   * Stores the matched update before either read-policy scope changes its domain data.
   */
  readonly update: SubscriptionUpdate;

  /**
   * Applies this producing BC's policy only after native queue admission.
   *
   * @param facts Admitted activation and actual subscription operation context.
   * @returns Surviving matched update or null when its data is removed.
   */
  readonly filter: (facts: ReadSideContext) => Promise<SubscriptionUpdate | null>;
}

/**
 * Applies one read-policy scope to data in an already matched subscription update.
 */
class SubscriptionReadFilterScope {
  /**
   * Processes only domain data, retaining acknowledgements and existing removals.
   *
   * @param update Matched source update with original identity and envelope fields.
   * @param filters Installed BC or Server read-policy scope.
   * @param facts Actual subscription operation and trusted activation facts.
   * @returns Detached surviving data or control, or null for an empty data batch.
   */
  async apply(
    update: SubscriptionUpdate,
    filters: ReadSideFilterEngine | undefined,
    facts: ReadSideContext,
  ): Promise<SubscriptionUpdate | null> {
    const visible = clone(SubscriptionUpdateSchema, update);
    if (filters === undefined) return visible;
    if (visible.update.case === "entityUpdates") return this.#states(visible, filters, facts);
    if (visible.update.case === "eventUpdates") return this.#events(visible, filters, facts);
    return visible;
  }

  /**
   * Replaces Entity states or emits removal using their original packed IDs.
   *
   * @param update Detached Entity data batch.
   * @param filters Scope selected for this delivery boundary.
   * @param facts Current reader and Topic facts.
   * @returns Entity update with filtered states or removal controls.
   */
  async #states(
    update: SubscriptionUpdate,
    filters: ReadSideFilterEngine,
    facts: ReadSideContext,
  ): Promise<SubscriptionUpdate> {
    if (update.update.case !== "entityUpdates") return update;
    for (const item of update.update.value.update) {
      if (item.kind.case !== "state") continue;
      const state = await filters.applyPacked(item.kind.value, facts);
      item.kind =
        state === null
          ? { case: "noLongerMatching", value: true }
          : { case: "state", value: state };
    }
    return update;
  }

  /**
   * Replaces visible domain payloads inside their original Event envelopes.
   *
   * @param update Detached Event data batch.
   * @param filters Scope selected for this delivery boundary.
   * @param facts Current reader and Topic facts.
   * @returns Event update or null when every Event was removed.
   */
  async #events(
    update: SubscriptionUpdate,
    filters: ReadSideFilterEngine,
    facts: ReadSideContext,
  ): Promise<SubscriptionUpdate | null> {
    if (update.update.case !== "eventUpdates") return update;
    const surviving = [];
    for (const event of update.update.value.event) {
      if (event.message === undefined)
        throw new TypeError("Subscription Event payload is missing.");
      const payload = await filters.applyPacked(event.message, facts);
      if (payload !== null) {
        event.message = payload;
        surviving.push(event);
      }
    }
    if (surviving.length === 0) return null;
    update.update.value.event = surviving;
    return update;
  }
}

/**
 * Reuses one policy traversal without exposing an additional constructor.
 */
export const SubscriptionReadFilters: SubscriptionReadFilterScope =
  new SubscriptionReadFilterScope();
