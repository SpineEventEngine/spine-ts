import { parse } from "yaml";

const vulnerable = new Map([
  ["brace-expansion", new Set(["2.1.3"])],
  ["uuid", new Set(["9.0.1"])],
  ["js-yaml", new Set(["4.3.0"])],
  ["nanoid", new Set(["3.3.15"])],
  ["postcss", new Set(["8.5.15"])],
]);

function invalid(message) {
  throw new Error(`Invalid pnpm lockfile: ${message}`);
}

function version(reference) {
  if (typeof reference === "string") return reference;
  if (reference && typeof reference === "object" && typeof reference.version === "string")
    return reference.version;
  invalid("dependency reference must include a version");
}

function keyFor(name, reference, nodes) {
  const value = version(reference);
  return Object.keys(nodes).find(
    (key) => key === `${name}@${value}` || key.startsWith(`${name}@${value}(`),
  );
}

/**
 * Parses a pnpm lockfile and returns production-reachable vulnerable resolutions.
 *
 * @param {string} lockfile pnpm lockfile source.
 * @returns {string[]} Deterministic production-policy violations.
 */
export function productionDependencyProblemsFromYaml(lockfile) {
  const parsed = parse(lockfile);
  if (!parsed || typeof parsed !== "object") invalid("root must be a mapping");
  for (const section of ["lockfileVersion", "importers", "packages", "snapshots"])
    if (parsed[section] === undefined) invalid(`missing ${section}`);
  if (
    typeof parsed.importers !== "object" ||
    typeof parsed.packages !== "object" ||
    typeof parsed.snapshots !== "object"
  )
    invalid("importers, packages, and snapshots must be mappings");
  const nodes = { ...parsed.packages, ...parsed.snapshots };
  const queue = [];
  for (const importer of Object.values(parsed.importers)) {
    if (!importer || typeof importer !== "object") invalid("importer must be a mapping");
    for (const group of ["dependencies", "optionalDependencies"])
      for (const dependency of Object.entries(importer[group] ?? {})) queue.push(dependency);
  }
  const reached = new Set();
  while (queue.length) {
    const [name, reference] = queue.pop();
    const key = keyFor(name, reference, nodes);
    if (!key || reached.has(key)) continue;
    reached.add(key);
    const node = nodes[key];
    if (!node || typeof node !== "object") invalid(`invalid package ${key}`);
    for (const group of ["dependencies", "optionalDependencies"])
      for (const dependency of Object.entries(node[group] ?? {})) queue.push(dependency);
  }
  return [...reached]
    .flatMap((key) => {
      const match = /^(@?[^@]+(?:\/[^@]+)?)@(\d+\.\d+\.\d+)/u.exec(key);
      return match && vulnerable.get(match[1])?.has(match[2])
        ? [`Production lockfile resolves vulnerable ${match[1]}@${match[2]}.`]
        : [];
    })
    .sort();
}
