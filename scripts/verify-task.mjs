import { spawnSync } from "node:child_process";
import { findPrimaryMergeBase } from "./git-primary-branch.mjs";

export function parseTaskVerificationArgs(args) {
  const values = args[0] === "--" ? args.slice(1) : args;
  if (values.length === 1 && values[0] === "--no-tests") return { noTests: true };
  if (values[0] === "--no-tests") throw new Error("--no-tests must be the only argument.");
  if (values[0] !== "--coverage" && values[0] !== "--no-coverage") {
    throw new Error(
      "verify:task requires --coverage or --no-coverage followed by focused test paths, or --no-tests.",
    );
  }
  const sourceIndex = values.indexOf("--source");
  const paths = values.slice(1, sourceIndex === -1 ? undefined : sourceIndex);
  if (paths.length === 0 || paths.some((path) => path.startsWith("--"))) {
    throw new Error("verify:task requires at least one focused test path.");
  }
  const coverage = values[0] === "--coverage";
  const sources = sourceIndex === -1 ? [] : values.slice(sourceIndex + 1);
  if (!coverage && sourceIndex !== -1) {
    throw new Error("verify:task --source is available only with --coverage.");
  }
  if (coverage && sources.length === 0) {
    throw new Error("verify:task --coverage requires --source followed by changed source paths.");
  }
  if (sources.some((path) => path.startsWith("--"))) {
    throw new Error("verify:task --source accepts only source paths.");
  }
  return { coverage, paths, ...(coverage ? { sources } : {}) };
}

export function vitestArgs(choice) {
  return [
    "exec",
    "vitest",
    "run",
    ...(choice.coverage
      ? [
          "--coverage",
          ...[...new Set(choice.sources)].map((source) => `--coverage.include=${source}`),
        ]
      : []),
    ...choice.paths,
  ];
}

/**
 * Classifies changed paths conservatively so shared or unknown changes retain every gate.
 *
 * @param paths Changed repository paths.
 * @returns Required Proto and API-documentation gates.
 */
export function classifyTaskChanges(paths) {
  const independentlySafe = paths.length > 0 && paths.every((path) => path.endsWith(".md"));
  return independentlySafe ? { proto: false, typeDoc: false } : { proto: true, typeDoc: true };
}

/**
 * Lists deterministic gates required for a task diff classification.
 *
 * @param classification Required Proto and API-documentation gates.
 * @returns Package scripts that must run for the classification.
 */
export function taskGateCommands(classification) {
  return [
    ...(classification.proto ? ["proto:generate"] : []),
    "typecheck:build:generated",
    "typecheck:tooling",
    "eslint",
    "lint:cleanup",
    "lint:tsdoc",
    "lint:copyright",
    "check:logging-containment",
    "format:check",
    "docs:audience:check",
    ...(classification.typeDoc ? ["docs:api:check"] : []),
    ...(classification.proto ? ["proto:lint:generated", "proto:check-generated:current"] : []),
    "check:release-readiness",
  ];
}

/**
 * Selects tests that a non-record task cannot opt out of with caller arguments.
 */
export function requiredTaskTests(classification, paths = []) {
  if (!classification.proto && !classification.typeDoc) return [];
  const packages = new Set();
  for (const path of paths) {
    const match = /^packages\/([^/]+)\//u.exec(path);
    if (match === null) return ["run", "--passWithNoTests"];
    packages.add(`packages/${match[1]}/test`);
  }
  return packages.size > 0 ? ["run", ...packages] : ["run", "--passWithNoTests"];
}

/* Plans mandatory changed-scope tests and any caller tests those suites do not cover. */
export function plannedTaskTests(classification, paths, choice) {
  const mandatory = requiredTaskTests(classification, paths);
  const requested = choice.noTests ? [] : [...new Set(choice.paths)];
  const uncovered = requested.filter((path) => !coveredByMandatoryTest(path, mandatory));
  if (choice.coverage && mandatory.length > 0)
    return [vitestArgs({ ...choice, paths: [...mandatory.slice(1), ...uncovered] })];
  return [
    ...(mandatory.length === 0 ? [] : [vitestArgs({ ...choice, paths: mandatory.slice(1) })]),
    ...(uncovered.length === 0 ? [] : [vitestArgs({ ...choice, paths: uncovered })]),
  ];
}

function coveredByMandatoryTest(path, mandatory) {
  return (
    mandatory.includes("--passWithNoTests") ||
    mandatory.slice(1).some((scope) => path === scope || path.startsWith(`${scope}/`))
  );
}

/**
 * Lists changed paths from the branch, worktree, index, and untracked files.
 *
 * @param runGit Runs a Git command and returns its status and standard output.
 * @returns Changed paths, or an empty list when Git cannot classify them.
 */
export function changedPaths(runGit = git) {
  const baseRef = findPrimaryMergeBase(runGit);
  if (baseRef === undefined) return [];
  const ranges = [`${baseRef}...HEAD`, undefined, "--cached"];
  const paths = new Set();
  for (const range of ranges) {
    const args = ["diff", "--name-only", "--no-renames", "--diff-filter=ACMRD"];
    if (range !== undefined) args.push(range);
    const result = runGit(args);
    if (result.status !== 0) return [];
    for (const path of result.stdout.split("\n")) if (path !== "") paths.add(path);
  }
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  if (untracked.status !== 0) return [];
  for (const path of untracked.stdout.split("\n")) if (path !== "") paths.add(path);
  return [...paths];
}

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.signal !== null || result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const choice = parseTaskVerificationArgs(process.argv.slice(2));
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const paths = changedPaths();
  const classification = classifyTaskChanges(paths);
  if (choice.noTests && requiredTaskTests(classification, paths).length > 0) {
    throw new Error("verify:task --no-tests is available only for an all-Markdown change set.");
  }
  for (const command of taskGateCommands(classification)) {
    run(pnpm, command === "eslint" ? ["exec", "eslint", "."] : [command]);
  }
  for (const test of plannedTaskTests(classification, paths, choice)) run(pnpm, test);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
