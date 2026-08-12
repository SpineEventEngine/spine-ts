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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = "packages/proto/proto/spine-sources.json";

export const COPYRIGHT_HEADER = `/*
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
`;

const codeMattersHeader = /\/\*\n \* Copyright \d{4}, CodeMatters\. All rights reserved\.\n(?:.|\n)*? \*\/\n/u;

function expectedHeader(year) {
  return COPYRIGHT_HEADER.replace("Copyright 2026", `Copyright ${year}`);
}

function placement(content) {
  return content.startsWith("#!") ? content.indexOf("\n") + 1 : 0;
}

function isEligible(path, excluded) {
  return /\.(?:ts|tsx|proto)$/u.test(path) && !excluded.has(path);
}

export function checkCopyright({ files, readFile, readManifest, year = new Date().getFullYear() }) {
  const manifest = readManifest();
  const excluded = new Set((manifest.sources ?? []).map((source) => source.localPath ?? source));
  const problems = [];

  for (const path of [...files].sort((left, right) => left.localeCompare(right))) {
    if (!/\.(?:ts|tsx|proto)$/u.test(path)) continue;
    const content = readFile(path);
    if (excluded.has(path)) {
      if (content.includes("CodeMatters")) problems.push(`${path}: forbidden CodeMatters header`);
      else if (!/[Cc]opyright/u.test(content)) problems.push(`${path}: missing upstream copyright notice`);
      continue;
    }
    if (!isEligible(path, excluded)) continue;
    const at = placement(content);
    const actual = content.slice(at);
    const match = actual.match(codeMattersHeader);
    if (match === null) {
      problems.push(
        content.includes("CodeMatters")
          ? `${path}: malformed CodeMatters header`
          : `${path}: missing CodeMatters header`,
      );
      continue;
    }
    if (match.index !== 0) {
      problems.push(`${path}: misplaced CodeMatters header`);
      continue;
    }
    if (match[0] !== expectedHeader(year)) {
      problems.push(`${path}: stale-year CodeMatters header`);
    }
  }
  return problems;
}

export function gitFiles(runGit = git) {
  const result = runGit(["ls-files", "--cached", "--others", "--exclude-standard"]);
  if (result.status !== 0) throw new Error("copyright enumeration failed: git ls-files");
  return result.stdout.split("\n").filter((path) => path !== "");
}

function git(args) {
  return spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

export function main() {
  const problems = checkCopyright({
    files: gitFiles(),
    readFile: (path) => readFileSync(resolve(repoRoot, path), "utf8"),
    readManifest: () => JSON.parse(readFileSync(resolve(repoRoot, manifestPath), "utf8")),
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
