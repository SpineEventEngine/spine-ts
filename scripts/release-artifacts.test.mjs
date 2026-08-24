import { describe, expect, it } from "vitest";

import { createReleaseManifest, validateReleaseManifest } from "./release-artifacts.mjs";

describe("release artifacts", () => {
  it("writes portable dependency-ordered manifest entries and validates their checksums", () => {
    const manifest = createReleaseManifest({
      release: { tag: "snapshot", version: "2.0.0-snapshot.4" },
      packages: [
        { name: "@spine-event-engine/server", tarball: "/tmp/release/server.tgz", integrity: "sha512-server", dependencies: ["@spine-event-engine/core"] },
        { name: "@spine-event-engine/core", tarball: "/tmp/release/core.tgz", integrity: "sha512-core", dependencies: [] },
      ],
      order: ["@spine-event-engine/core", "@spine-event-engine/server"],
      destination: "/tmp/release",
    });
    expect(manifest.packages.map(({ tarball }) => tarball)).toEqual(["core.tgz", "server.tgz"]);
    expect(() => validateReleaseManifest(manifest, (file) => file === "core.tgz" ? "sha512-core" : "sha512-server")).not.toThrow();
  });
});
