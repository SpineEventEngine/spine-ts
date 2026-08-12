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
import { EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

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
});
