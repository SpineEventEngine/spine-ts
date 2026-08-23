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

function mapping(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} must be a mapping`);
  return value;
}

function version(reference) {
  if (typeof reference === "string") return reference;
  if (reference && typeof reference === "object" && typeof reference.version === "string")
    return reference.version;
  invalid("dependency reference must include a version");
}

function keyFor(name, reference, nodes) {
  const value = version(reference);
  if (value.startsWith("link:")) return undefined;
  const base = value.replace(/\(.+$/u, "");
  if (Object.hasOwn(nodes, `${name}@${base}`)) return `${name}@${base}`;
  if (Object.hasOwn(nodes, base)) return base;
  if (/^@?[^@]+(?:\/[^@]+)?@\d/u.test(value)) {
    return Object.keys(nodes).find((key) => key === base || key.startsWith(`${base}(`));
  }
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
  mapping(parsed, "root");
  for (const section of ["lockfileVersion", "importers", "packages", "snapshots"])
    if (parsed[section] === undefined) invalid(`missing ${section}`);
  mapping(parsed.importers, "importers");
  mapping(parsed.packages, "packages");
  mapping(parsed.snapshots, "snapshots");
  const nodes = { ...parsed.packages, ...parsed.snapshots };
  const queue = [];
  for (const importer of Object.values(parsed.importers)) {
    mapping(importer, "importer");
    for (const group of ["dependencies", "optionalDependencies"])
      for (const dependency of Object.entries(mapping(importer[group] ?? {}, `${group} group`)))
        queue.push(dependency);
  }
  const reached = new Set();
  while (queue.length) {
    const [name, reference] = queue.pop();
    if (version(reference).startsWith("link:")) continue;
    const key = keyFor(name, reference, nodes);
    if (!key) invalid(`unresolved production dependency ${name}@${version(reference)}`);
    if (reached.has(key)) continue;
    reached.add(key);
    const node = nodes[key];
    mapping(node, `package ${key}`);
    for (const group of ["dependencies", "optionalDependencies"])
      for (const dependency of Object.entries(mapping(node[group] ?? {}, `${key} ${group}`)))
        queue.push(dependency);
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
