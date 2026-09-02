/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyrightHeader,
  recognizedCopyrightHeader,
  separateCopyrightHeader,
} from "./copyright-header.mjs";
import { isGeneratedTypeScriptPath } from "./generated-source-policy.mjs";
import { findPrimaryMergeBase } from "./git-primary-branch.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = "packages/proto/proto/spine-sources.json";

export const COPYRIGHT_HEADER = copyrightHeader(2026);

function expectedHeader(year) {
  return copyrightHeader(year);
}

function placement(content) {
  return content.startsWith("#!") ? content.indexOf("\n") + 1 : 0;
}

function isEligible(path, excluded) {
  return (
    /\.(?:ts|tsx|proto)$/u.test(path) && !excluded.has(path) && !isGeneratedTypeScriptPath(path)
  );
}

function usesCopyrightSpacingPolicy(path) {
  return /\.(?:ts|tsx)$/u.test(path);
}

function normalizedContents(path, contents) {
  const normalized = usesCopyrightSpacingPolicy(path)
    ? separateCopyrightHeader(contents)
    : contents;
  const at = placement(normalized);
  const before = normalized.slice(0, at);
  const after = normalized.slice(at);
  const header = recognizedCopyrightHeader(after);
  return `${before}${header === undefined ? after : after.slice(header.length)}`;
}

function hasMisplacedRecognizedHeader(contents) {
  for (const comment of contents.matchAll(/\/\*/gu)) {
    if (
      !contents.slice(0, comment.index).includes("CodeMatters") &&
      recognizedCopyrightHeader(contents.slice(comment.index)) !== undefined
    )
      return true;
  }
  return false;
}

function contentChanged(path, contents, options) {
  const base = options.baseContent?.(path);
  if (base !== undefined)
    return { changed: normalizedContents(path, contents) !== normalizedContents(path, base) };

  const renamed = options.renamedFrom?.(path) ?? [];
  if (renamed.length === 1) {
    const renamedBase = options.baseContentAt?.(renamed[0]);
    return {
      changed:
        renamedBase === undefined ||
        normalizedContents(path, contents) !== normalizedContents(path, renamedBase),
    };
  }
  if (renamed.length > 1) return { problem: "ambiguous header-normalized rename match" };

  const matches = (options.deletedBasePaths?.() ?? []).filter((candidate) => {
    const candidateBase = options.baseContentAt?.(candidate);
    return (
      candidateBase !== undefined &&
      normalizedContents(path, contents) === normalizedContents(path, candidateBase)
    );
  });
  if (matches.length > 1) return { problem: "ambiguous header-normalized rename match" };
  return { changed: matches.length === 0 };
}

export function checkCopyright({
  files,
  readFile,
  readManifest,
  year = new Date().getFullYear(),
  ...options
}) {
  const manifest = readManifest();
  const excluded = new Set((manifest.sources ?? []).map((source) => source.localPath ?? source));
  const problems = [];

  for (const path of [...files].sort((left, right) => left.localeCompare(right))) {
    if (!/\.(?:ts|tsx|proto)$/u.test(path)) continue;
    const content = readFile(path);
    if (isGeneratedTypeScriptPath(path)) {
      if (content.includes("CodeMatters")) problems.push(`${path}: forbidden CodeMatters header`);
      continue;
    }
    if (excluded.has(path)) {
      if (content.includes("CodeMatters")) problems.push(`${path}: forbidden CodeMatters header`);
      else if (!/[Cc]opyright/u.test(content))
        problems.push(`${path}: missing upstream copyright notice`);
      continue;
    }
    if (!isEligible(path, excluded)) continue;
    const at = placement(content);
    const actual = content.slice(at);
    const match = recognizedCopyrightHeader(actual);
    if (match === undefined) {
      problems.push(
        hasMisplacedRecognizedHeader(actual)
          ? `${path}: misplaced CodeMatters header`
          : content.includes("CodeMatters")
            ? `${path}: malformed CodeMatters header`
            : `${path}: missing CodeMatters header`,
      );
      continue;
    }
    if (usesCopyrightSpacingPolicy(path) && actual !== separateCopyrightHeader(actual)) {
      problems.push(
        `${path}: incorrect CodeMatters header spacing (expected exactly one empty line)`,
      );
      continue;
    }
    if (year === 2026 && match !== COPYRIGHT_HEADER) {
      problems.push(`${path}: stale-year CodeMatters header`);
      continue;
    }
    if (year > 2026) {
      let change;
      try {
        change = contentChanged(path, content, options);
      } catch {
        problems.push(`${path}: base content lookup failed`);
        continue;
      }
      if (change.problem !== undefined) {
        problems.push(`${path}: ${change.problem}`);
      } else if (change.changed && match !== expectedHeader(year)) {
        problems.push(`${path}: stale-year CodeMatters header`);
      }
    }
  }
  return problems;
}

export function gitFiles(runGit = git) {
  const result = runGit(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (result.status !== 0) throw new Error("copyright enumeration failed: git ls-files");
  return result.stdout.split("\0").filter((path) => path !== "");
}

function gitOutput(runGit, args, failure) {
  const result = runGit(args);
  if (result.status !== 0) throw new Error(`copyright ${failure} failed`);
  return result.stdout;
}

function renameMap(runGit, base) {
  const renames = new Map();
  for (const args of [
    ["diff", "-z", "--name-status", "-M", `${base}...HEAD`],
    ["diff", "-z", "--name-status", "-M"],
    ["diff", "--cached", "-z", "--name-status", "-M"],
  ]) {
    const fields = gitOutput(runGit, args, "rename detection").split("\0");
    for (let index = 0; index < fields.length - 1;) {
      const status = fields[index++];
      const from = fields[index++];
      if (status === undefined || status === "") break;
      if (status.startsWith("R") || status.startsWith("C")) {
        const to = fields[index++];
        if (from === undefined || to === undefined) break;
        if (status.startsWith("R"))
          renames.set(to, [...new Set([...(renames.get(to) ?? []), from])]);
      }
    }
  }
  return renames;
}

/* Creates deterministic Git-backed current-year comparison operations. */
export function gitComparison(runGit = git) {
  const base = findPrimaryMergeBase(runGit);
  if (base === undefined) throw new Error("copyright merge-base failed");
  const renames = renameMap(runGit, base);
  const deleted = new Set();
  for (const args of [
    ["diff", "-z", "--name-only", "--diff-filter=D", `${base}...HEAD`],
    ["diff", "-z", "--name-only", "--diff-filter=D"],
    ["diff", "--cached", "-z", "--name-only", "--diff-filter=D"],
  ]) {
    for (const path of gitOutput(runGit, args, "deleted-base enumeration").split("\0")) {
      if (path !== "") deleted.add(path);
    }
  }
  const atBase = (path) => {
    const result = runGit(["show", `${base}:${path}`]);
    if (result.status === 0) return result.stdout;
    if (result.status === 128) return undefined;
    throw new Error("copyright base content lookup failed");
  };
  return {
    baseContent: atBase,
    baseContentAt: atBase,
    renamedFrom: (path) => renames.get(path) ?? [],
    deletedBasePaths: () => [...deleted],
  };
}

function git(args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

export function main() {
  const comparison = gitComparison();
  const problems = checkCopyright({
    files: gitFiles(),
    readFile: (path) => readFileSync(resolve(repoRoot, path), "utf8"),
    readManifest: () => JSON.parse(readFileSync(resolve(repoRoot, manifestPath), "utf8")),
    ...comparison,
  });
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
