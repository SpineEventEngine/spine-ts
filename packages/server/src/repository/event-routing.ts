import type { MessageShape } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import type { EventContext } from "@spine-event-engine/proto";

/**
 * Calculates immutable target Entity IDs for one Event admission.
 *
 * The route must be deterministic and side-effect-free. It runs once for an
 * accepted admission; durable replay uses stored targets instead.
 */
export type EventRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  message: MessageShape<Schema>,
  context: EventContext,
) => readonly Id[];

interface State<Id> {
  readonly exact: Map<MessageSchema, EventRoute<Id>>;
  readonly semantic: Map<string, EventRoute<Id>>;
  defaultRoute: EventRoute<Id> | undefined;
}
const states = new WeakMap<object, State<unknown>>();

/**
 * Mutable Event route declarations snapshotted by repository construction.
 */
export class EventRouting<Id> {
  /**
   * Creates empty mutable Event route declarations.
   */
  private constructor() {
    states.set(this, { exact: new Map(), semantic: new Map(), defaultRoute: undefined });
  }

  /**
   * Creates empty Event route declarations.
   *
   * @typeParam Id Entity ID type owned by the receiving repository.
   * @returns Mutable Event route declarations.
   */
  static create<Id>(): EventRouting<Id> {
    return new EventRouting<Id>();
  }

  /**
   * Registers an exact generated Event schema route.
   *
   * @param schema Generated Event message schema.
   * @param via Route that calculates target Entity IDs.
   * @returns These mutable route declarations.
   */
  route<Schema extends MessageSchema>(schema: Schema, via: EventRoute<Id, Schema>): this {
    if (typeof via !== "function") throw new TypeError("Event routing requires a route function.");
    const state = EventRoutingInternals.state(this);
    if (state.exact.has(schema))
      throw new Error("Event routing has a duplicate exact event route.");
    state.exact.set(schema, via);
    return this;
  }

  /**
   * Registers a descriptor semantic Event route.
   *
   * @param javaType Canonical descriptor `(is)` or `(every_is)` Java type,
   *   without surrounding whitespace.
   * @param via Route that calculates target Entity IDs.
   * @returns These mutable route declarations.
   */
  routeSemantic(javaType: string, via: EventRoute<Id>): this {
    if (typeof javaType !== "string" || javaType.trim().length === 0)
      throw new TypeError("Event semantic routing requires a non-empty Java type.");
    if (javaType !== javaType.trim())
      throw new TypeError("Event semantic routing requires a canonical Java type.");
    if (typeof via !== "function") throw new TypeError("Event routing requires a route function.");
    const state = EventRoutingInternals.state(this);
    if (state.semantic.has(javaType))
      throw new Error("Event routing has a duplicate semantic event route.");
    state.semantic.set(javaType, via);
    return this;
  }

  /**
   * Replaces the producer-aware default Event route.
   *
   * @param via Route that calculates target Entity IDs.
   * @returns These mutable route declarations.
   */
  replaceDefault(via: EventRoute<Id>): this {
    if (typeof via !== "function") throw new TypeError("Event routing requires a route function.");
    EventRoutingInternals.state(this).defaultRoute = via;
    return this;
  }
}

/**
 * Internal access to Event-routing declaration state.
 *
 * @internal
 */
export const EventRoutingInternals: Readonly<{
  state<Id>(routing: EventRouting<Id>): State<Id>;
  snapshot<Id>(routing: EventRouting<Id> | undefined): Readonly<{
    exact: ReadonlyMap<MessageSchema, EventRoute<Id>>;
    semantic: ReadonlyMap<string, EventRoute<Id>>;
    defaultRoute: EventRoute<Id> | undefined;
  }>;
}> = Object.freeze({
  state<Id>(routing: EventRouting<Id>): State<Id> {
    return states.get(routing) as State<Id>;
  },
  snapshot<Id>(routing: EventRouting<Id> | undefined): Readonly<{
    exact: ReadonlyMap<MessageSchema, EventRoute<Id>>;
    semantic: ReadonlyMap<string, EventRoute<Id>>;
    defaultRoute: EventRoute<Id> | undefined;
  }> {
    if (routing === undefined) {
      return Object.freeze({
        exact: new Map<MessageSchema, EventRoute<Id>>(),
        semantic: new Map<string, EventRoute<Id>>(),
        defaultRoute: undefined,
      });
    }
    const state = EventRoutingInternals.state(routing);
    return Object.freeze({
      exact: new Map(state.exact),
      semantic: new Map(state.semantic),
      defaultRoute: state.defaultRoute,
    });
  },
});
