const dependencyGroups = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * Reports package manifest values that cannot be present in a packed npm artifact.
 *
 * @param {Record<string, unknown>} manifest packed package manifest
 * @returns {string[]} sorted policy violations
 */
export function packedManifestProblems(manifest) {
  const problems = [];
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";

  for (const group of dependencyGroups) {
    const dependencies = manifest[group];
    if (dependencies === null || typeof dependencies !== "object") continue;

    for (const [dependency, version] of Object.entries(dependencies)) {
      if (typeof version === "string" && /^(?:workspace:|file:|link:)/u.test(version)) {
        problems.push(`${name} ${group} ${dependency} must not use ${version}`);
      }
      if (version === "2.0.0-snapshot.1") {
        problems.push(`${name} ${group} ${dependency} must not use snapshot.1`);
      }
    }
  }

  return problems.sort((left, right) => left.localeCompare(right));
}

/**
 * Produces a deterministic internal-runtime dependency-first package order.
 *
 * @param {readonly Record<string, unknown>[]} manifests package manifests
 * @returns {string[]} package names
 */
export function dependencyFirstOrder(manifests) {
  const byName = new Map(
    manifests
      .filter((manifest) => typeof manifest.name === "string")
      .map((manifest) => [manifest.name, manifest]),
  );
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  const visit = (name) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`Internal package dependency cycle: ${name}`);
    visiting.add(name);
    const manifest = byName.get(name);
    for (const group of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = manifest?.[group];
      if (dependencies === null || typeof dependencies !== "object") continue;
      for (const dependency of Object.keys(dependencies).sort((left, right) =>
        left.localeCompare(right),
      )) {
        if (byName.has(dependency)) visit(dependency);
      }
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };

  for (const name of [...byName.keys()].sort((left, right) => left.localeCompare(right)))
    visit(name);
  return ordered;
}

/**
 * Reports required package files missing from a packed tar archive entry list.
 *
 * @param {Record<string, unknown>} manifest packed package manifest
 * @param {readonly string[]} entries tar entry paths
 * @returns {string[]} sorted policy violations
 */
export function packedArchiveProblems(manifest, entries) {
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";
  const files = new Set(entries.map((entry) => entry.replace(/^package\//u, "")));
  const problems = [];

  for (const required of ["package.json", "README.md", "REFERENCE.md", "LICENSE"]) {
    if (!files.has(required)) problems.push(`${name} archive is missing ${required}`);
  }

  return problems.sort((left, right) => left.localeCompare(right));
}
