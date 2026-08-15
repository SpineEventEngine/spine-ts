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

import type { EventDispatcher } from "./event-dispatcher.js";

/**
 * Internal multicast registry keyed by canonical Spine event type URL.
 */
export class EventDispatcherRegistry {
  readonly #dispatchers = new Set<EventDispatcher>();
  readonly #byTypeUrl = new Map<string, EventDispatcher[]>();
  readonly #externalByTypeUrl = new Map<string, EventDispatcher[]>();
  readonly #dispatcherSchemasByTypeUrl = new Map<string, MessageSchema>();
  readonly #schemasByTypeUrl = new Map<string, MessageSchema>();

  /**
   * Registers a dispatcher and all of its distinct event schemas.
   *
   * @param dispatcher the dispatcher to register.
   */
  register(dispatcher: EventDispatcher): void {
    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    const registrations = EventDispatcherRegistry.#registrations(dispatcher);

    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    this.#dispatchers.add(dispatcher);

    const external = new Set(
      EventDispatcherRegistry.#schemaRegistrations(dispatcher.externalEventSchemas?.() ?? []).map(
        ({ typeUrl }) => typeUrl,
      ),
    );
    for (const { schema, typeUrl } of registrations) {
      const registered = this.#byTypeUrl.get(typeUrl);

      if (registered === undefined) {
        this.#byTypeUrl.set(typeUrl, [dispatcher]);
        this.#dispatcherSchemasByTypeUrl.set(typeUrl, schema);
        this.#schemasByTypeUrl.set(typeUrl, this.#schemasByTypeUrl.get(typeUrl) ?? schema);
        if (external.has(typeUrl)) this.#externalByTypeUrl.set(typeUrl, [dispatcher]);
        continue;
      }

      registered.push(dispatcher);
      if (external.has(typeUrl)) {
        const externalDispatchers = this.#externalByTypeUrl.get(typeUrl) ?? [];
        externalDispatchers.push(dispatcher);
        this.#externalByTypeUrl.set(typeUrl, externalDispatchers);
      }
    }
  }

  /**
   * Registers event schemas without adding dispatch routes.
   *
   * @param schemas the generated schemas to register.
   */
  registerSchemas(schemas: Iterable<MessageSchema>): void {
    const registrations = EventDispatcherRegistry.#schemaRegistrations(schemas);

    for (const { schema, typeUrl } of registrations) {
      this.#schemasByTypeUrl.set(typeUrl, this.#schemasByTypeUrl.get(typeUrl) ?? schema);
    }
  }

  /**
   * Finds dispatchers registered for a canonical event type URL.
   *
   * @param typeUrl the canonical event type URL.
   * @returns a frozen dispatcher snapshot.
   */
  find(typeUrl: string, external = false): readonly EventDispatcher[] {
    return Object.freeze([
      ...((external ? this.#externalByTypeUrl : this.#byTypeUrl).get(typeUrl) ?? []),
    ]);
  }

  /**
   * Finds the generated schema registered for an event type URL.
   *
   * @param typeUrl the canonical event type URL.
   * @returns the registered event schema, if one exists.
   */
  schema(typeUrl: string): MessageSchema | undefined {
    return this.#schemasByTypeUrl.get(typeUrl);
  }

  /**
   * Lists event schemas represented by registered dispatchers.
   *
   * @returns the registered schemas.
   */
  schemas(): readonly MessageSchema[] {
    return Object.freeze([...this.#dispatcherSchemasByTypeUrl.values()]);
  }
  static #registrations(dispatcher: EventDispatcher): readonly EventDispatcherRegistration[] {
    const registrations = EventDispatcherRegistry.#schemaRegistrations(dispatcher.messageSchemas());
    const schemas = new Set(registrations.map(({ typeUrl }) => typeUrl));
    for (const external of EventDispatcherRegistry.#schemaRegistrations(
      dispatcher.externalEventSchemas?.() ?? [],
    )) {
      if (!schemas.has(external.typeUrl)) {
        throw new Error(
          "EventDispatcher.externalEventSchemas() must be a subset of messageSchemas().",
        );
      }
    }
    return registrations;
  }

  static #schemaRegistrations(
    schemas: Iterable<MessageSchema>,
  ): readonly EventDispatcherRegistration[] {
    const registrations: EventDispatcherRegistration[] = [];
    const seen = new Set<string>();

    for (const schema of schemas) {
      const typeUrl = TypeUrls.derive(schema);

      if (!seen.has(typeUrl)) {
        seen.add(typeUrl);
        registrations.push({ schema, typeUrl });
      }
    }

    return Object.freeze(registrations);
  }
}

interface EventDispatcherRegistration {
  readonly schema: MessageSchema;
  readonly typeUrl: string;
}
