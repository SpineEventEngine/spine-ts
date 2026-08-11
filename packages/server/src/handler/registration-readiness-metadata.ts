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
import { HandlerMetadataValues } from "./handler-metadata.js";

const semanticTagError =
  "Registration readiness entity semanticTags must be a dense array of non-empty strings.";

/**
 * Frozen fields shared by a readiness entry and its registered handler.
 */
export interface ReadinessMetadataFields<Handler extends HandlerMetadata> {
  // prettier-ignore

  /**
   * Entity handler metadata that declared the handler.
   */
  readonly entityHandlers: EntityHandlersMetadata;

  /**
   * Entity class that owns the handler method.
   */
  readonly entityType: EntityClass;

  /**
   * Descriptor-derived metadata for the entity state.
   */
  readonly entity: EntityMetadata;

  /**
   * Handler metadata used by the readiness entry.
   */
  readonly handler: Handler;

  /**
   * Registered handler metadata used to create the entry.
   */
  readonly registeredHandler: RegisteredHandlerMetadata<Handler>;
}

/**
 * Creates frozen readiness metadata without sharing mutable caller-owned records.
 */
class ReadinessMetadataOwner {
  // prettier-ignore

  /**
   * Compares fully qualified Protobuf type names in lexical order.
   *
   * @param left First type name.
   * @param right Second type name.
   * @returns A negative, zero, or positive comparison result.
   */
  compareTypeNames(left: string, right: string): number {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  }

  /**
   * Creates cloned fields for a new readiness entry.
   *
   * @param registeredHandler Registered handler to clone.
   * @returns Frozen fields with cloned metadata.
   */
  create<Handler extends HandlerMetadata>(
    registeredHandler: RegisteredHandlerMetadata<Handler>,
  ): ReadinessMetadataFields<Handler> {
    return this.#fields(this.#cloneRegistered(registeredHandler));
  }

  /**
   * Creates fields that retain already frozen registered metadata.
   *
   * @param registeredHandler Registered handler to retain.
   * @returns Frozen fields sharing the registered metadata.
   */
  copy<Handler extends HandlerMetadata>(
    registeredHandler: RegisteredHandlerMetadata<Handler>,
  ): ReadinessMetadataFields<Handler> {
    return this.#fields(this.#copyRegistered(registeredHandler));
  }

  /**
   * Copies map arrays into fresh frozen arrays.
   *
   * @param map Metadata arrays to copy.
   * @returns A map containing fresh frozen arrays.
   */
  copyMap<Value>(
    map: ReadonlyMap<string, readonly Value[]>,
  ): ReadonlyMap<string, readonly Value[]> {
    const copy = new Map<string, readonly Value[]>();
    for (const [key, values] of map) {
      copy.set(key, Object.freeze([...values]));
    }
    return copy;
  }

  #fields<Handler extends HandlerMetadata>(
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

  #cloneRegistered<Handler extends HandlerMetadata>(
    registeredHandler: RegisteredHandlerMetadata<Handler>,
  ): RegisteredHandlerMetadata<Handler> {
    const handlers = new Map<HandlerMetadata, HandlerMetadata>();
    const schemas = new WeakMap<object, object>();
    const fields = new Map<DescriptorFieldMetadata, DescriptorFieldMetadata>();
    const entity = this.#cloneEntity(registeredHandler.entity, schemas, fields);
    const handler = this.#cloneHandler(registeredHandler.handler, handlers, schemas);
    const entityHandlers = this.#cloneEntityHandlers(
      registeredHandler.entityHandlers,
      handlers,
      schemas,
      entity,
    );
    return Object.freeze({
      entityHandlers,
      entityType: registeredHandler.entityType,
      entity,
      handler,
    });
  }

  #copyRegistered<Handler extends HandlerMetadata>(
    registeredHandler: RegisteredHandlerMetadata<Handler>,
  ): RegisteredHandlerMetadata<Handler> {
    return Object.freeze({
      entityHandlers: registeredHandler.entityHandlers,
      entityType: registeredHandler.entityType,
      entity: registeredHandler.entity,
      handler: registeredHandler.handler,
    });
  }

  #cloneEntityHandlers(
    entityHandlers: EntityHandlersMetadata,
    clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
    clonedSchemas: WeakMap<object, object>,
    entity: EntityMetadata,
  ): EntityHandlersMetadata {
    return Object.freeze({
      entityType: entityHandlers.entityType,
      entity,
      handlers: this.#cloneHandlers(entityHandlers.handlers, clonedHandlers, clonedSchemas),
      commandAssignments: this.#cloneHandlers(
        entityHandlers.commandAssignments,
        clonedHandlers,
        clonedSchemas,
      ),
      commandReactions: this.#cloneHandlers(
        entityHandlers.commandReactions,
        clonedHandlers,
        clonedSchemas,
      ),
      eventSubscriptions: this.#cloneHandlers(
        entityHandlers.eventSubscriptions,
        clonedHandlers,
        clonedSchemas,
      ),
      stateSubscriptions: this.#cloneHandlers(
        entityHandlers.stateSubscriptions ?? [],
        clonedHandlers,
        clonedSchemas,
      ),
      eventReactions: this.#cloneHandlers(
        entityHandlers.eventReactions,
        clonedHandlers,
        clonedSchemas,
      ),
      eventApplications: this.#cloneHandlers(
        entityHandlers.eventApplications,
        clonedHandlers,
        clonedSchemas,
      ),
    });
  }

  #cloneHandlers<Handler extends HandlerMetadata>(
    handlers: readonly Handler[],
    clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
    clonedSchemas: WeakMap<object, object>,
  ): readonly Handler[] {
    return Object.freeze(
      handlers.map((handler) => this.#cloneHandler(handler, clonedHandlers, clonedSchemas)),
    );
  }

  #cloneHandler<Handler extends HandlerMetadata>(
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
      schema: this.#cloneSchema(handler.schema, clonedSchemas),
      descriptor: this.#cloneSchema(handler.descriptor, clonedSchemas),
    }) as unknown as Handler;
    clonedHandlers.set(handler, clone);
    HandlerMetadataValues.copyEmittedSchemas(handler, clone);
    return clone;
  }

  #cloneEntity(
    entity: EntityMetadata,
    clonedSchemas: WeakMap<object, object>,
    clonedFields: Map<DescriptorFieldMetadata, DescriptorFieldMetadata>,
  ): EntityMetadata {
    return Object.freeze({
      ...entity,
      schema: this.#cloneSchema(entity.schema, clonedSchemas),
      descriptor: this.#cloneSchema(entity.descriptor, clonedSchemas),
      idField: this.#cloneField(entity.idField, clonedFields),
      firstFieldRoutingHint: Object.freeze({
        ...entity.firstFieldRoutingHint,
        field: this.#cloneField(entity.firstFieldRoutingHint.field, clonedFields),
      }),
      columns: Object.freeze(entity.columns.map((field) => this.#cloneField(field, clonedFields))),
      setOnceFields: Object.freeze(
        entity.setOnceFields.map((field) => this.#cloneField(field, clonedFields)),
      ),
      semanticTags: this.#copyTags(entity.semanticTags),
    });
  }

  #copyTags(value: unknown): readonly string[] {
    if (!Array.isArray(value)) {
      throw new TypeError(semanticTagError);
    }
    const tags: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError(semanticTagError);
      }
      const tag = value[index] as unknown;
      if (typeof tag !== "string" || tag.trim().length === 0 || tag !== tag.trim()) {
        throw new TypeError(semanticTagError);
      }
      tags.push(tag);
    }
    return Object.freeze(tags);
  }

  #cloneSchema<Schema extends DescriptorMessageSchema>(
    schema: Schema,
    clonedSchemas: WeakMap<object, object>,
  ): Schema {
    const existing = clonedSchemas.get(schema);
    if (existing !== undefined) {
      return existing as Schema;
    }
    const clone = this.#cloneFrozen(schema);
    clonedSchemas.set(schema, clone);
    return clone;
  }

  #cloneField<Field extends DescriptorFieldMetadata>(
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

  #cloneFrozen<ObjectType extends object>(value: ObjectType): ObjectType {
    const clone = Object.create(Reflect.getPrototypeOf(value)) as ObjectType;
    Object.defineProperties(clone, Object.getOwnPropertyDescriptors(value));
    return Object.freeze(clone);
  }
}

/**
 * Creates frozen readiness metadata without sharing mutable caller-owned records.
 */
export const ReadinessMetadata: Readonly<ReadinessMetadataOwner> = Object.freeze(
  new ReadinessMetadataOwner(),
);
