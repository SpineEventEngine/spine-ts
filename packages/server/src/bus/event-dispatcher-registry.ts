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
import { EventDispatcherOriginSchemas } from "./event-dispatcher-origin-schemas.js";

/**
 * Internal multicast registry keyed by canonical Spine event type URL.
 */
export class EventDispatcherRegistry {
  readonly #dispatchers = new Set<EventDispatcher>();
  readonly #byTypeUrl = new Map<string, EventDispatcher[]>();
  readonly #domesticByTypeUrl = new Map<string, EventDispatcher[]>();
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

    const snapshot = EventDispatcherRegistry.#snapshot(dispatcher);

    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    this.#dispatchers.add(dispatcher);

    for (const { schema, typeUrl } of snapshot.all) {
      const registered = this.#byTypeUrl.get(typeUrl);

      if (registered === undefined) {
        this.#byTypeUrl.set(typeUrl, [dispatcher]);
        this.#dispatcherSchemasByTypeUrl.set(typeUrl, schema);
        this.#schemasByTypeUrl.set(typeUrl, this.#schemasByTypeUrl.get(typeUrl) ?? schema);
        if (snapshot.external.has(typeUrl)) this.#externalByTypeUrl.set(typeUrl, [dispatcher]);
        if (snapshot.domestic.has(typeUrl)) this.#domesticByTypeUrl.set(typeUrl, [dispatcher]);
        continue;
      }

      registered.push(dispatcher);
      if (snapshot.external.has(typeUrl)) {
        const externalDispatchers = this.#externalByTypeUrl.get(typeUrl) ?? [];
        externalDispatchers.push(dispatcher);
        this.#externalByTypeUrl.set(typeUrl, externalDispatchers);
      }
      if (snapshot.domestic.has(typeUrl)) {
        const domesticDispatchers = this.#domesticByTypeUrl.get(typeUrl) ?? [];
        domesticDispatchers.push(dispatcher);
        this.#domesticByTypeUrl.set(typeUrl, domesticDispatchers);
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
   * @param external whether the event was imported from another context.
   * @returns a frozen dispatcher snapshot.
   */
  find(typeUrl: string, external = false): readonly EventDispatcher[] {
    return Object.freeze([
      ...((external ? this.#externalByTypeUrl : this.#domesticByTypeUrl).get(typeUrl) ?? []),
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
  static #snapshot(dispatcher: EventDispatcher): DispatcherOriginSnapshot {
    const all = EventDispatcherRegistry.#schemaRegistrations(dispatcher.messageSchemas());
    const externalRegistrations = EventDispatcherRegistry.#schemaRegistrations(
      dispatcher.externalEventSchemas?.() ?? [],
    );
    const schemas = new Set(all.map(({ typeUrl }) => typeUrl));
    for (const external of externalRegistrations) {
      if (!schemas.has(external.typeUrl)) {
        throw new Error(
          "EventDispatcher.externalEventSchemas() must be a subset of messageSchemas().",
        );
      }
    }
    const privateOrigins = EventDispatcherOriginSchemas.get(dispatcher);
    const effectiveExternal = EventDispatcherRegistry.#schemaRegistrations(
      privateOrigins?.external ?? externalRegistrations.map(({ schema }) => schema),
    );
    const domesticRegistrations = EventDispatcherRegistry.#schemaRegistrations(
      privateOrigins?.domestic ??
        all
          .filter(
            ({ typeUrl }) => !externalRegistrations.some((entry) => entry.typeUrl === typeUrl),
          )
          .map(({ schema }) => schema),
    );
    for (const domestic of domesticRegistrations) {
      if (!schemas.has(domestic.typeUrl))
        throw new Error("Event dispatcher origin schemas must be a subset of messageSchemas().");
    }
    return Object.freeze({
      all,
      domestic: new Set(domesticRegistrations.map(({ typeUrl }) => typeUrl)),
      external: new Set(effectiveExternal.map(({ typeUrl }) => typeUrl)),
    });
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

interface DispatcherOriginSnapshot {
  readonly all: readonly EventDispatcherRegistration[];
  readonly domestic: ReadonlySet<string>;
  readonly external: ReadonlySet<string>;
}
