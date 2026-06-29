import type { DescriptorMessageSchema } from "./entity-metadata.js";
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
  readonly schema: DescriptorMessageSchema;
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
 * Declare a command assignee method with an explicit Protobuf-ES command schema.
 *
 * The decorator records metadata only. It does not register the handler in a
 * registry, instantiate the entity, or invoke the method.
 */
export function Assign(schema: DescriptorMessageSchema): HandlerMethodDecorator {
  return createHandlerDecorator("command-assignment", schema);
}

/**
 * Declare a command-reacting method with an explicit Protobuf-ES command schema.
 *
 * Command reactors may fan out in `HandlerMetadataRegistry`; this decorator
 * only records the method declaration for later materialization.
 */
export function Command(schema: DescriptorMessageSchema): HandlerMethodDecorator {
  return createHandlerDecorator("command-reaction", schema);
}

/**
 * Declare an event subscriber method with an explicit Protobuf-ES event schema.
 *
 * Subscribers are metadata-only declarations until later runtime slices consume
 * materialized `EntityHandlersMetadata`.
 */
export function Subscribe(schema: DescriptorMessageSchema): HandlerMethodDecorator {
  return createHandlerDecorator("event-subscription", schema);
}

/**
 * Declare an event reactor method with an explicit Protobuf-ES event schema.
 *
 * Reactors are collected as class-owned metadata and may fan out through the
 * caller-owned handler registry.
 */
export function React(schema: DescriptorMessageSchema): HandlerMethodDecorator {
  return createHandlerDecorator("event-reaction", schema);
}

/**
 * Declare an event applier method with an explicit Protobuf-ES event schema.
 *
 * The optional `allowImport` flag is preserved in materialized event
 * application metadata for later import/replay machinery.
 */
export function Apply(
  schema: DescriptorMessageSchema,
  options: EventApplicationOptions = {},
): HandlerMethodDecorator {
  return createHandlerDecorator("event-application", schema, options);
}

/**
 * Materialize standard-decorator declarations into the canonical handler metadata shape.
 *
 * The returned object is the same frozen `EntityHandlersMetadata` contract
 * produced by `defineEntityHandlers()` and accepted by
 * `HandlerMetadataRegistry`. Only own prototype methods of `entityType` are
 * inspected; inherited decorated methods are intentionally not materialized by
 * this class-owned adapter.
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
            return builder.assign(handler.schema, methodName);
          case "command-reaction":
            return builder.command(handler.schema, methodName);
          case "event-subscription":
            return builder.subscribe(handler.schema, methodName);
          case "event-reaction":
            return builder.react(handler.schema, methodName);
          case "event-application":
            return builder.apply(handler.schema, methodName, {
              allowImport: handler.allowImport ?? false,
            });
        }
      }) satisfies readonly HandlerMetadata<DescriptorMessageSchema, HandlerMethodName<Instance>>[],
  );
}

function createHandlerDecorator(
  kind: DecoratedHandlerKind,
  schema: DescriptorMessageSchema,
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
      schema,
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
