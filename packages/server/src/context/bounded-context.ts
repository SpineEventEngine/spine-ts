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

import { constants as fsConstants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ILogLayer } from "loglayer";

import { clone, create, getOption, hasOption, type Message } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import { TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import {
  EventSchema,
  BoundedContextNameSchema,
  TenantIdSchema,
  type Command,
  type Event,
  type TenantId,
} from "@spine-event-engine/proto";
import { SPI_type, internal_all, internal_type } from "@spine-event-engine/proto";
import {
  ColumnTypes,
  EventStore,
  InMemoryStorageFactory,
  RecordColumn,
  TenantBoundary,
  type StorageContext,
  type StorageFactory,
  type StorageMode,
} from "@spine-event-engine/storage";

import { CommandBus, commandBusAccess } from "../bus/command-bus.js";
import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import {
  EventBus,
  eventBusAccess,
  type EventSubscriber,
  type EventSubscription,
} from "../bus/event-bus.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import {
  type DeliveryEndpoint,
  DeliveryReadiness,
  type DeliveryReady,
  type OnDeliveryReady,
} from "./local-inbox-handoff.js";
import { LocalEntityInbox } from "./entity-inbox.js";
import { LocalProjectionInbox } from "./projection-handoff.js";
import { TenantIndexes, type TenantIndex } from "./tenant-index.js";
import {
  Repository,
  repositoryAccess,
  type ConcreteRepositoryEntityType,
  type EntityInbox,
  type RepositoryEntityType,
  type RepositoryIdentitySnapshot,
  type RepositoryOptions,
  type EntityInboxTarget,
  type ProjectionInbox,
  type ProjectionInboxTarget,
  type RepositoryView,
} from "../repository/repository.js";
import type {
  DescriptorMessageSchema,
  DescriptorFieldMetadata,
  EntityMetadata,
} from "../entity/entity-metadata.js";
import { GeneratedRegistryDiscovery } from "../handler/generated-registry-discovery.js";
import {
  HandlerRegistryIngestor,
  type GeneratedEntityHandlerGroup,
  type GeneratedHandlerRegistry,
} from "../handler/generated-handler-registry.js";
import {
  HandlerMetadataRegistry,
  type EntityHandlersMetadata,
} from "../handler/handler-metadata.js";
import { SignalMetadata } from "../runtime/signal-metadata.js";
import { Stand } from "../stand/stand.js";
import { SubscriptionRuntime, subscriptionRuntimeAccess } from "../stand/subscription-runtime.js";
import {
  StorageSubscriptionRegistry,
  type StandSubscriptionRegistry,
} from "../stand/subscription-registry.js";
import type { DeliveryEndpointMessage } from "../delivery/delivery.js";
import { type DeliveryStrategy, UniformAcrossAllShards } from "../delivery/delivery-builder.js";
import { InboxTargets } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";
import { emitServerError } from "../server/server-log.js";
import { IntegrationBroker } from "../integration/integration-broker.js";
import { ServerEnvironment } from "../server/server-environment.js";

/**
 * Tenant isolation mode declared by a bounded context specification.
 */
export type TenantMode = "single-tenant" | "multitenant";

/**
 * Immutable bounded context name value.
 */
export interface BoundedContextName {
  // prettier-ignore

  /**
   * Non-empty, non-blank bounded context name that does not start with `__spine/`.
   */
  readonly value: string;
}

/**
 * Small immutable bounded-context specification snapshot.
 */
export interface ContextSpecSnapshot {
  // prettier-ignore

  /**
   * Bounded context name value.
   */
  readonly name: BoundedContextName;

  /**
   * Whether the context requires tenant isolation.
   */
  readonly multitenant: boolean;

  /**
   * Whether the context stores its domain event log.
   */
  readonly storesEvents: boolean;
}

/**
 * Small built bounded-context metadata snapshot.
 */
export interface BoundedContextSnapshot {
  // prettier-ignore

  /**
   * Bounded context name value.
   */
  readonly name: BoundedContextName;

  /**
   * Tenant isolation mode for the built context.
   */
  readonly tenantMode: TenantMode;

  /**
   * Context specification used to build the context.
   */
  readonly spec: ContextSpecSnapshot;
}

interface SystemPairingSnapshot {
  readonly domain: BoundedContextSnapshot;
  readonly system: ContextSpecSnapshot;
}

/**
 * Minimal repository owner marker retained after registration.
 */
interface RepositoryOwner {
  // prettier-ignore

  /**
   * Bounded context name.
   */
  readonly name: BoundedContextName;
}

/**
 * Context-owned storage data needed while repositories register.
 */
interface RepositoryRegistration {
  // prettier-ignore

  /**
   * Bounded context name.
   */
  readonly name: BoundedContextName;

  /**
   * Storage context derived from the bounded context spec.
   */
  readonly storageContext: StorageMode;

  /**
   * Context storage factory.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Context-owned read-side Stand used by framework repository dispatch.
   */
  readonly stand: Stand;

  /**
   * Context-owned Entity Inbox handoff for Aggregate and Process Manager work.
   */
  readonly entityInbox: EntityInbox;

  /**
   * Context-owned local projection subscriber inbox handoff.
   */
  readonly projectionInbox: ProjectionInbox;

  /**
   * Stored-event dispatch callback into the owning context event bus.
   */
  readonly dispatchStored: (event: Event) => Promise<void>;

  /**
   * Stored-event follow-up dispatch callback into the owning context event bus.
   */
  readonly dispatchStoredFollowUp: (event: Event) => Promise<void>;

  /**
   * Follow-up event posting callback into the owning context event bus.
   */
  readonly postEventFollowUp: (event: Event) => Promise<void>;

  /**
   * Registers a schema for a framework-produced event before it enters the event bus.
   */
  readonly registerEventSchema: (schema: MessageSchema) => void;

  /**
   * Registers a schema for an internal system event.
   */
  readonly registerSystemEventSchema: (schema: MessageSchema) => void;

  /**
   * Posts a committed system event without affecting domain event storage.
   */
  readonly postSystemFollowUp: (event: Event) => Promise<void>;

  /**
   * Command posting callback into the owning context command bus.
   */
  readonly onPostCommand: (command: Command) => Promise<void>;

  /**
   * Records asynchronous event follow-up failures for diagnostics.
   */
  readonly recordDispatchFailure: (event: Event, error: unknown) => void;
}

interface RegisteredEntityInbox extends EntityInbox {
  register(target: EntityInboxTarget): void;
  endpoints(): readonly DeliveryEndpoint[];
}

interface PrjInbox extends ProjectionInbox {
  register(target: ProjectionInboxTarget): void;
  endpoints(): readonly DeliveryEndpoint[];
}

/**
 * Selects a tenant-specific delivery startup scope.
 */
export interface DeliveryTenantScope {
  // prettier-ignore

  /**
   * Identifies the tenant, or is absent for the single-tenant scope.
   */
  readonly tenantId?: TenantId;
}

/**
 * Gives delivery infrastructure access to one built bounded context.
 */
export interface ContextDeliveryDescriptor {
  // prettier-ignore

  /**
   * Creates storage used by the context's delivery routes.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Lists tenant scopes that existing delivery work may require at startup.
   *
   * @returns Resolves to immutable tenant delivery scopes.
   */
  startupScopes(): Promise<readonly DeliveryTenantScope[]>;

  /**
   * Creates the storage context for a delivery scope.
   *
   * @param scope Selects the tenant scope to represent.
   * @returns Returns the matching storage context.
   */
  storageContext(scope: DeliveryTenantScope): StorageContext;

  /**
   * Lists delivery endpoints registered by the context's local inboxes.
   *
   * @returns Returns immutable endpoint descriptions.
   */
  endpoints(): readonly DeliveryEndpoint[];

  /**
   * Dispatches a durable inbox message through its registered target.
   *
   * @param message Contains the delivery message to replay.
   * @param tenantId Identifies the delivery tenant when the context is multitenant.
   * @returns A promise that resolves after the message is replayed.
   */
  replay(message: DeliveryEndpointMessage, tenantId?: TenantId): Promise<void>;

  /**
   * Sets the observer for newly ready delivery routes.
   *
   * @param onReady Observes each route made ready by persistence.
   * @returns Returns a function that removes the observer.
   */
  onReady(onReady: OnDeliveryReady): () => void;

  /**
   * Updates readiness ownership to use configured delivery routes.
   *
   * @param scopes Lists routes that may receive buffered readiness.
   * @param onReady Observes readiness after routed ownership begins.
   * @param options Allows an empty route set when `allowEmpty` is true.
   * @returns A promise that resolves after the readiness transition completes.
   */
  transition(
    scopes: readonly DeliveryReady[],
    onReady: OnDeliveryReady,
    options?: {
      readonly allowEmpty?: boolean;
      readonly ports?: import("./local-inbox-handoff.js").EnvironmentDeliveryPorts;
    },
  ): Promise<void>;
}

interface RegistrationSnapshot {
  readonly entityType: RepositoryEntityType;
  readonly entityFamily: RepositoryView["entityFamily"];
  readonly stateSchema: DescriptorMessageSchema;
  readonly metadata: EntityMetadata;
  readonly stateFullTypeName: string;
  readonly idField: DescriptorFieldMetadata;
  readonly snapshot: RepositoryIdentitySnapshot;
}

/**
 * Post-only command endpoint exposed by a built bounded context.
 */
export interface CommandEndpoint {
  // prettier-ignore

  /**
   * Lists canonical command message type URLs accepted by this endpoint.
   *
   * @returns Returns immutable command type URLs.
   */
  acceptedCommandTypes(): readonly string[];

  /**
   * Posts a command into the context-owned command bus.
   *
   * @param command Contains the command to dispatch.
   * @returns A promise that settles after queued command dispatch completes and may reject.
   */
  post(command: Command): Promise<void>;
}

/**
 * Event endpoint exposed by a built bounded context for accepted-type listing and posting.
 */
export interface EventEndpoint {
  // prettier-ignore

  /**
   * Lists canonical public event message type URLs accepted by this endpoint.
   *
   * @returns Returns immutable event type URLs.
   */
  acceptedEventTypes(): readonly string[];

  /**
   * Posts an event into the context-owned event bus.
   *
   * @param event Contains the event to dispatch.
   * @returns A promise that settles after persistence and dispatch complete and may reject.
   */
  post(event: Event): Promise<void>;
}

/**
 * Tenant-scoped options for the legacy-named local read-side reset/replay helper.
 *
 * Single-tenant contexts reject `tenantId`. Multitenant contexts require a
 * complete generated `tenantId` and preserve its typed identity.
 */
export interface ReadCatchUpOptions {
  // prettier-ignore

  /**
   * Tenant slice to rebuild for multitenant contexts.
   */
  readonly tenantId?: TenantId;
}

/**
 * Summary from one legacy-named local read-side reset/replay run.
 *
 * The replay boundary covers only already-stored events routed to registered
 * projection subscribers after `Stand.clear()` removes the target projection
 * rows for the selected tenant slice.
 */
export interface ReadCatchUpResult {
  // prettier-ignore

  /**
   * Number of already-stored events dispatched to at least one projection subscriber.
   */
  readonly replayedEventCount: number;

  /**
   * Number of cleared projection-state rows before replay.
   */
  readonly clearedEntityCount: number;

  /**
   * Unique projection state type URLs cleared once before replay.
   */
  readonly clearedStateTypes: readonly string[];
}

type CatchUpReplayCode = "READ_SIDE_CATCH_UP_REPLAY_FAILED";

/**
 * Observable failure from asynchronous event follow-up processing.
 *
 * This covers dispatch of already-stored events and independent follow-up
 * posts whose acceptance, storage, or dispatch failed.
 */
export interface StoredEventDispatchFailure {
  // prettier-ignore

  /**
   * Event snapshot associated with the failure; it may not have reached storage.
   */
  readonly event: Event;

  /**
   * Frozen scalar snapshot of the thrown failure.
   */
  readonly error: DispatchErrorSnapshot;
}

/**
 * Copy-safe event follow-up error diagnostic.
 */
export interface DispatchErrorSnapshot {
  // prettier-ignore

  /**
   * Error class/name, or a stable label for non-Error throws.
   */
  readonly name: string;

  /**
   * Bounded diagnostic message.
   */
  readonly message: string;

  /**
   * Bounded stack string when the thrown value is an Error with a stack.
   */
  readonly stack?: string;
}

/**
 * Error thrown when a bounded context name cannot be accepted.
 */
export class BoundedContextNameError extends Error {
  // prettier-ignore

  /**
   * Rejected raw value.
   */
  readonly value: unknown;

  /**
   * Creates a deterministic bounded-context name validation error.
   *
   * @param value Contains the rejected name value.
   */
  constructor(value: unknown) {
    super('A Bounded Context name cannot be empty, blank, or start with "__spine/".');
    this.name = "BoundedContextNameError";
    this.value = value;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface FrameworkConstructionToken {
  readonly frameworkConstructionToken: true;
}

const frameworkConstructionToken: FrameworkConstructionToken = Object.freeze({
  frameworkConstructionToken: true,
});
const dispatchFailureLimit = 10;
const dispatchErrorMessageLimit = 500;
const dispatchErrorStackLimit = 2_000;
const generatedRegistryFile = "generated/handler/generated-handler-registry.js";
const moduleSchemeRe = /^[A-Za-z][A-Za-z\d+.-]*:/;
const internalStoragePrefix = "__spine/";
const generatedRegistryLoadAttempts = new Map<string, number>();
const eventSubscribers = new WeakMap<
  BoundedContext,
  (typeUrl: string, subscriber: EventSubscriber) => EventSubscription
>();
const contextSystemPairings = new WeakMap<BoundedContext, SystemPairingSnapshot>();
const contextTenantIndexes = new WeakMap<BoundedContext, TenantIndex>();
const contextStorageFactories = new WeakMap<BoundedContext, StorageFactory>();
const contextDeliveryDescriptors = new WeakMap<BoundedContext, ContextDeliveryDescriptor>();
const contextSubscriptionRuntimes = new WeakMap<BoundedContext, SubscriptionRuntime>();
const contextLoggers = new WeakMap<BoundedContext, ILogLayer>();
const contextEventBuses = new WeakMap<BoundedContext, readonly [EventBus, EventBus]>();
const contextDispatchFailureRecorders = new WeakMap<
  BoundedContext,
  (event: Event, error: unknown) => void
>();
const contextIntegrations = new WeakMap<
  BoundedContext,
  { readonly broker: IntegrationBroker; readonly ready: Promise<void> }
>();
const systemEventPosters = new WeakMap<BoundedContext, (event: Event) => Promise<void>>();
const builderBuilds = new WeakMap<
  BoundedContextBuilder,
  (defaultStorageFactory: StorageFactory) => Promise<BoundedContext>
>();

interface BoundedContextAccess {
  isBuilder(value: unknown): value is BoundedContextBuilder;
  build(
    builder: BoundedContextBuilder,
    defaultStorageFactory: StorageFactory,
  ): Promise<BoundedContext>;
  subscribeToEvent(
    context: BoundedContext,
    typeUrl: string,
    subscriber: EventSubscriber,
  ): EventSubscription;
  postSystemEvent(context: BoundedContext, event: Event): Promise<void>;
  systemPairing(context: BoundedContext): SystemPairingSnapshot;
  tenantIndex(context: BoundedContext): TenantIndex;
  storageFactory(context: BoundedContext): StorageFactory;
  subscriptionRegistry(context: BoundedContext): StandSubscriptionRegistry;
  consumeSubscription(
    context: BoundedContext,
    id: string,
    onUpdate: (update: import("@spine-event-engine/proto/client").SubscriptionUpdate) => void,
  ): Promise<import("../stand/stand.js").StandSubscription>;
  installLogger(context: BoundedContext, logger: ILogLayer): void;
  loggerFor(context: BoundedContext): ILogLayer;
  recordDispatchFailure(context: BoundedContext, event: Event, error: unknown): void;
  delivery(context: BoundedContext): ContextDeliveryDescriptor;
}
let constructBoundedContext:
  | ((
      snapshot: BoundedContextSnapshot,
      commandBus: CommandBus,
      eventBus: EventBus,
      systemEventBus: EventBus,
      stand: Stand,
      systemStand: Stand,
      runtime: SubscriptionRuntime,
      systemSpec: ContextSpecSnapshot,
      storageFactory: StorageFactory,
      repositories: readonly RepositoryView[],
      deliveryStrategy: DeliveryStrategy,
      token: FrameworkConstructionToken,
    ) => BoundedContext)
  | undefined;
let constructBoundedContextBuilder:
  | ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => BoundedContextBuilder)
  | undefined;
let constructContextSpec:
  ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => ContextSpec) | undefined;

/**
 * Represents a built bounded context and its command, event, repository, and read-side resources.
 */
export class BoundedContext {
  readonly #snapshot: BoundedContextSnapshot;
  readonly #commandBus: CommandBus;
  readonly #eventBus: EventBus;
  readonly #systemEventBus: EventBus;
  readonly #commandEndpoint: CommandEndpoint;
  readonly #eventEndpoint: EventEndpoint;
  readonly #entityInbox: RegisteredEntityInbox;
  readonly #projectionInbox: PrjInbox;
  readonly #deliveryStrategy: DeliveryStrategy;
  readonly #registeredRepositories: RegistrationSnapshot[] = [];
  readonly #storedEventDispatchFailures: StoredEventDispatchFailure[] = [];
  readonly #repositoryViews = new Set<RepositoryView>();
  readonly #storageFactory: StorageFactory;
  readonly #stand: Stand;
  readonly #systemStand: Stand;
  readonly #subscriptionRuntime: SubscriptionRuntime;
  #closed: Promise<void> | undefined;

  /**
   * Registers the framework-only construction hook for this module.
   */
  static {
    constructBoundedContext = (
      snapshot,
      commandBus,
      eventBus,
      systemEventBus,
      stand,
      systemStand,
      runtime,
      systemSpec,
      storageFactory,
      repositories,
      deliveryStrategy,
      token,
    ): BoundedContext =>
      new BoundedContext(
        snapshot,
        commandBus,
        eventBus,
        systemEventBus,
        stand,
        systemStand,
        runtime,
        systemSpec,
        storageFactory,
        repositories,
        deliveryStrategy,
        token,
      );
  }

  /**
   * Creates a framework-owned bounded context.
   *
   * @param snapshot Contains the immutable context metadata.
   * @param commandBus Dispatches commands accepted by this context.
   * @param eventBus Dispatches events accepted by this context.
   * @param systemEventBus Dispatches framework-only System events.
   * @param stand Stores read-side state for this context.
   * @param systemStand Stores read-side state for the paired System Context.
   * @param subscriptionRuntime Coordinates pair-owned subscription delivery.
   * @param systemSpec Contains paired System Context metadata.
   * @param storageFactory Creates context storage.
   * @param repositories Lists repositories to register.
   * @param deliveryStrategy Selects immutable Entity Inbox shards.
   * @param token Proves framework-controlled construction.
   */
  protected constructor(
    snapshot: BoundedContextSnapshot,
    commandBus: CommandBus,
    eventBus: EventBus,
    systemEventBus: EventBus,
    stand: Stand,
    systemStand: Stand,
    subscriptionRuntime: SubscriptionRuntime,
    systemSpec: ContextSpecSnapshot,
    storageFactory: StorageFactory,
    repositories: readonly RepositoryView[],
    deliveryStrategy: DeliveryStrategy,
    token: FrameworkConstructionToken,
  ) {
    ContextParts.requireFrameworkConstructionToken(
      token,
      "BoundedContext instances are framework-owned.",
    );
    this.#snapshot = ContextParts.cloneContextSnapshot(snapshot);
    this.#commandBus = commandBus;
    this.#eventBus = eventBus;
    this.#systemEventBus = systemEventBus;
    contextEventBuses.set(this, [eventBus, systemEventBus]);
    this.#stand = stand;
    this.#systemStand = systemStand;
    this.#subscriptionRuntime = subscriptionRuntime;
    this.#storageFactory = storageFactory;
    this.#deliveryStrategy = ContextParts.snapshotDeliveryStrategy(deliveryStrategy);
    this.#commandEndpoint = Object.freeze({
      acceptedCommandTypes: () => this.#commandBus.acceptedCommandTypes(),
      post: (command: Command) => this.#commandBus.post(command),
    });
    this.#eventEndpoint = Object.freeze({
      acceptedEventTypes: () => ContextParts.exposedEventTypeUrls(this.#eventBus),
      post: (event: Event) => ContextParts.postContextEvent(this, event),
    });
    contextDispatchFailureRecorders.set(this, (event, error) => {
      this.#recordDispatchFailure(event, error);
    });
    const deliveryReadiness = new DeliveryReadiness();
    const tenantIndex = TenantIndexes.create({
      contextName: this.#snapshot.name.value,
      tenantMode: this.#snapshot.tenantMode,
      storageFactory,
    });
    const keepTenant = (tenantId: TenantId) => tenantIndex.keep(tenantId);
    this.#entityInbox = new LocalEntityInbox(
      this.#snapshot.name.value,
      deliveryReadiness,
      keepTenant,
      this.#deliveryStrategy,
    );
    this.#projectionInbox = new LocalProjectionInbox(
      this.#snapshot.name.value,
      deliveryReadiness,
      keepTenant,
    );
    eventSubscribers.set(this, (typeUrl, subscriber) =>
      eventBusAccess.subscribe(this.#eventBus, typeUrl, subscriber),
    );
    systemEventPosters.set(this, (event) => this.#systemEventBus.post(event));
    contextSystemPairings.set(this, ContextParts.createSystemPairing(this.#snapshot, systemSpec));
    contextTenantIndexes.set(this, tenantIndex);
    contextStorageFactories.set(this, storageFactory);
    contextSubscriptionRuntimes.set(this, subscriptionRuntime);
    contextDeliveryDescriptors.set(
      this,
      ContextParts.createDeliveryDescriptor(
        this.#snapshot,
        storageFactory,
        tenantIndex,
        this.#entityInbox,
        this.#projectionInbox,
        deliveryReadiness,
      ),
    );
    try {
      this.#registerRepositories(repositories);
      this.#subscriptionRuntime.start();
    } catch (error) {
      try {
        ContextParts.cleanupFailedContext(this, tenantIndex);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Bounded Context build failed, and tenant index cleanup also failed.",
        );
      }
      throw error;
    }
    Object.freeze(this);
  }

  #registerRepositories(repositories: readonly RepositoryView[]): void {
    const preparedRepositories = this.#prepareRepositories(repositories);

    try {
      for (const preparedRepository of preparedRepositories) {
        ContextParts.rejectRegisteredRepository(preparedRepository.repository);
      }
      for (const preparedRepository of preparedRepositories) {
        this.#stand.register(preparedRepository.snapshot.stateSchema, {
          columns: ContextParts.repositoryColumns(preparedRepository.snapshot),
        });
        preparedRepository.commit();
        this.#registeredRepositories.push(preparedRepository.snapshot);
        if (preparedRepository.entityInboxTarget !== undefined) {
          this.#entityInbox.register(preparedRepository.entityInboxTarget);
        }
        if (preparedRepository.projectionInboxTarget !== undefined) {
          this.#projectionInbox.register(preparedRepository.projectionInboxTarget);
        }
        this.#repositoryViews.add(preparedRepository.repository);
      }
    } catch (error) {
      this.#failRegistration(error, preparedRepositories);
    }
  }

  #prepareRepositories(repositories: readonly RepositoryView[]): PreparedRepository[] {
    const registration: RepositoryRegistration = {
      name: ContextParts.cloneName(this.#snapshot.name),
      storageContext: ContextParts.createStorageMode(this.#snapshot.spec),
      storageFactory: this.#storageFactory,
      stand: this.#stand,
      entityInbox: this.#entityInbox,
      projectionInbox: this.#projectionInbox,
      dispatchStored: (event) => eventBusAccess.postStored(this.#eventBus, event),
      dispatchStoredFollowUp: (event) => eventBusAccess.postStoredFollowUp(this.#eventBus, event),
      postEventFollowUp: (event) => eventBusAccess.postFollowUp(this.#eventBus, event),
      registerEventSchema: (schema) => {
        eventBusAccess.registerSchemas(this.#eventBus, [schema]);
      },
      registerSystemEventSchema: (schema) => {
        eventBusAccess.registerSchemas(this.#systemEventBus, [schema]);
      },
      postSystemFollowUp: (event) => eventBusAccess.postFollowUp(this.#systemEventBus, event),
      onPostCommand: (command) => commandBusAccess.postInternal(this.#commandBus, command),
      recordDispatchFailure: (event, error) => {
        this.#recordDispatchFailure(event, error);
      },
    };
    const preparedRepositories: PreparedRepository[] = [];
    try {
      for (const repository of repositories) {
        preparedRepositories.push(
          ContextParts.prepareRepositoryForContext(repository, registration),
        );
      }
    } catch (error) {
      this.#failRegistration(error, preparedRepositories);
    }
    return preparedRepositories;
  }

  #failRegistration(error: unknown, preparedRepositories: readonly PreparedRepository[]): never {
    const closeErrors = ContextParts.closePreparedRepositories(preparedRepositories);
    if (closeErrors.length > 0) {
      throw new AggregateError(
        [error, ...closeErrors],
        "Repository registration failed, and prepared repository storage cleanup also failed.",
      );
    }
    throw error;
  }

  /**
   * Creates a builder for a context without tenant isolation.
   *
   * @param name Names the bounded context.
   * @returns Returns a builder initialized with the supplied name.
   */
  static singleTenant(name: string): BoundedContextBuilder {
    return ContextParts.createBoundedContextBuilder(ContextParts.createSpecSnapshot(name, false));
  }

  /**
   * Creates a builder for a tenant-isolated context.
   *
   * @param name Names the bounded context.
   * @returns Returns a builder initialized with the supplied name.
   */
  static multitenant(name: string): BoundedContextBuilder {
    return ContextParts.createBoundedContextBuilder(ContextParts.createSpecSnapshot(name, true));
  }

  /**
   * Returns the bounded context name.
   *
   * @returns Returns the immutable context name.
   */
  get name(): BoundedContextName {
    return this.#snapshot.name;
  }

  /**
   * Returns the context's tenant isolation mode.
   *
   * @returns Returns the configured tenant mode.
   */
  get tenantMode(): TenantMode {
    return this.#snapshot.tenantMode;
  }

  /**
   * Returns whether this context isolates data by tenant.
   *
   * @returns Returns true when the context is multitenant.
   */
  get isMultitenant(): boolean {
    return this.#snapshot.tenantMode === "multitenant";
  }

  /**
   * Returns a copy-safe specification used to build this context.
   *
   * @returns Returns the context specification.
   */
  get spec(): ContextSpec {
    return ContextParts.createContextSpec(this.#snapshot.spec);
  }

  /**
   * Returns a copy-safe immutable metadata snapshot.
   *
   * @returns Returns the context metadata snapshot.
   */
  get snapshot(): BoundedContextSnapshot {
    return ContextParts.cloneContextSnapshot(this.#snapshot);
  }

  /**
   * Returns the command endpoint owned by this context.
   *
   * @returns Returns the context command endpoint.
   */
  commandBus(): CommandEndpoint {
    return this.#commandEndpoint;
  }

  /**
   * Returns the event endpoint owned by this context.
   *
   * @returns Returns the context event endpoint.
   */
  eventBus(): EventEndpoint {
    return this.#eventEndpoint;
  }

  /**
   * Returns the context-owned read-side Stand.
   *
   * @returns Returns the read-side state store.
   */
  stand(): Stand {
    return this.#stand;
  }

  /**
   * Lists copy-safe views of repositories registered with this context.
   *
   * @returns Returns immutable repository views.
   */
  registeredRepositories(): readonly RepositoryView[] {
    return this.#registeredRepositories.map((snapshot) =>
      ContextParts.createRepositoryView(snapshot),
    );
  }

  /**
   * Returns copy-safe diagnostics for asynchronous event follow-up failures.
   *
   * Entries can describe already-stored event dispatch or an independent
   * follow-up post that failed before storage.
   *
   * @returns Returns immutable failure diagnostics.
   */
  storedEventDispatchFailures(): readonly StoredEventDispatchFailure[] {
    return this.#storedEventDispatchFailures.map(ContextParts.cloneDispatchFailure);
  }

  /**
   * Clears and locally replays every registered Projection from already-stored events.
   *
   * Despite its legacy name, this method is not Projection catch-up. It is a
   * process-local maintenance helper and provides no Projection targeting,
   * historical starting point, durable operation identity, progress,
   * historical/live coordination, restart, resumption, or multi-node work.
   *
   * Supported boundary:
   * - projection subscribers only;
   * - already-stored events only;
   * - clear then replay, with no event re-append;
   * - single-tenant contexts reject `tenantId`;
   * - multitenant contexts require the exact non-blank `tenantId`;
   * - process-local sequential execution on the same EventBus runtime queue as
   *   live event intake and stored redispatch.
   *
   * Unsupported boundary:
   * - Delivery jobs, schedulers, inbox lifecycle, retries, and transport
   *   topology;
   * - durable live-traffic catch-up orchestration across processes.
   *
   * @param options Selects the tenant slice to rebuild.
   * @returns Resolves to replay and clear counts for the selected slice.
   */
  async catchUpReadSide(options: ReadCatchUpOptions = {}): Promise<ReadCatchUpResult> {
    return eventBusAccess.runExclusive(this.#eventBus, () => this.#catchUpReadSideOnce(options));
  }

  async #catchUpReadSideOnce(options: ReadCatchUpOptions): Promise<ReadCatchUpResult> {
    const storageContext = ContextParts.catchUpStorageContext(this.#snapshot.spec, options);
    const tenantOptions = ContextParts.catchUpStandOptions(storageContext);
    const projections = ContextParts.projectionDispatchers(this.#repositoryViews);
    const clearTargets = ContextParts.projectionStateClearTargets(projections);
    const clearedStateTypes: string[] = [];
    let clearedEntityCount = 0;
    let replayedEventCount = 0;

    for (const target of clearTargets) {
      clearedEntityCount += await this.#stand.clear(target.schema, tenantOptions);
      clearedStateTypes.push(target.typeUrl);
    }

    const events = await ContextParts.readStoredEvents(storageContext, this.#storageFactory);

    for (const event of events) {
      try {
        ContextParts.validateReplayTenant(storageContext, event);
        replayedEventCount += await ContextParts.dispatchStoredProjectionEvent(
          projections,
          event,
          true,
        );
      } catch (error) {
        throw ContextParts.catchUpReplayError(event, error);
      }
    }

    return Object.freeze({
      replayedEventCount,
      clearedEntityCount,
      clearedStateTypes: Object.freeze(clearedStateTypes),
    });
  }

  /**
   * Closes context-owned buses, Stand, and repository storage/runtime bindings.
   *
   * Close is idempotent and returns the same close outcome on repeated calls.
   * The context attempts every owned close hook; when any hook fails, the
   * returned promise rejects with an `AggregateError` after the remaining hooks
   * have also been attempted.
   *
   * @returns A promise that settles after all owned resources close.
   */
  close(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  async #closeOnce(): Promise<void> {
    const errors: unknown[] = [];

    await ContextParts.closeContextPart(() => ContextParts.closeIntegration(this), errors);

    commandBusAccess.beginClose(this.#commandBus);
    eventBusAccess.beginClose(this.#eventBus);
    await ContextParts.closeContextPart(
      () => ContextParts.drainContextBuses(this.#commandBus, this.#eventBus),
      errors,
    );
    await ContextParts.closeContextPart(
      () => commandBusAccess.finishClose(this.#commandBus),
      errors,
    );
    await ContextParts.closeContextPart(() => eventBusAccess.finishClose(this.#eventBus), errors);
    this.#subscriptionRuntime.beginClose();
    eventBusAccess.beginClose(this.#systemEventBus);
    await ContextParts.closeContextPart(() => eventBusAccess.drain(this.#systemEventBus), errors);
    await ContextParts.closeContextPart(() => this.#subscriptionRuntime.drainClose(), errors);
    await ContextParts.closeContextPart(
      () => eventBusAccess.finishClose(this.#systemEventBus),
      errors,
    );
    await ContextParts.closeContextPart(() => this.#stand.close(), errors);
    await ContextParts.closeContextPart(() => this.#systemStand.close(), errors);
    await ContextParts.closeContextPart(() => this.#subscriptionRuntime.finishClose(), errors);
    await ContextParts.closeContextPart(() => {
      ContextParts.requireTenantIndex(this).close();
    }, errors);

    for (const repository of this.#repositoryViews) {
      await ContextParts.closeContextPart(() => {
        repositoryAccess.clearRuntime(repository);
        registeredRepositories.delete(repository);
      }, errors);
    }
    if (errors.length > 0) {
      this.#closed = undefined;
      throw new AggregateError(ContextParts.flattenErrors(errors), "BoundedContext close failed.");
    }
    ContextParts.clearContextMetadata(this);
  }

  #recordDispatchFailure(event: Event, error: unknown): void {
    this.#storedEventDispatchFailures.push(
      Object.freeze({
        event: clone(EventSchema, event),
        error: ContextParts.snapshotDispatchError(error),
      }),
    );
    if (this.#storedEventDispatchFailures.length > dispatchFailureLimit) {
      this.#storedEventDispatchFailures.splice(
        0,
        this.#storedEventDispatchFailures.length - dispatchFailureLimit,
      );
    }
    const logger = contextLoggers.get(this);
    const eventType = event.message?.typeUrl;
    if (logger !== undefined && eventType !== undefined && eventType.length > 0) {
      emitServerError(logger, "Repository follow-up dispatch failed.", {
        eventType,
        operation: "repository.follow_up",
        reasonCode: "dispatch_failed",
      });
    }
  }
}

/**
 * Exposes framework-only operations for built contexts and their builders.
 */
export const boundedContextAccess: BoundedContextAccess = Object.freeze({
  installLogger(context: BoundedContext, logger: ILogLayer): void {
    if (!contextStorageFactories.has(context)) {
      throw new TypeError("Context logger requires a built BoundedContext instance.");
    }
    contextLoggers.set(context, logger);
    const buses = contextEventBuses.get(context);
    if (buses === undefined) {
      throw new TypeError("Context logger requires a built BoundedContext instance.");
    }
    eventBusAccess.installLogger(buses[0], logger);
    eventBusAccess.installLogger(buses[1], logger);
    const runtime = contextSubscriptionRuntimes.get(context);
    if (runtime === undefined) {
      throw new TypeError("Context logger requires a built BoundedContext instance.");
    }
    subscriptionRuntimeAccess.installLogger(runtime, logger);
  },

  loggerFor(context: BoundedContext): ILogLayer {
    const logger = contextLoggers.get(context);
    if (logger === undefined) {
      throw new TypeError("Context logger requires a built BoundedContext instance.");
    }
    return logger;
  },

  recordDispatchFailure(context: BoundedContext, event: Event, error: unknown): void {
    const record = contextDispatchFailureRecorders.get(context);
    if (record === undefined) {
      throw new TypeError("Dispatch failure recording requires a built BoundedContext instance.");
    }
    record(event, error);
  },

  isBuilder(value: unknown): value is BoundedContextBuilder {
    return (
      typeof value === "object" &&
      value !== null &&
      builderBuilds.has(value as BoundedContextBuilder)
    );
  },

  build(
    builder: BoundedContextBuilder,
    defaultStorageFactory: StorageFactory,
  ): Promise<BoundedContext> {
    const build = builderBuilds.get(builder);

    if (build === undefined) {
      throw new TypeError("Builder access requires a BoundedContextBuilder instance.");
    }

    return build(defaultStorageFactory);
  },

  subscribeToEvent(
    context: BoundedContext,
    typeUrl: string,
    subscriber: EventSubscriber,
  ): EventSubscription {
    const subscribe = eventSubscribers.get(context);

    if (subscribe === undefined) {
      throw new TypeError("Event subscription requires a built BoundedContext instance.");
    }

    return subscribe(typeUrl, subscriber);
  },

  postSystemEvent(context: BoundedContext, event: Event): Promise<void> {
    const post = systemEventPosters.get(context);
    if (post === undefined) {
      throw new TypeError("System event posting requires a built BoundedContext instance.");
    }
    return post(event);
  },

  systemPairing(context: BoundedContext): SystemPairingSnapshot {
    return ContextParts.cloneSystemPairing(ContextParts.requireSystemPairing(context));
  },

  tenantIndex(context: BoundedContext): TenantIndex {
    return ContextParts.requireTenantIndex(context);
  },

  storageFactory(context: BoundedContext): StorageFactory {
    const storageFactory = contextStorageFactories.get(context);

    if (storageFactory === undefined) {
      throw new TypeError("Storage access requires a built BoundedContext instance.");
    }

    return storageFactory;
  },

  subscriptionRegistry(context: BoundedContext): StandSubscriptionRegistry {
    const runtime = contextSubscriptionRuntimes.get(context);
    if (runtime === undefined) {
      throw new TypeError("Subscription registry access requires a built BoundedContext instance.");
    }
    return runtime.registry();
  },

  consumeSubscription(
    context: BoundedContext,
    id: string,
    onUpdate: (update: import("@spine-event-engine/proto/client").SubscriptionUpdate) => void,
  ) {
    const runtime = contextSubscriptionRuntimes.get(context);
    if (runtime === undefined) {
      throw new TypeError("Subscription consumption requires a built BoundedContext instance.");
    }
    return runtime.consume(id, onUpdate);
  },

  delivery(context: BoundedContext): ContextDeliveryDescriptor {
    const descriptor = contextDeliveryDescriptors.get(context);

    if (descriptor === undefined) {
      throw new TypeError("Delivery access requires a built BoundedContext instance.");
    }

    return descriptor;
  },
});

/**
 * Customizes a repository assembled from an Entity class and generated handlers.
 *
 * @typeParam EntityType - The Entity class added to a Bounded Context builder.
 */
export type GeneratedRepositoryOptions<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
> = Readonly<
  Pick<
    RepositoryOptions<EntityType>,
    "commandRouting" | "eventRouting" | "stateUpdateRouting" | "stringifierRegistry"
  >
>;

/**
 * Assembles a {@link BoundedContext} from repositories and dispatchers.
 */
export class BoundedContextBuilder {
  readonly #specSnapshot: ContextSpecSnapshot;
  readonly #commandDispatchers = new Set<CommandDispatcher>();
  readonly #eventDispatchers = new Set<EventDispatcher>();
  readonly #repositories = new Set<RepositoryView>();
  readonly #entityTypes = new Set<RepositoryEntityType>();
  readonly #generatedRepositoryOptions = new Map<RepositoryEntityType, object>();
  #deliveryStrategy: DeliveryStrategy = UniformAcrossAllShards.singleShard();
  #storageFactory: StorageFactory | undefined;
  #subscriptionRegistry: StandSubscriptionRegistry | undefined;
  #persistSystemEvents = false;
  #generatedRegistryRoot: string | URL | undefined;

  /**
   * Registers the framework-only construction hook for this module.
   */
  static {
    constructBoundedContextBuilder = (snapshot, token): BoundedContextBuilder =>
      new BoundedContextBuilder(snapshot, token);
  }

  /**
   * Creates a framework-owned context builder.
   *
   * @param specSnapshot Contains the initial context specification.
   * @param token Proves framework-controlled construction.
   */
  protected constructor(specSnapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) {
    ContextParts.requireFrameworkConstructionToken(
      token,
      "BoundedContextBuilder instances are framework-owned.",
    );
    this.#specSnapshot = ContextParts.cloneSpecSnapshot(specSnapshot);
    builderBuilds.set(this, (defaultStorageFactory) => this.#buildAsyncWith(defaultStorageFactory));
    Object.freeze(this);
  }

  /**
   * Returns the name configured for the context to build.
   *
   * @returns Returns the immutable context name.
   */
  get name(): BoundedContextName {
    return this.#specSnapshot.name;
  }

  /**
   * Returns a copy-safe specification configured for the context.
   *
   * @returns Returns the context specification.
   */
  get spec(): ContextSpec {
    return ContextParts.createContextSpec(this.#specSnapshot);
  }

  /**
   * Returns the tenant isolation mode configured for the context.
   *
   * @returns Returns the configured tenant mode.
   */
  get tenantMode(): TenantMode {
    return ContextParts.toTenantMode(this.#specSnapshot.multitenant);
  }

  /**
   * Returns whether this builder will create a tenant-isolated context.
   *
   * @returns Returns true when the built context will be multitenant.
   */
  isMultitenant(): boolean {
    return this.#specSnapshot.multitenant;
  }

  /**
   * Adds an explicitly assembled repository.
   *
   * @param entry The repository to register.
   * @returns This builder for further configuration.
   */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    entry: Repository<EntityType>,
  ): this;

  /**
   * Adds an Entity class whose repository is assembled from generated handlers.
   *
   * @param entry The Entity class to register.
   * @param options Optional custom routing and field mappings for its generated repository.
   * @returns This builder for further configuration.
   */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    entry: EntityType,
    options?: GeneratedRepositoryOptions<EntityType>,
  ): this;

  /**
   * Adds an explicitly assembled repository or an Entity class.
   *
   * @param entry The repository or Entity class to register.
   * @param options Optional settings used only when an Entity class is supplied.
   * @returns This builder for further configuration.
   */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    entry: Repository<EntityType> | EntityType,
    options?: GeneratedRepositoryOptions<EntityType>,
  ): this {
    if (repositoryAccess.hasInstance(entry)) {
      if (options !== undefined) {
        throw new TypeError("Explicit Repository instances do not accept generated options.");
      }
      this.#repositories.add(entry);
      return this;
    }

    ContextParts.requireEntityClass(entry, "BoundedContextBuilder.add(repository)");
    this.#entityTypes.add(entry);
    if (options !== undefined) {
      this.#generatedRepositoryOptions.set(entry, Object.freeze({ ...options }));
    }
    return this;
  }

  /**
   * Removes a repository from the context registration list.
   *
   * @param repository Identifies the repository to remove.
   * @returns Returns this builder for further configuration.
   */
  remove<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
    ContextParts.requireRepositoryInstance(repository, "BoundedContextBuilder.remove(repository)");
    this.#repositories.delete(repository);
    return this;
  }

  /**
   * Adds a command dispatcher to the context being built.
   *
   * @param dispatcher Dispatches commands accepted by this context.
   * @returns Returns this builder for further configuration.
   */
  addCommandDispatcher(dispatcher: CommandDispatcher): this {
    this.#commandDispatchers.add(dispatcher);
    return this;
  }

  /**
   * Removes a command dispatcher from the context being built.
   *
   * @param dispatcher Identifies the dispatcher to remove.
   * @returns Returns this builder for further configuration.
   */
  removeCommandDispatcher(dispatcher: CommandDispatcher): this {
    this.#commandDispatchers.delete(dispatcher);
    return this;
  }

  /**
   * Adds an event dispatcher to the context being built.
   *
   * @param dispatcher Dispatches events accepted by this context.
   * @returns Returns this builder for further configuration.
   */
  addEventDispatcher(dispatcher: EventDispatcher): this {
    this.#eventDispatchers.add(dispatcher);
    return this;
  }

  /**
   * Removes an event dispatcher from the context being built.
   *
   * @param dispatcher Identifies the dispatcher to remove.
   * @returns Returns this builder for further configuration.
   */
  removeEventDispatcher(dispatcher: EventDispatcher): this {
    this.#eventDispatchers.delete(dispatcher);
    return this;
  }

  /**
   * Sets a storage factory for event, repository-state, and Stand storage.
   *
   * @param storageFactory Creates the context's persistent storage.
   * @returns Returns this builder for further configuration.
   */
  withStorageFactory(storageFactory: StorageFactory): this {
    this.#storageFactory = storageFactory;
    return this;
  }

  /**
   * Persists internal system events in the paired System Context storage.
   *
   * System events are forgotten by default. Enabling this option does not put
   * them into the domain EventStore.
   *
   * @returns Returns this builder for further configuration.
   */
  persistSystemEvents(): this {
    this.#persistSystemEvents = true;
    return this;
  }

  /**
   * Sets a complete custom registry and transfers it to the first build attempt.
   *
   * The built context closes the registry. A failed first build also begins its
   * closure, so callers must not reuse it.
   *
   * @param registry Stores this context's Stand subscription definitions.
   * @returns Returns this builder for further configuration.
   */
  withSubscriptionRegistry(registry: StandSubscriptionRegistry): this {
    this.#subscriptionRegistry = registry;
    return this;
  }

  /**
   * Sets the target-to-shard strategy for the context-owned Entity Inbox.
   *
   * @param strategy Selects the durable shard for Aggregate and Process Manager targets.
   * @returns Returns this builder for further configuration.
   */
  withDeliveryStrategy(strategy: DeliveryStrategy): this {
    this.#deliveryStrategy = ContextParts.snapshotDeliveryStrategy(strategy);
    return this;
  }

  /**
   * Sets a trusted compiled application root for generated handler metadata.
   *
   * @param root Names the compiled package or application root.
   * @returns Returns this builder for further configuration.
   */
  withGeneratedRegistryRoot(root: string | URL): this {
    this.#generatedRegistryRoot = root;
    return this;
  }

  /**
   * Builds a context from explicitly added repositories and dispatchers.
   *
   * @returns Returns the built context.
   */
  build(): BoundedContext {
    ContextParts.rejectSyncEntityAssembly(this.#entityTypes);
    return this.#buildWith(
      [...this.#repositories],
      this.#storageFactory ?? new InMemoryStorageFactory(),
    );
  }

  /**
   * Builds a context after loading generated metadata for added entity classes.
   *
   * @returns Resolves to the built context.
   */
  async buildAsync(): Promise<BoundedContext> {
    return this.#buildAsyncWith();
  }

  async #buildAsyncWith(defaultStorageFactory?: StorageFactory): Promise<BoundedContext> {
    const repositories = [
      ...this.#repositories,
      ...(await this.#loadGeneratedRepositories([...this.#entityTypes])),
    ];

    const context = this.#buildWith(
      repositories,
      this.#storageFactory ?? defaultStorageFactory ?? new InMemoryStorageFactory(),
    );
    await ContextParts.integrationReady(context);
    return context;
  }

  #buildWith(
    repositories: readonly RepositoryView[],
    storageFactory: StorageFactory,
  ): BoundedContext {
    let registry = this.#subscriptionRegistry;
    this.#subscriptionRegistry = undefined;

    const registeredRepositories = [...repositories];
    let eventStore: EventStore | undefined;
    let systemEventStore: EventStore | undefined;
    let eventBus: EventBus | undefined;
    let systemEventBus: EventBus | undefined;
    let stand: Stand | undefined;
    let systemStand: Stand | undefined;
    let runtime: SubscriptionRuntime | undefined;
    try {
      ContextParts.preflightRepositories(registeredRepositories);
      const eventDispatchers = [
        ...ContextParts.repositoryEventDispatchers(registeredRepositories),
        ...this.#eventDispatchers,
      ];
      const repositorySystemEventDispatchers =
        ContextParts.repositorySystemEventDispatchers(registeredRepositories);
      const domainEventDispatchers = ContextParts.domainEventDispatchers(eventDispatchers);
      const systemEventDispatchers = [
        ...ContextParts.systemEventDispatchers(eventDispatchers),
        ...repositorySystemEventDispatchers,
      ];
      const commandBus = new CommandBus([
        ...this.#commandDispatchers,
        ...ContextParts.repositoryCommandDispatchers(registeredRepositories),
      ]);
      const systemSpec = ContextParts.createSystemSpec(
        this.#specSnapshot,
        this.#persistSystemEvents,
      );
      systemEventStore = systemSpec.storesEvents
        ? new EventStore(ContextParts.createStorageMode(systemSpec), storageFactory)
        : undefined;
      systemEventBus = eventBusAccess.createSystemBus(systemEventStore);
      for (const dispatcher of systemEventDispatchers) systemEventBus.register(dispatcher);
      systemStand = new Stand({
        context: ContextParts.createStorageMode(systemSpec),
        storageFactory,
      });
      eventStore = this.createEventStore(storageFactory);
      eventBus = new EventBus(eventStore);
      for (const dispatcher of domainEventDispatchers) eventBus.register(dispatcher);
      eventBusAccess.registerSchemas(
        eventBus,
        ContextParts.repositoryProducedEventSchemas(registeredRepositories),
      );
      stand = new Stand({
        context: ContextParts.createStorageMode(this.#specSnapshot),
        storageFactory,
      });
      registry ??= new StorageSubscriptionRegistry(
        ContextParts.createSubscriptionStorageContext(this.#specSnapshot),
        storageFactory,
      );
      runtime = new SubscriptionRuntime(stand, systemStand, eventBus, systemEventBus, registry);
      const context = ContextParts.createBoundedContext(
        this.#specSnapshot,
        commandBus,
        eventBus,
        systemEventBus,
        stand,
        systemStand,
        runtime,
        systemSpec,
        storageFactory,
        registeredRepositories,
        this.#deliveryStrategy,
      );
      ContextParts.attachIntegration(
        context,
        eventBus,
        systemSpec,
        ContextParts.externalEventSchemas(domainEventDispatchers),
      );
      return context;
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      ContextParts.attemptCleanup(() => runtime?.abortClose(), cleanupErrors);
      if (runtime === undefined) {
        ContextParts.attemptCleanup(
          () => void registry?.close().catch(() => undefined),
          cleanupErrors,
        );
      }
      ContextParts.attemptCleanup(() => void stand?.close().catch(() => undefined), cleanupErrors);
      ContextParts.attemptCleanup(
        () => void systemStand?.close().catch(() => undefined),
        cleanupErrors,
      );
      ContextParts.attemptCleanup(() => {
        if (systemEventBus !== undefined) eventBusAccess.abortClose(systemEventBus);
        else if (systemEventStore !== undefined) systemEventStore.close();
      }, cleanupErrors);
      ContextParts.attemptCleanup(() => {
        if (eventBus !== undefined) eventBusAccess.abortClose(eventBus);
        else if (eventStore !== undefined) eventStore.close();
      }, cleanupErrors);
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          "Bounded Context build failed during cleanup.",
        );
      }
      throw error;
    }
  }

  async #loadGeneratedRepositories(
    entityTypes: readonly RepositoryEntityType[],
  ): Promise<readonly RepositoryView[]> {
    if (entityTypes.length === 0) {
      return Object.freeze([]);
    }

    const root = ContextParts.requireGeneratedRegistryRoot(this.#generatedRegistryRoot);
    const discovery = new GeneratedRegistryDiscovery();
    const registryModule = await ContextParts.trustedGeneratedRegistryModule(root);
    const registryKey = registryModule.href;
    const registries = (await discovery
      .load({
        modules: [registryModule],
        ...ContextParts.generatedRegistryCacheBust(registryKey),
      })
      .catch((error: unknown) => {
        ContextParts.recordGeneratedRegistryFailure(registryKey);
        throw error;
      })) as readonly GeneratedHandlerRegistry[];
    const metadata = ContextParts.ingestGeneratedRegistries(registries);

    return Object.freeze(
      entityTypes.map((entityType) =>
        ContextParts.createGeneratedRepository(
          entityType,
          registries,
          metadata,
          this.#generatedRepositoryOptions.get(entityType),
        ),
      ),
    );
  }

  private createEventStore(storageFactory: StorageFactory): EventStore {
    return new EventStore(ContextParts.createStorageMode(this.#specSnapshot), storageFactory);
  }
}

/**
 * Represents the immutable specification used by a context builder.
 */
export class ContextSpec {
  readonly #snapshot: ContextSpecSnapshot;

  /**
   * Registers the framework-only construction hook for this module.
   */
  static {
    constructContextSpec = (snapshot, token): ContextSpec => new ContextSpec(snapshot, token);
  }

  /**
   * Creates a framework-owned context specification.
   *
   * @param snapshot Contains immutable specification values.
   * @param token Proves framework-controlled construction.
   */
  protected constructor(snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) {
    ContextParts.requireFrameworkConstructionToken(
      token,
      "ContextSpec instances are framework-owned.",
    );
    this.#snapshot = ContextParts.cloneSpecSnapshot(snapshot);
    Object.freeze(this);
  }

  /**
   * Returns the bounded context name.
   *
   * @returns Returns the immutable context name.
   */
  get name(): BoundedContextName {
    return this.#snapshot.name;
  }

  /**
   * Returns whether the context requires tenant isolation.
   *
   * @returns Returns true when tenant isolation is required.
   */
  get multitenant(): boolean {
    return this.#snapshot.multitenant;
  }

  /**
   * Returns the tenant mode derived from the multitenant setting.
   *
   * @returns Returns the derived tenant mode.
   */
  get tenantMode(): TenantMode {
    return ContextParts.toTenantMode(this.#snapshot.multitenant);
  }

  /**
   * Returns whether the context specification stores its domain event log.
   *
   * @returns Returns true when the context stores events.
   */
  get storesEvents(): boolean {
    return this.#snapshot.storesEvents;
  }

  /**
   * Returns a copy-safe immutable snapshot of this specification.
   *
   * @returns Returns the specification snapshot.
   */
  get snapshot(): ContextSpecSnapshot {
    return ContextParts.cloneSpecSnapshot(this.#snapshot);
  }
}

interface PreparedRepository {
  readonly repository: RepositoryView;
  readonly snapshot: RegistrationSnapshot;
  readonly entityInboxTarget?: EntityInboxTarget;
  readonly projectionInboxTarget?: ProjectionInboxTarget;
  commit(): void;
  close(): void;
}

const registeredRepositories = new WeakMap<RepositoryView, RepositoryOwner>();

interface ProjectionDispatch {
  readonly repository: RepositoryView;
  readonly dispatcher: EventDispatcher;
  readonly eventTypeUrls: ReadonlySet<string>;
  readonly schema: DescriptorMessageSchema;
  readonly typeUrl: string;
}

interface ProjectionStateClearTarget {
  readonly schema: DescriptorMessageSchema;
  readonly typeUrl: string;
}

interface CatchUpReplayDetail {
  readonly name: string;
  readonly message: string;
}

class CatchUpReplayError extends Error {
  readonly code: CatchUpReplayCode = "READ_SIDE_CATCH_UP_REPLAY_FAILED";
  readonly eventId: string;
  readonly detail: CatchUpReplayDetail;

  constructor(eventId: string, detail: CatchUpReplayDetail) {
    super(`Read-side catch-up failed for stored event "${eventId}".`);
    this.name = "ReadCatchUpReplayError";
    this.eventId = eventId;
    this.detail = detail;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Assembles private bounded-context lifecycle and replay details.
 */
const ContextParts = Object.freeze({
  attemptCleanup(onCleanup: () => void, errors: unknown[]): void {
    try {
      onCleanup();
    } catch (error) {
      errors.push(error);
    }
  },
  flattenErrors(errors: readonly unknown[]): unknown[] {
    return errors.flatMap((error) =>
      error instanceof AggregateError ? ContextParts.flattenErrors(error.errors) : [error],
    );
  },
  requireFrameworkConstructionToken(token: unknown, message: string): void {
    if (token !== frameworkConstructionToken) {
      throw new TypeError(message);
    }
  },

  createContextSpec(specSnapshot: ContextSpecSnapshot): ContextSpec {
    return constructContextSpec(specSnapshot, frameworkConstructionToken);
  },

  createBoundedContextBuilder(specSnapshot: ContextSpecSnapshot): BoundedContextBuilder {
    return constructBoundedContextBuilder(specSnapshot, frameworkConstructionToken);
  },

  createBoundedContext(
    specSnapshot: ContextSpecSnapshot,
    commandBus: CommandBus,
    eventBus: EventBus,
    systemEventBus: EventBus,
    stand: Stand,
    systemStand: Stand,
    runtime: SubscriptionRuntime,
    systemSpec: ContextSpecSnapshot,
    storageFactory: StorageFactory,
    repositories: readonly RepositoryView[],
    deliveryStrategy: DeliveryStrategy,
  ): BoundedContext {
    return constructBoundedContext(
      {
        name: specSnapshot.name,
        tenantMode: ContextParts.toTenantMode(specSnapshot.multitenant),
        spec: specSnapshot,
      },
      commandBus,
      eventBus,
      systemEventBus,
      stand,
      systemStand,
      runtime,
      systemSpec,
      storageFactory,
      repositories,
      deliveryStrategy,
      frameworkConstructionToken,
    );
  },

  createStorageMode(specSnapshot: ContextSpecSnapshot): StorageMode {
    return Object.freeze({
      name: specSnapshot.name.value,
      multitenant: specSnapshot.multitenant,
    });
  },

  createSubscriptionStorageContext(specSnapshot: ContextSpecSnapshot): StorageContext {
    return Object.freeze({
      name: `${specSnapshot.name.value}:subscriptions`,
      multitenant: false,
    });
  },

  snapshotDeliveryStrategy(strategy: DeliveryStrategy): DeliveryStrategy {
    if (!Number.isSafeInteger(strategy.shardCount) || strategy.shardCount <= 0) {
      throw new Error("Delivery strategy shard count must be a positive safe integer.");
    }
    const shardCount = strategy.shardCount;
    return Object.freeze({
      shardCount,
      shardFor(targetId: Any, targetType: string): ShardIndex {
        const shard = strategy.shardFor(InboxTargets.clone(targetId), targetType);
        if (shard.ofTotal !== shardCount) {
          throw new Error("Delivery strategy shard total must equal its resolved shard count.");
        }
        return new ShardIndex(shard.index, shard.ofTotal);
      },
    });
  },

  catchUpStorageContext(
    specSnapshot: ContextSpecSnapshot,
    options: ReadCatchUpOptions,
  ): StorageContext {
    if (!specSnapshot.multitenant) {
      if (options.tenantId !== undefined) {
        throw new Error(
          `Single-tenant read-side catch-up for "${specSnapshot.name.value}" does not accept tenantId.`,
        );
      }
      return Object.freeze({ name: specSnapshot.name.value, multitenant: false });
    }

    const tenantId = options.tenantId;
    if (tenantId === undefined) {
      throw new Error(
        `Multitenant read-side catch-up for "${specSnapshot.name.value}" requires tenantId.`,
      );
    }

    return Object.freeze({
      name: specSnapshot.name.value,
      multitenant: true,
      tenantId: TenantBoundary.from(tenantId).tenantId,
    });
  },

  createBoundedContextName(value: string): BoundedContextName {
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.startsWith(internalStoragePrefix)
    ) {
      throw new BoundedContextNameError(value);
    }
    return Object.freeze({ value });
  },

  createSpecSnapshot(name: string, multitenant: boolean): ContextSpecSnapshot {
    return Object.freeze({
      name: ContextParts.createBoundedContextName(name),
      multitenant,
      storesEvents: true,
    });
  },

  cloneName(name: BoundedContextName): BoundedContextName {
    return ContextParts.createBoundedContextName(name.value);
  },

  cloneSpecSnapshot(spec: ContextSpecSnapshot): ContextSpecSnapshot {
    return Object.freeze({
      name: ContextParts.cloneName(spec.name),
      multitenant: spec.multitenant,
      storesEvents: spec.storesEvents,
    });
  },

  cloneContextSnapshot(snapshot: BoundedContextSnapshot): BoundedContextSnapshot {
    return Object.freeze({
      name: ContextParts.cloneName(snapshot.name),
      tenantMode: snapshot.tenantMode,
      spec: ContextParts.cloneSpecSnapshot(snapshot.spec),
    });
  },

  createSystemSpec(domainSpec: ContextSpecSnapshot, storesEvents: boolean): ContextSpecSnapshot {
    return Object.freeze({
      name: ContextParts.createBoundedContextName(`${domainSpec.name.value}_System`),
      multitenant: domainSpec.multitenant,
      storesEvents,
    });
  },

  createSystemPairing(
    snapshot: BoundedContextSnapshot,
    systemSpec: ContextSpecSnapshot,
  ): SystemPairingSnapshot {
    return Object.freeze({
      domain: ContextParts.cloneContextSnapshot(snapshot),
      system: ContextParts.cloneSpecSnapshot(systemSpec),
    });
  },

  cloneSystemPairing(pairing: SystemPairingSnapshot): SystemPairingSnapshot {
    return Object.freeze({
      domain: ContextParts.cloneContextSnapshot(pairing.domain),
      system: ContextParts.cloneSpecSnapshot(pairing.system),
    });
  },

  exposedEventTypeUrls(eventBus: EventBus): readonly string[] {
    return Object.freeze(
      eventBusAccess
        .eventSchemas(eventBus)
        .filter((schema) => !ContextParts.isInternalEventSchema(schema))
        .map((schema) => TypeUrls.derive(schema)),
    );
  },

  externalEventSchemas(dispatchers: Iterable<EventDispatcher>): readonly MessageSchema[] {
    const schemas = new Map<string, MessageSchema>();
    for (const dispatcher of dispatchers) {
      for (const schema of dispatcher.externalEventSchemas?.() ?? []) {
        schemas.set(TypeUrls.derive(schema), schema);
      }
    }
    return Object.freeze([...schemas.values()]);
  },

  attachIntegration(
    context: BoundedContext,
    eventBus: EventBus,
    systemSpec: ContextSpecSnapshot,
    externalEventSchemas: Iterable<MessageSchema>,
  ): void {
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: context.name.value }),
      pairedContextName: create(BoundedContextNameSchema, { value: systemSpec.name.value }),
      transportFactory: ServerEnvironment.instance().transportFactory,
      eventBus,
      externalEventSchemas,
      postImported: async (event) => {
        const imported = clone(EventSchema, event);
        if (imported.context === undefined) throw new Error("Imported event requires context.");
        ContextParts.validateImportedTenant(context, imported);
        imported.context.external = true;
        await eventBus.post(imported);
      },
    });
    contextIntegrations.set(context, { broker, ready: broker.open() });
  },

  postContextEvent(context: BoundedContext, event: Event): Promise<void> {
    const buses = contextEventBuses.get(context);
    if (buses === undefined) return Promise.reject(new Error("Context EventBus is unavailable."));
    return (contextIntegrations.get(context)?.ready ?? Promise.resolve()).then(() => {
      ContextParts.validateImportedTenant(context, event);
      return buses[0].post(event);
    });
  },

  closeIntegration(context: BoundedContext): Promise<void> {
    return contextIntegrations.get(context)?.broker.close() ?? Promise.resolve();
  },

  publishImported(context: BoundedContext, event: Event): Promise<void> {
    const integration = contextIntegrations.get(context);
    if (integration === undefined)
      return Promise.reject(new Error("Context integration is unavailable."));
    return integration.ready.then(() => integration.broker.publishImported(event));
  },

  validateImportedTenant(context: BoundedContext, event: Event): void {
    const tenantId = ContextParts.readReplayTenant(event);
    if (!context.isMultitenant) {
      if (tenantId !== undefined) {
        throw new Error(`Single-tenant context "${context.name.value}" does not accept tenantId.`);
      }
      return;
    }
    if (tenantId === undefined) {
      throw new Error(`Multitenant context "${context.name.value}" requires tenantId.`);
    }
    TenantBoundary.from(tenantId);
  },

  integrationReady(context: BoundedContext): Promise<void> {
    return contextIntegrations.get(context)?.ready ?? Promise.resolve();
  },

  isInternalEventSchema(schema: DescriptorMessageSchema): boolean {
    return (
      (hasOption(schema, internal_type) && getOption(schema, internal_type)) ||
      (hasOption(schema, SPI_type) && getOption(schema, SPI_type)) ||
      (hasOption(schema.file, internal_all) && getOption(schema.file, internal_all))
    );
  },

  toTenantMode(multitenant: boolean): TenantMode {
    return multitenant ? "multitenant" : "single-tenant";
  },

  requireSystemPairing(context: BoundedContext): SystemPairingSnapshot {
    const pairing = contextSystemPairings.get(context);

    if (pairing === undefined) {
      throw new TypeError("System pairing requires a built BoundedContext instance.");
    }

    return pairing;
  },

  requireTenantIndex(context: BoundedContext): TenantIndex {
    const tenantIndex = contextTenantIndexes.get(context);

    if (tenantIndex === undefined) {
      throw new TypeError("Tenant index requires a built BoundedContext instance.");
    }

    return tenantIndex;
  },

  requireRepositoryInstance(repository: unknown, operation: string): void {
    if (!repositoryAccess.hasInstance(repository)) {
      throw new TypeError(`${operation} requires a Repository instance.`);
    }
  },

  requireEntityClass(entityType: unknown, operation: string): void {
    if (typeof entityType !== "function") {
      throw new TypeError(
        `${operation} requires a Repository instance. Use an entity class only with buildAsync().`,
      );
    }
  },

  rejectSyncEntityAssembly(entityTypes: ReadonlySet<RepositoryEntityType>): void {
    if (entityTypes.size === 0) {
      return;
    }

    throw new Error(
      "BoundedContextBuilder.build() cannot assemble entity classes from generated metadata. " +
        "Use buildAsync().",
    );
  },

  requireGeneratedRegistryRoot(root: string | URL | undefined): string | URL {
    if (root !== undefined) {
      return root;
    }

    throw new Error(
      "BoundedContextBuilder.buildAsync() requires withGeneratedRegistryRoot(root) " +
        "when assembling entity classes from generated metadata.",
    );
  },

  async trustedGeneratedRegistryModule(root: string | URL): Promise<URL> {
    const trustedRoot = await ContextParts.canonicalGeneratedRegistryRoot(root);
    const registryPath = resolve(trustedRoot, generatedRegistryFile);
    const canonicalRegistryPath = await ContextParts.canonicalReadableRegistryPath(registryPath);

    if (ContextParts.resolvesOutsideRoot(trustedRoot, canonicalRegistryPath)) {
      throw new Error(
        `Generated handler registry module "${canonicalRegistryPath}" must resolve within ` +
          `the configured generated registry root "${trustedRoot}".`,
      );
    }

    return pathToFileURL(canonicalRegistryPath);
  },

  async canonicalGeneratedRegistryRoot(root: string | URL): Promise<string> {
    const rootPath = ContextParts.generatedRegistryRootPath(root);

    try {
      return await realpath(rootPath);
    } catch (error) {
      throw new Error(
        `Generated registry root "${rootPath}" must be an existing readable directory.`,
        { cause: error },
      );
    }
  },

  generatedRegistryRootPath(root: string | URL): string {
    if (root instanceof URL) {
      return ContextParts.fileUrlPath(root, "Generated registry root");
    }

    if (ContextParts.isUrlLike(root)) {
      return ContextParts.fileUrlPath(ContextParts.parseRootUrl(root), "Generated registry root");
    }

    return resolve(root);
  },

  fileUrlPath(url: URL, label: string): string {
    if (url.protocol !== "file:") {
      throw new Error(`${label} "${url.href}" must use the file: URL scheme.`);
    }

    if (url.search.length > 0 || url.hash.length > 0) {
      throw new Error(`${label} "${url.href}" must not include a query or hash.`);
    }

    return resolve(fileURLToPath(url));
  },

  parseRootUrl(root: string): URL {
    try {
      return new URL(root);
    } catch (error) {
      throw new Error(`Generated registry root "${root}" is not a valid URL.`, { cause: error });
    }
  },

  isUrlLike(value: string): boolean {
    return moduleSchemeRe.test(value) && !/^[A-Za-z]:[\\/]/.test(value);
  },

  async canonicalReadableRegistryPath(registryPath: string): Promise<string> {
    try {
      await access(registryPath, fsConstants.R_OK);
      return await realpath(registryPath);
    } catch (error) {
      throw new Error(
        `Generated handler registry module "${registryPath}" must exist and be readable.`,
        { cause: error },
      );
    }
  },

  resolvesOutsideRoot(canonicalRoot: string, canonicalPath: string): boolean {
    const relativePath = relative(canonicalRoot, canonicalPath);

    return (
      relativePath.startsWith("..") ||
      relativePath === ".." ||
      relativePath.split(sep).includes("..") ||
      isAbsolute(relativePath)
    );
  },

  generatedRegistryCacheBust(
    registryKey: string,
  ): { readonly cacheBust: string } | Record<string, never> {
    const attempt = generatedRegistryLoadAttempts.get(registryKey) ?? 0;

    return attempt === 0 ? {} : { cacheBust: `retry-${attempt.toString()}` };
  },

  recordGeneratedRegistryFailure(registryKey: string): void {
    generatedRegistryLoadAttempts.set(
      registryKey,
      (generatedRegistryLoadAttempts.get(registryKey) ?? 0) + 1,
    );
  },

  ingestGeneratedRegistries(
    registries: readonly GeneratedHandlerRegistry[],
  ): HandlerMetadataRegistry {
    const registry = new HandlerMetadataRegistry();
    const ingestor = new HandlerRegistryIngestor();

    for (const generated of registries) {
      ingestor.register(generated, registry);
    }

    return registry;
  },

  createGeneratedRepository(
    entityType: RepositoryEntityType,
    registries: readonly GeneratedHandlerRegistry[],
    metadata: HandlerMetadataRegistry,
    options?: object,
  ): RepositoryView {
    const generated = ContextParts.findGeneratedEntity(entityType, registries);
    const handlers = ContextParts.findGeneratedHandlers(entityType, generated, metadata);

    const repositoryOptions = Object.assign(
      {
        entityType,
        schema: generated.stateSchema,
        handlers,
        events: ContextParts.aggregateAssignedEvents(generated),
      },
      options,
    );
    return new Repository(repositoryOptions as never);
  },

  findGeneratedEntity(
    entityType: RepositoryEntityType,
    registries: readonly GeneratedHandlerRegistry[],
  ): GeneratedEntityHandlerGroup {
    for (const registry of registries) {
      const generated = registry.entities.find((entity) => entity.entityType === entityType);
      if (generated !== undefined) {
        return generated;
      }
    }

    throw new Error(`Generated handler registry is missing metadata for ${entityType.name}.`);
  },

  findGeneratedHandlers(
    entityType: RepositoryEntityType,
    generated: GeneratedEntityHandlerGroup,
    metadata: HandlerMetadataRegistry,
  ): EntityHandlersMetadata {
    const matches = metadata.findByState(generated.stateSchema.typeName);
    const handlers = matches.find((candidate) => candidate.entityType === entityType);

    if (handlers === undefined) {
      throw new Error(`Generated handler registry is missing metadata for ${entityType.name}.`);
    }

    return handlers;
  },

  aggregateAssignedEvents(
    generated: GeneratedEntityHandlerGroup,
  ): readonly DescriptorMessageSchema[] {
    return ContextParts.uniqueSchemas(
      generated.handlers.flatMap((handler) =>
        handler.kind === "command-assignment" || handler.kind === "event-reaction"
          ? handler.emittedSchemas
          : [],
      ),
    );
  },

  uniqueSchemas<Schema extends DescriptorMessageSchema>(
    schemas: readonly Schema[],
  ): readonly Schema[] {
    const byTypeName = new Map<string, Schema>();

    for (const schema of schemas) {
      byTypeName.set(schema.typeName, schema);
    }

    return Object.freeze([...byTypeName.values()]);
  },

  preflightRepositories(repositories: readonly RepositoryView[]): void {
    const entityTypes = new Set<RepositoryEntityType>();
    const stateTypeNames = new Set<string>();

    for (const repository of repositories) {
      ContextParts.requireRepositoryInstance(repository, "BoundedContextBuilder.add(repository)");
      const snapshot = ContextParts.repositorySnapshot(repository);
      const registration = registeredRepositories.get(repository);
      if (registration !== undefined) {
        throw new Error(
          `Repository for "${snapshot.stateFullTypeName}" is already registered with Bounded Context ` +
            `"${registration.name.value}".`,
        );
      }

      if (entityTypes.has(snapshot.entityType)) {
        throw new Error(
          `Repository entity type "${snapshot.entityType.name}" is already registered.`,
        );
      }
      entityTypes.add(snapshot.entityType);

      if (stateTypeNames.has(snapshot.stateFullTypeName)) {
        throw new Error(
          `Repository state type "${snapshot.stateFullTypeName}" is already registered.`,
        );
      }
      stateTypeNames.add(snapshot.stateFullTypeName);
    }

    ContextParts.rejectStateCycles(repositories);
  },

  rejectStateCycles(repositories: readonly RepositoryView[]): void {
    const dependencies = new Map<string, readonly string[]>();
    for (const repository of repositories) {
      const stateType = ContextParts.repositorySnapshot(repository).stateFullTypeName;
      dependencies.set(stateType, repositoryAccess.stateSubscriptionTypes(repository));
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const path: string[] = [];
    const visit = (stateType: string): void => {
      if (visited.has(stateType)) return;
      if (visiting.has(stateType)) {
        const start = path.indexOf(stateType);
        const cycle = [...path.slice(start), stateType];
        throw new Error(
          `Projection state subscriptions form a feedback cycle: ${cycle.join(" -> ")}.`,
        );
      }
      visiting.add(stateType);
      path.push(stateType);
      for (const dependency of dependencies.get(stateType) ?? []) {
        if (dependencies.has(dependency)) visit(dependency);
      }
      path.pop();
      visiting.delete(stateType);
      visited.add(stateType);
    };

    for (const stateType of dependencies.keys()) visit(stateType);
  },

  repositoryCommandDispatchers(
    repositories: readonly RepositoryView[],
  ): readonly CommandDispatcher[] {
    return repositories.flatMap((repository) => {
      const dispatcher = repositoryAccess.commandDispatcher(repository);
      return dispatcher === undefined ? [] : [dispatcher];
    });
  },

  repositoryEventDispatchers(repositories: readonly RepositoryView[]): readonly EventDispatcher[] {
    return repositories.flatMap((repository) => {
      const dispatcher = repositoryAccess.eventDispatcher(repository);
      return dispatcher === undefined ? [] : [dispatcher];
    });
  },

  repositorySystemEventDispatchers(
    repositories: readonly RepositoryView[],
  ): readonly EventDispatcher[] {
    return repositories.flatMap((repository) => {
      const dispatcher = repositoryAccess.systemEventDispatcher(repository);
      return dispatcher === undefined ? [] : [dispatcher];
    });
  },

  domainEventDispatchers(dispatchers: readonly EventDispatcher[]): readonly EventDispatcher[] {
    return Object.freeze(
      dispatchers.filter((dispatcher) => !ContextParts.isSystemEventDispatcher(dispatcher)),
    );
  },

  systemEventDispatchers(dispatchers: readonly EventDispatcher[]): readonly EventDispatcher[] {
    return Object.freeze(
      dispatchers.filter((dispatcher) => ContextParts.isSystemEventDispatcher(dispatcher)),
    );
  },

  isSystemEventDispatcher(dispatcher: EventDispatcher): boolean {
    const schemas = [...dispatcher.messageSchemas()];
    const systemSchemas = schemas.filter((schema) => schema.typeName.startsWith("spine.system."));
    if (systemSchemas.length > 0 && systemSchemas.length !== schemas.length) {
      throw new Error("An EventDispatcher cannot mix domain and system event schemas.");
    }
    return systemSchemas.length > 0;
  },

  repositoryProducedEventSchemas(
    repositories: readonly RepositoryView[],
  ): readonly MessageSchema[] {
    const schemas = new Map<string, MessageSchema>();

    for (const repository of repositories) {
      for (const schema of repositoryAccess.producedEventSchemas(repository)) {
        schemas.set(TypeUrls.derive(schema), schema);
      }
    }

    return Object.freeze([...schemas.values()]);
  },

  cleanupFailedContext(context: BoundedContext, tenantIndex: TenantIndex): void {
    ContextParts.clearContextMetadata(context);
    tenantIndex.close();
  },

  clearContextMetadata(context: BoundedContext): void {
    const buses = contextEventBuses.get(context);
    if (buses !== undefined) {
      eventBusAccess.clearLogger(buses[0]);
      eventBusAccess.clearLogger(buses[1]);
    }
    const runtime = contextSubscriptionRuntimes.get(context);
    if (runtime !== undefined) subscriptionRuntimeAccess.clearLogger(runtime);
    contextDispatchFailureRecorders.delete(context);
    contextEventBuses.delete(context);
    contextLoggers.delete(context);
    contextSystemPairings.delete(context);
    contextTenantIndexes.delete(context);
    contextStorageFactories.delete(context);
    contextDeliveryDescriptors.delete(context);
    contextSubscriptionRuntimes.delete(context);
    contextIntegrations.delete(context);
    eventSubscribers.delete(context);
    systemEventPosters.delete(context);
  },

  createDeliveryDescriptor(
    context: BoundedContextSnapshot,
    storageFactory: StorageFactory,
    tenantIndex: TenantIndex,
    entityInbox: RegisteredEntityInbox,
    projections: PrjInbox,
    readiness: DeliveryReadiness,
  ): ContextDeliveryDescriptor {
    return Object.freeze({
      storageFactory,
      async startupScopes(): Promise<readonly DeliveryTenantScope[]> {
        if (tenantIndex.tenantMode === "single-tenant") {
          return Object.freeze([Object.freeze({})]);
        }

        return Object.freeze(
          (await tenantIndex.all()).map((tenantId) => Object.freeze({ tenantId })),
        );
      },
      storageContext(scope: DeliveryTenantScope): StorageContext {
        if (context.tenantMode === "single-tenant") {
          if (scope.tenantId !== undefined) {
            throw new Error(
              `Single-tenant context "${context.name.value}" does not accept tenantId.`,
            );
          }
          return Object.freeze({ name: context.name.value, multitenant: false });
        }
        const tenantId = scope.tenantId;
        if (tenantId === undefined) {
          throw new Error(`Multitenant context "${context.name.value}" requires tenantId.`);
        }
        return Object.freeze({
          name: context.name.value,
          multitenant: true,
          tenantId: TenantBoundary.from(tenantId).tenantId,
        });
      },
      endpoints(): readonly DeliveryEndpoint[] {
        return Object.freeze([...entityInbox.endpoints(), ...projections.endpoints()]);
      },
      replay(message: DeliveryEndpointMessage, tenantId?: TenantId): Promise<void> {
        return message.label === "UPDATE_SUBSCRIBER"
          ? projections.replay(message, tenantId)
          : entityInbox.replay(message, tenantId);
      },
      onReady(onReady: (ready: DeliveryReady) => void): () => void {
        return readiness.onReady(onReady);
      },
      transition(
        scopes: readonly DeliveryReady[],
        onReady: OnDeliveryReady,
        options?: { readonly allowEmpty?: boolean },
      ): Promise<void> {
        return readiness.transition(scopes, onReady, options);
      },
    });
  },

  closePreparedRepositories(
    preparedRepositories: readonly PreparedRepository[],
  ): readonly unknown[] {
    const errors: unknown[] = [];
    for (const preparedRepository of preparedRepositories) {
      try {
        preparedRepository.close();
      } catch (error) {
        errors.push(error);
      }
    }

    return errors;
  },

  async closeContextPart(close: () => unknown, errors: unknown[]): Promise<void> {
    try {
      await close();
    } catch (error) {
      ContextParts.collectCloseError(error, errors);
    }
  },

  async drainContextBuses(commandBus: CommandBus, eventBus: EventBus): Promise<void> {
    let observedCommandWork = -1;
    let observedEventWork = -1;

    do {
      observedCommandWork = commandBusAccess.acceptedWorkCount(commandBus);
      observedEventWork = eventBusAccess.acceptedWorkCount(eventBus);
      await commandBusAccess.drain(commandBus);
      await eventBusAccess.drain(eventBus);
    } while (
      commandBusAccess.acceptedWorkCount(commandBus) !== observedCommandWork ||
      eventBusAccess.acceptedWorkCount(eventBus) !== observedEventWork
    );
  },

  collectCloseError(error: unknown, errors: unknown[]): void {
    if (error instanceof AggregateError) {
      const causes = error.errors as readonly unknown[];
      for (const cause of causes) {
        errors.push(cause);
      }
      return;
    }
    errors.push(error);
  },

  prepareRepositoryForContext(
    repository: RepositoryView,
    registration: RepositoryRegistration,
  ): PreparedRepository {
    ContextParts.requireRepositoryInstance(repository, "BoundedContext repository registration");
    const snapshot = ContextParts.repositorySnapshot(repository);
    ContextParts.rejectRegisteredRepository(repository);
    repositoryAccess.bindRuntime(repository, {
      context: registration.storageContext,
      storageFactory: registration.storageFactory,
      stand: registration.stand,
      signalMetadata: new SignalMetadata(),
      entityInbox: registration.entityInbox,
      projectionInbox: registration.projectionInbox,
      dispatchStored: registration.dispatchStored,
      dispatchStoredFollowUp: registration.dispatchStoredFollowUp,
      postEventFollowUp: registration.postEventFollowUp,
      registerEventSchema: registration.registerEventSchema,
      registerSystemEventSchema: registration.registerSystemEventSchema,
      postSystemFollowUp: registration.postSystemFollowUp,
      onPostCommand: registration.onPostCommand,
      recordDispatchFailure: registration.recordDispatchFailure,
    });

    const entityInboxTarget = repositoryAccess.entityInboxTarget(repository);
    const projectionInboxTarget = repositoryAccess.projectionInboxTarget(repository);

    return {
      repository,
      snapshot,
      ...(entityInboxTarget === undefined ? {} : { entityInboxTarget }),
      ...(projectionInboxTarget === undefined ? {} : { projectionInboxTarget }),
      commit: () => {
        registeredRepositories.set(repository, { name: registration.name });
      },
      close: () => {
        repositoryAccess.clearRuntime(repository);
      },
    };
  },

  repositorySnapshot(repository: RepositoryView): RegistrationSnapshot {
    const snapshot = repositoryAccess.snapshot(repository);

    return Object.freeze({
      entityType: snapshot.entityType,
      entityFamily: snapshot.entityFamily,
      stateSchema: snapshot.stateSchema,
      metadata: snapshot.metadata,
      stateFullTypeName: snapshot.stateFullTypeName,
      idField: snapshot.idField,
      snapshot,
    });
  },

  rejectRegisteredRepository(repository: RepositoryView): void {
    const snapshot = ContextParts.repositorySnapshot(repository);
    const registration = registeredRepositories.get(repository);

    if (registration !== undefined) {
      throw new Error(
        `Repository for "${snapshot.stateFullTypeName}" is already registered with Bounded Context ` +
          `"${registration.name.value}".`,
      );
    }
  },

  repositoryColumns(snapshot: RegistrationSnapshot): readonly RecordColumn<Message>[] {
    return snapshot.metadata.columns.map(
      (field) =>
        new RecordColumn(field.name, ColumnTypes.fromField(field.descriptor), (record) =>
          ContextParts.readRecordField(record, field.localName),
        ),
    );
  },

  createRepositoryView(snapshot: RegistrationSnapshot): RepositoryView {
    return Object.freeze({
      entityType: snapshot.entityType,
      entityFamily: snapshot.entityFamily,
      stateSchema: snapshot.stateSchema,
      metadata: snapshot.metadata,
      stateFullTypeName: snapshot.stateFullTypeName,
      idField: snapshot.idField,
      snapshot: snapshot.snapshot,
    });
  },

  cloneDispatchFailure(failure: StoredEventDispatchFailure): StoredEventDispatchFailure {
    return Object.freeze({
      event: clone(EventSchema, failure.event),
      error: ContextParts.cloneDispatchError(failure.error),
    });
  },

  snapshotDispatchError(error: unknown): DispatchErrorSnapshot {
    if (error instanceof Error) {
      const snapshot: DispatchErrorSnapshot = {
        name: ContextParts.boundedErrorString(error.name, dispatchErrorMessageLimit) || "Error",
        message: ContextParts.boundedErrorString(error.message, dispatchErrorMessageLimit),
        ...(typeof error.stack === "string"
          ? { stack: ContextParts.boundedErrorString(error.stack, dispatchErrorStackLimit) }
          : {}),
      };
      return Object.freeze(snapshot);
    }

    return Object.freeze({
      name: "NonErrorThrow",
      message: ContextParts.boundedErrorString(String(error), dispatchErrorMessageLimit),
    });
  },

  cloneDispatchError(error: DispatchErrorSnapshot): DispatchErrorSnapshot {
    return Object.freeze({
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    });
  },

  projectionDispatchers(repositories: Iterable<RepositoryView>): readonly ProjectionDispatch[] {
    const projections: ProjectionDispatch[] = [];

    for (const repository of repositories) {
      const snapshot = repositoryAccess.snapshot(repository);
      const dispatcher = repositoryAccess.eventDispatcher(repository);

      if (snapshot.entityFamily !== "projection" || dispatcher === undefined) {
        continue;
      }

      projections.push(
        Object.freeze({
          repository,
          dispatcher,
          eventTypeUrls: new Set(
            dispatcher.messageSchemas().map((schema) => TypeUrls.derive(schema)),
          ),
          schema: snapshot.stateSchema,
          typeUrl: TypeUrls.derive(snapshot.stateSchema),
        }),
      );
    }

    return Object.freeze(projections);
  },

  projectionStateClearTargets(
    projections: readonly ProjectionDispatch[],
  ): readonly ProjectionStateClearTarget[] {
    const unique = new Map<string, ProjectionStateClearTarget>();

    for (const projection of projections) {
      if (!unique.has(projection.typeUrl)) {
        unique.set(
          projection.typeUrl,
          Object.freeze({
            schema: projection.schema,
            typeUrl: projection.typeUrl,
          }),
        );
      }
    }

    return Object.freeze([...unique.values()]);
  },

  async readStoredEvents(
    context: StorageContext,
    storageFactory: StorageFactory,
  ): Promise<readonly Event[]> {
    const eventStore = new EventStore(context, storageFactory);

    try {
      return await eventStore.read({
        sort: [
          { field: "timestamp", direction: "asc" },
          { field: "context.producerId.value", direction: "asc" },
          { field: "context.version.number", direction: "asc" },
          { field: "id.value", direction: "asc" },
        ],
      });
    } finally {
      eventStore.close();
    }
  },

  catchUpStandOptions(context: StorageContext): { readonly tenantId?: TenantId } {
    if (!context.multitenant) {
      return {};
    }

    return Object.freeze({ tenantId: clone(TenantIdSchema, context.tenantId) });
  },

  validateReplayTenant(context: StorageContext, event: Event): void {
    if (!context.multitenant) {
      return;
    }

    const expectedTenantId = context.tenantId;

    const envelopeTenantId = ContextParts.readReplayTenant(event);
    if (envelopeTenantId === undefined) {
      throw new Error("Read-side catch-up requires stored event envelope tenant.");
    }
    if (TenantBoundary.from(envelopeTenantId).key !== TenantBoundary.from(expectedTenantId).key) {
      throw new Error("Read-side catch-up stored event envelope tenant does not match.");
    }
  },

  readReplayTenant(event: Event): TenantId | undefined {
    switch (event.context?.origin.case) {
      case "importContext":
        return ContextParts.tenantIdValue(event.context.origin.value.tenantId);
      case "pastMessage":
        return ContextParts.tenantIdValue(event.context.origin.value.actorContext?.tenantId);
      default:
        return undefined;
    }
  },

  tenantIdValue(tenantId: TenantId | undefined): TenantId | undefined {
    return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
  },

  async dispatchStoredProjectionEvent(
    projections: readonly ProjectionDispatch[],
    event: Event,
    rebuild: boolean,
  ): Promise<number> {
    const typeUrl = event.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("Read-side catch-up requires stored event.message.typeUrl.");
    }

    const matching = projections.filter((projection) => projection.eventTypeUrls.has(typeUrl));

    for (const projection of matching) {
      await projection.dispatcher.accept?.(clone(EventSchema, event));
    }
    for (const projection of matching) {
      await repositoryAccess.dispatchProjectionDirect(
        projection.repository,
        clone(EventSchema, event),
        rebuild,
      );
    }

    return matching.length > 0 ? 1 : 0;
  },

  catchUpReplayError(event: Event, cause: unknown): Error {
    return new CatchUpReplayError(
      event.id?.value ?? "(missing)",
      ContextParts.catchUpReplayDetail(cause),
    );
  },

  boundedErrorString(value: string, limit: number): string {
    return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
  },

  catchUpReplayDetail(error: unknown): CatchUpReplayDetail {
    if (error instanceof Error) {
      return Object.freeze({
        name: ContextParts.boundedErrorString(error.name, dispatchErrorMessageLimit) || "Error",
        message: ContextParts.boundedErrorString(error.message, dispatchErrorMessageLimit),
      });
    }

    return Object.freeze({
      name: "NonErrorThrow",
      message: ContextParts.boundedErrorString(String(error), dispatchErrorMessageLimit),
    });
  },

  readRecordId(record: Message, snapshot: RegistrationSnapshot): unknown {
    const value = ContextParts.readRecordField(record, snapshot.idField.localName);

    if (value === undefined || value === null) {
      throw new Error(
        `Repository state "${snapshot.stateFullTypeName}" requires ID field "${snapshot.idField.name}".`,
      );
    }

    return value;
  },

  readRecordField(record: Message, localName: DescriptorFieldMetadata["localName"]): unknown {
    return (record as Record<string, unknown>)[localName];
  },
});

/** @internal */
export const boundedContextIntegrationAccess: Readonly<{
  publishImported(context: BoundedContext, event: Event): Promise<void>;
  ready(context: BoundedContext): Promise<void>;
}> = Object.freeze({
  publishImported(context: BoundedContext, event: Event): Promise<void> {
    return ContextParts.publishImported(context, event);
  },
  ready(context: BoundedContext): Promise<void> {
    return ContextParts.integrationReady(context);
  },
});
