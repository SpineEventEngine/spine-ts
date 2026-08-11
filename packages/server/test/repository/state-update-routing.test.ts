import { EntityStateChangedSchema } from "../../../proto/generated/spine/system/server/entity_log_events_pb.js";
import { describe, expect, it } from "vitest";

import { StateUpdateRouting } from "../../src/index.js";
import { StateUpdateRoutingInternals } from "../../src/repository/state-update-routing.js";

describe("StateUpdateRouting", () => {
  it("creates factory-only declarations and rejects duplicate canonical registrations", () => {
    const route = () => ["target"];
    expect(() =>
      StateUpdateRouting.create<string>()
        .route(EntityStateChangedSchema, route)
        .route(EntityStateChangedSchema, route),
    ).toThrow(/duplicate exact state-update route/);
    expect(() =>
      StateUpdateRouting.create<string>().routeSemantic(" example.State", route),
    ).toThrow(/canonical Java type/);
    expect(() => StateUpdateRouting.create<string>().routeSemantic("   ", route)).toThrow(
      /non-empty Java type/,
    );
    expect(() =>
      StateUpdateRouting.create<string>()
        .routeSemantic("example.State", route)
        .routeSemantic("example.State", route),
    ).toThrow(/duplicate semantic state-update route/);
  });

  it("copies declarations into an immutable construction snapshot", () => {
    const first = () => ["first"];
    const second = () => ["second"];
    const routing = StateUpdateRouting.create<string>().route(EntityStateChangedSchema, first);

    const snapshot = StateUpdateRoutingInternals.snapshot(routing);
    routing.routeSemantic("example.State", second).replaceDefault(second);

    expect(snapshot.exact.get(EntityStateChangedSchema)).toBe(first);
    expect(snapshot.semantic).toEqual(new Map());
    expect(snapshot.defaultRoute).toBeUndefined();
  });
});
