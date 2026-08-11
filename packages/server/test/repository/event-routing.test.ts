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
