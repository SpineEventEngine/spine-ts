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
import { type MessageInterface, type MessageSchema } from "@spine-event-engine/core";
import type { CommandContext } from "@spine-event-engine/proto";
import {
  RoutingDeclarations,
  type InterfaceRouteSchemas,
  type InterfaceRouteMessage,
  type RoutingDeclarationSnapshot,
  type RoutingDeclarationState,
} from "./routing-declarations.js";

/**
 * Calculates one Entity ID for a Command message.
 *
 * @typeParam Id Entity ID type owned by the receiving repository.
 * @typeParam Schema Generated Command message schema.
 * @param message Unpacked Command message.
 * @param context Normalized Command context. When the signal omits its context,
 *   the framework supplies the default generated `CommandContext` value.
 * The route must be deterministic and side-effect-free. The framework invokes
 * it once for each accepted admission, and durable replay uses the stored
 * target instead of invoking it again.
 *
 * @returns Target Entity ID.
 */
export type CommandRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  message: MessageShape<Schema>,
  context: CommandContext,
) => Id;

type CommandRoutingState<Id> = RoutingDeclarationState<CommandRoute<Id>>;

const routingStates = new WeakMap<object, CommandRoutingState<unknown>>();

/**
 * Mutable Command route declarations that repositories snapshot at construction.
 *
 * @typeParam Id Entity ID type owned by the receiving repository.
 */
export class CommandRouting<Id> {
  // prettier-ignore

  /**
   * Creates empty mutable Command route declarations.
   */
  private constructor() {
    routingStates.set(this, RoutingDeclarations.create<CommandRoute<Id>>());
  }

  /**
   * Creates empty Command route declarations.
   *
   * @typeParam Id Entity ID type owned by the receiving repository.
   * @returns Mutable Command route declarations.
   */
  static create<Id>(): CommandRouting<Id> {
    return new CommandRouting<Id>();
  }

  /**
   * Registers a route for one exact generated Command schema.
   *
   * @param schemaOrToken Generated Command schema.
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  route<Schema extends MessageSchema>(schemaOrToken: Schema, via: CommandRoute<Id, Schema>): this;

  /**
   * Registers a route for a nominal Command message-interface token.
   *
   * @param schemaOrToken Generated Command message-interface token.
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  route<TInterface extends object, Schemas extends InterfaceRouteSchemas>(
    schemaOrToken: MessageInterface<TInterface, Schemas>,
    via: (message: InterfaceRouteMessage<TInterface, Schemas>, context: CommandContext) => Id,
  ): this;

  /**
   * Registers an exact generated Command-schema route or a nominal message-interface route.
   *
   * A schema route receives its exact message shape. An interface route receives
   * {@link InterfaceRouteMessage}, the member-message union intersected with
   * the declared interface. Routing selects an exact schema route first, then
   * the first matching interface token in registration order, then the
   * replacement/default route.
   *
   * Copied or malformed tokens fail during declaration. Every token member must
   * be registered by the repository, or construction fails. The selected route
   * runs once for an accepted admission; durable replay uses stored targets and
   * does not run routing again.
   *
   * @param schemaOrToken Generated Command schema or nominal message-interface token.
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  route(
    schemaOrToken: MessageSchema | MessageInterface<object, InterfaceRouteSchemas>,
    via: CommandRoute<Id>,
  ): this {
    if (typeof via !== "function")
      throw new TypeError("Command routing requires a route function.");
    const state = CommandRoutingInternals.state(this);
    if (RoutingDeclarations.isInterfaceTokenCandidate(schemaOrToken)) {
      RoutingDeclarations.routeInterface(state, schemaOrToken, via, "Command routing");
    } else {
      RoutingDeclarations.exact(
        state,
        schemaOrToken,
        via,
        "Command routing has a duplicate exact command route.",
      );
    }
    return this;
  }

  /**
   * Replaces the declaration-first default Command route.
   *
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  replaceDefault(via: CommandRoute<Id>): this {
    if (typeof via !== "function")
      throw new TypeError("Command routing requires a route function.");
    RoutingDeclarations.default(CommandRoutingInternals.state(this), via);
    return this;
  }
}

/**
 * Internal access to Command-routing declaration state.
 *
 * @internal
 */
export const CommandRoutingInternals: Readonly<{
  state<Id>(routing: CommandRouting<Id>): CommandRoutingState<Id>;
  snapshot<Id>(
    routing: CommandRouting<Id> | undefined,
  ): RoutingDeclarationSnapshot<CommandRoute<Id>>;
}> = Object.freeze({
  state<Id>(routing: CommandRouting<Id>): CommandRoutingState<Id> {
    return routingStates.get(routing) as CommandRoutingState<Id>;
  },
  snapshot<Id>(
    routing: CommandRouting<Id> | undefined,
  ): RoutingDeclarationSnapshot<CommandRoute<Id>> {
    if (routing === undefined) {
      return RoutingDeclarations.snapshot(RoutingDeclarations.create<CommandRoute<Id>>());
    }
    return RoutingDeclarations.snapshot(CommandRoutingInternals.state(routing));
  },
});
