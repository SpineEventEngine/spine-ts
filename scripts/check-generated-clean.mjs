import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findSymlinkedAncestors, lstatIfPresent } from "./generated-path-safety.mjs";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = "packages/proto/generated";

function parseArgs(argv) {
  const args = {
    repoRoot: defaultRepoRoot,
    expectedGeneratedRoot: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--repo-root") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--repo-root requires a path argument.");
      }

      args.repoRoot = resolve(value);
      index += 1;
      continue;
    }

    if (arg === "--expected-generated-root") {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--expected-generated-root requires a path argument.");
      }

      args.expectedGeneratedRoot = resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function runCommand(repoRoot, label, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error !== undefined) {
    throw new Error(`Failed to start ${label}: ${result.error.message}`);
  }

  if (result.signal !== null) {
    throw new Error(`${label} terminated by signal ${result.signal}.`);
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stderr}${result.stdout}`);
  }

  return result;
}

function resolveBufExecutable(repoRoot) {
  const executable = process.platform === "win32" ? "buf.cmd" : "buf";
  const localBuf = join(repoRoot, "node_modules", ".bin", executable);

  return existsSync(localBuf) ? localBuf : executable;
}

function assertGeneratedDirectorySafe(repoRoot, root, displayPath, options = {}) {
  const ancestorFailures =
    options.checkAncestors === false ? [] : findSymlinkedAncestors(repoRoot, displayPath);

  if (ancestorFailures.length > 0) {
    return ancestorFailures;
  }

  const rootStat = lstatIfPresent(root);

  if (rootStat === undefined) {
    return [...ancestorFailures, `missing directory: ${displayPath}`];
  }

  if (rootStat.isSymbolicLink()) {
    return [...ancestorFailures, `symlink directory: ${displayPath}`];
  }

  if (!rootStat.isDirectory()) {
    return [...ancestorFailures, `not a directory: ${displayPath}`];
  }

  const failures = [...ancestorFailures];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");

      if (entry.isSymbolicLink()) {
        failures.push(`symlink entry: ${relativePath}`);
        continue;
      }

      if (entry.isDirectory()) {
        visit(path);
        continue;
      }

      if (!entry.isFile()) {
        failures.push(`unsupported entry: ${relativePath}`);
      }
    }
  }

  visit(root);
  return failures;
}

function readFileMap(root) {
  const files = new Map();

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(path);
        continue;
      }

      if (entry.isFile()) {
        const relativePath = relative(root, path).split(sep).join("/");
        files.set(relativePath, readFileSync(path, "utf8"));
      }
    }
  }

  visit(root);
  return files;
}

function compareGeneratedOutput(currentRoot, expectedRoot) {
  const currentFiles = readFileMap(currentRoot);
  const expectedFiles = readFileMap(expectedRoot);
  const currentPaths = new Set(currentFiles.keys());
  const expectedPaths = new Set(expectedFiles.keys());
  const missing = [...expectedPaths].filter((path) => !currentPaths.has(path)).sort();
  const unexpected = [...currentPaths].filter((path) => !expectedPaths.has(path)).sort();
  const changed = [...expectedPaths]
    .filter((path) => currentPaths.has(path) && currentFiles.get(path) !== expectedFiles.get(path))
    .sort();

  return { missing, unexpected, changed };
}

function createExpectedGeneratedRoot(repoRoot) {
  const tempRoot = mkdtempSync(join(tmpdir(), "spine-proto-generated-"));
  const outputRoot = join(tempRoot, "generated");
  const templatePath = join(tempRoot, "buf.gen.yaml");

  writeFileSync(
    templatePath,
    [
      "version: v2",
      "plugins:",
      "  - local: protoc-gen-es",
      `    out: ${outputRoot}`,
      "    opt:",
      "      - target=ts",
      "      - import_extension=js",
      "",
    ].join("\n"),
  );

  runCommand(repoRoot, "proto source verification", process.execPath, [
    join(repoRoot, "scripts/verify-proto-sources.mjs"),
  ]);
  runCommand(repoRoot, "clean proto generation", resolveBufExecutable(repoRoot), [
    "generate",
    "--template",
    templatePath,
  ]);

  return { tempRoot, outputRoot };
}

function printGeneratedDiff(diff) {
  for (const label of ["missing", "changed", "unexpected"]) {
    for (const path of diff[label].slice(0, 40)) {
      console.error(`  - ${label}: ${path}`);
    }

    if (diff[label].length > 40) {
      console.error(`  - ... ${diff[label].length - 40} more ${label} files`);
    }
  }
}

function main() {
  const { repoRoot, expectedGeneratedRoot } = parseArgs(process.argv.slice(2));
  const trackedResult = runCommand(repoRoot, "tracked generated output check", "git", [
    "ls-files",
    "--",
    generatedPath,
  ]);
  const ignoredResult = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--", `${generatedPath}/.cleanup-enforcement-check`],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  if (ignoredResult.error !== undefined) {
    throw new Error(`Failed to check generated output ignore rule: ${ignoredResult.error.message}`);
  }

  if (ignoredResult.signal !== null) {
    throw new Error(`Generated output ignore check terminated by signal ${ignoredResult.signal}.`);
  }

  const trackedFiles = trackedResult.stdout.trim();
  const generatedDirectory = resolve(repoRoot, generatedPath);
  const generatedSafetyFailures = assertGeneratedDirectorySafe(
    repoRoot,
    generatedDirectory,
    generatedPath,
  );
  const generatedDirectoryNotIgnored = ignoredResult.status !== 0;
  const tempGeneration =
    expectedGeneratedRoot === undefined ? createExpectedGeneratedRoot(repoRoot) : undefined;
  const expectedRoot = expectedGeneratedRoot ?? tempGeneration.outputRoot;
  const expectedSafetyFailures = assertGeneratedDirectorySafe(
    repoRoot,
    expectedRoot,
    expectedRoot,
    {
      checkAncestors: false,
    },
  );

  try {
    if (
      trackedFiles.length > 0 ||
      generatedSafetyFailures.length > 0 ||
      expectedSafetyFailures.length > 0 ||
      generatedDirectoryNotIgnored
    ) {
      console.error("Generated proto output is not clean.");

      if (trackedFiles.length > 0) {
        console.error(`Tracked generated files:\n${trackedFiles}`);
      }

      for (const failure of generatedSafetyFailures) {
        console.error(
          failure.startsWith("symlink directory")
            ? `Generated directory must not be a symlink: ${generatedPath}`
            : failure.startsWith("symlink ancestor")
              ? `Generated path ancestor must not be a symlink: ${failure.replace("symlink ancestor: ", "")}`
              : `Generated output is unsafe: ${failure}`,
        );
      }

      for (const failure of expectedSafetyFailures) {
        console.error(`Expected generated output is unsafe: ${failure}`);
      }

      if (generatedDirectoryNotIgnored) {
        console.error(`Generated directory is not ignored by Git: ${generatedPath}`);
      }

      process.exit(1);
    }

    const diff = compareGeneratedOutput(generatedDirectory, expectedRoot);

    if (diff.missing.length > 0 || diff.changed.length > 0 || diff.unexpected.length > 0) {
      console.error("Generated proto output is stale.");
      printGeneratedDiff(diff);
      process.exit(1);
    }

    console.log("Generated proto output is ignored, untracked, and freshly regenerated.");
  } finally {
    if (tempGeneration !== undefined) {
      rmSync(tempGeneration.tempRoot, { recursive: true, force: true });
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
