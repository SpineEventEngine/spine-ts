import { clone, create, type Message } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  ValidationException,
  type MessageSchema,
  RejectionThrowable,
  Validate,
  TypeUrls,
  AnyMessages,
} from "@spine-event-engine/core";
import {
  CommandContextSchema,
  CommandSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  RejectionEventContextSchema,
  type Command,
  type Event,
  type TenantId,
  type Version,
  VersionSchema,
} from "@spine-event-engine/proto";
import {
  EventStore,
  RecordColumn,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";

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
  entityHistoryAccess,
  transactionalEntityAccess,
} from "../entity/entity.js";
import {
  describeEntityMetadata,
  type DescriptorFieldMetadata,
  type DescriptorMessageSchema,
  type EntityMetadata,
  type FirstFieldRoutingHint,
} from "../entity/entity-metadata.js";
import { entityStorageDescriptor } from "../entity/entity-storage-descriptor.js";
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
import { standAccess, type Stand } from "../stand/stand.js";
import { TransitionValidationError } from "./command-errors.js";
import { MessageIds, PrimitiveIds } from "./primitive-id.js";

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
  /** Retain a state-history row after each successful logical store. Defaults to false. */
  readonly stateHistory?: boolean;
  /** Retain process-manager diagnostic events. Defaults to false; aggregate events are retained. */
  readonly processManagerEventHistory?: boolean;
  /**
   * Enables a bounded best-effort, in-process duplicate-dispatch guard.
   *
   * The guard is disabled by default and uses depth 100 when enabled without
   * an explicit depth. Projection repositories cannot enable it. Process
   * Manager repositories must also enable `processManagerEventHistory`.
   */
  readonly doubleDispatchGuard?: boolean | { readonly depth?: number };
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
 * execute aggregate commands through repository-owned assignees and live
 * direct transactional handlers, persist the latest aggregate state plus a diagnostic event journal,
 * and hand already-stored events to the event bus. Aggregate and process-manager command
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
    repositoryHistoryConfigurations.set(
      this,
      readHistoryConfiguration(options, this.#entityFamily),
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

  /**
   * Enables or disables future state-history appends for this repository.
   *
   * This JVM-parity switch is for controlled administration/testing, not
   * routine request-time behavior. It never deletes or reconstructs history.
   */
  setStateHistoryEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") {
      throw new TypeError("Repository state-history switch requires a boolean.");
    }
    historyConfiguration(this).stateHistory = enabled;
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
 * Built bounded contexts may execute aggregate command assignees and event reactions through their
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
const repositoryEntityHandles = new WeakMap<RepositoryView, Map<string, { close(): void }>>();
const entityStateHistoryCaches = new WeakMap<object, { clear(): void }>();
interface RepositoryHistoryConfiguration {
  stateHistory: boolean;
  readonly processManagerEventHistory: boolean;
  readonly dispatchGuardDepth: number | undefined;
}
const repositoryHistoryConfigurations = new WeakMap<
  RepositoryView,
  RepositoryHistoryConfiguration
>();
interface DispatchGuard {
  readonly completed: Set<string>;
  readonly order: string[];
  chain: Promise<void>;
  active: number;
}
interface RepositoryDispatchGuards {
  readonly lanes: Map<string, DispatchGuard>;
  readonly order: string[];
}
const repositoryDispatchGuards = new WeakMap<RepositoryView, RepositoryDispatchGuards>();
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
  /** Supported delivery labels configured for this target. */
  readonly labels: readonly ProcessManagerInboxLabel[];
  /** Replays one durable inbox message under the active delivery tenant. */
  replay(message: ProcessManagerInboxMessage, deliveryTenantId?: string): Promise<void>;
}

/** @internal Context-owned process-manager inbox handoff capability. */
export interface ProcessManagerInbox {
  /** Replays one already-durable inbox row through registered process-manager targets. */
  replay(message: InboxMessage, deliveryTenantId?: string): Promise<void>;
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
type ProjectionInboxMessage = InboxMessage & {
  readonly label: "UPDATE_SUBSCRIBER";
  readonly status: "TO_DELIVER";
};

type ProjectionInboxInput = Omit<InboxMessageInput, "whenReceived" | "version"> & {
  readonly label: "UPDATE_SUBSCRIBER";
  readonly status: "TO_DELIVER";
};

export interface ProjectionInboxTarget {
  /** Target projection state type URL routed by this replay target. */
  readonly targetTypeUrl: string;
  /** Replays one durable inbox event under the active delivery tenant. */
  replay(message: ProjectionInboxMessage, deliveryTenantId?: string): Promise<void>;
}

/** @internal Context-owned projection subscriber inbox handoff capability. */
export interface ProjectionInbox {
  /** Replays one already-durable inbox row through registered projection targets. */
  replay(message: InboxMessage, deliveryTenantId?: string): Promise<void>;
  /** Writes a durable inbox row and waits for that exact row to be delivered locally. */
  receive(
    delivery: Delivery,
    input: ProjectionInboxInput,
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
    repositoryDispatchGuards.delete(repository);
    const handles = repositoryEntityHandles.get(repository);
    if (handles !== undefined) {
      for (const handle of handles.values()) handle.close();
      handles.clear();
    }
  },
});

interface RepositoryDispatchers {
  readonly command: CommandDispatcher | undefined;
  readonly event: EventDispatcher | undefined;
}

interface RepositoryRouting<Id = unknown> {
  readonly commandSchemas: readonly MessageSchema[];
  readonly eventSchemas: readonly MessageSchema[];
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
    targetTypeUrl: TypeUrls.derive(repository.stateSchema),
    labels: Object.freeze([
      ...(routing.commandSchemas.length === 0 ? [] : (["HANDLE_COMMAND"] as const)),
      ...(routing.eventSchemas.length === 0 ? [] : (["REACT_UPON_EVENT"] as const)),
    ]),
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
    targetTypeUrl: TypeUrls.derive(repository.stateSchema),
    replay: (message: ProjectionInboxMessage, deliveryTenantId?: string): Promise<void> =>
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
    case "aggregate": {
      const execution = new AggregateEventExecution(repository, routing, runtime, event);
      for (const entityId of repository.routeEvent(event).entityIds) {
        await guardedEntityEventDispatch(repository, runtime, event, entityId, () =>
          execution.runTarget(entityId),
        );
      }
      return;
    }
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
        targetTypeUrl: TypeUrls.derive(repository.stateSchema),
      },
      signalId: commandId.uuid,
      signal: AnyMessages.pack(CommandSchema, command),
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
        targetTypeUrl: TypeUrls.derive(repository.stateSchema),
      },
      signalId: eventId.value,
      signal: AnyMessages.pack(EventSchema, event, { validate: false }),
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
      targetTypeUrl: TypeUrls.derive(repository.stateSchema),
    },
    signalId,
    signal: AnyMessages.pack(EventSchema, event, { validate: false }),
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
  readonly states: EntityStateHistoryPort<unknown, Message>;
  readonly events: EntityEventHistoryPort<unknown>;
  readonly version: bigint;
}

class AggregateExecutionSupport {
  readonly #repository: RepositoryView;
  readonly #runtime: RepositoryRuntime;
  readonly #storageContext: StorageContext;

  constructor(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    storageContext: StorageContext,
  ) {
    this.#repository = repository;
    this.#runtime = runtime;
    this.#storageContext = storageContext;
  }

  async loadAggregate(entityId: unknown): Promise<LoadedAggregate> {
    const storage = openRepositoryEntityStorage(
      this.#repository,
      this.#runtime.storageFactory,
      entityStorageInput(this.#repository, this.#storageContext),
    );
    const current = await standAccess.readCurrent(
      this.#runtime.stand,
      this.#repository.stateSchema,
      entityId,
      this.#storageContext.tenantId === undefined
        ? {}
        : { tenantId: this.#storageContext.tenantId },
    );
    const entity = this.#instantiateAggregate(entityId, current);
    bindEntityHistory(entity, storage, entityId);

    return Object.freeze({
      entity,
      states: storage.states,
      events: storage.events,
      version: current?.version ?? 0n,
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

  /** Persist the framework delivery journal separately from the aggregate diagnostic journal. */
  async appendDeliveryEvents(events: readonly Event[]): Promise<void> {
    const store = new EventStore(this.#storageContext, this.#runtime.storageFactory);
    try {
      await store.appendAll(events);
    } finally {
      store.close();
    }
  }

  /** Store the current aggregate record before its diagnostic and delivery journals. */
  async persistAggregateUpdate(
    loaded: LoadedAggregate,
    entityId: unknown,
    version: bigint,
    events: readonly Event[],
  ): Promise<void> {
    const lifecycle = repositoryLifecycle(loaded.entity);
    const deferred = await standAccess.deferUpdate(
      this.#runtime.stand,
      this.#repository.stateSchema,
      repositoryState(loaded.entity) as never,
      standUpdateOptions(
        this.#storageContext.tenantId,
        create(VersionSchema, { number: eventVersionNumber(version) }),
        lifecycle,
      ),
    );
    try {
      if (historyConfiguration(this.#repository).stateHistory) {
        await loaded.states.append({
          entityId,
          state: repositoryState(loaded.entity) as Message,
          version,
          createdAt: events[events.length - 1]?.context?.timestamp ?? create(TimestampSchema),
        });
        entityStateHistoryCaches.get(loaded.entity)?.clear();
      }
      for (const event of events) {
        await loaded.events.append({
          entityId,
          event,
          producerVersion: readEventVersion(event),
          createdAt: event.context?.timestamp ?? create(TimestampSchema),
        });
      }
      await this.appendDeliveryEvents(events);
    } catch (error) {
      deferred.cancel();
      throw error;
    }
    try {
      deferred.notify();
    } catch (error) {
      const event = events[events.length - 1];
      if (event !== undefined) this.#runtime.recordDispatchFailure(event, error);
    }
  }

  async appendDiagnosticEvent(
    loaded: LoadedAggregate,
    entityId: unknown,
    event: Event,
  ): Promise<void> {
    await loaded.events.append({
      entityId,
      event,
      producerVersion: readEventVersion(event),
      createdAt: event.context?.timestamp ?? create(TimestampSchema),
    });
  }

  /** Complete persistence before scheduling best-effort stored-event dispatch. */
  async persistAggregateAndDispatch(
    loaded: LoadedAggregate,
    entityId: unknown,
    version: bigint,
    events: readonly Event[],
    dispatch: (event: Event) => Promise<void>,
  ): Promise<void> {
    await this.persistAggregateUpdate(loaded, entityId, version, events);
    for (const event of events) {
      void dispatch(event).catch((error: unknown) => {
        this.#runtime.recordDispatchFailure(event, error);
      });
    }
  }

  #instantiateAggregate(
    entityId: unknown,
    current:
      | {
          readonly state: unknown;
          readonly version: bigint;
          readonly archived: boolean;
          readonly deleted: boolean;
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
      state: current?.state ?? this.#defaultState(entityId),
      version: current?.version ?? 0n,
    };

    if (current !== undefined) {
      options.lifecycle = { archived: current.archived, deleted: current.deleted };
    }

    return new entityType(options);
  }

  #defaultState(entityId: unknown): unknown {
    return create(this.#repository.stateSchema, {
      [this.#repository.idField.localName]: entityId,
    });
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

    const loaded = await this.#support.loadAggregate(route.entityId);
    const commandContext = commandHandlerContext(this.#command);
    let produced: unknown;
    try {
      produced = await this.#invokeAssignee(
        loaded.entity,
        assignee.handler.methodName,
        message,
        assignee.handler.parameterCount,
        commandContext,
      );
    } catch (error) {
      if (!RejectionThrowable.is(error)) {
        throw error;
      }
      postRejectionEvent(this.#runtime, this.#command, route.entityId, error);
      return;
    }
    const events = this.#bindProducedEvents(
      this.#support.normalizeProducedSignals(produced),
      route.entityId,
      loaded.version,
      true,
    );

    if (events.length === 0) {
      throw new Error("Repository aggregate command handlers must return at least one event.");
    }

    const committedVersion = loaded.version + BigInt(events.length);
    await this.#support.persistAggregateAndDispatch(
      loaded,
      route.entityId,
      committedVersion,
      events,
      (event) => this.#runtime.dispatchStored(event),
    );
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
      message: AnyMessages.pack(schema, message as never),
      context: metadata.context,
    });
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

  async runTarget(entityId: unknown): Promise<void> {
    const intake = this.#readIntake();

    if (intake.reactors.length === 0 && intake.commanders.length === 0) {
      return;
    }

    await this.#postCommands(await this.#executeEntity(entityId, intake));
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
      readonly route: RepositoryEventRoute;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
  ): Promise<readonly Command[]> {
    const loaded = await this.#support.loadAggregate(entityId);
    const commands: Command[] = [];
    const produced = await this.#invokeHandlers(
      entityId,
      loaded,
      intake,
      intake.route.entityIds.length > 1,
    );

    for (const command of produced.commands) {
      commands.push(command);
    }

    if (produced.events.length > 0) {
      await this.#support.persistAggregateAndDispatch(
        loaded,
        entityId,
        loaded.version + BigInt(produced.events.length),
        produced.events,
        (event) => this.#runtime.dispatchStoredFollowUp(event),
      );
    }

    await this.#support.appendDiagnosticEvent(
      loaded,
      entityId,
      guardedJournalEvent(this.#event, entityId),
    );

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
    multiTarget: boolean,
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
            multiTarget,
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

  #bindProducedEvents(
    produced: readonly unknown[],
    entityId: unknown,
    lastVersion: bigint,
    multiTarget: boolean,
  ): readonly Event[] {
    const version = lastVersion + 1n;
    let sequence = 0;

    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        return this.#bindProducedEvent(signal, entityId, version, sequence, multiTarget);
      }),
    );
  }

  #bindProducedEvent(
    signal: unknown,
    entityId: unknown,
    version: bigint,
    sequence: number,
    multiTarget: boolean,
  ): Event {
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
      id: multiTarget
        ? create(EventIdSchema, {
            value: `${metadata.id.value}.target.${encodeURIComponent(canonicalEntityIdKey(entityId))}`,
          })
        : metadata.id,
      message: AnyMessages.pack(schema, signal as never),
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
          message: AnyMessages.pack(schema, signal as never),
          context: metadata.context,
        });
      }),
    );
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
    const packedMessage = requireSignalMessage(this.#event.message, "event");
    const tenantOptions = standTenantOptions(this.#runtime.context, this.#event);
    const entity = await this.#loadProjection(entityId, tenantOptions);

    await this.#invokeSubscribers(entity, subscribers, packedMessage);
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
      standUpdateOptions(
        tenantOptions.tenantId,
        this.#event.context?.version,
        repositoryLifecycle(entity),
      ),
    );
    if (historyConfiguration(this.#repository).stateHistory) {
      const storage = openRepositoryEntityStorage(
        this.#repository,
        this.#runtime.storageFactory,
        entityStorageInput(
          this.#repository,
          storageContextForTenant(this.#runtime.context, tenantOptions.tenantId),
        ),
      );
      await storage.states.append({
        entityId: (entity as { readonly id: unknown }).id,
        state: repositoryState(entity) as Message,
        version: BigInt(this.#event.context?.version?.number ?? 0),
        createdAt: this.#event.context?.timestamp ?? create(TimestampSchema),
      });
    }
  }

  async #invokeSubscribers(
    entity: object,
    subscribers: RepositoryEventSubscribers,
    packedMessage: NonNullable<Event["message"]>,
  ): Promise<void> {
    transactionalEntityAccess.start(entity);
    try {
      for (const subscriber of subscribers) {
        const subscriberMessage = unpackRequired(packedMessage, subscriber.handler.schema, "event");
        const eventContext = eventHandlerContext(this.#event);
        await invokeEntityMethod(
          entity,
          subscriber.handler.methodName,
          subscriberMessage,
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

    const entity = new entityType({
      id: entityId,
      schema: this.#repository.stateSchema,
      state: stored?.state ?? this.#defaultState(entityId),
      version: projectionVersion(stored?.version),
    });
    bindEntityHistory(
      entity,
      openRepositoryEntityStorage(
        this.#repository,
        this.#runtime.storageFactory,
        entityStorageInput(
          this.#repository,
          storageContextForTenant(this.#runtime.context, options.tenantId),
        ),
      ),
      entityId,
    );
    return entity;
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

    const entity = new entityType({
      id: entityId,
      schema: this.#repository.stateSchema,
      state: stored?.state ?? this.#defaultState(entityId),
      version: projectionVersion(stored?.version),
    });
    bindEntityHistory(
      entity,
      openRepositoryEntityStorage(
        this.#repository,
        this.#runtime.storageFactory,
        entityStorageInput(
          this.#repository,
          storageContextForTenant(this.#runtime.context, options.tenantId),
        ),
      ),
      entityId,
    );
    return entity;
  }

  async storeIfChanged(
    entity: object,
    options: { readonly tenantId?: string },
    createdAt: Timestamp,
  ): Promise<void> {
    if (!repositoryChanged(entity)) {
      return;
    }

    await this.#runtime.stand.update(
      this.#repository.stateSchema,
      repositoryState(entity) as never,
      standUpdateOptions(
        options.tenantId,
        create(VersionSchema, { number: processManagerVersion(entity) }),
        repositoryLifecycle(entity),
      ),
    );
    if (historyConfiguration(this.#repository).stateHistory) {
      const storage = openRepositoryEntityStorage(
        this.#repository,
        this.#runtime.storageFactory,
        entityStorageInput(
          this.#repository,
          storageContextForTenant(this.#runtime.context, options.tenantId),
        ),
      );
      await storage.states.append({
        entityId: (entity as { readonly id: unknown }).id,
        state: repositoryState(entity) as Message,
        version: BigInt(processManagerVersion(entity)),
        createdAt,
      });
    }
  }

  async appendDiagnosticEvents(
    entity: object,
    options: { readonly tenantId?: string },
    events: readonly Event[],
  ): Promise<void> {
    if (!historyConfiguration(this.#repository).processManagerEventHistory) return;
    const storage = openRepositoryEntityStorage(
      this.#repository,
      this.#runtime.storageFactory,
      entityStorageInput(
        this.#repository,
        storageContextForTenant(this.#runtime.context, options.tenantId),
      ),
    );
    for (const event of events) {
      await storage.events.append({
        entityId: (entity as { readonly id: unknown }).id,
        event,
        producerVersion: readEventVersion(event),
        createdAt: event.context?.timestamp ?? create(TimestampSchema),
      });
    }
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
    let eventSignals: readonly unknown[];
    try {
      eventSignals = await this.#invoke(entity, assignee, message);
    } catch (error) {
      if (!RejectionThrowable.is(error)) {
        throw error;
      }
      postRejectionEvent(this.#runtime, this.#command, route.entityId, error);
      return;
    }

    await this.#support.storeIfChanged(entity, tenantOptions, executionTimestamp());
    const events = this.#bindProducedEvents(eventSignals, route.entityId);
    await this.#support.appendDiagnosticEvents(entity, tenantOptions, events);
    this.#postEvents(events);
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
      message: AnyMessages.pack(schema, signal as never),
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
    await guardedEntityEventDispatch(
      this.#repository,
      this.#runtime,
      this.#event,
      entityId,
      async () => {
        await this.#executeEntity(entityId, intake);
      },
    );
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

    await this.#support.storeIfChanged(
      entity,
      tenantOptions,
      this.#event.context?.timestamp ?? create(TimestampSchema),
    );
    const events = this.#bindProducedEvents(produced.events, entityId);
    await this.#support.appendDiagnosticEvents(entity, tenantOptions, [
      guardedJournalEvent(this.#event, entityId),
    ]);
    await this.#support.appendDiagnosticEvents(entity, tenantOptions, events);
    this.#postEvents(events);
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
      message: AnyMessages.pack(schema, signal as never),
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
          message: AnyMessages.pack(schema, signal as never),
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
  const unpacked = AnyMessages.unpack(message, schema);

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

/** Internal structural provider seam shared by the memory, Datastore, and MySQL factories. */
interface EntityStorageFactory {
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): {
    readonly current: EntityRecordStorage<I, S>;
    readonly states: EntityStateHistoryPort<I, S>;
    readonly events: EntityEventHistoryPort<I>;
    close(): void;
  };
}

function openEntityStorage<I, S extends Message>(
  factory: StorageFactory,
  input: EntityStorageInput<I, S>,
): ReturnType<EntityStorageFactory["createEntityStorage"]> {
  const candidate = factory as StorageFactory & Partial<EntityStorageFactory>;
  if (candidate.createEntityStorage === undefined) {
    throw new Error("StorageFactory does not provide the required entity-record storage seam.");
  }
  return candidate.createEntityStorage(input);
}

function openRepositoryEntityStorage<I, S extends Message>(
  repository: RepositoryView,
  factory: StorageFactory,
  input: EntityStorageInput<I, S>,
): ReturnType<EntityStorageFactory["createEntityStorage"]> {
  const handle = openEntityStorage(factory, input);
  const key = JSON.stringify({
    context: input.context,
    layout: input.layout,
    state: input.stateSchema.typeName,
    storageKey: input.storageKey,
  });
  let handles = repositoryEntityHandles.get(repository);
  if (handles === undefined) {
    handles = new Map();
    repositoryEntityHandles.set(repository, handles);
  }
  const existing = handles.get(key);
  if (existing !== undefined) {
    handle.close();
    return existing as ReturnType<EntityStorageFactory["createEntityStorage"]>;
  }
  handles.set(key, handle);
  return handle;
}

function entityStorageInput(
  repository: RepositoryView,
  context: StorageContext,
): EntityStorageInput<unknown, Message> {
  return entityStorageDescriptor(
    context,
    repository.stateSchema,
    repository.idField.localName,
    repository.metadata.columns.map(
      (field) =>
        new RecordColumn(
          field.name,
          (state) => (state as Record<string, unknown>)[field.localName],
          "protobuf",
        ),
    ),
  );
}

function readHistoryConfiguration(
  options: {
    readonly stateHistory?: boolean;
    readonly processManagerEventHistory?: boolean;
    readonly doubleDispatchGuard?: boolean | { readonly depth?: number };
  },
  family: EntityFamily,
): RepositoryHistoryConfiguration {
  const guard = options.doubleDispatchGuard;
  const depth =
    guard === true
      ? 100
      : guard === false || guard === undefined
        ? undefined
        : (guard.depth ?? 100);
  if (depth !== undefined && (!Number.isSafeInteger(depth) || depth <= 0)) {
    throw new RangeError("Repository doubleDispatchGuard.depth must be a positive safe integer.");
  }
  if (depth !== undefined && family === "projection") {
    throw new Error("Repository doubleDispatchGuard is unavailable for Projections.");
  }
  if (
    depth !== undefined &&
    family === "process-manager" &&
    options.processManagerEventHistory !== true
  ) {
    throw new Error("Process Manager doubleDispatchGuard requires processManagerEventHistory.");
  }
  return {
    stateHistory: options.stateHistory ?? false,
    processManagerEventHistory: options.processManagerEventHistory ?? false,
    dispatchGuardDepth: depth,
  };
}

function historyConfiguration(repository: RepositoryView): RepositoryHistoryConfiguration {
  const configuration = repositoryHistoryConfigurations.get(repository);
  if (configuration === undefined)
    throw new Error("Repository history configuration is unavailable.");
  return configuration;
}

/**
 * In-process bounded duplicate guard. Completion is recorded only after a successful execution;
 * therefore provider/journal failures may be retried and separate machines remain independent.
 */
async function guardedEntityEventDispatch(
  repository: RepositoryView,
  runtime: RepositoryRuntime,
  event: Event,
  entityId: unknown,
  dispatch: () => Promise<void>,
): Promise<void> {
  const depth = historyConfiguration(repository).dispatchGuardDepth;
  const eventId = event.id?.value;
  if (depth === undefined || eventId === undefined || eventId.length === 0) return dispatch();
  if (entityId === undefined) return dispatch();
  const key = canonicalEntityIdKey(entityId);
  const journalEventId = guardedJournalEventId(eventId, key);
  let guards = repositoryDispatchGuards.get(repository);
  if (guards === undefined) {
    guards = { lanes: new Map(), order: [] };
    repositoryDispatchGuards.set(repository, guards);
  }
  let guard = guards.lanes.get(key);
  if (guard === undefined) {
    guard = { completed: new Set(), order: [], chain: Promise.resolve(), active: 0 };
    guards.lanes.set(key, guard);
  }
  touchGuardLane(guards, key);
  const activeGuard = guard;
  activeGuard.active += 1;
  const previous = activeGuard.chain;
  const next = previous.then(async () => {
    if (activeGuard.completed.has(eventId)) return;
    const storage = openEntityStorage(
      runtime.storageFactory,
      entityStorageInput(repository, storageContextForEvent(runtime.context, event)),
    );
    let persisted: readonly Event[];
    try {
      persisted = await storage.events.backward(entityId, depth);
    } finally {
      storage.close();
    }
    if (persisted.some((candidate) => candidate.id?.value === journalEventId)) {
      rememberGuardCompletion(activeGuard, eventId, depth);
      return;
    }
    await dispatch();
    rememberGuardCompletion(activeGuard, eventId, depth);
  });
  activeGuard.chain = next
    .catch(() => undefined)
    .finally(() => {
      activeGuard.active -= 1;
      trimGuardLanes(guards, depth);
    });
  return next;
}

function rememberGuardCompletion(guard: DispatchGuard, eventId: string, depth: number): void {
  if (!guard.completed.has(eventId)) {
    guard.completed.add(eventId);
    guard.order.push(eventId);
  }
  while (guard.order.length > depth) {
    const expired = guard.order.shift();
    if (expired !== undefined) guard.completed.delete(expired);
  }
}

function touchGuardLane(guards: RepositoryDispatchGuards, key: string): void {
  const index = guards.order.indexOf(key);
  if (index >= 0) guards.order.splice(index, 1);
  guards.order.push(key);
}

function trimGuardLanes(guards: RepositoryDispatchGuards, depth: number): void {
  while (guards.order.length > depth) {
    const key = guards.order[0];
    if (key === undefined) return;
    const guard = guards.lanes.get(key);
    if (guard?.active !== 0) return;
    guards.order.shift();
    guards.lanes.delete(key);
  }
}

function guardedJournalEvent(event: Event, entityId: unknown): Event {
  const sourceId = event.id?.value;
  if (sourceId === undefined) return event;
  return create(EventSchema, {
    ...event,
    id: create(EventIdSchema, {
      value: guardedJournalEventId(sourceId, canonicalEntityIdKey(entityId)),
    }),
  });
}

function guardedJournalEventId(sourceId: string, entityKey: string): string {
  return `${sourceId}.guard.${encodeURIComponent(entityKey)}`;
}

function bindEntityHistory(
  entity: object,
  storage: ReturnType<EntityStorageFactory["createEntityStorage"]>,
  entityId: unknown,
): void {
  const stateCache = createHistoryCache(
    (depth, startingFromVersion) => storage.states.backward(entityId, depth, startingFromVersion),
    (record) => record.version,
    { requireContiguousVersions: true },
  );
  entityStateHistoryCaches.set(entity, stateCache);
  const eventCache = createHistoryCache(
    (depth, startingFromVersion) => storage.events.backward(entityId, depth, startingFromVersion),
    (event) => readEventVersion(event),
    { cacheCompleteVersionGroups: true },
  );
  entityHistoryAccess.bind(entity, {
    stateAt: async (time) => cloneHistoryState(await storage.states.stateAt(entityId, time)),
    states: async (depth) =>
      freezeHistoryStates((await stateCache.read(depth)).map((record) => record.state)),
    events: async (depth) => freezeHistoryEvents(await eventCache.read(depth)),
    stateMaintenance: storage.states,
    eventMaintenance: storage.events,
  });
}

/** Per-live-entity continuation cache. A larger request is serialized behind the prior read. */
/** @internal Shared repository history-cache implementation, exercised by repository tests. */
export function createHistoryCache<T>(
  load: (depth: number, startingFromVersion?: bigint) => Promise<readonly T[]>,
  versionOf: (entry: T) => bigint | undefined,
  options: {
    readonly requireContiguousVersions?: boolean;
    readonly cacheCompleteVersionGroups?: boolean;
  } = {},
): {
  readonly read: (depth: number) => Promise<readonly T[]>;
  readonly clear: () => void;
} {
  const { requireContiguousVersions = false, cacheCompleteVersionGroups = false } = options;
  let entries: readonly T[] = Object.freeze([]);
  let exhausted = false;
  let continuation = Promise.resolve();
  let nextVersion: bigint | undefined;
  let newestVersion: bigint | undefined;
  let generation = 0;
  const clear = (): void => {
    generation += 1;
    entries = Object.freeze([]);
    exhausted = false;
    nextVersion = undefined;
    newestVersion = undefined;
  };
  return Object.freeze({
    read: async (depth: number): Promise<readonly T[]> => {
      await continuation;
      if (entries.length >= depth || exhausted) return entries.slice(0, depth);
      let result: readonly T[] | undefined;
      const next = continuation.then(async () => {
        if (entries.length >= depth || exhausted) return;
        const readGeneration = generation;
        const requested = Math.max(1, depth - entries.length);
        if (cacheCompleteVersionGroups) {
          const loaded = await load(requested + 1, nextVersion);
          if (readGeneration !== generation) return;
          const combined = [...entries, ...loaded];
          const short = loaded.length < requested + 1;
          const terminal = loaded.at(-1);
          const terminalVersion = terminal === undefined ? undefined : versionOf(terminal);
          const cachedLength =
            short || terminalVersion === undefined
              ? loaded.length
              : loaded.findIndex((entry) => versionOf(entry) === terminalVersion);
          const cacheable = loaded.slice(0, Math.max(0, cachedLength));
          entries = Object.freeze([...entries, ...cacheable]);
          const cachedLast = cacheable.at(-1);
          nextVersion = cachedLast === undefined ? nextVersion : versionOf(cachedLast);
          exhausted = short;
          result = Object.freeze(combined.slice(0, depth));
          return;
        }
        const loaded = await load(requested, nextVersion);
        if (readGeneration !== generation) return;
        const latest = loaded[0] === undefined ? undefined : versionOf(loaded[0]);
        const oldest = entries.at(-1);
        const oldestVersion = oldest === undefined ? undefined : versionOf(oldest);
        if (
          newestVersion !== undefined &&
          latest !== undefined &&
          latest > newestVersion &&
          nextVersion !== undefined
        ) {
          clear();
          const refreshed = await load(depth);
          if (readGeneration + 1 !== generation) return;
          entries = Object.freeze([...refreshed]);
          newestVersion = refreshed[0] === undefined ? undefined : versionOf(refreshed[0]);
          const refreshedLast = refreshed.at(-1);
          nextVersion = refreshedLast === undefined ? undefined : versionOf(refreshedLast);
          exhausted = refreshed.length < depth;
          return;
        }
        if (
          requireContiguousVersions &&
          oldestVersion !== undefined &&
          latest !== undefined &&
          (latest >= oldestVersion || (latest < oldestVersion && latest !== oldestVersion - 1n))
        ) {
          clear();
          return;
        }
        const combined = [...entries, ...loaded];
        entries = Object.freeze(combined);
        newestVersion ??= latest;
        const loadedLast = loaded.at(-1);
        nextVersion = loadedLast === undefined ? nextVersion : versionOf(loadedLast);
        exhausted = loaded.length < requested;
      });
      continuation = next.catch(() => undefined);
      await next;
      return result ?? entries.slice(0, depth);
    },
    clear,
  });
}

function cloneHistoryState(state: Message | undefined): Message | undefined {
  return state === undefined ? undefined : Object.freeze(structuredClone(state));
}

function freezeHistoryStates(states: readonly Message[]): readonly Message[] {
  return Object.freeze(states.map((state) => Object.freeze(structuredClone(state))));
}

function freezeHistoryEvents(events: readonly Event[]): readonly Event[] {
  return Object.freeze(events.map((event) => Object.freeze(clone(EventSchema, event))));
}

function canonicalEntityIdKey(id: unknown): string {
  if (id === null) return "null";
  switch (typeof id) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return `${typeof id}:${String(id)}`;
    default:
      return `json:${JSON.stringify(id)}`;
  }
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

function postRejectionEvent(
  runtime: RepositoryRuntime,
  command: Command,
  entityId: unknown,
  rejection: RejectionThrowable,
): void {
  const metadata = runtime.signalMetadata.eventFromCommand(command, 1, {
    producerId: runtimeProducerId(entityId) ?? "Unknown",
  });
  const event = create(EventSchema, {
    id: metadata.id,
    message: AnyMessages.pack(rejection.schema, rejection.messageThrown()),
    context: create(EventContextSchema, {
      ...metadata.context,
      rejection: create(RejectionEventContextSchema, {
        command: clone(CommandSchema, command),
        stacktrace: rejection.stack ?? "",
      }),
    }),
  });

  try {
    void runtime.postEventFollowUp(event).catch((error: unknown) => {
      runtime.recordDispatchFailure(event, error);
    });
  } catch (error) {
    runtime.recordDispatchFailure(event, error);
  }
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

function requirePmEventTenant(context: StorageContext, event: Event): string | undefined {
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
    message.signal === undefined ? undefined : AnyMessages.unpack(message.signal, CommandSchema);

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
  const event = signal === undefined ? undefined : AnyMessages.unpack(signal, EventSchema);

  if (event === undefined) {
    throw new Error(unreadableMessage);
  }

  return event;
}

function validateReplayedCommandPayload(routing: RepositoryRouting, command: Command): void {
  const commandMessage = requireSignalMessage(command.message, "command");
  const commandSchema = schemaForTypeUrl(routing.commandSchemas, commandMessage.typeUrl, "command");
  const payload = AnyMessages.unpack(commandMessage, commandSchema);

  if (payload === undefined) {
    throw CommandValidationError.invalidPayload();
  }

  try {
    Validate.check(commandSchema, payload);
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
  const payload = AnyMessages.unpack(eventMessage, eventSchema);

  if (payload === undefined) {
    throw new Error(invalidPayloadMessage);
  }

  Validate.check(eventSchema, payload);
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
  const expectedTargetTypeUrl = TypeUrls.derive(repository.stateSchema);

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
  const expectedTargetTypeUrl = TypeUrls.derive(repository.stateSchema);

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
  const expectedTargetTypeUrl = TypeUrls.derive(repository.stateSchema);

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

function executionTimestamp(): Timestamp {
  const milliseconds = Date.now();
  return create(TimestampSchema, {
    seconds: BigInt(Math.floor(milliseconds / 1_000)),
    nanos: (milliseconds % 1_000) * 1_000_000,
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

function storageContextForTenant(
  context: StorageContext,
  tenantId: string | undefined,
): StorageContext {
  if (!context.multitenant) return context;
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
  lifecycle: { readonly archived: boolean; readonly deleted: boolean },
): {
  readonly tenantId?: string;
  readonly version?: Version;
  readonly lifecycle: { readonly archived: boolean; readonly deleted: boolean };
} {
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(version === undefined ? {} : { version }),
    lifecycle,
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
      // Applications remain valid routing metadata. Aggregate persistence does
      // not invoke them to reconstruct or mutate state.
      ...handler.eventApplications.map((application) => application.schema),
    ]),
  );
  const producedEventSchemas = uniqueSchemas([
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
    byTypeUrl.set(TypeUrls.derive(schema), schema);
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
  const schema = schemas.find((candidate) => TypeUrls.derive(candidate) === typeUrl);

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
  const unpacked = AnyMessages.unpack(message, schema);
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
  const routedProducerId =
    event.context?.rejection !== undefined &&
    schema.fields[0]?.fieldKind === "message" &&
    producerId === "Unknown"
      ? undefined
      : producerId;
  const fieldId = readRouteId(readFirstFieldId(message, schema, "event"), targetIdField, "event");

  if (routedProducerId !== undefined && routedProducerId !== fieldId.value) {
    throw new Error(
      "Repository event routing requires producer ID and first field to identify the same entity.",
    );
  }

  return routedProducerId === undefined || targetIdField.descriptor.fieldKind === "message"
    ? fieldId.id
    : routedProducerId;
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
