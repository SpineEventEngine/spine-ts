import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findSymlinkedAncestors, lstatIfPresent } from "./generated-path-safety.mjs";
import {
  cleanupStagedTargets,
  atomicGeneratedTargets,
  generatedTargets,
  stageMessageBoardRegistry,
  stageGeneratedTargets,
} from "./proto-workflow.mjs";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maximumGeneratedTreeDepth = 64;
const maximumGeneratedTreeEntries = 1_000;

function parseArgs(argv) {
  const args = {
    repoRoot: defaultRepoRoot,
    expectedGeneratedRoot: undefined,
    currentOutput: false,
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

    if (arg === "--current-output") {
      args.currentOutput = true;
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

  const pending = [[root, 0]];
  let entries = 0;
  while (pending.length > 0) {
    const [directory, depth] = pending.pop();
    if (depth > maximumGeneratedTreeDepth) {
      failures.push(`depth exceeds ${maximumGeneratedTreeDepth}: ${relative(root, directory)}`);
      continue;
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > maximumGeneratedTreeEntries) {
        failures.push(`entry count exceeds ${maximumGeneratedTreeEntries}`);
        return failures;
      }
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");

      if (entry.isSymbolicLink()) {
        failures.push(`symlink entry: ${relativePath}`);
        continue;
      }

      if (entry.isDirectory()) {
        pending.push([path, depth + 1]);
        continue;
      }

      if (!entry.isFile()) {
        failures.push(`unsupported entry: ${relativePath}`);
      }
    }
  }

  return failures;
}

function readFileMap(root) {
  const files = new Map();
  const pending = [[root, 0]];
  let entries = 0;
  while (pending.length > 0) {
    const [directory, depth] = pending.pop();
    if (depth > maximumGeneratedTreeDepth)
      throw new Error(`Generated output depth exceeds ${maximumGeneratedTreeDepth}.`);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > maximumGeneratedTreeEntries)
        throw new Error(`Generated output entry count exceeds ${maximumGeneratedTreeEntries}.`);
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        pending.push([path, depth + 1]);
        continue;
      }

      if (entry.isFile()) {
        const relativePath = relative(root, path).split(sep).join("/");
        files.set(relativePath, readFileSync(path, "utf8"));
      }
    }
  }

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

export function messageBoardRegistryIsFresh(target, staged) {
  return readFileSync(target, "utf8") === readFileSync(staged, "utf8");
}

export function checkMessageBoardRegistryFresh(messageBoardRegistry) {
  return messageBoardRegistry === undefined ||
    messageBoardRegistryIsFresh(messageBoardRegistry.target, messageBoardRegistry.staged)
    ? 0
    : 1;
}

export function generatedTargetsForCheck(expectedGeneratedRoot) {
  return expectedGeneratedRoot === undefined
    ? atomicGeneratedTargets
    : [
        {
          ...generatedTargets[0],
          expectedGeneratedRoot,
        },
      ];
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

export function runGeneratedClean(args = process.argv.slice(2), operations = {}) {
  const { repoRoot, expectedGeneratedRoot, currentOutput } = parseArgs(args);
  if (expectedGeneratedRoot !== undefined && currentOutput) {
    throw new Error("--current-output cannot be combined with --expected-generated-root.");
  }
  let targets = generatedTargetsForCheck(expectedGeneratedRoot);
  let staged = { stagedTargets: [], status: 0 };
  let messageBoardRegistry;

  try {
    staged =
      expectedGeneratedRoot === undefined
        ? (operations.stageGeneratedTargets ?? stageGeneratedTargets)({
            repoRoot,
          })
        : staged;
    if (staged.status !== 0) return staged.status;
    if (expectedGeneratedRoot === undefined)
      targets = staged.stagedTargets.map(({ target }) => target);
    const expectedRoots = new Map(
      staged.stagedTargets.map((stagedTarget) => [
        stagedTarget.target.displayPath,
        stagedTarget.stagedOutputRoot,
      ]),
    );
    messageBoardRegistry =
      expectedGeneratedRoot === undefined
        ? (operations.stageMessageBoardRegistry ?? stageMessageBoardRegistry)(repoRoot)
        : undefined;
    for (const target of targets) {
      const trackedResult = runCommand(repoRoot, "tracked generated output check", "git", [
        "ls-files",
        "--",
        target.displayPath,
      ]);
      const ignoredResult = spawnSync(
        "git",
        ["check-ignore", "--quiet", "--", `${target.displayPath}/.cleanup-enforcement-check`],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      );

      if (ignoredResult.error !== undefined) {
        throw new Error(
          `Failed to check generated output ignore rule: ${ignoredResult.error.message}`,
        );
      }

      if (ignoredResult.signal !== null) {
        throw new Error(
          `Generated output ignore check terminated by signal ${ignoredResult.signal}.`,
        );
      }

      const trackedFiles = trackedResult.stdout
        .trim()
        .split("\n")
        .filter(
          (path) =>
            path.length > 0 && path !== `${target.displayPath}/.spine-proto-generation.json`,
        )
        .join("\n");
      const generatedDirectory = resolve(repoRoot, target.displayPath);
      const generatedSafetyFailures = assertGeneratedDirectorySafe(
        repoRoot,
        generatedDirectory,
        target.displayPath,
      );
      const generatedDirectoryNotIgnored = ignoredResult.status !== 0;
      const expectedRoot = target.expectedGeneratedRoot ?? expectedRoots.get(target.displayPath);

      if (expectedRoot === undefined) {
        throw new Error(`Missing staged generated output for ${target.displayPath}.`);
      }

      const expectedSafetyFailures =
        expectedRoot === undefined
          ? []
          : assertGeneratedDirectorySafe(repoRoot, expectedRoot, expectedRoot, {
              checkAncestors: false,
            });

      if (
        trackedFiles.length > 0 ||
        generatedSafetyFailures.length > 0 ||
        expectedSafetyFailures.length > 0 ||
        generatedDirectoryNotIgnored
      ) {
        console.error(`Generated proto output is not clean: ${target.displayPath}`);

        if (trackedFiles.length > 0) {
          console.error(`Tracked generated files:\n${trackedFiles}`);
        }

        for (const failure of generatedSafetyFailures) {
          console.error(
            failure.startsWith("symlink directory")
              ? `Generated directory must not be a symlink: ${target.displayPath}`
              : failure.startsWith("symlink ancestor")
                ? `Generated path ancestor must not be a symlink: ${failure.replace("symlink ancestor: ", "")}`
                : `Generated output is unsafe: ${failure}`,
          );
        }

        for (const failure of expectedSafetyFailures) {
          console.error(`Expected generated output is unsafe: ${failure}`);
        }

        if (generatedDirectoryNotIgnored) {
          console.error(`Generated directory is not ignored by Git: ${target.displayPath}`);
        }

        return 1;
      }

      const diff = compareGeneratedOutput(generatedDirectory, expectedRoot);

      if (diff.missing.length > 0 || diff.changed.length > 0 || diff.unexpected.length > 0) {
        console.error("Generated proto output is stale.");
        console.error(`Generated root: ${target.displayPath}`);
        printGeneratedDiff(diff);
        return 1;
      }
    }

    if (checkMessageBoardRegistryFresh(messageBoardRegistry) !== 0) {
      console.error("Generated MessageBoard model registry is stale.");
      console.error(`Registry: ${relative(repoRoot, messageBoardRegistry.target)}`);
      return 1;
    }

    console.log(
      currentOutput
        ? "Generated proto outputs are ignored, untracked, and already-generated by this verification profile."
        : "Generated proto outputs are ignored, untracked, and freshly regenerated.",
    );
    return 0;
  } finally {
    (operations.cleanupStagedTargets ?? cleanupStagedTargets)(staged.stagedTargets);
    if (messageBoardRegistry !== undefined) {
      rmSync(messageBoardRegistry.fileStageRoot, { recursive: true, force: true });
    }
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    process.exit(runGeneratedClean());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
