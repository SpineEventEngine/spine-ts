import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createSourceFile, ScriptTarget, SyntaxKind } from "typescript";

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
  "file_spine_base_field_path",
  "file_spine_core_actor_context",
  "file_spine_core_command",
  "file_spine_core_diagnostics",
  "file_spine_core_enrichment",
  "file_spine_core_event",
  "file_spine_core_tenant_id",
  "file_spine_core_user_id",
  "file_spine_core_version",
  "file_spine_net_email_address",
  "file_spine_net_internet_domain",
  "file_spine_string_template_string",
  "file_spine_time_time",
  "file_spine_ui_language",
  "file_spine_validation_validation_error",
  "set_once",
  "type_url_prefix",
  "FieldPathSchema",
  "TemplateStringSchema",
  "ValidationErrorSchema",
  "ConstraintViolationSchema",
];
const expectedCoreExports = [
  "DEFAULT_TYPE_URL_PREFIX",
  "TypeRegistry",
  "TypeRegistryLookup",
  "createSpineCoreRegistry",
  "deriveTypeUrl",
  "getTypeUrlPrefix",
  "spineCoreRegistry",
  "FileOptionExtension",
  "MessageSchema",
  "RegisterTypeOptions",
  "TypeMetadata",
  "DeriveTypeUrlOptions",
  "MessageValidationResult",
  "RejectionThrowable",
  "ValidationException",
  "createRejectionThrowable",
  "isRejectionThrowable",
  "validateMessage",
  "checkValid",
  "createValidationError",
  "TransitionValidationRequest",
  "TransitionValidationRule",
  "TransitionValidationResult",
  "validateTransition",
  "PackAnyOptions",
  "PackCommandInput",
  "PackEventInput",
  "packAny",
  "unpackAny",
  "packCommand",
  "packEvent",
];
const expectedClientExports = [
  "Client",
  "ClientOperationOptions",
  "ClientOptions",
  "ClientObserveOptions",
  "ClientOutcome",
  "ClientPostOptions",
  "ClientProtocolError",
  "ClientQueryOutcome",
  "ClientRequest",
  "CommandEvent",
  "CommandEvents",
  "EventSubscription",
  "ObservedClientOutcome",
  "ProjectionColumn",
  "ProjectionColumnDefinition",
  "ProjectionColumnDefinitionEntry",
  "ProjectionColumnOperator",
  "ProjectionColumnValue",
  "ProjectionColumnValueKind",
  "ProjectionColumns",
  "ProjectionComparison",
  "ProjectionComparisonPredicate",
  "ProjectionEqualityOperator",
  "ProjectionGroup",
  "ProjectionOrderingOperator",
  "ProjectionPredicate",
  "ProjectionQuery",
  "ProjectionQueryBuilder",
  "QueryState",
  "StateSubscription",
  "StateSubscriptionOptions",
  "StateSubscriptionUpdate",
  "SubscriptionEvent",
  "all",
  "either",
  "eq",
  "ge",
  "gt",
  "le",
  "lt",
];
const expectedDeliveryClientExports = [
  "DeliveryClient",
  "DeliveryClientOptions",
  "DeliveryFindOneOptions",
  "DeliveryMutationOptions",
  "DeliveryOutcomeUnknownError",
  "DeliveryPagingError",
  "DeliveryProtocolError",
  "DeliveryQuarantineError",
  "DeliveryReadPageOptions",
  "DeliveryShardObservationError",
  "ShardObservationOverflowError",
  "DeliveryShardObservationStream",
  "DeliveryWorkerId",
  "MAX_DELIVERY_BATCH_MESSAGES",
  "MAX_INBOX_PAYLOAD_BYTES",
  "MAX_DELIVERY_RPC_BYTES",
  "ReleasedShardSession",
  "RemoteInbox",
  "RemoteShardObservation",
  "RemoteShardSession",
  "RemoteWorkRegistry",
  "RemovalQuarantine",
  "RemovalQuarantineRecord",
];
const expectedDeliveryServerExports = [
  "createInMemoryDeliveryServerCore",
  "InMemoryDeliveryServerCore",
  "InMemoryDeliveryServerCoreOptions",
  "DeliveryServer",
  "DeliveryServerOptions",
];
const expectedStorageExports = [
  "EventStore",
  "EventRollback",
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
  "RecordContinuation",
  "RecordContinuationValue",
  "RecordEntry",
  "RecordFilter",
  "RecordMask",
  "RecordOrder",
  "RecordQuery",
  "RecordReadOptions",
  "RecordSpec",
  "RecordStorage",
  "Storage",
  "StorageContext",
  "StorageFactory",
  "StorageQueryCapabilities",
  "QueryCandidateLimitError",
  "StorageQueryFeature",
  "StorageQueryEvaluator",
  "StorageQueryPolicy",
];
const expectedDatastoreStorageExports = [
  "DatastoreQueryLimitError",
  "DatastoreStorageFactory",
  "DatastoreStorageFactoryInput",
  "DatastoreStorageOptions",
];
const expectedRdbmsStorageExports = [
  "MysqlStorageConfigurationError",
  "MysqlStorageConnectionError",
  "MysqlStorageDataError",
  "MysqlStorageFactory",
  "MysqlStorageOptions",
  "MysqlStorageOperationError",
  "MysqlStorageSchemaError",
];
const expectedTransportExports = [
  "AsyncCloseable",
  "PublishTransportHandler",
  "PublishTransportOperation",
  "RequestTransportHandler",
  "RequestTransportOperation",
  "SignalTransport",
  "TransportRoutingDescriptor",
  "TransportSemanticTag",
  "TransportSignalEnvelope",
  "TransportSignalKind",
  "TransportSubscription",
  "TransportSubscriptionHandle",
  "TransportSubscriptionInput",
  "TransportSubscriptionMode",
  "TransportTopic",
  "TransportTopicInput",
  "createTransportSubscription",
  "createTransportTopic",
  "isTransportOperationKind",
  "isTransportTopicKind",
];
const expectedZeroMqExports = [
  "ZeroMqAdapterConfig",
  "ZeroMqAdapterConfigInput",
  "ZeroMqTransportOptions",
  "ZeroMqTransportScope",
  "createZeroMqAdapterConfig",
  "createZeroMqTransport",
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
  "AggregateId",
  "AggregateHistory",
  "AggregateSnapshot",
  "AggregateStorage",
  "AggregateStorageOptions",
  "Apply",
  "Assign",
  "BaseHandlerMetadata",
  "BoundedContext",
  "BoundedContextBuilder",
  "BoundedContextName",
  "BoundedContextNameError",
  "BoundedContextSnapshot",
  "CommandBus",
  "Command",
  "CommandEndpoint",
  "CommandDispatcher",
  "CommandAssignmentHandlerMetadata",
  "CommandRuntimeRoutingPlan",
  "CommandRuntimeTransportHandler",
  "CommandRegistrationAssigneeMetadata",
  "CommandRegistrationReadiness",
  "CommandRegistrationReadinessLookup",
  "CommandReactionHandlerMetadata",
  "CommandContextInput",
  "Clock",
  "ContextSpec",
  "ContextSpecSnapshot",
  "ReadCatchUpOptions",
  "ReadCatchUpResult",
  "Delivery",
  "DeliveryBuilder",
  "DeliveryInbox",
  "DeliveryInboxWork",
  "DeliveryWorkRegistry",
  "DeliveryWorkSession",
  "ExclusiveDeliveryWorkSession",
  "LeasedDeliveryWorkSession",
  "DeliveryEndpointMessage",
  "DeliveryLabel",
  "DeliveryMonitor",
  "DeliveryPage",
  "DeliveryResult",
  "DeliveryRunOptions",
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
  "UniformAcrossAllShards",
  "createRoutingPlan",
  "DeferredRoutingSeam",
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
  "ServerEnvironmentSettings",
  "ServerOptions",
  "ServerRuntimeLifecycle",
  "ServerRuntimeRejectedState",
  "ServerRuntimeRoutingPlan",
  "RoutingPlanInput",
  "ServerRuntimeState",
  "ServerRuntimeStateError",
  "RuntimeStateErrorCode",
  "RuntimeTransportBinding",
  "RuntimeTransportBindingHandle",
  "RuntimeTransportBindingInput",
  "RuntimeTransportEnvelopeError",
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
  "EntityStateTransitionValidationRequest",
  "EntityStateTransitionValidationResult",
  "FirstFieldRoutingHint",
  "GeneratedRegistryDiscovery",
  "GeneratedRegistryDiscoveryError",
  "GeneratedRegistryDiscoveryOptions",
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
  "EventRuntimeRoutingPlan",
  "EventRuntimeTransportHandler",
  "EventReactionHandlerMetadata",
  "EventSubscriptionHandlerMetadata",
  "HandlerKind",
  "HandlerMetadata",
  "HandlerMetadataError",
  "HandlerMetadataErrorCode",
  "HandlerMetadataRegistry",
  "HandlerMetadataRegistryError",
  "HandlerMetadataRegistryErrorCode",
  "HandlerMetadataRegistryLookup",
  "HandlerMethodDecorator",
  "HandlerMethodName",
  "HandlerMethodValue",
  "HandlerParameterCount",
  "HandlerRegistryIngestionError",
  "HandlerRegistryIngestor",
  "HandlerRegistrationBuilder",
  "React",
  "RegisteredHandlerMetadata",
  "RegistryIngestionErrorCode",
  "Subscribe",
  "SystemClock",
  "acceptSignalIntake",
  "createEntityTransaction",
  "defineEntityHandlers",
  "failSignalIntake",
  "isEntitySchema",
  "describeEntityMetadata",
  "materializeDecoratedEntityHandlers",
  "validateEntityStateTransition",
];
const protoIndexPath = join("packages", "proto", "src", "index.ts");
const clientIndexPath = join("packages", "client", "src", "index.ts");
const deliveryClientIndexPath = join("packages", "delivery-client", "src", "index.ts");
const deliveryServerIndexPath = join("packages", "delivery-server", "src", "index.ts");
const storageIndexPath = join("packages", "storage", "src", "index.ts");
const datastoreStorageIndexPath = join("packages", "storage-datastore", "src", "index.ts");
const rdbmsStorageIndexPath = join("packages", "storage-rdbms", "src", "index.ts");
const serverIndexPath = join("packages", "server", "src", "index.ts");
const testingIndexPath = join("packages", "testing", "src", "index.ts");
const zeroMqIndexPath = join("packages", "transport", "src", "zeromq", "index.ts");

const typedocExecutable = process.platform === "win32" ? "typedoc.cmd" : "typedoc";
const typedocBin = join("node_modules", ".bin", typedocExecutable);
const outputDir = mkdtempSync(join(tmpdir(), "spine-typedoc-json-"));
const jsonPath = join(outputDir, "api.json");
const htmlPath = join(outputDir, "html");

const typedocResult = spawnSync(
  typedocBin,
  ["--options", "typedoc.json", "--out", htmlPath, "--json", jsonPath],
  {
    stdio: "inherit",
  },
);

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
const clientModuleNames = collectDirectModuleNames(apiDocs, "packages/client/src");
const deliveryClientModuleNames = collectDirectModuleNames(apiDocs, "packages/delivery-client/src");
const deliveryServerModuleNames = collectDirectModuleNames(apiDocs, "packages/delivery-server/src");
const storageModuleNames = collectDirectModuleNames(apiDocs, "packages/storage/src");
const datastoreStorageModuleNames = collectDirectModuleNames(
  apiDocs,
  "packages/storage-datastore/src",
);
const rdbmsStorageModuleNames = collectDirectModuleNames(apiDocs, "packages/storage-rdbms/src");
const testingModuleNames = collectDirectModuleNames(apiDocs, "packages/testing/src");
const zeroMqModuleNames = collectDirectModuleNames(apiDocs, "packages/transport/src/zeromq");

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

const missingExports = expectedProtoExports.filter((name) => !documentedNames.has(name));
const missingCoreExports = expectedCoreExports.filter((name) => !documentedNames.has(name));
const missingTransportExports = expectedTransportExports.filter(
  (name) => !documentedNames.has(name),
);
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
const declaredClientExports = collectNamedExports(clientIndexPath);
const declaredDeliveryClientExports = collectNamedExports(deliveryClientIndexPath);
const declaredDeliveryServerExports = collectNamedExports(deliveryServerIndexPath);
const declaredStorageExports = collectNamedExports(storageIndexPath);
const declaredDatastoreStorageExports = collectNamedExports(datastoreStorageIndexPath);
const declaredRdbmsStorageExports = collectNamedExports(rdbmsStorageIndexPath);
const declaredTestingExports = collectNamedExports(testingIndexPath);
const declaredZeroMqExports = collectNamedExports(zeroMqIndexPath);
const missingServerExports = expectedServerExports.filter((name) => !serverModuleNames.has(name));
const missingClientExports = expectedClientExports.filter((name) => !clientModuleNames.has(name));
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
const missingDeclaredServerExports = expectedServerExports.filter(
  (name) => !declaredServerExports.includes(name),
);
const missingStorageExports = expectedStorageExports.filter(
  (name) => !storageModuleNames.has(name),
);
const missingDeclaredStorageExports = expectedStorageExports.filter(
  (name) => !declaredStorageExports.includes(name),
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
const missingZeroMqExports = expectedZeroMqExports.filter((name) => !zeroMqModuleNames.has(name));
const missingZeroMqDeclarations = expectedZeroMqExports.filter(
  (name) => !declaredZeroMqExports.includes(name),
);
const unexpectedZeroMqExports = declaredZeroMqExports.filter(
  (name) => !expectedZeroMqExports.includes(name),
);

if (missingExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-event-engine/proto exports: ${missingExports.join(", ")}`,
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
    `TypeDoc JSON is missing expected @spine-event-engine/client exports: ${missingClientExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredClientExports.length > 0) {
  console.error(
    `@spine-event-engine/client root is missing expected exports: ${missingDeclaredClientExports.join(", ")}`,
  );
  process.exit(1);
}

if (unexpectedClientExports.length > 0) {
  console.error(
    "@spine-event-engine/client root exports changed without updating docs expectations: " +
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

if (missingZeroMqExports.length > 0) {
  console.error(
    "TypeDoc JSON is missing expected @spine-event-engine/transport/zeromq exports: " +
      missingZeroMqExports.join(", "),
  );
  process.exit(1);
}

if (missingZeroMqDeclarations.length > 0) {
  console.error(
    "@spine-event-engine/transport/zeromq root is missing expected exports: " +
      missingZeroMqDeclarations.join(", "),
  );
  process.exit(1);
}

if (unexpectedZeroMqExports.length > 0) {
  console.error(
    "@spine-event-engine/transport/zeromq exports changed without updating docs expectations: " +
      unexpectedZeroMqExports.join(", "),
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

if (/export\s+\*\s+from\s+["']\.\/generated\//.test(protoIndexSource)) {
  console.error(
    "@spine-event-engine/proto root must not use broad generated re-exports; expose curated aliases instead.",
  );
  process.exit(1);
}

console.log(
  [
    `TypeDoc JSON includes ${expectedProtoExports.length} expected @spine-event-engine/proto exports`,
    `${expectedCoreExports.length} expected @spine-event-engine/core exports`,
    `${expectedClientExports.length} expected @spine-event-engine/client exports`,
    `${expectedDeliveryClientExports.length} expected @spine-event-engine/delivery-client exports`,
    `${expectedDeliveryServerExports.length} expected @spine-event-engine/delivery-server exports`,
    `${expectedServerExports.length} expected @spine-event-engine/server exports`,
    `${expectedStorageExports.length} expected @spine-event-engine/storage exports`,
    `${expectedTransportExports.length} expected @spine-event-engine/transport exports`,
    `${expectedZeroMqExports.length} expected @spine-event-engine/transport/zeromq exports`,
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
    }
  }

  return [...names].sort();
}

function hasExportModifier(statement) {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === SyntaxKind.ExportKeyword) ?? false
  );
}
