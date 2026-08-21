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

import { lstatSync, mkdirSync, opendirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

import { BuildHandlerAnalyzer } from "./build-time-handler-analyzer.js";
import { GeneratedRegistryWriter } from "./generated-registry-writer.js";

/**
 * Options for application-local generated handler registry production.
 */
export interface HandlerCodegenOptions {
  // prettier-ignore

  /**
   * Application root containing its TypeScript project.
   */
  readonly appRoot: string;
}

/**
 * Filesystem operations used to stage an application handler registry.
 */
export interface HandlerCodegenOperations {
  // prettier-ignore

  /**
   * Creates a directory at the supplied path.
   *
   * @param path Directory path to create.
   */
  readonly mkdir: (path: string) => void;

  /**
   * Writes source text to the supplied path.
   *
   * @param path File path to write.
   * @param source UTF-8 source text to write.
   */
  readonly write: (path: string, source: string) => void;

  /**
   * Updates a filesystem entry to use another path.
   *
   * @param from Existing filesystem entry path.
   * @param to Destination filesystem entry path.
   */
  readonly rename: (from: string, to: string) => void;

  /**
   * Removes the filesystem entry at the supplied path.
   *
   * @param path Filesystem entry path to remove.
   */
  readonly remove: (path: string) => void;
}

const maxCompilerRoots = 1000;
const maxDiscoveryEntries = 1000;
const defaultOperations: HandlerCodegenOperations = {
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
  write: (path, source) => {
    writeFileSync(path, source, "utf8");
  },
  rename: renameSync,
  remove: (path) => {
    rmSync(path, { force: true });
  },
};

/**
 * Creates and atomically replaces an application's generated handler registry from tooling.
 *
 * @param options Application root and generation configuration.
 * @param operations Optional filesystem operations used for generation.
 */
export function generateHandlerRegistry(
  options: HandlerCodegenOptions,
  operations: Partial<HandlerCodegenOperations> = {},
): void {
  const appRoot = HandlerFiles.directory(resolve(options.appRoot), "Application root");
  const project = HandlerFiles.file(appRoot, join(appRoot, "tsconfig.json"), "Project");
  const generatedRoot = HandlerFiles.path(appRoot, join(appRoot, "generated"), "Generated root");
  const outputFile = HandlerFiles.path(
    generatedRoot,
    join(generatedRoot, "handler/generated-handler-registry.ts"),
    "Generated output",
  );
  const { program, sources } = HandlerFiles.program(appRoot, project);
  const analysis = BuildHandlerAnalyzer.analyze(program, sources);

  if (analysis.diagnostics.length > 0)
    throw new Error(HandlerFiles.diagnostics(analysis.diagnostics));

  const source = new GeneratedRegistryWriter().render(analysis, { outputFile });
  (operations.mkdir ?? defaultOperations.mkdir)(dirname(outputFile));
  HandlerFiles.write(outputFile, source, operations);
}

const HandlerFiles = Object.freeze({
  program(appRoot: string, project: string): { program: ts.Program; sources: ts.SourceFile[] } {
    const config = ts.readConfigFile(project, (path) => ts.sys.readFile(path));
    if (config.error !== undefined) throw new Error(HandlerFiles.configDiagnostics([config.error]));
    HandlerFiles.assertIncludes(HandlerFiles.value(config.config, "include"), appRoot);
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      HandlerFiles.configHost(appRoot, dirname(project)),
      dirname(project),
      undefined,
      project,
    );
    if (parsed.errors.length > 0) throw new Error(HandlerFiles.configDiagnostics(parsed.errors));
    if ((parsed.projectReferences?.length ?? 0) > 0)
      throw new Error("Project references are not supported for handler generation.");
    if (parsed.fileNames.length > maxCompilerRoots)
      throw new Error(`Handler source count exceeds ${String(maxCompilerRoots)}.`);
    const roots = parsed.fileNames.map((file) => HandlerFiles.typeScriptFile(appRoot, file));
    const program = ts.createProgram({
      rootNames: roots,
      options: parsed.options,
      ...(parsed.projectReferences === undefined
        ? {}
        : { projectReferences: parsed.projectReferences }),
    });
    const sources = roots
      .map((root) => program.getSourceFile(root))
      .filter(HandlerFiles.sourceFile);
    return { program, sources };
  },

  assertIncludes(value: unknown, appRoot: string): void {
    if (!Array.isArray(value)) return;
    for (const include of value) {
      if (typeof include !== "string") continue;
      if (include.split(/[\\/]/u).includes(".."))
        throw new Error(`Handler source must stay within ${appRoot}.`);
    }
  },

  value(value: unknown, key: string): unknown {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  },

  configHost(appRoot: string, currentDirectory: string): ts.ParseConfigHost {
    let entries = 0;
    // TypeScript 6.0.3 exports matchFiles at runtime but omits it from its declarations.
    const matchFiles = (
      ts as unknown as {
        matchFiles: (
          path: string,
          extensions: readonly string[],
          excludes: readonly string[] | undefined,
          includes: readonly string[] | undefined,
          caseSensitive: boolean,
          currentDirectory: string,
          depth: number | undefined,
          getFileSystemEntries: (directory: string) => { files: string[]; directories: string[] },
          realpath: (path: string) => string,
        ) => string[];
      }
    ).matchFiles;
    return {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      readDirectory: (path, extensions, excludes, includes, depth) =>
        matchFiles(
          path,
          extensions,
          excludes,
          includes,
          ts.sys.useCaseSensitiveFileNames,
          currentDirectory,
          depth,
          (directory: string) => {
            const resolvedDirectory = resolve(currentDirectory, directory);
            HandlerFiles.containedPath(appRoot, resolvedDirectory, "Handler discovery directory");
            const files: string[] = [];
            const directories: string[] = [];
            const handle = opendirSync(resolvedDirectory);
            try {
              let entry;
              while ((entry = handle.readSync()) !== null) {
                entries += 1;
                if (entries > maxDiscoveryEntries)
                  throw new Error(
                    `Handler discovery entry count exceeds ${String(maxDiscoveryEntries)}.`,
                  );
                const candidate = join(resolvedDirectory, entry.name);
                if (lstatSync(candidate).isSymbolicLink())
                  throw new Error(`Handler discovery must not traverse symlink: ${candidate}`);
                if (entry.isDirectory()) directories.push(entry.name);
                else if (entry.isFile()) files.push(entry.name);
              }
            } finally {
              handle.closeSync();
            }
            return { files, directories };
          },
          (path) => ts.sys.realpath?.(path) ?? path,
        ),
      fileExists: (path) => ts.sys.fileExists(path),
      readFile: (path) => ts.sys.readFile(path),
      trace: () => undefined,
      directoryExists: (path) => ts.sys.directoryExists(path),
      realpath: (path) => ts.sys.realpath?.(path) ?? path,
    };
  },

  sourceFile(value: ts.SourceFile | undefined): value is ts.SourceFile {
    return value !== undefined;
  },

  diagnostics(
    diagnostics: readonly {
      readonly sourceFile: string;
      readonly line: number;
      readonly column: number;
      readonly code: string;
      readonly message: string;
    }[],
  ): string {
    return diagnostics
      .map((diagnostic) => {
        const location =
          `${diagnostic.sourceFile}:${String(diagnostic.line)}:` + String(diagnostic.column);
        return `${location} ${diagnostic.code} ${diagnostic.message}`;
      })
      .join("\n");
  },

  configDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });
  },

  file(root: string, value: string, label: string): string {
    const path = HandlerFiles.path(root, value, label);
    if (!lstatSync(path).isFile()) throw new Error(`${label} must be a regular file: ${path}`);
    return path;
  },

  typeScriptFile(root: string, value: string): string {
    if (!value.endsWith(".ts") || value.endsWith(".d.ts"))
      throw new Error(`Handler source must be a TypeScript file: ${value}`);
    return HandlerFiles.file(root, value, "Handler source");
  },

  directory(path: string, label: string): string {
    HandlerFiles.assertNoSymlinkAncestors(path, label);
    if (!lstatSync(path).isDirectory()) throw new Error(`${label} must be a directory: ${path}`);
    return path;
  },

  path(root: string, path: string, label: string): string {
    const value = relative(root, path);
    if (value === "" || value.startsWith("..") || isAbsolute(value))
      throw new Error(`${label} must stay within ${root}.`);
    HandlerFiles.assertNoSymlinkAncestors(path, label);
    return path;
  },

  containedPath(root: string, path: string, label: string): string {
    const value = relative(root, path);
    if (value.startsWith("..") || isAbsolute(value))
      throw new Error(`${label} must stay within ${root}.`);
    HandlerFiles.assertNoSymlinkAncestors(path, label);
    return path;
  },

  assertNoSymlinkAncestors(path: string, label: string): void {
    const parts = resolve(path).split(sep).filter(Boolean);
    let current: string = sep;
    for (const part of parts) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink())
          throw new Error(`${label} must not use a symlink path.`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  },

  write(outputFile: string, source: string, operations: Partial<HandlerCodegenOperations>): void {
    const fileOperations = { ...defaultOperations, ...operations };
    const stage = join(
      dirname(outputFile),
      `.${basename(outputFile)}.${String(process.pid)}.${crypto.randomUUID()}.tmp`,
    );
    try {
      fileOperations.write(stage, source);
      fileOperations.rename(stage, outputFile);
    } catch (primary) {
      try {
        fileOperations.remove(stage);
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          "Generated handler registry publication failed.",
        );
      }
      throw primary;
    }
  },
});
