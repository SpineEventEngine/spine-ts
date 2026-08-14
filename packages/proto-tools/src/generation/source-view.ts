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
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const maximumSourceViewDepth = 32;
const maximumSourceViewEntries = 10_000;
const sourceViewPublicationRecordName = ".spine-source-view-publication.json";
const sourceViewPublicationRecordVersion = 1;

const nonRegularInputDiagnostic = "spine-proto: source view contains non-regular TypeScript input";

/**
 * Race-safe reads for files owned by a compiler source view.
 */
export const SourceViewInputs: Readonly<{
  read(path: string): Buffer;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Opens without following the final symlink or waiting on a special file,
   * validates the opened descriptor, and reads that immutable file identity.
   *
   * @param path Source or configuration path.
   * @returns Exact file bytes.
   */
  read(path: string): Buffer {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      );
      if (!fstatSync(descriptor).isFile()) throw new Error(nonRegularInputDiagnostic);
      return readFileSync(descriptor);
    } catch (error) {
      if (error instanceof Error && error.message === nonRegularInputDiagnostic) throw error;
      throw new Error(nonRegularInputDiagnostic, { cause: error });
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  },
});

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
   * Complete same-module compiler inputs, including declarations and allowed JavaScript.
   */
  readonly compilerFiles?: readonly string[];

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
   * Complete same-module compiler inputs captured by the publication transaction.
   */
  readonly compilerFiles: readonly string[];

  // prettier-ignore

  /**
   * Fingerprint of configured authored sources and recursive TypeScript configuration inputs.
   */
  readonly inventoryDigest: string;
}

/**
 * Fixed internal handoff retained by a root model-generation transaction.
 */
export interface SourceViewPublicationRecord {
  readonly formatVersion: 1;
  readonly inventoryDigest: string;
  readonly liveGeneratedRoot: string;
  readonly livePackageRoot: string;
}

interface ProjectConfigView {
  readonly allowJs: boolean;
  readonly configFiles: readonly string[];
}

function projectConfig(root: string): ProjectConfigView | undefined {
  const configPath = join(root, "tsconfig.json");
  if (!existsSync(configPath)) return undefined;
  const texts = new Map<string, string>();
  const host = {
    ...ts.sys,
    readFile: (path: string) => {
      const text = SourceViewInputs.read(path).toString("utf8");
      texts.set(resolve(path), text);
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
  for (const file of files)
    if (!texts.has(file)) texts.set(file, SourceViewInputs.read(file).toString("utf8"));
  return Object.freeze({
    allowJs: parsed.options.allowJs === true,
    configFiles: Object.freeze(files),
  });
}

function hashFile(hash: ReturnType<typeof createHash>, category: string, file: string): void {
  const content = SourceViewInputs.read(file);
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
  readonly compilerFiles: readonly string[];
  readonly digest: string;
}

function sourceInventory(root: string, generated: string): SourceInventory {
  const generatedDirectory = dirname(generated);
  const generatedName = basename(generated);
  const excluded = [generated, "dist"];
  const siblingStage = join(generatedDirectory, `.${generatedName}.stage-`);
  const siblingRootTransaction = join(generatedDirectory, `.${generatedName}-`);
  const siblingBackup = join(generatedDirectory, `.${generatedName}.`);
  const config = projectConfig(root);
  const inputs = collectAuthored(
    root,
    [...excluded, siblingStage, siblingRootTransaction, siblingBackup],
    config?.allowJs,
  );
  const authoredFiles = Object.freeze(inputs.authoredFiles);
  const compilerFiles = Object.freeze(inputs.compilerFiles);
  return Object.freeze({
    authoredFiles,
    compilerFiles,
    digest: inventoryDigest(compilerFiles, config?.configFiles),
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

/**
 * Writes the fixed internal source-view handoff for an outer generation stage.
 *
 * @param stageRoot Outer staged model package root.
 * @param sourceView Captured live-authored/staged-generated source view.
 */
export function writeSourceViewPublicationRecord(
  stageRoot: string,
  sourceView: PublicationSourceView,
): void {
  writeFileSync(
    join(stageRoot, sourceViewPublicationRecordName),
    `${JSON.stringify({
      formatVersion: sourceViewPublicationRecordVersion,
      inventoryDigest: sourceView.inventoryDigest,
      liveGeneratedRoot: sourceView.liveGeneratedRoot,
      livePackageRoot: sourceView.packageRoot,
    })}\n`,
    "utf8",
  );
}

/**
 * Reads one bounded root-transaction source-view handoff.
 *
 * @param stageRoot Outer staged model package root.
 * @param expectedLivePackageRoot Canonical selected live model package root.
 * @param expectedLiveGeneratedRoot Canonical selected live generated root.
 * @returns Validated immutable internal handoff.
 */
export function readSourceViewPublicationRecord(
  stageRoot: string,
  expectedLivePackageRoot: string,
  expectedLiveGeneratedRoot: string,
): SourceViewPublicationRecord {
  const recordPath = join(stageRoot, sourceViewPublicationRecordName);
  const stagePath = resolve(stageRoot);
  const candidate = resolve(recordPath);
  let stage: string;
  let regular = false;
  try {
    stage = realpathSync(stagePath);
    regular = lstatSync(candidate).isFile();
  } catch {
    throw new Error("spine-proto: invalid source-view publication record");
  }
  if (!candidate.startsWith(`${stagePath}/`) || !regular)
    throw new Error("spine-proto: invalid source-view publication record");
  const canonicalRecord = realpathSync(candidate);
  if (!canonicalRecord.startsWith(`${stage}/`))
    throw new Error("spine-proto: invalid source-view publication record");
  let raw: unknown;
  try {
    raw = JSON.parse(SourceViewInputs.read(canonicalRecord).toString("utf8"));
  } catch {
    throw new Error("spine-proto: invalid source-view publication record");
  }
  if (raw === null || typeof raw !== "object")
    throw new Error("spine-proto: invalid source-view publication record");
  const record = raw as Partial<SourceViewPublicationRecord>;
  const livePackageRoot = realpathSync(expectedLivePackageRoot);
  const expectedGeneratedRelative = relative(
    resolve(expectedLivePackageRoot),
    resolve(expectedLiveGeneratedRoot),
  );
  const liveGeneratedRoot = resolve(livePackageRoot, expectedGeneratedRelative);
  if (
    record.formatVersion !== sourceViewPublicationRecordVersion ||
    record.livePackageRoot !== livePackageRoot ||
    record.liveGeneratedRoot !== liveGeneratedRoot ||
    expectedGeneratedRelative === "" ||
    expectedGeneratedRelative.startsWith("..") ||
    typeof record.inventoryDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.inventoryDigest) ||
    Object.keys(record).sort().join(",") !==
      "formatVersion,inventoryDigest,liveGeneratedRoot,livePackageRoot"
  )
    throw new Error("spine-proto: invalid source-view publication record");
  return Object.freeze({
    formatVersion: sourceViewPublicationRecordVersion,
    inventoryDigest: record.inventoryDigest,
    liveGeneratedRoot,
    livePackageRoot,
  });
}

/**
 * Revalidates the live source/configuration inventory captured in a handoff.
 *
 * @param record Validated internal root-transaction handoff.
 */
export function assertSourceViewPublicationRecordCurrent(
  record: SourceViewPublicationRecord,
): void {
  try {
    const generated = relative(record.livePackageRoot, record.liveGeneratedRoot);
    if (
      inventoryDigest(
        sourceInventory(record.livePackageRoot, generated).compilerFiles,
        projectConfig(record.livePackageRoot)?.configFiles,
      ) === record.inventoryDigest
    )
      return;
  } catch {
    // Report one stable transaction diagnostic for every inventory mutation.
  }
  throw new Error("spine-proto: authored interface source view changed during generation");
}

function collectAuthored(
  root: string,
  excluded: readonly string[],
  allowJs = false,
): Readonly<{ authoredFiles: readonly string[]; compilerFiles: readonly string[] }> {
  const authoredFiles: string[] = [];
  const compilerFiles: string[] = [];
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
            ((entry.endsWith(".") || entry.endsWith("-")) && relativePath.startsWith(entry)),
        )
      )
        continue;
      const entry = lstatSync(path);
      const isTypeScript = [".cts", ".mts", ".ts", ".tsx"].some((extension) =>
        name.endsWith(extension),
      );
      const isAllowedJavaScript =
        allowJs && [".cjs", ".js", ".jsx", ".mjs"].some((extension) => name.endsWith(extension));
      const isCompilerInput = isTypeScript || isAllowedJavaScript;
      if (entry.isSymbolicLink()) {
        if (isCompilerInput) throw new Error(nonRegularInputDiagnostic);
        continue;
      }
      if (entry.isDirectory()) pending.push({ path, depth: current.depth + 1 });
      else if (isCompilerInput) {
        if (!entry.isFile()) throw new Error(nonRegularInputDiagnostic);
        compilerFiles.push(path);
        if (
          isTypeScript &&
          ![".d.cts", ".d.mts", ".d.ts"].some((extension) => name.endsWith(extension))
        )
          authoredFiles.push(path);
      }
    }
  }
  return Object.freeze({
    authoredFiles: Object.freeze(authoredFiles.sort()),
    compilerFiles: Object.freeze(compilerFiles.sort()),
  });
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
  const root = realpathSync(resolve(packageRoot));
  const generated = generatedRoot.replaceAll("\\", "/");
  const liveGeneratedRoot = resolve(root, generated);
  const inventory = sourceInventory(root, generated);
  return Object.freeze({
    authoredFiles: inventory.authoredFiles,
    compilerFiles: inventory.compilerFiles,
    inventoryDigest: inventory.digest,
    packageRoot: root,
    liveGeneratedRoot,
    stagedGeneratedRoot: resolve(stagedGeneratedRoot),
  });
}
