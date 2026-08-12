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

import { lstatSync, opendirSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

import { RegistryDependency } from "./model/registry-dependency.js";
import { NpmPackageName } from "./model/npm-package-name.js";

/**
 * Version shared by the configuration and published manifest JSON documents.
 */
export const manifestFormatVersion = 1;

/**
 * Configures an independently published Proto model package.
 */
export interface ModelConfig {
  // prettier-ignore

  /**
   * Declares the version of this configuration contract.
   */
  readonly formatVersion: 1;

  /**
   * Selects an independently published model package.
   */
  readonly mode: "model";

  /**
   * Names the owning npm package.
   */
  readonly packageName: string;

  /**
   * Locates the package-contained canonical Proto sources.
   */
  readonly protoRoot: string;

  /**
   * Locates the package-contained generated TypeScript files.
   */
  readonly generatedRoot: string;

  /**
   * Names the generated import subpath root.
   */
  readonly exportRoot: string;

  /**
   * Lists direct model packages from the npm registry.
   */
  readonly dependencies: readonly string[];

  /**
   * Names the generated model-module export.
   */
  readonly moduleExport: string;
}

/**
 * Configures an application that composes published Proto model packages.
 */
export interface ApplicationConfig {
  // prettier-ignore

  /**
   * Declares the version of this configuration contract.
   */
  readonly formatVersion: 1;

  /**
   * Selects application model composition.
   */
  readonly mode: "application";

  /**
   * Lists direct model packages from the npm registry.
   */
  readonly modelPackages: readonly string[];

  /**
   * Locates the generated package registry source file.
   */
  readonly registryOutput: string;
}

/**
 * Version-one model or application configuration selected by mode.
 */
export type SpineProtoConfig = ModelConfig | ApplicationConfig;

/**
 * Describes the Proto sources and generated exports owned by a model package.
 */
export interface ProtoManifest {
  // prettier-ignore

  /**
   * Declares the version of this manifest contract.
   */
  readonly formatVersion: 1;

  /**
   * Names the package that owns every listed Proto source.
   */
  readonly packageName: string;

  /**
   * States the declared version from the owning package.json file.
   */
  readonly packageVersion: string;

  /**
   * Lists canonical package-relative Proto paths owned by the package.
   */
  readonly protoFiles: readonly string[];

  /**
   * Maps each Proto path to its generated package-relative import subpath.
   */
  readonly generatedExports: Readonly<Record<string, string>>;

  /**
   * Lists direct model-package dependencies.
   */
  readonly dependencies: readonly string[];

  /**
   * Names the generated ProtoModule export.
   */
  readonly moduleExport: string;
}

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly exports: Readonly<Record<string, unknown>>;
}

const reservedBindings = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * Reports invalid contained Proto package contracts.
 */
const ProtoPackageErrors: Readonly<{ fail(name: string, message: string): never }> = Object.freeze({
  fail(name: string, message: string): never {
    throw new Error(`spine-proto: ${name}: ${message}`);
  },
});

/**
 * Reads, validates, and creates contained Proto package contracts.
 */
const ProtoPackage = Object.freeze({
  // prettier-ignore

  /**
   * Reads and validates versioned `spine-proto.json` package configuration.
   */
  configFromPackage(packageRoot: string): SpineProtoConfig {
    const packageJson = ProtoPackage.readPackage(packageRoot);
    const config = ProtoPackage.objectValue(
      packageJson.name,
      ProtoPackage.readJson(join(packageRoot, "spine-proto.json"), packageJson.name),
      "configuration",
    );
    if (config.formatVersion !== manifestFormatVersion)
      ProtoPackageErrors.fail(packageJson.name, "formatVersion must be 1");
    if (config.mode !== "model" && config.mode !== "application")
      ProtoPackageErrors.fail(packageJson.name, "mode must be model or application");

    if (config.mode === "application") {
      ProtoPackage.rejectKeys(
        packageJson.name,
        config,
        ["formatVersion", "mode", "modelPackages", "registryOutput"],
        "application mode",
      );
      const modelPackages = ProtoPackage.packageNameList(
        packageJson.name,
        config.modelPackages,
        "modelPackages",
      );
      ProtoPackage.validateRegistryDependencies(packageJson, modelPackages, "model package");
      const registryOutput = ProtoPackage.packagePath(
        packageRoot,
        packageJson.name,
        config.registryOutput,
        "registryOutput",
      );
      if (ProtoPackage.isReservedOutput(registryOutput))
        ProtoPackageErrors.fail(packageJson.name, "registryOutput must name a safe source file");
      return {
        formatVersion: 1,
        mode: "application",
        modelPackages,
        registryOutput,
      };
    }

    ProtoPackage.rejectKeys(
      packageJson.name,
      config,
      [
        "formatVersion",
        "mode",
        "packageName",
        "protoRoot",
        "generatedRoot",
        "exportRoot",
        "dependencies",
        "moduleExport",
      ],
      "model mode",
    );
    const packageName = ProtoPackage.packageNameValue(
      packageJson.name,
      config.packageName,
      "packageName",
    );
    if (packageName !== packageJson.name)
      ProtoPackageErrors.fail(packageJson.name, "packageName must match package.json name");
    const dependencies = ProtoPackage.packageNameList(
      packageJson.name,
      config.dependencies,
      "dependencies",
    );
    ProtoPackage.validateRegistryDependencies(packageJson, dependencies, "dependency");
    const protoRoot = ProtoPackage.packagePath(
      packageRoot,
      packageJson.name,
      config.protoRoot,
      "protoRoot",
    );
    const generatedRoot = ProtoPackage.packagePath(
      packageRoot,
      packageJson.name,
      config.generatedRoot,
      "generatedRoot",
    );
    if (
      generatedRoot === "." ||
      ["package.json", "spine-proto.json", "spine-proto-manifest.json"].includes(generatedRoot) ||
      ProtoPackage.pathsOverlap(protoRoot, generatedRoot)
    )
      ProtoPackageErrors.fail(
        packageJson.name,
        "generatedRoot must not overlap protoRoot or package root",
      );
    const exportRoot = ProtoPackage.packagePath(
      packageRoot,
      packageJson.name,
      config.exportRoot,
      "exportRoot",
    );
    ProtoPackage.validateGeneratedExports(packageJson, exportRoot);
    return {
      formatVersion: 1,
      mode: "model",
      packageName,
      protoRoot,
      generatedRoot,
      exportRoot,
      dependencies,
      moduleExport: ProtoPackage.bindingIdentifier(
        packageJson.name,
        config.moduleExport,
        "moduleExport",
      ),
    };
  },

  /**
   * Validates a deterministic manifest shipped by a model package.
   */
  manifestFromPackage(
    packageRoot: string,
    manifestPath: string = join(packageRoot, "spine-proto-manifest.json"),
  ): ProtoManifest {
    const packageJson = ProtoPackage.readPackage(packageRoot);
    const manifest = ProtoPackage.manifestFromValue(
      ProtoPackage.readJson(manifestPath, packageJson.name),
      packageJson.name,
    );
    if (manifest.packageName !== packageJson.name)
      ProtoPackageErrors.fail(
        packageJson.name,
        "manifest packageName must match package.json name",
      );
    if (manifest.packageVersion !== packageJson.version)
      ProtoPackageErrors.fail(
        packageJson.name,
        "manifest packageVersion must match package.json version",
      );
    for (const protoFile of manifest.protoFiles) {
      ProtoPackage.assertNoSymlinkAncestor(
        packageRoot,
        packageJson.name,
        protoFile,
        "manifest protoFiles",
      );
      ProtoPackage.assertNoSymlinkAncestor(
        packageRoot,
        packageJson.name,
        manifest.generatedExports[protoFile] ?? "",
        `manifest generated export for ${protoFile}`,
      );
    }
    return manifest;
  },

  /**
   * Builds a deterministic manifest from a model package's owned Proto paths.
   */
  manifestForPackage(packageRoot: string, ownedProtoFiles?: readonly string[]): ProtoManifest {
    const config = ProtoPackage.configFromPackage(packageRoot);
    if (config.mode !== "model")
      ProtoPackageErrors.fail(
        ProtoPackage.readPackage(packageRoot).name,
        "manifest requires model mode",
      );
    const packageJson = ProtoPackage.readPackage(packageRoot);
    if (ownedProtoFiles !== undefined && ownedProtoFiles.length > 10000)
      ProtoPackageErrors.fail(packageJson.name, "owned Proto paths exceeds 10000 entries");
    const protoFiles = (
      ownedProtoFiles ??
      ProtoPackage.discoverProtoFiles(join(packageRoot, config.protoRoot), packageJson.name)
    )
      .map((file) => ProtoPackage.protoPath(packageRoot, packageJson.name, config.protoRoot, file))
      .sort();
    if (new Set(protoFiles).size !== protoFiles.length)
      ProtoPackageErrors.fail(packageJson.name, "duplicate proto path");
    return {
      formatVersion: 1,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
      protoFiles,
      generatedExports: Object.fromEntries(
        protoFiles.map((file) => [
          file,
          ProtoPackage.exportPath(packageJson.name, config.exportRoot, file),
        ]),
      ),
      dependencies: [...config.dependencies].sort(),
      moduleExport: config.moduleExport,
    };
  },

  manifestFromValue(value: unknown, requester: string): ProtoManifest {
    const manifest = ProtoPackage.objectValue(requester, value, "manifest");
    ProtoPackage.rejectKeys(
      requester,
      manifest,
      [
        "formatVersion",
        "packageName",
        "packageVersion",
        "protoFiles",
        "generatedExports",
        "dependencies",
        "moduleExport",
      ],
      "manifest",
    );
    if (manifest.formatVersion !== manifestFormatVersion)
      ProtoPackageErrors.fail(requester, "manifest formatVersion must be 1");
    const protoFiles = ProtoPackage.stringList(
      requester,
      manifest.protoFiles,
      "manifest protoFiles",
    )
      .map((file) => ProtoPackage.manifestPath(requester, file, "manifest protoFiles"))
      .sort();
    const generatedExports = ProtoPackage.objectValue(
      requester,
      manifest.generatedExports,
      "manifest generatedExports",
    );
    ProtoPackage.assertRecordBound(requester, generatedExports, "manifest generatedExports");
    const keys = Object.keys(generatedExports).sort();
    if (keys.length !== protoFiles.length || keys.some((key, index) => key !== protoFiles[index])) {
      ProtoPackageErrors.fail(
        requester,
        "manifest generatedExports must map every proto file exactly once",
      );
    }
    return {
      formatVersion: 1,
      packageName: ProtoPackage.packageNameValue(
        requester,
        manifest.packageName,
        "manifest packageName",
      ),
      packageVersion: ProtoPackage.stringValue(
        requester,
        manifest.packageVersion,
        "manifest packageVersion",
      ),
      protoFiles,
      generatedExports: Object.fromEntries(
        protoFiles.map((file) => [
          file,
          ProtoPackage.manifestPath(
            requester,
            generatedExports[file],
            `manifest generated export for ${file}`,
          ),
        ]),
      ),
      dependencies: [
        ...ProtoPackage.packageNameList(requester, manifest.dependencies, "manifest dependencies"),
      ].sort(),
      moduleExport: ProtoPackage.bindingIdentifier(
        requester,
        manifest.moduleExport,
        "manifest moduleExport",
      ),
    };
  },

  discoverProtoFiles(root: string, name: string): string[] {
    const files: string[] = [];
    const pending = [{ path: root, relativePath: "", depth: 0 }];
    let encountered = 0;
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) break;
      let directoryHandle: ReturnType<typeof opendirSync>;
      try {
        directoryHandle = opendirSync(directory.path, { encoding: "utf8" });
      } catch {
        ProtoPackageErrors.fail(name, "proto root is missing or inaccessible");
      }
      try {
        for (
          let entry = directoryHandle.readSync();
          entry !== null;
          entry = directoryHandle.readSync()
        ) {
          encountered += 1;
          if (encountered > 10000)
            ProtoPackageErrors.fail(name, "proto source exceeds 10000 entries");
          const relativePath =
            directory.relativePath === "" ? entry.name : `${directory.relativePath}/${entry.name}`;
          if (entry.isDirectory()) {
            if (directory.depth >= 100)
              ProtoPackageErrors.fail(name, "proto source exceeds 100 directory levels");
            pending.push({
              path: join(directory.path, entry.name),
              relativePath,
              depth: directory.depth + 1,
            });
          } else if (entry.isFile() && entry.name.endsWith(".proto")) {
            files.push(relativePath);
          }
        }
      } finally {
        directoryHandle.closeSync();
      }
    }
    return files;
  },

  protoPath(packageRoot: string, name: string, protoRoot: string, value: string): string {
    const path = ProtoPackage.manifestPath(name, value, "proto path");
    ProtoPackage.assertNoSymlinkAncestor(packageRoot, name, join(protoRoot, path), "proto path");
    return path;
  },

  exportPath(name: string, exportRoot: string, protoPath: string): string {
    return ProtoPackage.manifestPath(
      name,
      `${exportRoot}/${protoPath.replace(/\.proto$/, "_pb.js")}`,
      "generated export",
    );
  },

  packagePath(packageRoot: string, name: string, value: unknown, label: string): string {
    const path = ProtoPackage.manifestPath(name, value, label);
    ProtoPackage.assertNoSymlinkAncestor(packageRoot, name, path, label);
    return path;
  },

  pathsOverlap(left: string, right: string): boolean {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  },

  isReservedOutput(path: string): boolean {
    return (
      path === "." ||
      ["package.json", "spine-proto.json", "spine-proto-manifest.json"].includes(path) ||
      !path.includes(".")
    );
  },

  bindingIdentifier(name: string, value: unknown, label: string): string {
    const identifier = ProtoPackage.stringValue(name, value, label);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier) || reservedBindings.has(identifier))
      ProtoPackageErrors.fail(name, `${label} must be a legal ESM binding identifier`);
    return identifier;
  },

  manifestPath(name: string, value: unknown, label: string): string {
    const path = ProtoPackage.stringValue(name, value, label).replaceAll("\\", "/");
    if (isAbsolute(path)) ProtoPackageErrors.fail(name, `${label} must be relative`);
    if (path.split("/").includes(".."))
      ProtoPackageErrors.fail(name, `${label} must not contain traversal`);
    if (path.endsWith("/") || normalize(path).replaceAll("\\", "/") !== path) {
      ProtoPackageErrors.fail(name, `${label} must be a normalized contained relative path`);
    }
    return path;
  },

  assertNoSymlinkAncestor(packageRoot: string, name: string, path: string, label: string): void {
    let current = packageRoot;
    for (const segment of path.split("/")) {
      current = join(current, segment);
      try {
        if (lstatSync(current).isSymbolicLink())
          ProtoPackageErrors.fail(name, `${label} must not pass through a symlink`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  },

  validateRegistryDependencies(
    packageJson: PackageJson,
    names: readonly string[],
    label: "dependency" | "model package",
  ): void {
    for (const name of names) {
      const specifier = packageJson.dependencies[name];
      if (specifier === undefined) {
        ProtoPackageErrors.fail(
          packageJson.name,
          `${label} ${name} must be declared in package.json dependencies`,
        );
      }
      if (!RegistryDependency.is(specifier)) {
        ProtoPackageErrors.fail(packageJson.name, `${label} ${name} must use a registry version`);
      }
    }
  },

  validateGeneratedExports(packageJson: PackageJson, exportRoot: string): void {
    const key = `./${exportRoot}/*.js`;
    const entry = packageJson.exports[key];
    const expectedRuntime = `./dist/${exportRoot}/*.js`;
    const expectedTypes = `./dist/${exportRoot}/*.d.ts`;
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      (entry as Record<string, unknown>).default !== expectedRuntime ||
      (entry as Record<string, unknown>).types !== expectedTypes
    ) {
      ProtoPackageErrors.fail(
        packageJson.name,
        `package.json exports must expose ${key} with default ${expectedRuntime} and types ${expectedTypes}`,
      );
    }
  },

  readPackage(packageRoot: string): PackageJson {
    const value = ProtoPackage.objectValue(
      packageRoot,
      ProtoPackage.readJson(join(packageRoot, "package.json"), packageRoot),
      "package.json",
    );
    const name = ProtoPackage.packageNameValue(packageRoot, value.name, "package.json name");
    return {
      name,
      version: ProtoPackage.stringValue(name, value.version, "package.json version"),
      dependencies: ProtoPackage.stringRecord(
        value.dependencies,
        name,
        "package.json dependencies",
      ),
      exports:
        value.exports === undefined
          ? {}
          : ProtoPackage.objectValue(name, value.exports, "package.json exports"),
    };
  },

  readJson(path: string, name: string): unknown {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return ProtoPackageErrors.fail(name, `cannot read ${path.split(sep).at(-1) ?? path}`);
    }
  },

  objectValue(name: string, value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return ProtoPackageErrors.fail(name, `${label} must be an object`);
    return value as Record<string, unknown>;
  },

  stringValue(name: string, value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0)
      return ProtoPackageErrors.fail(name, `${label} must be a non-empty string`);
    return value;
  },

  stringList(name: string, value: unknown, label: string): readonly string[] {
    if (!Array.isArray(value))
      ProtoPackageErrors.fail(name, `${label} must be an array of non-empty strings`);
    if (value.length > 10000) ProtoPackageErrors.fail(name, `${label} exceeds 10000 entries`);
    const strings = value.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    if (strings.length !== value.length)
      ProtoPackageErrors.fail(name, `${label} must be an array of non-empty strings`);
    if (new Set(strings).size !== strings.length)
      ProtoPackageErrors.fail(name, `${label} must not contain duplicates`);
    return strings;
  },

  packageNameValue(name: string, value: unknown, label: string): string {
    const packageName = ProtoPackage.stringValue(name, value, label);
    if (!NpmPackageName.is(packageName))
      ProtoPackageErrors.fail(name, `${label} must be a valid npm package name`);
    return packageName;
  },

  packageNameList(name: string, value: unknown, label: string): readonly string[] {
    return ProtoPackage.stringList(name, value, label).map((packageName) =>
      ProtoPackage.packageNameValue(name, packageName, label),
    );
  },

  assertRecordBound(name: string, record: Readonly<Record<string, unknown>>, label: string): void {
    let count = 0;
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      count += 1;
      if (count > 10000) ProtoPackageErrors.fail(name, `${label} exceeds 10000 entries`);
    }
  },

  stringRecord(value: unknown, name: string, label: string): Readonly<Record<string, string>> {
    if (value === undefined) return {};
    const record = ProtoPackage.objectValue(name, value, label);
    if (!Object.values(record).every((item) => typeof item === "string"))
      ProtoPackageErrors.fail(name, `${label} must contain string versions`);
    return record as Record<string, string>;
  },

  rejectKeys(
    name: string,
    value: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
    label: string,
  ): void {
    const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
    if (unexpected !== undefined)
      ProtoPackageErrors.fail(name, `${label} must not declare ${unexpected}`);
  },
});

/**
 * Provides access to the versioned Proto package configuration.
 */
export const ProtoConfig: Readonly<{
  // prettier-ignore

  /**
   * Reads and validates `spine-proto.json` at a package root.
   *
   * @param packageRoot The package root that contains the configuration.
   * @returns The validated model or application configuration.
   */
  read(packageRoot: string): SpineProtoConfig;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Reads and validates `spine-proto.json` at a package root.
   *
   * @param packageRoot The package root that contains the configuration.
   * @returns The validated model or application configuration.
   */
  read(packageRoot: string): SpineProtoConfig {
    return ProtoPackage.configFromPackage(packageRoot);
  },
});

/**
 * Provides access to deterministic Proto package manifests.
 */
export const ProtoManifest: Readonly<{
  // prettier-ignore

  /**
   * Reads and validates a package manifest.
   *
   * @param packageRoot The package root that owns the manifest.
   * @param manifestPath The optional manifest path within the package root.
   * @returns The validated manifest.
   */
  read(packageRoot: string, manifestPath?: string): ProtoManifest;

  /**
   * Creates a deterministic manifest from package-owned Proto paths.
   *
   * @param packageRoot The model package root.
   * @param ownedProtoFiles Optional explicit package-relative Proto paths.
   * @returns The created manifest.
   */
  create(packageRoot: string, ownedProtoFiles?: readonly string[]): ProtoManifest;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Reads and validates a package manifest.
   *
   * @param packageRoot The package root that owns the manifest.
   * @param manifestPath The optional manifest path within the package root.
   * @returns The validated manifest.
   */
  read(
    packageRoot: string,
    manifestPath: string = join(packageRoot, "spine-proto-manifest.json"),
  ): ProtoManifest {
    return ProtoPackage.manifestFromPackage(packageRoot, manifestPath);
  },

  /**
   * Creates a deterministic manifest from package-owned Proto paths.
   *
   * @param packageRoot The model package root.
   * @param ownedProtoFiles Optional explicit package-relative Proto paths.
   * @returns The created manifest.
   */
  create(packageRoot: string, ownedProtoFiles?: readonly string[]): ProtoManifest {
    return ProtoPackage.manifestForPackage(packageRoot, ownedProtoFiles);
  },
});
