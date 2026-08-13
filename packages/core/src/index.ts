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

import {
  clone,
  create,
  createRegistry,
  fromBinary,
  fromJsonString,
  getOption,
  hasOption,
  ScalarType,
  toBinary,
  toJsonString,
} from "@bufbuild/protobuf";
import type {
  DescField,
  Message,
  MessageInitShape,
  MessageShape,
  Registry,
} from "@bufbuild/protobuf";
import type { GenExtension, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import { base64Decode, base64Encode } from "@bufbuild/protobuf/wire";
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

type InterfaceSchemas = readonly [MessageSchema, ...MessageSchema[]];
type InterfaceMember<Schemas extends InterfaceSchemas> = MessageShape<Schemas[number]>;

declare const MESSAGE_INTERFACE_BRAND: unique symbol;
const MESSAGE_INTERFACE_TOKENS = new WeakSet<object>();

/**
 * Immutable nominal membership token for generated Protobuf message interfaces.
 *
 * The token preserves the concrete non-empty schema tuple used to define an
 * interface. Use {@link MessageInterfaces.define} to create a token and
 * {@link MessageInterfaces.is} to validate a runtime candidate.
 *
 * @typeParam TInterface The object shape implemented by every member message.
 * @typeParam Schemas The concrete non-empty tuple of member schemas.
 */
export interface MessageInterface<TInterface extends object, Schemas extends InterfaceSchemas> {
  /** Concrete, immutable generated message schemas that belong to this interface. */
  readonly schemas: Schemas;

  readonly [MESSAGE_INTERFACE_BRAND]: TInterface;
}

function isMessageSchema(value: unknown): value is MessageSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { readonly kind?: unknown }).kind === "message"
  );
}

/**
 * Creates and validates nominal generated message-interface tokens.
 */
export const MessageInterfaces: Readonly<{
  /**
   * Creates a nominal token from a non-empty tuple of generated message schemas.
   *
   * Every schema's message shape must implement `TInterface`. At runtime this
   * factory rejects empty, malformed, and duplicate membership; it copies and
   * freezes the retained membership. Factory availability is not an authenticity
   * boundary: use {@link is} when accepting a runtime token candidate.
   *
   * @typeParam TInterface The common object shape of all member messages.
   * @typeParam Schemas The concrete non-empty member-schema tuple.
   * @param schemas Generated message schemas belonging to the interface.
   * @returns A frozen nominal token with concrete schema membership.
   */
  define<TInterface extends object, const Schemas extends InterfaceSchemas>(
    schemas: InterfaceMember<Schemas> extends TInterface ? Schemas : never,
  ): MessageInterface<TInterface, Schemas>;

  /**
   * Determines whether a value is the exact token instance created by this factory.
   *
   * Structural copies, prototype copies, serialized values, and hand-built
   * lookalikes are rejected even when they expose matching schema membership.
   *
   * @param value The runtime value to inspect.
   * @returns Whether `value` is a factory-created message-interface token.
   */
  is(value: unknown): value is MessageInterface<object, InterfaceSchemas>;
}> = Object.freeze({
  define<TInterface extends object, const Schemas extends InterfaceSchemas>(
    schemas: InterfaceMember<Schemas> extends TInterface ? Schemas : never,
  ): MessageInterface<TInterface, Schemas> {
    if (schemas.length === 0) throw new Error("A message interface requires at least one schema.");
    const uniqueSchemas: MessageSchema[] = [];
    const seen = new Set<MessageSchema>();
    for (const schema of schemas as readonly unknown[]) {
      if (!isMessageSchema(schema)) {
        throw new TypeError("A message interface requires generated message schemas.");
      }
      if (!seen.has(schema)) {
        seen.add(schema);
        uniqueSchemas.push(schema);
      }
    }
    const token = Object.freeze({ schemas: Object.freeze(uniqueSchemas) });
    MESSAGE_INTERFACE_TOKENS.add(token);
    return token as unknown as MessageInterface<TInterface, Schemas>;
  },
  is(value: unknown): value is MessageInterface<object, InterfaceSchemas> {
    return typeof value === "object" && value !== null && MESSAGE_INTERFACE_TOKENS.has(value);
  },
});

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
    const basename = schema.file.proto.name.split("/").at(-1);
    const rejectionSource =
      basename === "rejections.proto" || basename?.endsWith("_rejections.proto") === true;
    if (schema.parent !== undefined || !rejectionSource) {
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

function isProtobufRegistry(types: TypeRegistryLookup | Registry): types is Registry {
  return "kind" in types;
}

function defaultMessageStringifier<Schema extends MessageSchema>(
  schema: Schema,
  registry: Registry | undefined,
  typeUrls: ReadonlyMap<string, string>,
): Stringifier<MessageShape<Schema>> {
  return Object.freeze({
    fromString(value: string): MessageShape<Schema> {
      const message =
        registry === undefined
          ? fromJsonString(schema, value)
          : fromJsonString(schema, value, { registry });
      restoreAnyTypeUrls(message, typeUrls);
      return message;
    },
    toString(value: MessageShape<Schema>): string {
      return registry === undefined
        ? toJsonString(schema, value)
        : toJsonString(schema, value, { registry });
    },
  });
}

function restoreAnyTypeUrls(value: unknown, typeUrls: ReadonlyMap<string, string>): void {
  if (typeof value !== "object" || value === null || value instanceof Uint8Array) return;
  if (Array.isArray(value)) {
    for (const item of value) restoreAnyTypeUrls(item, typeUrls);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.$typeName === AnySchema.typeName) {
    const typeUrl = record.typeUrl;
    if (typeof typeUrl === "string") {
      const canonical = typeUrls.get(typeUrl.slice(typeUrl.lastIndexOf("/") + 1));
      if (canonical !== undefined) record.typeUrl = canonical;
    }
  }
  for (const item of Object.values(record)) restoreAnyTypeUrls(item, typeUrls);
}

const FieldStringifiers = Object.freeze({
  create(
    field: DescField,
    messageStringifier: (schema: MessageSchema) => Stringifier<unknown>,
  ): Stringifier<unknown> {
    switch (field.fieldKind) {
      case "message":
        return messageStringifier(field.message as MessageSchema);
      case "enum":
        return this.enum(field);
      case "scalar":
        return this.scalar(field);
      case "list":
      case "map":
        throw new Error("Stringifiers support only singular Protobuf fields.");
    }
  },

  enum(field: Extract<DescField, { fieldKind: "enum" }>): Stringifier<unknown> {
    return Object.freeze({
      fromString(value: string): unknown {
        const named = field.enum.values.find((candidate) => candidate.name === value);
        return (
          named?.number ??
          Number(FieldStringifiers.integerText(value, -(2n ** 31n), 2n ** 31n - 1n))
        );
      },
      toString(value: unknown): string {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new TypeError("Enum field value must be an integer number.");
        }
        const number = FieldStringifiers.integerValue(
          value,
          -(2n ** 31n),
          2n ** 31n - 1n,
          "number",
        );
        return field.enum.value[Number(number)]?.name ?? number.toString();
      },
    });
  },

  scalar(field: Extract<DescField, { fieldKind: "scalar" }>): Stringifier<unknown> {
    switch (field.scalar) {
      case ScalarType.STRING:
        return this.string;
      case ScalarType.BOOL:
        return this.boolean;
      case ScalarType.BYTES:
        return this.bytes;
      case ScalarType.DOUBLE:
        return this.number;
      case ScalarType.FLOAT:
        return this.float;
      case ScalarType.INT32:
      case ScalarType.SFIXED32:
      case ScalarType.SINT32:
        return this.integer(-(2n ** 31n), 2n ** 31n - 1n, "number");
      case ScalarType.FIXED32:
      case ScalarType.UINT32:
        return this.integer(0n, 2n ** 32n - 1n, "number");
      case ScalarType.INT64:
      case ScalarType.SFIXED64:
      case ScalarType.SINT64:
        return this.integer(-(2n ** 63n), 2n ** 63n - 1n, field.longAsString ? "string" : "bigint");
      case ScalarType.FIXED64:
      case ScalarType.UINT64:
        return this.integer(0n, 2n ** 64n - 1n, field.longAsString ? "string" : "bigint");
    }
  },

  string: Object.freeze({
    fromString(value: string): unknown {
      return value;
    },
    toString(value: unknown): string {
      if (typeof value !== "string") throw new TypeError("Field value must be a string.");
      return value;
    },
  }),

  boolean: Object.freeze({
    fromString(value: string): unknown {
      if (value === "true") return true;
      if (value === "false") return false;
      throw new Error("Field value must be a canonical boolean.");
    },
    toString(value: unknown): string {
      if (typeof value !== "boolean") throw new TypeError("Field value must be a boolean.");
      return value ? "true" : "false";
    },
  }),

  bytes: Object.freeze({
    fromString(value: string): unknown {
      let decoded: Uint8Array;
      try {
        decoded = base64Decode(value);
      } catch {
        throw new Error("Field value must be canonical base64.");
      }
      if (base64Encode(decoded, "std") !== value) {
        throw new Error("Field value must be canonical base64.");
      }
      return decoded;
    },
    toString(value: unknown): string {
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Field value must be a byte array.");
      }
      return base64Encode(value, "std");
    },
  }),

  number: Object.freeze({
    fromString(value: string): unknown {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error("Field value must be a finite number.");
      const canonical = Object.is(parsed, -0) ? "-0" : String(parsed);
      if (canonical !== value) throw new Error("Field value must be a canonical number.");
      return parsed;
    },
    toString(value: unknown): string {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("Field value must be a finite number.");
      }
      return Object.is(value, -0) ? "-0" : String(value);
    },
  }),

  float: Object.freeze({
    fromString(value: string): unknown {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error("Field value must be a finite number.");
      const restored = Math.fround(parsed);
      if (!Number.isFinite(restored)) {
        throw new Error("Field value is outside the float32 range.");
      }
      if (FieldStringifiers.floatText(restored) !== value) {
        throw new Error("Field value must be a canonical float32 number.");
      }
      return restored;
    },
    toString(value: unknown): string {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("Field value must be a finite number.");
      }
      const normalized = Math.fround(value);
      if (!Number.isFinite(normalized)) {
        throw new Error("Field value is outside the float32 range.");
      }
      return FieldStringifiers.floatText(normalized);
    },
  }),

  floatText(value: number): string {
    if (Object.is(value, -0)) return "-0";
    if (value === 0) return "0";
    for (let precision = 1; precision <= 9; precision += 1) {
      const candidate = String(Number(value.toPrecision(precision)));
      if (Object.is(Math.fround(Number(candidate)), value)) return candidate;
    }
    throw new Error("Unable to format the float32 field value.");
  },

  integer(
    min: bigint,
    max: bigint,
    representation: "number" | "bigint" | "string",
  ): Stringifier<unknown> {
    return Object.freeze({
      fromString(value: string): unknown {
        const restored = FieldStringifiers.integerText(value, min, max);
        switch (representation) {
          case "number":
            return Number(restored);
          case "bigint":
            return restored;
          case "string":
            return restored.toString();
        }
      },
      toString(value: unknown): string {
        const restored = FieldStringifiers.integerValue(value, min, max, representation);
        return restored.toString();
      },
    });
  },

  integerText(value: string, min: bigint, max: bigint): bigint {
    if (!/^(?:0|-?[1-9]\d*)$/u.test(value)) {
      throw new Error("Field value must be a canonical integer.");
    }
    const restored = BigInt(value);
    if (restored < min || restored > max) {
      const kind = min === 0n && max === 2n ** 64n - 1n ? "uint64" : "declared integer";
      throw new Error(`Field value is outside the ${kind} range.`);
    }
    return restored;
  },

  integerValue(
    value: unknown,
    min: bigint,
    max: bigint,
    representation: "number" | "bigint" | "string",
  ): bigint {
    let converted: bigint;
    if (representation === "string") {
      if (typeof value !== "string") throw new TypeError("Field value must be an integer string.");
      converted = this.integerText(value, min, max);
    } else if (representation === "bigint" && typeof value === "bigint") {
      converted = value;
    } else if (
      representation === "number" &&
      typeof value === "number" &&
      Number.isSafeInteger(value)
    ) {
      converted = BigInt(value);
    } else {
      throw new TypeError("Field value must be an integer.");
    }
    if (converted < min || converted > max) {
      const kind = min === 0n && max === 2n ** 64n - 1n ? "uint64" : "declared integer";
      throw new Error(`Field value is outside the ${kind} range.`);
    }
    return converted;
  },
});

/**
 * Supplies reversible default stringifiers for generated Protobuf messages.
 */
export const Stringifiers = {
  // prettier-ignore

  /**
   * Creates the default compact Proto JSON stringifier for a message schema.
   * @param schema The generated message schema.
   * @param types The optional generated-type registry used to expand `Any` values.
   * @returns A reversible schema-bound stringifier.
   */
  forMessage<Schema extends MessageSchema>(
    schema: Schema,
    types?: TypeRegistryLookup | Registry,
  ): Stringifier<MessageShape<Schema>> {
    const registry =
      types === undefined
        ? undefined
        : isProtobufRegistry(types)
          ? types
          : createRegistry(...types.list().map((metadata) => metadata.descriptor));
    const typeUrls =
      types === undefined || isProtobufRegistry(types)
        ? new Map<string, string>()
        : new Map(types.list().map((metadata) => [metadata.schema.typeName, metadata.typeUrl]));
    return defaultMessageStringifier(schema, registry, typeUrls);
  },

  /**
   * Creates a reversible stringifier for one supported singular field.
   *
   * Scalar, bytes, enum, and message fields are supported. Numeric text is
   * canonical, finite, and range-checked; `float` values are normalized to
   * binary32. Repeated and map fields are rejected.
   *
   * @param field The Protobuf field descriptor.
   * @param types The optional generated-type registry used by message fields.
   * @returns A stringifier for the field's runtime value.
   */
  forField(field: DescField, types?: TypeRegistryLookup | Registry): Stringifier<unknown> {
    return FieldStringifiers.create(field, (schema) => this.forMessage(schema, types));
  },
} as const;
Object.freeze(Stringifiers);

/**
 * Holds schema-bound custom stringifiers with Proto JSON defaults.
 */
export class StringifierRegistry {
  readonly #registered = new Map<string, Stringifier<Message>>();
  #types: Registry | undefined;
  #typeUrls = new Map<string, string>();

  /**
   * Creates an empty registry or a snapshot of another registry.
   *
   * @param source The optional registry to copy.
   */
  constructor(source?: StringifierRegistry) {
    if (source !== undefined) {
      for (const [typeName, stringifier] of source.#registered) {
        this.#registered.set(typeName, stringifier);
      }
      this.#types = source.#types;
      this.#typeUrls = new Map(source.#typeUrls);
    }
  }

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
   * Sets the generated-type registry used by default message stringifiers.
   *
   * @param types Resolves message types embedded in `Any` values.
   */
  setTypeRegistry(types: TypeRegistryLookup): void {
    const metadata = types.list();
    this.#types = createRegistry(...metadata.map((item) => item.descriptor));
    this.#typeUrls = new Map(metadata.map((item) => [item.schema.typeName, item.typeUrl]));
  }

  /**
   * Returns the custom stringifier or the default compact Proto JSON mapping.
   * @param schema The generated message schema.
   * @returns The schema-bound stringifier.
   */
  forMessage<Schema extends MessageSchema>(schema: Schema): Stringifier<MessageShape<Schema>> {
    const registered = this.#registered.get(schema.typeName);

    return registered === undefined
      ? defaultMessageStringifier(schema, this.#types, this.#typeUrls)
      : (registered as Stringifier<MessageShape<Schema>>);
  }

  /**
   * Returns the configured reversible mapping for one supported singular field.
   *
   * Scalar, bytes, enum, and message fields are supported. Numeric text is
   * canonical, finite, and range-checked; `float` values are normalized to
   * binary32. Repeated and map fields are rejected. Registered message mappings
   * take precedence over compact Proto JSON defaults.
   *
   * @param field The Protobuf field descriptor.
   * @returns A stringifier for the field's runtime value.
   */
  forField(field: DescField): Stringifier<unknown> {
    return FieldStringifiers.create(field, (schema) => this.forMessage(schema));
  }
}

/**
 * Primitive identifier kinds supported by Spine JVM storage.
 */
export type PrimitiveIdentifierType = "string" | "int32" | "int64";

interface IdentifierCodec {
  // prettier-ignore

  /**
   * Packs a message-valued identifier.
   *
   * @param schema The generated identifier schema.
   * @param value The identifier value.
   * @returns The packed identifier.
   */
  pack<Schema extends MessageSchema>(schema: Schema, value: MessageShape<Schema>): Any;

  /**
   * Packs a string identifier.
   *
   * @param type The string identifier kind.
   * @param value The identifier value.
   * @returns The packed identifier.
   */
  pack(type: "string", value: string): Any;

  /**
   * Packs an `int32` identifier.
   *
   * @param type The `int32` identifier kind.
   * @param value The identifier value.
   * @returns The packed identifier.
   */
  pack(type: "int32", value: number): Any;

  /**
   * Packs an `int64` identifier.
   *
   * @param type The `int64` identifier kind.
   * @param value The identifier value.
   * @returns The packed identifier.
   */
  pack(type: "int64", value: bigint): Any;

  /**
   * Unpacks a message-valued identifier.
   *
   * @param schema The generated identifier schema.
   * @param value The packed identifier.
   * @returns The decoded identifier, or `undefined` for another type.
   */
  unpack<Schema extends MessageSchema>(
    schema: Schema,
    value: Any,
  ): MessageShape<Schema> | undefined;

  /**
   * Unpacks a string identifier.
   *
   * @param type The string identifier kind.
   * @param value The packed identifier.
   * @returns The decoded identifier, or `undefined` for another type.
   */
  unpack(type: "string", value: Any): string | undefined;

  /**
   * Unpacks an `int32` identifier.
   *
   * @param type The `int32` identifier kind.
   * @param value The packed identifier.
   * @returns The decoded identifier, or `undefined` for another type.
   */
  unpack(type: "int32", value: Any): number | undefined;

  /**
   * Unpacks an `int64` identifier.
   *
   * @param type The `int64` identifier kind.
   * @param value The packed identifier.
   * @returns The decoded identifier, or `undefined` for another type.
   */
  unpack(type: "int64", value: Any): bigint | undefined;
}

/**
 * Packs and unpacks the identifier types supported by Spine JVM storage.
 */
export const Identifiers: IdentifierCodec = {
  // prettier-ignore

  /**
   * Packs a supported typed identifier.
   */
  pack: packIdentifier,

  /**
   * Unpacks a supported typed identifier.
   */
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

/**
 * Packs a supported typed identifier.
 *
 * @param schema The generated schema or supported primitive kind.
 * @param value The identifier value.
 * @returns The packed identifier.
 */
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

/**
 * Unpacks a supported typed identifier.
 *
 * @param schema The generated schema or supported primitive kind.
 * @param value The packed identifier.
 * @returns The decoded identifier, or `undefined` for another type.
 */
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
   * @param options Optional explicit type URL.
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

    const metadata = RegistryLookups.metadata(schema, typeUrl);

    this.#byFullName.set(metadata.fullTypeName, metadata);
    this.#byTypeUrl.set(metadata.typeUrl, metadata);
    this.#bySchema.set(schema, metadata);
    this.#bySchemaDescriptor.set(schema.proto, metadata);

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
  metadata<Schema extends MessageSchema>(schema: Schema, typeUrl: string): TypeMetadata<Schema> {
    const firstField = schema.fields[0];
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
