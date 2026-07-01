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
import type { EntityMetadata } from "./entity-metadata.js";
import {
  compareFullTypeNames,
  copyMetadataArrayMap,
  copyReadinessMetadataFields,
  createReadinessMetadataFields,
} from "./registration-readiness-metadata.js";

const eventRegistrationReadinessToken = Symbol("eventRegistrationReadinessToken");
const authenticEventRegistrationReadiness = new WeakSet<object>();

/** Event subscriber entry exposed by event registration readiness lookups. */
export interface EventRegistrationSubscriberMetadata {
  /** Fully qualified event message type name subscribed to by one entity handler. */
  readonly eventFullTypeName: string;
  /** Entity handler metadata object that declared the event subscriber. */
  readonly entityHandlers: EntityHandlersMetadata;
  /** Entity class that owns the event subscriber method. */
  readonly entityType: EntityClass;
  /** Descriptor-derived entity metadata for the subscriber state type. */
  readonly entity: EntityMetadata;
  /** Event subscription handler metadata declared by the entity. */
  readonly handler: EventSubscriptionHandlerMetadata;
  /** Original registered handler entry from the handler metadata registry. */
  readonly registeredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata>;
}

/** Event reactor entry exposed by event registration readiness lookups. */
export interface EventRegistrationReactorMetadata {
  /** Fully qualified event message type name reacted to by one entity handler. */
  readonly eventFullTypeName: string;
  /** Entity handler metadata object that declared the event reactor. */
  readonly entityHandlers: EntityHandlersMetadata;
  /** Entity class that owns the event reactor method. */
  readonly entityType: EntityClass;
  /** Descriptor-derived entity metadata for the reactor state type. */
  readonly entity: EntityMetadata;
  /** Event reaction handler metadata declared by the entity. */
  readonly handler: EventReactionHandlerMetadata;
  /** Original registered handler entry from the handler metadata registry. */
  readonly registeredHandler: RegisteredHandlerMetadata<EventReactionHandlerMetadata>;
}

/** Event applier entry exposed by event registration readiness lookups. */
export interface EventRegistrationApplicationMetadata {
  /** Fully qualified event message type name applied by one entity handler. */
  readonly eventFullTypeName: string;
  /** Entity state full type name that owns the event applier. */
  readonly entityStateFullTypeName: string;
  /** Entity handler metadata object that declared the event applier. */
  readonly entityHandlers: EntityHandlersMetadata;
  /** Entity class that owns the event applier method. */
  readonly entityType: EntityClass;
  /** Descriptor-derived entity metadata for the applier state type. */
  readonly entity: EntityMetadata;
  /** Event application handler metadata declared by the entity. */
  readonly handler: EventApplicationHandlerMetadata;
  /** Original registered handler entry from the handler metadata registry. */
  readonly registeredHandler: RegisteredHandlerMetadata<EventApplicationHandlerMetadata>;
}

/** Read-only event registration readiness lookup surface. */
export interface EventRegistrationReadinessLookup {
  /** Return registered event message full type names in deterministic order. */
  registeredEventMessageFullTypeNames(): readonly string[];
  /** Return event subscriber metadata for an event message type in registry order. */
  findEventSubscribers(eventFullTypeName: string): readonly EventRegistrationSubscriberMetadata[];
  /** Return event reactor metadata for an event message type in registry order. */
  findEventReactors(eventFullTypeName: string): readonly EventRegistrationReactorMetadata[];
  /** Return event applier metadata for an event message type in registry order. */
  findEventApplications(eventFullTypeName: string): readonly EventRegistrationApplicationMetadata[];
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
  readonly #subscribersByEventFullTypeName: ReadonlyMap<
    string,
    readonly EventRegistrationSubscriberMetadata[]
  >;
  readonly #reactorsByEventFullTypeName: ReadonlyMap<
    string,
    readonly EventRegistrationReactorMetadata[]
  >;
  readonly #applicationsByEventFullTypeName: ReadonlyMap<
    string,
    readonly EventRegistrationApplicationMetadata[]
  >;

  private constructor(
    authenticityToken: typeof eventRegistrationReadinessToken,
    eventFullTypeNames: readonly string[],
    subscribersByEventFullTypeName: ReadonlyMap<
      string,
      readonly EventRegistrationSubscriberMetadata[]
    >,
    reactorsByEventFullTypeName: ReadonlyMap<string, readonly EventRegistrationReactorMetadata[]>,
    applicationsByEventFullTypeName: ReadonlyMap<
      string,
      readonly EventRegistrationApplicationMetadata[]
    >,
  ) {
    if (authenticityToken !== eventRegistrationReadinessToken) {
      throw new TypeError(
        "EventRegistrationReadiness instances must be created by the package factory methods.",
      );
    }

    this.#eventFullTypeNames = Object.freeze([...eventFullTypeNames]);
    this.#subscribersByEventFullTypeName = copyMetadataArrayMap(subscribersByEventFullTypeName);
    this.#reactorsByEventFullTypeName = copyMetadataArrayMap(reactorsByEventFullTypeName);
    this.#applicationsByEventFullTypeName = copyMetadataArrayMap(applicationsByEventFullTypeName);
    authenticEventRegistrationReadiness.add(this);
    Object.freeze(this);
  }

  /** Build readiness from an already validated handler metadata registry lookup. */
  static fromRegistry(registry: HandlerMetadataRegistryLookup): EventRegistrationReadiness {
    const validatedRegistry = new HandlerMetadataRegistry(registry.listEntityHandlers());
    const eventFullTypeNames = new Set<string>();
    const subscribersByEventFullTypeName = new Map<string, EventRegistrationSubscriberMetadata[]>();
    const reactorsByEventFullTypeName = new Map<string, EventRegistrationReactorMetadata[]>();
    const applicationsByEventFullTypeName = new Map<
      string,
      EventRegistrationApplicationMetadata[]
    >();

    for (const entry of validatedRegistry.findHandlersByKind("event-subscription")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      pushMapValue(
        subscribersByEventFullTypeName,
        eventFullTypeName,
        createSubscriberMetadata(eventFullTypeName, entry),
      );
    }

    for (const entry of validatedRegistry.findHandlersByKind("event-reaction")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      pushMapValue(
        reactorsByEventFullTypeName,
        eventFullTypeName,
        createReactorMetadata(eventFullTypeName, entry),
      );
    }

    for (const entry of validatedRegistry.findHandlersByKind("event-application")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      pushMapValue(
        applicationsByEventFullTypeName,
        eventFullTypeName,
        createApplicationMetadata(eventFullTypeName, entry),
      );
    }

    return new EventRegistrationReadiness(
      eventRegistrationReadinessToken,
      [...eventFullTypeNames].sort(compareFullTypeNames),
      subscribersByEventFullTypeName,
      reactorsByEventFullTypeName,
      applicationsByEventFullTypeName,
    );
  }

  /**
   * Build readiness from entity handler metadata.
   *
   * Duplicate event application validation is intentionally delegated to
   * `HandlerMetadataRegistry`. Subscriber and reactor fan-out is retained.
   */
  static fromEntityHandlers(
    entityHandlers: Iterable<EntityHandlersMetadata>,
  ): EventRegistrationReadiness {
    return EventRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry(entityHandlers));
  }

  /** Return registered event message full type names in deterministic order. */
  registeredEventMessageFullTypeNames(): readonly string[] {
    return Object.freeze([...this.#eventFullTypeNames]);
  }

  /** Return event subscriber metadata for an event message type in registry order. */
  findEventSubscribers(eventFullTypeName: string): readonly EventRegistrationSubscriberMetadata[] {
    return Object.freeze(
      (this.#subscribersByEventFullTypeName.get(eventFullTypeName) ?? []).map(
        copySubscriberMetadata,
      ),
    );
  }

  /** Return event reactor metadata for an event message type in registry order. */
  findEventReactors(eventFullTypeName: string): readonly EventRegistrationReactorMetadata[] {
    return Object.freeze(
      (this.#reactorsByEventFullTypeName.get(eventFullTypeName) ?? []).map(copyReactorMetadata),
    );
  }

  /** Return event applier metadata for an event message type in registry order. */
  findEventApplications(
    eventFullTypeName: string,
  ): readonly EventRegistrationApplicationMetadata[] {
    return Object.freeze(
      (this.#applicationsByEventFullTypeName.get(eventFullTypeName) ?? []).map(
        copyApplicationMetadata,
      ),
    );
  }
}

export function isAuthenticEventRegistrationReadiness(
  value: unknown,
): value is EventRegistrationReadiness {
  return value !== null && typeof value === "object" && authenticEventRegistrationReadiness.has(value);
}

function createSubscriberMetadata(
  eventFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata>,
): EventRegistrationSubscriberMetadata {
  const fields = createReadinessMetadataFields(registeredHandler);

  return Object.freeze({
    eventFullTypeName,
    ...fields,
  });
}

function copySubscriberMetadata(
  subscriber: EventRegistrationSubscriberMetadata,
): EventRegistrationSubscriberMetadata {
  const fields = copyReadinessMetadataFields(subscriber.registeredHandler);

  return Object.freeze({
    eventFullTypeName: subscriber.eventFullTypeName,
    ...fields,
  });
}

function createReactorMetadata(
  eventFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<EventReactionHandlerMetadata>,
): EventRegistrationReactorMetadata {
  const fields = createReadinessMetadataFields(registeredHandler);

  return Object.freeze({
    eventFullTypeName,
    ...fields,
  });
}

function copyReactorMetadata(
  reactor: EventRegistrationReactorMetadata,
): EventRegistrationReactorMetadata {
  const fields = copyReadinessMetadataFields(reactor.registeredHandler);

  return Object.freeze({
    eventFullTypeName: reactor.eventFullTypeName,
    ...fields,
  });
}

function createApplicationMetadata(
  eventFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<EventApplicationHandlerMetadata>,
): EventRegistrationApplicationMetadata {
  const fields = createReadinessMetadataFields(registeredHandler);

  return Object.freeze({
    eventFullTypeName,
    entityStateFullTypeName: fields.entity.fullTypeName,
    ...fields,
  });
}

function copyApplicationMetadata(
  application: EventRegistrationApplicationMetadata,
): EventRegistrationApplicationMetadata {
  const fields = copyReadinessMetadataFields(application.registeredHandler);

  return Object.freeze({
    eventFullTypeName: application.eventFullTypeName,
    entityStateFullTypeName: application.entityStateFullTypeName,
    ...fields,
  });
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key);

  if (values === undefined) {
    map.set(key, [value]);
    return;
  }

  values.push(value);
}
