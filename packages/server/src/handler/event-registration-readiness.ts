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

import {
  HandlerMetadataRegistry,
  type EntityClass,
  type EntityHandlersMetadata,
  type EventApplicationHandlerMetadata,
  type EventReactionHandlerMetadata,
  type EventSubscriptionHandlerMetadata,
  type HandlerMetadataRegistryLookup,
  type RegisteredHandlerMetadata,
} from "./handler-metadata.js";
import type { EntityMetadata } from "../entity/entity-metadata.js";
import { ReadinessMetadata } from "./registration-readiness-metadata.js";

const eventRegistrationReadinessToken = Symbol("eventRegistrationReadinessToken");
const authenticEventRegistrationReadiness = new WeakSet<object>();

/**
 * Event subscriber entry exposed by event registration readiness lookups.
 */
export interface EventRegistrationSubscriberMetadata {
  // prettier-ignore

  /**
   * Fully qualified event message type name subscribed to by one entity handler.
   */
  readonly eventFullTypeName: string;

  /**
   * Entity handler metadata object that declared the event subscriber.
   */
  readonly entityHandlers: EntityHandlersMetadata;

  /**
   * Entity class that owns the event subscriber method.
   */
  readonly entityType: EntityClass;

  /**
   * Descriptor-derived entity metadata for the subscriber state type.
   */
  readonly entity: EntityMetadata;

  /**
   * Event subscription handler metadata declared by the entity.
   */
  readonly handler: EventSubscriptionHandlerMetadata;

  /**
   * Original registered handler entry from the handler metadata registry.
   */
  readonly registeredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata>;
}

/**
 * Event reactor entry exposed by event registration readiness lookups.
 */
export interface EventRegistrationReactorMetadata {
  // prettier-ignore

  /**
   * Fully qualified event message type name reacted to by one entity handler.
   */
  readonly eventFullTypeName: string;

  /**
   * Entity handler metadata object that declared the event reactor.
   */
  readonly entityHandlers: EntityHandlersMetadata;

  /**
   * Entity class that owns the event reactor method.
   */
  readonly entityType: EntityClass;

  /**
   * Descriptor-derived entity metadata for the reactor state type.
   */
  readonly entity: EntityMetadata;

  /**
   * Event reaction handler metadata declared by the entity.
   */
  readonly handler: EventReactionHandlerMetadata;

  /**
   * Original registered handler entry from the handler metadata registry.
   */
  readonly registeredHandler: RegisteredHandlerMetadata<EventReactionHandlerMetadata>;
}

/**
 * Event applier entry exposed by event registration readiness lookups.
 */
export interface EventRegistrationApplicationMetadata {
  // prettier-ignore

  /**
   * Fully qualified event message type name applied by one entity handler.
   */
  readonly eventFullTypeName: string;

  /**
   * Entity state full type name that owns the event applier.
   */
  readonly stateTypeName: string;

  /**
   * Entity handler metadata object that declared the event applier.
   */
  readonly entityHandlers: EntityHandlersMetadata;

  /**
   * Entity class that owns the event applier method.
   */
  readonly entityType: EntityClass;

  /**
   * Descriptor-derived entity metadata for the applier state type.
   */
  readonly entity: EntityMetadata;

  /**
   * Event application handler metadata declared by the entity.
   */
  readonly handler: EventApplicationHandlerMetadata;

  /**
   * Original registered handler entry from the handler metadata registry.
   */
  readonly registeredHandler: RegisteredHandlerMetadata<EventApplicationHandlerMetadata>;
}

/**
 * Read-only event registration readiness lookup surface.
 */
export interface EventRegistrationReadinessLookup {
  // prettier-ignore

  /**
   * Returns registered event message type names in deterministic order.
   *
   * @returns A fresh frozen list of event message type names.
   */
  eventTypeNames(): readonly string[];

  /**
   * Finds subscriber metadata for an event message type in registry order.
   *
   * @param eventTypeName Fully qualified event message type name.
   * @returns A fresh frozen list of subscriber metadata.
   */
  findEventSubscribers(eventTypeName: string): readonly EventRegistrationSubscriberMetadata[];

  /**
   * Finds reactor metadata for an event message type in registry order.
   *
   * @param eventTypeName Fully qualified event message type name.
   * @returns A fresh frozen list of reactor metadata.
   */
  findEventReactors(eventTypeName: string): readonly EventRegistrationReactorMetadata[];

  /**
   * Finds applier metadata for an event message type in registry order.
   *
   * @param eventTypeName Fully qualified event message type name.
   * @returns A fresh frozen list of applier metadata.
   */
  findEventApplications(eventTypeName: string): readonly EventRegistrationApplicationMetadata[];
}

/**
 * Metadata-only event registration readiness derived from handler metadata.
 *
 * The surface mirrors the JVM event-dispatcher registration shape only far
 * enough for later runtime slices to ask which event message types have
 * subscribers, reactors, or appliers. Subscribers and reactors intentionally
 * preserve Spine fan-out semantics by returning all registered receivers for
 * the event type. Event applier duplicate policy remains owned by
 * `HandlerMetadataRegistry`, where uniqueness is per entity state and event
 * type. The current TypeScript handler metadata does not identify external
 * events, so domestic/external event classification is deferred.
 *
 * This surface does not publish, route, dispatch, invoke, store, import,
 * deliver, subscribe to command results, or acknowledge events.
 */
export class EventRegistrationReadiness implements EventRegistrationReadinessLookup {
  readonly #eventFullTypeNames: readonly string[];
  readonly #subscribersByTypeName: ReadonlyMap<
    string,
    readonly EventRegistrationSubscriberMetadata[]
  >;
  readonly #reactorsByTypeName: ReadonlyMap<string, readonly EventRegistrationReactorMetadata[]>;
  readonly #applicationsByTypeName: ReadonlyMap<
    string,
    readonly EventRegistrationApplicationMetadata[]
  >;

  private constructor(
    authenticityToken: typeof eventRegistrationReadinessToken,
    eventFullTypeNames: readonly string[],
    subscribersByTypeName: ReadonlyMap<string, readonly EventRegistrationSubscriberMetadata[]>,
    reactorsByTypeName: ReadonlyMap<string, readonly EventRegistrationReactorMetadata[]>,
    applicationsByTypeName: ReadonlyMap<string, readonly EventRegistrationApplicationMetadata[]>,
  ) {
    if (authenticityToken !== eventRegistrationReadinessToken) {
      throw new TypeError(
        "EventRegistrationReadiness instances must be created by the package factory methods.",
      );
    }

    this.#eventFullTypeNames = Object.freeze([...eventFullTypeNames]);
    this.#subscribersByTypeName = ReadinessMetadata.copyMap(subscribersByTypeName);
    this.#reactorsByTypeName = ReadinessMetadata.copyMap(reactorsByTypeName);
    this.#applicationsByTypeName = ReadinessMetadata.copyMap(applicationsByTypeName);
    authenticEventRegistrationReadiness.add(this);
    Object.freeze(this);
  }

  /**
   * Builds readiness from an already validated handler metadata registry lookup.
   *
   * @param registry Source of entity handler metadata.
   * @returns Frozen event registration readiness.
   */
  static fromRegistry(registry: HandlerMetadataRegistryLookup): EventRegistrationReadiness {
    const validatedRegistry = new HandlerMetadataRegistry(registry.listEntityHandlers());
    const eventFullTypeNames = new Set<string>();
    const subscribersByTypeName = new Map<string, EventRegistrationSubscriberMetadata[]>();
    const reactorsByTypeName = new Map<string, EventRegistrationReactorMetadata[]>();
    const applicationsByTypeName = new Map<string, EventRegistrationApplicationMetadata[]>();

    for (const entry of validatedRegistry.findHandlersByKind("event-subscription")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      EventRegistrationReadiness.#push(
        subscribersByTypeName,
        eventFullTypeName,
        EventRegistrationReadiness.#createSubscriber(eventFullTypeName, entry),
      );
    }

    for (const entry of validatedRegistry.findHandlersByKind("event-reaction")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      EventRegistrationReadiness.#push(
        reactorsByTypeName,
        eventFullTypeName,
        EventRegistrationReadiness.#createReactor(eventFullTypeName, entry),
      );
    }

    for (const entry of validatedRegistry.findHandlersByKind("event-application")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      EventRegistrationReadiness.#push(
        applicationsByTypeName,
        eventFullTypeName,
        EventRegistrationReadiness.#createApplication(eventFullTypeName, entry),
      );
    }

    return new EventRegistrationReadiness(
      eventRegistrationReadinessToken,
      [...eventFullTypeNames].sort((left, right) =>
        ReadinessMetadata.compareTypeNames(left, right),
      ),
      subscribersByTypeName,
      reactorsByTypeName,
      applicationsByTypeName,
    );
  }

  /**
   * Builds readiness from entity handler metadata.
   *
   * Duplicate event application validation is intentionally delegated to
   * `HandlerMetadataRegistry`. Subscriber and reactor fan-out is retained.
   *
   * @param entityHandlers Entity handler metadata to validate and index.
   * @returns Frozen event registration readiness.
   */
  static fromEntityHandlers(
    entityHandlers: Iterable<EntityHandlersMetadata>,
  ): EventRegistrationReadiness {
    return EventRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry(entityHandlers));
  }

  /**
   * Returns registered event message type names in deterministic order.
   *
   * @returns A fresh frozen list of event message type names.
   */
  eventTypeNames(): readonly string[] {
    return Object.freeze([...this.#eventFullTypeNames]);
  }

  /**
   * Finds subscriber metadata for an event message type in registry order.
   *
   * @param eventTypeName Fully qualified event message type name.
   * @returns A fresh frozen list of subscriber metadata.
   */
  findEventSubscribers(eventTypeName: string): readonly EventRegistrationSubscriberMetadata[] {
    return Object.freeze(
      (this.#subscribersByTypeName.get(eventTypeName) ?? []).map((subscriber) =>
        EventRegistrationReadiness.#copySubscriber(subscriber),
      ),
    );
  }

  /**
   * Finds reactor metadata for an event message type in registry order.
   *
   * @param eventTypeName Fully qualified event message type name.
   * @returns A fresh frozen list of reactor metadata.
   */
  findEventReactors(eventTypeName: string): readonly EventRegistrationReactorMetadata[] {
    return Object.freeze(
      (this.#reactorsByTypeName.get(eventTypeName) ?? []).map((reactor) =>
        EventRegistrationReadiness.#copyReactor(reactor),
      ),
    );
  }

  /**
   * Finds applier metadata for an event message type in registry order.
   *
   * @param eventTypeName Fully qualified event message type name.
   * @returns A fresh frozen list of applier metadata.
   */
  findEventApplications(eventTypeName: string): readonly EventRegistrationApplicationMetadata[] {
    return Object.freeze(
      (this.#applicationsByTypeName.get(eventTypeName) ?? []).map((application) =>
        EventRegistrationReadiness.#copyApplication(application),
      ),
    );
  }

  /**
   * Checks whether a value was created by this module's readiness factories.
   *
   * @param value Value to test for readiness authenticity.
   * @returns `true` when the value is an authentic event registration readiness instance.
   */
  static isAuthentic(value: unknown): value is EventRegistrationReadiness {
    return (
      value !== null && typeof value === "object" && authenticEventRegistrationReadiness.has(value)
    );
  }

  static #createSubscriber(
    eventFullTypeName: string,
    registeredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata>,
  ): EventRegistrationSubscriberMetadata {
    const fields = ReadinessMetadata.create(registeredHandler);

    return Object.freeze({
      eventFullTypeName,
      ...fields,
    });
  }

  static #copySubscriber(
    subscriber: EventRegistrationSubscriberMetadata,
  ): EventRegistrationSubscriberMetadata {
    const fields = ReadinessMetadata.copy(subscriber.registeredHandler);

    return Object.freeze({
      eventFullTypeName: subscriber.eventFullTypeName,
      ...fields,
    });
  }

  static #createReactor(
    eventFullTypeName: string,
    registeredHandler: RegisteredHandlerMetadata<EventReactionHandlerMetadata>,
  ): EventRegistrationReactorMetadata {
    const fields = ReadinessMetadata.create(registeredHandler);

    return Object.freeze({
      eventFullTypeName,
      ...fields,
    });
  }

  static #copyReactor(reactor: EventRegistrationReactorMetadata): EventRegistrationReactorMetadata {
    const fields = ReadinessMetadata.copy(reactor.registeredHandler);

    return Object.freeze({
      eventFullTypeName: reactor.eventFullTypeName,
      ...fields,
    });
  }

  static #createApplication(
    eventFullTypeName: string,
    registeredHandler: RegisteredHandlerMetadata<EventApplicationHandlerMetadata>,
  ): EventRegistrationApplicationMetadata {
    const fields = ReadinessMetadata.create(registeredHandler);

    return Object.freeze({
      eventFullTypeName,
      stateTypeName: fields.entity.fullTypeName,
      ...fields,
    });
  }

  static #copyApplication(
    application: EventRegistrationApplicationMetadata,
  ): EventRegistrationApplicationMetadata {
    const fields = ReadinessMetadata.copy(application.registeredHandler);

    return Object.freeze({
      eventFullTypeName: application.eventFullTypeName,
      stateTypeName: application.stateTypeName,
      ...fields,
    });
  }

  static #push<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
    const values = map.get(key);

    if (values === undefined) {
      map.set(key, [value]);
      return;
    }

    values.push(value);
  }
}
