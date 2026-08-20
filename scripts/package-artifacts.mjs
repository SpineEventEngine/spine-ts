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
      if (version === "workspace:*") {
        problems.push(`${name} ${group} ${dependency} must not use workspace:*`);
      }
    }
  }

  return problems.sort((left, right) => left.localeCompare(right));
}
