import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ref = "origin/main";
const inventoryPath = "build-protocol/release/COMPLETED_TASK_INTEGRATION_INVENTORY.tsv";
const completionLanguage = /\b(?:complete|completed|accepted|closed|integrated)\b/i;

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

const allCommits = git(["rev-list", "--all"]).split("\n");
const originMainCommits = new Set(git(["rev-list", ref]).split("\n"));

function commitFor(token) {
  const matches = allCommits.filter((commit) => commit.startsWith(token.toLowerCase()));
  return matches.length === 1 ? matches[0] : undefined;
}

const taskPaths = git(["ls-tree", "-r", "--name-only", ref, "build-protocol/tasks"])
  .split("\n")
  .filter((path) => path.endsWith("/TASK.md"));

const records = taskPaths
  .map((path) => ({ path, text: git(["show", `${ref}:${path}`]) }))
  .filter(({ text }) => completionLanguage.test(text.split("\n").slice(0, 12).join("\n")));

if (records.length !== 176) {
  throw new Error(`Expected 176 completion/acceptance records, found ${records.length}.`);
}

const rows = [
  [
    "task_id",
    "task_path",
    "qualifying_status_evidence",
    "extracted_resolved_commit_ids",
    "origin_main_ancestry",
    "unresolved_non_commit_tokens",
    "disposition_or_canonical_reference",
  ].join("\t"),
];

for (const { path, text } of records) {
  const topLevelLines = text.split("\n").slice(0, 12);
  const statusEvidence = topLevelLines.filter((line) => completionLanguage.test(line)).join(" | ");
  const tokens = [...new Set(text.match(/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/gi) ?? [])];
  const resolved = [];
  const unresolved = [];

  for (const token of tokens) {
    const commit = commitFor(token);
    if (commit === undefined) {
      unresolved.push(token);
    } else if (!resolved.includes(commit)) {
      resolved.push(commit);
    }
  }

  const allAncestors = resolved.every((commit) => originMainCommits.has(commit));
  const taskId = path.match(/\/([^/]+)\/TASK\.md$/u)[1];
  const disposition =
    taskId === "T-0077-dirty-worktree-recovery"
      ? `${ref}@e6bdc065; preservation-only rescue def03a41dc187205ede71c1101afba05a7f603f4 (non-integration)`
      : resolved.length > 0
        ? `${ref}@e6bdc065`
        : /T-0012|T-0013/u.test(taskId)
          ? "legacy-precedence-in-audit"
          : "record-only/no-commit-evidence";

  rows.push(
    [
      taskId,
      path,
      statusEvidence || "completion/acceptance language in first twelve lines",
      resolved.join(",") || "-",
      resolved.length === 0
        ? "no-resolved-commit"
        : allAncestors
          ? "all-resolved-commits-are-ancestors"
          : "contains-nonancestor-resolved-commit",
      unresolved.join(",") || "-",
      disposition,
    ]
      .map(escapeTsv)
      .join("\t"),
  );
}

writeFileSync(inventoryPath, `${rows.join("\n")}\n`);
