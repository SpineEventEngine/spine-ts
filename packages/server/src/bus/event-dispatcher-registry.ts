import { deriveTypeUrl } from "@spine-ts/core";

import type { EventDispatcher } from "./event-dispatcher.js";

/** Internal multicast registry keyed by canonical Spine event type URL. */
export class EventDispatcherRegistry {
  readonly #dispatchers = new Set<EventDispatcher>();
  readonly #byTypeUrl = new Map<string, EventDispatcher[]>();

  register(dispatcher: EventDispatcher): void {
    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    this.#dispatchers.add(dispatcher);

    for (const typeUrl of collectTypeUrls(dispatcher)) {
      const registered = this.#byTypeUrl.get(typeUrl);

      if (registered === undefined) {
        this.#byTypeUrl.set(typeUrl, [dispatcher]);
        continue;
      }

      registered.push(dispatcher);
    }
  }

  find(typeUrl: string): readonly EventDispatcher[] {
    return Object.freeze([...(this.#byTypeUrl.get(typeUrl) ?? [])]);
  }
}

function collectTypeUrls(dispatcher: EventDispatcher): readonly string[] {
  const typeUrls: string[] = [];
  const seen = new Set<string>();

  for (const schema of dispatcher.messageSchemas()) {
    const typeUrl = deriveTypeUrl(schema);

    if (!seen.has(typeUrl)) {
      seen.add(typeUrl);
      typeUrls.push(typeUrl);
    }
  }

  return Object.freeze(typeUrls);
}
