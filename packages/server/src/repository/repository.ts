import { clone, create } from "@bufbuild/protobuf";
import { deriveTypeUrl, packAny, unpackAny, type MessageSchema } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandIdSchema,
  EventContextSchema,
  EventSchema,
  type Command,
  type Event,
  MessageIdSchema,
  OriginSchema,
  type TenantId,
  type Version,
  VersionSchema,
} from "@spine-ts/proto";
import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import {
  Aggregate,
  type Entity,
  ProcessManager,
  Projection,
  type EntityFamily,
} from "../entity/entity.js";
import {
  describeEntityMetadata,
  type DescriptorFieldMetadata,
  type DescriptorMessageSchema,
  type EntityMetadata,
  type FirstFieldRoutingHint,
} from "../entity/entity-metadata.js";
import {
  CommandRegistrationReadiness,
  type CommandRegistrationReadinessLookup,
} from "../handler/command-registration-readiness.js";
import {
  EventRegistrationReadiness,
  type EventRegistrationReadinessLookup,
} from "../handler/event-registration-readiness.js";
import { handlerMetadataAccess, type EntityHandlersMetadata } from "../handler/handler-metadata.js";
import { AggregateStorage } from "./aggregate-storage.js";
import { PrimitiveIds } from "./primitive-id.js";
import type { Stand } from "../stand/stand.js";

type RepositoryEntityInstance<Schema extends DescriptorMessageSchema = DescriptorMessageSchema> =
  | Aggregate<unknown, Schema, unknown>
  | Projection<unknown, Schema, unknown>
  | ProcessManager<unknown, Schema, unknown>;

/** Generated Protobuf-ES state schema carried by a repository entity constructor. */
export type RepositoryStateSchema<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Aggregate<infer Id, infer Schema, infer Version>
    ? [Id, Version] extends [unknown, unknown]
      ? Schema
      : never
    : EntityType["prototype"] extends Projection<infer Id, infer Schema, infer Version>
      ? [Id, Version] extends [unknown, unknown]
        ? Schema
        : never
      : EntityType["prototype"] extends ProcessManager<infer Id, infer Schema, infer Version>
        ? [Id, Version] extends [unknown, unknown]
          ? Schema
          : never
        : never;

type RepositoryEntityId<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Aggregate<infer Id, DescriptorMessageSchema, unknown>
    ? Id
    : EntityType["prototype"] extends Projection<infer Id, DescriptorMessageSchema, unknown>
      ? Id
      : EntityType["prototype"] extends ProcessManager<infer Id, DescriptorMessageSchema, unknown>
        ? Id
        : never;

type RepositoryHandlers<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends infer Instance extends object
    ? EntityHandlersMetadata<Instance, RepositoryStateSchema<EntityType>>
    : never;

type RepositoryHandlersOptionFor<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Aggregate<unknown, DescriptorMessageSchema, infer Version>
    ? [Version] extends [bigint]
      ? RepositoryHandlers<EntityType> | readonly RepositoryHandlers<EntityType>[]
      : never
    : EntityType["prototype"] extends Projection<unknown, DescriptorMessageSchema, infer Version>
      ? [Version] extends [number]
        ? RepositoryHandlers<EntityType> | readonly RepositoryHandlers<EntityType>[]
        : never
      : RepositoryHandlers<EntityType> | readonly RepositoryHandlers<EntityType>[];

type IsUnion<Type, Union = Type> = Type extends unknown
  ? [Union] extends [Type]
    ? false
    : true
  : false;

/**
 * Single concrete entity constructor accepted by repository identity metadata.
 *
 * Concrete aggregate, projection, and process-manager classes satisfy this type naturally. Broad
 * constructor aliases, constructor unions, broad state schemas, and state-schema unions are
 * rejected so repository identities cannot erase which state schema the entity owns.
 */
export type ConcreteRepositoryEntityType<EntityType extends RepositoryEntityType> =
  IsUnion<EntityType> extends true
    ? never
    : RepositoryEntityType extends EntityType
      ? never
      : [ConstructorParameters<EntityType>] extends [never[]]
        ? never
        : IsUnion<RepositoryStateSchema<EntityType>> extends true
          ? never
          : DescriptorMessageSchema extends RepositoryStateSchema<EntityType>
            ? never
            : unknown;

interface RuntimeRepositoryEntityType {
  readonly prototype: object;
  readonly name: string;
}

/** Entity constructor value accepted by repository identity metadata. */
export type RepositoryEntityType<
  Instance extends RepositoryEntityInstance = RepositoryEntityInstance,
> = (abstract new (...args: never[]) => Instance) &
  // `any` erases the Entity constructor parameters while preserving its protected static origin.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof Entity<any, DescriptorMessageSchema, any> & {
    /** Prototype inspected for built-in entity family marker inheritance. */
    readonly prototype: Instance;
    /** Constructor name used in structured diagnostics. */
    readonly name: string;
  };

/**
 * Options for constructing repository identity and context-owned registration.
 *
 * @typeParam EntityType - A single concrete aggregate, projection, or process-manager constructor.
 * The constructor's prototype must carry one concrete generated state schema; broad constructor,
 * constructor-union, broad-schema, and schema-union bindings are rejected at compile time.
 */
export interface RepositoryOptions<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
> {
  /** Entity constructor owned by this repository identity. */
  readonly entityType: EntityType;
  /** Generated Protobuf-ES schema for the entity state owned by this repository identity. */
  readonly schema: RepositoryStateSchema<EntityType>;
  /**
   * Explicit handler metadata used to register repository command and event routing.
   *
   * Aggregate repositories with handlers can be executed by built bounded contexts and therefore
   * must use `bigint` version metadata, matching the persisted aggregate history version type.
   * Projection repositories with handlers can be executed by built bounded contexts and therefore
   * must use `number` version metadata, matching the protobuf event version carried into Stand.
   */
  readonly handlers?: RepositoryHandlersOptionFor<EntityType>;
}

/**
 * Immutable copy-safe repository identity snapshot.
 *
 * @typeParam EntityType - The concrete entity constructor owned by the repository. The snapshot's
 * state schema and metadata are derived from this constructor so callers cannot spell an impossible
 * entity/schema snapshot pair.
 */
export interface RepositoryIdentitySnapshot<
  EntityType extends RepositoryEntityType = RepositoryEntityType,
> {
  /** Entity constructor owned by the repository. */
  readonly entityType: EntityType;
  /** Entity family inferred from the constructor's built-in family marker base class. */
  readonly entityFamily: EntityFamily;
  /** Generated Protobuf-ES schema for the owned entity state. */
  readonly stateSchema: RepositoryStateSchema<EntityType>;
  /** Descriptor-derived metadata for the owned entity state. */
  readonly metadata: EntityMetadata<RepositoryStateSchema<EntityType>>;
  /** Fully qualified Protobuf type name of the owned entity state. */
  readonly stateFullTypeName: RepositoryStateSchema<EntityType>["typeName"];
  /** Canonical entity ID field copied from descriptor-derived metadata. */
  readonly idField: DescriptorFieldMetadata;
}

/** Public read view of a repository registered with a bounded context. */
export interface RepositoryView {
  /** Entity constructor owned by the repository. */
  readonly entityType: RepositoryEntityType;
  /** Entity family inferred from the constructor's built-in family marker base class. */
  readonly entityFamily: EntityFamily;
  /** Generated Protobuf-ES schema for the owned entity state. */
  readonly stateSchema: DescriptorMessageSchema;
  /** Descriptor-derived metadata for the owned entity state. */
  readonly metadata: EntityMetadata;
  /** Fully qualified Protobuf type name of the owned entity state. */
  readonly stateFullTypeName: string;
  /** Canonical entity ID field copied from descriptor-derived metadata. */
  readonly idField: DescriptorFieldMetadata;
  /** Copy-safe immutable identity snapshot for duplicate/conflict checks. */
  readonly snapshot: RepositoryIdentitySnapshot;
}

/** Machine-readable codes for repository identity failures. */
export type RepositoryIdentityErrorCode = "ENTITY_SCHEMA_KIND_MISMATCH" | "UNSUPPORTED_ENTITY_TYPE";

/** Error thrown when repository identity metadata cannot be constructed. */
export class RepositoryIdentityError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: RepositoryIdentityErrorCode;

  constructor(code: RepositoryIdentityErrorCode, message: string) {
    super(message);
    this.name = "RepositoryIdentityError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Repository identity and context-owned storage registration over one entity constructor and state schema.
 *
 * The class records the ownership facts bounded-context registration needs for
 * duplicate and conflict checks. Context assembly uses this metadata to attach
 * a repository to one built context and open state record storage. With
 * authentic explicit aggregate handler metadata, the built context can also
 * execute aggregate commands through repository-owned assignees and appliers,
 * persist aggregate history and snapshots through `AggregateStorage`, and hand
 * already-stored events to the event bus. The repository surface still does
 * not expose direct entity lookup/storage APIs, inbox/delivery management,
 * caches, lifecycle monitors, or transport startup.
 *
 * @typeParam EntityType - A single concrete aggregate, projection, or process-manager constructor
 * with one concrete generated state schema. Broad constructor, constructor-union, broad-schema, and
 * schema-union bindings intentionally fail the public type constraint.
 */
export class Repository<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
> implements RepositoryView {
  readonly #entityType: EntityType;
  readonly #entityFamily: EntityFamily;
  readonly #metadata: EntityMetadata<RepositoryStateSchema<EntityType>>;
  readonly #routing: RepositoryRouting<RepositoryEntityId<EntityType>>;

  /** Create repository identity for exactly one entity family/state schema pair. */
  constructor(options: RepositoryOptions<EntityType>) {
    if (!isRepositoryOptionsObject(options)) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        "Repository options must be a non-null object with an entity type class constructor " +
          "extending Aggregate, Projection, or ProcessManager.",
      );
    }

    const entityType = readEntityTypeOption(options);
    const entityTypeDisplayName = entityTypeName(entityType);

    if (typeof entityType !== "function" || !isClassConstructor(entityType)) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeDisplayName}" must be a class constructor ` +
          "extending Aggregate, Projection, or ProcessManager.",
      );
    }

    const entityFamily = resolveRepositoryEntityFamily(entityType);

    if (entityFamily === undefined) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeDisplayName}" must extend Aggregate, Projection, or ProcessManager.`,
      );
    }

    const schema = readRepositorySchemaOption(
      options,
      entityTypeDisplayName,
      entityFamily,
    ) as RepositoryStateSchema<EntityType>;

    const metadata = describeRepositoryEntityMetadata(entityTypeDisplayName, entityFamily, schema);

    if (metadata.kind !== entityFamily) {
      throw new RepositoryIdentityError(
        "ENTITY_SCHEMA_KIND_MISMATCH",
        `Repository entity type "${entityTypeDisplayName}" does not match ` +
          "the supplied state schema.",
      );
    }

    this.#entityType = entityType as EntityType;
    this.#entityFamily = entityFamily;
    this.#metadata = metadata;
    this.#routing = createRepositoryRouting(this.#entityType, this.#metadata, options.handlers);
    repositorySnapshots.set(
      this,
      createRepositorySnapshot(this.#entityType, this.#entityFamily, this.#metadata),
    );
    repositoryDispatchers.set(this, createRepositoryDispatchers(this, this.#routing));
  }

  /** Entity constructor owned by this repository identity. */
  get entityType(): EntityType {
    return this.#entityType;
  }

  /** Entity family inferred from the constructor's built-in family marker base class. */
  get entityFamily(): EntityFamily {
    return this.#entityFamily;
  }

  /** Generated Protobuf-ES schema for this repository's owned entity state. */
  get stateSchema(): RepositoryStateSchema<EntityType> {
    return this.#metadata.schema;
  }

  /** Descriptor-derived metadata for this repository's owned entity state. */
  get metadata(): EntityMetadata<RepositoryStateSchema<EntityType>> {
    return this.#metadata;
  }

  /** Fully qualified Protobuf type name of the owned entity state. */
  get stateFullTypeName(): RepositoryStateSchema<EntityType>["typeName"] {
    return this.#metadata.fullTypeName;
  }

  /** Canonical entity ID field copied from descriptor-derived metadata. */
  get idField(): DescriptorFieldMetadata {
    return cloneFieldMetadata(this.#metadata.idField);
  }

  /** Copy-safe immutable identity snapshot for later builder duplicate/conflict checks. */
  get snapshot(): RepositoryIdentitySnapshot<EntityType> {
    return cloneRepositorySnapshot(
      createRepositorySnapshot(this.#entityType, this.#entityFamily, this.#metadata),
    );
  }

  /** Route a command to exactly one entity ID without invoking the handler. */
  routeCommand(command: Command): RepositoryCommandRoute<RepositoryEntityId<EntityType>> {
    return this.#routing.routeCommand(command);
  }

  /** Route an event to one or more entity IDs without invoking the handler. */
  routeEvent(event: Event): RepositoryEventRoute<RepositoryEntityId<EntityType>> {
    return this.#routing.routeEvent(event);
  }
}

/**
 * Route-only invocation marker returned by direct repository routing APIs.
 *
 * Built bounded contexts may execute aggregate command assignees and event appliers through their
 * command bus; direct `routeCommand()` and `routeEvent()` calls remain routing-only.
 */
export type RepositoryRouteInvocation = "deferred";

/** Command route calculated by a repository. */
export interface RepositoryCommandRoute<Id = unknown> {
  /** Target entity identifier. */
  readonly entityId: Id;
  /** Fully qualified command message type name. */
  readonly messageFullTypeName: string;
  /** Direct repository route calculation does not invoke handlers. */
  readonly invocation: RepositoryRouteInvocation;
}

/** Event route calculated by a repository. */
export interface RepositoryEventRoute<Id = unknown> {
  /** Target entity identifiers. */
  readonly entityIds: readonly Id[];
  /** Fully qualified event message type name. */
  readonly messageFullTypeName: string;
  /** Direct repository route calculation does not invoke handlers. */
  readonly invocation: RepositoryRouteInvocation;
}

const repositorySnapshots = new WeakMap<RepositoryView, RepositoryIdentitySnapshot>();
const repositoryDispatchers = new WeakMap<RepositoryView, RepositoryDispatchers>();
const repositoryRuntimes = new WeakMap<RepositoryView, RepositoryRuntime>();
Object.freeze(Repository);

/** @internal Framework-only repository authority contract. */
export interface RepositoryAccess {
  hasInstance(repository: unknown): repository is RepositoryView;
  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot;
  commandDispatcher(repository: RepositoryView): CommandDispatcher | undefined;
  eventDispatcher(repository: RepositoryView): EventDispatcher | undefined;
  bindRuntime(repository: RepositoryView, runtime: RepositoryRuntime): void;
  clearRuntime(repository: RepositoryView): void;
}

/** @internal Framework-only repository authority used by bounded-context assembly. */
export const repositoryAccess: RepositoryAccess = Object.freeze({
  hasInstance(repository: unknown): repository is RepositoryView {
    return repositorySnapshots.has(repository as RepositoryView);
  },

  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot {
    const snapshot = repositorySnapshots.get(repository);

    if (snapshot === undefined) {
      throw new TypeError("Repository snapshot requires a Repository instance.");
    }

    return cloneRepositorySnapshot(snapshot);
  },

  commandDispatcher(repository: RepositoryView): CommandDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.command;
  },

  eventDispatcher(repository: RepositoryView): EventDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.event;
  },

  bindRuntime(repository: RepositoryView, runtime: RepositoryRuntime): void {
    repositoryRuntimes.set(repository, Object.freeze(runtime));
  },

  clearRuntime(repository: RepositoryView): void {
    repositoryRuntimes.delete(repository);
  },
});

interface RepositoryDispatchers {
  readonly command: CommandDispatcher | undefined;
  readonly event: EventDispatcher | undefined;
}

interface RepositoryRouting<Id = unknown> {
  readonly commandSchemas: readonly MessageSchema[];
  readonly eventSchemas: readonly MessageSchema[];
  readonly commandReadiness: CommandRegistrationReadinessLookup | undefined;
  readonly eventReadiness: EventRegistrationReadinessLookup | undefined;
  routeCommand(command: Command): RepositoryCommandRoute<Id>;
  routeEvent(event: Event): RepositoryEventRoute<Id>;
}

interface RepositoryRuntime {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly stand: Stand;
  readonly dispatchStored: (event: Event) => Promise<void>;
}

type RepositoryHandlersOption =
  EntityHandlersMetadata | readonly EntityHandlersMetadata[] | undefined;

function createRepositoryDispatchers(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
): RepositoryDispatchers {
  return Object.freeze({
    command:
      routing.commandSchemas.length === 0
        ? undefined
        : Object.freeze({
            messageSchemas: () => routing.commandSchemas,
            dispatch: (command: Command): Promise<void> =>
              dispatchRepositoryCommand(repository, routing, command),
          }),
    event:
      routing.eventSchemas.length === 0
        ? undefined
        : Object.freeze({
            messageSchemas: () => routing.eventSchemas,
            accept: (event: Event): Promise<void> => routeRepositoryEvent(repository, event),
            dispatch: (event: Event): Promise<void> =>
              dispatchRepositoryEvent(repository, routing, event),
          }),
  });
}

function routeRepositoryEvent(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  event: Event,
): Promise<void> {
  void repository.routeEvent(event);
  return Promise.resolve();
}

async function dispatchRepositoryEvent(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
  event: Event,
): Promise<void> {
  const runtime = repositoryRuntimes.get(repository);

  if (runtime === undefined || repository.entityFamily !== "projection") {
    void repository.routeEvent(event);
    return;
  }

  await new ProjectionEventExecution(repository, routing, runtime, event).run();
}

async function dispatchRepositoryCommand(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  },
  routing: RepositoryRouting,
  command: Command,
): Promise<void> {
  const runtime = repositoryRuntimes.get(repository);

  if (runtime === undefined || repository.entityFamily !== "aggregate") {
    void repository.routeCommand(command);
    return;
  }

  await new AggregateCommandExecution(repository, routing, runtime, command).run();
}

class AggregateCommandExecution {
  readonly #repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  };
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #command: Command;
  readonly #storageContext: StorageContext;

  constructor(
    repository: RepositoryView & {
      routeCommand(command: Command): RepositoryCommandRoute;
    },
    routing: RepositoryRouting,
    runtime: RepositoryRuntime,
    command: Command,
  ) {
    this.#repository = repository;
    this.#routing = routing;
    this.#runtime = runtime;
    this.#command = command;
    this.#storageContext = storageContextForCommand(this.#runtime.context, this.#command);
  }

  async run(): Promise<void> {
    const route = this.#repository.routeCommand(this.#command);
    const assignee = this.#routing.commandReadiness?.findCommandAssignee(route.messageFullTypeName);

    if (assignee === undefined) {
      return;
    }

    const loaded = await this.#loadAggregate(route.entityId);
    const message = unpackRequired(
      requireSignalMessage(this.#command.message, "command"),
      assignee.handler.schema,
      "command",
    );
    const produced = await invokeEntityMethod(loaded.entity, assignee.handler.methodName, message);
    const events = this.#bindProducedEvents(
      this.#normalizeProducedEvents(produced),
      route.entityId,
      loaded.version,
    );

    await this.#applyAggregateEvents(loaded.entity, events);

    if (events.length === 0) {
      return;
    }

    const committedVersion = loaded.version + BigInt(events.length);
    await loaded.storage.appendEvents(route.entityId as never, events);
    try {
      await loaded.storage.writeSnapshot({
        aggregateId: route.entityId as never,
        state: repositoryState(loaded.entity) as never,
        version: committedVersion,
        lifecycle: repositoryLifecycle(loaded.entity),
      });
    } finally {
      this.#dispatchStoredEvents(events);
    }
  }

  async #loadAggregate(entityId: unknown): Promise<{
    readonly entity: object;
    readonly storage: AggregateStorage<DescriptorMessageSchema>;
    readonly version: bigint;
  }> {
    const storage = new AggregateStorage({
      context: this.#storageContext,
      storageFactory: this.#runtime.storageFactory,
      stateSchema: this.#repository.stateSchema,
      eventSchemas: this.#routing.eventSchemas,
    });
    const history = await storage.readHistory(entityId as never);
    const entity = this.#instantiateAggregate(entityId, history.snapshot);

    await this.#applyAggregateEvents(entity, history.events);
    return Object.freeze({
      entity,
      storage,
      version: historyVersion(history.snapshot?.version, history.events),
    });
  }

  #instantiateAggregate(
    entityId: unknown,
    snapshot:
      | {
          readonly state: unknown;
          readonly version: bigint;
          readonly lifecycle: {
            readonly archived: boolean;
            readonly deleted: boolean;
          };
        }
      | undefined,
  ): object {
    const entityType = this.#repository.entityType as unknown as new (options: {
      readonly id: unknown;
      readonly schema: DescriptorMessageSchema;
      readonly state: unknown;
      readonly version: unknown;
      readonly lifecycle?: {
        readonly archived: boolean;
        readonly deleted: boolean;
      };
    }) => object;

    const options: {
      id: unknown;
      schema: DescriptorMessageSchema;
      state: unknown;
      version: unknown;
      lifecycle?: {
        readonly archived: boolean;
        readonly deleted: boolean;
      };
    } = {
      id: entityId,
      schema: this.#repository.stateSchema,
      state: snapshot?.state ?? this.#defaultState(entityId),
      version: snapshot?.version ?? 0n,
    };

    if (snapshot !== undefined) {
      options.lifecycle = snapshot.lifecycle;
    }

    return new entityType(options);
  }

  #defaultState(entityId: unknown): unknown {
    return create(this.#repository.stateSchema, {
      [this.#repository.idField.localName]: entityId,
    });
  }

  async #applyAggregateEvents(entity: object, events: readonly Event[]): Promise<void> {
    for (const event of events) {
      await this.#applyAggregateEvent(entity, event);
    }
  }

  async #applyAggregateEvent(entity: object, event: Event): Promise<void> {
    const message = event.message;

    if (message === undefined || message.typeUrl === "") {
      throw new Error("Repository aggregate execution requires event.message.typeUrl.");
    }

    const schema = schemaForTypeUrl(this.#routing.eventSchemas, message.typeUrl, "event");
    const application = this.#routing.eventReadiness?.findEventApplications(schema.typeName)[0];

    if (application === undefined) {
      throw new Error(`Repository aggregate execution has no applier for "${schema.typeName}".`);
    }

    await invokeEntityMethod(
      entity,
      application.handler.methodName,
      unpackRequired(message, application.handler.schema, "event"),
    );
  }

  #normalizeProducedEvents(produced: unknown): readonly Event[] {
    if (produced === undefined) {
      return Object.freeze([]);
    }

    if (Array.isArray(produced)) {
      return Object.freeze(produced.map((event) => clone(EventSchema, event as Event)));
    }

    return Object.freeze([clone(EventSchema, produced as Event)]);
  }

  #bindProducedEvents(
    events: readonly Event[],
    entityId: unknown,
    lastVersion: bigint,
  ): readonly Event[] {
    let version = lastVersion;

    return Object.freeze(
      events.map((event) => {
        version += 1n;
        return this.#bindProducedEvent(event, entityId, version);
      }),
    );
  }

  #bindProducedEvent(event: Event, entityId: unknown, version: bigint): Event {
    const aggregateId = PrimitiveIds.read(entityId);

    if (aggregateId === undefined) {
      throw new Error("Repository aggregate execution requires primitive aggregate IDs.");
    }

    const bound = clone(EventSchema, event);
    const context = clone(EventContextSchema, bound.context ?? create(EventContextSchema));

    context.producerId = PrimitiveIds.pack(aggregateId);
    context.version = create(VersionSchema, { number: eventVersionNumber(version) });
    if (
      context.origin.case === undefined &&
      this.#command.context !== undefined &&
      this.#command.id !== undefined
    ) {
      context.origin = {
        case: "pastMessage",
        value: create(OriginSchema, {
          message: create(MessageIdSchema, {
            id: packAny(CommandIdSchema, this.#command.id),
            typeUrl: this.#command.message?.typeUrl ?? "",
          }),
          ...(this.#command.context.actorContext === undefined
            ? {}
            : { actorContext: clone(ActorContextSchema, this.#command.context.actorContext) }),
          ...(this.#command.context.origin === undefined
            ? {}
            : { grandOrigin: clone(OriginSchema, this.#command.context.origin) }),
        }),
      };
    }
    bound.context = context;
    return bound;
  }

  #dispatchStoredEvents(events: readonly Event[]): void {
    for (const event of events) {
      void this.#runtime.dispatchStored(event).catch(() => undefined);
    }
  }
}

class ProjectionEventExecution {
  readonly #repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  };
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #event: Event;

  constructor(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
    routing: RepositoryRouting,
    runtime: RepositoryRuntime,
    event: Event,
  ) {
    this.#repository = repository;
    this.#routing = routing;
    this.#runtime = runtime;
    this.#event = event;
  }

  async run(): Promise<void> {
    const route = this.#repository.routeEvent(this.#event);
    const subscribers = this.#routing.eventReadiness?.findEventSubscribers(
      route.messageFullTypeName,
    );

    if (subscribers === undefined || subscribers.length === 0) {
      return;
    }

    const message = unpackRequired(
      requireSignalMessage(this.#event.message, "event"),
      subscribers[0]?.handler.schema ?? this.#repository.stateSchema,
      "event",
    );
    const tenantOptions = standTenantOptions(this.#runtime.context, this.#event);

    for (const entityId of route.entityIds) {
      const entity = await this.#loadProjection(entityId, tenantOptions);

      for (const subscriber of subscribers) {
        await invokeEntityMethod(entity, subscriber.handler.methodName, message);
      }

      if (repositoryChanged(entity)) {
        await this.#runtime.stand.update(
          this.#repository.stateSchema,
          repositoryState(entity) as never,
          standUpdateOptions(tenantOptions.tenantId, this.#event.context?.version),
        );
      }
    }
  }

  async #loadProjection(
    entityId: unknown,
    options: { readonly tenantId?: string },
  ): Promise<object> {
    const stored = await this.#runtime.stand.readVersioned(
      this.#repository.stateSchema,
      entityId,
      options,
    );
    const entityType = this.#repository.entityType as unknown as new (options: {
      readonly id: unknown;
      readonly schema: DescriptorMessageSchema;
      readonly state: unknown;
      readonly version: unknown;
    }) => object;

    return new entityType({
      id: entityId,
      schema: this.#repository.stateSchema,
      state: stored?.state ?? this.#defaultState(entityId),
      version: projectionVersion(stored?.version),
    });
  }

  #defaultState(entityId: unknown): unknown {
    return create(this.#repository.stateSchema, {
      [this.#repository.idField.localName]: entityId,
    });
  }
}

function historyVersion(snapshotVersion: bigint | undefined, events: readonly Event[]): bigint {
  const lastEvent = events.at(-1);

  return lastEvent === undefined ? (snapshotVersion ?? 0n) : readEventVersion(lastEvent);
}

function invokeEntityMethod(entity: object, methodName: string, message: unknown): unknown {
  const method = (entity as Record<string, unknown>)[methodName];

  if (typeof method !== "function") {
    throw new TypeError(`Repository entity execution requires method "${methodName}".`);
  }

  return Reflect.apply(method, entity, [message]);
}

function unpackRequired(
  message: NonNullable<Command["message"]>,
  schema: MessageSchema,
  signalKind: "command" | "event",
): unknown {
  const unpacked = unpackAny(message, schema);

  if (unpacked === undefined) {
    throw new Error(`Repository ${signalKind} execution requires a readable message.`);
  }

  return unpacked;
}

function requireSignalMessage(
  message: Command["message"],
  signalKind: "command" | "event",
): NonNullable<Command["message"]> {
  if (message === undefined || message.typeUrl === "") {
    throw new Error(`Repository ${signalKind} execution requires message.typeUrl.`);
  }

  return message;
}

function repositoryState(entity: object): unknown {
  return (entity as { readonly state: unknown }).state;
}

function repositoryLifecycle(entity: object): {
  readonly archived: boolean;
  readonly deleted: boolean;
} {
  return (
    entity as { readonly lifecycle: { readonly archived: boolean; readonly deleted: boolean } }
  ).lifecycle;
}

function repositoryChanged(entity: object): boolean {
  return (entity as { readonly changed?: unknown }).changed === true;
}

function readEventVersion(event: Event): bigint {
  const number = event.context?.version?.number;

  if (number === undefined) {
    throw new Error("Repository aggregate execution requires readable event versions.");
  }

  return BigInt(number);
}

function eventVersionNumber(version: bigint): number {
  if (version > 2_147_483_647n || version < -2_147_483_648n) {
    throw new Error(
      "Repository aggregate execution requires versions in the protobuf int32 range.",
    );
  }

  return Number(version);
}

function storageContextForCommand(context: StorageContext, command: Command): StorageContext {
  if (!context.multitenant) {
    return context;
  }

  const tenantId = readCommandTenant(command);
  return Object.freeze({
    name: context.name,
    multitenant: true,
    ...(tenantId === undefined ? {} : { tenantId }),
  });
}

function readCommandTenant(command: Command): string | undefined {
  return tenantValue(command.context?.actorContext?.tenantId);
}

function standTenantOptions(context: StorageContext, event: Event): { readonly tenantId?: string } {
  if (!context.multitenant) {
    return {};
  }

  const tenantId = readEventTenant(event) ?? context.tenantId;
  return tenantId === undefined ? {} : { tenantId };
}

function readEventTenant(event: Event): string | undefined {
  switch (event.context?.origin.case) {
    case "importContext":
      return tenantValue(event.context.origin.value.tenantId);
    case "pastMessage":
      return tenantValue(event.context.origin.value.actorContext?.tenantId);
    default:
      return undefined;
  }
}

function standUpdateOptions(
  tenantId: string | undefined,
  version: Version | undefined,
): { readonly tenantId?: string; readonly version?: Version } {
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(version === undefined ? {} : { version }),
  });
}

function projectionVersion(version: Version | undefined): number {
  return version?.number ?? 0;
}

function tenantValue(tenantId: TenantId | undefined): string | undefined {
  switch (tenantId?.kind.case) {
    case "value":
      return tenantId.kind.value;
    case "domain":
      return `domain:${tenantId.kind.value.value}`;
    case "email":
      return `email:${tenantId.kind.value.value}`;
    default:
      return undefined;
  }
}

function createRepositoryRouting<EntityType extends RepositoryEntityType>(
  entityType: EntityType,
  metadata: EntityMetadata,
  handlersOption: RepositoryHandlersOption,
): RepositoryRouting<RepositoryEntityId<EntityType>> {
  const handlers = normalizeHandlers(handlersOption);
  validateHandlers(entityType, metadata, handlers);
  const commandReadiness =
    handlers.length === 0 ? undefined : CommandRegistrationReadiness.fromEntityHandlers(handlers);
  const eventReadiness =
    handlers.length === 0 ? undefined : EventRegistrationReadiness.fromEntityHandlers(handlers);
  const commandSchemas = uniqueSchemas(
    handlers.flatMap((handler) =>
      handler.commandAssignments.map((assignment) => assignment.schema),
    ),
  );
  const eventSchemas = uniqueSchemas(
    handlers.flatMap((handler) => [
      ...handler.eventSubscriptions.map((subscription) => subscription.schema),
      ...handler.eventReactions.map((reaction) => reaction.schema),
      ...handler.eventApplications.map((application) => application.schema),
    ]),
  );

  return Object.freeze({
    commandSchemas,
    eventSchemas,
    commandReadiness,
    eventReadiness,
    routeCommand: (command: Command) =>
      routeCommand<RepositoryEntityId<EntityType>>(command, commandReadiness, commandSchemas),
    routeEvent: (event: Event) =>
      routeEvent<RepositoryEntityId<EntityType>>(event, eventReadiness, eventSchemas),
  });
}

function normalizeHandlers(
  handlersOption: RepositoryHandlersOption,
): readonly EntityHandlersMetadata[] {
  if (handlersOption === undefined) {
    return Object.freeze([]);
  }
  if (isHandlersArray(handlersOption)) {
    return Object.freeze([...handlersOption]);
  }
  return Object.freeze([handlersOption]);
}

function isHandlersArray(
  value: RepositoryHandlersOption,
): value is readonly EntityHandlersMetadata[] {
  return Array.isArray(value);
}

function validateHandlers(
  entityType: RepositoryEntityType,
  metadata: EntityMetadata,
  handlers: readonly EntityHandlersMetadata[],
): void {
  for (const handlersMetadata of handlers) {
    if (
      !handlerMetadataAccess.isAuthentic(handlersMetadata) ||
      handlersMetadata.entityType !== entityType ||
      handlersMetadata.entity.fullTypeName !== metadata.fullTypeName
    ) {
      throw new RepositoryIdentityError(
        "ENTITY_SCHEMA_KIND_MISMATCH",
        `Repository entity type "${entityType.name}" does not match the supplied handler metadata.`,
      );
    }
  }
}

function uniqueSchemas(schemas: readonly MessageSchema[]): readonly MessageSchema[] {
  const byTypeUrl = new Map<string, MessageSchema>();
  for (const schema of schemas) {
    byTypeUrl.set(deriveTypeUrl(schema), schema);
  }
  return Object.freeze([...byTypeUrl.values()]);
}

function routeCommand<Id>(
  command: Command,
  readiness: CommandRegistrationReadinessLookup | undefined,
  schemas: readonly MessageSchema[],
): RepositoryCommandRoute<Id> {
  const message = command.message;
  if (message === undefined || message.typeUrl === "") {
    throw new Error("Repository command routing requires command.message.typeUrl.");
  }

  const schema = schemaForTypeUrl(schemas, message.typeUrl, "command");
  const assignee = readiness?.findCommandAssignee(schema.typeName);
  if (assignee === undefined) {
    throw new Error(`Repository command routing has no assignee for "${schema.typeName}".`);
  }

  return Object.freeze({
    entityId: readFirstFieldId(message, schema, "command") as Id,
    messageFullTypeName: schema.typeName,
    invocation: "deferred",
  });
}

function routeEvent<Id>(
  event: Event,
  readiness: EventRegistrationReadinessLookup | undefined,
  schemas: readonly MessageSchema[],
): RepositoryEventRoute<Id> {
  const message = event.message;
  if (message === undefined || message.typeUrl === "") {
    throw new Error("Repository event routing requires event.message.typeUrl.");
  }

  const schema = schemaForTypeUrl(schemas, message.typeUrl, "event");
  const hasReceiver =
    (readiness?.findEventSubscribers(schema.typeName).length ?? 0) > 0 ||
    (readiness?.findEventReactors(schema.typeName).length ?? 0) > 0 ||
    (readiness?.findEventApplications(schema.typeName).length ?? 0) > 0;
  if (!hasReceiver) {
    throw new Error(`Repository event routing has no receiver for "${schema.typeName}".`);
  }

  return Object.freeze({
    entityIds: Object.freeze([readEventEntityId(event, message, schema) as Id]),
    messageFullTypeName: schema.typeName,
    invocation: "deferred",
  });
}

function schemaForTypeUrl(
  schemas: readonly MessageSchema[],
  typeUrl: string,
  signalKind: "command" | "event",
): MessageSchema {
  const schema = schemas.find((candidate) => deriveTypeUrl(candidate) === typeUrl);

  if (schema === undefined) {
    throw new Error(`Repository ${signalKind} routing has no schema for "${typeUrl}".`);
  }

  return schema;
}

function readFirstFieldId(
  message: NonNullable<Command["message"]>,
  schema: MessageSchema,
  signalKind: "command" | "event",
): unknown {
  const unpacked = unpackAny(message, schema);
  const firstField = schema.fields[0];

  if (unpacked === undefined || firstField === undefined) {
    throw new Error(`Repository ${signalKind} routing requires a readable first field.`);
  }

  const value = (unpacked as Record<string, unknown>)[firstField.localName];
  if (value === undefined || value === null) {
    throw new Error(`Repository ${signalKind} routing requires a non-empty first field.`);
  }

  return value;
}

function readProducerId(event: Event): string | number | boolean | undefined {
  const producerId = event.context?.producerId;
  if (producerId === undefined) {
    return undefined;
  }

  const unpacked = PrimitiveIds.unpack(producerId);
  if (unpacked !== undefined) {
    return unpacked;
  }
  throw new Error("Repository event routing requires a readable producer ID.");
}

function readEventEntityId(
  event: Event,
  message: NonNullable<Event["message"]>,
  schema: MessageSchema,
): unknown {
  const producerId = readProducerId(event);
  const fieldId = readFirstFieldId(message, schema, "event");

  if (producerId !== undefined && producerId !== fieldId) {
    throw new Error(
      "Repository event routing requires producer ID and first field to identify the same entity.",
    );
  }

  return producerId ?? fieldId;
}

function createRepositorySnapshot<EntityType extends RepositoryEntityType>(
  entityType: EntityType,
  entityFamily: EntityFamily,
  metadata: EntityMetadata<RepositoryStateSchema<EntityType>>,
): RepositoryIdentitySnapshot<EntityType> {
  const metadataCopy = cloneEntityMetadata(metadata);

  return Object.freeze({
    entityType,
    entityFamily,
    stateSchema: metadataCopy.schema,
    metadata: metadataCopy,
    stateFullTypeName: metadataCopy.fullTypeName,
    idField: cloneFieldMetadata(metadataCopy.idField),
  });
}

function cloneRepositorySnapshot<EntityType extends RepositoryEntityType>(
  snapshot: RepositoryIdentitySnapshot<EntityType>,
): RepositoryIdentitySnapshot<EntityType> {
  const metadata = cloneEntityMetadata(snapshot.metadata);

  return Object.freeze({
    entityType: snapshot.entityType,
    entityFamily: snapshot.entityFamily,
    stateSchema: metadata.schema,
    metadata,
    stateFullTypeName: metadata.fullTypeName,
    idField: cloneFieldMetadata(metadata.idField),
  });
}

function isRepositoryOptionsObject(options: unknown): options is object {
  return typeof options === "object" && options !== null;
}

function readEntityTypeOption(options: object): unknown {
  try {
    return (options as { readonly entityType: unknown }).entityType;
  } catch {
    throw new RepositoryIdentityError(
      "UNSUPPORTED_ENTITY_TYPE",
      "Repository options entityType must be readable and resolve to a class constructor " +
        "extending Aggregate, Projection, or ProcessManager.",
    );
  }
}

function readRepositorySchemaOption(
  options: object,
  entityTypeDisplayName: string,
  entityFamily: EntityFamily,
): unknown {
  try {
    return (options as { readonly schema: unknown }).schema;
  } catch {
    throw new RepositoryIdentityError(
      "ENTITY_SCHEMA_KIND_MISMATCH",
      `Repository entity type "${entityTypeDisplayName}" is a ${entityFamily}, but ` +
        "the supplied state schema could not be read.",
    );
  }
}

function isClassConstructor(entityType: unknown): boolean {
  if (typeof entityType !== "function") {
    return false;
  }

  try {
    const source = Function.prototype.toString.call(entityType);
    return source.startsWith("class ");
  } catch {
    return false;
  }
}

/** @internal Shared runtime family check for repository-owned entity constructors. */
export function resolveRepositoryEntityFamily(entityType: unknown): EntityFamily | undefined {
  if (typeof entityType !== "function" || !isClassConstructor(entityType)) {
    return undefined;
  }

  const runtimeEntityType = entityType as RuntimeRepositoryEntityType;

  if (hasEntityFamilyInheritance(runtimeEntityType, Aggregate, Aggregate.prototype)) {
    return "aggregate";
  }
  if (hasEntityFamilyInheritance(runtimeEntityType, Projection, Projection.prototype)) {
    return "projection";
  }
  if (hasEntityFamilyInheritance(runtimeEntityType, ProcessManager, ProcessManager.prototype)) {
    return "process-manager";
  }

  return undefined;
}

function hasEntityFamilyInheritance(
  entityType: RuntimeRepositoryEntityType,
  familyConstructor: object,
  familyPrototype: object,
): boolean {
  try {
    return (
      Object.prototype.isPrototypeOf.call(familyConstructor, entityType) &&
      Object.prototype.isPrototypeOf.call(familyPrototype, entityType.prototype)
    );
  } catch {
    return false;
  }
}

function entityTypeName(entityType: unknown): string {
  if ((typeof entityType !== "object" && typeof entityType !== "function") || entityType === null) {
    return "(anonymous)";
  }

  const name = safeStringProperty(entityType, "name");
  return typeof name === "string" && name.length > 0 ? name : "(anonymous)";
}

function safeStringProperty(value: object, propertyName: "name" | "typeName"): string | undefined {
  try {
    const property = (value as Record<typeof propertyName, unknown>)[propertyName];
    return typeof property === "string" ? property : undefined;
  } catch {
    return undefined;
  }
}

function describeRepositoryEntityMetadata<Schema extends DescriptorMessageSchema>(
  entityTypeDisplayName: string,
  entityFamily: EntityFamily,
  schema: Schema,
): EntityMetadata<Schema> {
  try {
    return describeEntityMetadata(schema);
  } catch {
    throw new RepositoryIdentityError(
      "ENTITY_SCHEMA_KIND_MISMATCH",
      `Repository entity type "${entityTypeDisplayName}" is a ${entityFamily}, but ` +
        "the supplied state schema does not expose supported entity metadata.",
    );
  }
}

function cloneEntityMetadata<Schema extends DescriptorMessageSchema>(
  metadata: EntityMetadata<Schema>,
): EntityMetadata<Schema> {
  const idField = cloneFieldMetadata(metadata.idField);
  const firstFieldRoutingHint: FirstFieldRoutingHint = Object.freeze({
    strategy: metadata.firstFieldRoutingHint.strategy,
    field: cloneFieldMetadata(metadata.firstFieldRoutingHint.field),
  });

  return Object.freeze({
    schema: metadata.schema,
    descriptor: metadata.descriptor,
    fullTypeName: metadata.fullTypeName,
    fileDescriptor: metadata.fileDescriptor,
    fileName: metadata.fileName,
    kind: metadata.kind,
    declaredVisibility: metadata.declaredVisibility,
    visibility: metadata.visibility,
    visibilitySource: metadata.visibilitySource,
    idField,
    firstFieldRoutingHint,
    columns: Object.freeze(metadata.columns.map(cloneFieldMetadata)),
    setOnceFields: Object.freeze(metadata.setOnceFields.map(cloneFieldMetadata)),
    semanticTags: Object.freeze([...metadata.semanticTags]),
  });
}

function cloneFieldMetadata(field: DescriptorFieldMetadata): DescriptorFieldMetadata {
  return Object.freeze({
    descriptor: field.descriptor,
    name: field.name,
    localName: field.localName,
    jsonName: field.jsonName,
    number: field.number,
  });
}
