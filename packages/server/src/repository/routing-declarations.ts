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

import type { MessageShape } from "@bufbuild/protobuf";
import {
  MessageInterfaces,
  type MessageInterface,
  type MessageSchema,
} from "@spine-event-engine/core";

export type InterfaceRouteSchemas = readonly [MessageSchema, ...MessageSchema[]];
type InterfaceToken = MessageInterface<object, InterfaceRouteSchemas>;

/**
 * Message shape available to a route declared for a message-interface token.
 *
 * @typeParam TInterface Declared common interface shape.
 * @typeParam Schemas Concrete token member schemas.
 */
export type InterfaceRouteMessage<
  TInterface extends object,
  Schemas extends InterfaceRouteSchemas,
> = MessageShape<Schemas[number]> & TInterface;

interface InterfaceRoute<Route> {
  readonly token: InterfaceToken;
  readonly route: Route;
}

export interface RoutingDeclarationState<Route> {
  readonly exact: Map<MessageSchema, Route>;
  readonly interfaceRoutes: Map<InterfaceToken, Route>;
  defaultRoute: Route | undefined;
}

export interface RoutingDeclarationSnapshot<Route> {
  readonly exact: ReadonlyMap<MessageSchema, Route>;
  readonly interfaceRoutes: readonly InterfaceRoute<Route>[];
  readonly defaultRoute: Route | undefined;
}

function readOnlyMap<Key, Value>(source: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
  let facade: ReadonlyMap<Key, Value>;
  facade = Object.freeze({
    get size() {
      return source.size;
    },
    [Symbol.iterator]: () => source[Symbol.iterator](),
    entries: () => source.entries(),
    get: (key: Key) => source.get(key),
    has: (key: Key) => source.has(key),
    keys: () => source.keys(),
    values: () => source.values(),
    forEach: (callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void) =>
      source.forEach((value, key) => callback(value, key, facade)),
  }) as ReadonlyMap<Key, Value>;
  return facade;
}

/**
 * Internal common declaration, snapshot, and selection mechanics for repository routing.
 *
 * @internal
 */
export const RoutingDeclarations: Readonly<{
  create<Route>(): RoutingDeclarationState<Route>;
  exact<Route>(
    state: RoutingDeclarationState<Route>,
    schema: MessageSchema,
    route: Route,
    duplicateMessage: string,
  ): void;
  routeInterface<Route>(
    state: RoutingDeclarationState<Route>,
    token: unknown,
    route: Route,
    routingName: string,
  ): void;
  isInterfaceTokenCandidate(
    value: unknown,
  ): value is MessageInterface<object, InterfaceRouteSchemas> | { readonly schemas: unknown };
  default<Route>(state: RoutingDeclarationState<Route>, route: Route): void;
  snapshot<Route>(state: RoutingDeclarationState<Route>): RoutingDeclarationSnapshot<Route>;
  select<Route>(
    snapshot: RoutingDeclarationSnapshot<Route>,
    schema: MessageSchema,
  ): Route | undefined;
  validate<Route>(
    snapshot: RoutingDeclarationSnapshot<Route>,
    schemas: readonly MessageSchema[],
    signalKind: string,
  ): void;
}> = Object.freeze({
  create<Route>(): RoutingDeclarationState<Route> {
    return { exact: new Map(), interfaceRoutes: new Map(), defaultRoute: undefined };
  },

  exact<Route>(
    state: RoutingDeclarationState<Route>,
    schema: MessageSchema,
    route: Route,
    duplicateMessage: string,
  ): void {
    if (state.exact.has(schema)) {
      throw new Error(duplicateMessage);
    }
    state.exact.set(schema, route);
  },

  routeInterface<Route>(
    state: RoutingDeclarationState<Route>,
    token: unknown,
    route: Route,
    routingName: string,
  ): void {
    if (!MessageInterfaces.is(token)) {
      throw new TypeError(`${routingName} requires a generated message interface token.`);
    }
    const interfaceToken = token as InterfaceToken;
    if (state.interfaceRoutes.has(interfaceToken)) {
      throw new Error(`${routingName} has a duplicate interface route.`);
    }
    state.interfaceRoutes.set(interfaceToken, route);
  },

  isInterfaceTokenCandidate(
    value: unknown,
  ): value is MessageInterface<object, InterfaceRouteSchemas> | { readonly schemas: unknown } {
    return (
      MessageInterfaces.is(value) ||
      (typeof value === "object" && value !== null && "schemas" in value)
    );
  },

  default<Route>(state: RoutingDeclarationState<Route>, route: Route): void {
    state.defaultRoute = route;
  },

  snapshot<Route>(state: RoutingDeclarationState<Route>): RoutingDeclarationSnapshot<Route> {
    const exact = new Map(state.exact);
    const interfaceRoutes = Object.freeze(
      [...state.interfaceRoutes].map(([token, route]) => Object.freeze({ token, route })),
    );
    return Object.freeze({
      exact: readOnlyMap(exact),
      interfaceRoutes,
      defaultRoute: state.defaultRoute,
    });
  },

  select<Route>(
    snapshot: RoutingDeclarationSnapshot<Route>,
    schema: MessageSchema,
  ): Route | undefined {
    const exact = snapshot.exact.get(schema);
    if (exact !== undefined) return exact;
    for (const { token, route } of snapshot.interfaceRoutes) {
      if (token.schemas.includes(schema)) return route;
    }
    return snapshot.defaultRoute;
  },

  validate<Route>(
    snapshot: RoutingDeclarationSnapshot<Route>,
    schemas: readonly MessageSchema[],
    signalKind: string,
  ): void {
    const registered = new Set(schemas);
    for (const schema of snapshot.exact.keys()) {
      if (!registered.has(schema)) {
        throw new Error(
          `Repository ${signalKind} routing has an unregistered exact route for "${schema.typeName}".`,
        );
      }
    }
    for (const { token } of snapshot.interfaceRoutes) {
      for (const schema of token.schemas) {
        if (!registered.has(schema)) {
          throw new Error(
            `Repository ${signalKind} routing has an unregistered interface member "${schema.typeName}".`,
          );
        }
      }
    }
  },
});
