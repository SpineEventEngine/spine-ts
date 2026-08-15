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
  TenantBoundary,
  type StorageContext,
  type StorageFactory,
  type StorageMode,
} from "@spine-event-engine/storage";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";
import type { EntityCommitStorage } from "@spine-event-engine/storage/internal/entity-commit";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/internal/entity-commit";

import { CommandValidationError } from "../bus/command-errors.js";
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
import {
  HandlerMetadataRegistry,
  HandlerMetadataValues,
  type CommandAssignmentHandlerMetadata,
  type CommandReactionHandlerMetadata,
  type EntityHandlersMetadata,
  type EventReactionHandlerMetadata,
  type StateSubscriptionHandlerMetadata,
  type HandlerParameterCount,
  type RegisteredHandlerMetadata,
  type WhereOptions,
} from "../handler/handler-metadata.js";
import { standAccess, type Stand } from "../stand/stand.js";
import { TransitionValidationError } from "./command-errors.js";
import { MessageIds, PrimitiveIds } from "./primitive-id.js";
import { ImplicitRequiredIds } from "../entity/implicit-required-id.js";

type RepositoryEntityInstance<Schema extends DescriptorMessageSchema = DescriptorMessageSchema> =
  | Aggregate<unknown, Schema, unknown>
  | Projection<unknown, Schema, unknown>
  | ProcessManager<unknown, Schema, unknown>;

/**
 * Generated Protobuf-ES state schema carried by a repository entity constructor.
 */
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

type StateRoutingOption<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Projection<unknown, DescriptorMessageSchema, unknown>
    ? StateUpdateRouting<RepositoryEntityId<EntityType>>
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

/**
 * Describes an entity constructor accepted by repository identity metadata.
 *
 * @typeParam Instance - The aggregate, projection, or process-manager instance type.
 * @param args The constructor arguments accepted by the entity class.
 * @returns An entity instance.
 */
export type RepositoryEntityType<
  Instance extends RepositoryEntityInstance = RepositoryEntityInstance,
> = (abstract new (...args: never[]) => Instance) &
  // `any` erases the Entity constructor parameters while preserving its protected static origin.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof Entity<any, DescriptorMessageSchema, any> & {
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
 * @typeParam EntityType - A single concrete aggregate, projection, or process-manager constructor.
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
   *
   * Aggregate repositories with handlers can be executed by built bounded contexts and therefore
   * must use `bigint` version metadata, matching the persisted aggregate history version type.
   * Projection repositories with handlers can be executed by built bounded contexts and therefore
   * must use `number` version metadata, matching the protobuf event version carried into Stand.
   * Process-manager repositories with handlers also execute through Stand-backed state and must
   * use `number` version metadata, matching the Stand version shape used by the local runtime.
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
 * @typeParam EntityType - The concrete entity constructor owned by the repository. The snapshot's
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
  hasInstance(repository: unknown): repository is RepositoryView {
    return repositorySnapshots.has(repository as RepositoryView);
  },

  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot {
    const snapshot = repositorySnapshots.get(repository);

    if (snapshot === undefined) {
      throw new TypeError("Repository snapshot requires a Repository instance.");
    }

    return RepositoryIdentity.cloneRepositorySnapshot(snapshot);
  },

  producedEventSchemas(repository: RepositoryView): readonly MessageSchema[] {
    const schemas = repositoryProducedEventSchemas.get(repository);

    if (schemas === undefined) {
      throw new TypeError("Produced event schemas require a Repository instance.");
    }

    return schemas;
  },

  commandDispatcher(repository: RepositoryView): CommandDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.command;
  },

  eventDispatcher(repository: RepositoryView): EventDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.event;
  },

  systemEventDispatcher(repository: RepositoryView): EventDispatcher | undefined {
    return repositoryDispatchers.get(repository)?.systemEvent;
  },

  stateSubscriptionTypes(repository: RepositoryView): readonly string[] {
    const routing = repositoryRoutings.get(repository);
    if (routing === undefined) {
      throw new TypeError("State subscriptions require a Repository instance.");
    }
    return Object.freeze(routing.stateSchemas.map((schema) => schema.typeName));
  },

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

  entityInboxTarget(repository: RepositoryView): EntityInboxTarget | undefined {
    return repositoryEntityInboxTargets.get(repository);
  },

  projectionInboxTarget(repository: RepositoryView): ProjectionInboxTarget | undefined {
    return repositoryProjectionInboxTargets.get(repository);
  },

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
  readonly systemEvent: EventDispatcher | undefined;
}

interface RepositoryRouting<Id = unknown> {
  readonly commandSchemas: readonly MessageSchema[];
  readonly eventSchemas: readonly MessageSchema[];
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
  commandReactions(
    eventFullTypeName: string,
    message: unknown,
    external: boolean,
  ): readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
  eventReactors(
    eventFullTypeName: string,
    message: unknown,
    external: boolean,
  ): readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
  eventSubscribers(
    eventFullTypeName: string,
    message: unknown,
    external: boolean,
  ): RepositoryEventSubscribers;
  routeCommand(command: Command): RepositoryCommandRoute<Id>;
  routeEvent(event: Event): RepositoryEventRoute<Id>;
  routeStateUpdate(event: Event): RepositoryStateUpdateRoute<Id> | undefined;
}

interface RepositoryRuntime {
  readonly context: StorageMode;
  readonly storageFactory: StorageFactory;
  readonly stand: Stand;
  readonly signalMetadata: SignalMetadata;
  readonly entityInbox: EntityInbox;
  readonly projectionInbox: ProjectionInbox;
  readonly dispatchStored: (event: Event) => Promise<void>;
  readonly dispatchStoredFollowUp: (event: Event) => Promise<void>;
  readonly postEventFollowUp: (event: Event) => Promise<void>;
  readonly registerEventSchema: (schema: MessageSchema) => void;
  readonly postSystemFollowUp: (event: Event) => Promise<void>;
  readonly registerSystemEventSchema: (schema: MessageSchema) => void;
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

interface LoadedRepositoryEntity {
  readonly commits: EntityCommitStorage;
  readonly current: EntityRecord | undefined;
  readonly entity: object;
  readonly storageInput: EntityStorageInput<unknown, Message>;
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

  normalizeProducedSignals(produced: unknown): readonly unknown[] {
    if (produced === undefined) {
      return Object.freeze([]);
    }

    if (Array.isArray(produced)) {
      return Object.freeze(Array.from(produced as readonly unknown[]));
    }

    return Object.freeze([produced]);
  }

  /**
   * Store the current aggregate record before its diagnostic and delivery journals.
   */
  async persistAggregateUpdate(
    loaded: LoadedAggregate,
    entityId: unknown,
    version: bigint,
    events: readonly Event[],
  ): Promise<boolean> {
    const lifecycle = RepositoryEntities.repositoryLifecycle(loaded.entity);
    const state = RepositoryEntities.repositoryState(loaded.entity) as Message;
    const deferred = await standAccess.deferUpdate(
      this.#runtime.stand,
      this.#repository.stateSchema,
      state,
      RepositoryStand.standUpdateOptions(
        this.#storageContext.tenantId,
        create(VersionSchema, { number: RepositorySignals.eventVersionNumber(version) }),
        lifecycle,
      ),
    );
    try {
      const createdAt = events[events.length - 1]?.context?.timestamp ?? create(TimestampSchema);
      const outcome = await loaded.commits.commit({
        context: this.#storageContext,
        entity: loaded.storageInput,
        entityId,
        ...(loaded.current === undefined ? {} : { expected: loaded.current }),
        next: EntityRecords.pack(this.#repository.stateSchema, entityId, state, version, lifecycle),
        ...(RepositoryStorage.historyConfiguration(this.#repository).stateHistory
          ? {
              states: [
                EntityRecords.pack(
                  this.#repository.stateSchema,
                  entityId,
                  state,
                  create(VersionSchema, {
                    number: RepositorySignals.eventVersionNumber(version),
                    timestamp: createdAt,
                  }),
                  lifecycle,
                ),
              ],
            }
          : {}),
        diagnostics: events.map((event) => clone(EventSchema, event)),
        events,
      });
      if (outcome !== "committed") {
        deferred.cancel();
        throw new Error("Concurrent Aggregate state commit conflict.");
      }
      entityStateHistoryCaches.get(loaded.entity)?.clear();
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
    return true;
  }

  async appendDiagnosticEvent(
    loaded: LoadedAggregate,
    entityId: unknown,
    event: Event,
  ): Promise<void> {
    await loaded.events.append(clone(EventSchema, event));
  }

  /**
   * Complete persistence before scheduling best-effort stored-event dispatch.
   */
  async persistAggregateAndDispatch(
    loaded: LoadedAggregate,
    entityId: unknown,
    version: bigint,
    events: readonly Event[],
    dispatch: (event: Event) => Promise<void>,
    onPersisted: () => Promise<void> | void,
  ): Promise<() => Promise<void>> {
    const committed = await this.persistAggregateUpdate(loaded, entityId, version, events);
    if (!committed) return () => Promise.resolve();
    await onPersisted();
    return async () => {
      await Promise.all(
        events.map(async (event) => {
          try {
            await dispatch(event);
          } catch (error) {
            this.#runtime.recordDispatchFailure(event, error);
          }
        }),
      );
    };
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
      RepositoryTenants.storageContextForCommand(this.#runtime.context, this.#command),
    );
  }

  async run(replayedRoute?: RepositoryCommandRoute): Promise<EntityInboxFollowUp | undefined> {
    void RepositorySignals.requireCommandId(this.#command);

    const commandMessage = EntityInvocation.requireSignalMessage(this.#command.message, "command");
    const commandSchema = RepositoryRoutes.schemaForTypeUrl(
      this.#routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );
    const message = EntityInvocation.unpackRequired(commandMessage, commandSchema, "command");

    const route = replayedRoute ?? this.#repository.routeCommand(this.#command);
    const assignee = this.#routing.commandReadiness?.findCommandAssignee(route.messageFullTypeName);

    if (assignee === undefined) {
      return undefined;
    }

    const loaded = await this.#support.loadAggregate(route.entityId);
    HandlerDispatchPublisher.command(
      this.#runtime,
      this.#repository,
      this.#command,
      route.entityId,
    );
    const commandContext = EntityInvocation.commandHandlerContext(this.#command);
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
      return RepositorySignals.postRejectionEvent(
        this.#runtime,
        this.#repository,
        this.#command,
        route.entityId,
        error,
      );
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
    return await this.#support.persistAggregateAndDispatch(
      loaded,
      route.entityId,
      committedVersion,
      events,
      (event) => this.#runtime.dispatchStored(event),
      () => {
        if (!RepositoryEntities.repositoryChanged(loaded.entity)) return;
        EntityStateChangePublisher.command(
          this.#runtime,
          this.#repository,
          this.#command,
          route.entityId,
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

  async #invokeAssignee(
    entity: object,
    methodName: string,
    message: unknown,
    parameterCount: HandlerParameterCount,
    context: unknown,
  ): Promise<unknown> {
    transactionalEntityAccess.start(entity);
    try {
      const produced = await EntityInvocation.invokeEntityMethod(
        entity,
        methodName,
        message,
        parameterCount,
        context,
      );
      const commit = await commitFenced(entity, (current) =>
        transactionalEntityAccess.commit(current),
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
    const metadata = this.#runtime.signalMetadata.eventFromCommand(this.#command, sequence, {
      version: RepositorySignals.eventVersionNumber(version),
    });
    const bound =
      allowEnvelopes && EntityInvocation.isEventEnvelope(signal)
        ? clone(EventSchema, signal)
        : this.#packDomainEvent(signal, metadata);
    bound.context = RepositorySignals.eventContextWithProducer(
      metadata.context,
      this.#repository,
      entityId,
    );
    return bound;
  }

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
      RepositoryTenants.storageContextForEvent(this.#runtime.context, this.#event),
    );
  }

  async runTarget(entityId: unknown, acceptedRoute: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.reactors.length === 0 && intake.commanders.length === 0) {
      return;
    }

    await this.#postCommands(await this.#executeEntity(entityId, intake));
  }

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
    const reactors = this.#routing
      .eventReactors(route.messageFullTypeName, message, this.#event.context?.external === true)
      .filter((reactor) => RepositoryHandlers.handlerEmittedSchemas(reactor.handler).length > 0);
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
      const dispatch = await this.#support.persistAggregateAndDispatch(
        loaded,
        entityId,
        loaded.version + BigInt(produced.events.length),
        produced.events,
        (event) => this.#runtime.dispatchStoredFollowUp(event),
        () => {
          if (!RepositoryEntities.repositoryChanged(loaded.entity)) return;
          EntityStateChangePublisher.event(
            this.#runtime,
            this.#repository,
            this.#event,
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
            RepositorySignals.eventVersionNumber(loaded.version + BigInt(produced.events.length)),
          );
        },
      );
      void dispatch();
    }

    await this.#support.appendDiagnosticEvent(
      loaded,
      entityId,
      DispatchGuards.guardedJournalEvent(this.#repository, this.#event, entityId),
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
    const eventContext = EntityInvocation.eventHandlerContext(this.#event);
    const commands: Command[] = [];
    const events: Event[] = [];

    transactionalEntityAccess.start(loaded.entity);
    try {
      for (const commander of intake.commanders) {
        const produced = await EntityInvocation.invokeEntityMethod(
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

      if (intake.reactors.length > 0) {
        HandlerDispatchPublisher.reactor(this.#runtime, this.#repository, this.#event, entityId);
      }
      for (const reactor of intake.reactors) {
        const produced = await EntityInvocation.invokeEntityMethod(
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

      const commit = await commitFenced(loaded.entity, (current) =>
        transactionalEntityAccess.commit(current),
      );
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
    const typeName = EntityInvocation.messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(`Repository aggregate execution cannot pack event message "${typeName}".`);
    }

    const metadata = this.#runtime.signalMetadata.eventFromEvent(this.#event, sequence, {
      version: RepositorySignals.eventVersionNumber(version),
    });

    return create(EventSchema, {
      id: multiTarget
        ? create(EventIdSchema, {
            value:
              `${metadata.id.value}.target.` +
              encodeURIComponent(DispatchGuards.canonicalEntityIdKey(this.#repository, entityId)),
          })
        : metadata.id,
      message: AnyMessages.pack(schema, signal as never),
      context: RepositorySignals.eventContextWithProducer(
        metadata.context,
        this.#repository,
        entityId,
      ),
    });
  }

  #bindProducedCommands(produced: readonly unknown[]): readonly Command[] {
    let sequence = 0;

    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        const typeName = EntityInvocation.messageTypeName(signal);
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

type EntityLoadMode = "stored" | "rebuild";

class ProjectionEventExecution {
  readonly #repository: RepositoryView & {
    routeEvent(event: Event): RepositoryEventRoute;
  };
  readonly #routing: RepositoryRouting;
  readonly #runtime: RepositoryRuntime;
  readonly #event: Event;
  readonly #rebuild: boolean;

  constructor(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  static async runStateTarget(
    repository: RepositoryView & { routeEvent(event: Event): RepositoryEventRoute },
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

  async runTarget(entityId: unknown, acceptedRoute: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.subscribers.length === 0) {
      return;
    }

    await this.#executeTarget(entityId, intake.subscribers);
  }

  async runDirect(acceptedRoute?: RepositoryEventRoute): Promise<void> {
    const intake = this.#readIntake(acceptedRoute);

    if (intake.subscribers.length === 0) {
      return;
    }

    for (const entityId of intake.route.entityIds) {
      await this.#executeTarget(entityId, intake.subscribers);
    }
  }

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
    const version = BigInt(this.#event.context?.version?.number ?? 0);
    const lifecycle = RepositoryEntities.repositoryLifecycle(loaded.entity);
    const deferred = await standAccess.deferUpdate(
      this.#runtime.stand,
      this.#repository.stateSchema,
      state,
      RepositoryStand.standUpdateOptions(
        tenantOptions.tenantId,
        this.#event.context?.version,
        lifecycle,
      ),
    );
    try {
      const outcome = await loaded.commits.commit({
        context: loaded.storageInput.context,
        entity: loaded.storageInput,
        entityId,
        ...(loaded.current === undefined ? {} : { expected: loaded.current }),
        next: EntityRecords.pack(
          this.#repository.stateSchema,
          entityId,
          state,
          this.#event.context?.version ?? version,
          lifecycle,
        ),
        ...(RepositoryStorage.historyConfiguration(this.#repository).stateHistory
          ? {
              states: [
                EntityRecords.pack(
                  this.#repository.stateSchema,
                  entityId,
                  state,
                  this.#event.context?.version ?? version,
                  lifecycle,
                ),
              ],
            }
          : {}),
      });
      if (outcome !== "committed") {
        deferred.cancel();
        throw new Error("Concurrent Projection state commit conflict.");
      }
    } catch (error) {
      deferred.cancel();
      throw error;
    }
    try {
      deferred.notify();
    } catch (error) {
      this.#runtime.recordDispatchFailure(this.#event, error);
    }
    EntityStateChangePublisher.event(
      this.#runtime,
      this.#repository,
      this.#event,
      entityId,
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
      this.#event.context?.version?.number ?? 0,
    );
  }

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
    const entityType = this.#repository.entityType as unknown as new (options: {
      readonly id: unknown;
      readonly schema: DescriptorMessageSchema;
      readonly state: unknown;
      readonly version: unknown;
      readonly lifecycle: EntityLifecycleFlags;
    }) => object;

    const entity = new entityType({
      id: entityId,
      schema: this.#repository.stateSchema,
      state:
        stored === undefined || (mode === "rebuild" && stored.deleted)
          ? this.#defaultState(entityId)
          : stored.state,
      version:
        mode === "rebuild" && stored?.deleted
          ? 0
          : RepositoryStand.projectionVersion(stored?.version),
      lifecycle:
        mode === "rebuild" && stored?.deleted
          ? { archived: false, deleted: false }
          : { archived: stored?.archived ?? false, deleted: stored?.deleted ?? false },
    });
    const storageInput = RepositoryStorage.entityStorageInput(
      this.#repository,
      RepositoryTenants.storageContextForTenant(this.#runtime.context, options.tenantId),
    );
    const storage = RepositoryStorage.openRepositoryEntityStorage(
      this.#repository,
      this.#runtime.storageFactory,
      storageInput,
    );
    RepositoryHistoryInternals.bindEntityHistory(
      entity,
      storage,
      entityId,
      this.#repository.stateSchema,
    );
    return Object.freeze({
      commits: storage.commits,
      current:
        stored === undefined
          ? undefined
          : EntityRecords.pack(
              this.#repository.stateSchema,
              entityId,
              stored.state,
              stored.versionMessage,
              { archived: stored.archived, deleted: stored.deleted },
            ),
      entity,
      storageInput,
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
    const entityType = this.#repository.entityType as unknown as new (options: {
      readonly id: unknown;
      readonly schema: DescriptorMessageSchema;
      readonly state: unknown;
      readonly version: unknown;
      readonly lifecycle: EntityLifecycleFlags;
    }) => object;

    const entity = new entityType({
      id: entityId,
      schema: this.#repository.stateSchema,
      state: stored === undefined ? this.#defaultState(entityId) : stored.state,
      version: RepositoryStand.projectionVersion(stored?.version),
      lifecycle: { archived: stored?.archived ?? false, deleted: stored?.deleted ?? false },
    });
    const storageInput = RepositoryStorage.entityStorageInput(
      this.#repository,
      RepositoryTenants.storageContextForTenant(this.#runtime.context, options.tenantId),
    );
    const storage = RepositoryStorage.openRepositoryEntityStorage(
      this.#repository,
      this.#runtime.storageFactory,
      storageInput,
    );
    RepositoryHistoryInternals.bindEntityHistory(
      entity,
      storage,
      entityId,
      this.#repository.stateSchema,
    );
    return Object.freeze({
      commits: storage.commits,
      current:
        stored === undefined
          ? undefined
          : EntityRecords.pack(
              this.#repository.stateSchema,
              entityId,
              stored.state,
              stored.versionMessage,
              { archived: stored.archived, deleted: stored.deleted },
            ),
      entity,
      storageInput,
    });
  }

  async commit(
    loaded: LoadedRepositoryEntity,
    options: { readonly tenantId?: TenantId },
    createdAt: Timestamp,
    events: readonly Event[],
  ): Promise<boolean> {
    const changed = RepositoryEntities.repositoryChanged(loaded.entity);
    if (!changed && events.length === 0) return true;
    const entityId = (loaded.entity as { readonly id: unknown }).id;
    const state = RepositoryEntities.repositoryState(loaded.entity) as Message;
    const lifecycle = RepositoryEntities.repositoryLifecycle(loaded.entity);
    const version = changed
      ? BigInt(RepositoryStand.processManagerVersion(loaded.entity))
      : BigInt(loaded.current?.version?.number ?? 0);
    const deferred = changed
      ? await standAccess.deferUpdate(
          this.#runtime.stand,
          this.#repository.stateSchema,
          state,
          RepositoryStand.standUpdateOptions(
            options.tenantId,
            create(VersionSchema, { number: Number(version) }),
            lifecycle,
          ),
        )
      : undefined;
    try {
      const history = RepositoryStorage.historyConfiguration(this.#repository);
      const outcome = await loaded.commits.commit({
        context: loaded.storageInput.context,
        entity: loaded.storageInput,
        entityId,
        ...(loaded.current === undefined ? {} : { expected: loaded.current }),
        next: EntityRecords.pack(this.#repository.stateSchema, entityId, state, version, lifecycle),
        ...(changed && history.stateHistory
          ? {
              states: [
                EntityRecords.pack(
                  this.#repository.stateSchema,
                  entityId,
                  state,
                  create(VersionSchema, { number: Number(version), timestamp: createdAt }),
                  lifecycle,
                ),
              ],
            }
          : {}),
        ...(history.processManagerEventHistory
          ? {
              diagnostics: events.map((event) => clone(EventSchema, event)),
            }
          : {}),
      });
      if (outcome !== "committed") {
        deferred?.cancel();
        throw new Error("Concurrent Process Manager state commit conflict.");
      }
      entityStateHistoryCaches.get(loaded.entity)?.clear();
    } catch (error) {
      deferred?.cancel();
      throw error;
    }
    try {
      deferred?.notify();
    } catch (error) {
      this.#runtime.recordDispatchFailure(events[events.length - 1] ?? create(EventSchema), error);
    }
    return true;
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

  async run(replayedRoute?: RepositoryCommandRoute): Promise<EntityInboxFollowUp | undefined> {
    RepositorySignals.requireCommandId(this.#command);
    const commandMessage = EntityInvocation.requireSignalMessage(this.#command.message, "command");
    const commandSchema = RepositoryRoutes.schemaForTypeUrl(
      this.#routing.commandSchemas,
      commandMessage.typeUrl,
      "command",
    );
    const message = EntityInvocation.unpackRequired(commandMessage, commandSchema, "command");
    const route = replayedRoute ?? this.#repository.routeCommand(this.#command);
    const assignee = this.#routing.commandReadiness?.findCommandAssignee(route.messageFullTypeName);

    if (assignee === undefined) {
      return;
    }

    const tenantOptions = RepositoryTenants.commandStandOptions(
      this.#runtime.context,
      this.#command,
    );
    const loaded = await this.#support.load(route.entityId, tenantOptions);
    HandlerDispatchPublisher.command(
      this.#runtime,
      this.#repository,
      this.#command,
      route.entityId,
    );
    let eventSignals: readonly unknown[];
    try {
      eventSignals = await this.#invoke(loaded.entity, assignee, message);
    } catch (error) {
      if (!RejectionThrowable.is(error)) {
        throw error;
      }
      return RepositorySignals.postRejectionEvent(
        this.#runtime,
        this.#repository,
        this.#command,
        route.entityId,
        error,
      );
    }

    const events = this.#bindProducedEvents(eventSignals, route.entityId);
    const committed = await this.#support.commit(
      loaded,
      tenantOptions,
      RepositorySignals.executionTimestamp(),
      events,
    );
    if (!committed) return undefined;
    if (RepositoryEntities.repositoryChanged(loaded.entity)) {
      EntityStateChangePublisher.command(
        this.#runtime,
        this.#repository,
        this.#command,
        route.entityId,
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
        RepositoryStand.processManagerVersion(loaded.entity),
      );
    }
    this.#postEvents(events);
    return undefined;
  }

  async #invoke(
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
      const commit = await commitFenced(entity, (current) =>
        transactionalEntityAccess.commit(current),
      );
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
    const typeName = EntityInvocation.messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(
        `Repository process-manager execution cannot pack event message "${typeName}".`,
      );
    }

    const metadata = this.#runtime.signalMetadata.eventFromCommand(this.#command, sequence, {
      version: RepositoryStand.processManagerProducedVersion(sequence),
    });

    return create(EventSchema, {
      id: metadata.id,
      message: AnyMessages.pack(schema, signal as never),
      context: RepositorySignals.eventContextWithProducer(
        metadata.context,
        this.#repository,
        entityId,
      ),
    });
  }

  #postEvents(events: readonly Event[]): void {
    for (const event of events) {
      // spine-log-boundary: server.repository_event_follow_up
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
    const produced = await this.#invokeHandlers(entityId, loaded.entity, intake);

    const events = this.#bindProducedEvents(produced.events, entityId);
    const diagnostics = [
      DispatchGuards.guardedJournalEvent(this.#repository, this.#event, entityId),
      ...events,
    ];
    const committed = await this.#support.commit(
      loaded,
      tenantOptions,
      this.#event.context?.timestamp ?? create(TimestampSchema),
      diagnostics,
    );
    if (!committed) return;
    if (RepositoryEntities.repositoryChanged(loaded.entity)) {
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
        RepositoryStand.processManagerVersion(loaded.entity),
      );
    }
    this.#postEvents(events);
    await this.#postCommands(this.#bindProducedCommands(produced.commands));
  }

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

  async #invokeHandlers(
    entityId: unknown,
    entity: object,
    intake: {
      readonly message: unknown;
      readonly reactors: readonly RegisteredHandlerMetadata<EventReactionHandlerMetadata>[];
      readonly commanders: readonly RegisteredHandlerMetadata<CommandReactionHandlerMetadata>[];
    },
  ): Promise<{ readonly commands: readonly unknown[]; readonly events: readonly unknown[] }> {
    const eventContext = EntityInvocation.eventHandlerContext(this.#event);
    const commands: unknown[] = [];
    const events: unknown[] = [];

    transactionalEntityAccess.start(entity);
    try {
      if (intake.reactors.length > 0) {
        HandlerDispatchPublisher.reactor(this.#runtime, this.#repository, this.#event, entityId);
      }
      for (const reactor of intake.reactors) {
        const produced = await EntityInvocation.invokeEntityMethod(
          entity,
          reactor.handler.methodName,
          intake.message,
          reactor.handler.parameterCount,
          eventContext,
        );
        events.push(...this.#support.normalizeProducedSignals(produced));
      }

      for (const commander of intake.commanders) {
        const produced = await EntityInvocation.invokeEntityMethod(
          entity,
          commander.handler.methodName,
          intake.message,
          commander.handler.parameterCount,
          eventContext,
        );
        commands.push(...this.#support.normalizeProducedSignals(produced));
      }

      const commit = await commitFenced(entity, (current) =>
        transactionalEntityAccess.commit(current),
      );
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
    const typeName = EntityInvocation.messageTypeName(signal);
    const schema = this.#routing.producedEventSchemas.find(
      (candidate) => candidate.typeName === typeName,
    );

    if (schema === undefined) {
      throw new Error(
        `Repository process-manager execution cannot pack event message "${typeName}".`,
      );
    }

    const metadata = this.#runtime.signalMetadata.eventFromEvent(this.#event, sequence, {
      version: RepositoryStand.processManagerProducedVersion(sequence),
    });

    return create(EventSchema, {
      id: metadata.id,
      message: AnyMessages.pack(schema, signal as never),
      context: RepositorySignals.eventContextWithProducer(
        metadata.context,
        this.#repository,
        entityId,
      ),
    });
  }

  #bindProducedCommands(produced: readonly unknown[]): readonly Command[] {
    let sequence = 0;
    return Object.freeze(
      produced.map((signal) => {
        sequence += 1;
        const typeName = EntityInvocation.messageTypeName(signal);
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
      // spine-log-boundary: server.process_manager_event_follow_up
      void this.#runtime.postEventFollowUp(event).catch((error: unknown) => {
        this.#runtime.recordDispatchFailure(event, error);
      });
    }
  }
}

/**
 * Internal structural provider seam shared by the memory, Datastore, and MySQL factories.
 */
interface EntityStorageFactory {
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): {
    readonly current: EntityRecordStorage<I>;
    readonly states: EntityStateHistoryPort<I, S>;
    readonly events: EntityEventHistoryPort<I>;
    close(): void;
  };
}

interface RepositoryEntityStorage<I, S extends Message> {
  readonly current: EntityRecordStorage<I>;
  readonly states: EntityStateHistoryPort<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  readonly commits: EntityCommitStorage;
  close(): void;
}

interface RoutableId {
  readonly id: unknown;
  readonly value: string | number | bigint | boolean;
}

/**
 * Internal repository identity operations.
 */
const RepositoryIdentity = {
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

  isRepositoryOptionsObject(options: unknown): options is object {
    return typeof options === "object" && options !== null;
  },

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
   * Resolves the runtime family of a repository-owned entity constructor.
   *
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

  safeStringProperty(value: object, propertyName: "name" | "typeName"): string | undefined {
    try {
      const property = (value as Record<typeof propertyName, unknown>)[propertyName];
      return typeof property === "string" ? property : undefined;
    } catch {
      return undefined;
    }
  },

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
  isEventEnvelope(signal: unknown): signal is Event {
    return (
      typeof signal === "object" &&
      signal !== null &&
      (signal as { readonly $typeName?: unknown }).$typeName === EventSchema.typeName
    );
  },

  messageTypeName(message: unknown): string {
    const typeName = (message as { readonly $typeName?: unknown }).$typeName;

    if (typeof typeName !== "string" || typeName.length === 0) {
      throw new Error("Repository aggregate execution requires a generated event message.");
    }

    return typeName;
  },

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

  commandHandlerContext(command: Command): NonNullable<Command["context"]> {
    return command.context === undefined
      ? create(CommandContextSchema)
      : clone(CommandContextSchema, command.context);
  },

  eventHandlerContext(event: Event): NonNullable<Event["context"]> {
    return event.context === undefined
      ? create(EventContextSchema)
      : clone(EventContextSchema, event.context);
  },

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
  repositoryState(entity: object): unknown {
    return (entity as { readonly state: unknown }).state;
  },

  repositoryLifecycle(entity: object): {
    readonly archived: boolean;
    readonly deleted: boolean;
  } {
    return (
      entity as { readonly lifecycle: { readonly archived: boolean; readonly deleted: boolean } }
    ).lifecycle;
  },

  repositoryChanged(entity: object): boolean {
    return (entity as { readonly changed?: unknown }).changed === true;
  },
};
Object.freeze(RepositoryEntities);

/**
 * Internal repository signals operations.
 */
const RepositorySignals = {
  readEventVersion(event: Event): bigint {
    const number = event.context?.version?.number;

    if (number === undefined) {
      throw new Error("Repository aggregate execution requires readable event versions.");
    }

    return BigInt(number);
  },

  eventVersionNumber(version: bigint): number {
    if (version > 2_147_483_647n || version < -2_147_483_648n) {
      throw new Error(
        "Repository aggregate execution requires versions in the protobuf int32 range.",
      );
    }

    return Number(version);
  },

  eventContextWithProducer(
    context: NonNullable<Event["context"]>,
    repository: RepositoryView,
    entityId: unknown,
  ): NonNullable<Event["context"]> {
    const producerId = EntityIds.pack(repository.stateSchema, entityId);
    return create(EventContextSchema, { ...context, producerId });
  },

  postRejectionEvent(
    runtime: RepositoryRuntime,
    repository: RepositoryView,
    command: Command,
    entityId: unknown,
    rejection: RejectionThrowable,
  ): EntityInboxFollowUp {
    runtime.registerEventSchema(rejection.schema);
    const metadata = runtime.signalMetadata.eventFromCommand(command, 1, {});
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
        await runtime.postEventFollowUp(event);
      } catch (error) {
        runtime.recordDispatchFailure(event, error);
      }
    };
  },

  requireCommandId(command: Command): NonNullable<Command["id"]> {
    if (command.id === undefined || command.id.uuid.trim().length === 0) {
      throw new Error("Repository aggregate execution requires command.id to bind event origins.");
    }

    return command.id;
  },

  requireEventId(event: Event): NonNullable<Event["id"]> {
    if (event.id === undefined || event.id.value.trim().length === 0) {
      throw new Error("Repository projection inbox handoff requires event.id.");
    }

    return event.id;
  },

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
      (ordinal) =>
        runtime.signalMetadata.eventFromCommand(command, ordinal, {
          version,
        }),
      {
        id: AnyMessages.pack(CommandIdSchema, command.id as never),
        typeUrl: command.message?.typeUrl ?? "",
      },
      { repository, entityId, oldState, oldLifecycle, newState, lifecycle, version },
    );
  }

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
      (ordinal) =>
        runtime.signalMetadata.eventFromEvent(source, ordinal, {
          version,
        }),
      {
        id: AnyMessages.pack(EventIdSchema, source.id as never),
        typeUrl: source.message?.typeUrl ?? "",
      },
      { repository, entityId, oldState, oldLifecycle, newState, lifecycle, version },
    );
  }

  #publish(
    runtime: RepositoryRuntime,
    metadataFor: (ordinal: number) => ReturnType<SignalMetadata["eventFromCommand"]>,
    origin: EventOrigin,
    change: EntityCommitChange,
  ): void {
    const drafts = this.#drafts(origin, change);
    drafts.forEach((draft, ordinal) => {
      const metadata = metadataFor(ordinal);
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

  #drafts(origin: EventOrigin, change: EntityCommitChange): readonly SystemEventDraft[] {
    const fields = this.#fields(origin, change);
    const archive = this.#archiveDraft(fields, change);
    const deletion = this.#deleteDraft(fields, change);
    return [...this.#stateDrafts(fields, change), archive, deletion].filter(
      (draft): draft is SystemEventDraft => draft !== undefined,
    );
  }

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

  #post(runtime: RepositoryRuntime, event: Event): void {
    try {
      // spine-log-boundary: server.repository_system_follow_up
      void runtime.postSystemFollowUp(event).catch((error: unknown) => {
        runtime.recordDispatchFailure(event, error);
      });
    } catch (error) {
      runtime.recordDispatchFailure(event, error);
    }
  }

  #sameState(schema: MessageSchema, left: Message, right: Message): boolean {
    const leftBytes = toBinary(schema, left as never);
    const rightBytes = toBinary(schema, right as never);
    return (
      leftBytes.length === rightBytes.length &&
      leftBytes.every((value, index) => value === rightBytes[index])
    );
  }

  #kind(kind: EntityMetadata["kind"]): number {
    return kind === "aggregate"
      ? EntityOption_Kind.AGGREGATE
      : kind === "projection"
        ? EntityOption_Kind.PROJECTION
        : EntityOption_Kind.PROCESS_MANAGER;
  }

  #packEntityId(repository: RepositoryView, entityId: unknown) {
    return EntityIds.pack(repository.stateSchema, entityId);
  }
}
const EntityStateChangePublisher = Object.freeze(new EntityStateChangePublishing());

/**
 * Builds and best-effort dispatches accepted handler diagnostics.
 */
class HandlerDispatchPublishing {
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
      runtime.recordDispatchFailure(create(EventSchema), error);
    }
  }

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
      runtime.recordDispatchFailure(create(EventSchema), error);
    }
  }

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
      void runtime.postSystemFollowUp(event).catch((error: unknown) => {
        runtime.recordDispatchFailure(event, error);
      });
    } catch (error) {
      runtime.recordDispatchFailure(event, error);
    }
  }

  #packEntityId(repository: RepositoryView, entityId: unknown): Any {
    return EntityIds.pack(repository.stateSchema, entityId);
  }

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

  projectionVersion(version: Version | bigint | undefined): number {
    return typeof version === "bigint" ? Number(version) : (version?.number ?? 0);
  },

  processManagerVersion(entity: object): number {
    const version = (entity as { readonly version?: unknown }).version;

    return typeof version === "number" ? version + 1 : 1;
  },

  processManagerProducedVersion(sequence: number): number {
    return sequence;
  },
};
Object.freeze(RepositoryStand);

/**
 * Internal repository tenants operations.
 */
const RepositoryTenants = {
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

  readCommandTenant(command: Command): TenantId | undefined {
    return RepositoryTenants.tenantValue(command.context?.actorContext?.tenantId);
  },

  standTenantOptions(context: StorageMode, event: Event): { readonly tenantId?: TenantId } {
    if (!context.multitenant) {
      return {};
    }

    const tenantId = RepositoryTenants.readEventTenant(event);
    return tenantId === undefined ? {} : { tenantId };
  },

  commandStandOptions(context: StorageMode, command: Command): { readonly tenantId?: TenantId } {
    if (!context.multitenant) {
      return {};
    }

    const tenantId = RepositoryTenants.readCommandTenant(command);
    return tenantId === undefined ? {} : { tenantId };
  },

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

  tenantValue(tenantId: TenantId | undefined): TenantId | undefined {
    return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
  },

  require(tenantId: TenantId): TenantId {
    return TenantBoundary.from(tenantId).tenantId;
  },

  equal(left: TenantId, right: TenantId): boolean {
    return TenantBoundary.from(left).key === TenantBoundary.from(right).key;
  },
};
Object.freeze(RepositoryTenants);

/**
 * Internal repository handlers operations.
 */
const RepositoryHandlers = {
  normalizeHandlers(handlersOption: RepositoryHandlersOption): readonly EntityHandlersMetadata[] {
    if (handlersOption === undefined) {
      return Object.freeze([]);
    }
    if (RepositoryHandlers.isHandlersArray(handlersOption)) {
      return Object.freeze([...handlersOption]);
    }
    return Object.freeze([handlersOption]);
  },

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

  forOrigin<Value extends { readonly handler: { readonly origin: "domestic" | "external" } }>(
    values: readonly Value[],
    external: boolean,
  ): readonly Value[] {
    return Object.freeze(
      values.filter((value) => (value.handler.origin === "external") === external),
    );
  },

  readinessMap<Value>(
    schemas: readonly MessageSchema[],
    find: (typeName: string) => readonly Value[],
  ): ReadonlyMap<string, readonly Value[]> {
    return new Map(schemas.map((schema) => [schema.typeName, find(schema.typeName)]));
  },

  handlerEmittedSchemas(
    handler:
      | CommandAssignmentHandlerMetadata
      | CommandReactionHandlerMetadata
      | EventReactionHandlerMetadata,
  ): readonly DescriptorMessageSchema[] {
    return HandlerMetadataValues.emittedSchemas(handler);
  },

  isHandlersArray(value: RepositoryHandlersOption): value is readonly EntityHandlersMetadata[] {
    return Array.isArray(value);
  },

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
    }
  },

  uniqueSchemas(schemas: readonly MessageSchema[]): readonly MessageSchema[] {
    const byTypeUrl = new Map<string, MessageSchema>();
    for (const schema of schemas) {
      byTypeUrl.set(TypeUrls.derive(schema), schema);
    }
    return Object.freeze([...byTypeUrl.values()]);
  },

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
    const handlers = RepositoryHandlers.normalizeHandlers(handlersOption);
    RepositoryHandlers.validateHandlers(entityType, metadata, handlers);
    const commandReadiness =
      handlers.length === 0 ? undefined : CommandRegistrationReadiness.fromEntityHandlers(handlers);
    const eventReadiness =
      handlers.length === 0 ? undefined : EventRegistrationReadiness.fromEntityHandlers(handlers);
    const commandSchemas = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) =>
        handler.commandAssignments.map((assignment) => assignment.schema),
      ),
    );
    const eventSchemas = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) => [
        ...handler.commandReactions.map((reaction) => reaction.schema),
        ...handler.eventSubscriptions.map((subscription) => subscription.schema),
        ...handler.eventReactions.map((reaction) => reaction.schema),
        // Applications remain valid routing metadata. Aggregate persistence does
        // not invoke them to reconstruct or mutate state.
        ...handler.eventApplications.map((application) => application.schema),
      ]),
    );
    const externalEventSchemas = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) =>
        handler.handlers
          .filter(
            (candidate) =>
              candidate.origin === "external" &&
              (candidate.kind === "event-subscription" ||
                candidate.kind === "event-reaction" ||
                candidate.kind === "command-reaction"),
          )
          .map((candidate) => candidate.schema),
      ),
    );
    const stateSchemas = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) =>
        handler.stateSubscriptions.map((subscription) => subscription.schema),
      ),
    ) as readonly DescriptorMessageSchema[];
    if (entityFamily !== "projection" && stateSchemas.length > 0) {
      throw new Error("Entity state subscriptions are supported only by Projection repositories.");
    }
    if (stateSchemas.some((schema) => schema.typeName === metadata.schema.typeName)) {
      throw new Error(
        "A Projection cannot subscribe to updates of its repository state because each " +
          "resulting update would be routed back to the same repository.",
      );
    }
    const stateSubscriptions = RepositoryRoutes.stateSubscriptions(handlers);
    const producedEventSchemas = RepositoryHandlers.uniqueSchemas([
      ...producedEvents,
      ...handlers.flatMap((handler) => [
        ...handler.commandAssignments.flatMap((assignment) =>
          RepositoryHandlers.handlerEmittedSchemas(assignment),
        ),
        ...handler.eventReactions.flatMap((reaction) =>
          RepositoryHandlers.handlerEmittedSchemas(reaction),
        ),
      ]),
    ]);
    const producedCommandSchemas = RepositoryHandlers.uniqueSchemas(
      handlers.flatMap((handler) =>
        handler.commandReactions.flatMap((reaction) =>
          RepositoryHandlers.handlerEmittedSchemas(reaction),
        ),
      ),
    );
    const commandReactions = RepositoryHandlers.createCommandReactionMap(handlers);
    const eventSubscribers = RepositoryHandlers.readinessMap(
      eventSchemas,
      (typeName) => eventReadiness?.findEventSubscribers(typeName) ?? [],
    );
    const eventReactors = RepositoryHandlers.readinessMap(
      eventSchemas,
      (typeName) => eventReadiness?.findEventReactors(typeName) ?? [],
    );
    const commandReactionFilters = RepositoryHandlers.createEventFilterPlans(
      commandReactions,
      stringifiers,
    );
    const eventSubscriberFilters = RepositoryHandlers.createEventFilterPlans(
      eventSubscribers,
      stringifiers,
    );
    const eventReactorFilters = RepositoryHandlers.createEventFilterPlans(
      eventReactors,
      stringifiers,
    );
    const commandRoutes = RepositoryRoutes.resolveCommandRoutes(commandSchemas, commandRouting);
    const eventRoutes = RepositoryRoutes.resolveEventRoutes(eventSchemas, eventRouting);
    const stateRoutes = RepositoryRoutes.resolveStateRoutes(
      stateSchemas,
      stateUpdateRouting,
      metadata.idField,
    );

    return Object.freeze({
      commandSchemas,
      eventSchemas,
      externalEventSchemas,
      producedEventSchemas,
      producedCommandSchemas,
      commandReadiness,
      eventReadiness,
      stateSchemas,
      stateSubscriptions,
      commandReactions: (eventFullTypeName: string, message: unknown, external: boolean) =>
        RepositoryHandlers.forOrigin(
          commandReactionFilters.get(eventFullTypeName)?.select(message) ?? Object.freeze([]),
          external,
        ),
      eventReactors: (eventFullTypeName: string, message: unknown, external: boolean) =>
        RepositoryHandlers.forOrigin(
          eventReactorFilters.get(eventFullTypeName)?.select(message) ?? Object.freeze([]),
          external,
        ),
      eventSubscribers: (eventFullTypeName: string, message: unknown, external: boolean) =>
        RepositoryHandlers.forOrigin(
          eventSubscriberFilters.get(eventFullTypeName)?.select(message) ?? Object.freeze([]),
          external,
        ),
      routeCommand: (command: Command) =>
        RepositoryRoutes.routeCommand<RepositoryEntityId<EntityType>>(
          command,
          commandReadiness,
          commandSchemas,
          metadata.idField,
          commandRoutes,
        ),
      routeEvent: (event: Event) =>
        RepositoryRoutes.routeEvent<RepositoryEntityId<EntityType>>(
          event,
          eventReadiness,
          commandReactions,
          eventSchemas,
          metadata.idField,
          eventRoutes,
        ),
      routeStateUpdate: (event: Event) =>
        RepositoryRoutes.routeStateUpdate<RepositoryEntityId<EntityType>>(
          event,
          stateSchemas,
          stateSubscriptions,
          metadata.idField,
          stateRoutes,
        ),
    });
  },

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
      entityId: RepositoryRoutes.readRouteId(candidateId, targetIdField, "command").id as Id,
      messageFullTypeName: schema.typeName,
      invocation: "deferred",
    });
  },

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
    const interested = Object.freeze(
      (subscriptions.get(update?.schema.typeName ?? "") ?? []).filter(
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
      const id = RepositoryRoutes.readRouteId(candidate, targetIdField, "state update").id as Id;
      const key = InboxTargets.key(InboxMessages.inboxTargetId(id, targetIdField));
      if (!unique.has(key)) unique.set(key, structuredClone(id));
    }
    return Object.freeze([...unique.values()]);
  },

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
      const id = RepositoryRoutes.readRouteId(candidate, targetIdField, "event").id as Id;
      const key = InboxTargets.key(InboxMessages.inboxTargetId(id, targetIdField));
      if (!unique.has(key)) unique.set(key, structuredClone(id));
    }
    return Object.freeze([...unique.values()]);
  },

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
    return RepositoryRoutes.readRouteId(value, targetIdField, signalKind).id;
  },

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

  isBlankRouteId(value: unknown): boolean {
    const id = PrimitiveIds.readFinite(value) ?? MessageIds.readValue(value);

    return typeof id === "string" && id.trim().length === 0;
  },

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
      return RepositoryRoutes.readRouteId(compatibleProducer.id, targetIdField, "event").id;
    }
    return RepositoryRoutes.readRouteId(
      RepositoryRoutes.readFirstFieldId(message, schema, "event"),
      targetIdField,
      "event",
    ).id;
  },

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

  readRouteId(
    value: unknown,
    targetIdField: DescriptorFieldMetadata,
    signalKind: "command" | "event" | "state update",
  ): RoutableId {
    const descriptor = targetIdField.descriptor;
    if (descriptor.fieldKind === "message") {
      return RepositoryRoutes.readMessageRouteId(value, descriptor.message.typeName, signalKind);
    }
    if (descriptor.fieldKind === "scalar") {
      return RepositoryRoutes.readPrimitiveRouteId(value, descriptor.scalar, signalKind);
    }
    throw new Error(`Repository ${signalKind} routing requires a scalar or message-valued ID.`);
  },

  readMessageRouteId(
    value: unknown,
    targetTypeName: string,
    signalKind: "command" | "event" | "state update",
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
  },

  readPrimitiveRouteId(
    value: unknown,
    targetType: ScalarType,
    signalKind: "command" | "event" | "state update",
  ): RoutableId {
    const messageValue = MessageIds.readValue(value);
    const candidate = messageValue ?? value;
    const id = RepositoryRoutes.readCompatiblePrimitiveId(candidate, targetType);
    if (id === undefined) {
      throw new Error(
        `Repository ${signalKind} routing requires an ID compatible with the Entity state.`,
      );
    }

    return Object.freeze({
      id,
      value: id,
    });
  },

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

  historyConfiguration(repository: RepositoryView): RepositoryHistoryConfiguration {
    const configuration = repositoryHistoryConfigurations.get(repository);
    if (configuration === undefined)
      throw new Error("Repository history configuration is unavailable.");
    return configuration;
  },

  /**
   * In-process bounded duplicate guard. Completion is recorded only after a successful execution;
   * therefore provider/journal failures may be retried and separate machines remain independent.
   */
};
Object.freeze(RepositoryStorage);

/**
 * Internal repository history internals operations.
 */
const RepositoryHistoryInternals = {
  bindEntityHistory(
    entity: object,
    storage: ReturnType<EntityStorageFactory["createEntityStorage"]>,
    entityId: unknown,
    schema: DescriptorMessageSchema,
  ): void {
    const stateCache = RepositoryHistoryInternals.createHistoryCache(
      (depth, startingFromVersion) => storage.states.backward(entityId, depth, startingFromVersion),
      (record) => BigInt(EntityRecords.unpack(schema, record).versionMessage.number),
      { requireContiguousVersions: true },
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
   * Creates a per-live-entity continuation cache that serializes a larger request behind a prior read.
   *
   * @internal Shared repository history-cache implementation, exercised by repository tests.
   */

  createHistoryCache<T>(
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
        // spine-log-boundary: server.repository_history_prefetch
        continuation = next.catch(() => undefined);
        await next;
        return result ?? entries.slice(0, depth);
      },
      clear,
    });
  },

  cloneHistoryState(state: Message | undefined): Message | undefined {
    return state === undefined ? undefined : Object.freeze(structuredClone(state));
  },

  freezeHistoryStates(states: readonly Message[]): readonly Message[] {
    return Object.freeze(states.map((state) => Object.freeze(structuredClone(state))));
  },

  freezeHistoryEvents(events: readonly Event[]): readonly Event[] {
    return Object.freeze(events.map((event) => Object.freeze(clone(EventSchema, event))));
  },
};
Object.freeze(RepositoryHistoryInternals);

/**
 * Internal dispatch guards operations.
 */
const DispatchGuards = {
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
    DispatchGuards.touchGuardLane(guards, key);
    const activeGuard = guard;
    activeGuard.active += 1;
    const previous = activeGuard.chain;
    const next = previous.then(async () => {
      if (activeGuard.completed.has(eventId)) return;
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
        DispatchGuards.rememberGuardCompletion(activeGuard, eventId, depth);
        return;
      }
      await dispatch();
      DispatchGuards.rememberGuardCompletion(activeGuard, eventId, depth);
    });
    // spine-log-boundary: server.repository_dispatch_guard
    activeGuard.chain = next
      .catch(() => undefined)
      .finally(() => {
        activeGuard.active -= 1;
        DispatchGuards.trimGuardLanes(guards, depth);
      });
    return next;
  },

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

  touchGuardLane(guards: RepositoryDispatchGuards, key: string): void {
    const index = guards.order.indexOf(key);
    if (index >= 0) guards.order.splice(index, 1);
    guards.order.push(key);
  },

  trimGuardLanes(guards: RepositoryDispatchGuards, depth: number): void {
    while (guards.order.length > depth) {
      const key = guards.order[0];
      if (key === undefined) return;
      const guard = guards.lanes.get(key);
      if (guard?.active !== 0) return;
      guards.order.shift();
      guards.lanes.delete(key);
    }
  },

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

  guardedJournalEventId(sourceId: string, entityKey: string): string {
    return `${sourceId}.guard.${encodeURIComponent(entityKey)}`;
  },

  canonicalEntityIdKey(repository: RepositoryView, id: unknown): string {
    return InboxTargets.key(InboxMessages.inboxTargetId(id, repository.idField));
  },
};
Object.freeze(DispatchGuards);

/**
 * Internal inbox messages operations.
 */
const InboxMessages = {
  inboxTargetId(entityId: unknown, idField: DescriptorFieldMetadata): Any {
    if (idField.descriptor.fieldKind === "message") {
      return Identifiers.pack(idField.descriptor.message as MessageSchema, entityId as never);
    }
    if (typeof entityId === "string") return Identifiers.pack("string", entityId);
    if (typeof entityId === "number") return Identifiers.pack("int32", entityId);
    if (typeof entityId === "bigint") return Identifiers.pack("int64", entityId);
    throw new Error("Repository Entity Inbox handoff requires a supported target ID.");
  },

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
    return RepositoryRoutes.readRouteId(entityId, idField, "command").id;
  },

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

  readPmInboxEvent(message: InboxMessage): Event {
    return InboxMessages.readStoredEvent(
      message,
      "REACT_UPON_EVENT",
      "Entity Inbox replay",
      "Entity Inbox replay requires a readable stored event.",
    );
  },

  readProjectionInboxEvent(message: InboxMessage): Event {
    return InboxMessages.readStoredEvent(
      message,
      "UPDATE_SUBSCRIBER",
      "Projection inbox replay",
      "Projection inbox replay requires a readable stored event.",
    );
  },

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
 * Internal inbox replay operations.
 */
const InboxReplay = {
  async replayAggregateCommand(
    repository: RepositoryView & {
      routeCommand(command: Command): RepositoryCommandRoute;
    },
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

  async replayPmInbox(
    repository: RepositoryView & {
      routeCommand(command: Command): RepositoryCommandRoute;
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  async replayProcessManagerCommand(
    repository: RepositoryView & {
      routeCommand(command: Command): RepositoryCommandRoute;
    },
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

  async replayProcessManagerEvent(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  async replayProjectionEvent(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  async replayProjectionMessage(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  async replayProjectionStateUpdate(
    repository: RepositoryView & { routeEvent(event: Event): RepositoryEventRoute },
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
      (routing.stateSubscriptions
        .get(update.schema.typeName)
        ?.some(
          (subscriber) =>
            (subscriber.handler.origin === "external") === (event.context?.external === true),
        ) ?? false) === false
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
        (routing.stateSubscriptions.get(schema.typeName) ?? []).filter(
          (subscriber) =>
            (subscriber.handler.origin === "external") === (event.context?.external === true),
        ),
      ),
      invocation: "deferred",
    });
  },
};
Object.freeze(InboxReplay);

/**
 * Internal inbox handoff operations.
 */
const InboxHandoff = {
  async handoffEntityCommand(
    repository: RepositoryView & {
      routeCommand(command: Command): RepositoryCommandRoute;
    },
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
 * Internal repository dispatch operations.
 */
const RepositoryDispatch = {
  createRepositoryDispatchers(
    repository: RepositoryView & {
      routeCommand(command: Command): RepositoryCommandRoute;
      routeEvent(event: Event): RepositoryEventRoute;
    },
    routing: RepositoryRouting,
  ): RepositoryDispatchers {
    const acceptedEventRoutes = new WeakMap<Event, RepositoryEventRoute>();
    const acceptedStateRoutes = new WeakMap<Event, RepositoryStateUpdateRoute | null>();
    return Object.freeze({
      command:
        routing.commandSchemas.length === 0
          ? undefined
          : Object.freeze({
              messageSchemas: () => routing.commandSchemas,
              dispatch: (command: Command): Promise<void> =>
                RepositoryDispatch.dispatchRepositoryCommand(repository, routing, command),
            }),
      event: (() => {
        if (routing.eventSchemas.length === 0) return undefined;
        const dispatcher = Object.freeze({
          messageSchemas: () => routing.eventSchemas,
          externalEventSchemas: () => routing.externalEventSchemas,
          accept: (event: Event): Promise<void> => {
            acceptedEventRoutes.set(event, repository.routeEvent(event));
            return Promise.resolve();
          },
          dispatch: (event: Event): Promise<void> => {
            const acceptedRoute = acceptedEventRoutes.get(event);
            acceptedEventRoutes.delete(event);
            return RepositoryDispatch.dispatchRepositoryEvent(
              repository,
              routing,
              event,
              acceptedRoute,
            );
          },
        });
        return EventDispatcherOriginSchemas.define(
          dispatcher,
          routing.eventSchemas,
          routing.externalEventSchemas,
        );
      })(),
      systemEvent:
        routing.stateSchemas.length === 0
          ? undefined
          : Object.freeze({
              messageSchemas: () => Object.freeze([EntityLog.EntityStateChangedSchema]),
              accept: (event: Event): Promise<void> => {
                acceptedStateRoutes.set(event, routing.routeStateUpdate(event) ?? null);
                return Promise.resolve();
              },
              dispatch: (event: Event): Promise<void> => {
                const route = acceptedStateRoutes.get(event);
                acceptedStateRoutes.delete(event);
                if (route === null) return Promise.resolve();
                return RepositoryDispatch.dispatchRepositoryStateUpdate(
                  repository,
                  routing,
                  event,
                  route,
                );
              },
            }),
    });
  },

  createEntityInboxTarget(
    repository: RepositoryView & {
      routeCommand(command: Command): RepositoryCommandRoute;
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  createProjectionInboxTarget(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  createProjectionDirectDispatch(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
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

  async dispatchRepositoryEvent(
    repository: RepositoryView & {
      routeEvent(event: Event): RepositoryEventRoute;
    },
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
      case "aggregate": {
        const execution = new AggregateEventExecution(repository, routing, runtime, event);
        for (const entityId of route.entityIds) {
          await DispatchGuards.guardedEntityEventDispatch(
            repository,
            runtime,
            event,
            entityId,
            () => execution.runTarget(entityId, route),
          );
        }
        return;
      }
      case "process-manager":
        await new ProcessManagerEventExecution(repository, routing, runtime, event).run(route);
        return;
      case "projection":
        await new ProjectionEventExecution(repository, routing, runtime, event).run(route);
        return;
    }
  },

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

  async dispatchRepositoryCommand(
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
   * @typeParam Entry - The history entry type.
   * @param load Loads entries before an optional continuation version.
   * @param versionOf Reads the optional version carried by an entry.
   * @param options Selects contiguous-version and complete-group behavior.
   * @returns A cache with read and clear operations.
   */
  createCache<Entry>(
    load: (depth: number, startingFromVersion?: bigint) => Promise<readonly Entry[]>,
    versionOf: (entry: Entry) => bigint | undefined,
    options: {
      readonly requireContiguousVersions?: boolean;
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
