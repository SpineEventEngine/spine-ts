import { describe, expect, it } from "vitest";

import {
  dependencyFirstOrder,
  packedArchiveProblems,
  packedReadmeLinkProblems,
  packedManifestProblems,
} from "./package-artifacts.mjs";

describe("package artifacts", () => {
  it("rejects a packed manifest with a workspace dependency", () => {
    expect(
      packedManifestProblems({
        name: "@spine-event-engine/example",
        version: "2.0.0-snapshot.3",
        dependencies: { "@spine-event-engine/core": "workspace:*" },
      }),
    ).toEqual([
      "@spine-event-engine/example dependencies @spine-event-engine/core must not use workspace:*",
    ]);
  });

  it("requires package metadata and reader files in every archive", () => {
    expect(
      packedArchiveProblems({ name: "@spine-event-engine/example" }, [
        "package/package.json",
        "package/README.md",
      ]),
    ).toEqual([
      "@spine-event-engine/example archive is missing LICENSE",
      "@spine-event-engine/example archive is missing REFERENCE.md",
    ]);
  });

  it("rejects packed README links that leave the package artifact", () => {
    expect(
      packedReadmeLinkProblems(
        { name: "@spine-event-engine/example" },
        ["README.md", "REFERENCE.md", "assets/diagram.svg"],
        [
          "[repository guide](../docs/guide.md)",
          "[missing](guides/first-steps.md)",
          "[reference](./REFERENCE.md?view=full#configuration)",
          "[diagram](assets/diagram.svg#overview)",
          "[website](https://spine.io/docs)",
          "[section](#installation)",
        ].join("\n"),
      ),
    ).toEqual([
      "@spine-event-engine/example README link escapes package artifact: ../docs/guide.md",
      "@spine-event-engine/example README link is missing from package artifact: guides/first-steps.md",
    ]);
  });

  it("rejects file and link dependency references in packed manifests", () => {
    expect(
      packedManifestProblems({
        name: "@spine-event-engine/example",
        dependencies: {
          local: "file:../local",
          linked: "link:../linked",
        },
      }),
    ).toEqual([
      "@spine-event-engine/example dependencies linked must not use link:../linked",
      "@spine-event-engine/example dependencies local must not use file:../local",
    ]);
  });

  it("orders internal runtime dependencies before dependents", () => {
    expect(
      dependencyFirstOrder([
        {
          name: "@spine-event-engine/server",
          dependencies: { "@spine-event-engine/core": "2.0.0-snapshot.3" },
        },
        {
          name: "@spine-event-engine/core",
          dependencies: { "@spine-event-engine/proto": "2.0.0-snapshot.3" },
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
