import { describe, expect, it } from "vitest";

import { createReleaseManifest, validateReleaseManifest } from "./release-artifacts.mjs";
import { frameworkPackageNames } from "./package-artifacts.mjs";

const expected = {
  tag: "snapshot",
  version: "2.0.0-snapshot.4",
  packages: frameworkPackageNames
    .map((name) => ({ name, dependencies: [] }))
    .sort((left, right) => left.name.localeCompare(right.name)),
};
const packages = expected.packages.map(({ name }, index) => ({
  name,
  tarball: "/tmp/release/" + index + ".tgz",
  integrity: "sha512-YQ==",
  dependencies: [],
}));
const manifest = () => createReleaseManifest({ expected, packages });

describe("release artifacts", () => {
  it("writes portable dependency-ordered manifest entries and validates their checksums", () => {
    const manifest = createReleaseManifest({
      expected,
      packages,
    });
    expect(manifest.packages.every(({ tarball }) => !tarball.startsWith("/"))).toBe(true);
    expect(() => validateReleaseManifest(manifest, expected, () => "sha512-YQ==")).not.toThrow();
  });

  it("accepts a stable expected release model", () => {
    const stable = { ...expected, tag: "latest", version: "2.0.0" };
    const value = createReleaseManifest({ expected: stable, packages });
    expect(() => validateReleaseManifest(value, stable, () => "sha512-YQ==")).not.toThrow();
  });

  it.each([
    [
      "wrong tag",
      (value) => {
        value.tag = "latest";
      },
    ],
    [
      "missing package",
      (value) => {
        value.packages.pop();
      },
    ],
    [
      "entry version",
      (value) => {
        value.packages[0].version = "2.0.0";
      },
    ],
    [
      "absolute tarball",
      (value) => {
        value.packages[0].tarball = "/x.tgz";
      },
    ],
    [
      "nested tarball",
      (value) => {
        value.packages[0].tarball = "dir/x.tgz";
      },
    ],
    [
      "invalid integrity",
      (value) => {
        value.packages[0].integrity = "sha1-x";
      },
    ],
    [
      "unknown dependency",
      (value) => {
        value.packages[0].dependencies = ["unknown"];
      },
    ],
    [
      "removed dependency contract",
      (value) => {
        value.packages[0].dependencies = [expected.packages[1].name];
      },
    ],
    [
      "wrong order",
      (value) => {
        value.packages.reverse();
      },
    ],
    ["checksum", () => {}],
  ])("rejects %s tampering", (_name, mutate) => {
    const value = structuredClone(manifest());
    mutate(value);
    expect(() => validateReleaseManifest(value, expected, () => "sha512-other")).toThrow();
  });
});
