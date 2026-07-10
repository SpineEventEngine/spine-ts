import { clone, create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import {
  ValidationException,
  checkValid,
  deriveTypeUrl,
  packAny,
  unpackAny,
  type MessageSchema,
} from "@spine-ts/core";
import {
  CommandContextSchema,
  CommandSchema,
  EventContextSchema,
  EventSchema,
  type Command,
  type Event,
  type TenantId,
  type Version,
  VersionSchema,
} from "@spine-ts/proto";
import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import { CommandValidationError } from "../bus/command-errors.js";
import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage, InboxMessageInput } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";
import {
  Aggregate,
  type Entity,
  ProcessManager,
  Projection,
  type EntityFamily,
  transactionalEntityAccess,
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
import { SignalMetadata } from "../runtime/signal-metadata.js";
import {
  HandlerMetadataRegistry,
  handlerMetadataAccess,
  type CommandAssignmentHandlerMetadata,
  type CommandReactionHandlerMetadata,
  type EntityHandlersMetadata,
  type EventReactionHandlerMetadata,
  type HandlerParameterCount,
  type RegisteredHandlerMetadata,
} from "../handler/handler-metadata.js";
import { AggregateStorage } from "./aggregate-storage.js";
import { MessageIds, PrimitiveIds } from "./primitive-id.js";
import type { Stand } from "../stand/stand.js";
import { TransitionValidationError } from "./command-errors.js";
import { ReplayError } from "./replay-error.js";

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
      : EntityType["prototype"] extends ProcessManager<
            unknown,
            DescriptorMessageSchema,
            infer Version
          >
        ? [Version] extends [number]
          ? RepositoryHandlers<EntityType> | readonly RepositoryHandlers<EntityType>[]
          : never
        : never;

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
   * Process-manager repositories with handlers also execute through Stand-backed state and must
   * use `number` version metadata, matching the Stand version shape used by the local runtime.
   */
  readonly handlers?: RepositoryHandlersOptionFor<EntityType>;
  /** Generated event schemas that aggregate or process-manager handlers may emit. */
  readonly events?: readonly MessageSchema[];
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
 * already-stored events to the event bus. Aggregate and process-manager command
 * execution require `command.id` before routing or mutation so produced events
 * can carry a contract-valid command origin. With authentic projection
 * subscriber metadata, built contexts can also execute projection subscribers
 * and write changed projection state through the context-owned `Stand`. With
 * authentic process-manager metadata, built contexts can execute command
 * assignees, event reactors, and event-commanding handlers, storing changed
 * process-manager state through tenant-scoped Stand records with numeric
 * versions. The `events` option declares generated event schemas emitted by
 * aggregate and process-manager producer handlers. The repository surface still
 * does not expose direct entity lookup/storage APIs, inbox/delivery management,
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
    this.#routing = createRepositoryRouting(
      this.#entityType,
      this.#entityFamily,
      this.#metadata,
      options.handlers,
      options.events ?? [],
    );
    repositorySnapshots.set(
      this,
      createRepositorySnapshot(this.#entityType, this.#entityFamily, this.#metadata),
    );
    repositoryDispatchers.set(this, createRepositoryDispatchers(this, this.#routing));
    const pmInboxTarget = createPmInboxTarget(this, this.#routing);
    const projectionInboxTarget = createProjectionInboxTarget(this, this.#routing);

    if (pmInboxTarget !== undefined) {
      repositoryPmInboxTargets.set(this, pmInboxTarget);
    }
    if (projectionInboxTarget !== undefined) {
      repositoryProjectionInboxTargets.set(this, projectionInboxTarget);
      repositoryProjectionDirect.set(this, createProjectionDirectDispatch(this, this.#routing));
    }
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
const repositoryPmInboxTargets = new WeakMap<RepositoryView, ProcessManagerInboxTarget>();
const repositoryProjectionInboxTargets = new WeakMap<RepositoryView, ProjectionInboxTarget>();
const repositoryProjectionDirect = new WeakMap<RepositoryView, (event: Event) => Promise<void>>();
const repositoryRuntimes = new WeakMap<RepositoryView, RepositoryRuntime>();
Object.freeze(Repository);

type ProcessManagerInboxLabel = "HANDLE_COMMAND" | "REACT_UPON_EVENT";
type ProcessManagerInboxMessage = InboxMessage & {
  readonly label: ProcessManagerInboxLabel;
  readonly status: "TO_DELIVER";
};
type ProcessManagerInboxInput = Omit<InboxMessageInput, "whenReceived" | "version"> & {
  readonly label: ProcessManagerInboxLabel;
  readonly status: "TO_DELIVER";
};

/** @internal Narrow framework-only replay target for process-manager inbox handoff. */
export interface ProcessManagerInboxTarget {
  /** Target process-manager state type URL routed by this replay target. */
  readonly targetTypeUrl: string;
  /** Replays one durable inbox message under the active delivery tenant. */
  replay(message: ProcessManagerInboxMessage, deliveryTenantId?: string): Promise<void>;
}

/** @internal Context-owned process-manager inbox handoff capability. */
export interface ProcessManagerInbox {
  /** Writes a durable inbox row and waits for that exact row to be delivered locally. */
  receive(
    delivery: Delivery,
    input: ProcessManagerInboxInput,
    deliveryTenantId?: string,
  ): Promise<InboxMessage>;
  /** Writes durable inbox rows and replays those exact rows in input order. */
  receiveAll(
    delivery: Delivery,
    inputs: readonly ProcessManagerInboxInput[],
    deliveryTenantId?: string,
  ): Promise<readonly InboxMessage[]>;
}

/** @internal Narrow framework-only replay target for projection subscriber inbox handoff. */
export interface ProjectionInboxTarget {
  /** Target projection state type URL routed by this replay target. */
  readonly targetTypeUrl: string;
  /** Replays one durable inbox event under the active delivery tenant. */
  replay(message: InboxMessage, deliveryTenantId?: string): Promise<void>;
}

/** @internal Context-owned projection subscriber inbox handoff capability. */
export interface ProjectionInbox {
  /** Writes a durable inbox row and waits for that exact row to be delivered locally. */
  receive(
    delivery: Delivery,
    input: Omit<InboxMessageInput, "whenReceived" | "version">,
    deliveryTenantId?: string,
  ): Promise<InboxMessage>;
}

/** @internal Framework-only repository authority contract. */
export interface RepositoryAccess {
  hasInstance(repository: unknown): repository is RepositoryView;
  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot;
  commandDispatcher(repository: RepositoryView): CommandDispatcher | undefined;
  eventDispatcher(repository: RepositoryView): EventDispatcher | undefined;
  processManagerInboxTarget(repository: RepositoryView): ProcessManagerInboxTarget | undefined;
  projectionInboxTarget(repository: RepositoryView): ProjectionInboxTarget | undefined;
  dispatchProjectionDirect(repository: RepositoryView, event: Event): Promise<void>;
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

  processManagerInboxTarget(repository: RepositoryView): ProcessManagerInboxTarget | undefined {
    return repositoryPmInboxTargets.get(repository);
  },

  projectionInboxTarget(repository: RepositoryView): ProjectionInboxTarget | undefined {
    return repositoryProjectionInboxTargets.get(repository);
  },

  dispatchProjectionDirect(repository: RepositoryView, event: Event): Promise<void> {
    const dispatch = repositoryProjectionDirect.get(repository);

    if (dispatch === undefined) {
      throw new TypeError("Direct projection dispatch requires a projection Repository instance.");
    }

    return dispatch(event);
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
  readonly eventApplicationSchemas: readonly MessageSchema[];
  readonly producedEventSchemas: readonly MessageSchema[];
  readonly producedCommandSchemas: readonly MessageSchema[];
  readonly commandReadiness: CommandRegistrationReadinessLookup | undefined;
  readonly eventReadiness: EventRegistrationReadinessLookup | undefined;
  commandReactions(
    eventFullTypeName: string,
  ): readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
  routeCommand(command: Command): RepositoryCommandRoute<Id>;
  routeEvent(event: Event): RepositoryEventRoute<Id>;
}

interface RepositoryRuntime {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly stand: Stand;
  readonly signalMetadata: SignalMetadata;
  readonly processManagerInbox: ProcessManagerInbox;
  readonly projectionInbox: ProjectionInbox;
  readonly dispatchStored: (event: Event) => Promise<void>;
  readonly dispatchStoredFollowUp: (event: Event) => Promise<void>;
  readonly postEventFollowUp: (event: Event) => Promise<void>;
  readonly onPostCommand: (command: Command) => Promise<void>;
  readonly recordDispatchFailure: (event: Event, error: unknown) => void;
}

type RepositoryHandlersOption =
  EntityHandlersMetadata | readonly EntityHandlersMetadata[] | undefined;
type ApplyMode = "command" | "replay";
type RepositoryCommandAssignee = NonNullable<
  ReturnType<NonNullable<RepositoryRouting["commandReadiness"]>["findCommandAssignee"]>
>;
type RepositoryEventSubscribers = NonNullable<
  ReturnType<NonNullable<RepositoryRouting["eventReadiness"]>["findEventSubscribers"]>
>;

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

function createPmInboxTarget(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
): ProcessManagerInboxTarget | undefined {
  if (
    repository.entityFamily !== "process-manager" ||
    (routing.commandSchemas.length === 0 && routing.eventSchemas.length === 0)
  ) {
    return undefined;
  }

  return Object.freeze({
    targetTypeUrl: deriveTypeUrl(repository.stateSchema),
    replay: (message: InboxMessage, deliveryTenantId?: string): Promise<void> =>
      replayPmInbox(repository, routing, message, deliveryTenantId),
  });
}

function createProjectionInboxTarget(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
): ProjectionInboxTarget | undefined {
  if (repository.entityFamily !== "projection" || routing.eventSchemas.length === 0) {
    return undefined;
  }

  return Object.freeze({
    targetTypeUrl: deriveTypeUrl(repository.stateSchema),
    replay: (message: InboxMessage, deliveryTenantId?: string): Promise<void> =>
      replayProjectionEvent(repository, routing, message, deliveryTenantId),
  });
}

function createProjectionDirectDispatch(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
): (event: Event) => Promise<void> {
  return (event: Event): Promise<void> => {
    const runtime = repositoryRuntimes.get(repository);

    if (runtime === undefined) {
      void repository.routeEvent(event);
      return Promise.resolve();
    }

    return new ProjectionEventExecution(repository, routing, runtime, event).runDirect();
  };
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

  if (runtime === undefined) {
    void repository.routeEvent(event);
    return;
  }

  switch (repository.entityFamily) {
    case "aggregate":
      await new AggregateEventExecution(repository, routing, runtime, event).run();
      return;
    case "process-manager":
      await new ProcessManagerEventExecution(repository, routing, runtime, event).run();
      return;
    case "projection":
      await new ProjectionEventExecution(repository, routing, runtime, event).run();
      return;
  }
}

async function dispatchRepositoryCommand(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  },
  routing: RepositoryRouting,
  command: Command,
): Promise<void> {
  const runtime = repositoryRuntimes.get(repository);

  if (runtime === undefined) {
    void repository.routeCommand(command);
    return;
  }

  if (repository.entityFamily === "aggregate") {
    await new AggregateCommandExecution(repository, routing, runtime, command).run();
    return;
  }

  if (repository.entityFamily === "process-manager") {
    await handoffProcessManagerCommand(repository, runtime, command);
    return;
  }

  void repository.routeCommand(command);
}

const inboxDedupMs = 30_000;

async function handoffProcessManagerCommand(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  },
  runtime: RepositoryRuntime,
  command: Command,
): Promise<void> {
  const route = repository.routeCommand(command);
  const commandId = requireCommandId(command);
  const whenReceived = new Date();
  const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
  const deliveryTenantId = requireProcessManagerTenant(runtime.context, command);
  const delivery = new Delivery({
    context: processManagerDeliveryContext(runtime.context, deliveryTenantId),
    storageFactory: runtime.storageFactory,
  });

  await runtime.processManagerInbox.receive(
    delivery,
    {
      inboxId: {
        targetId: inboxTargetId(route.entityId),
        targetTypeUrl: deriveTypeUrl(repository.stateSchema),
      },
      signalId: commandId.uuid,
      signal: packAny(CommandSchema, command),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      keepUntil,
    },
    deliveryTenantId,
  );
}

async function handoffProjectionEvent(
  repository: RepositoryView,
  runtime: RepositoryRuntime,
  event: Event,
  entityId: unknown,
): Promise<void> {
  const eventId = requireEventId(event);
  const whenReceived = new Date();
  const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
  const deliveryTenantId = requireProjectionTenant(runtime.context, event);
  const delivery = new Delivery({
    context: projectionDeliveryContext(runtime.context, deliveryTenantId),
    storageFactory: runtime.storageFactory,
  });

  await runtime.projectionInbox.receive(
    delivery,
    {
      inboxId: {
        targetId: inboxTargetId(entityId),
        targetTypeUrl: deriveTypeUrl(repository.stateSchema),
      },
      signalId: eventId.value,
      signal: packAny(EventSchema, event, { validate: false }),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      keepUntil,
    },
    deliveryTenantId,
  );
}

async function handoffPmEvent(
  repository: RepositoryView,
  runtime: RepositoryRuntime,
  event: Event,
  entityId: unknown,
): Promise<void> {
  const eventId = requireEventId(event);
  const whenReceived = new Date();
  const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
  const deliveryTenantId = requirePmEventTenant(runtime.context, event);
  const delivery = new Delivery({
    context: processManagerDeliveryContext(runtime.context, deliveryTenantId),
    storageFactory: runtime.storageFactory,
  });

  await runtime.processManagerInbox.receive(
    delivery,
    pmEventInboxInput(repository, eventId.value, event, entityId, keepUntil),
    deliveryTenantId,
  );
}

async function handoffPmEvents(
  repository: RepositoryView,
  runtime: RepositoryRuntime,
  event: Event,
  entityIds: readonly unknown[],
): Promise<void> {
  const eventId = requireEventId(event);
  const whenReceived = new Date();
  const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
  const deliveryTenantId = requirePmEventTenant(runtime.context, event);
  const delivery = new Delivery({
    context: processManagerDeliveryContext(runtime.context, deliveryTenantId),
    storageFactory: runtime.storageFactory,
  });
  const inputs = entityIds.map((entityId) =>
    pmEventInboxInput(repository, eventId.value, event, entityId, keepUntil),
  );

  await runtime.processManagerInbox.receiveAll(delivery, inputs, deliveryTenantId);
}

function pmEventInboxInput(
  repository: RepositoryView,
  signalId: string,
  event: Event,
  entityId: unknown,
  keepUntil: Date,
): ProcessManagerInboxInput {
  return {
    inboxId: {
      targetId: inboxTargetId(entityId),
      targetTypeUrl: deriveTypeUrl(repository.stateSchema),
    },
    signalId,
    signal: packAny(EventSchema, event, { validate: false }),
    label: "REACT_UPON_EVENT",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    keepUntil,
  };
}

async function replayPmInbox(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
  message: InboxMessage,
  deliveryTenantId?: string,
): Promise<void> {
  if (message.label === "HANDLE_COMMAND") {
    await replayProcessManagerCommand(repository, routing, message, deliveryTenantId);
    return;
  }
  if (message.label === "REACT_UPON_EVENT") {
    await replayProcessManagerEvent(repository, routing, message, deliveryTenantId);
    return;
  }

  throw new Error(`Process-manager inbox replay does not handle "${message.label}" messages.`);
}

async function replayProcessManagerCommand(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  },
  routing: RepositoryRouting,
  message: InboxMessage,
  deliveryTenantId?: string,
): Promise<void> {
  const runtime = repositoryRuntimes.get(repository);

  if (runtime === undefined) {
    throw new Error("Process-manager inbox replay requires a bound repository runtime.");
  }

  const command = readInboxCommand(message);

  validateReplayTenant(runtime.context, deliveryTenantId, command);
  validateReplayedCommandPayload(routing, command);
  validateReplayTarget(repository, message, command);

  await new ProcessManagerCommandExecution(repository, routing, runtime, command).run();
}

async function replayProcessManagerEvent(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
  message: InboxMessage,
  deliveryTenantId?: string,
): Promise<void> {
  const runtime = repositoryRuntimes.get(repository);

  if (runtime === undefined) {
    throw new Error("Process-manager inbox replay requires a bound repository runtime.");
  }

  const event = readPmInboxEvent(message);

  validatePmReplayTenant(runtime.context, deliveryTenantId, event);
  validateReplayedEventPayload(
    routing,
    event,
    "Process-manager inbox replay requires a readable event payload.",
  );

  const entityId = replayProcessManagerId(repository, message, event);

  await new ProcessManagerEventExecution(repository, routing, runtime, event).runTarget(entityId);
}

async function replayProjectionEvent(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  routing: RepositoryRouting,
  message: InboxMessage,
  deliveryTenantId?: string,
): Promise<void> {
  const runtime = repositoryRuntimes.get(repository);

  if (runtime === undefined) {
    throw new Error("Projection inbox replay requires a bound repository runtime.");
  }

  const event = readProjectionInboxEvent(message);

  validateProjectionReplayTenant(runtime.context, deliveryTenantId, event);
  validateReplayedEventPayload(routing, event);

  const entityId = replayProjectionId(repository, message, event);

  await new ProjectionEventExecution(repository, routing, runtime, event).runTarget(entityId);
}

interface LoadedAggregate {
  readonly entity: object;
  readonly storage: AggregateStorage<DescriptorMessageSchema>;
  readonly version: bigint;
}

class AggregateExecutionSupport {
  readonly #repository: RepositoryView;
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #storageContext: StorageContext;

  constructor(
    repository: RepositoryView,
    routing: RepositoryRouting,
    runtime: RepositoryRuntime,
    storageContext: StorageContext,
  ) {
    this.#repository = repository;
    this.#routing = routing;
    this.#runtime = runtime;
    this.#storageContext = storageContext;
  }

  usesAppliers(): boolean {
    return this.#routing.eventApplicationSchemas.length > 0;
  }

  async loadAggregate(entityId: unknown, replayAppliers: boolean): Promise<LoadedAggregate> {
    const storage = new AggregateStorage({
      context: this.#storageContext,
      storageFactory: this.#runtime.storageFactory,
      stateSchema: this.#repository.stateSchema,
      eventSchemas: this.#routing.producedEventSchemas,
    });
    const history = await storage.readHistory(entityId as never);
    if (!replayAppliers && history.events.length > 0) {
      throw new Error("Managed aggregate history has unsnapshotted events.");
    }
    const entity = this.#instantiateAggregate(entityId, history.snapshot);

    if (replayAppliers) {
      await this.applyAggregateEvents(entity, history.events, "replay");
    }

    return Object.freeze({
      entity,
      storage,
      version: historyVersion(history.snapshot?.version, history.events),
    });
  }

  normalizeProducedSignals(produced: unknown): readonly unknown[] {
    if (produced === undefined) {
      return Object.freeze([]);
    }

    if (Array.isArray(produced)) {
      return Object.freeze(Array.from(produced as readonly unknown[]));
    }

    return Object.freeze([produced]);
  }

  async applyAggregateEvents(
    entity: object,
    events: readonly Event[],
    mode: ApplyMode,
  ): Promise<void> {
    for (const event of events) {
      await this.#applyAggregateEvent(entity, event, mode);
    }
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

  async #applyAggregateEvent(entity: object, event: Event, mode: ApplyMode): Promise<void> {
    const message = event.message;

    if (message === undefined || message.typeUrl === "") {
      throw new Error("Repository aggregate execution requires event.message.typeUrl.");
    }

    const schema = schemaForTypeUrl(
      this.#routing.eventApplicationSchemas,
      message.typeUrl,
      "event",
    );
    const application = this.#routing.eventReadiness?.findEventApplications(schema.typeName)[0];

    if (application === undefined) {
      throw new Error(`Repository aggregate execution has no applier for "${schema.typeName}".`);
    }

    await invokeEntityMethod(
      entity,
      application.handler.methodName,
      unpackRequired(message, application.handler.schema, "event"),
    );
    const rejectedCommit = transactionalEntityAccess.rejectedCommit(entity);

    if (rejectedCommit !== undefined) {
      if (mode === "replay") {
        throw new ReplayError(rejectedCommit.validation.error);
      }
      throw new TransitionValidationError(rejectedCommit.validation.error);
    }
  }
}

class AggregateCommandExecution {
  readonly #repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  };
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #command: Command;
  readonly #support: AggregateExecutionSupport;

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
    this.#support = new AggregateExecutionSupport(
      repository,
      routing,
      runtime,
      storageContextForCommand(this.#runtime.context, this.#command),
    );
  }

  async run(): Promise<void> {
    void requireCommandId(this.#command);

    const commandMessage = requireSignalMessage(this.#command.message, "command");
    const commandSchema = schemaForTypeUrl(
      this.#routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );
    const message = unpackRequired(commandMessage, commandSchema, "command");

    const route = this.#repository.routeCommand(this.#command);
    const assignee = this.#routing.commandReadiness?.findCommandAssignee(route.messageFullTypeName);

    if (assignee === undefined) {
      return;
    }

    const usesAppliers = this.#usesAppliers();
    const loaded = await this.#support.loadAggregate(route.entityId, usesAppliers);
    const commandContext = commandHandlerContext(this.#command);
    const produced = usesAppliers
      ? await invokeEntityMethod(
          loaded.entity,
          assignee.handler.methodName,
          message,
          assignee.handler.parameterCount,
          commandContext,
        )
      : await this.#invokeAssignee(
          loaded.entity,
          assignee.handler.methodName,
          message,
          assignee.handler.parameterCount,
          commandContext,
        );
    const events = this.#bindProducedEvents(
      this.#support.normalizeProducedSignals(produced),
      route.entityId,
      loaded.version,
      usesAppliers,
    );

    if (events.length === 0) {
      throw new Error("Repository aggregate command handlers must return at least one event.");
    }

    if (usesAppliers) {
      await this.#support.applyAggregateEvents(loaded.entity, events, "command");
    }

    const committedVersion = usesAppliers
      ? loaded.version + BigInt(events.length)
      : loaded.version + 1n;
    await this.#storeAggregateUpdate(
      loaded,
      route.entityId,
      committedVersion,
      events,
      usesAppliers,
    );
  }

  #usesAppliers(): boolean {
    return this.#support.usesAppliers();
  }

  async #storeAggregateUpdate(
    loaded: {
      readonly entity: object;
      readonly storage: AggregateStorage<DescriptorMessageSchema>;
    },
    entityId: unknown,
    version: bigint,
    events: readonly Event[],
    usesAppliers: boolean,
  ): Promise<void> {
    const snapshot = {
      aggregateId: entityId as never,
      state: repositoryState(loaded.entity) as never,
      version,
      lifecycle: repositoryLifecycle(loaded.entity),
    };

    if (!usesAppliers) {
      await loaded.storage.writeSnapshotWithEvents(snapshot, events);
      this.#dispatchStoredEvents(events);
      return;
    }

    await loaded.storage.appendEvents(entityId as never, events);
    try {
      await loaded.storage.writeSnapshot(snapshot);
    } finally {
      this.#dispatchStoredEvents(events);
    }
  }

  async #invokeAssignee(
    entity: object,
    methodName: string,
    message: unknown,
    parameterCount: HandlerParameterCount,
    context: unknown,
  ): Promise<unknown> {
    transactionalEntityAccess.start(entity);
    try {
      const produced = await invokeEntityMethod(
        entity,
        methodName,
        message,
        parameterCount,
        context,
      );
      const commit = transactionalEntityAccess.commit(entity);
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }

      return produced;
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    }
  }

  #bindProducedEvents(
    produced: readonly unknown[],
    entityId: unknown,
    lastVersion: bigint,
    allowEnvelopes: boolean,
  ): readonly Event[] {
    const dispatchVersion = lastVersion + 1n;
    let sequence = 0;

    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        const version = allowEnvelopes ? lastVersion + BigInt(sequence) : dispatchVersion;
        return this.#bindProducedEvent(signal, entityId, version, allowEnvelopes, sequence);
      }),
    );
  }

  #bindProducedEvent(
    signal: unknown,
    entityId: unknown,
    version: bigint,
    allowEnvelopes: boolean,
    sequence: number,
  ): Event {
    const producerId = runtimeProducerId(entityId);
    const metadata = this.#runtime.signalMetadata.eventFromCommand(this.#command, sequence, {
      ...(producerId === undefined ? {} : { producerId }),
      version: eventVersionNumber(version),
    });
    const bound =
      allowEnvelopes && isEventEnvelope(signal)
        ? clone(EventSchema, signal)
        : this.#packDomainEvent(signal, metadata);
    bound.context = metadata.context;
    return bound;
  }

  #packDomainEvent(
    message: unknown,
    metadata: ReturnType<SignalMetadata["eventFromCommand"]>,
  ): Event {
    const typeName = messageTypeName(message);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(`Repository aggregate execution cannot pack event message "${typeName}".`);
    }

    return create(EventSchema, {
      id: metadata.id,
      message: packAny(schema, message as never),
      context: metadata.context,
    });
  }

  #dispatchStoredEvents(events: readonly Event[]): void {
    for (const event of events) {
      void this.#runtime.dispatchStored(event).catch((error: unknown) => {
        this.#runtime.recordDispatchFailure(event, error);
      });
    }
  }
}

class AggregateEventExecution {
  readonly #repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  };
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #event: Event;
  readonly #support: AggregateExecutionSupport;

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
    this.#support = new AggregateExecutionSupport(
      repository,
      routing,
      runtime,
      storageContextForEvent(this.#runtime.context, this.#event),
    );
  }

  async run(): Promise<void> {
    const intake = this.#readIntake();

    if (intake.reactors.length === 0 && intake.commanders.length === 0) {
      return;
    }

    const commands: Command[] = [];

    for (const entityId of intake.route.entityIds) {
      commands.push(...(await this.#executeEntity(entityId, intake)));
    }

    await this.#postCommands(commands);
  }

  #readIntake(): {
    readonly message: unknown;
    readonly route: RepositoryEventRoute;
    readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
  } {
    const eventMessage = requireSignalMessage(this.#event.message, "event");
    const eventSchema = schemaForTypeUrl(this.#routing.eventSchemas, eventMessage.typeUrl, "event");
    const message = unpackRequired(eventMessage, eventSchema, "event");
    const route = this.#repository.routeEvent(this.#event);
    const reactors = this.#routing.eventReadiness
      ?.findEventReactors(route.messageFullTypeName)
      .filter((reactor) => handlerEmittedSchemas(reactor.handler).length > 0);
    const commanders = this.#routing.commandReactions(route.messageFullTypeName);

    return Object.freeze({
      message,
      route,
      reactors: Object.freeze([...(reactors ?? [])]),
      commanders,
    });
  }

  async #executeEntity(
    entityId: unknown,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
  ): Promise<readonly Command[]> {
    const usesAppliers = this.#support.usesAppliers();
    const loaded = await this.#support.loadAggregate(entityId, usesAppliers);
    const commands: Command[] = [];
    const produced = await this.#invokeHandlers(entityId, loaded, intake);

    for (const command of produced.commands) {
      commands.push(command);
    }

    if (produced.events.length > 0) {
      if (usesAppliers) {
        await this.#support.applyAggregateEvents(loaded.entity, produced.events, "command");
      }
      await this.#storeAggregateUpdate(
        loaded,
        entityId,
        usesAppliers ? loaded.version + BigInt(produced.events.length) : loaded.version + 1n,
        produced.events,
        usesAppliers,
      );
    }

    return Object.freeze(commands);
  }

  async #invokeHandlers(
    entityId: unknown,
    loaded: LoadedAggregate,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
  ): Promise<{ readonly commands: readonly Command[]; readonly events: readonly Event[] }> {
    const eventContext = eventHandlerContext(this.#event);
    const commands: Command[] = [];
    const events: Event[] = [];

    transactionalEntityAccess.start(loaded.entity);
    try {
      for (const commander of intake.commanders) {
        const produced = await invokeEntityMethod(
          loaded.entity,
          commander.handler.methodName,
          intake.message,
          commander.handler.parameterCount,
          eventContext,
        );
        commands.push(
          ...this.#bindProducedCommands(this.#support.normalizeProducedSignals(produced)),
        );
      }

      for (const reactor of intake.reactors) {
        const produced = await invokeEntityMethod(
          loaded.entity,
          reactor.handler.methodName,
          intake.message,
          reactor.handler.parameterCount,
          eventContext,
        );
        events.push(
          ...this.#bindProducedEvents(
            this.#support.normalizeProducedSignals(produced),
            entityId,
            loaded.version,
          ),
        );
      }

      const commit = transactionalEntityAccess.commit(loaded.entity);
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }

      return Object.freeze({
        commands: Object.freeze(commands),
        events: Object.freeze(events),
      });
    } catch (error) {
      transactionalEntityAccess.rollback(loaded.entity);
      throw error;
    }
  }

  async #postCommands(commands: readonly Command[]): Promise<void> {
    for (const command of commands) {
      await this.#runtime.onPostCommand(command);
    }
  }

  async #storeAggregateUpdate(
    loaded: {
      readonly entity: object;
      readonly storage: AggregateStorage<DescriptorMessageSchema>;
    },
    entityId: unknown,
    version: bigint,
    events: readonly Event[],
    usesAppliers: boolean,
  ): Promise<void> {
    const snapshot = {
      aggregateId: entityId as never,
      state: repositoryState(loaded.entity) as never,
      version,
      lifecycle: repositoryLifecycle(loaded.entity),
    };

    if (!usesAppliers) {
      await loaded.storage.writeSnapshotWithEvents(snapshot, events);
      this.#dispatchStoredEvents(events);
      return;
    }

    await loaded.storage.appendEvents(entityId as never, events);
    try {
      await loaded.storage.writeSnapshot(snapshot);
    } finally {
      this.#dispatchStoredEvents(events);
    }
  }

  #bindProducedEvents(
    produced: readonly unknown[],
    entityId: unknown,
    lastVersion: bigint,
  ): readonly Event[] {
    const version = lastVersion + 1n;
    let sequence = 0;

    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        return this.#bindProducedEvent(signal, entityId, version, sequence);
      }),
    );
  }

  #bindProducedEvent(signal: unknown, entityId: unknown, version: bigint, sequence: number): Event {
    const typeName = messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(`Repository aggregate execution cannot pack event message "${typeName}".`);
    }

    const producerId = runtimeProducerId(entityId);
    const metadata = this.#runtime.signalMetadata.eventFromEvent(this.#event, sequence, {
      ...(producerId === undefined ? {} : { producerId }),
      version: eventVersionNumber(version),
    });

    return create(EventSchema, {
      id: metadata.id,
      message: packAny(schema, signal as never),
      context: metadata.context,
    });
  }

  #bindProducedCommands(produced: readonly unknown[]): readonly Command[] {
    let sequence = 0;

    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        const typeName = messageTypeName(signal);
        const schema = this.#routing.producedCommandSchemas.find(
          (candidate) => candidate.typeName === typeName,
        );

        if (schema === undefined) {
          throw new Error(
            `Repository aggregate execution cannot pack command message "${typeName}".`,
          );
        }

        const metadata = this.#runtime.signalMetadata.commandFromEvent(this.#event, sequence);

        return create(CommandSchema, {
          id: metadata.id,
          message: packAny(schema, signal as never),
          context: metadata.context,
        });
      }),
    );
  }

  #dispatchStoredEvents(events: readonly Event[]): void {
    for (const event of events) {
      void this.#runtime.dispatchStoredFollowUp(event).catch((error: unknown) => {
        this.#runtime.recordDispatchFailure(event, error);
      });
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
    const intake = this.#readIntake();

    if (intake.subscribers.length === 0) {
      return;
    }

    for (const entityId of intake.route.entityIds) {
      await handoffProjectionEvent(this.#repository, this.#runtime, this.#event, entityId);
    }
  }

  async runTarget(entityId: unknown): Promise<void> {
    const intake = this.#readIntake();

    if (intake.subscribers.length === 0) {
      return;
    }

    await this.#executeTarget(entityId, intake.subscribers);
  }

  async runDirect(): Promise<void> {
    const intake = this.#readIntake();

    if (intake.subscribers.length === 0) {
      return;
    }

    for (const entityId of intake.route.entityIds) {
      await this.#executeTarget(entityId, intake.subscribers);
    }
  }

  async #executeTarget(entityId: unknown, subscribers: RepositoryEventSubscribers): Promise<void> {
    const message = unpackRequired(
      requireSignalMessage(this.#event.message, "event"),
      subscribers[0]?.handler.schema ?? this.#repository.stateSchema,
      "event",
    );
    const tenantOptions = standTenantOptions(this.#runtime.context, this.#event);
    const entity = await this.#loadProjection(entityId, tenantOptions);

    await this.#invokeSubscribers(entity, subscribers, message);
    await this.#storeIfChanged(entity, tenantOptions);
  }

  #readIntake(): {
    readonly route: RepositoryEventRoute;
    readonly subscribers: RepositoryEventSubscribers;
  } {
    const route = this.#repository.routeEvent(this.#event);
    const subscribers = this.#routing.eventReadiness?.findEventSubscribers(
      route.messageFullTypeName,
    );

    return Object.freeze({
      route,
      subscribers: Object.freeze([...(subscribers ?? [])]),
    });
  }

  async #storeIfChanged(
    entity: object,
    tenantOptions: { readonly tenantId?: string },
  ): Promise<void> {
    if (!repositoryChanged(entity)) {
      return;
    }

    await this.#runtime.stand.update(
      this.#repository.stateSchema,
      repositoryState(entity) as never,
      standUpdateOptions(tenantOptions.tenantId, this.#event.context?.version),
    );
  }

  async #invokeSubscribers(
    entity: object,
    subscribers: RepositoryEventSubscribers,
    message: unknown,
  ): Promise<void> {
    transactionalEntityAccess.start(entity);
    try {
      for (const subscriber of subscribers) {
        const eventContext = eventHandlerContext(this.#event);
        await invokeEntityMethod(
          entity,
          subscriber.handler.methodName,
          message,
          subscriber.handler.parameterCount,
          eventContext,
        );
      }
      const commit = transactionalEntityAccess.commit(entity);
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
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

class ProcessManagerExecutionSupport {
  readonly #repository: RepositoryView;
  readonly #runtime: RepositoryRuntime;

  constructor(repository: RepositoryView, runtime: RepositoryRuntime) {
    this.#repository = repository;
    this.#runtime = runtime;
  }

  normalizeProducedSignals(produced: unknown): readonly unknown[] {
    if (produced === undefined) {
      return Object.freeze([]);
    }

    if (Array.isArray(produced)) {
      return Object.freeze(Array.from(produced as readonly unknown[]));
    }

    return Object.freeze([produced]);
  }

  async load(entityId: unknown, options: { readonly tenantId?: string }): Promise<object> {
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

  async storeIfChanged(entity: object, options: { readonly tenantId?: string }): Promise<void> {
    if (!repositoryChanged(entity)) {
      return;
    }

    await this.#runtime.stand.update(
      this.#repository.stateSchema,
      repositoryState(entity) as never,
      standUpdateOptions(
        options.tenantId,
        create(VersionSchema, { number: processManagerVersion(entity) }),
      ),
    );
  }

  #defaultState(entityId: unknown): unknown {
    return create(this.#repository.stateSchema, {
      [this.#repository.idField.localName]: entityId,
    });
  }
}

class ProcessManagerCommandExecution {
  readonly #repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  };
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #command: Command;
  readonly #support: ProcessManagerExecutionSupport;

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
    this.#support = new ProcessManagerExecutionSupport(repository, runtime);
  }

  async run(): Promise<void> {
    requireCommandId(this.#command);
    const commandMessage = requireSignalMessage(this.#command.message, "command");
    const commandSchema = schemaForTypeUrl(
      this.#routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );
    const message = unpackRequired(commandMessage, commandSchema, "command");
    const route = this.#repository.routeCommand(this.#command);
    const assignee = this.#routing.commandReadiness?.findCommandAssignee(route.messageFullTypeName);

    if (assignee === undefined) {
      return;
    }

    const tenantOptions = commandStandOptions(this.#runtime.context, this.#command);
    const entity = await this.#support.load(route.entityId, tenantOptions);
    const eventSignals = await this.#invoke(entity, assignee, message);

    await this.#support.storeIfChanged(entity, tenantOptions);
    this.#postEvents(this.#bindProducedEvents(eventSignals, route.entityId));
  }

  async #invoke(
    entity: object,
    assignee: RepositoryCommandAssignee,
    message: unknown,
  ): Promise<readonly unknown[]> {
    transactionalEntityAccess.start(entity);
    try {
      const produced = await invokeEntityMethod(
        entity,
        assignee.handler.methodName,
        message,
        assignee.handler.parameterCount,
        commandHandlerContext(this.#command),
      );
      const commit = transactionalEntityAccess.commit(entity);
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }

      return this.#support.normalizeProducedSignals(produced);
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    }
  }

  #bindProducedEvents(produced: readonly unknown[], entityId: unknown): readonly Event[] {
    let sequence = 0;
    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        return this.#bindProducedEvent(signal, entityId, sequence);
      }),
    );
  }

  #bindProducedEvent(signal: unknown, entityId: unknown, sequence: number): Event {
    const typeName = messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(
        `Repository process-manager execution cannot pack event message "${typeName}".`,
      );
    }

    const producerId = runtimeProducerId(entityId);
    const metadata = this.#runtime.signalMetadata.eventFromCommand(this.#command, sequence, {
      ...(producerId === undefined ? {} : { producerId }),
      version: processManagerProducedVersion(sequence),
    });

    return create(EventSchema, {
      id: metadata.id,
      message: packAny(schema, signal as never),
      context: metadata.context,
    });
  }

  #postEvents(events: readonly Event[]): void {
    for (const event of events) {
      void this.#runtime.postEventFollowUp(event).catch((error: unknown) => {
        this.#runtime.recordDispatchFailure(event, error);
      });
    }
  }
}

class ProcessManagerEventExecution {
  readonly #repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  };
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #event: Event;
  readonly #support: ProcessManagerExecutionSupport;

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
    this.#support = new ProcessManagerExecutionSupport(repository, runtime);
  }

  async run(): Promise<void> {
    const intake = this.#readIntake();

    if (intake.reactors.length === 0 && intake.commanders.length === 0) {
      return;
    }

    this.#validateSourceEventIdForFollowUps(intake);

    if (intake.route.entityIds.length === 1) {
      await handoffPmEvent(this.#repository, this.#runtime, this.#event, intake.route.entityIds[0]);
      return;
    }

    await handoffPmEvents(this.#repository, this.#runtime, this.#event, intake.route.entityIds);
  }

  async runTarget(entityId: unknown): Promise<void> {
    const intake = this.#readIntake();

    if (intake.reactors.length === 0 && intake.commanders.length === 0) {
      return;
    }

    this.#validateSourceEventIdForFollowUps(intake);
    await this.#executeEntity(entityId, intake);
  }

  #readIntake(): {
    readonly message: unknown;
    readonly route: RepositoryEventRoute;
    readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
  } {
    const eventMessage = requireSignalMessage(this.#event.message, "event");
    const eventSchema = schemaForTypeUrl(this.#routing.eventSchemas, eventMessage.typeUrl, "event");
    const message = unpackRequired(eventMessage, eventSchema, "event");
    const route = this.#repository.routeEvent(this.#event);
    const reactors = this.#routing.eventReadiness?.findEventReactors(route.messageFullTypeName);
    const commanders = this.#routing.commandReactions(route.messageFullTypeName);

    return Object.freeze({
      message,
      route,
      reactors: Object.freeze([...(reactors ?? [])]),
      commanders,
    });
  }

  async #executeEntity(
    entityId: unknown,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
  ): Promise<void> {
    const tenantOptions = standTenantOptions(this.#runtime.context, this.#event);
    const entity = await this.#support.load(entityId, tenantOptions);
    const produced = await this.#invokeHandlers(entity, intake);

    await this.#support.storeIfChanged(entity, tenantOptions);
    this.#postEvents(this.#bindProducedEvents(produced.events, entityId));
    await this.#postCommands(this.#bindProducedCommands(produced.commands));
  }

  #validateSourceEventIdForFollowUps(intake: {
    readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
  }): void {
    const emitsFollowUpEvents = intake.reactors.some(
      (reactor) => handlerEmittedSchemas(reactor.handler).length > 0,
    );

    if (!emitsFollowUpEvents && intake.commanders.length === 0) {
      return;
    }

    void this.#runtime.signalMetadata.originFromEvent(this.#event);
  }

  async #invokeHandlers(
    entity: object,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
  ): Promise<{ readonly commands: readonly unknown[]; readonly events: readonly unknown[] }> {
    const eventContext = eventHandlerContext(this.#event);
    const commands: unknown[] = [];
    const events: unknown[] = [];

    transactionalEntityAccess.start(entity);
    try {
      for (const reactor of intake.reactors) {
        const produced = await invokeEntityMethod(
          entity,
          reactor.handler.methodName,
          intake.message,
          reactor.handler.parameterCount,
          eventContext,
        );
        events.push(...this.#support.normalizeProducedSignals(produced));
      }

      for (const commander of intake.commanders) {
        const produced = await invokeEntityMethod(
          entity,
          commander.handler.methodName,
          intake.message,
          commander.handler.parameterCount,
          eventContext,
        );
        commands.push(...this.#support.normalizeProducedSignals(produced));
      }

      const commit = transactionalEntityAccess.commit(entity);
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }

      return Object.freeze({
        commands: Object.freeze(commands),
        events: Object.freeze(events),
      });
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    }
  }

  #bindProducedEvents(produced: readonly unknown[], entityId: unknown): readonly Event[] {
    let sequence = 0;
    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        return this.#bindProducedEvent(signal, entityId, sequence);
      }),
    );
  }

  #bindProducedEvent(signal: unknown, entityId: unknown, sequence: number): Event {
    const typeName = messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(
        `Repository process-manager execution cannot pack event message "${typeName}".`,
      );
    }

    const producerId = runtimeProducerId(entityId);
    const metadata = this.#runtime.signalMetadata.eventFromEvent(this.#event, sequence, {
      ...(producerId === undefined ? {} : { producerId }),
      version: processManagerProducedVersion(sequence),
    });

    return create(EventSchema, {
      id: metadata.id,
      message: packAny(schema, signal as never),
      context: metadata.context,
    });
  }

  #bindProducedCommands(produced: readonly unknown[]): readonly Command[] {
    let sequence = 0;
    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        const typeName = messageTypeName(signal);
        const schema = this.#routing.producedCommandSchemas.find(
          (candidate) => candidate.typeName === typeName,
        );

        if (schema === undefined) {
          throw new Error(
            `Repository process-manager execution cannot pack command message "${typeName}".`,
          );
        }

        const metadata = this.#runtime.signalMetadata.commandFromEvent(this.#event, sequence);

        return create(CommandSchema, {
          id: metadata.id,
          message: packAny(schema, signal as never),
          context: metadata.context,
        });
      }),
    );
  }

  async #postCommands(commands: readonly Command[]): Promise<void> {
    for (const command of commands) {
      await this.#runtime.onPostCommand(command);
    }
  }

  #postEvents(events: readonly Event[]): void {
    for (const event of events) {
      void this.#runtime.postEventFollowUp(event).catch((error: unknown) => {
        this.#runtime.recordDispatchFailure(event, error);
      });
    }
  }
}

function isEventEnvelope(signal: unknown): signal is Event {
  return (
    typeof signal === "object" &&
    signal !== null &&
    (signal as { readonly $typeName?: unknown }).$typeName === EventSchema.typeName
  );
}

function messageTypeName(message: unknown): string {
  const typeName = (message as { readonly $typeName?: unknown }).$typeName;

  if (typeof typeName !== "string" || typeName.length === 0) {
    throw new Error("Repository aggregate execution requires a generated event message.");
  }

  return typeName;
}

function historyVersion(snapshotVersion: bigint | undefined, events: readonly Event[]): bigint {
  const lastEvent = events.at(-1);

  return lastEvent === undefined ? (snapshotVersion ?? 0n) : readEventVersion(lastEvent);
}

function invokeEntityMethod(
  entity: object,
  methodName: string,
  message: unknown,
  parameterCount: HandlerParameterCount = 1,
  context?: unknown,
): unknown {
  const method = (entity as Record<string, unknown>)[methodName];

  if (typeof method !== "function") {
    throw new TypeError(`Repository entity execution requires method "${methodName}".`);
  }

  return Reflect.apply(method, entity, parameterCount === 2 ? [message, context] : [message]);
}

function commandHandlerContext(command: Command): NonNullable<Command["context"]> {
  return command.context === undefined
    ? create(CommandContextSchema)
    : clone(CommandContextSchema, command.context);
}

function eventHandlerContext(event: Event): NonNullable<Event["context"]> {
  return event.context === undefined
    ? create(EventContextSchema)
    : clone(EventContextSchema, event.context);
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

function runtimeProducerId(entityId: unknown): string | number | boolean | undefined {
  return PrimitiveIds.readFinite(entityId);
}

function requireCommandId(command: Command): NonNullable<Command["id"]> {
  if (command.id === undefined || command.id.uuid.trim().length === 0) {
    throw new Error("Repository aggregate execution requires command.id to bind event origins.");
  }

  return command.id;
}

function requireEventId(event: Event): NonNullable<Event["id"]> {
  if (event.id === undefined || event.id.value.trim().length === 0) {
    throw new Error("Repository projection inbox handoff requires event.id.");
  }

  return event.id;
}

function inboxTargetId(entityId: unknown): string {
  const primitive = PrimitiveIds.readFinite(entityId) ?? MessageIds.readValue(entityId);

  if (primitive === undefined) {
    throw new Error("Repository process-manager inbox handoff requires a readable target ID.");
  }

  return String(primitive);
}

function processManagerDeliveryContext(
  context: StorageContext,
  tenantId: string | undefined,
): StorageContext {
  if (!context.multitenant) {
    return context;
  }

  const tid = tenantId;
  if (tid === undefined) {
    throw new Error(
      `Multitenant process-manager inbox handoff for "${context.name}" requires tenantId.`,
    );
  }

  return Object.freeze({
    name: context.name,
    multitenant: true,
    tenantId: tid,
  });
}

function projectionDeliveryContext(
  context: StorageContext,
  tenantId: string | undefined,
): StorageContext {
  if (!context.multitenant) {
    return context;
  }

  const tid = tenantId;
  if (tid === undefined) {
    throw new Error(
      `Multitenant projection inbox handoff for "${context.name}" requires tenantId.`,
    );
  }

  return Object.freeze({
    name: context.name,
    multitenant: true,
    tenantId: tid,
  });
}

function requireProjectionTenant(context: StorageContext, event: Event): string | undefined {
  if (!context.multitenant) {
    return undefined;
  }

  const tenantId = readEventTenant(event) ?? context.tenantId;

  if (tenantId === undefined || tenantId.trim() === "") {
    throw new Error(
      `Multitenant projection inbox handoff for "${context.name}" requires tenantId.`,
    );
  }

  return tenantId;
}

function requirePmEventTenant(
  context: StorageContext,
  event: Event,
): string | undefined {
  if (!context.multitenant) {
    return undefined;
  }

  const tenantId = readEventTenant(event) ?? context.tenantId;

  if (tenantId === undefined || tenantId.trim() === "") {
    throw new Error(
      `Multitenant process-manager inbox handoff for "${context.name}" requires tenantId.`,
    );
  }

  return tenantId;
}

function requireProcessManagerTenant(
  context: StorageContext,
  command: Command,
): string | undefined {
  if (!context.multitenant) {
    return undefined;
  }

  const tenantId = readCommandTenant(command);

  if (tenantId === undefined || tenantId.trim() === "") {
    throw new Error(
      `Multitenant process-manager inbox handoff for "${context.name}" requires tenantId.`,
    );
  }

  return tenantId;
}

function readInboxCommand(message: InboxMessage): Command {
  if (message.label !== "HANDLE_COMMAND") {
    throw new Error(`Process-manager inbox replay does not handle "${message.label}" messages.`);
  }

  const command =
    message.signal === undefined ? undefined : unpackAny(message.signal, CommandSchema);

  if (command === undefined) {
    throw CommandValidationError.invalidPayload();
  }

  return command;
}

function readPmInboxEvent(message: InboxMessage): Event {
  return readStoredEvent(
    message,
    "REACT_UPON_EVENT",
    "Process-manager inbox replay",
    "Process-manager inbox replay requires a readable stored event.",
  );
}

function readProjectionInboxEvent(message: InboxMessage): Event {
  return readStoredEvent(
    message,
    "UPDATE_SUBSCRIBER",
    "Projection inbox replay",
    "Projection inbox replay requires a readable stored event.",
  );
}

function readStoredEvent(
  message: InboxMessage,
  expectedLabel: InboxMessage["label"],
  replayName: string,
  unreadableMessage: string,
): Event {
  if (message.label !== expectedLabel) {
    throw new Error(`${replayName} does not handle "${message.label}" messages.`);
  }

  const signal =
    message.signal === undefined
      ? undefined
      : create(AnySchema, {
          typeUrl: message.signal.typeUrl,
          value: new Uint8Array(message.signal.value),
        });
  const event = signal === undefined ? undefined : unpackAny(signal, EventSchema);

  if (event === undefined) {
    throw new Error(unreadableMessage);
  }

  return event;
}

function validateReplayedCommandPayload(routing: RepositoryRouting, command: Command): void {
  const commandMessage = requireSignalMessage(command.message, "command");
  const commandSchema = schemaForTypeUrl(routing.commandSchemas, commandMessage.typeUrl, "command");
  const payload = unpackAny(commandMessage, commandSchema);

  if (payload === undefined) {
    throw CommandValidationError.invalidPayload();
  }

  try {
    checkValid(commandSchema, payload);
  } catch (error) {
    if (error instanceof ValidationException) {
      throw new CommandValidationError(error.asMessage());
    }
    throw error;
  }
}

function validateReplayedEventPayload(
  routing: RepositoryRouting,
  event: Event,
  invalidPayloadMessage = "Projection inbox replay requires a readable event payload.",
): void {
  const eventMessage = requireSignalMessage(event.message, "event");
  const eventSchema = schemaForTypeUrl(routing.eventSchemas, eventMessage.typeUrl, "event");
  const payload = unpackAny(eventMessage, eventSchema);

  if (payload === undefined) {
    throw new Error(invalidPayloadMessage);
  }

  checkValid(eventSchema, payload);
}

function validateReplayTenant(
  context: StorageContext,
  deliveryTenantId: string | undefined,
  command: Command,
): void {
  if (!context.multitenant) {
    return;
  }

  if (deliveryTenantId === undefined || deliveryTenantId.trim() === "") {
    throw new Error(
      `Multitenant process-manager inbox replay for "${context.name}" requires tenantId.`,
    );
  }

  const envelopeTenantId = readCommandTenant(command);

  if (envelopeTenantId === undefined || envelopeTenantId.trim() === "") {
    throw new Error("Process-manager inbox replay requires stored command tenant metadata.");
  }
  if (envelopeTenantId !== deliveryTenantId) {
    throw new Error("Process-manager inbox replay stored command tenant does not match.");
  }
}

function validateProjectionReplayTenant(
  context: StorageContext,
  deliveryTenantId: string | undefined,
  event: Event,
): void {
  if (!context.multitenant) {
    return;
  }

  if (deliveryTenantId === undefined || deliveryTenantId.trim() === "") {
    throw new Error(`Multitenant projection inbox replay for "${context.name}" requires tenantId.`);
  }

  const envelopeTenantId = readEventTenant(event) ?? context.tenantId;

  if (envelopeTenantId === undefined || envelopeTenantId.trim() === "") {
    throw new Error("Projection inbox replay requires stored event tenant metadata.");
  }
  if (envelopeTenantId !== deliveryTenantId) {
    throw new Error("Projection inbox replay stored event tenant does not match.");
  }
}

function validatePmReplayTenant(
  context: StorageContext,
  deliveryTenantId: string | undefined,
  event: Event,
): void {
  if (!context.multitenant) {
    return;
  }

  if (deliveryTenantId === undefined || deliveryTenantId.trim() === "") {
    throw new Error(
      `Multitenant process-manager inbox replay for "${context.name}" requires tenantId.`,
    );
  }

  const envelopeTenantId = readEventTenant(event) ?? context.tenantId;

  if (envelopeTenantId === undefined || envelopeTenantId.trim() === "") {
    throw new Error("Process-manager inbox replay requires stored event tenant metadata.");
  }
  if (envelopeTenantId !== deliveryTenantId) {
    throw new Error("Process-manager inbox replay stored event tenant does not match.");
  }
}

function validateReplayTarget(
  repository: RepositoryView & {
    routeCommand(command: Command): RepositoryCommandRoute;
  },
  message: InboxMessage,
  command: Command,
): void {
  const expectedTargetTypeUrl = deriveTypeUrl(repository.stateSchema);

  if (message.inboxId.targetTypeUrl !== expectedTargetTypeUrl) {
    throw new Error(
      "Process-manager inbox replay stored target type does not match the routed repository.",
    );
  }

  const route = repository.routeCommand(command);
  const expectedTargetId = inboxTargetId(route.entityId);

  if (message.inboxId.targetId !== expectedTargetId) {
    throw new Error(
      "Process-manager inbox replay stored target ID does not match the routed command.",
    );
  }
}

function replayProcessManagerId(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  message: InboxMessage,
  event: Event,
): unknown {
  const expectedTargetTypeUrl = deriveTypeUrl(repository.stateSchema);

  if (message.inboxId.targetTypeUrl !== expectedTargetTypeUrl) {
    throw new Error(
      "Process-manager inbox replay stored target type does not match the routed repository.",
    );
  }

  const route = repository.routeEvent(event);
  const entityId = route.entityIds.find((id) => inboxTargetId(id) === message.inboxId.targetId);

  if (entityId === undefined) {
    throw new Error(
      "Process-manager inbox replay stored target ID does not match the routed event.",
    );
  }

  return entityId;
}

function replayProjectionId(
  repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  },
  message: InboxMessage,
  event: Event,
): unknown {
  const expectedTargetTypeUrl = deriveTypeUrl(repository.stateSchema);

  if (message.inboxId.targetTypeUrl !== expectedTargetTypeUrl) {
    throw new Error(
      "Projection inbox replay stored target type does not match the routed repository.",
    );
  }

  const route = repository.routeEvent(event);
  const entityId = route.entityIds.find((id) => inboxTargetId(id) === message.inboxId.targetId);

  if (entityId === undefined) {
    throw new Error("Projection inbox replay stored target ID does not match the routed event.");
  }

  return entityId;
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

function storageContextForEvent(context: StorageContext, event: Event): StorageContext {
  if (!context.multitenant) {
    return context;
  }

  const tenantId = readEventTenant(event) ?? context.tenantId;
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

function commandStandOptions(
  context: StorageContext,
  command: Command,
): { readonly tenantId?: string } {
  if (!context.multitenant) {
    return {};
  }

  const tenantId = readCommandTenant(command) ?? context.tenantId;
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

function processManagerVersion(entity: object): number {
  const version = (entity as { readonly version?: unknown }).version;

  return typeof version === "number" ? version + 1 : 1;
}

function processManagerProducedVersion(sequence: number): number {
  return sequence;
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
  entityFamily: EntityFamily,
  metadata: EntityMetadata,
  handlersOption: RepositoryHandlersOption,
  producedEvents: readonly MessageSchema[],
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
      ...handler.commandReactions.map((reaction) => reaction.schema),
      ...handler.eventSubscriptions.map((subscription) => subscription.schema),
      ...handler.eventReactions.map((reaction) => reaction.schema),
      ...handler.eventApplications.map((application) => application.schema),
    ]),
  );
  const eventApplicationSchemas = uniqueSchemas(
    handlers.flatMap((handler) =>
      handler.eventApplications.map((application) => application.schema),
    ),
  );
  const producedEventSchemas = uniqueSchemas([
    ...eventApplicationSchemas,
    ...producedEvents,
    ...handlers.flatMap((handler) => [
      ...handler.commandAssignments.flatMap((assignment) => handlerEmittedSchemas(assignment)),
      ...handler.eventReactions.flatMap((reaction) => handlerEmittedSchemas(reaction)),
    ]),
  ]);
  const producedCommandSchemas = uniqueSchemas(
    handlers.flatMap((handler) =>
      handler.commandReactions.flatMap((reaction) => handlerEmittedSchemas(reaction)),
    ),
  );
  const commandReactions = createCommandReactionMap(handlers);

  return Object.freeze({
    commandSchemas,
    eventSchemas,
    eventApplicationSchemas,
    producedEventSchemas,
    producedCommandSchemas,
    commandReadiness,
    eventReadiness,
    commandReactions: (eventFullTypeName: string) =>
      Object.freeze([...(commandReactions.get(eventFullTypeName) ?? [])]),
    routeCommand: (command: Command) =>
      routeCommand<RepositoryEntityId<EntityType>>(
        command,
        commandReadiness,
        commandSchemas,
        metadata.idField,
      ),
    routeEvent: (event: Event) =>
      routeEvent<RepositoryEntityId<EntityType>>(
        event,
        eventReadiness,
        commandReactions,
        eventSchemas,
        metadata.idField,
        entityFamily,
      ),
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

function createCommandReactionMap(
  handlers: readonly EntityHandlersMetadata[],
): ReadonlyMap<string, readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[]> {
  const byEvent = new Map<string, RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[]>();
  const registry = new HandlerMetadataRegistry(handlers);

  for (const entry of registry.findHandlersByKind("command-reaction")) {
    if (handlerEmittedSchemas(entry.handler).length === 0) {
      continue;
    }
    pushMapValue(byEvent, entry.handler.messageFullTypeName, entry);
  }

  return byEvent;
}

function handlerEmittedSchemas(
  handler:
    | CommandAssignmentHandlerMetadata
    | CommandReactionHandlerMetadata
    | EventReactionHandlerMetadata,
): readonly DescriptorMessageSchema[] {
  return handlerMetadataAccess.emittedSchemas(handler);
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

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key);

  if (values === undefined) {
    map.set(key, [value]);
    return;
  }

  values.push(value);
}

function routeCommand<Id>(
  command: Command,
  readiness: CommandRegistrationReadinessLookup | undefined,
  schemas: readonly MessageSchema[],
  targetIdField: DescriptorFieldMetadata,
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
    entityId: readRouteId(readFirstFieldId(message, schema, "command"), targetIdField, "command")
      .id as Id,
    messageFullTypeName: schema.typeName,
    invocation: "deferred",
  });
}

function routeEvent<Id>(
  event: Event,
  readiness: EventRegistrationReadinessLookup | undefined,
  commandReactions: ReadonlyMap<
    string,
    readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[]
  >,
  schemas: readonly MessageSchema[],
  targetIdField: DescriptorFieldMetadata,
  entityFamily: EntityFamily,
): RepositoryEventRoute<Id> {
  const message = event.message;
  if (message === undefined || message.typeUrl === "") {
    throw new Error("Repository event routing requires event.message.typeUrl.");
  }

  const schema = schemaForTypeUrl(schemas, message.typeUrl, "event");
  const hasReceiver =
    (commandReactions.get(schema.typeName)?.length ?? 0) > 0 ||
    (readiness?.findEventSubscribers(schema.typeName).length ?? 0) > 0 ||
    (readiness?.findEventReactors(schema.typeName).length ?? 0) > 0 ||
    (readiness?.findEventApplications(schema.typeName).length ?? 0) > 0;
  if (!hasReceiver) {
    throw new Error(`Repository event routing has no receiver for "${schema.typeName}".`);
  }

  const targetId =
    entityFamily === "process-manager"
      ? readRouteId(readFirstFieldId(message, schema, "event"), targetIdField, "event").id
      : readEventEntityId(event, message, schema, targetIdField);

  return Object.freeze({
    entityIds: Object.freeze([targetId as Id]),
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
  if (value === undefined || value === null || isBlankRouteId(value)) {
    throw new Error(`Repository ${signalKind} routing requires a non-empty first field.`);
  }

  return value;
}

function isBlankRouteId(value: unknown): boolean {
  const id = PrimitiveIds.readFinite(value) ?? MessageIds.readValue(value);

  return typeof id === "string" && id.trim().length === 0;
}

function readProducerId(event: Event): string | number | boolean | undefined {
  const producerId = event.context?.producerId;
  if (producerId === undefined) {
    return undefined;
  }

  const unpacked = PrimitiveIds.unpack(producerId);
  if (PrimitiveIds.readFinite(unpacked) !== undefined) {
    return unpacked;
  }
  if (unpacked !== undefined) {
    throw new Error("Repository event routing requires a finite producer ID.");
  }
  throw new Error("Repository event routing requires a readable producer ID.");
}

function readEventEntityId(
  event: Event,
  message: NonNullable<Event["message"]>,
  schema: MessageSchema,
  targetIdField: DescriptorFieldMetadata,
): unknown {
  const producerId = readProducerId(event);
  const fieldId = readRouteId(readFirstFieldId(message, schema, "event"), targetIdField, "event");

  if (producerId !== undefined && producerId !== fieldId.value) {
    throw new Error(
      "Repository event routing requires producer ID and first field to identify the same entity.",
    );
  }

  return producerId === undefined || targetIdField.descriptor.fieldKind === "message"
    ? fieldId.id
    : producerId;
}

interface RoutableId {
  readonly id: unknown;
  readonly value: string | number | boolean;
}

function readRouteId(
  value: unknown,
  targetIdField: DescriptorFieldMetadata,
  signalKind: "command" | "event",
): RoutableId {
  const descriptor = targetIdField.descriptor;
  if (descriptor.fieldKind === "message") {
    return readMessageRouteId(value, descriptor.message.typeName, signalKind);
  }
  return readPrimitiveRouteId(value, signalKind);
}

function readMessageRouteId(
  value: unknown,
  targetTypeName: string,
  signalKind: "command" | "event",
): RoutableId {
  const id = MessageIds.read(value);
  if (id === undefined) {
    throw new Error(`Repository ${signalKind} routing requires a single-field message ID.`);
  }
  if (id.$typeName !== targetTypeName) {
    throw new Error(`Repository ${signalKind} routing requires a "${targetTypeName}" ID.`);
  }

  return Object.freeze({
    id,
    value: id.value,
  });
}

function readPrimitiveRouteId(value: unknown, signalKind: "command" | "event"): RoutableId {
  const messageValue = MessageIds.readValue(value);
  const id = PrimitiveIds.readFinite(messageValue ?? value);
  if (id === undefined) {
    throw new Error(
      `Repository ${signalKind} routing requires a finite primitive or single-field message ID.`,
    );
  }

  return Object.freeze({
    id,
    value: id,
  });
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
