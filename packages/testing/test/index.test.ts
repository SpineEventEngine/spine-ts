import { describe, expect, it } from "vitest";

import { packageSkeleton } from "../src/index.js";

describe("@spine-ts/testing", () => {
  it("exports skeleton metadata", () => {
    expect(packageSkeleton).toEqual({
      implementationStatus: "skeleton",
      packageName: "@spine-ts/testing",
    });
  });
});
