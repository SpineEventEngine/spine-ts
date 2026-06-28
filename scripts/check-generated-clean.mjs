import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = "packages/proto/src/generated";

const diffResult = spawnSync("git", ["diff", "--exit-code", "--", generatedPath], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (diffResult.error !== undefined) {
  console.error(`Failed to check generated output drift: ${diffResult.error.message}`);
  process.exit(1);
}

if (diffResult.signal !== null) {
  console.error(`Generated output drift check terminated by signal ${diffResult.signal}.`);
  process.exit(1);
}

const untrackedResult = spawnSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "--", generatedPath],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);

if (untrackedResult.error !== undefined) {
  console.error(`Failed to check untracked generated output: ${untrackedResult.error.message}`);
  process.exit(1);
}

if (untrackedResult.signal !== null) {
  console.error(`Untracked generated output check terminated by signal ${untrackedResult.signal}.`);
  process.exit(1);
}

const hasTrackedDrift = diffResult.status !== 0;
const untrackedFiles = untrackedResult.stdout.trim();

if (hasTrackedDrift || untrackedFiles.length > 0) {
  console.error("Generated proto output is not clean after generation.");
  if (hasTrackedDrift) {
    console.error(diffResult.stdout);
    console.error(diffResult.stderr);
  }
  if (untrackedFiles.length > 0) {
    console.error(`Untracked generated files:\n${untrackedFiles}`);
  }
  process.exit(1);
}

console.log("Generated proto output is clean.");
