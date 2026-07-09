import { clone } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-ts/core";
import { EventSchema, type Event } from "@spine-ts/proto";
import type { EventStore } from "@spine-ts/storage";

import {
  runtimeAccess,
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
} from "../runtime/runtime.js";
import { EventDispatcherRegistry } from "./event-dispatcher-registry.js";
import type { EventDispatcher } from "./event-dispatcher.js";

const storedDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const storedFollowUpDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const exclusiveWorkers = new WeakMap<
  EventBus,
  <Result>(work: () => Result | Promise<Result>) => Promise<Result>
>();
const subscriberRegistrars = new WeakMap<
  EventBus,
  (typeUrl: string, subscriber: EventSubscriber) => EventSubscription
>();
const eventSchemaLists = new WeakMap<EventBus, () => readonly MessageSchema[]>();
const eventBusCloseStarters = new WeakMap<EventBus, () => void>();
const eventBusDrainers = new WeakMap<EventBus, () => Promise<void>>();
const eventBusCloseFinishers = new WeakMap<EventBus, () => Promise<void>>();
const eventBusWorkCounters = new WeakMap<EventBus, () => number>();

interface EventBusAccess {
  postStored(eventBus: EventBus, event: Event): Promise<void>;
  postStoredFollowUp(eventBus: EventBus, event: Event): Promise<void>;
  runExclusive<Result>(eventBus: EventBus, work: () => Result | Promise<Result>): Promise<Result>;
  subscribe(eventBus: EventBus, typeUrl: string, subscriber: EventSubscriber): EventSubscription;
  eventSchemas(eventBus: EventBus): readonly MessageSchema[];
  beginClose(eventBus: EventBus): void;
  drain(eventBus: EventBus): Promise<void>;
  finishClose(eventBus: EventBus): Promise<void>;
  acceptedWorkCount(eventBus: EventBus): number;
}

type EventBusIntakeState = "open" | "closing" | "closed";

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
  readonly #subscribers = new Map<string, Set<EventSubscriberRecord>>();
  readonly #runtime = new SingleProcessServerRuntime();
  readonly #started: Promise<void>;
  #intakeState: EventBusIntakeState = "open";
  #acceptedWorkCount = 0;
  #closed: Promise<void> | undefined;

  constructor(eventStore: EventStore, dispatchers: Iterable<EventDispatcher> = []) {
    this.#eventStore = eventStore;
    this.#started = this.#runtime.start();
    storedDispatchers.set(this, (event) => this.#postStored(event));
    storedFollowUpDispatchers.set(this, (event) => this.#postStoredFollowUp(event));
    exclusiveWorkers.set(this, (work) => this.#runExclusive(work));
    subscriberRegistrars.set(this, (typeUrl, subscriber) => this.#subscribe(typeUrl, subscriber));
    eventSchemaLists.set(this, () => this.#registry.schemas());
    eventBusCloseStarters.set(this, () => {
      this.#beginClose();
    });
    eventBusDrainers.set(this, () => this.#drain());
    eventBusCloseFinishers.set(this, () => this.#finishClose());
    eventBusWorkCounters.set(this, () => this.#acceptedWorkCount);

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

    if (this.#intakeState !== "open") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", this.#intakeState));
    }

    return this.#runExclusive(() => this.#dispatch(accepted));
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

    this.#beginClose();
    await closePart(() => this.#started.then(() => this.#runtime.close()), errors);
    this.#intakeState = "closed";
    this.#clearSubscribers();
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
    this.#notify(stored);
  }

  #postStored(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    if (this.#intakeState === "closed") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    }

    return this.#runExclusive(() => this.#dispatchStored(accepted));
  }

  #postStoredFollowUp(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    if (this.#intakeState === "closed") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    }

    this.#acceptedWorkCount++;
    return this.#started.then(() =>
      runtimeAccess.enqueueFollowUp(this.#runtime, () => this.#dispatchStored(accepted)),
    );
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
    this.#notify(event);
  }

  async #accept(event: Event, dispatchers: readonly EventDispatcher[]): Promise<void> {
    for (const dispatcher of dispatchers) {
      await dispatcher.accept?.(clone(EventSchema, event));
    }
  }

  #runExclusive<Result>(work: () => Result | Promise<Result>): Promise<Result> {
    let result: Result | undefined;

    this.#acceptedWorkCount++;
    return this.#started
      .then(() =>
        this.#runtime.enqueue(async () => {
          result = await work();
        }),
      )
      .then(() => result as Result);
  }

  #subscribe(typeUrl: string, subscriber: EventSubscriber): EventSubscription {
    if (this.#intakeState !== "open") {
      throw new Error("EventBus is closed.");
    }

    const subscribers = this.#subscribers.get(typeUrl) ?? new Set<EventSubscriberRecord>();
    const record: EventSubscriberRecord = {
      closed: false,
      subscriber,
      typeUrl,
    };

    subscribers.add(record);
    this.#subscribers.set(typeUrl, subscribers);

    return Object.freeze({
      get closed() {
        return record.closed;
      },
      unsubscribe: () => {
        this.#unsubscribe(record);
      },
    });
  }

  #unsubscribe(record: EventSubscriberRecord): void {
    if (record.closed) {
      return;
    }

    record.closed = true;
    record.subscriber = undefined;

    const subscribers = this.#subscribers.get(record.typeUrl);
    subscribers?.delete(record);
    if (subscribers?.size === 0) {
      this.#subscribers.delete(record.typeUrl);
    }
  }

  #clearSubscribers(): void {
    for (const subscribers of this.#subscribers.values()) {
      for (const record of subscribers) {
        record.closed = true;
        record.subscriber = undefined;
      }
    }
    this.#subscribers.clear();
  }

  #notify(event: Event): void {
    const typeUrl = event.message?.typeUrl;
    if (typeUrl === undefined) {
      return;
    }

    const subscribers = [...(this.#subscribers.get(typeUrl) ?? [])]
      .map((record) => record.subscriber)
      .filter((subscriber) => subscriber !== undefined);

    for (const subscriber of subscribers) {
      try {
        subscriber.onEvent(clone(EventSchema, event));
      } catch {
        // Service-delivery subscribers must not poison event intake or later subscribers.
      }
    }
  }

  #beginClose(): void {
    if (this.#intakeState === "open") {
      this.#intakeState = "closing";
    }
  }

  #drain(): Promise<void> {
    return this.#started.then(() => runtimeAccess.drain(this.#runtime));
  }

  #finishClose(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }
}

/** @internal Direct event subscriber used by framework service adapters. */
export interface EventSubscriber {
  onEvent(event: Event): void;
}

/** @internal Explicit cleanup handle for framework event subscriptions. */
export interface EventSubscription {
  readonly closed: boolean;
  unsubscribe(): void;
}

interface EventSubscriberRecord {
  closed: boolean;
  subscriber: EventSubscriber | undefined;
  readonly typeUrl: string;
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

  postStoredFollowUp(eventBus: EventBus, event: Event): Promise<void> {
    const postStoredFollowUp = storedFollowUpDispatchers.get(eventBus);

    if (postStoredFollowUp === undefined) {
      throw new TypeError("Stored follow-up event dispatch requires an EventBus instance.");
    }

    return postStoredFollowUp(event);
  },

  runExclusive<Result>(eventBus: EventBus, work: () => Result | Promise<Result>): Promise<Result> {
    const runExclusive = exclusiveWorkers.get(eventBus);

    if (runExclusive === undefined) {
      throw new TypeError("Exclusive event-bus work requires an EventBus instance.");
    }

    return runExclusive(work);
  },

  subscribe(eventBus: EventBus, typeUrl: string, subscriber: EventSubscriber): EventSubscription {
    const subscribe = subscriberRegistrars.get(eventBus);

    if (subscribe === undefined) {
      throw new TypeError("Event subscription requires an EventBus instance.");
    }

    return subscribe(typeUrl, subscriber);
  },

  eventSchemas(eventBus: EventBus): readonly MessageSchema[] {
    return eventBusSchemas(eventBus);
  },

  beginClose(eventBus: EventBus): void {
    const beginClose = eventBusCloseStarters.get(eventBus);

    if (beginClose === undefined) {
      throw new TypeError("Event-bus close coordination requires an EventBus instance.");
    }

    beginClose();
  },

  drain(eventBus: EventBus): Promise<void> {
    const drain = eventBusDrainers.get(eventBus);

    if (drain === undefined) {
      throw new TypeError("Event-bus drain requires an EventBus instance.");
    }

    return drain();
  },

  finishClose(eventBus: EventBus): Promise<void> {
    const finishClose = eventBusCloseFinishers.get(eventBus);

    if (finishClose === undefined) {
      throw new TypeError("Event-bus close completion requires an EventBus instance.");
    }

    return finishClose();
  },

  acceptedWorkCount(eventBus: EventBus): number {
    const acceptedWorkCount = eventBusWorkCounters.get(eventBus);

    if (acceptedWorkCount === undefined) {
      throw new TypeError("Event-bus work counting requires an EventBus instance.");
    }

    return acceptedWorkCount();
  },
});

function eventBusSchemas(eventBus: EventBus): readonly MessageSchema[] {
  const eventSchemas = eventSchemaLists.get(eventBus);

  if (eventSchemas === undefined) {
    throw new TypeError("Event schema listing requires an EventBus instance.");
  }

  return eventSchemas();
}

async function closePart(close: () => unknown, errors: unknown[]): Promise<void> {
  try {
    await close();
  } catch (error) {
    errors.push(error);
  }
}
