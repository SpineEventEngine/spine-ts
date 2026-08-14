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

import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { EventSchema } from "@spine-event-engine/proto";
import { MessageInterfaces } from "@spine-event-engine/core";
import { describe, expect, expectTypeOf, it } from "vitest";

import { EventRouting } from "../../src/index.js";
import { EventRoutingInternals } from "../../src/repository/event-routing.js";

describe("EventRouting", () => {
  it("creates factory-only exact and replacement-default declarations", () => {
    const route = () => ["target"];
    expect(() =>
      EventRouting.create<string>().route(EventSchema, route).route(EventSchema, route),
    ).toThrow(/duplicate exact event route/);
    expect(() => EventRouting.create<string>().route(EventSchema, undefined as never)).toThrow(
      /requires a route function/,
    );
    expect(() => EventRouting.create<string>().replaceDefault(undefined as never)).toThrow(
      /requires a route function/,
    );
  });

  it("copies declarations into an immutable construction snapshot", () => {
    const first = () => ["first"];
    const second = () => ["second"];
    const routing = EventRouting.create<string>().route(EventSchema, first);

    const snapshot = EventRoutingInternals.snapshot(routing);
    routing.replaceDefault(second);

    expect(snapshot.exact.get(EventSchema)).toBe(first);
    expect(snapshot).not.toHaveProperty("semantic");
    expect(snapshot.defaultRoute).toBeUndefined();
  });

  it("declares an ordered nominal message-interface route", () => {
    const token = MessageInterfaces.define<object, readonly [typeof EventSchema]>([EventSchema]);
    const route = () => ["target"];
    const routing = EventRouting.create<string>().route(token, route);

    expect(EventRoutingInternals.snapshot(routing).interfaceRoutes).toEqual([
      expect.objectContaining({ route, token }),
    ]);
    expect(() => routing.route(token, route)).toThrow(/duplicate interface route/);
    expect(() => routing.route({ schemas: token.schemas } as never, route)).toThrow(
      /generated message interface token/,
    );
  });

  it("types an Event interface callback with only common member fields", () => {
    interface Shared {
      readonly common: string;
    }
    type First = Message<"test.First"> & Shared & { readonly firstOnly: string };
    type Second = Message<"test.Second"> & Shared & { readonly secondOnly: string };
    const first = EventSchema as unknown as GenMessage<First>;
    const second = EventSchema as unknown as GenMessage<Second>;
    const token = MessageInterfaces.define<Shared, readonly [typeof first, typeof second]>([
      first,
      second,
    ]);

    EventRouting.create<string>().route(token, (message) => {
      expectTypeOf(message.common).toEqualTypeOf<string>();
      // @ts-expect-error A member-only field is not safe without narrowing the member union.
      expectTypeOf(message.secondOnly).toEqualTypeOf<string>();
      return [];
    });
  });
});
