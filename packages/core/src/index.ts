import { clone, create, fromBinary, getOption, hasOption, toBinary } from "@bufbuild/protobuf";
import type { DescField, Message, MessageInitShape, MessageShape } from "@bufbuild/protobuf";
import type { GenExtension, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema, type Any, type FileOptions } from "@bufbuild/protobuf/wkt";
import { validate as validateWithSpine } from "@spine-event-engine/validation-ts";
import {
  ActorContextSchema,
  type Command,
  type CommandContext,
  CommandContextSchema,
  type CommandId,
  CommandIdSchema,
  CommandSchema,
  CommandContext_ScheduleSchema,
  Command_SystemPropertiesSchema,
  ConstraintViolationSchema,
  EmailAddressSchema,
  EnrichmentSchema,
  Enrichment_ContainerSchema,
  type Event,
  type EventContext,
  EventContextSchema,
  type EventId,
  EventIdSchema,
  EventSchema,
  FieldPathSchema,
  InternetDomainSchema,
  LocalDateSchema,
  LocalDateTimeSchema,
  LocalTimeSchema,
  MessageIdSchema,
  OriginSchema,
  RejectionEventContextSchema,
  TemplateStringSchema,
  TenantIdSchema,
  UserIdSchema,
  ValidationErrorSchema,
  VersionSchema,
  YearMonthSchema,
  ZoneIdSchema,
  ZonedDateTimeSchema,
  type_url_prefix,
  type ConstraintViolation,
  type ValidationError,
} from "@spine-ts/proto";

const EMPTY_VIOLATIONS: readonly [] = Object.freeze([]);
const REDACTED_VALIDATION_DETAIL = "[redacted]";
const VALIDATION_RUNTIME_FAILURE_MESSAGE = "Validation runtime failed.";
const TRANSITION_RULE_FAILURE_MESSAGE = "Transition validation rule failed.";
const REJECTION_CONSTRUCTOR = Symbol("RejectionThrowable");
const REJECTION_THROWABLES = new WeakSet<object>();

/** Standard Protobuf `Any` prefix used when a file has no Spine type URL option. */
export const DEFAULT_TYPE_URL_PREFIX = "type.googleapis.com";

/** Protobuf-ES schema shape accepted by the Spine TS type registry. */
export type MessageSchema = GenMessage<Message>;

/** Structured result returned by {@link validateMessage}. */
export type MessageValidationResult =
  | {
      /** The message satisfied all single-message validation constraints. */
      readonly valid: true;
      /** Successful validation has no constraint violations. */
      readonly violations: readonly [];
      /** Successful validation does not allocate a validation error message. */
      readonly error: undefined;
    }
  | {
      /** The message failed validation or the validation runtime failed. */
      readonly valid: false;
      /** Invalid validation results always carry at least one constraint violation. */
      readonly violations: readonly [ConstraintViolation, ...ConstraintViolation[]];
      /** Repo-local Spine validation error message for the violations. */
      readonly error: ValidationError;
    };

/** Framework-owned state transition validation request. */
export interface TransitionValidationRequest<Schema extends MessageSchema = MessageSchema> {
  /** Schema shared by the previous and proposed message states. */
  readonly schema: Schema;
  /** Previous committed state, absent when creating a new state. */
  readonly previous: MessageShape<Schema> | undefined;
  /** Proposed next state to validate before commit. */
  readonly next: MessageShape<Schema>;
}

/** Rule adapter for stateful validation such as Spine `(set_once)`. */
export interface TransitionValidationRule<Schema extends MessageSchema = MessageSchema> {
  /** Return transition-only constraint violations for the proposed state change. */
  validateTransition(request: TransitionValidationRequest<Schema>): readonly ConstraintViolation[];
}

/** Structured result returned by {@link validateTransition}. */
export type TransitionValidationResult = MessageValidationResult;

/** Create a repo-local Spine `ValidationError` message from constraint violations. */
export function createValidationError(violations: readonly ConstraintViolation[]): ValidationError {
  return create(ValidationErrorSchema, { constraintViolation: [...violations] });
}

/** Error thrown when a Protobuf message fails Spine single-message validation. */
export class ValidationException extends Error {
  /** Constraint violations captured from the structured validation error. */
  readonly violations: readonly ConstraintViolation[];
  readonly #messageData: ValidationError;

  /** Create an exception from structured Spine validation error data. */
  constructor(messageData: ValidationError) {
    super(
      `Message validation failed with ${String(messageData.constraintViolation.length)} violation(s).`,
    );
    this.name = "ValidationException";
    this.#messageData = messageData;
    this.violations = messageData.constraintViolation;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Return the structured Spine `ValidationError` message data. */
  asMessage(): ValidationError {
    return this.#messageData;
  }
}

let instantiateRejection: <Schema extends MessageSchema>(
  schema: Schema,
  messageData: MessageShape<Schema>,
) => RejectionThrowable<Schema>;

/** A nominal domain rejection carrying its generated Protobuf message. */
export class RejectionThrowable<Schema extends MessageSchema = MessageSchema> extends Error {
  readonly #schema: Schema;
  readonly #messageData: MessageShape<Schema>;

  private constructor(
    schema: Schema,
    messageData: MessageShape<Schema>,
    token: typeof REJECTION_CONSTRUCTOR,
  ) {
    super(`Rejected: ${schema.typeName}`);
    if (token !== REJECTION_CONSTRUCTOR) {
      throw new TypeError("RejectionThrowable must be created by its validated factory.");
    }
    this.name = "RejectionThrowable";
    this.#schema = schema;
    this.#messageData = snapshotMessage(schema, messageData);
    Object.setPrototypeOf(this, new.target.prototype);
    REJECTION_THROWABLES.add(this);
    Object.preventExtensions(this);
  }

  static {
    instantiateRejection = <CreatedSchema extends MessageSchema>(
      schema: CreatedSchema,
      messageData: MessageShape<CreatedSchema>,
    ) => new RejectionThrowable<CreatedSchema>(schema, messageData, REJECTION_CONSTRUCTOR);
  }

  /** Generated Protobuf-ES schema for the rejected domain signal. */
  get schema(): Schema {
    return this.#schema;
  }

  /** Return a defensive clone of the snapshotted rejection message. */
  get messageData(): MessageShape<Schema> {
    return snapshotMessage(this.#schema, this.#messageData);
  }

  /** Return a defensive clone, matching Spine JVM's throwable contract. */
  messageThrown(): MessageShape<Schema> {
    return snapshotMessage(this.#schema, this.#messageData);
  }
}

/** Check whether a value is a factory-created domain rejection throwable. */
export function isRejectionThrowable(value: unknown): value is RejectionThrowable {
  return typeof value === "object" && value !== null && REJECTION_THROWABLES.has(value);
}

/**
 * Validate, snapshot, and wrap a generated rejection message in a nominal throwable.
 *
 * The schema must describe a top-level message declared in a source file whose
 * name ends in `rejections.proto`.
 *
 * @throws `TypeError` if the schema is not an eligible rejection message.
 * @throws {@link ValidationException} if the rejection payload is invalid.
 */
export function createRejectionThrowable<Schema extends MessageSchema>(
  schema: Schema,
  input: MessageInitShape<Schema>,
): RejectionThrowable<Schema> {
  assertRejectionSchema(schema);
  const messageData = checkValid(schema, create(schema, input));

  return instantiateRejection(schema, messageData);
}

/** Validate one Protobuf message through the Spine TS validation facade. */
export function validateMessage<Schema extends MessageSchema>(
  schema: Schema,
  message: MessageShape<Schema>,
): MessageValidationResult {
  try {
    return createValidationResult(validateWithSpine(schema, message).map(toConstraintViolation));
  } catch {
    return createValidationResult([
      createFacadeFailureViolation(schema.typeName, VALIDATION_RUNTIME_FAILURE_MESSAGE),
    ]);
  }
}

/** Validate one Protobuf message and throw if it has constraint violations. */
export function checkValid<Schema extends MessageSchema>(
  schema: Schema,
  message: MessageShape<Schema>,
): MessageShape<Schema> {
  const result = validateMessage(schema, message);

  if (!result.valid) {
    throw new ValidationException(result.error);
  }

  return message;
}

/** Run framework-owned transition validation rules for a previous/next state pair. */
export function validateTransition<Schema extends MessageSchema>(
  request: TransitionValidationRequest<Schema>,
  rules: readonly TransitionValidationRule<Schema>[] = [],
): TransitionValidationResult {
  const violations: ConstraintViolation[] = [];

  for (const rule of rules) {
    try {
      violations.push(...rule.validateTransition(request).map(toConstraintViolation));
    } catch {
      violations.push(
        createFacadeFailureViolation(request.schema.typeName, TRANSITION_RULE_FAILURE_MESSAGE),
      );
    }
  }

  return createValidationResult(violations);
}

/** Options for registering a schema in a {@link TypeRegistry}. */
export interface RegisterTypeOptions {
  /**
   * Explicit type URL for precomputed/generated metadata.
   *
   * Most callers should omit this and let the registry derive the URL from the
   * schema file's Spine `type_url_prefix` option.
   */
  readonly typeUrl?: string;
  /** Semantic marker tags from Spine `(is)` or `(every_is)` metadata. */
  readonly semanticTags?: readonly string[];
}

/** Descriptor-backed metadata for a registered Protobuf message schema. */
export interface TypeMetadata<Schema extends MessageSchema = MessageSchema> {
  /** Fully qualified Protobuf message name, without a leading dot. */
  readonly fullTypeName: Schema["typeName"];
  /** Canonical type URL used in `google.protobuf.Any` and Spine routing. */
  readonly typeUrl: string;
  /** Generated Protobuf-ES schema for this message. */
  readonly schema: Schema;
  /** Alias for the schema as the Protobuf-ES message descriptor. */
  readonly descriptor: Schema;
  /** File descriptor that declared the message. */
  readonly fileDescriptor: GenFile;
  /** Protobuf file name with the `.proto` suffix restored. */
  readonly fileName: string;
  /** Prefix that produced {@link TypeMetadata.typeUrl}. */
  readonly typeUrlPrefix: string;
  /** First declared field, preserving Protobuf source declaration order. */
  readonly firstField: DescField | undefined;
  /** First declared field name, when the descriptor exposes one. */
  readonly firstFieldName: string | undefined;
  /** Semantic tags explicitly registered for this schema. */
  readonly semanticTags: readonly string[];
  /** Check whether a file option is set on this schema's file descriptor. */
  hasFileOption<Value>(option: FileOptionExtension<Value>): boolean;
  /** Read a file option from this schema's file descriptor. */
  getFileOption<Value>(option: FileOptionExtension<Value>): Value;
}

/** Protobuf extension descriptor whose extendee is `google.protobuf.FileOptions`. */
export type FileOptionExtension<Value = unknown> = GenExtension<FileOptions, Value>;

/** Read-only lookup surface for a registry whose registrations are already fixed. */
export interface TypeRegistryLookup {
  /** Find metadata by fully qualified Protobuf type name. */
  findByFullName(fullTypeName: string): TypeMetadata | undefined;
  /** Find metadata by canonical type URL. */
  findByTypeUrl(typeUrl: string): TypeMetadata | undefined;
  /** Find metadata by generated schema identity. */
  findBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> | undefined;
  /** Find all metadata entries tagged with a semantic marker. */
  findBySemanticTag(semanticTag: string): readonly TypeMetadata[];
  /** Get metadata by fully qualified Protobuf type name or throw a descriptive error. */
  getByFullName(fullTypeName: string): TypeMetadata;
  /** Get metadata by canonical type URL or throw a descriptive error. */
  getByTypeUrl(typeUrl: string): TypeMetadata;
  /** Get metadata by generated schema identity or throw a descriptive error. */
  getBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema>;
  /** Return all registered metadata in registration order. */
  list(): readonly TypeMetadata[];
}

/** Options for deriving a schema type URL. */
export interface DeriveTypeUrlOptions {
  /**
   * Prefix used when the schema file has no Spine `type_url_prefix` option.
   * Trailing `/` separators are removed; empty or whitespace-containing values
   * are rejected with `TypeError`.
   */
  readonly fallbackPrefix?: string;
}

/** Options for Spine-aware `google.protobuf.Any` payload packing. */
export interface PackAnyOptions {
  /**
   * Validate the enclosed domain message before serialization.
   *
   * Validation is enabled by default. Set this to `false` only for messages
   * already validated by a trusted caller.
   */
  readonly validate?: boolean;
}

/** Input for creating a generated Spine `Command` envelope from a domain message. */
export interface PackCommandInput<
  Schema extends MessageSchema = MessageSchema,
> extends PackAnyOptions {
  /** Caller-supplied generated command ID. */
  readonly id: CommandId;
  /** Caller-supplied generated command context. */
  readonly context: CommandContext;
  /** Schema of the enclosed domain command message. */
  readonly schema: Schema;
  /** Already-built domain command message to validate and pack. */
  readonly message: MessageShape<Schema>;
}

/** Input for creating a generated Spine `Event` envelope from a domain message. */
export interface PackEventInput<
  Schema extends MessageSchema = MessageSchema,
> extends PackAnyOptions {
  /** Caller-supplied generated event ID. */
  readonly id: EventId;
  /** Caller-supplied generated event context. */
  readonly context: EventContext;
  /** Schema of the enclosed domain event message. */
  readonly schema: Schema;
  /** Already-built domain event message to validate and pack. */
  readonly message: MessageShape<Schema>;
}

/**
 * Derive the deterministic type URL for a Protobuf-ES message schema.
 *
 * @throws TypeError when the selected custom fallback normalizes to empty or
 *   contains whitespace.
 */
export function deriveTypeUrl(schema: MessageSchema, options: DeriveTypeUrlOptions = {}): string {
  const typeUrlPrefix = getTypeUrlPrefix(schema, options.fallbackPrefix);

  return `${typeUrlPrefix.replace(/\/+$/u, "")}/${schema.typeName}`;
}

/**
 * Pack a Protobuf-ES message into `Any` using Spine type URL derivation.
 *
 * Unknown fields are omitted from the serialized payload for stable framework
 * packing. Protobuf-ES 2.12.1 does not expose deterministic map-key ordering.
 */
export function packAny<Schema extends MessageSchema>(
  schema: Schema,
  message: MessageShape<Schema>,
  options: PackAnyOptions = {},
): Any {
  if (options.validate !== false) {
    checkValid(schema, message);
  }

  return create(AnySchema, {
    typeUrl: deriveTypeUrl(schema),
    value: toBinary(schema, message, { writeUnknownFields: false }),
  });
}

/** Unpack an `Any` only when its type URL exactly matches the requested schema. */
export function unpackAny<Schema extends MessageSchema>(
  packed: Any,
  schema: Schema,
): MessageShape<Schema> | undefined {
  if (packed.typeUrl !== deriveTypeUrl(schema)) {
    return undefined;
  }

  try {
    return fromBinary(schema, packed.value);
  } catch {
    return undefined;
  }
}

/** Create a generated Spine `Command` envelope from a caller-supplied payload, ID, and context. */
export function packCommand<Schema extends MessageSchema>(
  input: PackCommandInput<Schema>,
): Command {
  return create(CommandSchema, {
    id: clone(CommandIdSchema, input.id),
    message: packAny(input.schema, input.message, input),
    context: clone(CommandContextSchema, input.context),
  });
}

/** Create a generated Spine `Event` envelope from a caller-supplied payload, ID, and context. */
export function packEvent<Schema extends MessageSchema>(input: PackEventInput<Schema>): Event {
  return create(EventSchema, {
    id: clone(EventIdSchema, input.id),
    message: packAny(input.schema, input.message, input),
    context: clone(EventContextSchema, input.context),
  });
}

/**
 * Return the type URL prefix that applies to the given schema.
 *
 * Fallback prefixes have trailing `/` separators removed and must then be
 * non-empty and contain no whitespace. A schema file's Spine option takes
 * precedence without validating an unused fallback.
 */
export function getTypeUrlPrefix(
  schema: MessageSchema,
  fallbackPrefix: string = DEFAULT_TYPE_URL_PREFIX,
): string {
  if (hasOption(schema.file, type_url_prefix)) {
    return getOption(schema.file, type_url_prefix);
  }

  const normalizedFallbackPrefix = fallbackPrefix.replace(/\/+$/u, "");

  if (normalizedFallbackPrefix.length === 0 || /\s/u.test(normalizedFallbackPrefix)) {
    throw new TypeError("Fallback type URL prefix must be non-empty and contain no whitespace.");
  }

  return normalizedFallbackPrefix;
}

/** Registry for Protobuf schemas, Spine type URLs, and descriptor metadata. */
export class TypeRegistry {
  readonly #byFullName = new Map<string, TypeMetadata>();
  readonly #byTypeUrl = new Map<string, TypeMetadata>();
  readonly #bySemanticTag = new Map<string, TypeMetadata[]>();
  readonly #bySchema = new WeakMap<object, TypeMetadata>();
  readonly #bySchemaDescriptor = new WeakMap<object, TypeMetadata>();

  /** Create a registry and optionally register schemas immediately. */
  constructor(schemas: Iterable<MessageSchema> = []) {
    for (const schema of schemas) {
      this.register(schema);
    }
  }

  /** Register one schema and return its immutable metadata. */
  register<Schema extends MessageSchema>(
    schema: Schema,
    options: RegisterTypeOptions = {},
  ): TypeMetadata<Schema> {
    const fullTypeName = schema.typeName;
    const typeUrl = resolveTypeUrl(schema, options.typeUrl);
    const duplicateFullName = this.#byFullName.get(fullTypeName);
    const duplicateTypeUrl = this.#byTypeUrl.get(typeUrl);
    const schemaIdentityConflict = this.#bySchemaDescriptor.get(schema.proto);

    if (options.typeUrl !== undefined && duplicateTypeUrl !== undefined) {
      throw new Error(
        `Duplicate type URL "${typeUrl}" already registered for Protobuf type ` +
          `"${duplicateTypeUrl.fullTypeName}".`,
      );
    }

    if (duplicateFullName !== undefined) {
      throw new Error(
        `Duplicate Protobuf type name "${fullTypeName}" already registered with type URL ` +
          `"${duplicateFullName.typeUrl}".`,
      );
    }

    if (duplicateTypeUrl !== undefined) {
      throw new Error(
        `Duplicate type URL "${typeUrl}" already registered for Protobuf type ` +
          `"${duplicateTypeUrl.fullTypeName}".`,
      );
    }

    if (schemaIdentityConflict !== undefined) {
      throw new Error(
        `Schema identity conflict for "${schemaIdentityConflict.fullTypeName}": ` +
          `the same descriptor identity was registered as "${fullTypeName}".`,
      );
    }

    const metadata = createTypeMetadata(schema, typeUrl, options.semanticTags);

    this.#byFullName.set(metadata.fullTypeName, metadata);
    this.#byTypeUrl.set(metadata.typeUrl, metadata);
    this.#bySchema.set(schema, metadata);
    this.#bySchemaDescriptor.set(schema.proto, metadata);

    for (const tag of metadata.semanticTags) {
      const entries = this.#bySemanticTag.get(tag) ?? [];
      entries.push(metadata);
      this.#bySemanticTag.set(tag, entries);
    }

    return metadata;
  }

  /** Find metadata by fully qualified Protobuf type name. */
  findByFullName(fullTypeName: string): TypeMetadata | undefined {
    return this.#byFullName.get(fullTypeName);
  }

  /** Find metadata by canonical type URL. */
  findByTypeUrl(typeUrl: string): TypeMetadata | undefined {
    return this.#byTypeUrl.get(typeUrl);
  }

  /** Find metadata by generated schema identity. */
  findBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> | undefined {
    return this.#bySchema.get(schema) as TypeMetadata<Schema> | undefined;
  }

  /** Find all metadata entries tagged with a semantic marker. */
  findBySemanticTag(semanticTag: string): readonly TypeMetadata[] {
    return [...(this.#bySemanticTag.get(semanticTag) ?? [])];
  }

  /** Get metadata by fully qualified Protobuf type name or throw a descriptive error. */
  getByFullName(fullTypeName: string): TypeMetadata {
    const metadata = this.findByFullName(fullTypeName);

    if (metadata === undefined) {
      throw new Error(`No schema registered for Protobuf type name "${fullTypeName}".`);
    }

    return metadata;
  }

  /** Get metadata by canonical type URL or throw a descriptive error. */
  getByTypeUrl(typeUrl: string): TypeMetadata {
    const metadata = this.findByTypeUrl(typeUrl);

    if (metadata === undefined) {
      throw new Error(`No schema registered for type URL "${typeUrl}".`);
    }

    return metadata;
  }

  /** Get metadata by generated schema identity or throw a descriptive error. */
  getBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> {
    const metadata = this.findBySchema(schema);

    if (metadata === undefined) {
      throw new Error(`No metadata registered for schema "${schema.typeName}".`);
    }

    return metadata;
  }

  /** Return all registered metadata in registration order. */
  list(): readonly TypeMetadata[] {
    return [...this.#byFullName.values()];
  }
}

/** Build a registry containing the currently curated Spine schemas. */
export function createSpineCoreRegistry(): TypeRegistry {
  return new TypeRegistry([
    FieldPathSchema,
    TemplateStringSchema,
    ActorContextSchema,
    CommandIdSchema,
    CommandSchema,
    Command_SystemPropertiesSchema,
    CommandContextSchema,
    CommandContext_ScheduleSchema,
    MessageIdSchema,
    OriginSchema,
    EnrichmentSchema,
    Enrichment_ContainerSchema,
    EventIdSchema,
    EventSchema,
    EventContextSchema,
    RejectionEventContextSchema,
    TenantIdSchema,
    UserIdSchema,
    VersionSchema,
    EmailAddressSchema,
    InternetDomainSchema,
    YearMonthSchema,
    LocalDateSchema,
    LocalTimeSchema,
    LocalDateTimeSchema,
    ZoneIdSchema,
    ZonedDateTimeSchema,
    ValidationErrorSchema,
    ConstraintViolationSchema,
  ]);
}

/** Shared registry for the first curated Spine schema set. */
export const spineCoreRegistry: TypeRegistryLookup =
  createTypeRegistryLookup(createSpineCoreRegistry());

function createTypeRegistryLookup(registry: TypeRegistry): TypeRegistryLookup {
  return Object.freeze({
    findByFullName(fullTypeName: string): TypeMetadata | undefined {
      return registry.findByFullName(fullTypeName);
    },
    findByTypeUrl(typeUrl: string): TypeMetadata | undefined {
      return registry.findByTypeUrl(typeUrl);
    },
    findBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> | undefined {
      return registry.findBySchema(schema);
    },
    findBySemanticTag(semanticTag: string): readonly TypeMetadata[] {
      return registry.findBySemanticTag(semanticTag);
    },
    getByFullName(fullTypeName: string): TypeMetadata {
      return registry.getByFullName(fullTypeName);
    },
    getByTypeUrl(typeUrl: string): TypeMetadata {
      return registry.getByTypeUrl(typeUrl);
    },
    getBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> {
      return registry.getBySchema(schema);
    },
    list(): readonly TypeMetadata[] {
      return registry.list();
    },
  });
}

function resolveTypeUrl(schema: MessageSchema, explicitTypeUrl: string | undefined): string {
  if (explicitTypeUrl === undefined) {
    return deriveTypeUrl(schema);
  }

  validateExplicitTypeUrl(schema, explicitTypeUrl);

  return explicitTypeUrl;
}

function validateExplicitTypeUrl(schema: MessageSchema, typeUrl: string): void {
  const expectedSuffix = `/${schema.typeName}`;
  const prefix = typeUrl.slice(0, typeUrl.length - expectedSuffix.length);

  if (!typeUrl.endsWith(expectedSuffix) || prefix.length === 0) {
    throw new Error(
      `Explicit type URL "${typeUrl}" must have the form "<prefix>/${schema.typeName}".`,
    );
  }
}

function createTypeMetadata<Schema extends MessageSchema>(
  schema: Schema,
  typeUrl: string,
  semanticTags: readonly string[] = [],
): TypeMetadata<Schema> {
  const firstField = schema.fields[0];
  const tags = [...new Set(semanticTags)].sort();
  const metadata: TypeMetadata<Schema> = {
    fullTypeName: schema.typeName,
    typeUrl,
    schema,
    descriptor: schema,
    fileDescriptor: schema.file,
    fileName: `${schema.file.name}.proto`,
    typeUrlPrefix: typeUrl.slice(0, typeUrl.length - schema.typeName.length - 1),
    firstField,
    firstFieldName: firstField?.name,
    semanticTags: Object.freeze(tags),
    hasFileOption<Value>(option: FileOptionExtension<Value>): boolean {
      return hasOption(schema.file, option);
    },
    getFileOption<Value>(option: FileOptionExtension<Value>): Value {
      return getOption(schema.file, option);
    },
  };

  return Object.freeze(metadata);
}

function createValidationResult(
  violations: readonly ConstraintViolation[],
): MessageValidationResult {
  if (violations.length === 0) {
    return {
      valid: true,
      violations: EMPTY_VIOLATIONS,
      error: undefined,
    };
  }

  const nonEmptyViolations = violations as readonly [ConstraintViolation, ...ConstraintViolation[]];

  return {
    valid: false,
    violations: nonEmptyViolations,
    error: createValidationError(nonEmptyViolations),
  };
}

function createFacadeFailureViolation(typeName: string, message: string): ConstraintViolation {
  return create(ConstraintViolationSchema, {
    typeName,
    message: create(TemplateStringSchema, {
      withPlaceholders: message,
    }),
  });
}

interface SanitizableConstraintViolation {
  readonly typeName: string;
  readonly fieldPath?:
    | {
        readonly fieldName: readonly string[];
      }
    | undefined;
  readonly message?:
    | {
        readonly withPlaceholders: string;
        readonly placeholderValue: Record<string, string> | undefined;
      }
    | undefined;
}

function toConstraintViolation(violation: SanitizableConstraintViolation): ConstraintViolation {
  return create(ConstraintViolationSchema, {
    message:
      violation.message === undefined
        ? undefined
        : create(TemplateStringSchema, {
            withPlaceholders: violation.message.withPlaceholders,
            placeholderValue: redactPlaceholderValues(violation.message.placeholderValue),
          }),
    typeName: violation.typeName,
    fieldPath:
      violation.fieldPath === undefined
        ? undefined
        : create(FieldPathSchema, { fieldName: [...violation.fieldPath.fieldName] }),
  });
}

function redactPlaceholderValues(
  values: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(values ?? {}).map((key) => [key, REDACTED_VALIDATION_DETAIL]),
  );
}

function assertRejectionSchema(schema: MessageSchema): void {
  if (schema.parent !== undefined || !schema.file.proto.name.endsWith("rejections.proto")) {
    throw new TypeError(
      `Rejection schema "${schema.typeName}" must be a top-level message declared in a rejections.proto file.`,
    );
  }
}

function snapshotMessage<Schema extends MessageSchema>(
  schema: Schema,
  message: MessageShape<Schema>,
): MessageShape<Schema> {
  return fromBinary(schema, toBinary(schema, message));
}
