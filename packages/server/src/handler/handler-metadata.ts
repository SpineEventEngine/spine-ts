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
import { ProcessManager, Projection } from "../entity/entity.js";

/**
 * Entity class value accepted by explicit handler metadata registration.
 * @typeParam Instance Entity receiver type.
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
  | "command-substitution"
  | "command-reaction"
  | "event-subscription"
  | "state-subscription"
  | "event-reaction";

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
 * @typeParam Instance Entity receiver type.
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
export type HandlerMetadataErrorCode =
  | "UNKNOWN_HANDLER_METHOD"
  | "INVALID_PARAMETER_COUNT"
  | "UNSUPPORTED_COMMAND_HANDLER"
  | "UNSUPPORTED_ASSIGN_HANDLER";

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
 * @typeParam Kind Handler role type.
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
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
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
 */
export type CommandAssignmentHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"command-assignment", Schema, MethodName>;

/**
 * Metadata for a command-reacting method.
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
 */
export type CommandReactionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"command-reaction", Schema, MethodName>;

/**
 * Command-input `@Command` metadata that produces Commands after commit.
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
 */
export type CommandSubstitutionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"command-substitution", Schema, MethodName>;

/**
 * Metadata for an event subscription method.
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
 */
export type EventSubscriptionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"event-subscription", Schema, MethodName>;

/**
 * Metadata for an Entity-state subscription method.
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
 */
export type StateSubscriptionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"state-subscription", Schema, MethodName>;

/**
 * Metadata for an event reactor method.
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
 */
export type EventReactionHandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> = BaseHandlerMetadata<"event-reaction", Schema, MethodName>;

/**
 * Union of all explicit handler metadata records.
 * @typeParam MethodName Type parameter for this declaration.
 * @typeParam Schema Generated message schema type.
 */
export type HandlerMetadata<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  MethodName extends string = string,
> =
  | CommandAssignmentHandlerMetadata<Schema, MethodName>
  | CommandSubstitutionHandlerMetadata<Schema, MethodName>
  | CommandReactionHandlerMetadata<Schema, MethodName>
  | EventSubscriptionHandlerMetadata<Schema, MethodName>
  | StateSubscriptionHandlerMetadata<Schema, MethodName>
  | EventReactionHandlerMetadata<Schema, MethodName>;

/**
 * Builder passed to `EntityHandlers.define()` for typed method-name registration.
 *
 * Builder methods accept the compile-time callable-name approximation, then
 * validate that the selected name is an own prototype data method.
 * @typeParam Instance Entity receiver type.
 */
export interface HandlerRegistrationBuilder<Instance extends object> {
  // prettier-ignore

  /**
   * Registers a command assignee method.
   *
   * @param schema Command schema accepted by the method.
   * @param methodName Entity method name.
   * @returns The registered command-assignment metadata.
   * @typeParam Schema Generated message schema type.
   */
  assign<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): CommandAssignmentHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /**
   * Registers an Event/rejection or Entity-state subscriber method.
   *
   * @param schema Event, rejection, or descriptor-marked Entity state schema
   * accepted by the method.
   * @param methodName Entity method name.
   * @returns Event-subscription metadata for signals, or state-subscription
   * metadata for descriptor-marked Entity state schemas.
   * @typeParam Schema Generated message schema type.
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
   * @typeParam Schema Generated message schema type.
   */
  react<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): EventReactionHandlerMetadata<Schema, HandlerMethodName<Instance>>;
}

/**
 * Registers generated command substitution metadata during registry ingestion.
 *
 * @internal
 * @typeParam Instance Entity receiver type.
 */
export interface GeneratedHandlerRegistrationBuilder<
  Instance extends object,
> extends HandlerRegistrationBuilder<Instance> {
  // prettier-ignore

  /**
   * Registers a generated command-input substitution with emitted schemas.
   *
   * @param schema Generated command input schema.
   * @param methodName Process Manager method selected by generated metadata.
   * @returns Generated command-substitution handler metadata.
   * @typeParam Schema Generated message schema type.
   */
  substitute<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): CommandSubstitutionHandlerMetadata<Schema, HandlerMethodName<Instance>>;

  /**
   * Registers a generated event- or rejection-input command reaction.
   *
   * @param schema Generated Event or rejection input schema.
   * @param methodName Process Manager method selected by generated metadata.
   * @returns Generated command-reaction handler metadata.
   * @typeParam Schema Generated message schema type.
   */
  command<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    methodName: HandlerMethodName<Instance>,
  ): CommandReactionHandlerMetadata<Schema, HandlerMethodName<Instance>>;
}

/**
 * Frozen handler metadata for one explicitly registered entity class.
 * @typeParam Instance Entity receiver type.
 * @typeParam StateSchema Generated message schema type.
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
   * Command substitutions in declaration order.
   */
  readonly commandSubstitutions: readonly CommandSubstitutionHandlerMetadata[];

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
}

/**
 * Error code for handler metadata registry validation failures.
 */
export type HandlerRegistryErrorCode = "DUPLICATE_COMMAND_ASSIGNMENT";

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
 * @typeParam Handler Handler metadata type.
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
   * @typeParam Kind Handler role type.
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

  readonly #commandReceptors = new Map<
    string,
    RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata | CommandSubstitutionHandlerMetadata>
  >();

  /**
   * Creates a caller-owned registry and optionally registers metadata.
   *
   * @param entityHandlers Entity metadata to register in iteration order.
   * @typeParam Metadata Type parameter for this declaration.
   */
  constructor(entityHandlers: Iterable<EntityHandlersMetadata> = []) {
    for (const metadata of entityHandlers) {
      this.register(metadata);
    }
  }

  /**
   * Registers one entity handler metadata object.
   *
   * @typeParam Metadata Concrete Entity handler metadata type.
   * @param metadata Entity handler metadata to register.
   * @returns The registered metadata unchanged.
   */
  register<Metadata extends EntityHandlersMetadata>(metadata: Metadata): Metadata {
    const entries = metadata.handlers.map((handler) => this.#entry(metadata, handler));
    const commandReceptors = new Map<
      string,
      RegisteredHandlerMetadata<
        CommandAssignmentHandlerMetadata | CommandSubstitutionHandlerMetadata
      >
    >();

    for (const entry of entries) {
      if (
        entry.handler.kind === "command-assignment" ||
        entry.handler.kind === "command-substitution"
      ) {
        const commandEntry = entry as RegisteredHandlerMetadata<
          CommandAssignmentHandlerMetadata | CommandSubstitutionHandlerMetadata
        >;
        this.#validateAssignment(
          commandEntry,
          this.#commandReceptors.get(entry.handler.messageFullTypeName) ??
            commandReceptors.get(entry.handler.messageFullTypeName),
        );
        commandReceptors.set(entry.handler.messageFullTypeName, commandEntry);
      }
    }

    this.#entityHandlers.push(metadata);
    this.#push(this.#byEntityState, metadata.entity.fullTypeName, metadata);

    for (const entry of entries) {
      this.#handlerEntries.push(entry);
      this.#push(this.#byKind, entry.handler.kind, entry);
      this.#push(this.#byMessage, entry.handler.messageFullTypeName, entry);
    }

    for (const [messageFullTypeName, entry] of commandReceptors) {
      this.#commandReceptors.set(messageFullTypeName, entry);
      if (entry.handler.kind === "command-assignment") {
        this.#commandAssignments.set(
          messageFullTypeName,
          entry as RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>,
        );
      }
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
   * @typeParam Kind Handler role being selected.
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
   * Finds the effective command assignment or substitution receptor.
   *
   * @param commandTypeName Fully qualified command type name.
   * @returns The receptor when registered.
   */
  findCommandReceptor(
    commandTypeName: string,
  ):
    | RegisteredHandlerMetadata<
        CommandAssignmentHandlerMetadata | CommandSubstitutionHandlerMetadata
      >
    | undefined {
    return this.#commandReceptors.get(commandTypeName);
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
    entry: RegisteredHandlerMetadata<
      CommandAssignmentHandlerMetadata | CommandSubstitutionHandlerMetadata
    >,
    duplicate:
      | RegisteredHandlerMetadata<
          CommandAssignmentHandlerMetadata | CommandSubstitutionHandlerMetadata
        >
      | undefined,
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

  /**
   * Adds one value to a grouped lookup map.
   *
   * @typeParam Key Lookup key type.
   * @typeParam Value Stored value type.
   * @param map Grouped lookup map.
   * @param key Key selecting the group.
   * @param value Value to add.
   */
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
  readonly kind: HandlerKind;

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
   * Generated schemas that the handler may return or throw.
   */
  readonly outcomes?: HandlerOutcomeSchemas;

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

  readonly #outcomes = new WeakMap<HandlerMetadata, HandlerOutcomeSchemas>();

  /**
   * Creates handler metadata without invoking entity methods.
   *
   * @param entityType Entity class whose prototype owns the methods.
   * @param stateSchema Generated schema for the entity state.
   * @param define Callback that registers handlers with the builder.
   * @returns Frozen metadata for the entity class.
   * @typeParam Instance Entity receiver type.
   * @typeParam StateSchema Generated message schema type.
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
  returnedSchemas(handler: HandlerMetadata): readonly DescriptorMessageSchema[] {
    return Object.freeze([...(this.#outcomes.get(handler)?.returned ?? [])]);
  }

  /**
   * Returns generated rejection schemas declared by a handler.
   *
   * @param handler Handler metadata to inspect.
   * @returns Frozen generated rejection schemas.
   * @internal
   */
  thrownSchemas(handler: HandlerMetadata): readonly DescriptorMessageSchema[] {
    return Object.freeze([...(this.#outcomes.get(handler)?.thrown ?? [])]);
  }

  /**
   * Copies generated normal-return and thrown-rejection metadata between cloned handlers.
   *
   * @param source Source handler metadata.
   * @param target Cloned target handler metadata.
   * @internal
   * @typeParam Instance Entity receiver type.
   * @typeParam StateSchema Generated message schema type.
   */
  copyOutcomes(source: HandlerMetadata, target: HandlerMetadata): void {
    const outcomes = this.#outcomes.get(source);
    if (outcomes !== undefined) {
      this.#outcomes.set(target, EntityHandlersOwner.freezeOutcomes(outcomes));
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
   * @typeParam Instance Entity receiver type.
   * @typeParam StateSchema Generated message schema type.
   */
  defineArity<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: GeneratedHandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
    arities: Iterable<HandlerArity>,
  ): EntityHandlersMetadata<Instance, StateSchema> {
    return this.#define(entityType, stateSchema, define, arities);
  }

  /**
   * Registers declared handlers, validates receiver restrictions, and freezes grouped metadata.
   *
   * @typeParam Instance Entity instance type.
   * @typeParam StateSchema Generated Entity state schema type.
   * @param entityType Entity constructor whose methods are registered.
   * @param stateSchema Generated Entity state schema.
   * @param define Callback declaring handlers through the guarded builder.
   * @param arities Generated parameter counts, origins, and outcomes.
   * @returns Frozen handler metadata grouped by handler kind.
   */
  #define<Instance extends object, StateSchema extends DescriptorMessageSchema>(
    entityType: EntityClass<Instance>,
    stateSchema: StateSchema,
    define: (
      builder: GeneratedHandlerRegistrationBuilder<Instance>,
    ) => readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
    arities: Iterable<HandlerArity>,
  ): EntityHandlersMetadata<Instance, StateSchema> {
    const built = new WeakSet<HandlerMetadata>();
    const builder = this.#builder(entityType, built, this.#arityMap(arities));
    const handlers = Object.freeze([...define(builder)]);
    this.#validateCommandHandlers(entityType, handlers);
    this.#validateBuilt(handlers, built);
    const metadata: EntityHandlersMetadata<Instance, StateSchema> = {
      entityType,
      entity: describeEntityMetadata(stateSchema),
      handlers,
      commandAssignments: this.#ofKind(handlers, "command-assignment"),
      commandSubstitutions: this.#ofKind(handlers, "command-substitution"),
      commandReactions: this.#ofKind(handlers, "command-reaction"),
      eventSubscriptions: this.#ofKind(handlers, "event-subscription"),
      stateSubscriptions: this.#ofKind(handlers, "state-subscription"),
      eventReactions: this.#ofKind(handlers, "event-reaction"),
    };
    this.#authentic.add(metadata);
    return Object.freeze(metadata);
  }

  /**
   * Builds a guarded builder for Command, Event, and subscription registrations.
   *
   * @typeParam Instance Entity instance type.
   * @param entityType Entity constructor checked for declared methods.
   * @param built Set tracking metadata created by this builder.
   * @param arities Generated method metadata indexed by kind and method name.
   * @returns Frozen registration builder for supported handler kinds.
   */
  #builder<Instance extends object>(
    entityType: EntityClass<Instance>,
    built: WeakSet<HandlerMetadata>,
    arities: ReadonlyMap<string, HandlerGeneratedData>,
  ): GeneratedHandlerRegistrationBuilder<Instance> {
    return Object.freeze({
      ...this.#commandBuilder(entityType, built, arities),
      ...this.#eventBuilder(entityType, built, arities),
    });
  }

  /**
   * Builds generated Command receptor registrations.
   *
   * @typeParam Instance Entity receiver type.
   * @param entityType Entity constructor.
   * @param built Set of accepted handler metadata.
   * @param arities Generated method arity metadata.
   * @returns Command assignment and substitution registrations.
   */
  #commandBuilder<Instance extends object>(
    entityType: EntityClass<Instance>,
    built: WeakSet<HandlerMetadata>,
    arities: ReadonlyMap<string, HandlerGeneratedData>,
  ): Pick<GeneratedHandlerRegistrationBuilder<Instance>, "assign" | "substitute"> {
    return {
      /**
       * Builds command assignment metadata.
       *
       * @typeParam Schema Command input schema type.
       * @param schema Command input schema.
       * @param methodName Entity method name.
       * @returns Assignment metadata.
       */
      assign: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) => this.#handler(entityType, "command-assignment", schema, methodName, built, arities),

      /**
       * Builds command substitution metadata.
       *
       * @typeParam Schema Command input schema type.
       * @param schema Command input schema.
       * @param methodName Process Manager method name.
       * @returns Substitution metadata.
       */
      substitute: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) => this.#handler(entityType, "command-substitution", schema, methodName, built, arities),
    };
  }

  /**
   * Builds generated Event and state receiver registrations.
   *
   * @typeParam Instance Entity receiver type.
   * @param entityType Entity constructor.
   * @param built Set of accepted handler metadata.
   * @param arities Generated method arity metadata.
   * @returns Reaction and subscription registrations.
   */
  #eventBuilder<Instance extends object>(
    entityType: EntityClass<Instance>,
    built: WeakSet<HandlerMetadata>,
    arities: ReadonlyMap<string, HandlerGeneratedData>,
  ): Pick<GeneratedHandlerRegistrationBuilder<Instance>, "command" | "subscribe" | "react"> {
    return {
      ...this.#reactorBuilder(entityType, built, arities),
      ...this.#subscriberBuilder(entityType, built, arities),
    };
  }

  /**
   * Builds generated Event and rejection reaction registrations.
   *
   * @typeParam Instance Entity receiver type.
   * @param entityType Entity constructor.
   * @param built Set of accepted handler metadata.
   * @param arities Generated method arity metadata.
   * @returns Event and Command reaction registrations.
   */
  #reactorBuilder<Instance extends object>(
    entityType: EntityClass<Instance>,
    built: WeakSet<HandlerMetadata>,
    arities: ReadonlyMap<string, HandlerGeneratedData>,
  ): Pick<GeneratedHandlerRegistrationBuilder<Instance>, "command" | "react"> {
    return {
      /**
       * Builds command reaction metadata.
       *
       * @typeParam Schema Event or rejection input schema type.
       * @param schema Event or rejection input schema.
       * @param methodName Process Manager method name.
       * @returns Command reaction metadata.
       */
      command: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) => this.#handler(entityType, "command-reaction", schema, methodName, built, arities),

      /**
       * Builds event reaction metadata.
       *
       * @typeParam Schema Event input schema type.
       * @param schema Event input schema.
       * @param methodName Entity method name.
       * @returns Event reaction metadata.
       */
      react: <Schema extends DescriptorMessageSchema>(
        schema: Schema,
        methodName: HandlerMethodName<Instance>,
      ) => this.#handler(entityType, "event-reaction", schema, methodName, built, arities),
    };
  }

  /**
   * Builds generated Event and state subscription registrations.
   *
   * @typeParam Instance Entity receiver type.
   * @param entityType Entity constructor.
   * @param built Set of accepted handler metadata.
   * @param arities Generated method arity metadata.
   * @returns Subscription registration.
   */
  #subscriberBuilder<Instance extends object>(
    entityType: EntityClass<Instance>,
    built: WeakSet<HandlerMetadata>,
    arities: ReadonlyMap<string, HandlerGeneratedData>,
  ): Pick<GeneratedHandlerRegistrationBuilder<Instance>, "subscribe"> {
    return {
      /**
       * Builds subscription metadata.
       *
       * @typeParam Schema Event or Entity state schema type.
       * @param schema Event or Entity state input schema.
       * @param methodName Entity method name.
       * @returns Subscription metadata.
       */
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
    };
  }

  /**
   * Validates a declared method and binds its generated input and outcome metadata.
   *
   * @typeParam Instance Entity instance type.
   * @typeParam Kind Handler role retained in the metadata.
   * @typeParam Schema Generated input message schema type.
   * @param entityType Entity constructor declaring the method.
   * @param kind Role used to find generated method metadata.
   * @param schema Input message schema accepted by the handler.
   * @param methodName Declared instance method name.
   * @param built Set tracking records made by the guarded builder.
   * @param arities Generated parameter counts, origins, filters, and outcomes.
   * @returns Frozen handler registration with generated metadata attached.
   */
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
    if (generated?.outcomes !== undefined) {
      this.#outcomes.set(handler as HandlerMetadata, generated.outcomes);
    }
    built.add(handler as HandlerMetadata);
    return handler;
  }

  /**
   * Builds an index of generated method metadata by handler kind and method name.
   *
   * @param arities Generated records for declared handler methods.
   * @returns Frozen per-method values indexed by a collision-free key.
   */
  #arityMap(arities: Iterable<HandlerArity>): ReadonlyMap<string, HandlerGeneratedData> {
    const result = new Map<string, HandlerGeneratedData>();
    for (const arity of arities) {
      result.set(
        this.#arityKey(arity.kind, arity.methodName),
        Object.freeze({
          parameterCount: this.#parameterCount(arity.parameterCount),
          origin: arity.origin ?? "domestic",
          ...(arity.outcomes === undefined
            ? {}
            : { outcomes: EntityHandlersOwner.freezeOutcomes(arity.outcomes) }),
          ...(arity.where === undefined ? {} : { where: Object.freeze({ ...arity.where }) }),
        }),
      );
    }
    return result;
  }

  /**
   * Rejects generated handler arities other than one or two parameters.
   *
   * @param value Generated parameter count to validate.
   * @returns Supported parameter count of one or two.
   */
  #parameterCount(value: unknown): HandlerParameterCount {
    if (value === 1 || value === 2) {
      return value;
    }
    throw new HandlerMetadataError(
      "INVALID_PARAMETER_COUNT",
      `Handler metadata declares unsupported parameter count ${String(value)}.`,
    );
  }

  /**
   * Builds a frozen copy of generated outcome schemas.
   *
   * @param outcomes Outcome schemas to copy.
   * @returns Frozen outcome schemas.
   */
  static freezeOutcomes(outcomes: HandlerOutcomeSchemas): HandlerOutcomeSchemas {
    return Object.freeze({
      returned: Object.freeze([...outcomes.returned]),
      thrown: Object.freeze([...outcomes.thrown]),
    });
  }

  /**
   * Builds a handler key with a NUL delimiter between kind and method name.
   *
   * @param kind Handler role, allowing one method name in distinct roles.
   * @param methodName Entity method name.
   * @returns Collision-free lookup key for generated method metadata.
   */
  #arityKey(kind: HandlerKind, methodName: string): string {
    return `${kind}\u0000${methodName}`;
  }

  /**
   * Rejects Assign on Projections and Command handlers outside Process Managers.
   *
   * @param entityType Entity constructor determining supported handler roles.
   * @param handlers Handler declarations to validate.
   */
  #validateCommandHandlers(entityType: EntityClass, handlers: readonly HandlerMetadata[]): void {
    if (
      entityType.prototype instanceof Projection &&
      handlers.some((handler) => handler.kind === "command-assignment")
    ) {
      throw new HandlerMetadataError(
        "UNSUPPORTED_ASSIGN_HANDLER",
        "Projection entities cannot use @Assign handlers.",
      );
    }
    if (
      handlers.some(
        (handler) => handler.kind === "command-substitution" || handler.kind === "command-reaction",
      ) &&
      !(entityType.prototype instanceof ProcessManager)
    ) {
      throw new HandlerMetadataError(
        "UNSUPPORTED_COMMAND_HANDLER",
        "Only Process Manager entities support @Command handlers.",
      );
    }
  }

  /**
   * Rejects handler records not produced by the current registration builder.
   *
   * @param handlers Declared records to authenticate.
   * @param built Set of records created during this definition call.
   */
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

  /**
   * Validates that a normal method is declared directly on the Entity prototype.
   *
   * @typeParam Instance Entity instance type.
   * @param entityType Entity constructor whose prototype is inspected.
   * @param methodName Name that must identify an own prototype data method.
   */
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

  /**
   * Returns a frozen view of handlers for one role.
   *
   * @typeParam Kind Requested handler role.
   * @param handlers Validated handler declarations.
   * @param kind Role retained in the resulting list.
   * @returns Frozen list of matching handler records.
   */
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
   * @typeParam Instance Entity receiver type.
   * @typeParam StateSchema Generated Entity state schema type.
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
 * @typeParam Instance Entity receiver type.
 * @typeParam StateSchema Generated message schema type.
 */
export const EntityHandlers: Readonly<EntityHandlerDefinitions> = Object.freeze({
  /**
   * Builds explicit Entity handler metadata.
   *
   * @typeParam Instance Entity receiver type.
   * @typeParam StateSchema Generated Entity state schema type.
   * @param entityType Entity constructor.
   * @param stateSchema Generated Entity state schema.
   * @param define Callback registering handlers.
   * @returns Frozen Entity handler metadata.
   */
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
  readonly outcomes?: HandlerOutcomeSchemas;
  readonly where?: WhereOptions;
}

interface HandlerOutcomeSchemas {
  readonly returned: readonly DescriptorMessageSchema[];
  readonly thrown: readonly DescriptorMessageSchema[];
}
