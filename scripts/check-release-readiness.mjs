import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultImportTimeoutMs = 10_000;

function packageDirectories(repoRoot) {
  const packagesRoot = join(repoRoot, "packages");

  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name))
    .filter((directory) => existsSync(join(directory, "package.json")))
    .sort();
}

function runtimeTarget(exportTarget) {
  if (typeof exportTarget === "string") {
    return exportTarget;
  }

  if (exportTarget !== null && typeof exportTarget === "object") {
    return runtimeTarget(exportTarget.default ?? exportTarget.import);
  }

  return undefined;
}

function matchingWildcardPaths(packageRoot, target) {
  const wildcardIndex = target.indexOf("*");
  const before = target.slice(0, wildcardIndex);
  const after = target.slice(wildcardIndex + 1);
  const searchRoot = join(packageRoot, dirname(before));
  const paths = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        const candidate = `./${relative(packageRoot, path).replaceAll("\\", "/")}`;

        if (candidate.startsWith(before) && candidate.endsWith(after)) {
          paths.push(candidate.slice(before.length, candidate.length - after.length));
        }
      }
    }
  }

  if (existsSync(searchRoot)) {
    visit(searchRoot);
  }

  return paths.sort();
}

export function collectRuntimeExportSpecifiers(repoRoot = defaultRepoRoot) {
  const specifiers = [];

  for (const packageRoot of packageDirectories(repoRoot)) {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const packageDirectory = relative(repoRoot, packageRoot).replaceAll("\\", "/");

    for (const [subpath, exportTarget] of Object.entries(manifest.exports ?? {})) {
      const target = runtimeTarget(exportTarget);

      if (target === undefined) {
        continue;
      }

      if (!subpath.includes("*")) {
        specifiers.push({
          packageDirectory,
          specifier: subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
        });
        continue;
      }

      for (const wildcardPath of matchingWildcardPaths(packageRoot, target)) {
        specifiers.push({
          packageDirectory,
          specifier: `${manifest.name}/${subpath.slice(2).replace("*", wildcardPath)}`,
        });
      }
    }
  }

  return specifiers.sort(
    (left, right) =>
      left.packageDirectory.localeCompare(right.packageDirectory) ||
      left.specifier.localeCompare(right.specifier),
  );
}

function trackedMarkdownFiles(repoRoot) {
  return execFileSync("git", ["ls-files", "--", "*.md"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .sort();
}

function isRelativeFileReference(target) {
  return (
    target.length > 0 &&
    !target.startsWith("#") &&
    !target.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:/iu.test(target)
  );
}

function closingCodeDelimiter(line, delimiter, fromIndex) {
  let index = line.indexOf(delimiter, fromIndex);

  while (index !== -1) {
    const beforeIsTick = line[index - 1] === "`";
    const afterIsTick = line[index + delimiter.length] === "`";

    if (!beforeIsTick && !afterIsTick) {
      return index;
    }

    index = line.indexOf(delimiter, index + delimiter.length);
  }

  return -1;
}

function stripInlineCode(line) {
  let result = "";
  let index = 0;

  while (index < line.length) {
    if (line[index] !== "`") {
      result += line[index];
      index += 1;
      continue;
    }

    let delimiterEnd = index + 1;

    while (line[delimiterEnd] === "`") {
      delimiterEnd += 1;
    }

    const delimiter = line.slice(index, delimiterEnd);
    const closingIndex = closingCodeDelimiter(line, delimiter, delimiterEnd);

    if (closingIndex === -1) {
      result += delimiter;
      index = delimiterEnd;
      continue;
    }

    const codeEnd = closingIndex + delimiter.length;
    result += " ".repeat(codeEnd - index);
    index = codeEnd;
  }

  return result;
}

function fenceDelimiter(line) {
  const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);

  return match?.[1];
}

function collectLineTargets(line) {
  const targets = [];
  const reference = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>\n]+)>|([^\s]+))/u.exec(line);

  if (reference !== null) {
    targets.push(reference[1] ?? reference[2]);
  }

  for (const match of line.matchAll(
    /(?<!!)\[[^\]]+\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)]*\)))?\s*\)/gu,
  )) {
    targets.push(match[1] ?? match[2]);
  }

  return targets;
}

export function collectMarkdownRelativeLinks(repoRoot = defaultRepoRoot) {
  const links = [];

  for (const sourcePath of trackedMarkdownFiles(repoRoot)) {
    let activeFence;
    const lines = readFileSync(join(repoRoot, sourcePath), "utf8").split("\n");

    for (const line of lines) {
      const delimiter = fenceDelimiter(line);

      if (activeFence !== undefined) {
        if (
          delimiter !== undefined &&
          delimiter[0] === activeFence[0] &&
          delimiter.length >= activeFence.length
        ) {
          activeFence = undefined;
        }
        continue;
      }

      if (delimiter !== undefined) {
        activeFence = delimiter;
        continue;
      }

      for (const target of collectLineTargets(stripInlineCode(line))) {
        const targetPath = target.replace(/[?#].*$/u, "");

        if (isRelativeFileReference(targetPath)) {
          links.push({ sourcePath, targetPath });
        }
      }
    }
  }

  return links.sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.targetPath.localeCompare(right.targetPath),
  );
}

function validateImports(repoRoot, specifiers, importTimeoutMs) {
  const failures = [];

  for (const { packageDirectory, specifier } of specifiers) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", "await import(process.argv[1])", specifier],
      {
        cwd: join(repoRoot, packageDirectory),
        encoding: "utf8",
        killSignal: "SIGKILL",
        timeout: importTimeoutMs,
      },
    );

    if (result.error?.code === "ETIMEDOUT") {
      failures.push(
        `Timed out package export after ${importTimeoutMs} ms: ${packageDirectory}: ${specifier}`,
      );
      continue;
    }

    if (result.status !== 0) {
      failures.push(
        `Broken package export: ${packageDirectory}: ${specifier}\n${result.stderr.trim()}`,
      );
    }
  }

  return failures;
}

function validateLinks(repoRoot, links) {
  const failures = [];

  for (const { sourcePath, targetPath } of links) {
    const resolvedTarget = resolve(repoRoot, dirname(sourcePath), targetPath);
    const relativeTarget = relative(repoRoot, resolvedTarget);
    const escapesRepository =
      relativeTarget === ".." || relativeTarget.startsWith("../") || isAbsolute(relativeTarget);

    if (escapesRepository) {
      failures.push(`Escaping Markdown link: ${sourcePath} -> ${targetPath}`);
      continue;
    }

    if (!existsSync(resolvedTarget)) {
      failures.push(`Broken Markdown link: ${sourcePath} -> ${targetPath}`);
    }
  }

  return failures;
}

export function runReleaseReadiness(
  repoRoot = defaultRepoRoot,
  { importTimeoutMs = defaultImportTimeoutMs } = {},
) {
  if (!Number.isFinite(importTimeoutMs) || importTimeoutMs <= 0) {
    throw new Error(`Package import timeout must be a positive finite number: ${importTimeoutMs}`);
  }

  const exports = collectRuntimeExportSpecifiers(repoRoot);
  const links = collectMarkdownRelativeLinks(repoRoot);
  const failures = [
    ...validateImports(repoRoot, exports, importTimeoutMs),
    ...validateLinks(repoRoot, links),
  ];

  console.log(
    `Release readiness: ${exports.length} package imports; ${links.length} relative Markdown links.`,
  );

  if (failures.length > 0) {
    throw new Error(`Release readiness failed:\n${failures.join("\n")}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReleaseReadiness();
}
