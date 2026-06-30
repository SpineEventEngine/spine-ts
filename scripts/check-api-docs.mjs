import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
  "ExpectedStorageVersion",
  "StorageRecordKey",
  "StorageRecordKind",
  "StorageDurability",
  "StorageRecord",
  "PutStorageRecordInput",
  "DeleteStorageRecordInput",
  "WriteSideRecordStore",
  "ReadSideRecordStore",
  "EntityRecord",
  "AggregateSnapshotRecord",
  "ProjectionRecord",
  "DeliveryRecord",
  "AggregateEventRecord",
  "AppendAggregateEventsInput",
  "AggregateEventStore",
  "TenantIndexStore",
  "DiagnosticSeverity",
  "AppendDiagnosticInput",
  "DiagnosticRecord",
  "DiagnosticRecordStore",
  "StorageAdapter",
  "StorageVersionConflictError",
  "StoragePayloadCloneError",
  "createInMemoryStorageAdapter",
  "InMemoryStorageAdapter",
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
  "BoundedContextRepositoryRegistrationError",
  "BoundedContextRepositoryRegistrationConflictErrorDetails",
  "BoundedContextRepositoryRegistrationErrorCode",
  "BoundedContextRepositoryRegistrationErrorDetails",
  "BoundedContextRepositoryRegistrationOperation",
  "BoundedContextRepositorySnapshotErrorDetails",
  "BoundedContextSnapshot",
  "Command",
  "CommandAssignmentHandlerMetadata",
  "CommandReactionHandlerMetadata",
  "ContextSpec",
  "ContextSpecSnapshot",
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
  "PlainEntityVersionMetadata",
  "ProcessManager",
  "Projection",
  "ConcreteRepositoryEntityType",
  "Repository",
  "RepositoryEntityType",
  "RepositoryIdentityError",
  "RepositoryIdentityErrorCode",
  "RepositoryIdentityErrorDetails",
  "RepositoryIdentitySnapshot",
  "RepositoryOptions",
  "RepositoryRegistrationConflictDetails",
  "RepositoryStateSchema",
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
  "createEntityTransaction",
  "defineEntityHandlers",
  "isEntitySchema",
  "describeEntityMetadata",
  "materializeDecoratedEntityHandlers",
  "validateEntityStateTransition",
];
const protoIndexPath = join("packages", "proto", "src", "index.ts");

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
    ["BoundedContext", "BoundedContextBuilder", "ContextSpec"].includes(value.name)
      ? value.name
      : ownerName;

  if (typeof value.name === "string" && nextOwnerName !== undefined) {
    for (const forbidden of forbiddenPublicMembers) {
      if (
        forbidden.owner === nextOwnerName &&
        forbidden.member === value.name &&
        forbidden.matches(value)
      ) {
        matches.push(`${forbidden.owner}.${forbidden.member} (${forbidden.reason})`);
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
const missingServerExports = expectedServerExports.filter((name) => !documentedNames.has(name));
const missingStorageExports = expectedStorageExports.filter((name) => !documentedNames.has(name));
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

if (missingStorageExports.length > 0) {
  console.error(
    `TypeDoc JSON is missing expected @spine-ts/storage exports: ${missingStorageExports.join(", ")}`,
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
const forbiddenTypeDocNameMatches = forbiddenTypeDocNames.filter((name) =>
  apiDocsText.includes(name),
);
const forbiddenTypeDocPatternMatches = forbiddenTypeDocNamePatterns
  .filter((pattern) => pattern.test(apiDocsText))
  .map((pattern) => pattern.toString());

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
  `TypeDoc JSON includes ${expectedProtoExports.length} expected @spine-ts/proto exports, ${expectedCoreExports.length} expected @spine-ts/core exports, ${expectedServerExports.length} expected @spine-ts/server exports, and ${expectedStorageExports.length} expected @spine-ts/storage exports.`,
);
