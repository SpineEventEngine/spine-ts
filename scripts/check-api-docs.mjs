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
  "InternetDomain",
  "InternetDomainSchema",
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

const missingExports = expectedProtoExports.filter((name) => !documentedNames.has(name));
const missingCoreExports = expectedCoreExports.filter((name) => !documentedNames.has(name));

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

const protoIndexSource = readFileSync(protoIndexPath, "utf8");

if (/export\s+\*\s+from\s+["']\.\/generated\//.test(protoIndexSource)) {
  console.error(
    "@spine-ts/proto root must not use broad generated re-exports; expose curated aliases instead.",
  );
  process.exit(1);
}

console.log(
  `TypeDoc JSON includes ${expectedProtoExports.length} expected @spine-ts/proto exports and ${expectedCoreExports.length} expected @spine-ts/core exports.`,
);
