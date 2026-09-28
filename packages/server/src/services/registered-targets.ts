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

import { TypeUrls } from "@spine-event-engine/core";
import type {
  EntityQueryPlan,
  EntityQueryPlanPredicate,
} from "@spine-event-engine/core/spi/entity-query-plan";

import type { BoundedContext } from "../context/bounded-context.js";
import type { RepositoryView } from "../repository/repository.js";
import type { Stand } from "../stand/stand.js";

/**
 * A state registration and its bounded context for server-local reads.
 */
export interface RegisteredTarget {
  // prettier-ignore

  /**
   * Context containing the registered Entity state.
   */
  readonly context: BoundedContext;

  /**
   * Repository whose schema and columns authorize reads.
   */
  readonly repository: RepositoryView;

  /**
   * Wire type URL shared by equivalent descriptors of this state.
   */
  readonly typeUrl: string;
}

const standTargets = new WeakMap<Stand, RegisteredTargets>();

/**
 * Finds one registered Entity state type within a server assembly.
 *
 * A standalone context has no server lookup and continues using its local Stand.
 */
export class RegisteredTargets {
  readonly #targets = new Map<string, RegisteredTarget>();

  #installedStands: readonly Stand[] = [];

  /**
   * Validates and indexes the state types registered by the supplied contexts.
   *
   * @param contexts Contexts assembled for one Server.
   */
  constructor(contexts: readonly BoundedContext[]) {
    for (const context of contexts) {
      for (const repository of context.registeredRepositories()) {
        const typeUrl = TypeUrls.derive(repository.stateSchema);
        const prior = this.#targets.get(typeUrl);
        if (prior !== undefined) {
          throw new Error(
            `Entity type "${typeUrl}" is registered in both "${prior.context.name.value}" and "${context.name.value}".`,
          );
        }
        this.#targets.set(typeUrl, { context, repository, typeUrl });
      }
    }
  }

  /**
   * Returns a registered target by state type URL.
   *
   * @param typeUrl State type URL to find.
   * @returns The registration, if present.
   */
  find(typeUrl: string): RegisteredTarget | undefined {
    return this.#targets.get(typeUrl);
  }

  /**
   * Validates requested columns and fields against the registered target.
   *
   * @param target Registration selected by the query type URL.
   * @param plan Query compiled from the caller's typed builder.
   */
  validate(target: RegisteredTarget, plan: EntityQueryPlan): void {
    const columns = new Set([
      ...target.repository.metadata.columns.map((column) => column.name),
      "version",
      "archived",
      "deleted",
    ]);
    const predicates: EntityQueryPlanPredicate[] =
      plan.predicate === undefined ? [] : [plan.predicate];
    while (predicates.length > 0) {
      const predicate = predicates.pop();
      if (predicate?.kind === "comparison" && !columns.has(predicate.column)) {
        throw new Error(
          `Query column "${predicate.column}" is not registered for "${target.typeUrl}".`,
        );
      }
      if (predicate?.kind === "all" || predicate?.kind === "either") {
        predicates.push(...predicate.predicates);
      }
    }
    for (const order of plan.order ?? []) {
      if (!columns.has(order.column)) {
        throw new Error(
          `Query column "${order.column}" is not registered for "${target.typeUrl}".`,
        );
      }
    }
    for (const path of plan.mask?.paths ?? []) {
      if (!target.repository.stateSchema.fields.some((field) => field.name === path)) {
        throw new Error(`Query mask field "${path}" is not registered for "${target.typeUrl}".`);
      }
    }
  }

  /**
   * Lists the validated registrations for service route creation.
   *
   * @returns Registered state targets.
   */
  all(): readonly RegisteredTarget[] {
    return [...this.#targets.values()];
  }

  /**
   * Registers validated routes for every context Stand before recovery invokes handlers.
   *
   * @param contexts Contexts whose handlers use these routes.
   */
  install(contexts: readonly BoundedContext[]): void {
    const stands = contexts.map((context) => context.stand());
    const distinct = new Set(stands);
    if (distinct.size !== stands.length) {
      throw new Error("A Stand cannot be registered twice in one Server.");
    }
    for (const stand of stands) {
      if (standTargets.has(stand)) {
        throw new Error("Stand is already associated with another Server.");
      }
    }
    for (const stand of stands) standTargets.set(stand, this);
    this.#installedStands = stands;
  }

  /**
   * Removes only this Server's Stand routes after its contexts close.
   */
  release(): void {
    for (const stand of this.#installedStands) {
      if (standTargets.get(stand) === this) standTargets.delete(stand);
    }
    this.#installedStands = [];
  }

  /**
   * Finds the server routes installed for a repository's local Stand.
   *
   * @param stand Stand bound to the repository handler.
   * @returns Routes for its Server, if attached.
   */
  static forStand(stand: Stand): RegisteredTargets | undefined {
    return standTargets.get(stand);
  }
}
