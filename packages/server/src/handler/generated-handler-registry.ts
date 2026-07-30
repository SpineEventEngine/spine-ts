import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import {
  HandlerMetadataValues,
  HandlerMetadataRegistry,
  type EntityClass,
  type EntityHandlersMetadata,
  type HandlerMethodName,
  type HandlerMetadata,
  type HandlerRegistrationBuilder,
} from "./handler-metadata.js";

/** Describes the generated handler registry module shape accepted by the framework ingestor.
 *
 * @internal
 */
export interface GeneratedHandlerRegistry {
  /** Generated registry contract version. */
  readonly version: 1;
  /** Entity handler groups declared by the generated module. */
  readonly entities: readonly GeneratedEntityHandlerGroup[];
}

/** Framework-owned ingestion adapter for generated handler registries. */
export class HandlerRegistryIngestor {
  /** Converts generated registry records into canonical entity handler metadata.
   *
   * @param registry - Generated registry metadata to validate and materialize.
   * @returns Frozen canonical entity-handler metadata.
   */
  ingest(registry: unknown): readonly EntityHandlersMetadata[] {
    GeneratedRegistry.assert(registry);
    GeneratedRegistry.validateVersion(registry);

    return Object.freeze(registry.entities.map((entity) => GeneratedRegistry.materialize(entity)));
  }

  /** Registers generated registry records in a caller-owned metadata registry.
   *
   * @param generated - Generated registry metadata to validate and register.
   * @param registry - Metadata registry to update.
   * @returns The updated metadata registry.
   */
  register(
    generated: unknown,
    registry: HandlerMetadataRegistry = new HandlerMetadataRegistry(),
  ): HandlerMetadataRegistry {
    GeneratedRegistry.assert(generated);
    const entityHandlers = this.ingest(generated);
    new HandlerMetadataRegistry([...registry.listEntityHandlers(), ...entityHandlers]);

    for (const metadata of entityHandlers) {
      registry.register(metadata);
    }

    return registry;
  }
}

/** Error code for generated handler registry ingestion failures. */
export type RegistryIngestionErrorCode =
  | "UNSUPPORTED_REGISTRY_VERSION"
  | "UNSUPPORTED_HANDLER_KIND"
  | "INVALID_PARAMETER_COUNT"
  | "INVALID_SCHEMA"
  | "MISSING_EMITTED_SCHEMAS"
  | "UNEXPECTED_EMITTED_SCHEMAS";

/** Error thrown when generated handler registry metadata cannot be ingested. */
export class HandlerRegistryIngestionError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: RegistryIngestionErrorCode;

  /**
   * Creates an ingestion error.
   *
   * @param code - Stable code that identifies the failed validation.
   * @param message - Human-readable failure description.
   */
  constructor(code: RegistryIngestionErrorCode, message: string) {
    super(message);
    this.name = "HandlerRegistryIngestionError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Describes handler categories supported by generated registry ingestion.
 *
 * @internal
 */
export type GeneratedHandlerKind =
  "command-assignment" | "command-reaction" | "event-subscription" | "event-reaction";

/** Describes public handler arity recorded by generated registry tooling.
 *
 * @internal
 */
export type GeneratedHandlerParameterCount = 1 | 2;

/** Describes a type-erased generated entity group accepted by a top-level registry.
 *
 * @internal
 */
export interface GeneratedEntityHandlerGroup {
  /** Entity class whose prototype owns the generated handler methods. */
  readonly entityType: EntityClass;
  /** Generated Protobuf-ES schema for the entity state. */
  readonly stateSchema: DescriptorMessageSchema;
  /** Generated handler records in declaration order. */
  readonly handlers: readonly GeneratedHandlerRecordInput[];
}

/** Describes generated handler records for one entity class.
 *
 * @internal
 */
export interface GeneratedEntityHandlers<
  Instance extends object = object,
  StateSchema extends DescriptorMessageSchema = DescriptorMessageSchema,
> extends GeneratedEntityHandlerGroup {
  /** Entity class whose prototype owns the generated handler methods. */
  readonly entityType: EntityClass<Instance>;
  /** Generated Protobuf-ES schema for the entity state. */
  readonly stateSchema: StateSchema;
  /** Generated handler records in declaration order. */
  readonly handlers: readonly GeneratedHandlerRecord<Instance>[];
}

/** Describes type-erased generated metadata for one decorated handler method.
 *
 * @internal
 */
export interface GeneratedHandlerRecordInput {
  /** Handler role inferred from the bare decorator. */
  readonly kind: GeneratedHandlerKind;
  /** Entity instance method name selected by generated metadata. */
  readonly methodName: string;
  /** Generated Protobuf-ES schema accepted by the handler method. */
  readonly signalSchema: DescriptorMessageSchema;
  /** Generated Protobuf-ES schemas emitted by the handler return type. */
  readonly emittedSchemas: readonly DescriptorMessageSchema[];
  /** Public method arity: `handler(signal)` or `handler(signal, context)`. */
  readonly parameterCount: GeneratedHandlerParameterCount;
}

/** Describes generated metadata for one decorated handler method on a concrete entity class.
 *
 * @internal
 */
export interface GeneratedHandlerRecord<
  Instance extends object = object,
> extends GeneratedHandlerRecordInput {
  /** Entity instance method name selected by generated metadata. */
  readonly methodName: HandlerMethodName<Instance>;
}

const registryVersion = 1;

interface GeneratedRegistryOperations {
  assert(registry: unknown): asserts registry is GeneratedHandlerRegistry;
  validateVersion(registry: GeneratedHandlerRegistry): void;
  materialize(entity: GeneratedEntityHandlerGroup): EntityHandlersMetadata;
  build<Instance extends object>(
    builder: HandlerRegistrationBuilder<Instance>,
    handler: GeneratedHandlerRecordInput,
  ): HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>;
  validateHandler(handler: GeneratedHandlerRecordInput): void;
  validateSchema(schema: DescriptorMessageSchema, label: string): void;
  validateEmits(handler: GeneratedHandlerRecordInput): void;
  validateSubscription(handler: GeneratedHandlerRecordInput): void;
  isKind(kind: string): kind is GeneratedHandlerKind;
}

const GeneratedRegistry: GeneratedRegistryOperations = Object.freeze({
  assert(registry: unknown): asserts registry is GeneratedHandlerRegistry {
    if (registry === null || typeof registry !== "object") {
      throw new HandlerRegistryIngestionError(
        "UNSUPPORTED_REGISTRY_VERSION",
        "Generated handler registry must be an object.",
      );
    }
  },

  validateVersion(registry: GeneratedHandlerRegistry): void {
    const version: number = registry.version;

    if (version === registryVersion) {
      return;
    }

    throw new HandlerRegistryIngestionError(
      "UNSUPPORTED_REGISTRY_VERSION",
      `Generated handler registry version ${String(version)} is not supported.`,
    );
  },

  materialize(entity: GeneratedEntityHandlerGroup): EntityHandlersMetadata {
    GeneratedRegistry.validateSchema(entity.stateSchema, "entity state schema");
    entity.handlers.forEach((handler) => {
      GeneratedRegistry.validateHandler(handler);
    });

    return HandlerMetadataValues.defineArity(
      entity.entityType,
      entity.stateSchema,
      (builder) => entity.handlers.map((handler) => GeneratedRegistry.build(builder, handler)),
      entity.handlers.map((handler) => ({
        kind: handler.kind,
        methodName: handler.methodName,
        ...(handler.kind === "event-subscription"
          ? {}
          : { emittedSchemas: Object.freeze([...handler.emittedSchemas]) }),
        parameterCount: handler.parameterCount,
      })),
    );
  },

  build<Instance extends object>(
    builder: HandlerRegistrationBuilder<Instance>,
    handler: GeneratedHandlerRecordInput,
  ): HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>> {
    switch (handler.kind) {
      case "command-assignment":
        return builder.assign(
          handler.signalSchema,
          handler.methodName as HandlerMethodName<Instance>,
        );
      case "command-reaction":
        return builder.command(
          handler.signalSchema,
          handler.methodName as HandlerMethodName<Instance>,
        );
      case "event-subscription":
        return builder.subscribe(
          handler.signalSchema,
          handler.methodName as HandlerMethodName<Instance>,
        );
      case "event-reaction":
        return builder.react(
          handler.signalSchema,
          handler.methodName as HandlerMethodName<Instance>,
        );
      default:
        throw new HandlerRegistryIngestionError(
          "UNSUPPORTED_HANDLER_KIND",
          `Generated handler kind "${String(handler.kind)}" is not supported.`,
        );
    }
  },

  validateHandler(handler: GeneratedHandlerRecordInput): void {
    if (!GeneratedRegistry.isKind(handler.kind)) {
      throw new HandlerRegistryIngestionError(
        "UNSUPPORTED_HANDLER_KIND",
        `Generated handler kind "${String(handler.kind)}" is not supported.`,
      );
    }

    const parameterCount: number = handler.parameterCount;

    if (parameterCount !== 1 && parameterCount !== 2) {
      throw new HandlerRegistryIngestionError(
        "INVALID_PARAMETER_COUNT",
        `Generated handler "${handler.methodName}" declares unsupported parameter count ` +
          `${String(parameterCount)}.`,
      );
    }

    GeneratedRegistry.validateSchema(
      handler.signalSchema,
      `signal schema for generated handler "${handler.methodName}"`,
    );
    handler.emittedSchemas.forEach((schema, index) => {
      GeneratedRegistry.validateSchema(
        schema,
        `emitted schema ${String(index)} for generated handler "${handler.methodName}"`,
      );
    });

    if (handler.kind === "event-subscription") {
      GeneratedRegistry.validateSubscription(handler);
      return;
    }

    if (handler.kind === "command-assignment" || handler.kind === "command-reaction") {
      GeneratedRegistry.validateEmits(handler);
    }
  },

  validateSchema(schema: DescriptorMessageSchema, label: string): void {
    const value: unknown = schema;

    if (value === null || typeof value !== "object") {
      throw new HandlerRegistryIngestionError(
        "INVALID_SCHEMA",
        `Generated handler registry ${label} must be an object with a non-empty typeName.`,
      );
    }

    const typeName = (value as { readonly typeName?: unknown }).typeName;

    if (typeof typeName === "string" && typeName.trim().length > 0) {
      return;
    }

    throw new HandlerRegistryIngestionError(
      "INVALID_SCHEMA",
      `Generated handler registry ${label} must be an object with a non-empty typeName.`,
    );
  },

  validateEmits(handler: GeneratedHandlerRecordInput): void {
    if (handler.emittedSchemas.length > 0) {
      return;
    }

    throw new HandlerRegistryIngestionError(
      "MISSING_EMITTED_SCHEMAS",
      `Generated handler "${handler.methodName}" must declare at least one emitted schema.`,
    );
  },

  validateSubscription(handler: GeneratedHandlerRecordInput): void {
    if (handler.emittedSchemas.length === 0) {
      return;
    }

    throw new HandlerRegistryIngestionError(
      "UNEXPECTED_EMITTED_SCHEMAS",
      `Generated event subscription handler "${handler.methodName}" must not declare emitted schemas.`,
    );
  },

  isKind(kind: string): kind is GeneratedHandlerKind {
    return (
      kind === "command-assignment" ||
      kind === "command-reaction" ||
      kind === "event-subscription" ||
      kind === "event-reaction"
    );
  },
});
