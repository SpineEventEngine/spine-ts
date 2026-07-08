import type { EntityMetadata, DescriptorMessageSchema } from "../entity/entity-metadata.js";
import { describeEntityMetadata } from "../entity/entity-metadata.js";

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

/** Public handler method arity recorded in canonical metadata. */
export type HandlerParameterCount = 1 | 2;

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
export type HandlerMetadataErrorCode = "UNKNOWN_HANDLER_METHOD" | "INVALID_PARAMETER_COUNT";

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
  /** Public method arity: `handler(signal)` or `handler(signal, context)`. */
  readonly parameterCount: HandlerParameterCount;
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
  /** Legacy compatibility flag preserved on schema-bearing event appliers. */
  readonly allowImport?: boolean;
}

/** Metadata for an event applier method. */
export interface EventApplicationHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> extends BaseHandlerMetadata<"event-application", Schema, MethodName> {
  /** Legacy compatibility flag preserved on schema-bearing event appliers. */
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

/** Error code for handler metadata registry validation failures. */
export type HandlerMetadataRegistryErrorCode =
  "DUPLICATE_COMMAND_ASSIGNMENT" | "DUPLICATE_EVENT_APPLICATION";

/** Error thrown when a caller-owned handler metadata registry rejects metadata. */
export class HandlerMetadataRegistryError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: HandlerMetadataRegistryErrorCode;

  constructor(code: HandlerMetadataRegistryErrorCode, message: string) {
    super(message);
    this.name = "HandlerMetadataRegistryError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A handler metadata record paired with the entity metadata that declared it. */
export interface RegisteredHandlerMetadata<Handler extends HandlerMetadata = HandlerMetadata> {
  /** Entity handler metadata object registered by the caller. */
  readonly entityHandlers: EntityHandlersMetadata;
  /** Entity class that owns the registered handler method. */
  readonly entityType: EntityClass;
  /** Descriptor-derived entity metadata for the handler's state type. */
  readonly entity: EntityMetadata;
  /** Handler metadata record declared for the entity. */
  readonly handler: Handler;
}

/** Read-only lookup surface for already registered handler metadata. */
export interface HandlerMetadataRegistryLookup {
  /** Return registered entity handler metadata in registration order. */
  listEntityHandlers(): readonly EntityHandlersMetadata[];
  /** Return all registered handler entries in registration and declaration order. */
  listHandlers(): readonly RegisteredHandlerMetadata[];
  /** Find entity handler metadata by entity state full type name. */
  findEntityHandlersByState(entityStateFullTypeName: string): readonly EntityHandlersMetadata[];
  /** Find handler entries by handler role. */
  findHandlersByKind<Kind extends HandlerKind>(
    kind: Kind,
  ): readonly RegisteredHandlerMetadata<Extract<HandlerMetadata, { readonly kind: Kind }>>[];
  /** Find handler entries by command/event message full type name. */
  findHandlersByMessageFullTypeName(
    messageFullTypeName: string,
  ): readonly RegisteredHandlerMetadata[];
  /** Find the unique command assignment for a command message full type name. */
  findCommandAssignment(
    commandFullTypeName: string,
  ): RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> | undefined;
  /** Find the unique event applier for an entity state and event message full type name. */
  findEventApplication(
    entityStateFullTypeName: string,
    eventFullTypeName: string,
  ): RegisteredHandlerMetadata<EventApplicationHandlerMetadata> | undefined;
}

/** Caller-owned registry for lookup-only handler metadata and duplicate validation. */
export class HandlerMetadataRegistry implements HandlerMetadataRegistryLookup {
  readonly #entityHandlers: EntityHandlersMetadata[] = [];
  readonly #handlerEntries: RegisteredHandlerMetadata[] = [];
  readonly #byEntityState = new Map<string, EntityHandlersMetadata[]>();
  readonly #byKind = new Map<HandlerKind, RegisteredHandlerMetadata[]>();
  readonly #byMessage = new Map<string, RegisteredHandlerMetadata[]>();
  readonly #commandAssignments = new Map<
    string,
    RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>
  >();
  readonly #eventApplications = new Map<
    string,
    RegisteredHandlerMetadata<EventApplicationHandlerMetadata>
  >();

  /** Create a caller-owned registry and optionally register metadata immediately. */
  constructor(entityHandlers: Iterable<EntityHandlersMetadata> = []) {
    for (const metadata of entityHandlers) {
      this.register(metadata);
    }
  }

  /** Register one entity handler metadata object and return it unchanged. */
  register<Metadata extends EntityHandlersMetadata>(metadata: Metadata): Metadata {
    const entries = metadata.handlers.map((handler) => createRegisteredHandler(metadata, handler));
    const commandAssignments = new Map<
      string,
      RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>
    >();
    const eventApplications = new Map<
      string,
      RegisteredHandlerMetadata<EventApplicationHandlerMetadata>
    >();

    for (const entry of entries) {
      if (entry.handler.kind === "command-assignment") {
        const commandEntry = entry as RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>;
        validateCommandAssignment(
          commandEntry,
          this.#commandAssignments.get(entry.handler.messageFullTypeName) ??
            commandAssignments.get(entry.handler.messageFullTypeName),
        );
        commandAssignments.set(entry.handler.messageFullTypeName, commandEntry);
      }

      if (entry.handler.kind === "event-application") {
        const eventEntry = entry as RegisteredHandlerMetadata<EventApplicationHandlerMetadata>;
        const key = eventApplicationKey(
          entry.entity.fullTypeName,
          entry.handler.messageFullTypeName,
        );

        validateEventApplication(
          eventEntry,
          this.#eventApplications.get(key) ?? eventApplications.get(key),
        );
        eventApplications.set(key, eventEntry);
      }
    }

    this.#entityHandlers.push(metadata);
    pushMapValue(this.#byEntityState, metadata.entity.fullTypeName, metadata);

    for (const entry of entries) {
      this.#handlerEntries.push(entry);
      pushMapValue(this.#byKind, entry.handler.kind, entry);
      pushMapValue(this.#byMessage, entry.handler.messageFullTypeName, entry);
    }

    for (const [messageFullTypeName, entry] of commandAssignments) {
      this.#commandAssignments.set(messageFullTypeName, entry);
    }

    for (const [key, entry] of eventApplications) {
      this.#eventApplications.set(key, entry);
    }

    return metadata;
  }

  /** Return registered entity handler metadata in registration order. */
  listEntityHandlers(): readonly EntityHandlersMetadata[] {
    return Object.freeze([...this.#entityHandlers]);
  }

  /** Return all registered handler entries in registration and declaration order. */
  listHandlers(): readonly RegisteredHandlerMetadata[] {
    return Object.freeze([...this.#handlerEntries]);
  }

  /** Find entity handler metadata by entity state full type name. */
  findEntityHandlersByState(entityStateFullTypeName: string): readonly EntityHandlersMetadata[] {
    return Object.freeze([...(this.#byEntityState.get(entityStateFullTypeName) ?? [])]);
  }

  /** Find handler entries by handler role. */
  findHandlersByKind<Kind extends HandlerKind>(
    kind: Kind,
  ): readonly RegisteredHandlerMetadata<Extract<HandlerMetadata, { readonly kind: Kind }>>[] {
    return Object.freeze([
      ...((this.#byKind.get(kind) ?? []) as RegisteredHandlerMetadata<
        Extract<HandlerMetadata, { readonly kind: Kind }>
      >[]),
    ]);
  }

  /** Find handler entries by command/event message full type name. */
  findHandlersByMessageFullTypeName(
    messageFullTypeName: string,
  ): readonly RegisteredHandlerMetadata[] {
    return Object.freeze([...(this.#byMessage.get(messageFullTypeName) ?? [])]);
  }

  /** Find the unique command assignment for a command message full type name. */
  findCommandAssignment(
    commandFullTypeName: string,
  ): RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> | undefined {
    return this.#commandAssignments.get(commandFullTypeName);
  }

  /** Find the unique event applier for an entity state and event message full type name. */
  findEventApplication(
    entityStateFullTypeName: string,
    eventFullTypeName: string,
  ): RegisteredHandlerMetadata<EventApplicationHandlerMetadata> | undefined {
    return this.#eventApplications.get(
      eventApplicationKey(entityStateFullTypeName, eventFullTypeName),
    );
  }
}

const authenticEntityHandlers = new WeakSet<EntityHandlersMetadata>();

/** @internal Framework-owned arity override for generated handler metadata ingestion. */
export interface HandlerArity {
  /** Handler role whose public arity is being preserved. */
  readonly kind: Exclude<HandlerKind, "event-application">;
  /** Entity instance method name selected by generated metadata. */
  readonly methodName: string;
  /** Public method arity: `handler(signal)` or `handler(signal, context)`. */
  readonly parameterCount: HandlerParameterCount;
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
  return defineEntityHandlersCore(entityType, stateSchema, define, []);
}

function defineEntityHandlersCore<
  Instance extends object,
  StateSchema extends DescriptorMessageSchema,
>(
  entityType: EntityClass<Instance>,
  stateSchema: StateSchema,
  define: (
    builder: HandlerRegistrationBuilder<Instance>,
  ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
  arities: Iterable<HandlerArity>,
): EntityHandlersMetadata<Instance, StateSchema> {
  const builtHandlers = new WeakSet<HandlerMetadata>();
  const builder = createHandlerRegistrationBuilder(
    entityType,
    builtHandlers,
    createHandlerArityMap(arities),
  );
  const handlers = Object.freeze([...define(builder)]);
  validateBuiltHandlers(handlers, builtHandlers);
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

  authenticEntityHandlers.add(metadata);
  return Object.freeze(metadata);
}

/** @internal Framework-only handler metadata authority contract. */
export interface HandlerMetadataAccess {
  isAuthentic(metadata: EntityHandlersMetadata): metadata is EntityHandlersMetadata;
  defineArity<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: HandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
    arities: Iterable<HandlerArity>,
  ): EntityHandlersMetadata<Instance, StateSchema>;
}

/** @internal Framework-only handler metadata authority. */
export const handlerMetadataAccess: HandlerMetadataAccess = Object.freeze({
  isAuthentic(metadata: EntityHandlersMetadata): metadata is EntityHandlersMetadata {
    return authenticEntityHandlers.has(metadata);
  },

  defineArity<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: HandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
    arities: Iterable<HandlerArity>,
  ): EntityHandlersMetadata<Instance, StateSchema> {
    return defineEntityHandlersCore(entityType, stateSchema, define, arities);
  },
});

function createHandlerRegistrationBuilder<Instance extends object>(
  entityType: EntityClass<Instance>,
  builtHandlers: WeakSet<HandlerMetadata>,
  arities: ReadonlyMap<string, HandlerParameterCount>,
): HandlerRegistrationBuilder<Instance> {
  return Object.freeze({
    assign: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) =>
      createHandler(entityType, "command-assignment", schema, methodName, builtHandlers, arities),
    command: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) => createHandler(entityType, "command-reaction", schema, methodName, builtHandlers, arities),
    subscribe: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) =>
      createHandler(entityType, "event-subscription", schema, methodName, builtHandlers, arities),
    react: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
    ) => createHandler(entityType, "event-reaction", schema, methodName, builtHandlers, arities),
    apply: <Schema extends DescriptorMessageSchema>(
      schema: Schema,
      methodName: HandlerMethodName<Instance>,
      options: EventApplicationOptions = {},
    ) => {
      const handler: EventApplicationHandlerMetadata<
        Schema,
        HandlerMethodName<Instance>
      > = Object.freeze({
        ...createHandler(entityType, "event-application", schema, methodName, builtHandlers),
        allowImport: options.allowImport ?? false,
      });
      builtHandlers.add(handler);
      return handler;
    },
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
  builtHandlers: WeakSet<HandlerMetadata>,
  arities: ReadonlyMap<string, HandlerParameterCount> = new Map(),
): BaseHandlerMetadata<Kind, Schema, HandlerMethodName<Instance>> {
  validateHandlerMethod(entityType, methodName);
  const parameterCount = arities.get(handlerArityKey(kind, methodName)) ?? 1;

  const handler = Object.freeze({
    kind,
    schema,
    descriptor: schema,
    messageFullTypeName: schema.typeName,
    methodName,
    parameterCount,
  });
  builtHandlers.add(handler as HandlerMetadata);
  return handler;
}

function createHandlerArityMap(
  arities: Iterable<HandlerArity>,
): ReadonlyMap<string, HandlerParameterCount> {
  const byHandler = new Map<string, HandlerParameterCount>();

  for (const arity of arities) {
    byHandler.set(
      handlerArityKey(arity.kind, arity.methodName),
      readParameterCount(arity.parameterCount),
    );
  }

  return byHandler;
}

function readParameterCount(parameterCount: unknown): HandlerParameterCount {
  if (parameterCount === 1 || parameterCount === 2) {
    return parameterCount;
  }

  throw new HandlerMetadataError(
    "INVALID_PARAMETER_COUNT",
    `Handler metadata declares unsupported parameter count ${String(parameterCount)}.`,
  );
}

function handlerArityKey(kind: HandlerKind, methodName: string): string {
  return `${kind}\u0000${methodName}`;
}

function validateBuiltHandlers(
  handlers: readonly HandlerMetadata[],
  builtHandlers: WeakSet<HandlerMetadata>,
): void {
  for (const handler of handlers) {
    if (!builtHandlers.has(handler)) {
      throw new HandlerMetadataError(
        "UNKNOWN_HANDLER_METHOD",
        "Handler metadata must be created by the registration builder.",
      );
    }
  }
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
      `Handler method "${methodName}" must be an own prototype data method declared with ` +
        "normal class method syntax on the registered entity prototype.",
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

function createRegisteredHandler(
  entityHandlers: EntityHandlersMetadata,
  handler: HandlerMetadata,
): RegisteredHandlerMetadata {
  return Object.freeze({
    entityHandlers,
    entityType: entityHandlers.entityType,
    entity: entityHandlers.entity,
    handler,
  });
}

function validateCommandAssignment(
  entry: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>,
  duplicate: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> | undefined,
): void {
  if (duplicate === undefined) {
    return;
  }

  throw new HandlerMetadataRegistryError(
    "DUPLICATE_COMMAND_ASSIGNMENT",
    `Duplicate command assignment for "${entry.handler.messageFullTypeName}" declared by entity ` +
      `"${entry.entity.fullTypeName}"; already declared by entity ` +
      `"${duplicate.entity.fullTypeName}".`,
  );
}

function validateEventApplication(
  entry: RegisteredHandlerMetadata<EventApplicationHandlerMetadata>,
  duplicate: RegisteredHandlerMetadata<EventApplicationHandlerMetadata> | undefined,
): void {
  if (duplicate === undefined) {
    return;
  }

  throw new HandlerMetadataRegistryError(
    "DUPLICATE_EVENT_APPLICATION",
    `Duplicate event application for entity "${entry.entity.fullTypeName}" and event ` +
      `"${entry.handler.messageFullTypeName}"; already declared by method ` +
      `"${duplicate.handler.methodName}".`,
  );
}

function eventApplicationKey(entityStateName: string, eventFullTypeName: string): string {
  return `${entityStateName}\u0000${eventFullTypeName}`;
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key);

  if (values === undefined) {
    map.set(key, [value]);
    return;
  }

  values.push(value);
}
