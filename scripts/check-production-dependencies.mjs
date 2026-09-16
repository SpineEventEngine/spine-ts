import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { productionDependencyProblemsFromYaml } from "./production-lockfile-policy.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Returns production lockfile resolutions prohibited by the release policy.
 *
 * @param lockfile Text of the workspace pnpm lockfile.
 * @returns Release-policy violations for forbidden production dependency resolutions.
 */
export function productionDependencyProblems(lockfile) {
  return productionDependencyProblemsFromYaml(lockfile);
}

/**
 * Reads and checks production dependencies from a checkout lockfile.
 *
 * @param root Checkout containing the pnpm lockfile to inspect.
 * @returns Lockfile policy violations; throws if the lockfile cannot be read.
 */
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
