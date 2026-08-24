import { describe, expect, it } from "vitest";

import { createReleaseManifest, validateReleaseManifest } from "./release-artifacts.mjs";
import { frameworkPackageNames } from "./package-artifacts.mjs";

describe("release artifacts", () => {
  it("writes portable dependency-ordered manifest entries and validates their checksums", () => {
    const manifest = createReleaseManifest({
      release: { tag: "snapshot", version: "2.0.0-snapshot.4" },
      packages: frameworkPackageNames.map((name, index) => ({ name, tarball: "/tmp/release/" + index + ".tgz", integrity: "sha512-YQ==", dependencies: [] })),
      order: [...frameworkPackageNames].sort((left, right) => left.localeCompare(right)),
    });
    expect(manifest.packages.every(({ tarball }) => !tarball.startsWith("/"))).toBe(true);
    expect(() => validateReleaseManifest(manifest, () => "sha512-YQ==")).not.toThrow();
  });
});
