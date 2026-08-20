import { describe, expect, it } from "vitest";

import { dependencyFirstOrder, packedManifestProblems } from "./package-artifacts.mjs";

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

  it("orders internal runtime dependencies before dependents", () => {
    expect(
      dependencyFirstOrder([
        {
          name: "@spine-event-engine/server",
          dependencies: { "@spine-event-engine/core": "2.0.0-snapshot.2" },
        },
        {
          name: "@spine-event-engine/core",
          dependencies: { "@spine-event-engine/proto": "2.0.0-snapshot.2" },
        },
        { name: "@spine-event-engine/proto" },
      ]),
    ).toEqual([
      "@spine-event-engine/proto",
      "@spine-event-engine/core",
      "@spine-event-engine/server",
    ]);
  });
});
