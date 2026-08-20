import { describe, expect, it } from "vitest";

import { packedManifestProblems } from "./package-artifacts.mjs";

describe("package artifacts", () => {
  it("rejects a packed manifest with a workspace dependency", () => {
    expect(
      packedManifestProblems({
        name: "@spine-event-engine/example",
        version: "2.0.0-snapshot.2",
        dependencies: { "@spine-event-engine/core": "workspace:*" },
      }),
    ).toEqual([
      "@spine-event-engine/example dependencies @spine-event-engine/core must not use workspace:*",
    ]);
  });
});
