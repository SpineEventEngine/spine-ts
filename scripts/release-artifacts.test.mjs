import { describe, expect, it } from "vitest";

import { createReleaseManifest, validateReleaseManifest } from "./release-artifacts.mjs";
import { frameworkPackageNames } from "./package-artifacts.mjs";
import { expectedReleaseModel, readReleaseManifests } from "./release-policy.mjs";

const expected = {
  tag: "snapshot",
  version: "2.0.0-snapshot.4",
  packages: frameworkPackageNames
    .map((name) => ({ name, dependencies: [] }))
    .sort((left, right) => left.name.localeCompare(right.name)),
};
const sourceSha = "a".repeat(40);
const packages = expected.packages.map(({ name }) => ({
  name,
  version: expected.version,
  tarball: "/tmp/release/" + name.slice(1).replace("/", "-") + "-" + expected.version + ".tgz",
  integrity: "sha512-YQ==",
  dependencies: [],
}));
const manifest = () => createReleaseManifest({ expected, packages, sourceSha });

describe("release artifacts", () => {
  it("validates the actual workspace dependency graph after manifest creation", () => {
    const workspace = expectedReleaseModel(
      readReleaseManifests(new URL("..", import.meta.url).pathname),
    );
    const inspected = workspace.packages.map(({ name, dependencies }) => ({
      name,
      version: workspace.version,
      tarball: `/tmp/release/${name.slice(1).replace("/", "-")}-${workspace.version}.tgz`,
      integrity: "sha512-YQ==",
      dependencies,
    }));
    expect(inspected.some(({ dependencies }) => dependencies.length > 0)).toBe(true);
    const value = createReleaseManifest({ expected: workspace, packages: inspected, sourceSha });
    expect(() =>
      validateReleaseManifest(value, workspace, () => "sha512-YQ==", sourceSha),
    ).not.toThrow();
  });

  it("writes portable dependency-ordered manifest entries and validates their checksums", () => {
    const manifest = createReleaseManifest({
      expected,
      packages,
      sourceSha,
    });
    expect(manifest.packages.every(({ tarball }) => !tarball.startsWith("/"))).toBe(true);
    expect(() =>
      validateReleaseManifest(manifest, expected, () => "sha512-YQ==", sourceSha),
    ).not.toThrow();
  });

  it("accepts a stable expected release model", () => {
    const stable = { ...expected, tag: "latest", version: "2.0.0" };
    const value = createReleaseManifest({
      expected: stable,
      packages: packages.map((entry) => ({
        ...entry,
        version: stable.version,
        tarball: entry.tarball.replace(expected.version, stable.version),
      })),
      sourceSha,
    });
    expect(() =>
      validateReleaseManifest(value, stable, () => "sha512-YQ==", sourceSha),
    ).not.toThrow();
  });

  it.each([
    [
      "wrong tag",
      (value) => {
        value.tag = "latest";
      },
      "Invalid release manifest inventory",
    ],
    [
      "missing package",
      (value) => {
        value.packages.pop();
      },
      "Invalid release manifest inventory",
    ],
    [
      "entry version",
      (value) => {
        value.packages[0].version = "2.0.0";
      },
      "Invalid release manifest entry",
    ],
    [
      "absolute tarball",
      (value) => {
        value.packages[0].tarball = "/x.tgz";
      },
      "Invalid release manifest entry",
    ],
    [
      "nested tarball",
      (value) => {
        value.packages[0].tarball = "dir/x.tgz";
      },
      "Invalid release manifest entry",
    ],
    [
      "invalid integrity",
      (value) => {
        value.packages[0].integrity = "sha1-x";
      },
      "Invalid release manifest entry",
    ],
    [
      "unknown dependency",
      (value) => {
        value.packages[0].dependencies = ["unknown"];
      },
      "Invalid release manifest entry",
    ],
    [
      "removed dependency contract",
      (value) => {
        value.packages[0].dependencies = [expected.packages[1].name];
      },
      "Release manifest is not dependency ordered",
    ],
    [
      "wrong order",
      (value) => {
        value.packages.reverse();
      },
      "Release manifest is not dependency ordered",
    ],
  ])("rejects %s tampering", (_name, mutate, message) => {
    const value = JSON.parse(JSON.stringify(manifest()));
    mutate(value);
    expect(() => validateReleaseManifest(value, expected, () => "sha512-YQ==", sourceSha)).toThrow(
      message,
    );
  });

  it("rejects a wrong checksum independently", () => {
    expect(() =>
      validateReleaseManifest(manifest(), expected, () => "sha512-other", sourceSha),
    ).toThrow("checksum mismatch");
  });

  it("rejects an inspected archive version before creating the release manifest", () => {
    const changed = packages.map((entry) => ({ ...entry }));
    changed[0].version = "2.0.0-snapshot.3";
    expect(() => createReleaseManifest({ expected, packages: changed, sourceSha })).toThrow(
      "Packed artifact version",
    );
  });
});
