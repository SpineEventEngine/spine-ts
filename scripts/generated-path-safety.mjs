import { lstatSync } from "node:fs";
import { isAbsolute, join, parse, sep } from "node:path";

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
