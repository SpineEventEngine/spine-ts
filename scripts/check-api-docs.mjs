import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createProgram,
  createSourceFile,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  SyntaxKind,
} from "typescript";

const expectedProtoExports = [
  "ActorContext",
  "ActorContextSchema",
  "Command",
  "CommandContext",
  "CommandContextSchema",
  "CommandContext_Schedule",
  "CommandContext_ScheduleSchema",
  "CommandId",
  "CommandIdSchema",
  "CommandSchema",
  "CommandValidationError",
  "CommandValidationErrorSchema",
  "Command_SystemProperties",
  "Command_SystemPropertiesSchema",
  "column",
  "entity",
  "EntityOption",
  "EntityOptionSchema",
  "EntityOption_Kind",
  "EntityOption_KindSchema",
  "EntityOption_Visibility",
  "EntityOption_VisibilitySchema",
  "every_is",
  "EveryIsOption",
  "EveryIsOptionSchema",
  "FieldPath",
  "TemplateString",
  "ValidationError",
  "ConstraintViolation",
  "DayOfWeek",
  "DayOfWeekSchema",
  "EmailAddress",
  "EmailAddressSchema",
  "Enrichment",
  "EnrichmentSchema",
  "Enrichment_Container",
  "Enrichment_ContainerSchema",
  "Event",
  "EventContext",
  "EventContextSchema",
  "EventId",
  "EventIdSchema",
  "EventSchema",
  "EventValidationError",
  "EventValidationErrorSchema",
  "IsOption",
  "IsOptionSchema",
  "InternetDomain",
  "InternetDomainSchema",
  "is",
  "Language",
  "LanguageSchema",
  "LocalDate",
  "LocalDateSchema",
  "LocalDateTime",
  "LocalDateTimeSchema",
  "LocalTime",
  "LocalTimeSchema",
  "MessageId",
  "MessageIdSchema",
  "Month",
  "MonthSchema",
  "Origin",
  "OriginSchema",
  "RejectionEventContext",
  "RejectionEventContextSchema",
  "TenantId",
  "TenantIdSchema",
  "UserId",
  "UserIdSchema",
  "Version",
  "VersionSchema",
  "YearMonth",
  "YearMonthSchema",
  "ZoneId",
  "ZoneIdSchema",
  "ZonedDateTime",
  "ZonedDateTimeSchema",
  "file_spine_options",
  "fieldPathFile",
  "actorContextFile",
  "file_spine_core_command",
  "file_spine_core_diagnostics",
  "file_spine_core_enrichment",
  "file_spine_core_event",
  "tenantIdFile",
  "userIdFile",
  "file_spine_core_version",
  "emailAddressFile",
  "internetDomainFile",
  "templateStringFile",
  "file_spine_time_time",
  "file_spine_ui_language",
  "validationErrorFile",
  "set_once",
  "type_url_prefix",
  "FieldPathSchema",
  "TemplateStringSchema",
  "ValidationErrorSchema",
  "ConstraintViolationSchema",
];
const expectedIntegrationProtoExports = [
  "BoundedContextName",
  "BoundedContextNameSchema",
  "BoundedContextOnline",
  "BoundedContextOnlineSchema",
  "ChannelId",
  "ChannelIdSchema",
  "ExternalEventsWanted",
  "ExternalEventsWantedSchema",
  "ExternalEventType",
  "ExternalEventTypeSchema",
  "ExternalMessage",
  "ExternalMessageSchema",
  "ExternalMessageValidationError",
  "ExternalMessageValidationErrorSchema",
  "file_spine_core_bounded_context",
  "file_spine_server_integration_broker",
  "file_spine_server_transport_transport",
];
const expectedProtoToolsExports = [
  "manifestFormatVersion",
  "ModelConfig",
  "ApplicationConfig",
  "SpineProtoConfig",
  "ProtoManifest",
  "ProtoConfig",
];
const expectedAuthExports = [
  "ApplicationSessionIssue",
  "ApplicationSessionIssuer",
  "AuthenticatedPrincipal",
  "Authenticator",
  "AuthorizationPolicy",
  "AuthorizedRequestContext",
  "Clock",
  "CookieCredential",
  "BearerCredential",
  "CommandRequestInput",
  "ContextResolver",
  "ConfiguredOidcProvider",
  "createGitHubProvider",
  "createGoogleProvider",
  "createOidcProvider",
  "discoverOidcProvider",
  "DynamicUnaryClient",
  "DynamicUnaryForwarder",
  "DynamicUnaryOptions",
  "ExternalIdentity",
  "GatewayAdmission",
  "UnaryGatewayCollaborators",
  "DynamicSubscriptionCreator",
  "GitHubProviderOptions",
  "IdentityMapping",
  "IncomingCommand",
  "IncomingQuery",
  "IncomingRequest",
  "IncomingRequestInput",
  "IncomingSubscription",
  "IncomingSubscriptionActivation",
  "IncomingSubscriptionCancellation",
  "RequestCredential",
  "RequestDecoder",
  "ResolvedSession",
  "ResolvedApplicationIdentity",
  "SessionResolver",
  "InMemorySubscriptionBindings",
  "SubscriptionBindings",
  "SubscriptionAbortSignal",
  "SubscriptionBindingTransition",
  "SubscriptionTopicWire",
  "PublicSubscriptionWire",
  "BackendSubscriptionEnvelope",
  "createNativeGatewayServices",
  "NativeGatewayRequestContext",
  "NativeGatewayServices",
  "NativeGatewayServicesOptions",
  "NativeSubscriptionCreator",
  "OpaqueCredentialExtraction",
  "OpaqueCredentialRejection",
  "OpaqueSessionClock",
  "OpaqueSessionCookies",
  "OpaqueSessionCookiesOptions",
  "OpaqueSessionCreateResult",
  "OpaqueSessionHeaders",
  "OpaqueSessionLogoutResult",
  "OpaqueSessionRandom",
  "OpaqueSessionRotateResult",
  "OpaqueSessions",
  "OpaqueSessionsOptions",
  "OidcAuthorizationCodeExchange",
  "OidcClientAuthentication",
  "OidcFlow",
  "OidcFlowCallbackInput",
  "OidcFlowCallbackResult",
  "OidcFlowClock",
  "OidcFlowExchangeInput",
  "OidcFlowExchangeResult",
  "OidcFlowOptions",
  "OidcFlowRandom",
  "OidcFlowStartInput",
  "OidcFlowStartResult",
  "OidcVerifiedIdentityProvider",
  "OidcProviderOptions",
  "ProviderFetch",
  "SignedSessionClock",
  "SignedSessionIssueResult",
  "SignedSessionLogoutResult",
  "SignedSessionRandom",
  "SignedSessionRotationResult",
  "SignedSessionSigningKey",
  "SignedSessionVerificationKey",
  "SignedSessions",
  "SignedSessionsOptions",
  "SignedTokenRevocation",
  "SubscriptionCoordinator",
  "SubscriptionGatewayCollaborators",
  "OnSubscriptionDefinition",
  "SubscriptionGatewayLimits",
  "SubscriptionCreator",
  "SubscriptionGateway",
  "SubscriptionGatewayOptions",
  "SubscriptionGatewayRequest",
  "SubscriptionGatewayResult",
  "SubscriptionRelayLimits",
  "SubscriptionUpdateRelay",
  "SubscriptionUpdateSink",
  "SubscriptionUpdateWire",
  "TransportFactsInput",
  "TransportRequestContext",
  "UnaryForwarder",
  "UnaryGateway",
  "UnaryGatewayOptions",
  "UnaryGatewayRejection",
  "UnaryGatewayRequest",
  "UnaryGatewayResult",
  "IncomingRequests",
  "TransportFacts",
];
const expectedCoreExports = [
  "DEFAULT_TYPE_URL_PREFIX",
  "TypeRegistry",
  "TypeRegistryLookup",
  "TypeRegistry.spineCore",
  "TypeUrls.derive",
  "TypeUrls.prefix",
  "spineCoreRegistry",
  "FileOptionExtension",
  "MessageSchema",
  "MessageInterface",
  "MessageInterfaces",
  "MessageInterfaces.define",
  "MessageInterfaces.is",
  "RegisterTypeOptions",
  "TypeMetadata",
  "DeriveTypeUrlOptions",
  "MessageValidationResult",
  "RejectionThrowable",
  "ValidationException",
  "RejectionThrowable.create",
  "RejectionThrowable.is",
  "Validate.message",
  "Validate.check",
  "Validate.createError",
  "TransitionValidationRequest",
  "TransitionValidationRule",
  "TransitionValidationResult",
  "Validate.transition",
  "PackAnyOptions",
  "PackCommandInput",
  "PackEventInput",
  "AnyMessages.pack",
  "AnyMessages.unpack",
  "SignalEnvelopes.command",
  "SignalEnvelopes.event",
];
const expectedClientExports = [
  "Client",
  "ClientKernel",
  "ClientOperationOptions",
  "ClientOptions",
  "ClientOutcome",
  "ClientProtocolError",
  "ClientRequest",
  "ClientTransport",
  "CreateSubscriptionOptions",
  "Subscription",
  "SubscriptionDelivery",
  "SubscriptionLifecycle",
  "EntityColumn",
  "EntityColumnDefinition",
  "EntityColumnDefinitionEntry",
  "EntityColumnOperator",
  "EntityColumnValue",
  "EntityColumnValueKind",
  "EntityColumns",
  "EntityComparison",
  "EntityComparisonPredicate",
  "EntityEqualityOperator",
  "EntityGroup",
  "EntityOrderingOperator",
  "EntityPredicate",
  "EntityQuery",
  "EntityQueryBuilder",
];
const expectedClientWebExports = [
  "BearerBrowserSessionOptions",
  "BrowserClientOptions",
  "BrowserSession",
  "BrowserSessionContext",
  "BrowserSessionOptions",
  "Client",
  "ClientOperationOptions",
  "ClientOptions",
  "ClientOutcome",
  "ClientProtocolError",
  "ClientRequest",
  "ClientTransport",
  "CreateSubscriptionOptions",
  "OnRequestMetadata",
  "OnBrowserSessionContext",
  "Subscription",
  "SubscriptionDelivery",
  "SubscriptionLifecycle",
  "SubscriptionLifecycleState",
  "SubscriptionRetryPolicy",
  "SubscriptionRuntimeOptions",
  "SubscriptionScheduler",
];
const expectedClientReactExports = [
  "OnSubscriptionDelivery",
  "OnSubscriptionLifecycle",
  "RequestObservation",
  "SpineClientProvider",
  "SpineClientProviderProps",
  "SubscriptionObservation",
  "useEntityQuery",
  "useEntitySubscription",
  "useEventSubscription",
  "useRequest",
  "useSpineClient",
  "useSubscriptionDelivery",
  "useSubscriptionLifecycle",
];
const expectedDeliveryClientExports = [
  "DeliveryClient",
  "DeliveryClientOptions",
  "DeliveryFindOneOptions",
  "DeliveryMutationOptions",
  "DeliveryOutcomeUnknownError",
  "DeliveryPagingError",
  "DeliveryProtocolError",
  "DeliveryReadPageOptions",
  "DeliveryShardObservationError",
  "ShardObservationOverflowError",
  "DeliveryShardObservationStream",
  "DeliveryWorkerId",
  "MAX_DELIVERY_BATCH_MESSAGES",
  "MAX_INBOX_PAYLOAD_BYTES",
  "MAX_DELIVERY_RPC_BYTES",
  "ReleasedShardSession",
  "RemoteDelivery",
  "RemoteDeliveryConfig",
  "RemoteInbox",
  "RemoteShardObservation",
  "RemoteShardSession",
  "RemoteWorkRegistry",
];
const expectedDeliveryServerExports = [
  "InMemoryDelivery",
  "DeliveryCore",
  "DeliveryCoreOptions",
  "DeliveryServer",
  "DeliveryServerOptions",
];
const expectedDeploymentExports = [
  "ApplicationNode",
  "LeasedNodeRegistry",
  "LeasedNodeRegistryOptions",
  "NodeDiscovery",
  "NodeLease",
  "NodeScheduler",
  "NodeSnapshotReader",
  "ScheduledNodeDiscovery",
  "ScheduledNodeDiscoveryOptions",
  "StaticNodeDiscovery",
];
const expectedDeploymentGceExports = [
  "GceApplicationNode",
  "GceApplicationNodeOptions",
  "GceDeadlineFactory",
  "GceMetadata",
  "GceMetadataProvider",
  "GceMetadataService",
  "GceNodeDiscovery",
  "GceNodeDiscoveryOptions",
  "GceRegistrar",
  "GceRegistrarLifecycle",
  "GceRegistrarOptions",
  "GceRegistryReader",
  "GceScheduler",
];
const expectedDeploymentGkeExports = [
  "DnsLookup",
  "GkeDnsAddress",
  "GkeDnsResolver",
  "GkeNodeDiscovery",
  "GkeNodeDiscoveryOptions",
  "NodeDnsResolver",
];
const expectedStorageExports = [
  "ColumnMapping",
  "ColumnMappings",
  "ColumnTypeMapping",
  "ColumnTypes",
  "EventStore",
  "EventStoreContext",
  "EventRollback",
  "EntityEventStorage",
  "EntityStateHistoryStorage",
  "InMemoryStorageBackend",
  "InMemoryRecordStorage",
  "InMemoryStorageFactory",
  "OnEventAccepted",
  "NormalizedComparisonOperator",
  "NormalizedQueryEntry",
  "NormalizedQueryMask",
  "NormalizedQueryOrder",
  "NormalizedQueryPlan",
  "NormalizedQueryPredicate",
  "RecordColumn",
  "RecordColumnType",
  "RecordContinuation",
  "RecordContinuationValue",
  "RecordEntry",
  "RecordFilter",
  "RecordMask",
  "RecordOrder",
  "RecordQuery",
  "RecordReadOptions",
  "RecordSpec",
  "RecordSpecOptions",
  "RecordStorage",
  "Storage",
  "StorageContext",
  "StorageFactory",
  "StorageGroup",
  "StorageMode",
  "StorageQueryCapabilities",
  "defaultQueryCandidateLimit",
  "QueryCandidateLimitError",
  "StorageQueryFeature",
  "StorageQueryEvaluator",
  "StorageQueryPolicy",
];
const expectedStorageProviderDocumentedExports = [
  "CleanupOperation",
  "DeliveryCleanupInput",
  "DeliveryCleanupStorage",
  "DeliveryCleanupStorageFactories",
  "DeliveryCleanupStorageFactory",
  "EntityCommitInput",
  "EntityCommitResult",
  "EntityCommitStorage",
  "EntityCommitStorageFactories",
  "EntityCommitStorageFactory",
  "EntityEventHistoryPort",
  "EntityHistoryConformance",
  "EntityHistoryConformanceAdapter",
  "EntityIdCodec",
  "EntityRecordStorage",
  "EntityStateHistoryPort",
  "EntityStorageConformance",
  "EntityStorageInput",
  "StorageQueryValues",
  "TenantBoundary",
  "TenantCatalog",
  "TenantCatalogProvider",
  "cleanupOperationActive",
  "disabledEventHistoryPort",
  "disabledStateHistoryPort",
  "eventHistorySpec",
  "eventStoreAccess",
  "eventStoreRecordSpec",
  "stateHistorySpec",
];
const expectedStorageProviderDeclaredExports = [
  ...expectedStorageProviderDocumentedExports,
  "EntityRecord",
].sort();
const expectedDatastoreStorageExports = [
  "CreateEntityStorage",
  "CreateRecordStorage",
  "DatastoreColumnMapping",
  "DatastoreEntityStorageHandle",
  "DatastoreIdColumn",
  "DatastoreQueryLimitError",
  "DatastoreStorageFactory",
  "DatastoreStorageFactoryBuilder",
  "DefaultNamespaceConverter",
  "NamespaceConverter",
  "RecordLayout",
];
const expectedRdbmsStorageExports = [
  "CreateOperationFactory",
  "MysqlColumnSpec",
  "MysqlCreateOperation",
  "MysqlEntityStorageHandle",
  "MysqlStorageConfigurationError",
  "MysqlStorageConnectionError",
  "MysqlStorageDataError",
  "MysqlStorageFactory",
  "MysqlStorageFactoryBuilder",
  "MysqlStorageOptions",
  "MysqlTenantStorageOptions",
  "MysqlStorageOperationError",
  "MysqlStorageSchemaError",
  "MysqlTableSpec",
];
const expectedTransportExports = [
  "ConsumerHandle",
  "ExternalMessageConsumer",
  "InMemoryTransportFactory",
  "MessageChannel",
  "Publisher",
  "Subscriber",
  "TransportFactory",
];
const expectedTestingExports = [
  "BlackBox",
  "BlackBoxClosedError",
  "BlackBoxOptions",
  "BlackBoxScope",
  "BlackBoxTimeoutError",
];
const expectedServerExports = [
  "Aggregate",
  "Apply",
  "Assign",
  "BaseHandlerMetadata",
  "BoundedContext",
  "BoundedContextBuilder",
  "BoundedContextName",
  "BoundedContextNameError",
  "BoundedContextSnapshot",
  "BrowserAdmission",
  "BrowserBackend",
  "BrowserServerCollaborators",
  "BrowserServerOptions",
  "BrowserAuthRoute",
  "CommandBus",
  "Command",
  "CommandEndpoint",
  "CommandDispatcher",
  "CommandAssignmentHandlerMetadata",
  "CommandRegistrationAssigneeMetadata",
  "CommandRegistrationReadiness",
  "CommandRegistrationReadinessLookup",
  "CommandReactionHandlerMetadata",
  "CommandRoute",
  "CommandRouting",
  "InterfaceRouteMessage",
  "CommandContextInput",
  "Clock",
  "ContextSpec",
  "ContextSpecSnapshot",
  "ReadCatchUpOptions",
  "ReadCatchUpResult",
  "AlreadyPickedUp",
  "Delivery",
  "DeliveryBuilder",
  "DeliveryInbox",
  "DeliveryWorkRegistry",
  "DeliveryWorkSession",
  "ExclusiveDeliveryWorkSession",
  "LeasedDeliveryWorkSession",
  "ManagedServerApplication",
  "ManagedServerApplicationHandle",
  "ManagedServerApplicationOptions",
  "ManagedServerRestartOptions",
  "DeliveryEndpointMessage",
  "DeliveryLabel",
  "DeliveryMonitor",
  "DeliveryResult",
  "DeliveryRunOptions",
  "DeliveryStage",
  "DeliveryStatistics",
  "DeliveryOperationOptions",
  "DeliveryShardUpdate",
  "DeliveryShutdownTimeoutError",
  "DeliverySource",
  "DeliveryStorageCorruptionError",
  "DeliveryStrategy",
  "DeliverySupervisor",
  "DeliverySupervisorCloseOptions",
  "DeliverySupervisorOptions",
  "DeliveryStatus",
  "FailedPickUp",
  "FailedReception",
  "PickUpAction",
  "ReceptionAction",
  "UniformAcrossAllShards",
  "DurableSubscriptionBindings",
  "DurableSubscriptionBindingsOptions",
  "DeclaredEntityVisibility",
  "DescriptorFieldMetadata",
  "DescriptorMessageSchema",
  "DescriptorMetadataErrorCode",
  "DescriptorMetadataError",
  "Entity",
  "EntityClass",
  "EntityFamily",
  "EntityHandlersMetadata",
  "EntityLifecycleFlags",
  "EntityOptions",
  "EntityVersionMetadata",
  "Environment",
  "EnvironmentType",
  "EventBus",
  "EventEndpoint",
  "EventDispatcher",
  "EventContextInput",
  "EventRoute",
  "EventRouting",
  "FixedClock",
  "Inbox",
  "InboxId",
  "InboxMessage",
  "InboxMessageError",
  "InboxMessageId",
  "InboxMessageInput",
  "InboxReadContinuation",
  "InboxReadOptions",
  "InboxStorage",
  "InboxStorageOptions",
  "InboxWriteResult",
  "isDurableSubscriptionBindings",
  "ListenerLifecycle",
  "MessageId",
  "PlainEntityVersionMetadata",
  "PrimitiveId",
  "ProcessManager",
  "Projection",
  "ConcreteRepositoryEntityType",
  "Repository",
  "RepositoryEntityType",
  "RepositoryIdentityError",
  "RepositoryIdentityErrorCode",
  "RepositoryIdentitySnapshot",
  "RepositoryOptions",
  "RepositoryCommandRoute",
  "RepositoryEventRoute",
  "RepositoryRouteInvocation",
  "RepositoryStateSchema",
  "RepositoryView",
  "RunningServer",
  "Server",
  "ServerEnvironment",
  "ServerEnvironmentCloseable",
  "ServerEnvironmentDelivery",
  "ServerEnvironmentSettings",
  "ServerOptions",
  "ServerRuntimeLifecycle",
  "ServerRuntimeRejectedState",
  "StateUpdateRoute",
  "StateUpdateRouting",
  "ThirdPartyContext",
  "ServerRuntimeState",
  "ServerRuntimeStateError",
  "RuntimeStateErrorCode",
  "ServerRuntimeStateOperation",
  "ServerRuntimeWork",
  "SingleProcessServerRuntime",
  "SpineServices",
  "SpineServicesOptions",
  "SignalIds",
  "SignalIntakeAccepted",
  "SignalIntakeAcceptedFor",
  "SignalIntakeFailure",
  "SignalIntakeFailureCode",
  "SignalIntakeFailureDetails",
  "SignalIntakeFailureDiagnostics",
  "SignalIntakeResult",
  "SignalKind",
  "SignalMetadata",
  "SignalMetadataOptions",
  "ShardIndex",
  "ShardSession",
  "ShardedWorkRegistry",
  "ShardedWorkRegistryOptions",
  "Stand",
  "InMemorySubscriptionRegistry",
  "StandActivateResult",
  "StandCleanupResult",
  "StandConflictError",
  "StandCreateResult",
  "StandDeleteResult",
  "StandSubscriptionEntry",
  "StandSubscriptionRegistry",
  "StorageSubscriptionRegistry",
  "StandOptions",
  "StandReadOptions",
  "StandReadResult",
  "StandRegisterOptions",
  "StandStateTypeError",
  "StandSubscribeOptions",
  "StandSubscription",
  "StandUpdate",
  "StandUpdateOptions",
  "DispatchErrorSnapshot",
  "StoredEventDispatchFailure",
  "EntityScopeReason",
  "TransactionalEntity",
  "TransactionalEntityScopeError",
  "TransactionalEntityScopeOperation",
  "TenantMode",
  "EntityTransaction",
  "EntityTransactionAcceptedCommit",
  "EntityTransactionCommitResult",
  "CommittedVersionMetadata",
  "DraftStateError",
  "DraftStateReason",
  "EntityTransactionLifecycleFlags",
  "EntityTransactionOperation",
  "EntityTransactionOptions",
  "EntityTransactionRejectedCommit",
  "EntityTransactionRollbackResult",
  "EntityTransactionStateError",
  "EntityTransactionStatus",
  "EntityTransactionMutator",
  "EntityTransactionVersionMetadata",
  "StateTransitionRequest",
  "StateTransitionResult",
  "FirstFieldRoutingHint",
  "GeneratedRegistryDiscovery",
  "GeneratedRegistryDiscoveryError",
  "GeneratedRegistryDiscoveryOptions",
  "GeneratedRepositoryOptions",
  "RegistryDiscoveryErrorCode",
  "ActorContextInput",
  "EntityKind",
  "EntityMetadata",
  "EntityVisibility",
  "EventApplicationHandlerMetadata",
  "EventApplicationOptions",
  "EventRegistrationApplicationMetadata",
  "EventRegistrationReadiness",
  "EventRegistrationReadinessLookup",
  "EventRegistrationReactorMetadata",
  "EventRegistrationSubscriberMetadata",
  "EventReactionHandlerMetadata",
  "EventSubscriptionHandlerMetadata",
  "External",
  "StateSubscriptionHandlerMetadata",
  "HandlerKind",
  "HandlerMetadata",
  "HandlerMetadataError",
  "HandlerMetadataErrorCode",
  "HandlerRegistryErrorCode",
  "HandlerMetadataRegistry",
  "HandlerMetadataRegistryError",
  "HandlerMetadataRegistryLookup",
  "HandlerMethodDecorator",
  "HandlerMethodName",
  "HandlerMethodValue",
  "HandlerOrigin",
  "HandlerParameterCount",
  "HandlerRegistryIngestionError",
  "HandlerRegistryIngestor",
  "HandlerRegistrationBuilder",
  "React",
  "RegisteredHandlerMetadata",
  "RegistryIngestionErrorCode",
  "Subscribe",
  "Where",
  "WhereOptions",
  "SpecScanner",
  "SystemClock",
  "acceptSignalIntake",
  "createEntityTransaction",
  "EntityHandlers",
  "failSignalIntake",
  "isEntitySchema",
  "describeEntityMetadata",
  "materializeDecoratedEntityHandlers",
  "validateEntityStateTransition",
];
const protoIndexPath = join("packages", "proto", "src", "index.ts");
const boundedContextProtoPath = join(
  "packages",
  "proto",
  "generated",
  "spine",
  "core",
  "bounded_context_pb.ts",
);
const brokerProtoPath = join(
  "packages",
  "proto",
  "generated",
  "spine",
  "server",
  "integration",
  "broker_pb.ts",
);
const transportProtoPath = join(
  "packages",
  "proto",
  "generated",
  "spine",
  "server",
  "transport",
  "transport_pb.ts",
);
const protoToolsIndexPath = join("packages", "proto-tools", "src", "index.ts");
const authIndexPath = join("packages", "auth", "src", "index.ts");
const clientIndexPath = join("packages", "client-node", "src", "index.ts");
const clientWebIndexPath = join("packages", "client-web", "src", "index.ts");
const clientReactIndexPath = join("packages", "client-react", "src", "index.ts");
const deliveryClientIndexPath = join("packages", "delivery-client", "src", "index.ts");
const deliveryServerIndexPath = join("packages", "delivery-server", "src", "index.ts");
const deploymentIndexPath = join("packages", "deployment", "src", "index.ts");
const deploymentGceIndexPath = join("packages", "deployment-gce", "src", "index.ts");
const deploymentGkeIndexPath = join("packages", "deployment-gke", "src", "index.ts");
const storageIndexPath = join("packages", "storage", "src", "index.ts");
const storageProviderPath = join("packages", "storage", "src", "provider.ts");
const datastoreStorageIndexPath = join("packages", "storage-datastore", "src", "index.ts");
const rdbmsStorageIndexPath = join("packages", "storage-rdbms", "src", "index.ts");
const serverIndexPath = join("packages", "server", "src", "index.ts");
const testingIndexPath = join("packages", "testing", "src", "index.ts");
const transportIndexPath = join("packages", "transport", "src", "index.ts");

const typedocExecutable = process.platform === "win32" ? "typedoc.cmd" : "typedoc";
const typedocBin = join("node_modules", ".bin", typedocExecutable);
const outputDir = mkdtempSync(join(tmpdir(), "spine-typedoc-json-"));
const jsonPath = join(outputDir, "api.json");

const typedocResult = spawnSync(typedocBin, ["--options", "typedoc.json", "--json", jsonPath], {
  stdio: "inherit",
});

if (typedocResult.error !== undefined) {
  console.error(`Failed to start TypeDoc JSON check: ${typedocResult.error.message}`);
  process.exit(1);
}

if (typedocResult.signal !== null) {
  console.error(`TypeDoc JSON check terminated by signal ${typedocResult.signal}.`);
  process.exit(1);
}

if (typedocResult.status !== 0) {
  process.exit(typedocResult.status ?? 1);
}

const apiDocs = JSON.parse(readFileSync(jsonPath, "utf8"));
const documentedNames = new Set();
const serverModuleNames = collectDirectModuleNames(apiDocs, "packages/server/src");
const authModuleNames = collectDirectModuleNames(apiDocs, "packages/auth/src");
const clientModuleNames = collectDirectModuleNames(apiDocs, "packages/client-node/src");
const clientWebModuleNames = collectDirectModuleNames(apiDocs, "packages/client-web/src");
const clientReactModuleNames = collectDirectModuleNames(apiDocs, "packages/client-react/src");
const deliveryClientModuleNames = collectDirectModuleNames(apiDocs, "packages/delivery-client/src");
const deliveryServerModuleNames = collectDirectModuleNames(apiDocs, "packages/delivery-server/src");
const deploymentModuleNames = collectDirectModuleNames(apiDocs, "packages/deployment/src");
const deploymentGceModuleNames = collectDirectModuleNames(apiDocs, "packages/deployment-gce/src");
const deploymentGkeModuleNames = collectDirectModuleNames(apiDocs, "packages/deployment-gke/src");
const storageModuleNames = collectDirectModuleNames(apiDocs, "packages/storage/src");
const storageProviderModuleNames = collectDirectModuleNames(
  apiDocs,
  "packages/storage/src/provider",
);
const datastoreStorageModuleNames = collectDirectModuleNames(
  apiDocs,
  "packages/storage-datastore/src",
);
const rdbmsStorageModuleNames = collectDirectModuleNames(apiDocs, "packages/storage-rdbms/src");
const testingModuleNames = collectDirectModuleNames(apiDocs, "packages/testing/src");
const transportModuleNames = collectDirectModuleNames(apiDocs, "packages/transport/src");

function collectNames(value) {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectNames(child);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (typeof value.name === "string") {
    documentedNames.add(value.name);

    const members =
      Array.isArray(value.children) && value.children.length > 0
        ? value.children
        : value.type?.type === "reflection" && Array.isArray(value.type.declaration?.children)
          ? value.type.declaration.children
          : value.type?.type === "reference" &&
              value.type.name === "Readonly" &&
              value.type.typeArguments?.length === 1 &&
              value.type.typeArguments[0]?.type === "reflection" &&
              Array.isArray(value.type.typeArguments[0].declaration?.children)
            ? value.type.typeArguments[0].declaration.children
            : [];

    for (const member of members) {
      if (typeof member.name === "string") {
        documentedNames.add(`${value.name}.${member.name}`);
      }
    }
  }

  for (const child of Object.values(value)) {
    collectNames(child);
  }
}

collectNames(apiDocs);

function collectDirectModuleNames(value, moduleName) {
  const module = findNamedChild(value, moduleName);
  if (module === undefined || !Array.isArray(module.children)) {
    return new Set();
  }
  return new Set(
    module.children.map((child) => child.name).filter((name) => typeof name === "string"),
  );
}

function findNamedChild(value, name) {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (value.name === name) {
    return value;
  }
  if (!Array.isArray(value.children)) {
    return undefined;
  }
  for (const child of value.children) {
    const match = findNamedChild(child, name);
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
}

const forbiddenPublicMembers = [
  {
    owner: "BoundedContext",
    member: "constructor",
    reason: "public constructor",
    matches: (value) => value.flags?.isProtected !== true && value.flags?.isPrivate !== true,
  },
  {
    owner: "BoundedContextBuilder",
    member: "constructor",
    reason: "public constructor",
    matches: (value) => value.flags?.isProtected !== true && value.flags?.isPrivate !== true,
  },
  {
    owner: "ContextSpec",
    member: "constructor",
    reason: "public constructor",
    matches: (value) => value.flags?.isProtected !== true && value.flags?.isPrivate !== true,
  },
  {
    owner: "BoundedContext",
    member: "fromSpecSnapshot",
    reason: "removed factory",
    matches: (value) => Array.isArray(value.signatures),
  },
  {
    owner: "BoundedContextBuilder",
    member: "rename",
    reason: "removed builder method",
    matches: (value) => Array.isArray(value.signatures),
  },
  {
    owner: "ContextSpec",
    member: "singleTenant",
    reason: "removed factory",
    matches: (value) => value.flags?.isStatic === true && Array.isArray(value.signatures),
  },
  {
    owner: "ContextSpec",
    member: "multitenant",
    reason: "removed factory",
    matches: (value) => value.flags?.isStatic === true && Array.isArray(value.signatures),
  },
  {
    owner: "Repository",
    member: "hasInstance",
    reason: "repository brand authority is framework-internal",
    matches: (value) => value.flags?.isStatic === true && Array.isArray(value.signatures),
  },
  {
    owner: "Repository",
    member: "snapshotOf",
    reason: "repository snapshot authority is framework-internal",
    matches: (value) => value.flags?.isStatic === true && Array.isArray(value.signatures),
  },
  {
    owner: "Repository",
    member: "isRegistered",
    reason: "registration state is context-owned",
    matches: (value) => Array.isArray(value.signatures),
  },
  {
    owner: "Repository",
    member: "registeredContextName",
    reason: "registration state is context-owned",
    matches: () => true,
  },
  {
    owner: "Repository",
    member: "registerWith",
    reason: "registration is context-owned",
    matches: (value) => Array.isArray(value.signatures),
  },
  {
    owner: "Repository",
    member: "prepareRegistration",
    reason: "repository preparation is context-owned",
    matches: (value) => Array.isArray(value.signatures),
  },
  {
    owner: undefined,
    member: "isRepositoryInstance",
    reason: "repository brand helper is not public API",
    matches: (value) => Array.isArray(value.signatures),
  },
  {
    owner: undefined,
    member: "BoundedContextRegistration",
    reason: "bounded-context registration details are not public API",
    matches: (value) => typeof value.kind === "number",
  },
  {
    owner: undefined,
    member: "RepositoryAccess",
    reason: "repository authority is framework-internal",
    matches: (value) => typeof value.kind === "number",
  },
  {
    owner: undefined,
    member: "repositoryAccess",
    reason: "repository authority is framework-internal",
    matches: (value) => typeof value.kind === "number" || Array.isArray(value.signatures),
  },
  {
    owner: undefined,
    member: "prepareRepository",
    reason: "repository preparation helper is not public API",
    matches: (value) => Array.isArray(value.signatures),
  },
  {
    owner: undefined,
    member: "RepositoryPreparationToken",
    reason: "repository preparation token is not public API",
    matches: (value) => typeof value.kind === "number",
  },
  {
    owner: undefined,
    member: "repositoryRegistrationAccess",
    reason: "repository registration access is not public API",
    matches: (value) => typeof value.kind === "number" || Array.isArray(value.signatures),
  },
  {
    owner: undefined,
    member: "RepositoryRegistrationAccess",
    reason: "repository registration access is not public API",
    matches: (value) => typeof value.kind === "number",
  },
  {
    owner: undefined,
    member: "PreparedRepository",
    reason: "repository preparation details are not public API",
    matches: (value) => typeof value.kind === "number",
  },
  {
    owner: "SingleProcessServerRuntime",
    member: "enqueueFollowUp",
    reason: "follow-up scheduling authority is framework-internal",
    matches: (value) => Array.isArray(value.signatures),
  },
  ...[
    "GeneratedEntityHandlerGroup",
    "GeneratedEntityHandlers",
    "GeneratedHandlerKind",
    "GeneratedHandlerParameterCount",
    "GeneratedHandlerRecordInput",
    "GeneratedHandlerRecord",
    "GeneratedHandlerRegistry",
  ].map((member) => ({
    owner: undefined,
    member,
    reason: "generated registry contracts are internal tooling API",
    matches: (value) => typeof value.kind === "number",
  })),
];

function collectForbiddenMembers(value, ownerName, matches) {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectForbiddenMembers(child, ownerName, matches);
    }
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  const nextOwnerName =
    typeof value.kind === "number" &&
    typeof value.name === "string" &&
    [
      "BoundedContext",
      "BoundedContextBuilder",
      "ContextSpec",
      "Repository",
      "SingleProcessServerRuntime",
    ].includes(value.name)
      ? value.name
      : ownerName;

  if (typeof value.name === "string") {
    for (const forbidden of forbiddenPublicMembers) {
      if (
        (forbidden.owner === undefined || forbidden.owner === nextOwnerName) &&
        forbidden.member === value.name &&
        forbidden.matches(value)
      ) {
        const label =
          forbidden.owner === undefined
            ? forbidden.member
            : `${forbidden.owner}.${forbidden.member}`;
        matches.push(`${label} (${forbidden.reason})`);
      }
    }
  }

  for (const child of Object.values(value)) {
    collectForbiddenMembers(child, nextOwnerName, matches);
  }
}

const forbiddenMatches = [];
collectForbiddenMembers(apiDocs, undefined, forbiddenMatches);

const missingCoreExports = expectedCoreExports.filter((name) => !documentedNames.has(name));
const forbiddenTypeDocNames = [
  "BuiltInEntityConstructor",
  "BuiltInEntityConstructorBase",
  "EntityConstructor",
  "EntityStaticMarkerBase",
  "EntityStaticMarkerBaseClass",
  "HasErasedRepositoryConstructorParameters",
  "RepositoryEntityTypeCarriesConcreteConstructorParameters",
  "RepositoryEntityTypeConstraint",
  "SingleConcreteRepositoryEntityType",
  "RepositorySchemaForInstance",
  "RepositoryConcreteEntityTypeConstraint",
  "RepositorySchemaFromEntityInstance",
  "repositoryEntityTypeConstraint",
  "spineTsEntityConstructor",
  "__repositoryEntityTypeMustBeASingleConcreteConstructor",
  "__repositoryEntityTypeMustCarryConcreteStateSchema",
  "__spineTsBuiltInEntityConstructor",
  "__spineTsEntityConstructorBrand",
  "EntityConstructorBrand",
  "onBackgroundFailure",
];
const forbiddenTypeDocNamePatterns = [
  /\bEntity\w*Marker\w*\b/u,
  /\b\w*EntityConstructor\w*Brand\w*\b/u,
  /\bspineTs\w*\b/u,
];
const forbiddenStorageTypeDocNames = [
  "RecordIdSchema",
  "RecordMaskApi",
  "RecordQueryApi",
  "RecordSpecInput",
  "StorageObject",
  "createEventStore",
];
const declaredServerExports = collectNamedExports(serverIndexPath);
const declaredAuthExports = collectNamedExports(authIndexPath);
const declaredProtoToolsExports = collectNamedExports(protoToolsIndexPath);
const declaredClientExports = collectNamedExports(clientIndexPath);
const declaredClientWebExports = collectNamedExports(clientWebIndexPath);
const declaredDeliveryClientExports = collectNamedExports(deliveryClientIndexPath);
const declaredDeliveryServerExports = collectNamedExports(deliveryServerIndexPath);
const declaredDeploymentExports = collectNamedExports(deploymentIndexPath);
const declaredDeploymentGceExports = collectNamedExports(deploymentGceIndexPath);
const declaredDeploymentGkeExports = collectNamedExports(deploymentGkeIndexPath);
const declaredStorageExports = collectNamedExports(storageIndexPath);
const declaredStorageProviderExports = collectModuleExports(storageProviderPath);
const declaredDatastoreStorageExports = collectNamedExports(datastoreStorageIndexPath);
const declaredRdbmsStorageExports = collectNamedExports(rdbmsStorageIndexPath);
const declaredTestingExports = collectNamedExports(testingIndexPath);
const declaredTransportExports = collectNamedExports(transportIndexPath);
const declaredIntegrationProtoExports = new Set([
  ...collectNamedExports(boundedContextProtoPath),
  ...collectNamedExports(brokerProtoPath),
  ...collectNamedExports(transportProtoPath),
]);
const missingIntegrationProtoExports = expectedIntegrationProtoExports.filter(
  (name) => !declaredIntegrationProtoExports.has(name),
);
const unexpectedIntegrationProtoExports = [...declaredIntegrationProtoExports].filter(
  (name) => !expectedIntegrationProtoExports.includes(name),
);
const missingTransportExports = expectedTransportExports.filter(
  (name) => !transportModuleNames.has(name),
);
const missingDeclaredTransportExports = expectedTransportExports.filter(
  (name) => !declaredTransportExports.includes(name),
);
const unexpectedTransportExports = declaredTransportExports.filter(
  (name) => !expectedTransportExports.includes(name),
);
const missingServerExports = expectedServerExports.filter((name) => !serverModuleNames.has(name));
const missingAuthExports = expectedAuthExports.filter((name) => !authModuleNames.has(name));
const missingDeclaredAuthExports = expectedAuthExports.filter(
  (name) => !declaredAuthExports.includes(name),
);
const unexpectedAuthExports = declaredAuthExports.filter(
  (name) => !expectedAuthExports.includes(name),
);
const missingDeclaredProtoToolsExports = expectedProtoToolsExports.filter(
  (name) => !declaredProtoToolsExports.includes(name),
);
const unexpectedProtoToolsExports = declaredProtoToolsExports.filter(
  (name) => !expectedProtoToolsExports.includes(name),
);
const missingClientExports = expectedClientExports.filter((name) => !clientModuleNames.has(name));
const missingClientWebExports = expectedClientWebExports.filter(
  (name) => !clientWebModuleNames.has(name),
);
const declaredClientReactExports = collectNamedExports(clientReactIndexPath);
const missingClientReactExports = expectedClientReactExports.filter(
  (name) => !clientReactModuleNames.has(name),
);
const missingDeclaredClientReactExports = expectedClientReactExports.filter(
  (name) => !declaredClientReactExports.includes(name),
);
const unexpectedClientReactExports = declaredClientReactExports.filter(
  (name) => !expectedClientReactExports.includes(name),
);
const missingDeclaredClientWebExports = expectedClientWebExports.filter(
  (name) => !declaredClientWebExports.includes(name),
);
const unexpectedClientWebExports = declaredClientWebExports.filter(
  (name) => !expectedClientWebExports.includes(name),
);
const missingDeclaredClientExports = expectedClientExports.filter(
  (name) => !declaredClientExports.includes(name),
);
const unexpectedClientExports = declaredClientExports.filter(
  (name) => !expectedClientExports.includes(name),
);
const missingDeliveryClientExports = expectedDeliveryClientExports.filter(
  (name) => !deliveryClientModuleNames.has(name),
);
const missingDeclaredDeliveryClientExports = expectedDeliveryClientExports.filter(
  (name) => !declaredDeliveryClientExports.includes(name),
);
const unexpectedDeliveryClientExports = declaredDeliveryClientExports.filter(
  (name) => !expectedDeliveryClientExports.includes(name),
);
const missingDeliveryServerExports = expectedDeliveryServerExports.filter(
  (name) => !deliveryServerModuleNames.has(name),
);
const missingDeclaredDeliveryServerExports = expectedDeliveryServerExports.filter(
  (name) => !declaredDeliveryServerExports.includes(name),
);
const unexpectedDeliveryServerExports = declaredDeliveryServerExports.filter(
  (name) => !expectedDeliveryServerExports.includes(name),
);
const missingDeploymentExports = expectedDeploymentExports.filter(
  (name) => !deploymentModuleNames.has(name),
);
const missingDeclaredDeploymentExports = expectedDeploymentExports.filter(
  (name) => !declaredDeploymentExports.includes(name),
);
const unexpectedDeploymentExports = declaredDeploymentExports.filter(
  (name) => !expectedDeploymentExports.includes(name),
);
const missingDeploymentGceExports = expectedDeploymentGceExports.filter(
  (name) => !deploymentGceModuleNames.has(name),
);
const missingDeclaredDeploymentGceExports = expectedDeploymentGceExports.filter(
  (name) => !declaredDeploymentGceExports.includes(name),
);
const unexpectedDeploymentGceExports = declaredDeploymentGceExports.filter(
  (name) => !expectedDeploymentGceExports.includes(name),
);
const missingDeploymentGkeExports = expectedDeploymentGkeExports.filter(
  (name) => !deploymentGkeModuleNames.has(name),
);
const missingDeclaredDeploymentGkeExports = expectedDeploymentGkeExports.filter(
  (name) => !declaredDeploymentGkeExports.includes(name),
);
const unexpectedDeploymentGkeExports = declaredDeploymentGkeExports.filter(
  (name) => !expectedDeploymentGkeExports.includes(name),
);
const missingDeclaredServerExports = expectedServerExports.filter(
  (name) => !declaredServerExports.includes(name),
);
const missingStorageExports = expectedStorageExports.filter(
  (name) => !storageModuleNames.has(name),
);
const missingDeclaredStorageExports = expectedStorageExports.filter(
  (name) => !declaredStorageExports.includes(name),
);
const missingStorageProviderExports = expectedStorageProviderDocumentedExports.filter(
  (name) => !storageProviderModuleNames.has(name),
);
const missingDeclaredStorageProviderExports = expectedStorageProviderDeclaredExports.filter(
  (name) => !declaredStorageProviderExports.includes(name),
);
const unexpectedServerExports = declaredServerExports.filter(
  (name) => !expectedServerExports.includes(name),
);
const forbiddenServerExports = [
  "DeliveryControlledRun",
  "DeliveryRunControl",
  "DeliveryRunPort",
  "DeliveryScheduler",
];
const forbiddenDeclaredServerExports = forbiddenServerExports.filter((name) =>
  declaredServerExports.includes(name),
);
const forbiddenDocumentedServerExports = forbiddenServerExports.filter((name) =>
  serverModuleNames.has(name),
);
const unexpectedStorageExports = declaredStorageExports.filter(
  (name) => !expectedStorageExports.includes(name),
);
const unexpectedStorageProviderExports = declaredStorageProviderExports.filter(
  (name) => !expectedStorageProviderDeclaredExports.includes(name),
);
const unexpectedDocumentedStorageProviderExports = [...storageProviderModuleNames].filter(
  (name) => !expectedStorageProviderDocumentedExports.includes(name),
);
const providerOnlyStorageContracts = ["TenantBoundary", "TenantCatalog", "TenantCatalogProvider"];
const leakedStorageRootContracts = providerOnlyStorageContracts.filter(
  (name) => storageModuleNames.has(name) || declaredStorageExports.includes(name),
);
const missingDatastoreStorageExports = expectedDatastoreStorageExports.filter(
  (name) => !datastoreStorageModuleNames.has(name),
);
const missingDeclaredDatastoreStorageExports = expectedDatastoreStorageExports.filter(
  (name) => !declaredDatastoreStorageExports.includes(name),
);
const unexpectedDatastoreStorageExports = declaredDatastoreStorageExports.filter(
  (name) => !expectedDatastoreStorageExports.includes(name),
);
const missingRdbmsStorageExports = expectedRdbmsStorageExports.filter(
  (name) => !rdbmsStorageModuleNames.has(name),
);
const missingDeclaredRdbmsStorageExports = expectedRdbmsStorageExports.filter(
  (name) => !declaredRdbmsStorageExports.includes(name),
);
const unexpectedRdbmsStorageExports = declaredRdbmsStorageExports.filter(
  (name) => !expectedRdbmsStorageExports.includes(name),
);
const missingTestingExports = expectedTestingExports.filter(
  (name) => !testingModuleNames.has(name),
);
const missingDeclaredTestingExports = expectedTestingExports.filter(
  (name) => !declaredTestingExports.includes(name),
);
const unexpectedTestingExports = declaredTestingExports.filter(
  (name) => !expectedTestingExports.includes(name),
);

const missingExports = expectedProtoExports.filter((name) => !documentedNames.has(name));

if (missingExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/proto exports: ${missingExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingIntegrationProtoExports.length > 0) {
  console.error(
    "Generated integration Proto modules are missing expected root exports: " +
      missingIntegrationProtoExports.join(", "),
  );
  process.exit(1);
}

if (unexpectedIntegrationProtoExports.length > 0) {
  console.error(
    "Generated integration Proto module exports changed without updating docs expectations: " +
      unexpectedIntegrationProtoExports.join(", "),
  );
  process.exit(1);
}

if (missingDeclaredProtoToolsExports.length > 0 || unexpectedProtoToolsExports.length > 0) {
  console.error(
    "@spine-event-engine/proto-tools exports changed without updating docs expectations: " +
      [...missingDeclaredProtoToolsExports, ...unexpectedProtoToolsExports].join(", "),
  );
  process.exit(1);
}

if (missingAuthExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/auth exports: ${missingAuthExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredAuthExports.length > 0 || unexpectedAuthExports.length > 0) {
  console.error(
    "@spine-event-engine/auth root export inventory mismatch: " +
      [...missingDeclaredAuthExports, ...unexpectedAuthExports].join(", "),
  );
  process.exit(1);
}

if (missingCoreExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/core exports: ${missingCoreExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingClientExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/client-node exports: ${missingClientExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingClientWebExports.length > 0 || missingDeclaredClientWebExports.length > 0) {
  console.error(
    "@spine-event-engine/client-web is missing expected exports: " +
      [...missingClientWebExports, ...missingDeclaredClientWebExports].join(", "),
  );
  process.exit(1);
}

if (unexpectedClientWebExports.length > 0) {
  console.error(
    "@spine-event-engine/client-web exports changed without updating docs expectations: " +
      unexpectedClientWebExports.join(", "),
  );
  process.exit(1);
}

if (missingClientReactExports.length > 0 || missingDeclaredClientReactExports.length > 0) {
  console.error(
    "@spine-event-engine/client-react is missing expected exports: " +
      [...missingClientReactExports, ...missingDeclaredClientReactExports].join(", "),
  );
  process.exit(1);
}

if (unexpectedClientReactExports.length > 0) {
  console.error(
    "@spine-event-engine/client-react exports changed without updating docs expectations: " +
      unexpectedClientReactExports.join(", "),
  );
  process.exit(1);
}

if (missingDeclaredClientExports.length > 0) {
  console.error(
    `@spine-event-engine/client-node root is missing expected exports: ${missingDeclaredClientExports.join(", ")}`,
  );
  process.exit(1);
}

if (unexpectedClientExports.length > 0) {
  console.error(
    "@spine-event-engine/client-node root exports changed without updating docs expectations: " +
      unexpectedClientExports.join(", "),
  );
  process.exit(1);
}

if (missingDeliveryClientExports.length > 0 || missingDeclaredDeliveryClientExports.length > 0) {
  console.error(
    "@spine-event-engine/delivery-client is missing expected exports: " +
      [...missingDeliveryClientExports, ...missingDeclaredDeliveryClientExports].join(", "),
  );
  process.exit(1);
}

if (unexpectedDeliveryClientExports.length > 0) {
  console.error(
    "@spine-event-engine/delivery-client exports changed without updating docs expectations: " +
      unexpectedDeliveryClientExports.join(", "),
  );
  process.exit(1);
}
if (missingDeliveryServerExports.length > 0 || missingDeclaredDeliveryServerExports.length > 0) {
  console.error(
    "@spine-event-engine/delivery-server is missing expected exports: " +
      [...missingDeliveryServerExports, ...missingDeclaredDeliveryServerExports].join(", "),
  );
  process.exit(1);
}
if (unexpectedDeliveryServerExports.length > 0) {
  console.error(
    "@spine-event-engine/delivery-server exports changed without updating docs expectations: " +
      unexpectedDeliveryServerExports.join(", "),
  );
  process.exit(1);
}

if (missingDeploymentExports.length > 0 || missingDeclaredDeploymentExports.length > 0) {
  console.error(
    "@spine-event-engine/deployment is missing expected exports: " +
      [...missingDeploymentExports, ...missingDeclaredDeploymentExports].join(", "),
  );
  process.exit(1);
}

if (unexpectedDeploymentExports.length > 0) {
  console.error(
    "@spine-event-engine/deployment root exports changed without updating docs expectations: " +
      unexpectedDeploymentExports.join(", "),
  );
  process.exit(1);
}

if (missingDeploymentGceExports.length > 0 || missingDeclaredDeploymentGceExports.length > 0) {
  console.error(
    "@spine-event-engine/deployment-gce is missing expected exports: " +
      [...missingDeploymentGceExports, ...missingDeclaredDeploymentGceExports].join(", "),
  );
  process.exit(1);
}

if (unexpectedDeploymentGceExports.length > 0) {
  console.error(
    "@spine-event-engine/deployment-gce root exports changed without updating docs expectations: " +
      unexpectedDeploymentGceExports.join(", "),
  );
  process.exit(1);
}

if (missingDeploymentGkeExports.length > 0 || missingDeclaredDeploymentGkeExports.length > 0) {
  console.error(
    "@spine-event-engine/deployment-gke is missing expected exports: " +
      [...missingDeploymentGkeExports, ...missingDeclaredDeploymentGkeExports].join(", "),
  );
  process.exit(1);
}

if (unexpectedDeploymentGkeExports.length > 0) {
  console.error(
    "@spine-event-engine/deployment-gke root exports changed without updating docs expectations: " +
      unexpectedDeploymentGkeExports.join(", "),
  );
  process.exit(1);
}

if (missingServerExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/server exports: ${missingServerExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredServerExports.length > 0) {
  console.error(
    `@spine-event-engine/server root is missing expected exports: ${missingDeclaredServerExports.join(", ")}`,
  );
  process.exit(1);
}

if (unexpectedServerExports.length > 0) {
  console.error(
    "@spine-event-engine/server root exports changed without updating docs expectations: " +
      unexpectedServerExports.join(", "),
  );
  process.exit(1);
}

if (forbiddenDeclaredServerExports.length > 0 || forbiddenDocumentedServerExports.length > 0) {
  console.error(
    "@spine-event-engine/server must not expose internal scheduler/run-control API: " +
      [...forbiddenDeclaredServerExports, ...forbiddenDocumentedServerExports].join(", "),
  );
  process.exit(1);
}

if (missingStorageExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/storage exports: ${missingStorageExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredStorageExports.length > 0) {
  console.error(
    `@spine-event-engine/storage root is missing expected exports: ${missingDeclaredStorageExports.join(
      ", ",
    )}`,
  );
  process.exit(1);
}

if (unexpectedStorageExports.length > 0) {
  console.error(
    "@spine-event-engine/storage root exports changed without updating docs expectations: " +
      unexpectedStorageExports.join(", "),
  );
  process.exit(1);
}

if (missingStorageProviderExports.length > 0) {
  console.error(
    "TypeDoc JSON is missing expected @spine-event-engine/storage/provider exports: " +
      missingStorageProviderExports.join(", "),
  );
  process.exit(1);
}

if (missingDeclaredStorageProviderExports.length > 0) {
  console.error(
    "@spine-event-engine/storage/provider is missing expected exports: " +
      missingDeclaredStorageProviderExports.join(", "),
  );
  process.exit(1);
}

if (unexpectedStorageProviderExports.length > 0) {
  console.error(
    "@spine-event-engine/storage/provider exports changed without updating docs expectations: " +
      unexpectedStorageProviderExports.join(", "),
  );
  process.exit(1);
}

if (unexpectedDocumentedStorageProviderExports.length > 0) {
  console.error(
    "TypeDoc JSON has unexpected @spine-event-engine/storage/provider exports: " +
      unexpectedDocumentedStorageProviderExports.join(", "),
  );
  process.exit(1);
}

if (leakedStorageRootContracts.length > 0) {
  console.error(
    "@spine-event-engine/storage must expose tenant contracts only from ./provider: " +
      leakedStorageRootContracts.join(", "),
  );
  process.exit(1);
}

if (missingDatastoreStorageExports.length > 0) {
  console.error(
    "TypeDoc JSON is missing expected @spine-event-engine/storage-datastore exports: " +
      missingDatastoreStorageExports.join(", "),
  );
  process.exit(1);
}

if (missingDeclaredDatastoreStorageExports.length > 0) {
  console.error(
    "@spine-event-engine/storage-datastore root is missing expected exports: " +
      missingDeclaredDatastoreStorageExports.join(", "),
  );
  process.exit(1);
}

if (unexpectedDatastoreStorageExports.length > 0) {
  console.error(
    "@spine-event-engine/storage-datastore root exports changed without updating docs expectations: " +
      unexpectedDatastoreStorageExports.join(", "),
  );
  process.exit(1);
}

if (missingRdbmsStorageExports.length > 0) {
  console.error(
    "TypeDoc JSON is missing expected @spine-event-engine/storage-rdbms exports: " +
      missingRdbmsStorageExports.join(", "),
  );
  process.exit(1);
}

if (missingDeclaredRdbmsStorageExports.length > 0) {
  console.error(
    "@spine-event-engine/storage-rdbms root is missing expected exports: " +
      missingDeclaredRdbmsStorageExports.join(", "),
  );
  process.exit(1);
}

if (unexpectedRdbmsStorageExports.length > 0) {
  console.error(
    "@spine-event-engine/storage-rdbms root exports changed without updating docs expectations: " +
      unexpectedRdbmsStorageExports.join(", "),
  );
  process.exit(1);
}

if (missingTransportExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/transport exports: ${missingTransportExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredTransportExports.length > 0) {
  console.error(
    "@spine-event-engine/transport root is missing expected exports: " +
      missingDeclaredTransportExports.join(", "),
  );
  process.exit(1);
}

if (unexpectedTransportExports.length > 0) {
  console.error(
    "@spine-event-engine/transport root exports changed without updating docs expectations: " +
      unexpectedTransportExports.join(", "),
  );
  process.exit(1);
}

if (missingTestingExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/testing exports: ${missingTestingExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredTestingExports.length > 0) {
  console.error(
    `@spine-event-engine/testing root is missing expected exports: ${missingDeclaredTestingExports.join(
      ", ",
    )}`,
  );
  process.exit(1);
}

if (unexpectedTestingExports.length > 0) {
  console.error(
    "@spine-event-engine/testing root exports changed without updating docs expectations: " +
      unexpectedTestingExports.join(", "),
  );
  process.exit(1);
}

if (forbiddenMatches.length > 0) {
  console.error(
    `TypeDoc JSON exposes removed or non-public @spine-event-engine/server API surface: ${[
      ...new Set(forbiddenMatches),
    ].join(", ")}`,
  );
  process.exit(1);
}

const apiDocsText = JSON.stringify(apiDocs);
const forbiddenStorageTypeDocNameMatches = forbiddenStorageTypeDocNames.filter((name) =>
  apiDocsText.includes(name),
);
const forbiddenTypeDocNameMatches = forbiddenTypeDocNames.filter((name) =>
  apiDocsText.includes(name),
);
const forbiddenTypeDocPatternMatches = forbiddenTypeDocNamePatterns
  .filter((pattern) => pattern.test(apiDocsText))
  .map((pattern) => pattern.toString());

if (forbiddenStorageTypeDocNameMatches.length > 0) {
  console.error(
    `TypeDoc JSON exposes internal or removed @spine-event-engine/storage symbols: ${[
      ...new Set(forbiddenStorageTypeDocNameMatches),
    ].join(", ")}`,
  );
  process.exit(1);
}

if (forbiddenTypeDocNameMatches.length > 0 || forbiddenTypeDocPatternMatches.length > 0) {
  console.error(
    `TypeDoc JSON exposes internal @spine-event-engine/server repository type machinery: ${[
      ...forbiddenTypeDocNameMatches,
      ...forbiddenTypeDocPatternMatches,
    ].join(", ")}`,
  );
  process.exit(1);
}

const protoIndexSource = readFileSync(protoIndexPath, "utf8");
const requiredIntegrationProtoReexports = [
  "../generated/spine/core/bounded_context_pb.js",
  "../generated/spine/server/integration/broker_pb.js",
  "../generated/spine/server/transport/transport_pb.js",
];

for (const modulePath of requiredIntegrationProtoReexports) {
  if (!protoIndexSource.includes(`export * from "${modulePath}";`)) {
    console.error(`@spine-event-engine/proto root is missing exact re-export ${modulePath}.`);
    process.exit(1);
  }
}

if (/export\s+\*\s+from\s+["']\.\/generated\//.test(protoIndexSource)) {
  console.error(
    "@spine-event-engine/proto root must not use broad generated re-exports; expose curated aliases instead.",
  );
  process.exit(1);
}

console.log(
  [
    `TypeDoc JSON includes ${expectedProtoExports.length} expected @spine-event-engine/proto exports`,
    `${expectedIntegrationProtoExports.length} exact generated integration Proto exports`,
    `${expectedAuthExports.length} expected @spine-event-engine/auth exports`,
    `${expectedCoreExports.length} expected @spine-event-engine/core exports`,
    `${expectedClientExports.length} expected @spine-event-engine/client-node exports`,
    `${expectedClientWebExports.length} expected @spine-event-engine/client-web exports`,
    `${expectedClientReactExports.length} expected @spine-event-engine/client-react exports`,
    `${expectedDeliveryClientExports.length} expected @spine-event-engine/delivery-client exports`,
    `${expectedDeliveryServerExports.length} expected @spine-event-engine/delivery-server exports`,
    `${expectedDeploymentExports.length} expected @spine-event-engine/deployment exports`,
    `${expectedDeploymentGceExports.length} expected @spine-event-engine/deployment-gce exports`,
    `${expectedDeploymentGkeExports.length} expected @spine-event-engine/deployment-gke exports`,
    `${expectedServerExports.length} expected @spine-event-engine/server exports`,
    `${expectedStorageExports.length} expected @spine-event-engine/storage exports`,
    `${expectedStorageProviderDocumentedExports.length} documented and ${expectedStorageProviderDeclaredExports.length} declared @spine-event-engine/storage/provider exports`,
    `${expectedTransportExports.length} expected @spine-event-engine/transport exports`,
    `${expectedTestingExports.length} expected @spine-event-engine/testing exports.`,
  ].join(", "),
);

function collectNamedExports(indexPath) {
  const source = createSourceFile(
    indexPath,
    readFileSync(indexPath, "utf8"),
    ScriptTarget.Latest,
    true,
  );
  const names = new Set();

  for (const statement of source.statements) {
    if (statement.kind === SyntaxKind.ExportDeclaration) {
      const exportClause = statement.exportClause;

      if (exportClause === undefined || exportClause.kind !== SyntaxKind.NamedExports) {
        continue;
      }

      for (const element of exportClause.elements) {
        names.add(element.name.text);
      }
      continue;
    }

    if (hasExportModifier(statement) && statement.name?.kind === SyntaxKind.Identifier) {
      names.add(statement.name.text);
      continue;
    }

    if (hasExportModifier(statement) && statement.kind === SyntaxKind.VariableStatement) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.name.kind === SyntaxKind.Identifier) {
          names.add(declaration.name.text);
        }
      }
    }
  }

  return [...names].sort();
}

function collectModuleExports(modulePath) {
  const program = createProgram([modulePath], {
    module: ModuleKind.NodeNext,
    moduleResolution: ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ScriptTarget.ESNext,
  });
  const source = program.getSourceFile(modulePath);
  const symbol =
    source === undefined ? undefined : program.getTypeChecker().getSymbolAtLocation(source);

  return symbol === undefined
    ? []
    : program
        .getTypeChecker()
        .getExportsOfModule(symbol)
        .map((value) => value.getName())
        .sort();
}

function hasExportModifier(statement) {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false
  );
}
