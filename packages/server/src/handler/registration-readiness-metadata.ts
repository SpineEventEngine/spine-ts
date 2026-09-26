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
   * Groups one registration with its Entity and handler metadata for readiness checks.
   *
   * @typeParam Handler Registered handler subtype.
   * @param registeredHandler Registration supplying Entity and handler records.
   * @returns Frozen fields used by readiness cloning or copying.
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
   * Copies registration, Entity, and handler descriptors while reusing shared clones.
   *
   * @typeParam Handler Registered handler subtype.
   * @param registeredHandler Registration whose mutable descriptors are isolated.
   * @returns Frozen registration referring to cloned metadata.
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
   * Copies the registration shell without cloning its already immutable metadata.
   *
   * @typeParam Handler Registered handler subtype.
   * @param registeredHandler Registration containing immutable metadata references.
   * @returns Frozen registration with the same nested references.
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
   * Builds every handler-kind list with shared cloned handler identities.
   *
   * @param entityHandlers Original grouped handler metadata.
   * @param clonedHandlers Cache preserving identity across grouped lists.
   * @param clonedSchemas Cache preserving shared descriptor identity.
   * @param entity Cloned Entity metadata reused by the registration.
   * @returns Frozen grouping with cloned handlers and Entity metadata.
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
   * Copies a handler-kind list using the shared registration caches.
   *
   * @typeParam Handler Handler subtype retained in the list.
   * @param handlers Original handler-kind list.
   * @param clonedHandlers Cache for handlers repeated in grouped lists.
   * @param clonedSchemas Cache for descriptors shared by handlers.
   * @returns Frozen list of cloned handler records.
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
   * Copies one handler once and transfers its generated outcome schemas.
   *
   * @typeParam Handler Handler subtype preserved by the clone.
   * @param handler Original handler registration.
   * @param clonedHandlers Cache preventing duplicate clones of one record.
   * @param clonedSchemas Cache for shared input descriptors.
   * @returns Frozen clone with its outcome schemas copied.
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
   * Copies Entity descriptors and routing fields while retaining shared identities.
   *
   * @param entity Original Entity schema and field metadata.
   * @param clonedSchemas Cache for repeated schema descriptors.
   * @param clonedFields Cache for fields repeated in routing and column metadata.
   * @returns Frozen Entity metadata with isolated descriptors and fields.
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
   * Copies a schema descriptor once per registration.
   *
   * @typeParam Schema Generated schema descriptor type.
   * @param schema Descriptor to isolate.
   * @param clonedSchemas Cache preserving repeated descriptor identity.
   * @returns Frozen descriptor clone.
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
   * Copies a field descriptor once per registration.
   *
   * @typeParam Field Field descriptor type.
   * @param field Descriptor to isolate.
   * @param clonedFields Cache preserving fields reused across Entity metadata.
   * @returns Frozen field descriptor clone.
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
   * Copies an object's own descriptors without changing its prototype.
   *
   * @typeParam ObjectType Descriptor object type preserved by the clone.
   * @param value Descriptor whose prototype and own properties are copied.
   * @returns Frozen copy retaining the source prototype.
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
