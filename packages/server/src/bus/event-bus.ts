import { clone } from "@bufbuild/protobuf";
import { EventSchema, type Event } from "@spine-ts/proto";
import type { EventStore } from "@spine-ts/storage";

import { SingleProcessServerRuntime } from "../runtime/runtime.js";
import { EventDispatcherRegistry } from "./event-dispatcher-registry.js";
import type { EventDispatcher } from "./event-dispatcher.js";

const storedDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();

interface EventBusAccess {
  postStored(eventBus: EventBus, event: Event): Promise<void>;
}

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
  #closed: Promise<void> | undefined;

  constructor(eventStore: EventStore, dispatchers: Iterable<EventDispatcher> = []) {
    this.#eventStore = eventStore;
    this.#started = this.#runtime.start();
    storedDispatchers.set(this, (event) => this.#postStored(event));

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

  /**
   * Stop accepting new event work, drain accepted work, and close the event store.
   *
   * Close is idempotent and returns the same close outcome on repeated calls.
   * Runtime and event-store close hooks are both attempted; failures reject as
   * an `AggregateError`.
   */
  close(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  async #closeOnce(): Promise<void> {
    const errors: unknown[] = [];

    await closePart(() => this.#started.then(() => this.#runtime.close()), errors);
    await closePart(() => {
      this.#eventStore.close();
    }, errors);

    if (errors.length > 0) {
      throw new AggregateError(errors, "EventBus close failed.");
    }
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

  #postStored(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    return this.#started.then(() => this.#runtime.enqueue(() => this.#dispatchStored(accepted)));
  }

  async #dispatchStored(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    const dispatchers = this.#registry.find(typeUrl);
    await this.#accept(event, dispatchers);

    for (const dispatcher of dispatchers) {
      await dispatcher.dispatch(clone(EventSchema, event));
    }
  }

  async #accept(event: Event, dispatchers: readonly EventDispatcher[]): Promise<void> {
    for (const dispatcher of dispatchers) {
      await dispatcher.accept?.(clone(EventSchema, event));
    }
  }
}

/** @internal Event-bus access used when events are already stored. */
export const eventBusAccess: EventBusAccess = Object.freeze({
  postStored(eventBus: EventBus, event: Event): Promise<void> {
    const postStored = storedDispatchers.get(eventBus);

    if (postStored === undefined) {
      throw new TypeError("Stored event dispatch requires an EventBus instance.");
    }

    return postStored(event);
  },
});

async function closePart(close: () => unknown, errors: unknown[]): Promise<void> {
  try {
    await close();
  } catch (error) {
    errors.push(error);
  }
}
