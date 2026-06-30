import {
  HandlerMetadataRegistry,
  type EntityClass,
  type EntityHandlersMetadata,
  type EventApplicationHandlerMetadata,
  type EventReactionHandlerMetadata,
  type EventSubscriptionHandlerMetadata,
  type HandlerMetadata,
  type HandlerMetadataRegistryLookup,
  type RegisteredHandlerMetadata,
} from "./handler-metadata.js";
import type { EntityMetadata } from "./entity-metadata.js";

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
    this.#eventFullTypeNames = Object.freeze([...eventFullTypeNames]);
    this.#subscribersByEventFullTypeName = copyMetadataArrayMap(subscribersByEventFullTypeName);
    this.#reactorsByEventFullTypeName = copyMetadataArrayMap(reactorsByEventFullTypeName);
    this.#applicationsByEventFullTypeName = copyMetadataArrayMap(applicationsByEventFullTypeName);
    Object.freeze(this);
  }

  /** Build readiness from an already validated handler metadata registry lookup. */
  static fromRegistry(registry: HandlerMetadataRegistryLookup): EventRegistrationReadiness {
    const eventFullTypeNames = new Set<string>();
    const subscribersByEventFullTypeName = new Map<string, EventRegistrationSubscriberMetadata[]>();
    const reactorsByEventFullTypeName = new Map<string, EventRegistrationReactorMetadata[]>();
    const applicationsByEventFullTypeName = new Map<
      string,
      EventRegistrationApplicationMetadata[]
    >();

    for (const entry of registry.findHandlersByKind("event-subscription")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      pushMapValue(
        subscribersByEventFullTypeName,
        eventFullTypeName,
        createSubscriberMetadata(eventFullTypeName, entry),
      );
    }

    for (const entry of registry.findHandlersByKind("event-reaction")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      pushMapValue(
        reactorsByEventFullTypeName,
        eventFullTypeName,
        createReactorMetadata(eventFullTypeName, entry),
      );
    }

    for (const entry of registry.findHandlersByKind("event-application")) {
      const eventFullTypeName = entry.handler.messageFullTypeName;

      eventFullTypeNames.add(eventFullTypeName);
      pushMapValue(
        applicationsByEventFullTypeName,
        eventFullTypeName,
        createApplicationMetadata(eventFullTypeName, entry),
      );
    }

    return new EventRegistrationReadiness(
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

function compareFullTypeNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function createSubscriberMetadata(
  eventFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata>,
): EventRegistrationSubscriberMetadata {
  const clonedHandlers = new Map<HandlerMetadata, HandlerMetadata>();
  const handler = cloneHandlerMetadata(registeredHandler.handler, clonedHandlers);
  const entity = cloneEntityMetadata(registeredHandler.entity);
  const entityHandlers = cloneEntityHandlers(
    registeredHandler.entityHandlers,
    clonedHandlers,
    entity,
  );
  const registeredHandlerCopy: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata> =
    Object.freeze({
      entityHandlers,
      entityType: registeredHandler.entityType,
      entity,
      handler,
    });

  return Object.freeze({
    eventFullTypeName,
    entityHandlers,
    entityType: registeredHandler.entityType,
    entity,
    handler,
    registeredHandler: registeredHandlerCopy,
  });
}

function copySubscriberMetadata(
  subscriber: EventRegistrationSubscriberMetadata,
): EventRegistrationSubscriberMetadata {
  return createSubscriberMetadata(subscriber.eventFullTypeName, subscriber.registeredHandler);
}

function createReactorMetadata(
  eventFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<EventReactionHandlerMetadata>,
): EventRegistrationReactorMetadata {
  const clonedHandlers = new Map<HandlerMetadata, HandlerMetadata>();
  const handler = cloneHandlerMetadata(registeredHandler.handler, clonedHandlers);
  const entity = cloneEntityMetadata(registeredHandler.entity);
  const entityHandlers = cloneEntityHandlers(
    registeredHandler.entityHandlers,
    clonedHandlers,
    entity,
  );
  const registeredHandlerCopy: RegisteredHandlerMetadata<EventReactionHandlerMetadata> =
    Object.freeze({
      entityHandlers,
      entityType: registeredHandler.entityType,
      entity,
      handler,
    });

  return Object.freeze({
    eventFullTypeName,
    entityHandlers,
    entityType: registeredHandler.entityType,
    entity,
    handler,
    registeredHandler: registeredHandlerCopy,
  });
}

function copyReactorMetadata(
  reactor: EventRegistrationReactorMetadata,
): EventRegistrationReactorMetadata {
  return createReactorMetadata(reactor.eventFullTypeName, reactor.registeredHandler);
}

function createApplicationMetadata(
  eventFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<EventApplicationHandlerMetadata>,
): EventRegistrationApplicationMetadata {
  const clonedHandlers = new Map<HandlerMetadata, HandlerMetadata>();
  const handler = cloneHandlerMetadata(registeredHandler.handler, clonedHandlers);
  const entity = cloneEntityMetadata(registeredHandler.entity);
  const entityHandlers = cloneEntityHandlers(
    registeredHandler.entityHandlers,
    clonedHandlers,
    entity,
  );
  const registeredHandlerCopy: RegisteredHandlerMetadata<EventApplicationHandlerMetadata> =
    Object.freeze({
      entityHandlers,
      entityType: registeredHandler.entityType,
      entity,
      handler,
    });

  return Object.freeze({
    eventFullTypeName,
    entityStateFullTypeName: entity.fullTypeName,
    entityHandlers,
    entityType: registeredHandler.entityType,
    entity,
    handler,
    registeredHandler: registeredHandlerCopy,
  });
}

function copyApplicationMetadata(
  application: EventRegistrationApplicationMetadata,
): EventRegistrationApplicationMetadata {
  return createApplicationMetadata(application.eventFullTypeName, application.registeredHandler);
}

function cloneEntityHandlers(
  entityHandlers: EntityHandlersMetadata,
  clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
  entity: EntityMetadata,
): EntityHandlersMetadata {
  return Object.freeze({
    entityType: entityHandlers.entityType,
    entity,
    handlers: Object.freeze(
      entityHandlers.handlers.map((handler) => cloneHandlerMetadata(handler, clonedHandlers)),
    ),
    commandAssignments: Object.freeze(
      entityHandlers.commandAssignments.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
    commandReactions: Object.freeze(
      entityHandlers.commandReactions.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
    eventSubscriptions: Object.freeze(
      entityHandlers.eventSubscriptions.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
    eventReactions: Object.freeze(
      entityHandlers.eventReactions.map((handler) => cloneHandlerMetadata(handler, clonedHandlers)),
    ),
    eventApplications: Object.freeze(
      entityHandlers.eventApplications.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
  });
}

function cloneHandlerMetadata<Handler extends HandlerMetadata>(
  handler: Handler,
  clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
): Handler {
  const existing = clonedHandlers.get(handler);

  if (existing !== undefined) {
    return existing as Handler;
  }

  const clone = Object.freeze({ ...handler }) as unknown as Handler;

  clonedHandlers.set(handler, clone);
  return clone;
}

function cloneEntityMetadata(entity: EntityMetadata): EntityMetadata {
  return Object.freeze({
    ...entity,
    idField: Object.freeze({ ...entity.idField }),
    firstFieldRoutingHint: Object.freeze({
      ...entity.firstFieldRoutingHint,
      field: Object.freeze({ ...entity.firstFieldRoutingHint.field }),
    }),
    columns: Object.freeze(entity.columns.map((field) => Object.freeze({ ...field }))),
    setOnceFields: Object.freeze(entity.setOnceFields.map((field) => Object.freeze({ ...field }))),
    semanticTags: Object.freeze([...entity.semanticTags]),
  });
}

function copyMetadataArrayMap<Value>(
  map: ReadonlyMap<string, readonly Value[]>,
): ReadonlyMap<string, readonly Value[]> {
  const copy = new Map<string, readonly Value[]>();

  for (const [key, values] of map) {
    copy.set(key, Object.freeze([...values]));
  }

  return copy;
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key);

  if (values === undefined) {
    map.set(key, [value]);
    return;
  }

  values.push(value);
}
