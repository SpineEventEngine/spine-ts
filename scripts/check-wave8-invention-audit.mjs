import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const historicalPrefixes = [
  "build-protocol/planning/",
  "build-protocol/tasks/",
  "build-protocol/work-logs/",
  "build-protocol/reviews/",
  "build-protocol/release/",
  "build-protocol/reports/",
  "build-protocol/security/",
];
const excludedPrefixes = [
  ...historicalPrefixes,
  ".git/",
  "node_modules/",
  "coverage/",
  "docs/api/reference/",
  "scripts/",
];
const excludedFiles = new Set([
  "docs/spine-ts-extra-concepts-vs-core-jvm.md",
  "DECISION_LOG.md",
  "build-protocol/DECISION_LOG.md",
  "build-protocol/PROJECT_COMPLETION_PLAN.md",
  ".wave8-forbidden-artifacts.json",
]);
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".json",
  ".proto",
  ".md",
  ".yaml",
  ".yml",
]);
export const manifest = JSON.parse(
  readFileSync(join(repoRoot, ".wave8-forbidden-artifacts.json"), "utf8"),
);
export const forbiddenArtifacts = manifest.map(({ name, fixture }) => [name, fixture]);
const forbidden = manifest.map(({ name, pattern, flags, fixture }) => [
  name,
  new RegExp(pattern, flags),
  fixture,
]);
export function files(root, directory = root) {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const repoPath = relative(root, path).replaceAll("\\", "/");
    if (
      excludedPrefixes.some((prefix) => repoPath.startsWith(prefix)) ||
      excludedFiles.has(repoPath) ||
      repoPath.includes("/dist/") ||
      repoPath.includes("/test/")
    )
      continue;
    if (entry.isDirectory()) result.push(...files(root, path));
    else if (entry.isFile() && sourceExtensions.has(`.${entry.name.split(".").at(-1)}`))
      result.push(repoPath);
  }
  return result.sort();
}

function trackedFiles(root) {
  try {
    return execFileSync("git", ["ls-files", "--cached"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean)
      .filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix)))
      .filter((path) => !excludedFiles.has(path))
      .filter((path) => !path.includes("/dist/") && !path.includes("/test/"))
      .filter((path) => sourceExtensions.has(`.${path.split(".").at(-1)}`))
      .sort();
  } catch (error) {
    throw new Error(`Wave 8 audit requires tracked-file enumeration: ${String(error)}`);
  }
}

function truthfulNegative(path, line, match) {
  if (!path.endsWith(".md")) return false;
  const start = Math.max(
    line.lastIndexOf(".", match.index - 1),
    line.lastIndexOf("!", match.index - 1),
    line.lastIndexOf("?", match.index - 1),
    line.lastIndexOf(";", match.index - 1),
  );
  const clause = line.slice(start + 1);
  const occurrence = match[0] ?? "";
  const before = line.slice(start + 1, match.index);
  const after = line.slice(match.index + occurrence.length);
  if (/\b(?:but|yet|however)\b/iu.test(clause)) return false;
  const noList = before.match(/\bno\s+(.+)$/iu)?.[1];
  return (
    /\b(?:no|without)\s*$/iu.test(before) ||
    (noList !== undefined &&
      !/\b(?:is|are|was|were|remain(?:s)?|exist(?:s)?|persist(?:s)?|support(?:s)?|contain(?:s)?|has|have)\b/iu.test(
        noList,
      )) ||
    /\b(?:does not|never)\s+(?:persist|store|use|support|contain|have)\s*$/iu.test(before) ||
    /^\s+(?:is|are|was|were|has been|have been)\s+(?:removed|deleted|absent|unsupported)\b/iu.test(
      after,
    )
  );
}

export function auditWave8CurrentState(root = repoRoot, enumerate = trackedFiles) {
  const problems = [];
  for (const path of enumerate(root)) {
    const lines = readFileSync(join(root, path), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      for (const [name, pattern] of forbidden) {
        pattern.lastIndex = 0;
        let positive = false;
        for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
          if (!truthfulNegative(path, line, match)) {
            positive = true;
            break;
          }
        }
        if (positive) problems.push(`${path}:${index + 1}: forbidden Wave 8 artifact: ${name}`);
      }
    }
  }
  return problems.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = auditWave8CurrentState();
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exitCode = 1;
  }
}
