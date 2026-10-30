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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";

import type { GeneratedRegistryWriter } from "./generated-registry-writer.js";
import type { RuntimeMetadataDiscovery } from "./runtime-metadata-graph.js";

/**
 * A generated file and its exact contents.
 */
export interface MetadataAsset {
  /**
   * Absolute destination for this generated file.
   */
  readonly file: string;

  /**
   * Exact generated payload.
   */
  readonly source: string;
}

/**
 * Source and emitted adapters derived from one compiler configuration.
 */
export interface MetadataAssets {
  /**
   * Adapter files beside the authored bootstrap.
   */
  readonly source: readonly MetadataAsset[];

  /**
   * Adapter files beside emitted bootstrap output.
   */
  readonly runtime: readonly MetadataAsset[];

  /**
   * Confined record used by clean builds to restore emitted adapters.
   */
  readonly record: MetadataAsset;
}

/**
 * Builds static adapters from resolved public package exports.
 */
export const RuntimeMetadataAssets: Readonly<{
  render(
    project: string,
    publishedBootstrap: string,
    sourceBootstrap: string,
    dependencies: RuntimeMetadataDiscovery,
    writer: GeneratedRegistryWriter,
    format?: "import" | "require",
  ): MetadataAssets;
}> = Object.freeze({
  /**
   * Renders source and compiler-output adapters using the published source location.
   *
   * @param project Application TypeScript project path.
   * @param publishedBootstrap Final bootstrap source path.
   * @param sourceBootstrap Staged or final bootstrap source path.
   * @param dependencies Resolved public package metadata exports.
   * @param writer Existing generated metadata writer.
   * @param format Runtime module condition of the consuming application.
   * @returns Generated adapter files and restoration record.
   */
  render(
    project: string,
    publishedBootstrap: string,
    sourceBootstrap: string,
    dependencies: RuntimeMetadataDiscovery,
    writer: GeneratedRegistryWriter,
    format: "import" | "require" = "import",
  ): MetadataAssets {
    const appRoot = dirname(project);
    const outputs = MetadataOutput.paths(project, publishedBootstrap);
    const source = writer.renderDependencies(dependencies, dirname(publishedBootstrap), format);
    const runtime = writer.renderDependencies(dependencies, dirname(outputs.runtime), format);
    const declarations = writer.renderDependencies(dependencies, dirname(outputs.declarations));
    const sourceFiles = MetadataOutput.pair(dirname(sourceBootstrap), source);
    const runtimeFiles = [
      { file: outputs.runtime, source: runtime.runtime },
      { file: outputs.declarations, source: declarations.declarations },
    ];
    const record = MetadataOutput.record(
      appRoot,
      project,
      dirname(sourceBootstrap),
      runtimeFiles,
      dependencies,
    );
    return { source: sourceFiles, runtime: runtimeFiles, record };
  },
});

/**
 * Calculates compiler output and confines restoration payloads.
 */
const MetadataOutput = {
  /**
   * Lists the effective project and inherited configs that control emitted paths.
   *
   * @param project Root TypeScript project configuration.
   * @returns Configuration files in dependency order without duplicates.
   */
  configurationFiles(project: string): readonly string[] {
    const visited = new Set<string>();
    const pending = [project];
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      const config = ts.readConfigFile(file, (path) => ts.sys.readFile(path));
      if (config.error !== undefined) throw new Error(`Cannot read adapter project: ${file}`);
      const inherited: unknown = (config.config as { extends?: unknown }).extends;
      const names = Array.isArray(inherited)
        ? inherited
        : inherited === undefined
          ? []
          : [inherited];
      for (const name of names) {
        if (typeof name !== "string") throw new Error(`Invalid adapter project extends: ${file}`);
        pending.push(createRequire(file).resolve(name));
      }
    }
    return [...visited];
  },

  /**
   * Calculates actual emitted paths, including a separate declaration directory.
   *
   * @param project Effective application project configuration.
   * @param bootstrap Generated TypeScript bootstrap source.
   * @returns Emitted JavaScript and declaration adapter paths.
   */
  paths(
    project: string,
    bootstrap: string,
  ): { readonly runtime: string; readonly declarations: string } {
    const config = ts.readConfigFile(project, (path) => ts.sys.readFile(path));
    if (config.error !== undefined) throw new Error(`Cannot read adapter project: ${project}`);
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      dirname(project),
      undefined,
      project,
    );
    if (parsed.errors.some((error) => error.code !== 18003))
      throw new Error(`Invalid adapter project: ${project}`);
    const command = { ...parsed, fileNames: [...parsed.fileNames, bootstrap] };
    const emitted = ts.getOutputFileNames(command, bootstrap, !ts.sys.useCaseSensitiveFileNames);
    const js = emitted.find((path) => path.endsWith(".js"));
    if (js === undefined) throw new Error(`No JavaScript bootstrap output: ${project}`);
    const dts = emitted.find((path) => path.endsWith(".d.ts")) ?? js.replace(/\.js$/u, ".d.ts");
    return {
      runtime: MetadataOutput.confine(dirname(project), join(dirname(js), "spine-dependencies.js")),
      declarations: MetadataOutput.confine(
        dirname(project),
        join(dirname(dts), "spine-dependencies.d.ts"),
      ),
    };
  },

  /**
   * Adds sibling JavaScript and declaration adapters to the source output.
   *
   * @param directory Generated source directory.
   * @param source Rendered JavaScript and declarations.
   * @returns Two source adapter files.
   */
  pair(
    directory: string,
    source: { readonly runtime: string; readonly declarations: string },
  ): readonly MetadataAsset[] {
    return [
      { file: join(directory, "spine-dependencies.js"), source: source.runtime },
      { file: join(directory, "spine-dependencies.d.ts"), source: source.declarations },
    ];
  },

  /**
   * Records confined emitted payloads and dependency fingerprints for clean restoration.
   *
   * @param appRoot Application package root.
   * @param project Effective TypeScript project configuration.
   * @param sourceDirectory Generated source directory.
   * @param runtime Emitted adapter payloads.
   * @param dependencies Selected public package exports.
   * @returns Generated restoration record.
   */
  record(
    appRoot: string,
    project: string,
    sourceDirectory: string,
    runtime: readonly MetadataAsset[],
    dependencies: RuntimeMetadataDiscovery,
  ): MetadataAsset {
    const canonicalRoot = realpathSync(appRoot);
    const inputs = MetadataOutput.inputFiles(appRoot, project, dependencies);
    const payload = {
      formatVersion: 2,
      inputs: inputs.filter(existsSync).map((file) => ({
        path: relative(appRoot, file),
        hash: MetadataOutput.hash(readFileSync(file)),
      })),
      edges: dependencies.edges.map(({ requester, name, resolved }) => ({
        requester: relative(canonicalRoot, requester) || ".",
        name,
        resolved: resolved === null ? null : relative(canonicalRoot, resolved),
      })),
      runtime: runtime.map(({ file, source }) => ({ path: relative(appRoot, file), source })),
    };
    return {
      file: join(sourceDirectory, "spine-dependencies.json"),
      source: `${JSON.stringify(payload, null, 2)}\n`,
    };
  },

  /**
   * Collects all manifests, compiler configs, and selected published exports.
   *
   * @param appRoot Application package root.
   * @param project Effective TypeScript project configuration.
   * @param dependencies Resolved runtime graph and participating packages.
   * @returns Files whose bytes determine the adapter output.
   */
  inputFiles(
    appRoot: string,
    project: string,
    dependencies: RuntimeMetadataDiscovery,
  ): readonly string[] {
    return [
      join(appRoot, "package.json"),
      ...MetadataOutput.configurationFiles(project),
      ...dependencies.edges.flatMap((edge) =>
        edge.resolved === null ? [] : [join(edge.resolved, "package.json")],
      ),
      ...dependencies.flatMap(({ root, runtimeFile, typesFile }) => [
        join(root, "package.json"),
        runtimeFile,
        typesFile,
      ]),
    ];
  },

  /**
   * Validates that generated adapter destinations remain in the application package.
   *
   * @param root Application package root.
   * @param file Proposed emitted adapter path.
   * @returns Validated absolute path.
   */
  confine(root: string, file: string): string {
    const path = resolve(file);
    const within = relative(root, path);
    if (within.startsWith("..") || isAbsolute(within))
      throw new Error(`Generated adapter output escapes application: ${path}`);
    return path;
  },

  /**
   * Returns a stable fingerprint for a dependency manifest or selected export.
   *
   * @param bytes Exact published input bytes.
   * @returns Stable SHA-256 digest.
   */
  hash(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  },
};
