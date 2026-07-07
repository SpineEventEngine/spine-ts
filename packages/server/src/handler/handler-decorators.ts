import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import {
  defineEntityHandlers,
  type EntityClass,
  type EntityHandlersMetadata,
  type EventApplicationOptions,
  type HandlerKind,
  type HandlerMethodName,
  type HandlerMetadata,
} from "./handler-metadata.js";

type DecoratedHandlerKind = HandlerKind;

interface DecoratedHandlerRecord {
  readonly kind: DecoratedHandlerKind;
  readonly schema?: DescriptorMessageSchema;
  readonly methodName: string;
  readonly allowImport?: boolean;
}

/** Standard TypeScript method decorator accepted by Spine handler declarations. */
export type HandlerMethodDecorator = <
  This extends object,
  Parameters extends readonly unknown[],
  Return,
>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
) => void;

/** Instance method shape accepted by public handler decorators. */
export type HandlerMethodValue<
  This extends object = object,
  Parameters extends readonly unknown[] = readonly unknown[],
  Return = unknown,
> = (this: This, ...parameters: Parameters) => Return;

const handlerDecoratorMetadataKey = Symbol("@spine-ts/server.handlerDecorators");
const decoratorMetadataSymbol = installDecoratorMetadataSymbol();

/**
 * Declare a command assignee method.
 *
 * Bare `@Assign` is the ordinary application form. `@Assign(schema)` remains a
 * legacy/framework compatibility form until generated handler registries own
 * schema discovery. The decorator records metadata only; it does not register
 * the handler, instantiate the entity, or invoke the method.
 */
export function Assign(schema: DescriptorMessageSchema): HandlerMethodDecorator;
export function Assign<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;
export function Assign(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return decorateOrCreate("command-assignment", schemaOrValue, context);
}

/**
 * Declare a command-reacting method.
 *
 * Bare `@Command` is the ordinary application form. `@Command(schema)` remains
 * a legacy/framework compatibility form. Command reactors may fan out in
 * `HandlerMetadataRegistry`; this decorator only records the declaration.
 */
export function Command(schema: DescriptorMessageSchema): HandlerMethodDecorator;
export function Command<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;
export function Command(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return decorateOrCreate("command-reaction", schemaOrValue, context);
}

/**
 * Declare an event subscriber method.
 *
 * Bare `@Subscribe` is the ordinary application form. `@Subscribe(schema)`
 * remains a legacy/framework compatibility form. Subscribers are metadata-only
 * declarations until generated registry/runtime metadata consumes them.
 */
export function Subscribe(schema: DescriptorMessageSchema): HandlerMethodDecorator;
export function Subscribe<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;
export function Subscribe(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return decorateOrCreate("event-subscription", schemaOrValue, context);
}

/**
 * Declare an event reactor method.
 *
 * Bare `@React` is the ordinary application form. `@React(schema)` remains a
 * legacy/framework compatibility form. Reactors are collected as class-owned
 * metadata and may fan out through the caller-owned handler registry.
 */
export function React(schema: DescriptorMessageSchema): HandlerMethodDecorator;
export function React<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;
export function React(
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context?: ClassMethodDecoratorContext,
): HandlerMethodDecorator | undefined {
  return decorateOrCreate("event-reaction", schemaOrValue, context);
}

/**
 * Declare legacy/framework event application metadata.
 *
 * New application aggregates must not use `@Apply`; managed aggregates are no
 * longer event-sourced and the framework owns state transactions. This
 * decorator is kept only for compatibility code that still needs explicit
 * schema-bearing event application metadata. The optional `allowImport` flag is
 * preserved in that legacy metadata for later import/replay machinery.
 */
export function Apply(
  schema: DescriptorMessageSchema,
  options: EventApplicationOptions = {},
): HandlerMethodDecorator {
  return createHandlerDecorator("event-application", schema, options);
}

/**
 * Materialize schema-bearing decorator declarations for framework compatibility.
 *
 * The returned object is the same frozen `EntityHandlersMetadata` contract
 * produced by `defineEntityHandlers()` and accepted by
 * `HandlerMetadataRegistry`. Only own prototype methods of `entityType` are
 * inspected; inherited decorated methods are intentionally not materialized by
 * this class-owned adapter.
 *
 * Application code must not call this function and must not provide its own
 * handler discovery/materialization. Generated framework registries will own
 * schema inference for bare decorators; this adapter only supports legacy
 * schema-bearing decorator metadata.
 */
export function materializeDecoratedEntityHandlers<
  Instance extends object,
  StateSchema extends DescriptorMessageSchema,
>(
  entityType: EntityClass<Instance>,
  stateSchema: StateSchema,
): EntityHandlersMetadata<Instance, StateSchema> {
  const decoratedHandlers = collectOwnDecoratedHandlers(entityType);

  return defineEntityHandlers(
    entityType,
    stateSchema,
    (builder) =>
      decoratedHandlers.map((handler) => {
        const methodName = handler.methodName as HandlerMethodName<Instance>;

        switch (handler.kind) {
          case "command-assignment":
            return builder.assign(requireDecoratedSchema(handler), methodName);
          case "command-reaction":
            return builder.command(requireDecoratedSchema(handler), methodName);
          case "event-subscription":
            return builder.subscribe(requireDecoratedSchema(handler), methodName);
          case "event-reaction":
            return builder.react(requireDecoratedSchema(handler), methodName);
          case "event-application":
            return builder.apply(requireDecoratedSchema(handler), methodName, {
              allowImport: handler.allowImport ?? false,
            });
        }
      }) satisfies readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
  );
}

function decorateOrCreate(
  kind: DecoratedHandlerKind,
  schemaOrValue: DescriptorMessageSchema | HandlerMethodValue,
  context: ClassMethodDecoratorContext | undefined,
): HandlerMethodDecorator | undefined {
  if (context !== undefined) {
    createHandlerDecorator(kind)(schemaOrValue as HandlerMethodValue, context);
    return undefined;
  }

  return createHandlerDecorator(kind, schemaOrValue as DescriptorMessageSchema);
}

function createHandlerDecorator(
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

    const metadata = requireDecoratorMetadata(context);
    const previous = readDecoratedHandlers(metadata);

    Object.defineProperty(metadata, handlerDecoratorMetadataKey, {
      configurable: true,
      enumerable: false,
      value: Object.freeze([...previous, record]),
      writable: true,
    });
  };
}

function requireDecoratedSchema(handler: DecoratedHandlerRecord): DescriptorMessageSchema {
  if (handler.schema === undefined) {
    throw new TypeError(
      `Decorated handler "${handler.methodName}" was declared without a schema; ` +
        "use generated registry metadata or explicit defineEntityHandlers() registration.",
    );
  }

  return handler.schema;
}

function collectOwnDecoratedHandlers<Instance extends object>(
  entityType: EntityClass<Instance>,
): readonly DecoratedHandlerRecord[] {
  const metadata = readClassDecoratorMetadata(entityType);

  if (metadata === undefined) {
    return Object.freeze([]);
  }

  const records = readDecoratedHandlers(metadata).filter((record) => {
    const descriptor = Object.getOwnPropertyDescriptor(entityType.prototype, record.methodName);

    return typeof descriptor?.value === "function";
  });

  return Object.freeze(records);
}

function installDecoratorMetadataSymbol(): symbol {
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
}

function requireDecoratorMetadata(context: {
  readonly metadata: Record<PropertyKey, unknown> | undefined;
}): Record<PropertyKey, unknown> {
  if (context.metadata === undefined) {
    throw new TypeError("Spine handler decorators require standard decorator metadata support.");
  }

  return context.metadata;
}

function readClassDecoratorMetadata<Instance extends object>(
  entityType: EntityClass<Instance>,
): Record<PropertyKey, unknown> | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(entityType, decoratorMetadataSymbol);
  const metadata: unknown = descriptor?.value;

  if (metadata === null || typeof metadata !== "object") {
    return undefined;
  }

  return metadata as Record<PropertyKey, unknown>;
}

function readDecoratedHandlers(
  metadata: Record<PropertyKey, unknown>,
): readonly DecoratedHandlerRecord[] {
  if (!Object.hasOwn(metadata, handlerDecoratorMetadataKey)) {
    return [];
  }

  const value = metadata[handlerDecoratorMetadataKey];

  return Array.isArray(value) ? (value as readonly DecoratedHandlerRecord[]) : [];
}
