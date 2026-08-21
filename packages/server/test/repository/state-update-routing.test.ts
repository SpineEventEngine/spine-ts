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
// prettier-ignore
import {
  EntityStateChangedSchema,
} from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { MessageInterfaces } from "@spine-event-engine/core";
import { describe, expect, expectTypeOf, it } from "vitest";

import { StateUpdateRouting } from "../../src/index.js";
import { StateUpdateRoutingInternals } from "../../src/repository/state-update-routing.js";

describe("StateUpdateRouting", () => {
  it("creates factory-only exact and replacement-default declarations", () => {
    const route = () => ["target"];
    expect(() =>
      StateUpdateRouting.create<string>()
        .route(EntityStateChangedSchema, route)
        .route(EntityStateChangedSchema, route),
    ).toThrow(/duplicate exact state-update route/);
    expect(() =>
      StateUpdateRouting.create().route(EntityStateChangedSchema, undefined as never),
    ).toThrow(/route function/);
    expect(() => StateUpdateRouting.create().replaceDefault(undefined as never)).toThrow(
      /route function/,
    );
  });

  it("copies declarations into an immutable construction snapshot", () => {
    const first = () => ["first"];
    const second = () => ["second"];
    const routing = StateUpdateRouting.create<string>().route(EntityStateChangedSchema, first);

    const snapshot = StateUpdateRoutingInternals.snapshot(routing);
    routing.replaceDefault(second);

    expect(snapshot.exact.get(EntityStateChangedSchema)).toBe(first);
    expect(snapshot).not.toHaveProperty("semantic");
    expect(snapshot.defaultRoute).toBeUndefined();
  });

  it("declares an ordered nominal message-interface route", () => {
    const token = MessageInterfaces.define<object, readonly [typeof EntityStateChangedSchema]>([
      EntityStateChangedSchema,
    ]);
    const route = () => ["target"];
    const routing = StateUpdateRouting.create<string>().route(token, route);

    expect(StateUpdateRoutingInternals.snapshot(routing).interfaceRoutes).toEqual([
      expect.objectContaining({ route, token }),
    ]);
    expect(() => routing.route(token, route)).toThrow(/duplicate interface route/);
    expect(() => routing.route({ schemas: token.schemas } as never, route)).toThrow(
      /generated message interface token/,
    );
  });

  it("types a state interface callback with only common member fields", () => {
    interface Shared {
      readonly common: string;
    }
    type First = Message<"test.First"> & Shared & { readonly firstOnly: string };
    type Second = Message<"test.Second"> & Shared & { readonly secondOnly: string };
    const first = EntityStateChangedSchema as unknown as GenMessage<First>;
    const second = EntityStateChangedSchema as unknown as GenMessage<Second>;
    const token = MessageInterfaces.define<Shared, readonly [typeof first, typeof second]>([
      first,
      second,
    ]);

    StateUpdateRouting.create<string>().route(token, (message) => {
      expectTypeOf(message.common).toEqualTypeOf<string>();
      // @ts-expect-error A member-only field is not safe without narrowing the member union.
      expectTypeOf(message.firstOnly).toEqualTypeOf<string>();
      return [];
    });
  });
});
