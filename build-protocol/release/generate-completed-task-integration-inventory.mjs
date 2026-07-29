import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const baseline = "e6bdc0653a55c5c09a1af3742e74626b81c43217";
const inventoryPath = "build-protocol/release/COMPLETED_TASK_INTEGRATION_INVENTORY.tsv";
const completionLanguage = /\b(?:complete|completed|accepted|closed|integrated|done)\b/i;
const nonCompletionStatus = /\b(?:superseded|abandoned)\b/i;
const preservationCommits = new Map([
  [
    "def03a41dc187205ede71c1101afba05a7f603f4",
    "rescue/dirty-root-20260729 (preservation-only/non-integration)",
  ],
  [
    "cf608c7b4dadfa75cb1ea4631cdca8760e21c123",
    "rescue/T-0048-planning-20260729 (preservation-only/non-integration)",
  ],
]);

function escapeTsv(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\t", "\\t")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function explicitStatusEvidence(text) {
  const lines = text.split("\n");
  const firstSecondLevelHeading = lines.findIndex((line) => /^##\s+(?!Status\s*$)/u.test(line));
  const topLevelEnd = firstSecondLevelHeading === -1 ? lines.length : firstSecondLevelHeading;

  for (const line of lines.slice(0, topLevelEnd)) {
    if (/^Status:\s*.+$/iu.test(line)) {
      return line;
    }
  }

  const statusHeading = lines
    .slice(0, topLevelEnd)
    .findIndex((line) => /^## Status\s*$/iu.test(line));
  if (statusHeading !== -1) {
    for (const line of lines.slice(statusHeading + 1)) {
      if (line.trim().length > 0) {
        return `Status: ${line.trim()}`;
      }
    }
  }

  return undefined;
}

const baselineCommits = git(["rev-list", baseline]).split("\n");
const baselineCommitSet = new Set(baselineCommits);

function commitFor(token) {
  const normalized = token.toLowerCase();
  const baselineMatches = baselineCommits.filter((commit) => commit.startsWith(normalized));
  if (baselineMatches.length === 1) {
    return { commit: baselineMatches[0], preservation: undefined };
  }
  const preservationMatches = [...preservationCommits.keys()].filter((commit) =>
    commit.startsWith(normalized),
  );
  return preservationMatches.length === 1
    ? {
        commit: preservationMatches[0],
        preservation: preservationCommits.get(preservationMatches[0]),
      }
    : undefined;
}

const taskPaths = git(["ls-tree", "-r", "--name-only", baseline, "build-protocol/tasks"])
  .split("\n")
  .filter((path) => path.endsWith("/TASK.md"));
const records = taskPaths
  .map((path) => ({ path, text: git(["show", `${baseline}:${path}`]) }))
  .map((record) => ({ ...record, statusEvidence: explicitStatusEvidence(record.text) }))
  .filter(
    ({ statusEvidence }) =>
      statusEvidence !== undefined &&
      completionLanguage.test(statusEvidence) &&
      !nonCompletionStatus.test(statusEvidence),
  );

if (records.length !== 172) {
  throw new Error(`Expected 172 explicit completion/acceptance records, found ${records.length}.`);
}

const rows = [
  [
    "task_id",
    "task_path",
    "qualifying_status_evidence",
    "extracted_resolved_commit_ids",
    "baseline_ancestry",
    "unresolved_non_commit_tokens",
    "disposition_or_canonical_reference",
  ].join("\t"),
];

for (const { path, text, statusEvidence } of records) {
  const tokens = [...new Set(text.match(/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/gi) ?? [])];
  const resolved = [];
  const unresolved = [];

  for (const token of tokens) {
    const resolution = commitFor(token);
    if (resolution === undefined) {
      unresolved.push(token);
    } else if (!resolved.some(({ commit }) => commit === resolution.commit)) {
      resolved.push(resolution);
    }
  }

  const preservation = resolved.filter(({ preservation: value }) => value !== undefined);
  const allAncestors = resolved.every(({ commit }) => baselineCommitSet.has(commit));
  const taskId = path.match(/\/([^/]+)\/TASK\.md$/u)[1];
  const disposition =
    taskId === "T-0077-dirty-worktree-recovery"
      ? `baseline@${baseline}; ${preservationCommits.get("def03a41dc187205ede71c1101afba05a7f603f4")}`
      : resolved.length > 0
        ? `baseline@${baseline}`
        : /T-0012|T-0013/u.test(taskId)
          ? "legacy-precedence-in-audit"
          : "record-only/no-commit-evidence";

  rows.push(
    [
      taskId,
      path,
      statusEvidence,
      resolved.map(({ commit }) => commit).join(",") || "-",
      resolved.length === 0
        ? "no-resolved-commit"
        : preservation.length > 0
          ? allAncestors
            ? "baseline-ancestors-plus-preservation"
            : "preservation-only-or-mixed"
          : "all-resolved-commits-are-baseline-ancestors",
      unresolved.join(",") || "-",
      disposition,
    ]
      .map(escapeTsv)
      .join("\t"),
  );
}

const generated = `${rows.join("\n")}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(inventoryPath, "utf8") !== generated) {
    throw new Error(`${inventoryPath} is not reproducible from baseline ${baseline}.`);
  }
  process.stdout.write(`${inventoryPath} matches baseline ${baseline}.\n`);
} else {
  writeFileSync(inventoryPath, generated);
}
