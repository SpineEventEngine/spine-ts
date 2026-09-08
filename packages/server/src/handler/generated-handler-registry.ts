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

import { isEntitySchema, type DescriptorMessageSchema } from "../entity/entity-metadata.js";
import { ProcessManager } from "../entity/entity.js";
import {
  AbstractAssignee,
  AbstractCommander,
  AbstractEventReactor,
  AbstractEventSubscriber,
} from "./standalone.js";
import {
  HandlerMetadataValues,
  HandlerMetadataRegistry,
  type EntityClass,
  type EntityHandlersMetadata,
  type HandlerMethodName,
  type HandlerOrigin,
  type HandlerMetadata,
  type GeneratedHandlerRegistrationBuilder,
  type WhereOptions,
} from "./handler-metadata.js";
import { RejectionSources } from "./rejection-source.js";

/**
 * Describes the generated handler registry module shape accepted by the framework ingestor.
 *
 */
/**
 * Generated registry metadata consumed by the framework.
 *
 * Application code regenerates this data whenever the handler contract changes.
 */
export interface GeneratedHandlerRegistry {
  readonly receivers: readonly GeneratedReceiver[];
}

/**
 * Framework-owned ingestion adapter for generated handler registries.
 */
export class HandlerRegistryIngestor {
  // prettier-ignore

  /**
   * Converts generated registry records into canonical entity handler metadata.
   *
   * @param registry Generated registry metadata to validate and materialize.
   * @returns Frozen canonical entity-handler metadata.
   */
  ingest(registry: unknown): readonly EntityHandlersMetadata[] {
    GeneratedRegistry.assert(registry);
    return GeneratedRegistry.materializeAll(registry);
  }

  /**
   * Registers generated registry records in a caller-owned metadata registry.
   *
   * @param generated Generated registry metadata to validate and register.
   * @param registry Metadata registry to update.
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

/**
 * Error code for generated handler registry ingestion failures.
 */
export type RegistryIngestionErrorCode =
  | "UNSUPPORTED_REGISTRY_VERSION"
  | "UNSUPPORTED_HANDLER_KIND"
  | "INVALID_PARAMETER_COUNT"
  | "INVALID_SCHEMA"
  | "INVALID_SIGNAL_ORIGIN"
  | "EXTERNAL_COMMAND_RECEIVER"
  | "MISSING_EMITTED_SCHEMAS"
  | "UNEXPECTED_EMITTED_SCHEMAS";

/**
 * Error thrown when generated handler registry metadata cannot be ingested.
 */
export class HandlerRegistryIngestionError extends Error {
  // prettier-ignore

  /**
   * Stable code for callers/tests that need structured failure handling.
   */
  readonly code: RegistryIngestionErrorCode;

  /**
   * Creates an ingestion error.
   *
   * @param code Stable code that identifies the failed validation.
   * @param message Human-readable failure description.
   */
  constructor(code: RegistryIngestionErrorCode, message: string) {
    super(message);
    this.name = "HandlerRegistryIngestionError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Describes handler categories supported by generated registry ingestion.
 *
 */
export type GeneratedHandlerKind =
  | "command-assignment"
  | "command-substitution"
  | "command-reaction"
  | "event-subscription"
  | "state-subscription"
  | "event-reaction";

/**
 * Describes public handler arity recorded by generated registry tooling.
 *
 */
export type GeneratedHandlerParameterCount = 1 | 2;

/**
 * Describes a type-erased generated entity group accepted by a top-level registry.
 *
 */
export interface GeneratedEntityHandlerGroup {
  // prettier-ignore

  /**
   * Entity class whose prototype owns the generated handler methods.
   */
  readonly receiverKind: "entity";
  readonly receiverType: EntityClass;

  /**
   * Generated Protobuf-ES schema for the entity state.
   */
  readonly stateSchema: DescriptorMessageSchema;

  /**
   * Generated handler records in declaration order.
   */
  readonly handlers: readonly GeneratedHandlerRecordInput[];
}

/** Metadata for one decorated standalone application instance. */
export interface GeneratedStandaloneHandlerGroup {
  readonly receiverKind: "standalone";
  readonly receiverType: EntityClass;
  readonly handlers: readonly GeneratedHandlerRecordInput[];
}

/** One generated Entity or standalone receiver declaration. */
export type GeneratedReceiver = GeneratedEntityHandlerGroup | GeneratedStandaloneHandlerGroup;

/**
 * Describes generated handler records for one entity class.
 *
 */
export interface GeneratedEntityHandlers<
  Instance extends object = object,
  StateSchema extends DescriptorMessageSchema = DescriptorMessageSchema,
> extends GeneratedEntityHandlerGroup {
  // prettier-ignore

  /**
   * Entity class whose prototype owns the generated handler methods.
   */
  readonly receiverType: EntityClass<Instance>;

  /**
   * Generated Protobuf-ES schema for the entity state.
   */
  readonly stateSchema: StateSchema;

  /**
   * Generated handler records in declaration order.
   */
  readonly handlers: readonly GeneratedHandlerRecord<Instance>[];
}

/**
 * Describes type-erased generated metadata for one decorated handler method.
 *
 */
export interface GeneratedHandlerRecordInput {
  // prettier-ignore

  /**
   * Handler role inferred from the bare decorator.
   */
  readonly kind: GeneratedHandlerKind;

  /**
   * Entity instance method name selected by generated metadata.
   */
  readonly methodName: string;

  /**
   * Generated Protobuf-ES schema accepted by the handler method.
   */
  readonly signalSchema: DescriptorMessageSchema;

  /**
   * Generated Protobuf-ES schemas emitted by the handler return type.
   */
  readonly emittedSchemas: readonly DescriptorMessageSchema[];

  /**
   * Public method arity: `handler(signal)` or `handler(signal, context)`.
   */
  readonly parameterCount: GeneratedHandlerParameterCount;

  /**
   * Required origin inferred from the receptor's first parameter.
   */
  readonly origin: HandlerOrigin;

  /**
   * Optional generated Event field equality filter.
   */
  readonly where?: WhereOptions;
}

/**
 * Describes generated metadata for one decorated handler method on a concrete entity class.
 *
 */
export interface GeneratedHandlerRecord<
  Instance extends object = object,
> extends GeneratedHandlerRecordInput {
  // prettier-ignore

  /**
   * Entity instance method name selected by generated metadata.
   */
  readonly methodName: HandlerMethodName<Instance>;
}

interface GeneratedRegistryOperations {
  assert(registry: unknown): asserts registry is GeneratedHandlerRegistry;
  materializeAll(registry: GeneratedHandlerRegistry): readonly EntityHandlersMetadata[];
  materialize(entity: GeneratedEntityHandlerGroup): EntityHandlersMetadata;
  build<Instance extends object>(
    builder: GeneratedHandlerRegistrationBuilder<Instance>,
    handler: GeneratedHandlerRecordInput,
  ): HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>;
  validateHandler(
    handler: GeneratedHandlerRecordInput,
  ): void;
  validateCommandHandlers(entity: GeneratedEntityHandlerGroup): void;
  validateStandalone(receiver: GeneratedStandaloneHandlerGroup): void;
  validateSchema(schema: DescriptorMessageSchema, label: string): void;
  validateEmits(handler: GeneratedHandlerRecordInput): void;
  validateCommandRoles(handler: GeneratedHandlerRecordInput): void;
  validateSubscription(handler: GeneratedHandlerRecordInput): void;
  validateWhere(handler: GeneratedHandlerRecordInput): void;
  isCommandSchema(schema: DescriptorMessageSchema): boolean;
  isLegacyEventSchema(schema: DescriptorMessageSchema): boolean;
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

    const receivers = (registry as { readonly receivers?: unknown }).receivers;
    if (!Array.isArray(receivers)) {
      throw new HandlerRegistryIngestionError(
        "UNSUPPORTED_REGISTRY_VERSION",
        "Generated handler registry must declare an unversioned receivers array; regenerate generated handler metadata.",
      );
    }
  },

  materializeAll(registry: GeneratedHandlerRegistry): readonly EntityHandlersMetadata[] {
    registry.receivers.forEach((receiver) => {
      if (receiver.receiverKind === "standalone") GeneratedRegistry.validateStandalone(receiver);
    });
    return Object.freeze(
      registry.receivers
        .filter((receiver): receiver is GeneratedEntityHandlerGroup => receiver.receiverKind === "entity")
        .map((receiver) => GeneratedRegistry.materialize(receiver)),
    );
  },

  materialize(entity: GeneratedEntityHandlerGroup): EntityHandlersMetadata {
    GeneratedRegistry.validateSchema(entity.stateSchema, "entity state schema");
    entity.handlers.forEach((handler) => {
      GeneratedRegistry.validateHandler(handler);
    });
    GeneratedRegistry.validateCommandHandlers(entity);

    return HandlerMetadataValues.defineArity(
      entity.receiverType,
      entity.stateSchema,
      (builder) => entity.handlers.map((handler) => GeneratedRegistry.build(builder, handler)),
      entity.handlers.map((handler) => ({
        kind: handler.kind,
        methodName: handler.methodName,
        ...(handler.kind === "event-subscription" || handler.kind === "state-subscription"
          ? {}
          : { emittedSchemas: Object.freeze([...handler.emittedSchemas]) }),
        parameterCount: handler.parameterCount,
        origin: handler.origin,
        ...(handler.where === undefined ? {} : { where: Object.freeze({ ...handler.where }) }),
      })),
    );
  },

  validateCommandHandlers(entity: GeneratedEntityHandlerGroup): void {
    if (
      entity.handlers.some(
        (handler) =>
          handler.kind === "command-substitution" || handler.kind === "command-reaction",
      ) &&
      !(entity.receiverType.prototype instanceof ProcessManager)
    ) {
      throw new HandlerRegistryIngestionError(
        "UNSUPPORTED_HANDLER_KIND",
        "Generated @Command handlers are supported only by Process Manager entities.",
      );
    }
  },

  validateStandalone(receiver: GeneratedStandaloneHandlerGroup): void {
    const prototype = receiver.receiverType.prototype;
    const role =
      prototype instanceof AbstractAssignee
        ? "assignee"
        : prototype instanceof AbstractCommander
          ? "commander"
          : prototype instanceof AbstractEventReactor
            ? "reactor"
            : prototype instanceof AbstractEventSubscriber
              ? "subscriber"
              : undefined;
    if (role === undefined) {
      throw new HandlerRegistryIngestionError(
        "UNSUPPORTED_HANDLER_KIND",
        "Standalone receiver must extend a supported nominal handler base class.",
      );
    }
    for (const handler of receiver.handlers) {
      GeneratedRegistry.validateHandler(handler);
      const valid =
        (role === "assignee" && handler.kind === "command-assignment") ||
        (role === "commander" && (handler.kind === "command-substitution" || handler.kind === "command-reaction")) ||
        (role === "reactor" && handler.kind === "event-reaction") ||
        (role === "subscriber" && (handler.kind === "event-subscription" || handler.kind === "state-subscription"));
      if (!valid) {
        throw new HandlerRegistryIngestionError(
          "UNSUPPORTED_HANDLER_KIND",
          `Generated handler "${handler.methodName}" is not legal for standalone ${role}.`,
        );
      }
      if (role === "assignee" || role === "reactor") {
        if (
          handler.emittedSchemas.some(
            (schema) => !GeneratedRegistry.isLegacyEventSchema(schema) || isEntitySchema(schema),
          )
        ) {
          throw new HandlerRegistryIngestionError("INVALID_SCHEMA", `Standalone ${role} "${handler.methodName}" must produce Events.`);
        }
      }
      if (role === "subscriber" && handler.origin === "external" && handler.kind === "state-subscription") {
        throw new HandlerRegistryIngestionError("INVALID_SIGNAL_ORIGIN", `Standalone state subscriber "${handler.methodName}" cannot accept External state.`);
      }
    }
  },

  build<Instance extends object>(
    builder: GeneratedHandlerRegistrationBuilder<Instance>,
    handler: GeneratedHandlerRecordInput,
  ): HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>> {
    switch (handler.kind) {
      case "command-assignment":
        return builder.assign(
          handler.signalSchema,
          handler.methodName as HandlerMethodName<Instance>,
        );
      case "command-substitution":
        return builder.substitute(
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
      case "state-subscription":
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

  validateHandler(
    handler: GeneratedHandlerRecordInput,
  ): void {
    if (!GeneratedRegistry.isKind(handler.kind)) {
      throw new HandlerRegistryIngestionError(
        "UNSUPPORTED_HANDLER_KIND",
        `Generated handler kind "${String(handler.kind)}" is not supported.`,
      );
    }

    const origin: unknown = handler.origin;
    if (origin !== "domestic" && origin !== "external") {
      throw new HandlerRegistryIngestionError(
        "INVALID_SIGNAL_ORIGIN",
        `Generated handler "${handler.methodName}" declares an invalid signal origin.`,
      );
    }
    if (
      handler.origin === "external" &&
      (handler.kind === "command-assignment" || handler.kind === "command-substitution")
    ) {
      throw new HandlerRegistryIngestionError(
        "EXTERNAL_COMMAND_RECEIVER",
        `Generated command receiver "${handler.methodName}" cannot accept external commands.`,
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
    GeneratedRegistry.validateCommandRoles(handler);
    GeneratedRegistry.validateWhere(handler);

    if (handler.kind === "event-subscription" || handler.kind === "state-subscription") {
      GeneratedRegistry.validateSubscription(handler);
      if (handler.kind === "state-subscription" && !isEntitySchema(handler.signalSchema)) {
        throw new HandlerRegistryIngestionError(
          "INVALID_SCHEMA",
          `Generated state subscription handler "${handler.methodName}" must declare an entity state schema.`,
        );
      }
      if (handler.kind === "event-subscription" && isEntitySchema(handler.signalSchema)) {
        throw new HandlerRegistryIngestionError(
          "INVALID_SCHEMA",
          `Generated event subscription handler "${handler.methodName}" must not declare an entity state schema.`,
        );
      }
      return;
    }

    if (
      handler.kind === "command-assignment" ||
      handler.kind === "command-substitution" ||
      handler.kind === "command-reaction"
    ) {
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

  validateCommandRoles(handler: GeneratedHandlerRecordInput): void {
    if (handler.kind !== "command-substitution" && handler.kind !== "command-reaction") {
      return;
    }
    if (
      handler.kind === "command-substitution" &&
      !GeneratedRegistry.isCommandSchema(handler.signalSchema)
    ) {
      throw new HandlerRegistryIngestionError(
        "INVALID_SCHEMA",
        `Generated command substitution "${handler.methodName}" must declare a Command input schema.`,
      );
    }
    if (
      handler.kind === "command-reaction" &&
      !GeneratedRegistry.isLegacyEventSchema(handler.signalSchema)
    ) {
      throw new HandlerRegistryIngestionError(
        "INVALID_SCHEMA",
        `Generated command reaction "${handler.methodName}" must declare an Event or rejection input schema.`,
      );
    }
    if (handler.emittedSchemas.every((schema) => GeneratedRegistry.isCommandSchema(schema))) return;
    throw new HandlerRegistryIngestionError(
      "INVALID_SCHEMA",
      `Generated @Command handler "${handler.methodName}" must declare Command outputs.`,
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

  validateWhere(handler: GeneratedHandlerRecordInput): void {
    const where = handler.where as unknown;
    if (where === undefined) return;
    if (
      typeof where !== "object" ||
      where === null ||
      Array.isArray(where) ||
      (Reflect.getPrototypeOf(where) !== Object.prototype && Reflect.getPrototypeOf(where) !== null)
    ) {
      throw new HandlerRegistryIngestionError(
        "INVALID_SCHEMA",
        `Generated handler "${handler.methodName}" declares an invalid Event field filter.`,
      );
    }
    const keys = Object.keys(where);
    const filter = where as Record<string, unknown>;
    if (
      keys.length !== 2 ||
      !keys.includes("eventField") ||
      !keys.includes("equals") ||
      typeof filter.eventField !== "string" ||
      filter.eventField.trim().length === 0 ||
      typeof filter.equals !== "string" ||
      !GeneratedRegistry.isLegacyEventSchema(handler.signalSchema) ||
      (handler.kind !== "event-subscription" &&
        handler.kind !== "event-reaction" &&
        handler.kind !== "command-reaction")
    ) {
      throw new HandlerRegistryIngestionError(
        "INVALID_SCHEMA",
        `Generated handler "${handler.methodName}" declares an invalid Event field filter.`,
      );
    }
  },

  isLegacyEventSchema(schema: DescriptorMessageSchema): boolean {
    const fileName = schema.file.name.split(/[\\/]/u).at(-1);
    return (
      fileName === "events" ||
      fileName === "events.proto" ||
      fileName?.endsWith("_events") === true ||
      fileName?.endsWith("_events.proto") === true ||
      fileName === "rejections" ||
      fileName?.endsWith("_rejections") === true ||
      RejectionSources.matches(schema.file.name) ||
      schema.typeName === "spine.core.Event"
    );
  },

  isCommandSchema(schema: DescriptorMessageSchema): boolean {
    const fileName = schema.file.name.split(/[\\/]/u).at(-1);
    return (
      schema.typeName === "spine.core.Command" ||
      fileName === "commands" ||
      fileName === "commands.proto" ||
      fileName?.endsWith("_commands") === true ||
      fileName?.endsWith("_commands.proto") === true
    );
  },

  isKind(kind: string): kind is GeneratedHandlerKind {
    return (
      kind === "command-assignment" ||
      kind === "command-substitution" ||
      kind === "command-reaction" ||
      kind === "event-subscription" ||
      kind === "state-subscription" ||
      kind === "event-reaction"
    );
  },
});
