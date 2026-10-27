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

import type { Message } from "@bufbuild/protobuf";

import type { AgentHistoryStorageInput } from "../entity/agent-history.js";
import type { EntityStorageInput } from "../memory/in-memory-entity-history.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { StorageGroup } from "../record/storage-group.js";
import type { StorageFactory } from "../storage/storage-factory.js";
import type { StorageContext } from "../storage/storage.js";

/**
 * Selects creation or read-only compatibility checking.
 */
export type StoragePreparationMode = "create" | "check";

/**
 * Declares an Entity without borrowed history handles.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state type.
 */
export type EntityStoragePreparationInput<I, S extends Message> = Omit<
  EntityStorageInput<I, S>,
  "stateHistoryStorage" | "eventHistoryStorage"
>;

/**
 * Provider-only operations that establish physical storage requirements.
 */
export interface StoragePreparation {
  /**
   * Prepares one ordinary record family.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param context Complete storage scope.
   * @param spec Declarative record layout.
   * @param group Optional physical group.
   * @param mode Creation or read-only compatibility check.
   * @returns Completion after the requirement is established.
   */
  prepareRecord<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group: StorageGroup | undefined,
    mode: StoragePreparationMode,
  ): Promise<void>;

  /**
   * Prepares current Entity records and enabled history families.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Complete declarative Entity layout.
   * @param mode Creation or read-only compatibility check.
   * @returns Completion after the requirements are established.
   */
  prepareEntity<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
    mode: StoragePreparationMode,
  ): Promise<void>;

  /**
   * Prepares the surviving Agent audit history family.
   *
   * @typeParam I Agent identifier type.
   * @param input Agent history scope and codec.
   * @param mode Creation or read-only compatibility check.
   * @returns Completion after the audit requirement is established.
   */
  prepareAgentHistory<I>(
    input: AgentHistoryStorageInput<I>,
    mode: StoragePreparationMode,
  ): Promise<void>;
}

const preparations = new WeakMap<StorageFactory, StoragePreparation>();

/**
 * Registers and finds provider preparation capabilities.
 */
interface StoragePreparationAccess {
  /**
   * Registers a provider preparation port.
   *
   * @param factory The provider factory.
   * @param preparation Its preparation implementation.
   */
  register(factory: StorageFactory, preparation: StoragePreparation): void;

  /**
   * Finds a registered preparation port.
   *
   * @param factory The provider factory.
   * @returns Its preparation port.
   */
  for(factory: StorageFactory): StoragePreparation;
}

/**
 * Framework lookup for a provider's registered preparation capability.
 */
export const StoragePreparations: StoragePreparationAccess = Object.freeze({
  /**
   * Registers a provider preparation port.
   *
   * @param factory The provider factory.
   * @param preparation Its preparation implementation.
   */
  register(factory: StorageFactory, preparation: StoragePreparation): void {
    preparations.set(factory, preparation);
  },

  /**
   * Finds a registered preparation port, rejecting unsupported providers.
   *
   * @param factory The provider factory.
   * @returns Its preparation port.
   */
  for(factory: StorageFactory): StoragePreparation {
    const preparation = preparations.get(factory);
    if (preparation === undefined)
      throw new Error("StorageFactory does not support storage preparation.");
    return preparation;
  },
});
