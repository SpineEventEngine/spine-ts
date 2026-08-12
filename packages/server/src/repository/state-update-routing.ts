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

import type { MessageShape } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import type { EventContext } from "@spine-event-engine/proto";

/**
 * Calculates target Entity IDs for one accepted Entity state update.
 *
 * The route must be deterministic and side-effect-free. It runs once during
 * admission; durable replay uses the stored target instead.
 *
 * @typeParam Id Entity ID type used by the receiving Projection repository.
 * @typeParam Schema Generated Entity state message schema.
 * @param state Unpacked new Entity state.
 * @param context Normalized System Event context.
 * @returns Up to 1,000 target Projection IDs. The framework validates,
 * copies, stable-deduplicates, and freezes accepted IDs. An empty array means
 * that this update is not delivered to this repository.
 */
export type StateUpdateRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  state: MessageShape<Schema>,
  context: EventContext,
) => readonly Id[];

interface State<Id> {
  readonly exact: Map<MessageSchema, StateUpdateRoute<Id>>;
  defaultRoute: StateUpdateRoute<Id> | undefined;
}
const states = new WeakMap<object, State<unknown>>();

/**
 * Mutable Entity-state route declarations snapshotted by repository construction.
 */
export class StateUpdateRouting<Id> {
  private constructor() {
    states.set(this, { exact: new Map(), defaultRoute: undefined });
  }

  /**
   * Creates empty Entity-state route declarations.
   *
   * @returns Mutable declarations for one repository.
   */
  static create<Id>(): StateUpdateRouting<Id> {
    return new StateUpdateRouting<Id>();
  }

  /**
   * Registers an exact generated Entity-state schema route.
   *
   * @param schema Generated Entity-state schema to match.
   * @param via Route function to invoke.
   * @returns These mutable declarations.
   */
  route<Schema extends MessageSchema>(schema: Schema, via: StateUpdateRoute<Id, Schema>): this {
    if (typeof via !== "function")
      throw new TypeError("State-update routing requires a route function.");
    const state = StateUpdateRoutingInternals.state(this);
    if (state.exact.has(schema))
      throw new Error("State-update routing has a duplicate exact state-update route.");
    state.exact.set(schema, via);
    return this;
  }

  /**
   * Replaces the first-compatible-field default state route.
   *
   * @param via Replacement route function.
   * @returns These mutable declarations.
   */
  replaceDefault(via: StateUpdateRoute<Id>): this {
    if (typeof via !== "function")
      throw new TypeError("State-update routing requires a route function.");
    StateUpdateRoutingInternals.state(this).defaultRoute = via;
    return this;
  }
}

/**
 * Internal access to state-routing declaration state.
 *
 * @internal Repository construction support.
 */
export const StateUpdateRoutingInternals: Readonly<{
  state<Id>(routing: StateUpdateRouting<Id>): State<Id>;
  snapshot<Id>(routing: StateUpdateRouting<Id> | undefined): Readonly<{
    exact: ReadonlyMap<MessageSchema, StateUpdateRoute<Id>>;
    defaultRoute: StateUpdateRoute<Id> | undefined;
  }>;
}> = Object.freeze({
  state<Id>(routing: StateUpdateRouting<Id>): State<Id> {
    return states.get(routing) as State<Id>;
  },
  snapshot<Id>(routing: StateUpdateRouting<Id> | undefined) {
    if (routing === undefined) {
      return Object.freeze({
        exact: new Map<MessageSchema, StateUpdateRoute<Id>>(),
        defaultRoute: undefined,
      });
    }
    const state = StateUpdateRoutingInternals.state(routing);
    return Object.freeze({
      exact: new Map(state.exact),
      defaultRoute: state.defaultRoute,
    });
  },
});
