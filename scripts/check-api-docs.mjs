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
  "ValidationException",
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
const expectedStorageExports = [
  "EventStore",
  "InMemoryRecordStorage",
  "InMemoryStorageFactory",
  "OnEventAccepted",
  "RecordColumn",
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
  "TransportSignalKind",
  "TransportSubscription",
  "TransportSubscriptionHandle",
  "TransportSubscriptionInput",
  "TransportSubscriptionMode",
  "TransportTopic",
  "TransportTopicInput",
  "createTransportSubscription",
  "createTransportTopic",
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
  "CommandRegistrationAssigneeMetadata",
  "CommandRegistrationReadiness",
  "CommandRegistrationReadinessLookup",
  "CommandReactionHandlerMetadata",
  "ContextSpec",
  "ContextSpecSnapshot",
  "Delivery",
  "DeliveryLabel",
  "DeliveryOptions",
  "DeliveryStorageCorruptionError",
  "DeliveryStatus",
  "createServerRuntimeRoutingPlan",
  "DeferredServerRuntimeRoutingSeam",
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
  "EventBus",
  "EventEndpoint",
  "EventDispatcher",
  "Inbox",
  "InboxId",
  "InboxMessage",
  "InboxMessageError",
  "InboxMessageId",
  "InboxMessageInput",
  "InboxReadOptions",
  "InboxStorage",
  "InboxStorageOptions",
  "InboxWriteResult",
  "PlainEntityVersionMetadata",
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
  "ServerRuntimeLifecycle",
  "ServerRuntimeRejectedState",
  "ServerRuntimeRoutingPlan",
  "ServerRuntimeRoutingPlanInput",
  "ServerRuntimeState",
  "ServerRuntimeStateError",
  "RuntimeStateErrorCode",
  "ServerRuntimeStateOperation",
  "ServerRuntimeWork",
  "SingleProcessServerRuntime",
  "SignalIntakeAccepted",
  "SignalIntakeAcceptedFor",
  "SignalIntakeFailure",
  "SignalIntakeFailureCode",
  "SignalIntakeFailureDetails",
  "SignalIntakeFailureDiagnostics",
  "SignalIntakeResult",
  "SignalKind",
  "ShardIndex",
  "ShardSession",
  "ShardedWorkRegistry",
  "ShardedWorkRegistryOptions",
  "Stand",
  "StandColumn",
  "StandOptions",
  "StandReadOptions",
  "StandRegisterOptions",
  "StandStateTypeError",
  "StandSubscribeOptions",
  "StandSubscription",
  "StandUpdate",
  "StandUpdateOptions",
  "TransactionalEntity",
  "TransactionalEntityScopeError",
  "TransactionalEntityScopeErrorReason",
  "TransactionalEntityScopeOperation",
  "TenantMode",
  "EntityTransaction",
  "EntityTransactionAcceptedCommit",
  "EntityTransactionCommitResult",
  "EntityTransactionCommittedVersionMetadata",
  "EntityTransactionDraftStateError",
  "EntityTransactionDraftStateReason",
  "EntityTransactionLifecycleFlags",
  "EntityTransactionOperation",
  "EntityTransactionOptions",
  "EntityTransactionRejectedCommit",
  "EntityTransactionRollbackResult",
  "EntityTransactionStateError",
  "EntityTransactionStatus",
  "EntityTransactionUpdater",
  "EntityTransactionVersionMetadata",
  "EntityStateTransitionValidationRequest",
  "EntityStateTransitionValidationResult",
  "FirstFieldRoutingHint",
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
  "HandlerRegistrationBuilder",
  "React",
  "RegisteredHandlerMetadata",
  "Subscribe",
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
const storageIndexPath = join("packages", "storage", "src", "index.ts");
const serverIndexPath = join("packages", "server", "src", "index.ts");

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
const storageModuleNames = collectDirectModuleNames(apiDocs, "packages/storage/src");

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
    ["BoundedContext", "BoundedContextBuilder", "ContextSpec", "Repository"].includes(value.name)
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
const declaredStorageExports = collectNamedExports(storageIndexPath);
const missingServerExports = expectedServerExports.filter((name) => !serverModuleNames.has(name));
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
const unexpectedStorageExports = declaredStorageExports.filter(
  (name) => !expectedStorageExports.includes(name),
);

if (missingExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/proto exports: ${missingExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingCoreExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/core exports: ${missingCoreExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingServerExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/server exports: ${missingServerExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredServerExports.length > 0) {
  console.error(
    `@spine-ts/server root is missing expected exports: ${missingDeclaredServerExports.join(", ")}`,
  );
  process.exit(1);
}

if (unexpectedServerExports.length > 0) {
  console.error(
    `@spine-ts/server root exports changed without updating docs expectations: ${unexpectedServerExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingStorageExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/storage exports: ${missingStorageExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingDeclaredStorageExports.length > 0) {
  console.error(
    `@spine-ts/storage root is missing expected exports: ${missingDeclaredStorageExports.join(
      ", ",
    )}`,
  );
  process.exit(1);
}

if (unexpectedStorageExports.length > 0) {
  console.error(
    `@spine-ts/storage root exports changed without updating docs expectations: ${unexpectedStorageExports.join(", ")}`,
  );
  process.exit(1);
}

if (missingTransportExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/transport exports: ${missingTransportExports.join(", ")}`,
  );
  process.exit(1);
}

if (forbiddenMatches.length > 0) {
  console.error(
    `TypeDoc JSON exposes removed or non-public @spine-ts/server API surface: ${[
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
    `TypeDoc JSON exposes internal or removed @spine-ts/storage symbols: ${[
      ...new Set(forbiddenStorageTypeDocNameMatches),
    ].join(", ")}`,
  );
  process.exit(1);
}

if (forbiddenTypeDocNameMatches.length > 0 || forbiddenTypeDocPatternMatches.length > 0) {
  console.error(
    `TypeDoc JSON exposes internal @spine-ts/server repository type machinery: ${[
      ...forbiddenTypeDocNameMatches,
      ...forbiddenTypeDocPatternMatches,
    ].join(", ")}`,
  );
  process.exit(1);
}

const protoIndexSource = readFileSync(protoIndexPath, "utf8");

if (/export\s+\*\s+from\s+["']\.\/generated\//.test(protoIndexSource)) {
  console.error(
    "@spine-ts/proto root must not use broad generated re-exports; expose curated aliases instead.",
  );
  process.exit(1);
}

console.log(
  [
    `TypeDoc JSON includes ${expectedProtoExports.length} expected @spine-ts/proto exports`,
    `${expectedCoreExports.length} expected @spine-ts/core exports`,
    `${expectedServerExports.length} expected @spine-ts/server exports`,
    `${expectedStorageExports.length} expected @spine-ts/storage exports`,
    `${expectedTransportExports.length} expected @spine-ts/transport exports.`,
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
    if (statement.kind !== SyntaxKind.ExportDeclaration) {
      continue;
    }

    const exportClause = statement.exportClause;

    if (exportClause === undefined || exportClause.kind !== SyntaxKind.NamedExports) {
      continue;
    }

    for (const element of exportClause.elements) {
      names.add(element.name.text);
    }
  }

  return [...names].sort();
}
