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
  actorContextFile,
  file_spine_core_command,
  file_spine_core_event,
  file_spine_options,
  validationErrorFile,
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

describe("@spine-event-engine/proto", () => {
  it("verifies the copied Spine proto source manifest checksums", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("packages/proto/proto/spine-sources.json"), "utf8"),
    ) as ProtoSourceManifest;

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.sources).toHaveLength(46);

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

  it("pins the fresh upstream TypeScript option contract byte-for-byte", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("packages/proto/proto/spine-sources.json"), "utf8"),
    ) as ProtoSourceManifest;
    const source = manifest.sources.find(
      (candidate) => candidate.localPath === "packages/proto/proto/spine/options.proto",
    );

    expect(source).toMatchObject({
      repository: "SpineEventEngine/base-libraries",
      commit: "51cb428771e5af8a944675fb8e26e9eb2c3d0dfe",
      upstreamPath: "base/src/main/proto/spine/options.proto",
      sha256: "894468a9ee427d4805accae79ef83cbdf5aacb09e41193b4d5cc965b3ede0ad9",
    });
    expect(source?.sourceUrl).toBe(
      [
        "https://github.com/SpineEventEngine/base-libraries/blob/",
        "51cb428771e5af8a944675fb8e26e9eb2c3d0dfe/base/src/main/proto/spine/options.proto",
      ].join(""),
    );
    expect(source?.rawUrl).toBe(
      [
        "https://raw.githubusercontent.com/SpineEventEngine/base-libraries/",
        "51cb428771e5af8a944675fb8e26e9eb2c3d0dfe/base/src/main/proto/spine/options.proto",
      ].join(""),
    );
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
    expect(getOption(actorContextFile, type_url_prefix)).toBe("type.spine.io");
    expect(getOption(validationErrorFile, type_url_prefix)).toBe("type.spine.io");
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
    expect(getOption(CommandSchema, is).tsType).toBe("");
    expect(create(EveryIsOptionSchema).tsType).toBe("");
    expect(create(IsOptionSchema).tsType).toBe("");
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
        "BoundedContextNameSchema",
        "BoundedContextOnlineSchema",
        "ChannelIdSchema",
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
        "ExternalEventTypeSchema",
        "ExternalEventsWantedSchema",
        "ExternalMessageSchema",
        "ExternalMessageValidationError",
        "ExternalMessageValidationErrorSchema",
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
        "spineProtoModule",
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
        "fieldPathFile",
        "file_spine_core_ack",
        "file_spine_core_bounded_context",
        "actorContextFile",
        "file_spine_core_command",
        "file_spine_core_diagnostics",
        "file_spine_core_enrichment",
        "file_spine_core_event",
        "file_spine_core_response",
        "tenantIdFile",
        "userIdFile",
        "file_spine_core_version",
        "emailAddressFile",
        "internetDomainFile",
        "file_spine_options",
        "file_spine_server_integration_broker",
        "file_spine_server_transport_transport",
        "templateStringFile",
        "file_spine_time_time",
        "file_spine_ui_language",
        "validationErrorFile",
        "internal_all",
        "internal_type",
        "type_url_prefix",
      ].sort(),
    );
  });
});
