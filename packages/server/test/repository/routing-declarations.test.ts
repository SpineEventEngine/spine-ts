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

import { MessageInterfaces } from "@spine-event-engine/core";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { RoutingDeclarations } from "../../src/repository/routing-declarations.js";

describe("RoutingDeclarations", () => {
  it("selects an exact route before registered interface routes and the default", () => {
    const token = MessageInterfaces.define<object, readonly [typeof CommandSchema]>([CommandSchema]);
    const declarations = RoutingDeclarations.create<string>();
    const exact = "exact";
    const byInterface = "interface";
    const fallback = "default";

    RoutingDeclarations.exact(declarations, CommandSchema, exact, "Command routing");
    RoutingDeclarations.routeInterface(declarations, token, byInterface, "Command routing");
    RoutingDeclarations.default(declarations, fallback);

    const snapshot = RoutingDeclarations.snapshot(declarations);

    expect(RoutingDeclarations.select(snapshot, CommandSchema)).toBe(exact);
    expect(RoutingDeclarations.select(snapshot, EventSchema)).toBe(fallback);
  });

  it("selects the first matching interface route in registration order", () => {
    const broader = MessageInterfaces.define<object, readonly [typeof CommandSchema, typeof EventSchema]>([
      CommandSchema,
      EventSchema,
    ]);
    const narrower = MessageInterfaces.define<object, readonly [typeof CommandSchema]>([CommandSchema]);
    const declarations = RoutingDeclarations.create<string>();

    RoutingDeclarations.routeInterface(declarations, broader, "broader", "Event routing");
    RoutingDeclarations.routeInterface(declarations, narrower, "narrower", "Event routing");

    expect(RoutingDeclarations.select(RoutingDeclarations.snapshot(declarations), CommandSchema)).toBe(
      "broader",
    );
  });

  it("rejects duplicate and non-nominal interface tokens", () => {
    const token = MessageInterfaces.define<object, readonly [typeof CommandSchema]>([CommandSchema]);
    const declarations = RoutingDeclarations.create<string>();

    RoutingDeclarations.routeInterface(declarations, token, "first", "Command routing");

    expect(() => RoutingDeclarations.routeInterface(declarations, token, "second", "Command routing")).toThrow(
      /duplicate interface route/,
    );
    expect(() =>
      RoutingDeclarations.routeInterface(declarations, { schemas: token.schemas }, "copy", "Command routing"),
    ).toThrow(/generated message interface token/);
  });

  it("rejects an interface whose members are not all registered by a repository", () => {
    const token = MessageInterfaces.define<object, readonly [typeof CommandSchema, typeof EventSchema]>([
      CommandSchema,
      EventSchema,
    ]);
    const declarations = RoutingDeclarations.create<string>();
    RoutingDeclarations.routeInterface(declarations, token, "route", "Command routing");

    expect(() =>
      RoutingDeclarations.validate(RoutingDeclarations.snapshot(declarations), [CommandSchema], "command"),
    ).toThrow(/unregistered interface member.*spine.core.Event/);
  });

  it("passes the immutable map facade to snapshot forEach callbacks", () => {
    const declarations = RoutingDeclarations.create<string>();
    RoutingDeclarations.exact(declarations, CommandSchema, "route", "Command routing");
    const snapshot = RoutingDeclarations.snapshot(declarations);

    snapshot.exact.forEach((_route, _schema, map) => {
      expect(map).toBe(snapshot.exact);
      expect("set" in map).toBe(false);
    });
  });

  it("classifies nominal and copied interface-token candidates without classifying schemas", () => {
    const token = MessageInterfaces.define<object, readonly [typeof CommandSchema]>([CommandSchema]);

    expect(RoutingDeclarations.isInterfaceTokenCandidate(token)).toBe(true);
    expect(RoutingDeclarations.isInterfaceTokenCandidate({ schemas: token.schemas })).toBe(true);
    expect(RoutingDeclarations.isInterfaceTokenCandidate(CommandSchema)).toBe(false);
  });
});
