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
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { ProtoModule } from "@spine-event-engine/proto";
import { AppQueryHandler } from "./app-query-handler.js";

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

  /**
   * Passive application query implementations declared in this package.
   */
  readonly appQueries?: readonly AppQueryDescription[];
}

/**
 * Exact implementation constructor and generated request/result schemas.
 */
export interface AppQueryDescription {
  /**
   * Concrete handler class; registration does not construct it.
   */
  readonly handlerType: { readonly name: string; readonly prototype: object };

  /**
   * Generated request message name.
   */
  readonly queryTypeName: string;

  /**
   * Generated request schema.
   */
  readonly querySchema: GenMessage<Message>;

  /**
   * Generated result schema.
   */
  readonly responseSchema: GenMessage<Message>;
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
const queries = new Map<
  AppQueryDescription["handlerType"],
  { readonly description: AppQueryDescription; readonly moduleId: string }
>();

/**
 * Registers validated passive descriptions without selecting application handlers.
 *
 * @param metadata Generated package descriptions.
 * @param moduleId Generated metadata module identifier for diagnostics.
 */
export const SpineMetadataInventory: Readonly<{
  register(metadata: SpineMetadata, moduleId: string): void;
  validateQuery(query: AppQueryDescription): void;
  select(constructors: readonly ReceiverConstructor[]): GeneratedHandlerRegistry;
  selectQueries(
    constructors: readonly AppQueryDescription["handlerType"][],
  ): readonly AppQueryDescription[];
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
    const stagedQueries = new Map<AppQueryDescription["handlerType"], AppQueryDescription>();
    for (const query of metadata.appQueries ?? []) {
      SpineMetadataInventory.validateQuery(query);
      const prior =
        stagedQueries.get(query.handlerType) ?? queries.get(query.handlerType)?.description;
      if (prior !== undefined && prior !== query)
        throw new Error(`Spine App Query metadata for ${query.handlerType.name} conflicts.`);
      stagedQueries.set(query.handlerType, query);
    }
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
    for (const [constructor, description] of stagedQueries)
      queries.set(constructor, { description, moduleId });
  },

  /**
   * Checks a passive query description before it enters process metadata.
   *
   * @param query Generated constructor and paired schema description.
   */
  validateQuery(query: AppQueryDescription): void {
    const value = query as unknown as {
      handlerType?: { prototype?: object };
      queryTypeName?: string;
      querySchema?: { kind?: string; typeName?: string };
      responseSchema?: { kind?: string; typeName?: string };
    } | null;
    if (
      value?.handlerType?.prototype === undefined ||
      !(value.handlerType.prototype instanceof AppQueryHandler)
    )
      throw new TypeError("App Query metadata requires a concrete AppQueryHandler class.");
    if (
      value.querySchema?.kind !== "message" ||
      value.querySchema.typeName !== value.queryTypeName ||
      !value.queryTypeName?.endsWith(".Query")
    )
      throw new TypeError("App Query metadata requires its generated Query schema.");
    const expected = `${value.queryTypeName.slice(0, -".Query".length)}.Response`;
    if (value.responseSchema?.kind !== "message" || value.responseSchema.typeName !== expected)
      throw new TypeError("App Query metadata requires its paired Response schema.");
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

  /**
   * Selects passive query descriptions by exact implementation constructor.
   *
   * @param constructors Application-supplied handler classes.
   * @returns Only matching descriptions in caller order.
   */
  selectQueries(
    constructors: readonly AppQueryDescription["handlerType"][],
  ): readonly AppQueryDescription[] {
    return Object.freeze(
      constructors.map((constructor) => {
        const query = queries.get(constructor);
        if (query === undefined)
          throw new Error(`Generated App Query metadata for ${constructor.name} is missing.`);
        return query.description;
      }),
    );
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
    queries.clear();
  },
});
