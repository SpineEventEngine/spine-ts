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
  HandlerMetadataRegistry,
  type CommandAssignmentHandlerMetadata,
  type EntityClass,
  type EntityHandlersMetadata,
  type HandlerMetadataRegistryLookup,
  type RegisteredHandlerMetadata,
} from "./handler-metadata.js";
import type { EntityMetadata } from "../entity/entity-metadata.js";
import { ReadinessMetadata } from "./registration-readiness-metadata.js";

const commandRegistrationReadinessToken = Symbol("commandRegistrationReadinessToken");
const authenticCommandRegistrationReadiness = new WeakSet<object>();

/**
 * Command assignment entry exposed by command registration readiness lookups.
 */
export interface CommandRegistrationAssigneeMetadata {
  // prettier-ignore

  /**
   * Fully qualified command message type name assigned to one entity handler.
   */
  readonly commandFullTypeName: string;

  /**
   * Entity handler metadata object that declared the command assignment.
   */
  readonly entityHandlers: EntityHandlersMetadata;

  /**
   * Entity class that owns the assigned command handler method.
   */
  readonly entityType: EntityClass;

  /**
   * Descriptor-derived entity metadata for the assignee state type.
   */
  readonly entity: EntityMetadata;

  /**
   * Command assignment handler metadata declared by the entity.
   */
  readonly handler: CommandAssignmentHandlerMetadata;

  /**
   * Original registered handler entry from the handler metadata registry.
   */
  readonly registeredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>;
}

/**
 * Read-only command registration readiness lookup surface.
 */
export interface CommandRegistrationReadinessLookup {
  // prettier-ignore

  /**
   * Returns registered command message type names in deterministic order.
   *
   * @returns A fresh frozen list of command message type names.
   */
  commandTypeNames(): readonly string[];

  /**
   * Finds unique assignee metadata for a command message type.
   *
   * @param commandTypeName Fully qualified command message type name.
   * @returns The assignee metadata, or `undefined` when no assignee is registered.
   */
  findCommandAssignee(commandTypeName: string): CommandRegistrationAssigneeMetadata | undefined;
}

/**
 * Metadata-only command registration readiness derived from handler metadata.
 *
 * The surface mirrors the JVM command-dispatcher registration shape only far
 * enough for later runtime slices to ask which command message types have one
 * registered assignee. It does not post, route, dispatch, invoke, store, or
 * acknowledge commands.
 */
export class CommandRegistrationReadiness implements CommandRegistrationReadinessLookup {
  readonly #commandFullTypeNames: readonly string[];
  readonly #assigneesByTypeName: ReadonlyMap<string, CommandRegistrationAssigneeMetadata>;

  private constructor(
    authenticityToken: typeof commandRegistrationReadinessToken,
    commandFullTypeNames: readonly string[],
    assigneesByTypeName: ReadonlyMap<string, CommandRegistrationAssigneeMetadata>,
  ) {
    if (authenticityToken !== commandRegistrationReadinessToken) {
      throw new TypeError(
        "CommandRegistrationReadiness instances must be created by the package factory methods.",
      );
    }

    this.#commandFullTypeNames = Object.freeze([...commandFullTypeNames]);
    this.#assigneesByTypeName = new Map(assigneesByTypeName);
    authenticCommandRegistrationReadiness.add(this);
    Object.freeze(this);
  }

  /**
   * Builds readiness from a handler metadata registry lookup.
   *
   * @param registry Source of entity handler metadata.
   * @returns Frozen command registration readiness.
   */
  static fromRegistry(registry: HandlerMetadataRegistryLookup): CommandRegistrationReadiness {
    const validatedRegistry = new HandlerMetadataRegistry(registry.listEntityHandlers());
    const commandFullTypeNames = [
      ...new Set(
        validatedRegistry
          .findHandlersByKind("command-assignment")
          .map((entry) => entry.handler.messageFullTypeName),
      ),
    ].sort((left, right) => ReadinessMetadata.compareTypeNames(left, right));
    const assigneesByTypeName = new Map<string, CommandRegistrationAssigneeMetadata>();

    for (const commandFullTypeName of commandFullTypeNames) {
      const assignment = validatedRegistry.findCommandAssignment(commandFullTypeName);

      if (assignment !== undefined) {
        assigneesByTypeName.set(
          commandFullTypeName,
          CommandRegistrationReadiness.#createAssignee(commandFullTypeName, assignment),
        );
      }
    }

    return new CommandRegistrationReadiness(
      commandRegistrationReadinessToken,
      [...assigneesByTypeName.keys()].sort((left, right) =>
        ReadinessMetadata.compareTypeNames(left, right),
      ),
      assigneesByTypeName,
    );
  }

  /**
   * Builds readiness from entity handler metadata.
   *
   * Duplicate command assignment validation is intentionally delegated to
   * `HandlerMetadataRegistry`.
   *
   * @param entityHandlers Entity handler metadata to validate and index.
   * @returns Frozen command registration readiness.
   */
  static fromEntityHandlers(
    entityHandlers: Iterable<EntityHandlersMetadata>,
  ): CommandRegistrationReadiness {
    return CommandRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry(entityHandlers));
  }

  /**
   * Returns registered command message type names in deterministic order.
   *
   * @returns A fresh frozen list of command message type names.
   */
  commandTypeNames(): readonly string[] {
    return Object.freeze([...this.#commandFullTypeNames]);
  }

  /**
   * Finds unique assignee metadata for a command message type.
   *
   * @param commandTypeName Fully qualified command message type name.
   * @returns The assignee metadata, or `undefined` when no assignee is registered.
   */
  findCommandAssignee(commandTypeName: string): CommandRegistrationAssigneeMetadata | undefined {
    const assignee = this.#assigneesByTypeName.get(commandTypeName);

    return assignee === undefined
      ? undefined
      : CommandRegistrationReadiness.#copyAssignee(assignee);
  }

  /**
   * Checks whether a value was created by this module's readiness factories.
   *
   * @param value Value to test for readiness authenticity.
   * @returns `true` when the value is an authentic command registration readiness instance.
   */
  static isAuthentic(value: unknown): value is CommandRegistrationReadiness {
    return (
      value !== null &&
      typeof value === "object" &&
      authenticCommandRegistrationReadiness.has(value)
    );
  }

  static #createAssignee(
    commandFullTypeName: string,
    registeredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>,
  ): CommandRegistrationAssigneeMetadata {
    const fields = ReadinessMetadata.create(registeredHandler);

    return Object.freeze({
      commandFullTypeName,
      ...fields,
    });
  }

  static #copyAssignee(
    assignee: CommandRegistrationAssigneeMetadata,
  ): CommandRegistrationAssigneeMetadata {
    const fields = ReadinessMetadata.copy(assignee.registeredHandler);

    return Object.freeze({
      commandFullTypeName: assignee.commandFullTypeName,
      ...fields,
    });
  }
}
