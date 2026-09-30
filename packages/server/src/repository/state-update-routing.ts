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
import type { EventContext } from "@spine-event-engine/proto";
import type {
  RepositoryEntityType,
  RepositoryReadQueries,
  RepositoryEntityId,
} from "./repository.js";
import {
  RoutingDeclarations,
  type InterfaceRouteSchemas,
  type InterfaceRouteMessage,
  type RoutingDeclarationSnapshot,
  type RoutingDeclarationState,
} from "./routing-declarations.js";

/**
 * Calculates target Entity IDs for one accepted Entity state update.
 *
 * The route must be deterministic and side-effect-free. It runs once during
 * admission; durable replay uses the stored target instead.
 *
 * @typeParam Id Entity ID type used by the receiving Projection repository.
 * @typeParam Schema Generated Entity state message schema.
 * @typeParam EntityType Registered Projection class for repository reads.
 * @param state Unpacked new Entity state.
 * @param context Normalized System Event context.
 * @param repository Invocation-scoped read-only access to the receiving repository.
 * @returns All target Projection IDs. The framework validates,
 * copies, stable-deduplicates, and freezes accepted IDs. An empty array means
 * that this update is not delivered to this repository.
 */
export type StateUpdateRoute<
  Id,
  Schema extends MessageSchema = MessageSchema,
  EntityType extends RepositoryEntityType = RepositoryEntityType,
> = (
  state: MessageShape<Schema>,
  context: EventContext,
  repository: RepositoryReadQueries<EntityType>,
) => readonly Id[] | Promise<readonly Id[]>;

/**
 * Stores mutable state-update declarations before repository construction.
 *
 * @typeParam Id Target Projection ID type.
 */
type State<Id> = RoutingDeclarationState<StateUpdateRoute<Id>>;
const states = new WeakMap<object, State<unknown>>();
const routingEntityTypes = new WeakMap<object, RepositoryEntityType>();

/**
 * Mutable Entity-state route declarations snapshotted by repository construction.
 *
 * @typeParam Id Projection ID type.
 * @typeParam EntityType Registered Projection class for repository reads.
 */
export class StateUpdateRouting<
  Id,
  EntityType extends RepositoryEntityType = RepositoryEntityType,
> {
  /**
   * Records the selected Entity class in emitted declarations so a different
   * repository class fails type checking. This adds no runtime field.
   *
   * @param entity Entity class type checked at assignment.
   * @returns The same Entity class type for the assignment check.
   */
  declare protected readonly entityClassType: (entity: EntityType) => EntityType;

  /**
   * Creates empty mutable state-update declarations.
   *
   * @param entityType Application Projection constructor, when class-aware.
   */
  private constructor(entityType?: EntityType) {
    states.set(this, RoutingDeclarations.create<StateUpdateRoute<Id>>());
    if (entityType !== undefined) routingEntityTypes.set(this, entityType);
  }

  /**
   * Creates empty Entity-state route declarations.
   *
   * @typeParam EntityType Registered Projection class inferred from the supplied constructor.
   * @param entityType Application Projection constructor for typed repository reads.
   * @returns Mutable declarations for one repository.
   */
  static create<EntityType extends RepositoryEntityType>(
    entityType: EntityType,
  ): StateUpdateRouting<RepositoryEntityId<EntityType>, EntityType>;

  /**
   * Creates ID-only state-update declarations.
   *
   * @typeParam Id Target Projection ID type.
   * @returns Mutable route declarations.
   */
  static create<Id>(): StateUpdateRouting<Id>;

  /**
   * Creates mutable state-update declarations for either factory overload.
   *
   * @typeParam Id Target Projection ID type.
   * @typeParam EntityType Selected application Projection class.
   * @param entityType Application Projection constructor, when class-aware.
   * @returns Mutable route declarations.
   */
  static create<Id, EntityType extends RepositoryEntityType = RepositoryEntityType>(
    entityType?: EntityType,
  ): StateUpdateRouting<Id, EntityType> {
    return new StateUpdateRouting<Id, EntityType>(entityType);
  }

  /**
   * Registers a route for one exact generated Entity-state schema.
   *
   * @typeParam Schema Generated Entity-state schema.
   * @param schemaOrToken Generated Entity-state schema.
   * @param via Route that calculates target Projection IDs.
   * @returns These mutable declarations.
   */
  route<Schema extends MessageSchema>(
    schemaOrToken: Schema,
    via: StateUpdateRoute<Id, Schema, EntityType>,
  ): this;

  /**
   * Registers a route for a nominal Entity-state message-interface token.
   *
   * @typeParam TInterface Declared state interface.
   * @typeParam Schemas Schemas implementing the interface.
   * @param schemaOrToken Generated Entity-state message-interface token.
   * @param via Route that calculates target Projection IDs.
   * @returns These mutable declarations.
   */
  route<TInterface extends object, Schemas extends InterfaceRouteSchemas>(
    schemaOrToken: MessageInterface<TInterface, Schemas>,
    via: (
      message: InterfaceRouteMessage<TInterface, Schemas>,
      context: EventContext,
      repository: RepositoryReadQueries<EntityType>,
    ) => readonly Id[] | Promise<readonly Id[]>,
  ): this;

  /**
   * Registers an exact generated Entity-state schema route or a nominal message-interface route.
   *
   * A schema route receives its exact state shape. An interface route receives
   * {@link InterfaceRouteMessage}, the member-state union intersected with the
   * declared interface. Routing selects an exact schema route first, then the
   * first matching interface token in registration order, then the
   * replacement/default route.
   *
   * Copied or malformed tokens fail during declaration. Every token member must
   * be registered by the repository, or construction fails. The selected route
   * runs once for an accepted admission; durable replay uses stored targets and
   * does not run routing again.
   *
   * @param schemaOrToken Generated Entity-state schema or nominal message-interface token.
   * @param via Route function to invoke.
   * @returns These mutable declarations.
   */
  route(
    schemaOrToken: MessageSchema | MessageInterface<object, InterfaceRouteSchemas>,
    via: StateUpdateRoute<Id>,
  ): this {
    if (typeof via !== "function")
      throw new TypeError("State-update routing requires a route function.");
    const state = StateUpdateRoutingInternals.state(this);
    if (RoutingDeclarations.isInterfaceTokenCandidate(schemaOrToken)) {
      RoutingDeclarations.routeInterface(state, schemaOrToken, via, "State-update routing");
    } else {
      RoutingDeclarations.exact(
        state,
        schemaOrToken,
        via,
        "State-update routing has a duplicate exact state-update route.",
      );
    }
    return this;
  }

  /**
   * Replaces the first-compatible-field default state route.
   *
   * @param via Replacement route function.
   * @returns These mutable declarations.
   */
  replaceDefault(via: StateUpdateRoute<Id, MessageSchema, EntityType>): this {
    if (typeof via !== "function")
      throw new TypeError("State-update routing requires a route function.");
    RoutingDeclarations.default(StateUpdateRoutingInternals.state(this), via);
    return this;
  }
}

/**
 * Internal access to state-routing declaration state.
 *
 * @internal Repository construction support.
 */
export const StateUpdateRoutingInternals: Readonly<{
  /**
   * Returns the Entity constructor selected for class-aware declarations, if any.
   *
   * @param routing Route declarations, when configured.
   * @returns Selected Entity constructor, if any.
   */
  entityType(routing: object | undefined): RepositoryEntityType | undefined;

  /**
   * Finds mutable state-update declaration state.
   *
   * @typeParam Id Target Projection ID type.
   * @typeParam EntityType Selected application Projection class.
   * @param routing Route declarations.
   * @returns Mutable declaration state.
   */
  state<Id, EntityType extends RepositoryEntityType>(
    routing: StateUpdateRouting<Id, EntityType>,
  ): State<Id>;

  /**
   * Copies declarations for repository construction.
   *
   * @typeParam Id Target Projection ID type.
   * @typeParam EntityType Selected application Projection class.
   * @param routing Route declarations, when configured.
   * @returns Immutable declaration snapshot.
   */
  snapshot<Id, EntityType extends RepositoryEntityType>(
    routing: StateUpdateRouting<Id, EntityType> | StateUpdateRouting<Id> | undefined,
  ): RoutingDeclarationSnapshot<StateUpdateRoute<Id>>;
}> = Object.freeze({
  /**
   * Returns the Entity constructor selected for class-aware declarations, if any.
   *
   * @param routing Route declarations, when configured.
   * @returns Selected Entity constructor, if any.
   */
  entityType(routing: object | undefined): RepositoryEntityType | undefined {
    return routing === undefined ? undefined : routingEntityTypes.get(routing);
  },

  /**
   * Finds mutable state-update declaration state.
   *
   * @typeParam Id Target Projection ID type.
   * @typeParam EntityType Selected application Projection class.
   * @param routing Route declarations.
   * @returns Mutable declaration state.
   */
  state<Id, EntityType extends RepositoryEntityType>(
    routing: StateUpdateRouting<Id, EntityType>,
  ): State<Id> {
    return states.get(routing) as State<Id>;
  },

  /**
   * Copies declarations for repository construction.
   *
   * @typeParam Id Target Projection ID type.
   * @typeParam EntityType Selected application Projection class.
   * @param routing Route declarations, when configured.
   * @returns Immutable declaration snapshot.
   */
  snapshot<Id, EntityType extends RepositoryEntityType>(
    routing: StateUpdateRouting<Id, EntityType> | StateUpdateRouting<Id> | undefined,
  ): RoutingDeclarationSnapshot<StateUpdateRoute<Id>> {
    if (routing === undefined) {
      return RoutingDeclarations.snapshot(RoutingDeclarations.create<StateUpdateRoute<Id>>());
    }
    return RoutingDeclarations.snapshot(states.get(routing) as State<Id>);
  },
});
