import { basename, isAbsolute } from "node:path";

import { dependencyFirstOrder, frameworkPackageNames } from "./package-artifacts.mjs";
import { classifyReleaseVersion } from "./release-policy.mjs";

export function createReleaseManifest({ expected, packages }) {
  const release = expected;
  const order = expected.packages.map(({ name }) => name);
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  if (byName.size !== packages.length || byName.size !== order.length)
    throw new Error("Packed artifacts do not match the expected inventory");
  return {
    format: 1,
    tag: release.tag,
    version: release.version,
    packages: order.map((name) => {
      const entry = byName.get(name);
      if (entry === undefined)
        throw new Error("Dependency order references an unknown package: " + name);
      const expectedEntry = release.packages.find((candidate) => candidate.name === name);
      if (JSON.stringify(entry.dependencies) !== JSON.stringify(expectedEntry.dependencies))
        throw new Error("Packed artifact dependencies do not match source policy");
      return { ...entry, tarball: basename(entry.tarball), version: release.version };
    }),
  };
}

export function validateReleaseManifest(manifest, expected, checksum) {
  if (manifest?.format !== 1 || !Array.isArray(manifest.packages))
    throw new Error("Invalid release manifest");
  const release = classifyReleaseVersion(manifest.version);
  if (
    release.tag !== manifest.tag ||
    release.tag !== expected.tag ||
    manifest.version !== expected.version ||
    manifest.packages.length !== frameworkPackageNames.length
  )
    throw new Error("Invalid release manifest inventory");
  const names = new Set();
  const tarballs = new Set();
  for (const entry of manifest.packages) {
    if (
      typeof entry.name !== "string" ||
      !frameworkPackageNames.includes(entry.name) ||
      names.has(entry.name) ||
      entry.version !== manifest.version ||
      typeof entry.integrity !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity) ||
      typeof entry.tarball !== "string" ||
      entry.tarball !== basename(entry.tarball) ||
      isAbsolute(entry.tarball) ||
      tarballs.has(entry.tarball) ||
      !Array.isArray(entry.dependencies) ||
      new Set(entry.dependencies).size !== entry.dependencies.length ||
      entry.dependencies.some((name) => !frameworkPackageNames.includes(name))
    )
      throw new Error("Invalid release manifest entry");
    names.add(entry.name);
    tarballs.add(entry.tarball);
    if (checksum(entry.tarball) !== entry.integrity)
      throw new Error("Release manifest checksum mismatch for " + entry.name);
  }
  if (names.size !== frameworkPackageNames.length)
    throw new Error("Invalid release manifest inventory");
  const order = dependencyFirstOrder(manifest.packages);
  if (
    order.some((name, index) => name !== manifest.packages[index].name) ||
    expected.packages.some(
      (entry, index) =>
        entry.name !== manifest.packages[index].name ||
        JSON.stringify(entry.dependencies) !==
          JSON.stringify(manifest.packages[index].dependencies),
    )
  )
    throw new Error("Release manifest is not dependency ordered");
  return manifest;
}
