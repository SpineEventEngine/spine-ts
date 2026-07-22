import type { GenEnum, GenExtension, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { FieldOptions, FileOptions, MessageOptions } from "@bufbuild/protobuf/wkt";
import {
  FieldPathSchema as generatedFieldPathSchema,
  file_spine_base_field_path as generatedFileSpineBaseFieldPath,
} from "../generated/spine/base/field_path_pb.js";
import type { FieldPath } from "../generated/spine/base/field_path_pb.js";
import {
  ActorContextSchema as generatedActorContextSchema,
  file_spine_core_actor_context as generatedFileSpineCoreActorContext,
} from "../generated/spine/core/actor_context_pb.js";
import type { ActorContext } from "../generated/spine/core/actor_context_pb.js";
import {
  CommandContextSchema as generatedCommandContextSchema,
  CommandContext_ScheduleSchema as generatedCommandContextScheduleSchema,
  CommandIdSchema as generatedCommandIdSchema,
  CommandSchema as generatedCommandSchema,
  CommandValidationError as generatedCommandValidationError,
  CommandValidationErrorSchema as generatedCommandValidationErrorSchema,
  Command_SystemPropertiesSchema as generatedCommandSystemPropertiesSchema,
  file_spine_core_command as generatedFileSpineCoreCommand,
} from "../generated/spine/core/command_pb.js";
import type {
  Command,
  CommandContext,
  CommandContext_Schedule,
  CommandId,
  CommandValidationError as CommandValidationErrorType,
  Command_SystemProperties,
} from "../generated/spine/core/command_pb.js";
import {
  MessageIdSchema as generatedMessageIdSchema,
  OriginSchema as generatedOriginSchema,
  file_spine_core_diagnostics as generatedFileSpineCoreDiagnostics,
} from "../generated/spine/core/diagnostics_pb.js";
import type { MessageId, Origin } from "../generated/spine/core/diagnostics_pb.js";
import {
  EnrichmentSchema as generatedEnrichmentSchema,
  Enrichment_ContainerSchema as generatedEnrichmentContainerSchema,
  file_spine_core_enrichment as generatedFileSpineCoreEnrichment,
} from "../generated/spine/core/enrichment_pb.js";
import type { Enrichment, Enrichment_Container } from "../generated/spine/core/enrichment_pb.js";
import {
  EventContextSchema as generatedEventContextSchema,
  EventIdSchema as generatedEventIdSchema,
  EventSchema as generatedEventSchema,
  EventValidationError as generatedEventValidationError,
  EventValidationErrorSchema as generatedEventValidationErrorSchema,
  RejectionEventContextSchema as generatedRejectionEventContextSchema,
  file_spine_core_event as generatedFileSpineCoreEvent,
} from "../generated/spine/core/event_pb.js";
import type {
  Event,
  EventContext,
  EventId,
  EventValidationError as EventValidationErrorType,
  RejectionEventContext,
} from "../generated/spine/core/event_pb.js";
import {
  TenantIdSchema as generatedTenantIdSchema,
  file_spine_core_tenant_id as generatedFileSpineCoreTenantId,
} from "../generated/spine/core/tenant_id_pb.js";
import type { TenantId } from "../generated/spine/core/tenant_id_pb.js";
import {
  UserIdSchema as generatedUserIdSchema,
  file_spine_core_user_id as generatedFileSpineCoreUserId,
} from "../generated/spine/core/user_id_pb.js";
import type { UserId } from "../generated/spine/core/user_id_pb.js";
import {
  VersionSchema as generatedVersionSchema,
  file_spine_core_version as generatedFileSpineCoreVersion,
} from "../generated/spine/core/version_pb.js";
import type { Version } from "../generated/spine/core/version_pb.js";
import {
  EmailAddressSchema as generatedEmailAddressSchema,
  file_spine_net_email_address as generatedFileSpineNetEmailAddress,
} from "../generated/spine/net/email_address_pb.js";
import type { EmailAddress } from "../generated/spine/net/email_address_pb.js";
import {
  InternetDomainSchema as generatedInternetDomainSchema,
  file_spine_net_internet_domain as generatedFileSpineNetInternetDomain,
} from "../generated/spine/net/internet_domain_pb.js";
import type { InternetDomain } from "../generated/spine/net/internet_domain_pb.js";
import {
  EntityOptionSchema as generatedEntityOptionSchema,
  EntityOption_Kind as generatedEntityOptionKind,
  EntityOption_KindSchema as generatedEntityOptionKindSchema,
  EntityOption_Visibility as generatedEntityOptionVisibility,
  EntityOption_VisibilitySchema as generatedEntityOptionVisibilitySchema,
  EveryIsOptionSchema as generatedEveryIsOptionSchema,
  file_spine_options as generatedFileSpineOptions,
  column as generatedColumn,
  entity as generatedEntity,
  every_is as generatedEveryIs,
  is as generatedIs,
  IsOptionSchema as generatedIsOptionSchema,
  set_once as generatedSetOnce,
  type_url_prefix as generatedTypeUrlPrefix,
} from "../generated/spine/options_pb.js";
import type { EntityOption, EveryIsOption, IsOption } from "../generated/spine/options_pb.js";
import {
  TemplateStringSchema as generatedTemplateStringSchema,
  file_spine_string_template_string as generatedFileSpineStringTemplateString,
} from "../generated/spine/string/template_string_pb.js";
import type { TemplateString } from "../generated/spine/string/template_string_pb.js";
import {
  DayOfWeek as generatedDayOfWeek,
  DayOfWeekSchema as generatedDayOfWeekSchema,
  LocalDateSchema as generatedLocalDateSchema,
  LocalDateTimeSchema as generatedLocalDateTimeSchema,
  LocalTimeSchema as generatedLocalTimeSchema,
  Month as generatedMonth,
  MonthSchema as generatedMonthSchema,
  YearMonthSchema as generatedYearMonthSchema,
  ZoneIdSchema as generatedZoneIdSchema,
  ZonedDateTimeSchema as generatedZonedDateTimeSchema,
  file_spine_time_time as generatedFileSpineTimeTime,
} from "../generated/spine/time/time_pb.js";
import type {
  DayOfWeek as DayOfWeekType,
  LocalDate,
  LocalDateTime,
  LocalTime,
  Month as MonthType,
  YearMonth,
  ZoneId,
  ZonedDateTime,
} from "../generated/spine/time/time_pb.js";
import {
  Language as generatedLanguage,
  LanguageSchema as generatedLanguageSchema,
  file_spine_ui_language as generatedFileSpineUiLanguage,
} from "../generated/spine/ui/language_pb.js";
import type { Language as LanguageType } from "../generated/spine/ui/language_pb.js";
import {
  ConstraintViolationSchema as generatedConstraintViolationSchema,
  ValidationErrorSchema as generatedValidationErrorSchema,
  file_spine_validation_validation_error as generatedFileSpineValidationValidationError,
} from "../generated/spine/validation/validation_error_pb.js";
import type {
  ConstraintViolation,
  ValidationError,
} from "../generated/spine/validation/validation_error_pb.js";

export * from "../generated/spine/base/error_pb.js";
export * from "../generated/spine/core/ack_pb.js";
export * from "../generated/spine/core/response_pb.js";
export { SPI_type, internal_all, internal_type } from "../generated/spine/options_pb.js";

/**
 * Curated Protobuf-ES root exports for copied Spine proto contracts.
 *
 * The package root intentionally avoids broad generated re-exports. Runtime
 * metadata registries, validation facades, and `Any` packing helpers live in
 * `@spine-ts/core` or later runtime packages.
 */
export type {
  ActorContext,
  Command,
  CommandContext,
  CommandContext_Schedule,
  CommandId,
  Command_SystemProperties,
  ConstraintViolation,
  EmailAddress,
  EntityOption,
  Enrichment,
  Enrichment_Container,
  EveryIsOption,
  Event,
  EventContext,
  EventId,
  FieldPath,
  InternetDomain,
  IsOption,
  LocalDate,
  LocalDateTime,
  LocalTime,
  MessageId,
  Origin,
  RejectionEventContext,
  TemplateString,
  TenantId,
  UserId,
  ValidationError,
  Version,
  YearMonth,
  ZoneId,
  ZonedDateTime,
};

export type CommandValidationError = CommandValidationErrorType;
export type DayOfWeek = DayOfWeekType;
export type EventValidationError = EventValidationErrorType;
export type Language = LanguageType;
export type Month = MonthType;

/** File descriptor for `spine/options.proto`. */
export const file_spine_options: GenFile = generatedFileSpineOptions;

/** File descriptor for `spine/base/field_path.proto`. */
export const file_spine_base_field_path: GenFile = generatedFileSpineBaseFieldPath;

/** File descriptor for `spine/core/actor_context.proto`. */
export const file_spine_core_actor_context: GenFile = generatedFileSpineCoreActorContext;

/** File descriptor for `spine/core/command.proto`. */
export const file_spine_core_command: GenFile = generatedFileSpineCoreCommand;

/** File descriptor for `spine/core/diagnostics.proto`. */
export const file_spine_core_diagnostics: GenFile = generatedFileSpineCoreDiagnostics;

/** File descriptor for `spine/core/enrichment.proto`. */
export const file_spine_core_enrichment: GenFile = generatedFileSpineCoreEnrichment;

/** File descriptor for `spine/core/event.proto`. */
export const file_spine_core_event: GenFile = generatedFileSpineCoreEvent;

/** File descriptor for `spine/core/tenant_id.proto`. */
export const file_spine_core_tenant_id: GenFile = generatedFileSpineCoreTenantId;

/** File descriptor for `spine/core/user_id.proto`. */
export const file_spine_core_user_id: GenFile = generatedFileSpineCoreUserId;

/** File descriptor for `spine/core/version.proto`. */
export const file_spine_core_version: GenFile = generatedFileSpineCoreVersion;

/** File descriptor for `spine/net/email_address.proto`. */
export const file_spine_net_email_address: GenFile = generatedFileSpineNetEmailAddress;

/** File descriptor for `spine/net/internet_domain.proto`. */
export const file_spine_net_internet_domain: GenFile = generatedFileSpineNetInternetDomain;

/** File descriptor for `spine/string/template_string.proto`. */
export const file_spine_string_template_string: GenFile = generatedFileSpineStringTemplateString;

/** File descriptor for `spine/time/time.proto`. */
export const file_spine_time_time: GenFile = generatedFileSpineTimeTime;

/** File descriptor for `spine/ui/language.proto`. */
export const file_spine_ui_language: GenFile = generatedFileSpineUiLanguage;

/** File descriptor for `spine/validation/validation_error.proto`. */
export const file_spine_validation_validation_error: GenFile =
  generatedFileSpineValidationValidationError;

/** Spine custom file option that stores the type URL prefix for file messages. */
export const type_url_prefix: GenExtension<FileOptions, string> = generatedTypeUrlPrefix;

/** Spine custom message option that marks entity state metadata. */
export const entity: GenExtension<MessageOptions, EntityOption> = generatedEntity;

/** Spine custom field option that marks queryable entity columns. */
export const column: GenExtension<FieldOptions, boolean> = generatedColumn;

/** Spine custom field option that marks state fields enforced once per entity lifecycle. */
export const set_once: GenExtension<FieldOptions, boolean> = generatedSetOnce;

/** Spine custom message option that carries semantic marker tags for one message type. */
export const is: GenExtension<MessageOptions, IsOption> = generatedIs;

/** Spine custom file option that carries semantic marker tags shared by all file messages. */
export const every_is: GenExtension<FileOptions, EveryIsOption> = generatedEveryIs;

/** Enum for `spine.core.CommandValidationError`. */
export const CommandValidationError: typeof generatedCommandValidationError =
  generatedCommandValidationError;

/** Enum descriptor for `spine.core.CommandValidationError`. */
export const CommandValidationErrorSchema: GenEnum<CommandValidationErrorType> =
  generatedCommandValidationErrorSchema;

/** Enum for `spine.core.EventValidationError`. */
export const EventValidationError: typeof generatedEventValidationError =
  generatedEventValidationError;

/** Enum descriptor for `spine.core.EventValidationError`. */
export const EventValidationErrorSchema: GenEnum<EventValidationErrorType> =
  generatedEventValidationErrorSchema;

/** Enum for `spine.time.Month`. */
export const Month: typeof generatedMonth = generatedMonth;

/** Enum descriptor for `spine.time.Month`. */
export const MonthSchema: GenEnum<MonthType> = generatedMonthSchema;

/** Enum for `spine.time.DayOfWeek`. */
export const DayOfWeek: typeof generatedDayOfWeek = generatedDayOfWeek;

/** Enum descriptor for `spine.time.DayOfWeek`. */
export const DayOfWeekSchema: GenEnum<DayOfWeekType> = generatedDayOfWeekSchema;

/** Enum for `spine.ui.Language`. */
export const Language: typeof generatedLanguage = generatedLanguage;

/** Enum descriptor for `spine.ui.Language`. */
export const LanguageSchema: GenEnum<LanguageType> = generatedLanguageSchema;

/** Enum for `EntityOption.Kind`. */
export const EntityOption_Kind: typeof generatedEntityOptionKind = generatedEntityOptionKind;

/** Enum descriptor for `EntityOption.Kind`. */
export const EntityOption_KindSchema: GenEnum<EntityOption["kind"]> =
  generatedEntityOptionKindSchema;

/** Enum for `EntityOption.Visibility`. */
export const EntityOption_Visibility: typeof generatedEntityOptionVisibility =
  generatedEntityOptionVisibility;

/** Enum descriptor for `EntityOption.Visibility`. */
export const EntityOption_VisibilitySchema: GenEnum<EntityOption["visibility"]> =
  generatedEntityOptionVisibilitySchema;

/** Schema for `spine.base.FieldPath`. */
export const FieldPathSchema: GenMessage<FieldPath> = generatedFieldPathSchema;

/** Schema for `spine.core.ActorContext`. */
export const ActorContextSchema: GenMessage<ActorContext> = generatedActorContextSchema;

/** Schema for `spine.core.CommandId`. */
export const CommandIdSchema: GenMessage<CommandId> = generatedCommandIdSchema;

/** Schema for `spine.core.Command`. */
export const CommandSchema: GenMessage<Command> = generatedCommandSchema;

/** Schema for `spine.core.Command.SystemProperties`. */
export const Command_SystemPropertiesSchema: GenMessage<Command_SystemProperties> =
  generatedCommandSystemPropertiesSchema;

/** Schema for `spine.core.CommandContext`. */
export const CommandContextSchema: GenMessage<CommandContext> = generatedCommandContextSchema;

/** Schema for `spine.core.CommandContext.Schedule`. */
export const CommandContext_ScheduleSchema: GenMessage<CommandContext_Schedule> =
  generatedCommandContextScheduleSchema;

/** Schema for `spine.core.MessageId`. */
export const MessageIdSchema: GenMessage<MessageId> = generatedMessageIdSchema;

/** Schema for `spine.core.Origin`. */
export const OriginSchema: GenMessage<Origin> = generatedOriginSchema;

/** Schema for `spine.core.Enrichment`. */
export const EnrichmentSchema: GenMessage<Enrichment> = generatedEnrichmentSchema;

/** Schema for `spine.core.Enrichment.Container`. */
export const Enrichment_ContainerSchema: GenMessage<Enrichment_Container> =
  generatedEnrichmentContainerSchema;

/** Schema for `spine.core.EventId`. */
export const EventIdSchema: GenMessage<EventId> = generatedEventIdSchema;

/** Schema for `spine.core.Event`. */
export const EventSchema: GenMessage<Event> = generatedEventSchema;

/** Schema for `spine.core.EventContext`. */
export const EventContextSchema: GenMessage<EventContext> = generatedEventContextSchema;

/** Schema for `spine.core.RejectionEventContext`. */
export const RejectionEventContextSchema: GenMessage<RejectionEventContext> =
  generatedRejectionEventContextSchema;

/** Schema for `spine.core.TenantId`. */
export const TenantIdSchema: GenMessage<TenantId> = generatedTenantIdSchema;

/** Schema for `spine.core.UserId`. */
export const UserIdSchema: GenMessage<UserId> = generatedUserIdSchema;

/** Schema for `spine.core.Version`. */
export const VersionSchema: GenMessage<Version> = generatedVersionSchema;

/** Schema for `spine.net.EmailAddress`. */
export const EmailAddressSchema: GenMessage<EmailAddress> = generatedEmailAddressSchema;

/** Schema for `EntityOption`. */
export const EntityOptionSchema: GenMessage<EntityOption> = generatedEntityOptionSchema;

/** Schema for `EveryIsOption`. */
export const EveryIsOptionSchema: GenMessage<EveryIsOption> = generatedEveryIsOptionSchema;

/** Schema for `IsOption`. */
export const IsOptionSchema: GenMessage<IsOption> = generatedIsOptionSchema;

/** Schema for `spine.net.InternetDomain`. */
export const InternetDomainSchema: GenMessage<InternetDomain> = generatedInternetDomainSchema;

/** Schema for `spine.string.TemplateString`. */
export const TemplateStringSchema: GenMessage<TemplateString> = generatedTemplateStringSchema;

/** Schema for `spine.time.YearMonth`. */
export const YearMonthSchema: GenMessage<YearMonth> = generatedYearMonthSchema;

/** Schema for `spine.time.LocalDate`. */
export const LocalDateSchema: GenMessage<LocalDate> = generatedLocalDateSchema;

/** Schema for `spine.time.LocalTime`. */
export const LocalTimeSchema: GenMessage<LocalTime> = generatedLocalTimeSchema;

/** Schema for `spine.time.LocalDateTime`. */
export const LocalDateTimeSchema: GenMessage<LocalDateTime> = generatedLocalDateTimeSchema;

/** Schema for `spine.time.ZoneId`. */
export const ZoneIdSchema: GenMessage<ZoneId> = generatedZoneIdSchema;

/** Schema for `spine.time.ZonedDateTime`. */
export const ZonedDateTimeSchema: GenMessage<ZonedDateTime> = generatedZonedDateTimeSchema;

/** Schema for `spine.validation.ValidationError`. */
export const ValidationErrorSchema: GenMessage<ValidationError> = generatedValidationErrorSchema;

/** Schema for `spine.validation.ConstraintViolation`. */
export const ConstraintViolationSchema: GenMessage<ConstraintViolation> =
  generatedConstraintViolationSchema;
