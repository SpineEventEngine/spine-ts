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
export type HandlerMethodDecorator = (
  value: HandlerMethodValue,
  context: ClassMethodDecoratorContext<object, HandlerMethodValue>,
) => void;

/** Instance method shape accepted by public handler decorators. */
export type HandlerMethodValue = (this: object, ...parameters: readonly unknown[]) => unknown;

const decoratedHandlersByMethod = new WeakMap<
  HandlerMethodValue,
  readonly DecoratedHandlerRecord[]
>();

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
  return (value, context) => {
    if (context.static || context.private) {
      throw new TypeError("Spine handler decorators must be applied to public instance methods.");
    }

    if (typeof context.name !== "string") {
      throw new TypeError("Spine handler decorators require string-named methods.");
    }

    const previous = decoratedHandlersByMethod.get(value) ?? [];
    const record: DecoratedHandlerRecord = Object.freeze({
      kind,
      schema,
      methodName: context.name,
      ...(kind === "event-application" ? { allowImport: options.allowImport ?? false } : {}),
    });

    decoratedHandlersByMethod.set(value, Object.freeze([...previous, record]));
  };
}

function collectOwnDecoratedHandlers<Instance extends object>(
  entityType: EntityClass<Instance>,
): readonly DecoratedHandlerRecord[] {
  const records: DecoratedHandlerRecord[] = [];

  for (const methodName of Object.getOwnPropertyNames(entityType.prototype)) {
    if (methodName === "constructor") {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(entityType.prototype, methodName);

    if (typeof descriptor?.value !== "function") {
      continue;
    }

    records.push(...(decoratedHandlersByMethod.get(descriptor.value as HandlerMethodValue) ?? []));
  }

  return Object.freeze(records);
}
