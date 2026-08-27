/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("..", import.meta.url).pathname;

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
}

function productionPackagePaths(root) {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")),
    )
    .map((entry) => `packages/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function documentationProblems(root, packagePaths) {
  const expected = productionPackagePaths(root);
  const actual = [...packagePaths].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    return [
      `documentation package paths must exactly match production packages: ${expected.join(", ")}`,
    ];
  return [];
}

function workspacePatterns(repoRoot) {
  return readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8")
    .split("\n")
    .map((line) => /^\s+-\s+"([^"]+)"\s*$/u.exec(line)?.[1])
    .filter((pattern) => pattern !== undefined);
}

function workspaceDirectories(repoRoot, pattern) {
  const parts = pattern.split("/");
  const directories = [repoRoot];

  for (const part of parts) {
    const next = [];

    for (const directory of directories) {
      if (part === "*") {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            next.push(join(directory, entry.name));
          }
        }
      } else {
        next.push(join(directory, part));
      }
    }

    directories.splice(0, directories.length, ...next);
  }

  return directories;
}

function readWorkspacePackages(repoRoot) {
  const directories = workspacePatterns(repoRoot).flatMap((pattern) =>
    workspaceDirectories(repoRoot, pattern),
  );
  const paths = new Set();
  const packages = [];

  for (const directory of directories) {
    const path = join(directory, "package.json");

    try {
      const packagePath = relative(repoRoot, directory).replaceAll("\\", "/");

      if (!paths.has(packagePath)) {
        paths.add(packagePath);
        packages.push({ path: packagePath, manifest: JSON.parse(readFileSync(path, "utf8")) });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return packages.sort((left, right) => left.path.localeCompare(right.path));
}

function hasReferenceLink(readme) {
  return /(?<!!)\[[^\]]+\]\(REFERENCE\.md\)/u.test(readme);
}

function versionProblems(repoRoot) {
  const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const problems = [];
  const workspacePackages = readWorkspacePackages(repoRoot);
  const localPackageNames = new Set(
    workspacePackages
      .map((workspacePackage) => workspacePackage.manifest.name)
      .filter((name) => typeof name === "string"),
  );

  if (root.version === undefined || root.version === "0.0.0") {
    problems.push("root package must define a non-placeholder version");
  }

  for (const workspacePackage of workspacePackages) {
    if (workspacePackage.manifest.version !== root.version) {
      problems.push(`${workspacePackage.path} must use the root version`);
    }

    for (const group of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const [name, version] of Object.entries(workspacePackage.manifest[group] ?? {})) {
        if (localPackageNames.has(name) && version !== "workspace:*" && version !== root.version) {
          problems.push(`${workspacePackage.path} must use the root version for ${name}`);
        }
      }
    }
  }

  return problems;
}

function withWorkspaceFixture(callback) {
  const fixture = mkdtempSync(join(tmpdir(), "spine-ts-package-metadata-"));

  try {
    writeFileSync(join(fixture, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    writeFileSync(join(fixture, "package.json"), '{"version":"1.2.3"}\n');
    mkdirSync(join(fixture, "packages", "core"), { recursive: true });
    writeFileSync(
      join(fixture, "packages", "core", "package.json"),
      '{"name":"@example/core","version":"1.2.3"}\n',
    );
    mkdirSync(join(fixture, "packages", "example"), { recursive: true });
    writeFileSync(
      join(fixture, "packages", "example", "package.json"),
      '{"name":"@example/example","version":"1.2.3"}\n',
    );
    callback(fixture);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe("package metadata", () => {
  it("declares Apache-2.0 for every framework package without classifying examples as publishable", () => {
    const frameworkPackages = productionPackagePaths(repoRoot);

    expect(frameworkPackages).toHaveLength(18);
    expect(
      frameworkPackages.every((path) => readJson(`${path}/package.json`).license === "Apache-2.0"),
    ).toBe(true);
    expect(readJson("package.json").license).toBeUndefined();
    expect(
      readWorkspacePackages(repoRoot)
        .filter((workspacePackage) => workspacePackage.path.startsWith("examples/"))
        .every((workspacePackage) => workspacePackage.manifest.license === undefined),
    ).toBe(true);
  });

  it("makes exactly the framework packages publishable without a static channel", () => {
    const frameworkPackages = productionPackagePaths(repoRoot);
    const publicationConfig = {
      registry: "https://registry.npmjs.org/",
      access: "public",
    };

    expect(frameworkPackages).toHaveLength(18);
    for (const packagePath of frameworkPackages) {
      const packageJson = readJson(`${packagePath}/package.json`);

      expect(packageJson.private).not.toBe(true);
      expect(packageJson.description).toEqual(expect.any(String));
      expect(packageJson.description.trim()).not.toBe("");
      expect(packageJson.publishConfig).toEqual(publicationConfig);
      expect(packageJson.repository).toEqual({
        type: "git",
        url: "https://github.com/SpineEventEngine/spine-ts",
        directory: packagePath,
      });
    }

    expect(readJson("package.json").private).toBe(true);
    for (const workspacePackage of readWorkspacePackages(repoRoot).filter((workspacePackage) =>
      workspacePackage.path.startsWith("examples/"),
    )) {
      expect(workspacePackage.manifest.private).toBe(true);
    }
  });

  it("derives every workspace version from the root package version", () => {
    const rootPackage = readJson("package.json");
    const workspacePackages = readWorkspacePackages(repoRoot);

    expect(typeof rootPackage.version).toBe("string");
    expect(workspacePackages.map((workspacePackage) => workspacePackage.path)).toEqual([
      "examples/distributed-message-board",
      "examples/message-board/app",
      "examples/message-board/model",
      "examples/message-board/web",
      "examples/orders",
      "examples/projects",
      "examples/todo",
      "packages/auth",
      "packages/client-node",
      "packages/client-react",
      "packages/client-web",
      "packages/core",
      "packages/delivery-client",
      "packages/delivery-server",
      "packages/deployment",
      "packages/deployment-gce",
      "packages/deployment-gke",
      "packages/proto",
      "packages/proto-tools",
      "packages/server",
      "packages/storage",
      "packages/storage-datastore",
      "packages/storage-rdbms",
      "packages/testing",
      "packages/transport",
    ]);
    expect(
      workspacePackages.every(
        (workspacePackage) => workspacePackage.manifest.version === rootPackage.version,
      ),
    ).toBe(true);
    expect(versionProblems(repoRoot)).toEqual([]);
  });

  it("rejects a divergent, missing, or placeholder workspace version", () => {
    withWorkspaceFixture((fixture) => {
      writeFileSync(join(fixture, "packages", "example", "package.json"), '{"version":"2.0.0"}\n');
      expect(versionProblems(fixture)).toEqual(["packages/example must use the root version"]);

      writeFileSync(join(fixture, "packages", "example", "package.json"), "{}\n");
      expect(versionProblems(fixture)).toEqual(["packages/example must use the root version"]);

      writeFileSync(join(fixture, "package.json"), '{"version":"0.0.0"}\n');
      writeFileSync(
        join(fixture, "packages", "core", "package.json"),
        '{"name":"@example/core","version":"0.0.0"}\n',
      );
      writeFileSync(join(fixture, "packages", "example", "package.json"), '{"version":"0.0.0"}\n');
      expect(versionProblems(fixture)).toEqual([
        "root package must define a non-placeholder version",
      ]);
    });
  });

  it("requires non-workspace local package pins to use the root version", () => {
    withWorkspaceFixture((fixture) => {
      writeFileSync(
        join(fixture, "packages", "example", "package.json"),
        '{"name":"@example/example","version":"1.2.3","dependencies":{"@example/core":"1.2.4"}}\n',
      );
      expect(versionProblems(fixture)).toEqual([
        "packages/example must use the root version for @example/core",
      ]);

      writeFileSync(
        join(fixture, "packages", "example", "package.json"),
        '{"name":"@example/example","version":"1.2.3","dependencies":{"@example/core":"workspace:*"}}\n',
      );
      expect(versionProblems(fixture)).toEqual([]);

      writeFileSync(join(fixture, "package.json"), '{"version":"3.4.5"}\n');
      writeFileSync(
        join(fixture, "packages", "core", "package.json"),
        '{"name":"@example/core","version":"3.4.5"}\n',
      );
      writeFileSync(
        join(fixture, "packages", "example", "package.json"),
        '{"name":"@example/example","version":"3.4.5","dependencies":{"@example/core":"3.4.5"}}\n',
      );
      expect(versionProblems(fixture)).toEqual([]);
    });
  });

  it("keeps moved example lockfile importers aligned with their final package paths", () => {
    const lockfile = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
    const finalPaths = ["examples/orders", "examples/projects"];

    for (const path of finalPaths) {
      expect(readJson(`${path}/package.json`).name).toMatch(/^@spine-event-engine\/example-/u);
      expect(lockfile).toContain(`  ${path}:\n`);
    }
    expect(lockfile).not.toContain("  examples/datastore-orders:\n");
    expect(lockfile).not.toContain("  examples/project-management:\n");
  });

  it("ships reader and reference documentation for the completed package documentation group", () => {
    const documentedPackages = productionPackagePaths(repoRoot);

    expect(documentationProblems(repoRoot, documentedPackages)).toEqual([]);
    for (const packagePath of documentedPackages) {
      const packageJson = readJson(`${packagePath}/package.json`);

      expect(packageJson.files).toEqual(expect.arrayContaining(["README.md", "REFERENCE.md"]));
      expect(existsSync(join(repoRoot, packagePath, "README.md"))).toBe(true);
      expect(existsSync(join(repoRoot, packagePath, "REFERENCE.md"))).toBe(true);
      const readme = readFileSync(join(repoRoot, packagePath, "README.md"), "utf8");
      expect(hasReferenceLink(readme), packagePath).toBe(true);
    }
  });

  it("rejects a future production package omitted from documentation coverage", () => {
    withWorkspaceFixture((fixture) => {
      mkdirSync(join(fixture, "packages", "future"), { recursive: true });
      writeFileSync(
        join(fixture, "packages", "future", "package.json"),
        '{"name":"@example/future"}\n',
      );
      expect(documentationProblems(fixture, ["packages/core", "packages/example"])).toEqual([
        "documentation package paths must exactly match production packages: packages/core, packages/example, packages/future",
      ]);
    });
  });

  it("rejects prose that names the reference without linking to it", () => {
    const readme = "Read REFERENCE.md for details.";

    expect(hasReferenceLink(readme)).toBe(false);
  });

  it("rejects an image that points at the reference document", () => {
    const readme = "![Reference cover](REFERENCE.md)";

    expect(hasReferenceLink(readme)).toBe(false);
  });

  it("keeps standalone commands self-sufficient while task verification classifies generated work", () => {
    const rootPackage = readJson("package.json");

    expect(rootPackage.scripts["typecheck:build"]).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts.lint).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts.lint).toContain("pnpm lint:copyright");
    expect(rootPackage.scripts["lint:copyright"]).toBe("node scripts/check-copyright.mjs");
    expect(rootPackage.scripts["docs:api"]).toMatch(/^pnpm proto:generate && /);
    expect(rootPackage.scripts["docs:check"]).toMatch(/^pnpm proto:generate && /);

    const task = rootPackage.scripts["verify:task"];
    const release = rootPackage.scripts["verify:release"];
    const generatedGates = rootPackage.scripts["verify:generated-gates"];
    const releaseGenerated = rootPackage.scripts["verify:release:generated"];

    expect(rootPackage.scripts.verify).toBe("pnpm verify:release");
    expect(task).toContain("pnpm check:node");
    expect(task).toContain("node scripts/verify-task.mjs");
    expect(task).not.toContain("pnpm proto:generate");
    expect(task).not.toContain("vitest");

    expect(release.match(/pnpm proto:generate/gu)).toHaveLength(1);
    expect(release).toContain("pnpm verify:release:generated");
    expect(releaseGenerated.match(/pnpm verify:generated-gates/gu)).toHaveLength(1);
    expect(releaseGenerated.match(/vitest run --coverage/gu)).toHaveLength(1);
    expect(releaseGenerated).toContain("--maxWorkers=50%");
    expect(releaseGenerated).not.toContain(
      "packages/server/test/server/server-integration-broker-cross-process.test.ts",
    );
    expect(releaseGenerated.match(/vitest run/gu)).toHaveLength(1);
    expect(generatedGates.match(/pnpm typecheck:build:generated/gu)).toHaveLength(1);
    expect(generatedGates.match(/pnpm docs:check:generated/gu)).toHaveLength(1);
    expect(generatedGates).toContain("pnpm lint:cleanup");
    expect(generatedGates).toContain("pnpm lint:tsdoc");
    expect(generatedGates).toContain("pnpm lint:copyright");
    expect(generatedGates).toContain("pnpm proto:lint:generated");
    expect(generatedGates).toContain("pnpm proto:check-generated:current");
    expect(release).not.toContain("pnpm verify:generated");
    expect(rootPackage.scripts["docs:api:check"]).toBe("node scripts/check-api-docs.mjs");
    expect(rootPackage.scripts["docs:audience:check"]).toBe("node scripts/check-doc-audience.mjs");
    expect(rootPackage.scripts["docs:snippets:check"]).toBe(
      "pnpm typecheck:build && pnpm docs:snippets:check:generated",
    );
    expect(rootPackage.scripts["docs:snippets:check:generated"]).toBe(
      "node docs/check-typescript-snippets.mjs",
    );
    expect(rootPackage.scripts["docs:check:generated"]).toBe(
      "pnpm docs:api:check && pnpm docs:audience:check && pnpm docs:snippets:check:generated",
    );
    expect(rootPackage.scripts["proto:lint:generated"]).toBe("pnpm exec buf lint");
    expect(rootPackage.scripts["proto:check-generated:current"]).toBe(
      "node scripts/check-generated-clean.mjs --current-output",
    );

    const apiDocsChecker = readFileSync(join(repoRoot, "scripts/check-api-docs.mjs"), "utf8");
    expect(apiDocsChecker).not.toContain('"--out", htmlPath');
    expect(apiDocsChecker).toContain('"--json", jsonPath');
    expect(apiDocsChecker).not.toContain('"SubscriptionCapacityReservation"');
  });

  it("exports the packaged Proto sources, compiled generated modules, and manifest", () => {
    const protoPackage = readJson("packages/proto/package.json");

    expect(protoPackage.exports).toEqual({
      ".": {
        types: "./dist/src/index.d.ts",
        default: "./dist/src/index.js",
      },
      "./auth": {
        types: "./dist/src/auth/index.d.ts",
        default: "./dist/src/auth/index.js",
      },
      "./client": {
        types: "./dist/src/client/index.d.ts",
        default: "./dist/src/client/index.js",
      },
      "./delivery": {
        types: "./dist/src/delivery/index.d.ts",
        default: "./dist/src/delivery/index.js",
      },
      "./delivery-server": {
        types: "./dist/src/delivery-server/index.d.ts",
        default: "./dist/src/delivery-server/index.js",
      },
      "./deployment": {
        types: "./dist/src/deployment/index.d.ts",
        default: "./dist/src/deployment/index.js",
      },
      "./spine-proto-manifest.json": "./spine-proto-manifest.json",
      "./proto/*": "./proto/*",
      "./generated/*.js": {
        types: "./dist/generated/*.d.ts",
        default: "./dist/generated/*.js",
      },
    });
    expect(protoPackage.files).toEqual(
      expect.arrayContaining(["proto", "spine-proto.json", "spine-proto-manifest.json"]),
    );
  });
});
