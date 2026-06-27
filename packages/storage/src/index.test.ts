import { describe, expect, it } from "vitest";

import { packageSkeleton } from "./index.js";

describe("@spine-ts/storage", () => {
  it("exports skeleton metadata", () => {
    expect(packageSkeleton).toEqual({
      implementationStatus: "skeleton",
      packageName: "@spine-ts/storage",
    });
  });
});
