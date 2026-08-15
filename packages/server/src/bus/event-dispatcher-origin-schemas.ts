import type { MessageSchema } from "@spine-event-engine/core";

import type { EventDispatcher } from "./event-dispatcher.js";

interface OriginSchemas {
  readonly domestic: readonly MessageSchema[];
  readonly external: readonly MessageSchema[];
}

const values = new WeakMap<EventDispatcher, OriginSchemas>();

/** @internal Repository dispatchers use this private companion for mixed-origin schemas. */
export const EventDispatcherOriginSchemas: {
  readonly define: (
    dispatcher: EventDispatcher,
    domestic: readonly MessageSchema[],
    external: readonly MessageSchema[],
  ) => EventDispatcher;
  readonly get: (dispatcher: EventDispatcher) => OriginSchemas | undefined;
} = Object.freeze({
  define(
    dispatcher: EventDispatcher,
    domestic: readonly MessageSchema[],
    external: readonly MessageSchema[],
  ): EventDispatcher {
    values.set(
      dispatcher,
      Object.freeze({
        domestic: Object.freeze([...domestic]),
        external: Object.freeze([...external]),
      }),
    );
    return dispatcher;
  },
  get(dispatcher: EventDispatcher): OriginSchemas | undefined {
    return values.get(dispatcher);
  },
});
