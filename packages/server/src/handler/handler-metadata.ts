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

import type { EntityMetadata, DescriptorMessageSchema } from "../entity/entity-metadata.js";
import { describeEntityMetadata, isEntitySchema } from "../entity/entity-metadata.js";

/**
 * Entity class value accepted by explicit handler metadata registration.
 */
export interface EntityClass<Instance extends object = object> {
  // prettier-ignore

  /**
   * Prototype inspected for explicitly named handler methods. Registered names
   * must refer to own prototype data methods declared with normal class method
   * syntax; accessors, `constructor`, inherited methods, and instance fields are
   * rejected at runtime.
   */
  readonly prototype: Instance;
}

/**
 * Public handler metadata categories produced by explicit registration.
 */
export type HandlerKind =
  | "command-assignment"
  | "command-reaction"
  | "event-subscription"
  | "state-subscription"
  | "event-reaction"
  | "event-application";

/**
 * Public handler method arity recorded in canonical metadata.
 */
export type HandlerParameterCount = 1 | 2;

/**
 * Origin declared by a generated receptor's first parameter.
 */
export type HandlerOrigin = "domestic" | "external";

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

/**
 * Error code for explicit handler metadata registration failures.
 */
export type HandlerMetadataErrorCode = "UNKNOWN_HANDLER_METHOD" | "INVALID_PARAMETER_COUNT";

/**
 * Error thrown when explicit handler metadata cannot be defined.
 */
export class HandlerMetadataError extends Error {
  // prettier-ignore

  /**
   * Stable code for callers/tests that need structured failure handling.
   */
  readonly code: HandlerMetadataErrorCode;

  /**
   * Creates a registration error.
   *
   * @param code Stable failure code.
   * @param message Human-readable failure detail.
   */
  constructor(code: HandlerMetadataErrorCode, message: string) {
    super(message);
    this.name = "HandlerMetadataError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Common fields shared by every explicit handler metadata record.
 */
export interface BaseHandlerMetadata<
  Kind extends HandlerKind = HandlerKind,
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> {
  // prettier-ignore

  /**
   * Handler role in Spine's command/event model.
   */
  readonly kind: Kind;

  /**
   * Generated Protobuf-ES schema accepted by the handler method.
   */
  readonly schema: Schema;

  /**
   * Alias for the schema as the descriptor-bearing message declaration.
   */
  readonly descriptor: Schema;

  /**
   * Fully qualified Protobuf type name handled by the method.
   */
  readonly messageFullTypeName: Schema["typeName"];

  /**
   * Entity instance method name selected by explicit registration.
   */
  readonly methodName: MethodName;

  /**
   * Public method arity: `handler(signal)` or `handler(signal, context)`.
   */
  readonly parameterCount: HandlerParameterCount;

  /**
   * Whether this receptor accepts domestic or imported external signals.
   */
  readonly origin: HandlerOrigin;

  /**
   * Optional Event field equality filter generated for this handler.
   */
  readonly where?: WhereOptions;
}

/**
 * Declares one equality filter for an Event-consuming handler.
 */
export interface WhereOptions {
  // prettier-ignore

  /**
   * Proto source-name path of the Event field to compare.
   */
  readonly eventField: string;

  /**
   * Expected field value in its canonical Stringifier representation.
   */
  readonly equals: string;
}

/**
 * Metadata for a command assignee method.
 */
export type CommandAssignmentHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"command-assignment", Schema, MethodName>;

/**
 * Metadata for a command-reacting method.
 */
export type CommandReactionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"command-reaction", Schema, MethodName>;

/**
 * Metadata for an event subscription method.
 */
export type EventSubscriptionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"event-subscription", Schema, MethodName>;

/**
 * Metadata for an Entity-state subscription method.
 */
export type StateSubscriptionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"state-subscription", Schema, MethodName>;

/**
 * Metadata for an event reactor method.
 */
export type EventReactionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"event-reaction", Schema, MethodName>;

/**
 * Options accepted by event applier registration.
 */
export interface EventApplicationOptions {
  // prettier-ignore

  /**
   * Legacy compatibility flag preserved on schema-bearing event appliers.
   */
  readonly allowImport?: boolean;
}

/**
 * Metadata for an event applier method.
 */
export interface EventApplicationHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> extends BaseHandlerMetadata<"event-application", Schema, MethodName> {
  // prettier-ignore

  /**
   * Legacy compatibility flag preserved on schema-bearing event appliers.
   */
  readonly allowImport: boolean;
}

/**
 * Union of all explicit handler metadata records.
 */
export type HandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> =
  | CommandAssignmentHandlerMetadata<Schema, MethodName>
  | CommandReactionHandlerMetadata<Schema, MethodName>
  | EventSubscriptionHandlerMetadata<Schema, MethodName>
  | StateSubscriptionHandlerMetadata<Schema, MethodName>
  | EventReactionHandlerMetadata<Schema, MethodName>
  | EventApplicationHandlerMetadata<Schema, MethodName>;

/**
 * Builder passed to `EntityHandlers.define()` for typed method-name registration.
 *
 * Builder methods accept the compile-time callable-name approximation, then
 * validate that the selected name is an own prototype data method.
 */
export interface HandlerRegistrationBuilder<Instance extends object> {
  // prettier-ignore

  /**
   * Registers a command assignee method.
   *
   * @param schema Command schema accepted by the method.
   * @param methodName Entity method name.
   * @returns The registered command-assignment metadata.
   */
  assign<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): CommandAssignmentHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /**
   * Registers a command reactor method.
   *
   * @param schema Command schema accepted by the method.
   * @param methodName Entity method name.
   * @returns The registered command-reaction metadata.
   */
  command<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): CommandReactionHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /**
   * Registers an Event/rejection or Entity-state subscriber method.
   *
   * @param schema Event, rejection, or descriptor-marked Entity state schema
   * accepted by the method.
   * @param methodName Entity method name.
   * @returns Event-subscription metadata for signals, or state-subscription
   * metadata for descriptor-marked Entity state schemas.
   */
  subscribe<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ):
    | EventSubscriptionHandlerMetadata<Schema, HandlerMethodName<Instance>>
    | StateSubscriptionHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /**
   * Registers an event reactor method.
   *
   * @param schema Event schema accepted by the method.
   * @param methodName Entity method name.
   * @returns The registered event-reaction metadata.
   */
  react<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): EventReactionHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /**
   * Registers an event applier method.
   *
   * @param schema Event schema accepted by the method.
   * @param methodName Entity method name.
   * @param options Legacy event-application options.
   * @returns The registered event-application metadata.
   */
  apply<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
    options?: EventApplicationOptions,
  ): EventApplicationHandlerMetadata<Schema, HandlerMethodName<Instance>>;
}

/**
 * Frozen handler metadata for one explicitly registered entity class.
 */
export interface EntityHandlersMetadata<
  Instance extends object = object,
  StateSchema extends DescriptorMessageSchema = DescriptorMessageSchema,
> {
  // prettier-ignore

  /**
   * Entity class whose prototype owns the registered methods.
   */
  readonly entityType: EntityClass<Instance>;

  /**
   * Descriptor-derived state metadata from `describeEntityMetadata()`.
   */
  readonly entity: EntityMetadata<StateSchema>;

  /**
   * All handlers in declaration order.
   */
  readonly handlers: readonly HandlerMetadata[];

  /**
   * Command assignees in declaration order.
   */
  readonly commandAssignments: readonly CommandAssignmentHandlerMetadata[];

  /**
   * Command reactors in declaration order.
   */
  readonly commandReactions: readonly CommandReactionHandlerMetadata[];

  /**
   * Event subscribers in declaration order.
   */
  readonly eventSubscriptions: readonly EventSubscriptionHandlerMetadata[];

  /**
   * Entity-state subscribers in declaration order.
   */
  readonly stateSubscriptions: readonly StateSubscriptionHandlerMetadata[];

  /**
   * Event reactors in declaration order.
   */
  readonly eventReactions: readonly EventReactionHandlerMetadata[];

  /**
   * Event appliers in declaration order.
   */
  readonly eventApplications: readonly EventApplicationHandlerMetadata[];
}

/**
 * Error code for handler metadata registry validation failures.
 */
export type HandlerRegistryErrorCode =
  "DUPLICATE_COMMAND_ASSIGNMENT" | "DUPLICATE_EVENT_APPLICATION";

/**
 * Error thrown when a caller-owned handler metadata registry rejects metadata.
 */
export class HandlerMetadataRegistryError extends Error {
  // prettier-ignore

  /**
   * Stable code for callers/tests that need structured failure handling.
   */
  readonly code: HandlerRegistryErrorCode;

  /**
   * Creates a registry validation error.
   *
   * @param code Stable failure code.
   * @param message Human-readable failure detail.
   */
  constructor(code: HandlerRegistryErrorCode, message: string) {
    super(message);
    this.name = "HandlerMetadataRegistryError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * A handler metadata record paired with the entity metadata that declared it.
 */
export interface RegisteredHandlerMetadata<Handler extends HandlerMetadata = HandlerMetadata> {
  // prettier-ignore

  /**
   * Entity handler metadata object registered by the caller.
   */
  readonly entityHandlers: EntityHandlersMetadata;

  /**
   * Entity class that owns the registered handler method.
   */
  readonly entityType: EntityClass;

  /**
   * Descriptor-derived entity metadata for the handler's state type.
   */
  readonly entity: EntityMetadata;

  /**
   * Handler metadata record declared for the entity.
   */
  readonly handler: Handler;
}

/**
 * Read-only lookup surface for already registered handler metadata.
 */
export interface HandlerMetadataRegistryLookup {
  // prettier-ignore

  /**
   * Returns registered entity handler metadata in registration order.
   *
   * @returns A fresh frozen metadata list.
   */
  listEntityHandlers(): readonly EntityHandlersMetadata[];

  /**
   * Returns registered handler entries in registration and declaration order.
   *
   * @returns A fresh frozen registered-handler list.
   */
  listHandlers(): readonly RegisteredHandlerMetadata[];

  /**
   * Finds entity handler metadata by state type name.
   *
   * @param stateTypeName Fully qualified entity state type name.
   * @returns Matching metadata in registration order.
   */
  findByState(stateTypeName: string): readonly EntityHandlersMetadata[];

  /**
   * Finds handler entries by handler role.
   *
   * @param kind Handler role.
   * @returns Matching entries in registration and declaration order.
   */
  findHandlersByKind<Kind extends HandlerKind>(
    kind: Kind,
  ): readonly RegisteredHandlerMetadata<Extract<HandlerMetadata, { readonly kind: Kind }>>[];

  /**
   * Finds handler entries by message type name.
   *
   * @param messageTypeName Fully qualified command or event type name.
   * @returns Matching entries in registration and declaration order.
   */
  findByMessage(messageTypeName: string): readonly RegisteredHandlerMetadata[];

  /**
   * Finds the unique command assignment for a command type.
   *
   * @param commandTypeName Fully qualified command type name.
   * @returns The assignment when registered.
   */
  findCommandAssignment(
    commandTypeName: string,
  ): RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> | undefined;

  /**
   * Finds the unique event applier for a state and event type.
   *
   * @param stateTypeName Fully qualified entity state type name.
   * @param eventTypeName Fully qualified event type name.
   * @returns The applier when registered.
   */
  findEventApplication(
    stateTypeName: string,
    eventTypeName: string,
  ): RegisteredHandlerMetadata<EventApplicationHandlerMetadata> | undefined;
}

/**
 * Caller-owned registry for lookup-only handler metadata and duplicate validation.
 */
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

  /**
   * Creates a caller-owned registry and optionally registers metadata.
   *
   * @param entityHandlers Entity metadata to register in iteration order.
   */
  constructor(entityHandlers: Iterable<EntityHandlersMetadata> = []) {
    for (const metadata of entityHandlers) {
      this.register(metadata);
    }
  }

  /**
   * Registers one entity handler metadata object.
   *
   * @param metadata Entity handler metadata to register.
   * @returns The registered metadata unchanged.
   */
  register<Metadata extends EntityHandlersMetadata>(metadata: Metadata): Metadata {
    const entries = metadata.handlers.map((handler) => this.#entry(metadata, handler));
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
        this.#validateAssignment(
          commandEntry,
          this.#commandAssignments.get(entry.handler.messageFullTypeName) ??
            commandAssignments.get(entry.handler.messageFullTypeName),
        );
        commandAssignments.set(entry.handler.messageFullTypeName, commandEntry);
      }

      if (entry.handler.kind === "event-application") {
        const eventEntry = entry as RegisteredHandlerMetadata<EventApplicationHandlerMetadata>;
        const key = this.#applicationKey(
          entry.entity.fullTypeName,
          entry.handler.messageFullTypeName,
        );

        this.#validateApplication(
          eventEntry,
          this.#eventApplications.get(key) ?? eventApplications.get(key),
        );
        eventApplications.set(key, eventEntry);
      }
    }

    this.#entityHandlers.push(metadata);
    this.#push(this.#byEntityState, metadata.entity.fullTypeName, metadata);

    for (const entry of entries) {
      this.#handlerEntries.push(entry);
      this.#push(this.#byKind, entry.handler.kind, entry);
      this.#push(this.#byMessage, entry.handler.messageFullTypeName, entry);
    }

    for (const [messageFullTypeName, entry] of commandAssignments) {
      this.#commandAssignments.set(messageFullTypeName, entry);
    }

    for (const [key, entry] of eventApplications) {
      this.#eventApplications.set(key, entry);
    }

    return metadata;
  }

  /**
   * Returns registered entity handler metadata in registration order.
   *
   * @returns A fresh frozen metadata list.
   */
  listEntityHandlers(): readonly EntityHandlersMetadata[] {
    return Object.freeze([...this.#entityHandlers]);
  }

  /**
   * Returns registered handler entries in registration and declaration order.
   *
   * @returns A fresh frozen registered-handler list.
   */
  listHandlers(): readonly RegisteredHandlerMetadata[] {
    return Object.freeze([...this.#handlerEntries]);
  }

  /**
   * Finds entity handler metadata by state type name.
   *
   * @param stateTypeName Fully qualified entity state type name.
   * @returns Matching metadata in registration order.
   */
  findByState(stateTypeName: string): readonly EntityHandlersMetadata[] {
    return Object.freeze([...(this.#byEntityState.get(stateTypeName) ?? [])]);
  }

  /**
   * Finds handler entries by handler role.
   *
   * @param kind Handler role.
   * @returns Matching entries in registration and declaration order.
   */
  findHandlersByKind<Kind extends HandlerKind>(
    kind: Kind,
  ): readonly RegisteredHandlerMetadata<Extract<HandlerMetadata, { readonly kind: Kind }>>[] {
    return Object.freeze([
      ...((this.#byKind.get(kind) ?? []) as RegisteredHandlerMetadata<
        Extract<HandlerMetadata, { readonly kind: Kind }>
      >[]),
    ]);
  }

  /**
   * Finds handler entries by message type name.
   *
   * @param messageTypeName Fully qualified command or event type name.
   * @returns Matching entries in registration and declaration order.
   */
  findByMessage(messageTypeName: string): readonly RegisteredHandlerMetadata[] {
    return Object.freeze([...(this.#byMessage.get(messageTypeName) ?? [])]);
  }

  /**
   * Finds the unique command assignment for a command type.
   *
   * @param commandTypeName Fully qualified command type name.
   * @returns The assignment when registered.
   */
  findCommandAssignment(
    commandTypeName: string,
  ): RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> | undefined {
    return this.#commandAssignments.get(commandTypeName);
  }

  /**
   * Finds the unique event applier for a state and event type.
   *
   * @param stateTypeName Fully qualified entity state type name.
   * @param eventTypeName Fully qualified event type name.
   * @returns The applier when registered.
   */
  findEventApplication(
    stateTypeName: string,
    eventTypeName: string,
  ): RegisteredHandlerMetadata<EventApplicationHandlerMetadata> | undefined {
    return this.#eventApplications.get(this.#applicationKey(stateTypeName, eventTypeName));
  }

  #entry(
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

  #validateAssignment(
    entry: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>,
    duplicate: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> | undefined,
  ): void {
    if (duplicate !== undefined) {
      throw new HandlerMetadataRegistryError(
        "DUPLICATE_COMMAND_ASSIGNMENT",
        `Duplicate command assignment for "${entry.handler.messageFullTypeName}" declared by entity ` +
          `"${entry.entity.fullTypeName}"; already declared by entity ` +
          `"${duplicate.entity.fullTypeName}".`,
      );
    }
  }

  #validateApplication(
    entry: RegisteredHandlerMetadata<EventApplicationHandlerMetadata>,
    duplicate: RegisteredHandlerMetadata<EventApplicationHandlerMetadata> | undefined,
  ): void {
    if (duplicate !== undefined) {
      throw new HandlerMetadataRegistryError(
        "DUPLICATE_EVENT_APPLICATION",
        `Duplicate event application for entity "${entry.entity.fullTypeName}" and event ` +
          `"${entry.handler.messageFullTypeName}"; already declared by method ` +
          `"${duplicate.handler.methodName}".`,
      );
    }
  }

  #applicationKey(stateTypeName: string, eventTypeName: string): string {
    return `${stateTypeName}\u0000${eventTypeName}`;
  }

  #push<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
    const values = map.get(key);
    if (values === undefined) {
      map.set(key, [value]);
    } else {
      values.push(value);
    }
  }
}

/**
 * Framework-owned arity override for generated handler metadata ingestion.
 * @internal
 */
export interface HandlerArity {
  // prettier-ignore

  /**
   * Handler role whose public arity is being preserved.
   */
  readonly kind: Exclude<HandlerKind, "event-application">;

  /**
   * Entity instance method name selected by generated metadata.
   */
  readonly methodName: string;

  /**
   * Public method arity: `handler(signal)` or `handler(signal, context)`.
   */
  readonly parameterCount: HandlerParameterCount;

  /**
   * Origin carried by generated receptor metadata.
   */
  readonly origin?: HandlerOrigin;

  /**
   * Generated Protobuf-ES schemas emitted by the handler return type.
   */
  readonly emittedSchemas?: readonly DescriptorMessageSchema[];

  /**
   * Optional generated Event field filter.
   */
  readonly where?: WhereOptions;
}

/**
 * Builds and validates metadata for one entity class.
 */
class EntityHandlersOwner {
  readonly #authentic = new WeakSet<EntityHandlersMetadata>();
  readonly #emittedSchemas = new WeakMap<HandlerMetadata, readonly DescriptorMessageSchema[]>();

  /**
   * Creates handler metadata without invoking entity methods.
   *
   * @param entityType Entity class whose prototype owns the methods.
   * @param stateSchema Generated schema for the entity state.
   * @param define Callback that registers handlers with the builder.
   * @returns Frozen metadata for the entity class.
   */
  define<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: HandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
  ): EntityHandlersMetadata<Instance, StateSchema> {
    return this.#define(entityType, stateSchema, define, []);
  }

  /**
   * Checks that metadata was created by this package.
   *
   * @param metadata Metadata to inspect.
   * @returns Whether the metadata is package-authentic.
   * @internal
   */
  isAuthentic(metadata: EntityHandlersMetadata): metadata is EntityHandlersMetadata {
    return this.#authentic.has(metadata);
  }

  /**
   * Returns schemas emitted by generated handler metadata.
   *
   * @param handler Handler metadata to inspect.
   * @returns Frozen emitted schemas.
   * @internal
   */
  emittedSchemas(handler: HandlerMetadata): readonly DescriptorMessageSchema[] {
    return Object.freeze([...(this.#emittedSchemas.get(handler) ?? [])]);
  }

  /**
   * Copies generated emitted-schema metadata between cloned handlers.
   *
   * @param source Source handler metadata.
   * @param target Cloned target handler metadata.
   * @internal
   */
  copyEmittedSchemas(source: HandlerMetadata, target: HandlerMetadata): void {
    const schemas = this.#emittedSchemas.get(source);
    if (schemas !== undefined) {
      this.#emittedSchemas.set(target, Object.freeze([...schemas]));
    }
  }

  /**
   * Creates handler metadata using generated arity metadata.
   *
   * @param entityType Entity class whose prototype owns the methods.
   * @param stateSchema Generated schema for the entity state.
   * @param define Callback that registers handlers with the builder.
   * @param arities Generated arity metadata.
   * @returns Frozen metadata for the entity class.
   * @internal
   */
  defineArity<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: HandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
    arities: Iterable<HandlerArity>,
  ): EntityHandlersMetadata<Instance, StateSchema> {
    return this.#define(entityType, stateSchema, define, arities);
  }

  #define<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: HandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
    arities: Iterable<HandlerArity>,
  ): EntityHandlersMetadata<Instance, StateSchema> {
    const built = new WeakSet<HandlerMetadata>();
    const builder = this.#builder(entityType, built, this.#arityMap(arities));
    const handlers = Object.freeze([...define(builder)]);
    this.#validateBuilt(handlers, built);
    const metadata: EntityHandlersMetadata<Instance, StateSchema> = {
      entityType,
      entity: describeEntityMetadata(stateSchema),
      handlers,
      commandAssignments: this.#ofKind(handlers, "command-assignment"),
      commandReactions: this.#ofKind(handlers, "command-reaction"),
      eventSubscriptions: this.#ofKind(handlers, "event-subscription"),
      stateSubscriptions: this.#ofKind(handlers, "state-subscription"),
      eventReactions: this.#ofKind(handlers, "event-reaction"),
      eventApplications: this.#ofKind(handlers, "event-application"),
    };
    this.#authentic.add(metadata);
    return Object.freeze(metadata);
  }

  #builder<Instance extends object>(
    entityType: EntityClass<Instance>,
    built: WeakSet<HandlerMetadata>,
    arities: ReadonlyMap<string, HandlerGeneratedData>,
  ): HandlerRegistrationBuilder<Instance> {
    return Object.freeze({
      assign: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) => this.#handler(entityType, "command-assignment", schema, methodName, built, arities),
      command: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) => this.#handler(entityType, "command-reaction", schema, methodName, built, arities),
      subscribe: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) =>
        this.#handler(
          entityType,
          isEntitySchema(schema) ? "state-subscription" : "event-subscription",
          schema,
          methodName,
          built,
          arities,
        ),
      react: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) => this.#handler(entityType, "event-reaction", schema, methodName, built, arities),
      apply: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
        options: EventApplicationOptions = {},
      ) => {
        const handler: EventApplicationHandlerMetadata<
          Schema,
          HandlerMethodName<Instance>
        > = Object.freeze({
          ...this.#handler(entityType, "event-application", schema, methodName, built),
          allowImport: options.allowImport ?? false,
        });
        built.add(handler);
        return handler;
      },
    });
  }

  #handler<
    Instance extends object,
    Kind extends HandlerKind,
    Schema extends DescriptorMessageSchema,
  >(
    entityType: EntityClass<Instance>,
    kind: Kind,
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
    built: WeakSet<HandlerMetadata>,
    arities: ReadonlyMap<string, HandlerGeneratedData> = new Map(),
  ): BaseHandlerMetadata<Kind, Schema, HandlerMethodName<Instance>> {
    this.#validateMethod(entityType, methodName);
    const generated = arities.get(this.#arityKey(kind, methodName));
    const handler = Object.freeze({
      kind,
      schema,
      descriptor: schema,
      messageFullTypeName: schema.typeName,
      methodName,
      parameterCount: generated?.parameterCount ?? 1,
      origin: generated?.origin ?? "domestic",
      ...(generated?.where === undefined ? {} : { where: Object.freeze({ ...generated.where }) }),
    });
    if (generated?.emittedSchemas !== undefined) {
      this.#emittedSchemas.set(handler as HandlerMetadata, generated.emittedSchemas);
    }
    built.add(handler as HandlerMetadata);
    return handler;
  }

  #arityMap(arities: Iterable<HandlerArity>): ReadonlyMap<string, HandlerGeneratedData> {
    const result = new Map<string, HandlerGeneratedData>();
    for (const arity of arities) {
      result.set(
        this.#arityKey(arity.kind, arity.methodName),
        Object.freeze({
          parameterCount: this.#parameterCount(arity.parameterCount),
          origin: arity.origin ?? "domestic",
          ...(arity.emittedSchemas === undefined
            ? {}
            : { emittedSchemas: Object.freeze([...arity.emittedSchemas]) }),
          ...(arity.where === undefined ? {} : { where: Object.freeze({ ...arity.where }) }),
        }),
      );
    }
    return result;
  }

  #parameterCount(value: unknown): HandlerParameterCount {
    if (value === 1 || value === 2) {
      return value;
    }
    throw new HandlerMetadataError(
      "INVALID_PARAMETER_COUNT",
      `Handler metadata declares unsupported parameter count ${String(value)}.`,
    );
  }

  #arityKey(kind: HandlerKind, methodName: string): string {
    return `${kind}\u0000${methodName}`;
  }

  #validateBuilt(handlers: readonly HandlerMetadata[], built: WeakSet<HandlerMetadata>): void {
    for (const handler of handlers) {
      if (!built.has(handler)) {
        throw new HandlerMetadataError(
          "UNKNOWN_HANDLER_METHOD",
          "Handler metadata must be created by the registration builder.",
        );
      }
    }
  }

  #validateMethod<Instance extends object>(
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

  #ofKind<Kind extends HandlerKind>(
    handlers: readonly HandlerMetadata[],
    kind: Kind,
  ): readonly Extract<HandlerMetadata, { readonly kind: Kind }>[] {
    return Object.freeze(
      handlers.filter(
        (handler): handler is Extract<HandlerMetadata, { readonly kind: Kind }> =>
          handler.kind === kind,
      ),
    );
  }
}

/**
 * Internal metadata authority for handler registration, generated metadata, and cloning.
 * @internal
 */
export const HandlerMetadataValues: Readonly<EntityHandlersOwner> = Object.freeze(
  new EntityHandlersOwner(),
);

/**
 * Defines explicit handler metadata for one entity class.
 */
interface EntityHandlerDefinitions {
  // prettier-ignore

  /**
   * Creates handler metadata without invoking entity methods.
   *
   * @param entityType Entity class whose prototype owns the methods.
   * @param stateSchema Generated schema for the entity state.
   * @param define Callback that registers handlers with the builder.
   * @returns Frozen metadata for the entity class.
   */
  define<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: HandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
  ): EntityHandlersMetadata<Instance, StateSchema>;
}

/**
 * Defines metadata for explicitly registered entity handlers.
 */
export const EntityHandlers: Readonly<EntityHandlerDefinitions> = Object.freeze({
  define<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: HandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
  ): EntityHandlersMetadata<Instance, StateSchema> {
    return HandlerMetadataValues.define(entityType, stateSchema, define);
  },
});

interface HandlerGeneratedData {
  readonly parameterCount: HandlerParameterCount;
  readonly origin: HandlerOrigin;
  readonly emittedSchemas?: readonly DescriptorMessageSchema[];
  readonly where?: WhereOptions;
}
