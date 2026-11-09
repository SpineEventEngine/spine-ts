/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { clone, create, equals } from "@bufbuild/protobuf";
import { AnyPacker, Validate, type MessageSchema } from "@spine-event-engine/core";
import { EventContextSchema, EventSchema, type Event } from "@spine-event-engine/proto";
import * as AgentInteraction from "@spine-event-engine/proto/agent";
import type { EventStore } from "@spine-event-engine/storage";
import { eventStoreAccess } from "@spine-event-engine/storage/provider";
import type { ILogLayer } from "loglayer";

import {
  runtimeAccess,
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
} from "../runtime/runtime.js";
import type { ServerEnvironment } from "../server/server-environment.js";
import { EventDispatcherRegistry } from "./event-dispatcher-registry.js";
import type { EventDispatcher } from "./event-dispatcher.js";
import { emitServerError } from "../server/server-log.js";

const storedDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const eventBusRuntimes = new WeakMap<EventBus, SingleProcessServerRuntime>();
const storedFollowUpDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const followUpPosters = new WeakMap<EventBus, (event: Event) => Promise<void>>();

/**
 * Executes a callback on the serialized bus queue.
 *
 * @typeParam Result Callback result.
 * @param work Callback to run.
 * @returns Callback result.
 */
type ExclusiveWorker = <Result>(work: () => Result | Promise<Result>) => Promise<Result>;

const exclusiveWorkers = new WeakMap<EventBus, ExclusiveWorker>();
const subscriberRegistrars = new WeakMap<
  EventBus,
  (typeUrl: string, subscriber: EventSubscriber) => EventSubscription
>();
const eventSchemaLists = new WeakMap<EventBus, () => readonly MessageSchema[]>();
const eventSchemaRegistrars = new WeakMap<EventBus, (schemas: Iterable<MessageSchema>) => void>();
const dispatcherUnregistrars = new WeakMap<EventBus, (dispatcher: EventDispatcher) => void>();
const eventSchemaFinders = new WeakMap<EventBus, (typeUrl: string) => MessageSchema | undefined>();
const eventBusCloseStarters = new WeakMap<EventBus, () => void>();
const eventBusDrainers = new WeakMap<EventBus, () => Promise<void>>();
const eventBusCloseFinishers = new WeakMap<EventBus, () => Promise<void>>();
const eventBusAborters = new WeakMap<EventBus, () => void>();
const eventBusWorkCounters = new WeakMap<EventBus, () => number>();
const forgettingBus: unique symbol = Symbol("forgetting-bus");
const forgettingBuses = new WeakSet<EventBus>();
const eventBusRoles = new WeakMap<EventBus, EventBusRole>();
const eventBusLoggers = new WeakMap<EventBus, ILogLayer>();
const eventAdmissions = new WeakMap<EventBus, (event: Event) => Promise<void>>();

/**
 * Selects whether an EventBus accepts domain event schemas or framework System event schemas.
 */
type EventBusRole = "domain" | "system";

const agentSystemTypes = new Set<string>([
  AgentInteraction.AgentAiOperationStartedSchema.typeName,
  AgentInteraction.AgentModelAttemptStartedSchema.typeName,
  AgentInteraction.AgentModelAttemptFinishedSchema.typeName,
  AgentInteraction.AgentAiResultAdmittedSchema.typeName,
  AgentInteraction.AgentAiOperationFailedSchema.typeName,
  AgentInteraction.AgentToolCallStartedSchema.typeName,
  AgentInteraction.AgentToolCallFinishedSchema.typeName,
  AgentInteraction.AgentModelSelectionChangedSchema.typeName,
  AgentInteraction.AgentInvocationTerminatedSchema.typeName,
]);

/**
 * Checks whether a schema defines a framework System Event, including Agent interactions.
 *
 * @param schema Event payload schema.
 * @returns Whether the Event belongs to the System bus.
 */
export const isSystemEventSchema = (schema: MessageSchema): boolean =>
  schema.typeName.startsWith("spine.system.") || agentSystemTypes.has(schema.typeName);

/**
 * Pairs a recipient with the cloned Event it accepted, preserving its accepted payload for dispatch.
 */
interface AcceptedEventDispatcher {
  readonly dispatcher: EventDispatcher;
  readonly event: Event;
}

/**
 * Defines package-private EventBus assembly, posting, subscription, schema, logging, and close operations.
 */
interface EventBusAccess {
  // prettier-ignore

  /**
   * Binds this context bus's private runtime to its captured environment.
   * @param eventBus Framework context bus.
   * @param environment Exact environment containing the context.
   */
  bindEnvironment(eventBus: EventBus, environment: ServerEnvironment): void;

  /**
   * Sets receiving-context admission before Event storage or dispatch.
   *
   * @param eventBus Context Event bus.
   * @param onAdmit Checks current tenant membership.
   */
  setAdmission(eventBus: EventBus, onAdmit: (event: Event) => Promise<void>): void;

  /**
   * Creates a package-internal bus without an event store.
   *
   * @param dispatchers the initial dispatchers to register.
   * @returns the assembled forgetting bus.
   */
  createForgettingBus(dispatchers?: Iterable<EventDispatcher>): EventBus;

  /**
   * Creates a System Event bus with optional persistent storage.
   * @param eventStore Optional System Event store.
   * @param dispatchers Initial recipients.
   * @returns Configured System Event bus.
   */
  createSystemBus(
    eventStore: EventStore | undefined,
    dispatchers?: Iterable<EventDispatcher>,
  ): EventBus;

  /**
   * Dispatches one already-stored Event without another append.
   * @param eventBus Target bus.
   * @param event Captured Event envelope.
   * @returns Completion after recipient dispatch.
   */
  postStored(eventBus: EventBus, event: Event): Promise<void>;

  /**
   * Queues an already-stored Event as a trusted follow-up.
   * @param eventBus Target bus.
   * @param event Captured Event envelope.
   * @returns Completion after recipient dispatch.
   */
  postStoredFollowUp(eventBus: EventBus, event: Event): Promise<void>;

  /**
   * Queues a produced Event after active bus work.
   * @param eventBus Target bus.
   * @param event Produced Event envelope.
   * @returns Completion after recipient dispatch.
   */
  postFollowUp(eventBus: EventBus, event: Event): Promise<void>;

  /**
   * Executes a callback in the Event queue.
   * @typeParam Result Callback result.
   * @param eventBus Target bus.
   * @param work Serialized callback.
   * @returns The callback result.
   */
  runExclusive<Result>(eventBus: EventBus, work: () => Result | Promise<Result>): Promise<Result>;

  /**
   * Registers an in-process Event subscriber.
   * @param eventBus Target bus.
   * @param typeUrl Event payload type URL.
   * @param subscriber Recipient to notify.
   * @returns Subscription cancellation handle.
   */
  subscribe(eventBus: EventBus, typeUrl: string, subscriber: EventSubscriber): EventSubscription;

  /**
   * Lists registered Event payload schemas.
   * @param eventBus Target bus.
   * @returns Current schema list.
   */
  eventSchemas(eventBus: EventBus): readonly MessageSchema[];

  /**
   * Registers Event schemas for produced signals.
   * @param eventBus Target bus.
   * @param schemas Schemas to register.
   */
  registerSchemas(eventBus: EventBus, schemas: Iterable<MessageSchema>): void;

  /**
   * Removes a dispatcher from this bus.
   * @param eventBus Target bus.
   * @param dispatcher Dispatcher to remove.
   */
  unregister(eventBus: EventBus, dispatcher: EventDispatcher): void;

  /**
   * Finds a registered Event schema.
   * @param eventBus Target bus.
   * @param typeUrl Event payload type URL.
   * @returns Matching schema when registered.
   */
  schema(eventBus: EventBus, typeUrl: string): MessageSchema | undefined;

  /**
   * Stops external Event intake before graceful drain.
   * @param eventBus Target bus.
   */
  beginClose(eventBus: EventBus): void;

  /**
   * Waits for accepted Event work.
   * @param eventBus Target bus.
   * @returns Completion after the queue drains.
   */
  drain(eventBus: EventBus): Promise<void>;

  /**
   * Completes graceful Event-bus closure.
   * @param eventBus Target bus.
   * @returns Completion after closure.
   */
  finishClose(eventBus: EventBus): Promise<void>;

  /**
   * Closes a partially assembled bus.
   * @param eventBus Target bus.
   */
  abortClose(eventBus: EventBus): void;

  /**
   * Returns admitted Event work count for drain stability.
   * @param eventBus Target bus.
   * @returns Number of accepted work items.
   */
  acceptedWorkCount(eventBus: EventBus): number;

  /**
   * Sets the internal diagnostic sink.
   * @param eventBus Target bus.
   * @param logger Safe structured logger.
   */
  installLogger(eventBus: EventBus, logger: ILogLayer): void;

  /**
   * Clears the internal diagnostic sink.
   * @param eventBus Target bus.
   */
  clearLogger(eventBus: EventBus): void;
}

/**
 * Tracks whether an EventBus still accepts work, is draining, or has closed.
 */
type EventBusIntakeState = "open" | "closing" | "closed";

/**
 * Small single-process multicast event bus.
 *
 * Public construction creates a domain-only bus that stores domain events and
 * rejects System schemas, dispatchers, and events. Internally assembled
 * forgetting and System buses have no `EventStore` unless explicitly given one.
 * Events with no matching dispatcher resolve without dispatch. Events with no
 * registered schema reject deterministically before storage or dispatch.
 */
export class EventBus {
  readonly #eventStore: EventStore | undefined;

  readonly #registry = new EventDispatcherRegistry();

  readonly #subscribers = new Map<string, Set<EventSubscriberRecord>>();

  readonly #runtime = new SingleProcessServerRuntime();

  readonly #started: Promise<void>;

  #intakeState: EventBusIntakeState = "open";

  #acceptedWorkCount = 0;

  #closed: Promise<void> | undefined;

  /**
   * Creates a domain-only bus backed by an event store and initial dispatchers.
   * System schemas and dispatchers are rejected; framework System events use
   * the package-internal System-bus factory instead.
   *
   * @param eventStore the store that persists accepted events.
   * @param dispatchers the dispatchers to register.
   */
  constructor(eventStore: EventStore, dispatchers: Iterable<EventDispatcher> = []) {
    const ownedStore = EventBus.#requireEventStore(eventStore);

    this.#eventStore = ownedStore === forgettingBus ? undefined : ownedStore;
    this.#started = this.#runtime.start();
    eventBusRuntimes.set(this, this.#runtime);
    storedDispatchers.set(this, (event) => this.#postStored(event));
    storedFollowUpDispatchers.set(this, (event) => this.#postStoredFollowUp(event));
    followUpPosters.set(this, (event) => this.#postFollowUp(event));
    exclusiveWorkers.set(this, (work) => this.#runExclusive(work));
    subscriberRegistrars.set(this, (typeUrl, subscriber) => this.#subscribe(typeUrl, subscriber));
    eventSchemaLists.set(this, () => this.#registry.schemas());
    eventSchemaRegistrars.set(this, (schemas) => {
      this.#registry.registerSchemas(schemas);
    });
    dispatcherUnregistrars.set(this, (dispatcher) => {
      this.#registry.unregister(dispatcher);
    });
    eventSchemaFinders.set(this, (typeUrl) => this.#registry.schema(typeUrl));
    this.#registerCloseHooks();

    for (const dispatcher of dispatchers) {
      this.register(dispatcher);
    }
  }

  /**
   * Registers lifecycle callbacks for the package-internal bus access seam.
   */
  #registerCloseHooks(): void {
    eventBusCloseStarters.set(this, () => {
      this.#beginClose();
    });
    eventBusDrainers.set(this, () => this.#drain());
    eventBusCloseFinishers.set(this, () => this.#finishClose());
    eventBusAborters.set(this, () => {
      this.#abortClose();
    });
    eventBusWorkCounters.set(this, () => this.#acceptedWorkCount);
  }

  /**
   * Registers an event dispatcher.
   *
   * @typeParam Dispatcher Concrete recipient being registered.
   * @param dispatcher the dispatcher to register.
   * @returns the registered dispatcher.
   */
  register<Dispatcher extends EventDispatcher>(dispatcher: Dispatcher): Dispatcher {
    EventBusRoles.validateDispatcher(eventBusRoles.get(this) ?? "domain", dispatcher);
    this.#registry.register(dispatcher);
    return dispatcher;
  }

  /**
   * Posts an event for asynchronous dispatch.
   *
   * Repository-backed Entity recipients complete dispatch after their Inbox
   * receipt is stored and eligible delivery is scheduled. Handler processing
   * may continue after this promise resolves. Other registered dispatchers
   * determine completion through their own dispatch promises.
   *
   * @param event the event envelope to post.
   * @returns Completion or failure of admission and registered dispatcher handoff.
   */
  post(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    if (this.#intakeState !== "open") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", this.#intakeState));
    }

    return this.#runExclusive(() => this.#dispatch(accepted));
  }

  /**
   * Stops accepting new event work, drains accepted work, and closes its event store.
   *
   * Close is idempotent and returns the same close outcome on repeated calls.
   * Runtime and event-store close hooks are both awaited; failures reject as
   * an `AggregateError` after both cleanup attempts.
   *
   * @returns A promise that settles after the event bus closes.
   */
  close(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  /**
   * Stops EventBus intake, closes the runtime, clears subscribers, closes the optional event
   * store, and aggregates cleanup failures.
   */
  async #closeOnce(): Promise<void> {
    const errors: unknown[] = [];

    this.#beginClose();
    await EventBus.#closePart(() => this.#started.then(() => this.#runtime.close()), errors);
    this.#intakeState = "closed";
    this.#clearSubscribers();
    const eventStore = this.#eventStore;
    if (eventStore !== undefined) {
      await EventBus.#closePart(() => eventStore.close(), errors);
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "EventBus close failed.");
    }
  }

  /**
   * Performs best-effort immediate closure for a partially assembled EventBus and releases its idle event store.
   */
  #abortClose(): void {
    this.#beginClose();
    try {
      if (this.#eventStore !== undefined) eventStoreAccess.closeIdle(this.#eventStore);
    } finally {
      // spine-log-boundary: server.event_bus_close_runtime
      void this.#started.then(() => this.#runtime.close()).catch(() => undefined);
      this.#intakeState = "closed";
      this.#clearSubscribers();
    }
  }

  /**
   * Validates and admits a new Event, persists it when applicable, then dispatches accepted
   * recipients and notifies subscribers.
   */
  async #dispatch(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    this.#validate(event, typeUrl);
    const onAdmit = eventAdmissions.get(this);
    await onAdmit?.(event);

    const dispatchers = this.#registry.find(typeUrl, event.context?.external === true);

    if (forgettingBuses.has(this)) {
      const accepted = await this.#accept(event, dispatchers);
      await this.#deliverAccepted(event, accepted);
      return;
    }

    const eventStore = this.#eventStore;
    if (eventStore === undefined) {
      throw new Error("EventBus requires an EventStore.");
    }

    let acceptedDispatchers: readonly AcceptedEventDispatcher[] = [];
    const stored = await eventStore.acceptThenAppend(event, async (accepted) => {
      acceptedDispatchers = await this.#accept(accepted, dispatchers);
    });

    await this.#deliverAccepted(stored, acceptedDispatchers);
  }

  /**
   * Queues an already-stored Event for recipient acceptance and dispatch without appending it again.
   */
  #postStored(event: Event): Promise<void> {
    const accepted = clone(EventSchema, event);

    if (this.#intakeState === "closed") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    }

    return this.#runExclusive(() => this.#dispatchStored(accepted));
  }

  /**
   * Queues an already-stored follow-up Event behind current runtime work without appending it again.
   */
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

  /**
   * Queues a follow-up Event behind current runtime work for normal acceptance and dispatch.
   */
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

  /**
   * Validates and accepts a stored Event, dispatches its accepted recipients, and notifies
   * subscribers without storing it.
   */
  async #dispatchStored(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    const dispatchers = this.#registry.find(typeUrl, event.context?.external === true);
    this.#validate(event, typeUrl);
    const accepted = await this.#accept(event, dispatchers);

    await this.#deliverAccepted(event, accepted);
  }

  /**
   * Delivers accepted recipients in order before notification.
   *
   * @param event Event to notify after successful dispatch.
   * @param accepted Recipients admitted for this Event.
   * @returns Completion after all recipients and notification.
   */
  async #deliverAccepted(
    event: Event,
    accepted: readonly AcceptedEventDispatcher[],
  ): Promise<void> {
    for (const { dispatcher, event: acceptedEvent } of accepted) {
      await dispatcher.dispatch(acceptedEvent);
    }
    this.#notify(event);
  }

  /**
   * Clones the Event for each matching recipient, awaits its optional acceptance hook, and returns
   * the accepted recipient payloads.
   */
  async #accept(
    event: Event,
    dispatchers: readonly EventDispatcher[],
  ): Promise<readonly AcceptedEventDispatcher[]> {
    const accepted: AcceptedEventDispatcher[] = [];
    for (const dispatcher of dispatchers) {
      const acceptedEvent = clone(EventSchema, event);
      await dispatcher.accept?.(acceptedEvent);
      accepted.push(Object.freeze({ dispatcher, event: acceptedEvent }));
    }
    return Object.freeze(accepted);
  }

  /**
   * Checks required Event identity and context, registered schema and bus role, payload decoding,
   * and Protobuf validity.
   */
  #validate(event: Event, typeUrl: string): void {
    if (event.id?.value === undefined || event.id.value === "") {
      throw new Error("EventBus requires non-empty event.id.value.");
    }
    if (
      event.context === undefined ||
      equals(EventContextSchema, event.context, create(EventContextSchema))
    ) {
      throw new Error("EventBus requires a non-default event.context.");
    }
    const schema = this.#registry.schema(typeUrl);

    if (schema === undefined) {
      throw new Error(`No event schema registered for "${typeUrl}".`);
    }

    EventBusRoles.validateSchema(eventBusRoles.get(this) ?? "domain", schema);

    const message =
      event.message === undefined ? undefined : AnyPacker.tryUnpack(event.message, schema);

    if (message === undefined) {
      throw new Error("Event payload does not match its registered schema.");
    }

    Validate.check(EventSchema, event);
    Validate.check(schema, message);
  }

  /**
   * Serializes one Event callback on the raw runtime queue.
   * @typeParam Result Callback result.
   * @param work Callback to run.
   * @returns Callback result after queued work completes.
   */
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

  /**
   * Registers a subscriber for one event type and returns an idempotent unsubscribe handle.
   */
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
      /**
       * Reports whether this subscription has stopped receiving events.
       */
      get closed() {
        return record.closed;
      },
      unsubscribe: () => {
        this.#unsubscribe(record);
      },
    });
  }

  /**
   * Marks a subscriber record closed and removes it from the type-specific subscriber set.
   */
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

  /**
   * Closes all subscriber records, drops their callbacks, and removes the bus logger.
   */
  #clearSubscribers(): void {
    for (const subscribers of this.#subscribers.values()) {
      for (const record of subscribers) {
        record.closed = true;
        record.subscriber = undefined;
      }
    }
    this.#subscribers.clear();
    eventBusLoggers.delete(this);
  }

  /**
   * Notifies a snapshot of subscribers for the Event type; subscriber failures are logged and do not interrupt intake.
   */
  #notify(event: Event): void {
    const typeUrl = event.message?.typeUrl;
    if (typeUrl === undefined) {
      return;
    }

    const subscribers = [...(this.#subscribers.get(typeUrl) ?? [])]
      .map((record) => record.subscriber)
      .filter((subscriber) => subscriber !== undefined);

    for (const subscriber of subscribers) {
      const logger = eventBusLoggers.get(this);
      try {
        const onEvent: (event: Event) => unknown = subscriber.onEvent.bind(subscriber);
        const result = onEvent(clone(EventSchema, event));
        if (EventBus.#isPromiseLike(result)) {
          // spine-log-boundary: server.event_subscriber_async_failure
          void Promise.resolve(result).catch(() => {
            this.#recordSubscriberFailure(typeUrl, logger);
          });
        }
      } catch {
        // Service-delivery subscribers must not poison event intake or later subscribers.
        // spine-log-boundary: server.event_subscriber_sync_failure
        this.#recordSubscriberFailure(typeUrl, logger);
      }
    }
  }

  /**
   * Emits a structured diagnostic when a subscriber throws or returns a rejected promise.
   */
  #recordSubscriberFailure(typeUrl: string, logger: ILogLayer | undefined): void {
    if (logger !== undefined) {
      emitServerError(logger, "Event subscriber failed.", {
        eventType: typeUrl,
        operation: "event.subscriber",
        reasonCode: "subscriber_failed",
      });
    }
  }

  /**
   * Transitions an open bus to closing so new event work is rejected.
   */
  #beginClose(): void {
    if (this.#intakeState === "open") {
      this.#intakeState = "closing";
    }
  }

  /**
   * Waits for the EventBus runtime queue to drain after runtime startup.
   */
  #drain(): Promise<void> {
    return this.#started.then(() => runtimeAccess.drain(this.#runtime));
  }

  /**
   * Starts or returns the idempotent EventBus close operation.
   */
  #finishClose(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  /**
   * Awaits one close hook and appends its failure so remaining cleanup can continue.
   */
  static async #closePart(close: () => unknown, errors: unknown[]): Promise<void> {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }

  /**
   * Rejects a missing store and returns the supplied event-store sentinel or EventStore.
   */
  static #requireEventStore(eventStore: unknown): EventStore | typeof forgettingBus {
    if (eventStore === undefined) {
      throw new TypeError("EventBus requires an EventStore.");
    }

    return eventStore as EventStore | typeof forgettingBus;
  }

  /**
   * Recognizes object or function values with a callable then property.
   */
  static #isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function"
    );
  }
}

const EventBusRoles = Object.freeze({
  /**
   * Creates a System Event bus with the supplied recipients.
   * @param eventStore Optional persistent Event store.
   * @param dispatchers Initial System recipients.
   * @returns Configured System Event bus.
   */
  createSystem(
    eventStore: EventStore | undefined,
    dispatchers: Iterable<EventDispatcher>,
  ): EventBus {
    const eventBus = new EventBus((eventStore ?? forgettingBus) as EventStore, []);
    eventBusRoles.set(eventBus, "system");
    if (eventStore === undefined) forgettingBuses.add(eventBus);
    for (const dispatcher of dispatchers) eventBus.register(dispatcher);
    return eventBus;
  },

  /**
   * Validates that a dispatcher belongs to the bus role.
   *
   * @param role Domain or System role.
   * @param dispatcher Recipient to validate.
   */
  validateDispatcher(role: EventBusRole, dispatcher: EventDispatcher): void {
    for (const schema of dispatcher.messageSchemas()) EventBusRoles.validateSchema(role, schema);
  },

  /**
   * Validates one Event schema for a bus role.
   *
   * @param role Domain or System role.
   * @param schema Event payload schema.
   */
  validateSchema(role: EventBusRole, schema: MessageSchema): void {
    const typeUrl = `type.${schema.typeName}`;
    const systemSchema = isSystemEventSchema(schema);
    if (role === "domain" && systemSchema)
      throw new Error(`Domain EventBus rejects system event schema "${typeUrl}".`);
    if (role === "system" && !systemSchema)
      throw new Error(`System EventBus rejects domain event schema "${typeUrl}".`);
  },
});

/**
 * Accepts events for framework service adapters.
 *
 * @internal
 */
export interface EventSubscriber {
  // prettier-ignore

  /**
   * Accepts a cloned dispatched event.
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

/**
 * Tracks one subscriber registration, its event type, and whether its subscription remains active.
 */
interface EventSubscriberRecord {
  closed: boolean;
  subscriber: EventSubscriber | undefined;
  readonly typeUrl: string;
}

/**
 * Provides package-internal EventBus access and assembly.
 *
 * @internal
 */
export const eventBusAccess: EventBusAccess = Object.freeze({
  /**
   * Binds the private queue to its framework context's captured environment.
   * @param eventBus Framework context bus.
   * @param environment Exact environment containing the context.
   */
  bindEnvironment(eventBus: EventBus, environment: ServerEnvironment): void {
    const runtime = eventBusRuntimes.get(eventBus);
    if (runtime === undefined)
      throw new TypeError("Framework binding requires an EventBus instance.");
    runtimeAccess.bindFrameworkEnvironment(runtime, environment);
  },

  /**
   * Sets the context's live Event tenant check.
   *
   * @param eventBus Context Event bus.
   * @param onAdmit Checks current membership.
   */
  setAdmission(eventBus: EventBus, onAdmit: (event: Event) => Promise<void>): void {
    if (!storedDispatchers.has(eventBus))
      throw new TypeError("Event admission requires an EventBus instance.");
    eventAdmissions.set(eventBus, onAdmit);
  },

  /**
   * Removes the logger associated with a valid EventBus.
   */
  clearLogger(eventBus: EventBus): void {
    if (!storedDispatchers.has(eventBus)) {
      throw new TypeError("EventBus logger requires an EventBus instance.");
    }
    eventBusLoggers.delete(eventBus);
  },

  /**
   * Associates a structured diagnostic logger with a valid EventBus.
   */
  installLogger(eventBus: EventBus, logger: ILogLayer): void {
    if (!storedDispatchers.has(eventBus)) {
      throw new TypeError("EventBus logger requires an EventBus instance.");
    }
    eventBusLoggers.set(eventBus, logger);
  },

  /**
   * Creates an internal EventBus that dispatches accepted events without persisting them.
   */
  createForgettingBus(dispatchers: Iterable<EventDispatcher> = []): EventBus {
    const eventBus = new EventBus(forgettingBus as never, dispatchers);
    forgettingBuses.add(eventBus);
    return eventBus;
  },

  /**
   * Creates an internal System-role EventBus, optionally backed by a store, and registers initial dispatchers.
   */
  createSystemBus(
    eventStore: EventStore | undefined,
    dispatchers: Iterable<EventDispatcher> = [],
  ): EventBus {
    return EventBusRoles.createSystem(eventStore, dispatchers);
  },

  /**
   * Dispatches an already-persisted Event through this bus without appending it to the store.
   */
  postStored(eventBus: EventBus, event: Event): Promise<void> {
    const postStored = storedDispatchers.get(eventBus);

    if (postStored === undefined) {
      throw new TypeError("Stored event dispatch requires an EventBus instance.");
    }

    return postStored(event);
  },

  /**
   * Schedules dispatch of an already-persisted Event as follow-up runtime work.
   */
  postStoredFollowUp(eventBus: EventBus, event: Event): Promise<void> {
    const postStoredFollowUp = storedFollowUpDispatchers.get(eventBus);

    if (postStoredFollowUp === undefined) {
      throw new TypeError("Stored follow-up event dispatch requires an EventBus instance.");
    }

    return postStoredFollowUp(event);
  },

  /**
   * Schedules normal Event acceptance and dispatch as follow-up runtime work.
   */
  postFollowUp(eventBus: EventBus, event: Event): Promise<void> {
    const postFollowUp = followUpPosters.get(eventBus);

    if (postFollowUp === undefined) {
      throw new TypeError("Follow-up event posting requires an EventBus instance.");
    }

    return postFollowUp(event);
  },

  /**
   * Executes one callback on the Event queue.
   * @typeParam Result Callback result.
   * @param eventBus Target bus.
   * @param work Serialized callback.
   * @returns Callback result.
   */
  runExclusive<Result>(eventBus: EventBus, work: () => Result | Promise<Result>): Promise<Result> {
    const runExclusive = exclusiveWorkers.get(eventBus);

    if (runExclusive === undefined) {
      throw new TypeError("Exclusive event-bus work requires an EventBus instance.");
    }

    return runExclusive(work);
  },

  /**
   * Registers a callback for a particular event type on this bus.
   */
  subscribe(eventBus: EventBus, typeUrl: string, subscriber: EventSubscriber): EventSubscription {
    const subscribe = subscriberRegistrars.get(eventBus);

    if (subscribe === undefined) {
      throw new TypeError("Event subscription requires an EventBus instance.");
    }

    return subscribe(typeUrl, subscriber);
  },

  /**
   * Returns the schemas registered with this EventBus.
   */
  eventSchemas(eventBus: EventBus): readonly MessageSchema[] {
    const eventSchemas = eventSchemaLists.get(eventBus);

    if (eventSchemas === undefined) {
      throw new TypeError("Event schema listing requires an EventBus instance.");
    }

    return eventSchemas();
  },

  /**
   * Registers event payload schemas with this EventBus.
   */
  registerSchemas(eventBus: EventBus, schemas: Iterable<MessageSchema>): void {
    const registerSchemas = eventSchemaRegistrars.get(eventBus);

    if (registerSchemas === undefined) {
      throw new TypeError("Event schema registration requires an EventBus instance.");
    }

    const checked = [...schemas];
    for (const schema of checked) {
      EventBusRoles.validateSchema(eventBusRoles.get(eventBus) ?? "domain", schema);
    }
    registerSchemas(checked);
  },

  /**
   * Removes the supplied dispatcher and its registrations from this EventBus.
   */
  unregister(eventBus: EventBus, dispatcher: EventDispatcher): void {
    const unregister = dispatcherUnregistrars.get(eventBus);
    if (unregister === undefined) throw new TypeError("Event dispatcher requires an EventBus.");
    unregister(dispatcher);
  },

  /**
   * Looks up the registered event payload schema for a type URL.
   */
  schema(eventBus: EventBus, typeUrl: string): MessageSchema | undefined {
    const schema = eventSchemaFinders.get(eventBus);
    if (schema === undefined) throw new TypeError("Event schema requires an EventBus.");
    return schema(typeUrl);
  },

  /**
   * Stops this EventBus from accepting newly posted events.
   */
  beginClose(eventBus: EventBus): void {
    const beginClose = eventBusCloseStarters.get(eventBus);

    if (beginClose === undefined) {
      throw new TypeError("Event-bus close coordination requires an EventBus instance.");
    }

    beginClose();
  },

  /**
   * Waits for queued EventBus work to complete.
   */
  drain(eventBus: EventBus): Promise<void> {
    const drain = eventBusDrainers.get(eventBus);

    if (drain === undefined) {
      throw new TypeError("Event-bus drain requires an EventBus instance.");
    }

    return drain();
  },

  /**
   * Completes the idempotent close operation for this EventBus.
   */
  finishClose(eventBus: EventBus): Promise<void> {
    const finishClose = eventBusCloseFinishers.get(eventBus);

    if (finishClose === undefined) {
      throw new TypeError("Event-bus close completion requires an EventBus instance.");
    }

    return finishClose();
  },

  /**
   * Closes a partially assembled EventBus without waiting for normal drain.
   */
  abortClose(eventBus: EventBus): void {
    const abortClose = eventBusAborters.get(eventBus);
    if (abortClose === undefined)
      throw new TypeError("Event-bus close coordination requires an EventBus instance.");
    abortClose();
  },

  /**
   * Returns the count of EventBus work admitted for runtime drain stability checks.
   */
  acceptedWorkCount(eventBus: EventBus): number {
    const acceptedWorkCount = eventBusWorkCounters.get(eventBus);

    if (acceptedWorkCount === undefined) {
      throw new TypeError("Event-bus work counting requires an EventBus instance.");
    }

    return acceptedWorkCount();
  },
});
