import { clone } from "@bufbuild/protobuf";
import { EventSchema, type Event } from "@spine-ts/proto";
import type { EventStore } from "@spine-ts/storage";

import { SingleProcessServerRuntime } from "../runtime/runtime.js";
import { EventDispatcherRegistry } from "./event-dispatcher-registry.js";
import type { EventDispatcher } from "./event-dispatcher.js";

/**
 * Small single-process multicast event bus.
 *
 * Events are accepted asynchronously through `post()`, prechecked by the
 * injected `EventStore`, validated by matching dispatchers, appended, and then
 * dispatched in deterministic registration order. Events with no matching
 * dispatcher remain stored and resolve without dispatch.
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

  async #dispatch(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    const dispatchers = this.#registry.find(typeUrl);
    const stored = await this.#eventStore.acceptThenAppend(event, (accepted) =>
      this.#accept(accepted, dispatchers),
    );

    for (const dispatcher of dispatchers) {
      await dispatcher.dispatch(clone(EventSchema, stored));
    }
  }

  async #accept(event: Event, dispatchers: readonly EventDispatcher[]): Promise<void> {
    for (const dispatcher of dispatchers) {
      await dispatcher.accept?.(clone(EventSchema, event));
    }
  }
}
