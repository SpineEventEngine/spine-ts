import { spawnSync } from "node:child_process";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Tests whether a Proto source uses an approved rejection basename.
 */
export function isRejectionSourceName(sourceName) {
  const name = basename(sourceName);
  return name === "rejections.proto" || name.endsWith("_rejections.proto");
}

/**
 * Reports tracked rejection-like Proto sources outside the approved convention.
 */
export function checkRejectionSourceNames(sourceNames) {
  return sourceNames
    .filter((sourceName) => basename(sourceName).includes("rejection"))
    .filter((sourceName) => !isRejectionSourceName(sourceName))
    .sort()
    .map((sourceName) => `${sourceName} must use "rejections.proto" or "*_rejections.proto".`);
}

export function trackedProtoSources(run = spawnSync) {
  const result = run("git", ["ls-files", "-z", "--", "*.proto"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined || result.status !== 0) {
    throw result.error ?? new Error("Could not enumerate tracked Proto sources.");
  }
  return result.stdout.split("\0").filter(Boolean);
}

export function main(sourceNames = trackedProtoSources()) {
  const failures = checkRejectionSourceNames(sourceNames);
  if (failures.length === 0) {
    console.log("Rejection source naming checks passed.");
    return 0;
  }
  for (const failure of failures) console.error(failure);
  return 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
