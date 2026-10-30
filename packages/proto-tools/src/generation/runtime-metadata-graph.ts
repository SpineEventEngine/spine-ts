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

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";

/**
 * An installed package that publishes passive Spine metadata.
 */
export interface RuntimeMetadataPackage {
  /**
   * Published package label used for registration and diagnostics.
   */
  readonly name: string;

  /**
   * Resolved package version.
   */
  readonly version: string;

  /**
   * Canonical installed package location used for diamond deduplication.
   */
  readonly root: string;

  /**
   * JavaScript target imported by the generated dependency adapter.
   */
  readonly runtimeFile: string;

  /**
   * Declaration target imported by the generated dependency adapter.
   */
  readonly typesFile: string;
}

/**
 * A declared runtime dependency and its resolved installation, if present.
 */
export interface RuntimeMetadataEdge {
  /**
   * Declared package name.
   */
  readonly name: string;

  /**
   * Package root from which Node resolves this dependency.
   */
  readonly requester: string;

  /**
   * Canonical installed root or null for an absent optional dependency.
   */
  readonly resolved: string | null;
}

/**
 * Participating metadata plus every traversed runtime dependency edge.
 */
export interface RuntimeMetadataDiscovery extends ReadonlyArray<RuntimeMetadataPackage> {
  /**
   * Edges used to detect stale generated adapters after installation changes.
   */
  readonly edges: readonly RuntimeMetadataEdge[];
}

type RuntimePackageIdentity = Pick<RuntimeMetadataPackage, "name" | "version" | "root">;

interface RuntimePackageJson {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
}

interface StagedMetadata {
  readonly packageName: string;
  readonly staged: string;
  readonly moduleRoot?: string;
}

interface RuntimeStep {
  readonly name: string;
  readonly requester: string;
  readonly optional: boolean;
}

interface RuntimeGraphState {
  readonly format: "import" | "require";
  readonly visited: Map<string, RuntimePackageIdentity>;
  readonly versions: Map<string, RuntimePackageIdentity>;
  readonly schemas: Map<string, RuntimePackageIdentity>;
  readonly result: RuntimeMetadataPackage[];
  readonly edges: RuntimeMetadataEdge[];
  readonly staged: readonly StagedMetadata[];
}

/**
 * Resolves passive metadata participants from declared runtime dependencies.
 */
export const RuntimeMetadataGraph: Readonly<{
  resolve(
    applicationRoot: string,
    staged?: readonly StagedMetadata[],
    format?: "import" | "require",
  ): RuntimeMetadataDiscovery;
  format(applicationRoot: string): "import" | "require";
}> = Object.freeze({
  /**
   * Walks installed dependency packages without loading their runtime modules.
   *
   * @param applicationRoot Root of the application package.
   * @param staged Generated outputs from the same atomic generation transaction.
   * @param format Node runtime condition of the compiled consumer.
   * @returns Participating packages in deterministic dependency order.
   */
  resolve(
    applicationRoot: string,
    staged: readonly StagedMetadata[] = [],
    format: "import" | "require" = RuntimeMetadataGraph.format(applicationRoot),
  ): RuntimeMetadataDiscovery {
    if (!existsSync(join(applicationRoot, "package.json"))) return Object.assign([], { edges: [] });
    const canonicalRoot = realpathSync(applicationRoot);
    const root = RuntimePackage.read(join(canonicalRoot, "package.json"));
    const graph: RuntimeGraphState = {
      format,
      visited: new Map(),
      versions: new Map(),
      schemas: new Map(),
      result: [],
      edges: [],
      staged,
    };
    const pending = RuntimePackage.steps(root, canonicalRoot);
    while (pending.length > 0) {
      const step = pending.pop();
      if (step !== undefined) RuntimePackage.visit(step, graph, pending);
    }
    return Object.assign(
      graph.result.sort((left, right) => left.name.localeCompare(right.name)),
      {
        edges: graph.edges.sort((left, right) =>
          `${left.requester}/${left.name}`.localeCompare(`${right.requester}/${right.name}`),
        ),
      },
    );
  },

  /**
   * Returns the NodeNext runtime condition for an application package.
   *
   * @param applicationRoot Package root holding its package manifest.
   * @returns ESM import or CommonJS require condition.
   */
  format(applicationRoot: string): "import" | "require" {
    const manifest = join(applicationRoot, "package.json");
    if (!existsSync(manifest)) return "require";
    const value: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    return (value as { type?: unknown }).type === "module" ? "import" : "require";
  },
});

/**
 * Validates installed package metadata and conventional export files.
 */
const RuntimePackage = {
  /**
   * Resolves a declared dependency, checks its metadata, and queues its runtime dependencies.
   *
   * @param step The dependency name and requester package.
   * @param graph Accumulated package identities and metadata claims.
   * @param pending Remaining dependency edges.
   */
  visit(step: RuntimeStep, graph: RuntimeGraphState, pending: RuntimeStep[]): void {
    const installedRoot = RuntimePackage.location(step, graph);
    if (installedRoot === null) return;
    const manifest = RuntimePackage.read(join(installedRoot, "package.json"));
    const item: RuntimePackageIdentity = {
      name: manifest.name,
      version: manifest.version,
      root: installedRoot,
    };
    if (manifest.exports?.["./spine"] !== undefined) RuntimePackage.unique(graph.versions, item);
    if (graph.visited.has(installedRoot)) return;
    graph.visited.set(installedRoot, item);
    RuntimePackage.participant(manifest, item, graph.result, graph.staged, graph.format);
    if (manifest.exports?.["./spine"] !== undefined)
      RuntimePackage.claimSchemas(item, graph.schemas);
    pending.push(...RuntimePackage.steps(manifest, installedRoot));
  },

  /**
   * Resolves and records one dependency edge without importing its module.
   *
   * @param step Declared dependency and requester.
   * @param graph Accumulated edge record.
   * @returns Canonical package location, or null for an absent optional package.
   */
  location(step: RuntimeStep, graph: RuntimeGraphState): string | null {
    let packagePath: string | undefined;
    try {
      packagePath = findPackageJSON(step.name, join(step.requester, "package.json"));
    } catch (error) {
      if (step.optional && (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
        graph.edges.push({ name: step.name, requester: step.requester, resolved: null });
        return null;
      }
      throw error;
    }
    if (packagePath === undefined) {
      if (step.optional) {
        graph.edges.push({ name: step.name, requester: step.requester, resolved: null });
        return null;
      }
      throw new Error(
        `spine-proto: cannot resolve runtime dependency ${step.name} from ${step.requester}`,
      );
    }
    const installedRoot = realpathSync(dirname(packagePath));
    graph.edges.push({ name: step.name, requester: step.requester, resolved: installedRoot });
    return installedRoot;
  },

  /**
   * Reads one installed package manifest.
   *
   * @param path Package manifest path.
   * @returns Validated runtime dependency fields.
   */
  read(path: string): RuntimePackageJson {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(`spine-proto: invalid package manifest ${path}`);
    const manifest = value as Record<string, unknown>;
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string")
      throw new Error(`spine-proto: invalid package identity ${path}`);
    if (!RuntimePackage.stringRecord(manifest.dependencies))
      throw new Error(`spine-proto: invalid runtime dependencies ${path}`);
    if (!RuntimePackage.stringRecord(manifest.optionalDependencies))
      throw new Error(`spine-proto: invalid optional runtime dependencies ${path}`);
    return manifest as unknown as RuntimePackageJson;
  },

  /**
   * Returns ordered required and optional runtime dependency steps.
   *
   * @param manifest Installed package dependency declarations.
   * @param requester Package root used for ordinary Node resolution.
   * @returns Stack-ordered dependency edges.
   */
  steps(manifest: RuntimePackageJson, requester: string): RuntimeStep[] {
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
    return [...names]
      .sort()
      .reverse()
      .map((name) => ({
        name,
        requester,
        optional: manifest.optionalDependencies?.[name] !== undefined,
      }));
  },

  /**
   * Checks that one package name never resolves to incompatible installations.
   *
   * @param versions Previously resolved package names.
   * @param item New resolved package.
   */
  unique(versions: Map<string, RuntimePackageIdentity>, item: RuntimePackageIdentity): void {
    const prior = versions.get(item.name);
    if (prior !== undefined && (prior.version !== item.version || prior.root !== item.root))
      throw new Error(
        `spine-proto: ${item.name} resolves to ${prior.version} at ${prior.root} and ${item.version} at ${item.root}`,
      );
    versions.set(item.name, item);
  },

  /**
   * Checks published Proto provenance for stale identity and duplicate schema claims.
   *
   * @param item Participating package identity.
   * @param schemas Previously claimed Proto paths.
   */
  claimSchemas(item: RuntimePackageIdentity, schemas: Map<string, RuntimePackageIdentity>): void {
    const path = join(item.root, "spine-proto-manifest.json");
    if (!existsSync(path)) return;
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(`spine-proto: ${item.name} has malformed Proto manifest`);
    const manifest = value as Record<string, unknown>;
    if (
      manifest.packageName !== item.name ||
      manifest.packageVersion !== item.version ||
      !Array.isArray(manifest.protoFiles) ||
      !manifest.protoFiles.every((file) => typeof file === "string")
    )
      throw new Error(`spine-proto: ${item.name} has stale Proto manifest`);
    for (const file of manifest.protoFiles) {
      const prior = schemas.get(file);
      if (prior !== undefined && prior.root !== item.root)
        throw new Error(`spine-proto: ${prior.name} and ${item.name} both claim ${file}`);
      schemas.set(file, item);
    }
  },

  /**
   * Adds a published metadata participant after checking both artifacts.
   *
   * @param manifest Installed package manifest.
   * @param item Resolved package identity.
   * @param result Participant output list.
   * @param staged Generated outputs from the same atomic generation transaction.
   * @param format Runtime module condition selected by the consuming application.
   */
  participant(
    manifest: RuntimePackageJson,
    item: RuntimePackageIdentity,
    result: RuntimeMetadataPackage[],
    staged: readonly StagedMetadata[],
    format: "import" | "require",
  ): void {
    const entry = manifest.exports?.["./spine"];
    if (entry === undefined) return;
    const artifacts = RuntimePackage.exportArtifacts(item, entry, format);
    const candidate = staged.find((redirect) => redirect.packageName === item.name);
    const stagedRoot = candidate?.moduleRoot ?? candidate?.staged;
    if (stagedRoot !== undefined && existsSync(join(stagedRoot, "spine-metadata.ts"))) {
      RuntimePackage.assertMetadataExport(item, join(stagedRoot, "spine-metadata.ts"));
      result.push({ ...item, typesFile: artifacts[0] ?? "", runtimeFile: artifacts[1] ?? "" });
      return;
    }
    for (const [index, file] of artifacts.entries())
      if (!existsSync(file))
        throw new Error(
          `spine-proto: ${item.name}/spine missing published ${index === 0 ? "types" : format} file`,
        );
    RuntimePackage.assertMetadataExport(item, artifacts[1] ?? "");
    RuntimePackage.scanInitialization(item, artifacts[1] ?? "");
    result.push({ ...item, typesFile: artifacts[0] ?? "", runtimeFile: artifacts[1] ?? "" });
  },

  /**
   * Resolves the conventional JavaScript and declaration export paths safely.
   *
   * @param item Installed package identity.
   * @param entry Conventional package export value.
   * @param format Runtime module condition selected by the consumer.
   * @returns Declaration path followed by runtime JavaScript path.
   */
  exportArtifacts(
    item: RuntimePackageIdentity,
    entry: unknown,
    format: "import" | "require",
  ): readonly string[] {
    const targets =
      typeof entry === "string"
        ? [
            entry.replace(/\.(cjs|mjs|js)$/u, (_suffix, extension: string) =>
              extension === "cjs" ? ".d.cts" : extension === "mjs" ? ".d.mts" : ".d.ts",
            ),
            entry,
          ]
        : [
            RuntimePackage.selectExport(entry, "types", format),
            RuntimePackage.selectExport(entry, format, format),
          ];
    return targets.map((target, index) => {
      const field = index === 0 ? "types" : format;
      if (
        typeof target !== "string" ||
        !target.startsWith("./") ||
        (index === 0 && !/\.d\.(?:ts|mts|cts)$/u.test(target))
      )
        throw new Error(`spine-proto: ${item.name}/spine missing published ${field} file`);
      const file = resolve(item.root, target);
      const inside = relative(item.root, file);
      if (inside.startsWith("..") || isAbsolute(inside))
        throw new Error(`spine-proto: ${item.name}/spine export escapes package root`);
      return file;
    });
  },

  /**
   * Returns a published ESM or declaration export through ordered Node conditions.
   *
   * @param entry Conditional export branch.
   * @param target Runtime or declaration condition.
   * @param format Runtime condition governing nested declaration selection.
   * @returns Selected relative export path, if supported.
   */
  selectExport(
    entry: unknown,
    target: "types" | "import" | "require",
    format: "import" | "require",
  ): string | undefined {
    if (typeof entry === "string") return target === "types" ? undefined : entry;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
    for (const [condition, branch] of Object.entries(entry)) {
      if (
        (condition === "require" && format === "import") ||
        (condition === "import" && format === "require") ||
        (condition === "types" && target !== "types")
      )
        continue;
      if (!["types", "import", "require", "node", "default"].includes(condition)) continue;
      if (condition === "types" && target === "types" && typeof branch === "string") return branch;
      if (condition === "types") continue;
      const selected = RuntimePackage.selectExport(branch, target, format);
      if (selected !== undefined) return selected;
    }
    return undefined;
  },

  /**
   * Checks that a published metadata module provides the conventional binding.
   *
   * @param item Package whose export is inspected.
   * @param file Published or staged metadata module.
   */
  assertMetadataExport(item: RuntimePackageIdentity, file: string): void {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ESNext,
      false,
    );
    const exported = source.statements.some((statement) => {
      if (ts.isVariableStatement(statement))
        return (
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
          statement.declarationList.declarations.some(
            (declaration) =>
              ts.isIdentifier(declaration.name) && declaration.name.text === "spineMetadata",
          )
        );
      if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
      )
        return statement.exportClause.elements.some(
          (element) => element.name.text === "spineMetadata",
        );
      return RuntimePackage.commonJsMetadata(statement, source);
    });
    if (!exported) throw new Error(`spine-proto: ${item.name}/spine lacks spineMetadata export`);
  },

  /**
   * Checks a CommonJS published metadata assignment without executing its module.
   *
   * @param statement Parsed top-level JavaScript statement.
   * @param source Parsed metadata module for expression text.
   * @returns Whether the statement assigns the published metadata binding.
   */
  commonJsMetadata(statement: ts.Statement, source: ts.SourceFile): boolean {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression))
      return false;
    const left = statement.expression.left;
    return (
      ts.isPropertyAccessExpression(left) &&
      left.name.text === "spineMetadata" &&
      (left.expression.getText(source) === "exports" ||
        left.expression.getText(source) === "module.exports")
    );
  },

  /**
   * Rejects imports from passive metadata back into generated startup code.
   *
   * @param item Package whose metadata is inspected.
   * @param entry Published metadata JavaScript file.
   */
  scanInitialization(item: RuntimePackageIdentity, entry: string): void {
    const seen = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      for (const imported of ts.preProcessFile(readFileSync(file, "utf8"), true, true)
        .importedFiles) {
        const specifier = imported.fileName;
        if (!specifier.startsWith(".")) continue;
        if (specifier.endsWith("/spine-bootstrap.js"))
          throw new Error(
            `spine-proto: ${item.name} metadata initialization cycle through ${file}`,
          );
        pending.push(resolve(dirname(file), specifier));
      }
    }
  },

  /**
   * Validates dependency field shape while allowing an omitted field.
   *
   * @param value Untrusted package manifest field.
   * @returns Whether the field maps names to version specifiers.
   */
  stringRecord(value: unknown): boolean {
    return (
      value === undefined ||
      (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        Object.values(value).every((entry) => typeof entry === "string"))
    );
  },
};
