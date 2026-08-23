import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Returns production lockfile resolutions prohibited by the release policy.
 *
 * @param {string} lockfile pnpm lockfile source
 * @returns {string[]} deterministic policy violations
 */
export function productionDependencyProblems(lockfile) {
  const packages = /^packages:\n([\s\S]*?)^snapshots:/mu.exec(lockfile)?.[1] ?? "";
  const snapshots = /^snapshots:\n([\s\S]*)$/mu.exec(lockfile)?.[1] ?? "";
  const resolutions = `${packages}\n${snapshots}`;
  const problems = [];
  if (/^\s{2}brace-expansion@2\.1\.3:/mu.test(resolutions))
    problems.push("Production lockfile resolves vulnerable brace-expansion@2.1.3.");
  if (/^\s{2}uuid@9\.0\.1:/mu.test(resolutions))
    problems.push("Production lockfile resolves vulnerable uuid@9.0.1.");
  return problems;
}

export function checkProductionDependencies(root = repositoryRoot) {
  return productionDependencyProblems(readFileSync(join(root, "pnpm-lock.yaml"), "utf8"));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const problems = checkProductionDependencies();
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
