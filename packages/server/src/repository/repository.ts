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

import { clone, create, ScalarType, toBinary, type Message } from "@bufbuild/protobuf";
import {
  AnySchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  TimestampSchema,
  type Any,
  type Timestamp,
} from "@bufbuild/protobuf/wkt";
import {
  ValidationException,
  type MessageSchema,
  RejectionThrowable,
  Validate,
  TypeUrls,
  AnyMessages,
  Identifiers,
  StringifierRegistry,
} from "@spine-event-engine/core";
import {
  CommandContextSchema,
  ActorContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  TenantIdSchema,
  type MessageId,
  RejectionEventContextSchema,
  type Command,
  type Event,
  type TenantId,
  type Version,
  VersionSchema,
  EntityOption_Kind,
} from "@spine-event-engine/proto";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { EntityTypeNameSchema } from "@spine-event-engine/proto/generated/spine/system/server/entity_type_pb.js";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import {
  type StorageContext,
  type StorageFactory,
  type StorageMode,
} from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import type { EntityCommitStorage } from "@spine-event-engine/storage/provider";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";

import { CommandValidationError } from "../bus/command-errors.js";
import { SignalPublisher } from "../runtime/signal-publisher.js";
import {
  CommandRoutingInternals,
  type CommandRoute,
  type CommandRouting,
} from "./command-routing.js";
import { EventRoutingInternals, type EventRoute, type EventRouting } from "./event-routing.js";
import {
  StateUpdateRoutingInternals,
  type StateUpdateRoute,
  type StateUpdateRouting,
} from "./state-update-routing.js";
import { RoutingDeclarations, type RoutingDeclarationSnapshot } from "./routing-declarations.js";
import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import { EventDispatcherOriginSchemas } from "../bus/event-dispatcher-origin-schemas.js";
import { Delivery } from "../delivery/delivery.js";
import { commitFenced } from "./commit-fence.js";
import { InboxTargets, type InboxMessage, type InboxMessageInput } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";
import {
  Aggregate,
  type Entity,
  type EntityLifecycleFlags,
  ProcessManager,
  Projection,
  type EntityFamily,
  entityHistoryAccess,
  processManagerQueryAccess,
  transactionalEntityAccess,
} from "../entity/entity.js";
import {
  describeEntityMetadata,
  attachEntitySchema,
  type DescriptorFieldMetadata,
  type DescriptorMessageSchema,
  type EntityMetadata,
  type EntityConstructor,
  type FirstFieldRoutingHint,
} from "../entity/entity-metadata.js";
import {
  EntityIds,
  EntityRecords,
  entityStorageDescriptor,
} from "../entity/entity-storage-descriptor.js";
import { SpecScanner } from "../entity/spec-scanner.js";
import {
  CommandRegistrationReadiness,
  type CommandRegistrationReadinessLookup,
} from "../handler/command-registration-readiness.js";
import {
  EventRegistrationReadiness,
  type EventRegistrationReadinessLookup,
} from "../handler/event-registration-readiness.js";
import {
  EventHandlerFilters,
  type EventHandlerFilterPlan,
} from "../handler/event-handler-filter.js";
import { SignalMetadata } from "../runtime/signal-metadata.js";
import { QueryReader } from "../services/query-reader.js";
import {
  HandlerMetadataRegistry,
  HandlerMetadataValues,
  type CommandAssignmentHandlerMetadata,
  type CommandReactionHandlerMetadata,
  type EntityHandlersMetadata,
  type EventReactionHandlerMetadata,
  type StateSubscriptionHandlerMetadata,
  type HandlerParameterCount,
  type HandlerMetadata,
  type RegisteredHandlerMetadata,
  type WhereOptions,
} from "../handler/handler-metadata.js";
import { DeclaredRejections } from "../handler/declared-rejections.js";
import { standAccess, type Stand } from "../stand/stand.js";
import { TransitionValidationError } from "./command-errors.js";
import { MessageIds, PrimitiveIds } from "./primitive-id.js";
import { ImplicitRequiredIds } from "../entity/implicit-required-id.js";

/**
 * Represents an Aggregate, Projection, or Process Manager with a state schema.
 *
 * @typeParam Schema Generated state schema of the Entity instance.
 */
type RepositoryEntityInstance<Schema extends DescriptorMessageSchema = DescriptorMessageSchema> =
  Aggregate<unknown, Schema> | Projection<unknown, Schema> | ProcessManager<unknown, Schema>;

/**
 * Generated Protobuf-ES state schema carried by a repository entity constructor.
 *
 * @typeParam EntityType Entity constructor whose state schema is selected.
 */
export type RepositoryStateSchema<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Aggregate<unknown, infer Schema>
    ? Schema
    : EntityType["prototype"] extends Projection<unknown, infer Schema>
      ? Schema
      : EntityType["prototype"] extends ProcessManager<unknown, infer Schema>
        ? Schema
        : never;

/**
 * Selects the ID type declared by a repository Entity constructor.
 *
 * @typeParam EntityType Entity constructor whose ID type is selected.
 */
type RepositoryEntityId<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Aggregate<infer Id, DescriptorMessageSchema>
    ? Id
    : EntityType["prototype"] extends Projection<infer Id, DescriptorMessageSchema>
      ? Id
      : EntityType["prototype"] extends ProcessManager<infer Id, DescriptorMessageSchema>
        ? Id
        : never;

/**
 * Describes handler metadata compatible with an Entity constructor.
 *
 * @typeParam EntityType Entity constructor represented by the handlers.
 */
type RepositoryHandlers<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends infer Instance extends object
    ? EntityHandlersMetadata<Instance, RepositoryStateSchema<EntityType>>
    : never;

/**
 * Accepts one or several handler metadata blocks for an Entity constructor.
 *
 * @typeParam EntityType Entity constructor represented by the handlers.
 */
type RepositoryHandlersOptionFor<EntityType extends RepositoryEntityType> =
  RepositoryHandlers<EntityType> | readonly RepositoryHandlers<EntityType>[];

/**
 * Allows state-update routing only for Projection constructors.
 *
 * @typeParam EntityType Entity constructor being configured.
 */
type StateRoutingOption<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Projection<unknown, DescriptorMessageSchema>
    ? StateUpdateRouting<RepositoryEntityId<EntityType>>
    : never;

/**
 * Detects a TypeScript union while preserving the complete input type.
 *
 * @typeParam Type Candidate type to test.
 * @typeParam Union Original unsplit candidate type.
 */
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
 *
 * @typeParam EntityType Candidate concrete Entity constructor.
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

/**
 * Describes an entity constructor accepted by repository identity metadata.
 *
 * @typeParam Instance The aggregate, projection, or process-manager instance type.
 * @param args The constructor arguments accepted by the entity class.
 * @returns An entity instance.
 */
export type RepositoryEntityType<
  Instance extends RepositoryEntityInstance = RepositoryEntityInstance,
> = (abstract new (...args: never[]) => Instance) &
  // `any` erases the Entity constructor parameters while preserving its protected static origin.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof Entity<any, DescriptorMessageSchema> & {
    // prettier-ignore

    /**
     * Prototype inspected for built-in entity family marker inheritance.
     */
    readonly prototype: Instance;

    /**
     * Constructor name used in structured diagnostics.
     */
    readonly name: string;
  };

/**
 * Options for constructing repository identity and context-owned registration.
 *
 * @typeParam EntityType A single concrete aggregate, projection, or process-manager constructor.
 * The constructor's prototype must carry one concrete generated state schema; broad constructor,
 * constructor-union, broad-schema, and schema-union bindings are rejected at compile time.
 */
export interface RepositoryOptions<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
> {
  // prettier-ignore

  /**
   * Entity constructor owned by this repository identity.
   */
  readonly entityType: EntityType;

  /**
   * Generated Protobuf-ES schema for the entity state owned by this repository identity.
   */
  readonly schema: RepositoryStateSchema<EntityType>;

  /**
   * Explicit handler metadata used to register repository command and event routing.
   * The metadata must describe this repository's Entity constructor and state schema.
   */
  readonly handlers?: RepositoryHandlersOptionFor<EntityType>;

  /**
   * Mutable Command route declarations snapshotted when this repository is constructed.
   */
  readonly commandRouting?: CommandRouting<RepositoryEntityId<EntityType>>;

  /**
   * Mutable Event route declarations snapshotted when this repository is constructed.
   */
  readonly eventRouting?: EventRouting<RepositoryEntityId<EntityType>>;

  /**
   * Mutable state-update declarations allowed only for Projections.
   */
  readonly stateUpdateRouting?: StateRoutingOption<EntityType>;

  /**
   * Reversible field mappings used by generated Event handler filters.
   *
   * Pass the same source registry configured for storage/query mappings when
   * message-valued fields use application-defined string representations. The
   * repository snapshots the registry during construction.
   */
  readonly stringifierRegistry?: StringifierRegistry;

  /**
   * Generated event schemas that aggregate or process-manager handlers may emit.
   */
  readonly events?: readonly MessageSchema[];

  /**
   * Retain a state-history row after each successful logical store. Defaults to false.
   */
  readonly stateHistory?: boolean;

  /**
   * Retain process-manager diagnostic events. Defaults to false; aggregate events are retained.
   */
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
 * @typeParam EntityType The concrete entity constructor represented by the repository. The snapshot's
 * state schema and metadata are derived from this constructor so callers cannot spell an impossible
 * entity/schema snapshot pair.
 */
export interface RepositoryIdentitySnapshot<
  EntityType extends RepositoryEntityType = RepositoryEntityType,
> {
  // prettier-ignore

  /**
   * Entity constructor owned by the repository.
   */
  readonly entityType: EntityType;

  /**
   * Entity family inferred from the constructor's built-in family marker base class.
   */
  readonly entityFamily: EntityFamily;

  /**
   * Generated Protobuf-ES schema for the owned entity state.
   */
  readonly stateSchema: RepositoryStateSchema<EntityType>;

  /**
   * Descriptor-derived metadata for the owned entity state.
   */
  readonly metadata: EntityMetadata<RepositoryStateSchema<EntityType>>;

  /**
   * Fully qualified Protobuf type name of the owned entity state.
   */
  readonly stateFullTypeName: RepositoryStateSchema<EntityType>["typeName"];

  /**
   * Canonical entity ID field copied from descriptor-derived metadata.
   */
  readonly idField: DescriptorFieldMetadata;
}

/**
 * Public read view of a repository registered with a bounded context.
 */
export interface RepositoryView {
  // prettier-ignore

  /**
   * Entity constructor owned by the repository.
   */
  readonly entityType: RepositoryEntityType;

  /**
   * Entity family inferred from the constructor's built-in family marker base class.
   */
  readonly entityFamily: EntityFamily;

  /**
   * Generated Protobuf-ES schema for the owned entity state.
   */
  readonly stateSchema: DescriptorMessageSchema;

  /**
   * Descriptor-derived metadata for the owned entity state.
   */
  readonly metadata: EntityMetadata;

  /**
   * Fully qualified Protobuf type name of the owned entity state.
   */
  readonly stateFullTypeName: string;

  /**
   * Canonical entity ID field copied from descriptor-derived metadata.
   */
  readonly idField: DescriptorFieldMetadata;

  /**
   * Copy-safe immutable identity snapshot for duplicate/conflict checks.
   */
  readonly snapshot: RepositoryIdentitySnapshot;
}

/**
 * Repository view with Command routing available to execution and Inbox delivery.
 */
interface CommandRoutingRepository extends RepositoryView {
  // prettier-ignore

  /**
   * Resolves the target Entity and registered message type for a Command.
   *
   * @param command Command envelope to route.
   * @returns The target identifier and handler message type.
   */
  routeCommand(command: Command): RepositoryCommandRoute;
}

/**
 * Repository view with Event routing available to execution and Inbox delivery.
 */
interface EventRoutingRepository extends RepositoryView {
  // prettier-ignore

  /**
   * Resolves target Entities and the registered message type for an Event.
   *
   * @param event Event envelope to route.
   * @returns The target identifiers and handler message type.
   */
  routeEvent(event: Event): RepositoryEventRoute;
}

/**
 * Machine-readable codes for repository identity failures.
 */
export type RepositoryIdentityErrorCode = "ENTITY_SCHEMA_KIND_MISMATCH" | "UNSUPPORTED_ENTITY_TYPE";

/**
 * Describes an error raised when repository identity metadata cannot be constructed.
 */
export class RepositoryIdentityError extends Error {
  // prettier-ignore

  /**
   * Stable code for callers/tests that need structured failure handling.
   */
  readonly code: RepositoryIdentityErrorCode;

  /**
   * Creates a repository identity error.
   *
   * @param code The stable reason for the failed identity.
   * @param message The diagnostic message.
   */
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

  /**
   * Creates repository identity for one entity family and state schema pair.
   *
   * @param options The entity constructor, state schema, and optional routing configuration.
   */
  constructor(options: RepositoryOptions<EntityType>) {
    if (!RepositoryIdentity.isRepositoryOptionsObject(options)) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        "Repository options must be a non-null object with an entity type class constructor " +
          "extending Aggregate, Projection, or ProcessManager.",
      );
    }

    const entityType = RepositoryIdentity.readEntityTypeOption(options);
    const entityTypeDisplayName = RepositoryIdentity.entityTypeName(entityType);

    if (typeof entityType !== "function" || !RepositoryIdentity.isClassConstructor(entityType)) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeDisplayName}" must be a class constructor ` +
          "extending Aggregate, Projection, or ProcessManager.",
      );
    }

    const entityFamily = RepositoryIdentity.resolveRepositoryEntityFamily(entityType);

    if (entityFamily === undefined) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeDisplayName}" must extend Aggregate, Projection, or ProcessManager.`,
      );
    }

    const schema = RepositoryIdentity.readRepositorySchemaOption(
      options,
      entityTypeDisplayName,
      entityFamily,
    ) as RepositoryStateSchema<EntityType>;

    const metadata = RepositoryIdentity.describeRepositoryEntityMetadata(
      entityTypeDisplayName,
      entityFamily,
      schema,
    );

    if (metadata.kind !== entityFamily) {
      throw new RepositoryIdentityError(
        "ENTITY_SCHEMA_KIND_MISMATCH",
        `Repository entity type "${entityTypeDisplayName}" does not match ` +
          "the supplied state schema.",
      );
    }
    if (options.stateUpdateRouting !== undefined && entityFamily !== "projection") {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        "State-update routing is supported only by Projection repositories.",
      );
    }

    attachEntitySchema(entityType as EntityConstructor, schema);

    this.#entityType = entityType as EntityType;
    this.#entityFamily = entityFamily;
    this.#metadata = metadata;
    this.#routing = RepositoryRoutes.createRepositoryRouting(
      this.#entityType,
      this.#entityFamily,
      this.#metadata,
      options.handlers,
      options.events ?? [],
      CommandRoutingInternals.snapshot(options.commandRouting),
      EventRoutingInternals.snapshot(options.eventRouting),
      StateUpdateRoutingInternals.snapshot(options.stateUpdateRouting),
      new StringifierRegistry(options.stringifierRegistry),
    );
    repositoryRoutings.set(this, this.#routing);
    repositoryProducedEventSchemas.set(
      this,
      Object.freeze([...this.#routing.producedEventSchemas]),
    );
    repositoryHistoryConfigurations.set(
      this,
      RepositoryStorage.readHistoryConfiguration(options, this.#entityFamily),
    );
    repositorySnapshots.set(
      this,
      RepositoryIdentity.createRepositorySnapshot(
        this.#entityType,
        this.#entityFamily,
        this.#metadata,
      ),
    );
    repositoryDispatchers.set(
      this,
      RepositoryDispatch.createRepositoryDispatchers(this, this.#routing),
    );
    const entityInboxTarget = RepositoryDispatch.createEntityInboxTarget(this, this.#routing);
    const projectionInboxTarget = RepositoryDispatch.createProjectionInboxTarget(
      this,
      this.#routing,
    );

    if (entityInboxTarget !== undefined) {
      repositoryEntityInboxTargets.set(this, entityInboxTarget);
    }
    if (projectionInboxTarget !== undefined) {
      repositoryProjectionInboxTargets.set(this, projectionInboxTarget);
      repositoryProjectionDirect.set(
        this,
        RepositoryDispatch.createProjectionDirectDispatch(this, this.#routing),
      );
    }
  }

  /**
   * Returns the entity constructor owned by this repository identity.
   *
   * @returns The owned entity constructor.
   */
  get entityType(): EntityType {
    return this.#entityType;
  }

  /**
   * Returns the entity family inferred from its constructor.
   *
   * @returns The aggregate, projection, or process-manager family.
   */
  get entityFamily(): EntityFamily {
    return this.#entityFamily;
  }

  /**
   * Returns the generated schema for this repository's entity state.
   *
   * @returns The owned state schema.
   */
  get stateSchema(): RepositoryStateSchema<EntityType> {
    return this.#metadata.schema;
  }

  /**
   * Sets whether future state-history rows are appended for this repository.
   *
   * This JVM-parity switch is for controlled administration/testing, not
   * routine request-time behavior. It never deletes or reconstructs history.
   *
   * @param enabled Whether later successful stores append state-history rows.
   */
  setStateHistoryEnabled(enabled: boolean): void {
    if (typeof enabled !== "boolean") {
      throw new TypeError("Repository state-history switch requires a boolean.");
    }
    const configuration = RepositoryStorage.historyConfiguration(this);
    if (configuration.stateHistory === enabled) return;
    configuration.stateHistory = enabled;
    const handles = repositoryEntityHandles.get(this);
    if (handles !== undefined) {
      for (const handle of handles.values()) handle.close();
      handles.clear();
    }
  }

  /**
   * Returns descriptor-derived metadata for the owned entity state.
   *
   * @returns A metadata view for the owned state.
   */
  get metadata(): EntityMetadata<RepositoryStateSchema<EntityType>> {
    return this.#metadata;
  }

  /**
   * Returns the fully qualified Protobuf name of the owned entity state.
   *
   * @returns The state message type name.
   */
  get stateFullTypeName(): RepositoryStateSchema<EntityType>["typeName"] {
    return this.#metadata.fullTypeName;
  }

  /**
   * Returns a copy of the canonical entity ID field metadata.
   *
   * @returns The descriptor field used as the entity ID.
   */
  get idField(): DescriptorFieldMetadata {
    return RepositoryIdentity.cloneFieldMetadata(this.#metadata.idField);
  }

  /**
   * Returns a copy-safe identity snapshot for builder duplicate and conflict checks.
   *
   * @returns An immutable snapshot of the repository identity.
   */
  get snapshot(): RepositoryIdentitySnapshot<EntityType> {
    return RepositoryIdentity.cloneRepositorySnapshot(
      RepositoryIdentity.createRepositorySnapshot(
        this.#entityType,
        this.#entityFamily,
        this.#metadata,
      ),
    );
  }

  /**
   * Routes a command to one entity ID without invoking a handler.
   *
   * @param command The command envelope to route.
   * @returns The calculated command route.
   */
  routeCommand(command: Command): RepositoryCommandRoute<RepositoryEntityId<EntityType>> {
    return this.#routing.routeCommand(command);
  }

  /**
   * Routes an Event without invoking a handler.
   *
   * The default route uses a readable producer whose typed ID is compatible
   * with the Entity ID. A valid producer of another type falls back to the
   * Event's declaration-first field. A producer that claims the compatible type
   * but cannot be decoded is rejected. Custom routes may select zero, one, or
   * many targets.
   *
   * @param event The event envelope to route.
   * @returns The calculated event route.
   */
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

/**
 * Command route calculated by a repository.
 *
 * @typeParam Id Target Entity identifier type.
 */
export interface RepositoryCommandRoute<Id = unknown> {
  // prettier-ignore

  /**
   * Target entity identifier.
   */
  readonly entityId: Id;

  /**
   * Fully qualified command message type name.
   */
  readonly messageFullTypeName: string;

  /**
   * Direct repository route calculation does not invoke handlers.
   */
  readonly invocation: RepositoryRouteInvocation;
}

/**
 * Event route calculated by a repository.
 *
 * @typeParam Id Target Entity identifier type.
 */
export interface RepositoryEventRoute<Id = unknown> {
  // prettier-ignore

  /**
   * Target entity identifiers.
   */
  readonly entityIds: readonly Id[];

  /**
   * Fully qualified event message type name.
   */
  readonly messageFullTypeName: string;

  /**
   * Direct repository route calculation does not invoke handlers.
   */
  readonly invocation: RepositoryRouteInvocation;
}

/**
 * Route calculated for one unpacked Entity state update.
 *
 * @typeParam Id Target Projection identifier type.
 * @internal Framework delivery metadata.
 */
interface RepositoryStateUpdateRoute<Id = unknown> extends RepositoryEventRoute<Id> {
  // prettier-ignore

  /**
   * Unpacked source Entity state selected from `EntityStateChanged.newState`.
   */
  readonly state: Message;
  readonly subscribers: RepositoryStateSubscribers;
}

const repositorySnapshots = new WeakMap<RepositoryView, RepositoryIdentitySnapshot>();
const repositoryRoutings = new WeakMap<RepositoryView, RepositoryRouting>();
const repositoryProducedEventSchemas = new WeakMap<RepositoryView, readonly MessageSchema[]>();
const repositoryDispatchers = new WeakMap<RepositoryView, RepositoryDispatchers>();
const repositoryEntityInboxTargets = new WeakMap<RepositoryView, EntityInboxTarget>();
const repositoryProjectionInboxTargets = new WeakMap<RepositoryView, ProjectionInboxTarget>();
const repositoryProjectionDirect = new WeakMap<
  RepositoryView,
  (event: Event, rebuild?: boolean) => Promise<void>
>();
const repositoryRuntimes = new WeakMap<RepositoryView, RepositoryRuntime>();
const repositoryEntityHandles = new WeakMap<
  RepositoryView,
  Map<
    string,
    {
      /**
       * Closes the retained Entity storage handle.
       */
      close(): void;
    }
  >
>();
const entityStateHistoryCaches = new WeakMap<
  object,
  {
    /**
     * Clears cached state history after the Entity commits.
     */
    clear(): void;
  }
>();
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

type EntityInboxLabel = "HANDLE_COMMAND" | "REACT_UPON_EVENT";
type EntityInboxFollowUp = () => Promise<void>;
type EntityInboxReplay = Promise<EntityInboxFollowUp | undefined>;
type EntityInboxMessage = InboxMessage & {
  readonly label: EntityInboxLabel;
  readonly status: "TO_DELIVER";
};
type EntityInboxInput = Omit<InboxMessageInput, "whenReceived" | "version" | "shard"> & {
  readonly label: EntityInboxLabel;
  readonly status: "TO_DELIVER";
};

/**
 * Describes one Aggregate or Process Manager replay target.
 *
 * @internal
 */
export interface EntityInboxTarget {
  // prettier-ignore

  /**
   * Target state type URL routed by this replay target.
   */
  readonly targetTypeUrl: string;

  /**
   * Delivery labels configured for this target.
   */
  readonly labels: readonly EntityInboxLabel[];

  /**
   * Returns after replaying a stored Entity Inbox message.
   *
   * @param message Supplies the durable Entity Inbox message.
   * @param deliveryTenantId Identifies the active delivery tenant.
   * @returns Resolves after replay, optionally with an async follow-up callback.
   */
  replay(message: EntityInboxMessage, deliveryTenantId?: TenantId): EntityInboxReplay;
}

/**
 * Defines context-owned Entity Inbox handoff operations.
 *
 * @internal
 */
export interface EntityInbox {
  // prettier-ignore

  /**
   * Returns the context-owned target-to-shard strategy.
   *
   * @returns The immutable delivery strategy.
   */
  strategy(): import("../delivery/delivery-builder.js").DeliveryStrategy;

  /**
   * Delivers one durable inbox row through registered Entity Inbox targets.
   *
   * @param message The durable inbox row to replay.
   * @param deliveryTenantId The tenant resolved by the delivery runtime.
   * @returns A promise that resolves after the row is replayed.
   */
  replay(message: InboxMessage, deliveryTenantId?: TenantId): Promise<void>;

  /**
   * Writes and locally delivers one durable inbox row.
   *
   * @param delivery The delivery runtime that persists and replays the row.
   * @param input The row values to persist.
   * @param deliveryTenantId The tenant resolved by the delivery runtime.
   * @returns The persisted inbox row.
   */
  receive(
    delivery: Delivery,
    input: EntityInboxInput,
    deliveryTenantId?: TenantId,
  ): Promise<InboxMessage>;

  /**
   * Writes and locally delivers durable inbox rows in input order.
   *
   * @param delivery The delivery runtime that persists and replays the rows.
   * @param inputs The row values to persist.
   * @param deliveryTenantId The tenant resolved by the delivery runtime.
   * @returns The persisted inbox rows.
   */
  receiveAll(
    delivery: Delivery,
    inputs: readonly EntityInboxInput[],
    deliveryTenantId?: TenantId,
  ): Promise<readonly InboxMessage[]>;
}

/**
 *
 * @internal Narrow framework-only replay target for projection subscriber inbox handoff.
 */
type ProjectionInboxMessage = InboxMessage & {
  readonly label: "UPDATE_SUBSCRIBER";
  readonly status: "TO_DELIVER";
};

type ProjectionInboxInput = Omit<InboxMessageInput, "whenReceived" | "version"> & {
  readonly label: "UPDATE_SUBSCRIBER";
  readonly status: "TO_DELIVER";
};

/**
 * Describes a framework-only projection inbox replay target.
 *
 * @internal
 */
export interface ProjectionInboxTarget {
  // prettier-ignore

  /**
   * Target projection state type URL routed by this replay target.
   */
  readonly targetTypeUrl: string;

  /**
   * Delivers one durable inbox event under the active delivery tenant.
   *
   * @param message The durable message to replay.
   * @param deliveryTenantId The tenant resolved by the delivery runtime.
   * @returns A promise that resolves after the message is replayed.
   */
  replay(message: ProjectionInboxMessage, deliveryTenantId?: TenantId): Promise<void>;
}

/**
 * Defines context-owned projection subscriber inbox handoff operations.
 *
 * @internal
 */
export interface ProjectionInbox {
  // prettier-ignore

  /**
   * Delivers one durable inbox row through registered projection targets.
   *
   * @param message The durable inbox row to replay.
   * @param deliveryTenantId The tenant resolved by the delivery runtime.
   * @returns A promise that resolves after the row is replayed.
   */
  replay(message: InboxMessage, deliveryTenantId?: TenantId): Promise<void>;

  /**
   * Writes and locally delivers one durable inbox row.
   *
   * @param delivery The delivery runtime that persists and replays the row.
   * @param input The row values to persist.
   * @param deliveryTenantId The tenant resolved by the delivery runtime.
   * @returns The persisted inbox row.
   */
  receive(
    delivery: Delivery,
    input: ProjectionInboxInput,
    deliveryTenantId?: TenantId,
  ): Promise<InboxMessage>;
}

/**
 * Defines framework-only access to repository runtime state.
 *
 * @internal
 */
export interface RepositoryAccess {
  // prettier-ignore

  /**
   * Determines whether a value is a repository view.
   *
   * @param repository The value to inspect.
   * @returns Whether the value belongs to a repository.
   */
  hasInstance(repository: unknown): repository is RepositoryView;

  /**
   * Returns a copy-safe repository identity snapshot.
   *
   * @param repository The repository to inspect.
   * @returns The repository identity snapshot.
   */
  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot;

  /**
   * Returns schemas for events that the repository can produce.
   *
   * @param repository the repository to inspect.
   * @returns the produced event schemas.
   */
  producedEventSchemas(repository: RepositoryView): readonly MessageSchema[];

  /**
   * Returns the repository command dispatcher when it has command routing.
   *
   * @param repository The repository to inspect.
   * @returns The command dispatcher, if present.
   */
  commandDispatcher(repository: RepositoryView): CommandDispatcher | undefined;

  /**
   * Returns the repository event dispatcher when it has event routing.
   *
   * @param repository The repository to inspect.
   * @returns The event dispatcher, if present.
   */
  eventDispatcher(repository: RepositoryView): EventDispatcher | undefined;

  /**
   * Returns the repository System Event dispatcher, if present.
   *
   * @param repository The repository to inspect.
   * @returns The System Event dispatcher, if present.
   */
  systemEventDispatcher(repository: RepositoryView): EventDispatcher | undefined;

  /**
   * Returns Entity state type names subscribed by the repository.
   *
   * @param repository The repository to inspect.
   * @returns The subscribed Entity state type names.
   */
  stateSubscriptionTypes(repository: RepositoryView): readonly string[];

  /**
   * Calculates a Projection's internal route for an Entity state-change System event.
   *
   * @param repository The Projection repository to route through.
   * @param event The Entity state-change System event.
   * @returns The calculated route, or `undefined` for an unrelated state.
   */
  routeStateUpdate(
    repository: RepositoryView,
    event: Event,
  ): RepositoryStateUpdateRoute | undefined;

  /**
   * Returns the Entity Inbox target configured for a repository.
   *
   * @param repository The repository to inspect.
   * @returns The inbox target, if present.
   */
  entityInboxTarget(repository: RepositoryView): EntityInboxTarget | undefined;

  /**
   * Returns the projection inbox target configured for a repository.
   *
   * @param repository The repository to inspect.
   * @returns The inbox target, if present.
   */
  projectionInboxTarget(repository: RepositoryView): ProjectionInboxTarget | undefined;

  /**
   * Dispatches an event directly to a projection repository.
   *
   * @param repository The projection repository to dispatch to.
   * @param event The event to dispatch.
   * @param rebuild Selects the stored-event rebuild loading mode.
   * @returns A promise that resolves after the projection receives the event.
   */
  dispatchProjectionDirect(
    repository: RepositoryView,
    event: Event,
    rebuild?: boolean,
  ): Promise<void>;

  /**
   * Binds a built runtime to a repository.
   *
   * @param repository The repository receiving runtime services.
   * @param runtime The context runtime to bind.
   */
  bindRuntime(repository: RepositoryView, runtime: RepositoryRuntime): void;

  /**
   * Clears runtime state and open storage handles for a repository.
   *
   * @param repository The repository to detach.
   */
  clearRuntime(repository: RepositoryView): void;
}

/**
 * Exposes framework-only repository access for bounded-context assembly.
 *
 * @internal
 */
export const repositoryAccess: RepositoryAccess = Object.freeze({
  /**
   * Checks whether a value has registered repository identity metadata.
   *
   * @param repository Value to inspect.
   * @returns Whether the value is a repository view.
   */
  hasInstance(repository: unknown): repository is RepositoryView {
    return repositorySnapshots.has(repository as RepositoryView);
  },

  /**
   * Copies a repository's immutable identity metadata.
   *
   * @param repository Repository to inspect.
   * @returns A copy-safe identity snapshot.
   */
  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot {
    const snapshot = repositorySnapshots.get(repository);

    if (snapshot === undefined) {
      throw new TypeError("Repository snapshot requires a Repository instance.");
    }

    return RepositoryIdentity.cloneRepositorySnapshot(snapshot);
  },

  /**
   * Reads schemas for Events this repository can emit.
   *
   * @param repository Repository to inspect.
   * @returns Registered produced Event schemas.
   */
  producedEventSchemas(repository: RepositoryView): readonly MessageSchema[] {
    const schemas = repositoryProducedEventSchemas.get(repository);

    if (schemas === undefined) {
      throw new TypeError("Produced event schemas require a Repository instance.");
    }

    return schemas;
  },

  /**
   * Looks up command dispatch for the repository.
   *
   * @param repository Repository to inspect.
   * @returns A dispatcher when command routes are registered.
   */
  commandDispatcher(repository: RepositoryView): CommandDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.command;
  },

  /**
   * Looks up Event dispatch for the repository.
   *
   * @param repository Repository to inspect.
   * @returns A dispatcher when Event routes are registered.
   */
  eventDispatcher(repository: RepositoryView): EventDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.event;
  },

  /**
   * Looks up state-update System Event dispatch for the repository.
   *
   * @param repository Repository to inspect.
   * @returns A dispatcher when state subscriptions are registered.
   */
  systemEventDispatcher(repository: RepositoryView): EventDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.systemEvent;
  },

  /**
   * Lists Entity state types subscribed by this repository.
   *
   * @param repository Repository to inspect.
   * @returns A frozen list of state type names.
   */
  stateSubscriptionTypes(repository: RepositoryView): readonly string[] {
    const routing = repositoryRoutings.get(repository);
    if (routing === undefined) {
      throw new TypeError("State subscriptions require a Repository instance.");
    }
    return Object.freeze(routing.stateSchemas.map((schema) => schema.typeName));
  },

  /**
   * Resolves an Entity state-change route for a Projection repository.
   *
   * @param repository Repository to route through.
   * @param event Entity state-change System Event.
   * @returns The matching route, or `undefined` for an unrelated state.
   */
  routeStateUpdate(
    repository: RepositoryView,
    event: Event,
  ): RepositoryStateUpdateRoute | undefined {
    const routing = repositoryRoutings.get(repository);
    if (routing === undefined) {
      throw new TypeError("State-update routing requires a Repository instance.");
    }
    return routing.routeStateUpdate(event);
  },

  /**
   * Looks up the Aggregate or Process Manager inbox replay target.
   *
   * @param repository Repository to inspect.
   * @returns Its replay target, when registered.
   */
  entityInboxTarget(repository: RepositoryView): EntityInboxTarget | undefined {
    return repositoryEntityInboxTargets.get(repository);
  },

  /**
   * Looks up the Projection inbox replay target.
   *
   * @param repository Repository to inspect.
   * @returns Its replay target, when registered.
   */
  projectionInboxTarget(repository: RepositoryView): ProjectionInboxTarget | undefined {
    return repositoryProjectionInboxTargets.get(repository);
  },

  /**
   * Dispatches an Event directly to a registered Projection.
   *
   * @param repository Projection repository to dispatch through.
   * @param event Event to deliver.
   * @param rebuild Whether to load deleted state for rebuilding.
   * @returns Completion after the Projection receives the Event.
   */
  dispatchProjectionDirect(
    repository: RepositoryView,
    event: Event,
    rebuild?: boolean,
  ): Promise<void> {
    const dispatch = repositoryProjectionDirect.get(repository);

    if (dispatch === undefined) {
      throw new TypeError("Direct projection dispatch requires a projection Repository instance.");
    }

    return dispatch(event, rebuild);
  },

  /**
   * Stores a built context runtime for repository dispatch.
   *
   * @param repository Repository receiving runtime services.
   * @param runtime Context runtime to bind.
   */
  bindRuntime(repository: RepositoryView, runtime: RepositoryRuntime): void {
    repositoryRuntimes.set(repository, Object.freeze(runtime));
  },

  /**
   * Removes runtime dispatch state and closes tracked storage handles.
   *
   * @param repository Repository to detach.
   */
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
  readonly systemEvent: EventDispatcher | undefined;
}

/**
 * Holds immutable message schemas, handler selectors, and route operations.
 *
 * @typeParam Id Repository Entity identifier type.
 */
interface RepositoryRouting<Id = unknown> {
  readonly commandSchemas: readonly MessageSchema[];
  readonly eventSchemas: readonly MessageSchema[];
  readonly domesticEventSchemas: readonly MessageSchema[];
  readonly externalEventSchemas: readonly MessageSchema[];
  readonly producedEventSchemas: readonly MessageSchema[];
  readonly producedCommandSchemas: readonly MessageSchema[];
  readonly commandReadiness: CommandRegistrationReadinessLookup | undefined;
  readonly eventReadiness: EventRegistrationReadinessLookup | undefined;
  readonly stateSchemas: readonly DescriptorMessageSchema[];
  readonly stateSubscriptions: ReadonlyMap<
    string,
    readonly RegisteredHandlerMetadata<StateSubscriptionHandlerMetadata>[]
  >;

  /**
   * Finds Command reactions matching an Event type, fields, and origin.
   *
   * @param eventFullTypeName Source Event type name.
   * @param message Decoded Event message.
   * @param external Whether the Event has external origin.
   * @returns Matching Command reaction handlers.
   */
  commandReactions(
    eventFullTypeName: string,
    message: unknown,
    external: boolean,
  ): readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];

  /**
   * Finds Event reactors matching an Event type, fields, and origin.
   *
   * @param eventFullTypeName Source Event type name.
   * @param message Decoded Event message.
   * @param external Whether the Event has external origin.
   * @returns Matching Event reactor handlers.
   */
  eventReactors(
    eventFullTypeName: string,
    message: unknown,
    external: boolean,
  ): readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];

  /**
   * Finds Event subscribers matching an Event type, fields, and origin.
   *
   * @param eventFullTypeName Source Event type name.
   * @param message Decoded Event message.
   * @param external Whether the Event has external origin.
   * @returns Matching Event subscribers.
   */
  eventSubscribers(
    eventFullTypeName: string,
    message: unknown,
    external: boolean,
  ): RepositoryEventSubscribers;

  /**
   * Routes a Command to its target Entity without invoking its handler.
   *
   * @param command Command envelope to route.
   * @returns Accepted Command route.
   */
  routeCommand(command: Command): RepositoryCommandRoute<Id>;

  /**
   * Routes an Event to target Entities without invoking handlers.
   *
   * @param event Event envelope to route.
   * @returns Accepted Event route.
   */
  routeEvent(event: Event): RepositoryEventRoute<Id>;

  /**
   * Routes an Entity state-change Event to subscribed Projections.
   *
   * @param event State-change System Event to route.
   * @returns Accepted state-update route, or `undefined`.
   */
  routeStateUpdate(event: Event): RepositoryStateUpdateRoute<Id> | undefined;
}

interface RoutingSchemas {
  readonly command: readonly MessageSchema[];
  readonly event: readonly MessageSchema[];
  readonly domesticEvent: readonly MessageSchema[];
  readonly externalEvent: readonly MessageSchema[];
  readonly state: readonly DescriptorMessageSchema[];
  readonly producedEvent: readonly MessageSchema[];
  readonly producedCommand: readonly MessageSchema[];
}

interface RoutingReadiness {
  readonly command: CommandRegistrationReadinessLookup | undefined;
  readonly event: EventRegistrationReadinessLookup | undefined;
}

interface RoutingFilters {
  readonly commandReactions: ReadonlyMap<
    string,
    EventHandlerFilterPlan<RegisteredHandlerMetadata<CommandReactionHandlerMetadata>>
  >;
  readonly eventReactors: ReadonlyMap<
    string,
    EventHandlerFilterPlan<RegisteredHandlerMetadata<EventReactionHandlerMetadata>>
  >;
  readonly eventSubscribers: ReadonlyMap<
    string,
    EventHandlerFilterPlan<RepositoryEventSubscribers[number]>
  >;
  readonly commandReactionMap: ReadonlyMap<
    string,
    readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[]
  >;
}

/**
 * Maps registered schemas to custom signal routing declarations.
 *
 * @typeParam Id Repository Entity identifier type.
 */
interface RoutingMaps<Id> {
  readonly command: ReadonlyMap<MessageSchema, CommandRoute<Id>>;
  readonly event: ReadonlyMap<MessageSchema, EventRoute<Id>>;
  readonly state: ReadonlyMap<DescriptorMessageSchema, StateUpdateRoute<Id>>;
}

/**
 * Collects repository declarations used while building immutable routing.
 *
 * @typeParam Id Repository Entity identifier type.
 */
interface RoutingInput<Id> {
  readonly entityType: RepositoryEntityType;
  readonly entityFamily: EntityFamily;
  readonly metadata: EntityMetadata;
  readonly handlersOption: RepositoryHandlersOption;
  readonly producedEvents: readonly MessageSchema[];
  readonly commandRouting: RoutingDeclarationSnapshot<CommandRoute<Id>>;
  readonly eventRouting: RoutingDeclarationSnapshot<EventRoute<Id>>;
  readonly stateUpdateRouting: RoutingDeclarationSnapshot<StateUpdateRoute<Id>>;
  readonly stringifiers: StringifierRegistry;
}

interface RepositoryRuntime {
  readonly context: StorageMode;
  readonly storageFactory: StorageFactory;
  readonly stand: Stand;
  readonly signalMetadata: SignalMetadata;
  readonly entityInbox: EntityInbox;
  readonly projectionInbox: ProjectionInbox;
  readonly publisher: SignalPublisher;
  readonly registerEventSchema: (schema: MessageSchema) => void;
  readonly registerSystemEventSchema: (schema: MessageSchema) => void;
}

type RepositoryHandlersOption =
  EntityHandlersMetadata | readonly EntityHandlersMetadata[] | undefined;
type RepositoryCommandAssignee = NonNullable<
  ReturnType<NonNullable<RepositoryRouting["commandReadiness"]>["findCommandAssignee"]>
>;
type RepositoryEventSubscribers = NonNullable<
  ReturnType<NonNullable<RepositoryRouting["eventReadiness"]>["findEventSubscribers"]>
>;
type RepositoryStateSubscribers =
  readonly RegisteredHandlerMetadata<StateSubscriptionHandlerMetadata>[];

const inboxDedupMs = 30_000;

interface LoadedAggregate {
  readonly commits: EntityCommitStorage;
  readonly current: EntityRecord | undefined;
  readonly entity: object;
  readonly oldState: Message | undefined;
  readonly states: EntityStateHistoryPort<unknown, Message>;
  readonly events: EntityEventHistoryPort<unknown>;
  readonly version: bigint;
  readonly storageInput: EntityStorageInput<unknown, Message>;
}

interface AggregateSnapshot {
  readonly state: unknown;
  readonly versionMessage: Version;
  readonly archived: boolean;
  readonly deleted: boolean;
}

interface AggregateConstructorOptions {
  id: unknown;
  schema: DescriptorMessageSchema;
  state: unknown;
  version: Version;
  lifecycle?: {
    readonly archived: boolean;
    readonly deleted: boolean;
  };
}

interface LoadedRepositoryEntity {
  readonly commits: EntityCommitStorage;
  readonly current: EntityRecord | undefined;
  readonly entity: object;
  readonly events: EntityEventHistoryPort<unknown>;
  readonly storageInput: EntityStorageInput<unknown, Message>;
}

/**
 * Loads and persists Aggregate state within one tenant storage context.
 */
class AggregateExecutionSupport {
  readonly #repository: RepositoryView;

  readonly #runtime: RepositoryRuntime;

  readonly #storageContext: StorageContext;

  /**
   * Binds an Aggregate repository to runtime and tenant storage services.
   *
   * @param repository Aggregate repository being executed.
   * @param runtime Built context services.
   * @param storageContext Tenant-aware storage location.
   */
  constructor(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    storageContext: StorageContext,
  ) {
    this.#repository = repository;
    this.#runtime = runtime;
    this.#storageContext = storageContext;
  }

  /**
   * Restores an Aggregate from Stand or creates its initial state and binds history.
   *
   * @param entityId Aggregate identifier to load.
   * @returns Aggregate instance, current record, history ports, and version.
   */
  async loadAggregate(entityId: unknown): Promise<LoadedAggregate> {
    const storageInput = RepositoryStorage.entityStorageInput(
      this.#repository,
      this.#storageContext,
    );
    const storage = RepositoryStorage.openRepositoryEntityStorage(
      this.#repository,
      this.#runtime.storageFactory,
      storageInput,
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
    RepositoryHistoryInternals.bindEntityHistory(
      entity,
      storage,
      entityId,
      this.#repository.stateSchema,
    );

    return Object.freeze({
      commits: storage.commits,
      current:
        current === undefined
          ? undefined
          : EntityRecords.pack(
              this.#repository.stateSchema,
              entityId,
              current.state,
              current.versionMessage,
              { archived: current.archived, deleted: current.deleted },
            ),
      entity,
      oldState:
        current === undefined
          ? undefined
          : clone(this.#repository.stateSchema, current.state as never),
      states: storage.states,
      events: storage.events,
      version: current?.version ?? 0n,
      storageInput,
    });
  }

  /**
   * Normalizes a handler result to a frozen signal list.
   *
   * @param produced Raw handler result.
   * @returns No signals, one signal, or the copied result array.
   */
  normalizeProducedSignals(produced: unknown): readonly unknown[] {
    if (produced === undefined) {
      return Object.freeze([]);
    }

    if (Array.isArray(produced)) {
      return Object.freeze(
        Array.from(produced as readonly unknown[]).filter((item) => item !== undefined),
      );
    }

    return Object.freeze([produced]);
  }

  /**
   * Stores the current Aggregate record before its diagnostic and delivery journals.
   *
   * @param loaded Aggregate and commit storage to update.
   * @param entityId Aggregate identifier.
   * @param events Produced Events to retain.
   * @returns `true` after a successful commit; conflicts throw.
   */
  async persistAggregateUpdate(
    loaded: LoadedAggregate,
    entityId: unknown,
    events: readonly Event[],
  ): Promise<boolean> {
    const lifecycle = RepositoryEntities.repositoryLifecycle(loaded.entity);
    const state = RepositoryEntities.repositoryState(loaded.entity) as Message;
    const versionMessage = RepositoryEntities.repositoryVersion(loaded.entity);
    const deferred = await standAccess.deferUpdate(
      this.#runtime.stand,
      this.#repository.stateSchema,
      state,
      RepositoryStand.standUpdateOptions(this.#storageContext.tenantId, versionMessage, lifecycle),
    );
    try {
      const outcome = await this.#commitAggregateRecord(
        loaded,
        entityId,
        state,
        versionMessage,
        lifecycle,
        events,
      );
      if (outcome !== "committed") {
        throw new Error("Concurrent Aggregate state commit conflict.");
      }
      entityStateHistoryCaches.get(loaded.entity)?.clear();
    } catch (error) {
      deferred.cancel();
      throw error;
    }
    this.#notifyAggregate(() => {
      deferred.notify();
    }, events);
    return true;
  }

  /**
   * Notifies Stand after an Aggregate commit and reports delivery failure.
   *
   * @param onNotify Delivers the deferred Stand update.
   * @param events Produced Events available for failure reporting.
   */
  #notifyAggregate(onNotify: () => void, events: readonly Event[]): void {
    try {
      onNotify();
    } catch (error) {
      const event = events[events.length - 1];
      if (event !== undefined) this.#runtime.publisher.reportFailure("event", event, error);
    }
  }

  /**
   * Writes one Aggregate state and its optional history with the same Version.
   *
   * @param loaded Loaded Aggregate and commit storage.
   * @param entityId Aggregate identifier.
   * @param state Accepted Aggregate state.
   * @param version Current Spine Version.
   * @param lifecycle Accepted lifecycle flags.
   * @param events Produced Events to retain and publish.
   * @returns The storage commit outcome.
   */
  #commitAggregateRecord(
    loaded: LoadedAggregate,
    entityId: unknown,
    state: Message,
    version: Version,
    lifecycle: EntityLifecycleFlags,
    events: readonly Event[],
  ): Promise<"committed" | "conflict"> {
    const record = EntityRecords.pack(
      this.#repository.stateSchema,
      entityId,
      state,
      version,
      lifecycle,
    );
    return loaded.commits.commit({
      context: this.#storageContext,
      entity: loaded.storageInput,
      entityId,
      ...(loaded.current === undefined ? {} : { expected: loaded.current }),
      next: record,
      ...(RepositoryStorage.historyConfiguration(this.#repository).stateHistory
        ? { states: [record] }
        : {}),
      diagnostics: events.map((event) => clone(EventSchema, event)),
      events,
    });
  }

  /**
   * Writes a copied Event to the Aggregate diagnostic history.
   *
   * @param loaded Aggregate with its history port.
   * @param entityId Aggregate identifier retained for the caller contract.
   * @param event Event to append.
   * @returns Completion after the history append.
   */
  async appendDiagnosticEvent(
    loaded: LoadedAggregate,
    entityId: unknown,
    event: Event,
  ): Promise<void> {
    await loaded.events.append(clone(EventSchema, event));
  }

  /**
   * Completes persistence before scheduling best-effort stored-Event dispatch.
   *
   * @param loaded Aggregate and commit storage to update.
   * @param entityId Aggregate identifier.
   * @param events Produced Events to persist and dispatch.
   * @param dispatch Publishes one committed Event.
   * @param onPersisted Runs after durable persistence.
   * @returns A deferred follow-up that dispatches the Events.
   */
  async persistAggregateAndDispatch(
    loaded: LoadedAggregate,
    entityId: unknown,
    events: readonly Event[],
    dispatch: (event: Event) => Promise<void>,
    onPersisted: () => Promise<void> | void,
  ): Promise<() => Promise<void>> {
    const committed = await this.persistAggregateUpdate(loaded, entityId, events);
    if (!committed) return () => Promise.resolve();
    await onPersisted();
    return async () => {
      await Promise.all(
        events.map(async (event) => {
          try {
            await dispatch(event);
          } catch (error) {
            this.#runtime.publisher.reportFailure("event", event, error);
          }
        }),
      );
    };
  }

  /**
   * Restores an Aggregate or creates one with initial state and version zero.
   *
   * @param entityId Aggregate identifier.
   * @param current Stored state and lifecycle, when present.
   * @returns The constructed Aggregate instance.
   */
  #instantiateAggregate(entityId: unknown, current: AggregateSnapshot | undefined): object {
    const entityType = this.#repository.entityType as unknown as new (
      options: AggregateConstructorOptions,
    ) => object;
    const options: AggregateConstructorOptions = {
      id: entityId,
      schema: this.#repository.stateSchema,
      state: current?.state ?? this.#defaultState(entityId),
      version: current?.versionMessage ?? create(VersionSchema),
    };

    if (current !== undefined) {
      options.lifecycle = { archived: current.archived, deleted: current.deleted };
    }

    return new entityType(options);
  }

  /**
   * Creates generated initial state with its canonical identifier field set.
   *
   * @param entityId Identifier to place in the state.
   * @returns A new state message.
   */
  #defaultState(entityId: unknown): unknown {
    return create(this.#repository.stateSchema, {
      [this.#repository.idField.localName]: entityId,
    });
  }
}

/**
 * Executes one routed Aggregate Command and stores its resulting Events.
 */
class AggregateCommandExecution {
  readonly #repository: CommandRoutingRepository;

  readonly #routing: RepositoryRouting;

  readonly #runtime: RepositoryRuntime;

  readonly #command: Command;

  readonly #support: AggregateExecutionSupport;

  /**
   * Captures routing, runtime, Command, and tenant-scoped persistence services.
   *
   * @param repository Aggregate repository receiving the Command.
   * @param routing Registered Command routes and schemas.
   * @param runtime Built context services.
   * @param command Command to execute.
   */
  constructor(
    repository: CommandRoutingRepository,
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
      RepositoryTenants.storageContextForCommand(this.#runtime.context, this.#command),
    );
  }

  /**
   * Validates the Command and executes its assignee when registered.
   *
   * @param replayedRoute Accepted route from durable inbox replay, when present.
   * @returns A deferred dispatch follow-up, or `undefined` without an assignee.
   */
  async run(replayedRoute?: RepositoryCommandRoute): Promise<EntityInboxFollowUp | undefined> {
    void RepositorySignals.requireCommandId(this.#command);
    const intake = this.#readIntake(replayedRoute);
    if (intake === undefined) return undefined;
    return this.#runAssignee(intake);
  }

  /**
   * Decodes the Command and selects its registered assignee.
   *
   * @param replayedRoute Accepted inbox route, when present.
   * @returns Decoded message and route with an assignee, or `undefined`.
   */
  #readIntake(replayedRoute?: RepositoryCommandRoute):
    | {
        readonly message: unknown;
        readonly route: RepositoryCommandRoute;
        readonly assignee: RepositoryCommandAssignee;
      }
    | undefined {
    const commandMessage = EntityInvocation.requireSignalMessage(this.#command.message, "command");
    const commandSchema = RepositoryRoutes.schemaForTypeUrl(
      this.#routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );
    const message = EntityInvocation.unpackRequired(commandMessage, commandSchema, "command");
    const route = replayedRoute ?? this.#repository.routeCommand(this.#command);
    const assignee = this.#routing.commandReadiness?.findCommandAssignee(route.messageFullTypeName);
    return assignee === undefined ? undefined : Object.freeze({ message, route, assignee });
  }

  /**
   * Invokes the assignee, persists its Events, or publishes a declared rejection.
   *
   * @param intake Decoded Command, target route, and assignee.
   * @returns A deferred Event follow-up or a rejection follow-up.
   */
  async #runAssignee(intake: {
    readonly message: unknown;
    readonly route: RepositoryCommandRoute;
    readonly assignee: RepositoryCommandAssignee;
  }): Promise<EntityInboxFollowUp | undefined> {
    const loaded = await this.#support.loadAggregate(intake.route.entityId);
    this.#publishCommandDispatch(intake.route.entityId);
    let produced: unknown;
    try {
      produced = await this.#invokeAssignee(
        loaded.entity,
        intake.assignee.handler,
        intake.message,
        EntityInvocation.commandHandlerContext(this.#command),
      );
    } catch (error) {
      return this.#postAssigneeRejection(intake, error);
    }
    const events = this.#requiredEvents(
      produced,
      intake.assignee.handler,
      intake.route.entityId,
      RepositoryEntities.priorVersion(loaded.current),
    );
    return this.#persistAssigneeResult(loaded, intake.route.entityId, events);
  }

  /**
   * Publishes a declared rejection from the invoked Aggregate assignee.
   *
   * @param intake Assignee and target route for the rejected Command.
   * @param error Handler failure to classify and publish.
   * @returns A rejection follow-up when one is created.
   */
  #postAssigneeRejection(
    intake: {
      readonly assignee: RepositoryCommandAssignee;
      readonly route: RepositoryCommandRoute;
    },
    error: unknown,
  ): EntityInboxFollowUp | undefined {
    if (!RejectionThrowable.is(error)) throw error;
    RepositorySignals.requireDeclaredRejection(intake.assignee.handler, error);
    return RepositorySignals.postRejectionEvent(
      this.#runtime,
      this.#repository,
      this.#command,
      intake.route.entityId,
      error,
    );
  }

  /**
   * Publishes a best-effort Command dispatch diagnostic.
   *
   * @param entityId Target Aggregate identifier.
   */
  #publishCommandDispatch(entityId: unknown): void {
    HandlerDispatchPublisher.command(this.#runtime, this.#repository, this.#command, entityId);
  }

  /**
   * Binds the assignee result to Events and rejects an empty result.
   *
   * @param produced Raw assignee result.
   * @param handler Assignee declaration associated with the result.
   * @param entityId Target Aggregate identifier.
   * @param version Producer version before Command handling.
   * @returns At least one bound Event.
   */
  #requiredEvents(
    produced: unknown,
    handler: RepositoryCommandAssignee["handler"],
    entityId: unknown,
    version: Version,
  ): readonly Event[] {
    const events = this.#bindProducedEvents(
      this.#support.normalizeProducedSignals(produced),
      entityId,
      version,
      true,
    );
    if (events.length === 0)
      throw new Error("Repository aggregate command handlers must return at least one event.");
    return events;
  }

  /**
   * Stores accepted Aggregate changes and publishes a state-change diagnostic.
   *
   * @param loaded Aggregate and commit storage.
   * @param entityId Target Aggregate identifier.
   * @param events Bound Events from the assignee.
   * @returns A deferred committed-Event dispatch follow-up.
   */
  #persistAssigneeResult(
    loaded: LoadedAggregate,
    entityId: unknown,
    events: readonly Event[],
  ): Promise<EntityInboxFollowUp | undefined> {
    const committedVersion = loaded.version + 1n;
    return this.#support.persistAggregateAndDispatch(
      loaded,
      entityId,
      events,
      (event) => this.#runtime.publisher.publishCommittedEvent(event),
      () => {
        if (!RepositoryEntities.repositoryChanged(loaded.entity)) return;
        EntityStateChangePublisher.command(
          this.#runtime,
          this.#repository,
          this.#command,
          entityId,
          loaded.oldState,
          loaded.current === undefined
            ? undefined
            : {
                archived: loaded.current.lifecycleFlags?.archived ?? false,
                deleted: loaded.current.lifecycleFlags?.deleted ?? false,
              },
          RepositoryEntities.repositoryState(loaded.entity) as Message,
          RepositoryEntities.repositoryLifecycle(loaded.entity),
          RepositorySignals.eventVersionNumber(committedVersion),
        );
      },
    );
  }

  /**
   * Invokes an assignee in a fenced Entity transaction with output validation.
   *
   * @param entity Aggregate instance to mutate.
   * @param handler Assignee declaration to invoke.
   * @param message Decoded Command message.
   * @param context Copied Command context for the handler.
   * @returns The handler's raw result after a successful commit.
   */
  async #invokeAssignee(
    entity: object,
    handler: RepositoryCommandAssignee["handler"],
    message: unknown,
    context: unknown,
  ): Promise<unknown> {
    transactionalEntityAccess.start(entity);
    try {
      const produced = await EntityInvocation.invokeEntityMethod(
        entity,
        handler.methodName,
        message,
        handler.parameterCount,
        context,
      );
      RepositoryHandlers.requireDeclaredOutputs(
        handler,
        this.#support.normalizeProducedSignals(produced),
        true,
      );
      const commit = await commitFenced(entity, (current) =>
        transactionalEntityAccess.commit(current, true),
      );
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }

      return produced;
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    }
  }

  /**
   * Binds each produced result to the target and pre-dispatch version.
   *
   * @param produced Handler results to bind.
   * @param entityId Target Aggregate identifier.
   * @param lastVersion Producer version before this dispatch.
   * @param allowEnvelopes Whether existing Event envelopes are accepted.
   * @returns Frozen bound Event list.
   */
  #bindProducedEvents(
    produced: readonly unknown[],
    entityId: unknown,
    lastVersion: Version,
    allowEnvelopes: boolean,
  ): readonly Event[] {
    const dispatchVersion = lastVersion;

    return Object.freeze(
      produced.map((signal) =>
        this.#bindProducedEvent(signal, entityId, dispatchVersion, allowEnvelopes),
      ),
    );
  }

  /**
   * Packs a domain Event or copies an allowed envelope with producer context.
   *
   * @param signal One handler result.
   * @param entityId Target Aggregate identifier.
   * @param version Producer version before dispatch.
   * @param allowEnvelopes Whether a supplied Event envelope may pass through.
   * @returns Event bound to this Aggregate.
   */
  #bindProducedEvent(
    signal: unknown,
    entityId: unknown,
    version: Version,
    allowEnvelopes: boolean,
  ): Event {
    const metadata = this.#runtime.signalMetadata.eventFromCommand(this.#command, {
      version: version.number,
    });
    const bound =
      allowEnvelopes && EntityInvocation.isEventEnvelope(signal)
        ? clone(EventSchema, signal)
        : this.#packDomainEvent(signal, metadata);
    bound.context = RepositorySignals.eventContextWithProducer(
      metadata.context,
      this.#repository,
      entityId,
      version,
    );
    return bound;
  }

  /**
   * Packs a declared domain Event message into an Event envelope.
   *
   * @param message Generated Event message from the handler.
   * @param metadata ID and context derived from the source Command.
   * @returns Packed Event envelope.
   */
  #packDomainEvent(
    message: unknown,
    metadata: ReturnType<SignalMetadata["eventFromCommand"]>,
  ): Event {
    const typeName = EntityInvocation.messageTypeName(message);
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

/**
 * Runs Aggregate Event reactors and persists their state and Event results.
 */
class AggregateEventExecution {
  readonly #repository: EventRoutingRepository;

  readonly #routing: RepositoryRouting;

  readonly #runtime: RepositoryRuntime;

  readonly #event: Event;

  readonly #support: AggregateExecutionSupport;

  /**
   * Captures Event routing and tenant-scoped Aggregate storage services.
   *
   * @param repository Aggregate repository receiving the Event.
   * @param routing Registered Event routes and schemas.
   * @param runtime Built context services.
   * @param event Source Event to react to.
   */
  constructor(
    repository: EventRoutingRepository,
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
      RepositoryTenants.storageContextForEvent(this.#runtime.context, this.#event),
    );
  }

  /**
   * Executes matching reactors for one routed Aggregate target.
   *
   * @param entityId Target Aggregate identifier.
   * @param acceptedRoute Route accepted before execution.
   * @returns Completion after matching reactors run.
   */
  async runTarget(entityId: unknown, acceptedRoute: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.reactors.length === 0) {
      return;
    }

    await this.#executeEntity(entityId, intake);
  }

  /**
   * Decodes the Event and selects reactors with declared output.
   *
   * @param acceptedRoute Route accepted before execution.
   * @returns Decoded message, route, and matching reactors.
   */
  #readIntake(acceptedRoute: RepositoryEventRoute): {
    readonly message: unknown;
    readonly route: RepositoryEventRoute;
    readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
  } {
    const eventMessage = EntityInvocation.requireSignalMessage(this.#event.message, "event");
    const eventSchema = RepositoryRoutes.schemaForTypeUrl(
      this.#routing.eventSchemas,
      eventMessage.typeUrl,
      "event",
    );
    const message = EntityInvocation.unpackRequired(eventMessage, eventSchema, "event");
    const route = acceptedRoute;
    const reactors = this.#routing
      .eventReactors(route.messageFullTypeName, message, this.#event.context?.external === true)
      .filter((reactor) => RepositoryHandlers.handlerEmittedSchemas(reactor.handler).length > 0);
    return Object.freeze({
      message,
      route,
      reactors: Object.freeze([...reactors]),
    });
  }

  /**
   * Invokes reactors, persists their result, and journals the source Event.
   *
   * @param entityId Target Aggregate identifier.
   * @param intake Decoded Event and matching reactors.
   * @returns Completion after persistence and journaling.
   */
  async #executeEntity(
    entityId: unknown,
    intake: {
      readonly message: unknown;
      readonly route: RepositoryEventRoute;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    },
  ): Promise<void> {
    const loaded = await this.#support.loadAggregate(entityId);
    const produced = await this.#invokeHandlers(entityId, loaded, intake);
    await this.#persistProducedEvents(loaded, entityId, produced);
    await this.#support.appendDiagnosticEvent(
      loaded,
      entityId,
      DispatchGuards.guardedJournalEvent(this.#repository, this.#event, entityId),
    );

    return undefined;
  }

  /**
   * Stores changed state or produced Events and schedules reactor publication.
   *
   * @param loaded Aggregate and commit storage.
   * @param entityId Target Aggregate identifier.
   * @param produced Events returned by reactors.
   * @returns Completion after accepted state and Events are stored.
   */
  async #persistProducedEvents(
    loaded: LoadedAggregate,
    entityId: unknown,
    produced: readonly Event[],
  ): Promise<void> {
    if (produced.length === 0 && !RepositoryEntities.repositoryChanged(loaded.entity)) return;
    const dispatch = await this.#support.persistAggregateAndDispatch(
      loaded,
      entityId,
      produced,
      (event) => this.#runtime.publisher.publishReactorEvent(event),
      () => {
        this.#publishStateChange(loaded, entityId);
      },
    );
    void dispatch();
  }

  /**
   * Publishes an Entity state-change System Event when the Aggregate changed.
   *
   * @param loaded Aggregate before and after handling.
   * @param entityId Target Aggregate identifier.
   */
  #publishStateChange(loaded: LoadedAggregate, entityId: unknown): void {
    if (!RepositoryEntities.repositoryChanged(loaded.entity)) return;
    EntityStateChangePublisher.event(
      this.#runtime,
      this.#repository,
      this.#event,
      entityId,
      loaded.oldState,
      this.#lifecycleSnapshot(loaded),
      RepositoryEntities.repositoryState(loaded.entity) as Message,
      RepositoryEntities.repositoryLifecycle(loaded.entity),
      RepositorySignals.eventVersionNumber(loaded.version + 1n),
    );
  }

  /**
   * Reads lifecycle flags from the prior stored Aggregate record.
   *
   * @param loaded Aggregate with its optional prior record.
   * @returns Prior flags, or `undefined` for a new Aggregate.
   */
  #lifecycleSnapshot(
    loaded: LoadedAggregate,
  ): { readonly archived: boolean; readonly deleted: boolean } | undefined {
    return loaded.current === undefined
      ? undefined
      : {
          archived: loaded.current.lifecycleFlags?.archived ?? false,
          deleted: loaded.current.lifecycleFlags?.deleted ?? false,
        };
  }

  /**
   * Invokes matching reactors in one Entity transaction and commits their changes.
   *
   * @param entityId Target Aggregate identifier.
   * @param loaded Restored Aggregate and version.
   * @param intake Decoded Event and matching reactors.
   * @returns Frozen list of produced Events.
   */
  async #invokeHandlers(
    entityId: unknown,
    loaded: LoadedAggregate,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    },
  ): Promise<readonly Event[]> {
    const eventContext = EntityInvocation.eventHandlerContext(this.#event);
    const events: Event[] = [];

    transactionalEntityAccess.start(loaded.entity);
    try {
      await this.#invokeReactors(entityId, loaded, intake, eventContext, events);
      await this.#commitEntity(loaded.entity, events.length > 0);
      return Object.freeze(events);
    } catch (error) {
      transactionalEntityAccess.rollback(loaded.entity);
      throw error;
    }
  }

  /**
   * Invokes each reactor, checks its declared output, and collects bound Events.
   *
   * @param entityId Target Aggregate identifier.
   * @param loaded Restored Aggregate and producer version.
   * @param intake Decoded Event and matching reactors.
   * @param eventContext Copied source Event context.
   * @param events Output list to append to.
   * @returns Completion after all reactors run.
   */
  async #invokeReactors(
    entityId: unknown,
    loaded: LoadedAggregate,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    },
    eventContext: unknown,
    events: Event[],
  ): Promise<void> {
    if (intake.reactors.length > 0)
      HandlerDispatchPublisher.reactor(this.#runtime, this.#repository, this.#event, entityId);
    for (const reactor of intake.reactors) {
      const produced = await EntityInvocation.invokeEntityMethod(
        loaded.entity,
        reactor.handler.methodName,
        intake.message,
        reactor.handler.parameterCount,
        eventContext,
      );
      RepositoryHandlers.requireDeclaredOutputs(
        reactor.handler,
        this.#support.normalizeProducedSignals(produced),
      );
      events.push(
        ...this.#bindProducedEvents(
          this.#support.normalizeProducedSignals(produced),
          entityId,
          RepositoryEntities.priorVersion(loaded.current),
        ),
      );
    }
  }

  /**
   * Applies a fenced Entity commit and raises transition rejection.
   *
   * @param entity Aggregate instance to commit.
   * @param producedEvents Whether reactors produced Events.
   * @returns Completion after a successful fenced commit.
   */
  async #commitEntity(entity: object, producedEvents: boolean): Promise<void> {
    const commit = await commitFenced(entity, (current) =>
      transactionalEntityAccess.commit(current, producedEvents),
    );
    if (commit.status === "rejected") throw new TransitionValidationError(commit.validation.error);
  }

  /**
   * Binds reactor results using the pre-dispatch Aggregate version.
   *
   * @param produced Domain Event messages from reactors.
   * @param entityId Target Aggregate identifier.
   * @param lastVersion Producer version before this Event.
   * @returns Frozen Event envelope list.
   */
  #bindProducedEvents(
    produced: readonly unknown[],
    entityId: unknown,
    lastVersion: Version,
  ): readonly Event[] {
    const version = lastVersion;
    return Object.freeze(
      produced.map((signal) => this.#bindProducedEvent(signal, entityId, version)),
    );
  }

  /**
   * Packs a declared reactor result with source and producer context.
   *
   * @param signal One domain Event message.
   * @param entityId Target Aggregate identifier.
   * @param version Producer version before dispatch.
   * @returns Bound Event envelope.
   */
  #bindProducedEvent(signal: unknown, entityId: unknown, version: Version): Event {
    const typeName = EntityInvocation.messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(`Repository aggregate execution cannot pack event message "${typeName}".`);
    }

    const metadata = this.#runtime.signalMetadata.eventFromEvent(this.#event, {
      version: version.number,
    });

    return create(EventSchema, {
      id: metadata.id,
      message: AnyMessages.pack(schema, signal as never),
      context: RepositorySignals.eventContextWithProducer(
        metadata.context,
        this.#repository,
        entityId,
        version,
      ),
    });
  }
}

type EntityLoadMode = "stored" | "rebuild";

/**
 * Routes subscribed Events and state updates to a Projection.
 */
class ProjectionEventExecution {
  readonly #repository: EventRoutingRepository;

  readonly #routing: RepositoryRouting;

  readonly #runtime: RepositoryRuntime;

  readonly #event: Event;

  readonly #rebuild: boolean;

  /**
   * Captures Projection routing, runtime, source Event, and loading mode.
   *
   * @param repository Projection repository receiving the Event.
   * @param routing Registered Event and state routes.
   * @param runtime Built context services.
   * @param event Source Event to deliver.
   * @param rebuild Whether to restore deleted state for rebuilding.
   */
  constructor(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    runtime: RepositoryRuntime,
    event: Event,
    rebuild = false,
  ) {
    this.#repository = repository;
    this.#routing = routing;
    this.#runtime = runtime;
    this.#event = event;
    this.#rebuild = rebuild;
  }

  /**
   * Delivers a decoded Entity state update to one Projection target.
   *
   * @param repository Projection repository receiving the update.
   * @param routing Registered state-update routes.
   * @param runtime Built context services.
   * @param event Source state-change System Event.
   * @param entityId Target Projection identifier.
   * @param route Accepted state-update route.
   * @param subscribers State subscribers to invoke.
   * @returns Completion after the target receives the state.
   */
  static async runStateTarget(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    runtime: RepositoryRuntime,
    event: Event,
    entityId: unknown,
    route: RepositoryStateUpdateRoute,
    subscribers: RepositoryStateSubscribers,
  ): Promise<void> {
    const execution = new ProjectionEventExecution(repository, routing, runtime, event);
    await execution.#executeStateTarget(entityId, route.state, subscribers);
  }

  /**
   * Delivers an accepted Event to the durable Projection inbox.
   *
   * @param acceptedRoute Route accepted before dispatch.
   * @returns Completion after inbox handoff.
   */
  async run(acceptedRoute: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.subscribers.length === 0) {
      return;
    }

    for (const entityId of intake.route.entityIds) {
      await InboxHandoff.handoffProjectionEvent(
        this.#repository,
        this.#runtime,
        this.#event,
        entityId,
      );
    }
  }

  /**
   * Delivers an accepted Event for one Projection target.
   *
   * @param entityId Target Projection identifier.
   * @param acceptedRoute Route accepted before replay.
   * @returns Completion after target delivery.
   */
  async runTarget(entityId: unknown, acceptedRoute: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.subscribers.length === 0) {
      return;
    }

    await this.#executeTarget(entityId, intake.subscribers);
  }

  /**
   * Dispatches directly to all routed Projection targets.
   *
   * @param acceptedRoute Route accepted before direct dispatch, when present.
   * @returns Completion after all targets receive the Event.
   */
  async runDirect(acceptedRoute?: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.subscribers.length === 0) {
      return;
    }

    for (const entityId of intake.route.entityIds) {
      await this.#executeTarget(entityId, intake.subscribers);
    }
  }

  /**
   * Invokes Event subscribers and stores a changed Projection state.
   *
   * @param entityId Target Projection identifier.
   * @param subscribers Selected Event subscribers.
   * @returns Completion after handling and any state commit.
   */
  async #executeTarget(entityId: unknown, subscribers: RepositoryEventSubscribers): Promise<void> {
    const packedMessage = EntityInvocation.requireSignalMessage(this.#event.message, "event");
    const tenantOptions = RepositoryTenants.standTenantOptions(this.#runtime.context, this.#event);
    const mode: EntityLoadMode = this.#rebuild ? "rebuild" : "stored";
    const loaded = await this.#loadProjection(entityId, tenantOptions, mode);

    HandlerDispatchPublisher.subscriber(this.#runtime, this.#repository, this.#event, entityId);
    await this.#invokeSubscribers(loaded.entity, subscribers, packedMessage);
    await this.#storeIfChanged(
      loaded,
      tenantOptions,
      loaded.current === undefined
        ? undefined
        : EntityRecords.unpack(this.#repository.stateSchema, loaded.current).state,
      mode,
    );
  }

  /**
   * Invokes state subscribers and stores a changed Projection state.
   *
   * @param entityId Target Projection identifier.
   * @param state Decoded source Entity state.
   * @param subscribers Selected state subscribers.
   * @returns Completion after handling and any state commit.
   */
  async #executeStateTarget(
    entityId: unknown,
    state: Message,
    subscribers: RepositoryStateSubscribers,
  ): Promise<void> {
    const tenantOptions = RepositoryTenants.standTenantOptions(this.#runtime.context, this.#event);
    const loaded = await this.#loadProjection(entityId, tenantOptions, "stored");
    await this.#invokeStateSubscribers(loaded.entity, subscribers, state);
    await this.#storeIfChanged(
      loaded,
      tenantOptions,
      loaded.current === undefined
        ? undefined
        : EntityRecords.unpack(this.#repository.stateSchema, loaded.current).state,
      "stored",
    );
  }

  /**
   * Resolves the route, decodes the Event, and filters its subscribers.
   *
   * @param acceptedRoute Route accepted before delivery, when present.
   * @returns Route and matching subscribers.
   */
  #readIntake(acceptedRoute?: RepositoryEventRoute): {
    readonly route: RepositoryEventRoute;
    readonly subscribers: RepositoryEventSubscribers;
  } {
    const route = acceptedRoute ?? this.#repository.routeEvent(this.#event);
    const packedMessage = EntityInvocation.requireSignalMessage(this.#event.message, "event");
    const eventSchema = RepositoryRoutes.schemaForTypeUrl(
      this.#routing.eventSchemas,
      packedMessage.typeUrl,
      "event",
    );
    const message = EntityInvocation.unpackRequired(packedMessage, eventSchema, "event");
    const subscribers = this.#routing.eventSubscribers(
      route.messageFullTypeName,
      message,
      this.#event.context?.external === true,
    );

    return Object.freeze({
      route,
      subscribers,
    });
  }

  /**
   * Persists changed Projection state, notifies Stand, and publishes the change.
   *
   * @param loaded Projection and commit storage.
   * @param tenantOptions Stand tenant selection.
   * @param oldState State before delivery, when present.
   * @param mode Stored or rebuild loading mode.
   * @returns Completion after a changed state is stored and published.
   */
  async #storeIfChanged(
    loaded: LoadedRepositoryEntity,
    tenantOptions: { readonly tenantId?: TenantId },
    oldState: Message | undefined,
    mode: EntityLoadMode,
  ): Promise<void> {
    if (!RepositoryEntities.repositoryChanged(loaded.entity)) {
      return;
    }

    const entityId = (loaded.entity as { readonly id: unknown }).id;
    const state = RepositoryEntities.repositoryState(loaded.entity) as Message;
    const version = RepositoryEntities.repositoryVersion(loaded.entity);
    const lifecycle = RepositoryEntities.repositoryLifecycle(loaded.entity);
    const deferred = await standAccess.deferUpdate(
      this.#runtime.stand,
      this.#repository.stateSchema,
      state,
      RepositoryStand.standUpdateOptions(tenantOptions.tenantId, version, lifecycle),
    );
    await this.#commitProjectionOrCancel(loaded, entityId, state, version, lifecycle, () => {
      deferred.cancel();
    });
    this.#notifyProjection(() => {
      deferred.notify();
    });
    this.#publishProjectionChange(loaded, oldState, mode, state, lifecycle, version);
  }

  /**
   * Cancels a deferred Stand update when Projection storage rejects its commit.
   *
   * @param loaded Loaded Projection and commit storage.
   * @param entityId Projection identifier.
   * @param state Accepted Projection state.
   * @param version Current Spine Version.
   * @param lifecycle Accepted lifecycle flags.
   * @param onCancel Cancels the deferred Stand update.
   * @returns Completion after a successful storage commit.
   */
  async #commitProjectionOrCancel(
    loaded: LoadedRepositoryEntity,
    entityId: unknown,
    state: Message,
    version: Version,
    lifecycle: EntityLifecycleFlags,
    onCancel: () => void,
  ): Promise<void> {
    try {
      const outcome = await this.#commitProjectionRecord(
        loaded,
        entityId,
        state,
        version,
        lifecycle,
      );
      if (outcome !== "committed") throw new Error("Concurrent Projection state commit conflict.");
    } catch (error) {
      onCancel();
      throw error;
    }
  }

  /**
   * Notifies Stand after a Projection commit and reports delivery failure.
   *
   * @param onNotify Delivers the deferred Stand update.
   */
  #notifyProjection(onNotify: () => void): void {
    try {
      onNotify();
    } catch (error) {
      this.#runtime.publisher.reportFailure("event", this.#event, error);
    }
  }

  /**
   * Persists one Projection update with the same Version in current and history records.
   *
   * @param loaded Loaded Projection and commit storage.
   * @param entityId Projection identifier.
   * @param state Accepted Projection state.
   * @param version Current Spine Version.
   * @param lifecycle Accepted lifecycle flags.
   * @returns The storage commit outcome.
   */
  #commitProjectionRecord(
    loaded: LoadedRepositoryEntity,
    entityId: unknown,
    state: Message,
    version: Version,
    lifecycle: EntityLifecycleFlags,
  ): Promise<"committed" | "conflict"> {
    const record = EntityRecords.pack(
      this.#repository.stateSchema,
      entityId,
      state,
      version,
      lifecycle,
    );
    return loaded.commits.commit({
      context: loaded.storageInput.context,
      entity: loaded.storageInput,
      entityId,
      ...(loaded.current === undefined ? {} : { expected: loaded.current }),
      next: record,
      ...(RepositoryStorage.historyConfiguration(this.#repository).stateHistory
        ? { states: [record] }
        : {}),
    });
  }

  /**
   * Publishes a Projection state change with its committed Entity version.
   *
   * @param loaded Loaded Projection and prior record.
   * @param oldState State before dispatch, when available.
   * @param mode Normal or rebuilding delivery mode.
   * @param state Accepted Projection state.
   * @param lifecycle Accepted lifecycle flags.
   * @param version Committed Spine Version.
   */
  #publishProjectionChange(
    loaded: LoadedRepositoryEntity,
    oldState: Message | undefined,
    mode: EntityLoadMode,
    state: Message,
    lifecycle: EntityLifecycleFlags,
    version: Version,
  ): void {
    EntityStateChangePublisher.event(
      this.#runtime,
      this.#repository,
      this.#event,
      (loaded.entity as { readonly id: unknown }).id,
      oldState,
      mode === "rebuild"
        ? lifecycle
        : loaded.current === undefined
          ? undefined
          : {
              archived: loaded.current.lifecycleFlags?.archived ?? false,
              deleted: loaded.current.lifecycleFlags?.deleted ?? false,
            },
      state,
      lifecycle,
      version.number,
    );
  }

  /**
   * Invokes Event subscribers in one Entity transaction.
   *
   * @param entity Projection instance to update.
   * @param subscribers Selected Event subscribers.
   * @param packedMessage Packed source Event message.
   * @returns Completion after the subscriber transaction commits.
   */
  async #invokeSubscribers(
    entity: object,
    subscribers: RepositoryEventSubscribers,
    packedMessage: NonNullable<Event["message"]>,
  ): Promise<void> {
    transactionalEntityAccess.start(entity);
    try {
      for (const subscriber of subscribers) {
        const subscriberMessage = EntityInvocation.unpackRequired(
          packedMessage,
          subscriber.handler.schema,
          "event",
        );
        const eventContext = EntityInvocation.eventHandlerContext(this.#event);
        await EntityInvocation.invokeEntityMethod(
          entity,
          subscriber.handler.methodName,
          subscriberMessage,
          subscriber.handler.parameterCount,
          eventContext,
        );
      }
      const commit = await commitFenced(entity, (current) =>
        transactionalEntityAccess.commit(current),
      );
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    }
  }

  /**
   * Invokes state subscribers in one Entity transaction.
   *
   * @param entity Projection instance to update.
   * @param subscribers Selected state subscribers.
   * @param state Decoded source Entity state.
   * @returns Completion after the subscriber transaction commits.
   */
  async #invokeStateSubscribers(
    entity: object,
    subscribers: RepositoryStateSubscribers,
    state: Message,
  ): Promise<void> {
    transactionalEntityAccess.start(entity);
    try {
      for (const subscriber of subscribers) {
        const context = EntityInvocation.eventHandlerContext(this.#event);
        await EntityInvocation.invokeEntityMethod(
          entity,
          subscriber.handler.methodName,
          state,
          subscriber.handler.parameterCount,
          context,
        );
      }
      const commit = await commitFenced(entity, (current) =>
        transactionalEntityAccess.commit(current),
      );
      if (commit.status === "rejected")
        throw new TransitionValidationError(commit.validation.error);
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    }
  }

  /**
   * Restores or creates a Projection and binds its storage history.
   *
   * @param entityId Target Projection identifier.
   * @param options Stand tenant selection.
   * @param mode Stored or rebuild loading mode.
   * @returns Loaded Projection, current record, and commit storage.
   */
  async #loadProjection(
    entityId: unknown,
    options: { readonly tenantId?: TenantId },
    mode: EntityLoadMode,
  ): Promise<LoadedRepositoryEntity> {
    const stored = await standAccess.readCurrent(
      this.#runtime.stand,
      this.#repository.stateSchema,
      entityId,
      options,
    );
    const entity = RepositoryEntities.instantiate(
      this.#repository,
      entityId,
      stored,
      mode === "rebuild" && stored?.deleted === true,
    );
    const { commits, events, storageInput } = RepositoryEntities.bindStorage(
      this.#repository,
      this.#runtime,
      options.tenantId,
      entityId,
      entity,
    );
    return RepositoryEntities.loaded(
      entity,
      stored,
      commits,
      events,
      storageInput,
      this.#repository.stateSchema,
      entityId,
    );
  }
}

/**
 * Binds Process Manager query access to Stand for one handler invocation.
 */
const ProcessManagerQueries = Object.freeze({
  /**
   * Binds tenant-aware query reads and returns a release callback.
   *
   * @param entity Process Manager receiving query access.
   * @param runtime Context Stand and query services.
   * @param actorContext Actor metadata from the source signal.
   * @param tenantId Tenant for query reads, when present.
   * @returns Callback that removes the query binding.
   */
  bind(
    entity: object,
    runtime: RepositoryRuntime,
    actorContext: NonNullable<Command["context"]>["actorContext"] | undefined,
    tenantId: TenantId | undefined,
  ): () => void {
    const context =
      actorContext === undefined
        ? create(ActorContextSchema)
        : clone(ActorContextSchema, actorContext);
    if (tenantId !== undefined) {
      context.tenantId = RepositoryTenants.require(tenantId);
    }
    return processManagerQueryAccess.bind(
      entity,
      async (plan, schema, query) => {
        const results = await QueryReader.read(
          runtime.stand,
          schema,
          plan,
          tenantId,
          10_000,
          query,
        );
        return Object.freeze(results.map((result) => clone(schema, result.state)));
      },
      context,
    );
  },
});

/**
 * Loads and commits Process Manager state and optional diagnostic history.
 */
class ProcessManagerExecutionSupport {
  readonly #repository: RepositoryView;

  readonly #runtime: RepositoryRuntime;

  /**
   * Binds a Process Manager repository to its runtime services.
   *
   * @param repository Process Manager repository being executed.
   * @param runtime Built context services.
   */
  constructor(repository: RepositoryView, runtime: RepositoryRuntime) {
    this.#repository = repository;
    this.#runtime = runtime;
  }

  /**
   * Normalizes a handler result to a frozen signal list.
   *
   * @param produced Raw handler result.
   * @returns No signals, one signal, or the copied result array.
   */
  normalizeProducedSignals(produced: unknown): readonly unknown[] {
    if (produced === undefined) {
      return Object.freeze([]);
    }

    if (Array.isArray(produced)) {
      return Object.freeze(
        Array.from(produced as readonly unknown[]).filter((item) => item !== undefined),
      );
    }

    return Object.freeze([produced]);
  }

  /**
   * Restores or creates a Process Manager and binds its history storage.
   *
   * @param entityId Process Manager identifier to load.
   * @param options Stand tenant selection.
   * @returns Loaded instance, current record, and commit storage.
   */
  async load(
    entityId: unknown,
    options: { readonly tenantId?: TenantId },
  ): Promise<LoadedRepositoryEntity> {
    const stored = await standAccess.readCurrent(
      this.#runtime.stand,
      this.#repository.stateSchema,
      entityId,
      options,
    );
    const entity = RepositoryEntities.instantiate(this.#repository, entityId, stored, false);
    const { commits, events, storageInput } = RepositoryEntities.bindStorage(
      this.#repository,
      this.#runtime,
      options.tenantId,
      entityId,
      entity,
    );
    return RepositoryEntities.loaded(
      entity,
      stored,
      commits,
      events,
      storageInput,
      this.#repository.stateSchema,
      entityId,
    );
  }

  /**
   * Stores changed Process Manager state or produced Events under one Version.
   *
   * @param loaded Process Manager and commit storage.
   * @param options Stand tenant selection.
   * @param events Produced or diagnostic Events to retain when configured.
   * @returns `true` after a successful commit or unchanged no-op.
   */
  async commit(
    loaded: LoadedRepositoryEntity,
    options: { readonly tenantId?: TenantId },
    events: readonly Event[],
  ): Promise<boolean> {
    const version = RepositoryEntities.repositoryVersion(loaded.entity);
    const priorNumber = loaded.current?.version?.number ?? 0;
    if (version.number === priorNumber) {
      await this.#appendUnchangedDiagnostics(loaded, events);
      return true;
    }
    const entityId = (loaded.entity as { readonly id: unknown }).id;
    const state = RepositoryEntities.repositoryState(loaded.entity) as Message;
    const lifecycle = RepositoryEntities.repositoryLifecycle(loaded.entity);
    const deferred = await standAccess.deferUpdate(
      this.#runtime.stand,
      this.#repository.stateSchema,
      state,
      RepositoryStand.standUpdateOptions(options.tenantId, version, lifecycle),
    );
    await this.#storeProcessManagerRecord(
      loaded,
      entityId,
      state,
      version,
      lifecycle,
      events,
      deferred,
    );
    this.#notifyProcessManager(() => {
      deferred.notify();
    }, events);
    return true;
  }

  /**
   * Writes configured Process Manager diagnostics without storing unchanged state.
   *
   * @param loaded Process Manager and its diagnostic Event history.
   * @param events Input and produced Events to retain when history is configured.
   * @returns Completion after all configured diagnostic Events are appended.
   */
  async #appendUnchangedDiagnostics(
    loaded: LoadedRepositoryEntity,
    events: readonly Event[],
  ): Promise<void> {
    if (!RepositoryStorage.historyConfiguration(this.#repository).processManagerEventHistory)
      return;
    for (const event of events) await loaded.events.append(clone(EventSchema, event));
  }

  /**
   * Stores accepted Process Manager state and cancels Stand notification on failure.
   *
   * @param loaded Process Manager and commit storage.
   * @param entityId Process Manager identifier.
   * @param state Accepted Process Manager state.
   * @param version Current Spine Version.
   * @param lifecycle Accepted lifecycle flags.
   * @param events Diagnostic Events to retain when configured.
   * @param deferred Stand update to notify or cancel.
   * @returns Completion after durable persistence.
   */
  async #storeProcessManagerRecord(
    loaded: LoadedRepositoryEntity,
    entityId: unknown,
    state: Message,
    version: Version,
    lifecycle: EntityLifecycleFlags,
    events: readonly Event[],
    deferred: Awaited<ReturnType<typeof standAccess.deferUpdate>>,
  ): Promise<void> {
    try {
      const outcome = await this.#commitProcessManagerRecord(
        loaded,
        entityId,
        state,
        version,
        lifecycle,
        events,
      );
      if (outcome !== "committed") {
        throw new Error("Concurrent Process Manager state commit conflict.");
      }
      entityStateHistoryCaches.get(loaded.entity)?.clear();
    } catch (error) {
      deferred.cancel();
      throw error;
    }
  }

  /**
   * Stores one Process Manager version in current and optional history records.
   *
   * @param loaded Loaded Process Manager and commit storage.
   * @param entityId Process Manager identifier.
   * @param state Accepted Process Manager state.
   * @param version Current Spine Version.
   * @param lifecycle Accepted lifecycle flags.
   * @param events Diagnostic Events to retain when configured.
   * @returns The storage commit outcome.
   */
  #commitProcessManagerRecord(
    loaded: LoadedRepositoryEntity,
    entityId: unknown,
    state: Message,
    version: Version,
    lifecycle: EntityLifecycleFlags,
    events: readonly Event[],
  ): Promise<"committed" | "conflict"> {
    const history = RepositoryStorage.historyConfiguration(this.#repository);
    const record = EntityRecords.pack(
      this.#repository.stateSchema,
      entityId,
      state,
      version,
      lifecycle,
    );
    return loaded.commits.commit({
      context: loaded.storageInput.context,
      entity: loaded.storageInput,
      entityId,
      ...(loaded.current === undefined ? {} : { expected: loaded.current }),
      next: record,
      ...(history.stateHistory ? { states: [record] } : {}),
      ...(history.processManagerEventHistory
        ? { diagnostics: events.map((event) => clone(EventSchema, event)) }
        : {}),
    });
  }

  /**
   * Notifies Stand after a Process Manager commit and reports delivery failure.
   *
   * @param onNotify Delivers the deferred Stand update.
   * @param events Produced or diagnostic Events available for failure reporting.
   */
  #notifyProcessManager(onNotify: () => void, events: readonly Event[]): void {
    try {
      onNotify();
    } catch (error) {
      this.#runtime.publisher.reportFailure(
        "event",
        events[events.length - 1] ?? create(EventSchema),
        error,
      );
    }
  }
}

/**
 * Executes a routed Process Manager Command and publishes its results.
 */
class ProcessManagerCommandExecution {
  readonly #repository: CommandRoutingRepository;

  readonly #routing: RepositoryRouting;

  readonly #runtime: RepositoryRuntime;

  readonly #command: Command;

  readonly #support: ProcessManagerExecutionSupport;

  /**
   * Captures Process Manager routing, runtime, and source Command.
   *
   * @param repository Process Manager repository receiving the Command.
   * @param routing Registered Command routes and schemas.
   * @param runtime Built context services.
   * @param command Source Command to execute.
   */
  constructor(
    repository: CommandRoutingRepository,
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

  /**
   * Invokes the registered Command handler and commits its results.
   *
   * @param replayedRoute Accepted route from durable inbox replay, when present.
   * @returns A deferred Command follow-up, rejection follow-up, or `undefined`.
   */
  async run(replayedRoute?: RepositoryCommandRoute): Promise<EntityInboxFollowUp | undefined> {
    RepositorySignals.requireCommandId(this.#command);
    const intake = this.#readIntake(replayedRoute);
    if (intake === undefined) return undefined;

    const tenantOptions = RepositoryTenants.commandStandOptions(
      this.#runtime.context,
      this.#command,
    );
    const loaded = await this.#support.load(intake.route.entityId, tenantOptions);
    this.#publishDispatch(intake.route.entityId);
    try {
      const produced = await this.#invoke(
        loaded.entity,
        intake.assignee,
        intake.message,
        tenantOptions.tenantId,
      );
      return await this.#commitAndPublish(loaded, tenantOptions, intake, produced);
    } catch (error) {
      if (!RejectionThrowable.is(error)) throw error;
      RepositorySignals.requireDeclaredRejection(intake.assignee.handler, error);
      return RepositorySignals.postRejectionEvent(
        this.#runtime,
        this.#repository,
        this.#command,
        intake.route.entityId,
        error,
      );
    }
  }

  /**
   * Publishes a best-effort Command dispatch diagnostic.
   *
   * @param entityId Target Process Manager identifier.
   */
  #publishDispatch(entityId: unknown): void {
    HandlerDispatchPublisher.command(this.#runtime, this.#repository, this.#command, entityId);
  }

  /**
   * Decodes a registered Command and finds its assignee.
   *
   * @param replayedRoute Accepted inbox route, when present.
   * @returns Decoded Command, route, and assignee, or `undefined`.
   */
  #readIntake(replayedRoute?: RepositoryCommandRoute):
    | {
        readonly assignee: RepositoryCommandAssignee;
        readonly message: unknown;
        readonly route: RepositoryCommandRoute;
      }
    | undefined {
    const commandMessage = EntityInvocation.requireSignalMessage(this.#command.message, "command");
    const commandSchema = RepositoryRoutes.schemaForTypeUrl(
      this.#routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );
    const message = EntityInvocation.unpackRequired(commandMessage, commandSchema, "command");
    const route = replayedRoute ?? this.#repository.routeCommand(this.#command);
    const assignee = this.#routing.commandReadiness?.findCommandAssignee(route.messageFullTypeName);
    return assignee === undefined ? undefined : Object.freeze({ assignee, message, route });
  }

  /**
   * Commits Process Manager changes and publishes produced Events and Commands.
   *
   * @param loaded Process Manager and commit storage.
   * @param tenantOptions Stand tenant selection.
   * @param intake Assignee and target route.
   * @param producedSignals Validated handler results.
   * @returns Deferred Command publication when Commands were produced.
   */
  async #commitAndPublish(
    loaded: Awaited<ReturnType<ProcessManagerExecutionSupport["load"]>>,
    tenantOptions: ReturnType<typeof RepositoryTenants.commandStandOptions>,
    intake: {
      readonly assignee: RepositoryCommandAssignee;
      readonly route: RepositoryCommandRoute;
    },
    producedSignals: readonly unknown[],
  ): Promise<EntityInboxFollowUp | undefined> {
    const commands = this.#commandOutputs(intake.assignee, producedSignals);
    const events = this.#eventOutputs(
      intake.assignee,
      producedSignals,
      intake.route.entityId,
      RepositoryEntities.priorVersion(loaded.current),
    );
    const committed = await this.#support.commit(loaded, tenantOptions, events);
    if (!committed) return undefined;
    this.#publishChangedState(loaded, intake.route.entityId);
    this.#postEvents(events);
    return commands.length === 0
      ? undefined
      : async () => {
          await this.#postCommands(commands, this.#command);
        };
  }

  /**
   * Binds substitution results as Commands and requires nonempty output.
   *
   * @param assignee Invoked Command handler declaration.
   * @param produced Validated handler results.
   * @returns Bound Commands, or an empty list for assignment handlers.
   */
  #commandOutputs(
    assignee: RepositoryCommandAssignee,
    produced: readonly unknown[],
  ): readonly Command[] {
    if (assignee.handler.kind !== "command-substitution") return Object.freeze([]);
    const commands = this.#bindProducedCommands(produced);
    if (commands.length === 0) {
      throw new Error(
        "Repository Process Manager command substitutions must return at least one command.",
      );
    }
    return commands;
  }

  /**
   * Binds assignment results as Events.
   *
   * @param assignee Invoked Command handler declaration.
   * @param produced Validated handler results.
   * @param entityId Target Process Manager identifier.
   * @param version Process Manager Version before this dispatch.
   * @returns Bound Events, or an empty list for substitution handlers.
   */
  #eventOutputs(
    assignee: RepositoryCommandAssignee,
    produced: readonly unknown[],
    entityId: unknown,
    version: Version,
  ): readonly Event[] {
    return assignee.handler.kind === "command-assignment"
      ? this.#bindProducedEvents(produced, entityId, version)
      : Object.freeze([]);
  }

  /**
   * Publishes a state-change System Event when the Process Manager changed.
   *
   * @param loaded Process Manager before and after handling.
   * @param entityId Target Process Manager identifier.
   */
  #publishChangedState(
    loaded: Awaited<ReturnType<ProcessManagerExecutionSupport["load"]>>,
    entityId: unknown,
  ): void {
    if (RepositoryEntities.repositoryChanged(loaded.entity)) {
      EntityStateChangePublisher.command(
        this.#runtime,
        this.#repository,
        this.#command,
        entityId,
        loaded.current === undefined
          ? undefined
          : EntityRecords.unpack(this.#repository.stateSchema, loaded.current).state,
        loaded.current === undefined
          ? undefined
          : {
              archived: loaded.current.lifecycleFlags?.archived ?? false,
              deleted: loaded.current.lifecycleFlags?.deleted ?? false,
            },
        RepositoryEntities.repositoryState(loaded.entity) as Message,
        RepositoryEntities.repositoryLifecycle(loaded.entity),
        RepositoryEntities.repositoryVersion(loaded.entity).number,
      );
    }
  }

  /**
   * Binds query access for one Command handler invocation.
   *
   * @param entity Process Manager instance.
   * @param assignee Registered Command handler.
   * @param message Decoded Command message.
   * @param tenantId Tenant for query reads, when present.
   * @returns Validated handler signals.
   */
  async #invoke(
    entity: object,
    assignee: RepositoryCommandAssignee,
    message: unknown,
    tenantId: TenantId | undefined,
  ): Promise<readonly unknown[]> {
    const releaseQuery = ProcessManagerQueries.bind(
      entity,
      this.#runtime,
      this.#command.context?.actorContext,
      tenantId,
    );
    try {
      return await this.#invokeCommandHandler(entity, assignee, message);
    } finally {
      releaseQuery();
    }
  }

  /**
   * Invokes the Command handler in a fenced Entity transaction.
   *
   * @param entity Process Manager instance to mutate.
   * @param assignee Registered Command handler.
   * @param message Decoded Command message.
   * @returns Validated handler signals after commit.
   */
  async #invokeCommandHandler(
    entity: object,
    assignee: RepositoryCommandAssignee,
    message: unknown,
  ): Promise<readonly unknown[]> {
    transactionalEntityAccess.start(entity);
    try {
      const produced = await EntityInvocation.invokeEntityMethod(
        entity,
        assignee.handler.methodName,
        message,
        assignee.handler.parameterCount,
        EntityInvocation.commandHandlerContext(this.#command),
      );
      const signals = this.#support.normalizeProducedSignals(produced);
      RepositoryHandlers.requireDeclaredOutputs(assignee.handler, signals);
      const commit = await commitFenced(entity, (current) =>
        transactionalEntityAccess.commit(
          current,
          assignee.handler.kind === "command-assignment" && signals.length > 0,
        ),
      );
      if (commit.status === "rejected") {
        throw new TransitionValidationError(commit.validation.error);
      }

      return signals;
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    }
  }

  /**
   * Binds assignment results as Process Manager Events.
   *
   * @param produced Domain Event messages from the handler.
   * @param entityId Target Process Manager identifier.
   * @param version Process Manager Version before this dispatch.
   * @returns Frozen Event envelope list.
   */
  #bindProducedEvents(
    produced: readonly unknown[],
    entityId: unknown,
    version: Version,
  ): readonly Event[] {
    return Object.freeze(
      produced.map((signal) => this.#bindProducedEvent(signal, entityId, version)),
    );
  }

  /**
   * Packs one declared Event with source and producer context.
   *
   * @param signal Domain Event message to pack.
   * @param entityId Target Process Manager identifier.
   * @param version Process Manager Version before this dispatch.
   * @returns Bound Event envelope.
   */
  #bindProducedEvent(signal: unknown, entityId: unknown, version: Version): Event {
    const typeName = EntityInvocation.messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(
        `Repository process-manager execution cannot pack event message "${typeName}".`,
      );
    }

    const metadata = this.#runtime.signalMetadata.eventFromCommand(this.#command, {
      version: version.number,
    });

    return create(EventSchema, {
      id: metadata.id,
      message: AnyMessages.pack(schema, signal as never),
      context: RepositorySignals.eventContextWithProducer(
        metadata.context,
        this.#repository,
        entityId,
        version,
      ),
    });
  }

  /**
   * Packs declared substitution results as Commands from the source Command.
   *
   * @param produced Domain Command messages from the handler.
   * @returns Frozen Command envelope list.
   */
  #bindProducedCommands(produced: readonly unknown[]): readonly Command[] {
    return Object.freeze(
      produced.map((signal) => {
        const typeName = EntityInvocation.messageTypeName(signal);
        const schema = this.#routing.producedCommandSchemas.find(
          (candidate) => candidate.typeName === typeName,
        );
        if (schema === undefined) {
          throw new Error(
            `Repository process-manager execution cannot pack command message "${typeName}".`,
          );
        }
        const metadata = this.#runtime.signalMetadata.commandFromCommand(this.#command);
        return create(CommandSchema, {
          id: metadata.id,
          message: AnyMessages.pack(schema, signal as never),
          context: metadata.context,
        });
      }),
    );
  }

  /**
   * Publishes each produced Command in handler order.
   *
   * @param commands Bound Commands to publish.
   * @param source Source Command retained for the caller contract.
   * @returns Completion after all Commands are published.
   */
  async #postCommands(commands: readonly Command[], source: Command): Promise<void> {
    void source;
    for (const command of commands) {
      await this.#runtime.publisher.publishCommand(command);
    }
  }

  /**
   * Schedules publication of produced Events.
   *
   * @param events Bound Events to publish.
   */
  #postEvents(events: readonly Event[]): void {
    for (const event of events) {
      // spine-log-boundary: server.repository_event_follow_up
      void this.#runtime.publisher.publishEvent(event);
    }
  }
}

/**
 * Runs Process Manager Event handlers and persists their results.
 */
class ProcessManagerEventExecution {
  readonly #repository: EventRoutingRepository;

  readonly #routing: RepositoryRouting;

  readonly #runtime: RepositoryRuntime;

  readonly #event: Event;

  readonly #support: ProcessManagerExecutionSupport;

  /**
   * Captures Process Manager routing, runtime, and source Event.
   *
   * @param repository Process Manager repository receiving the Event.
   * @param routing Registered Event routes and schemas.
   * @param runtime Built context services.
   * @param event Source Event to execute.
   */
  constructor(
    repository: EventRoutingRepository,
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

  /**
   * Delivers a routed Event to the durable Process Manager inbox.
   *
   * @param acceptedRoute Route accepted before dispatch.
   * @returns Completion after inbox handoff.
   */
  async run(acceptedRoute: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.reactors.length === 0 && intake.commanders.length === 0) {
      return;
    }

    this.#validateSourceEventIdForFollowUps(intake);

    if (intake.route.entityIds.length === 1) {
      await InboxHandoff.handoffPmEvent(
        this.#repository,
        this.#runtime,
        this.#event,
        intake.route.entityIds[0],
      );
      return;
    }

    await InboxHandoff.handoffPmEvents(
      this.#repository,
      this.#runtime,
      this.#event,
      intake.route.entityIds,
    );
  }

  /**
   * Delivers a routed Event for one target under the duplicate-dispatch guard.
   *
   * @param entityId Target Process Manager identifier.
   * @param acceptedRoute Route accepted before replay.
   * @returns Completion after guarded target execution.
   */
  async runTarget(entityId: unknown, acceptedRoute: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.reactors.length === 0 && intake.commanders.length === 0) {
      return;
    }

    this.#validateSourceEventIdForFollowUps(intake);
    await DispatchGuards.guardedEntityEventDispatch(
      this.#repository,
      this.#runtime,
      this.#event,
      entityId,
      async () => {
        await this.#executeEntity(entityId, intake);
      },
    );
  }

  /**
   * Decodes the Event and selects matching reactors and Command producers.
   *
   * @param acceptedRoute Route accepted before execution.
   * @returns Decoded message, route, reactors, and Command producers.
   */
  #readIntake(acceptedRoute: RepositoryEventRoute): {
    readonly message: unknown;
    readonly route: RepositoryEventRoute;
    readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
  } {
    const eventMessage = EntityInvocation.requireSignalMessage(this.#event.message, "event");
    const eventSchema = RepositoryRoutes.schemaForTypeUrl(
      this.#routing.eventSchemas,
      eventMessage.typeUrl,
      "event",
    );
    const message = EntityInvocation.unpackRequired(eventMessage, eventSchema, "event");
    const route = acceptedRoute;
    const reactors = this.#routing.eventReactors(
      route.messageFullTypeName,
      message,
      this.#event.context?.external === true,
    );
    const commanders = this.#routing.commandReactions(
      route.messageFullTypeName,
      message,
      this.#event.context?.external === true,
    );

    return Object.freeze({
      message,
      route,
      reactors: Object.freeze([...reactors]),
      commanders,
    });
  }

  /**
   * Invokes handlers, commits state, and publishes resulting Events and Commands.
   *
   * @param entityId Target Process Manager identifier.
   * @param intake Decoded Event and matching handlers.
   * @returns Completion after accepted results are published.
   */
  async #executeEntity(
    entityId: unknown,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
  ): Promise<void> {
    const tenantOptions = RepositoryTenants.standTenantOptions(this.#runtime.context, this.#event);
    const loaded = await this.#support.load(entityId, tenantOptions);
    const produced = await this.#invokeHandlers(
      entityId,
      loaded.entity,
      intake,
      tenantOptions.tenantId,
    );

    const events = this.#bindProducedEvents(
      produced.events,
      entityId,
      RepositoryEntities.priorVersion(loaded.current),
    );
    const diagnostics = [
      DispatchGuards.guardedJournalEvent(this.#repository, this.#event, entityId),
      ...events,
    ];
    const committed = await this.#support.commit(loaded, tenantOptions, diagnostics);
    if (!committed) return;
    this.#publishChangedState(loaded, entityId);
    this.#postEvents(events);
    await this.#postCommands(this.#bindProducedCommands(produced.commands));
  }

  /**
   * Publishes a state-change System Event when the Process Manager changed.
   *
   * @param loaded Process Manager before and after handling.
   * @param entityId Target Process Manager identifier.
   */
  #publishChangedState(
    loaded: Awaited<ReturnType<ProcessManagerExecutionSupport["load"]>>,
    entityId: unknown,
  ): void {
    if (!RepositoryEntities.repositoryChanged(loaded.entity)) return;
    EntityStateChangePublisher.event(
      this.#runtime,
      this.#repository,
      this.#event,
      entityId,
      loaded.current === undefined
        ? undefined
        : EntityRecords.unpack(this.#repository.stateSchema, loaded.current).state,
      loaded.current === undefined
        ? undefined
        : {
            archived: loaded.current.lifecycleFlags?.archived ?? false,
            deleted: loaded.current.lifecycleFlags?.deleted ?? false,
          },
      RepositoryEntities.repositoryState(loaded.entity) as Message,
      RepositoryEntities.repositoryLifecycle(loaded.entity),
      RepositoryEntities.repositoryVersion(loaded.entity).number,
    );
  }

  /**
   * Validates source Event metadata when handlers can produce follow-ups.
   *
   * @param intake Matching reactors and Command producers.
   */
  #validateSourceEventIdForFollowUps(intake: {
    readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
    readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
  }): void {
    const emitsFollowUpEvents = intake.reactors.some(
      (reactor) => RepositoryHandlers.handlerEmittedSchemas(reactor.handler).length > 0,
    );

    if (!emitsFollowUpEvents && intake.commanders.length === 0) {
      return;
    }

    void this.#runtime.signalMetadata.originFromEvent(this.#event);
  }

  /**
   * Invokes Event handlers in one transaction with temporary query access.
   *
   * @param entityId Target Process Manager identifier.
   * @param entity Process Manager instance.
   * @param intake Decoded Event and matching handlers.
   * @param tenantId Tenant for query reads, when present.
   * @returns Validated Command and Event message lists.
   */
  async #invokeHandlers(
    entityId: unknown,
    entity: object,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
    tenantId: TenantId | undefined,
  ): Promise<{ readonly commands: readonly unknown[]; readonly events: readonly unknown[] }> {
    const eventContext = EntityInvocation.eventHandlerContext(this.#event);
    const commands: unknown[] = [];
    const events: unknown[] = [];
    const releaseQuery = ProcessManagerQueries.bind(
      entity,
      this.#runtime,
      this.#runtime.signalMetadata.originFromEvent(this.#event).actorContext,
      tenantId,
    );

    transactionalEntityAccess.start(entity);
    try {
      await this.#invokeEventHandlers(entityId, entity, intake, eventContext, events, commands);
      await this.#commitEntity(entity, events.length > 0);
      return Object.freeze({
        commands: Object.freeze(commands),
        events: Object.freeze(events),
      });
    } catch (error) {
      transactionalEntityAccess.rollback(entity);
      throw error;
    } finally {
      releaseQuery();
    }
  }

  /**
   * Invokes reactors and Command producers, collecting their separate outputs.
   *
   * @param entityId Target Process Manager identifier.
   * @param entity Process Manager instance.
   * @param intake Decoded Event and matching handlers.
   * @param context Copied source Event context.
   * @param events Output list for Event messages.
   * @param commands Output list for Command messages.
   * @returns Completion after matching handlers run.
   */
  async #invokeEventHandlers(
    entityId: unknown,
    entity: object,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
    context: unknown,
    events: unknown[],
    commands: unknown[],
  ): Promise<void> {
    if (intake.reactors.length > 0)
      HandlerDispatchPublisher.reactor(this.#runtime, this.#repository, this.#event, entityId);
    await this.#invokeHandlersInto(entity, intake.reactors, intake.message, context, events);
    await this.#invokeHandlersInto(entity, intake.commanders, intake.message, context, commands);
  }

  /**
   * Invokes each selected handler and appends its declared results.
   *
   * @param entity Process Manager instance.
   * @param handlers Handler registrations to invoke.
   * @param message Decoded source Event message.
   * @param context Copied source Event context.
   * @param output Result list to append to.
   * @returns Completion after all selected handlers run.
   */
  async #invokeHandlersInto(
    entity: object,
    handlers: readonly RegisteredHandlerMetadata<
      EventReactionHandlerMetadata | CommandReactionHandlerMetadata
    >[],
    message: unknown,
    context: unknown,
    output: unknown[],
  ): Promise<void> {
    for (const handler of handlers) {
      const produced = await EntityInvocation.invokeEntityMethod(
        entity,
        handler.handler.methodName,
        message,
        handler.handler.parameterCount,
        context,
      );
      const signals = this.#support.normalizeProducedSignals(produced);
      RepositoryHandlers.requireDeclaredOutputs(handler.handler, signals);
      output.push(...signals);
    }
  }

  /**
   * Applies a fenced Entity commit and raises transition rejection.
   *
   * @param entity Process Manager instance to commit.
   * @param producedEvents Whether handlers produced Events.
   * @returns Completion after a successful fenced commit.
   */
  async #commitEntity(entity: object, producedEvents: boolean): Promise<void> {
    const commit = await commitFenced(entity, (current) =>
      transactionalEntityAccess.commit(current, producedEvents),
    );
    if (commit.status === "rejected") throw new TransitionValidationError(commit.validation.error);
  }

  /**
   * Binds reactor results as Process Manager Events.
   *
   * @param produced Domain Event messages from handlers.
   * @param entityId Target Process Manager identifier.
   * @param version Process Manager Version before this dispatch.
   * @returns Frozen Event envelope list.
   */
  #bindProducedEvents(
    produced: readonly unknown[],
    entityId: unknown,
    version: Version,
  ): readonly Event[] {
    return Object.freeze(
      produced.map((signal) => this.#bindProducedEvent(signal, entityId, version)),
    );
  }

  /**
   * Packs one declared Event with source and producer context.
   *
   * @param signal Domain Event message to pack.
   * @param entityId Target Process Manager identifier.
   * @param version Process Manager Version before this dispatch.
   * @returns Bound Event envelope.
   */
  #bindProducedEvent(signal: unknown, entityId: unknown, version: Version): Event {
    const typeName = EntityInvocation.messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(
        `Repository process-manager execution cannot pack event message "${typeName}".`,
      );
    }

    const metadata = this.#runtime.signalMetadata.eventFromEvent(this.#event, {
      version: version.number,
    });

    return create(EventSchema, {
      id: metadata.id,
      message: AnyMessages.pack(schema, signal as never),
      context: RepositorySignals.eventContextWithProducer(
        metadata.context,
        this.#repository,
        entityId,
        version,
      ),
    });
  }

  /**
   * Packs Command reactions using metadata from the source Event.
   *
   * @param produced Domain Command messages from handlers.
   * @returns Frozen Command envelope list.
   */
  #bindProducedCommands(produced: readonly unknown[]): readonly Command[] {
    return Object.freeze(
      produced.map((signal) => {
        const typeName = EntityInvocation.messageTypeName(signal);
        const schema = this.#routing.producedCommandSchemas.find(
          (candidate) => candidate.typeName === typeName,
        );

        if (schema === undefined) {
          throw new Error(
            `Repository process-manager execution cannot pack command message "${typeName}".`,
          );
        }

        const metadata = this.#runtime.signalMetadata.commandFromEvent(this.#event);

        return create(CommandSchema, {
          id: metadata.id,
          message: AnyMessages.pack(schema, signal as never),
          context: metadata.context,
        });
      }),
    );
  }

  /**
   * Publishes each produced Command in handler order.
   *
   * @param commands Bound Commands to publish.
   * @returns Completion after all Commands are published.
   */
  async #postCommands(commands: readonly Command[]): Promise<void> {
    for (const command of commands) {
      await this.#runtime.publisher.publishCommand(command);
    }
  }

  /**
   * Schedules publication of produced Events.
   *
   * @param events Bound Events to publish.
   */
  #postEvents(events: readonly Event[]): void {
    for (const event of events) {
      // spine-log-boundary: server.process_manager_event_follow_up
      void this.#runtime.publisher.publishEvent(event);
    }
  }
}

/**
 * Internal structural provider seam shared by the memory, Datastore, and MySQL factories.
 */
interface EntityStorageFactory {
  /**
   * Opens current, state-history, and Event-history storage for one Entity type.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Generated Entity state message type.
   * @param input Entity storage location and schema.
   * @returns Open storage ports and a close operation.
   */
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): {
    readonly current: EntityRecordStorage<I>;
    readonly states: EntityStateHistoryPort<I, S>;
    readonly events: EntityEventHistoryPort<I>;

    /**
     * Closes the storage ports opened for this Entity.
     */
    close(): void;
  };
}

/**
 * Groups open Entity storage ports with their atomic commit port.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Generated Entity state message type.
 */
interface RepositoryEntityStorage<I, S extends Message> {
  readonly current: EntityRecordStorage<I>;
  readonly states: EntityStateHistoryPort<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  readonly commits: EntityCommitStorage;

  /**
   * Closes the Entity history and commit storage handles.
   */
  close(): void;
}

/**
 * Internal repository identity operations.
 */
const RepositoryIdentity = {
  /**
   * Creates a frozen identity snapshot from validated Entity metadata.
   *
   * @typeParam EntityType Concrete Entity constructor represented by the snapshot.
   * @param entityType Entity constructor.
   * @param entityFamily Aggregate, Projection, or Process Manager family.
   * @param metadata Descriptor-derived state metadata.
   * @returns Copy-safe repository identity snapshot.
   */
  createRepositorySnapshot<EntityType extends RepositoryEntityType>(
    entityType: EntityType,
    entityFamily: EntityFamily,
    metadata: EntityMetadata<RepositoryStateSchema<EntityType>>,
  ): RepositoryIdentitySnapshot<EntityType> {
    const metadataCopy = RepositoryIdentity.cloneEntityMetadata(metadata);

    return Object.freeze({
      entityType,
      entityFamily,
      stateSchema: metadataCopy.schema,
      metadata: metadataCopy,
      stateFullTypeName: metadataCopy.fullTypeName,
      idField: RepositoryIdentity.cloneFieldMetadata(metadataCopy.idField),
    });
  },

  /**
   * Copies a repository identity snapshot and its mutable metadata fields.
   *
   * @typeParam EntityType Concrete Entity constructor in the snapshot.
   * @param snapshot Identity snapshot to copy.
   * @returns Frozen copy of the snapshot.
   */
  cloneRepositorySnapshot<EntityType extends RepositoryEntityType>(
    snapshot: RepositoryIdentitySnapshot<EntityType>,
  ): RepositoryIdentitySnapshot<EntityType> {
    const metadata = RepositoryIdentity.cloneEntityMetadata(snapshot.metadata);

    return Object.freeze({
      entityType: snapshot.entityType,
      entityFamily: snapshot.entityFamily,
      stateSchema: metadata.schema,
      metadata,
      stateFullTypeName: metadata.fullTypeName,
      idField: RepositoryIdentity.cloneFieldMetadata(metadata.idField),
    });
  },

  /**
   * Checks that repository options are a non-null object.
   *
   * @param options Value supplied as repository options.
   * @returns Whether the value can expose option properties.
   */
  isRepositoryOptionsObject(options: unknown): options is object {
    return typeof options === "object" && options !== null;
  },

  /**
   * Reads the Entity constructor option and reports inaccessible properties.
   *
   * @param options Repository options object.
   * @returns Supplied Entity constructor value.
   */
  readEntityTypeOption(options: object): unknown {
    try {
      return (options as { readonly entityType: unknown }).entityType;
    } catch {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        "Repository options entityType must be readable and resolve to a class constructor " +
          "extending Aggregate, Projection, or ProcessManager.",
      );
    }
  },

  /**
   * Reads the state schema option and reports inaccessible properties.
   *
   * @param options Repository options object.
   * @param entityTypeDisplayName Constructor name for diagnostics.
   * @param entityFamily Resolved Entity family for diagnostics.
   * @returns Supplied state schema value.
   */
  readRepositorySchemaOption(
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
  },

  /**
   * Checks whether a value is a native class constructor.
   *
   * @param entityType Candidate Entity constructor.
   * @returns Whether the value has class syntax.
   */
  isClassConstructor(entityType: unknown): boolean {
    if (typeof entityType !== "function") {
      return false;
    }

    try {
      const source = Function.prototype.toString.call(entityType);
      return source.startsWith("class ");
    } catch {
      return false;
    }
  },

  /**
   * Resolves the runtime family of a repository Entity constructor.
   *
   * @param entityType Candidate Entity constructor.
   * @returns Its supported family, or `undefined`.
   * @internal
   */
  resolveRepositoryEntityFamily(entityType: unknown): EntityFamily | undefined {
    if (typeof entityType !== "function" || !RepositoryIdentity.isClassConstructor(entityType)) {
      return undefined;
    }

    const runtimeEntityType = entityType as RuntimeRepositoryEntityType;

    if (
      RepositoryIdentity.hasEntityFamilyInheritance(
        runtimeEntityType,
        Aggregate,
        Aggregate.prototype,
      )
    ) {
      return "aggregate";
    }
    if (
      RepositoryIdentity.hasEntityFamilyInheritance(
        runtimeEntityType,
        Projection,
        Projection.prototype,
      )
    ) {
      return "projection";
    }
    if (
      RepositoryIdentity.hasEntityFamilyInheritance(
        runtimeEntityType,
        ProcessManager,
        ProcessManager.prototype,
      )
    ) {
      return "process-manager";
    }

    return undefined;
  },

  /**
   * Checks constructor and prototype inheritance against an Entity family.
   *
   * @param entityType Candidate constructor.
   * @param familyConstructor Aggregate, Projection, or Process Manager constructor.
   * @param familyPrototype Prototype for the same family.
   * @returns Whether both inheritance paths match.
   */
  hasEntityFamilyInheritance(
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
  },

  /**
   * Reads a safe diagnostic name from an Entity constructor.
   *
   * @param entityType Constructor value to describe.
   * @returns Its name, or an anonymous placeholder.
   */
  entityTypeName(entityType: unknown): string {
    if (
      (typeof entityType !== "object" && typeof entityType !== "function") ||
      entityType === null
    ) {
      return "(anonymous)";
    }

    const name = RepositoryIdentity.safeStringProperty(entityType, "name");
    return typeof name === "string" && name.length > 0 ? name : "(anonymous)";
  },

  /**
   * Reads one string property without propagating accessor errors.
   *
   * @param value Object to inspect.
   * @param propertyName Property to read.
   * @returns String value when readable, otherwise `undefined`.
   */
  safeStringProperty(value: object, propertyName: "name" | "typeName"): string | undefined {
    try {
      const property = (value as Record<typeof propertyName, unknown>)[propertyName];
      return typeof property === "string" ? property : undefined;
    } catch {
      return undefined;
    }
  },

  /**
   * Describes a generated state schema and wraps invalid metadata errors.
   *
   * @typeParam Schema Concrete generated state schema.
   * @param entityTypeDisplayName Constructor name for diagnostics.
   * @param entityFamily Resolved Entity family for diagnostics.
   * @param schema Generated state schema to inspect.
   * @returns Descriptor-derived Entity metadata.
   */
  describeRepositoryEntityMetadata<Schema extends DescriptorMessageSchema>(
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
  },

  /**
   * Copies descriptor-derived Entity metadata and nested field descriptions.
   *
   * @typeParam Schema Generated state schema represented by the metadata.
   * @param metadata Entity metadata to copy.
   * @returns Frozen metadata copy.
   */
  cloneEntityMetadata<Schema extends DescriptorMessageSchema>(
    metadata: EntityMetadata<Schema>,
  ): EntityMetadata<Schema> {
    const idField = RepositoryIdentity.cloneFieldMetadata(metadata.idField);
    const firstFieldRoutingHint: FirstFieldRoutingHint = Object.freeze({
      strategy: metadata.firstFieldRoutingHint.strategy,
      field: RepositoryIdentity.cloneFieldMetadata(metadata.firstFieldRoutingHint.field),
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
      columns: Object.freeze(
        metadata.columns.map((field) => RepositoryIdentity.cloneFieldMetadata(field)),
      ),
      setOnceFields: Object.freeze(
        metadata.setOnceFields.map((field) => RepositoryIdentity.cloneFieldMetadata(field)),
      ),
    });
  },

  /**
   * Copies one descriptor field description for an identity snapshot.
   *
   * @param field Descriptor field to copy.
   * @returns Frozen field description.
   */
  cloneFieldMetadata(field: DescriptorFieldMetadata): DescriptorFieldMetadata {
    return Object.freeze({
      descriptor: field.descriptor,
      name: field.name,
      localName: field.localName,
      jsonName: field.jsonName,
      number: field.number,
    });
  },
};
Object.freeze(RepositoryIdentity);

/**
 * Internal entity invocation operations.
 */
const EntityInvocation = {
  /**
   * Checks whether a handler result is an Event envelope.
   *
   * @param signal Handler result to inspect.
   * @returns Whether it carries the generated Event type name.
   */
  isEventEnvelope(signal: unknown): signal is Event {
    return (
      typeof signal === "object" &&
      signal !== null &&
      (signal as { readonly $typeName?: unknown }).$typeName === EventSchema.typeName
    );
  },

  /**
   * Reads a generated message's type name or rejects malformed output.
   *
   * @param message Handler result to inspect.
   * @returns Its generated message type name.
   */
  messageTypeName(message: unknown): string {
    const typeName = (message as { readonly $typeName?: unknown }).$typeName;

    if (typeof typeName !== "string" || typeName.length === 0) {
      throw new Error("Repository aggregate execution requires a generated event message.");
    }

    return typeName;
  },

  /**
   * Invokes a registered Entity handler with its declared argument count.
   *
   * @param entity Entity instance containing the method.
   * @param methodName Registered handler method name.
   * @param message Decoded Command or Event message.
   * @param parameterCount One message parameter or message plus context.
   * @param context Handler context when declared.
   * @returns Raw handler result.
   */
  invokeEntityMethod(
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
  },

  /**
   * Copies a Command context or creates an empty context when absent.
   *
   * @param command Source Command envelope.
   * @returns Context isolated from the source envelope.
   */
  commandHandlerContext(command: Command): NonNullable<Command["context"]> {
    return command.context === undefined
      ? create(CommandContextSchema)
      : clone(CommandContextSchema, command.context);
  },

  /**
   * Copies an Event context or creates an empty context when absent.
   *
   * @param event Source Event envelope.
   * @returns Context isolated from the source envelope.
   */
  eventHandlerContext(event: Event): NonNullable<Event["context"]> {
    return event.context === undefined
      ? create(EventContextSchema)
      : clone(EventContextSchema, event.context);
  },

  /**
   * Unpacks a required signal message with its registered schema.
   *
   * @param message Packed signal payload.
   * @param schema Registered generated message schema.
   * @param signalKind Signal name for failure diagnostics.
   * @returns Decoded generated message.
   */
  unpackRequired(
    message: NonNullable<Command["message"]>,
    schema: MessageSchema,
    signalKind: "command" | "event" | "state update",
  ): unknown {
    const unpacked = AnyMessages.unpack(message, schema);

    if (unpacked === undefined) {
      throw new Error(`Repository ${signalKind} execution requires a readable message.`);
    }

    return unpacked;
  },

  /**
   * Validates that a signal carries a typed message payload.
   *
   * @param message Optional packed signal payload.
   * @param signalKind Signal name for failure diagnostics.
   * @returns Payload with a nonempty type URL.
   */
  requireSignalMessage(
    message: Command["message"],
    signalKind: "command" | "event" | "state update",
  ): NonNullable<Command["message"]> {
    if (message === undefined || message.typeUrl === "") {
      throw new Error(`Repository ${signalKind} execution requires message.typeUrl.`);
    }

    return message;
  },
};
Object.freeze(EntityInvocation);

/**
 * Internal repository entities operations.
 */
const RepositoryEntities = {
  /**
   * Opens Entity storage and binds diagnostic history to the restored instance.
   *
   * @param repository Entity repository registration.
   * @param runtime Storage factory and tenant mode.
   * @param tenantId Tenant identifier when multitenant.
   * @param entityId Entity identifier.
   * @param entity Restored Entity instance.
   * @returns Commit storage and its Entity storage specification.
   */
  bindStorage(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    tenantId: TenantId | undefined,
    entityId: unknown,
    entity: object,
  ): {
    readonly commits: EntityCommitStorage;
    readonly events: EntityEventHistoryPort<unknown>;
    readonly storageInput: EntityStorageInput<unknown, Message>;
  } {
    const storageInput = RepositoryStorage.entityStorageInput(
      repository,
      RepositoryTenants.storageContextForTenant(runtime.context, tenantId),
    );
    const storage = RepositoryStorage.openRepositoryEntityStorage(
      repository,
      runtime.storageFactory,
      storageInput,
    );
    RepositoryHistoryInternals.bindEntityHistory(entity, storage, entityId, repository.stateSchema);
    return { commits: storage.commits, events: storage.events, storageInput };
  },

  /**
   * Restores an Entity from Stand or creates a fresh instance at Version zero.
   *
   * @param repository Entity schema and constructor registration.
   * @param entityId Entity identifier.
   * @param stored Prior Stand snapshot, when present.
   * @param resetDeleted Whether rebuild replaces a deleted Projection.
   * @returns The Entity instance for one repository dispatch.
   */
  instantiate(
    repository: RepositoryView,
    entityId: unknown,
    stored:
      | {
          readonly state: unknown;
          readonly versionMessage: Version;
          readonly archived: boolean;
          readonly deleted: boolean;
        }
      | undefined,
    resetDeleted: boolean,
  ): object {
    const entityType = repository.entityType as unknown as new (options: {
      readonly id: unknown;
      readonly schema: DescriptorMessageSchema;
      readonly state: unknown;
      readonly version: Version;
      readonly lifecycle: EntityLifecycleFlags;
    }) => object;
    const fresh = stored === undefined || resetDeleted;
    return new entityType({
      id: entityId,
      schema: repository.stateSchema,
      state: fresh
        ? create(repository.stateSchema, { [repository.idField.localName]: entityId })
        : stored.state,
      version: fresh ? create(VersionSchema) : stored.versionMessage,
      lifecycle: resetDeleted
        ? { archived: false, deleted: false }
        : { archived: stored?.archived ?? false, deleted: stored?.deleted ?? false },
    });
  },

  /**
   * Builds the loaded repository Entity view from a Stand snapshot.
   *
   * @param entity Restored Entity instance.
   * @param stored Prior Stand snapshot, when present.
   * @param commits Durable commit storage.
   * @param events Durable diagnostic Event history.
   * @param storageInput Entity storage specification.
   * @param schema Entity state schema.
   * @param entityId Entity identifier.
   * @returns The loaded Entity and prior record.
   */
  loaded(
    entity: object,
    stored:
      | {
          readonly state: unknown;
          readonly versionMessage: Version;
          readonly archived: boolean;
          readonly deleted: boolean;
        }
      | undefined,
    commits: EntityCommitStorage,
    events: EntityEventHistoryPort<unknown>,
    storageInput: EntityStorageInput<unknown, Message>,
    schema: DescriptorMessageSchema,
    entityId: unknown,
  ): LoadedRepositoryEntity {
    return Object.freeze({
      commits,
      events,
      current:
        stored === undefined
          ? undefined
          : EntityRecords.pack(schema, entityId, stored.state as Message, stored.versionMessage, {
              archived: stored.archived,
              deleted: stored.deleted,
            }),
      entity,
      storageInput,
    });
  },

  /**
   * Returns a defensive copy of the Version before this repository dispatch.
   *
   * @param current Prior stored Entity record, when one exists.
   * @returns Prior Version, or the initial zero Version for a fresh Entity.
   */
  priorVersion(current: EntityRecord | undefined): Version {
    return current?.version === undefined
      ? create(VersionSchema)
      : clone(VersionSchema, current.version);
  },

  /**
   * Reads the current state snapshot from a repository Entity.
   *
   * @param entity Entity instance to inspect.
   * @returns Its current state message.
   */
  repositoryState(entity: object): unknown {
    return (entity as { readonly state: unknown }).state;
  },

  /**
   * Reads the current Spine Version from a repository Entity.
   *
   * @param entity Entity instance to inspect.
   * @returns Its current Version snapshot.
   */
  repositoryVersion(entity: object): Version {
    return (entity as { readonly version: Version }).version;
  },

  /**
   * Reads archived and deleted flags from a repository Entity.
   *
   * @param entity Entity instance to inspect.
   * @returns Its current lifecycle flags.
   */
  repositoryLifecycle(entity: object): {
    readonly archived: boolean;
    readonly deleted: boolean;
  } {
    return (
      entity as { readonly lifecycle: { readonly archived: boolean; readonly deleted: boolean } }
    ).lifecycle;
  },

  /**
   * Checks whether the Entity transaction changed state or lifecycle.
   *
   * @param entity Entity instance to inspect.
   * @returns Whether the Entity reports a change.
   */
  repositoryChanged(entity: object): boolean {
    return (entity as { readonly changed?: unknown }).changed === true;
  },
};
Object.freeze(RepositoryEntities);

/**
 * Internal repository signals operations.
 */
const RepositorySignals = {
  /**
   * Validates that a rejection type was declared by the invoked handler.
   *
   * @param handler Handler declaration that raised the rejection.
   * @param rejection Rejection to validate.
   */
  requireDeclaredRejection(handler: HandlerMetadata, rejection: RejectionThrowable): void {
    DeclaredRejections.require(
      handler.methodName,
      HandlerMetadataValues.thrownSchemas(handler),
      rejection,
    );
  },

  /**
   * Reads the producer version from an Event context.
   *
   * @param event Event carrying producer metadata.
   * @returns Version number as a bigint.
   */
  readEventVersion(event: Event): bigint {
    const number = event.context?.version?.number;

    if (number === undefined) {
      throw new Error("Repository aggregate execution requires readable event versions.");
    }

    return BigInt(number);
  },

  /**
   * Converts an Aggregate version into the Event context int32 range.
   *
   * @param version Aggregate version number.
   * @returns Version number suitable for a Protobuf Event context.
   */
  eventVersionNumber(version: bigint): number {
    if (version > 2_147_483_647n || version < -2_147_483_648n) {
      throw new Error(
        "Repository aggregate execution requires versions in the protobuf int32 range.",
      );
    }

    return Number(version);
  },

  /**
   * Copies an Event context with the producing Entity identifier.
   *
   * @param context Event context to extend.
   * @param repository Producing Entity repository.
   * @param entityId Producing Entity identifier.
   * @param version Full pre-dispatch producer Version, when supplied.
   * @returns New Event context with producer metadata.
   */
  eventContextWithProducer(
    context: NonNullable<Event["context"]>,
    repository: RepositoryView,
    entityId: unknown,
    version?: Version,
  ): NonNullable<Event["context"]> {
    const producerId = EntityIds.pack(repository.stateSchema, entityId);
    return create(EventContextSchema, {
      ...context,
      producerId,
      ...(version === undefined ? {} : { version: clone(VersionSchema, version) }),
    });
  },

  /**
   * Builds a rejection Event and returns a best-effort publication follow-up.
   *
   * @param runtime Context signal and publication services.
   * @param repository Repository of the rejected Command.
   * @param command Command rejected by its handler.
   * @param entityId Target Entity identifier.
   * @param rejection Declared handler rejection.
   * @returns Deferred rejection Event publication.
   */
  postRejectionEvent(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    command: Command,
    entityId: unknown,
    rejection: RejectionThrowable,
  ): EntityInboxFollowUp {
    const metadata = runtime.signalMetadata.eventFromCommand(command, {});
    const event = create(EventSchema, {
      id: metadata.id,
      message: AnyMessages.pack(rejection.schema, rejection.messageThrown()),
      context: create(EventContextSchema, {
        ...RepositorySignals.eventContextWithProducer(metadata.context, repository, entityId),
        rejection: create(RejectionEventContextSchema, {
          command: clone(CommandSchema, command),
          stacktrace: rejection.stack ?? "",
        }),
      }),
    });

    return async () => {
      try {
        // spine-log-boundary: server.repository_rejection_follow_up
        await runtime.publisher.publishRejectionEvent(event);
      } catch (error) {
        runtime.publisher.reportFailure("event", event, error);
      }
    };
  },

  /**
   * Validates a nonempty Command ID for Event origin metadata.
   *
   * @param command Source Command envelope.
   * @returns Its nonempty ID.
   */
  requireCommandId(command: Command): NonNullable<Command["id"]> {
    if (command.id === undefined || command.id.uuid.trim().length === 0) {
      throw new Error("Repository aggregate execution requires command.id to bind event origins.");
    }

    return command.id;
  },

  /**
   * Validates a nonempty Event ID for inbox deduplication.
   *
   * @param event Source Event envelope.
   * @returns Its nonempty ID.
   */
  requireEventId(event: Event): NonNullable<Event["id"]> {
    if (event.id === undefined || event.id.value.trim().length === 0) {
      throw new Error("Repository projection inbox handoff requires event.id.");
    }

    return event.id;
  },

  /**
   * Creates a Protobuf timestamp for this execution instant.
   *
   * @returns Timestamp derived from the current clock.
   */
  executionTimestamp(): Timestamp {
    const milliseconds = Date.now();
    return create(TimestampSchema, {
      seconds: BigInt(Math.floor(milliseconds / 1_000)),
      nanos: (milliseconds % 1_000) * 1_000_000,
    });
  },
};

/**
 * Describes one committed Entity transition to publish on the System EventBus.
 */
interface EntityCommitChange {
  readonly repository: RepositoryView;
  readonly entityId: unknown;
  readonly oldState: Message | undefined;
  readonly oldLifecycle: EntityLifecycleFlags | undefined;
  readonly newState: Message;
  readonly lifecycle: EntityLifecycleFlags;
  readonly version: number;
}

/**
 * Identifies the signal that caused a committed Entity transition.
 */
interface EventOrigin {
  readonly id: NonNullable<ReturnType<typeof AnyMessages.pack>>;
  readonly typeUrl: string;
}

/**
 * Provides fields shared by Entity lifecycle event messages.
 */
interface SystemEventFields {
  readonly entity: MessageId;
  readonly signalId: MessageId[];
  readonly state: Any;
  readonly version: Version;
}

/**
 * Creates one System event payload after its envelope timestamp is known.
 */
interface SystemEventDraft {
  readonly schema: MessageSchema;
  readonly messageAt: (when: Timestamp | undefined) => Message;
}

/**
 * Builds and best-effort dispatches committed entity state notifications.
 */
class EntityStateChangePublishing {
  /**
   * Publishes System Events for an Entity change caused by a Command.
   *
   * @param runtime Context signal and publication services.
   * @param repository Repository of the changed Entity.
   * @param command Source Command.
   * @param entityId Changed Entity identifier.
   * @param oldState State before handling, when present.
   * @param oldLifecycle Lifecycle before handling, when present.
   * @param newState Accepted Entity state.
   * @param lifecycle Accepted lifecycle flags.
   * @param version Committed Entity version number.
   */
  command(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    command: Command,
    entityId: unknown,
    oldState: Message | undefined,
    oldLifecycle: EntityLifecycleFlags | undefined,
    newState: Message,
    lifecycle: EntityLifecycleFlags,
    version: number,
  ): void {
    this.#publish(
      runtime,
      () =>
        runtime.signalMetadata.eventFromCommand(command, {
          version,
        }),
      {
        id: AnyMessages.pack(CommandIdSchema, command.id as never),
        typeUrl: command.message?.typeUrl ?? "",
      },
      { repository, entityId, oldState, oldLifecycle, newState, lifecycle, version },
    );
  }

  /**
   * Publishes System Events for an Entity change caused by an Event.
   *
   * @param runtime Context signal and publication services.
   * @param repository Repository of the changed Entity.
   * @param source Source Event.
   * @param entityId Changed Entity identifier.
   * @param oldState State before handling, when present.
   * @param oldLifecycle Lifecycle before handling, when present.
   * @param newState Accepted Entity state.
   * @param lifecycle Accepted lifecycle flags.
   * @param version Committed Entity version number.
   */
  event(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    source: Event,
    entityId: unknown,
    oldState: Message | undefined,
    oldLifecycle: EntityLifecycleFlags | undefined,
    newState: Message,
    lifecycle: EntityLifecycleFlags,
    version: number,
  ): void {
    this.#publish(
      runtime,
      () =>
        runtime.signalMetadata.eventFromEvent(source, {
          version,
        }),
      {
        id: AnyMessages.pack(EventIdSchema, source.id as never),
        typeUrl: source.message?.typeUrl ?? "",
      },
      { repository, entityId, oldState, oldLifecycle, newState, lifecycle, version },
    );
  }

  /**
   * Packs and publishes each System Event describing the accepted change.
   *
   * @param runtime Context signal and publication services.
   * @param metadataFor Creates Event metadata from the source signal.
   * @param origin Source signal identifier and type URL.
   * @param change Accepted Entity transition.
   */
  #publish(
    runtime: RepositoryRuntime,
    metadataFor: () => ReturnType<SignalMetadata["eventFromCommand"]>,
    origin: EventOrigin,
    change: EntityCommitChange,
  ): void {
    const drafts = this.#drafts(origin, change);
    drafts.forEach((draft) => {
      const metadata = metadataFor();
      runtime.registerSystemEventSchema(draft.schema);
      const event = create(EventSchema, {
        id: metadata.id,
        message: AnyMessages.pack(
          draft.schema,
          draft.messageAt(metadata.context.timestamp) as never,
        ),
        context: RepositorySignals.eventContextWithProducer(
          metadata.context,
          change.repository,
          change.entityId,
        ),
      });
      this.#post(runtime, event);
    });
  }

  /**
   * Creates state and lifecycle System Events for a committed change.
   *
   * @param origin Source signal identifier and type URL.
   * @param change Accepted Entity transition.
   * @returns Event drafts for the changed state or lifecycle.
   */
  #drafts(origin: EventOrigin, change: EntityCommitChange): readonly SystemEventDraft[] {
    const fields = this.#fields(origin, change);
    const archive = this.#archiveDraft(fields, change);
    const deletion = this.#deleteDraft(fields, change);
    return [...this.#stateDrafts(fields, change), archive, deletion].filter(
      (draft): draft is SystemEventDraft => draft !== undefined,
    );
  }

  /**
   * Packs fields shared by Entity state and lifecycle diagnostics.
   *
   * @param origin Source signal identifier and type URL.
   * @param change Accepted Entity transition.
   * @returns Shared Entity, signal, state, and version fields.
   */
  #fields(origin: EventOrigin, change: EntityCommitChange): SystemEventFields {
    const entity = create(MessageIdSchema, {
      id: this.#packEntityId(change.repository, change.entityId),
      typeUrl: TypeUrls.derive(change.repository.stateSchema),
    });
    return {
      entity,
      signalId: [create(MessageIdSchema, { id: origin.id, typeUrl: origin.typeUrl })],
      state: AnyMessages.pack(change.repository.stateSchema, change.newState),
      version: create(VersionSchema, { number: change.version }),
    };
  }

  /**
   * Creates state Event drafts from prior and next state.
   *
   * @param fields Shared System Event fields.
   * @param change Accepted Entity transition.
   * @returns Zero, one, or two state Event drafts.
   */
  #stateDrafts(fields: SystemEventFields, change: EntityCommitChange): readonly SystemEventDraft[] {
    const drafts: SystemEventDraft[] = [];
    if (change.oldState === undefined) {
      drafts.push({
        schema: EntityLog.EntityCreatedSchema,
        messageAt: () =>
          create(EntityLog.EntityCreatedSchema, {
            entity: fields.entity,
            kind: this.#kind(change.repository.metadata.kind),
          }),
      });
    }
    if (
      change.oldState === undefined ||
      !this.#sameState(change.repository.stateSchema, change.oldState, change.newState)
    ) {
      drafts.push(this.#stateChangedDraft(fields, change));
    }
    return drafts;
  }

  /**
   * Builds an EntityStateChanged payload draft.
   *
   * @param fields Shared System Event fields.
   * @param change Accepted Entity transition.
   * @returns Draft that receives the envelope timestamp later.
   */
  #stateChangedDraft(fields: SystemEventFields, change: EntityCommitChange): SystemEventDraft {
    return {
      schema: EntityLog.EntityStateChangedSchema,
      messageAt: (when) =>
        create(EntityLog.EntityStateChangedSchema, {
          entity: fields.entity,
          ...(change.oldState === undefined
            ? {}
            : {
                oldState: AnyMessages.pack(change.repository.stateSchema, change.oldState as never),
              }),
          newState: fields.state,
          signalId: fields.signalId,
          when,
          newVersion: fields.version,
        }),
    };
  }

  /**
   * Creates an archive or unarchive Event when that flag changed.
   *
   * @param fields Shared System Event fields.
   * @param change Accepted Entity transition.
   * @returns Lifecycle Event draft, or `undefined`.
   */
  #archiveDraft(
    fields: SystemEventFields,
    change: EntityCommitChange,
  ): SystemEventDraft | undefined {
    const previous = change.oldLifecycle ?? { archived: false, deleted: false };
    if (previous.archived === change.lifecycle.archived) return undefined;
    return change.lifecycle.archived
      ? {
          schema: EntityLog.EntityArchivedSchema,
          messageAt: (when) =>
            create(EntityLog.EntityArchivedSchema, {
              entity: fields.entity,
              signalId: fields.signalId,
              when,
              version: fields.version,
              lastState: fields.state,
            }),
        }
      : {
          schema: EntityLog.EntityUnarchivedSchema,
          messageAt: (when) =>
            create(EntityLog.EntityUnarchivedSchema, {
              entity: fields.entity,
              signalId: fields.signalId,
              when,
              version: fields.version,
              state: fields.state,
            }),
        };
  }

  /**
   * Creates a deletion or restoration Event when that flag changed.
   *
   * @param fields Shared System Event fields.
   * @param change Accepted Entity transition.
   * @returns Lifecycle Event draft, or `undefined`.
   */
  #deleteDraft(
    fields: SystemEventFields,
    change: EntityCommitChange,
  ): SystemEventDraft | undefined {
    const previous = change.oldLifecycle ?? { archived: false, deleted: false };
    if (previous.deleted === change.lifecycle.deleted) return undefined;
    return change.lifecycle.deleted
      ? {
          schema: EntityLog.EntityDeletedSchema,
          messageAt: (when) =>
            create(EntityLog.EntityDeletedSchema, {
              entity: fields.entity,
              signalId: fields.signalId,
              when,
              version: fields.version,
              deletion: { case: "markedAsDeleted", value: true },
              lastState: fields.state,
            }),
        }
      : {
          schema: EntityLog.EntityRestoredSchema,
          messageAt: (when) =>
            create(EntityLog.EntityRestoredSchema, {
              entity: fields.entity,
              signalId: fields.signalId,
              when,
              version: fields.version,
              state: fields.state,
            }),
        };
  }

  /**
   * Schedules best-effort System Event publication and reports failure.
   *
   * @param runtime Context publication services.
   * @param event Packed System Event to publish.
   */
  #post(runtime: RepositoryRuntime, event: Event): void {
    try {
      // spine-log-boundary: server.repository_system_follow_up
      void runtime.publisher.publishSystemEvent(event);
    } catch (error) {
      runtime.publisher.reportFailure("system-event", event, error);
    }
  }

  /**
   * Compares serialized state messages for a meaningful state change.
   *
   * @param schema Generated state schema.
   * @param left State before handling.
   * @param right State after handling.
   * @returns Whether their serialized bytes match.
   */
  #sameState(schema: MessageSchema, left: Message, right: Message): boolean {
    const leftBytes = toBinary(schema, left as never);
    const rightBytes = toBinary(schema, right as never);
    return (
      leftBytes.length === rightBytes.length &&
      leftBytes.every((value, index) => value === rightBytes[index])
    );
  }

  /**
   * Maps a repository Entity family to the System Event kind enum.
   *
   * @param kind Repository Entity family.
   * @returns Matching Protobuf Entity kind.
   */
  #kind(kind: EntityMetadata["kind"]): number {
    return kind === "aggregate"
      ? EntityOption_Kind.AGGREGATE
      : kind === "projection"
        ? EntityOption_Kind.PROJECTION
        : EntityOption_Kind.PROCESS_MANAGER;
  }

  /**
   * Packs an Entity identifier for System Event metadata.
   *
   * @param repository Repository carrying the ID schema.
   * @param entityId Changed Entity identifier.
   * @returns Packed identifier.
   */
  #packEntityId(repository: RepositoryView, entityId: unknown) {
    return EntityIds.pack(repository.stateSchema, entityId);
  }
}
const EntityStateChangePublisher = Object.freeze(new EntityStateChangePublishing());

/**
 * Builds and best-effort dispatches accepted handler diagnostics.
 */
class HandlerDispatchPublishing {
  /**
   * Publishes a best-effort CommandDispatchedToHandler diagnostic.
   *
   * @param runtime Context signal and publication services.
   * @param repository Repository receiving the Command.
   * @param command Source Command.
   * @param entityId Target Entity identifier.
   */
  command(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    command: Command,
    entityId: unknown,
  ): void {
    try {
      const context = runtime.signalMetadata.eventContext({
        origin: runtime.signalMetadata.originFromCommand(command),
      });
      const event = create(EventSchema, {
        id: runtime.signalMetadata.eventId(),
        message: AnyMessages.pack(
          EntityLog.CommandDispatchedToHandlerSchema,
          this.#message(repository, command, entityId, context.timestamp),
        ),
        context,
      });
      this.#post(runtime, EntityLog.CommandDispatchedToHandlerSchema, event);
    } catch (error) {
      runtime.publisher.reportFailure("event", create(EventSchema), error);
    }
  }

  /**
   * Publishes a best-effort EventDispatchedToSubscriber diagnostic.
   *
   * @param runtime Context signal and publication services.
   * @param repository Repository receiving the Event.
   * @param event Source Event.
   * @param entityId Target Entity identifier.
   */
  subscriber(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    event: Event,
    entityId: unknown,
  ): void {
    this.#publishEvent(
      runtime,
      repository,
      event,
      entityId,
      EntityLog.EventDispatchedToSubscriberSchema,
    );
  }

  /**
   * Publishes a best-effort EventDispatchedToReactor diagnostic.
   *
   * @param runtime Context signal and publication services.
   * @param repository Repository receiving the Event.
   * @param event Source Event.
   * @param entityId Target Entity identifier.
   */
  reactor(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    event: Event,
    entityId: unknown,
  ): void {
    this.#publishEvent(
      runtime,
      repository,
      event,
      entityId,
      EntityLog.EventDispatchedToReactorSchema,
    );
  }

  /**
   * Builds and publishes one subscriber or reactor dispatch diagnostic.
   *
   * @param runtime Context signal and publication services.
   * @param repository Repository receiving the Event.
   * @param event Source Event.
   * @param entityId Target Entity identifier.
   * @param schema Diagnostic message schema to emit.
   */
  #publishEvent(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    event: Event,
    entityId: unknown,
    schema:
      | typeof EntityLog.EventDispatchedToSubscriberSchema
      | typeof EntityLog.EventDispatchedToReactorSchema,
  ): void {
    try {
      const context = runtime.signalMetadata.eventContext({
        origin: runtime.signalMetadata.originFromEvent(event),
      });
      const diagnostic = create(EventSchema, {
        id: runtime.signalMetadata.eventId(),
        message: AnyMessages.pack(
          schema,
          this.#eventMessage(schema, repository, event, entityId, context.timestamp) as never,
        ),
        context,
      });
      this.#post(runtime, schema, diagnostic);
    } catch (error) {
      runtime.publisher.reportFailure("event", create(EventSchema), error);
    }
  }

  /**
   * Packs a Command dispatch diagnostic with target and source metadata.
   *
   * @param repository Repository receiving the Command.
   * @param command Source Command.
   * @param entityId Target Entity identifier.
   * @param whenDispatched Dispatch timestamp, when available.
   * @returns Command dispatch diagnostic message.
   */
  #message(
    repository: RepositoryView,
    command: Command,
    entityId: unknown,
    whenDispatched: Timestamp | undefined,
  ): EntityLog.CommandDispatchedToHandler {
    return create(EntityLog.CommandDispatchedToHandlerSchema, {
      receiver: create(MessageIdSchema, {
        id: this.#packEntityId(repository, entityId),
        typeUrl: TypeUrls.derive(repository.stateSchema),
      }),
      payload: clone(CommandSchema, command),
      whenDispatched,
      entityType: create(EntityTypeNameSchema, {
        impl: { case: "javaClassName", value: repository.entityType.name },
      }),
    });
  }

  /**
   * Registers and schedules a System Event diagnostic for publication.
   *
   * @param runtime Context publication services.
   * @param schema Diagnostic message schema.
   * @param event Packed diagnostic Event.
   */
  #post(
    runtime: RepositoryRuntime,
    schema:
      | typeof EntityLog.CommandDispatchedToHandlerSchema
      | typeof EntityLog.EventDispatchedToSubscriberSchema
      | typeof EntityLog.EventDispatchedToReactorSchema,
    event: Event,
  ): void {
    try {
      runtime.registerSystemEventSchema(schema);
      // spine-log-boundary: server.repository_system_dispatch_follow_up
      void runtime.publisher.publishSystemEvent(event);
    } catch (error) {
      runtime.publisher.reportFailure("system-event", event, error);
    }
  }

  /**
   * Packs a target Entity identifier for dispatch diagnostics.
   *
   * @param repository Repository carrying the ID schema.
   * @param entityId Target Entity identifier.
   * @returns Packed identifier.
   */
  #packEntityId(repository: RepositoryView, entityId: unknown): Any {
    return EntityIds.pack(repository.stateSchema, entityId);
  }

  /**
   * Packs a subscriber or reactor dispatch diagnostic message.
   *
   * @param schema Diagnostic message schema to emit.
   * @param repository Repository receiving the Event.
   * @param event Source Event.
   * @param entityId Target Entity identifier.
   * @param whenDispatched Dispatch timestamp, when available.
   * @returns Matching subscriber or reactor diagnostic message.
   */
  #eventMessage(
    schema:
      | typeof EntityLog.EventDispatchedToSubscriberSchema
      | typeof EntityLog.EventDispatchedToReactorSchema,
    repository: RepositoryView,
    event: Event,
    entityId: unknown,
    whenDispatched: Timestamp | undefined,
  ): EntityLog.EventDispatchedToSubscriber | EntityLog.EventDispatchedToReactor {
    const fields = {
      receiver: create(MessageIdSchema, {
        id: this.#packEntityId(repository, entityId),
        typeUrl: TypeUrls.derive(repository.stateSchema),
      }),
      payload: clone(EventSchema, event),
      whenDispatched,
      entityType: create(EntityTypeNameSchema, {
        impl: { case: "javaClassName", value: repository.entityType.name },
      }),
    };
    return schema === EntityLog.EventDispatchedToSubscriberSchema
      ? create(EntityLog.EventDispatchedToSubscriberSchema, fields)
      : create(EntityLog.EventDispatchedToReactorSchema, fields);
  }
}

const HandlerDispatchPublisher = Object.freeze(new HandlerDispatchPublishing());
Object.freeze(RepositorySignals);

/**
 * Internal repository stand operations.
 */
const RepositoryStand = {
  /**
   * Builds tenant, Version, and lifecycle options for a Stand update.
   *
   * @param tenantId Tenant receiving the update, when present.
   * @param version Committed Spine Version, when present.
   * @param lifecycle Accepted archived and deleted flags.
   * @returns Frozen Stand update options.
   */
  standUpdateOptions(
    tenantId: TenantId | undefined,
    version: Version | undefined,
    lifecycle: { readonly archived: boolean; readonly deleted: boolean },
  ): {
    readonly tenantId?: TenantId;
    readonly version?: Version;
    readonly lifecycle: { readonly archived: boolean; readonly deleted: boolean };
  } {
    return Object.freeze({
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(version === undefined ? {} : { version }),
      lifecycle,
    });
  },

  /**
   * Maps one Event position to its Process Manager producer version.
   *
   * @param sequence One-based position among produced Events.
   * @returns Producer sequence number for Event metadata.
   */
};
Object.freeze(RepositoryStand);

/**
 * Internal repository tenants operations.
 */
const RepositoryTenants = {
  /**
   * Builds tenant-aware storage context for Entity inbox delivery.
   *
   * @param context Bounded context storage mode.
   * @param tenantId Delivery tenant when multitenant.
   * @returns Storage context for durable Entity inbox rows.
   */
  entityInboxDeliveryContext(context: StorageMode, tenantId: TenantId | undefined): StorageContext {
    if (!context.multitenant) {
      return Object.freeze({ name: context.name, multitenant: false });
    }

    const tid = tenantId;
    if (tid === undefined) {
      throw new Error(`Multitenant Entity Inbox handoff for "${context.name}" requires tenantId.`);
    }

    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId: RepositoryTenants.require(tid),
    });
  },

  /**
   * Builds tenant-aware storage context for Projection inbox delivery.
   *
   * @param context Bounded context storage mode.
   * @param tenantId Delivery tenant when multitenant.
   * @returns Storage context for durable Projection inbox rows.
   */
  projectionDeliveryContext(context: StorageMode, tenantId: TenantId | undefined): StorageContext {
    if (!context.multitenant) {
      return Object.freeze({ name: context.name, multitenant: false });
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
      tenantId: RepositoryTenants.require(tid),
    });
  },

  /**
   * Validates an Event tenant before Projection inbox handoff.
   *
   * @param context Bounded context storage mode.
   * @param event Event entering Projection delivery.
   * @returns Validated tenant, or `undefined` for single-tenant contexts.
   */
  requireProjectionTenant(context: StorageMode, event: Event): TenantId | undefined {
    if (!context.multitenant) {
      return undefined;
    }

    const tenantId = RepositoryTenants.readEventTenant(event);

    if (tenantId === undefined) {
      throw new Error(
        `Multitenant projection inbox handoff for "${context.name}" requires tenantId.`,
      );
    }

    return RepositoryTenants.require(tenantId);
  },

  /**
   * Validates an Event tenant before Process Manager inbox handoff.
   *
   * @param context Bounded context storage mode.
   * @param event Event entering Process Manager delivery.
   * @returns Validated tenant, or `undefined` for single-tenant contexts.
   */
  requirePmEventTenant(context: StorageMode, event: Event): TenantId | undefined {
    if (!context.multitenant) {
      return undefined;
    }

    const tenantId = RepositoryTenants.readEventTenant(event);

    if (tenantId === undefined) {
      throw new Error(`Multitenant Entity Inbox handoff for "${context.name}" requires tenantId.`);
    }

    return RepositoryTenants.require(tenantId);
  },

  /**
   * Validates a Command tenant before Entity inbox handoff.
   *
   * @param context Bounded context storage mode.
   * @param command Command entering Entity delivery.
   * @returns Validated tenant, or `undefined` for single-tenant contexts.
   */
  requireCommandTenant(context: StorageMode, command: Command): TenantId | undefined {
    if (!context.multitenant) {
      return undefined;
    }

    const tenantId = RepositoryTenants.readCommandTenant(command);

    if (tenantId === undefined) {
      throw new Error(`Multitenant Entity Inbox handoff for "${context.name}" requires tenantId.`);
    }

    return RepositoryTenants.require(tenantId);
  },

  /**
   * Builds storage context from a Command actor tenant.
   *
   * @param context Bounded context storage mode.
   * @param command Command entering repository execution.
   * @returns Tenant-aware storage context.
   */
  storageContextForCommand(context: StorageMode, command: Command): StorageContext {
    if (!context.multitenant) {
      return Object.freeze({ name: context.name, multitenant: false });
    }

    const tenantId = RepositoryTenants.readCommandTenant(command);
    if (tenantId === undefined)
      throw new Error(`Multitenant command for "${context.name}" requires tenantId.`);
    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId: RepositoryTenants.require(tenantId),
    });
  },

  /**
   * Builds storage context from an Event origin tenant.
   *
   * @param context Bounded context storage mode.
   * @param event Event entering repository execution.
   * @returns Tenant-aware storage context.
   */
  storageContextForEvent(context: StorageMode, event: Event): StorageContext {
    if (!context.multitenant) {
      return Object.freeze({ name: context.name, multitenant: false });
    }

    const tenantId = RepositoryTenants.readEventTenant(event);
    if (tenantId === undefined)
      throw new Error(`Multitenant event for "${context.name}" requires tenantId.`);
    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId: RepositoryTenants.require(tenantId),
    });
  },

  /**
   * Builds storage context from an explicit tenant value.
   *
   * @param context Bounded context storage mode.
   * @param tenantId Tenant to select when multitenant.
   * @returns Tenant-aware storage context.
   */
  storageContextForTenant(context: StorageMode, tenantId: TenantId | undefined): StorageContext {
    if (!context.multitenant) return Object.freeze({ name: context.name, multitenant: false });
    if (tenantId === undefined)
      throw new Error(`Multitenant storage for "${context.name}" requires tenantId.`);
    return Object.freeze({
      name: context.name,
      multitenant: true,
      tenantId: RepositoryTenants.require(tenantId),
    });
  },

  /**
   * Reads a copied tenant identifier from Command actor metadata.
   *
   * @param command Source Command.
   * @returns Tenant identifier when present.
   */
  readCommandTenant(command: Command): TenantId | undefined {
    return RepositoryTenants.tenantValue(command.context?.actorContext?.tenantId);
  },

  /**
   * Reads a tenant for a Stand Event update when available.
   *
   * @param context Bounded context storage mode.
   * @param event Source Event.
   * @returns Stand tenant options.
   */
  standTenantOptions(context: StorageMode, event: Event): { readonly tenantId?: TenantId } {
    if (!context.multitenant) {
      return {};
    }

    const tenantId = RepositoryTenants.readEventTenant(event);
    return tenantId === undefined ? {} : { tenantId };
  },

  /**
   * Reads a tenant for a Stand Command update when available.
   *
   * @param context Bounded context storage mode.
   * @param command Source Command.
   * @returns Stand tenant options.
   */
  commandStandOptions(context: StorageMode, command: Command): { readonly tenantId?: TenantId } {
    if (!context.multitenant) {
      return {};
    }

    const tenantId = RepositoryTenants.readCommandTenant(command);
    return tenantId === undefined ? {} : { tenantId };
  },

  /**
   * Reads a copied tenant identifier from Event origin metadata.
   *
   * @param event Source Event.
   * @returns Tenant identifier when present.
   */
  readEventTenant(event: Event): TenantId | undefined {
    switch (event.context?.origin.case) {
      case "importContext":
        return RepositoryTenants.tenantValue(event.context.origin.value.tenantId);
      case "pastMessage":
        return RepositoryTenants.tenantValue(event.context.origin.value.actorContext?.tenantId);
      default:
        return undefined;
    }
  },

  /**
   * Copies a tenant identifier when provided.
   *
   * @param tenantId Tenant identifier to isolate from its source.
   * @returns Copied tenant, or `undefined`.
   */
  tenantValue(tenantId: TenantId | undefined): TenantId | undefined {
    return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
  },

  /**
   * Validates and copies a tenant identifier through the storage boundary.
   *
   * @param tenantId Tenant identifier to validate.
   * @returns Validated tenant identifier.
   */
  require(tenantId: TenantId): TenantId {
    return TenantBoundary.from(tenantId).tenantId;
  },

  /**
   * Compares normalized tenant storage keys.
   *
   * @param left First tenant identifier.
   * @param right Second tenant identifier.
   * @returns Whether both identifiers select the same tenant.
   */
  equal(left: TenantId, right: TenantId): boolean {
    return TenantBoundary.from(left).key === TenantBoundary.from(right).key;
  },
};
Object.freeze(RepositoryTenants);

/**
 * Internal repository handlers operations.
 */
const RepositoryHandlers = {
  /**
   * Rejects outputs not declared by the invoked handler, even if a sibling declares them.
   *
   * @param handler Invoked handler declaration.
   * @param signals Returned domain messages to validate.
   * @param allowEnvelopes Whether Event envelopes may pass through.
   */
  requireDeclaredOutputs(
    handler: HandlerMetadata,
    signals: readonly unknown[],
    allowEnvelopes = false,
  ): void {
    const schemas = HandlerMetadataValues.returnedSchemas(handler);
    for (const signal of signals) {
      if (allowEnvelopes && EntityInvocation.isEventEnvelope(signal)) continue;
      const typeName = EntityInvocation.messageTypeName(signal);
      if (!schemas.some((schema) => schema.typeName === typeName)) {
        throw new Error(
          `Handler "${handler.methodName}" returned undeclared message "${typeName}".`,
        );
      }
    }
  },

  /**
   * Normalizes one or many handler metadata blocks to a frozen list.
   *
   * @param handlersOption Configured handler metadata.
   * @returns Frozen handler metadata list.
   */
  normalizeHandlers(handlersOption: RepositoryHandlersOption): readonly EntityHandlersMetadata[] {
    if (handlersOption === undefined) {
      return Object.freeze([]);
    }
    if (RepositoryHandlers.isHandlersArray(handlersOption)) {
      return Object.freeze([...handlersOption]);
    }
    return Object.freeze([handlersOption]);
  },

  /**
   * Groups Event-to-Command reactions by source Event type.
   *
   * @param handlers Entity handler metadata blocks.
   * @returns Reactions indexed by Event type name.
   */
  createCommandReactionMap(
    handlers: readonly EntityHandlersMetadata[],
  ): ReadonlyMap<string, readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[]> {
    const byEvent = new Map<string, RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[]>();
    const registry = new HandlerMetadataRegistry(handlers);

    for (const entry of registry.findHandlersByKind("command-reaction")) {
      if (RepositoryHandlers.handlerEmittedSchemas(entry.handler).length === 0) {
        continue;
      }
      RepositoryHandlers.pushMapValue(byEvent, entry.handler.messageFullTypeName, entry);
    }

    return byEvent;
  },

  /**
   * Builds Event field filters for handlers grouped by Event type.
   *
   * @typeParam Value Handler registration carrying schema and filter metadata.
   * @param byEvent Handler registrations indexed by Event type.
   * @param stringifiers Field conversion registry for message-valued filters.
   * @returns Compiled filter plans by Event type.
   */
  createEventFilterPlans<
    Value extends {
      readonly handler: {
        readonly schema: DescriptorMessageSchema;
        readonly where?: WhereOptions;
      };
    },
  >(
    byEvent: ReadonlyMap<string, readonly Value[]>,
    stringifiers: StringifierRegistry,
  ): ReadonlyMap<string, EventHandlerFilterPlan<Value>> {
    const plans = new Map<string, EventHandlerFilterPlan<Value>>();
    for (const [eventType, values] of byEvent) {
      plans.set(
        eventType,
        EventHandlerFilters.compile(
          values.map((value) => ({
            value,
            schema: value.handler.schema,
            ...(value.handler.where === undefined ? {} : { where: value.handler.where }),
          })),
          stringifiers,
        ),
      );
    }
    return plans;
  },

  /**
   * Finds handlers for domestic or external Event origin.
   *
   * @typeParam Value Handler registration with origin metadata.
   * @param values Candidate handler registrations.
   * @param external Whether the source Event is external.
   * @returns Frozen matching registration list.
   */
  forOrigin<Value extends { readonly handler: { readonly origin: "domestic" | "external" } }>(
    values: readonly Value[],
    external: boolean,
  ): readonly Value[] {
    return Object.freeze(
      values.filter((value) => (value.handler.origin === "external") === external),
    );
  },

  /**
   * Maps readiness-selected handlers by registered message type.
   *
   * @typeParam Value Handler registration returned by readiness lookup.
   * @param schemas Registered message schemas.
   * @param find Selects handlers for one type name.
   * @returns Handler lists indexed by message type name.
   */
  readinessMap<Value>(
    schemas: readonly MessageSchema[],
    find: (typeName: string) => readonly Value[],
  ): ReadonlyMap<string, readonly Value[]> {
    return new Map(schemas.map((schema) => [schema.typeName, find(schema.typeName)]));
  },

  /**
   * Reads the declared output schemas for one handler.
   *
   * @param handler Command or Event handler declaration.
   * @returns Generated schemas the handler may emit.
   */
  handlerEmittedSchemas(
    handler:
      | CommandAssignmentHandlerMetadata
      | import("../handler/handler-metadata.js").CommandSubstitutionHandlerMetadata
      | CommandReactionHandlerMetadata
      | EventReactionHandlerMetadata,
  ): readonly DescriptorMessageSchema[] {
    return HandlerMetadataValues.returnedSchemas(handler);
  },

  /**
   * Reads the declared rejection schemas for a Command handler.
   *
   * @param handler Assignment or substitution declaration.
   * @returns Generated rejection schemas the handler may throw.
   */
  handlerThrownSchemas(
    handler:
      | CommandAssignmentHandlerMetadata
      | import("../handler/handler-metadata.js").CommandSubstitutionHandlerMetadata,
  ): readonly DescriptorMessageSchema[] {
    return HandlerMetadataValues.thrownSchemas(handler);
  },

  /**
   * Checks whether handler metadata was supplied as a list.
   *
   * @param value Configured handler metadata.
   * @returns Whether it is a handler list.
   */
  isHandlersArray(value: RepositoryHandlersOption): value is readonly EntityHandlersMetadata[] {
    return Array.isArray(value);
  },

  /**
   * Validates handler metadata against the Entity constructor and family.
   *
   * @param entityType Repository Entity constructor.
   * @param metadata Descriptor-derived state metadata.
   * @param handlers Handler metadata blocks to validate.
   */
  validateHandlers(
    entityType: RepositoryEntityType,
    metadata: EntityMetadata,
    handlers: readonly EntityHandlersMetadata[],
  ): void {
    for (const handlersMetadata of handlers) {
      if (
        !HandlerMetadataValues.isAuthentic(handlersMetadata) ||
        handlersMetadata.entityType !== entityType ||
        handlersMetadata.entity.fullTypeName !== metadata.fullTypeName
      ) {
        throw new RepositoryIdentityError(
          "ENTITY_SCHEMA_KIND_MISMATCH",
          `Repository entity type "${entityType.name}" does not match the supplied handler metadata.`,
        );
      }

      if (
        metadata.kind !== "process-manager" &&
        (handlersMetadata.commandSubstitutions.length > 0 ||
          handlersMetadata.commandReactions.length > 0)
      ) {
        throw new RepositoryIdentityError(
          "UNSUPPORTED_ENTITY_TYPE",
          "Only Process Manager repositories support @Command handlers.",
        );
      }
    }
  },

  /**
   * Returns unique generated schemas by type URL.
   *
   * @param schemas Candidate message schemas.
   * @returns Frozen list retaining the last schema for each type URL.
   */
  uniqueSchemas(schemas: readonly MessageSchema[]): readonly MessageSchema[] {
    const byTypeUrl = new Map<string, MessageSchema>();
    for (const schema of schemas) {
      byTypeUrl.set(TypeUrls.derive(schema), schema);
    }
    return Object.freeze([...byTypeUrl.values()]);
  },

  /**
   * Adds a value to a map entry, creating its list when absent.
   *
   * @typeParam Key Map key type.
   * @typeParam Value Map value type.
   * @param map Mutable map of value lists.
   * @param key Entry key to update.
   * @param value Value to append.
   */
  pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
    const values = map.get(key);

    if (values === undefined) {
      map.set(key, [value]);
      return;
    }

    values.push(value);
  },
};
Object.freeze(RepositoryHandlers);

/**
 * Internal repository routes operations.
 */
const RepositoryRoutes = {
  /**
   * Builds immutable routing from an Entity constructor and its declarations.
   *
   * @typeParam EntityType Concrete repository Entity constructor.
   * @param entityType Entity constructor receiving signals.
   * @param entityFamily Aggregate, Projection, or Process Manager family.
   * @param metadata Descriptor-derived state metadata.
   * @param handlersOption Registered Entity handler metadata.
   * @param producedEvents Additional Event schemas this repository may emit.
   * @param commandRouting Captured Command route declarations.
   * @param eventRouting Captured Event route declarations.
   * @param stateUpdateRouting Captured state-update route declarations.
   * @param stringifiers Field conversion registry for Event filters.
   * @returns Immutable routing and handler selection operations.
   */
  createRepositoryRouting<EntityType extends RepositoryEntityType>(
    entityType: EntityType,
    entityFamily: EntityFamily,
    metadata: EntityMetadata,
    handlersOption: RepositoryHandlersOption,
    producedEvents: readonly MessageSchema[],
    commandRouting: RoutingDeclarationSnapshot<CommandRoute<RepositoryEntityId<EntityType>>>,
    eventRouting: RoutingDeclarationSnapshot<EventRoute<RepositoryEntityId<EntityType>>>,
    stateUpdateRouting: RoutingDeclarationSnapshot<
      StateUpdateRoute<RepositoryEntityId<EntityType>>
    >,
    stringifiers: StringifierRegistry,
  ): RepositoryRouting<RepositoryEntityId<EntityType>> {
    return RepositoryRoutes.prepareRouting({
      entityType,
      entityFamily,
      metadata,
      handlersOption,
      producedEvents,
      commandRouting,
      eventRouting,
      stateUpdateRouting,
      stringifiers,
    });
  },

  /**
   * Validates handler declarations and assembles routing schemas and selectors.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param input Entity metadata, handlers, and captured routes.
   * @returns Immutable repository routing.
   */
  prepareRouting<Id>(input: RoutingInput<Id>): RepositoryRouting<Id> {
    const handlers = RepositoryHandlers.normalizeHandlers(input.handlersOption);
    RepositoryHandlers.validateHandlers(input.entityType, input.metadata, handlers);
    const readiness = RepositoryRoutes.readiness(handlers);
    const schemas = RepositoryRoutes.routingSchemas(handlers, input.producedEvents);
    RepositoryRoutes.validateStateSchemas(input.entityFamily, input.metadata, schemas.state);
    const stateSubscriptions = RepositoryRoutes.stateSubscriptions(handlers);
    const filters = RepositoryRoutes.routingFilters(
      handlers,
      schemas.event,
      readiness.event,
      input.stringifiers,
    );
    const routes = RepositoryRoutes.routingMaps(
      schemas,
      input.commandRouting,
      input.eventRouting,
      input.stateUpdateRouting,
      input.metadata.idField,
    );
    return RepositoryRoutes.freezeRouting(
      schemas,
      readiness,
      stateSubscriptions,
      filters,
      routes,
      input.metadata.idField,
    );
  },

  /**
   * Builds Command and Event handler readiness lookups when handlers exist.
   *
   * @param handlers Registered Entity handler metadata.
   * @returns Readiness lookups, or absent lookups for no handlers.
   */
  readiness(handlers: readonly EntityHandlersMetadata[]): RoutingReadiness {
    return handlers.length === 0
      ? { command: undefined, event: undefined }
      : {
          command: CommandRegistrationReadiness.fromEntityHandlers(handlers),
          event: EventRegistrationReadiness.fromEntityHandlers(handlers),
        };
  },

  /**
   * Collects accepted, produced, and origin-specific message schemas.
   *
   * @param handlers Registered Entity handler metadata.
   * @param producedEvents Additional Event schemas this repository may emit.
   * @returns Schema groups used to build routes.
   */
  routingSchemas(
    handlers: readonly EntityHandlersMetadata[],
    producedEvents: readonly MessageSchema[],
  ): RoutingSchemas {
    const accepted = RepositoryRoutes.acceptedSchemas(handlers);
    const origins = RepositoryRoutes.originSchemas(handlers);
    const produced = RepositoryRoutes.producedSchemas(handlers, producedEvents);
    return { ...accepted, ...origins, ...produced };
  },

  /**
   * Collects Command, Event, and state schemas accepted by handlers.
   *
   * @param handlers Registered Entity handler metadata.
   * @returns Deduplicated accepted schema groups.
   */
  acceptedSchemas(handlers: readonly EntityHandlersMetadata[]) {
    const command = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) => [
        ...handler.commandAssignments.map((assignment) => assignment.schema),
        ...handler.commandSubstitutions.map((substitution) => substitution.schema),
      ]),
    );
    const event = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) => [
        ...handler.commandReactions.map((reaction) => reaction.schema),
        ...handler.eventSubscriptions.map((subscription) => subscription.schema),
        ...handler.eventReactions.map((reaction) => reaction.schema),
        ...handler.eventApplications.map((application) => application.schema),
      ]),
    );
    const state = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) =>
        handler.stateSubscriptions.map((subscription) => subscription.schema),
      ),
    ) as readonly DescriptorMessageSchema[];
    return { command, event, state };
  },

  /**
   * Groups domestic and external Event schemas declared by handlers.
   *
   * @param handlers Registered Entity handler metadata.
   * @returns Origin-specific Event schema groups.
   */
  originSchemas(handlers: readonly EntityHandlersMetadata[]) {
    const schemas = (origin: "domestic" | "external") =>
      RepositoryHandlers.uniqueSchemas(
        handlers.flatMap((handler) =>
          handler.handlers
            .filter(
              (candidate) =>
                candidate.origin === origin &&
                (candidate.kind === "event-subscription" ||
                  candidate.kind === "event-reaction" ||
                  candidate.kind === "command-reaction"),
            )
            .map((candidate) => candidate.schema),
        ),
      );
    return { domesticEvent: schemas("domestic"), externalEvent: schemas("external") };
  },

  /**
   * Collects schemas for Events and Commands handlers may produce.
   *
   * @param handlers Registered Entity handler metadata.
   * @param explicitEvents Additional Event schemas configured on the repository.
   * @returns Deduplicated produced Event and Command schema groups.
   */
  producedSchemas(
    handlers: readonly EntityHandlersMetadata[],
    explicitEvents: readonly MessageSchema[],
  ) {
    const producedEvent = RepositoryHandlers.uniqueSchemas([
      ...explicitEvents,
      ...handlers.flatMap((handler) => [
        ...handler.commandAssignments.flatMap((value) =>
          RepositoryHandlers.handlerEmittedSchemas(value),
        ),
        ...handler.commandAssignments.flatMap((value) =>
          RepositoryHandlers.handlerThrownSchemas(value),
        ),
        ...handler.commandSubstitutions.flatMap((value) =>
          RepositoryHandlers.handlerThrownSchemas(value),
        ),
        ...handler.eventReactions.flatMap((value) =>
          RepositoryHandlers.handlerEmittedSchemas(value),
        ),
      ]),
    ]);
    const producedCommand = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) => [
        ...handler.commandSubstitutions.flatMap((value) =>
          RepositoryHandlers.handlerEmittedSchemas(value),
        ),
        ...handler.commandReactions.flatMap((value) =>
          RepositoryHandlers.handlerEmittedSchemas(value),
        ),
      ]),
    );
    return { producedEvent, producedCommand };
  },

  /**
   * Rejects state subscriptions outside Projections or to the same state type.
   *
   * @param entityFamily Repository Entity family.
   * @param metadata Descriptor-derived state metadata.
   * @param schemas Subscribed Entity state schemas.
   */
  validateStateSchemas(
    entityFamily: EntityFamily,
    metadata: EntityMetadata,
    schemas: readonly DescriptorMessageSchema[],
  ): void {
    if (entityFamily !== "projection" && schemas.length > 0) {
      throw new Error("Entity state subscriptions are supported only by Projection repositories.");
    }
    if (schemas.some((schema) => schema.typeName === metadata.schema.typeName)) {
      throw new Error(
        "A Projection cannot subscribe to updates of its repository state because each " +
          "resulting update would be routed back to the same repository.",
      );
    }
  },

  /**
   * Builds Event filters for reactors, subscribers, and Command reactions.
   *
   * @param handlers Registered Entity handler metadata.
   * @param eventSchemas Accepted Event schemas.
   * @param readiness Event handler readiness lookup, when present.
   * @param stringifiers Field conversion registry for filters.
   * @returns Compiled Event filter groups.
   */
  routingFilters(
    handlers: readonly EntityHandlersMetadata[],
    eventSchemas: readonly MessageSchema[],
    readiness: EventRegistrationReadinessLookup | undefined,
    stringifiers: StringifierRegistry,
  ): RoutingFilters {
    const commandReactionMap = RepositoryHandlers.createCommandReactionMap(handlers);
    const subscribers = RepositoryHandlers.readinessMap(
      eventSchemas,
      (typeName) => readiness?.findEventSubscribers(typeName) ?? [],
    );
    const reactors = RepositoryHandlers.readinessMap(
      eventSchemas,
      (typeName) => readiness?.findEventReactors(typeName) ?? [],
    );
    return {
      commandReactionMap,
      commandReactions: RepositoryHandlers.createEventFilterPlans(commandReactionMap, stringifiers),
      eventSubscribers: RepositoryHandlers.createEventFilterPlans(subscribers, stringifiers),
      eventReactors: RepositoryHandlers.createEventFilterPlans(reactors, stringifiers),
    };
  },

  /**
   * Resolves captured custom routes for each accepted signal schema.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Accepted signal and state schemas.
   * @param command Captured Command route declarations.
   * @param event Captured Event route declarations.
   * @param state Captured state-update route declarations.
   * @param idField Canonical target Entity ID field.
   * @returns Custom route maps by schema.
   */
  routingMaps<Id>(
    schemas: RoutingSchemas,
    command: RoutingDeclarationSnapshot<CommandRoute<Id>>,
    event: RoutingDeclarationSnapshot<EventRoute<Id>>,
    state: RoutingDeclarationSnapshot<StateUpdateRoute<Id>>,
    idField: DescriptorFieldMetadata,
  ): RoutingMaps<Id> {
    return {
      command: RepositoryRoutes.resolveCommandRoutes(schemas.command, command),
      event: RepositoryRoutes.resolveEventRoutes(schemas.event, event),
      state: RepositoryRoutes.resolveStateRoutes(schemas.state, state, idField),
    };
  },

  /**
   * Creates immutable schema sets, handler selectors, and signal route operations.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Accepted and produced schema groups.
   * @param readiness Handler readiness lookups.
   * @param stateSubscriptions State subscribers by source type.
   * @param filters Compiled Event filter groups.
   * @param routes Custom route maps by schema.
   * @param idField Canonical target Entity ID field.
   * @returns Immutable repository routing.
   */
  freezeRouting<Id>(
    schemas: RoutingSchemas,
    readiness: RoutingReadiness,
    stateSubscriptions: ReadonlyMap<string, RepositoryStateSubscribers>,
    filters: RoutingFilters,
    routes: RoutingMaps<Id>,
    idField: DescriptorFieldMetadata,
  ): RepositoryRouting<Id> {
    return Object.freeze({
      commandSchemas: schemas.command,
      eventSchemas: schemas.event,
      domesticEventSchemas: schemas.domesticEvent,
      externalEventSchemas: schemas.externalEvent,
      producedEventSchemas: schemas.producedEvent,
      producedCommandSchemas: schemas.producedCommand,
      commandReadiness: readiness.command,
      eventReadiness: readiness.event,
      stateSchemas: schemas.state,
      stateSubscriptions,
      ...RepositoryRoutes.handlerSelectors(filters),
      ...RepositoryRoutes.routeSelectors(
        schemas,
        readiness,
        stateSubscriptions,
        filters,
        routes,
        idField,
      ),
    });
  },

  /**
   * Builds filter-aware selectors for Command reactions and Event handlers.
   *
   * @param filters Compiled Event filter groups.
   * @returns Functions that select matching handler registrations.
   */
  handlerSelectors(
    filters: RoutingFilters,
  ): Pick<RepositoryRouting, "commandReactions" | "eventReactors" | "eventSubscribers"> {
    return {
      commandReactions: (typeName, message, external) =>
        RepositoryRoutes.selectHandlers(filters.commandReactions, typeName, message, external),
      eventReactors: (typeName, message, external) =>
        RepositoryRoutes.selectHandlers(filters.eventReactors, typeName, message, external),
      eventSubscribers: (typeName, message, external) =>
        RepositoryRoutes.selectHandlers(filters.eventSubscribers, typeName, message, external),
    };
  },

  /**
   * Finds handlers matching message fields and Event origin.
   *
   * @typeParam Value Handler registration with origin metadata.
   * @param filters Compiled filter plans indexed by Event type.
   * @param typeName Source Event type name.
   * @param message Decoded Event message.
   * @param external Whether the Event has external origin.
   * @returns Matching handler registrations.
   */
  selectHandlers<Value extends { readonly handler: { readonly origin: "domestic" | "external" } }>(
    filters: ReadonlyMap<string, EventHandlerFilterPlan<Value>>,
    typeName: string,
    message: unknown,
    external: boolean,
  ): readonly Value[] {
    return RepositoryHandlers.forOrigin(
      filters.get(typeName)?.select(message) ?? Object.freeze([]),
      external,
    );
  },

  /**
   * Builds Command, Event, and state-update route functions.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Accepted signal and state schemas.
   * @param readiness Handler readiness lookups.
   * @param stateSubscriptions State subscribers by source type.
   * @param filters Compiled Event filter groups.
   * @param routes Custom route maps by schema.
   * @param idField Canonical target Entity ID field.
   * @returns Route functions for repository dispatch.
   */
  routeSelectors<Id>(
    schemas: RoutingSchemas,
    readiness: RoutingReadiness,
    stateSubscriptions: ReadonlyMap<string, RepositoryStateSubscribers>,
    filters: RoutingFilters,
    routes: RoutingMaps<Id>,
    idField: DescriptorFieldMetadata,
  ): Pick<RepositoryRouting<Id>, "routeCommand" | "routeEvent" | "routeStateUpdate"> {
    return {
      routeCommand: RepositoryRoutes.commandSelector(schemas, readiness, routes, idField),
      routeEvent: RepositoryRoutes.eventSelector(schemas, readiness, filters, routes, idField),
      routeStateUpdate: RepositoryRoutes.stateSelector(
        schemas,
        stateSubscriptions,
        routes,
        idField,
      ),
    };
  },

  /**
   * Builds a Command route function from readiness and custom declarations.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Accepted Command schemas.
   * @param readiness Command handler readiness lookup.
   * @param routes Custom route maps by schema.
   * @param idField Canonical target Entity ID field.
   * @returns Function that routes one Command.
   */
  commandSelector<Id>(
    schemas: RoutingSchemas,
    readiness: RoutingReadiness,
    routes: RoutingMaps<Id>,
    idField: DescriptorFieldMetadata,
  ): (command: Command) => RepositoryCommandRoute<Id> {
    return (command) =>
      RepositoryRoutes.routeCommand(
        command,
        readiness.command,
        schemas.command,
        idField,
        routes.command,
      );
  },

  /**
   * Builds an Event route function from readiness and custom declarations.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Accepted Event schemas.
   * @param readiness Event handler readiness lookup.
   * @param filters Compiled Event filter groups.
   * @param routes Custom route maps by schema.
   * @param idField Canonical target Entity ID field.
   * @returns Function that routes one Event.
   */
  eventSelector<Id>(
    schemas: RoutingSchemas,
    readiness: RoutingReadiness,
    filters: RoutingFilters,
    routes: RoutingMaps<Id>,
    idField: DescriptorFieldMetadata,
  ): (event: Event) => RepositoryEventRoute<Id> {
    return (event) =>
      RepositoryRoutes.routeEvent(
        event,
        readiness.event,
        filters.commandReactionMap,
        schemas.event,
        idField,
        routes.event,
      );
  },

  /**
   * Builds a state-update route function for Projection subscriptions.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Subscribed state schemas.
   * @param subscriptions State subscribers by source type.
   * @param routes Custom state-update routes by schema.
   * @param idField Canonical target Entity ID field.
   * @returns Function that routes one state-change Event.
   */
  stateSelector<Id>(
    schemas: RoutingSchemas,
    subscriptions: ReadonlyMap<string, RepositoryStateSubscribers>,
    routes: RoutingMaps<Id>,
    idField: DescriptorFieldMetadata,
  ): (event: Event) => RepositoryStateUpdateRoute<Id> | undefined {
    return (event) =>
      RepositoryRoutes.routeStateUpdate(event, schemas.state, subscriptions, idField, routes.state);
  },

  /**
   * Routes a Command to its registered assignee and target Entity ID.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param command Command envelope to route.
   * @param readiness Command handler readiness lookup.
   * @param schemas Accepted Command schemas.
   * @param targetIdField Canonical target Entity ID field.
   * @param commandRoutes Custom Command routes by schema.
   * @returns Deferred Command route for one target.
   */
  routeCommand<Id>(
    command: Command,
    readiness: CommandRegistrationReadinessLookup | undefined,
    schemas: readonly MessageSchema[],
    targetIdField: DescriptorFieldMetadata,
    commandRoutes: ReadonlyMap<MessageSchema, CommandRoute<Id>>,
  ): RepositoryCommandRoute<Id> {
    const message = command.message;
    if (message === undefined || message.typeUrl === "") {
      throw new Error("Repository command routing requires command.message.typeUrl.");
    }

    const schema = RepositoryRoutes.schemaForTypeUrl(schemas, message.typeUrl, "command");
    const assignee = readiness?.findCommandAssignee(schema.typeName);
    if (assignee === undefined) {
      throw new Error(`Repository command routing has no assignee for "${schema.typeName}".`);
    }

    const customRoute = commandRoutes.get(schema);
    const candidateId =
      customRoute === undefined
        ? RepositoryRoutes.readFirstFieldId(message, schema, "command")
        : RepositoryRoutes.callCommandRoute(customRoute, message, schema, command.context);

    return Object.freeze({
      entityId: RepositoryRoutes.readRouteId(candidateId, targetIdField, "command") as Id,
      messageFullTypeName: schema.typeName,
      invocation: "deferred",
    });
  },

  /**
   * Resolves custom Command routes for registered schemas.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Accepted Command schemas.
   * @param routing Captured Command route declarations.
   * @returns Custom Command routes by schema.
   */
  resolveCommandRoutes<Id>(
    schemas: readonly MessageSchema[],
    routing: RoutingDeclarationSnapshot<CommandRoute<Id>>,
  ): ReadonlyMap<MessageSchema, CommandRoute<Id>> {
    const routes = new Map<MessageSchema, CommandRoute<Id>>();
    RoutingDeclarations.validate(routing, schemas, "command");

    for (const schema of schemas) {
      const route = RoutingDeclarations.select(routing, schema);
      if (route !== undefined) routes.set(schema, route);
    }
    return routes;
  },

  /**
   * Calls a custom Command route with a decoded message and context.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param route Registered custom route.
   * @param message Packed Command payload.
   * @param schema Registered Command schema.
   * @param context Source Command context, when present.
   * @returns Candidate target Entity ID.
   */
  callCommandRoute<Id>(
    route: CommandRoute<Id>,
    message: NonNullable<Command["message"]>,
    schema: MessageSchema,
    context: Command["context"] | undefined,
  ): Id {
    const unpacked = AnyMessages.unpack(message, schema);
    if (unpacked === undefined) {
      throw new Error("Repository command routing requires a readable Command message.");
    }
    return route(unpacked, context ?? create(CommandContextSchema));
  },

  /**
   * Routes an Event to interested Entity IDs using custom or default routing.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param event Event envelope to route.
   * @param readiness Event handler readiness lookup.
   * @param commandReactions Command reactions by Event type.
   * @param schemas Accepted Event schemas.
   * @param targetIdField Canonical target Entity ID field.
   * @param eventRoutes Custom Event routes by schema.
   * @returns Deferred Event route with target IDs.
   */
  routeEvent<Id>(
    event: Event,
    readiness: EventRegistrationReadinessLookup | undefined,
    commandReactions: ReadonlyMap<
      string,
      readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[]
    >,
    schemas: readonly MessageSchema[],
    targetIdField: DescriptorFieldMetadata,
    eventRoutes: ReadonlyMap<MessageSchema, EventRoute<Id>>,
  ): RepositoryEventRoute<Id> {
    const message = event.message;
    if (message === undefined || message.typeUrl === "") {
      throw new Error("Repository event routing requires event.message.typeUrl.");
    }

    const schema = RepositoryRoutes.schemaForTypeUrl(schemas, message.typeUrl, "event");
    const hasReceiver =
      (commandReactions.get(schema.typeName)?.length ?? 0) > 0 ||
      (readiness?.findEventSubscribers(schema.typeName).length ?? 0) > 0 ||
      (readiness?.findEventReactors(schema.typeName).length ?? 0) > 0 ||
      (readiness?.findEventApplications(schema.typeName).length ?? 0) > 0;
    if (!hasReceiver) {
      throw new Error(`Repository event routing has no receiver for "${schema.typeName}".`);
    }

    const customRoute = eventRoutes.get(schema);
    if (customRoute !== undefined) {
      return Object.freeze({
        entityIds: RepositoryRoutes.callEventRoute(
          customRoute,
          message,
          schema,
          event.context,
          targetIdField,
        ),
        messageFullTypeName: schema.typeName,
        invocation: "deferred",
      });
    }

    const targetId = RepositoryRoutes.readEventEntityId(event, message, schema, targetIdField);

    return Object.freeze({
      entityIds: Object.freeze([targetId as Id]),
      messageFullTypeName: schema.typeName,
      invocation: "deferred",
    });
  },

  /**
   * Resolves custom Event routes for registered schemas.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Accepted Event schemas.
   * @param routing Captured Event route declarations.
   * @returns Custom Event routes by schema.
   */
  resolveEventRoutes<Id>(
    schemas: readonly MessageSchema[],
    routing: RoutingDeclarationSnapshot<EventRoute<Id>>,
  ): ReadonlyMap<MessageSchema, EventRoute<Id>> {
    const routes = new Map<MessageSchema, EventRoute<Id>>();
    RoutingDeclarations.validate(routing, schemas, "event");

    for (const schema of schemas) {
      const route = RoutingDeclarations.select(routing, schema);
      if (route !== undefined) routes.set(schema, route);
    }
    return routes;
  },

  /**
   * Groups state subscribers by source Entity type name.
   *
   * @param handlers Registered Entity handler metadata.
   * @returns Frozen subscriber lists indexed by state type.
   */
  stateSubscriptions(
    handlers: readonly EntityHandlersMetadata[],
  ): ReadonlyMap<string, readonly RegisteredHandlerMetadata<StateSubscriptionHandlerMetadata>[]> {
    const byType = new Map<string, RegisteredHandlerMetadata<StateSubscriptionHandlerMetadata>[]>();
    for (const entityHandlers of handlers) {
      for (const handler of entityHandlers.stateSubscriptions) {
        RepositoryHandlers.pushMapValue(
          byType,
          handler.messageFullTypeName,
          Object.freeze({
            entityHandlers,
            entityType: entityHandlers.entityType,
            entity: entityHandlers.entity,
            handler,
          }),
        );
      }
    }
    return new Map(
      [...byType].map(([typeName, subscriptions]) => [typeName, Object.freeze([...subscriptions])]),
    );
  },

  /**
   * Resolves state-update routes and checks default ID compatibility.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param schemas Subscribed source Entity state schemas.
   * @param routing Captured state-update route declarations.
   * @param targetIdField Canonical Projection ID field.
   * @returns Custom state-update routes by schema.
   */
  resolveStateRoutes<Id>(
    schemas: readonly DescriptorMessageSchema[],
    routing: RoutingDeclarationSnapshot<StateUpdateRoute<Id>>,
    targetIdField: DescriptorFieldMetadata,
  ): ReadonlyMap<DescriptorMessageSchema, StateUpdateRoute<Id>> {
    const routes = new Map<DescriptorMessageSchema, StateUpdateRoute<Id>>();
    RoutingDeclarations.validate(routing, schemas, "state-update");
    for (const schema of schemas) {
      const route = RoutingDeclarations.select(routing, schema);
      if (route !== undefined) routes.set(schema, route);
      else if (
        !schema.fields.some((field) =>
          RepositoryRoutes.compatibleStateIdField(field, targetIdField),
        )
      ) {
        throw new Error(
          `Repository state-update routing has no compatible field in "${schema.typeName}".`,
        );
      }
    }
    return routes;
  },

  /**
   * Routes a System Event state update to interested Projections.
   *
   * @typeParam Id Projection identifier type.
   * @param event Entity state-change System Event.
   * @param schemas Subscribed source state schemas.
   * @param subscriptions State subscribers by source type.
   * @param targetIdField Canonical Projection ID field.
   * @param routes Custom state-update routes by schema.
   * @returns Route and decoded state, or `undefined` when uninterested.
   */
  routeStateUpdate<Id>(
    event: Event,
    schemas: readonly DescriptorMessageSchema[],
    subscriptions: ReadonlyMap<
      string,
      readonly RegisteredHandlerMetadata<StateSubscriptionHandlerMetadata>[]
    >,
    targetIdField: DescriptorFieldMetadata,
    routes: ReadonlyMap<DescriptorMessageSchema, StateUpdateRoute<Id>>,
  ): RepositoryStateUpdateRoute<Id> | undefined {
    const update = RepositoryRoutes.decodeStateUpdate(
      event,
      schemas,
      "Repository state-update routing",
    );
    const candidates = subscriptions.get(update?.schema.typeName ?? "") ?? [];
    const interested = Object.freeze(
      candidates.filter(
        (subscriber) =>
          (subscriber.handler.origin === "external") === (event.context?.external === true),
      ),
    );
    if (update === undefined || interested.length === 0) {
      return undefined;
    }
    const { schema, state } = update;
    const custom = routes.get(schema);
    const candidateIds =
      custom === undefined
        ? [RepositoryRoutes.firstCompatibleId(state, schema, targetIdField, "state update") as Id]
        : RepositoryRoutes.callStateUpdateRoute(custom, state, event.context, targetIdField);
    return Object.freeze({
      entityIds: Object.freeze([...candidateIds]),
      messageFullTypeName: schema.typeName,
      state,
      subscribers: interested,
      invocation: "deferred",
    });
  },

  /**
   * Decodes the new Entity state carried by a state-change System Event.
   *
   * @param event Candidate System Event.
   * @param schemas Subscribed source state schemas.
   * @param operation Operation name for diagnostics.
   * @returns Decoded schema and state, or `undefined` for unrelated Events.
   */
  decodeStateUpdate(
    event: Event,
    schemas: readonly DescriptorMessageSchema[],
    operation: string,
  ): { readonly schema: DescriptorMessageSchema; readonly state: Message } | undefined {
    const message = event.message;
    if (message?.typeUrl !== TypeUrls.derive(EntityLog.EntityStateChangedSchema)) {
      throw new Error(`${operation} requires an EntityStateChanged System event.`);
    }
    const changed = AnyMessages.unpack(message, EntityLog.EntityStateChangedSchema);
    const packedState = changed?.newState;
    if (packedState === undefined || packedState.typeUrl === "") {
      throw new Error(`${operation} requires EntityStateChanged.newState.`);
    }
    const schema = schemas.find((candidate) => TypeUrls.derive(candidate) === packedState.typeUrl);
    if (schema === undefined) return undefined;
    const state = AnyMessages.unpack(packedState, schema);
    if (state === undefined) throw new Error(`${operation} requires a readable Entity state.`);
    return Object.freeze({ schema, state });
  },

  /**
   * Calls a custom state-update route and validates its target IDs.
   *
   * @typeParam Id Projection identifier type.
   * @param route Registered state-update route.
   * @param state Decoded source Entity state.
   * @param context Source Event context, when present.
   * @param targetIdField Canonical Projection ID field.
   * @returns Validated Projection target IDs.
   */
  callStateUpdateRoute<Id>(
    route: StateUpdateRoute<Id>,
    state: Message,
    context: Event["context"] | undefined,
    targetIdField: DescriptorFieldMetadata,
  ): readonly Id[] {
    const candidates = route(state, context ?? create(EventContextSchema));
    if (!Array.isArray(candidates))
      throw new Error("Repository state-update routing requires an array of Entity IDs.");
    if (candidates.length > 1_000)
      throw new Error("Repository state-update routing accepts at most 1,000 Entity IDs.");
    const unique = new Map<string, Id>();
    for (const candidate of candidates) {
      const id = RepositoryRoutes.readRouteId(candidate, targetIdField, "state update") as Id;
      const key = InboxTargets.key(InboxMessages.inboxTargetId(id, targetIdField));
      if (!unique.has(key)) unique.set(key, structuredClone(id));
    }
    return Object.freeze([...unique.values()]);
  },

  /**
   * Calls a custom Event route and validates its target IDs.
   *
   * @typeParam Id Repository Entity identifier type.
   * @param route Registered custom Event route.
   * @param message Packed Event payload.
   * @param schema Registered Event schema.
   * @param context Source Event context, when present.
   * @param targetIdField Canonical target Entity ID field.
   * @returns Validated target Entity IDs.
   */
  callEventRoute<Id>(
    route: EventRoute<Id>,
    message: NonNullable<Event["message"]>,
    schema: MessageSchema,
    context: Event["context"] | undefined,
    targetIdField: DescriptorFieldMetadata,
  ): readonly Id[] {
    const unpacked = AnyMessages.unpack(message, schema);
    if (unpacked === undefined) {
      throw new Error("Repository event routing requires a readable Event message.");
    }
    const candidates = route(unpacked, context ?? create(EventContextSchema));
    if (!Array.isArray(candidates)) {
      throw new Error("Repository event routing requires an array of Entity IDs.");
    }
    if (candidates.length > 1_000) {
      throw new Error("Repository event routing accepts at most 1,000 Entity IDs.");
    }

    const unique = new Map<string, Id>();
    for (const candidate of candidates) {
      const id = RepositoryRoutes.readRouteId(candidate, targetIdField, "event") as Id;
      const key = InboxTargets.key(InboxMessages.inboxTargetId(id, targetIdField));
      if (!unique.has(key)) unique.set(key, structuredClone(id));
    }
    return Object.freeze([...unique.values()]);
  },

  /**
   * Finds a registered message schema by its type URL.
   *
   * @param schemas Accepted message schemas.
   * @param typeUrl Packed message type URL.
   * @param signalKind Signal name for diagnostics.
   * @returns Matching generated schema.
   */
  schemaForTypeUrl(
    schemas: readonly MessageSchema[],
    typeUrl: string,
    signalKind: "command" | "event" | "state update",
  ): MessageSchema {
    const schema = schemas.find((candidate) => TypeUrls.derive(candidate) === typeUrl);

    if (schema === undefined) {
      throw new Error(`Repository ${signalKind} routing has no schema for "${typeUrl}".`);
    }

    return schema;
  },

  /**
   * Reads the default target ID from a decoded signal's first field.
   *
   * @param message Packed Command or Event payload.
   * @param schema Generated payload schema.
   * @param signalKind Signal name for validation.
   * @returns Nonempty first-field value.
   */
  readFirstFieldId(
    message: NonNullable<Command["message"]>,
    schema: MessageSchema,
    signalKind: "command" | "event",
  ): unknown {
    const unpacked = AnyMessages.unpack(message, schema);
    const firstField = schema.fields[0];

    if (unpacked === undefined || firstField === undefined) {
      throw new Error(`Repository ${signalKind} routing requires a readable first field.`);
    }

    if (firstField.fieldKind === "list" || firstField.fieldKind === "map") {
      throw new Error(`Repository ${signalKind} routing requires a singular non-map first field.`);
    }

    const value = (unpacked as Record<string, unknown>)[firstField.localName];
    if (value === undefined || value === null || RepositoryRoutes.isBlankRouteId(value)) {
      throw new Error(`Repository ${signalKind} routing requires a non-empty first field.`);
    }
    if (signalKind === "command" && (value === 0 || value === false)) {
      throw new Error("Repository command routing requires a non-default first field.");
    }

    return value;
  },

  /**
   * Reads the first state field compatible with a Projection target ID.
   *
   * @param state Decoded source Entity state.
   * @param schema Source state schema.
   * @param targetIdField Canonical Projection ID field.
   * @param signalKind State-update name for validation.
   * @returns Validated Projection target ID.
   */
  firstCompatibleId(
    state: Message,
    schema: MessageSchema,
    targetIdField: DescriptorFieldMetadata,
    signalKind: "state update",
  ): unknown {
    const field = schema.fields.find((candidate) =>
      RepositoryRoutes.compatibleStateIdField(candidate, targetIdField),
    );
    if (field === undefined)
      throw new Error("Repository state-update routing requires a compatible state field.");
    const value = (state as Record<string, unknown>)[field.localName];
    return RepositoryRoutes.readRouteId(value, targetIdField, signalKind);
  },

  /**
   * Checks whether a source state field can route to the target ID type.
   *
   * @param field Candidate source state field.
   * @param targetIdField Canonical target Entity ID field.
   * @returns Whether message or primitive ID types match.
   */
  compatibleStateIdField(
    field: MessageSchema["fields"][number],
    targetIdField: DescriptorFieldMetadata,
  ): boolean {
    if (field.fieldKind === "list" || field.fieldKind === "map") return false;
    const target = targetIdField.descriptor;
    if (field.fieldKind === "message" && target.fieldKind === "message")
      return field.message.typeName === target.message.typeName;
    if (field.fieldKind !== "scalar" || target.fieldKind !== "scalar") return false;
    try {
      return (
        RepositoryRoutes.primitiveIdentifierType(field.scalar) ===
        RepositoryRoutes.primitiveIdentifierType(target.scalar)
      );
    } catch {
      return false;
    }
  },

  /**
   * Checks whether a candidate route ID is blank text.
   *
   * @param value Candidate identifier value.
   * @returns Whether the value is an empty or whitespace string.
   */
  isBlankRouteId(value: unknown): boolean {
    const id = PrimitiveIds.readFinite(value);

    return typeof id === "string" && id.trim().length === 0;
  },

  /**
   * Reads a compatible producer ID or the Event payload's first-field ID.
   *
   * @param event Source Event envelope.
   * @param message Packed Event payload.
   * @param schema Generated Event schema.
   * @param targetIdField Canonical target Entity ID field.
   * @returns Validated target Entity ID.
   */
  readEventEntityId(
    event: Event,
    message: NonNullable<Event["message"]>,
    schema: MessageSchema,
    targetIdField: DescriptorFieldMetadata,
  ): unknown {
    const producerId = event.context?.producerId;
    if (producerId === undefined || producerId.typeUrl.trim().length === 0) {
      throw new Error("Repository event routing requires a producer ID.");
    }
    const compatibleProducer = RepositoryRoutes.compatibleProducerId(producerId, targetIdField);
    if (compatibleProducer.compatible) {
      return RepositoryRoutes.readRouteId(compatibleProducer.id, targetIdField, "event");
    }
    return RepositoryRoutes.readRouteId(
      RepositoryRoutes.readFirstFieldId(message, schema, "event"),
      targetIdField,
      "event",
    );
  },

  /**
   * Unpacks a producer ID when its type matches the target ID field.
   *
   * @param producerId Packed source producer identifier.
   * @param targetIdField Canonical target Entity ID field.
   * @returns Compatible decoded ID, or an incompatible marker.
   */
  compatibleProducerId(
    producerId: Any,
    targetIdField: DescriptorFieldMetadata,
  ): { readonly compatible: false } | { readonly compatible: true; readonly id: unknown } {
    const descriptor = targetIdField.descriptor;
    if (descriptor.fieldKind === "message") {
      const schema = descriptor.message as MessageSchema;
      if (producerId.typeUrl !== TypeUrls.derive(schema)) return { compatible: false };
      const id = Identifiers.unpack(schema, producerId);
      if (id === undefined) {
        throw new Error("Repository event routing requires a readable compatible producer ID.");
      }
      return { compatible: true, id };
    }
    if (descriptor.fieldKind !== "scalar") {
      throw new Error("Repository event routing requires a scalar or message-valued ID.");
    }
    const type = RepositoryRoutes.primitiveIdentifierType(descriptor.scalar);
    const schema =
      type === "string"
        ? StringValueSchema
        : type === "int32"
          ? Int32ValueSchema
          : Int64ValueSchema;
    if (producerId.typeUrl !== TypeUrls.derive(schema)) return { compatible: false };
    const id =
      type === "string"
        ? Identifiers.unpack("string", producerId)
        : type === "int32"
          ? Identifiers.unpack("int32", producerId)
          : Identifiers.unpack("int64", producerId);
    if (id === undefined) {
      throw new Error("Repository event routing requires a readable compatible producer ID.");
    }
    return { compatible: true, id };
  },

  /**
   * Maps a supported Protobuf scalar to its primitive identifier family.
   *
   * @param type Protobuf scalar field type.
   * @returns String, 32-bit integer, or 64-bit integer ID family.
   */
  primitiveIdentifierType(type: ScalarType): "string" | "int32" | "int64" {
    switch (type) {
      case ScalarType.STRING:
        return "string";
      case ScalarType.INT32:
      case ScalarType.SINT32:
      case ScalarType.SFIXED32:
        return "int32";
      case ScalarType.INT64:
      case ScalarType.SINT64:
      case ScalarType.SFIXED64:
        return "int64";
      default:
        throw new Error("Repository event routing requires a supported Entity ID type.");
    }
  },

  /**
   * Validates a candidate target ID against the Entity state ID field.
   *
   * @param value Candidate identifier.
   * @param targetIdField Canonical target Entity ID field.
   * @param signalKind Signal name for diagnostics.
   * @returns Validated message or primitive identifier.
   */
  readRouteId(
    value: unknown,
    targetIdField: DescriptorFieldMetadata,
    signalKind: "command" | "event" | "state update",
  ): unknown {
    const descriptor = targetIdField.descriptor;
    if (descriptor.fieldKind === "message") {
      return RepositoryRoutes.readMessageRouteId(
        value,
        descriptor.message as MessageSchema,
        signalKind,
      );
    }
    if (descriptor.fieldKind === "scalar") {
      return RepositoryRoutes.readPrimitiveRouteId(value, descriptor.scalar, signalKind);
    }
    throw new Error(`Repository ${signalKind} routing requires a scalar or message-valued ID.`);
  },

  /**
   * Validates a generated message-valued target ID.
   *
   * @param value Candidate identifier.
   * @param targetSchema Generated target ID schema.
   * @param signalKind Signal name for diagnostics.
   * @returns Validated and encodable ID message.
   */
  readMessageRouteId(
    value: unknown,
    targetSchema: MessageSchema,
    signalKind: "command" | "event" | "state update",
  ): Message {
    const id = MessageIds.read(value);
    if (id === undefined) {
      throw new Error(`Repository ${signalKind} routing requires a "${targetSchema.typeName}" ID.`);
    }
    if (id.$typeName !== targetSchema.typeName) {
      throw new Error(`Repository ${signalKind} routing requires a "${targetSchema.typeName}" ID.`);
    }
    try {
      Validate.check(targetSchema, id);
    } catch (error) {
      throw new Error(
        `Repository ${signalKind} routing requires a valid "${targetSchema.typeName}" ID.`,
        { cause: error },
      );
    }
    try {
      Identifiers.pack(targetSchema, id as never);
    } catch (error) {
      throw new Error(
        `Repository ${signalKind} routing requires an encodable "${targetSchema.typeName}" ID.`,
        { cause: error },
      );
    }

    return id;
  },

  /**
   * Validates a primitive target ID against a Protobuf scalar type.
   *
   * @param value Candidate identifier.
   * @param targetType Canonical ID field scalar type.
   * @param signalKind Signal name for diagnostics.
   * @returns Compatible string, number, or bigint ID.
   */
  readPrimitiveRouteId(
    value: unknown,
    targetType: ScalarType,
    signalKind: "command" | "event" | "state update",
  ): string | number | bigint {
    const id = RepositoryRoutes.readCompatiblePrimitiveId(value, targetType);
    if (id === undefined) {
      throw new Error(
        `Repository ${signalKind} routing requires an ID compatible with the Entity state.`,
      );
    }

    return id;
  },

  /**
   * Reads a nonblank primitive ID within the target scalar's range.
   *
   * @param value Candidate identifier.
   * @param targetType Canonical ID field scalar type.
   * @returns Compatible primitive ID, or `undefined`.
   */
  readCompatiblePrimitiveId(
    value: unknown,
    targetType: ScalarType,
  ): string | number | bigint | undefined {
    switch (targetType) {
      case ScalarType.STRING:
        return typeof value === "string" && value.trim().length > 0 ? value : undefined;
      case ScalarType.INT32:
      case ScalarType.SINT32:
      case ScalarType.SFIXED32:
        return typeof value === "number" &&
          Number.isInteger(value) &&
          value >= -(2 ** 31) &&
          value < 2 ** 31
          ? value
          : undefined;
      case ScalarType.INT64:
      case ScalarType.SINT64:
      case ScalarType.SFIXED64:
        return typeof value === "bigint" && value >= -(1n << 63n) && value < 1n << 63n
          ? value
          : undefined;
      default:
        return undefined;
    }
  },
};
Object.freeze(RepositoryRoutes);

/**
 * Internal repository storage operations.
 */
const RepositoryStorage = {
  /**
   * Opens Entity storage and an atomic commit port from a storage factory.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Generated Entity state type.
   * @param factory Provider storage factory.
   * @param input Entity storage location and schema.
   * @returns Storage ports closed together by one handle.
   */
  openEntityStorage<I, S extends Message>(
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): RepositoryEntityStorage<I, S> {
    const candidate = factory as StorageFactory & Partial<EntityStorageFactory>;
    if (candidate.createEntityStorage === undefined) {
      throw new Error(
        "StorageFactory does not provide the required atomic Entity commit storage seam.",
      );
    }
    const entity = candidate.createEntityStorage(input);
    const commits = EntityCommitStorageFactories.create(factory, input);
    return {
      ...entity,
      commits,
      close: () => {
        commits.close();
        entity.close();
      },
    };
  },

  /**
   * Returns one shared Entity storage handle per context and state type.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Generated Entity state type.
   * @param repository Repository tracking open handles.
   * @param factory Provider storage factory.
   * @param input Entity storage location and schema.
   * @returns Shared Entity storage handle.
   */
  openRepositoryEntityStorage<I, S extends Message>(
    repository: RepositoryView,
    factory: StorageFactory,
    input: EntityStorageInput<I, S>,
  ): RepositoryEntityStorage<I, S> {
    const handle = RepositoryStorage.openEntityStorage(factory, input);
    const key = JSON.stringify({ context: input.context, state: input.sourceType.typeName });
    let handles = repositoryEntityHandles.get(repository);
    if (handles === undefined) {
      handles = new Map();
      repositoryEntityHandles.set(repository, handles);
    }
    const existing = handles.get(key);
    if (existing !== undefined) {
      handle.close();
      return existing as RepositoryEntityStorage<I, S>;
    }
    handles.set(key, handle);
    return handle;
  },

  /**
   * Builds Entity storage input with configured state and Event history flags.
   *
   * @param repository Repository Entity registration.
   * @param context Tenant-aware storage context.
   * @returns Entity storage description for the provider.
   */
  entityStorageInput(
    repository: RepositoryView,
    context: StorageContext,
  ): EntityStorageInput<unknown, Message> {
    const descriptor = entityStorageDescriptor(
      context,
      SpecScanner.scan(repository.entityType),
    ) as EntityStorageInput<unknown, Message>;
    const history = RepositoryStorage.historyConfiguration(repository);
    return {
      ...descriptor,
      stateHistory: history.stateHistory,
      eventHistory: repository.entityFamily === "aggregate" || history.processManagerEventHistory,
    };
  },

  /**
   * Validates history and duplicate-dispatch options for an Entity family.
   *
   * @param options Repository history and guard settings.
   * @param family Aggregate, Projection, or Process Manager family.
   * @returns Normalized history and guard configuration.
   */
  readHistoryConfiguration(
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
  },

  /**
   * Reads history and guard settings captured for a repository.
   *
   * @param repository Repository to inspect.
   * @returns Its validated configuration.
   */
  historyConfiguration(repository: RepositoryView): RepositoryHistoryConfiguration {
    const configuration = repositoryHistoryConfigurations.get(repository);
    if (configuration === undefined)
      throw new Error("Repository history configuration is unavailable.");
    return configuration;
  },
};
Object.freeze(RepositoryStorage);

/**
 * Internal repository history internals operations.
 */
const RepositoryHistoryInternals = {
  /**
   * Binds state and Event history readers to one restored Entity instance.
   *
   * @param entity Instance receiving the history accessors.
   * @param storage Entity storage used for reads and maintenance.
   * @param entityId Identifier used to select history records.
   * @param schema Schema used to unpack state records.
   */
  bindEntityHistory(
    entity: object,
    storage: ReturnType<EntityStorageFactory["createEntityStorage"]>,
    entityId: unknown,
    schema: DescriptorMessageSchema,
  ): void {
    const stateCache = RepositoryHistoryInternals.createHistoryCache(
      (depth, startingFromVersion) => storage.states.backward(entityId, depth, startingFromVersion),
      (record) => BigInt(EntityRecords.unpack(schema, record).versionMessage.number),
      { requireDescendingVersions: true },
    );
    entityStateHistoryCaches.set(entity, stateCache);
    const eventCache = RepositoryHistoryInternals.createHistoryCache(
      (depth, startingFromVersion) => storage.events.backward(entityId, depth, startingFromVersion),
      (event) => RepositorySignals.readEventVersion(event),
      { cacheCompleteVersionGroups: true },
    );
    entityHistoryAccess.bind(entity, {
      stateAt: async (time) =>
        RepositoryHistoryInternals.cloneHistoryState(await storage.states.stateAt(entityId, time)),
      states: async (depth) =>
        RepositoryHistoryInternals.freezeHistoryStates(
          (await stateCache.read(depth)).map(
            (record) => EntityRecords.unpack(schema, record).state,
          ),
        ),
      events: async (depth) =>
        RepositoryHistoryInternals.freezeHistoryEvents(await eventCache.read(depth)),
      stateMaintenance: storage.states,
      eventMaintenance: storage.events,
    });
  },

  /**
   * Creates a history cache that serializes reads and extends prior results.
   *
   * @typeParam T State-record or Event type retained by the cache.
   * @param load Reads a backward page, optionally continuing from a version.
   * @param versionOf Reads the version used to continue a page.
   * @param options State ordering and complete Event-group cache rules.
   * @returns Read and clear operations for the new cache.
   * @internal Shared repository history-cache implementation, exercised by repository tests.
   */
  createHistoryCache<T>(
    load: (depth: number, startingFromVersion?: bigint) => Promise<readonly T[]>,
    versionOf: (entry: T) => bigint | undefined,
    options: {
      readonly requireDescendingVersions?: boolean;
      readonly cacheCompleteVersionGroups?: boolean;
    } = {},
  ): {
    readonly read: (depth: number) => Promise<readonly T[]>;
    readonly clear: () => void;
  } {
    return new RepositoryHistoryCache(load, versionOf, options).api();
  },

  /**
   * Copies a historical state and freezes the returned message object.
   *
   * @param state Historical state, absent when no record matched.
   * @returns An independent state copy, or undefined.
   */
  cloneHistoryState(state: Message | undefined): Message | undefined {
    return state === undefined ? undefined : Object.freeze(structuredClone(state));
  },

  /**
   * Copies historical states and freezes their outer objects and list.
   *
   * @param states Historical states read from storage.
   * @returns A frozen list of independent state copies.
   */
  freezeHistoryStates(states: readonly Message[]): readonly Message[] {
    return Object.freeze(states.map((state) => Object.freeze(structuredClone(state))));
  },

  /**
   * Copies historical Events and freezes their outer objects and list.
   *
   * @param events Historical Events read from storage.
   * @returns A frozen list of independent Event copies.
   */
  freezeHistoryEvents(events: readonly Event[]): readonly Event[] {
    return Object.freeze(events.map((event) => Object.freeze(clone(EventSchema, event))));
  },
};
Object.freeze(RepositoryHistoryInternals);

/**
 * Reuses backward history pages during the lifetime of a restored Entity.
 *
 * @typeParam T State-record or Event type returned by the history reader.
 */
class RepositoryHistoryCache<T> {
  readonly #load: (depth: number, startingFromVersion?: bigint) => Promise<readonly T[]>;

  readonly #versionOf: (entry: T) => bigint | undefined;

  readonly #requireDescendingVersions: boolean;

  readonly #cacheCompleteVersionGroups: boolean;

  #entries: readonly T[] = Object.freeze([]);

  #exhausted = false;

  #continuation = Promise.resolve();

  #nextVersion: bigint | undefined;

  #newestVersion: bigint | undefined;

  #generation = 0;

  /**
   * Creates an empty cache with the supplied history paging rules.
   *
   * @param load Reads a backward page, optionally continuing from a version.
   * @param versionOf Extracts the continuation version from a history entry.
   * @param options State ordering and complete Event-group cache rules.
   */
  constructor(
    load: (depth: number, startingFromVersion?: bigint) => Promise<readonly T[]>,
    versionOf: (entry: T) => bigint | undefined,
    options: {
      readonly requireDescendingVersions?: boolean;
      readonly cacheCompleteVersionGroups?: boolean;
    },
  ) {
    this.#load = load;
    this.#versionOf = versionOf;
    this.#requireDescendingVersions = options.requireDescendingVersions ?? false;
    this.#cacheCompleteVersionGroups = options.cacheCompleteVersionGroups ?? false;
  }

  /**
   * Exposes bound read and clear callbacks without exposing cache fields.
   *
   * @returns The operations used by Entity history accessors.
   */
  api(): { readonly read: (depth: number) => Promise<readonly T[]>; readonly clear: () => void } {
    return Object.freeze({
      read: (depth) => this.read(depth),
      clear: () => {
        this.clear();
      },
    });
  }

  /**
   * Clears cached entries and prevents pending reads from restoring stale pages.
   */
  clear(): void {
    this.#generation += 1;
    this.#entries = Object.freeze([]);
    this.#exhausted = false;
    this.#nextVersion = undefined;
    this.#newestVersion = undefined;
  }

  /**
   * Reads up to the requested number of entries, extending cached history as needed.
   *
   * @param depth Maximum number of entries to return, newest first.
   * @returns Cached and newly loaded entries, limited to the requested depth.
   */
  async read(depth: number): Promise<readonly T[]> {
    await this.#continuation;
    if (this.#isSatisfied(depth)) return this.#entries.slice(0, depth);
    let result: readonly T[] | undefined;
    const next = this.#continuation.then(async () => {
      if (this.#isSatisfied(depth)) return;
      result = await this.#extend(depth);
    });
    // spine-log-boundary: server.repository_history_prefetch
    this.#continuation = next.catch(() => undefined);
    await next;
    return result ?? this.#entries.slice(0, depth);
  }

  /**
   * Checks whether cached entries or known exhaustion satisfy a read.
   *
   * @param depth Requested number of entries.
   * @returns True when another storage read is unnecessary.
   */
  #isSatisfied(depth: number): boolean {
    return this.#entries.length >= depth || this.#exhausted;
  }

  /**
   * Loads the missing entries using the configured continuation rule.
   *
   * @param depth Total number of entries requested by the caller.
   * @returns A result containing uncached partial groups, or undefined to use the cache.
   */
  async #extend(depth: number): Promise<readonly T[] | undefined> {
    const generation = this.#generation;
    const requested = Math.max(1, depth - this.#entries.length);
    return this.#cacheCompleteVersionGroups
      ? this.#extendCompleteGroups(depth, requested, generation)
      : this.#extendVersioned(depth, requested, generation);
  }

  /**
   * Loads an extra entry so a partial terminal version group is not cached.
   *
   * @param depth Total number of entries requested by the caller.
   * @param requested Number of missing entries, excluding the look-ahead entry.
   * @param generation Cache generation at the start of this read.
   * @returns Requested entries, or undefined if the cache was cleared during loading.
   */
  async #extendCompleteGroups(
    depth: number,
    requested: number,
    generation: number,
  ): Promise<readonly T[] | undefined> {
    const loaded = await this.#load(requested + 1, this.#nextVersion);
    if (generation !== this.#generation) return undefined;
    const combined = [...this.#entries, ...loaded];
    const cacheable = this.#completeGroups(loaded, requested);
    this.#append(cacheable);
    this.#exhausted = loaded.length < requested + 1;
    return Object.freeze(combined.slice(0, depth));
  }

  /**
   * Removes a terminal version group when the page may contain only part of it.
   *
   * @param loaded Page including the look-ahead entry when available.
   * @param requested Number requested before adding the look-ahead entry.
   * @returns Entries whose version groups are complete in this page.
   */
  #completeGroups(loaded: readonly T[], requested: number): readonly T[] {
    const terminal = loaded.at(-1);
    const terminalVersion = terminal === undefined ? undefined : this.#versionOf(terminal);
    const length =
      loaded.length < requested + 1 || terminalVersion === undefined
        ? loaded.length
        : loaded.findIndex((entry) => this.#versionOf(entry) === terminalVersion);
    return loaded.slice(0, Math.max(0, length));
  }

  /**
   * Loads more version-ordered history, refreshing or clearing invalid continuations.
   *
   * @param depth Total number of entries requested by the caller.
   * @param requested Number of missing entries to load.
   * @param generation Cache generation at the start of this read.
   * @returns Undefined because accepted entries are read from the updated cache.
   */
  async #extendVersioned(depth: number, requested: number, generation: number): Promise<undefined> {
    const loaded = await this.#load(requested, this.#nextVersion);
    if (generation !== this.#generation) return undefined;
    const latest = loaded[0] === undefined ? undefined : this.#versionOf(loaded[0]);
    if (this.#hasInvalidPage(loaded)) {
      this.clear();
      return undefined;
    }
    if (this.#hasNewerPage(latest)) return this.#refresh(depth, generation);
    if (this.#hasInvalidContinuation(latest)) {
      this.clear();
      return undefined;
    }
    this.#append(loaded);
    this.#newestVersion ??= latest;
    this.#exhausted = loaded.length < requested;
    return undefined;
  }

  /**
   * Checks strict descending versions when required for state history.
   *
   * @param loaded Page to inspect for repeated or increasing versions.
   * @returns True when two readable adjacent versions violate the ordering rule.
   */
  #hasInvalidPage(loaded: readonly T[]): boolean {
    if (!this.#requireDescendingVersions) return false;
    for (let index = 1; index < loaded.length; index += 1) {
      const newer = this.#versionOf(loaded[index - 1] as T);
      const older = this.#versionOf(loaded[index] as T);
      if (newer !== undefined && older !== undefined && newer <= older) return true;
    }
    return false;
  }

  /**
   * Checks whether a continuation page is newer than the newest cached entry.
   *
   * @param latest First version in the loaded page, if readable.
   * @returns True when the cache must restart from the newest history.
   */
  #hasNewerPage(latest: bigint | undefined): boolean {
    return (
      this.#newestVersion !== undefined &&
      latest !== undefined &&
      latest > this.#newestVersion &&
      this.#nextVersion !== undefined
    );
  }

  /**
   * Checks that a state-history continuation starts below the oldest cached version.
   *
   * @param latest First version in the loaded page, if readable.
   * @returns True when the continuation overlaps or precedes the cached boundary.
   */
  #hasInvalidContinuation(latest: bigint | undefined): boolean {
    const oldest = this.#entries.at(-1);
    const oldestVersion = oldest === undefined ? undefined : this.#versionOf(oldest);
    return (
      this.#requireDescendingVersions &&
      oldestVersion !== undefined &&
      latest !== undefined &&
      latest >= oldestVersion
    );
  }

  /**
   * Reads history again from the newest entry after detecting a newer page.
   *
   * @param depth Maximum number of entries to reload.
   * @param generation Cache generation before this refresh clears the cache.
   * @returns Undefined because accepted entries are stored in the cache.
   */
  async #refresh(depth: number, generation: number): Promise<undefined> {
    this.clear();
    const refreshed = await this.#load(depth);
    if (generation + 1 !== this.#generation) return undefined;
    if (this.#hasInvalidPage(refreshed)) return undefined;
    this.#append(refreshed);
    this.#newestVersion = refreshed[0] === undefined ? undefined : this.#versionOf(refreshed[0]);
    this.#exhausted = refreshed.length < depth;
    return undefined;
  }

  /**
   * Adds an accepted page and records its oldest readable version.
   *
   * @param loaded Entries to add in storage order.
   */
  #append(loaded: readonly T[]): void {
    this.#entries = Object.freeze([...this.#entries, ...loaded]);
    const last = loaded.at(-1);
    this.#nextVersion = last === undefined ? this.#nextVersion : this.#versionOf(last);
  }
}

/**
 * Serializes guarded Event delivery and remembers recent completed dispatches.
 */
const DispatchGuards = {
  /**
   * Dispatches an Event with duplicate checks when the repository enables them.
   *
   * @param repository Repository receiving the Event.
   * @param runtime Storage and tenant context for the dispatch.
   * @param event Event being delivered.
   * @param entityId Target Entity identifier.
   * @param dispatch Operation to run unless a completed delivery is found.
   * @returns Completion of the dispatch or duplicate check.
   */
  async guardedEntityEventDispatch(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    event: Event,
    entityId: unknown,
    dispatch: () => Promise<void>,
  ): Promise<void> {
    const depth = RepositoryStorage.historyConfiguration(repository).dispatchGuardDepth;
    const eventId = event.id?.value;
    if (depth === undefined || eventId === undefined || eventId.length === 0) return dispatch();
    if (entityId === undefined) return dispatch();
    const key = DispatchGuards.canonicalEntityIdKey(repository, entityId);
    const journalEventId = DispatchGuards.guardedJournalEventId(eventId, key);
    const { guard, guards } = DispatchGuards.guardLane(repository, key);
    DispatchGuards.touchGuardLane(guards, key);
    guard.active += 1;
    return DispatchGuards.scheduleDispatch(
      repository,
      runtime,
      event,
      entityId,
      eventId,
      journalEventId,
      depth,
      guard,
      guards,
      dispatch,
    );
  },

  /**
   * Queues a guarded dispatch after earlier work for the same Entity.
   *
   * @param repository Repository receiving the Event.
   * @param runtime Storage and tenant context for the dispatch.
   * @param event Event being delivered.
   * @param entityId Target Entity identifier.
   * @param eventId Original Event identifier used by the in-memory check.
   * @param journalEventId Target-specific identifier used by stored diagnostic Events.
   * @param depth Maximum completed identifiers and inactive Entity queues to retain.
   * @param guard Queue and recent completion records for this Entity.
   * @param guards Repository's collection of Entity queues.
   * @param dispatch Operation to run unless a completed delivery is found.
   * @returns Completion of this queued operation, retaining its failure for the caller.
   */
  scheduleDispatch(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    event: Event,
    entityId: unknown,
    eventId: string,
    journalEventId: string,
    depth: number,
    guard: DispatchGuard,
    guards: RepositoryDispatchGuards,
    dispatch: () => Promise<void>,
  ): Promise<void> {
    const next = guard.chain.then(() =>
      DispatchGuards.dispatchOnce(
        repository,
        runtime,
        event,
        entityId,
        eventId,
        journalEventId,
        depth,
        guard,
        dispatch,
      ),
    );
    // spine-log-boundary: server.repository_dispatch_guard
    guard.chain = next
      .catch(() => undefined)
      .finally(() => {
        guard.active -= 1;
        DispatchGuards.trimGuardLanes(guards, depth);
      });
    return next;
  },

  /**
   * Gets or creates the serialized dispatch queue for one Entity key.
   *
   * @param repository Repository whose queues are being accessed.
   * @param key Canonical target Entity key.
   * @returns The Entity queue and the repository collection containing it.
   */
  guardLane(
    repository: RepositoryView,
    key: string,
  ): { guard: DispatchGuard; guards: RepositoryDispatchGuards } {
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
    return { guard, guards };
  },

  /**
   * Dispatches an Event unless memory or retained diagnostic Events show completion.
   *
   * @param repository Repository receiving the Event.
   * @param runtime Storage and tenant context for the dispatch.
   * @param event Event being delivered.
   * @param entityId Target Entity identifier.
   * @param eventId Original identifier used for recent in-memory completions.
   * @param journalEventId Target-specific identifier to find in storage.
   * @param depth Maximum retained Events to inspect and completions to remember.
   * @param guard Recent completion records for this Entity.
   * @param dispatch Operation to run when neither check finds a completed delivery.
   * @returns Completion of the duplicate check and any required dispatch.
   */
  async dispatchOnce(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    event: Event,
    entityId: unknown,
    eventId: string,
    journalEventId: string,
    depth: number,
    guard: DispatchGuard,
    dispatch: () => Promise<void>,
  ): Promise<void> {
    if (guard.completed.has(eventId)) return;
    const storage = RepositoryStorage.openEntityStorage(
      runtime.storageFactory,
      RepositoryStorage.entityStorageInput(
        repository,
        RepositoryTenants.storageContextForEvent(runtime.context, event),
      ),
    );
    let persisted: readonly Event[];
    try {
      persisted = await storage.events.backward(entityId, depth);
    } finally {
      storage.close();
    }
    if (persisted.some((candidate) => candidate.id?.value === journalEventId)) {
      DispatchGuards.rememberGuardCompletion(guard, eventId, depth);
      return;
    }
    await dispatch();
    DispatchGuards.rememberGuardCompletion(guard, eventId, depth);
  },

  /**
   * Records a successful delivery and discards the oldest excess identifiers.
   *
   * @param guard Recent completion records for this Entity.
   * @param eventId Identifier of the completed Event.
   * @param depth Maximum number of identifiers to retain.
   */
  rememberGuardCompletion(guard: DispatchGuard, eventId: string, depth: number): void {
    if (!guard.completed.has(eventId)) {
      guard.completed.add(eventId);
      guard.order.push(eventId);
    }
    while (guard.order.length > depth) {
      const expired = guard.order.shift();
      if (expired !== undefined) guard.completed.delete(expired);
    }
  },

  /**
   * Updates the queue list to place this Entity at its most recently used end.
   *
   * @param guards Repository collection of Entity queues.
   * @param key Canonical key of the queue being used.
   */
  touchGuardLane(guards: RepositoryDispatchGuards, key: string): void {
    const index = guards.order.indexOf(key);
    if (index >= 0) guards.order.splice(index, 1);
    guards.order.push(key);
  },

  /**
   * Removes least-recently-used inactive queues beyond the configured limit.
   *
   * @param guards Repository collection of Entity queues.
   * @param depth Maximum queue count when enough queues are inactive.
   */
  trimGuardLanes(guards: RepositoryDispatchGuards, depth: number): void {
    while (guards.order.length > depth) {
      const index = guards.order.findIndex((key) => guards.lanes.get(key)?.active === 0);
      if (index < 0) return;
      const [key] = guards.order.splice(index, 1);
      if (key === undefined) return;
      guards.lanes.delete(key);
    }
  },

  /**
   * Copies an Event with a target-specific identifier for duplicate checking.
   *
   * @param repository Repository supplying the target identifier descriptor.
   * @param event Source Event, returned unchanged if it has no identifier.
   * @param entityId Target Entity identifier.
   * @returns An Event suitable for this target's diagnostic history.
   */
  guardedJournalEvent(repository: RepositoryView, event: Event, entityId: unknown): Event {
    const sourceId = event.id?.value;
    if (sourceId === undefined) return event;
    return create(EventSchema, {
      ...event,
      id: create(EventIdSchema, {
        value: DispatchGuards.guardedJournalEventId(
          sourceId,
          DispatchGuards.canonicalEntityIdKey(repository, entityId),
        ),
      }),
    });
  },

  /**
   * Creates an identifier from the original Event identifier and encoded target key.
   *
   * @param sourceId Original Event identifier.
   * @param entityKey Canonical target Entity key.
   * @returns The target-specific diagnostic Event identifier.
   */
  guardedJournalEventId(sourceId: string, entityKey: string): string {
    return `${sourceId}.guard.${encodeURIComponent(entityKey)}`;
  },

  /**
   * Encodes an Entity identifier using its repository descriptor and Inbox key format.
   *
   * @param repository Repository supplying the identifier descriptor.
   * @param id Entity identifier to encode.
   * @returns A stable key for dispatch queues and diagnostic Event identifiers.
   */
  canonicalEntityIdKey(repository: RepositoryView, id: unknown): string {
    return InboxTargets.key(InboxMessages.inboxTargetId(id, repository.idField));
  },
};
Object.freeze(DispatchGuards);

/**
 * Packs target identifiers and reads typed signals from stored Inbox messages.
 */
const InboxMessages = {
  /**
   * Packs an Entity identifier into the Inbox target representation.
   *
   * @param entityId Message, string, or integer Entity identifier.
   * @param idField Descriptor identifying the Entity's ID field.
   * @returns The packed target identifier.
   */
  inboxTargetId(entityId: unknown, idField: DescriptorFieldMetadata): Any {
    if (idField.descriptor.fieldKind === "message") {
      return Identifiers.pack(idField.descriptor.message as MessageSchema, entityId as never);
    }
    if (typeof entityId === "string") return Identifiers.pack("string", entityId);
    if (typeof entityId === "number") return Identifiers.pack("int32", entityId);
    if (typeof entityId === "bigint") return Identifiers.pack("int64", entityId);
    throw new Error("Repository Entity Inbox handoff requires a supported target ID.");
  },

  /**
   * Unpacks and validates a stored Inbox target against the repository's ID field.
   *
   * @param targetId Packed target identifier stored with the Inbox message.
   * @param idField Descriptor identifying the expected ID type.
   * @returns The identifier used to restore the target Entity.
   */
  targetEntityId(targetId: Any, idField: DescriptorFieldMetadata): unknown {
    const descriptor = idField.descriptor;
    let entityId: unknown;
    if (descriptor.fieldKind === "message") {
      entityId = Identifiers.unpack(descriptor.message as MessageSchema, targetId);
    } else if (descriptor.fieldKind === "scalar") {
      switch (descriptor.scalar) {
        case ScalarType.STRING:
          entityId = Identifiers.unpack("string", targetId);
          break;
        case ScalarType.INT32:
        case ScalarType.SINT32:
        case ScalarType.SFIXED32:
          entityId = Identifiers.unpack("int32", targetId);
          break;
        case ScalarType.INT64:
        case ScalarType.SINT64:
        case ScalarType.SFIXED64:
          entityId = Identifiers.unpack("int64", targetId);
          break;
      }
    }
    if (entityId === undefined) {
      throw new Error("Entity Inbox replay stored target ID is incompatible with the repository.");
    }
    return RepositoryRoutes.readRouteId(entityId, idField, "command");
  },

  /**
   * Reads a Command from an Inbox message labeled for command handling.
   *
   * @param message Stored Inbox message to validate and unpack.
   * @returns The stored Command envelope.
   */
  readInboxCommand(message: InboxMessage): Command {
    if (message.label !== "HANDLE_COMMAND") {
      throw new Error(`Entity Inbox replay does not handle "${message.label}" messages.`);
    }

    const command =
      message.signal === undefined ? undefined : AnyMessages.unpack(message.signal, CommandSchema);

    if (command === undefined) {
      throw CommandValidationError.invalidPayload();
    }

    return command;
  },

  /**
   * Reads an Event labeled for a Process Manager reaction.
   *
   * @param message Stored Inbox message to validate and unpack.
   * @returns The stored Event envelope.
   */
  readPmInboxEvent(message: InboxMessage): Event {
    return InboxMessages.readStoredEvent(
      message,
      "REACT_UPON_EVENT",
      "Entity Inbox replay",
      "Entity Inbox replay requires a readable stored event.",
    );
  },

  /**
   * Reads an Event labeled for a Projection update.
   *
   * @param message Stored Inbox message to validate and unpack.
   * @returns The stored Event envelope.
   */
  readProjectionInboxEvent(message: InboxMessage): Event {
    return InboxMessages.readStoredEvent(
      message,
      "UPDATE_SUBSCRIBER",
      "Projection inbox replay",
      "Projection inbox replay requires a readable stored event.",
    );
  },

  /**
   * Validates an Inbox operation label and decodes its stored Event bytes.
   *
   * @param message Stored Inbox message to inspect.
   * @param expectedLabel Operation label required by the caller.
   * @param replayName Human-readable operation name used in label errors.
   * @param unreadableMessage Error text used when Event decoding fails.
   * @returns The stored Event envelope.
   */
  readStoredEvent(
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
  },
};
Object.freeze(InboxMessages);

/**
 * Validates and dispatches stored Inbox signals to their recorded Entity targets.
 */
const InboxReplay = {
  /**
   * Dispatches a stored Aggregate Command after checking its tenant and payload.
   *
   * @param repository Aggregate repository receiving the Command.
   * @param routing Registered handlers and message schemas.
   * @param message Stored Inbox message with the recorded target.
   * @param deliveryTenantId Tenant selected by delivery in a multitenant context.
   * @returns Any follow-up work that must wait for Inbox completion.
   */
  async replayAggregateCommand(
    repository: CommandRoutingRepository,
    routing: RepositoryRouting,
    message: InboxMessage,
    deliveryTenantId?: TenantId,
  ): Promise<EntityInboxFollowUp | undefined> {
    const runtime = repositoryRuntimes.get(repository);

    if (runtime === undefined) {
      throw new Error("Aggregate inbox replay requires a bound repository runtime.");
    }
    if (message.label !== "HANDLE_COMMAND") {
      throw new Error(`Aggregate inbox replay does not handle "${message.label}" messages.`);
    }

    const command = InboxMessages.readInboxCommand(message);
    InboxReplay.validateReplayTenant(runtime.context, deliveryTenantId, command);
    InboxReplay.validateReplayedCommandPayload(routing, command);
    const route = InboxReplay.replayCommandRoute(repository, routing, message, command);

    return await new AggregateCommandExecution(repository, routing, runtime, command).run(route);
  },

  /**
   * Routes Process Manager Command or Event replay by its stored operation label.
   *
   * @param repository Process Manager repository receiving the signal.
   * @param routing Registered handlers and message schemas.
   * @param message Stored Inbox message with the recorded target.
   * @param deliveryTenantId Tenant selected by delivery in a multitenant context.
   * @returns Any Command follow-up work that must wait for Inbox completion.
   */
  async replayPmInbox(
    repository: CommandRoutingRepository & EventRoutingRepository,
    routing: RepositoryRouting,
    message: InboxMessage,
    deliveryTenantId?: TenantId,
  ): Promise<EntityInboxFollowUp | undefined> {
    if (message.label === "HANDLE_COMMAND") {
      return await InboxReplay.replayProcessManagerCommand(
        repository,
        routing,
        message,
        deliveryTenantId,
      );
    }
    if (message.label === "REACT_UPON_EVENT") {
      await InboxReplay.replayProcessManagerEvent(repository, routing, message, deliveryTenantId);
      return undefined;
    }

    throw new Error(`Entity Inbox replay does not handle "${message.label}" messages.`);
  },

  /**
   * Dispatches a stored Process Manager Command after tenant and payload validation.
   *
   * @param repository Process Manager repository receiving the Command.
   * @param routing Registered handlers and message schemas.
   * @param message Stored Inbox message with the recorded target.
   * @param deliveryTenantId Tenant selected by delivery in a multitenant context.
   * @returns Any follow-up work that must wait for Inbox completion.
   */
  async replayProcessManagerCommand(
    repository: CommandRoutingRepository,
    routing: RepositoryRouting,
    message: InboxMessage,
    deliveryTenantId?: TenantId,
  ): Promise<EntityInboxFollowUp | undefined> {
    const runtime = repositoryRuntimes.get(repository);

    if (runtime === undefined) {
      throw new Error("Entity Inbox replay requires a bound repository runtime.");
    }

    const command = InboxMessages.readInboxCommand(message);

    InboxReplay.validateReplayTenant(runtime.context, deliveryTenantId, command);
    InboxReplay.validateReplayedCommandPayload(routing, command);
    const route = InboxReplay.replayCommandRoute(repository, routing, message, command);

    return await new ProcessManagerCommandExecution(repository, routing, runtime, command).run(
      route,
    );
  },

  /**
   * Dispatches a validated Event to the Process Manager target recorded in its Inbox.
   *
   * @param repository Process Manager repository receiving the Event.
   * @param routing Registered handlers and message schemas.
   * @param message Stored Inbox message with the recorded target.
   * @param deliveryTenantId Tenant selected by delivery in a multitenant context.
   * @returns Completion of dispatch to the recorded target.
   */
  async replayProcessManagerEvent(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    message: InboxMessage,
    deliveryTenantId?: TenantId,
  ): Promise<void> {
    const runtime = repositoryRuntimes.get(repository);

    if (runtime === undefined) {
      throw new Error("Entity Inbox replay requires a bound repository runtime.");
    }

    const event = InboxMessages.readPmInboxEvent(message);

    InboxReplay.validatePmReplayTenant(runtime.context, deliveryTenantId, event);
    InboxReplay.validateReplayedEventPayload(
      routing,
      event,
      "Entity Inbox replay requires a readable event payload.",
    );

    const route = InboxReplay.replayEventRoute(
      repository,
      routing,
      message,
      event,
      "Entity Inbox replay",
    );
    const [entityId] = route.entityIds;

    await new ProcessManagerEventExecution(repository, routing, runtime, event).runTarget(
      entityId,
      route,
    );
  },

  /**
   * Dispatches a validated Event to the Projection target recorded in its Inbox.
   *
   * @param repository Projection repository receiving the Event.
   * @param routing Registered subscribers and message schemas.
   * @param message Stored Inbox message with the recorded target.
   * @param deliveryTenantId Tenant selected by delivery in a multitenant context.
   * @returns Completion of dispatch to the recorded target.
   */
  async replayProjectionEvent(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    message: InboxMessage,
    deliveryTenantId?: TenantId,
  ): Promise<void> {
    const runtime = repositoryRuntimes.get(repository);

    if (runtime === undefined) {
      throw new Error("Projection inbox replay requires a bound repository runtime.");
    }

    const event = InboxMessages.readProjectionInboxEvent(message);

    InboxReplay.validateProjectionReplayTenant(runtime.context, deliveryTenantId, event);
    InboxReplay.validateReplayedEventPayload(routing, event);

    const route = InboxReplay.replayEventRoute(
      repository,
      routing,
      message,
      event,
      "Projection inbox replay",
    );
    const [entityId] = route.entityIds;

    await new ProjectionEventExecution(repository, routing, runtime, event).runTarget(
      entityId,
      route,
    );
  },

  /**
   * Routes a Projection Inbox message to domain Event or Entity-state update replay.
   *
   * @param repository Projection repository receiving the update.
   * @param routing Registered subscribers and message schemas.
   * @param message Stored Projection Inbox message.
   * @param deliveryTenantId Tenant selected by delivery in a multitenant context.
   * @returns Completion of the selected replay operation.
   */
  async replayProjectionMessage(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    message: ProjectionInboxMessage,
    deliveryTenantId?: TenantId,
  ): Promise<void> {
    const event = InboxMessages.readProjectionInboxEvent(message);
    if (event.message?.typeUrl === TypeUrls.derive(EntityLog.EntityStateChangedSchema)) {
      await InboxReplay.replayProjectionStateUpdate(
        repository,
        routing,
        message,
        event,
        deliveryTenantId,
      );
      return;
    }
    await InboxReplay.replayProjectionEvent(repository, routing, message, deliveryTenantId);
  },

  /**
   * Dispatches an Entity-state update to the Projection target recorded in its Inbox.
   *
   * @param repository Projection repository receiving the state update.
   * @param routing Registered state subscribers and schemas.
   * @param message Stored Inbox message with the recorded target.
   * @param event Event envelope carrying the Entity-state update.
   * @param deliveryTenantId Tenant selected by delivery in a multitenant context.
   * @returns Completion of state-subscriber dispatch to the recorded target.
   */
  async replayProjectionStateUpdate(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    message: ProjectionInboxMessage,
    event: Event,
    deliveryTenantId?: TenantId,
  ): Promise<void> {
    const runtime = repositoryRuntimes.get(repository);
    if (runtime === undefined)
      throw new Error("Projection inbox replay requires a bound repository runtime.");
    InboxReplay.validateProjectionReplayTenant(runtime.context, deliveryTenantId, event);
    const route = InboxReplay.replayStateUpdateRoute(repository, routing, message, event);
    const [entityId] = route.entityIds;
    const subscribers = route.subscribers;
    await ProjectionEventExecution.runStateTarget(
      repository,
      routing,
      runtime,
      event,
      entityId,
      route,
      subscribers,
    );
  },

  /**
   * Validates a stored Command against its schema and implicit identifier requirements.
   *
   * @param routing Registered Command schemas.
   * @param command Envelope whose payload must remain valid on replay.
   */
  validateReplayedCommandPayload(routing: RepositoryRouting, command: Command): void {
    const commandMessage = EntityInvocation.requireSignalMessage(command.message, "command");
    const commandSchema = RepositoryRoutes.schemaForTypeUrl(
      routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );
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
    const implicitId = ImplicitRequiredIds.validateCommand(commandSchema, payload);
    if (!implicitId.valid) {
      throw new CommandValidationError(implicitId.error);
    }
  },

  /**
   * Unpacks and validates a stored Event against its registered schema.
   *
   * @param routing Registered Event schemas.
   * @param event Envelope whose payload must remain valid on replay.
   * @param invalidPayloadMessage Error text used when the payload cannot be unpacked.
   */
  validateReplayedEventPayload(
    routing: RepositoryRouting,
    event: Event,
    invalidPayloadMessage = "Projection inbox replay requires a readable event payload.",
  ): void {
    const eventMessage = EntityInvocation.requireSignalMessage(event.message, "event");
    const eventSchema = RepositoryRoutes.schemaForTypeUrl(
      routing.eventSchemas,
      eventMessage.typeUrl,
      "event",
    );
    const payload = AnyMessages.unpack(eventMessage, eventSchema);

    if (payload === undefined) {
      throw new Error(invalidPayloadMessage);
    }

    Validate.check(eventSchema, payload);
  },

  /**
   * Checks that a replayed Command's tenant matches its delivery tenant.
   *
   * @param context Context name and tenant mode; single-tenant contexts need no check.
   * @param deliveryTenantId Tenant selected by Inbox delivery.
   * @param command Stored Command containing the original actor context.
   */
  validateReplayTenant(
    context: StorageMode,
    deliveryTenantId: TenantId | undefined,
    command: Command,
  ): void {
    if (!context.multitenant) {
      return;
    }

    if (deliveryTenantId === undefined) {
      throw new Error(`Multitenant Entity Inbox replay for "${context.name}" requires tenantId.`);
    }

    const envelopeTenantId = RepositoryTenants.readCommandTenant(command);

    if (envelopeTenantId === undefined) {
      throw new Error("Entity Inbox replay requires stored command tenant metadata.");
    }
    if (!RepositoryTenants.equal(envelopeTenantId, deliveryTenantId)) {
      throw new Error("Entity Inbox replay stored command tenant does not match.");
    }
  },

  /**
   * Checks that a replayed Projection Event's tenant matches its delivery tenant.
   *
   * @param context Context name and tenant mode; single-tenant contexts need no check.
   * @param deliveryTenantId Tenant selected by Inbox delivery.
   * @param event Stored Event containing the original tenant metadata.
   */
  validateProjectionReplayTenant(
    context: StorageMode,
    deliveryTenantId: TenantId | undefined,
    event: Event,
  ): void {
    if (!context.multitenant) {
      return;
    }

    if (deliveryTenantId === undefined) {
      throw new Error(
        `Multitenant projection inbox replay for "${context.name}" requires tenantId.`,
      );
    }

    const envelopeTenantId = RepositoryTenants.readEventTenant(event);

    if (envelopeTenantId === undefined) {
      throw new Error("Projection inbox replay requires stored event tenant metadata.");
    }
    if (!RepositoryTenants.equal(envelopeTenantId, deliveryTenantId)) {
      throw new Error("Projection inbox replay stored event tenant does not match.");
    }
  },

  /**
   * Checks that a replayed Process Manager Event's tenant matches its delivery tenant.
   *
   * @param context Context name and tenant mode; single-tenant contexts need no check.
   * @param deliveryTenantId Tenant selected by Inbox delivery.
   * @param event Stored Event containing the original tenant metadata.
   */
  validatePmReplayTenant(
    context: StorageMode,
    deliveryTenantId: TenantId | undefined,
    event: Event,
  ): void {
    if (!context.multitenant) {
      return;
    }

    if (deliveryTenantId === undefined) {
      throw new Error(`Multitenant Entity Inbox replay for "${context.name}" requires tenantId.`);
    }

    const envelopeTenantId = RepositoryTenants.readEventTenant(event);

    if (envelopeTenantId === undefined) {
      throw new Error("Entity Inbox replay requires stored event tenant metadata.");
    }
    if (!RepositoryTenants.equal(envelopeTenantId, deliveryTenantId)) {
      throw new Error("Entity Inbox replay stored event tenant does not match.");
    }
  },

  /**
   * Restores a Command route from the stored target instead of running routing again.
   *
   * @param repository Repository whose Entity type must match the stored target.
   * @param routing Registered Command schemas.
   * @param message Inbox message recording the target type and identifier.
   * @param command Stored Command used to identify the registered handler schema.
   * @returns A deferred route to the recorded Entity identifier.
   */
  replayCommandRoute(
    repository: RepositoryView,
    routing: RepositoryRouting,
    message: InboxMessage,
    command: Command,
  ): RepositoryCommandRoute {
    const expectedTargetTypeUrl = TypeUrls.derive(repository.stateSchema);

    if (message.inboxId.targetTypeUrl !== expectedTargetTypeUrl) {
      throw new Error(
        "Entity Inbox replay stored target type does not match the routed repository.",
      );
    }

    const commandMessage = EntityInvocation.requireSignalMessage(command.message, "command");
    const schema = RepositoryRoutes.schemaForTypeUrl(
      routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );

    return Object.freeze({
      entityId: InboxMessages.targetEntityId(message.inboxId.targetId, repository.idField),
      messageFullTypeName: schema.typeName,
      invocation: "deferred",
    });
  },

  /**
   * Restores a single-target Event route from a stored Inbox message.
   *
   * @param repository Repository whose Entity type must match the stored target.
   * @param routing Registered Event schemas.
   * @param message Inbox message recording the target type and identifier.
   * @param event Stored Event used to identify the registered handler schema.
   * @param replayName Operation name used when reporting a target-type mismatch.
   * @returns A deferred route containing exactly the recorded target identifier.
   */
  replayEventRoute(
    repository: RepositoryView,
    routing: RepositoryRouting,
    message: InboxMessage,
    event: Event,
    replayName: string,
  ): RepositoryEventRoute & { readonly entityIds: readonly [unknown] } {
    const expectedTargetTypeUrl = TypeUrls.derive(repository.stateSchema);

    if (message.inboxId.targetTypeUrl !== expectedTargetTypeUrl) {
      throw new Error(`${replayName} stored target type does not match the routed repository.`);
    }

    const eventMessage = EntityInvocation.requireSignalMessage(event.message, "event");
    const schema = RepositoryRoutes.schemaForTypeUrl(
      routing.eventSchemas,
      eventMessage.typeUrl,
      "event",
    );
    const entityId = InboxMessages.targetEntityId(message.inboxId.targetId, repository.idField);
    const entityIds: readonly [unknown] = Object.freeze([entityId]);
    return Object.freeze({
      entityIds,
      messageFullTypeName: schema.typeName,
      invocation: "deferred",
    });
  },

  /**
   * Restores a Projection state-update route and its origin-compatible subscribers.
   *
   * @param repository Repository whose Entity type must match the stored target.
   * @param routing Registered state schemas and subscribers.
   * @param message Inbox message recording the Projection target.
   * @param event Stored Entity-state update envelope.
   * @returns A deferred route with the unpacked state and matching subscribers.
   */
  replayStateUpdateRoute(
    repository: RepositoryView,
    routing: RepositoryRouting,
    message: InboxMessage,
    event: Event,
  ): RepositoryStateUpdateRoute & { readonly entityIds: readonly [unknown] } {
    const expectedTargetTypeUrl = TypeUrls.derive(repository.stateSchema);
    if (message.inboxId.targetTypeUrl !== expectedTargetTypeUrl) {
      throw new Error(
        "Projection inbox replay stored target type does not match the routed repository.",
      );
    }
    const update = RepositoryRoutes.decodeStateUpdate(
      event,
      routing.stateSchemas,
      "Projection inbox replay",
    );
    if (
      update === undefined ||
      (routing.stateSubscriptions.get(update.schema.typeName)?.length ?? 0) === 0
    ) {
      throw new Error("Projection inbox replay requires a readable stored Entity state update.");
    }
    const { schema, state } = update;
    const entityId = InboxMessages.targetEntityId(message.inboxId.targetId, repository.idField);
    const entityIds: readonly [unknown] = Object.freeze([entityId]);
    return Object.freeze({
      entityIds,
      messageFullTypeName: schema.typeName,
      state,
      subscribers: Object.freeze(
        (() => {
          const candidates = routing.stateSubscriptions.get(schema.typeName) ?? [];
          return candidates.filter(
            (subscriber) =>
              (subscriber.handler.origin === "external") === (event.context?.external === true),
          );
        })(),
      ),
      invocation: "deferred",
    });
  },
};
Object.freeze(InboxReplay);

/**
 * Records routed signals in the appropriate Entity or Projection Inbox.
 */
const InboxHandoff = {
  /**
   * Routes a Command and submits it to the target Entity's Inbox.
   *
   * @param repository Repository supplying the Command route and Entity type.
   * @param runtime Inbox, storage, tenant mode, and delivery strategy.
   * @param command Command envelope to retain and deliver.
   * @returns Completion of Inbox receipt and its selected delivery operation.
   */
  async handoffEntityCommand(
    repository: CommandRoutingRepository,
    runtime: RepositoryRuntime,
    command: Command,
  ): Promise<void> {
    const route = repository.routeCommand(command);
    const commandId = RepositorySignals.requireCommandId(command);
    const whenReceived = new Date();
    const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
    const deliveryTenantId = RepositoryTenants.requireCommandTenant(runtime.context, command);
    const delivery = new Delivery({
      context: RepositoryTenants.entityInboxDeliveryContext(runtime.context, deliveryTenantId),
      storageFactory: runtime.storageFactory,
      strategy: runtime.entityInbox.strategy(),
    });

    await runtime.entityInbox.receive(
      delivery,
      {
        inboxId: {
          targetId: InboxMessages.inboxTargetId(route.entityId, repository.idField),
          targetTypeUrl: TypeUrls.derive(repository.stateSchema),
        },
        signalId: commandId.uuid,
        signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        keepUntil,
      },
      deliveryTenantId,
    );
  },

  /**
   * Delivers an Event to one Projection target with the duplicate-retention deadline.
   *
   * @param repository Repository supplying the Projection type and ID descriptor.
   * @param runtime Projection Inbox, storage, and tenant mode.
   * @param event Event envelope to retain and deliver.
   * @param entityId Routed Projection identifier.
   * @returns Completion of Inbox receipt and delivery.
   */
  async handoffProjectionEvent(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    event: Event,
    entityId: unknown,
  ): Promise<void> {
    const eventId = RepositorySignals.requireEventId(event);
    const whenReceived = new Date();
    const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
    const deliveryTenantId = RepositoryTenants.requireProjectionTenant(runtime.context, event);
    const delivery = new Delivery({
      context: RepositoryTenants.projectionDeliveryContext(runtime.context, deliveryTenantId),
      storageFactory: runtime.storageFactory,
    });

    await runtime.projectionInbox.receive(
      delivery,
      {
        inboxId: {
          targetId: InboxMessages.inboxTargetId(entityId, repository.idField),
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
  },

  /**
   * Delivers an Event to one Process Manager target using its Entity Inbox.
   *
   * @param repository Repository supplying the Process Manager type and ID descriptor.
   * @param runtime Entity Inbox, storage, tenant mode, and delivery strategy.
   * @param event Event envelope to retain and deliver.
   * @param entityId Routed Process Manager identifier.
   * @returns Completion of Inbox receipt and its selected delivery operation.
   */
  async handoffPmEvent(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    event: Event,
    entityId: unknown,
  ): Promise<void> {
    const eventId = RepositorySignals.requireEventId(event);
    const whenReceived = new Date();
    const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
    const deliveryTenantId = RepositoryTenants.requirePmEventTenant(runtime.context, event);
    const delivery = new Delivery({
      context: RepositoryTenants.entityInboxDeliveryContext(runtime.context, deliveryTenantId),
      storageFactory: runtime.storageFactory,
      strategy: runtime.entityInbox.strategy(),
    });

    await runtime.entityInbox.receive(
      delivery,
      InboxHandoff.pmEventInboxInput(repository, eventId.value, event, entityId, keepUntil),
      deliveryTenantId,
    );
  },

  /**
   * Delivers an Event to all routed Process Manager targets through batch receipt.
   *
   * @param repository Repository supplying the Process Manager type and ID descriptor.
   * @param runtime Entity Inbox, storage, tenant mode, and delivery strategy.
   * @param event Event envelope shared by the target deliveries.
   * @param entityIds Routed Process Manager identifiers.
   * @returns Completion of batch receipt and its selected delivery operation.
   */
  async handoffPmEvents(
    repository: RepositoryView,
    runtime: RepositoryRuntime,
    event: Event,
    entityIds: readonly unknown[],
  ): Promise<void> {
    const eventId = RepositorySignals.requireEventId(event);
    const whenReceived = new Date();
    const keepUntil = new Date(whenReceived.getTime() + inboxDedupMs);
    const deliveryTenantId = RepositoryTenants.requirePmEventTenant(runtime.context, event);
    const delivery = new Delivery({
      context: RepositoryTenants.entityInboxDeliveryContext(runtime.context, deliveryTenantId),
      storageFactory: runtime.storageFactory,
      strategy: runtime.entityInbox.strategy(),
    });
    const inputs = entityIds.map((entityId) =>
      InboxHandoff.pmEventInboxInput(repository, eventId.value, event, entityId, keepUntil),
    );

    await runtime.entityInbox.receiveAll(delivery, inputs, deliveryTenantId);
  },

  /**
   * Builds a pending Process Manager Event delivery for a single target.
   *
   * @param repository Repository supplying the target type and ID descriptor.
   * @param signalId Identifier of the original Event.
   * @param event Event envelope to pack without repeating validation.
   * @param entityId Routed Process Manager identifier.
   * @param keepUntil Duplicate-retention deadline for this receipt.
   * @returns Input for Entity Inbox receipt.
   */
  pmEventInboxInput(
    repository: RepositoryView,
    signalId: string,
    event: Event,
    entityId: unknown,
    keepUntil: Date,
  ): EntityInboxInput {
    return {
      inboxId: {
        targetId: InboxMessages.inboxTargetId(entityId, repository.idField),
        targetTypeUrl: TypeUrls.derive(repository.stateSchema),
      },
      signalId,
      signal: AnyMessages.pack(EventSchema, event, { validate: false }),
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
      keepUntil,
    };
  },
};
Object.freeze(InboxHandoff);

/**
 * Connects bus dispatchers and Inbox replay to repository execution.
 */
const RepositoryDispatch = {
  /**
   * Creates the bus dispatchers supported by the repository's registered handlers.
   *
   * @param repository Repository providing Command and Event routes.
   * @param routing Registered handlers, schemas, and state-update routes.
   * @returns Command, Event, and system-Event dispatchers where applicable.
   */
  createRepositoryDispatchers(
    repository: CommandRoutingRepository & EventRoutingRepository,
    routing: RepositoryRouting,
  ): RepositoryDispatchers {
    const acceptedEventRoutes = new WeakMap<Event, RepositoryEventRoute>();
    const acceptedStateRoutes = new WeakMap<Event, RepositoryStateUpdateRoute | null>();
    return Object.freeze({
      command: RepositoryDispatch.commandDispatcher(repository, routing),
      event: RepositoryDispatch.eventDispatcher(repository, routing, acceptedEventRoutes),
      systemEvent: RepositoryDispatch.stateDispatcher(repository, routing, acceptedStateRoutes),
    });
  },

  /**
   * Creates a Command dispatcher when the repository accepts Commands.
   *
   * @param repository Repository providing Command routes.
   * @param routing Registered Command handlers and schemas.
   * @returns The dispatcher, or undefined when no Command schema is registered.
   */
  commandDispatcher(
    repository: CommandRoutingRepository,
    routing: RepositoryRouting,
  ): CommandDispatcher | undefined {
    return routing.commandSchemas.length === 0
      ? undefined
      : Object.freeze({
          messageSchemas: () => routing.commandSchemas,
          dispatch: (command: Command): Promise<void> =>
            RepositoryDispatch.dispatchRepositoryCommand(repository, routing, command),
        });
  },

  /**
   * Creates an Event dispatcher that preserves routes computed during acceptance.
   *
   * @param repository Repository providing Event routes.
   * @param routing Registered domestic and external Event handlers and schemas.
   * @param accepted Cache of routes between Event acceptance and dispatch.
   * @returns The dispatcher, or undefined when no Event schema is registered.
   */
  eventDispatcher(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    accepted: WeakMap<Event, RepositoryEventRoute>,
  ): EventDispatcher | undefined {
    if (routing.eventSchemas.length === 0) return undefined;
    const dispatcher = Object.freeze({
      messageSchemas: () => routing.eventSchemas,
      externalEventSchemas: () => routing.externalEventSchemas,
      accept: (event: Event): Promise<void> => {
        accepted.set(event, repository.routeEvent(event));
        return Promise.resolve();
      },
      dispatch: (event: Event): Promise<void> => {
        const route = accepted.get(event);
        accepted.delete(event);
        return RepositoryDispatch.dispatchRepositoryEvent(repository, routing, event, route);
      },
    });
    return EventDispatcherOriginSchemas.define(
      dispatcher,
      routing.domesticEventSchemas,
      routing.externalEventSchemas,
    );
  },

  /**
   * Creates a system-Event dispatcher for registered Entity-state subscriptions.
   *
   * @param repository Repository receiving state updates.
   * @param routing State schemas, subscribers, and origin-aware routing.
   * @param accepted Cached accepted routes; null records an ignored update.
   * @returns The dispatcher, or undefined when no state schema is registered.
   */
  stateDispatcher(
    repository: RepositoryView,
    routing: RepositoryRouting,
    accepted: WeakMap<Event, RepositoryStateUpdateRoute | null>,
  ): EventDispatcher | undefined {
    if (routing.stateSchemas.length === 0) return undefined;
    const hasOrigin = (origin: "domestic" | "external") =>
      [...routing.stateSubscriptions.values()].some((values) =>
        values.some((value) => value.handler.origin === origin),
      );
    const schema = EntityLog.EntityStateChangedSchema;
    const dispatcher = Object.freeze({
      messageSchemas: () => Object.freeze([schema]),
      externalEventSchemas: () => (hasOrigin("external") ? [schema] : []),
      accept: (event: Event): Promise<void> => {
        accepted.set(event, routing.routeStateUpdate(event) ?? null);
        return Promise.resolve();
      },
      dispatch: (event: Event): Promise<void> =>
        RepositoryDispatch.dispatchAcceptedState(repository, routing, event, accepted),
    });
    return EventDispatcherOriginSchemas.define(
      dispatcher,
      hasOrigin("domestic") ? [schema] : [],
      hasOrigin("external") ? [schema] : [],
    );
  },

  /**
   * Dispatches a cached state-update route unless acceptance ignored the update.
   *
   * @param repository Repository receiving the state update.
   * @param routing State-update routes and subscribers.
   * @param event System Event carrying the state update.
   * @param accepted Cache populated during acceptance and cleared for this Event.
   * @returns Completion of dispatch, or immediate completion for an ignored update.
   */
  dispatchAcceptedState(
    repository: RepositoryView,
    routing: RepositoryRouting,
    event: Event,
    accepted: WeakMap<Event, RepositoryStateUpdateRoute | null>,
  ): Promise<void> {
    const route = accepted.get(event);
    accepted.delete(event);
    return route === null
      ? Promise.resolve()
      : RepositoryDispatch.dispatchRepositoryStateUpdate(repository, routing, event, route);
  },

  /**
   * Creates replay access for an Aggregate or Process Manager with signal handlers.
   *
   * @param repository Repository providing signal routes and Entity identity.
   * @param routing Registered handlers and message schemas.
   * @returns The Inbox target and supported operation labels, when applicable.
   */
  createEntityInboxTarget(
    repository: CommandRoutingRepository & EventRoutingRepository,
    routing: RepositoryRouting,
  ): EntityInboxTarget | undefined {
    if (
      (repository.entityFamily !== "aggregate" && repository.entityFamily !== "process-manager") ||
      (routing.commandSchemas.length === 0 && routing.eventSchemas.length === 0)
    ) {
      return undefined;
    }

    return Object.freeze({
      targetTypeUrl: TypeUrls.derive(repository.stateSchema),
      labels: Object.freeze([
        ...(routing.commandSchemas.length === 0 ? [] : (["HANDLE_COMMAND"] as const)),
        ...(repository.entityFamily === "process-manager" && routing.eventSchemas.length > 0
          ? (["REACT_UPON_EVENT"] as const)
          : []),
      ]),
      replay: (message: InboxMessage, deliveryTenantId?: TenantId): EntityInboxReplay =>
        repository.entityFamily === "aggregate"
          ? InboxReplay.replayAggregateCommand(repository, routing, message, deliveryTenantId)
          : InboxReplay.replayPmInbox(repository, routing, message, deliveryTenantId),
    });
  },

  /**
   * Creates replay access for a Projection with Event or state subscribers.
   *
   * @param repository Repository providing Projection identity and Event routes.
   * @param routing Registered Event and state subscribers.
   * @returns The Projection Inbox target, when applicable.
   */
  createProjectionInboxTarget(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
  ): ProjectionInboxTarget | undefined {
    if (
      repository.entityFamily !== "projection" ||
      (routing.eventSchemas.length === 0 && routing.stateSchemas.length === 0)
    ) {
      return undefined;
    }

    return Object.freeze({
      targetTypeUrl: TypeUrls.derive(repository.stateSchema),
      replay: (message: ProjectionInboxMessage, deliveryTenantId?: TenantId): Promise<void> =>
        InboxReplay.replayProjectionMessage(repository, routing, message, deliveryTenantId),
    });
  },

  /**
   * Creates direct Projection dispatch for ordinary delivery or rebuilding.
   *
   * @param repository Repository providing Projection identity and Event routes.
   * @param routing Registered Projection subscribers and schemas.
   * @returns A callback that validates routing only when no runtime is bound.
   */
  createProjectionDirectDispatch(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
  ): (event: Event, rebuild?: boolean) => Promise<void> {
    return (event: Event, rebuild?: boolean): Promise<void> => {
      const runtime = repositoryRuntimes.get(repository);

      if (runtime === undefined) {
        void repository.routeEvent(event);
        return Promise.resolve();
      }

      return new ProjectionEventExecution(repository, routing, runtime, event, rebuild).runDirect();
    };
  },

  /**
   * Routes an Event to the execution path for the repository's Entity family.
   *
   * @param repository Repository providing Entity identity and Event routes.
   * @param routing Registered Event handlers and schemas.
   * @param event Event envelope to dispatch.
   * @param acceptedRoute Previously accepted route, if available.
   * @returns Completion of routing or runtime dispatch when a runtime is bound.
   */
  async dispatchRepositoryEvent(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    event: Event,
    acceptedRoute?: RepositoryEventRoute,
  ): Promise<void> {
    const runtime = repositoryRuntimes.get(repository);

    if (runtime === undefined) {
      if (acceptedRoute === undefined) void repository.routeEvent(event);
      return;
    }

    const route = acceptedRoute ?? repository.routeEvent(event);

    switch (repository.entityFamily) {
      case "aggregate":
        await RepositoryDispatch.dispatchAggregateEvent(repository, routing, runtime, event, route);
        return;
      case "process-manager":
        await new ProcessManagerEventExecution(repository, routing, runtime, event).run(route);
        return;
      case "projection":
        await new ProjectionEventExecution(repository, routing, runtime, event).run(route);
        return;
    }
  },

  /**
   * Dispatches an Event to each routed Aggregate with its configured duplicate guard.
   *
   * @param repository Aggregate repository receiving the Event.
   * @param routing Registered Aggregate Event handlers and schemas.
   * @param runtime Bound storage, publisher, and tenant context.
   * @param event Event envelope to dispatch.
   * @param route Accepted route listing target Aggregate identifiers.
   * @returns Completion of all target dispatches in route order.
   */
  async dispatchAggregateEvent(
    repository: EventRoutingRepository,
    routing: RepositoryRouting,
    runtime: RepositoryRuntime,
    event: Event,
    route: RepositoryEventRoute,
  ): Promise<void> {
    const execution = new AggregateEventExecution(repository, routing, runtime, event);
    for (const entityId of route.entityIds) {
      await DispatchGuards.guardedEntityEventDispatch(repository, runtime, event, entityId, () =>
        execution.runTarget(entityId, route),
      );
    }
  },

  /**
   * Delivers a routed Entity-state update to each target Projection Inbox.
   *
   * @param repository Projection repository receiving the update.
   * @param routing Registered state schemas and subscribers.
   * @param event System Event carrying the state update.
   * @param acceptedRoute Previously accepted state-update route, if available.
   * @returns Completion of routing and any required Inbox receipts.
   */
  async dispatchRepositoryStateUpdate(
    repository: RepositoryView,
    routing: RepositoryRouting,
    event: Event,
    acceptedRoute?: RepositoryStateUpdateRoute,
  ): Promise<void> {
    const runtime = repositoryRuntimes.get(repository);
    if (runtime === undefined) {
      if (acceptedRoute === undefined) void routing.routeStateUpdate(event);
      return;
    }
    const route = acceptedRoute ?? routing.routeStateUpdate(event);
    if (route === undefined) return;
    for (const entityId of route.entityIds) {
      await InboxHandoff.handoffProjectionEvent(repository, runtime, event, entityId);
    }
  },

  /**
   * Delivers Commands for Aggregates and Process Managers through their Entity Inboxes.
   *
   * @param repository Repository providing Command routes and Entity identity.
   * @param routing Registered Command handler metadata.
   * @param command Command envelope to dispatch.
   * @returns Completion of Inbox receipt, or routing validation without a bound runtime.
   */
  async dispatchRepositoryCommand(
    repository: CommandRoutingRepository,
    routing: RepositoryRouting,
    command: Command,
  ): Promise<void> {
    const runtime = repositoryRuntimes.get(repository);

    if (runtime === undefined) {
      void repository.routeCommand(command);
      return;
    }

    if (repository.entityFamily === "aggregate") {
      await InboxHandoff.handoffEntityCommand(repository, runtime, command);
      return;
    }

    if (repository.entityFamily === "process-manager") {
      await InboxHandoff.handoffEntityCommand(repository, runtime, command);
      return;
    }

    void repository.routeCommand(command);
  },
};
Object.freeze(RepositoryDispatch);

/**
 * Defines continuation-aware repository history caches.
 */
const repositoryHistory = {
  // prettier-ignore

  /**
   * Creates a cache that extends a repository history only when a caller requests more entries.
   *
   * @typeParam Entry The history entry type.
   * @param load Loads entries before an optional continuation version.
   * @param versionOf Reads the optional version carried by an entry.
   * @param options Selects strictly descending-version and complete-group behavior.
   * @returns A cache with read and clear operations.
   */
  createCache<Entry>(
    load: (depth: number, startingFromVersion?: bigint) => Promise<readonly Entry[]>,
    versionOf: (entry: Entry) => bigint | undefined,
    options: {
      readonly requireDescendingVersions?: boolean;
      readonly cacheCompleteVersionGroups?: boolean;
    } = {},
  ): { readonly read: (depth: number) => Promise<readonly Entry[]>; readonly clear: () => void } {
    return RepositoryHistoryInternals.createHistoryCache(load, versionOf, options);
  },
};

Object.freeze(repositoryHistory);

/**
 * Defines continuation-aware repository history caches.
 */
export const RepositoryHistory: Readonly<typeof repositoryHistory> = repositoryHistory;
