import { describe, expect, expectTypeOf, it } from "vitest";

import * as clientRoot from "../src/index.js";

type ClientRoot = typeof import("../src/index.js");

describe("@spine-ts/client", () => {
  it("exports only the Projection column foundation in this packet", () => {
    expect(clientRoot.ProjectionColumn).toBeTypeOf("function");
    expect("AggregateColumn" in clientRoot).toBe(false);
    expect("ProcessManagerColumn" in clientRoot).toBe(false);
    expectTypeOf<
      "AggregateColumn" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "ProcessManagerColumn" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
  });
});
