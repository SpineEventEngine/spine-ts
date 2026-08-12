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
import { create } from "@bufbuild/protobuf";
import { CommandContextSchema, CommandSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

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
});
