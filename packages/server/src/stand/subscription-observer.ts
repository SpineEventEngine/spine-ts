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

import { clone, create, toBinary, type Message } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import {
  AnySchema,
  BoolValueSchema,
  BytesValueSchema,
  DoubleValueSchema,
  FloatValueSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  UInt32ValueSchema,
  UInt64ValueSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import {
  EventSchema,
  ResponseSchema,
  StatusSchema,
  TenantIdSchema,
  VersionSchema,
  type Event,
  type TenantId,
} from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  EventUpdatesSchema,
  type CompositeFilter,
  type Filter,
  Filter_Operator,
  CompositeFilter_CompositeOperator,
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  type Subscription,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { RecordMask } from "@spine-event-engine/storage";

import { eventBusAccess, type EventBus, type EventSubscription } from "../bus/event-bus.js";
import type { StandUpdate } from "./stand.js";

/* eslint-disable @typescript-eslint/no-extraneous-class */

/**
 * Describes a state type that a Stand can observe for a canonical definition.
 *
 * @internal
 */
export interface StandObservedState {
  // prettier-ignore

  /**
   * The state schema used for filtering and packing.
   */
  readonly schema: MessageSchema;

  /**
   * The local state property containing the entity ID.
   */
  readonly idField: string;
}

interface StateMatcher {
  readonly mask: readonly string[] | undefined;
  match(update: StandUpdate): "state" | "noLongerMatching" | undefined;
}

interface ResolvedPath {
  readonly local: readonly string[];
  readonly leaf: { readonly localName: string; readonly message?: MessageSchema } | undefined;
}

interface LifecycleMessage extends Message {
  readonly entity?: { readonly id?: Any; readonly typeUrl: string };
  readonly state?: Any;
  readonly lastState?: Any;
  readonly version?: import("@spine-event-engine/proto").Version;
}

/**
 * Groups the internal operations that observe and render canonical Stand
 * subscription definitions.
 *
 * @internal
 */
export class SubscriptionObservers {
  // prettier-ignore

  /**
   * Observes one domain event target through the domain EventBus.
   *
   * Entity-state targets are intentionally not inferred here: callers must use
   * {@link observeState} after classifying the target against domain Stand
   * metadata, so one definition cannot attach to both buses.
   *
   * @param subscription Defines the event target and tenant filter.
   * @param domainEventBus Delivers accepted domain events.
   * @param onUpdate Receives the rendered client update.
   * @returns Returns an attachment when the target is valid.
   * @internal
   */
  static observeEvent(
    subscription: Subscription,
    domainEventBus: EventBus | undefined,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): EventSubscription | undefined {
    const typeUrl = subscription.topic?.target?.type;
    if (typeUrl === undefined || typeUrl.length === 0 || domainEventBus === undefined)
      return undefined;
    const tenantId = SubscriptionObservers.#tenantValue(subscription.topic?.context?.tenantId);
    return eventBusAccess.subscribe(domainEventBus, typeUrl, {
      onEvent(event) {
        if (
          tenantId !== undefined &&
          !SubscriptionObservers.#sameTenant(SubscriptionObservers.#eventTenant(event), tenantId)
        )
          return;
        onUpdate(SubscriptionObservers.#createEventUpdate(subscription, event));
      },
    });
  }

  /**
   * Observes one known entity-state target through the paired System EventBus.
   *
   * @param subscription Defines the state target and tenant filter.
   * @param state Supplies registered entity-state metadata.
   * @param systemEventBus Delivers Entity state and lifecycle System events.
   * @param onUpdate Receives the rendered client update.
   * @returns Returns an attachment when the System bus is available.
   * @internal
   */
  static observeState(
    subscription: Subscription,
    state: StandObservedState,
    systemEventBus: EventBus | undefined,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): EventSubscription | undefined {
    if (systemEventBus === undefined) return undefined;
    const tenantId = SubscriptionObservers.#tenantValue(subscription.topic?.context?.tenantId);
    const render = SubscriptionObservers.#createStateRenderer(subscription, state);
    const subscriptions = [
      eventBusAccess.subscribe(
        systemEventBus,
        TypeUrls.derive(EntityLog.EntityStateChangedSchema),
        {
          onEvent(event) {
            const update = SubscriptionObservers.#stateChangeUpdate(event, state, tenantId);
            if (update !== undefined) {
              const rendered = render(update);
              if (rendered !== undefined) onUpdate(rendered);
            }
          },
        },
      ),
      eventBusAccess.subscribe(systemEventBus, TypeUrls.derive(EntityLog.EntityArchivedSchema), {
        onEvent(event) {
          SubscriptionObservers.#lifecycleRemoval(
            event,
            state,
            tenantId,
            EntityLog.EntityArchivedSchema,
            subscription,
            onUpdate,
          );
        },
      }),
      eventBusAccess.subscribe(systemEventBus, TypeUrls.derive(EntityLog.EntityDeletedSchema), {
        onEvent(event) {
          SubscriptionObservers.#lifecycleRemoval(
            event,
            state,
            tenantId,
            EntityLog.EntityDeletedSchema,
            subscription,
            onUpdate,
          );
        },
      }),
      eventBusAccess.subscribe(systemEventBus, TypeUrls.derive(EntityLog.EntityUnarchivedSchema), {
        onEvent(event) {
          SubscriptionObservers.#lifecycleState(
            event,
            state,
            tenantId,
            EntityLog.EntityUnarchivedSchema,
            render,
            onUpdate,
          );
        },
      }),
      eventBusAccess.subscribe(systemEventBus, TypeUrls.derive(EntityLog.EntityRestoredSchema), {
        onEvent(event) {
          SubscriptionObservers.#lifecycleState(
            event,
            state,
            tenantId,
            EntityLog.EntityRestoredSchema,
            render,
            onUpdate,
          );
        },
      }),
    ];
    return {
      get closed() {
        return subscriptions.every((subscription) => subscription.closed);
      },
      unsubscribe() {
        const errors: unknown[] = [];
        for (const subscription of subscriptions) {
          try {
            subscription.unsubscribe();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1)
          throw new AggregateError(errors, "Entity subscription observer detach failed.");
      },
    };
  }

  static #lifecycleRemoval(
    event: Event,
    state: StandObservedState,
    tenantId: TenantId | undefined,
    schema: MessageSchema,
    subscription: Subscription,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): void {
    if (
      tenantId !== undefined &&
      !SubscriptionObservers.#sameTenant(SubscriptionObservers.#eventTenant(event), tenantId)
    )
      return;
    const lifecycle =
      event.message === undefined
        ? undefined
        : (AnyMessages.unpack(event.message, schema) as LifecycleMessage | undefined);
    if (
      lifecycle?.entity?.typeUrl !== TypeUrls.derive(state.schema) ||
      lifecycle.entity.id === undefined
    )
      return;
    const idSchema = SubscriptionObservers.#findField(state.schema, state.idField)?.message;
    const id = SubscriptionObservers.#unpackValue(lifecycle.entity.id, idSchema);
    if (id === undefined) return;
    const lastState =
      lifecycle.lastState === undefined
        ? undefined
        : AnyMessages.unpack(lifecycle.lastState, state.schema);
    if (
      lastState === undefined ||
      SubscriptionObservers.#createMatcher(subscription, state).match({
        typeUrl: TypeUrls.derive(state.schema),
        id,
        state: lastState,
      }) === undefined
    )
      return;
    onUpdate(SubscriptionObservers.#removalUpdate(id, state, subscription));
  }

  static #lifecycleState(
    event: Event,
    state: StandObservedState,
    tenantId: TenantId | undefined,
    schema: MessageSchema,
    render: (update: StandUpdate) => SubscriptionUpdate | undefined,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): void {
    if (
      tenantId !== undefined &&
      !SubscriptionObservers.#sameTenant(SubscriptionObservers.#eventTenant(event), tenantId)
    )
      return;
    const lifecycle =
      event.message === undefined
        ? undefined
        : (AnyMessages.unpack(event.message, schema) as LifecycleMessage | undefined);
    if (
      lifecycle?.entity?.typeUrl !== TypeUrls.derive(state.schema) ||
      lifecycle.entity.id === undefined ||
      lifecycle.state === undefined
    )
      return;
    const idSchema = SubscriptionObservers.#findField(state.schema, state.idField)?.message;
    const id = SubscriptionObservers.#unpackValue(lifecycle.entity.id, idSchema);
    const entityState = AnyMessages.unpack(lifecycle.state, state.schema);
    if (id === undefined || entityState === undefined) return;
    const rendered = render(
      Object.freeze({
        typeUrl: TypeUrls.derive(state.schema),
        id,
        state: entityState,
        ...(lifecycle.version === undefined
          ? {}
          : { version: clone(VersionSchema, lifecycle.version) }),
        ...(tenantId === undefined ? {} : { tenantId: clone(TenantIdSchema, tenantId) }),
      }),
    );
    if (rendered !== undefined) onUpdate(rendered);
  }

  static #removalUpdate(
    id: unknown,
    state: StandObservedState,
    subscription: Subscription,
  ): SubscriptionUpdate {
    return create(SubscriptionUpdateSchema, {
      subscription: clone(SubscriptionSchema, subscription),
      response: SubscriptionObservers.#okResponse(),
      update: {
        case: "entityUpdates",
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: SubscriptionObservers.#packEntityId(state, id),
              kind: { case: "noLongerMatching", value: true },
            }),
          ],
        }),
      },
    });
  }

  static #createStateRenderer(
    subscription: Subscription,
    state: StandObservedState,
  ): (update: StandUpdate) => SubscriptionUpdate | undefined {
    const matcher = SubscriptionObservers.#createMatcher(subscription, state);
    return (update) => {
      const match = matcher.match(update);
      if (match === undefined) return undefined;
      return create(SubscriptionUpdateSchema, {
        subscription: clone(SubscriptionSchema, subscription),
        response: SubscriptionObservers.#okResponse(),
        update: {
          case: "entityUpdates",
          value: create(EntityUpdatesSchema, {
            update: [
              create(EntityStateUpdateSchema, {
                id: SubscriptionObservers.#packEntityId(state, update.id),
                kind:
                  match === "state"
                    ? {
                        case: "state",
                        value: AnyMessages.pack(
                          state.schema,
                          RecordMask.apply(clone(state.schema, update.state), matcher.mask),
                          { validate: false },
                        ),
                      }
                    : { case: "noLongerMatching", value: true },
              }),
            ],
          }),
        },
      });
    };
  }

  static #createEventUpdate(subscription: Subscription, event: Event): SubscriptionUpdate {
    return create(SubscriptionUpdateSchema, {
      subscription: clone(SubscriptionSchema, subscription),
      response: SubscriptionObservers.#okResponse(),
      update: {
        case: "eventUpdates",
        value: create(EventUpdatesSchema, {
          event: [SubscriptionObservers.#cloneClientEvent(event)],
        }),
      },
    });
  }

  static #stateChangeUpdate(
    event: Event,
    state: StandObservedState,
    tenantId: TenantId | undefined,
  ): StandUpdate | undefined {
    if (
      tenantId !== undefined &&
      !SubscriptionObservers.#sameTenant(SubscriptionObservers.#eventTenant(event), tenantId)
    )
      return undefined;
    const change =
      event.message === undefined
        ? undefined
        : AnyMessages.unpack(event.message, EntityLog.EntityStateChangedSchema);
    if (change?.entity?.typeUrl !== TypeUrls.derive(state.schema) || change.newState === undefined)
      return undefined;
    const newState = AnyMessages.unpack(change.newState, state.schema);
    const idSchema = SubscriptionObservers.#findField(state.schema, state.idField)?.message;
    const id =
      change.entity.id === undefined
        ? undefined
        : SubscriptionObservers.#unpackValue(change.entity.id, idSchema);
    if (newState === undefined || id === undefined) return undefined;
    const oldState =
      change.oldState === undefined ? undefined : AnyMessages.unpack(change.oldState, state.schema);
    return Object.freeze({
      typeUrl: TypeUrls.derive(state.schema),
      id,
      ...(oldState === undefined ? {} : { previousState: oldState }),
      state: newState,
      ...(change.newVersion === undefined
        ? {}
        : { version: clone(VersionSchema, change.newVersion) }),
      ...(tenantId === undefined ? {} : { tenantId: clone(TenantIdSchema, tenantId) }),
    });
  }

  static #okResponse() {
    return create(ResponseSchema, {
      status: create(StatusSchema, { status: { case: "ok", value: {} } }),
    });
  }

  static #createMatcher(subscription: Subscription, state: StandObservedState): StateMatcher {
    const target = subscription.topic?.target;
    const mask = SubscriptionObservers.#localMask(subscription, state.schema);
    if (target?.criterion.case !== "filters") return { mask, match: () => "state" };
    const filters = target.criterion.value;
    const idField = SubscriptionObservers.#findField(state.schema, state.idField);
    const ids = filters.idFilter?.id.map((value) =>
      SubscriptionObservers.#decodeId(value, idField?.message),
    );
    const predicate = SubscriptionObservers.#createPredicate(filters.filter, state.schema);
    return {
      mask,
      match(update) {
        if (
          ids !== undefined &&
          !ids.some((id) => SubscriptionObservers.#equals(update.id, id, idField?.message))
        ) {
          return undefined;
        }
        if (predicate(update.state)) return "state";
        return update.previousState !== undefined && predicate(update.previousState)
          ? "noLongerMatching"
          : undefined;
      },
    };
  }

  static #createPredicate(
    filters: readonly CompositeFilter[],
    schema: MessageSchema,
  ): (state: Message) => boolean {
    const predicates = filters.map((filter) =>
      SubscriptionObservers.#compositePredicate(filter, schema),
    );
    return (state) => predicates.every((predicate) => predicate(state));
  }

  static #compositePredicate(
    filter: CompositeFilter,
    schema: MessageSchema,
  ): (state: Message) => boolean {
    const parts = [
      ...filter.filter.map((value) => SubscriptionObservers.#simplePredicate(value, schema)),
      ...filter.compositeFilter.map((value) =>
        SubscriptionObservers.#compositePredicate(value, schema),
      ),
    ];
    if (filter.operator === CompositeFilter_CompositeOperator.EITHER) {
      return (state) => parts.some((predicate) => predicate(state));
    }
    return (state) => parts.every((predicate) => predicate(state));
  }

  static #simplePredicate(filter: Filter, schema: MessageSchema): (state: Message) => boolean {
    if (filter.operator !== Filter_Operator.EQUAL || filter.value === undefined) return () => false;
    const path = SubscriptionObservers.#resolvePath(schema, filter.fieldPath?.fieldName ?? []);
    const expected = SubscriptionObservers.#unpackValue(filter.value, path.leaf?.message);
    return (state) =>
      SubscriptionObservers.#equals(
        SubscriptionObservers.#readPath(state, path.local),
        expected,
        path.leaf?.message,
      );
  }

  static #localMask(
    subscription: Subscription,
    schema: MessageSchema,
  ): readonly string[] | undefined {
    const paths = subscription.topic?.fieldMask?.paths ?? [];
    return paths.length === 0
      ? undefined
      : paths.map((path) =>
          SubscriptionObservers.#resolvePath(schema, path.split(".")).local.join("."),
        );
  }

  static #resolvePath(schema: MessageSchema, names: readonly string[]): ResolvedPath {
    let current: MessageSchema | undefined = schema;
    let leaf: { readonly localName: string; readonly message?: MessageSchema } | undefined;
    const local: string[] = [];
    for (const name of names) {
      leaf = SubscriptionObservers.#findField(current, name);
      if (leaf === undefined) return { local: [], leaf: undefined };
      local.push(leaf.localName);
      current = leaf.message;
    }
    return { local, leaf };
  }

  static #findField(
    schema: MessageSchema | undefined,
    name: string,
  ): { readonly localName: string; readonly message?: MessageSchema } | undefined {
    return (
      schema?.fields as
        | readonly {
            readonly name: string;
            readonly localName: string;
            readonly message?: MessageSchema;
          }[]
        | undefined
    )?.find((field) => field.name === name || field.localName === name);
  }

  static #readPath(value: unknown, path: readonly string[]): unknown {
    let current = value;
    for (const part of path) {
      if (typeof current !== "object" || current === null) return undefined;
      current = Reflect.get(current, part);
    }
    return current;
  }

  static #decodeId(value: Any, schema: MessageSchema | undefined): unknown {
    return schema === undefined
      ? SubscriptionObservers.#unpackValue(value)
      : AnyMessages.unpack(value, schema);
  }

  static #unpackValue(value: Any, schema?: MessageSchema): unknown {
    if (schema !== undefined) {
      const message = AnyMessages.unpack(value, schema);
      if (message !== undefined) return message;
    }
    for (const decoder of SubscriptionObservers.#valueDecoders) {
      const decoded = decoder(value);
      if (decoded !== undefined) return decoded;
    }
    return value;
  }

  static readonly #valueDecoders = Object.freeze([
    (value: Any) => AnyMessages.unpack(value, StringValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, BoolValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, Int32ValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, UInt32ValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, Int64ValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, UInt64ValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, FloatValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, DoubleValueSchema)?.value,
    (value: Any) => AnyMessages.unpack(value, BytesValueSchema)?.value,
  ]);

  static #equals(left: unknown, right: unknown, schema?: MessageSchema): boolean {
    if (
      schema !== undefined &&
      SubscriptionObservers.#isMessage(left) &&
      SubscriptionObservers.#isMessage(right)
    ) {
      return SubscriptionObservers.#sameBytes(toBinary(schema, left), toBinary(schema, right));
    }
    if (SubscriptionObservers.#isAny(left) && SubscriptionObservers.#isAny(right)) {
      return SubscriptionObservers.#sameBytes(
        toBinary(AnySchema, left),
        toBinary(AnySchema, right),
      );
    }
    if (left instanceof Uint8Array && right instanceof Uint8Array) {
      return SubscriptionObservers.#sameBytes(left, right);
    }
    return Object.is(left, right);
  }

  static #packEntityId(state: StandObservedState, id: unknown): Any | undefined {
    if (SubscriptionObservers.#isAny(id)) return clone(AnySchema, id);
    const idSchema = SubscriptionObservers.#findField(state.schema, state.idField)?.message;
    if (idSchema !== undefined && SubscriptionObservers.#isMessage(id))
      return AnyMessages.pack(idSchema, id, { validate: false });
    if (id instanceof Uint8Array)
      return AnyMessages.pack(BytesValueSchema, create(BytesValueSchema, { value: id }));
    if (typeof id === "string")
      return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }));
    if (typeof id === "boolean")
      return AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value: id }));
    if (typeof id === "number")
      return AnyMessages.pack(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
    return typeof id === "bigint"
      ? AnyMessages.pack(Int64ValueSchema, create(Int64ValueSchema, { value: id }))
      : undefined;
  }

  static #cloneClientEvent(event: Event): Event {
    const client = clone(EventSchema, event);
    const rejection = client.context?.rejection;
    if (rejection !== undefined) {
      rejection.command = undefined;
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      rejection.commandMessage = undefined;
      rejection.stacktrace = "";
    }
    return client;
  }

  static #eventTenant(event: Event): TenantId | undefined {
    switch (event.context?.origin.case) {
      case "importContext":
        return SubscriptionObservers.#tenantValue(event.context.origin.value.tenantId);
      case "pastMessage":
        return SubscriptionObservers.#tenantValue(
          event.context.origin.value.actorContext?.tenantId,
        );
      default:
        return undefined;
    }
  }

  static #tenantValue(tenant: TenantId | undefined): TenantId | undefined {
    return tenant === undefined ? undefined : clone(TenantIdSchema, tenant);
  }

  static #sameTenant(left: TenantId | undefined, right: TenantId): boolean {
    return left !== undefined && TenantBoundary.from(left).key === TenantBoundary.from(right).key;
  }

  static #isMessage(value: unknown): value is Message {
    return typeof value === "object" && value !== null && "$typeName" in value;
  }

  static #isAny(value: unknown): value is Any {
    return SubscriptionObservers.#isMessage(value) && value.$typeName === "google.protobuf.Any";
  }

  static #sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  }
}
