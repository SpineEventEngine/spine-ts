import { create } from "@bufbuild/protobuf";
import { CommandContextSchema, CommandSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { CommandRouting } from "../../src/index.js";

describe("CommandRouting", () => {
  it("rejects duplicate and malformed exact and semantic registrations", () => {
    const route = () => "target";

    expect(() =>
      CommandRouting.create<string>().route(CommandSchema, route).route(CommandSchema, route),
    ).toThrow(/duplicate exact command route/);
    expect(() => CommandRouting.create<string>().route(CommandSchema, undefined as never)).toThrow(
      /requires a route function/,
    );
    expect(() =>
      CommandRouting.create<string>().routeSemantic("example.Type", route).routeSemantic("example.Type", route),
    ).toThrow(/duplicate semantic command route/);
    expect(() => CommandRouting.create<string>().routeSemantic("   ", route)).toThrow(
      /non-empty Java type/,
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
});
