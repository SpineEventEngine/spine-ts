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

import { clone, create } from "@bufbuild/protobuf";
import { AnyMessages, Validate, type MessageSchema } from "@spine-event-engine/core";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import * as AgentInteraction from "@spine-event-engine/proto/agent";
import type { EventStore } from "@spine-event-engine/storage";
import { eventStoreAccess } from "@spine-event-engine/storage/provider";
import {
  AgentSavedDispatchPlanSchema as SavedPlanSchema,
  type AgentSavedDispatchPlan,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { ILogLayer } from "loglayer";

import {
  runtimeAccess,
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
} from "../runtime/runtime.js";
import { EventDispatcherRegistry } from "./event-dispatcher-registry.js";
import type { EventDispatcher } from "./event-dispatcher.js";
import { emitServerError } from "../server/server-log.js";
import { SavedDispatcherBindings } from "./saved-dispatcher-binding.js";

const storedDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const storedFollowUpDispatchers = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const followUpPosters = new WeakMap<EventBus, (event: Event) => Promise<void>>();
const savedPreparers = new WeakMap<EventBus, (event: Event) => Promise<AgentSavedDispatchPlan>>();
const savedFollowUps = new WeakMap<
  EventBus,
  (event: Event, plan: AgentSavedDispatchPlan) => Promise<void>
>();
// prettier-ignore
const exclusiveWorkers = new WeakMap<
  EventBus,

  /**
   * Executes work in the event bus sequence.
   *
   * @typeParam Result Value returned by serialized work.
   */
  <Result>(work: () => Result | Promise<Result>) => Promise<Result>
>();
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
 * Checks for framework System events, including Agent interaction events.
 *
 * @param schema Event message descriptor to classify.
 * @returns Whether the schema is reserved for System events.
 */
export const isSystemEventSchema = (schema: MessageSchema): boolean =>
  schema.typeName.startsWith("spine.system.") || agentSystemTypes.has(schema.typeName);

interface AcceptedEventDispatcher {
  readonly dispatcher: EventDispatcher;
  readonly event: Event;
}

interface EventBusAccess {
  /**
   * Creates a bus without event storage.
   *
   * @param dispatchers Initial dispatchers to register.
   * @returns The event bus without an event store.
   */
  createForgettingBus(dispatchers?: Iterable<EventDispatcher>): EventBus;

  /**
   * Creates a System-event bus with optional storage.
   *
   * @param eventStore Optional event store for the System bus.
   * @param dispatchers Initial dispatchers to register.
   * @returns The System-event bus.
   */
  createSystemBus(
    eventStore: EventStore | undefined,
    dispatchers?: Iterable<EventDispatcher>,
  ): EventBus;

  /**
   * Stores and dispatches an accepted event.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param event Event envelope to prepare or dispatch.
   * @returns A promise for event storage and dispatch.
   */
  postStored(eventBus: EventBus, event: Event): Promise<void>;

  /**
   * Stores and dispatches an event during follow-up work.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param event Event envelope to prepare or dispatch.
   * @returns A promise for follow-up event storage and dispatch.
   */
  postStoredFollowUp(eventBus: EventBus, event: Event): Promise<void>;

  /**
   * Posts an internal event during follow-up work.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param event Event envelope to prepare or dispatch.
   * @returns A promise for follow-up event dispatch.
   */
  postFollowUp(eventBus: EventBus, event: Event): Promise<void>;

  /**
   * Prepares a dispatch plan before persisting accepted output.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param event Event envelope to prepare or dispatch.
   * @returns The exact saved recipient plan.
   */
  prepareSaved(eventBus: EventBus, event: Event): Promise<AgentSavedDispatchPlan>;

  /**
   * Posts a prepared dispatch after its Agent result is saved.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param event Event envelope to prepare or dispatch.
   * @param plan Persisted recipient plan for this dispatch.
   * @returns A promise for completion of the saved dispatch.
   */
  postSavedFollowUp(eventBus: EventBus, event: Event, plan: AgentSavedDispatchPlan): Promise<void>;

  /**
   * Executes work in the bus-wide exclusive sequence.
   *
   * @typeParam Result Result type returned by the serialized work.
   * @param eventBus Event bus receiving this internal operation.
   * @param work Work to serialize with other bus operations.
   * @returns The result returned by the serialized work.
   */
  runExclusive<Result>(eventBus: EventBus, work: () => Result | Promise<Result>): Promise<Result>;

  /**
   * Subscribes a callback to one event type.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param typeUrl Fully qualified event message type URL.
   * @param subscriber Callback to invoke for matching events.
   * @returns A handle for removing the subscription.
   */
  subscribe(eventBus: EventBus, typeUrl: string, subscriber: EventSubscriber): EventSubscription;

  /**
   * Lists schemas registered for dispatch.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @returns The registered event message schemas.
   */
  eventSchemas(eventBus: EventBus): readonly MessageSchema[];

  /**
   * Registers event schemas for dispatch.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param schemas Event message schemas to register.
   */
  registerSchemas(eventBus: EventBus, schemas: Iterable<MessageSchema>): void;

  /**
   * Removes a dispatcher from the bus.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param dispatcher Dispatcher to register or inspect.
   */
  unregister(eventBus: EventBus, dispatcher: EventDispatcher): void;

  /**
   * Finds a registered event schema by type URL.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param typeUrl Fully qualified event message type URL.
   * @returns The matching schema, if registered.
   */
  schema(eventBus: EventBus, typeUrl: string): MessageSchema | undefined;

  /**
   * Stops accepting new external work.
   *
   * @param eventBus Event bus receiving this internal operation.
   */
  beginClose(eventBus: EventBus): void;

  /**
   * Waits for accepted dispatches to settle.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @returns A promise that settles when accepted work drains.
   */
  drain(eventBus: EventBus): Promise<void>;

  /**
   * Completes the bus shutdown.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @returns A promise that settles when shutdown completes.
   */
  finishClose(eventBus: EventBus): Promise<void>;

  /**
   * Restores intake after an aborted shutdown.
   *
   * @param eventBus Event bus receiving this internal operation.
   */
  abortClose(eventBus: EventBus): void;

  /**
   * Returns the number of accepted dispatches still in progress.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @returns The number of accepted dispatches still in progress.
   */
  acceptedWorkCount(eventBus: EventBus): number;

  /**
   * Attaches the server logger to this bus.
   *
   * @param eventBus Event bus receiving this internal operation.
   * @param logger Logger used for bus diagnostics.
   */
  installLogger(eventBus: EventBus, logger: ILogLayer): void;

  /**
   * Removes the server logger from this bus.
   *
   * @param eventBus Event bus receiving this internal operation.
   */
  clearLogger(eventBus: EventBus): void;
}

type EventBusIntakeState = "open" | "closing" | "closed";

/**
 * Small single-process multicast event bus.
 *
 * Public construction creates a domain-only bus that stores domain events and
 * rejects System schemas, dispatchers, and events. Internally assembled
 * forgetting and System buses own no `EventStore` unless explicitly given one.
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
    storedDispatchers.set(this, (event) => this.#postStored(event));
    storedFollowUpDispatchers.set(this, (event) => this.#postStoredFollowUp(event));
    followUpPosters.set(this, (event) => this.#postFollowUp(event));
    savedPreparers.set(this, (event) => this.#prepareSaved(event));
    savedFollowUps.set(this, (event, plan) => this.#postSavedFollowUp(event, plan));
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
    eventBusCloseStarters.set(this, () => {
      this.#beginClose();
    });
    eventBusDrainers.set(this, () => this.#drain());
    eventBusCloseFinishers.set(this, () => this.#finishClose());
    eventBusAborters.set(this, () => {
      this.#abortClose();
    });
    eventBusWorkCounters.set(this, () => this.#acceptedWorkCount);

    for (const dispatcher of dispatchers) {
      this.register(dispatcher);
    }
  }

  /**
   * Registers an event dispatcher.
   *
   * @typeParam Dispatcher Concrete Event dispatcher type returned to the caller.
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
   * Stops accepting new event work, drains accepted work, and closes an owned event store.
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
    const eventStore = this.#eventStore;
    if (eventStore !== undefined) {
      await EventBus.#closePart(() => {
        eventStore.close();
      }, errors);
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "EventBus close failed.");
    }
  }

  #abortClose(): void {
    this.#beginClose();
    try {
      this.#eventStore?.close();
    } finally {
      // spine-log-boundary: server.event_bus_close_runtime
      void this.#started.then(() => this.#runtime.close()).catch(() => undefined);
      this.#intakeState = "closed";
      this.#clearSubscribers();
    }
  }

  async #dispatch(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    const dispatchers = this.#registry.find(typeUrl, event.context?.external === true);

    if (forgettingBuses.has(this)) {
      this.#validate(event, typeUrl);
      const accepted = await this.#accept(event, dispatchers);

      for (const { dispatcher, event: acceptedEvent } of accepted) {
        await dispatcher.dispatch(acceptedEvent);
      }
      this.#notify(event);
      return;
    }

    const eventStore = this.#eventStore;
    if (eventStore === undefined) {
      throw new Error("EventBus requires an EventStore.");
    }

    let acceptedDispatchers: readonly AcceptedEventDispatcher[] = [];
    const stored = await eventStore.acceptThenAppend(event, async (accepted) => {
      this.#validate(accepted, typeUrl);
      acceptedDispatchers = await this.#accept(accepted, dispatchers);
    });

    for (const { dispatcher, event: acceptedEvent } of acceptedDispatchers) {
      await dispatcher.dispatch(acceptedEvent);
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

  async #prepareSaved(event: Event): Promise<AgentSavedDispatchPlan> {
    const typeUrl = event.message?.typeUrl;
    if (!typeUrl) throw new Error("Saved Agent Event requires a registered message type.");
    this.#validate(event, typeUrl);
    const targets = [];
    for (const dispatcher of this.#registry.find(typeUrl, event.context?.external === true)) {
      const binding = SavedDispatcherBindings.forEvent(dispatcher);
      if (binding === undefined)
        throw new Error("Saved Agent Event matches a dispatcher without durable metadata.");
      targets.push(await binding.prepare(clone(EventSchema, event)));
    }
    return create(SavedPlanSchema, { targets });
  }

  #postSavedFollowUp(event: Event, plan: AgentSavedDispatchPlan): Promise<void> {
    const accepted = clone(EventSchema, event);
    const frozen = clone(SavedPlanSchema, plan);
    if (this.#intakeState === "closed")
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    this.#acceptedWorkCount++;
    return this.#started.then(() =>
      runtimeAccess.enqueueFollowUp(this.#runtime, () => this.#dispatchSaved(accepted, frozen)),
    );
  }

  async #dispatchSaved(event: Event, plan: AgentSavedDispatchPlan): Promise<void> {
    const typeUrl = event.message?.typeUrl;
    if (!typeUrl) throw new Error("Saved Agent Event requires a registered message type.");
    this.#validate(event, typeUrl);
    const dispatchers = this.#registry.find(typeUrl, event.context?.external === true);
    const deliveries = await this.#bindSaved(event, plan, dispatchers);
    const store = this.#eventStore;
    if (store === undefined) throw new Error("Saved Agent Event requires an EventStore.");
    await eventStoreAccess.appendOrVerifyOriginal(store, event);
    for (const deliver of deliveries) await deliver();
    this.#notify(event);
  }

  async #bindSaved(
    event: Event,
    plan: AgentSavedDispatchPlan,
    dispatchers: readonly EventDispatcher[],
  ): Promise<readonly (() => Promise<void>)[]> {
    if (dispatchers.length !== plan.targets.length)
      throw new Error("Saved Agent Event dispatcher set changed before delivery.");
    const remaining = new Set(dispatchers);
    const deliveries: (() => Promise<void>)[] = [];
    for (const target of plan.targets) {
      const matches = [...remaining].filter(
        (dispatcher) => SavedDispatcherBindings.forEvent(dispatcher)?.matches(target) === true,
      );
      if (matches.length !== 1)
        throw new Error("Saved Agent Event dispatcher binding is missing or ambiguous.");
      const dispatcher = matches[0];
      if (dispatcher === undefined) throw new Error("Saved Agent Event dispatcher disappeared.");
      remaining.delete(dispatcher);
      const binding = SavedDispatcherBindings.forEvent(dispatcher);
      if (binding === undefined) throw new Error("Saved Agent Event metadata disappeared.");
      deliveries.push(await binding.bind(clone(EventSchema, event), target));
    }
    return deliveries;
  }

  async #dispatchStored(event: Event): Promise<void> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("EventBus requires event.message.typeUrl.");
    }

    const dispatchers = this.#registry.find(typeUrl, event.context?.external === true);
    this.#validate(event, typeUrl);
    const accepted = await this.#accept(event, dispatchers);

    for (const { dispatcher, event: acceptedEvent } of accepted) {
      await dispatcher.dispatch(acceptedEvent);
    }
    this.#notify(event);
  }

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

  #validate(event: Event, typeUrl: string): void {
    const schema = this.#registry.schema(typeUrl);

    if (schema === undefined) {
      throw new Error(`No event schema registered for "${typeUrl}".`);
    }

    EventBusRoles.validateSchema(eventBusRoles.get(this) ?? "domain", schema);

    const message =
      event.message === undefined ? undefined : AnyMessages.unpack(event.message, schema);

    if (message === undefined) {
      throw new Error("Event payload does not match its registered schema.");
    }

    Validate.check(schema, message);
  }

  /**
   * Executes one task after prior accepted bus work settles.
   *
   * @typeParam Result Value returned by the task.
   * @param work Task to serialize with other bus work.
   * @returns The task result after dispatch ordering is respected.
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
    eventBusLoggers.delete(this);
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

  #recordSubscriberFailure(typeUrl: string, logger: ILogLayer | undefined): void {
    if (logger !== undefined) {
      emitServerError(logger, "Event subscriber failed.", {
        eventType: typeUrl,
        operation: "event.subscriber",
        reasonCode: "subscriber_failed",
      });
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

  static #requireEventStore(eventStore: unknown): EventStore | typeof forgettingBus {
    if (eventStore === undefined) {
      throw new TypeError("EventBus requires an EventStore.");
    }

    return eventStore as EventStore | typeof forgettingBus;
  }

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
   * Creates a bus restricted to System event schemas.
   *
   * @param eventStore Optional store for published System events.
   * @param dispatchers Initial System event dispatchers.
   * @returns The configured System event bus.
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
   * Validates every schema accepted by a dispatcher against the bus role.
   *
   * @param role Domain or System role of the bus.
   * @param dispatcher Dispatcher whose schemas are checked.
   */
  validateDispatcher(role: EventBusRole, dispatcher: EventDispatcher): void {
    for (const schema of dispatcher.messageSchemas()) EventBusRoles.validateSchema(role, schema);
  },

  /**
   * Validates a message schema against the bus role.
   *
   * @param role Domain or System role of the bus.
   * @param schema Event message descriptor to check.
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
  clearLogger(eventBus: EventBus): void {
    if (!storedDispatchers.has(eventBus)) {
      throw new TypeError("EventBus logger requires an EventBus instance.");
    }
    eventBusLoggers.delete(eventBus);
  },
  installLogger(eventBus: EventBus, logger: ILogLayer): void {
    if (!storedDispatchers.has(eventBus)) {
      throw new TypeError("EventBus logger requires an EventBus instance.");
    }
    eventBusLoggers.set(eventBus, logger);
  },
  createForgettingBus(dispatchers: Iterable<EventDispatcher> = []): EventBus {
    const eventBus = new EventBus(forgettingBus as never, dispatchers);
    forgettingBuses.add(eventBus);
    return eventBus;
  },

  createSystemBus(
    eventStore: EventStore | undefined,
    dispatchers: Iterable<EventDispatcher> = [],
  ): EventBus {
    return EventBusRoles.createSystem(eventStore, dispatchers);
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

  prepareSaved(eventBus: EventBus, event: Event): Promise<AgentSavedDispatchPlan> {
    const prepare = savedPreparers.get(eventBus);
    if (prepare === undefined) throw new TypeError("Saved Event preparation requires an EventBus.");
    return prepare(event);
  },

  postSavedFollowUp(eventBus: EventBus, event: Event, plan: AgentSavedDispatchPlan): Promise<void> {
    const post = savedFollowUps.get(eventBus);
    if (post === undefined) throw new TypeError("Saved Event delivery requires an EventBus.");
    return post(event, plan);
  },

  /**
   * Executes work in the bus-wide exclusive sequence.
   *
   * @typeParam Result Value returned by serialized work.
   * @param eventBus Bus providing the exclusive sequence.
   * @param work Task to serialize with other bus work.
   * @returns The result returned by the task.
   */
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

    const checked = [...schemas];
    for (const schema of checked) {
      EventBusRoles.validateSchema(eventBusRoles.get(eventBus) ?? "domain", schema);
    }
    registerSchemas(checked);
  },
  unregister(eventBus: EventBus, dispatcher: EventDispatcher): void {
    const unregister = dispatcherUnregistrars.get(eventBus);
    if (unregister === undefined) throw new TypeError("Event dispatcher requires an EventBus.");
    unregister(dispatcher);
  },
  schema(eventBus: EventBus, typeUrl: string): MessageSchema | undefined {
    const schema = eventSchemaFinders.get(eventBus);
    if (schema === undefined) throw new TypeError("Event schema requires an EventBus.");
    return schema(typeUrl);
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
  abortClose(eventBus: EventBus): void {
    const abortClose = eventBusAborters.get(eventBus);
    if (abortClose === undefined)
      throw new TypeError("Event-bus close coordination requires an EventBus instance.");
    abortClose();
  },

  acceptedWorkCount(eventBus: EventBus): number {
    const acceptedWorkCount = eventBusWorkCounters.get(eventBus);

    if (acceptedWorkCount === undefined) {
      throw new TypeError("Event-bus work counting requires an EventBus instance.");
    }

    return acceptedWorkCount();
  },
});
