import { type MessageSchema, TypeUrls } from "@spine-event-engine/core";

import type { EventDispatcher } from "./event-dispatcher.js";

/**
 * Internal multicast registry keyed by canonical Spine event type URL.
 */
export class EventDispatcherRegistry {
  readonly #dispatchers = new Set<EventDispatcher>();
  readonly #byTypeUrl = new Map<string, EventDispatcher[]>();
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

    for (const { schema, typeUrl } of registrations) {
      const registered = this.#byTypeUrl.get(typeUrl);

      if (registered === undefined) {
        this.#byTypeUrl.set(typeUrl, [dispatcher]);
        this.#dispatcherSchemasByTypeUrl.set(typeUrl, schema);
        this.#schemasByTypeUrl.set(typeUrl, this.#schemasByTypeUrl.get(typeUrl) ?? schema);
        continue;
      }

      registered.push(dispatcher);
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
  find(typeUrl: string): readonly EventDispatcher[] {
    return Object.freeze([...(this.#byTypeUrl.get(typeUrl) ?? [])]);
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
    return EventDispatcherRegistry.#schemaRegistrations(dispatcher.messageSchemas());
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
