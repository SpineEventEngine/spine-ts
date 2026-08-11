import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import {
  EntityHandlers,
  type EntityClass,
  type EntityHandlersMetadata,
  type EventApplicationOptions,
  type HandlerKind,
  type HandlerMethodName,
  type HandlerMetadata,
} from "./handler-metadata.js";

type DecoratedHandlerKind = Exclude<HandlerKind, "state-subscription">;

interface DecoratedHandlerRecord {
  readonly kind: DecoratedHandlerKind;
  readonly schema?: DescriptorMessageSchema;
  readonly methodName: string;
  readonly allowImport?: boolean;
}

/**
 * Describes the standard TypeScript method decorator accepted by Spine handler declarations.
 *
 * @typeParam This - Entity instance that owns the decorated method.
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
 * @typeParam This - Entity instance that owns the method.
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

const handlerDecoratorMetadataKey = Symbol("@spine-event-engine/server.handlerDecorators");

/**
 * Creates a command-assignee declaration.
 *
 * Bare `@Assign` is the ordinary application form. Generated handler
 * registries require a command input and normal event output; a rejection is
 * valid in neither role, but the handler may throw a generated rejection
 * throwable. The decorator records metadata only; it does not register the
 * handler, instantiate the entity, or invoke the method.
 *
 * @typeParam This - Entity instance that owns the method.
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
 * Creates a command-reacting declaration.
 *
 * Bare `@Command` is the ordinary application form. Generated registries accept
 * command inputs; event-to-command handlers also accept event or rejection
 * inputs. Normal outputs are commands, while rejections are thrown, not
 * returned. Command reactors may fan out in `HandlerMetadataRegistry`; this
 * decorator only records the declaration.
 *
 * @typeParam This - Entity instance that owns the method.
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
 * Creates command-reaction decorator metadata or a schema-bearing decorator.
 *
 * @param schemaOrValue Command schema or decorated method implementation.
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
 * Entity-state inputs and returns `void`. Event/rejection inputs produce
 * event-subscription metadata; Entity state inputs produce state-subscription
 * metadata. Subscribers are metadata-only declarations bridged by generated
 * registry and runtime metadata.
 *
 * @typeParam This - Entity instance that owns the method.
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
 * Bare `@React` accepts generated event or rejection inputs and returns normal
 * events or explicit `void`; rejections are thrown, not returned. Reactors are
 * collected as class-owned metadata and may fan out through the caller-owned
 * handler registry.
 *
 * @typeParam This - Entity instance that owns the method.
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
 * Creates legacy framework event-application metadata.
 *
 * New application aggregates must not use `@Apply`; managed aggregates are no
 * longer event-sourced and the framework owns state transactions. This
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
 * this class-owned adapter.
 *
 * Application code must not call this function and must not provide its own
 * handler discovery/materialization. Generated framework registries own schema
 * inference for bare decorators; this adapter only supports legacy
 * schema-bearing decorator metadata.
 *
 * @typeParam Instance - Entity instance that owns the handlers.
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

  return EntityHandlers.define(
    entityType,
    stateSchema,
    (builder) =>
      decoratedHandlers.map((handler) => {
        const methodName = handler.methodName as HandlerMethodName<Instance>;

        switch (handler.kind) {
          case "command-assignment":
            return builder.assign(DecoratorMetadata.schema(handler), methodName);
          case "command-reaction":
            return builder.command(DecoratorMetadata.schema(handler), methodName);
          case "event-subscription":
            return builder.subscribe(DecoratorMetadata.schema(handler), methodName);
          case "event-reaction":
            return builder.react(DecoratorMetadata.schema(handler), methodName);
          case "event-application":
            return builder.apply(DecoratorMetadata.schema(handler), methodName, {
              allowImport: handler.allowImport ?? false,
            });
        }
      }) satisfies readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
  );
}

const DecoratorMetadata = Object.freeze({
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

  create(
    kind: DecoratedHandlerKind,
    schema?: DescriptorMessageSchema,
    options: EventApplicationOptions = {},
  ): HandlerMethodDecorator {
    return <This extends object, Parameters extends readonly unknown[], Return>(
      _value: HandlerMethodValue<This, Parameters, Return>,
      context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
    ): void => {
      if (context.static || context.private) {
        throw new TypeError("Spine handler decorators must be applied to public instance methods.");
      }

      if (typeof context.name !== "string") {
        throw new TypeError("Spine handler decorators require string-named methods.");
      }

      const record: DecoratedHandlerRecord = Object.freeze({
        kind,
        ...(schema === undefined ? {} : { schema }),
        methodName: context.name,
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

  schema(handler: DecoratedHandlerRecord): DescriptorMessageSchema {
    if (handler.schema === undefined) {
      throw new TypeError(
        `Decorated handler "${handler.methodName}" was declared without a schema; ` +
          "use generated registry metadata or explicit EntityHandlers.define() registration.",
      );
    }

    return handler.schema;
  },

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

  require(context: {
    readonly metadata: Record<PropertyKey, unknown> | undefined;
  }): Record<PropertyKey, unknown> {
    if (context.metadata === undefined) {
      throw new TypeError("Spine handler decorators require standard decorator metadata support.");
    }

    return context.metadata;
  },

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

  read(metadata: Record<PropertyKey, unknown>): readonly DecoratedHandlerRecord[] {
    if (!Object.hasOwn(metadata, handlerDecoratorMetadataKey)) {
      return [];
    }

    const value = metadata[handlerDecoratorMetadataKey];

    return Array.isArray(value) ? (value as readonly DecoratedHandlerRecord[]) : [];
  },
});

const decoratorMetadataSymbol = DecoratorMetadata.installSymbol();
