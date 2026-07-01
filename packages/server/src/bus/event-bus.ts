import { clone } from "@bufbuild/protobuf";
import { EventSchema, type Event } from "@spine-ts/proto";
import { EventStore } from "@spine-ts/storage";

import { SingleProcessServerRuntime } from "../runtime/runtime.js";
import { EventDispatcherRegistry } from "./event-dispatcher-registry.js";
import type { EventDispatcher } from "./event-dispatcher.js";

/**
 * Small single-process multicast event bus.
 *
 * Events are accepted asynchronously through `post()`, appended to the
 * injected `EventStore`, and then dispatched to all matching dispatchers in
 * deterministic registration order.
 */
export class EventBus {
  readonly #eventStore: EventStore;
  readonly #registry = new EventDispatcherRegistry();
  readonly #runtime = new SingleProcessServerRuntime();
  readonly #started: Promise<void>;

  constructor(eventStore: EventStore, dispatchers: Iterable<EventDispatcher> = []) {
    this.#eventStore = eventStore;
    this.#started = this.#runtime.start();

    for (const dispatcher of dispatchers) {
      this.register(dispatcher);
    }
  }

  register<Dispatcher extends EventDispatcher>(dispatcher: Dispatcher): Dispatcher {
    this.#registry.register(dispatcher);
    return dispatcher;
  }

  post(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    return this.#started.then(() => this.#runtime.enqueue(() => this.#dispatch(accepted)));
  }

  dispatch(event: Event): Promise<void> {
    return this.#dispatch(clone(EventSchema, event));
  }

  async #dispatch(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    const stored = clone(EventSchema, event);
    await this.#eventStore.append(stored);

    const dispatchers = this.#registry.find(typeUrl);

    if (dispatchers.length === 0) {
      throw new Error(`No event dispatcher registered for "${typeUrl}".`);
    }

    for (const dispatcher of dispatchers) {
      await dispatcher.dispatch(clone(EventSchema, stored));
    }
  }
}
