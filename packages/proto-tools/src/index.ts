import { type Dirent, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

import { isRegistryDependencySpecifier } from "./registry-dependency.js";

/** Version shared by the configuration and published manifest JSON documents. */
export const manifestFormatVersion = 1;

export interface ModelConfig {
  /** Contract version. */
  readonly formatVersion: 1;
  /** Selects an independently published model package. */
  readonly mode: "model";
  /** Name matching the owning package.json file. */
  readonly packageName: string;
  /** Package-contained canonical Proto source root. */
  readonly protoRoot: string;
  /** Package-contained generated TypeScript filesystem root. */
  readonly generatedRoot: string;
  /** Package export subpath root for generated imports. */
  readonly exportRoot: string;
  /** Direct model package dependencies from the npm registry. */
  readonly dependencies: readonly string[];
  /** Generated model-module export name. */
  readonly moduleExport: string;
}

export interface ApplicationConfig {
  /** Contract version. */
  readonly formatVersion: 1;
  /** Selects application model composition. */
  readonly mode: "application";
  /** Direct model package dependencies from the npm registry. */
  readonly modelPackages: readonly string[];
  /** Package-contained generated registry output path. */
  readonly registryOutput: string;
}

/** Version-one model or application configuration selected by mode. */
export type SpineProtoConfig = ModelConfig | ApplicationConfig;

export interface ProtoManifest {
  /** Manifest contract version. */
  readonly formatVersion: 1;
  /** Package that owns every listed Proto source. */
  readonly packageName: string;
  /** Published version matching the owning package.json file. */
  readonly packageVersion: string;
  /** Canonical package-relative owned Proto paths. */
  readonly protoFiles: readonly string[];
  /** Maps each Proto path to a package-relative generated npm import subpath. */
  readonly generatedExports: Readonly<Record<string, string>>;
  /** Direct model dependencies. */
  readonly dependencies: readonly string[];
  /** Generated ProtoModule export name. */
  readonly moduleExport: string;
}

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** Reads and validates the one versioned configuration at a package root. */
export function readConfig(packageRoot: string): SpineProtoConfig {
  const packageJson = readPackage(packageRoot);
  const config = objectValue(
    packageJson.name,
    readJson(join(packageRoot, "spine-proto.json"), packageJson.name),
    "configuration",
  );
  if (config.formatVersion !== manifestFormatVersion)
    fail(packageJson.name, "formatVersion must be 1");
  if (config.mode !== "model" && config.mode !== "application")
    fail(packageJson.name, "mode must be model or application");

  if (config.mode === "application") {
    rejectKeys(
      packageJson.name,
      config,
      ["formatVersion", "mode", "modelPackages", "registryOutput"],
      "application mode",
    );
    const modelPackages = stringList(packageJson.name, config.modelPackages, "modelPackages");
    validateRegistryDependencies(packageJson, modelPackages, "model package");
    return {
      formatVersion: 1,
      mode: "application",
      modelPackages,
      registryOutput: packagePath(
        packageRoot,
        packageJson.name,
        config.registryOutput,
        "registryOutput",
      ),
    };
  }

  rejectKeys(
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
  const packageName = stringValue(packageJson.name, config.packageName, "packageName");
  if (packageName !== packageJson.name)
    fail(packageJson.name, "packageName must match package.json name");
  const dependencies = stringList(packageJson.name, config.dependencies, "dependencies");
  validateRegistryDependencies(packageJson, dependencies, "dependency");
  return {
    formatVersion: 1,
    mode: "model",
    packageName,
    protoRoot: packagePath(packageRoot, packageJson.name, config.protoRoot, "protoRoot"),
    generatedRoot: packagePath(
      packageRoot,
      packageJson.name,
      config.generatedRoot,
      "generatedRoot",
    ),
    exportRoot: packagePath(packageRoot, packageJson.name, config.exportRoot, "exportRoot"),
    dependencies,
    moduleExport: stringValue(packageJson.name, config.moduleExport, "moduleExport"),
  };
}

/** Validates the deterministic manifest shipped by a model package. */
export function readManifest(packageRoot: string): ProtoManifest;
export function readManifest(
  packageRoot: string,
  manifestPath: string = join(packageRoot, "spine-proto-manifest.json"),
): ProtoManifest {
  const packageJson = readPackage(packageRoot);
  const manifest = manifestFromValue(readJson(manifestPath, packageJson.name), packageJson.name);
  if (manifest.packageName !== packageJson.name)
    fail(packageJson.name, "manifest packageName must match package.json name");
  if (manifest.packageVersion !== packageJson.version)
    fail(packageJson.name, "manifest packageVersion must match package.json version");
  for (const protoFile of manifest.protoFiles) {
    assertNoSymlinkAncestor(packageRoot, packageJson.name, protoFile, "manifest protoFiles");
    assertNoSymlinkAncestor(
      packageRoot,
      packageJson.name,
      manifest.generatedExports[protoFile] ?? "",
      `manifest generated export for ${protoFile}`,
    );
  }
  return manifest;
}

/** Builds a deterministic model manifest from the model package's owned Proto paths. */
export function createManifest(
  packageRoot: string,
  ownedProtoFiles?: readonly string[],
): ProtoManifest {
  const config = readConfig(packageRoot);
  if (config.mode !== "model") fail(readPackage(packageRoot).name, "manifest requires model mode");
  const packageJson = readPackage(packageRoot);
  const protoFiles = (
    ownedProtoFiles ?? discoverProtoFiles(join(packageRoot, config.protoRoot), packageJson.name)
  )
    .map((file) => protoPath(packageRoot, packageJson.name, config.protoRoot, file))
    .sort();
  if (new Set(protoFiles).size !== protoFiles.length)
    fail(packageJson.name, "duplicate proto path");
  return {
    formatVersion: 1,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    protoFiles,
    generatedExports: Object.fromEntries(
      protoFiles.map((file) => [file, exportPath(packageJson.name, config.exportRoot, file)]),
    ),
    dependencies: [...config.dependencies].sort(),
    moduleExport: config.moduleExport,
  };
}

function manifestFromValue(value: unknown, requester: string): ProtoManifest {
  const manifest = objectValue(requester, value, "manifest");
  rejectKeys(
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
    fail(requester, "manifest formatVersion must be 1");
  if (Array.isArray(manifest.dependencies) && manifest.dependencies.length > 10000)
    fail(requester, "manifest dependencies exceeds 10000 entries");
  const protoFiles = stringList(requester, manifest.protoFiles, "manifest protoFiles")
    .map((file) => manifestPath(requester, file, "manifest protoFiles"))
    .sort();
  const generatedExports = objectValue(
    requester,
    manifest.generatedExports,
    "manifest generatedExports",
  );
  const keys = Object.keys(generatedExports).sort();
  if (keys.length !== protoFiles.length || keys.some((key, index) => key !== protoFiles[index])) {
    fail(requester, "manifest generatedExports must map every proto file exactly once");
  }
  return {
    formatVersion: 1,
    packageName: stringValue(requester, manifest.packageName, "manifest packageName"),
    packageVersion: stringValue(requester, manifest.packageVersion, "manifest packageVersion"),
    protoFiles,
    generatedExports: Object.fromEntries(
      protoFiles.map((file) => [
        file,
        manifestPath(requester, generatedExports[file], `manifest generated export for ${file}`),
      ]),
    ),
    dependencies: [...stringList(requester, manifest.dependencies, "manifest dependencies")].sort(),
    moduleExport: stringValue(requester, manifest.moduleExport, "manifest moduleExport"),
  };
}

function discoverProtoFiles(root: string, name: string): string[] {
  const files: string[] = [];
  const pending = [{ path: root, relativePath: "", depth: 0 }];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory.path, { encoding: "utf8", withFileTypes: true });
    } catch {
      fail(name, "proto root is missing or inaccessible");
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath =
        directory.relativePath === "" ? entry.name : `${directory.relativePath}/${entry.name}`;
      if (entry.isDirectory()) {
        if (directory.depth >= 100) fail(name, "proto source exceeds 100 directory levels");
        pending.push({
          path: join(directory.path, entry.name),
          relativePath,
          depth: directory.depth + 1,
        });
      } else if (entry.isFile() && entry.name.endsWith(".proto")) {
        files.push(relativePath);
        if (files.length > 10000) fail(name, "proto source exceeds 10000 files");
      }
    }
  }
  return files;
}

function protoPath(packageRoot: string, name: string, protoRoot: string, value: string): string {
  const path = manifestPath(name, value, "proto path");
  assertNoSymlinkAncestor(packageRoot, name, join(protoRoot, path), "proto path");
  return path;
}

function exportPath(name: string, exportRoot: string, protoPath: string): string {
  return manifestPath(
    name,
    `${exportRoot}/${protoPath.replace(/\.proto$/, "_pb.js")}`,
    "generated export",
  );
}

function packagePath(packageRoot: string, name: string, value: unknown, label: string): string {
  const path = manifestPath(name, value, label);
  assertNoSymlinkAncestor(packageRoot, name, path, label);
  return path;
}

function manifestPath(name: string, value: unknown, label: string): string {
  const path = stringValue(name, value, label).replaceAll("\\", "/");
  if (isAbsolute(path)) fail(name, `${label} must be relative`);
  if (path.split("/").includes("..")) fail(name, `${label} must not contain traversal`);
  if (path.endsWith("/") || normalize(path).replaceAll("\\", "/") !== path) {
    fail(name, `${label} must be a normalized contained relative path`);
  }
  return path;
}

function assertNoSymlinkAncestor(
  packageRoot: string,
  name: string,
  path: string,
  label: string,
): void {
  let current = packageRoot;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink())
        fail(name, `${label} must not pass through a symlink`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function validateRegistryDependencies(
  packageJson: PackageJson,
  names: readonly string[],
  label: "dependency" | "model package",
): void {
  for (const name of names) {
    const specifier = packageJson.dependencies[name];
    if (specifier === undefined) {
      fail(packageJson.name, `${label} ${name} must be declared in package.json dependencies`);
    }
    if (!isRegistryDependencySpecifier(specifier)) {
      fail(packageJson.name, `${label} ${name} must use a registry version`);
    }
  }
}

function readPackage(packageRoot: string): PackageJson {
  const value = objectValue(
    packageRoot,
    readJson(join(packageRoot, "package.json"), packageRoot),
    "package.json",
  );
  return {
    name: stringValue(packageRoot, value.name, "package.json name"),
    version: stringValue(packageRoot, value.version, "package.json version"),
    dependencies: stringRecord(value.dependencies, packageRoot, "package.json dependencies"),
  };
}

function readJson(path: string, name: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(name, `cannot read ${path.split(sep).at(-1) ?? path}`);
  }
}

function objectValue(name: string, value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(name, `${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringValue(name: string, value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    fail(name, `${label} must be a non-empty string`);
  return value;
}

function stringList(name: string, value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail(name, `${label} must be an array of non-empty strings`);
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (strings.length !== value.length) fail(name, `${label} must be an array of non-empty strings`);
  if (new Set(strings).size !== strings.length) fail(name, `${label} must not contain duplicates`);
  return strings;
}

function stringRecord(
  value: unknown,
  name: string,
  label: string,
): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  const record = objectValue(name, value, label);
  if (!Object.values(record).every((item) => typeof item === "string"))
    fail(name, `${label} must contain string versions`);
  return record as Record<string, string>;
}

function rejectKeys(
  name: string,
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) fail(name, `${label} must not declare ${unexpected}`);
}

function fail(name: string, message: string): never {
  throw new Error(`spine-proto: ${name}: ${message}`);
}
