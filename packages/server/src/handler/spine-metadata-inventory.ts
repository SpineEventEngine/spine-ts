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

import type { ProtoModule } from "@spine-event-engine/proto";

import {
  HandlerRegistryIngestor,
  type GeneratedHandlerRegistry,
  type GeneratedReceiver,
} from "./generated-handler-registry.js";

/**
 * Passive model and handler descriptions emitted by one package.
 */
export interface SpineMetadata extends GeneratedHandlerRegistry {
  // prettier-ignore

  /**
   * Local model module registered through the ordinary Proto inventory.
   */
  readonly protoModule?: ProtoModule;
}

interface RegisteredReceiver {
  readonly receiver: GeneratedReceiver;
  readonly moduleId: string;
}

/**
 * Runtime constructor identity used to index passive descriptions.
 */
interface ReceiverConstructor {
  readonly name: string;
  readonly prototype: unknown;
}

const receivers = new Map<ReceiverConstructor, RegisteredReceiver>();

/**
 * Registers validated passive descriptions without selecting application handlers.
 *
 * @param metadata Generated package descriptions.
 * @param moduleId Generated metadata module identifier for diagnostics.
 */
export const SpineMetadataInventory: Readonly<{
  register(metadata: SpineMetadata, moduleId: string): void;
  select(constructors: readonly ReceiverConstructor[]): GeneratedHandlerRegistry;
}> = Object.freeze({
  /**
   * Registers validated passive descriptions without selecting application handlers.
   *
   * @param metadata Generated package descriptions.
   * @param moduleId Generated metadata module identifier for diagnostics.
   */
  register(metadata: SpineMetadata, moduleId: string): void {
    if (moduleId.trim().length === 0) throw new TypeError("Spine metadata module ID is required.");
    new HandlerRegistryIngestor().ingest(metadata);
    const staged = new Map<ReceiverConstructor, RegisteredReceiver>();
    for (const receiver of metadata.receivers) {
      const constructor = receiver.receiverType as ReceiverConstructor;
      const prior = staged.get(constructor) ?? receivers.get(constructor);
      if (prior !== undefined && prior.receiver !== receiver)
        throw new Error(
          `Spine metadata for ${constructor.name} conflicts between ${prior.moduleId} and ${moduleId}.`,
        );
      staged.set(constructor, { receiver, moduleId });
    }
    for (const [constructor, entry] of staged) receivers.set(constructor, entry);
  },

  /**
   * Selects passive descriptions by exact constructor identity.
   *
   * @param constructors Entity and standalone constructors selected by an application.
   * @returns Only descriptions for selected classes.
   */
  select(constructors: readonly ReceiverConstructor[]): GeneratedHandlerRegistry {
    const selected = constructors.map((constructor) => {
      const entry = receivers.get(constructor);
      if (entry === undefined)
        throw new Error(
          `Generated metadata for ${constructor.name} is missing. Generate and import the ` +
            `package's spine-bootstrap.js before BoundedContext assembly.`,
        );
      return entry.receiver;
    });
    return Object.freeze({ receivers: Object.freeze(selected) });
  },
});

/**
 * Preserves compatibility with bootstraps emitted before grouped inventory registration.
 */
export const registerSpineMetadata: typeof SpineMetadataInventory.register =
  SpineMetadataInventory.register;

/**
 * Preserves compatibility with direct inventory selection callers.
 */
export const spineMetadataFor: typeof SpineMetadataInventory.select = SpineMetadataInventory.select;

/**
 * Test-facing reset for independent metadata assembly cases.
 */
export const spineMetadataTestAccess: Readonly<{ clear(): void }> = Object.freeze({
  /**
   * Clears process-local descriptions between isolated tests.
   */
  clear(): void {
    receivers.clear();
  },
});
