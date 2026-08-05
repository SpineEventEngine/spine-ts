import { clone } from "@bufbuild/protobuf";
import { AnyMessages, Validate, type MessageSchema } from "@spine-event-engine/core";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import type { EventStore } from "@spine-event-engine/storage";

import {
  runtimeAccess,
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
} from "../runtime/runtime.js";
import { EventDispatcherRegistry } from "./event-dispatcher-registry.js";
import type { EventDispatcher } from "./event-dispatcher.js";

const storedDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const storedFollowUpDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const followUpPosters = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const exclusiveWorkers = new WeakMap<
  EventBus,
  <Result>(work: () => Result | Promise<Result>) => Promise<Result>
>();
const subscriberRegistrars = new WeakMap<
  EventBus,
  (typeUrl: string, subscriber: EventSubscriber) => EventSubscription
>();
const eventSchemaLists = new WeakMap<EventBus, () => readonly MessageSchema[]>();
const eventSchemaRegistrars = new WeakMap<EventBus, (schemas: Iterable<MessageSchema>) => void>();
const eventBusCloseStarters = new WeakMap<EventBus, () => void>();
const eventBusDrainers = new WeakMap<EventBus, () => Promise<void>>();
const eventBusCloseFinishers = new WeakMap<EventBus, () => Promise<void>>();
const eventBusWorkCounters = new WeakMap<EventBus, () => number>();
const forgettingBuses = new WeakSet<EventBus>();

interface EventBusAccess {
  createForgettingBus(eventStore: EventStore, dispatchers?: Iterable<EventDispatcher>): EventBus;
  postStored(eventBus: EventBus, event: Event): Promise<void>;
  postStoredFollowUp(eventBus: EventBus, event: Event): Promise<void>;
  postFollowUp(eventBus: EventBus, event: Event): Promise<void>;
  runExclusive<Result>(eventBus: EventBus, work: () => Result | Promise<Result>): Promise<Result>;
  subscribe(eventBus: EventBus, typeUrl: string, subscriber: EventSubscriber): EventSubscription;
  eventSchemas(eventBus: EventBus): readonly MessageSchema[];
  registerSchemas(eventBus: EventBus, schemas: Iterable<MessageSchema>): void;
  beginClose(eventBus: EventBus): void;
  drain(eventBus: EventBus): Promise<void>;
  finishClose(eventBus: EventBus): Promise<void>;
  acceptedWorkCount(eventBus: EventBus): number;
}

type EventBusIntakeState = "open" | "closing" | "closed";

/**
 * Small single-process multicast event bus.
 *
 * Public construction stores events. Internally assembled forgetting buses
 * validate, accept, and dispatch without using their injected `EventStore`.
 * Events with no matching dispatcher resolve without dispatch. Events with no
 * registered schema reject deterministically before storage or dispatch.
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

  /**
   * Creates a bus backed by an event store and initial dispatchers.
   *
   * @param eventStore the store that persists accepted events.
   * @param dispatchers the dispatchers to register.
   */
  constructor(eventStore: EventStore, dispatchers: Iterable<EventDispatcher> = []) {
    this.#eventStore = eventStore;
    this.#started = this.#runtime.start();
    storedDispatchers.set(this, (event) => this.#postStored(event));
    storedFollowUpDispatchers.set(this, (event) => this.#postStoredFollowUp(event));
    followUpPosters.set(this, (event) => this.#postFollowUp(event));
    exclusiveWorkers.set(this, (work) => this.#runExclusive(work));
    subscriberRegistrars.set(this, (typeUrl, subscriber) => this.#subscribe(typeUrl, subscriber));
    eventSchemaLists.set(this, () => this.#registry.schemas());
    eventSchemaRegistrars.set(this, (schemas) => {
      this.#registry.registerSchemas(schemas);
    });
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

  /**
   * Registers an event dispatcher.
   *
   * @param dispatcher the dispatcher to register.
   * @returns the registered dispatcher.
   */
  register<Dispatcher extends EventDispatcher>(dispatcher: Dispatcher): Dispatcher {
    this.#registry.register(dispatcher);
    return dispatcher;
  }

  /**
   * Posts an event for asynchronous dispatch.
   *
   * @param event the event envelope to post.
   * @returns A promise that settles after admission and dispatch complete and may reject.
   */
  post(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    if (this.#intakeState !== "open") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", this.#intakeState));
    }

    return this.#runExclusive(() => this.#dispatch(accepted));
  }

  /**
   * Stops accepting new event work, drains accepted work, and closes the event store.
   *
   * Close is idempotent and returns the same close outcome on repeated calls.
   * Runtime and event-store close hooks are both attempted; failures reject as
   * an `AggregateError`.
   *
   * @returns A promise that settles after the event bus closes.
   *
   */
  close(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  async #closeOnce(): Promise<void> {
    const errors: unknown[] = [];

    this.#beginClose();
    await EventBus.#closePart(() => this.#started.then(() => this.#runtime.close()), errors);
    this.#intakeState = "closed";
    this.#clearSubscribers();
    await EventBus.#closePart(() => {
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

    if (forgettingBuses.has(this)) {
      this.#validate(event, typeUrl);
      await this.#accept(event, dispatchers);

      for (const dispatcher of dispatchers) {
        await dispatcher.dispatch(clone(EventSchema, event));
      }
      this.#notify(event);
      return;
    }

    const stored = await this.#eventStore.acceptThenAppend(event, async (accepted) => {
      this.#validate(accepted, typeUrl);
      await this.#accept(accepted, dispatchers);
    });

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

  #postFollowUp(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    if (this.#intakeState === "closed") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    }

    this.#acceptedWorkCount++;
    return this.#started.then(() =>
      runtimeAccess.enqueueFollowUp(this.#runtime, () => this.#dispatch(accepted)),
    );
  }

  async #dispatchStored(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    const dispatchers = this.#registry.find(typeUrl);
    this.#validate(event, typeUrl);
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

  #validate(event: Event, typeUrl: string): void {
    const schema = this.#registry.schema(typeUrl);

    if (schema === undefined) {
      throw new Error(`No event schema registered for "${typeUrl}".`);
    }

    const message =
      event.message === undefined ? undefined : AnyMessages.unpack(event.message, schema);

    if (message === undefined) {
      throw new Error("Event payload does not match its registered schema.");
    }

    Validate.check(schema, message);
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

  static async #closePart(close: () => unknown, errors: unknown[]): Promise<void> {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
}

/**
 * Accepts events for framework service adapters.
 *
 * @internal
 */
export interface EventSubscriber {
  // prettier-ignore

  /**
   * Accepts a cloned stored event.
   *
   * @param event the event received by the subscription.
   */
  onEvent(event: Event): void;
}

/**
 * Represents an explicit cleanup handle for framework event subscriptions.
 *
 * @internal
 */
export interface EventSubscription {
  // prettier-ignore

  /**
   * Indicates whether the subscription no longer receives events.
   */
  readonly closed: boolean;

  /**
   * Stops this subscription from receiving events.
   */
  unsubscribe(): void;
}

interface EventSubscriberRecord {
  closed: boolean;
  subscriber: EventSubscriber | undefined;
  readonly typeUrl: string;
}

/**
 * Provides event-bus access for events that are already stored.
 *
 * @internal
 */
export const eventBusAccess: EventBusAccess = Object.freeze({
  createForgettingBus(
    eventStore: EventStore,
    dispatchers: Iterable<EventDispatcher> = [],
  ): EventBus {
    const eventBus = new EventBus(eventStore, dispatchers);
    forgettingBuses.add(eventBus);
    return eventBus;
  },

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

  postFollowUp(eventBus: EventBus, event: Event): Promise<void> {
    const postFollowUp = followUpPosters.get(eventBus);

    if (postFollowUp === undefined) {
      throw new TypeError("Follow-up event posting requires an EventBus instance.");
    }

    return postFollowUp(event);
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
    const eventSchemas = eventSchemaLists.get(eventBus);

    if (eventSchemas === undefined) {
      throw new TypeError("Event schema listing requires an EventBus instance.");
    }

    return eventSchemas();
  },

  registerSchemas(eventBus: EventBus, schemas: Iterable<MessageSchema>): void {
    const registerSchemas = eventSchemaRegistrars.get(eventBus);

    if (registerSchemas === undefined) {
      throw new TypeError("Event schema registration requires an EventBus instance.");
    }

    registerSchemas(schemas);
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
