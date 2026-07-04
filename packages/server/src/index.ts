export {
  BoundedContext,
  BoundedContextBuilder,
  type BoundedContextName,
  BoundedContextNameError,
  type BoundedContextSnapshot,
  type CommandEndpoint,
  ContextSpec,
  type ContextSpecSnapshot,
  type EventEndpoint,
  type TenantMode,
} from "./context/bounded-context.js";

export {
  Stand,
  type StandOptions,
  type StandReadOptions,
  type StandRegisterOptions,
  type StandSubscribeOptions,
  type StandSubscription,
  StandStateTypeError,
  type StandUpdate,
  type StandUpdateOptions,
} from "./stand/stand.js";

export { SpineServices, type SpineServicesOptions } from "./services/spine-services.js";

export { CommandBus } from "./bus/command-bus.js";
export type { CommandDispatcher } from "./bus/command-dispatcher.js";
export { EventBus } from "./bus/event-bus.js";
export type { EventDispatcher } from "./bus/event-dispatcher.js";
export { Delivery, type DeliveryOptions } from "./delivery/delivery.js";
export { DeliveryStorageCorruptionError } from "./delivery/delivery-storage-error.js";
export {
  Inbox,
  type DeliveryLabel,
  type DeliveryStatus,
  type InboxId,
  InboxMessageError,
  type InboxMessage,
  type InboxMessageId,
  type InboxMessageInput,
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
  type EntityVersionMetadata,
  type PlainEntityVersionMetadata,
  ProcessManager,
  Projection,
  TransactionalEntity,
  TransactionalEntityScopeError,
  type TransactionalEntityScopeErrorReason,
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

export {
  createEntityTransaction,
  EntityTransaction,
  EntityTransactionDraftStateError,
  EntityTransactionStateError,
  type EntityTransactionAcceptedCommit,
  type EntityTransactionCommitResult,
  type EntityTransactionCommittedVersionMetadata,
  type EntityTransactionDraftStateReason,
  type EntityTransactionLifecycleFlags,
  type EntityTransactionOperation,
  type EntityTransactionOptions,
  type EntityTransactionRejectedCommit,
  type EntityTransactionRollbackResult,
  type EntityTransactionStatus,
  type EntityTransactionUpdater,
  type EntityTransactionVersionMetadata,
} from "./entity/entity-transaction.js";

export {
  type EntityStateTransitionValidationRequest,
  type EntityStateTransitionValidationResult,
  validateEntityStateTransition,
} from "./entity/entity-transition-validation.js";

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

export {
  createServerRuntimeRoutingPlan,
  type CommandRuntimeRoutingPlan,
  type DeferredServerRuntimeRoutingSeam,
  type EventRuntimeRoutingPlan,
  type ServerRuntimeRoutingPlan,
  type ServerRuntimeRoutingPlanInput,
} from "./runtime/runtime-routing.js";

export {
  AggregateStorage,
  type AggregateId,
  type AggregateHistory,
  type AggregateSnapshot,
  type AggregateStorageOptions,
} from "./repository/aggregate-storage.js";

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
  materializeDecoratedEntityHandlers,
} from "./handler/handler-decorators.js";

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
  type HandlerKind,
  type HandlerMetadata,
  HandlerMetadataError,
  type HandlerMetadataErrorCode,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  type HandlerMetadataRegistryErrorCode,
  type HandlerMetadataRegistryLookup,
  type HandlerMethodName,
  type HandlerRegistrationBuilder,
  type RegisteredHandlerMetadata,
  defineEntityHandlers,
} from "./handler/handler-metadata.js";
