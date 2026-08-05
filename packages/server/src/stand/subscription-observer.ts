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
import { AnyMessages, type MessageSchema } from "@spine-event-engine/core";
import {
  EventSchema,
  ResponseSchema,
  StatusSchema,
  type Event,
  type TenantId,
} from "@spine-event-engine/proto";
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
import { RecordMask } from "@spine-event-engine/storage";

import { eventBusAccess, type EventBus, type EventSubscription } from "../bus/event-bus.js";
import type { StandSubscription, StandUpdate } from "./stand.js";

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

/**
 * Groups the internal operations that observe and render canonical Stand
 * subscription definitions.
 *
 * @internal
 */
interface SubscriptionObserverOperations {
  observeSubscription(
    subscription: Subscription,
    eventBus: EventBus | undefined,
    findState: (typeUrl: string) => StandObservedState | undefined,
    subscribeState: (
      schema: MessageSchema,
      callback: (update: StandUpdate) => void,
      tenantId: string | undefined,
    ) => StandSubscription,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): StandSubscription | EventSubscription | undefined;
}

/**
 * Groups the internal operations that observe and render canonical Stand
 * subscription definitions.
 *
 * @internal
 */
export const SubscriptionObservers: SubscriptionObserverOperations = (() => {
  // prettier-ignore

  /**
   * Attaches one active canonical definition to this node's local state/EventBus
   * sources and renders its client-safe update before delivery to consumers.
   *
   * @param subscription The active canonical subscription definition.
   * @param eventBus The local event source for event targets.
   * @param findState Finds the local state route for a target type.
   * @param subscribeState Subscribes to local state updates for a state route.
   * @param onUpdate Receives a fully rendered client update.
   * @returns Returns the local observer attachment when the target is known.
   */
  function observeSubscription(
    subscription: Subscription,
    eventBus: EventBus | undefined,
    findState: (typeUrl: string) => StandObservedState | undefined,
    subscribeState: (
      schema: MessageSchema,
      callback: (update: StandUpdate) => void,
      tenantId: string | undefined,
    ) => StandSubscription,
    onUpdate: (update: SubscriptionUpdate) => void,
  ): StandSubscription | EventSubscription | undefined {
    const target = subscription.topic?.target;
    const typeUrl = target?.type;
    if (typeUrl === undefined || typeUrl.length === 0) return undefined;
    const tenantId = tenantValue(subscription.topic?.context?.tenantId);
    const state = findState(typeUrl);
    if (state !== undefined) {
      const render = createStateRenderer(subscription, state);
      return subscribeState(
        state.schema,
        (update) => {
          const rendered = render(update);
          if (rendered !== undefined) onUpdate(rendered);
        },
        tenantId,
      );
    }
    if (eventBus === undefined) return undefined;
    return eventBusAccess.subscribe(eventBus, typeUrl, {
      onEvent(event) {
        if (tenantId !== undefined && eventTenant(event) !== tenantId) return;
        onUpdate(createEventUpdate(subscription, event));
      },
    });
  }

  function createStateRenderer(
    subscription: Subscription,
    state: StandObservedState,
  ): (update: StandUpdate) => SubscriptionUpdate | undefined {
    const matcher = createMatcher(subscription, state);
    return (update) => {
      const match = matcher.match(update);
      if (match === undefined) return undefined;
      return create(SubscriptionUpdateSchema, {
        subscription: clone(SubscriptionSchema, subscription),
        response: okResponse(),
        update: {
          case: "entityUpdates",
          value: create(EntityUpdatesSchema, {
            update: [
              create(EntityStateUpdateSchema, {
                id: packEntityId(state, update.id),
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

  function createEventUpdate(subscription: Subscription, event: Event): SubscriptionUpdate {
    return create(SubscriptionUpdateSchema, {
      subscription: clone(SubscriptionSchema, subscription),
      response: okResponse(),
      update: {
        case: "eventUpdates",
        value: create(EventUpdatesSchema, { event: [cloneClientEvent(event)] }),
      },
    });
  }

  function okResponse() {
    return create(ResponseSchema, {
      status: create(StatusSchema, { status: { case: "ok", value: {} } }),
    });
  }

  function createMatcher(subscription: Subscription, state: StandObservedState): StateMatcher {
    const target = subscription.topic?.target;
    const mask = localMask(subscription, state.schema);
    if (target?.criterion.case !== "filters") return { mask, match: () => "state" };
    const filters = target.criterion.value;
    const idField = findField(state.schema, state.idField);
    const ids = filters.idFilter?.id.map((value) => decodeId(value, idField?.message));
    const predicate = createPredicate(filters.filter, state.schema);
    return {
      mask,
      match(update) {
        if (ids !== undefined && !ids.some((id) => equals(update.id, id, idField?.message))) {
          return undefined;
        }
        if (predicate(update.state)) return "state";
        return update.previousState !== undefined && predicate(update.previousState)
          ? "noLongerMatching"
          : undefined;
      },
    };
  }

  interface StateMatcher {
    readonly mask: readonly string[] | undefined;
    match(update: StandUpdate): "state" | "noLongerMatching" | undefined;
  }

  function createPredicate(
    filters: readonly CompositeFilter[],
    schema: MessageSchema,
  ): (state: Message) => boolean {
    const predicates = filters.map((filter) => compositePredicate(filter, schema));
    return (state) => predicates.every((predicate) => predicate(state));
  }

  function compositePredicate(
    filter: CompositeFilter,
    schema: MessageSchema,
  ): (state: Message) => boolean {
    const parts = [
      ...filter.filter.map((value) => simplePredicate(value, schema)),
      ...filter.compositeFilter.map((value) => compositePredicate(value, schema)),
    ];
    if (filter.operator === CompositeFilter_CompositeOperator.EITHER) {
      return (state) => parts.some((predicate) => predicate(state));
    }
    return (state) => parts.every((predicate) => predicate(state));
  }

  function simplePredicate(filter: Filter, schema: MessageSchema): (state: Message) => boolean {
    if (filter.operator !== Filter_Operator.EQUAL || filter.value === undefined) return () => false;
    const path = resolvePath(schema, filter.fieldPath?.fieldName ?? []);
    const expected = unpackValue(filter.value, path.leaf?.message);
    return (state) => equals(readPath(state, path.local), expected, path.leaf?.message);
  }

  function localMask(
    subscription: Subscription,
    schema: MessageSchema,
  ): readonly string[] | undefined {
    const paths = subscription.topic?.fieldMask?.paths ?? [];
    return paths.length === 0
      ? undefined
      : paths.map((path) => resolvePath(schema, path.split(".")).local.join("."));
  }

  interface ResolvedPath {
    readonly local: readonly string[];
    readonly leaf: { readonly localName: string; readonly message?: MessageSchema } | undefined;
  }

  function resolvePath(schema: MessageSchema, names: readonly string[]): ResolvedPath {
    let current: MessageSchema | undefined = schema;
    let leaf: { readonly localName: string; readonly message?: MessageSchema } | undefined;
    const local: string[] = [];
    for (const name of names) {
      leaf = findField(current, name);
      if (leaf === undefined) return { local: [], leaf: undefined };
      local.push(leaf.localName);
      current = leaf.message;
    }
    return { local, leaf };
  }

  function findField(
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

  function readPath(value: unknown, path: readonly string[]): unknown {
    let current = value;
    for (const part of path) {
      if (typeof current !== "object" || current === null) return undefined;
      current = Reflect.get(current, part);
    }
    return current;
  }

  function decodeId(value: Any, schema: MessageSchema | undefined): unknown {
    return schema === undefined ? unpackValue(value) : AnyMessages.unpack(value, schema);
  }

  function unpackValue(value: Any, schema?: MessageSchema): unknown {
    if (schema !== undefined) {
      const message = AnyMessages.unpack(value, schema);
      if (message !== undefined) return message;
    }
    for (const decoder of valueDecoders) {
      const decoded = decoder(value);
      if (decoded !== undefined) return decoded;
    }
    return value;
  }

  const valueDecoders = Object.freeze([
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

  function equals(left: unknown, right: unknown, schema?: MessageSchema): boolean {
    if (schema !== undefined && isMessage(left) && isMessage(right)) {
      return sameBytes(toBinary(schema, left), toBinary(schema, right));
    }
    if (isAny(left) && isAny(right))
      return sameBytes(toBinary(AnySchema, left), toBinary(AnySchema, right));
    if (left instanceof Uint8Array && right instanceof Uint8Array) return sameBytes(left, right);
    return Object.is(left, right);
  }

  function packEntityId(state: StandObservedState, id: unknown): Any | undefined {
    if (isAny(id)) return clone(AnySchema, id);
    const idSchema = findField(state.schema, state.idField)?.message;
    if (idSchema !== undefined && isMessage(id))
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

  function cloneClientEvent(event: Event): Event {
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

  function eventTenant(event: Event): string | undefined {
    switch (event.context?.origin.case) {
      case "importContext":
        return tenantValue(event.context.origin.value.tenantId);
      case "pastMessage":
        return tenantValue(event.context.origin.value.actorContext?.tenantId);
      default:
        return undefined;
    }
  }

  function tenantValue(tenant: TenantId | undefined): string | undefined {
    switch (tenant?.kind.case) {
      case "value":
        return tenant.kind.value;
      case "domain":
        return `domain:${tenant.kind.value.value}`;
      case "email":
        return `email:${tenant.kind.value.value}`;
      default:
        return undefined;
    }
  }

  function isMessage(value: unknown): value is Message {
    return typeof value === "object" && value !== null && "$typeName" in value;
  }

  function isAny(value: unknown): value is Any {
    return isMessage(value) && value.$typeName === "google.protobuf.Any";
  }

  function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  }

  return Object.freeze({ observeSubscription });
})();

/**
 * Attaches one active canonical definition through the internal observer group.
 *
 * @param subscription The active canonical subscription definition.
 * @param eventBus The local event source for event targets.
 * @param findState Finds the local state route for a target type.
 * @param subscribeState Subscribes to local state updates for a state route.
 * @param onUpdate Receives a fully rendered client update.
 * @returns Returns the local observer attachment when the target is known.
 * @internal
 */
export function observeSubscription(
  subscription: Subscription,
  eventBus: EventBus | undefined,
  findState: (typeUrl: string) => StandObservedState | undefined,
  subscribeState: (
    schema: MessageSchema,
    callback: (update: StandUpdate) => void,
    tenantId: string | undefined,
  ) => StandSubscription,
  onUpdate: (update: SubscriptionUpdate) => void,
): StandSubscription | EventSubscription | undefined {
  return SubscriptionObservers.observeSubscription(
    subscription,
    eventBus,
    findState,
    subscribeState,
    onUpdate,
  );
}
