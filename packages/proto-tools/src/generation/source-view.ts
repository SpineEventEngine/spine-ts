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

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

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

/**
 * Internal source view carrying the required publication revalidation digest.
 */
export interface PublicationSourceView extends ModelSourceView {
  // prettier-ignore

  /**
   * Fingerprint of configured authored sources and recursive TypeScript configuration inputs.
   */
  readonly inventoryDigest: string;
}

interface ProjectConfigView {
  readonly configFiles: readonly string[];
  readonly fileNames: ReadonlySet<string>;
}

function projectConfig(root: string): ProjectConfigView | undefined {
  const configPath = join(root, "tsconfig.json");
  if (!existsSync(configPath)) return undefined;
  const texts = new Map<string, string>();
  const host = {
    ...ts.sys,
    readFile: (path: string) => {
      const text = ts.sys.readFile(path);
      if (text !== undefined) texts.set(resolve(path), text);
      return text;
    },
  };
  const source = ts.readJsonConfigFile(configPath, host.readFile);
  const parsed = ts.parseJsonSourceFileConfigFileContent(
    source,
    host,
    root,
    undefined,
    configPath,
    undefined,
    undefined,
    new Map(),
  );
  if (parsed.errors.some((diagnostic) => diagnostic.code !== 18002 && diagnostic.code !== 18003))
    throw new Error("spine-proto: source view has invalid tsconfig.json");
  const extended =
    (source as unknown as { readonly extendedSourceFiles?: readonly string[] })
      .extendedSourceFiles ?? [];
  const files = [source.fileName, ...extended]
    .map((file) => resolve(file))
    .filter((file, index, values) => values.indexOf(file) === index)
    .sort();
  for (const file of files) if (!texts.has(file)) texts.set(file, readFileSync(file, "utf8"));
  return Object.freeze({
    configFiles: Object.freeze(files),
    fileNames: new Set(parsed.fileNames.map((file) => resolve(file))),
  });
}

function hashFile(hash: ReturnType<typeof createHash>, category: string, file: string): void {
  const content = readFileSync(file);
  hash.update(
    `${String(category.length)}:${category}${String(file.length)}:${file}${String(content.length)}:`,
  );
  hash.update(content);
}

function inventoryDigest(files: readonly string[], configs: readonly string[] = []): string {
  const hash = createHash("sha256");
  for (const file of files) hashFile(hash, "source", file);
  for (const config of configs) hashFile(hash, "config", config);
  return hash.digest("hex");
}

interface SourceInventory {
  readonly authoredFiles: readonly string[];
  readonly digest: string;
}

function sourceInventory(root: string, generated: string): SourceInventory {
  const generatedDirectory = dirname(generated);
  const generatedName = basename(generated);
  const excluded = [generated, "dist"];
  const siblingStage = join(generatedDirectory, `.${generatedName}.stage-`);
  const siblingBackup = join(generatedDirectory, `.${generatedName}.`);
  const candidates = collectAuthored(root, [...excluded, siblingStage, siblingBackup]);
  const config = projectConfig(root);
  const authoredFiles = Object.freeze(
    config === undefined
      ? candidates
      : candidates.filter((file) => config.fileNames.has(resolve(file))),
  );
  return Object.freeze({
    authoredFiles,
    digest: inventoryDigest(authoredFiles, config?.configFiles),
  });
}

/**
 * Checks that the immutable authored-source inventory is current before publication.
 *
 * @param sourceView Compiler input snapshot captured before generation.
 */
export function assertSourceViewCurrent(sourceView: PublicationSourceView): void {
  try {
    const generated = relative(sourceView.packageRoot, sourceView.liveGeneratedRoot);
    const current = sourceInventory(sourceView.packageRoot, generated);
    if (current.digest === sourceView.inventoryDigest) return;
  } catch {
    // Report one stable transaction diagnostic for every inventory mutation.
  }
  throw new Error("spine-proto: authored interface source view changed during generation");
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
): PublicationSourceView {
  const root = resolve(packageRoot);
  const generated = generatedRoot.replaceAll("\\", "/");
  const liveGeneratedRoot = resolve(root, generated);
  const inventory = sourceInventory(root, generated);
  return Object.freeze({
    authoredFiles: inventory.authoredFiles,
    inventoryDigest: inventory.digest,
    packageRoot: root,
    liveGeneratedRoot,
    stagedGeneratedRoot: resolve(stagedGeneratedRoot),
  });
}
