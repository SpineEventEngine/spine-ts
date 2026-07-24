import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { lstatIfPresent } from "./generated-path-safety.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPathPattern = /^(?:packages\/[^/]+|examples\/[^/]+)\/generated\//u;
const rootFilePattern = /^[^/]+\.(?:json|md|yaml|yml|mjs|ts)$/u;
const rootDotJsonPattern = /^\.[^/]+\.json$/u;

function isSupportedFormatPath(path) {
  if (generatedPathPattern.test(path) || path.startsWith("packages/proto/src/generated/")) {
    return false;
  }

  if (rootFilePattern.test(path) || rootDotJsonPattern.test(path)) {
    return true;
  }

  if (path.startsWith("docs/")) {
    return path.endsWith(".md");
  }

  if (path.startsWith("packages/") || path.startsWith("examples/")) {
    return /\.(?:json|md|ts)$/u.test(path);
  }

  if (path.startsWith("proto/")) {
    return path.endsWith(".md");
  }

  if (path.startsWith("scripts/")) {
    return path.endsWith(".mjs");
  }

  if (path.startsWith("build-protocol/")) {
    return path.endsWith(".md");
  }

  return false;
}

export function selectFormatFiles(paths) {
  return paths.filter(isSupportedFormatPath).sort();
}

export function trackedFiles(root = repoRoot, status = lstatIfPresent) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.error !== undefined) {
    throw new Error(`Failed to list tracked files: ${result.error.message}`);
  }

  if (result.signal !== null) {
    throw new Error(`Tracked file listing terminated by signal ${result.signal}.`);
  }

  if (result.status !== 0) {
    throw new Error(`Tracked file listing failed:\n${result.stderr}${result.stdout}`);
  }

  return result.stdout
    .split("\0")
    .filter((path) => path.length > 0 && status(resolve(root, path)) !== undefined);
}

function runPrettier(mode, files) {
  if (files.length === 0) {
    console.log("No tracked files matched the formatting set.");
    return 0;
  }

  const result = spawnSync("prettier", [mode, ...files], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    console.error(`Failed to start Prettier: ${result.error.message}`);
    return 1;
  }

  if (result.signal !== null) {
    console.error(`Prettier terminated by signal ${result.signal}.`);
    return 1;
  }

  return result.status ?? 1;
}

function parseMode(argv) {
  if (argv.length !== 1 || (argv[0] !== "--check" && argv[0] !== "--write")) {
    throw new Error("Usage: node scripts/format-files.mjs <--check|--write>");
  }

  return argv[0] === "--check" ? "--check" : "--write";
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    process.exit(runPrettier(parseMode(process.argv.slice(2)), selectFormatFiles(trackedFiles())));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
