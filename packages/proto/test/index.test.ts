import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOption, hasOption, create } from "@bufbuild/protobuf";

import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  column,
  entity,
  EmailAddressSchema,
  EntityOptionSchema,
  EntityOption_Kind,
  EntityOption_KindSchema,
  EntityOption_Visibility,
  EntityOption_VisibilitySchema,
  EnrichmentSchema,
  every_is,
  EveryIsOptionSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  FieldPathSchema,
  InternetDomainSchema,
  is,
  IsOptionSchema,
  MessageIdSchema,
  OriginSchema,
  set_once,
  TemplateStringSchema,
  TenantIdSchema,
  UserIdSchema,
  ValidationErrorSchema,
  VersionSchema,
  ZoneIdSchema,
  file_spine_core_actor_context,
  file_spine_core_command,
  file_spine_core_event,
  file_spine_options,
  file_spine_validation_validation_error,
  type_url_prefix,
} from "../src/index.js";
import * as protoRoot from "../src/index.js";

interface ProtoSourceManifest {
  readonly schemaVersion: 1;
  readonly sources: readonly {
    readonly localPath: string;
    readonly repository: string;
    readonly commit: string;
    readonly upstreamPath: string;
    readonly sourceUrl: string;
    readonly rawUrl: string;
    readonly sha256: string;
  }[];
}

describe("@spine-ts/proto", () => {
  it("verifies the copied Spine proto source manifest checksums", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("proto/spine-sources.json"), "utf8"),
    ) as ProtoSourceManifest;

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.sources).toHaveLength(39);

    for (const source of manifest.sources) {
      const contents = readFileSync(resolve(source.localPath));
      const actual = createHash("sha256").update(contents).digest("hex");

      expect(source.repository).toMatch(/^SpineEventEngine\//);
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(source.upstreamPath).toMatch(/\.proto$/);
      expect(source.sourceUrl).toContain(source.commit);
      expect(source.rawUrl).toContain(source.commit);
      expect(actual).toBe(source.sha256);
    }
  });

  it("exports generated schemas for validation errors and their dependencies", () => {
    expect(ValidationErrorSchema.typeName).toBe("spine.validation.ValidationError");
    expect(FieldPathSchema.typeName).toBe("spine.base.FieldPath");
    expect(TemplateStringSchema.typeName).toBe("spine.string.TemplateString");

    const validationError = create(ValidationErrorSchema);

    expect(validationError.$typeName).toBe("spine.validation.ValidationError");
    expect(validationError.constraintViolation).toEqual([]);
  });

  it("exports generated schemas for the core signal envelope closure", () => {
    expect(CommandSchema.typeName).toBe("spine.core.Command");
    expect(CommandIdSchema.typeName).toBe("spine.core.CommandId");
    expect(CommandContextSchema.typeName).toBe("spine.core.CommandContext");
    expect(EventSchema.typeName).toBe("spine.core.Event");
    expect(EventIdSchema.typeName).toBe("spine.core.EventId");
    expect(EventContextSchema.typeName).toBe("spine.core.EventContext");
    expect(ActorContextSchema.typeName).toBe("spine.core.ActorContext");
    expect(TenantIdSchema.typeName).toBe("spine.core.TenantId");
    expect(UserIdSchema.typeName).toBe("spine.core.UserId");
    expect(VersionSchema.typeName).toBe("spine.core.Version");
    expect(MessageIdSchema.typeName).toBe("spine.core.MessageId");
    expect(OriginSchema.typeName).toBe("spine.core.Origin");
    expect(EnrichmentSchema.typeName).toBe("spine.core.Enrichment");
    expect(EmailAddressSchema.typeName).toBe("spine.net.EmailAddress");
    expect(InternetDomainSchema.typeName).toBe("spine.net.InternetDomain");
    expect(ZoneIdSchema.typeName).toBe("spine.time.ZoneId");

    expect(create(CommandSchema).$typeName).toBe("spine.core.Command");
    expect(create(EventSchema).$typeName).toBe("spine.core.Event");
    expect(create(ActorContextSchema).$typeName).toBe("spine.core.ActorContext");
  });

  it("preserves the Spine type URL prefix custom option in generated descriptors", () => {
    expect(hasOption(file_spine_options, type_url_prefix)).toBe(true);
    expect(getOption(file_spine_options, type_url_prefix)).toBe("type.spine.io");
    expect(getOption(file_spine_core_command, type_url_prefix)).toBe("type.spine.io");
    expect(getOption(file_spine_core_event, type_url_prefix)).toBe("type.spine.io");
    expect(getOption(file_spine_core_actor_context, type_url_prefix)).toBe("type.spine.io");
    expect(getOption(file_spine_validation_validation_error, type_url_prefix)).toBe(
      "type.spine.io",
    );
  });

  it("exports the curated Spine option descriptors needed by entity metadata", () => {
    expect(EntityOptionSchema.typeName).toBe("EntityOption");
    expect(EveryIsOptionSchema.typeName).toBe("EveryIsOption");
    expect(IsOptionSchema.typeName).toBe("IsOption");
    expect(EntityOption_Kind.PROJECTION).toBe(2);
    expect(EntityOption_Visibility.FULL).toBe(4);
    expect(EntityOption_KindSchema.typeName).toBe("EntityOption.Kind");
    expect(EntityOption_VisibilitySchema.typeName).toBe("EntityOption.Visibility");
    expect(hasOption(CommandSchema, is)).toBe(true);
    expect(getOption(CommandSchema, is).javaType).toBe("CommandMixin");
    expect(hasOption(file_spine_core_command, every_is)).toBe(false);
    expect(entity.extendee.typeName).toBe("google.protobuf.MessageOptions");
    expect(column.extendee.typeName).toBe("google.protobuf.FieldOptions");
    expect(set_once.extendee.typeName).toBe("google.protobuf.FieldOptions");
  });

  it("keeps the public root runtime exports curated", () => {
    expect(Object.keys(protoRoot).sort()).toEqual(
      [
        "AckSchema",
        "ActorContextSchema",
        "ConstraintViolationSchema",
        "CommandContextSchema",
        "CommandContext_ScheduleSchema",
        "CommandIdSchema",
        "CommandSchema",
        "CommandValidationError",
        "CommandValidationErrorSchema",
        "Command_SystemPropertiesSchema",
        "column",
        "DayOfWeek",
        "DayOfWeekSchema",
        "EmailAddressSchema",
        "entity",
        "EntityOptionSchema",
        "EntityOption_Kind",
        "EntityOption_KindSchema",
        "EntityOption_Visibility",
        "EntityOption_VisibilitySchema",
        "EnrichmentSchema",
        "Enrichment_ContainerSchema",
        "ErrorSchema",
        "every_is",
        "EveryIsOptionSchema",
        "EventContextSchema",
        "EventIdSchema",
        "EventSchema",
        "EventValidationError",
        "EventValidationErrorSchema",
        "FieldPathSchema",
        "InternetDomainSchema",
        "is",
        "IsOptionSchema",
        "Language",
        "LanguageSchema",
        "LocalDateSchema",
        "LocalDateTimeSchema",
        "LocalTimeSchema",
        "MessageIdSchema",
        "Month",
        "MonthSchema",
        "OriginSchema",
        "RejectionEventContextSchema",
        "ResponseSchema",
        "set_once",
        "SPI_type",
        "StatusSchema",
        "TemplateStringSchema",
        "TenantIdSchema",
        "UserIdSchema",
        "ValidationErrorSchema",
        "VersionSchema",
        "YearMonthSchema",
        "ZoneIdSchema",
        "ZonedDateTimeSchema",
        "file_spine_base_error",
        "file_spine_base_field_path",
        "file_spine_core_ack",
        "file_spine_core_actor_context",
        "file_spine_core_command",
        "file_spine_core_diagnostics",
        "file_spine_core_enrichment",
        "file_spine_core_event",
        "file_spine_core_response",
        "file_spine_core_tenant_id",
        "file_spine_core_user_id",
        "file_spine_core_version",
        "file_spine_net_email_address",
        "file_spine_net_internet_domain",
        "file_spine_options",
        "file_spine_string_template_string",
        "file_spine_time_time",
        "file_spine_ui_language",
        "file_spine_validation_validation_error",
        "internal_all",
        "internal_type",
        "type_url_prefix",
      ].sort(),
    );
  });
});
