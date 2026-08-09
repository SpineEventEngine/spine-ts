import {
  clone,
  create,
  fromBinary,
  fromJsonString,
  getOption,
  hasOption,
  toBinary,
  toJsonString,
} from "@bufbuild/protobuf";
import type { DescField, Message, MessageInitShape, MessageShape } from "@bufbuild/protobuf";
import type { GenExtension, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import {
  AnySchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  type Any,
  type FileOptions,
} from "@bufbuild/protobuf/wkt";
import { validate as validateWithSpine } from "@spine-event-engine/validation";
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
  type ProtoModule,
  type ValidationError,
} from "@spine-event-engine/proto";

const EMPTY_VIOLATIONS: readonly [] = Object.freeze([]);
const REDACTED_VALIDATION_DETAIL = "[redacted]";
const VALIDATION_RUNTIME_FAILURE_MESSAGE = "Validation runtime failed.";
const TRANSITION_RULE_FAILURE_MESSAGE = "Transition validation rule failed.";
const REJECTION_CONSTRUCTOR = Symbol("RejectionThrowable");
const REJECTION_THROWABLES = new WeakSet<object>();

/**
 * Standard Protobuf `Any` prefix used when a file has no Spine type URL option.
 */
export const DEFAULT_TYPE_URL_PREFIX = "type.googleapis.com";

/**
 * Protobuf-ES schema shape accepted by the Spine TS type registry.
 */
export type MessageSchema = GenMessage<Message>;

/**
 * Structured result returned by {@link Validate.message}.
 */
export type MessageValidationResult =
  | {
      // prettier-ignore

      /**
       * The message satisfied all single-message validation constraints.
       */
      readonly valid: true;

      /**
       * Successful validation has no constraint violations.
       */
      readonly violations: readonly [];

      /**
       * Successful validation does not allocate a validation error message.
       */
      readonly error: undefined;
    }
  | {
      // prettier-ignore

      /**
       * The message failed validation or the validation runtime failed.
       */
      readonly valid: false;

      /**
       * Invalid validation results always carry at least one constraint violation.
       */
      readonly violations: readonly [ConstraintViolation, ...ConstraintViolation[]];

      /**
       * Repo-local Spine validation error message for the violations.
       */
      readonly error: ValidationError;
    };

/**
 * Framework-owned state transition validation request.
 */
export interface TransitionValidationRequest<Schema extends MessageSchema = MessageSchema> {
  // prettier-ignore

  /**
   * Schema shared by the previous and proposed message states.
   */
  readonly schema: Schema;

  /**
   * Previous committed state, absent when creating a new state.
   */
  readonly previous: MessageShape<Schema> | undefined;

  /**
   * Proposed next state to validate before commit.
   */
  readonly next: MessageShape<Schema>;
}

/**
 * Rule adapter for stateful validation such as Spine `(set_once)`.
 */
export interface TransitionValidationRule<Schema extends MessageSchema = MessageSchema> {
  // prettier-ignore

  /**
   * Returns transition-only constraint violations for the proposed state change.
   * @param request The previous and proposed state change.
   * @returns The constraint violations found by this rule.
   */
  validateTransition(request: TransitionValidationRequest<Schema>): readonly ConstraintViolation[];
}

/**
 * Structured result returned by {@link Validate.transition}.
 */
export type TransitionValidationResult = MessageValidationResult;

/**
 * Error thrown when a Protobuf message fails Spine single-message validation.
 */
export class ValidationException extends Error {
  // prettier-ignore

  /**
   * Constraint violations captured from the structured validation error.
   */
  readonly violations: readonly ConstraintViolation[];
  readonly #messageData: ValidationError;

  /**
   * Creates an exception from structured Spine validation error data.
   * @param messageData The validation error represented by this exception.
   */
  constructor(messageData: ValidationError) {
    super(
      `Message validation failed with ${String(messageData.constraintViolation.length)} violation(s).`,
    );
    this.name = "ValidationException";
    this.#messageData = messageData;
    this.violations = messageData.constraintViolation;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Returns the structured Spine `ValidationError` message data.
   * @returns The validation error message.
   */
  asMessage(): ValidationError {
    return this.#messageData;
  }
}

let instantiateRejection: <Schema extends MessageSchema>(
  schema: Schema,
  messageData: MessageShape<Schema>,
) => RejectionThrowable<Schema>;

/**
 * A nominal domain rejection carrying its generated Protobuf message.
 */
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
    this.#messageData = RejectionThrowable.snapshot(schema, messageData);
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

  /**
   * Returns the generated Protobuf-ES schema for the rejected domain signal.
   * @returns The rejection schema.
   */
  get schema(): Schema {
    return this.#schema;
  }

  /**
   * Returns a defensive clone of the snapshotted rejection message.
   * @returns The cloned rejection message.
   */
  get messageData(): MessageShape<Schema> {
    return RejectionThrowable.snapshot(this.#schema, this.#messageData);
  }

  /**
   * Returns a defensive clone matching Spine JVM's throwable contract.
   * @returns The cloned rejection message.
   */
  messageThrown(): MessageShape<Schema> {
    return RejectionThrowable.snapshot(this.#schema, this.#messageData);
  }

  /**
   * Creates a nominal throwable from a validated generated rejection message.
   * @param schema The generated rejection schema.
   * @param input The rejection message fields.
   * @returns The validated nominal rejection throwable.
   */
  static create<Schema extends MessageSchema>(
    schema: Schema,
    input: MessageInitShape<Schema>,
  ): RejectionThrowable<Schema> {
    RejectionThrowable.assertSchema(schema);
    return instantiateRejection(schema, Validate.check(schema, create(schema, input)));
  }

  /**
   * Checks whether a value is a factory-created domain rejection throwable.
   * @param value The value to inspect.
   * @returns Whether the value is a trusted rejection throwable.
   */
  static is(value: unknown): value is RejectionThrowable {
    return typeof value === "object" && value !== null && REJECTION_THROWABLES.has(value);
  }

  private static assertSchema(schema: MessageSchema): void {
    if (schema.parent !== undefined || !schema.file.proto.name.endsWith("rejections.proto")) {
      throw new TypeError(
        `Rejection schema "${schema.typeName}" must be a top-level message declared in a rejections.proto file.`,
      );
    }
  }

  private static snapshot<Schema extends MessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): MessageShape<Schema> {
    return fromBinary(schema, toBinary(schema, message));
  }
}

/**
 * Validates Spine messages and proposed state transitions.
 */
export const Validate = {
  // prettier-ignore

  /**
   * Creates a repo-local validation error from constraint violations.
   * @param violations The violations to include.
   * @returns The validation error.
   */
  createError(violations: readonly ConstraintViolation[]): ValidationError {
    return ValidationResults.error(violations);
  },

  /**
   * Validates one Protobuf message through the Spine TS validation facade.
   * @param schema The message schema.
   * @param message The message to validate.
   * @returns The sanitized validation result.
   */
  message<Schema extends MessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): MessageValidationResult {
    try {
      return ValidationResults.from(
        validateWithSpine(schema, message).map((violation) =>
          ValidationResults.violation(violation),
        ),
      );
    } catch {
      return ValidationResults.from([
        ValidationResults.failure(schema.typeName, VALIDATION_RUNTIME_FAILURE_MESSAGE),
      ]);
    }
  },

  /**
   * Validates one Protobuf message and throws for constraint violations.
   * @param schema The message schema.
   * @param message The message to validate.
   * @returns The validated message.
   */
  check<Schema extends MessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
  ): MessageShape<Schema> {
    const result = Validate.message(schema, message);
    if (!result.valid) throw new ValidationException(result.error);
    return message;
  },

  /**
   * Validates a previous/next state pair with framework-owned transition rules.
   * @param request The state transition.
   * @param rules The rules to apply.
   * @returns The sanitized transition result.
   */
  transition<Schema extends MessageSchema>(
    request: TransitionValidationRequest<Schema>,
    rules: readonly TransitionValidationRule<Schema>[] = [],
  ): TransitionValidationResult {
    const violations: ConstraintViolation[] = [];
    for (const rule of rules) {
      try {
        violations.push(
          ...rule
            .validateTransition(request)
            .map((violation) => ValidationResults.violation(violation)),
        );
      } catch {
        violations.push(
          ValidationResults.failure(request.schema.typeName, TRANSITION_RULE_FAILURE_MESSAGE),
        );
      }
    }
    return ValidationResults.from(violations);
  },
} as const;
Object.freeze(Validate);

/**
 * Options for registering a schema in a {@link TypeRegistry}.
 */
export interface RegisterTypeOptions {
  // prettier-ignore

  /**
   * Explicit type URL for precomputed/generated metadata.
   *
   * Most callers should omit this and let the registry derive the URL from the
   * schema file's Spine `type_url_prefix` option.
   */
  readonly typeUrl?: string;

  /**
   * Semantic marker tags from Spine `(is)` or `(every_is)` metadata.
   */
  readonly semanticTags?: readonly string[];
}

/**
 * Descriptor-backed metadata for a registered Protobuf message schema.
 */
export interface TypeMetadata<Schema extends MessageSchema = MessageSchema> {
  // prettier-ignore

  /**
   * Fully qualified Protobuf message name, without a leading dot.
   */
  readonly fullTypeName: Schema["typeName"];

  /**
   * Canonical type URL used in `google.protobuf.Any` and Spine routing.
   */
  readonly typeUrl: string;

  /**
   * Generated Protobuf-ES schema for this message.
   */
  readonly schema: Schema;

  /**
   * Alias for the schema as the Protobuf-ES message descriptor.
   */
  readonly descriptor: Schema;

  /**
   * File descriptor that declared the message.
   */
  readonly fileDescriptor: GenFile;

  /**
   * Protobuf file name with the `.proto` suffix restored.
   */
  readonly fileName: string;

  /**
   * Prefix that produced {@link TypeMetadata.typeUrl}.
   */
  readonly typeUrlPrefix: string;

  /**
   * First declared field, preserving Protobuf source declaration order.
   */
  readonly firstField: DescField | undefined;

  /**
   * First declared field name, when the descriptor exposes one.
   */
  readonly firstFieldName: string | undefined;

  /**
   * Semantic tags explicitly registered for this schema.
   */
  readonly semanticTags: readonly string[];

  /**
   * Checks whether a file option is set on this schema's file descriptor.
   * @param option The file option extension.
   * @returns Whether the option is present.
   */
  hasFileOption<Value>(option: FileOptionExtension<Value>): boolean;

  /**
   * Reads a file option from this schema's file descriptor.
   * @param option The file option extension.
   * @returns The extension value.
   */
  getFileOption<Value>(option: FileOptionExtension<Value>): Value;
}

/**
 * Protobuf extension descriptor whose extendee is `google.protobuf.FileOptions`.
 */
export type FileOptionExtension<Value = unknown> = GenExtension<FileOptions, Value>;

/**
 * Read-only lookup surface for a registry whose registrations are already fixed.
 */
export interface TypeRegistryLookup {
  // prettier-ignore

  /**
   * Finds metadata by fully qualified Protobuf type name.
   * @param fullTypeName The Protobuf type name.
   * @returns Matching metadata, if registered.
   */
  findByFullName(fullTypeName: string): TypeMetadata | undefined;

  /**
   * Finds metadata by canonical type URL.
   * @param typeUrl The canonical type URL.
   * @returns Matching metadata, if registered.
   */
  findByTypeUrl(typeUrl: string): TypeMetadata | undefined;

  /**
   * Finds metadata by generated schema identity.
   * @param schema The generated message schema.
   * @returns Matching metadata, if registered.
   */
  findBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> | undefined;

  /**
   * Finds all metadata entries tagged with a semantic marker.
   * @param semanticTag The semantic marker.
   * @returns The matching metadata entries.
   */
  findBySemanticTag(semanticTag: string): readonly TypeMetadata[];

  /**
   * Gets metadata by fully qualified Protobuf type name or throws a descriptive error.
   * @param fullTypeName The Protobuf type name.
   * @returns The registered metadata.
   */
  getByFullName(fullTypeName: string): TypeMetadata;

  /**
   * Gets metadata by canonical type URL or throws a descriptive error.
   * @param typeUrl The canonical type URL.
   * @returns The registered metadata.
   */
  getByTypeUrl(typeUrl: string): TypeMetadata;

  /**
   * Gets metadata by generated schema identity or throws a descriptive error.
   * @param schema The generated message schema.
   * @returns The registered metadata.
   */
  getBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema>;

  /**
   * Returns all registered metadata in registration order.
   * @returns The registered metadata entries.
   */
  list(): readonly TypeMetadata[];
}

/**
 * Options for deriving a schema type URL.
 */
export interface DeriveTypeUrlOptions {
  // prettier-ignore

  /**
   * Prefix used when the schema file has no Spine `type_url_prefix` option.
   * Trailing `/` separators are removed; empty or whitespace-containing values
   * are rejected with `TypeError`.
   */
  readonly fallbackPrefix?: string;
}

/**
 * Options for Spine-aware `google.protobuf.Any` payload packing.
 */
export interface PackAnyOptions {
  // prettier-ignore

  /**
   * Validate the enclosed domain message before serialization.
   *
   * Validation is enabled by default. Set this to `false` only for messages
   * already validated by a trusted caller.
   */
  readonly validate?: boolean;
}

/**
 * Input for creating a generated Spine `Command` envelope from a domain message.
 */
export interface PackCommandInput<
  Schema extends MessageSchema = MessageSchema,
> extends PackAnyOptions {
  // prettier-ignore

  /**
   * Caller-supplied generated command ID.
   */
  readonly id: CommandId;

  /**
   * Caller-supplied generated command context.
   */
  readonly context: CommandContext;

  /**
   * Schema of the enclosed domain command message.
   */
  readonly schema: Schema;

  /**
   * Already-built domain command message to validate and pack.
   */
  readonly message: MessageShape<Schema>;
}

/**
 * Input for creating a generated Spine `Event` envelope from a domain message.
 */
export interface PackEventInput<
  Schema extends MessageSchema = MessageSchema,
> extends PackAnyOptions {
  // prettier-ignore

  /**
   * Caller-supplied generated event ID.
   */
  readonly id: EventId;

  /**
   * Caller-supplied generated event context.
   */
  readonly context: EventContext;

  /**
   * Schema of the enclosed domain event message.
   */
  readonly schema: Schema;

  /**
   * Already-built domain event message to validate and pack.
   */
  readonly message: MessageShape<Schema>;
}

/**
 * Derives canonical Spine type URLs and validates explicit URLs.
 */
export const TypeUrls = {
  // prettier-ignore

  /**
   * Calculates the deterministic type URL for a Protobuf-ES message schema.
   * @param schema The message schema.
   * @param options The fallback options.
   * @returns The canonical type URL.
   */
  derive(schema: MessageSchema, options: DeriveTypeUrlOptions = {}): string {
    return `${TypeUrls.prefix(schema, options.fallbackPrefix).replace(/\/+$/u, "")}/${schema.typeName}`;
  },

  /**
   * Returns the type URL prefix that applies to a schema.
   * @param schema The message schema.
   * @param fallbackPrefix The fallback prefix.
   * @returns The canonical prefix.
   */
  prefix(schema: MessageSchema, fallbackPrefix: string = DEFAULT_TYPE_URL_PREFIX): string {
    if (hasOption(schema.file, type_url_prefix)) return getOption(schema.file, type_url_prefix);
    const normalizedFallbackPrefix = fallbackPrefix.replace(/\/+$/u, "");
    if (normalizedFallbackPrefix.length === 0 || /\s/u.test(normalizedFallbackPrefix)) {
      throw new TypeError("Fallback type URL prefix must be non-empty and contain no whitespace.");
    }
    return normalizedFallbackPrefix;
  },

  /**
   * Resolves an explicit or derived type URL for a schema registration.
   * @param schema The message schema.
   * @param explicitTypeUrl The explicit type URL.
   * @returns The resolved type URL.
   */
  resolve(schema: MessageSchema, explicitTypeUrl: string | undefined): string {
    if (explicitTypeUrl === undefined) return TypeUrls.derive(schema);
    TypeUrls.validate(schema, explicitTypeUrl);
    return explicitTypeUrl;
  },

  /**
   * Validates an explicit type URL for a schema registration.
   * @param schema The message schema.
   * @param typeUrl The type URL to validate.
   */
  validate(schema: MessageSchema, typeUrl: string): void {
    const expectedSuffix = `/${schema.typeName}`;
    const prefix = typeUrl.slice(0, typeUrl.length - expectedSuffix.length);
    if (!typeUrl.endsWith(expectedSuffix) || prefix.length === 0) {
      throw new Error(
        `Explicit type URL "${typeUrl}" must have the form "<prefix>/${schema.typeName}".`,
      );
    }
  },
} as const;
Object.freeze(TypeUrls);

/**
 * Packs and unpacks Spine messages in `google.protobuf.Any` envelopes.
 */
export const AnyMessages = {
  // prettier-ignore

  /**
   * Packs a message into `Any`, omitting unknown fields from binary output.
   * @param schema The message schema.
   * @param message The message to pack.
   * @param options The packing options.
   * @returns The packed Any message.
   */
  pack<Schema extends MessageSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
    options: PackAnyOptions = {},
  ): Any {
    if (options.validate !== false) Validate.check(schema, message);
    return create(AnySchema, {
      typeUrl: TypeUrls.derive(schema),
      value: toBinary(schema, message, { writeUnknownFields: false }),
    });
  },

  /**
   * Unpacks an `Any` when its type URL exactly matches the requested schema.
   * @param packed The packed message.
   * @param schema The expected schema.
   * @returns The unpacked message, when valid.
   */
  unpack<Schema extends MessageSchema>(
    packed: Any,
    schema: Schema,
  ): MessageShape<Schema> | undefined {
    if (packed.typeUrl !== TypeUrls.derive(schema)) return undefined;
    try {
      return fromBinary(schema, packed.value);
    } catch {
      return undefined;
    }
  },

  /**
   * Unpacks an `Any` when its exact type URL is registered.
   * @param registry The schema registry.
   * @param packed The packed message.
   * @returns The unpacked message, when valid.
   */
  unpackUsing(registry: TypeRegistryLookup, packed: Any): Message | undefined {
    const metadata = registry.findByTypeUrl(packed.typeUrl);
    if (metadata === undefined) return undefined;
    try {
      return fromBinary(metadata.schema, packed.value);
    } catch {
      return undefined;
    }
  },
} as const;
Object.freeze(AnyMessages);

/**
 * Converts one value to and from its stable string representation.
 */
export interface Stringifier<T> {
  // prettier-ignore

  /**
   * Restores a value from its string representation.
   * @param value The stored string.
   * @returns The restored value.
   */
  fromString(value: string): T;

  /**
   * Converts a value to its string representation.
   * @param value The value to convert.
   * @returns The stored string.
   */
  toString(value: T): string;
}

/**
 * Supplies reversible default stringifiers for generated Protobuf messages.
 */
export const Stringifiers = {
  // prettier-ignore

  /**
   * Creates the default compact Proto JSON stringifier for a message schema.
   * @param schema The generated message schema.
   * @returns A reversible schema-bound stringifier.
   */
  forMessage<Schema extends MessageSchema>(schema: Schema): Stringifier<MessageShape<Schema>> {
    return Object.freeze({
      fromString(value: string): MessageShape<Schema> {
        return fromJsonString(schema, value);
      },
      toString(value: MessageShape<Schema>): string {
        return toJsonString(schema, value);
      },
    });
  },
} as const;
Object.freeze(Stringifiers);

/**
 * Holds schema-bound custom stringifiers with Proto JSON defaults.
 */
export class StringifierRegistry {
  readonly #registered = new Map<string, Stringifier<Message>>();

  /**
   * Registers or replaces the stringifier for one generated message type.
   * @param schema The generated message schema.
   * @param stringifier The reversible stringifier.
   */
  register<Schema extends MessageSchema>(
    schema: Schema,
    stringifier: Stringifier<MessageShape<Schema>>,
  ): void {
    this.#registered.set(schema.typeName, stringifier);
  }

  /**
   * Returns the custom stringifier or the default compact Proto JSON mapping.
   * @param schema The generated message schema.
   * @returns The schema-bound stringifier.
   */
  forMessage<Schema extends MessageSchema>(schema: Schema): Stringifier<MessageShape<Schema>> {
    const registered = this.#registered.get(schema.typeName);

    return registered === undefined
      ? Stringifiers.forMessage(schema)
      : (registered as Stringifier<MessageShape<Schema>>);
  }
}

/**
 * Primitive identifier kinds supported by Spine JVM storage.
 */
export type PrimitiveIdentifierType = "string" | "int32" | "int64";

interface IdentifierCodec {
  pack<Schema extends MessageSchema>(schema: Schema, value: MessageShape<Schema>): Any;
  pack(type: "string", value: string): Any;
  pack(type: "int32", value: number): Any;
  pack(type: "int64", value: bigint): Any;
  unpack<Schema extends MessageSchema>(
    schema: Schema,
    value: Any,
  ): MessageShape<Schema> | undefined;
  unpack(type: "string", value: Any): string | undefined;
  unpack(type: "int32", value: Any): number | undefined;
  unpack(type: "int64", value: Any): bigint | undefined;
}

/**
 * Packs and unpacks the identifier types supported by Spine JVM storage.
 */
export const Identifiers: IdentifierCodec = {
  pack: packIdentifier,
  unpack: unpackIdentifier,
};
Object.freeze(Identifiers);

const IdentifierValues = Object.freeze({
  int32(value: unknown): number {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < -(2 ** 31) ||
      value >= 2 ** 31
    ) {
      throw new RangeError("Identifier is outside the int32 range.");
    }
    return value;
  },

  int64(value: unknown): bigint {
    if (typeof value !== "bigint" || value < -(1n << 63n) || value >= 1n << 63n) {
      throw new RangeError("Identifier is outside the int64 range.");
    }
    return value;
  },
});

function packIdentifier<Schema extends MessageSchema>(
  schema: Schema,
  value: MessageShape<Schema>,
): Any;
function packIdentifier(type: "string", value: string): Any;
function packIdentifier(type: "int32", value: number): Any;
function packIdentifier(type: "int64", value: bigint): Any;
function packIdentifier(
  type: MessageSchema | PrimitiveIdentifierType,
  value: Message | string | number | bigint,
): Any {
  if (typeof type !== "string") {
    return AnyMessages.pack(type, value as Message, { validate: false });
  }
  switch (type) {
    case "string":
      if (typeof value !== "string") throw new TypeError("Identifier must be a string.");
      return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value }), {
        validate: false,
      });
    case "int32":
      return AnyMessages.pack(
        Int32ValueSchema,
        create(Int32ValueSchema, { value: IdentifierValues.int32(value) }),
        { validate: false },
      );
    case "int64":
      return AnyMessages.pack(
        Int64ValueSchema,
        create(Int64ValueSchema, { value: IdentifierValues.int64(value) }),
        { validate: false },
      );
  }
}

function unpackIdentifier<Schema extends MessageSchema>(
  schema: Schema,
  value: Any,
): MessageShape<Schema> | undefined;
function unpackIdentifier(type: "string", value: Any): string | undefined;
function unpackIdentifier(type: "int32", value: Any): number | undefined;
function unpackIdentifier(type: "int64", value: Any): bigint | undefined;
function unpackIdentifier(
  type: MessageSchema | PrimitiveIdentifierType,
  value: Any,
): Message | string | number | bigint | undefined {
  if (typeof type !== "string") return AnyMessages.unpack(value, type);
  switch (type) {
    case "string":
      return AnyMessages.unpack(value, StringValueSchema)?.value;
    case "int32":
      return AnyMessages.unpack(value, Int32ValueSchema)?.value;
    case "int64":
      return AnyMessages.unpack(value, Int64ValueSchema)?.value;
  }
}

/**
 * Creates generated Spine command and event envelopes.
 */
export const SignalEnvelopes = {
  // prettier-ignore

  /**
   * Packs a generated Spine command envelope from caller-supplied data.
   * @param input The command envelope input.
   * @returns The packed command.
   */
  command<Schema extends MessageSchema>(input: PackCommandInput<Schema>): Command {
    return create(CommandSchema, {
      id: clone(CommandIdSchema, input.id),
      message: AnyMessages.pack(input.schema, input.message, input),
      context: clone(CommandContextSchema, input.context),
    });
  },

  /**
   * Packs a generated Spine event envelope from caller-supplied data.
   * @param input The event envelope input.
   * @returns The packed event.
   */
  event<Schema extends MessageSchema>(input: PackEventInput<Schema>): Event {
    return create(EventSchema, {
      id: clone(EventIdSchema, input.id),
      message: AnyMessages.pack(input.schema, input.message, input),
      context: clone(EventContextSchema, input.context),
    });
  },
} as const;
Object.freeze(SignalEnvelopes);

/**
 * Registry for Protobuf schemas, Spine type URLs, and descriptor metadata.
 */
export class TypeRegistry {
  readonly #byFullName = new Map<string, TypeMetadata>();
  readonly #byTypeUrl = new Map<string, TypeMetadata>();
  readonly #bySemanticTag = new Map<string, TypeMetadata[]>();
  readonly #bySchema = new WeakMap<object, TypeMetadata>();
  readonly #bySchemaDescriptor = new WeakMap<object, TypeMetadata>();

  /**
   * Creates a registry and optionally registers schemas immediately.
   * @param schemas The schemas to register.
   */
  constructor(schemas: Iterable<MessageSchema> = []) {
    for (const schema of schemas) {
      this.register(schema);
    }
  }

  /**
   * Creates a registry from modules in deterministic dependency-first order.
   * @param modules The modules to compose.
   * @returns The composed registry.
   */
  static from(...modules: readonly ProtoModule[]): TypeRegistry {
    const definitions = new Map<string, ProtoModule>();
    const visiting = new Set<string>();
    const verified = new WeakSet<ProtoModule>();
    const schemas: MessageSchema[] = [];

    for (const module of modules) {
      RegistryLookups.compose(module, definitions, visiting, verified, schemas);
    }

    return new TypeRegistry(schemas);
  }

  /**
   * Creates a registry containing the currently curated Spine schemas.
   * @returns The mutable curated registry.
   */
  static spineCore(): TypeRegistry {
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

  /**
   * Registers one schema and returns its immutable metadata.
   * @param schema The generated message schema.
   * @param options Optional type URL and semantic tag metadata.
   * @returns The registered schema metadata.
   */
  register<Schema extends MessageSchema>(
    schema: Schema,
    options: RegisterTypeOptions = {},
  ): TypeMetadata<Schema> {
    const fullTypeName = schema.typeName;
    const typeUrl = TypeUrls.resolve(schema, options.typeUrl);
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

    const metadata = RegistryLookups.metadata(schema, typeUrl, options.semanticTags);

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

  /**
   * Finds metadata by fully qualified Protobuf type name.
   * @param fullTypeName The Protobuf type name.
   * @returns Matching metadata, if registered.
   */
  findByFullName(fullTypeName: string): TypeMetadata | undefined {
    return this.#byFullName.get(fullTypeName);
  }

  /**
   * Finds metadata by canonical type URL.
   * @param typeUrl The canonical type URL.
   * @returns Matching metadata, if registered.
   */
  findByTypeUrl(typeUrl: string): TypeMetadata | undefined {
    return this.#byTypeUrl.get(typeUrl);
  }

  /**
   * Finds metadata by generated schema identity.
   * @param schema The generated message schema.
   * @returns Matching metadata, if registered.
   */
  findBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> | undefined {
    return this.#bySchema.get(schema) as TypeMetadata<Schema> | undefined;
  }

  /**
   * Finds all metadata entries tagged with a semantic marker.
   * @param semanticTag The semantic marker.
   * @returns The matching metadata entries.
   */
  findBySemanticTag(semanticTag: string): readonly TypeMetadata[] {
    return [...(this.#bySemanticTag.get(semanticTag) ?? [])];
  }

  /**
   * Gets metadata by fully qualified Protobuf type name or throws a descriptive error.
   * @param fullTypeName The Protobuf type name.
   * @returns The registered metadata.
   */
  getByFullName(fullTypeName: string): TypeMetadata {
    const metadata = this.findByFullName(fullTypeName);

    if (metadata === undefined) {
      throw new Error(`No schema registered for Protobuf type name "${fullTypeName}".`);
    }

    return metadata;
  }

  /**
   * Gets metadata by canonical type URL or throws a descriptive error.
   * @param typeUrl The canonical type URL.
   * @returns The registered metadata.
   */
  getByTypeUrl(typeUrl: string): TypeMetadata {
    const metadata = this.findByTypeUrl(typeUrl);

    if (metadata === undefined) {
      throw new Error(`No schema registered for type URL "${typeUrl}".`);
    }

    return metadata;
  }

  /**
   * Gets metadata by generated schema identity or throws a descriptive error.
   * @param schema The generated message schema.
   * @returns The registered metadata.
   */
  getBySchema<Schema extends MessageSchema>(schema: Schema): TypeMetadata<Schema> {
    const metadata = this.findBySchema(schema);

    if (metadata === undefined) {
      throw new Error(`No metadata registered for schema "${schema.typeName}".`);
    }

    return metadata;
  }

  /**
   * Returns all registered metadata in registration order.
   * @returns The registered metadata entries.
   */
  list(): readonly TypeMetadata[] {
    return [...this.#byFullName.values()];
  }
}

const RegistryLookups = {
  // prettier-ignore

  /**
   * Composes modules in deterministic dependency-first order.
   */
  compose(
    root: ProtoModule,
    definitions: Map<string, ProtoModule>,
    visiting: Set<string>,
    verified: WeakSet<ProtoModule>,
    schemas: MessageSchema[],
  ): void {
    const frames: ModuleFrame[] = [{ module: root, appendSchemas: false }];

    while (frames.length > 0) {
      const frame = frames.pop();

      if (frame === undefined) {
        continue;
      }

      const { module } = frame;
      if (frame.appendSchemas) {
        visiting.delete(module.name);
        verified.add(module);
        if (definitions.get(module.name) === module) {
          schemas.push(...module.schemas);
        }
        continue;
      }

      if (visiting.has(module.name)) {
        throw new Error(`Proto module dependency cycle at "${module.name}".`);
      }

      const existing = definitions.get(module.name);
      if (existing !== undefined && !RegistryLookups.sameModule(existing, module)) {
        throw new Error(`Proto module conflict for "${module.name}".`);
      }

      if (existing !== undefined && verified.has(module)) {
        continue;
      }

      if (existing === undefined) {
        definitions.set(module.name, module);
      }

      visiting.add(module.name);
      frames.push({ module, appendSchemas: true });

      for (let index = module.dependencies.length - 1; index >= 0; index -= 1) {
        const dependency = module.dependencies[index];
        if (dependency !== undefined) {
          frames.push({ module: dependency, appendSchemas: false });
        }
      }
    }
  },

  /**
   * Compares two module definitions for same-name conflicts.
   */
  sameModule(left: ProtoModule, right: ProtoModule): boolean {
    if (left === right) {
      return true;
    }

    if (
      left.name !== right.name ||
      left.schemas.length !== right.schemas.length ||
      left.dependencies.length !== right.dependencies.length
    ) {
      return false;
    }

    return (
      left.schemas.every((schema, index) => schema === right.schemas[index]) &&
      left.dependencies.every(
        (dependency, index) => dependency.name === right.dependencies[index]?.name,
      )
    );
  },

  /**
   * Creates immutable descriptor-backed schema metadata.
   */
  metadata<Schema extends MessageSchema>(
    schema: Schema,
    typeUrl: string,
    semanticTags: readonly string[] = [],
  ): TypeMetadata<Schema> {
    const firstField = schema.fields[0];
    const tags = [...new Set(semanticTags)].sort();
    return Object.freeze({
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
    });
  },

  /**
   * Creates an immutable registry lookup view.
   */
  lookup(registry: TypeRegistry): TypeRegistryLookup {
    return Object.freeze({
      findByFullName: (fullTypeName: string) => registry.findByFullName(fullTypeName),
      findByTypeUrl: (typeUrl: string) => registry.findByTypeUrl(typeUrl),
      findBySchema: <Schema extends MessageSchema>(schema: Schema) => registry.findBySchema(schema),
      findBySemanticTag: (semanticTag: string) => registry.findBySemanticTag(semanticTag),
      getByFullName: (fullTypeName: string) => registry.getByFullName(fullTypeName),
      getByTypeUrl: (typeUrl: string) => registry.getByTypeUrl(typeUrl),
      getBySchema: <Schema extends MessageSchema>(schema: Schema) => registry.getBySchema(schema),
      list: () => registry.list(),
    });
  },
};

interface ModuleFrame {
  readonly module: ProtoModule;
  readonly appendSchemas: boolean;
}

/**
 * Shared registry for the first curated Spine schema set.
 */
export const spineCoreRegistry: TypeRegistryLookup = RegistryLookups.lookup(
  TypeRegistry.spineCore(),
);

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

/**
 * Constructs and sanitizes internal message-validation results.
 */
const ValidationResults = {
  from(violations: readonly ConstraintViolation[]): MessageValidationResult {
    if (violations.length === 0)
      return { valid: true, violations: EMPTY_VIOLATIONS, error: undefined };
    const nonEmpty = violations as readonly [ConstraintViolation, ...ConstraintViolation[]];
    return { valid: false, violations: nonEmpty, error: ValidationResults.error(nonEmpty) };
  },
  error(violations: readonly ConstraintViolation[]): ValidationError {
    return create(ValidationErrorSchema, { constraintViolation: [...violations] });
  },
  failure(typeName: string, message: string): ConstraintViolation {
    return create(ConstraintViolationSchema, {
      typeName,
      message: create(TemplateStringSchema, { withPlaceholders: message }),
    });
  },
  violation(violation: SanitizableConstraintViolation): ConstraintViolation {
    return create(ConstraintViolationSchema, {
      message:
        violation.message === undefined
          ? undefined
          : create(TemplateStringSchema, {
              withPlaceholders: violation.message.withPlaceholders,
              placeholderValue: ValidationResults.redact(violation.message.placeholderValue),
            }),
      typeName: violation.typeName,
      fieldPath:
        violation.fieldPath === undefined
          ? undefined
          : create(FieldPathSchema, { fieldName: [...violation.fieldPath.fieldName] }),
    });
  },
  redact(values: Record<string, string> | undefined): Record<string, string> {
    return Object.fromEntries(
      Object.keys(values ?? {}).map((key) => [key, REDACTED_VALIDATION_DETAIL]),
    );
  },
};
