import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import {
  handlerMetadataAccess,
  HandlerMetadataRegistry,
  type EntityClass,
  type EntityHandlersMetadata,
  type HandlerMethodName,
  type HandlerMetadata,
  type HandlerRegistrationBuilder,
} from "./handler-metadata.js";

/** @internal Generated handler registry module shape accepted by the framework ingestor. */
export interface GeneratedHandlerRegistry {
  /** Generated registry contract version. */
  readonly version: 1;
  /** Entity handler groups declared by the generated module. */
  readonly entities: readonly GeneratedEntityHandlerGroup[];
}

/** Framework-owned ingestion adapter for generated handler registries. */
export class HandlerRegistryIngestor {
  /** Convert generated registry records into canonical entity handler metadata. */
  ingest(registry: unknown): readonly EntityHandlersMetadata[] {
    assertGeneratedHandlerRegistry(registry);
    validateRegistryVersion(registry);

    return Object.freeze(
      registry.entities.map((entity) => materializeGeneratedEntityHandlers(entity)),
    );
  }

  /** Ingest generated registry records and register them in a caller-owned metadata registry. */
  register(
    generated: unknown,
    registry: HandlerMetadataRegistry = new HandlerMetadataRegistry(),
  ): HandlerMetadataRegistry {
    assertGeneratedHandlerRegistry(generated);
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

  constructor(code: RegistryIngestionErrorCode, message: string) {
    super(message);
    this.name = "HandlerRegistryIngestionError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** @internal Handler categories supported by generated registry ingestion. */
export type GeneratedHandlerKind =
  "command-assignment" | "command-reaction" | "event-subscription" | "event-reaction";

/** @internal Public handler arity recorded by generated registry tooling. */
export type GeneratedHandlerParameterCount = 1 | 2;

/** @internal Type-erased generated entity group accepted by a top-level generated registry. */
export interface GeneratedEntityHandlerGroup {
  /** Entity class whose prototype owns the generated handler methods. */
  readonly entityType: EntityClass;
  /** Generated Protobuf-ES schema for the entity state. */
  readonly stateSchema: DescriptorMessageSchema;
  /** Generated handler records in declaration order. */
  readonly handlers: readonly GeneratedHandlerRecordInput[];
}

/** @internal Generated handler records for one entity class. */
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

/** @internal Type-erased generated metadata for one decorated handler method. */
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

/** @internal Generated metadata for one decorated handler method on a concrete entity class. */
export interface GeneratedHandlerRecord<
  Instance extends object = object,
> extends GeneratedHandlerRecordInput {
  /** Entity instance method name selected by generated metadata. */
  readonly methodName: HandlerMethodName<Instance>;
}

const registryVersion = 1;

function assertGeneratedHandlerRegistry(
  registry: unknown,
): asserts registry is GeneratedHandlerRegistry {
  if (registry === null || typeof registry !== "object") {
    throw new HandlerRegistryIngestionError(
      "UNSUPPORTED_REGISTRY_VERSION",
      "Generated handler registry must be an object.",
    );
  }
}

function validateRegistryVersion(registry: GeneratedHandlerRegistry): void {
  const version: number = registry.version;

  if (version === registryVersion) {
    return;
  }

  throw new HandlerRegistryIngestionError(
    "UNSUPPORTED_REGISTRY_VERSION",
    `Generated handler registry version ${String(version)} is not supported.`,
  );
}

function materializeGeneratedEntityHandlers(
  entity: GeneratedEntityHandlerGroup,
): EntityHandlersMetadata {
  validateSchema(entity.stateSchema, "entity state schema");
  entity.handlers.forEach((handler) => {
    validateGeneratedHandler(handler);
  });

  return handlerMetadataAccess.defineArity(
    entity.entityType,
    entity.stateSchema,
    (builder) => entity.handlers.map((handler) => buildGeneratedHandler(builder, handler)),
    entity.handlers.map((handler) => ({
      kind: handler.kind,
      methodName: handler.methodName,
      ...(handler.kind === "event-subscription"
        ? {}
        : { emittedSchemas: Object.freeze([...handler.emittedSchemas]) }),
      parameterCount: handler.parameterCount,
    })),
  );
}

function buildGeneratedHandler<Instance extends object>(
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
      return builder.react(handler.signalSchema, handler.methodName as HandlerMethodName<Instance>);
    default:
      throw new HandlerRegistryIngestionError(
        "UNSUPPORTED_HANDLER_KIND",
        `Generated handler kind "${String(handler.kind)}" is not supported.`,
      );
  }
}

function validateGeneratedHandler(handler: GeneratedHandlerRecordInput): void {
  if (!isGeneratedHandlerKind(handler.kind)) {
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

  validateSchema(
    handler.signalSchema,
    `signal schema for generated handler "${handler.methodName}"`,
  );
  handler.emittedSchemas.forEach((schema, index) => {
    validateSchema(
      schema,
      `emitted schema ${String(index)} for generated handler "${handler.methodName}"`,
    );
  });

  if (handler.kind === "event-subscription") {
    validateSubscriptionEmitsNothing(handler);
    return;
  }

  if (handler.kind === "command-assignment" || handler.kind === "command-reaction") {
    validateEmitsSomething(handler);
  }
}

function validateSchema(schema: DescriptorMessageSchema, label: string): void {
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
}

function validateEmitsSomething(handler: GeneratedHandlerRecordInput): void {
  if (handler.emittedSchemas.length > 0) {
    return;
  }

  throw new HandlerRegistryIngestionError(
    "MISSING_EMITTED_SCHEMAS",
    `Generated handler "${handler.methodName}" must declare at least one emitted schema.`,
  );
}

function validateSubscriptionEmitsNothing(handler: GeneratedHandlerRecordInput): void {
  if (handler.emittedSchemas.length === 0) {
    return;
  }

  throw new HandlerRegistryIngestionError(
    "UNEXPECTED_EMITTED_SCHEMAS",
    `Generated event subscription handler "${handler.methodName}" must not declare emitted schemas.`,
  );
}

function isGeneratedHandlerKind(kind: string): kind is GeneratedHandlerKind {
  return (
    kind === "command-assignment" ||
    kind === "command-reaction" ||
    kind === "event-subscription" ||
    kind === "event-reaction"
  );
}
