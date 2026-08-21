/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

function packageDirectories(root) {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function packageManifests(root) {
  return packageDirectories(root).map((directory) => {
    const manifest = JSON.parse(
      readFileSync(join(root, "packages", directory, "package.json"), "utf8"),
    );
    return { directory, manifest };
  });
}

const finalPublicSurfaces = new Map([
  ["@spine-event-engine/server", ["./spi/handler-registry", "./spi/delivery", "./browser"]],
  ["@spine-event-engine/core", ["./spi/subscription-lifecycle"]],
  ["@spine-event-engine/deployment", ["./spi/backend-membership"]],
  ["@spine-event-engine/storage", ["./provider"]],
]);

const exactFrameworkPackages = [
  "auth",
  "client-node",
  "client-react",
  "client-web",
  "core",
  "delivery-client",
  "delivery-server",
  "deployment",
  "deployment-gce",
  "deployment-gke",
  "proto",
  "proto-tools",
  "server",
  "storage",
  "storage-datastore",
  "storage-rdbms",
  "testing",
  "transport",
].map((directory) => `@spine-event-engine/${directory}`);

/**
 * Returns every accidentally-public package export key.
 */
export function packageExportInternalPathProblems(root) {
  return packageManifests(root).flatMap(({ manifest }) => {
    return Object.keys(manifest.exports ?? {})
      .filter((path) => path.includes("internal/"))
      .map((path) => `${manifest.name} exports ${path}`);
  });
}

function packageGraphProblems(manifests) {
  const byName = new Map(manifests.map(({ manifest }) => [manifest.name, manifest]));
  const actual = [...byName.keys()].sort((left, right) => left.localeCompare(right));
  const expected = [...exactFrameworkPackages].sort((left, right) => left.localeCompare(right));
  const problems = [];
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    problems.push(`framework package inventory must be exact: ${expected.join(", ")}`);

  const visited = new Set();
  const visiting = new Set();
  const visit = (name, path) => {
    if (visiting.has(name)) {
      problems.push(`framework dependency graph is cyclic: ${[...path, name].join(" -> ")}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    const manifest = byName.get(name);
    for (const group of ["dependencies", "optionalDependencies", "peerDependencies"])
      for (const dependency of Object.keys(manifest?.[group] ?? {}).sort((left, right) =>
        left.localeCompare(right),
      ))
        if (byName.has(dependency)) visit(dependency, [...path, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of actual) visit(name, []);
  return [...new Set(problems)].sort((left, right) => left.localeCompare(right));
}

/**
 * Returns package-surface and graph violations for the final Wave 14 boundary.
 */
export function finalPublicSurfaceProblems(root) {
  const manifests = packageManifests(root);
  const byName = new Map(manifests.map(({ manifest }) => [manifest.name, manifest]));
  const problems = packageGraphProblems(manifests);
  for (const [name, surfaces] of finalPublicSurfaces) {
    const exports = byName.get(name)?.exports ?? {};
    for (const surface of surfaces)
      if (!(surface in exports)) problems.push(`${name} must export ${surface}`);
  }
  return problems.sort((left, right) => left.localeCompare(right));
}

/**
 * Returns runtime closure violations for the server's native root entry point.
 * `optionalDependencies` are intentionally excluded: the browser entry is a separate optional path.
 */
export function nativeServerRootDependencyProblems(root) {
  const byName = new Map(packageManifests(root).map(({ manifest }) => [manifest.name, manifest]));
  const problems = [];
  const pending = ["@spine-event-engine/server"];
  const visited = new Set();
  while (pending.length) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    visited.add(name);
    const dependencies = byName.get(name)?.dependencies ?? {};
    for (const dependency of Object.keys(dependencies).sort((left, right) =>
      left.localeCompare(right),
    )) {
      if (dependency === "typescript" || dependency === "@spine-event-engine/auth")
        problems.push(`${name} native dependency closure contains ${dependency}`);
      if (byName.has(dependency)) pending.push(dependency);
    }
  }
  return problems.sort((left, right) => left.localeCompare(right));
}

function trackedTestOrFixtureFiles(root) {
  const extensions = /\.(?:[cm]?[jt]sx?)$/u;
  const isTestOrFixture = (path) =>
    extensions.test(path) &&
    (/(?:^|\/)(?:test|tests|test-fixtures|fixtures)(?:\/|$)/u.test(path) ||
      /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(path));
  try {
    return execFileSync("git", ["ls-files", "-z", "--", "packages"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .split("\0")
      .filter(isTestOrFixture)
      .map((path) => join(root, path))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return discoveredTestOrFixtureFiles(root, isTestOrFixture);
  }
}

function discoveredTestOrFixtureFiles(root, isTestOrFixture) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && isTestOrFixture(relative(root, path))) files.push(path);
    }
  };
  walk(join(root, "packages"));
  return files.sort((left, right) => left.localeCompare(right));
}

function packageRootFor(root, path) {
  const relativePath = relative(join(root, "packages"), path).split(sep);
  return relativePath.length > 1 ? join(root, "packages", relativePath[0]) : undefined;
}

/**
 * Compares nested paths with an injected platform path implementation when needed in tests.
 */
export function isNestedPath(parent, child, path = { relative, sep }) {
  const nested = path.relative(parent, child);
  return nested === "" || (nested !== ".." && !nested.startsWith(".." + path.sep));
}

function resolvedRelativeTarget(importer, specifier) {
  const candidate = resolve(dirname(importer), specifier);
  const candidates = [candidate];
  if (/\.js$/u.test(candidate)) candidates.push(candidate.replace(/\.js$/u, ".ts"));
  candidates.push(
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].map(
      (extension) => candidate + extension,
    ),
  );
  candidates.push(
    ...[
      "index.ts",
      "index.tsx",
      "index.mts",
      "index.cts",
      "index.js",
      "index.mjs",
      "index.cjs",
    ].map((file) => join(candidate, file)),
  );
  const target = candidates.find((path) => existsSync(path));
  return target === undefined ? undefined : realpathSync(target);
}

function scriptKind(path) {
  if (/\.(?:cjs|mjs)$/u.test(path)) return ts.ScriptKind.JS;
  if (/\.tsx$/u.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

function stringSpecifier(node) {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function relativeSpecifiers(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, scriptKind(path));
  const specifiers = [];
  const add = (specifier) => {
    if (specifier?.startsWith("./") || specifier?.startsWith("../")) specifiers.push(specifier);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      add(stringSpecifier(node.moduleSpecifier));
    else if (ts.isImportEqualsDeclaration(node))
      add(stringSpecifier(node.moduleReference.expression));
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        add(stringSpecifier(node.arguments[0]));
      if (ts.isIdentifier(node.expression) && node.expression.text === "require")
        add(stringSpecifier(node.arguments[0]));
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    )
      add(stringSpecifier(node.arguments[0]));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/**
 * Reports tracked test and fixture imports that bypass a sibling package's public exports.
 * Real paths are compared so a symlink cannot disguise the crossing.
 */
export function siblingPackageTreeReachProblems(root) {
  const actualRoot = realpathSync(root);
  const packagesRoot = join(actualRoot, "packages");
  const packageRoots = packageDirectories(actualRoot).map((directory) =>
    realpathSync(join(packagesRoot, directory)),
  );
  const forbiddenTrees = new Set(["src", "dist", "generated", "node_modules"]);
  const problems = [];

  for (const importer of trackedTestOrFixtureFiles(actualRoot)) {
    const ownRoot = packageRootFor(actualRoot, importer);
    if (ownRoot === undefined) continue;
    for (const specifier of relativeSpecifiers(importer, readFileSync(importer, "utf8"))) {
      const target = resolvedRelativeTarget(importer, specifier);
      if (target === undefined) continue;
      const siblingRoot = packageRoots.find(
        (packageRoot) =>
          packageRoot !== realpathSync(ownRoot) &&
          relative(packageRoot, target) !== "" &&
          isNestedPath(packageRoot, target),
      );
      if (siblingRoot === undefined) continue;
      const siblingRelativePath = relative(siblingRoot, target);
      if (!forbiddenTrees.has(siblingRelativePath.split("/")[0])) continue;
      problems.push(`${relative(actualRoot, importer)} reaches ${relative(actualRoot, target)}`);
    }
  }
  return [...new Set(problems)].sort((left, right) => left.localeCompare(right));
}
