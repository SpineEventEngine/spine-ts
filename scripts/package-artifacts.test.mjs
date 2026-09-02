import { describe, expect, it } from "vitest";

import {
  dependencyFirstOrder,
  packedArchiveProblems,
  packedContentProblems,
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

  it("validates rendered README destinations without parsing code or malformed Markdown", () => {
    expect(
      packedReadmeLinkProblems(
        { name: "@spine-event-engine/example" },
        [
          "README.md",
          "REFERENCE.md",
          "assets/diagram.svg",
          "guides/with (parentheses).md",
          "guides/with space.md",
          "images/diagram.svg",
        ],
        [
          "```md",
          "[fenced escape](../not-rendered.md)",
          "```",
          "`[inline escape](../not-rendered.md)`",
          "[unfinished](../not-rendered.md",
          "[reference](nested/../REFERENCE.md?view=full#configuration)",
          '[titled reference](REFERENCE.md "full reference")',
          "[parenthesized title](REFERENCE.md (full reference))",
          "![image](images/diagram.svg?size=2#top)",
          "[parentheses](guides/with (parentheses).md)",
          "[escaped space](guides/with\\ space.md)",
          "\\[escaped link](../not-rendered.md)",
          "    [indented code](../not-rendered.md)",
          "[external](https://spine.io/docs)",
          "[protocol relative](//spine.io/docs)",
          "[mail](mailto:hello@spine.io)",
          "[data](data:text/plain,ok)",
          "[file escape](file:../outside.md)",
          "[upper file escape](FILE:../outside.md)",
          "[file absolute](file:///outside.md)",
          "[windows drive](C:\\outside\\README.md)",
          "[windows traversal](..\\outside\\README.md)",
          "[root path](/outside.md)",
          "[encoded traversal](%2e%2e/outside.md)",
          "[reference definition]: assets/diagram.svg?raw=1#preview",
        ].join("\n"),
      ),
    ).toEqual([
      "@spine-event-engine/example README link escapes package artifact: ..\\outside\\README.md",
      "@spine-event-engine/example README link escapes package artifact: /outside.md",
      "@spine-event-engine/example README link escapes package artifact: %2e%2e/outside.md",
      "@spine-event-engine/example README link escapes package artifact: C:\\outside\\README.md",
      "@spine-event-engine/example README link escapes package artifact: file:../outside.md",
      "@spine-event-engine/example README link escapes package artifact: FILE:../outside.md",
      "@spine-event-engine/example README link escapes package artifact: file:///outside.md",
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

  it("rejects stale snapshot.2 references from packed manifests and archive text", () => {
    const manifest = {
      name: "@spine-event-engine/example",
      dependencies: { "@spine-event-engine/core": "2.0.0-snapshot.2" },
    };

    expect(packedManifestProblems(manifest)).toEqual([
      "@spine-event-engine/example dependencies @spine-event-engine/core must not use snapshot.2",
    ]);
    expect(
      packedContentProblems(
        manifest,
        ["package.json", "dist/index.js"],
        ['export { core } from "@spine-event-engine/core@2.0.0-snapshot.2";\n'],
      ),
    ).toEqual(["@spine-event-engine/example archive text has prohibited specifier"]);
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
