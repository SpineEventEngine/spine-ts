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

import type { ILogLayer } from "loglayer";

import { clone, create, getOption, hasOption, type Message } from "@bufbuild/protobuf";
import type { AiRegistry } from "@spine-event-engine/ai";
import { freezeRegistry, isAiModel, registryOptions } from "@spine-event-engine/ai/spi/runtime";
import { TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import {
  EventSchema,
  EventContextSchema,
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
  RecordColumn,
  type StorageContext,
  type StorageFactory,
  type StorageMode,
} from "@spine-event-engine/storage";
import {
  AgentHistoryStorageFactories,
  EventStoreGroups,
  eventStoreRecordSpec,
  StoragePreparations,
  TenantBoundary,
  type StoragePreparationMode,
} from "@spine-event-engine/storage/provider";

import { CommandBus, commandBusAccess } from "../bus/command-bus.js";
import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import {
  EventBus,
  eventBusAccess,
  isSystemEventSchema,
  type EventSubscriber,
  type EventSubscription,
} from "../bus/event-bus.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import { type DeliveryEndpoint, DeliveryReadiness } from "./local-inbox-handoff.js";
import { LocalEntityInbox } from "./entity-inbox.js";
import { LocalProjectionInbox } from "./projection-handoff.js";
import { TenantAdmissions } from "./tenant-unknown-error.js";
import type { TenantIndex } from "./tenant-index.js";
import {
  AgentExecutionCapacity,
  type AgentCapacityReservation,
} from "../agent/agent-execution-capacity.js";
import {
  AgentAcceptanceReceipts,
  agentAcceptanceReceiptGroup,
  agentAcceptanceReceiptSpec,
} from "../agent/agent-acceptance-receipts.js";
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
import { spineMetadataFor } from "../handler/spine-metadata-inventory.js";
import {
  HandlerRegistryIngestor,
  type GeneratedEntityHandlerGroup,
  type GeneratedHandlerRegistry,
  type GeneratedStandaloneHandlerGroup,
} from "../handler/generated-handler-registry.js";
import {
  AbstractAssignee,
  AbstractCommander,
  AbstractEventReactor,
  AbstractEventSubscriber,
} from "../handler/standalone.js";
import {
  HandlerMetadataRegistry,
  type EntityHandlersMetadata,
} from "../handler/handler-metadata.js";
import { SignalMetadata } from "../runtime/signal-metadata.js";
import { runtimeAccess } from "../runtime/runtime.js";
import { Stand, standAccess } from "../stand/stand.js";
import { SubscriptionRuntime, subscriptionRuntimeAccess } from "../stand/subscription-runtime.js";
import {
  StorageSubscriptionRegistry,
  subscriptionRecordSpec,
  type StandSubscriptionRegistry,
} from "../stand/subscription-registry.js";
import type { DeliveryEndpointMessage } from "../delivery/delivery.js";
import type { DeliveryStrategy } from "../delivery/delivery-builder.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { IntegrationBroker } from "../integration/integration-broker.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../server/server-environment.js";
import { SignalPublisher } from "../runtime/signal-publisher.js";
import {
  StandaloneHandlerRuntime,
  type StandaloneBinding,
} from "../runtime/standalone-handler-runtime.js";

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
 * Bounded Context associated with a registered repository.
 */
interface RepositoryOwner {
  // prettier-ignore

  /**
   * Bounded context name.
   */
  readonly name: BoundedContextName;
}

/**
 * Storage and delivery services supplied when a repository registers.
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
   * Checks live membership before a direct repository read.
   */
  readonly onAdmit: (tenantId: TenantId | undefined) => Promise<void>;

  /**
   * Application AI registry selected before Agent repository intake.
   */
  readonly ai?: AiRegistry;

  /**
   * Hands a completed Agent Event once to the normal Event publisher.
   */
  readonly publishAgentEvent: (event: Event) => Promise<void>;

  /**
   * Hands an Agent System Event to the paired context publisher with contained dispatch failures.
   */
  readonly publishAgentSystemEvent: (event: Event) => Promise<void>;

  /**
   * Retained atomic admission evidence for live Agent delivery.
   */
  readonly agentReceipts: AgentAcceptanceReceipts;

  /**
   * Reserves local serialized Agent capacity before a receipt is written.
   */
  readonly reserveAgent: (key: string, signal: AbortSignal) => AgentCapacityReservation | undefined;

  /**
   * Cancels only this context's admitted Agent work.
   */
  readonly agentSignal: AbortSignal;

  /**
   * Retains a capacity-deferred shard hint for the next available slot.
   */
  readonly deferAgent: (message: InboxMessage, tenantId: TenantId | undefined) => void;

  /**
   * Stand that stores read-side state for this context.
   */
  readonly stand: Stand;

  /**
   * Entity Inbox that delivers Aggregate and Process Manager work.
   */
  readonly entityInbox: EntityInbox;

  /**
   * Projection Inbox that delivers local subscriber work.
   */
  readonly projectionInbox: ProjectionInbox;

  /**
   * Publisher for signals produced by repository handlers.
   */
  readonly publisher: SignalPublisher;

  /**
   * Registers a schema for a framework-produced event before it enters the event bus.
   */
  readonly registerEventSchema: (schema: MessageSchema) => void;

  /**
   * Registers a schema for an internal system event.
   */
  readonly registerSystemEventSchema: (schema: MessageSchema) => void;
}

interface RegisteredEntityInbox extends EntityInbox {
  /**
   * Waits for callbacks already accepted by exact local handoffs.
   *
   * @returns Completion after all accepted callbacks settle.
   */
  whenFollowUpsIdle(): Promise<void>;

  /**
   * Registers an Aggregate or Process Manager target for local delivery.
   *
   * @param target Target delivery metadata.
   */
  register(target: EntityInboxTarget): void;

  /**
   * Lists endpoints registered for local Entity work.
   *
   * @returns Registered delivery endpoints.
   */
  endpoints(): readonly DeliveryEndpoint[];
}

interface PrjInbox extends ProjectionInbox {
  /**
   * Registers a Projection target for local subscriber delivery.
   *
   * @param target Subscriber delivery metadata.
   */
  register(target: ProjectionInboxTarget): void;

  /**
   * Lists endpoints registered for local Projection work.
   *
   * @returns Registered delivery endpoints.
   */
  endpoints(): readonly DeliveryEndpoint[];
}

/**
 * Gives delivery infrastructure access to one built bounded context.
 */
export interface ContextDeliveryDescriptor {
  // prettier-ignore

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
   * Posts a command to this context's command bus.
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
   * Posts an event to this context's event bus.
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

/**
 * Rejects an Entity state type already served by another open domain context.
 */
export class DuplicateEntityStateException extends Error {
  // prettier-ignore

  /**
   * Wire type URL of the conflicting Entity state.
   */
  readonly stateType: string;

  /**
   * Name of the context that already serves the state.
   */
  readonly registeredContext: string;

  /**
   * Name of the context attempting registration.
   */
  readonly conflictingContext: string;

  /**
   * Creates a duplicate-state registration error.
   * @param stateType Entity state wire type URL.
   * @param registeredContext Existing domain context name.
   * @param conflictingContext New domain context name.
   */
  constructor(stateType: string, registeredContext: string, conflictingContext: string) {
    super(
      `Entity state "${stateType}" is already registered in "${registeredContext}"; ` +
        `register it in only one open domain Bounded Context (attempted in "${conflictingContext}").`,
    );
    this.name = "DuplicateEntityStateException";
    this.stateType = stateType;
    this.registeredContext = registeredContext;
    this.conflictingContext = conflictingContext;
  }
}

interface FrameworkConstructionToken {
  readonly frameworkConstructionToken: true;
}

const frameworkConstructionToken: FrameworkConstructionToken = Object.freeze({
  frameworkConstructionToken: true,
});
const errorDetailLimit = 500;
const internalStoragePrefix = "__spine/";
const eventSubscribers = new WeakMap<
  BoundedContext,
  (typeUrl: string, subscriber: EventSubscriber) => EventSubscription
>();
const contextSystemPairings = new WeakMap<BoundedContext, SystemPairingSnapshot>();
const contextTenantIndexes = new WeakMap<BoundedContext, TenantIndex>();
const contextStorageFactories = new WeakMap<BoundedContext, StorageFactory>();
const contextDeliveryDescriptors = new WeakMap<BoundedContext, ContextDeliveryDescriptor>();
const contextSubscriptionRuntimes = new WeakMap<BoundedContext, SubscriptionRuntime>();
const contextPreparations = new WeakMap<
  BoundedContext,
  (options: BoundedContextBuildOptions) => Promise<void>
>();
const contextInputPreparations = new WeakMap<
  BoundedContext,
  (tenantId?: TenantId) => Promise<void>
>();
const contextLoggers = new WeakMap<BoundedContext, ILogLayer>();
const contextSignalPublishers = new WeakMap<BoundedContext, SignalPublisher>();
const contextEventBuses = new WeakMap<BoundedContext, readonly [EventBus, EventBus]>();
const contextRepositoryViews = new WeakMap<BoundedContext, ReadonlySet<RepositoryView>>();
const issuedRepositoryViews = new WeakMap<
  RepositoryView,
  { readonly context: BoundedContext; readonly repository: RepositoryView }
>();
const closingContexts = new WeakSet<BoundedContext>();
const contextClosePhases = new WeakMap<
  BoundedContext,
  {
    readonly begin: () => void;
    readonly drain: () => Promise<void>;
    readonly trackReplay: (onReplay: () => Promise<void>) => Promise<void>;
  }
>();
const contextIntegrations = new WeakMap<
  BoundedContext,
  { readonly broker: IntegrationBroker; readonly ready: Promise<void> }
>();
const systemEventPosters = new WeakMap<BoundedContext, (event: Event) => Promise<void>>();
const builderBuilds = new WeakMap<BoundedContextBuilder, () => Promise<BoundedContext>>();
const explicitPreparations = new WeakMap<
  BoundedContext,
  (mode: StoragePreparationMode, ids: readonly TenantId[]) => Promise<void>
>();

interface BoundedContextAccess {
  /**
   * Returns whether a completed context has begun closing.
   *
   * @param context Completed context.
   * @returns Whether close has started.
   */
  isClosing(context: BoundedContext): boolean;

  /**
   * Prepares one already-admitted context without joining global fatal cleanup.
   *
   * @param context Admitted context.
   * @param mode Creation or read-only check.
   * @param ids Captured tenant identities, when supplied.
   * @returns Completion of local preparation.
   */
  prepareExplicit(
    context: BoundedContext,
    mode: StoragePreparationMode,
    ids: readonly TenantId[],
  ): Promise<void>;

  /**
   * Admits a service membership and preparation chain before its first await.
   *
   * @param context Selected built context.
   * @param tenantId Captured tenant identity, when applicable.
   * @param onMembership Checks live tenant membership.
   * @param onReady Performs the admitted one-shot registry mutation, if present.
   * @returns Tracked completion of membership and model preparation.
   */
  admitServiceInput(
    context: BoundedContext,
    tenantId: TenantId | undefined,
    onMembership: () => Promise<void>,
    onReady?: () => Promise<void>,
  ): Promise<void>;

  /**
   * Admits one shared subscription-registry operation before asynchronous lookup.
   *
   * @param context Selected built context.
   * @param onOperation Complete registry operation.
   * @returns Tracked operation completion.
   */
  admitServiceRegistryOperation(
    context: BoundedContext,
    onOperation: () => Promise<void>,
  ): Promise<void>;

  /**
   * Registers an entered shared replay through its complete callback.
   *
   * @param context Selected Bounded Context.
   * @param onReplay Complete replay callback.
   * @returns Completion of the captured callback.
   */
  trackReplay(context: BoundedContext, onReplay: () => Promise<void>): Promise<void>;

  /**
   * Resolves an original or Bounded Context-issued copy-safe repository view.
   *
   * @param context Built Bounded Context that registered the repository.
   * @param view Candidate original or issued view.
   * @returns Registered repository, or undefined for a foreign view.
   */
  resolveRepository(context: BoundedContext, view: RepositoryView): RepositoryView | undefined;

  /**
   * Stops new work admission before a Server drains all its contexts.
   *
   * @param context Built context entering shutdown.
   */
  beginClose(context: BoundedContext): void;

  /**
   * Waits for accepted work while every Stand remains available.
   *
   * @param context Built context whose work must settle.
   * @returns Completion after the context's accepted work drains.
   */
  drainWork(context: BoundedContext): Promise<void>;

  /**
   * Checks whether a value is a builder created by this module.
   *
   * @param value Value to check.
   * @returns True for a registered builder.
   */
  isBuilder(value: unknown): value is BoundedContextBuilder;

  /**
   * Builds a registered context builder using the configured environment.
   *
   * @param builder Registered builder to build.
   * @returns Promise resolving to a bounded context.
   */
  build(builder: BoundedContextBuilder): Promise<BoundedContext>;

  /**
   * Subscribes to a public event type on a built context.
   *
   * @param context Built context to observe.
   * @param typeUrl Public event type URL.
   * @param subscriber Event subscriber to register.
   * @returns Cancellable event subscription.
   */
  subscribeToEvent(
    context: BoundedContext,
    typeUrl: string,
    subscriber: EventSubscriber,
  ): EventSubscription;

  /**
   * Posts a framework System event through the context publisher.
   *
   * @param context Target bounded context.
   * @param event System event to post.
   * @returns Promise settling after publication.
   */
  postSystemEvent(context: BoundedContext, event: Event): Promise<void>;

  /**
   * Marks a copied event as external and posts it through the context endpoint.
   *
   * @param context Target bounded context.
   * @param event External event to post.
   * @returns Event dispatch promise.
   */
  postExternalEvent(context: BoundedContext, event: Event): Promise<void>;

  /**
   * Observes commands and events published by the context.
   *
   * @param context Context whose signals are observed.
   * @param observer Callbacks for produced commands and events.
   * @returns Handle whose close operation removes the observer.
   */
  observeProducedSignals(
    context: BoundedContext,
    observer: {
      readonly onCommand?: (command: Readonly<Command>) => void;
      readonly onEvent?: (event: Readonly<Event>) => void;
    },
  ): { readonly close: () => void };

  /**
   * Returns a copy-safe snapshot of paired domain and System specifications.
   *
   * @param context Context whose pairing is read.
   * @returns Paired specification snapshot.
   */
  systemPairing(context: BoundedContext): SystemPairingSnapshot;

  /**
   * Returns the context tenant index.
   *
   * @param context Context whose index is read.
   * @returns Tenant index for the built context.
   */
  tenantIndex(context: BoundedContext): TenantIndex;

  /**
   * Returns the storage factory configured for a built context.
   *
   * @param context Context whose storage factory is read.
   * @returns Configured storage factory.
   */
  storageFactory(context: BoundedContext): StorageFactory;

  /**
   * Returns the context's Stand subscription registry.
   *
   * @param context Context whose registry is read.
   * @returns Stand subscription registry.
   */
  subscriptionRegistry(context: BoundedContext): StandSubscriptionRegistry;

  /**
   * Processes a registered Stand subscription and forwards each update.
   *
   * @param context Context containing the subscription.
   * @param id Registered subscription ID.
   * @param onUpdate Callback receiving updates.
   * @returns Promise resolving to the subscription handle.
   */
  consumeSubscription(
    context: BoundedContext,
    id: string,
    onUpdate: (update: import("@spine-event-engine/proto/client").SubscriptionUpdate) => void,
  ): Promise<import("../stand/stand.js").StandSubscription>;

  /**
   * Sets a logger on context buses and subscription runtime.
   *
   * @param context Context receiving the logger.
   * @param logger Logging layer to install.
   */
  installLogger(context: BoundedContext, logger: ILogLayer): void;

  /**
   * Returns the logger installed on a built context.
   *
   * @param context Context whose logger is read.
   * @returns Installed logging layer.
   */
  loggerFor(context: BoundedContext): ILogLayer;

  /**
   * Returns the delivery descriptor for a built context.
   *
   * @param context Context whose descriptor is read.
   * @returns Delivery descriptor.
   */
  delivery(context: BoundedContext): ContextDeliveryDescriptor;
}

/**
 * Prepared services passed through the framework-only context construction hook.
 */
interface BoundedContextAssembly {
  // prettier-ignore

  /**
   * Immutable context metadata.
   */
  readonly snapshot: BoundedContextSnapshot;

  /**
   * Effective live tenant membership index.
   */
  readonly tenantIndex: TenantIndex;

  /**
   * Command dispatch for this context.
   */
  readonly commandBus: CommandBus;

  /**
   * Domain Event dispatch for this context.
   */
  readonly eventBus: EventBus;

  /**
   * System Event dispatch for the paired context.
   */
  readonly systemEventBus: EventBus;

  /**
   * Publishes signals produced by handlers.
   */
  readonly publisher: SignalPublisher;

  /**
   * Domain read-side Stand.
   */
  readonly stand: Stand;

  /**
   * Paired System read-side Stand.
   */
  readonly systemStand: Stand;

  /**
   * Coordinates paired subscriptions.
   */
  readonly subscriptionRuntime: SubscriptionRuntime;

  /**
   * Paired System Context metadata.
   */
  readonly systemSpec: ContextSpecSnapshot;

  /**
   * Provider that creates context storage.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Selected AI registry, if this Bounded Context accepts Agent work.
   */
  readonly ai?: AiRegistry;

  /**
   * Repositories registered in this context.
   */
  readonly repositories: readonly RepositoryView[];

  /**
   * Sharding choice for Entity Inbox delivery.
   */
  readonly deliveryStrategy: DeliveryStrategy;

  /**
   * Proof of framework-controlled construction.
   */
  readonly token: FrameworkConstructionToken;
}

/**
 * Tenant-aware delivery services prepared during context construction.
 */
interface ContextDeliveryParts {
  // prettier-ignore

  /**
   * Readiness signal shared by both Inboxes.
   */
  readonly deliveryReadiness: DeliveryReadiness;

  /**
   * Effective tenant index for delivery scopes.
   */
  readonly tenantIndex: TenantIndex;

  /**
   * Inbox for Entity messages.
   */
  readonly entityInbox: RegisteredEntityInbox;

  /**
   * Inbox for Projection messages.
   */
  readonly projectionInbox: PrjInbox;
}

let constructBoundedContext: ((input: BoundedContextAssembly) => BoundedContext) | undefined;
let registerBoundedContext:
  ((context: BoundedContext, repositories: readonly RepositoryView[]) => void) | undefined;
let constructBoundedContextBuilder:
  | ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => BoundedContextBuilder)
  | undefined;
let constructContextSpec:
  ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => ContextSpec) | undefined;

/**
 * Explicit preparation operations for one built Bounded Context.
 */
export interface BoundedContextRuntime {
  /**
   * Creates declared storage structures for current or selected tenants.
   * With no IDs, a multitenant context pages its current index; a single-tenant
   * context prepares its neutral destination. Database-backed providers require
   * an existing database; this method does not provision one.
   * @param tenantIds Optional registered complete tenant identities.
   * @returns Completion after required structures are ready; malformed IDs reject the promise.
   */
  createStorageStructures(...tenantIds: TenantId[]): Promise<void>;

  /**
   * Checks declared structures without creating them.
   * With no IDs, a multitenant context pages its current index; a single-tenant
   * context checks its neutral destination. Database-backed providers require
   * an existing database; this method does not provision one.
   * @param tenantIds Optional registered complete tenant identities.
   * @returns Completion after read-only compatibility checks; malformed IDs reject the promise.
   */
  checkStructureCompatibility(...tenantIds: TenantId[]): Promise<void>;

  /**
   * Starts the first shared subscription registry pass without tenant structures.
   * @returns Completion after initial monitoring is ready.
   */
  startSubscriptionMonitoring(): Promise<void>;
}

/**
 * Represents a built bounded context and its command, event, repository, and read-side resources.
 */
export class BoundedContext {
  readonly #snapshot: BoundedContextSnapshot;

  readonly #commandBus: CommandBus;

  readonly #eventBus: EventBus;

  readonly #systemEventBus: EventBus;

  readonly #publisher: SignalPublisher;

  readonly #commandEndpoint: CommandEndpoint;

  readonly #eventEndpoint: EventEndpoint;

  readonly #entityInbox: RegisteredEntityInbox;

  readonly #projectionInbox: PrjInbox;

  readonly #deliveryReadiness: DeliveryReadiness;

  #stopAgentAvailability: (() => void) | undefined;

  readonly #registeredRepositories: RegistrationSnapshot[] = [];

  readonly #repositoryViews = new Set<RepositoryView>();

  readonly #storageFactory: StorageFactory;

  readonly #environment: ServerEnvironment;

  readonly #ai: AiRegistry | undefined;

  readonly #stand: Stand;

  readonly #systemStand: Stand;

  readonly #subscriptionRuntime: SubscriptionRuntime;

  /**
   * Explicit storage and subscription preparation for this built context.
   */
  readonly runtime: BoundedContextRuntime;

  readonly #agentReceipts: AgentAcceptanceReceipts;

  readonly #agentController = new AbortController();

  readonly #agentReservations = new Set<Promise<void>>();

  readonly #activeReplays = new Set<Promise<void>>();

  readonly #activePreparations = new Set<Promise<void>>();

  readonly #tenantPreparations = new Map<string | symbol, Promise<void>>();

  readonly #preparationController = new AbortController();

  #sharedPreparation: Promise<void> | undefined;

  #closed: Promise<void> | undefined;

  /**
   * Registers the framework-only construction hook for this module.
   */
  static {
    constructBoundedContext = (input): BoundedContext => new BoundedContext(input);
    registerBoundedContext = (context, repositories) => {
      context.#registerRepositories(repositories);
    };
  }

  /**
   * Creates a Bounded Context from its prepared framework services.
   *
   * @param input Prepared services and framework construction token.
   */
  protected constructor(input: BoundedContextAssembly) {
    ContextParts.requireFrameworkConstructionToken(
      input.token,
      "BoundedContext instances are framework-owned.",
    );
    this.#snapshot = ContextParts.cloneContextSnapshot(input.snapshot);
    this.#commandBus = input.commandBus;
    this.#eventBus = input.eventBus;
    this.#systemEventBus = input.systemEventBus;
    this.#publisher = input.publisher;
    this.#stand = input.stand;
    this.#systemStand = input.systemStand;
    this.#subscriptionRuntime = input.subscriptionRuntime;
    this.runtime = this.#createRuntime();
    this.#storageFactory = input.storageFactory;
    this.#agentReceipts = new AgentAcceptanceReceipts(input.storageFactory);
    this.#environment = ServerEnvironment.instance();
    this.#ai = input.ai;
    this.#installTenantAdmission();
    this.#commandEndpoint = Object.freeze({
      acceptedCommandTypes: () => this.#commandBus.acceptedCommandTypes(),
      post: (command: Command) => this.#commandBus.post(command),
    });
    this.#eventEndpoint = Object.freeze({
      acceptedEventTypes: () => ContextParts.exposedEventTypeUrls(this.#eventBus),
      post: (event: Event) => ContextParts.postContextEvent(this, event),
    });
    const delivery = this.#createDelivery(input.tenantIndex);
    this.#deliveryReadiness = delivery.deliveryReadiness;
    this.#entityInbox = delivery.entityInbox;
    this.#projectionInbox = delivery.projectionInbox;
    this.#installReferences(input, delivery);
    serverEnvironmentAccess.addContext(this.#environment, this);
    Object.freeze(this);
  }

  /**
   * Exposes explicit preparation for this built context.
   *
   * @returns Stable explicit preparation methods.
   */
  #createRuntime(): BoundedContextRuntime {
    return Object.freeze({
      createStorageStructures: (...ids: TenantId[]) => this.#explicitStructures("create", ids),
      checkStructureCompatibility: (...ids: TenantId[]) => this.#explicitStructures("check", ids),
      startSubscriptionMonitoring: () => this.#explicitMonitoring(),
    });
  }

  /**
   * Installs live membership checks on context signal buses.
   *
   */
  #installTenantAdmission(): void {
    explicitPreparations.set(this, (mode, ids) => this.#prepareExplicitLocal(mode, ids));
    commandBusAccess.bindEnvironment(this.#commandBus, this.#environment);
    eventBusAccess.bindEnvironment(this.#eventBus, this.#environment);
    eventBusAccess.bindEnvironment(this.#systemEventBus, this.#environment);
    commandBusAccess.setAdmission(this.#commandBus, (command) =>
      this.#admitTenant(command.context?.actorContext?.tenantId),
    );
    eventBusAccess.setAdmission(this.#eventBus, (event) =>
      this.#admitTenant(ContextParts.readReplayTenant(event)),
    );
    standAccess.setAdmission(this.#stand, (tenantId) => this.#admitTenant(tenantId));
    standAccess.setPublicAdmission(this.#stand, () => {
      if (closingContexts.has(this) && !runtimeAccess.isRunningAdmittedWork(this.#environment))
        throw new Error("Bounded Context is closing.");
    });
  }

  /**
   * Checks this context's live index before repository work.
   *
   * @param tenantId Captured tenant identity, when applicable.
   */
  async #admitTenant(tenantId?: TenantId): Promise<void> {
    await TenantAdmissions.require(
      this.tenantIndex,
      this.#snapshot.name.value,
      this.isMultitenant,
      tenantId,
    );
    await this.#prepareInput(tenantId);
  }

  /**
   * Initializes only the admitted input's complete context and tenant requirements.
   * @param tenantId Captured input tenant identity, when applicable.
   * @returns Completion after storage and first monitoring pass are ready.
   */
  async #prepareInput(tenantId?: TenantId): Promise<void> {
    await this.#prepareShared("create");
    await this.#prepareTenant(tenantId, "create");
    if (!closingContexts.has(this)) await this.#subscriptionRuntime.start();
  }

  /**
   * Prepares the fixed shared subscription registry layout once per context.
   * @param mode Required provider preparation mode.
   * @returns Shared preparation completion.
   */
  #prepareShared(mode: StoragePreparationMode): Promise<void> {
    if (!(this.#subscriptionRuntime.registry() instanceof StorageSubscriptionRegistry))
      return Promise.resolve();
    if (this.#sharedPreparation !== undefined) return this.#sharedPreparation;
    const attempt = this.#trackPreparation(() =>
      StoragePreparations.for(this.#storageFactory).prepareRecord(
        ContextParts.createSubscriptionStorageContext(this.#snapshot.spec),
        subscriptionRecordSpec,
        undefined,
        mode,
      ),
    );
    this.#sharedPreparation = attempt;
    void attempt.catch(() => {
      if (this.#sharedPreparation === attempt) this.#sharedPreparation = undefined;
    });
    return attempt;
  }

  /**
   * Shares one pending complete-tenant preparation without caching a stale model flag.
   * @param tenantId Captured tenant identity, when applicable.
   * @param mode Required provider preparation mode.
   * @returns Complete tenant preparation attempt.
   */
  #prepareTenant(tenantId: TenantId | undefined, mode: StoragePreparationMode): Promise<void> {
    const context = this.#storageContextFor(tenantId);
    const key = TenantBoundary.of(context).key;
    const pending = this.#tenantPreparations.get(key);
    if (pending !== undefined) return pending;
    const attempt = this.#trackPreparation(() => this.#prepareTenantNow(context, mode));
    this.#tenantPreparations.set(key, attempt);
    void attempt.then(
      () => this.#tenantPreparations.delete(key),
      () => this.#tenantPreparations.delete(key),
    );
    return attempt;
  }

  /**
   * Prepares exact Event, Entity and Agent families for one captured destination.
   * @param context Captured physical storage destination.
   * @param mode Required provider preparation mode.
   * @returns Completion after all declared families are ready.
   */
  async #prepareTenantNow(context: StorageContext, mode: StoragePreparationMode): Promise<void> {
    const preparation = StoragePreparations.for(this.#storageFactory);
    await preparation.prepareRecord(
      context,
      eventStoreRecordSpec,
      EventStoreGroups.forContext(context.name),
      mode,
    );
    const system = ContextParts.requireSystemPairing(this).system;
    if (system.storesEvents) {
      const systemContext = { ...context, name: system.name.value };
      await preparation.prepareRecord(
        systemContext,
        eventStoreRecordSpec,
        EventStoreGroups.forContext(system.name.value, "system"),
        mode,
      );
    }
    for (const repository of this.#repositoryViews)
      await repositoryAccess.prepareStorage(repository, context, this.#storageFactory, mode);
    if ([...this.#repositoryViews].some((repository) => repository.entityFamily === "agent"))
      await preparation.prepareRecord(
        context,
        agentAcceptanceReceiptSpec,
        agentAcceptanceReceiptGroup,
        mode,
      );
  }

  /**
   * Captures the same tenant scope used by repository and Event storage.
   * @param tenantId Complete selected tenant identity, when applicable.
   * @returns A detached provider storage context.
   */
  #storageContextFor(tenantId: TenantId | undefined): StorageContext {
    if (!this.isMultitenant) return { name: this.name.value, multitenant: false };
    if (tenantId === undefined) throw new Error("Multitenant preparation requires tenantId.");
    return {
      name: this.name.value,
      multitenant: true,
      tenantId: TenantBoundary.from(tenantId).tenantId,
    };
  }

  /**
   * Retains an admitted preparation until closure can safely release its provider.
   * @param onPrepare Complete provider preparation callback.
   * @returns Tracked preparation completion.
   */
  #trackPreparation(onPrepare: () => Promise<void>): Promise<void> {
    const attempt = Promise.resolve().then(onPrepare);
    this.#activePreparations.add(attempt);
    void attempt.then(
      () => this.#activePreparations.delete(attempt),
      () => this.#activePreparations.delete(attempt),
    );
    return attempt;
  }

  /**
   * Completes independently requested eager structure and monitor phases.
   * @param options Independent build-time initialization choices.
   * @returns Completion after requested phases settle.
   */
  async #prepareBuild(options: BoundedContextBuildOptions): Promise<void> {
    if (options.createStorageStructures !== false) {
      await this.#requiredPrepare(() => this.#prepareShared("create"));
      await this.#prepareCurrentTenants("create");
    }
    if (options.startSubscriptionMonitoring !== false) {
      await this.#requiredPrepare(() => this.#prepareShared("create"));
      await this.#requiredPrepare(() => this.#subscriptionRuntime.start());
    }
  }

  /**
   * Classifies a requested startup phase without changing shared lazy attempts.
   * @param onPrepare Required provider or initial-monitor phase.
   * @returns Completion of the requested phase.
   */
  async #requiredPrepare(onPrepare: () => Promise<void>): Promise<void> {
    serverEnvironmentAccess.requireAvailable(this.#environment);
    try {
      await onPrepare();
    } catch (error) {
      serverEnvironmentAccess.failStartup(this.#environment, error);
      throw error;
    }
    serverEnvironmentAccess.requireAvailable(this.#environment);
  }

  /**
   * Traverses the current live index in finite pages without a tenant cap.
   * @param mode Creation or read-only check.
   * @returns Completion after currently listed tenants are prepared.
   */
  async #prepareCurrentTenants(mode: StoragePreparationMode): Promise<void> {
    if (!this.isMultitenant)
      return this.#requiredPrepare(() => this.#prepareTenant(undefined, mode));
    let after: import("./tenant-index.js").TenantIndexCursor | undefined;
    do {
      serverEnvironmentAccess.requireAvailable(this.#environment);
      const page = await this.tenantIndex.page({
        count: 64,
        signal: this.#preparationController.signal,
        ...(after === undefined ? {} : { after }),
      });
      serverEnvironmentAccess.requireAvailable(this.#environment);
      for (const id of page.ids) {
        serverEnvironmentAccess.requireAvailable(this.#environment);
        await TenantAdmissions.require(this.tenantIndex, this.name.value, true, id);
        serverEnvironmentAccess.requireAvailable(this.#environment);
        await this.#requiredPrepare(() => this.#prepareTenant(id, mode));
      }
      after = page.hasMore ? page.after : undefined;
    } while (after !== undefined);
  }

  /**
   * Admits explicit structure work and joins fatal cleanup after local settlement.
   * @param mode Creation or read-only compatibility mode.
   * @param tenantIds Explicit complete tenant identities, if supplied.
   * @returns Completion after the selected structures are ready.
   */
  async #explicitStructures(
    mode: StoragePreparationMode,
    tenantIds: readonly TenantId[],
  ): Promise<void> {
    const captured = tenantIds.map((id) => TenantBoundary.from(id).tenantId);
    const admitted = boundedContextAccess.admitServiceRegistryOperation(this, () =>
      this.#prepareExplicitLocal(mode, captured),
    );
    return this.#joinRequiredCleanup(admitted);
  }

  /**
   * Runs explicit preparation while the caller holds this context's admission.
   *
   * @param mode Creation or read-only check.
   * @param ids Captured tenant identities, when supplied.
   * @returns Completion of the local preparation.
   */
  async #prepareExplicitLocal(
    mode: StoragePreparationMode,
    ids: readonly TenantId[],
  ): Promise<void> {
    const selected = await this.#selectedTenants(ids);
    await this.#requiredPrepare(() => this.#prepareShared(mode));
    if (selected === undefined) return this.#prepareCurrentTenants(mode);
    for (const id of selected) {
      await TenantAdmissions.require(this.tenantIndex, this.name.value, this.isMultitenant, id);
      await this.#requiredPrepare(() => this.#prepareTenant(id, mode));
    }
  }

  /**
   * Validates all explicit IDs before any provider preparation.
   *
   * @param ids Captured explicit tenant identities.
   * @returns Distinct current IDs or undefined for all current tenants.
   */
  async #selectedTenants(ids: readonly TenantId[]): Promise<readonly TenantId[] | undefined> {
    if (ids.length === 0) return undefined;
    const selected = new Map<string | symbol, TenantId>();
    for (const id of ids) {
      await TenantAdmissions.require(this.tenantIndex, this.name.value, this.isMultitenant, id);
      const boundary = TenantBoundary.from(id);
      selected.set(boundary.key, boundary.tenantId);
    }
    return [...selected.values()];
  }

  /**
   * Starts the one initial monitor pass as an explicit required phase.
   *
   * @returns Completion after the initial pass.
   */
  #explicitMonitoring(): Promise<void> {
    const admitted = boundedContextAccess.admitServiceRegistryOperation(this, async () => {
      await this.#requiredPrepare(() => this.#prepareShared("create"));
      await this.#requiredPrepare(() => this.#subscriptionRuntime.start());
    });
    return this.#joinRequiredCleanup(admitted);
  }

  /**
   * Waits for recorded fatal cleanup only after context admission settles.
   *
   * @param admitted Locally admitted operation.
   * @returns Completion after local work or fatal cleanup.
   */
  async #joinRequiredCleanup(admitted: Promise<void>): Promise<void> {
    try {
      await admitted;
    } catch (error) {
      if (serverEnvironmentAccess.hasStartupFailure(this.#environment))
        return serverEnvironmentAccess.awaitStartupFailure(this.#environment);
      throw error;
    }
  }

  /**
   * Creates tenant-aware Inboxes and their shared readiness signal.
   *
   * @param tenantIndex Effective membership index for this context.
   * @returns Inboxes, tenant index, and readiness signal.
   */
  #createDelivery(tenantIndex: TenantIndex): ContextDeliveryParts {
    const deliveryReadiness = this.#createReadiness();
    const onAdmit = (tenantId?: TenantId) => this.#admitTenant(tenantId);
    const entityInbox = new LocalEntityInbox(
      this.#snapshot.name.value,
      deliveryReadiness,
      onAdmit,
      this.#environment.delivery.strategy,
    );
    const projectionInbox = new LocalProjectionInbox(
      this.#snapshot.name.value,
      deliveryReadiness,
      onAdmit,
    );
    deliveryReadiness.configureDirect((message, tenantId) =>
      message.label === "UPDATE_SUBSCRIBER"
        ? projectionInbox.replay(message, tenantId)
        : entityInbox.replay(message, tenantId),
    );
    return { deliveryReadiness, tenantIndex, entityInbox, projectionInbox };
  }

  /**
   * Creates readiness for the shared Delivery and this context's Agent capacity.
   * @returns Shared readiness with the Agent capacity wake installed.
   */
  #createReadiness(): DeliveryReadiness {
    const readiness = new DeliveryReadiness(
      undefined,
      serverEnvironmentAccess.coreDelivery(this.#environment),
      (shard) => {
        serverEnvironmentAccess.notifyDelivery(this.#environment, shard);
      },
      serverEnvironmentAccess.remoteSupervised(this.#environment),
    );
    if (this.#ai !== undefined)
      this.#stopAgentAvailability = AgentExecutionCapacity.for(this.#ai).onAvailable(() => {
        readiness.retryDeferred();
      });
    return readiness;
  }

  /**
   * Installs framework references used after context construction.
   *
   * @param input Prepared framework services.
   * @param delivery Tenant index and Inboxes prepared for this context.
   */
  #installReferences(input: BoundedContextAssembly, delivery: ContextDeliveryParts): void {
    contextEventBuses.set(this, [this.#eventBus, this.#systemEventBus]);
    contextRepositoryViews.set(this, this.#repositoryViews);
    eventSubscribers.set(this, (typeUrl, subscriber) =>
      eventBusAccess.subscribe(this.#eventBus, typeUrl, subscriber),
    );
    systemEventPosters.set(this, (event) => this.#publisher.publishSystemEvent(event));
    contextSystemPairings.set(
      this,
      ContextParts.createSystemPairing(this.#snapshot, input.systemSpec),
    );
    contextTenantIndexes.set(this, delivery.tenantIndex);
    contextStorageFactories.set(this, input.storageFactory);
    contextSubscriptionRuntimes.set(this, this.#subscriptionRuntime);
    contextPreparations.set(this, (options) => this.#prepareBuild(options));
    contextInputPreparations.set(this, (tenantId) => this.#prepareInput(tenantId));
    contextSignalPublishers.set(this, this.#publisher);
    contextClosePhases.set(this, {
      begin: () => {
        this.#beginClose();
      },
      drain: () => this.#drainWork(),
      trackReplay: (onReplay) => this.#trackReplay(onReplay),
    });
    contextDeliveryDescriptors.set(
      this,
      ContextParts.createDeliveryDescriptor(this.#entityInbox, this.#projectionInbox),
    );
  }

  #registerRepositories(repositories: readonly RepositoryView[]): void {
    const preparedRepositories = this.#prepareRepositories(repositories);

    try {
      for (const preparedRepository of preparedRepositories) {
        ContextParts.rejectRegisteredRepository(preparedRepository.repository);
      }
      this.#reserveStates(preparedRepositories);
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

  /**
   * Reserves Entity state types before registration mutates delivery targets.
   *
   * @param repositories Prepared repositories for this context.
   */
  #reserveStates(repositories: readonly PreparedRepository[]): void {
    for (const repository of repositories) {
      const stateType = TypeUrls.derive(repository.snapshot.stateSchema);
      const prior = serverEnvironmentAccess.reserveState(this.#environment, this, stateType);
      if (prior !== undefined)
        throw new DuplicateEntityStateException(stateType, prior.name.value, this.name.value);
    }
  }

  #prepareRepositories(repositories: readonly RepositoryView[]): PreparedRepository[] {
    const registration = this.#repositoryRegistration();
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

  /**
   * Reserves shared-registry capacity before Agent receipt admission.
   */
  #reserveAgent(key: string, signal: AbortSignal): AgentCapacityReservation | undefined {
    const reservation =
      this.#ai === undefined
        ? undefined
        : AgentExecutionCapacity.for(this.#ai).reserve(key, signal);
    if (reservation !== undefined) {
      this.#agentReservations.add(reservation.completed);
      void reservation.completed.then(
        () => this.#agentReservations.delete(reservation.completed),
        () => this.#agentReservations.delete(reservation.completed),
      );
    }
    return reservation;
  }

  /**
   * Builds callbacks shared by every repository prepared for this Bounded Context.
   */
  #repositoryRegistration(): RepositoryRegistration {
    return {
      name: ContextParts.cloneName(this.#snapshot.name),
      storageContext: ContextParts.createStorageMode(this.#snapshot.spec),
      storageFactory: this.#storageFactory,
      onAdmit: (tenantId) => this.#admitTenant(tenantId),
      ...(this.#ai === undefined ? {} : { ai: this.#ai }),
      stand: this.#stand,
      entityInbox: this.#entityInbox,
      projectionInbox: this.#projectionInbox,
      publisher: this.#publisher,
      registerEventSchema: (schema) => {
        eventBusAccess.registerSchemas(this.#eventBus, [schema]);
      },
      registerSystemEventSchema: (schema) => {
        eventBusAccess.registerSchemas(this.#systemEventBus, [schema]);
      },
      publishAgentEvent: (event) => this.#publishAgentEvent(event),
      publishAgentSystemEvent: (event) => this.#publisher.publishSystemEvent(event),
      agentReceipts: this.#agentReceipts,
      agentSignal: this.#agentController.signal,
      reserveAgent: (key, signal) => this.#reserveAgent(key, signal),
      deferAgent: (message, tenantId) => {
        this.#deferAgent(message, tenantId);
      },
    };
  }

  /**
   * Publishes an Agent event on its selected ordinary or rejection bus.
   */
  #publishAgentEvent(event: Event): Promise<void> {
    return event.context?.rejection === undefined
      ? this.#publisher.publishEvent(event)
      : this.#publisher.publishRejectionEvent(event);
  }

  /**
   * Records a deferred Agent shard for the next available capacity slot.
   */
  #deferAgent(message: InboxMessage, tenantId: TenantId | undefined): void {
    this.#deliveryReadiness.defer({
      label: message.label,
      targetTypeUrl: message.inboxId.targetTypeUrl,
      shard: message.shard,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
  }

  #failRegistration(error: unknown, preparedRepositories: readonly PreparedRepository[]): never {
    const uncommitted = preparedRepositories.filter(
      ({ repository }) => !this.#repositoryViews.has(repository),
    );
    const closeErrors = ContextParts.closePreparedRepositories(uncommitted);
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
   * Returns the live index configured for this Bounded Context.
   *
   * @returns The effective configured index.
   */
  get tenantIndex(): TenantIndex {
    return ContextParts.requireTenantIndex(this);
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
   * Returns this context's command endpoint.
   *
   * @returns Returns the context command endpoint.
   */
  commandBus(): CommandEndpoint {
    return this.#commandEndpoint;
  }

  /**
   * Returns this context's event endpoint.
   *
   * @returns Returns the context event endpoint.
   */
  eventBus(): EventEndpoint {
    return this.#eventEndpoint;
  }

  /**
   * Returns the Stand that stores this context's read-side state.
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
    const originals = [...this.#repositoryViews];
    return this.#registeredRepositories.map((snapshot, index) => {
      const repository = originals[index];
      if (repository === undefined) throw new Error("Registered repository view disappeared.");
      const view = ContextParts.createRepositoryView(snapshot);
      issuedRepositoryViews.set(view, { context: this, repository });
      return view;
    });
  }

  /**
   * Returns the repository already registered for an exact Entity constructor.
   * This trusted server-side lookup does not load Entity state or open storage.
   *
   * @typeParam EntityType Concrete Entity constructor registered in this Bounded Context.
   * @param entityType Exact Entity class supplied to this Bounded Context's builder.
   * @returns The existing typed repository for that Entity class.
   * @throws When the constructor is absent or the Bounded Context is closing.
   */
  getRepository<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    entityType: EntityType,
  ): Repository<EntityType> {
    if (closingContexts.has(this)) throw new Error("Bounded Context is closing.");
    for (const repository of this.#repositoryViews) {
      if (repository.entityType === entityType) return repository as Repository<EntityType>;
    }
    throw new Error("Entity constructor is not registered in this Bounded Context.");
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
   *   live event intake.
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
   * Closes this context's buses, Stand, repository storage, and runtime bindings.
   * @returns Completion or an aggregate of close failures.
   */
  close(): Promise<void> {
    this.#beginClose();
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  /**
   * Stops external admission while accepted follow-ups drain.
   */
  #beginClose(): void {
    closingContexts.add(this);
    this.#preparationController.abort(new Error("Bounded Context closed."));
    serverEnvironmentAccess.stopRecipients(this.#environment, this);
    this.#agentController.abort(new Error("Bounded Context closed."));
    this.#publisher.beginClose();
    commandBusAccess.beginClose(this.#commandBus);
    eventBusAccess.beginClose(this.#eventBus);
    eventBusAccess.beginClose(this.#systemEventBus);
  }

  /**
   * Closes integration intake and drains accepted context work before Stand close.
   *
   * @returns Completion after the context's accepted work settles.
   */
  async #drainWork(): Promise<void> {
    this.#beginClose();
    const errors: unknown[] = [];
    await this.#closePart(() => ContextParts.closeIntegration(this), errors);
    await this.#closePart(
      () =>
        ContextParts.drainContextWork(
          this.#commandBus,
          this.#eventBus,
          this.#systemEventBus,
          this.#publisher,
        ),
      errors,
    );
    if (errors.length > 0) throw new AggregateError(errors, "BoundedContext drain failed.");
  }

  /**
   * Closes the context's remaining stores and repository registrations.
   *
   * @returns Completion after resource closure.
   */
  async #closeOnce(): Promise<void> {
    const errors: unknown[] = [];

    this.#stopAgentAvailability?.();
    this.#stopAgentAvailability = undefined;

    await this.#closePart(() => this.#drainWork(), errors);
    await this.#drainAdmittedContextWork(errors);
    await this.#closePart(() => this.#deliveryReadiness.close(), errors);
    await this.#closePart(
      () =>
        ContextParts.drainContextWork(
          this.#commandBus,
          this.#eventBus,
          this.#systemEventBus,
          this.#publisher,
        ),
      errors,
    );
    await this.#closePart(() => this.#agentReceipts.close(), errors);
    await this.#closeBuses(errors);
    await this.#closePart(() => this.#stand.close(), errors);
    await this.#closePart(() => this.#systemStand.close(), errors);
    await this.#closePart(() => this.#subscriptionRuntime.finishClose(), errors);
    await this.#closeRepositories(errors);
    serverEnvironmentAccess.removeContext(this.#environment, this);
    if (errors.length > 0) {
      this.#closed = undefined;
      throw new AggregateError(ContextParts.flattenErrors(errors), "BoundedContext close failed.");
    }
    ContextParts.clearContextMetadata(this);
  }

  /**
   * Settles entered replay, local follow-ups, and reserved Agent turns.
   * @param errors Collects independent close failures.
   */
  async #drainAdmittedContextWork(errors: unknown[]): Promise<void> {
    await this.#closePart(
      () => Promise.allSettled([...this.#activePreparations]).then(() => undefined),
      errors,
    );
    await this.#closePart(
      () => Promise.allSettled([...this.#activeReplays]).then(() => undefined),
      errors,
    );
    await this.#closePart(() => this.#entityInbox.whenFollowUpsIdle(), errors);
    await this.#closePart(
      () => Promise.allSettled([...this.#agentReservations]).then(() => undefined),
      errors,
    );
  }

  /**
   * Closes bus intake and subscription drains before the Stands.
   *
   * @param errors Collects independent close failures.
   * @returns Completion after bounded bus close attempts.
   */
  async #closeBuses(errors: unknown[]): Promise<void> {
    this.#publisher.finishClose();
    await this.#closePart(() => commandBusAccess.finishClose(this.#commandBus), errors);
    await this.#closePart(() => eventBusAccess.finishClose(this.#eventBus), errors);
    this.#subscriptionRuntime.beginClose();
    await this.#closePart(() => eventBusAccess.drain(this.#systemEventBus), errors);
    await this.#closePart(() => this.#subscriptionRuntime.drainClose(), errors);
    await this.#closePart(() => eventBusAccess.finishClose(this.#systemEventBus), errors);
  }

  /**
   * Clears repository runtime registration after Stand closure.
   *
   * @param errors Failures collected during context closure.
   */
  async #closeRepositories(errors: unknown[]): Promise<void> {
    const closing = [...this.#repositoryViews].map((repository) => {
      return repositoryAccess.clearRuntime(repository).finally(() => {
        registeredRepositories.delete(repository);
      });
    });
    for (const result of await Promise.allSettled(closing)) {
      if (result.status === "rejected") errors.push(result.reason);
    }
  }

  /**
   * Registers an entered shared replay through its complete follow-up callback.
   * @param onReplay Complete replay callback.
   * @returns Completion of the captured callback.
   */
  #trackReplay(onReplay: () => Promise<void>): Promise<void> {
    const replay = Promise.resolve().then(onReplay);
    this.#activeReplays.add(replay);
    void replay.then(
      () => this.#activeReplays.delete(replay),
      () => this.#activeReplays.delete(replay),
    );
    return replay;
  }

  /**
   * Calls a close action and collects its failure before later cleanup.
   * @param work Close action.
   * @param errors Collects close failures.
   */
  async #closePart(work: () => unknown, errors: unknown[]): Promise<void> {
    await ContextParts.closeContextPart(work, errors);
  }
}

/**
 * Exposes framework-only operations for built contexts and their builders.
 */
export const boundedContextAccess: BoundedContextAccess = Object.freeze({
  /**
   * Reports whether close has started for the given context.
   *
   * @param context Completed context.
   * @returns Whether close has started.
   */
  isClosing: (context: BoundedContext) => closingContexts.has(context),

  /**
   * Prepares an admitted context without joining global fatal cleanup.
   *
   * @param context Admitted context.
   * @param mode Creation or read-only check.
   * @param ids Captured tenant identities.
   * @returns Completion of local preparation.
   */
  prepareExplicit(
    context: BoundedContext,
    mode: StoragePreparationMode,
    ids: readonly TenantId[],
  ): Promise<void> {
    const prepare = explicitPreparations.get(context);
    if (prepare === undefined)
      return Promise.reject(new TypeError("Preparation requires a built context."));
    return prepare(mode, ids);
  },

  /**
   * Admits a service membership and preparation chain before its first await.
   *
   * @param context Selected built context.
   * @param tenantId Captured tenant identity, when applicable.
   * @param onMembership Checks live tenant membership.
   * @param onReady Performs the admitted one-shot registry mutation, if present.
   * @returns Tracked completion of membership and model preparation.
   */
  admitServiceInput(
    context: BoundedContext,
    tenantId: TenantId | undefined,
    onMembership: () => Promise<void>,
    onReady?: () => Promise<void>,
  ): Promise<void> {
    if (closingContexts.has(context))
      return Promise.reject(new Error("Bounded Context is closing."));
    const prepare = contextInputPreparations.get(context);
    const phase = contextClosePhases.get(context);
    if (prepare === undefined || phase === undefined)
      return Promise.reject(new TypeError("Service input requires a built context."));
    return phase.trackReplay(async () => {
      await onMembership();
      await prepare(tenantId);
      await onReady?.();
    });
  },

  /**
   * Admits one shared subscription-registry operation before asynchronous lookup.
   *
   * @param context Selected built context.
   * @param onOperation Complete registry operation.
   * @returns Tracked operation completion.
   */
  admitServiceRegistryOperation(
    context: BoundedContext,
    onOperation: () => Promise<void>,
  ): Promise<void> {
    if (closingContexts.has(context))
      return Promise.reject(new Error("Bounded Context is closing."));
    const phase = contextClosePhases.get(context);
    if (phase === undefined)
      return Promise.reject(new TypeError("Service registry requires a built context."));
    return phase.trackReplay(onOperation);
  },

  trackReplay(context: BoundedContext, onReplay: () => Promise<void>): Promise<void> {
    const phase = contextClosePhases.get(context);
    if (phase === undefined)
      return Promise.reject(new TypeError("Replay requires a built context."));
    return phase.trackReplay(onReplay);
  },

  /**
   * Resolves a view only within the Bounded Context that issued it.
   *
   * @param context Built Bounded Context that registered the repository.
   * @param view Candidate original or issued view.
   * @returns Registered repository, or undefined for a foreign view.
   */
  resolveRepository(context: BoundedContext, view: RepositoryView): RepositoryView | undefined {
    const originals = contextRepositoryViews.get(context);
    if (originals?.has(view)) return view;
    const issued = issuedRepositoryViews.get(view);
    return issued?.context === context && originals?.has(issued.repository)
      ? issued.repository
      : undefined;
  },
  beginClose(context: BoundedContext): void {
    const phase = contextClosePhases.get(context);
    if (phase === undefined) throw new TypeError("Close phase requires a built BoundedContext.");
    phase.begin();
  },

  drainWork(context: BoundedContext): Promise<void> {
    const phase = contextClosePhases.get(context);
    if (phase === undefined)
      return Promise.reject(new TypeError("Drain requires a built BoundedContext."));
    return phase.drain();
  },

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
    const publisher = contextSignalPublishers.get(context);
    if (publisher === undefined)
      throw new TypeError("Context logger requires a built BoundedContext instance.");
    publisher.installLogger(logger);
    const runtime = contextSubscriptionRuntimes.get(context);
    if (runtime === undefined) {
      throw new TypeError("Context logger requires a built BoundedContext instance.");
    }
    subscriptionRuntimeAccess.installLogger(runtime, logger, context.name.value);
  },

  loggerFor(context: BoundedContext): ILogLayer {
    const logger = contextLoggers.get(context);
    if (logger === undefined) {
      throw new TypeError("Context logger requires a built BoundedContext instance.");
    }
    return logger;
  },

  isBuilder(value: unknown): value is BoundedContextBuilder {
    return (
      typeof value === "object" &&
      value !== null &&
      builderBuilds.has(value as BoundedContextBuilder)
    );
  },

  build(builder: BoundedContextBuilder): Promise<BoundedContext> {
    const build = builderBuilds.get(builder);

    if (build === undefined) {
      throw new TypeError("Builder access requires a BoundedContextBuilder instance.");
    }

    return build();
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

  postExternalEvent(context: BoundedContext, event: Event): Promise<void> {
    const imported = clone(EventSchema, event);
    imported.context = clone(EventContextSchema, imported.context ?? create(EventContextSchema));
    imported.context.external = true;
    return context.eventBus().post(imported);
  },

  observeProducedSignals(
    context: BoundedContext,
    observer: {
      readonly onCommand?: (command: Readonly<Command>) => void;
      readonly onEvent?: (event: Readonly<Event>) => void;
    },
  ): { readonly close: () => void } {
    const publisher = contextSignalPublishers.get(context);
    if (publisher === undefined) {
      throw new TypeError("Produced signal observation requires a built BoundedContext instance.");
    }
    return publisher.observe(observer);
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
 * Configures routing and Entity construction for a generated repository.
 *
 * `onCreate` passes the framework's Entity options to an application constructor callback.
 * It is required when the Entity class has additional required constructor arguments.
 *
 * @typeParam EntityType The Entity class added to a Bounded Context builder.
 */
export type GeneratedRepositoryOptions<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
> = Readonly<
  Pick<
    RepositoryOptions<EntityType>,
    "commandRouting" | "eventRouting" | "stateUpdateRouting" | "stringifierRegistry" | "ai"
  >
> &
  (RepositoryOptions<EntityType> extends { readonly onCreate: infer Callback }
    ? { readonly onCreate: Callback }
    : Pick<RepositoryOptions<EntityType>, "onCreate">);

/**
 * Tracks resources that may require cleanup after context assembly fails.
 */
interface ContextBuildResources {
  context?: BoundedContext;
  registry?: StandSubscriptionRegistry;
  commandBus?: CommandBus;
  eventStore?: EventStore;
  systemEventStore?: EventStore;
  eventBus?: EventBus;
  systemEventBus?: EventBus;
  publisher?: SignalPublisher;
  stand?: Stand;
  systemStand?: Stand;
  runtime?: SubscriptionRuntime;
}

interface ContextBuildBuses {
  readonly commandBus: CommandBus;
  readonly eventStore: EventStore | undefined;
  readonly systemEventStore: EventStore | undefined;
  readonly eventBus: EventBus;
  readonly systemEventBus: EventBus;
  readonly publisher: SignalPublisher;
  readonly systemStand: Stand;
  readonly systemSpec: ContextSpecSnapshot;
}

interface ContextSystemBuses {
  readonly eventStore: EventStore | undefined;
  readonly eventBus: EventBus;
  readonly stand: Stand;
  readonly spec: ContextSpecSnapshot;
}

interface ContextBuildDispatchers {
  readonly domain: readonly EventDispatcher[];
  readonly system: readonly EventDispatcher[];
}

interface ContextBuildRuntime {
  readonly stand: Stand;
  readonly registry: StandSubscriptionRegistry;
  readonly runtime: SubscriptionRuntime;
}

/**
 * Selects which initialization operations build awaits before returning.
 */
export interface BoundedContextBuildOptions {
  /**
   * Defers model structure preparation until a valid first input when false.
   */
  readonly createStorageStructures?: boolean;

  /**
   * Defers the first subscription pass until a valid first input when false.
   */
  readonly startSubscriptionMonitoring?: boolean;
}

/**
 * Assembles a {@link BoundedContext} from repositories and dispatchers.
 */
export class BoundedContextBuilder {
  readonly #specSnapshot: ContextSpecSnapshot;

  readonly #commandDispatchers = new Set<CommandDispatcher>();

  readonly #eventDispatchers = new Set<EventDispatcher>();

  readonly #assignees: AbstractAssignee[] = [];

  readonly #commanders: AbstractCommander[] = [];

  readonly #eventReceivers: (AbstractEventReactor | AbstractEventSubscriber)[] = [];

  readonly #repositories = new Set<RepositoryView>();

  readonly #entityTypes = new Set<RepositoryEntityType>();

  readonly #generatedRepositoryOptions = new Map<RepositoryEntityType, object>();

  #aiRegistry: AiRegistry | undefined;

  #tenantIndex: TenantIndex | undefined;

  #subscriptionRegistry: StandSubscriptionRegistry | undefined;

  #persistSystemEvents = false;

  /**
   * Registers the framework-only construction hook for this module.
   */
  static {
    constructBoundedContextBuilder = (snapshot, token): BoundedContextBuilder =>
      new BoundedContextBuilder(snapshot, token);
  }

  /**
   * Creates a builder from a prepared context specification.
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
    builderBuilds.set(this, () => this.#buildAsyncWith());
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
   * @typeParam EntityType Concrete Entity class represented by the repository.
   * @param entry The repository to register.
   * @returns This builder for further configuration.
   */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    entry: Repository<EntityType>,
  ): this;

  /**
   * Adds an Entity class whose repository is assembled from generated handlers.
   *
   * @typeParam EntityType Concrete Entity class represented by this entry.
   * @param entry The Entity class to register.
   * @param options Routing and constructor callback for its generated repository. The callback
   * is required when the Entity constructor needs additional application arguments.
   *
   * @returns This builder for further configuration.
   */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    entry: EntityType,
    ...options: GeneratedRepositoryOptions<EntityType> extends { readonly onCreate: object }
      ? [options: GeneratedRepositoryOptions<EntityType>]
      : [options?: GeneratedRepositoryOptions<EntityType>]
  ): this;

  /**
   * Adds an explicitly assembled repository or an Entity class.
   *
   * @typeParam EntityType Concrete Entity class represented by this entry.
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
   * @typeParam EntityType Concrete Entity class represented by the repository.
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
   * @param dispatcher Raw command dispatcher, or an `AbstractCommander` instance.
   *   A standalone commander requires generated receiver metadata and therefore
   *   this builder's `build()` path. It installs its Command and Event sides
   *   exactly once.
   *
   * @returns This builder for further configuration.
   */
  addCommandDispatcher(dispatcher: CommandDispatcher | AbstractCommander): this {
    if (dispatcher instanceof AbstractCommander) {
      this.#commanders.push(dispatcher);
      return this;
    }
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
   * @param dispatcher Raw event dispatcher, or a standalone reactor/subscriber.
   *   Standalone receivers require generated receiver metadata and `build()`.
   *
   * @returns This builder for further configuration.
   */
  addEventDispatcher(
    dispatcher: EventDispatcher | AbstractEventReactor | AbstractEventSubscriber,
  ): this {
    if (
      dispatcher instanceof AbstractEventReactor ||
      dispatcher instanceof AbstractEventSubscriber
    ) {
      this.#eventReceivers.push(dispatcher);
      return this;
    }
    this.#eventDispatchers.add(dispatcher);
    return this;
  }

  /**
   * Adds a generated standalone command assignee.
   *
   * The registered instance is matched by exact constructor to generated
   * receiver metadata when `build()` assembles the context.
   *
   * @param assignee Generated standalone assignee instance.
   * @returns This builder for further configuration.
   */
  addAssignee(assignee: AbstractAssignee): this {
    this.#assignees.push(assignee);
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
   * Sets a live tenant index for this Bounded Context.
   *
   * @param tenantIndex Application membership index.
   * @returns This builder.
   */
  withTenantIndex(tenantIndex: TenantIndex): this {
    this.#tenantIndex = tenantIndex;
    return this;
  }

  /**
   * Sets the application AI registry before this Bounded Context is built.
   *
   * @param registry Factory-created deployment registry.
   * @returns This builder.
   */
  withAi(registry: AiRegistry): this {
    this.#aiRegistry = registry;
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
   * Builds a context after loading generated handlers and preparing runtime resources.
   *
   * @param options Independent eager structure and subscription timing choices.
   * @returns The built context after requested initialization and integration are ready.
   */
  build(options: BoundedContextBuildOptions = {}): Promise<BoundedContext> {
    return this.#buildAsyncWith(options);
  }

  async #buildAsyncWith(options: BoundedContextBuildOptions = {}): Promise<BoundedContext> {
    const environment = ServerEnvironment.instance();
    const finishBuild = serverEnvironmentAccess.beginContextBuild(environment);
    let built: BoundedContext | undefined;
    let failed = false;
    let failure: unknown;
    try {
      await serverEnvironmentAccess.awaitSetup(environment);
      built = await this.#buildAsyncReady(options, environment);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      finishBuild();
    }
    if (serverEnvironmentAccess.hasStartupFailure(environment))
      return serverEnvironmentAccess.awaitStartupFailure(environment);
    if (failed) throw failure;
    if (built === undefined) throw new Error("Bounded Context build did not complete.");
    return built;
  }

  /**
   * Loads generated metadata and finishes one asynchronous context assembly.
   *
   * @returns The integrated context.
   */
  async #buildAsyncReady(
    options: BoundedContextBuildOptions,
    environment: ServerEnvironment,
  ): Promise<BoundedContext> {
    const generated = this.#loadGeneratedArtifacts([...this.#entityTypes]);
    serverEnvironmentAccess.requireAvailable(environment);
    const repositories = [...this.#repositories, ...generated.repositories];

    const context = await this.#buildWithResources(
      repositories,
      environment.storageFactory,
      generated.standalone,
      this.#aiRegistry ?? environment.ai,
    );
    try {
      await this.#integrateBuiltContext(context, options, environment);
    } catch (error) {
      return this.#closeFailedBuild(context, environment, error);
    }
    return context;
  }

  /**
   * Completes required integration and requested initialization before publication.
   * @param context Constructed context.
   * @param options Requested eager initialization phases.
   * @param environment Captured environment lifetime.
   */
  async #integrateBuiltContext(
    context: BoundedContext,
    options: BoundedContextBuildOptions,
    environment: ServerEnvironment,
  ): Promise<void> {
    serverEnvironmentAccess.requireAvailable(environment);
    boundedContextAccess.installLogger(context, serverEnvironmentAccess.loggerFor(environment));
    await ContextParts.integrationReady(context).catch((error: unknown) => {
      serverEnvironmentAccess.failStartup(environment, error);
      throw error;
    });
    serverEnvironmentAccess.requireAvailable(environment);
    const prepare = contextPreparations.get(context);
    if (prepare === undefined) throw new Error("Context preparation is unavailable.");
    await prepare(options);
    serverEnvironmentAccess.requireAvailable(environment);
    await serverEnvironmentAccess.completeContext(environment, context);
  }

  /**
   * Releases a failed partial context before its build ticket settles.
   * @param context Context assembled before the failure.
   * @param environment Captured environment lifetime.
   * @param error Original build failure.
   * @returns Rejection retaining the original and any local cleanup failure.
   */
  async #closeFailedBuild(
    context: BoundedContext,
    environment: ServerEnvironment,
    error: unknown,
  ): Promise<never> {
    try {
      await context.close();
    } catch (closeError) {
      if (serverEnvironmentAccess.hasStartupFailure(environment)) {
        serverEnvironmentAccess.recordStartupCleanup(environment, closeError);
        throw error;
      }
      throw new AggregateError([error, closeError], "BoundedContext open cleanup failed.");
    }
    throw error;
  }

  /**
   * Assembles a context and cleans partial resources on failure.
   *
   * @param repositories Repositories selected for the context.
   * @param storageFactory Storage factory for the context.
   * @param standalone Generated standalone handler groups.
   * @param ai Optional AI registry.
   * @returns The assembled context.
   */
  async #buildWithResources(
    repositories: readonly RepositoryView[],
    storageFactory: StorageFactory,
    standalone: readonly GeneratedStandaloneHandlerGroup[],
    ai: AiRegistry | undefined,
  ): Promise<BoundedContext> {
    const resources: ContextBuildResources =
      this.#subscriptionRegistry === undefined ? {} : { registry: this.#subscriptionRegistry };
    this.#subscriptionRegistry = undefined;
    const registeredRepositories = [...repositories];
    try {
      return this.#assembleContext(
        registeredRepositories,
        storageFactory,
        standalone,
        resources,
        ai,
      );
    } catch (error) {
      return await this.#failBuild(resources, error);
    }
  }

  #assembleContext(
    repositories: readonly RepositoryView[],
    storageFactory: StorageFactory,
    standalone: readonly GeneratedStandaloneHandlerGroup[],
    resources: ContextBuildResources,
    ai?: AiRegistry,
  ): BoundedContext {
    ContextParts.preflightRepositories(repositories);
    this.#preflightAgents(repositories, storageFactory, ai);
    if (ai !== undefined) freezeRegistry(ai);
    const dispatchers = this.#buildDispatchers(repositories);
    const buses = this.#buildBuses(repositories, storageFactory, dispatchers, resources);
    const standaloneEvent = this.#installStandalone(standalone, buses);
    for (const dispatcher of dispatchers.domain) buses.eventBus.register(dispatcher);
    eventBusAccess.registerSchemas(buses.eventBus, [
      ...ContextParts.repositoryProducedEventSchemas(repositories),
      ...ContextParts.standaloneProducedEventSchemas(standalone),
    ]);
    const running = this.#buildRuntime(storageFactory, buses, resources);
    const context = this.#createContext(repositories, storageFactory, buses, running, ai);
    resources.context = context;
    if (registerBoundedContext === undefined)
      throw new Error("Context registration is unavailable.");
    registerBoundedContext(context, repositories);
    ContextParts.attachIntegration(
      context,
      buses.eventBus,
      buses.systemSpec,
      ContextParts.externalEventSchemas([
        ...dispatchers.domain,
        ...(standaloneEvent === undefined ? [] : [standaloneEvent]),
      ]),
    );
    return context;
  }

  /**
   * Rejects missing Agent prerequisites before repository intake is installed.
   *
   * @param repositories Repositories selected for this Bounded Context.
   * @param storageFactory Provider supplying mandatory Agent records.
   * @param ai Effective Bounded Context or server registry.
   */
  #preflightAgents(
    repositories: readonly RepositoryView[],
    storageFactory: StorageFactory,
    ai?: AiRegistry,
  ): void {
    const agents = repositories.filter((repository) => repository.entityFamily === "agent");
    if (agents.length === 0) return;
    if (ai === undefined) throw new TypeError("Agent registration requires an AI registry.");
    registryOptions(ai);
    if (!this.#persistSystemEvents)
      throw new TypeError("Agent registration requires persisted System Events.");
    if (!AgentHistoryStorageFactories.supports(storageFactory))
      throw new TypeError("Agent registration requires indexed history storage.");
    for (const repository of agents) {
      const config = repositoryAccess.agentConfiguration(repository);
      if (config.ai === undefined)
        throw new TypeError("Agent registration requires repository capabilities.");
      if (config.ai.models.some((model) => !isAiModel(model)))
        throw new TypeError("Agent repository capabilities must be factory-created models.");
    }
  }

  #buildDispatchers(repositories: readonly RepositoryView[]): ContextBuildDispatchers {
    const event = [
      ...ContextParts.repositoryEventDispatchers(repositories),
      ...this.#eventDispatchers,
    ];
    return {
      domain: ContextParts.domainEventDispatchers(event),
      system: [
        ...ContextParts.systemEventDispatchers(event),
        ...ContextParts.repositorySystemEventDispatchers(repositories),
      ],
    };
  }

  #buildBuses(
    repositories: readonly RepositoryView[],
    storageFactory: StorageFactory,
    dispatchers: ContextBuildDispatchers,
    resources: ContextBuildResources,
  ): ContextBuildBuses {
    const commandBus = new CommandBus([
      ...this.#commandDispatchers,
      ...ContextParts.repositoryCommandDispatchers(repositories),
    ]);
    resources.commandBus = commandBus;
    const system = this.#buildSystemBuses(storageFactory, dispatchers.system, resources);
    const eventStore = this.createEventStore(storageFactory);
    resources.eventStore = eventStore;
    const eventBus = new EventBus(eventStore);
    resources.eventBus = eventBus;
    const publisher = new SignalPublisher(
      commandBus,
      eventBus,
      system.eventBus,
      this.#specSnapshot.name.value,
    );
    resources.publisher = publisher;
    return {
      commandBus,
      eventStore,
      systemEventStore: system.eventStore,
      eventBus,
      systemEventBus: system.eventBus,
      publisher,
      systemStand: system.stand,
      systemSpec: system.spec,
    };
  }

  #buildSystemBuses(
    storageFactory: StorageFactory,
    dispatchers: readonly EventDispatcher[],
    resources: ContextBuildResources,
  ): ContextSystemBuses {
    const systemSpec = ContextParts.createSystemSpec(this.#specSnapshot, this.#persistSystemEvents);
    const systemEventStore = systemSpec.storesEvents
      ? new EventStore(
          ContextParts.createStorageMode(systemSpec),
          storageFactory,
          EventStoreGroups.forContext(systemSpec.name.value, "system"),
        )
      : undefined;
    if (systemEventStore !== undefined) resources.systemEventStore = systemEventStore;
    const systemEventBus = eventBusAccess.createSystemBus(systemEventStore);
    resources.systemEventBus = systemEventBus;
    for (const dispatcher of dispatchers) systemEventBus.register(dispatcher);
    const systemStand = new Stand({
      context: ContextParts.createStorageMode(systemSpec),
      storageFactory,
    });
    resources.systemStand = systemStand;
    return {
      eventStore: systemEventStore,
      eventBus: systemEventBus,
      stand: systemStand,
      spec: systemSpec,
    };
  }

  #installStandalone(
    standalone: readonly GeneratedStandaloneHandlerGroup[],
    buses: ContextBuildBuses,
  ): EventDispatcher | undefined {
    ContextParts.assertUniqueCommandReceptors(standalone);
    const runtime =
      standalone.length === 0
        ? undefined
        : new StandaloneHandlerRuntime(
            ContextParts.matchStandaloneHandlers(
              standalone,
              this.#standaloneInstances(),
              buses.publisher,
            ),
          );
    const command = runtime?.commandDispatcher();
    const event = runtime?.eventDispatcher();
    const state = runtime?.stateDispatcher();
    if (command !== undefined) buses.commandBus.register(command);
    if (event !== undefined) buses.eventBus.register(event);
    if (state !== undefined) buses.systemEventBus.register(state);
    return event;
  }

  #buildRuntime(
    storageFactory: StorageFactory,
    buses: ContextBuildBuses,
    resources: ContextBuildResources,
  ): ContextBuildRuntime {
    const stand = this.#buildStand(storageFactory);
    resources.stand = stand;
    const registry =
      resources.registry ??
      new StorageSubscriptionRegistry(
        ContextParts.createSubscriptionStorageContext(this.#specSnapshot),
        storageFactory,
      );
    resources.registry = registry;
    const runtime = new SubscriptionRuntime(
      stand,
      buses.systemStand,
      buses.eventBus,
      buses.systemEventBus,
      registry,
    );
    resources.runtime = runtime;
    return { stand, registry, runtime };
  }

  /**
   * Builds the context Stand with a captured live membership directory.
   *
   * @param storageFactory Provider used for Entity records.
   * @returns Direct read-side Stand.
   */
  #buildStand(storageFactory: StorageFactory): Stand {
    const tenantIndex = this.#tenantIndex ?? ServerEnvironment.instance().tenantIndex;
    const stand = new Stand({
      context: ContextParts.createStorageMode(this.#specSnapshot),
      storageFactory,
    });
    standAccess.setAdmission(stand, (tenantId) =>
      TenantAdmissions.require(
        tenantIndex,
        this.#specSnapshot.name.value,
        this.#specSnapshot.multitenant,
        tenantId,
      ),
    );
    return stand;
  }

  #createContext(
    repositories: readonly RepositoryView[],
    storageFactory: StorageFactory,
    buses: ContextBuildBuses,
    running: ContextBuildRuntime,
    ai?: AiRegistry,
  ): BoundedContext {
    return ContextParts.createBoundedContext(
      this.#specSnapshot,
      storageFactory,
      repositories,
      ServerEnvironment.instance().delivery.strategy,
      buses,
      running,
      ai,
      this.#tenantIndex ?? ServerEnvironment.instance().tenantIndex,
    );
  }

  async #failBuild(resources: ContextBuildResources, error: unknown): Promise<never> {
    const cleanupErrors: unknown[] = [];
    if (resources.context !== undefined) {
      try {
        await resources.context.close();
      } catch (closeError) {
        cleanupErrors.push(closeError);
      }
    } else {
      ContextParts.attemptCleanup(() => resources.publisher?.abortAssembly(), cleanupErrors);
      const registry = resources.runtime ?? resources.registry;
      const closing = [registry, resources.stand, resources.systemStand];
      for (const resource of closing) {
        if (resource === undefined) continue;
        try {
          await resource.close();
        } catch (closeError) {
          cleanupErrors.push(closeError);
        }
      }
      await ContextParts.cleanupBuildBuses(resources, cleanupErrors);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Bounded Context build failed during cleanup.",
      );
    }
    throw error;
  }

  #loadGeneratedArtifacts(entityTypes: readonly RepositoryEntityType[]): {
    readonly repositories: readonly RepositoryView[];
    readonly standalone: readonly GeneratedStandaloneHandlerGroup[];
  } {
    if (entityTypes.length === 0 && this.#standaloneInstances().length === 0) {
      return Object.freeze({ repositories: Object.freeze([]), standalone: Object.freeze([]) });
    }

    const selected = [
      ...entityTypes,
      ...this.#standaloneInstances().map((instance) => instance.constructor),
    ];
    const registries = [spineMetadataFor(selected)];
    const metadata = ContextParts.ingestGeneratedRegistries(registries);

    const repositories = Object.freeze(
      entityTypes.map((entityType) =>
        ContextParts.createGeneratedRepository(
          entityType,
          registries,
          metadata,
          this.#generatedRepositoryOptions.get(entityType),
        ),
      ),
    );
    const standalone = Object.freeze(
      registries.flatMap((registry) =>
        registry.receivers.filter(
          (receiver): receiver is GeneratedStandaloneHandlerGroup =>
            receiver.receiverKind === "standalone",
        ),
      ),
    );
    return Object.freeze({ repositories, standalone });
  }

  #standaloneInstances(): readonly object[] {
    return Object.freeze([...this.#assignees, ...this.#commanders, ...this.#eventReceivers]);
  }

  /**
   * Creates the domain EventStore using this context's storage mode.
   *
   * @param storageFactory Storage provider for event records.
   * @returns Domain EventStore.
   */
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
   * Creates a context specification from prepared values.
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

/**
 * Describes a repository prepared for context registration and rollback.
 */
interface PreparedRepository {
  readonly repository: RepositoryView;
  readonly snapshot: RegistrationSnapshot;
  readonly entityInboxTarget?: EntityInboxTarget;
  readonly projectionInboxTarget?: ProjectionInboxTarget;

  /**
   * Commits runtime bindings after Stand schema registration.
   */
  commit(): void;

  /**
   * Closes storage prepared for registration.
   */
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

/**
 * Reports failure while redispatching a stored event during read-side replay.
 */
class CatchUpReplayError extends Error {
  readonly code: CatchUpReplayCode = "READ_SIDE_CATCH_UP_REPLAY_FAILED";

  readonly eventId: string;

  readonly detail: CatchUpReplayDetail;

  /**
   * Creates a replay error tied to the stored event that failed.
   *
   * @param eventId Identifies the stored event.
   * @param detail Contains the bounded cause name and message.
   */
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
  /**
   * Rejects duplicate command receptors in generated standalone groups.
   *
   * @param receivers Generated groups to validate.
   */
  assertUniqueCommandReceptors(receivers: readonly GeneratedStandaloneHandlerGroup[]): void {
    const receptorByType = new Map<string, string>();
    for (const receiver of receivers) {
      for (const handler of receiver.handlers) {
        if (handler.kind !== "command-assignment" && handler.kind !== "command-substitution")
          continue;
        const typeName = TypeUrls.derive(handler.input.schema);
        const prior = receptorByType.get(typeName);
        if (prior !== undefined)
          throw new Error(
            `Standalone command receptors conflict for "${typeName}": ${prior} and ${
              (receiver.receiverType as unknown as StandaloneConstructor).name
            }.`,
          );
        receptorByType.set(
          typeName,
          (receiver.receiverType as unknown as StandaloneConstructor).name,
        );
      }
    }
  },

  /**
   * Matches generated standalone groups to their registered instances.
   *
   * @param generated Generated handler groups.
   * @param instances Registered standalone instances.
   * @param publisher Publisher used by bindings.
   * @returns Frozen bindings in generated order.
   */
  matchStandaloneHandlers(
    generated: readonly GeneratedStandaloneHandlerGroup[],
    instances: readonly object[],
    publisher: SignalPublisher,
  ): readonly StandaloneBinding[] {
    const byConstructor = new Map<StandaloneConstructor, object>();
    for (const instance of instances) {
      const constructor = instance.constructor as StandaloneConstructor;
      if (byConstructor.has(constructor)) {
        throw new Error(`Standalone receiver ${constructor.name} is registered more than once.`);
      }
      byConstructor.set(constructor, instance);
    }
    const bindings: StandaloneBinding[] = [];
    for (const receiver of generated) {
      const receiverType = receiver.receiverType as unknown as StandaloneConstructor;
      const instance = byConstructor.get(receiverType);
      if (instance === undefined) {
        throw new Error(
          `Generated standalone receiver ${receiverType.name} has no explicitly registered instance.`,
        );
      }
      bindings.push(Object.freeze({ group: receiver, instance, publisher }));
      byConstructor.delete(receiverType);
    }
    if (byConstructor.size > 0) {
      throw new Error(
        `Registered standalone receiver ${[...byConstructor.keys()][0]?.name ?? "unknown"} has no generated metadata.`,
      );
    }
    return Object.freeze(bindings);
  },

  /**
   * Calls cleanup and records any thrown error.
   *
   * @param onCleanup Cleanup action.
   * @param errors Collection receiving failures.
   */
  attemptCleanup(onCleanup: () => void, errors: unknown[]): void {
    try {
      onCleanup();
    } catch (error) {
      errors.push(error);
    }
  },

  /**
   * Closes buses and stores after context assembly fails.
   *
   * @param resources Partially created resources.
   * @param errors Collection receiving failures.
   * @returns Completion after all created buses and stores close.
   */
  async cleanupBuildBuses(resources: ContextBuildResources, errors: unknown[]): Promise<void> {
    const closing: (() => Promise<void>)[] = [];
    const { commandBus, systemEventBus, systemEventStore, eventBus, eventStore } = resources;
    if (commandBus !== undefined) closing.push(() => commandBus.close());
    if (systemEventBus !== undefined) closing.push(() => systemEventBus.close());
    else if (systemEventStore !== undefined) closing.push(() => systemEventStore.close());
    if (eventBus !== undefined) closing.push(() => eventBus.close());
    else if (eventStore !== undefined) closing.push(() => eventStore.close());
    for (const close of closing) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
  },

  /**
   * Returns constituent failures from nested aggregate errors.
   *
   * @param errors Errors to expand.
   * @returns Flattened error list.
   */
  flattenErrors(errors: readonly unknown[]): unknown[] {
    return errors.flatMap((error) =>
      error instanceof AggregateError ? ContextParts.flattenErrors(error.errors) : [error],
    );
  },

  /**
   * Rejects construction without the framework token.
   *
   * @param token Supplied token.
   * @param message Error message for an invalid token.
   */
  requireFrameworkConstructionToken(token: unknown, message: string): void {
    if (token !== frameworkConstructionToken) {
      throw new TypeError(message);
    }
  },

  /**
   * Creates a context specification from its snapshot.
   *
   * @param specSnapshot Snapshot used for construction.
   * @returns Constructed context specification.
   */
  createContextSpec(specSnapshot: ContextSpecSnapshot): ContextSpec {
    return constructContextSpec(specSnapshot, frameworkConstructionToken);
  },

  /**
   * Creates a builder for a context snapshot.
   *
   * @param specSnapshot Context configuration snapshot.
   * @returns Constructed context builder.
   */
  createBoundedContextBuilder(specSnapshot: ContextSpecSnapshot): BoundedContextBuilder {
    return constructBoundedContextBuilder(specSnapshot, frameworkConstructionToken);
  },

  /**
   * Creates a bounded context from assembled runtime components.
   *
   * @param specSnapshot Context configuration.
   * @param storageFactory Storage provider.
   * @param repositories Registered repository views.
   * @param deliveryStrategy Delivery sharding strategy.
   * @param buses Prepared domain and System buses.
   * @param running Prepared Stand and subscription runtime.
   * @param ai Effective AI registry when Agent repositories are present.
   * @param tenantIndex Effective live membership index.
   * @returns Constructed bounded context.
   */
  createBoundedContext(
    specSnapshot: ContextSpecSnapshot,
    storageFactory: StorageFactory,
    repositories: readonly RepositoryView[],
    deliveryStrategy: DeliveryStrategy,
    buses: ContextBuildBuses,
    running: ContextBuildRuntime,
    ai?: AiRegistry,
    tenantIndex?: TenantIndex,
  ): BoundedContext {
    return constructBoundedContext({
      snapshot: ContextParts.snapshotFor(specSnapshot),
      commandBus: buses.commandBus,
      eventBus: buses.eventBus,
      systemEventBus: buses.systemEventBus,
      publisher: buses.publisher,
      stand: running.stand,
      systemStand: buses.systemStand,
      subscriptionRuntime: running.runtime,
      systemSpec: buses.systemSpec,
      storageFactory,
      tenantIndex: tenantIndex ?? ServerEnvironment.instance().tenantIndex,
      repositories,
      deliveryStrategy,
      ...(ai === undefined ? {} : { ai }),
      token: frameworkConstructionToken,
    });
  },

  /**
   * Captures public context identity from the build specification.
   *
   * @param specSnapshot Prepared context specification.
   * @returns Immutable context metadata input.
   */
  snapshotFor(specSnapshot: ContextSpecSnapshot): BoundedContextSnapshot {
    return {
      name: specSnapshot.name,
      tenantMode: ContextParts.toTenantMode(specSnapshot.multitenant),
      spec: specSnapshot,
    };
  },

  /**
   * Creates the storage mode represented by a context snapshot.
   *
   * @param specSnapshot Context configuration snapshot.
   * @returns Storage mode for the context.
   */
  createStorageMode(specSnapshot: ContextSpecSnapshot): StorageMode {
    return Object.freeze({
      name: specSnapshot.name.value,
      multitenant: specSnapshot.multitenant,
    });
  },

  /**
   * Creates a non-tenant-scoped subscription storage context.
   *
   * @param specSnapshot Context configuration snapshot.
   * @returns Subscription storage context.
   */
  createSubscriptionStorageContext(specSnapshot: ContextSpecSnapshot): StorageContext {
    return Object.freeze({
      name: `${specSnapshot.name.value}:subscriptions`,
      multitenant: false,
    });
  },

  /**
   * Creates the storage context for read-side catch-up.
   *
   * @param specSnapshot Context configuration.
   * @param options Catch-up tenant options.
   * @returns Storage context for the selected scope.
   */
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

  /**
   * Creates a bounded-context name after checking reserved names.
   *
   * @param value Candidate context name.
   * @returns Immutable validated name.
   */
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

  /**
   * Creates a context snapshot with event storage enabled.
   *
   * @param name Context name.
   * @param multitenant Whether tenant isolation is enabled.
   * @returns Immutable specification snapshot.
   */
  createSpecSnapshot(name: string, multitenant: boolean): ContextSpecSnapshot {
    return Object.freeze({
      name: ContextParts.createBoundedContextName(name),
      multitenant,
      storesEvents: true,
    });
  },

  /**
   * Copies a bounded-context name into an immutable value.
   *
   * @param name Source context name.
   * @returns Immutable name copy.
   */
  cloneName(name: BoundedContextName): BoundedContextName {
    return ContextParts.createBoundedContextName(name.value);
  },

  /**
   * Copies a context specification snapshot and its name.
   *
   * @param spec Source specification.
   * @returns Immutable specification copy.
   */
  cloneSpecSnapshot(spec: ContextSpecSnapshot): ContextSpecSnapshot {
    return Object.freeze({
      name: ContextParts.cloneName(spec.name),
      multitenant: spec.multitenant,
      storesEvents: spec.storesEvents,
    });
  },

  /**
   * Copies a bounded-context snapshot and its specification.
   *
   * @param snapshot Source context snapshot.
   * @returns Immutable context snapshot copy.
   */
  cloneContextSnapshot(snapshot: BoundedContextSnapshot): BoundedContextSnapshot {
    return Object.freeze({
      name: ContextParts.cloneName(snapshot.name),
      tenantMode: snapshot.tenantMode,
      spec: ContextParts.cloneSpecSnapshot(snapshot.spec),
    });
  },

  /**
   * Creates the System specification paired with a domain context.
   *
   * @param domainSpec Domain specification.
   * @param storesEvents Whether System events are stored.
   * @returns System context snapshot.
   */
  createSystemSpec(domainSpec: ContextSpecSnapshot, storesEvents: boolean): ContextSpecSnapshot {
    return Object.freeze({
      name: ContextParts.createBoundedContextName(`${domainSpec.name.value}_System`),
      multitenant: domainSpec.multitenant,
      storesEvents,
    });
  },

  /**
   * Creates a pairing snapshot for domain and System specifications.
   *
   * @param snapshot Domain snapshot.
   * @param systemSpec Paired System specification.
   * @returns Immutable context pairing.
   */
  createSystemPairing(
    snapshot: BoundedContextSnapshot,
    systemSpec: ContextSpecSnapshot,
  ): SystemPairingSnapshot {
    return Object.freeze({
      domain: ContextParts.cloneContextSnapshot(snapshot),
      system: ContextParts.cloneSpecSnapshot(systemSpec),
    });
  },

  /**
   * Copies both specifications in a System pairing.
   *
   * @param pairing Pairing to copy.
   * @returns Immutable pairing copy.
   */
  cloneSystemPairing(pairing: SystemPairingSnapshot): SystemPairingSnapshot {
    return Object.freeze({
      domain: ContextParts.cloneContextSnapshot(pairing.domain),
      system: ContextParts.cloneSpecSnapshot(pairing.system),
    });
  },

  /**
   * Lists non-internal event type URLs exposed by an event bus.
   *
   * @param eventBus Bus whose schemas are inspected.
   * @returns Frozen exposed type URLs.
   */
  exposedEventTypeUrls(eventBus: EventBus): readonly string[] {
    return Object.freeze(
      eventBusAccess
        .eventSchemas(eventBus)
        .filter((schema) => !ContextParts.isInternalEventSchema(schema))
        .map((schema) => TypeUrls.derive(schema)),
    );
  },

  /**
   * Collects external event schemas by type URL.
   *
   * @param dispatchers Dispatchers to inspect.
   * @returns Unique frozen schemas.
   */
  externalEventSchemas(dispatchers: Iterable<EventDispatcher>): readonly MessageSchema[] {
    const schemas = new Map<string, MessageSchema>();
    for (const dispatcher of dispatchers) {
      for (const schema of dispatcher.externalEventSchemas?.() ?? []) {
        schemas.set(TypeUrls.derive(schema), schema);
      }
    }
    return Object.freeze([...schemas.values()]);
  },

  /**
   * Opens the integration broker and associates context readiness.
   *
   * @param context Context receiving integration.
   * @param eventBus Event bus supplied to broker.
   * @param systemSpec Paired System specification.
   * @param externalEventSchemas Schemas accepted from outside.
   */
  attachIntegration(
    context: BoundedContext,
    eventBus: EventBus,
    systemSpec: ContextSpecSnapshot,
    externalEventSchemas: Iterable<MessageSchema>,
  ): void {
    const broker = new IntegrationBroker({
      contextName: create(BoundedContextNameSchema, { value: context.name.value }),
      pairedContextName: create(BoundedContextNameSchema, { value: systemSpec.name.value }),
      transportFactory: ServerEnvironment.instance().integrationChannelFactory,
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
    const ready = broker.open();
    // The builder awaits readiness; retain a rejection handler until it observes the result.
    void ready.catch(() => undefined);
    contextIntegrations.set(context, { broker, ready });
  },

  /**
   * Posts an event after integration readiness and tenant validation.
   *
   * @param context Target context.
   * @param event Event to post.
   * @returns Promise fulfilled after posting.
   */
  postContextEvent(context: BoundedContext, event: Event): Promise<void> {
    const buses = contextEventBuses.get(context);
    if (buses === undefined) return Promise.reject(new Error("Context EventBus is unavailable."));
    if (closingContexts.has(context)) return Promise.reject(new Error("server runtime is closed."));
    return (contextIntegrations.get(context)?.ready ?? Promise.resolve()).then(() => {
      ContextParts.validateImportedTenant(context, event);
      return buses[0].post(event);
    });
  },

  /**
   * Closes the context integration broker.
   *
   * @param context Context whose broker is closed.
   * @returns Promise fulfilled after closing.
   */
  closeIntegration(context: BoundedContext): Promise<void> {
    return contextIntegrations.get(context)?.broker.close() ?? Promise.resolve();
  },

  /**
   * Publishes an imported event through the integration broker.
   *
   * @param context Context integration.
   * @param event Imported event.
   * @returns Promise fulfilled after publishing.
   */
  publishImported(context: BoundedContext, event: Event): Promise<void> {
    const integration = contextIntegrations.get(context);
    if (integration === undefined)
      return Promise.reject(new Error("Context integration is unavailable."));
    return integration.ready.then(() => integration.broker.publishImported(event));
  },

  /**
   * Checks imported event tenant against the context tenant mode.
   *
   * @param context Target context.
   * @param event Imported event to validate.
   */
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

  /**
   * Waits for the integration broker to become ready.
   *
   * @param context Context whose readiness is observed.
   * @returns Readiness promise.
   */
  integrationReady(context: BoundedContext): Promise<void> {
    return contextIntegrations.get(context)?.ready ?? Promise.resolve();
  },

  /**
   * Checks whether a schema carries an internal or SPI marker.
   *
   * @param schema Event schema to inspect.
   * @returns True when an internal marker is set.
   */
  isInternalEventSchema(schema: DescriptorMessageSchema): boolean {
    return (
      (hasOption(schema, internal_type) && getOption(schema, internal_type)) ||
      (hasOption(schema, SPI_type) && getOption(schema, SPI_type)) ||
      (hasOption(schema.file, internal_all) && getOption(schema.file, internal_all))
    );
  },

  /**
   * Converts the multitenant flag to a tenant mode.
   *
   * @param multitenant Context isolation flag.
   * @returns Corresponding tenant mode.
   */
  toTenantMode(multitenant: boolean): TenantMode {
    return multitenant ? "multitenant" : "single-tenant";
  },

  /**
   * Reads the System pairing recorded for a built context.
   *
   * @param context Context to inspect.
   * @returns Pairing snapshot; throws if unpaired.
   */
  requireSystemPairing(context: BoundedContext): SystemPairingSnapshot {
    const pairing = contextSystemPairings.get(context);

    if (pairing === undefined) {
      throw new TypeError("System pairing requires a built BoundedContext instance.");
    }

    return pairing;
  },

  /**
   * Reads the tenant index recorded for a built context.
   *
   * @param context Context to inspect.
   * @returns Tenant index; throws if unavailable.
   */
  requireTenantIndex(context: BoundedContext): TenantIndex {
    const tenantIndex = contextTenantIndexes.get(context);

    if (tenantIndex === undefined) {
      throw new TypeError("Tenant index requires a built BoundedContext instance.");
    }

    return tenantIndex;
  },

  /**
   * Rejects values that are not Repository instances.
   *
   * @param repository Candidate value.
   * @param operation Operation name included in the error.
   */
  requireRepositoryInstance(repository: unknown, operation: string): void {
    if (!repositoryAccess.hasInstance(repository)) {
      throw new TypeError(`${operation} requires a Repository instance.`);
    }
  },

  /**
   * Rejects values that are not Entity classes.
   *
   * @param entityType Candidate Entity constructor.
   * @param operation Operation name included in the error.
   */
  requireEntityClass(entityType: unknown, operation: string): void {
    if (typeof entityType !== "function") {
      throw new TypeError(
        `${operation} requires a Repository instance. Use an entity class only with build().`,
      );
    }
  },

  /**
   * Loads generated handler registries into a metadata registry.
   *
   * @param registries Generated registries to ingest.
   * @returns Populated handler metadata registry.
   */
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

  /**
   * Creates a repository from generated Entity handler metadata.
   *
   * @param entityType Entity class.
   * @param registries Generated registries to search.
   * @param metadata Ingested handler metadata.
   * @param options Repository options overriding defaults.
   * @returns Configured repository view.
   */
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

  /**
   * Finds the generated Entity handler group for an Entity class.
   *
   * @param entityType Entity class to find.
   * @param registries Generated registries to search.
   * @returns Matching handler group; throws when absent.
   */
  findGeneratedEntity(
    entityType: RepositoryEntityType,
    registries: readonly GeneratedHandlerRegistry[],
  ): GeneratedEntityHandlerGroup {
    for (const registry of registries) {
      const generated = registry.receivers.find(
        (receiver): receiver is GeneratedEntityHandlerGroup =>
          receiver.receiverKind === "entity" && receiver.receiverType === entityType,
      );
      if (generated !== undefined) {
        return generated;
      }
    }

    throw new Error(`Generated handler registry is missing metadata for ${entityType.name}.`);
  },

  /**
   * Finds handler metadata for an Entity class and state schema.
   *
   * @param entityType Entity class.
   * @param generated Matching generated Entity group.
   * @param metadata Handler metadata registry.
   * @returns Matching handler metadata; throws when absent.
   */
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

  /**
   * Collects event schemas declared as returned or thrown handler outcomes.
   *
   * @param generated Generated Entity handler group.
   * @returns Frozen unique event schemas.
   */
  aggregateAssignedEvents(
    generated: GeneratedEntityHandlerGroup,
  ): readonly DescriptorMessageSchema[] {
    return ContextParts.uniqueSchemas(
      generated.handlers.flatMap((handler) => [
        ...(handler.kind === "command-assignment" || handler.kind === "event-reaction"
          ? handler.outcomes.returned
          : []),
        ...(handler.kind === "command-assignment" || handler.kind === "command-substitution"
          ? handler.outcomes.thrown
          : []),
      ]),
    );
  },

  /**
   * Collects event schemas produced by standalone handler outcomes.
   *
   * @param receivers Generated standalone groups.
   * @returns Frozen unique event schemas.
   */
  standaloneProducedEventSchemas(
    receivers: readonly GeneratedStandaloneHandlerGroup[],
  ): readonly DescriptorMessageSchema[] {
    return ContextParts.uniqueSchemas(
      receivers.flatMap((receiver) =>
        receiver.handlers.flatMap((handler) => [
          ...(handler.kind === "command-assignment" || handler.kind === "event-reaction"
            ? handler.outcomes.returned
            : []),
          ...(handler.kind === "command-assignment" || handler.kind === "command-substitution"
            ? handler.outcomes.thrown
            : []),
        ]),
      ),
    );
  },

  /**
   * Returns unique schemas by Protobuf type name, preserving the last schema.
   *
   * @typeParam Schema Descriptor schema type retained in the result.
   * @param schemas Schemas to deduplicate.
   * @returns Frozen deduplicated schemas.
   */
  uniqueSchemas<Schema extends DescriptorMessageSchema>(
    schemas: readonly Schema[],
  ): readonly Schema[] {
    const byTypeName = new Map<string, Schema>();

    for (const schema of schemas) {
      byTypeName.set(schema.typeName, schema);
    }

    return Object.freeze([...byTypeName.values()]);
  },

  /**
   * Validates repository uniqueness, registration state, and projection cycles.
   *
   * @param repositories Repository views to validate.
   */
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

  /**
   * Rejects cycles among repository state-subscription dependencies.
   *
   * @param repositories Repository views whose dependencies are checked.
   */
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

  /**
   * Collects command dispatchers configured by repositories.
   *
   * @param repositories Repository views to inspect.
   * @returns Present command dispatchers.
   */
  repositoryCommandDispatchers(
    repositories: readonly RepositoryView[],
  ): readonly CommandDispatcher[] {
    return repositories.flatMap((repository) => {
      const dispatcher = repositoryAccess.commandDispatcher(repository);
      return dispatcher === undefined ? [] : [dispatcher];
    });
  },

  /**
   * Collects event dispatchers configured by repositories.
   *
   * @param repositories Repository views to inspect.
   * @returns Present event dispatchers.
   */
  repositoryEventDispatchers(repositories: readonly RepositoryView[]): readonly EventDispatcher[] {
    return repositories.flatMap((repository) => {
      const dispatcher = repositoryAccess.eventDispatcher(repository);
      return dispatcher === undefined ? [] : [dispatcher];
    });
  },

  /**
   * Collects System event dispatchers configured by repositories.
   *
   * @param repositories Repository views to inspect.
   * @returns Present System event dispatchers.
   */
  repositorySystemEventDispatchers(
    repositories: readonly RepositoryView[],
  ): readonly EventDispatcher[] {
    return repositories.flatMap((repository) => {
      const dispatcher = repositoryAccess.systemEventDispatcher(repository);
      return dispatcher === undefined ? [] : [dispatcher];
    });
  },

  /**
   * Returns event dispatchers excluding System routes.
   *
   * @param dispatchers Event dispatchers to filter.
   * @returns Frozen domain event dispatchers.
   */
  domainEventDispatchers(dispatchers: readonly EventDispatcher[]): readonly EventDispatcher[] {
    return Object.freeze(
      dispatchers.filter((dispatcher) => !ContextParts.isSystemEventDispatcher(dispatcher)),
    );
  },

  /**
   * Returns System event dispatchers.
   *
   * @param dispatchers Event dispatchers to filter.
   * @returns Frozen System event dispatchers.
   */
  systemEventDispatchers(dispatchers: readonly EventDispatcher[]): readonly EventDispatcher[] {
    return Object.freeze(
      dispatchers.filter((dispatcher) => ContextParts.isSystemEventDispatcher(dispatcher)),
    );
  },

  /**
   * Checks a dispatcher's event family and rejects mixed families.
   *
   * @param dispatcher Dispatcher to inspect.
   * @returns True when its schemas are System event schemas.
   */
  isSystemEventDispatcher(dispatcher: EventDispatcher): boolean {
    const schemas = [...dispatcher.messageSchemas()];
    const systemSchemas = schemas.filter(isSystemEventSchema);
    if (systemSchemas.length > 0 && systemSchemas.length !== schemas.length) {
      throw new Error("An EventDispatcher cannot mix domain and system event schemas.");
    }
    return systemSchemas.length > 0;
  },

  /**
   * Collects repository-produced event schemas by type URL.
   *
   * @param repositories Repository views to inspect.
   * @returns Frozen unique event schemas.
   */
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

  /**
   * Removes runtime metadata associated with a context.
   *
   * @param context Context whose WeakMap metadata is removed.
   */
  clearContextMetadata(context: BoundedContext): void {
    const buses = contextEventBuses.get(context);
    if (buses !== undefined) {
      eventBusAccess.clearLogger(buses[0]);
      eventBusAccess.clearLogger(buses[1]);
    }
    const runtime = contextSubscriptionRuntimes.get(context);
    if (runtime !== undefined) subscriptionRuntimeAccess.clearLogger(runtime);
    contextSignalPublishers.get(context)?.clearLogger();
    contextSignalPublishers.delete(context);
    contextLoggers.delete(context);
    contextSystemPairings.delete(context);
    contextTenantIndexes.delete(context);
    contextStorageFactories.delete(context);
    contextDeliveryDescriptors.delete(context);
    contextSubscriptionRuntimes.delete(context);
    contextInputPreparations.delete(context);
    contextPreparations.delete(context);
    contextIntegrations.delete(context);
    eventSubscribers.delete(context);
    systemEventPosters.delete(context);
  },

  /**
   * Creates delivery operations from the context inboxes.
   *
   * @param entityInbox Registered Entity inbox.
   * @param projections Projection inbox.
   * @returns Delivery descriptor.
   */
  createDeliveryDescriptor(
    entityInbox: RegisteredEntityInbox,
    projections: PrjInbox,
  ): ContextDeliveryDescriptor {
    return Object.freeze<ContextDeliveryDescriptor>({
      endpoints: () => Object.freeze([...entityInbox.endpoints(), ...projections.endpoints()]),
      replay: (message, tenantId) =>
        message.label === "UPDATE_SUBSCRIBER"
          ? projections.replay(message, tenantId)
          : entityInbox.replay(message, tenantId),
    });
  },

  /**
   * Closes prepared repositories and collects close failures.
   *
   * @param preparedRepositories Prepared repository resources to close.
   * @returns Collected close errors.
   */
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

  /**
   * Calls one asynchronous context close action and records failures.
   *
   * @param close Close operation.
   * @param errors Failure collection.
   * @returns Promise fulfilled after the close attempt is recorded.
   */
  async closeContextPart(close: () => unknown, errors: unknown[]): Promise<void> {
    try {
      await close();
    } catch (error) {
      ContextParts.collectCloseError(error, errors);
    }
  },

  /**
   * Waits until accepted command, event, System event, and signal work drains.
   *
   * @param commandBus Command bus.
   * @param eventBus Domain event bus.
   * @param systemEventBus System event bus.
   * @param publisher Signal publisher.
   * @returns Promise fulfilled when accepted work stabilizes.
   */
  async drainContextWork(
    commandBus: CommandBus,
    eventBus: EventBus,
    systemEventBus: EventBus,
    publisher: SignalPublisher,
  ): Promise<void> {
    let observedCommandWork = -1;
    let observedEventWork = -1;
    let observedSystemEventWork = -1;

    do {
      observedCommandWork = commandBusAccess.acceptedWorkCount(commandBus);
      observedEventWork = eventBusAccess.acceptedWorkCount(eventBus);
      observedSystemEventWork = eventBusAccess.acceptedWorkCount(systemEventBus);
      await commandBusAccess.drain(commandBus);
      await eventBusAccess.drain(eventBus);
      await eventBusAccess.drain(systemEventBus);
      await publisher.drain();
    } while (
      commandBusAccess.acceptedWorkCount(commandBus) !== observedCommandWork ||
      eventBusAccess.acceptedWorkCount(eventBus) !== observedEventWork ||
      eventBusAccess.acceptedWorkCount(systemEventBus) !== observedSystemEventWork
    );
  },

  /**
   * Adds an error or aggregate causes to the close error collection.
   *
   * @param error Close failure.
   * @param errors Failure collection.
   */
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

  /**
   * Binds a repository to context runtime services and supplies commit and close operations.
   *
   * @param repository Repository to prepare.
   * @param registration Context services and schemas.
   * @returns Prepared repository.
   */
  prepareRepositoryForContext(
    repository: RepositoryView,
    registration: RepositoryRegistration,
  ): PreparedRepository {
    ContextParts.requireRepositoryInstance(repository, "BoundedContext repository registration");
    const snapshot = ContextParts.repositorySnapshot(repository);
    ContextParts.rejectRegisteredRepository(repository);
    ContextParts.bindRepositoryRuntime(repository, registration);

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
        repositoryAccess.clearRuntimeIdle(repository);
      },
    };
  },

  /**
   * Binds Bounded Context services to a prepared repository before target registration.
   *
   * @param repository Prepared repository receiving runtime services.
   * @param registration Bounded Context services and schemas.
   */
  bindRepositoryRuntime(repository: RepositoryView, registration: RepositoryRegistration): void {
    repositoryAccess.bindRuntime(repository, {
      context: registration.storageContext,
      storageFactory: registration.storageFactory,
      onAdmit: registration.onAdmit,
      ...(registration.ai === undefined ? {} : { ai: registration.ai }),
      stand: registration.stand,
      signalMetadata: new SignalMetadata(),
      entityInbox: registration.entityInbox,
      projectionInbox: registration.projectionInbox,
      publisher: registration.publisher,
      registerEventSchema: registration.registerEventSchema,
      registerSystemEventSchema: registration.registerSystemEventSchema,
      publishAgentEvent: registration.publishAgentEvent,
      publishAgentSystemEvent: registration.publishAgentSystemEvent,
      agentReceipts: registration.agentReceipts,
      agentSignal: registration.agentSignal,
      reserveAgent: registration.reserveAgent,
      deferAgent: registration.deferAgent,
    });
  },

  /**
   * Captures repository metadata needed for context registration.
   *
   * @param repository Repository to inspect.
   * @returns Frozen registration snapshot.
   */
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

  /**
   * Rejects a repository already registered with a bounded context.
   *
   * @param repository Repository to check.
   */
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

  /**
   * Creates storage record columns from Entity metadata.
   *
   * @param snapshot Registration snapshot supplying fields.
   * @returns Record columns.
   */
  repositoryColumns(snapshot: RegistrationSnapshot): readonly RecordColumn<Message>[] {
    return snapshot.metadata.columns.map(
      (field) =>
        new RecordColumn(field.name, ColumnTypes.fromField(field.descriptor), (record) =>
          ContextParts.readRecordField(record, field.localName),
        ),
    );
  },

  /**
   * Creates an immutable repository view from a registration snapshot.
   *
   * @param snapshot Registration snapshot.
   * @returns Immutable repository view.
   */
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

  /**
   * Builds dispatch descriptors for Projection repositories with event handlers.
   *
   * @param repositories Repository views to inspect.
   * @returns Frozen Projection dispatch descriptors.
   */
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

  /**
   * Collects unique Projection state schemas for clearing.
   *
   * @param projections Projection dispatch descriptors.
   * @returns Frozen unique clear targets.
   */
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

  /**
   * Reads stored events in deterministic timestamp, producer, version, and ID order.
   *
   * @param context Event-store storage context.
   * @param storageFactory Event storage provider.
   * @returns Stored events in deterministic order.
   */
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
      await eventStore.close();
    }
  },

  /**
   * Builds Stand options for the catch-up tenant scope.
   *
   * @param context Catch-up storage context.
   * @returns Options with a cloned tenant ID when multitenant.
   */
  catchUpStandOptions(context: StorageContext): { readonly tenantId?: TenantId } {
    if (!context.multitenant) {
      return {};
    }

    return Object.freeze({ tenantId: clone(TenantIdSchema, context.tenantId) });
  },

  /**
   * Verifies a stored event envelope belongs to the catch-up tenant.
   *
   * @param context Catch-up storage context.
   * @param event Stored event to validate.
   */
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

  /**
   * Reads the tenant ID from an event import or past-message origin.
   *
   * @param event Event whose origin is inspected.
   * @returns Cloned tenant ID when present.
   */
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

  /**
   * Copies a tenant ID when present.
   *
   * @param tenantId Optional tenant ID.
   * @returns Cloned tenant ID or undefined.
   */
  tenantIdValue(tenantId: TenantId | undefined): TenantId | undefined {
    return tenantId === undefined ? undefined : clone(TenantIdSchema, tenantId);
  },

  /**
   * Dispatches a stored event to matching Projection handlers and direct updates.
   *
   * @param projections Projection dispatch descriptors.
   * @param event Stored event.
   * @param rebuild Whether direct dispatch is a rebuild.
   * @returns One when a Projection matched, otherwise zero.
   */
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

  /**
   * Creates a replay error with the event ID and bounded cause details.
   *
   * @param event Event that failed.
   * @param cause Thrown replay cause.
   * @returns Replay error.
   */
  catchUpReplayError(event: Event, cause: unknown): Error {
    return new CatchUpReplayError(
      event.id?.value ?? "(missing)",
      ContextParts.catchUpReplayDetail(cause),
    );
  },

  /**
   * Returns an error string truncated to a maximum length.
   *
   * @param value String to bound.
   * @param limit Maximum character count.
   * @returns Bounded string.
   */
  boundedErrorString(value: string, limit: number): string {
    return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
  },

  /**
   * Converts a thrown value to bounded error name and message details.
   *
   * @param error Thrown value.
   * @returns Immutable bounded details.
   */
  catchUpReplayDetail(error: unknown): CatchUpReplayDetail {
    if (error instanceof Error) {
      return Object.freeze({
        name: ContextParts.boundedErrorString(error.name, errorDetailLimit) || "Error",
        message: ContextParts.boundedErrorString(error.message, errorDetailLimit),
      });
    }

    return Object.freeze({
      name: "NonErrorThrow",
      message: ContextParts.boundedErrorString(String(error), errorDetailLimit),
    });
  },

  /**
   * Reads and requires the Entity ID field from a stored record.
   *
   * @param record Protobuf record.
   * @param snapshot Repository metadata identifying the ID field.
   * @returns ID field value; throws when missing.
   */
  readRecordId(record: Message, snapshot: RegistrationSnapshot): unknown {
    const value = ContextParts.readRecordField(record, snapshot.idField.localName);

    if (value === undefined || value === null) {
      throw new Error(
        `Repository state "${snapshot.stateFullTypeName}" requires ID field "${snapshot.idField.name}".`,
      );
    }

    return value;
  },

  /**
   * Reads a field from a Protobuf record by descriptor local name.
   *
   * @param record Record message.
   * @param localName Descriptor local field name.
   * @returns Field value.
   */
  readRecordField(record: Message, localName: DescriptorFieldMetadata["localName"]): unknown {
    return (record as Record<string, unknown>)[localName];
  },
});

interface StandaloneConstructor {
  readonly name: string;
}

/**
 * Exposes broker-only operations for the owning integration package.
 *
 * @internal
 */
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
