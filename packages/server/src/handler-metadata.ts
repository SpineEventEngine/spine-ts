import type { EntityMetadata, DescriptorMessageSchema } from "./entity-metadata.js";
import { describeEntityMetadata } from "./entity-metadata.js";

/** Entity class value accepted by explicit handler metadata registration. */
export interface EntityClass<Instance extends object = object> {
  /**
   * Prototype inspected for explicitly named handler methods. Registered names
   * must refer to own prototype data methods declared with normal class method
   * syntax; accessors, `constructor`, inherited methods, and instance fields are
   * rejected at runtime.
   */
  readonly prototype: Instance;
}

/** Public handler metadata categories produced by explicit registration. */
export type HandlerKind =
  | "command-assignment"
  | "command-reaction"
  | "event-subscription"
  | "event-reaction"
  | "event-application";

/**
 * Compile-time approximation of entity callable member names.
 *
 * TypeScript cannot distinguish normal class prototype methods from accessors
 * that return functions or other callable instance properties. Runtime
 * registration therefore applies the narrower public contract: handler names
 * must be own prototype data methods declared with normal class method syntax.
 */
export type HandlerMethodName<Instance extends object> = Extract<
  {
    [Name in keyof Instance]: Instance[Name] extends (...parameters: never[]) => unknown
      ? Name
      : never;
  }[keyof Instance],
  string
>;

/** Error code for explicit handler metadata registration failures. */
export type HandlerMetadataErrorCode = "UNKNOWN_HANDLER_METHOD";

/** Error thrown when explicit handler metadata cannot be defined. */
export class HandlerMetadataError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: HandlerMetadataErrorCode;

  constructor(code: HandlerMetadataErrorCode, message: string) {
    super(message);
    this.name = "HandlerMetadataError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Common fields shared by every explicit handler metadata record. */
export interface BaseHandlerMetadata<
  Kind extends HandlerKind = HandlerKind,
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> {
  /** Handler role in Spine's command/event model. */
  readonly kind: Kind;
  /** Generated Protobuf-ES schema accepted by the handler method. */
  readonly schema: Schema;
  /** Alias for the schema as the descriptor-bearing message declaration. */
  readonly descriptor: Schema;
  /** Fully qualified Protobuf type name handled by the method. */
  readonly messageFullTypeName: Schema["typeName"];
  /** Entity instance method name selected by explicit registration. */
  readonly methodName: MethodName;
}

/** Metadata for a command assignee method. */
export type CommandAssignmentHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"command-assignment", Schema, MethodName>;

/** Metadata for a command-reacting method. */
export type CommandReactionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"command-reaction", Schema, MethodName>;

/** Metadata for an event subscription method. */
export type EventSubscriptionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"event-subscription", Schema, MethodName>;

/** Metadata for an event reactor method. */
export type EventReactionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"event-reaction", Schema, MethodName>;

/** Options accepted by event applier registration. */
export interface EventApplicationOptions {
  /** Whether this applier may be used by later import/replay machinery. */
  readonly allowImport?: boolean;
}

/** Metadata for an event applier method. */
export interface EventApplicationHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> extends BaseHandlerMetadata<"event-application", Schema, MethodName> {
  /** Whether later import/replay machinery may use this applier. */
  readonly allowImport: boolean;
}

/** Union of all explicit handler metadata records. */
export type HandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> =
  | CommandAssignmentHandlerMetadata<Schema, MethodName>
  | CommandReactionHandlerMetadata<Schema, MethodName>
  | EventSubscriptionHandlerMetadata<Schema, MethodName>
  | EventReactionHandlerMetadata<Schema, MethodName>
  | EventApplicationHandlerMetadata<Schema, MethodName>;

/**
 * Builder passed to `defineEntityHandlers()` for typed method-name registration.
 *
 * Builder methods accept the compile-time callable-name approximation, then
 * validate that the selected name is an own prototype data method.
 */
export interface HandlerRegistrationBuilder<Instance extends object> {
  /** Register a command assignee method. */
  assign<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): CommandAssignmentHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /** Register a command reactor method. */
  command<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): CommandReactionHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /** Register an event subscriber method. */
  subscribe<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): EventSubscriptionHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /** Register an event reactor method. */
  react<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): EventReactionHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /** Register an event applier method. */
  apply<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
    options?: EventApplicationOptions,
  ): EventApplicationHandlerMetadata<Schema, HandlerMethodName<Instance>>;
}

/** Frozen handler metadata for one explicitly registered entity class. */
export interface EntityHandlersMetadata<
  Instance extends object = object,
  StateSchema extends DescriptorMessageSchema = DescriptorMessageSchema,
> {
  /** Entity class whose prototype owns the registered methods. */
  readonly entityType: EntityClass<Instance>;
  /** Descriptor-derived state metadata from `describeEntityMetadata()`. */
  readonly entity: EntityMetadata<StateSchema>;
  /** All handlers in declaration order. */
  readonly handlers: readonly HandlerMetadata[];
  /** Command assignees in declaration order. */
  readonly commandAssignments: readonly CommandAssignmentHandlerMetadata[];
  /** Command reactors in declaration order. */
  readonly commandReactions: readonly CommandReactionHandlerMetadata[];
  /** Event subscribers in declaration order. */
  readonly eventSubscriptions: readonly EventSubscriptionHandlerMetadata[];
  /** Event reactors in declaration order. */
  readonly eventReactions: readonly EventReactionHandlerMetadata[];
  /** Event appliers in declaration order. */
  readonly eventApplications: readonly EventApplicationHandlerMetadata[];
}

/**
 * Explicitly bind schemas to entity class method names without invoking handlers.
 *
 * Handler names must identify own prototype data methods declared with normal
 * class method syntax. Registration rejects accessors, `constructor`, inherited
 * methods, and instance fields without invoking user code.
 */
export function defineEntityHandlers<
  Instance extends object,
  StateSchema extends DescriptorMessageSchema,
>(
  entityType: EntityClass<Instance>,
  stateSchema: StateSchema,
  define: (
    builder: HandlerRegistrationBuilder<Instance>,
  ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
): EntityHandlersMetadata<Instance, StateSchema> {
  const builder = createHandlerRegistrationBuilder(entityType);
  const handlers = Object.freeze([...define(builder)]);
  const metadata: EntityHandlersMetadata<Instance, StateSchema> = {
    entityType,
    entity: describeEntityMetadata(stateSchema),
    handlers,
    commandAssignments: filterHandlers(handlers, "command-assignment"),
    commandReactions: filterHandlers(handlers, "command-reaction"),
    eventSubscriptions: filterHandlers(handlers, "event-subscription"),
    eventReactions: filterHandlers(handlers, "event-reaction"),
    eventApplications: filterHandlers(handlers, "event-application"),
  };

  return Object.freeze(metadata);
}

function createHandlerRegistrationBuilder<Instance extends object>(
  entityType: EntityClass<Instance>,
): HandlerRegistrationBuilder<Instance> {
  return Object.freeze({
    assign: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) => createHandler(entityType, "command-assignment", schema, methodName),
    command: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) => createHandler(entityType, "command-reaction", schema, methodName),
    subscribe: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) => createHandler(entityType, "event-subscription", schema, methodName),
    react: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) => createHandler(entityType, "event-reaction", schema, methodName),
    apply: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
      options: EventApplicationOptions = {},
    ) =>
      Object.freeze({
        ...createHandler(entityType, "event-application", schema, methodName),
        allowImport: options.allowImport ?? false,
      }),
  });
}

function createHandler<
  Instance extends object,
  Kind extends Exclude<HandlerKind, "event-application"> | "event-application",
  Schema extends DescriptorMessageSchema,
>(
  entityType: EntityClass<Instance>,
  kind: Kind,
  schema: Schema,
  methodName: HandlerMethodName<Instance>,
): BaseHandlerMetadata<Kind, Schema, HandlerMethodName<Instance>> {
  validateHandlerMethod(entityType, methodName);

  return Object.freeze({
    kind,
    schema,
    descriptor: schema,
    messageFullTypeName: schema.typeName,
    methodName,
  });
}

function validateHandlerMethod<Instance extends object>(
  entityType: EntityClass<Instance>,
  methodName: HandlerMethodName<Instance>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(entityType.prototype, methodName);

  if (
    methodName === "constructor" ||
    descriptor === undefined ||
    typeof descriptor.value !== "function"
  ) {
    throw new HandlerMetadataError(
      "UNKNOWN_HANDLER_METHOD",
      `Handler method "${methodName}" must be an own prototype data method declared with normal class method syntax on the registered entity prototype.`,
    );
  }
}

function filterHandlers<Kind extends HandlerKind>(
  handlers: readonly HandlerMetadata[],
  kind: Kind,
): readonly Extract<HandlerMetadata, { readonly kind: Kind }>[] {
  return Object.freeze(
    handlers.filter((handler): handler is Extract<HandlerMetadata, { readonly kind: Kind }> => {
      return handler.kind === kind;
    }),
  );
}
