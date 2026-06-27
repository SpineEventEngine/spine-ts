import { describe, expect, it } from "vitest";

import { exampleSkeleton } from "./index.js";

describe("@spine-ts/example-todo", () => {
  it("exports skeleton metadata", () => {
    expect(exampleSkeleton).toEqual({
      implementationStatus: "skeleton",
      packageName: "@spine-ts/example-todo",
    });
  });
});
