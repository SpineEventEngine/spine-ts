import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function codeWithoutCommentsOrStrings(source) {
  let result = "";
  let blockComment = false;
  let string = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += current === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (string) {
      result += current === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === '"') string = false;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (current === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (current === '"') {
      string = true;
      result += " ";
      continue;
    }
    result += current;
  }
  return result;
}

function isDeclaration(line) {
  return (
    /^\s*(?:repeated\s+)?[A-Za-z_][\w.<>]*\s+[A-Za-z_]\w*\s*=\s*\d+/u.test(line) ||
    /^\s*[A-Z][A-Z0-9_]*\s*=\s*\d+/u.test(line) ||
    /^\s*(?:message|enum|service|rpc)\s+[A-Za-z_]\w*/u.test(line)
  );
}

function opensDeclarationBlock(line) {
  return /^\s*(?:message|enum|service|oneof)\s+[A-Za-z_]\w*\s*\{\s*(?:\/\/.*)?$/u.test(line);
}

/**
 * Checks one authored Proto source for mechanically enforceable declaration-style violations.
 *
 * @param source Proto text whose comments and strings are excluded from style matching.
 * @param path Display path included in diagnostics.
 * @returns Style diagnostic strings for malformed declaration formatting.
 */
export function ownedProtoStyleFailures(source, path = "authored.proto") {
  const failures = [];
  const code = codeWithoutCommentsOrStrings(source);
  if (/\boptional\b/u.test(code)) failures.push(`${path}: authored Proto must not use optional`);
  if (source.startsWith("\n") || source.startsWith("\r")) {
    failures.push(`${path}: file must not begin with an empty line`);
  }

  const lines = source.split(/\r?\n/u);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!isDeclaration(lines[lineIndex] ?? "")) continue;
    let commentStart = lineIndex;
    while (commentStart > 0 && /^\s*\/\//u.test(lines[commentStart - 1] ?? "")) {
      commentStart -= 1;
    }
    if (commentStart === lineIndex) continue;
    const precedingLine = lines[commentStart - 1] ?? "";
    if (
      commentStart > 0 &&
      precedingLine.trim().length !== 0 &&
      !opensDeclarationBlock(precedingLine)
    ) {
      failures.push(`${path}:${commentStart + 1}: declaration documentation needs a blank line`);
    }
    const comments = lines.slice(commentStart, lineIndex).map((line) => line.trim());
    const hasParagraphBreak = comments.slice(0, -1).some((line) => line === "//");
    if (hasParagraphBreak && comments.at(-1) !== "//") {
      failures.push(`${path}:${lineIndex + 1}: multi-paragraph comment must end with //`);
    }
  }
  return failures;
}

/**
 * Checks source-role patterns that conflict with the repository's authored Proto conventions.
 *
 * @param source Proto text to classify using observable syntax.
 * @param path Display path included in diagnostics.
 * @returns Source-role diagnostic strings; semantic domain suitability remains reviewer judgment.
 */
export function protoRoleFailures(source, path) {
  const state = /(?:^|[_/])states\.proto$/u.test(path);
  const signal = /(?:^|[_/])(commands|events)\.proto$/u.test(path);
  const entity = /\(entity\)\.kind\s*=/u.test(source);
  if (state && !entity) return [`${path}: state source must declare an (entity).kind option`];
  if (signal && entity) return [`${path}: command/event source must not declare an entity state`];
  return [];
}

/**
 * Rejects generic fixture basenames that conceal the Proto's domain purpose.
 *
 * @param path Repository-relative authored Proto path.
 * @returns Naming diagnostics for disallowed fixture filenames.
 */
export function fixtureProtoNameFailures(path) {
  if (!/^packages\/[^/]+\/test-fixtures\/proto\//u.test(path)) return [];
  return /(?:commands|events|states|identifiers|rejections|types)\.proto$/u.test(basename(path))
    ? []
    : [`${path}: test-fixture Proto filename needs a role suffix`];
}

/**
 * Checks changed authored Protos and prints style, role, and filename diagnostics to stderr.
 *
 * @param root Repository root from which Git paths and Proto files are resolved.
 * @returns Zero when no diagnostics are found, otherwise one.
 */
export function checkOwnedProtoStyle(root = repositoryRoot) {
  const manifestPath = resolve(root, "packages/proto/proto/spine-sources.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const frozen = new Set((manifest.sources ?? []).map(({ localPath }) => localPath));
  const tracked = gitLines(root, ["ls-files", "*.proto"]);
  const untracked = gitLines(root, ["ls-files", "--others", "--exclude-standard", "--", "*.proto"]);
  const changed = changedProtoPaths(root);
  return [...new Set([...tracked, ...untracked])]
    .filter(
      (path) =>
        !frozen.has(path) &&
        !path.includes("/.generated-") &&
        (path.startsWith("packages/proto/proto/") || changed.has(path)),
    )
    .filter((path) => existsSync(resolve(root, path)))
    .flatMap((localPath) => {
      const source = readFileSync(resolve(root, localPath), "utf8");
      return [
        ...ownedProtoStyleFailures(source, localPath),
        ...protoRoleFailures(source, localPath),
        ...fixtureProtoNameFailures(localPath),
      ];
    });
}

function changedProtoPaths(root) {
  const base = gitLines(root, ["merge-base", "origin/master", "HEAD"])[0];
  if (base === undefined) throw new Error("Unable to classify changed Proto sources.");
  const paths = new Set();
  for (const args of [
    ["diff", "--name-only", `${base}...HEAD`, "--", "*.proto"],
    ["diff", "--name-only", "--", "*.proto"],
    ["diff", "--name-only", "--cached", "--", "*.proto"],
    ["ls-files", "--others", "--exclude-standard", "--", "*.proto"],
  ]) {
    for (const path of gitLines(root, args)) paths.add(path);
  }
  return paths;
}

function gitLines(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    throw new Error(`Unable to classify Proto sources with git ${args.join(" ")}.`);
  }
  return result.stdout.split("\n").filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = checkOwnedProtoStyle();
  if (failures.length > 0) {
    console.error(
      `Authored Proto style checks failed:\n${failures.map((item) => `- ${item}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("Authored Proto style checks passed.");
}
