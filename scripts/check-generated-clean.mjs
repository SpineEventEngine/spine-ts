import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = "packages/proto/generated";

const trackedResult = spawnSync("git", ["ls-files", "--", generatedPath], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (trackedResult.error !== undefined) {
  console.error(`Failed to check tracked generated output: ${trackedResult.error.message}`);
  process.exit(1);
}

if (trackedResult.signal !== null) {
  console.error(`Tracked generated output check terminated by signal ${trackedResult.signal}.`);
  process.exit(1);
}

const ignoredResult = spawnSync(
  "git",
  ["check-ignore", "--quiet", "--", `${generatedPath}/.cleanup-enforcement-check`],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);

if (ignoredResult.error !== undefined) {
  console.error(`Failed to check generated output ignore rule: ${ignoredResult.error.message}`);
  process.exit(1);
}

if (ignoredResult.signal !== null) {
  console.error(`Generated output ignore check terminated by signal ${ignoredResult.signal}.`);
  process.exit(1);
}

const trackedFiles = trackedResult.stdout.trim();
const generatedDirectory = resolve(repoRoot, generatedPath);
const generatedDirectoryMissing = !existsSync(generatedDirectory);
const generatedDirectoryNotIgnored = ignoredResult.status !== 0;

if (trackedFiles.length > 0 || generatedDirectoryMissing || generatedDirectoryNotIgnored) {
  console.error("Generated proto output is not clean.");

  if (trackedFiles.length > 0) {
    console.error(`Tracked generated files:\n${trackedFiles}`);
  }

  if (generatedDirectoryMissing) {
    console.error(`Generated directory is missing: ${generatedPath}`);
  }

  if (generatedDirectoryNotIgnored) {
    console.error(`Generated directory is not ignored by Git: ${generatedPath}`);
  }

  process.exit(1);
}

console.log("Generated proto output is ignored and untracked.");
