import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

export function collectMarkdownRelativeLinks(repoRoot = defaultRepoRoot) {
  const links = [];

  for (const sourcePath of trackedMarkdownFiles(repoRoot)) {
    let fenced = false;
    const lines = readFileSync(join(repoRoot, sourcePath), "utf8").split("\n");

    for (const line of lines) {
      if (/^\s*(```|~~~)/u.test(line)) {
        fenced = !fenced;
        continue;
      }

      if (fenced) {
        continue;
      }

      for (const match of line.matchAll(/(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/gu)) {
        const targetPath = match[1].replace(/[?#].*$/u, "");

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

function validateImports(repoRoot, specifiers) {
  const failures = [];

  for (const { packageDirectory, specifier } of specifiers) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", "await import(process.argv[1])", specifier],
      {
        cwd: join(repoRoot, packageDirectory),
        encoding: "utf8",
      },
    );

    if (result.status !== 0) {
      failures.push(
        `Broken package export: ${packageDirectory}: ${specifier}\n${result.stderr.trim()}`,
      );
    }
  }

  return failures;
}

function validateLinks(repoRoot, links) {
  return links
    .filter(
      ({ sourcePath, targetPath }) =>
        !existsSync(resolve(repoRoot, dirname(sourcePath), targetPath)),
    )
    .map(({ sourcePath, targetPath }) => `Broken Markdown link: ${sourcePath} -> ${targetPath}`);
}

export function runReleaseReadiness(repoRoot = defaultRepoRoot) {
  const exports = collectRuntimeExportSpecifiers(repoRoot);
  const links = collectMarkdownRelativeLinks(repoRoot);
  const failures = [...validateImports(repoRoot, exports), ...validateLinks(repoRoot, links)];

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
