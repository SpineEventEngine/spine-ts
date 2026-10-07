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

import type { AgentHistoryStorage, AgentHistoryStorageInput } from "../entity/agent-history.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/**
 * Creates provider handles for one Agent history scope.
 */
export interface AgentHistoryStorageFactory {
  /**
   * Opens the provider's indexed Agent history handle.
   *
   * @typeParam Id Typed Agent identifier.
   * @param input Context, tenant, state type, and ID codec.
   * @returns Independently closeable history handle.
   */
  createAgentHistoryStorage<Id>(input: AgentHistoryStorageInput<Id>): AgentHistoryStorage<Id>;
}

const factories = new WeakMap<StorageFactory, AgentHistoryStorageFactory>();

/**
 * Registers provider capability and opens its scoped handles.
 */
export interface AgentHistoryFactoryAccess {
  /**
   * Returns whether the provider registered mandatory Agent history.
   * @param factory Storage factory checked before a tenant is selected.
   * @returns Whether indexed Agent history handles are available.
   */
  supports(factory: StorageFactory): boolean;

  /**
   * Registers an Agent history provider capability.
   *
   * @param factory Provider storage factory.
   * @param creator Provider-specific handle creator.
   */
  register(factory: StorageFactory, creator: AgentHistoryStorageFactory): void;

  /**
   * Opens the required Agent history provider capability.
   *
   * @typeParam Id Typed Agent identifier.
   * @param factory Provider storage factory.
   * @param input Context, state type, and typed ID scope.
   * @returns Independently closeable history handle.
   */
  create<Id>(factory: StorageFactory, input: AgentHistoryStorageInput<Id>): AgentHistoryStorage<Id>;
}

/**
 * Registers and opens the provider-only Agent history capability.
 */
export const AgentHistoryStorageFactories: AgentHistoryFactoryAccess = Object.freeze({
  /**
   * Checks registration without creating a handle for an invented tenant.
   * @param factory Storage factory checked at context registration.
   * @returns Whether Agent history handles are available.
   */
  supports(factory: StorageFactory): boolean {
    return factories.has(factory);
  },

  /**
   * Registers a provider's Agent history handle factory.
   *
   * @param factory Storage factory offering the capability.
   * @param creator Provider-specific handle creator.
   */
  register(factory: StorageFactory, creator: AgentHistoryStorageFactory): void {
    factories.set(factory, creator);
  },

  /**
   * Opens an Agent history handle or fails when the provider lacks one.
   *
   * @typeParam Id Typed Agent identifier.
   * @param factory Provider storage factory.
   * @param input Context, tenant, state type, and ID codec.
   * @returns Independently closeable history handle.
   */
  create<Id>(
    factory: StorageFactory,
    input: AgentHistoryStorageInput<Id>,
  ): AgentHistoryStorage<Id> {
    const creator = factories.get(factory);
    if (creator === undefined)
      throw new Error("StorageFactory does not provide required Agent history storage.");
    return creator.createAgentHistoryStorage(input);
  },
});
