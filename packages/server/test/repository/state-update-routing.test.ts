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
