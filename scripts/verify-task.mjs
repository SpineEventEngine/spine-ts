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
      ? ["--coverage", ...choice.sources.map((source) => `--coverage.include=${source}`)]
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
  for (const command of taskGateCommands(classifyTaskChanges(changedPaths()))) {
    run(pnpm, command === "eslint" ? ["exec", "eslint", "."] : [command]);
  }
  if (choice.noTests) return;
  run(pnpm, vitestArgs(choice));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
