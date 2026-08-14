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

import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { MessageInterfaces } from "@spine-event-engine/core";
import { CommandContextSchema, CommandSchema } from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it } from "vitest";

import { CommandRouting } from "../../src/index.js";
import { CommandRoutingInternals } from "../../src/repository/command-routing.js";

describe("CommandRouting", () => {
  it("exposes only exact and replacement-default declarations", () => {
    const route = () => "target";

    expect(() =>
      CommandRouting.create<string>().route(CommandSchema, route).route(CommandSchema, route),
    ).toThrow(/duplicate exact command route/);
    expect(() => CommandRouting.create<string>().route(CommandSchema, undefined as never)).toThrow(
      /requires a route function/,
    );
    expect(() => CommandRouting.create<string>().replaceDefault(undefined as never)).toThrow(
      /requires a route function/,
    );

    expect(
      CommandRouting.create<string>()
        .route(CommandSchema, (message, context) => {
          expect(message.$typeName).toBe("spine.core.Command");
          expect(context).toEqual(create(CommandContextSchema));
          return "target";
        })
        .replaceDefault(route),
    ).toBeInstanceOf(CommandRouting);
  });

  it("copies route declarations into an immutable construction snapshot", () => {
    const first = () => "first";
    const second = () => "second";
    const routing = CommandRouting.create<string>().route(CommandSchema, first);

    const snapshot = CommandRoutingInternals.snapshot(routing);
    routing.replaceDefault(second);

    expect(snapshot.exact.get(CommandSchema)).toBe(first);
    expect(snapshot).not.toHaveProperty("semantic");
    expect(snapshot.defaultRoute).toBeUndefined();
  });

  it("declares an ordered nominal message-interface route", () => {
    const token = MessageInterfaces.define<object, readonly [typeof CommandSchema]>([CommandSchema]);
    const route = () => "target";
    const routing = CommandRouting.create<string>().route(token, route);

    expect(CommandRoutingInternals.snapshot(routing).interfaceRoutes).toEqual([
      expect.objectContaining({ route, token }),
    ]);
    expect(() => routing.route(token, route)).toThrow(/duplicate interface route/);
    expect(() => routing.route({ schemas: token.schemas } as never, route)).toThrow(
      /generated message interface token/,
    );
  });

  it("types interface callbacks as the member union intersected with the interface", () => {
    type Shared = { readonly common: string };
    type First = Message<"test.First"> & Shared & { readonly firstOnly: string };
    type Second = Message<"test.Second"> & Shared & { readonly secondOnly: string };
    const first = CommandSchema as unknown as GenMessage<First>;
    const second = CommandSchema as unknown as GenMessage<Second>;
    const token = MessageInterfaces.define<Shared, readonly [typeof first, typeof second]>([
      first,
      second,
    ]);

    CommandRouting.create<string>()
      .route(CommandSchema, (message) => {
        expectTypeOf(message).toMatchTypeOf<Message<"spine.core.Command">>();
        return "exact";
      })
      .route(token, (message) => {
        expectTypeOf(message.common).toEqualTypeOf<string>();
        // @ts-expect-error A member-only field is not safe without narrowing the member union.
        message.firstOnly;
        return "interface";
      });
  });
});
