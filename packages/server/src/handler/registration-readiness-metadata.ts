import type {
  DescriptorFieldMetadata,
  DescriptorMessageSchema,
  EntityMetadata,
} from "../entity/entity-metadata.js";
import type {
  EntityClass,
  EntityHandlersMetadata,
  HandlerMetadata,
  RegisteredHandlerMetadata,
} from "./handler-metadata.js";

export interface ReadinessMetadataFields<Handler extends HandlerMetadata> {
  readonly entityHandlers: EntityHandlersMetadata;
  readonly entityType: EntityClass;
  readonly entity: EntityMetadata;
  readonly handler: Handler;
  readonly registeredHandler: RegisteredHandlerMetadata<Handler>;
}

export function compareFullTypeNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function createReadinessMetadataFields<Handler extends HandlerMetadata>(
  registeredHandler: RegisteredHandlerMetadata<Handler>,
): ReadinessMetadataFields<Handler> {
  return createMetadataFields(cloneRegisteredHandlerMetadata(registeredHandler));
}

export function copyReadinessMetadataFields<Handler extends HandlerMetadata>(
  registeredHandler: RegisteredHandlerMetadata<Handler>,
): ReadinessMetadataFields<Handler> {
  return createMetadataFields(copyRegisteredHandlerMetadata(registeredHandler));
}

export function copyMetadataArrayMap<Value>(
  map: ReadonlyMap<string, readonly Value[]>,
): ReadonlyMap<string, readonly Value[]> {
  const copy = new Map<string, readonly Value[]>();

  for (const [key, values] of map) {
    copy.set(key, Object.freeze([...values]));
  }

  return copy;
}

function createMetadataFields<Handler extends HandlerMetadata>(
  registeredHandler: RegisteredHandlerMetadata<Handler>,
): ReadinessMetadataFields<Handler> {
  return Object.freeze({
    entityHandlers: registeredHandler.entityHandlers,
    entityType: registeredHandler.entityType,
    entity: registeredHandler.entity,
    handler: registeredHandler.handler,
    registeredHandler,
  });
}

function cloneRegisteredHandlerMetadata<Handler extends HandlerMetadata>(
  registeredHandler: RegisteredHandlerMetadata<Handler>,
): RegisteredHandlerMetadata<Handler> {
  const clonedHandlers = new Map<HandlerMetadata, HandlerMetadata>();
  const clonedSchemas = new WeakMap<object, object>();
  const clonedFields = new Map<DescriptorFieldMetadata, DescriptorFieldMetadata>();
  const entity = cloneEntityMetadata(registeredHandler.entity, clonedSchemas, clonedFields);
  const handler = cloneHandlerMetadata(registeredHandler.handler, clonedHandlers, clonedSchemas);
  const entityHandlers = cloneEntityHandlers(
    registeredHandler.entityHandlers,
    clonedHandlers,
    clonedSchemas,
    entity,
  );

  return Object.freeze({
    entityHandlers,
    entityType: registeredHandler.entityType,
    entity,
    handler,
  });
}

function copyRegisteredHandlerMetadata<Handler extends HandlerMetadata>(
  registeredHandler: RegisteredHandlerMetadata<Handler>,
): RegisteredHandlerMetadata<Handler> {
  return Object.freeze({
    entityHandlers: registeredHandler.entityHandlers,
    entityType: registeredHandler.entityType,
    entity: registeredHandler.entity,
    handler: registeredHandler.handler,
  });
}

function cloneEntityHandlers(
  entityHandlers: EntityHandlersMetadata,
  clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
  clonedSchemas: WeakMap<object, object>,
  entity: EntityMetadata,
): EntityHandlersMetadata {
  return Object.freeze({
    entityType: entityHandlers.entityType,
    entity,
    handlers: cloneHandlers(entityHandlers.handlers, clonedHandlers, clonedSchemas),
    commandAssignments: cloneHandlers(
      entityHandlers.commandAssignments,
      clonedHandlers,
      clonedSchemas,
    ),
    commandReactions: cloneHandlers(entityHandlers.commandReactions, clonedHandlers, clonedSchemas),
    eventSubscriptions: cloneHandlers(
      entityHandlers.eventSubscriptions,
      clonedHandlers,
      clonedSchemas,
    ),
    eventReactions: cloneHandlers(entityHandlers.eventReactions, clonedHandlers, clonedSchemas),
    eventApplications: cloneHandlers(
      entityHandlers.eventApplications,
      clonedHandlers,
      clonedSchemas,
    ),
  });
}

function cloneHandlers<Handler extends HandlerMetadata>(
  handlers: readonly Handler[],
  clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
  clonedSchemas: WeakMap<object, object>,
): readonly Handler[] {
  return Object.freeze(
    handlers.map((handler) => cloneHandlerMetadata(handler, clonedHandlers, clonedSchemas)),
  );
}

function cloneHandlerMetadata<Handler extends HandlerMetadata>(
  handler: Handler,
  clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
  clonedSchemas: WeakMap<object, object>,
): Handler {
  const existing = clonedHandlers.get(handler);

  if (existing !== undefined) {
    return existing as Handler;
  }

  const clone = Object.freeze({
    ...handler,
    schema: cloneDescriptorMessageSchema(handler.schema, clonedSchemas),
    descriptor: cloneDescriptorMessageSchema(handler.descriptor, clonedSchemas),
  }) as unknown as Handler;

  clonedHandlers.set(handler, clone);
  return clone;
}

function cloneEntityMetadata(
  entity: EntityMetadata,
  clonedSchemas: WeakMap<object, object>,
  clonedFields: Map<DescriptorFieldMetadata, DescriptorFieldMetadata>,
): EntityMetadata {
  return Object.freeze({
    ...entity,
    schema: cloneDescriptorMessageSchema(entity.schema, clonedSchemas),
    descriptor: cloneDescriptorMessageSchema(entity.descriptor, clonedSchemas),
    idField: cloneFieldMetadata(entity.idField, clonedFields),
    firstFieldRoutingHint: Object.freeze({
      ...entity.firstFieldRoutingHint,
      field: cloneFieldMetadata(entity.firstFieldRoutingHint.field, clonedFields),
    }),
    columns: Object.freeze(entity.columns.map((field) => cloneFieldMetadata(field, clonedFields))),
    setOnceFields: Object.freeze(
      entity.setOnceFields.map((field) => cloneFieldMetadata(field, clonedFields)),
    ),
    semanticTags: Object.freeze([...entity.semanticTags]),
  });
}

function cloneDescriptorMessageSchema<Schema extends DescriptorMessageSchema>(
  schema: Schema,
  clonedSchemas: WeakMap<object, object>,
): Schema {
  const existing = clonedSchemas.get(schema);

  if (existing !== undefined) {
    return existing as Schema;
  }

  const clone = cloneFrozenObject(schema);

  clonedSchemas.set(schema, clone);
  return clone;
}

function cloneFieldMetadata<Field extends DescriptorFieldMetadata>(
  field: Field,
  clonedFields: Map<DescriptorFieldMetadata, DescriptorFieldMetadata>,
): Field {
  const existing = clonedFields.get(field);

  if (existing !== undefined) {
    return existing as Field;
  }

  const clone = Object.freeze({ ...field }) as Field;

  clonedFields.set(field, clone);
  return clone;
}

function cloneFrozenObject<ObjectType extends object>(value: ObjectType): ObjectType {
  const clone = Object.create(Reflect.getPrototypeOf(value)) as ObjectType;

  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(value));
  return Object.freeze(clone);
}
