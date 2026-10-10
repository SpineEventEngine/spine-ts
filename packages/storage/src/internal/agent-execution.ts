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

import type {
  AgentExecutionStorage,
  AgentExecutionStorageInput,
} from "../entity/agent-execution.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/**
 * Opens provider handles for durable Agent execution.
 */
export interface AgentExecutionStorageFactory {
  /**
   * Opens a closeable provider handle for one Agent repository.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   * @param input Entity layout and generated Agent state type.
   * @returns Provider execution handle.
   */
  createAgentExecutionStorage<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S>;
}

const factories = new WeakMap<StorageFactory, AgentExecutionStorageFactory>();

/**
 * Registers and opens the provider-only durable Agent execution capability.
 */
export interface AgentExecutionFactoryAccess {
  /**
   * Returns whether a storage factory registered durable Agent execution.
   *
   * @param factory Storage factory checked at Bounded Context registration.
   * @returns Whether the provider offers Agent execution handles.
   */
  supports(factory: StorageFactory): boolean;

  /**
   * Registers a provider capability.
   * @param factory Storage factory offering execution.
   * @param creator Provider-specific handle creator.
   */
  register(factory: StorageFactory, creator: AgentExecutionStorageFactory): void;

  /**
   * Opens the required provider capability.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   * @param factory Storage factory offering execution.
   * @param input Agent repository scope and Entity layout.
   * @returns Closeable provider execution handle.
   */
  create<I, S extends Message>(
    factory: StorageFactory,
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S>;
}

/**
 * Registers and creates provider execution handles without exposing them to applications.
 */
export const AgentExecutionStorageFactories: AgentExecutionFactoryAccess = Object.freeze({
  /**
   * Checks provider registration without selecting or fabricating a tenant.
   *
   * @param factory Storage factory checked at Bounded Context registration.
   * @returns Whether the provider offers Agent execution handles.
   */
  supports(factory: StorageFactory): boolean {
    return factories.has(factory);
  },

  /**
   * Registers one provider's execution capability.
   * @param factory Storage factory offering execution.
   * @param creator Provider-specific handle creator.
   */
  register(factory: StorageFactory, creator: AgentExecutionStorageFactory): void {
    factories.set(factory, creator);
  },

  /**
   * Rejects providers without durable Agent execution support before intake.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   * @param factory Storage factory offering execution.
   * @param input Agent repository scope and Entity layout.
   * @returns Closeable provider execution handle.
   */
  create<I, S extends Message>(
    factory: StorageFactory,
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S> {
    const creator = factories.get(factory);
    if (creator === undefined)
      throw new Error("StorageFactory does not provide durable Agent execution storage.");
    return creator.createAgentExecutionStorage(input);
  },
});
