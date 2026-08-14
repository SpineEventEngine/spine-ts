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
import {
  MessageInterfaces,
  type MessageInterface,
  type MessageSchema,
} from "@spine-event-engine/core";
import type { EventContext } from "@spine-event-engine/proto";
import {
  RoutingDeclarations,
  type InterfaceRouteMessage,
  type RoutingDeclarationSnapshot,
  type RoutingDeclarationState,
} from "./routing-declarations.js";

type InterfaceSchemas = readonly [MessageSchema, ...MessageSchema[]];

/**
 * Calculates target Entity IDs for one Event admission.
 *
 * The route must be deterministic and side-effect-free. It runs once for an
 * accepted admission; durable replay uses stored targets instead.
 *
 * @typeParam Id Entity ID type used by the receiving repository.
 * @typeParam Schema Generated Event message schema.
 * @param message Unpacked Event message.
 * @param context Normalized Event context. When the signal omits its context,
 *   the framework supplies the default generated `EventContext` value.
 * @returns Up to 1,000 target Entity IDs. The framework validates the complete
 *   result, copies and stable-deduplicates its IDs, and freezes the accepted
 *   plan. An empty array deliberately suppresses delivery to this repository.
 */
export type EventRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  message: MessageShape<Schema>,
  context: EventContext,
) => readonly Id[];

type State<Id> = RoutingDeclarationState<EventRoute<Id>>;
const states = new WeakMap<object, State<unknown>>();

/**
 * Mutable Event route declarations snapshotted by repository construction.
 */
export class EventRouting<Id> {
  // prettier-ignore

  /**
   * Creates empty mutable Event route declarations.
   */
  private constructor() {
    states.set(this, RoutingDeclarations.create<EventRoute<Id>>());
  }

  /**
   * Creates empty Event route declarations.
   *
   * @typeParam Id Entity ID type used by the receiving repository.
   * @returns Mutable Event route declarations.
   */
  static create<Id>(): EventRouting<Id> {
    return new EventRouting<Id>();
  }

  /**
   * Registers an exact generated Event schema route.
   *
   * @param schema Generated Event message schema.
   * @param via Route that calculates target Entity IDs.
   * @returns These mutable route declarations.
   */
  route<Schema extends MessageSchema>(schema: Schema, via: EventRoute<Id, Schema>): this;
  route<TInterface extends object, Schemas extends InterfaceSchemas>(
    token: MessageInterface<TInterface, Schemas>,
    via: (message: InterfaceRouteMessage<TInterface, Schemas>, context: EventContext) => readonly Id[],
  ): this;
  route(
    schemaOrToken: MessageSchema | MessageInterface<object, InterfaceSchemas>,
    via: EventRoute<Id>,
  ): this {
    if (typeof via !== "function") throw new TypeError("Event routing requires a route function.");
    const state = EventRoutingInternals.state(this);
    if (
      MessageInterfaces.is(schemaOrToken) ||
      (typeof schemaOrToken === "object" && schemaOrToken !== null && "schemas" in schemaOrToken)
    ) {
      RoutingDeclarations.routeInterface(state, schemaOrToken, via, "Event routing");
    } else {
      RoutingDeclarations.exact(
        state,
        schemaOrToken,
        via,
        "Event routing has a duplicate exact event route.",
      );
    }
    return this;
  }

  /**
   * Replaces the producer-aware default Event route.
   *
   * @param via Route that calculates target Entity IDs.
   * @returns These mutable route declarations.
   */
  replaceDefault(via: EventRoute<Id>): this {
    if (typeof via !== "function") throw new TypeError("Event routing requires a route function.");
    RoutingDeclarations.default(EventRoutingInternals.state(this), via);
    return this;
  }
}

/**
 * Internal access to Event-routing declaration state.
 *
 * @internal
 */
export const EventRoutingInternals: Readonly<{
  state<Id>(routing: EventRouting<Id>): State<Id>;
  snapshot<Id>(routing: EventRouting<Id> | undefined): RoutingDeclarationSnapshot<EventRoute<Id>>;
}> = Object.freeze({
  state<Id>(routing: EventRouting<Id>): State<Id> {
    return states.get(routing) as State<Id>;
  },
  snapshot<Id>(routing: EventRouting<Id> | undefined): RoutingDeclarationSnapshot<EventRoute<Id>> {
    if (routing === undefined) {
      return RoutingDeclarations.snapshot(RoutingDeclarations.create<EventRoute<Id>>());
    }
    return RoutingDeclarations.snapshot(EventRoutingInternals.state(routing));
  },
});
