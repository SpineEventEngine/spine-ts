import { readFileSync } from "node:fs";
import { join } from "node:path";

import { dependencyFirstOrder, frameworkPackageNames } from "./package-artifacts.mjs";

/**
 * Lists manifests that must agree before a framework release is published.
 */
export const releaseManifestPaths = [
  "package.json",
  "packages/auth/package.json",
  "packages/client-node/package.json",
  "packages/client-react/package.json",
  "packages/client-web/package.json",
  "packages/core/package.json",
  "packages/delivery-client/package.json",
  "packages/delivery-server/package.json",
  "packages/deployment/package.json",
  "packages/deployment-gce/package.json",
  "packages/deployment-gke/package.json",
  "packages/proto/package.json",
  "packages/proto-tools/package.json",
  "packages/server/package.json",
  "packages/storage/package.json",
  "packages/storage-datastore/package.json",
  "packages/storage-postgres/package.json",
  "packages/storage-rdbms/package.json",
  "packages/testing/package.json",
  "packages/transport/package.json",
  "examples/distributed-message-board/package.json",
  "examples/message-board/app/package.json",
  "examples/message-board/model/package.json",
  "examples/message-board/web/package.json",
  "examples/orders/package.json",
  "examples/projects/package.json",
  "examples/todo/package.json",
];

/**
 * Selects publishable package manifests from the complete release inventory.
 */
export const publicPackagePaths = releaseManifestPaths.filter((path) =>
  path.startsWith("packages/"),
);

/**
 * Maps a supported semantic version to the npm tag used for publication.
 *
 * @param version Candidate root release version.
 * @returns The version paired with either the `latest` or `snapshot` tag.
 */
export function classifyReleaseVersion(version) {
  if (/^\d+\.\d+\.\d+-snapshot\.\d+$/u.test(version)) return { tag: "snapshot", version };
  if (/^\d+\.\d+\.\d+$/u.test(version)) return { tag: "latest", version };
  throw new Error("Unsupported release version: " + version);
}

/**
 * Reads every manifest that participates in release-policy validation.
 *
 * @param root Repository root from which release manifests are read.
 * @returns Manifest entries in the fixed release-policy inventory order.
 */
export function readReleaseManifests(root) {
  return releaseManifestPaths.map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(join(root, path), "utf8")),
  }));
}

/**
 * Validates that release manifests share the required package policy.
 *
 * @param entries Manifest entries expected to match the fixed release inventory.
 * @returns The validated release version and npm tag.
 */
export function validateReleasePolicy(entries) {
  if (entries.length !== releaseManifestPaths.length)
    throw new Error("Release manifests do not match the exact 27-path inventory");
  for (const [index, entry] of entries.entries())
    if (entry.path !== releaseManifestPaths[index])
      throw new Error("Release manifests do not match the exact 27-path inventory");
  const root = entries[0].manifest;
  const release = classifyReleaseVersion(root.version);
  const publicEntries = entries.filter(({ path }) => path.startsWith("packages/"));
  const publicNames = publicEntries.map(({ manifest }) => manifest.name).sort();
  const expectedPublicNames = [...frameworkPackageNames].sort();
  if (JSON.stringify(publicNames) !== JSON.stringify(expectedPublicNames))
    throw new Error("Release packages do not match the exact public-name inventory");
  for (const { path, manifest } of entries) {
    if (manifest.version !== release.version) throw new Error(path + " must use the root version");
    const isPublic = path.startsWith("packages/");
    if (isPublic !== frameworkPackageNames.includes(manifest.name))
      throw new Error(path + " has an invalid public/private boundary");
    if (isPublic && manifest.private === true)
      throw new Error(manifest.name + " must not be private");
    if (!isPublic && manifest.private !== true) throw new Error(path + " must be private");
    if (!isPublic) continue;
    if (
      manifest.publishConfig?.registry !== "https://registry.npmjs.org/" ||
      manifest.publishConfig?.access !== "public"
    )
      throw new Error(manifest.name + " has invalid publishConfig");
    if ("tag" in manifest.publishConfig)
      throw new Error(manifest.name + " must not define publishConfig.tag");
    for (const group of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "devDependencies",
    ])
      for (const [name, version] of Object.entries(manifest[group] ?? {}))
        if (
          frameworkPackageNames.includes(name) &&
          version !== "workspace:*" &&
          version !== release.version
        )
          throw new Error(
            manifest.name + " " + group + " " + name + " must use " + release.version,
          );
  }
  return release;
}

/**
 * Builds a public package order in which internal runtime dependencies precede consumers.
 *
 * @param entries Release manifest entries containing public package dependencies.
 * @returns Public package names in deterministic dependency-first order.
 */
export function releaseDependencyOrder(entries) {
  return dependencyFirstOrder(
    entries.filter(({ path }) => path.startsWith("packages/")).map(({ manifest }) => manifest),
  );
}

/**
 * Builds the dependency-ordered package model used by release preparation and publication.
 *
 * @param entries Manifest entries to validate and project into release packages.
 * @returns Release tag, version, and dependency-ordered public package entries.
 */
export function expectedReleaseModel(entries) {
  const release = validateReleasePolicy(entries);
  const packages = entries
    .filter(({ path }) => path.startsWith("packages/"))
    .map(({ manifest }) => ({
      name: manifest.name,
      dependencies: ["dependencies", "optionalDependencies", "peerDependencies"]
        .flatMap((group) => Object.keys(manifest[group] ?? {}))
        .filter((name) => frameworkPackageNames.includes(name))
        .sort((left, right) => left.localeCompare(right)),
    }));
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  return { ...release, packages: releaseDependencyOrder(entries).map((name) => byName.get(name)) };
}
