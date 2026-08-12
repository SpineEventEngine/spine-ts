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
import { EntityStateChangedSchema } from "../../../proto/generated/spine/system/server/entity_log_events_pb.js";
import { describe, expect, it } from "vitest";

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
});
