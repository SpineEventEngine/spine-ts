import { lstatSync } from "node:fs";
import { isAbsolute, join, parse, sep } from "node:path";

/**
 * Reads filesystem metadata while treating a missing path as absent rather than exceptional.
 *
 * @param path Filesystem path to inspect without following symbolic links.
 * @returns Link metadata, or undefined when the path does not exist.
 */
export function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/**
 * Lists existing ancestor links that make a repository-relative generated path unsafe to write.
 *
 * @param repoRoot Repository boundary against which ancestors are checked.
 * @param repoRelativePath Generated path relative to that boundary.
 * @returns Repository-relative symlink ancestors, ordered from the root toward the target.
 */
export function findSymlinkedAncestors(repoRoot, repoRelativePath) {
  const parts = repoRelativePath.split(/[\\/]+/).filter(Boolean);
  const failures = [];
  let current = isAbsolute(repoRelativePath) ? parse(repoRelativePath).root : repoRoot;

  for (let index = 0; index < parts.length - 1; index += 1) {
    current = join(current, parts[index]);

    const stat = lstatIfPresent(current);

    if (stat === undefined) {
      continue;
    }

    const displayPath = parts.slice(0, index + 1).join("/");

    if (stat.isSymbolicLink()) {
      failures.push(`symlink ancestor: ${displayPath}`);
      continue;
    }

    if (!stat.isDirectory()) {
      failures.push(`not a directory: ${displayPath}`);
    }
  }

  return failures.map((failure) => failure.split(sep).join("/"));
}
