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
import { type MessageSchema, TypeUrls } from "@spine-event-engine/core";

import type { CommandDispatcher } from "./command-dispatcher.js";

interface RegisteredCommandDispatcher {
  readonly dispatcher: CommandDispatcher;
  readonly schema: MessageSchema;
}

/**
 * Internal unicast registry keyed by canonical Spine command type URL.
 */
export class CommandDispatcherRegistry {
  readonly #dispatchers = new Set<CommandDispatcher>();
  readonly #byTypeUrl = new Map<string, RegisteredCommandDispatcher>();

  /**
   * Registers a dispatcher and all of its distinct command schemas.
   *
   * @param dispatcher the dispatcher to register.
   */
  register(dispatcher: CommandDispatcher): void {
    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    const registrations = CommandDispatcherRegistry.#registrations(dispatcher);

    for (const registration of registrations) {
      const registered = this.#byTypeUrl.get(registration.typeUrl);

      if (registered !== undefined && registered.dispatcher !== dispatcher) {
        throw new Error(`Duplicate command dispatcher for "${registration.typeUrl}".`);
      }
    }

    this.#dispatchers.add(dispatcher);

    for (const registration of registrations) {
      this.#byTypeUrl.set(registration.typeUrl, {
        dispatcher,
        schema: registration.schema,
      });
    }
  }

  /**
   * Finds the dispatcher registered for a canonical command type URL.
   *
   * @param typeUrl the canonical command type URL.
   * @returns the registration, when one exists.
   */
  find(typeUrl: string): RegisteredCommandDispatcher | undefined {
    return this.#byTypeUrl.get(typeUrl);
  }

  /**
   * Lists the canonical command type URLs accepted by this registry.
   *
   * @returns the registered type URLs.
   */
  acceptedTypeUrls(): readonly string[] {
    return Object.freeze([...this.#byTypeUrl.keys()]);
  }
  static #registrations(
    dispatcher: CommandDispatcher,
  ): readonly { readonly typeUrl: string; readonly schema: MessageSchema }[] {
    const registrations: { typeUrl: string; schema: MessageSchema }[] = [];
    const seen = new Set<string>();

    for (const schema of dispatcher.messageSchemas()) {
      const typeUrl = TypeUrls.derive(schema);

      if (!seen.has(typeUrl)) {
        seen.add(typeUrl);
        registrations.push({ typeUrl, schema });
      }
    }

    return Object.freeze(registrations);
  }
}
