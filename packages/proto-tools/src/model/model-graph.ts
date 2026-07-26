import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { satisfies, validRange } from "semver";

import { type ProtoManifest } from "../index.js";
import { readManifestAt } from "../io/manifest-reader.js";
import { isRegistryDependencySpecifier } from "./registry-dependency.js";

export interface ResolvedModel {
  readonly name: string;
  readonly version: string;
  readonly moduleExport: string;
  readonly root: string;
}

export interface ProtoOwner {
  readonly packageName: string;
  readonly generatedExport: string;
}

export interface ResolvedModelGraph {
  readonly models: readonly ResolvedModel[];
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

/** Resolves explicitly declared installed model packages without scanning node_modules. */
export function resolveModelGraph(
  requesterRoot: string,
  modelPackages: readonly string[],
): ResolvedModelGraph {
  if (modelPackages.length > 10000) {
    fail(
      readPackageJson(join(requesterRoot, "package.json"), requesterRoot).name,
      "model dependency graph exceeds 10000 packages",
    );
  }
  const resolved = new Map<string, ResolvedNode>();
  const owners: Record<string, ProtoOwner> = {};
  const models: ResolvedModel[] = [];
  const states = new Map<string, "visiting" | "visited">();
  let packageCount = 0;
  let scheduledEdges = modelPackages.length;
  const pending: TraversalStep[] = modelPackages
    .slice()
    .sort()
    .reverse()
    .map((name) => ({ kind: "visit" as const, requesterRoot, name }));

  while (pending.length > 0) {
    const step = pending.pop();
    if (step === undefined) continue;
    const node = resolveNode(step.requesterRoot, step.name);
    const requesterPackage = readPackageJson(join(step.requesterRoot, "package.json"), step.name);
    const requestedVersion = requesterPackage.dependencies[step.name];
    if (
      requestedVersion !== undefined &&
      !satisfiesRegistrySpecifier(node.model.version, requestedVersion)
    ) {
      fail(
        requesterPackage.name,
        `dependency ${step.name} version ${node.model.version} does not satisfy ${requestedVersion}`,
      );
    }
    const state = states.get(node.model.root);

    if (step.kind === "complete") {
      states.set(node.model.root, "visited");
      models.push(node.model);
      for (const protoFile of node.manifest.protoFiles) {
        const existing = owners[protoFile];
        if (existing !== undefined && existing.packageName !== node.model.name) {
          fail(
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
    if (state === "visiting") fail(step.name, "dependency cycle");
    packageCount += 1;
    if (packageCount > 10000) fail(step.name, "model dependency graph exceeds 10000 packages");
    states.set(node.model.root, "visiting");
    pending.push({ kind: "complete" as const, requesterRoot: step.requesterRoot, name: step.name });
    if (node.manifest.dependencies.length > 10000 - scheduledEdges) {
      fail(node.model.name, "model dependency graph exceeds 10000 scheduled dependency edges");
    }
    scheduledEdges += node.manifest.dependencies.length;
    for (const dependency of node.manifest.dependencies.slice().sort().reverse()) {
      pending.push({ kind: "visit" as const, requesterRoot: node.model.root, name: dependency });
    }
  }

  return { models, protoOwners: Object.fromEntries(Object.entries(owners).sort()) };

  function resolveNode(requester: string, name: string): ResolvedNode {
    const manifestPath = resolveManifest(requester, name);
    const root = findPackageRoot(manifestPath, name);
    const packageJson = readPackageJson(join(root, "package.json"), name);
    if (packageJson.name !== name) fail(name, "package.json name must match requested package");
    const manifest = readManifestAt(root, manifestPath);
    validateDeclaredDependencies(packageJson, manifest);
    const model: ResolvedModel = {
      name: packageJson.name,
      version: packageJson.version,
      moduleExport: manifest.moduleExport,
      root,
    };
    const existing = resolved.get(model.name);
    if (existing !== undefined && existing.model.root !== root) {
      fail(name, `package ${name} resolves to multiple installed roots`);
    }
    if (existing !== undefined) return existing;
    const node = { model, manifest };
    resolved.set(model.name, node);
    return node;
  }
}

function findPackageRoot(manifestPath: string, requester: string): string {
  let root = dirname(manifestPath);
  for (let depth = 0; depth <= 100; depth += 1) {
    const packageJsonPath = join(root, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        if (readPackageJson(packageJsonPath, requester).name === requester)
          return realpathSync(root);
      } catch {
        // Nested metadata does not establish the owner of this manifest.
      }
    }
    const parent = dirname(root);
    if (parent === root) break;
    root = parent;
  }
  fail(requester, "cannot locate owning package.json for resolved manifest");
}

function resolveManifest(requesterRoot: string, name: string): string {
  try {
    return createRequire(join(requesterRoot, "package.json")).resolve(
      `${name}/spine-proto-manifest.json`,
    );
  } catch {
    fail(name, `cannot resolve manifest from ${requesterRoot}`);
  }
}

function readPackageJson(path: string, requester: string): PackageJson {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    const packageJson = value as Record<string, unknown>;
    if (typeof packageJson.name !== "string" || packageJson.name.length === 0)
      fail(requester, "package.json name must be a non-empty string");
    if (typeof packageJson.version !== "string" || packageJson.version.length === 0)
      fail(requester, "package.json version must be a non-empty string");
    if (packageJson.dependencies !== undefined && !isStringRecord(packageJson.dependencies)) {
      fail(requester, "package.json dependencies must contain string versions");
    }
    return {
      name: packageJson.name,
      version: packageJson.version,
      dependencies: packageJson.dependencies ?? {},
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("spine-proto:")) throw error;
    fail(requester, "cannot read package.json");
  }
}

function validateDeclaredDependencies(packageJson: PackageJson, manifest: ProtoManifest): void {
  for (const dependency of manifest.dependencies) {
    const specifier = packageJson.dependencies[dependency];
    if (specifier === undefined)
      fail(
        packageJson.name,
        `dependency ${dependency} must be declared in package.json dependencies`,
      );
    if (!isRegistryDependencySpecifier(specifier))
      fail(packageJson.name, `dependency ${dependency} must use a registry version`);
  }
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function satisfiesRegistrySpecifier(version: string, specifier: string): boolean {
  const range = specifier.startsWith("npm:")
    ? specifier.slice(specifier.lastIndexOf("@") + 1)
    : specifier;
  const parsedRange = validRange(range);
  return parsedRange === null || satisfies(version, parsedRange);
}

function fail(name: string, message: string): never {
  throw new Error(`spine-proto: ${name}: ${message}`);
}
