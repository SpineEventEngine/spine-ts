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
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { satisfies, validRange } from "semver";

import { type ProtoManifest } from "../index.js";
import { readManifestAt } from "../io/manifest-reader.js";
import { RegistryDependency } from "./registry-dependency.js";
import { NpmPackageName } from "./npm-package-name.js";

/**
 * Describes one installed model package in a resolved dependency graph.
 */
export interface ResolvedModel {
  // prettier-ignore

  /**
   * Names the resolved model package.
   */
  readonly name: string;

  /**
   * States the resolved package version.
   */
  readonly version: string;

  /**
   * Names the package export that provides its Proto module.
   */
  readonly moduleExport: string;

  /**
   * Locates the installed package root.
   */
  readonly root: string;
}

/**
 * Identifies the model package that owns a generated Proto path.
 */
export interface ProtoOwner {
  // prettier-ignore

  /**
   * Names the package that owns the Proto path.
   */
  readonly packageName: string;

  /**
   * Names the package-relative generated import subpath.
   */
  readonly generatedExport: string;
}

/**
 * Contains the resolved model packages and their Proto-path owners.
 */
export interface ResolvedModelGraph {
  // prettier-ignore

  /**
   * Lists model packages in deterministic dependency order.
   */
  readonly models: readonly ResolvedModel[];

  /**
   * Maps every owned Proto path to its model package.
   */
  readonly protoOwners: Readonly<Record<string, ProtoOwner>>;
}

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

interface ResolvedNode {
  readonly model: ResolvedModel;
  readonly manifest: ProtoManifest;
}

type TraversalStep =
  | { readonly kind: "visit"; readonly requesterRoot: string; readonly name: string }
  | { readonly kind: "complete"; readonly requesterRoot: string; readonly name: string };

/**
 * Resolves explicitly declared installed model-package graphs.
 */
export const ModelGraph: Readonly<{
  resolve(requesterRoot: string, modelPackages: readonly string[]): ResolvedModelGraph;
  findPackageRoot(manifestPath: string, requester: string): string;
  resolveManifest(requesterRoot: string, name: string): string;
  readPackageJson(path: string, requester: string): PackageJson;
  validateDeclaredDependencies(packageJson: PackageJson, manifest: ProtoManifest): void;
  isStringRecord(value: unknown): value is Readonly<Record<string, string>>;
  satisfiesRegistrySpecifier(version: string, specifier: string): boolean;
  fail(name: string, message: string): never;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Resolves explicitly declared installed model packages without scanning `node_modules`.
   *
   * @param requesterRoot The application or model package root.
   * @param modelPackages The explicitly declared direct model packages.
   * @returns The deterministically resolved model graph.
   */
  resolve(requesterRoot: string, modelPackages: readonly string[]): ResolvedModelGraph {
    if (modelPackages.length > 10000) {
      ModelGraph.fail(
        ModelGraph.readPackageJson(join(requesterRoot, "package.json"), requesterRoot).name,
        "model dependency graph exceeds 10000 packages",
      );
    }
    const rootPackage = ModelGraph.readPackageJson(
      join(requesterRoot, "package.json"),
      requesterRoot,
    );
    for (const modelPackage of modelPackages) {
      const candidate: unknown = modelPackage;
      if (!NpmPackageName.is(candidate))
        ModelGraph.fail(
          rootPackage.name,
          `model package ${modelPackage} must be a valid npm package name`,
        );
    }
    const resolved = new Map<string, ResolvedNode>();
    const owners: Record<string, ProtoOwner> = {};
    const models: ResolvedModel[] = [];
    const states = new Map<string, "visiting" | "visited">();
    let packageCount = 0;
    let ownedProtoPaths = 0;
    let scheduledEdges = modelPackages.length;
    const pending: TraversalStep[] = modelPackages
      .slice()
      .sort()
      .reverse()
      .map((name) => ({ kind: "visit" as const, requesterRoot, name }));

    const walker = {
      resolveNode(requester: string, name: string): ResolvedNode {
        const manifestPath = ModelGraph.resolveManifest(requester, name);
        const root = ModelGraph.findPackageRoot(manifestPath, name);
        const packageJson = ModelGraph.readPackageJson(join(root, "package.json"), name);
        if (packageJson.name !== name)
          ModelGraph.fail(name, "package.json name must match requested package");
        const manifest = readManifestAt(root, manifestPath);
        ModelGraph.validateDeclaredDependencies(packageJson, manifest);
        const model: ResolvedModel = {
          name: packageJson.name,
          version: packageJson.version,
          moduleExport: manifest.moduleExport,
          root,
        };
        const existing = resolved.get(model.name);
        if (existing !== undefined && existing.model.root !== root)
          ModelGraph.fail(name, `package ${name} resolves to multiple installed roots`);
        if (existing !== undefined) return existing;
        const node = { model, manifest };
        resolved.set(model.name, node);
        return node;
      },
    };

    while (pending.length > 0) {
      const step = pending.pop();
      if (step === undefined) continue;
      const node = walker.resolveNode(step.requesterRoot, step.name);
      const requesterPackage = ModelGraph.readPackageJson(
        join(step.requesterRoot, "package.json"),
        step.name,
      );
      const requestedVersion = requesterPackage.dependencies[step.name];
      if (
        requestedVersion !== undefined &&
        !ModelGraph.satisfiesRegistrySpecifier(node.model.version, requestedVersion)
      ) {
        ModelGraph.fail(
          requesterPackage.name,
          `dependency ${step.name} version ${node.model.version} does not satisfy ${requestedVersion}`,
        );
      }
      const state = states.get(node.model.root);

      if (step.kind === "complete") {
        states.set(node.model.root, "visited");
        models.push(node.model);
        for (const protoFile of node.manifest.protoFiles) {
          ownedProtoPaths += 1;
          if (ownedProtoPaths > 10000)
            ModelGraph.fail(
              node.model.name,
              "resolved model graph exceeds 10000 owned Proto paths",
            );
          const existing = owners[protoFile];
          if (existing !== undefined && existing.packageName !== node.model.name) {
            ModelGraph.fail(
              node.model.name,
              `Proto path ${protoFile} is already owned by ${existing.packageName}`,
            );
          }
          owners[protoFile] = {
            packageName: node.model.name,
            generatedExport: node.manifest.generatedExports[protoFile] ?? "",
          };
        }
        continue;
      }
      if (state === "visited") continue;
      if (state === "visiting") ModelGraph.fail(step.name, "dependency cycle");
      packageCount += 1;
      if (packageCount > 10000)
        ModelGraph.fail(step.name, "model dependency graph exceeds 10000 packages");
      states.set(node.model.root, "visiting");
      pending.push({
        kind: "complete" as const,
        requesterRoot: step.requesterRoot,
        name: step.name,
      });
      if (node.manifest.dependencies.length > 10000 - scheduledEdges) {
        ModelGraph.fail(
          node.model.name,
          "model dependency graph exceeds 10000 scheduled dependency edges",
        );
      }
      scheduledEdges += node.manifest.dependencies.length;
      for (const dependency of node.manifest.dependencies.slice().sort().reverse()) {
        pending.push({ kind: "visit" as const, requesterRoot: node.model.root, name: dependency });
      }
    }

    return { models, protoOwners: Object.fromEntries(Object.entries(owners).sort()) };
  },

  findPackageRoot(manifestPath: string, requester: string): string {
    let root = dirname(manifestPath);
    for (let depth = 0; depth <= 100; depth += 1) {
      const packageJsonPath = join(root, "package.json");
      if (existsSync(packageJsonPath)) {
        try {
          if (ModelGraph.readPackageJson(packageJsonPath, requester).name === requester)
            return realpathSync(root);
        } catch {
          // Nested metadata does not establish the owner of this manifest.
        }
      }
      const parent = dirname(root);
      if (parent === root) break;
      root = parent;
    }
    return ModelGraph.fail(requester, "cannot locate owning package.json for resolved manifest");
  },

  resolveManifest(requesterRoot: string, name: string): string {
    try {
      return createRequire(join(requesterRoot, "package.json")).resolve(
        `${name}/spine-proto-manifest.json`,
      );
    } catch {
      return ModelGraph.fail(name, `cannot resolve manifest from ${requesterRoot}`);
    }
  },

  readPackageJson(path: string, requester: string): PackageJson {
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
      const packageJson = value as Record<string, unknown>;
      if (typeof packageJson.name !== "string" || packageJson.name.length === 0)
        ModelGraph.fail(requester, "package.json name must be a non-empty string");
      if (!NpmPackageName.is(packageJson.name))
        ModelGraph.fail(requester, "package.json name must be a valid npm package name");
      if (typeof packageJson.version !== "string" || packageJson.version.length === 0)
        ModelGraph.fail(requester, "package.json version must be a non-empty string");
      if (
        packageJson.dependencies !== undefined &&
        !ModelGraph.isStringRecord(packageJson.dependencies)
      ) {
        ModelGraph.fail(requester, "package.json dependencies must contain string versions");
      }
      const validPackageJson = packageJson as {
        readonly name: string;
        readonly version: string;
        readonly dependencies?: Readonly<Record<string, string>>;
      };
      return {
        name: validPackageJson.name,
        version: validPackageJson.version,
        dependencies: validPackageJson.dependencies ?? {},
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("spine-proto:")) throw error;
      return ModelGraph.fail(requester, "cannot read package.json");
    }
  },

  validateDeclaredDependencies(packageJson: PackageJson, manifest: ProtoManifest): void {
    for (const dependency of manifest.dependencies) {
      const candidate: unknown = dependency;
      if (!NpmPackageName.is(candidate))
        ModelGraph.fail(
          packageJson.name,
          `dependency ${dependency} must be a valid npm package name`,
        );
      const specifier = packageJson.dependencies[dependency];
      if (specifier === undefined)
        ModelGraph.fail(
          packageJson.name,
          `dependency ${dependency} must be declared in package.json dependencies`,
        );
      if (!RegistryDependency.is(specifier))
        ModelGraph.fail(packageJson.name, `dependency ${dependency} must use a registry version`);
    }
  },

  isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === "string")
    );
  },

  satisfiesRegistrySpecifier(version: string, specifier: string): boolean {
    const range = specifier.startsWith("npm:")
      ? specifier.slice(specifier.lastIndexOf("@") + 1)
      : specifier;
    const parsedRange = validRange(range);
    return parsedRange === null || satisfies(version, parsedRange);
  },

  fail(name: string, message: string): never {
    throw new Error(`spine-proto: ${name}: ${message}`);
  },
});
