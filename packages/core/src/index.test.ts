import { describe, expect, it } from "vitest";

import { packageSkeleton } from "./index.js";

describe("@spine-ts/core", () => {
  it("exports skeleton metadata", () => {
    expect(packageSkeleton).toEqual({
      implementationStatus: "skeleton",
      packageName: "@spine-ts/core",
    });
  });
});
