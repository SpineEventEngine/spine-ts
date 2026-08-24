import { basename, isAbsolute } from "node:path";

export function createReleaseManifest({ release, packages, order, destination }) {
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  return {
    format: 1,
    tag: release.tag,
    version: release.version,
    packages: order.map((name) => {
      const entry = byName.get(name);
      if (entry === undefined) throw new Error("Dependency order references an unknown package: " + name);
      return { ...entry, tarball: basename(entry.tarball), version: release.version };
    }),
  };
}

export function validateReleaseManifest(manifest, checksum) {
  if (manifest?.format !== 1 || !Array.isArray(manifest.packages)) throw new Error("Invalid release manifest");
  for (const entry of manifest.packages) {
    if (typeof entry.name !== "string" || typeof entry.version !== "string" || typeof entry.integrity !== "string" || typeof entry.tarball !== "string" || isAbsolute(entry.tarball) || entry.tarball.includes(".."))
      throw new Error("Invalid release manifest entry");
    if (checksum(entry.tarball) !== entry.integrity) throw new Error("Release manifest checksum mismatch for " + entry.name);
  }
  return manifest;
}
