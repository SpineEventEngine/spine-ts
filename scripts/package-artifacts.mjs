import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

const dependencyGroups = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * Lists the exact public npm package names released by this repository.
 */
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
  "@spine-event-engine/storage-postgres",
  "@spine-event-engine/storage-mysql",
  "@spine-event-engine/testing",
  "@spine-event-engine/transport",
];

/**
 * Checks the checkout's public and private package inventory and public manifest metadata.
 *
 * @param root Repository root containing the package manifests to inspect.
 * @returns Sorted policy violations; an empty array means the inventory is valid.
 */
export function validatePublicationInventory(root) {
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packageManifests = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")),
    )
    .map((entry) => ({
      name: "@spine-event-engine/" + entry.name,
      manifest: JSON.parse(
        readFileSync(join(root, "packages", entry.name, "package.json"), "utf8"),
      ),
    }));
  const actual = packageManifests
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right));
  const expected = [...frameworkPackageNames].sort((left, right) => left.localeCompare(right));
  const problems = [];
  if (!/^\d+\.\d+\.\d+(?:-snapshot\.\d+)?$/u.test(rootManifest.version))
    problems.push("root must use a supported release version");
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    problems.push("public package paths do not match exact inventory");
  const privatePackages = packageManifests
    .filter(({ manifest }) => manifest.private === true)
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(privatePackages) !==
    JSON.stringify(["@spine-event-engine/server-blackbox-tests"])
  )
    problems.push("private package paths do not match exact inventory");
  for (const name of expected) {
    const directory = join(root, "packages", name.split("/")[1]);
    if (!existsSync(join(directory, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    problems.push(...publicManifestProblems(manifest));
  }
  return problems.sort((left, right) => left.localeCompare(right));
}

/**
 * Finds local and obsolete dependency specifiers that would make a packed artifact unreleasable.
 *
 * @param manifest Package manifest whose dependency groups are inspected.
 * @returns Sorted dependency-specifier violations.
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
      if (/^2\.0\.0-snapshot\.[12]$/u.test(version)) {
        problems.push(`${name} ${group} ${dependency} must not use snapshot.${version.at(-1)}`);
      }
    }
  }

  return problems.sort((left, right) => left.localeCompare(right));
}

/**
 * Validates public package identity, version, licensing, publication, and repository metadata.
 *
 * @param manifest Public package manifest to validate.
 * @returns Sorted public-manifest policy violations.
 */
export function publicManifestProblems(manifest) {
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";
  const problems = [];
  if (!frameworkPackageNames.includes(name))
    problems.push(name + " is not in the public inventory");
  if (!/^\d+\.\d+\.\d+(?:-snapshot\.\d+)?$/u.test(manifest.version))
    problems.push(name + " must use a supported release version");
  if (manifest.private === true) problems.push(name + " must not be private");
  if (manifest.license !== "Apache-2.0") problems.push(name + " must use Apache-2.0");
  if (typeof manifest.description !== "string" || !manifest.description.trim())
    problems.push(name + " must have a description");
  const publishConfig = JSON.stringify(manifest.publishConfig);
  if (
    publishConfig !==
    JSON.stringify({
      registry: "https://registry.npmjs.org/",
      access: "public",
    })
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

/**
 * Finds disallowed, undeclared, or missing content and metadata targets in a packed package.
 *
 * @param manifest Manifest extracted from the package archive.
 * @param entries Relative paths included in the archive.
 * @param texts Text payloads extracted from relevant archive entries.
 * @param sourceFiles Source manifest file patterns permitted in the archive.
 * @returns Unique sorted archive-content policy violations.
 */
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
    if (/workspace:|2\.0\.0-snapshot\.(?:1|2)(?!\d)/u.test(value))
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

/**
 * Checks that internal runtime dependencies use the package's release version.
 *
 * @param manifest Package manifest whose runtime dependency groups are checked.
 * @returns Sorted internal dependency-version violations.
 */
export function internalRuntimeDependencyProblems(manifest) {
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";
  const problems = [];
  for (const group of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [dependency, version] of Object.entries(manifest[group] || {})) {
      if (frameworkPackageNames.includes(dependency) && version !== manifest.version)
        problems.push(name + " " + group + " " + dependency + " must use " + manifest.version);
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
 * Builds a deterministic dependency-first order for the supplied internal package manifests.
 *
 * @param manifests Package manifests participating in the dependency graph.
 * @returns Package names with each internal dependency before its consumers.
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
 * Finds required publication files absent from a packed tarball.
 *
 * @param manifest Package manifest used to identify violations.
 * @param entries Tar entry paths, including their package directory prefix.
 * @returns Sorted missing-file violations.
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

/**
 * Finds README links that escape or reference files absent from the packed artifact.
 *
 * @param manifest Package manifest used to identify violations.
 * @param entries Tar entry paths, including their package directory prefix.
 * @param readme README text extracted from the packed artifact.
 * @returns Unique sorted README-link violations.
 */
export function packedReadmeLinkProblems(manifest, entries, readme) {
  const name = typeof manifest.name === "string" ? manifest.name : "<unnamed package>";
  const files = new Set(entries.map((entry) => entry.replace(/^package\//u, "")));
  const problems = [];

  for (const target of markdownLinkTargets(readme)) {
    const path = localLinkPath(target);
    if (path === undefined) continue;
    const decodedPath = decodeLinkPath(path.split(/[?#]/u, 1)[0])
      .replace(/\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~ -])/gu, "$1")
      .replaceAll("\\", "/");
    const normalized = posix.normalize(decodedPath);
    if (
      decodedPath.startsWith("/") ||
      /^[a-z]:\//iu.test(decodedPath) ||
      normalized === ".." ||
      normalized.startsWith("../")
    ) {
      problems.push(`${name} README link escapes package artifact: ${target}`);
    } else if (!files.has(normalized)) {
      problems.push(`${name} README link is missing from package artifact: ${target}`);
    }
  }

  return [...new Set(problems)].sort((left, right) => left.localeCompare(right));
}

function markdownLinkTargets(readme) {
  const targets = [];
  let activeFence;

  for (const sourceLine of readme.split("\n")) {
    const delimiter = fenceDelimiter(sourceLine);
    if (activeFence !== undefined) {
      if (
        delimiter !== undefined &&
        delimiter[0] === activeFence[0] &&
        delimiter.length >= activeFence.length
      ) {
        activeFence = undefined;
      }
      continue;
    }
    if (delimiter !== undefined) {
      activeFence = delimiter;
      continue;
    }
    if (/^(?: {4}|\t)/u.test(sourceLine)) continue;

    const line = stripInlineCode(sourceLine);
    const reference = /^\s{0,3}\[[^\]]+\]:\s*/u.exec(line);
    if (reference !== null) {
      const target = readReferenceDestination(line, reference[0].length);
      if (target) targets.push(target);
    }

    let index = 0;
    while (index < line.length) {
      const labelStart = line.indexOf("[", index);
      if (labelStart === -1) break;
      if (isEscaped(line, labelStart)) {
        index = labelStart + 1;
        continue;
      }
      const labelEnd = line.indexOf("](", labelStart + 1);
      if (labelEnd === -1) break;
      const destination = readInlineDestination(line, labelEnd + 2);
      if (destination === undefined) {
        index = labelEnd + 2;
        continue;
      }
      const target = withoutMarkdownTitle(destination.target);
      if (target) targets.push(target);
      index = destination.end;
    }
  }
  return targets;
}

function fenceDelimiter(line) {
  return /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
}

function stripInlineCode(line) {
  let result = "";
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      result += line[index];
      index += 1;
      continue;
    }
    let delimiterEnd = index + 1;
    while (line[delimiterEnd] === "`") delimiterEnd += 1;
    const delimiter = line.slice(index, delimiterEnd);
    const closing = line.indexOf(delimiter, delimiterEnd);
    if (closing === -1) {
      result += delimiter;
      index = delimiterEnd;
      continue;
    }
    result += " ".repeat(closing + delimiter.length - index);
    index = closing + delimiter.length;
  }
  return result;
}

function readInlineDestination(line, from) {
  let index = from;
  while (/\s/u.test(line[index] ?? "")) index += 1;
  if (line[index] === "<") {
    const end = line.indexOf(">", index + 1);
    if (end === -1) return undefined;
    const close = line.indexOf(")", end + 1);
    if (close === -1) return undefined;
    return { target: line.slice(index + 1, end), end: close + 1 };
  }

  const targetStart = index;
  let depth = 0;
  while (index < line.length) {
    if (line[index] === "\\") {
      index += 2;
      continue;
    }
    if (line[index] === "(") depth += 1;
    if (line[index] === ")") {
      if (depth === 0) return { target: line.slice(targetStart, index), end: index + 1 };
      depth -= 1;
    }
    index += 1;
  }
  return undefined;
}

function isEscaped(line, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function withoutMarkdownTitle(destination) {
  return destination.replace(/\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)]*\))\s*$/u, "").trim();
}

function readReferenceDestination(line, from) {
  const destination = line.slice(from).trim();
  if (destination.startsWith("<")) {
    const end = destination.indexOf(">");
    return end === -1 ? undefined : destination.slice(1, end);
  }
  const match = /^(?:\\.|\S)+/u.exec(destination);
  return match?.[0];
}

function localLinkPath(target) {
  if (target.startsWith("#")) return undefined;
  if (target.startsWith("//")) return undefined;
  if (/^file:/iu.test(target)) return target.slice("file:".length);
  if (/^[a-z]:[\\/]/iu.test(target)) return target;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) return undefined;
  return target;
}

function decodeLinkPath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
