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
import type { CommandContext } from "@spine-event-engine/proto";

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

interface CommandRoutingState<Id> {
  readonly exact: Map<MessageSchema, CommandRoute<Id>>;
  defaultRoute: CommandRoute<Id> | undefined;
}

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
    routingStates.set(this, {
      exact: new Map<MessageSchema, CommandRoute<Id>>(),
      defaultRoute: undefined,
    });
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
   * Registers an exact generated Command schema route.
   *
   * @param schema Generated Command message schema.
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  route<Schema extends MessageSchema>(schema: Schema, via: CommandRoute<Id, Schema>): this {
    if (typeof via !== "function")
      throw new TypeError("Command routing requires a route function.");
    const state = CommandRoutingInternals.state(this);
    if (state.exact.has(schema))
      throw new Error("Command routing has a duplicate exact command route.");
    state.exact.set(schema, via);
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
    CommandRoutingInternals.state(this).defaultRoute = via;
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
  snapshot<Id>(routing: CommandRouting<Id> | undefined): Readonly<{
    exact: ReadonlyMap<MessageSchema, CommandRoute<Id>>;
    defaultRoute: CommandRoute<Id> | undefined;
  }>;
}> = Object.freeze({
  state<Id>(routing: CommandRouting<Id>): CommandRoutingState<Id> {
    return routingStates.get(routing) as CommandRoutingState<Id>;
  },
  snapshot<Id>(routing: CommandRouting<Id> | undefined): Readonly<{
    exact: ReadonlyMap<MessageSchema, CommandRoute<Id>>;
    defaultRoute: CommandRoute<Id> | undefined;
  }> {
    if (routing === undefined) {
      return Object.freeze({
        exact: new Map<MessageSchema, CommandRoute<Id>>(),
        defaultRoute: undefined,
      });
    }
    const state = CommandRoutingInternals.state(routing);
    return Object.freeze({
      exact: new Map(state.exact),
      defaultRoute: state.defaultRoute,
    });
  },
});
