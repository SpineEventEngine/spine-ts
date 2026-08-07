import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
    if (commentStart > 0 && (lines[commentStart - 1] ?? "").trim().length !== 0) {
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

export function checkOwnedProtoStyle(root = repositoryRoot) {
  const manifestPath = resolve(root, "packages/proto/proto/spine-sources.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return (manifest.ownedSources ?? []).flatMap(({ localPath }) =>
    ownedProtoStyleFailures(readFileSync(resolve(root, localPath), "utf8"), localPath),
  );
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
