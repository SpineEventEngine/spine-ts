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

import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const maximumSourceViewDepth = 32;
const maximumSourceViewEntries = 10_000;

/**
 * Stable compiler input view for authored sources and staged generated output.
 */
export interface ModelSourceView {
  // prettier-ignore

  /**
   * Eligible authored TypeScript files, excluding generated publication trees.
   */
  readonly authoredFiles: readonly string[];

  // prettier-ignore

  /**
   * Absolute model package root used to resolve authored imports.
   */
  readonly packageRoot: string;

  // prettier-ignore

  /**
   * Canonical live generated root excluded from authored-interface candidates.
   */
  readonly liveGeneratedRoot: string;

  // prettier-ignore

  /**
   * Redirect root used when compiler imports address generated model sources.
   */
  readonly stagedGeneratedRoot: string;
}

function collectAuthored(root: string, excluded: readonly string[]): readonly string[] {
  const files: string[] = [];
  const pending = [{ path: root, depth: 0 }];
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    if (current.depth > maximumSourceViewDepth)
      throw new Error("spine-proto: source view exceeds bounded traversal");
    for (const name of readdirSync(current.path).sort().reverse()) {
      entries += 1;
      if (entries > maximumSourceViewEntries)
        throw new Error("spine-proto: source view exceeds bounded traversal");
      const path = join(current.path, name);
      const relativePath = relative(root, path);
      if (
        excluded.some(
          (entry) =>
            relativePath === entry ||
            relativePath.startsWith(`${entry}${sep}`) ||
            relativePath.startsWith(`${entry}-`) ||
            (entry.endsWith(".") && relativePath.startsWith(entry)),
        )
      )
        continue;
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push({ path, depth: current.depth + 1 });
      else if (
        [".cts", ".mts", ".ts", ".tsx"].some((extension) => name.endsWith(extension)) &&
        !name.endsWith(".d.ts")
      )
        files.push(path);
    }
  }
  return files.sort();
}

/**
 * Creates a live-authored/staged-generated compiler source view.
 *
 * @param packageRoot Model package root.
 * @param generatedRoot Configured live generated root.
 * @param stagedGeneratedRoot Generated tree inside the current stage.
 * @returns Authored compiler candidates and the staged generated redirect root.
 */
export function modelSourceView(
  packageRoot: string,
  generatedRoot: string,
  stagedGeneratedRoot: string,
): ModelSourceView {
  const root = resolve(packageRoot);
  const generated = generatedRoot.replaceAll("\\", "/");
  const generatedDirectory = dirname(generated);
  const generatedName = basename(generated);
  const excluded = [generated, "dist"];
  const siblingStage = join(generatedDirectory, `.${generatedName}.stage-`);
  const siblingBackup = join(generatedDirectory, `.${generatedName}.`);
  const liveGeneratedRoot = resolve(root, generated);
  return Object.freeze({
    authoredFiles: Object.freeze(collectAuthored(root, [...excluded, siblingStage, siblingBackup])),
    packageRoot: root,
    liveGeneratedRoot,
    stagedGeneratedRoot: resolve(stagedGeneratedRoot),
  });
}
