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

export {
  BoundedContext,
  BoundedContextBuilder,
  type BoundedContextName,
  BoundedContextNameError,
  type BoundedContextSnapshot,
  type CommandEndpoint,
  ContextSpec,
  type ContextSpecSnapshot,
  type ReadCatchUpOptions,
  type ReadCatchUpResult,
  type EventEndpoint,
  type GeneratedRepositoryOptions,
  type DispatchErrorSnapshot,
  type StoredEventDispatchFailure,
  type TenantMode,
} from "./context/bounded-context.js";
export { ThirdPartyContext } from "./integration/third-party-context.js";

export {
  Stand,
  type StandOptions,
  type StandReadOptions,
  type StandReadResult,
  type StandRegisterOptions,
  type StandSubscribeOptions,
  type StandSubscription,
  StandStateTypeError,
  type StandUpdate,
  type StandUpdateOptions,
} from "./stand/stand.js";
export {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
  StandConflictError,
  type StandActivateResult,
  type StandCleanupResult,
  type StandCreateResult,
  type StandDeleteResult,
  type StandSubscriptionEntry,
  type StandSubscriptionRegistry,
} from "./stand/subscription-registry.js";

export { SpineServices, type SpineServicesOptions } from "./services/spine-services.js";
export {
  Server,
  type BrowserAuthRoute,
  type BrowserServerOptions,
  type ListenerLifecycle,
  type RunningServer,
  type ServerOptions,
} from "./server/server.js";
export {
  ManagedServerApplication,
  type ManagedServerApplicationHandle,
  type ManagedServerApplicationOptions,
  type ManagedServerRestartOptions,
} from "./server/managed-server-application.js";
export {
  DurableSubscriptionBindings,
  isDurableSubscriptionBindings,
  type DurableSubscriptionBindingsOptions,
} from "./server/durable-subscription-bindings.js";
export {
  DurablePublicSubscriptionBindings,
  isDurablePublicSubscriptionBindings,
  type DurablePublicSubscriptionBindingsOptions,
} from "./server/durable-public-subscription-bindings.js";
export { Environment, EnvironmentType } from "./server/environment.js";
export {
  ServerEnvironment,
  type ServerEnvironmentCloseable,
  type ServerEnvironmentDelivery,
  type ServerEnvironmentSettings,
} from "./server/server-environment.js";

export { CommandBus } from "./bus/command-bus.js";
export type { CommandDispatcher } from "./bus/command-dispatcher.js";
export { EventBus } from "./bus/event-bus.js";
export type { EventDispatcher } from "./bus/event-dispatcher.js";
export { DeliveryStorageCorruptionError } from "./delivery/delivery-storage-error.js";
export type {
  DeliveryInbox,
  DeliveryWorkRegistry,
  DeliveryWorkSession,
  ExclusiveDeliveryWorkSession,
  LeasedDeliveryWorkSession,
} from "./delivery/delivery-ports.js";
export { type DeliveryEndpointMessage } from "./delivery/delivery.js";
export {
  DeliveryBuilder,
  DeliveryMonitor,
  type Delivery,
  type DeliveryResult,
  type DeliveryRunOptions,
  type DeliveryStrategy,
  UniformAcrossAllShards,
} from "./delivery/delivery-builder.js";
export {
  AlreadyPickedUp,
  FailedPickUp,
  FailedReception,
  type DeliveryStage,
  type DeliveryStatistics,
  type PickUpAction,
  type ReceptionAction,
} from "./delivery/delivery-monitor.js";
export {
  DeliverySupervisor,
  DeliveryShutdownTimeoutError,
  type DeliveryOperationOptions,
  type DeliveryShardUpdate,
  type DeliverySource,
  type DeliverySupervisorOptions,
  type DeliverySupervisorCloseOptions,
} from "./delivery/delivery-supervisor.js";
export {
  Inbox,
  type DeliveryLabel,
  type DeliveryStatus,
  type InboxId,
  InboxMessageError,
  type InboxMessage,
  type InboxMessageId,
  type InboxMessageInput,
  type InboxReadContinuation,
  type InboxReadOptions,
  type InboxWriteResult,
} from "./delivery/inbox.js";
export { InboxStorage, type InboxStorageOptions } from "./delivery/inbox-storage.js";
export { ShardIndex } from "./delivery/shard-index.js";
export {
  ShardedWorkRegistry,
  ShardSession,
  type ShardedWorkRegistryOptions,
} from "./delivery/sharded-work-registry.js";

export {
  Aggregate,
  Entity,
  type EntityFamily,
  type EntityLifecycleFlags,
  type EntityOptions,
  type EntityScopeReason,
  type EntityVersionMetadata,
  type PlainEntityVersionMetadata,
  ProcessManager,
  Projection,
  TransactionalEntity,
  TransactionalEntityScopeError,
  type TransactionalEntityScopeOperation,
} from "./entity/entity.js";

export {
  type DeclaredEntityVisibility,
  type DescriptorFieldMetadata,
  DescriptorMetadataError,
  type DescriptorMetadataErrorCode,
  type DescriptorMessageSchema,
  describeEntityMetadata,
  type EntityKind,
  type EntityMetadata,
  type EntityVisibility,
  type FirstFieldRoutingHint,
  isEntitySchema,
} from "./entity/entity-metadata.js";

export { SpecScanner } from "./entity/spec-scanner.js";

export {
  createEntityTransaction,
  EntityTransaction,
  DraftStateError,
  EntityTransactionStateError,
  type EntityTransactionAcceptedCommit,
  type EntityTransactionCommitResult,
  type CommittedVersionMetadata,
  type DraftStateReason,
  type EntityTransactionLifecycleFlags,
  type EntityTransactionOperation,
  type EntityTransactionOptions,
  type EntityTransactionRejectedCommit,
  type EntityTransactionRollbackResult,
  type EntityTransactionStatus,
  type EntityTransactionMutator,
  type EntityTransactionVersionMetadata,
} from "./entity/entity-transaction.js";

export {
  type StateTransitionRequest,
  type StateTransitionResult,
  validateEntityStateTransition,
} from "./entity/entity-transition-validation.js";

export {
  type ActorContextInput,
  type Clock,
  type CommandContextInput,
  FixedClock,
  type EventContextInput,
  SignalIds,
  SignalMetadata,
  type SignalMetadataOptions,
  SystemClock,
} from "./runtime/signal-metadata.js";

export {
  type ServerRuntimeLifecycle,
  type ServerRuntimeRejectedState,
  type ServerRuntimeState,
  ServerRuntimeStateError,
  type ServerRuntimeStateOperation,
  type ServerRuntimeWork,
  type RuntimeStateErrorCode,
  SingleProcessServerRuntime,
} from "./runtime/runtime.js";

export {
  acceptSignalIntake,
  failSignalIntake,
  type SignalIntakeAccepted,
  type SignalIntakeAcceptedFor,
  type SignalIntakeFailure,
  type SignalIntakeFailureCode,
  type SignalIntakeFailureDetails,
  type SignalIntakeFailureDiagnostics,
  type SignalIntakeResult,
  type SignalKind,
} from "./runtime/signal-intake.js";

export {
  CommandRegistrationReadiness,
  type CommandRegistrationAssigneeMetadata,
  type CommandRegistrationReadinessLookup,
} from "./handler/command-registration-readiness.js";

export {
  EventRegistrationReadiness,
  type EventRegistrationApplicationMetadata,
  type EventRegistrationReadinessLookup,
  type EventRegistrationReactorMetadata,
  type EventRegistrationSubscriberMetadata,
} from "./handler/event-registration-readiness.js";

export { type MessageId, type PrimitiveId } from "./repository/primitive-id.js";
export { CommandRouting, type CommandRoute } from "./repository/command-routing.js";
export type { InterfaceRouteMessage } from "./repository/routing-declarations.js";
export { EventRouting, type EventRoute } from "./repository/event-routing.js";
export { StateUpdateRouting, type StateUpdateRoute } from "./repository/state-update-routing.js";

export {
  type ConcreteRepositoryEntityType,
  Repository,
  type RepositoryCommandRoute,
  type RepositoryEntityType,
  type RepositoryEventRoute,
  RepositoryIdentityError,
  type RepositoryIdentityErrorCode,
  type RepositoryIdentitySnapshot,
  type RepositoryOptions,
  type RepositoryRouteInvocation,
  type RepositoryStateSchema,
  type RepositoryView,
} from "./repository/repository.js";

export {
  Apply,
  Assign,
  Command,
  type HandlerMethodDecorator,
  type HandlerMethodValue,
  React,
  Subscribe,
  Where,
  type WhereOptions,
  materializeDecoratedEntityHandlers,
} from "./handler/handler-decorators.js";

export type { External } from "./handler/external.js";

export {
  GeneratedRegistryDiscovery,
  GeneratedRegistryDiscoveryError,
  type GeneratedRegistryDiscoveryOptions,
  type RegistryDiscoveryErrorCode,
} from "./handler/generated-registry-discovery.js";

export {
  HandlerRegistryIngestionError,
  HandlerRegistryIngestor,
  type RegistryIngestionErrorCode,
} from "./handler/generated-handler-registry.js";

export {
  type BaseHandlerMetadata,
  type CommandAssignmentHandlerMetadata,
  type CommandReactionHandlerMetadata,
  type EntityClass,
  type EntityHandlersMetadata,
  type EventApplicationHandlerMetadata,
  type EventApplicationOptions,
  type EventReactionHandlerMetadata,
  type EventSubscriptionHandlerMetadata,
  type StateSubscriptionHandlerMetadata,
  type HandlerKind,
  type HandlerOrigin,
  type HandlerMetadata,
  EntityHandlers,
  HandlerMetadataError,
  type HandlerMetadataErrorCode,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  type HandlerRegistryErrorCode,
  type HandlerMetadataRegistryLookup,
  type HandlerMethodName,
  type HandlerParameterCount,
  type HandlerRegistrationBuilder,
  type RegisteredHandlerMetadata,
} from "./handler/handler-metadata.js";
