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
]);
const sourceExtensions = new Set([
  ".ts",
  ".mts",
  ".mjs",
  ".json",
  ".proto",
  ".md",
  ".yaml",
  ".yml",
]);
const forbidden = [
  ["RemovalQuarantine", /\bRemovalQuarantine\b/gu],
  ["removal fingerprint", /\bRemovalFingerprint\b|\bremoval[-_ ]fingerprint\b/giu],
  ["delivery attempt", /\bDeliveryAttempt\b/gu],
  ["attempt exhaustion", /\bAttemptExhaustion\b/gu],
  ["retry decision", /\bRetryDecision\b/gu],
  ["revoked-session facility", /\bRevokedSession\b|\brevoked[-_ ]session\b/giu],
  [
    "versioned discovery key",
    /\bApplicationNodeLease:v1\b|\bversioned discovery[-_ ]?(?:storage )?key\b/giu,
  ],
  ["retired validation package", /@spine-event-engine\/validation-ts\b/gu],
  ["storage fingerprint", /\bcompatibilityFingerprint\b|\bschema fingerprint\b/giu],
];

function files(root, directory = root) {
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

function truthfulNegative(line) {
  return /\b(?:no|without|removed|delete(?:d)?|does not|never)\b/iu.test(line);
}

export function auditWave8CurrentState(root = repoRoot) {
  const problems = [];
  for (const path of files(root)) {
    const markdown = path.endsWith(".md");
    const lines = readFileSync(join(root, path), "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      for (const [name, pattern] of forbidden) {
        pattern.lastIndex = 0;
        if (!pattern.test(line) || (markdown && truthfulNegative(line))) continue;
        problems.push(`${path}:${index + 1}: forbidden Wave 8 artifact: ${name}`);
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
