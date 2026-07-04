import { deriveTypeUrl } from "@spine-ts/core";

import type { CommandDispatcher } from "./command-dispatcher.js";

/** Internal unicast registry keyed by canonical Spine command type URL. */
export class CommandDispatcherRegistry {
  readonly #dispatchers = new Set<CommandDispatcher>();
  readonly #byTypeUrl = new Map<string, CommandDispatcher>();

  register(dispatcher: CommandDispatcher): void {
    if (this.#dispatchers.has(dispatcher)) {
      return;
    }

    const typeUrls = collectTypeUrls(dispatcher);

    for (const typeUrl of typeUrls) {
      const registered = this.#byTypeUrl.get(typeUrl);

      if (registered !== undefined && registered !== dispatcher) {
        throw new Error(`Duplicate command dispatcher for "${typeUrl}".`);
      }
    }

    this.#dispatchers.add(dispatcher);

    for (const typeUrl of typeUrls) {
      this.#byTypeUrl.set(typeUrl, dispatcher);
    }
  }

  find(typeUrl: string): CommandDispatcher | undefined {
    return this.#byTypeUrl.get(typeUrl);
  }

  acceptedTypeUrls(): readonly string[] {
    return Object.freeze([...this.#byTypeUrl.keys()]);
  }
}

function collectTypeUrls(dispatcher: CommandDispatcher): readonly string[] {
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
