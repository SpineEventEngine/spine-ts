import { basename, isAbsolute } from "node:path";

import { dependencyFirstOrder, frameworkPackageNames } from "./package-artifacts.mjs";
import { classifyReleaseVersion } from "./release-policy.mjs";

/**
 * Creates the saved publication manifest from inspected package archives.
 *
 * @param expected Validated release model that defines package order and version.
 * @param packages Inspected tarball entries, including integrity and dependencies.
 * @param sourceSha Commit that prepared the archives.
 * @returns Versioned manifest with archive basenames in dependency-first order.
 */
export function createReleaseManifest({ expected, packages, sourceSha }) {
  const release = expected;
  const order = expected.packages.map(({ name }) => name);
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  if (byName.size !== packages.length || byName.size !== order.length)
    throw new Error("Packed artifacts do not match the expected inventory");
  return {
    format: 1,
    sourceSha,
    tag: release.tag,
    version: release.version,
    packages: order.map((name) => {
      const entry = byName.get(name);
      if (entry === undefined)
        throw new Error("Dependency order references an unknown package: " + name);
      const expectedEntry = release.packages.find((candidate) => candidate.name === name);
      if (JSON.stringify(entry.dependencies) !== JSON.stringify(expectedEntry.dependencies))
        throw new Error("Packed artifact dependencies do not match source policy");
      if (entry.version !== release.version)
        throw new Error("Packed artifact version does not match source policy: " + name);
      return { ...entry, tarball: basename(entry.tarball), version: release.version };
    }),
  };
}

/**
 * Rejects release manifests that disagree with expected packages or checksums.
 *
 * @param manifest Release manifest read from the publication directory.
 * @param expected Validated release model against which the manifest is compared.
 * @param checksum Function that calculates a tarball's SHA-512 integrity string.
 * @param sourceSha Commit expected in the saved manifest.
 * @returns The validated manifest.
 */
export function validateReleaseManifest(manifest, expected, checksum, sourceSha) {
  if (
    manifest?.format !== 1 ||
    !Array.isArray(manifest.packages) ||
    !/^[a-f0-9]{40}$/u.test(manifest.sourceSha) ||
    manifest.sourceSha !== sourceSha
  )
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
    validateEntry(entry, manifest.version, names, tarballs);
    names.add(entry.name);
    tarballs.add(entry.tarball);
    if (checksum(entry.tarball) !== entry.integrity)
      throw new Error("Release manifest checksum mismatch for " + entry.name);
  }
  if (names.size !== frameworkPackageNames.length)
    throw new Error("Invalid release manifest inventory");
  assertReleaseOrder(manifest.packages, expected.packages);
  return manifest;
}

/**
 * Checks dependency order and source dependency edges in a saved release.
 *
 * @param packages Saved package entries.
 * @param expected Current release package entries.
 */
function assertReleaseOrder(packages, expected) {
  const order = dependencyFirstOrder(
    packages.map(({ name, dependencies }) => ({
      name,
      dependencies: Object.fromEntries(dependencies.map((dependency) => [dependency, true])),
    })),
  );
  if (
    order.some((name, index) => name !== packages[index].name) ||
    expected.some(
      (entry, index) =>
        entry.name !== packages[index].name ||
        JSON.stringify(entry.dependencies) !== JSON.stringify(packages[index].dependencies),
    )
  )
    throw new Error("Release manifest is not dependency ordered");
}

/**
 * Checks one prepared package against the exact release inventory and archive name.
 *
 * @param entry Saved archive entry.
 * @param version Expected common version.
 * @param names Package names already seen.
 * @param tarballs Archive names already seen.
 */
function validateEntry(entry, version, names, tarballs) {
  if (
    typeof entry.name !== "string" ||
    !frameworkPackageNames.includes(entry.name) ||
    names.has(entry.name) ||
    entry.version !== version ||
    typeof entry.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity) ||
    typeof entry.tarball !== "string" ||
    entry.tarball !== `${entry.name.slice(1).replace("/", "-")}-${entry.version}.tgz` ||
    entry.tarball !== basename(entry.tarball) ||
    isAbsolute(entry.tarball) ||
    tarballs.has(entry.tarball) ||
    !Array.isArray(entry.dependencies) ||
    new Set(entry.dependencies).size !== entry.dependencies.length ||
    entry.dependencies.some((name) => !frameworkPackageNames.includes(name))
  )
    throw new Error("Invalid release manifest entry");
}
