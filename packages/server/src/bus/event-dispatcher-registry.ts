import { type MessageSchema, TypeUrls } from "@spine-event-engine/core";

import type { EventDispatcher } from "./event-dispatcher.js";

/** Internal multicast registry keyed by canonical Spine event type URL. */
export class EventDispatcherRegistry {
  readonly #dispatchers = new Set<EventDispatcher>();
  readonly #byTypeUrl = new Map<string, EventDispatcher[]>();
  readonly #schemasByTypeUrl = new Map<string, MessageSchema>();

  register(dispatcher: EventDispatcher): void {
    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    const registrations = collectRegistrations(dispatcher);

    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    this.#dispatchers.add(dispatcher);

    for (const { schema, typeUrl } of registrations) {
      const registered = this.#byTypeUrl.get(typeUrl);

      if (registered === undefined) {
        this.#byTypeUrl.set(typeUrl, [dispatcher]);
        this.#schemasByTypeUrl.set(typeUrl, schema);
        continue;
      }

      registered.push(dispatcher);
    }
  }

  find(typeUrl: string): readonly EventDispatcher[] {
    return Object.freeze([...(this.#byTypeUrl.get(typeUrl) ?? [])]);
  }

  schemas(): readonly MessageSchema[] {
    return Object.freeze([...this.#schemasByTypeUrl.values()]);
  }
}

function collectRegistrations(dispatcher: EventDispatcher): readonly EventDispatcherRegistration[] {
  const registrations: EventDispatcherRegistration[] = [];
  const seen = new Set<string>();

  for (const schema of dispatcher.messageSchemas()) {
    const typeUrl = TypeUrls.derive(schema);

    if (!seen.has(typeUrl)) {
      seen.add(typeUrl);
      registrations.push({ schema, typeUrl });
    }
  }

  return Object.freeze(registrations);
}

interface EventDispatcherRegistration {
  readonly schema: MessageSchema;
  readonly typeUrl: string;
}
