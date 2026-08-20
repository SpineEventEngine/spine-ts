const dependencyGroups = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export const frameworkPackageNames = [
  "@spine-event-engine/auth",
  "@spine-event-engine/client-node",
  "@spine-event-engine/client-react",
  "@spine-event-engine/client-web",
  "@spine-event-engine/core",
  "@spine-event-engine/delivery-client",
  "@spine-event-engine/delivery-server",
  "@spine-event-engine/deployment",
  "@spine-event-engine/deployment-gce",
  "@spine-event-engine/deployment-gke",
  "@spine-event-engine/proto",
  "@spine-event-engine/proto-tools",
  "@spine-event-engine/server",
  "@spine-event-engine/storage",
  "@spine-event-engine/storage-datastore",
  "@spine-event-engine/storage-rdbms",
  "@spine-event-engine/testing",
  "@spine-event-engine/transport",
];

/** Returns deterministic errors for the public inventory in a checkout root. */
export function validatePublicationInventory(root) {
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const actual = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")),
    )
    .map((entry) => "@spine-event-engine/" + entry.name)
    .sort((left, right) => left.localeCompare(right));
  const expected = [...frameworkPackageNames].sort((left, right) => left.localeCompare(right));
  const problems = [];
  if (rootManifest.version !== "2.0.0-snapshot.2") problems.push("root must use snapshot.2");
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    problems.push("public package paths do not match exact inventory");
  for (const name of expected) {
    const directory = join(root, "packages", name.split("/")[1]);
    if (!existsSync(join(directory, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    problems.push(...publicManifestProblems(manifest));
  }
  return problems.sort((left, right) => left.localeCompare(right));
}

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

export function publicManifestProblems(manifest) {
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";
  const problems = [];
  if (!frameworkPackageNames.includes(name))
    problems.push(name + " is not in the public inventory");
  if (manifest.version !== "2.0.0-snapshot.2") problems.push(name + " must use snapshot.2");
  if (manifest.private === true) problems.push(name + " must not be private");
  if (manifest.license !== "Apache-2.0") problems.push(name + " must use Apache-2.0");
  if (typeof manifest.description !== "string" || !manifest.description.trim())
    problems.push(name + " must have a description");
  const publishConfig = JSON.stringify(manifest.publishConfig);
  if (
    publishConfig !==
    JSON.stringify({ registry: "https://registry.npmjs.org/", access: "public", tag: "snapshot" })
  )
    problems.push(name + " has invalid publishConfig");
  const repository = manifest.repository;
  if (
    repository === null ||
    typeof repository !== "object" ||
    repository.type !== "git" ||
    repository.url !== "https://github.com/SpineEventEngine/spine-ts"
  )
    problems.push(name + " has invalid repository");
  if (repository?.directory !== "packages/" + name.split("/")[1])
    problems.push(name + " has invalid repository directory");
  return problems.sort((left, right) => left.localeCompare(right));
}

export function packedContentProblems(manifest, entries, texts, sourceFiles = []) {
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";
  const files = new Set(entries);
  const problems = [];
  for (const file of files) {
    if (/^(?:src|test|tests|\.tmp)(?:\/|$)/u.test(file))
      problems.push(name + " archive contains prohibited payload: " + file);
    if (
      sourceFiles.length &&
      /\.[^/]+$/u.test(file) &&
      !["package.json", "README.md", "REFERENCE.md", "LICENSE"].includes(file) &&
      !sourceFiles.some(
        (pattern) => file === pattern || file.startsWith(pattern.replace(/\*$/u, "")),
      )
    )
      problems.push(name + " archive contains undeclared payload: " + file);
  }
  for (const value of texts) {
    if (/workspace:|2\.0\.0-snapshot\.1/u.test(value))
      problems.push(name + " archive text has prohibited specifier");
    if (/\/Users\/|\/private\/var\/|\.worktrees\//u.test(value))
      problems.push(name + " archive text has repository path");
  }
  for (const target of manifestTargets(manifest)) {
    const relative = target.replace(/^\.\//u, "");
    if (relative.includes("*")) {
      const prefix = relative.split("*")[0];
      if (![...files].some((file) => file.startsWith(prefix)))
        problems.push(name + " wildcard target has no archive entry: " + target);
    } else if (!files.has(relative)) {
      problems.push(name + " archive is missing target: " + target);
    }
  }
  return [...new Set(problems)].sort((left, right) => left.localeCompare(right));
}

export function internalRuntimeDependencyProblems(manifest) {
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";
  const problems = [];
  for (const group of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependency, version] of Object.entries(manifest[group] || {})) {
      if (frameworkPackageNames.includes(dependency) && version !== "2.0.0-snapshot.2")
        problems.push(name + " " + group + " " + dependency + " must use snapshot.2");
      if (dependency === "@spine-event-engine/validation" && version !== "2.0.0-snapshot.7")
        problems.push(name + " validation must use snapshot.7");
    }
  }
  return problems.sort((left, right) => left.localeCompare(right));
}

function manifestTargets(manifest) {
  const targets = [manifest.main, manifest.module, manifest.types].filter(
    (value) => typeof value === "string",
  );
  if (typeof manifest.bin === "string") targets.push(manifest.bin);
  if (manifest.bin && typeof manifest.bin === "object")
    targets.push(...Object.values(manifest.bin));
  for (const value of Object.values(manifest.exports || {})) {
    if (typeof value === "string") targets.push(value);
    else if (value && typeof value === "object")
      targets.push(...Object.values(value).filter((target) => typeof target === "string"));
  }
  return targets;
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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
