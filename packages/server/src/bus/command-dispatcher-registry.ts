import { type MessageSchema, TypeUrls } from "@spine-event-engine/core";

import type { CommandDispatcher } from "./command-dispatcher.js";

interface RegisteredCommandDispatcher {
  readonly dispatcher: CommandDispatcher;
  readonly schema: MessageSchema;
}

/** Internal unicast registry keyed by canonical Spine command type URL. */
export class CommandDispatcherRegistry {
  readonly #dispatchers = new Set<CommandDispatcher>();
  readonly #byTypeUrl = new Map<string, RegisteredCommandDispatcher>();

  register(dispatcher: CommandDispatcher): void {
    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    const registrations = collectRegistrations(dispatcher);

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

  find(typeUrl: string): RegisteredCommandDispatcher | undefined {
    return this.#byTypeUrl.get(typeUrl);
  }

  acceptedTypeUrls(): readonly string[] {
    return Object.freeze([...this.#byTypeUrl.keys()]);
  }
}

function collectRegistrations(
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
