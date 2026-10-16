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

import path from "node:path";
import ts from "typescript";

/**
 * Selects authored TypeScript requests that need compiler-based transformation.
 * @param id Vite module identifier, possibly with a query.
 * @returns Absolute source path, or undefined for other requests.
 */
function sourceFile(id) {
  if (id.startsWith("\0") || id.includes("/node_modules/")) return undefined;
  const question = id.indexOf("?");
  const file = question < 0 ? id : id.slice(0, question);
  if (!path.isAbsolute(file) || !/\.[cm]?tsx?$/.test(file) || /\.d\.[cm]?ts$/.test(file))
    return undefined;
  if (question >= 0 && /(?:^|&)(?:raw|url|inline|worker)(?:&|=|$)/.test(id.slice(question + 1)))
    return undefined;
  return file;
}

/**
 * Formats TypeScript compiler diagnostics for a failed transform.
 * @param diagnostics Errors returned by the compiler.
 * @returns A readable diagnostic message.
 */
function diagnosticText(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: (name) => name,
    getNewLine: () => ts.sys.newLine,
  });
}

/**
 * Reads package compiler settings and selects ESM-only transpile output.
 * @param configFile Nearest package tsconfig path.
 * @returns Effective compiler options for Vite's transform.
 */
function parsedOptions(configFile) {
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error !== undefined)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configFile));
  if (parsed.errors.length > 0) throw new Error(diagnosticText(parsed.errors));
  return {
    ...parsed.options,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    sourceMap: true,
    inlineSourceMap: false,
    inlineSources: true,
    declaration: false,
    declarationMap: false,
    isolatedDeclarations: false,
    composite: false,
    rootDir: undefined,
    outDir: undefined,
    tsBuildInfoFile: undefined,
  };
}

/**
 * Caches the nearest package configuration for one authored file.
 * @param file Absolute TypeScript path.
 * @param configs Parsed options by tsconfig path.
 * @param directories Parsed options by source directory.
 * @returns Package compiler options adapted for Vitest.
 */
function compilerOptions(file, configs, directories) {
  if (/\.cts$/.test(file))
    throw new Error(`TypeScript coverage cannot emit CommonJS source as ESM: ${file}.`);
  const directory = path.dirname(file);
  const known = directories.get(directory);
  if (known !== undefined) return known;
  const configFile = ts.findConfigFile(directory, ts.sys.fileExists, "tsconfig.json");
  const packageFile = ts.findConfigFile(directory, ts.sys.fileExists, "package.json");
  if (configFile === undefined || packageFile === undefined)
    throw new Error(`TypeScript coverage requires a package config for ${file}.`);
  const modulePackage = ts.readConfigFile(packageFile, ts.sys.readFile);
  if (modulePackage.error !== undefined || modulePackage.config.type !== "module")
    throw new Error(`TypeScript coverage requires an ESM package for ${file}.`);
  const cached = configs.get(configFile);
  if (cached !== undefined) {
    directories.set(directory, cached);
    return cached;
  }
  const options = parsedOptions(configFile);
  configs.set(configFile, options);
  directories.set(directory, options);
  return options;
}

/**
 * Creates a Vite transform using package TypeScript compiler settings for V8 coverage.
 * @returns A Vite pre-transform plugin with authored TypeScript source maps.
 */
export function typescriptVitestPlugin() {
  const configs = new Map();
  const directories = new Map();
  return {
    name: "spine-typescript-coverage",
    enforce: "pre",
    transform(code, id) {
      const file = sourceFile(id);
      if (file === undefined) return undefined;
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: compilerOptions(file, configs, directories),
        reportDiagnostics: true,
      });
      const errors =
        result.diagnostics?.filter(
          (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
        ) ?? [];
      if (errors.length > 0)
        throw new Error(
          `TypeScript coverage transform failed for ${file}: ${diagnosticText(errors)}`,
        );
      if (result.sourceMapText === undefined)
        throw new Error(`TypeScript did not return a source map for ${file}.`);
      const map = JSON.parse(result.sourceMapText);
      map.sources = [file];
      map.sourcesContent = [code];
      map.sourceRoot = "";
      return {
        code: result.outputText.replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n"),
        map,
      };
    },
  };
}
