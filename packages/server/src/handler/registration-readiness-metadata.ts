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

/**
 * Frozen fields shared by a readiness entry and its registered handler.
 * @typeParam Handler Handler metadata type.
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
   * @typeParam Handler Handler metadata type.
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
   * @typeParam Handler Handler metadata type.
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
   * @typeParam Value Value stored in each metadata array.
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

  /**
   * Builds fields metadata.
   *
   * @typeParam Handler Handler type for this declaration.
   * @param registeredHandler registeredHandler supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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

  /**
   * Copies cloneRegistered metadata.
   *
   * @typeParam Handler Handler type for this declaration.
   * @param registeredHandler registeredHandler supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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

  /**
   * Copies copyRegistered metadata.
   *
   * @typeParam Handler Handler type for this declaration.
   * @param registeredHandler registeredHandler supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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

  /**
   * Copies cloneEntityHandlers metadata.
   *
   * @param clonedHandlers clonedHandlers supplied to the metadata operation.
   * @param clonedSchemas clonedSchemas supplied to the metadata operation.
   * @param entity entity supplied to the metadata operation.
   * @param entityHandlers entityHandlers supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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
      commandSubstitutions: this.#cloneHandlers(
        entityHandlers.commandSubstitutions,
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
        entityHandlers.stateSubscriptions,
        clonedHandlers,
        clonedSchemas,
      ),
      eventReactions: this.#cloneHandlers(
        entityHandlers.eventReactions,
        clonedHandlers,
        clonedSchemas,
      ),
    });
  }

  /**
   * Copies cloneHandlers metadata.
   *
   * @typeParam Handler Handler type for this declaration.
   * @param clonedHandlers clonedHandlers supplied to the metadata operation.
   * @param clonedSchemas clonedSchemas supplied to the metadata operation.
   * @param handlers handlers supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
  #cloneHandlers<Handler extends HandlerMetadata>(
    handlers: readonly Handler[],
    clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
    clonedSchemas: WeakMap<object, object>,
  ): readonly Handler[] {
    return Object.freeze(
      handlers.map((handler) => this.#cloneHandler(handler, clonedHandlers, clonedSchemas)),
    );
  }

  /**
   * Copies cloneHandler metadata.
   *
   * @typeParam Handler Handler type for this declaration.
   * @param clonedHandlers clonedHandlers supplied to the metadata operation.
   * @param clonedSchemas clonedSchemas supplied to the metadata operation.
   * @param handler handler supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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
    HandlerMetadataValues.copyOutcomes(handler, clone);
    return clone;
  }

  /**
   * Copies cloneEntity metadata.
   *
   * @param clonedFields clonedFields supplied to the metadata operation.
   * @param clonedSchemas clonedSchemas supplied to the metadata operation.
   * @param entity entity supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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
    });
  }

  /**
   * Copies cloneSchema metadata.
   *
   * @typeParam Schema Schema type for this declaration.
   * @param clonedSchemas clonedSchemas supplied to the metadata operation.
   * @param schema schema supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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

  /**
   * Copies cloneField metadata.
   *
   * @typeParam Field Field type for this declaration.
   * @param clonedFields clonedFields supplied to the metadata operation.
   * @param field field supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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

  /**
   * Copies cloneFrozen metadata.
   *
   * @typeParam ObjectType ObjectType type for this declaration.
   * @param value value supplied to the metadata operation.
   * @returns The resulting metadata value.
   */
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
