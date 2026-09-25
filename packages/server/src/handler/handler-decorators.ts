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

import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import {
  EntityHandlers,
  type EntityClass,
  type EntityHandlersMetadata,
  type EventApplicationOptions,
  type HandlerKind,
  type HandlerMethodName,
  type HandlerMetadata,
  type HandlerRegistrationBuilder,
  type WhereOptions,
} from "./handler-metadata.js";

export type { WhereOptions } from "./handler-metadata.js";

type DecoratedHandlerKind = Exclude<HandlerKind, "state-subscription">;

interface DecoratedHandlerRecord {
  readonly kind: DecoratedHandlerKind;
  readonly schema?: DescriptorMessageSchema;
  readonly methodName: string;
  readonly allowImport?: boolean;
}

interface HandlerDecoratorContext {
  readonly static: boolean;
  readonly private: boolean;
  readonly name: string | symbol;
}

/**
 * Describes the standard TypeScript method decorator accepted by Spine handler declarations.
 *
 * @typeParam This Receiver instance on which the decorated method runs.
 * @typeParam Parameters - Parameters accepted by the decorated method.
 * @typeParam Return - Result returned by the decorated method.
 * @param value Decorated method implementation.
 * @param context Standard TypeScript decorator context.
 */
export type HandlerMethodDecorator = <
  This extends object,
  Parameters extends readonly unknown[],
  Return,
>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
) => void;

/**
 * Describes an instance method shape accepted by public handler decorators.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param this Entity instance that receives the invocation.
 * @param parameters Arguments supplied to the handler.
 * @returns Handler result.
 */
export type HandlerMethodValue<
  This extends object = object,
  Parameters extends readonly unknown[] = readonly unknown[],
  Return = unknown,
> = (this: This, ...parameters: Parameters) => Return;

/**
 * Generated companion declaration for a rejection that a command receptor may throw.
 */
export interface RejectionDeclaration {
  // prettier-ignore

  /**
   * Generated Protobuf schema of the declared rejection.
   */
  readonly schema: DescriptorMessageSchema;
}

const handlerDecoratorMetadataKey = Symbol("@spine-event-engine/server.handlerDecorators");

/**
 * Validates declared domain rejections for build-time handler discovery.
 *
 * Put `@Assign` or `@Command` first and `@Throws` last for readability; either
 * order is accepted. The generated registry registers these rejection types
 * even when no server handler consumes them. Rejections are thrown, not normal
 * return values, and do not belong in the handler's return union or tuple.
 *
 * @param declarations Generated rejection companions.
 * @returns A method decorator that validates the annotated instance method.
 */
export function Throws(...declarations: readonly RejectionDeclaration[]): HandlerMethodDecorator {
  if (declarations.length === 0) {
    throw new TypeError("@Throws requires at least one generated rejection declaration.");
  }
  const schemas = declarations.map((declaration) => {
    const value: unknown = declaration;
    const schema =
      value !== null && typeof value === "object"
        ? (value as { readonly schema?: unknown }).schema
        : undefined;
    if (
      schema === null ||
      typeof schema !== "object" ||
      typeof (schema as { readonly typeName?: unknown }).typeName !== "string"
    ) {
      throw new TypeError("@Throws accepts only generated rejection declarations.");
    }
    return schema as DescriptorMessageSchema;
  });
  const typeNames = schemas.map((schema) => schema.typeName);
  if (new Set(typeNames).size !== typeNames.length) {
    throw new TypeError("@Throws cannot declare the same rejection more than once.");
  }
  return (_value, context): void => {
    DecoratorMetadata.methodName(context);
  };
}

/**
 * Creates a command-assignee declaration.
 *
 * Bare `@Assign` is the ordinary application form. Generated handler
 * registries require a command input and normal event output; a rejection is
 * valid in neither role, but the handler may throw a generated rejection
 * throwable. The decorator records metadata only; it does not register the
 * handler, instantiate the entity, or invoke the method.
 *
 * Declare a generated Event type, a union such as `TaskAssigned | TaskReassigned`,
 * a flat Event array (`T[]`, `readonly T[]`, `Array<T>`, or `ReadonlyArray<T>`),
 * or a fixed tuple such as `readonly [TaskCreated, TaskAssigned?]`. Tuples may
 * have named entries and union alternatives. Concrete local/imported aliases
 * and exactly one outer built-in `Promise` are supported. A successful command
 * must produce at least one Event; `void`, whole-result `undefined`, and
 * optional-only tuples are not valid assignment declarations.
 *
 * Return domain messages, not framework envelopes or rejections. Nested
 * collections, rest tuples, nested promises, custom thenables, `any`, and
 * `unknown` are unsupported. TypeScript checks tuple structure; Spine validates
 * each returned message against this handler's declarations and keeps its order.
 * Declare thrown domain rejections separately with {@link Throws}.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation or command schema.
 * @param context Standard decorator context for bare usage.
 */
export function Assign<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Creates command-assignment decorator metadata or a schema-bearing decorator.
 *
 * @param schemaOrValue Command schema or decorated method implementation.
 * @param context Standard decorator context for bare usage.
 * @returns A decorator for schema-bearing usage, or `undefined` after bare usage.
 */
export function Assign(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return DecoratorMetadata.decorateOrCreate("command-assignment", schemaOrValue, context);
}

/**
 * Creates a command handler declaration.
 *
 * Bare `@Command` accepts a generated Command, Event, or rejection input.
 * A Command input is the unique command-substitution receptor for its type and
 * substitutes it with one or more Commands. Among Entity repositories, only
 * Process Managers support `@Command`; Aggregates and Projections reject it.
 * Standalone receivers use `AbstractCommander`.
 * Event and rejection inputs are Event Bus reactions that may return Commands.
 * Rejections are thrown, not returned.
 *
 * Declare a generated Command, a union such as
 * `CreateAccessGrant | ExtendAccessGrant`, a flat Command array, or a fixed
 * tuple. Arrays support `T[]`, `readonly T[]`, `Array<T>`, and `ReadonlyArray<T>`;
 * tuples support readonly, named, optional, and union-valued entries. Concrete
 * local/imported aliases and one outer built-in `Promise` are supported.
 * A Command-input handler must declare a guaranteed Command output. An
 * Event/rejection reaction may declare `undefined` alone or in any supported
 * union, and may return an empty typed Command array. `void` is not supported
 * for reactions; optional-only tuples are rejected for Command inputs.
 *
 * Every result must be a declared domain Command, not a framework envelope.
 * Nested collections, rest tuples, nested promises, custom thenables, `any`,
 * and `unknown` are unsupported. TypeScript checks tuple structure; Spine
 * validates returned message types and preserves their order.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation or command schema.
 * @param context Standard decorator context for bare usage.
 */
export function Command<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Creates command-handler decorator metadata or a schema-bearing decorator.
 * Command input declares a Process Manager command substitution; Event or rejection
 * input declares an Event Bus command reaction. Schema-bearing metadata cannot
 * provide declared returned schemas and is rejected during materialization.
 *
 * @param schemaOrValue Generated Command, Event, or rejection schema, or
 * decorated method implementation.
 * @param context Standard decorator context for bare usage.
 * @returns A decorator for schema-bearing usage, or `undefined` after bare usage.
 */
export function Command(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return DecoratorMetadata.decorateOrCreate("command-reaction", schemaOrValue, context);
}

/**
 * Creates an Event/rejection or Entity-state subscriber declaration.
 *
 * Bare `@Subscribe` accepts generated Event/rejection or descriptor-marked
 * Entity-state inputs and declares `void` or one built-in `Promise<void>`;
 * aliases and parenthesized forms of `void` are supported, but `undefined`
 * alone is not a subscriber return type.
 * It does not return signals; unions, arrays, and tuples of messages belong in
 * producing handlers such as {@link React}, not subscribers. Nested promises
 * and custom thenables are unsupported. Event/rejection inputs produce
 * event-subscription metadata; Entity state inputs produce state-subscription
 * metadata. Subscribers are metadata-only declarations bridged by generated
 * registry and runtime metadata.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation.
 * @param context Standard decorator context for bare usage.
 */
export function Subscribe<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Creates subscriber decorator metadata or a schema-bearing decorator.
 *
 * @param schemaOrValue Event, rejection, or descriptor-marked Entity state
 * schema, or the decorated method implementation.
 * @param context Standard decorator context for bare usage.
 * @returns A decorator for schema-bearing usage, or `undefined` after bare usage.
 */
export function Subscribe(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return DecoratorMetadata.decorateOrCreate("event-subscription", schemaOrValue, context);
}

/**
 * Creates an event-reactor declaration.
 *
 * Bare `@React` accepts generated Event or rejection inputs and returns domain
 * Events, not rejections or framework envelopes. Declare one Event, a union of
 * Event types, a flat array, or a fixed tuple. Arrays support `T[]`, `readonly T[]`,
 * `Array<T>`, and `ReadonlyArray<T>`; tuples support readonly, named, optional,
 * and union-valued entries. Concrete local/imported aliases are supported.
 *
 * Declare explicit `undefined` for no output, or a type such as
 * `TaskRenamed | undefined` when a reaction sometimes emits an Event. Empty
 * arrays and absent optional tuple entries produce no signals. Any supported
 * result may have exactly one outer built-in `Promise`, including `Promise<undefined>`.
 * `void` is not a valid reactor return type.
 * Nested collections, rest tuples, nested promises, custom thenables, `any`,
 * and `unknown` are unsupported. TypeScript checks tuple structure; Spine checks
 * each actual Event against this handler's declarations and preserves order.
 * Generated registry metadata connects the declaration to runtime dispatch.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation or event schema.
 * @param context Standard decorator context for bare usage.
 */
export function React<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Creates event-reaction decorator metadata or a schema-bearing decorator.
 *
 * @param schemaOrValue Event schema or decorated method implementation.
 * @param context Standard decorator context for bare usage.
 * @returns A decorator for schema-bearing usage, or `undefined` after bare usage.
 */
export function React(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return DecoratorMetadata.decorateOrCreate("event-reaction", schemaOrValue, context);
}

/**
 * Creates one Event field equality filter for an Event-consuming handler.
 *
 * Generated handler analysis validates the declaration and carries it into
 * immutable repository metadata. The decorator itself does not inspect or
 * invoke the handler.
 *
 * @param options Event source field and canonical expected value.
 * @returns Decorator for a public instance handler method.
 */
export function Where(options: WhereOptions): HandlerMethodDecorator {
  const snapshot = WhereValues.snapshot(options);

  return (_value, context): void => {
    void snapshot;
    DecoratorMetadata.methodName(context);
  };
}

/**
 * Creates legacy framework event-application metadata.
 *
 * New application aggregates must not use `@Apply`; managed aggregates are no
 * longer event-sourced and the framework manages state transactions. This
 * decorator is kept only for compatibility code that still needs explicit
 * schema-bearing event application metadata. The optional `allowImport` flag
 * is preserved only as part of that legacy metadata shape.
 *
 * @param schema Event schema accepted by the decorated method.
 * @param options Legacy event-application metadata options.
 * @returns Decorator that records the application metadata.
 */
export function Apply(
  schema: DescriptorMessageSchema,
  options: EventApplicationOptions = {},
): HandlerMethodDecorator {
  return DecoratorMetadata.create("event-application", schema, options);
}

/**
 * Builds schema-bearing decorator declarations for framework compatibility.
 *
 * The returned object is the same frozen `EntityHandlersMetadata` contract
 * produced by `EntityHandlers.define()` and accepted by
 * `HandlerMetadataRegistry`. Only own prototype methods of `entityType` are
 * inspected; inherited decorated methods are intentionally not materialized by
 * this per-class adapter.
 *
 * Application code must not call this function and must not provide its own
 * handler discovery/materialization. Generated framework registries own schema
 * inference for bare decorators; this adapter only supports legacy
 * schema-bearing decorator metadata.
 *
 * @typeParam Instance Entity instance on which the handlers run.
 * @typeParam StateSchema - Schema that describes the entity state.
 * @param entityType Entity class whose own decorated methods are read.
 * @param stateSchema Schema that describes the entity state.
 * @returns Frozen handler metadata for the decorated methods.
 */
export function materializeDecoratedEntityHandlers<
  Instance extends object,
  StateSchema extends DescriptorMessageSchema,
>(
  entityType: EntityClass<Instance>,
  stateSchema: StateSchema,
): EntityHandlersMetadata<Instance, StateSchema> {
  const decoratedHandlers = DecoratorMetadata.collect(entityType);

  return EntityHandlers.define(entityType, stateSchema, (builder) =>
    decoratedHandlers.map((handler) =>
      DecoratorMetadata.materializeLegacyHandler(builder, handler),
    ),
  );
}

const DecoratorMetadata = Object.freeze({
  /**
   * Builds legacy schema-bearing metadata for one decorated Entity method.
   *
   * @typeParam Instance Entity receiver type.
   * @param builder Entity handler registration builder.
   * @param handler Decorated method record.
   * @returns Canonical handler metadata.
   */
  materializeLegacyHandler<Instance extends object>(
    builder: HandlerRegistrationBuilder<Instance>,
    handler: DecoratedHandlerRecord,
  ): HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>> {
    const methodName = handler.methodName as HandlerMethodName<Instance>;
    switch (handler.kind) {
      case "command-assignment":
        return builder.assign(DecoratorMetadata.schema(handler), methodName);
      case "command-substitution":
        throw new TypeError(
          "Command substitutions require generated registry metadata with emitted schemas.",
        );
      case "command-reaction":
        throw new TypeError(
          "@Command handlers require generated registry metadata with emitted schemas.",
        );
      case "event-subscription":
        return builder.subscribe(DecoratorMetadata.schema(handler), methodName);
      case "event-reaction":
        return builder.react(DecoratorMetadata.schema(handler), methodName);
      case "event-application":
        return builder.apply(DecoratorMetadata.schema(handler), methodName, {
          allowImport: handler.allowImport ?? false,
        });
    }
  },

  /**
   * Validates a public instance method and reads its string name.
   *
   * @param context TypeScript decorator context identifying the method.
   * @returns The method name used in handler metadata.
   */
  methodName(context: HandlerDecoratorContext): string {
    if (context.static || context.private) {
      throw new TypeError("Spine handler decorators must be applied to public instance methods.");
    }

    if (typeof context.name !== "string") {
      throw new TypeError("Spine handler decorators require string-named methods.");
    }
    return context.name;
  },

  /**
   * Applies a bare decorator or creates the internal schema-bearing form.
   *
   * @param kind Handler role recorded for the method.
   * @param schemaOrValue Decorated method, or schema for the internal form.
   * @param context Present when TypeScript invokes a bare decorator.
   * @returns The internal decorator, or undefined after bare decoration.
   */
  decorateOrCreate(
    kind: DecoratedHandlerKind,
    schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
    context: ClassMethodDecoratorContext | undefined,
  ): HandlerMethodDecorator | undefined {
    if (context !== undefined) {
      DecoratorMetadata.create(kind)(schemaOrValue as HandlerMethodValue, context);
      return undefined;
    }

    return DecoratorMetadata.create(kind, schemaOrValue as DescriptorMessageSchema);
  },

  /**
   * Creates a decorator that appends immutable metadata for one method.
   *
   * @param kind Handler role recorded for the method.
   * @param schema Optional schema supplied by internal compatibility tooling.
   * @param options Import policy for a legacy Event application method.
   * @returns A standard TypeScript method decorator.
   */
  create(
    kind: DecoratedHandlerKind,
    schema?: DescriptorMessageSchema,
    options: EventApplicationOptions = {},
  ): HandlerMethodDecorator {
    return (_value, context): void => {
      const methodName = DecoratorMetadata.methodName(context);

      const record: DecoratedHandlerRecord = Object.freeze({
        kind,
        ...(schema === undefined ? {} : { schema }),
        methodName,
        ...(kind === "event-application" ? { allowImport: options.allowImport ?? false } : {}),
      });

      const metadata = DecoratorMetadata.require(context);
      const previous = DecoratorMetadata.read(metadata);

      Object.defineProperty(metadata, handlerDecoratorMetadataKey, {
        configurable: true,
        enumerable: false,
        value: Object.freeze([...previous, record]),
        writable: true,
      });
    };
  },

  /**
   * Reads a legacy declaration's schema, rejecting bare declarations.
   *
   * @param handler Decorator record being materialized.
   * @returns Its explicitly supplied message schema.
   */
  schema(handler: DecoratedHandlerRecord): DescriptorMessageSchema {
    if (handler.schema === undefined) {
      throw new TypeError(
        `Decorated handler "${handler.methodName}" was declared without a schema; ` +
          "use generated registry metadata or explicit EntityHandlers.define() registration.",
      );
    }

    return handler.schema;
  },

  /**
   * Reads handler declarations for methods defined on this class prototype.
   *
   * @typeParam Instance Entity instance represented by the constructor.
   * @param entityType Constructor whose declared handlers are collected.
   * @returns A frozen list of matching decorator records.
   */
  collect<Instance extends object>(
    entityType: EntityClass<Instance>,
  ): readonly DecoratedHandlerRecord[] {
    const metadata = DecoratorMetadata.classMetadata(entityType);

    if (metadata === undefined) {
      return Object.freeze([]);
    }

    const records = DecoratorMetadata.read(metadata).filter((record) => {
      const descriptor = Object.getOwnPropertyDescriptor(entityType.prototype, record.methodName);

      return typeof descriptor?.value === "function";
    });

    return Object.freeze(records);
  },

  /**
   * Initializes Symbol.metadata when the runtime does not yet supply it.
   *
   * @returns The existing or newly installed decorator metadata symbol.
   */
  installSymbol(): symbol {
    const existingMetadata = Reflect.get(Symbol, "metadata");

    if (typeof existingMetadata === "symbol") {
      return existingMetadata;
    }

    const metadata = Symbol("Symbol.metadata");

    Object.defineProperty(Symbol, "metadata", {
      configurable: true,
      enumerable: false,
      value: metadata,
      writable: false,
    });

    return metadata;
  },

  /**
   * Reads TypeScript's class metadata object, rejecting missing support.
   *
   * @param context Decorator context with optional runtime metadata support.
   * @returns The writable class metadata object.
   */
  require(context: {
    readonly metadata: Record<PropertyKey, unknown> | undefined;
  }): Record<PropertyKey, unknown> {
    if (context.metadata === undefined) {
      throw new TypeError("Spine handler decorators require standard decorator metadata support.");
    }

    return context.metadata;
  },

  /**
   * Reads metadata defined directly on the Entity constructor.
   *
   * @typeParam Instance Entity instance represented by the constructor.
   * @param entityType Constructor whose metadata is inspected.
   * @returns Its metadata object, or undefined when none is present.
   */
  classMetadata<Instance extends object>(
    entityType: EntityClass<Instance>,
  ): Record<PropertyKey, unknown> | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(entityType, decoratorMetadataSymbol);
    const metadata: unknown = descriptor?.value;

    if (metadata === null || typeof metadata !== "object") {
      return undefined;
    }

    return metadata as Record<PropertyKey, unknown>;
  },

  /**
   * Reads Spine handler records without inheriting a parent metadata array.
   *
   * @param metadata Class metadata object to inspect.
   * @returns Stored handler records, or an empty list when absent.
   */
  read(metadata: Record<PropertyKey, unknown>): readonly DecoratedHandlerRecord[] {
    if (!Object.hasOwn(metadata, handlerDecoratorMetadataKey)) {
      return [];
    }

    const value = metadata[handlerDecoratorMetadataKey];

    return Array.isArray(value) ? (value as readonly DecoratedHandlerRecord[]) : [];
  },
});

const WhereValues = Object.freeze({
  /**
   * Validates and copies the supported single-field Event filter.
   *
   * @param options Field name and comparison value supplied to the decorator.
   * @returns A frozen filter independent of the caller's object.
   */
  snapshot(options: WhereOptions): WhereOptions {
    const value: unknown = options;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Where options must be an object.");
    }
    const keys = Object.keys(value);
    if (
      keys.length !== 2 ||
      !keys.includes("eventField") ||
      !keys.includes("equals") ||
      typeof options.eventField !== "string" ||
      options.eventField.trim().length === 0 ||
      typeof options.equals !== "string"
    ) {
      throw new TypeError("Where options require exactly non-empty eventField and string equals.");
    }
    return Object.freeze({ eventField: options.eventField, equals: options.equals });
  },
});

const decoratorMetadataSymbol = DecoratorMetadata.installSymbol();
