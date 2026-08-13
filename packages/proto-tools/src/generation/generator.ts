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

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

import { ProtoConfig, ProtoManifest } from "../index.js";
import { readManifestAt } from "../io/manifest-reader.js";
import { ModelGraph } from "../model/model-graph.js";
import { ManifestFile, type ManifestFileOperations } from "../io/atomic-manifest.js";
import { generatedSource, normalizeGeneratedTree } from "./generated-source-policy.js";
import { modelSourceView } from "./source-view.js";

/**
 * Bounded seams used to test failure handling while retaining real Buf integration.
 */
export interface GenerationOperations {
  // prettier-ignore

  /**
   * Executes Buf for the staged model sources.
   *
   * @param moduleRoot The temporary Buf module root.
   * @param output The temporary generated-output directory.
   * @param owned The package-relative Proto paths to generate.
   * @param packageName The owning model package name.
   * @param runner The optional subprocess runner.
   */
  readonly runBuf?: (
    moduleRoot: string,
    output: string,
    owned: readonly string[],
    packageName: string,
    runner?: SubprocessRunner,
  ) => void;

  /**
   * Executes interface companion generation after primary Buf generation succeeds.
   *
   * @param moduleRoot The temporary Buf module root.
   * @param output The temporary generated-output directory.
   * @param owned The package-relative Proto paths to generate.
   * @param packageName The owning model package name.
   * @param runner The optional subprocess runner.
   */
  readonly runInterfacePhase?: (
    moduleRoot: string,
    output: string,
    owned: readonly string[],
    packageName: string,
    runner?: SubprocessRunner,
  ) => void;

  /**
   * Updates generated imports that belong to direct model dependencies.
   *
   * @param output The generated-output directory.
   * @param owners The package that owns each Proto path.
   * @param currentPackage The model package being generated.
   */
  readonly rewriteImports?: (
    output: string,
    owners: Readonly<
      Record<string, { readonly packageName: string; readonly generatedExport: string }>
    >,
    currentPackage: string,
  ) => void;

  /**
   * Writes the generated module descriptor.
   *
   * @param output The generated-output directory.
   * @param exportName The generated module export name.
   * @param packageName The owning model package name.
   * @param dependencies The direct model-module dependencies.
   */
  readonly writeModule?: (
    output: string,
    exportName: string,
    packageName: string,
    dependencies: readonly { readonly name: string; readonly moduleExport: string }[],
  ) => void;

  /**
   * Applies a filesystem rename during publication, backup, or rollback.
   *
   * @param from The current source path.
   * @param to The destination path.
   */
  readonly rename?: (from: string, to: string) => void;

  /**
   * Overrides manifest publication filesystem operations for tests.
   */
  readonly manifestOperations?: Partial<ManifestFileOperations>;

  /**
   * Runs a subprocess for Buf generation or validation.
   */
  readonly runProcess?: SubprocessRunner;

  /**
   * Overrides generation-claim filesystem operations for tests.
   */
  readonly lockOperations?: Partial<GenerationLockOperations>;
}

/**
 * Bounded lock seams for deterministic ownership and cleanup tests.
 */
export interface GenerationLockOperations {
  // prettier-ignore

  /**
   * Creates a lock file with its owner content.
   *
   * @param path The unique lock-file path.
   * @param content The serialized owner metadata.
   */
  readonly create: (path: string, content: string) => void;

  /**
   * Lists the entries in a package directory.
   *
   * @param directory The package directory to inspect.
   * @returns The directory entry names.
   */
  readonly list: (directory: string) => readonly string[];

  /**
   * Reads the content of a lock file.
   *
   * @param path The lock-file path.
   * @returns The serialized owner metadata.
   */
  readonly read: (path: string) => string;

  /**
   * Inspects the kind of a lock-file entry.
   *
   * @param path The lock-file path.
   * @returns Whether the entry is regular, symbolic, or another kind.
   */
  readonly inspect: (path: string) => "regular" | "symlink" | "other";

  /**
   * Removes a lock file.
   *
   * @param path The lock-file path.
   */
  readonly remove: (path: string) => void;

  /**
   * Determines whether a lock owner is still running.
   *
   * @param pid The candidate process identifier.
   * @returns The liveness result for the candidate process.
   */
  readonly liveness: (pid: number) => ClaimLiveness;
}

/**
 * Result of a bounded generation-claim liveness probe.
 */
export type ClaimLiveness = "alive" | "dead" | "indeterminate";

/**
 * Executes the packaged Buf executable in a synchronous subprocess.
 *
 * @param command The executable path.
 * @param arguments_ The command-line arguments.
 * @param options The working-directory, encoding, timeout, and buffer options.
 * @returns The synchronous subprocess result.
 */
export type SubprocessRunner = (
  command: string,
  arguments_: readonly string[],
  options: {
    readonly cwd: string;
    readonly encoding: "utf8";
    readonly timeout: number;
    readonly maxBuffer: number;
  },
) => SpawnSyncReturns<string>;

const bufTimeoutMs = 300_000;
const bufMaxBuffer = 1_048_576;

/**
 * Bounded seams for atomic application-registry publication failures.
 */
export interface CompositionOperations {
  // prettier-ignore

  /**
   * Overrides registry publication filesystem operations for tests.
   */
  readonly registryOperations?: Partial<ManifestFileOperations>;
}

interface GenerationLock {
  readonly path: string;
  readonly token: string;
}

const defaultLockOperations: GenerationLockOperations = {
  create: (path, content) => {
    writeFileSync(path, content, { flag: "wx" });
  },
  list: (directory) => readdirSync(directory),
  read: (path) => readFileSync(path, "utf8"),
  inspect: (path) => {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) return "symlink";
    return entry.isFile() ? "regular" : "other";
  },
  remove: (path) => {
    unlinkSync(path);
  },
  liveness: (pid) => protoGeneration.claimLiveness(pid),
};

/**
 * Reports Proto artifact generation failures.
 */
const ProtoGenerationErrors: Readonly<{ fail(owner: string, message: string): never }> =
  Object.freeze({
    fail(owner: string, message: string): never {
      throw new Error(`spine-proto: ${owner}: ${message}`);
    },
  });

/**
 * Generates and composes deterministic Protobuf package artifacts.
 */
const protoGeneration = Object.freeze({
  // prettier-ignore

  /**
   * Builds a model package's owned Protobuf-ES sources and module descriptor.
   *
   * @param packageRoot The root of the model package to generate.
   * @param operations Optional bounded filesystem and process seams for tests.
   */
  generate(packageRoot: string, operations: GenerationOperations = {}): void {
    const config = ProtoConfig.read(packageRoot);
    if (config.mode !== "model")
      ProtoGenerationErrors.fail(packageRoot, "generate requires model mode");
    const lock = protoGeneration.acquireLock(
      packageRoot,
      config.packageName,
      operations.lockOperations,
    );
    let primaryError: unknown;
    try {
      const manifest = ProtoManifest.create(packageRoot);
      const graph = ModelGraph.resolve(packageRoot, config.dependencies);
      const target = join(packageRoot, config.generatedRoot);
      mkdirSync(dirname(target), { recursive: true });
      const stage = mkdtempSync(join(dirname(target), `.${basename(target)}.stage-`));
      const moduleRoot = join(stage, "module");
      const output = join(moduleRoot, "output");
      try {
        modelSourceView(packageRoot, config.generatedRoot, output);
        protoGeneration.copyOwnedSources(
          packageRoot,
          config.protoRoot,
          moduleRoot,
          manifest.protoFiles,
        );
        for (const model of graph.models) protoGeneration.copyDependencySources(model, moduleRoot);
        (operations.runBuf ?? protoGeneration.runBuf)(
          moduleRoot,
          output,
          manifest.protoFiles,
          config.packageName,
          operations.runProcess,
        );
        const runInterfacePhase =
          operations.runInterfacePhase ??
          (operations.runBuf === undefined ? protoGeneration.runInterfacePhase : () => undefined);
        runInterfacePhase(
          moduleRoot,
          output,
          manifest.protoFiles,
          config.packageName,
          operations.runProcess,
        );
        protoGeneration.assertRejectionRuntimeDependency(packageRoot, config.packageName, output);
        (operations.rewriteImports ?? protoGeneration.rewriteDependencyImports)(
          output,
          graph.protoOwners,
          config.packageName,
          new Set(config.dependencies),
        );
        (operations.writeModule ?? protoGeneration.writeModule)(
          output,
          config.moduleExport,
          config.packageName,
          graph.models.filter((model) => config.dependencies.includes(model.name)),
        );
        normalizeGeneratedTree(output, manifest.protoFiles);
        protoGeneration.publish(
          packageRoot,
          config.generatedRoot,
          output,
          manifest,
          operations.rename,
          operations.manifestOperations,
        );
      } finally {
        rmSync(stage, { recursive: true, force: true });
      }
    } catch (error) {
      primaryError = error;
    }
    try {
      protoGeneration.releaseLock(lock, config.packageName, operations.lockOperations);
    } catch (error) {
      if (primaryError === undefined) throw error;
    }
    if (primaryError !== undefined) {
      if (primaryError instanceof Error) throw primaryError;
      throw new Error(`spine-proto: ${config.packageName}: generation failed`, {
        cause: primaryError,
      });
    }
  },

  acquireLock(
    packageRoot: string,
    packageName: string,
    operations: Partial<GenerationLockOperations> = {},
  ): GenerationLock {
    const token = crypto.randomUUID();
    const lock = join(packageRoot, `.spine-proto-generate.lock.${token}`);
    const lockOperations = { ...defaultLockOperations, ...operations };
    try {
      lockOperations.create(lock, JSON.stringify({ pid: process.pid, token }));
    } catch {
      ProtoGenerationErrors.fail(packageName, "cannot acquire generation claim");
    }
    try {
      for (let scan = 0; scan < 2; scan += 1) {
        const claims = lockOperations
          .list(packageRoot)
          .filter((name) => name.startsWith(".spine-proto-generate.lock."))
          .sort();
        if (claims.length > 1000)
          ProtoGenerationErrors.fail(packageName, "generation claim count exceeds 1000");
        for (const name of claims) {
          const path = join(packageRoot, name);
          if (path === lock) continue;
          if (lockOperations.inspect(path) !== "regular")
            ProtoGenerationErrors.fail(packageName, "generation claim is not a regular file");
          try {
            const owner = JSON.parse(lockOperations.read(path)) as { pid?: unknown };
            if (typeof owner.pid !== "number" || owner.pid <= 0) throw new Error();
            if (lockOperations.liveness(owner.pid) !== "dead")
              ProtoGenerationErrors.fail(
                packageName,
                "generation already in progress for this package",
              );
            lockOperations.remove(path);
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("spine-proto:")) throw error;
            ProtoGenerationErrors.fail(packageName, "generation claim has invalid owner metadata");
          }
        }
      }
    } catch (error) {
      try {
        lockOperations.remove(lock);
      } catch {
        // Preserve the primary claim-admission failure.
      }
      throw error;
    }
    return { path: lock, token };
  },

  releaseLock(
    lock: GenerationLock,
    packageName: string,
    operations: Partial<GenerationLockOperations> = {},
  ): void {
    const lockOperations = { ...defaultLockOperations, ...operations };
    try {
      const owner = JSON.parse(lockOperations.read(lock.path)) as { token?: unknown };
      if (owner.token !== lock.token)
        ProtoGenerationErrors.fail(packageName, "generation lock ownership changed");
      if (lockOperations.inspect(lock.path) !== "regular")
        ProtoGenerationErrors.fail(packageName, "generation lock is not a regular file");
      lockOperations.remove(lock.path);
    } catch {
      ProtoGenerationErrors.fail(packageName, "cannot clean up generation lock");
    }
  },

  /**
   * Returns a signal-zero probe result without treating unknown process errors as death.
   *
   * @param pid The process identifier to probe.
   * @param probe The signal-zero probe to run.
   * @returns Whether the claim owner is alive, dead, or indeterminate.
   */
  claimLiveness(
    pid: number,
    probe: (candidate: number) => unknown = (candidate) => process.kill(candidate, 0),
  ): ClaimLiveness {
    try {
      probe(pid);
      return "alive";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return "dead";
      return "indeterminate";
    }
  },

  /**
   * Writes the explicit, deterministic application model registry.
   *
   * @param packageRoot The root of the application package to compose.
   * @param operations Optional bounded manifest publication seams for tests.
   */
  compose(packageRoot: string, operations: CompositionOperations = {}): void {
    const config = ProtoConfig.read(packageRoot);
    if (config.mode !== "application")
      ProtoGenerationErrors.fail(packageRoot, "compose requires application mode");
    const imports = ModelGraph.resolve(packageRoot, config.modelPackages)
      .models.filter((model) => config.modelPackages.includes(model.name))
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));
    const aliases = imports.map((_, index) => `model${String(index)}`);
    const sources = imports.flatMap((model) => ProtoManifest.read(model.root).protoFiles);
    const source = generatedSource(
      [
        'import { TypeRegistry } from "@spine-event-engine/core";',
        ...imports.map(
          (model, index) =>
            `import { ${model.moduleExport} as ${aliases[index] ?? "model"} } from ${JSON.stringify(model.name)};`,
        ),
        "",
        "/**",
        " * The application type registry composed from every declared model package.",
        " */",
        `export const typeRegistry: TypeRegistry = TypeRegistry.from(${aliases.join(", ")});`,
        "",
      ].join("\n"),
      sources,
    );
    const target = join(packageRoot, config.registryOutput);
    mkdirSync(dirname(target), { recursive: true });
    ManifestFile.writeAtomically(target, source, operations.registryOperations);
  },

  copyOwnedSources(
    packageRoot: string,
    protoRoot: string,
    destination: string,
    protoFiles: readonly string[],
  ): void {
    for (const protoFile of protoFiles) {
      const source = join(packageRoot, protoRoot, protoFile);
      protoGeneration.assertRegularFile(source, packageRoot);
      const target = join(destination, protoFile);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
  },

  assertRejectionRuntimeDependency(packageRoot: string, packageName: string, output: string): void {
    if (!protoGeneration.files(output).some((file) => file.endsWith("rejections.ts"))) return;
    let dependencies: unknown;
    try {
      const packageJson: unknown = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      );
      dependencies =
        packageJson !== null && typeof packageJson === "object"
          ? (packageJson as Record<string, unknown>).dependencies
          : undefined;
    } catch {
      ProtoGenerationErrors.fail(packageName, "cannot read package runtime dependencies");
    }
    if (
      dependencies === null ||
      typeof dependencies !== "object" ||
      typeof (dependencies as Record<string, unknown>)["@spine-event-engine/core"] !== "string"
    )
      ProtoGenerationErrors.fail(
        packageName,
        "rejection generation requires direct runtime dependency @spine-event-engine/core",
      );
  },

  copyDependencySources(
    model: { readonly name: string; readonly root: string },
    destination: string,
  ): void {
    const manifestPath = protoGeneration.resolveExportedManifest(model.root, model.name);
    for (const protoPath of readManifestAt(model.root, manifestPath).protoFiles) {
      const source = protoGeneration.resolveExportedProto(model.root, model.name, protoPath);
      const target = join(destination, protoPath);
      mkdirSync(dirname(target), { recursive: true });
      protoGeneration.assertRegularFile(source, model.name);
      copyFileSync(source, target);
    }
  },

  resolveExportedManifest(packageRoot: string, packageName: string): string {
    try {
      return createRequire(join(packageRoot, "package.json")).resolve(
        `${packageName}/spine-proto-manifest.json`,
      );
    } catch {
      return ProtoGenerationErrors.fail(packageName, "cannot resolve exported manifest");
    }
  },

  resolveExportedProto(requesterRoot: string, packageName: string, protoPath: string): string {
    try {
      return createRequire(join(requesterRoot, "package.json")).resolve(
        `${packageName}/proto/${protoPath}`,
      );
    } catch {
      return ProtoGenerationErrors.fail(
        packageName,
        `cannot resolve exported Proto source ${protoPath}`,
      );
    }
  },

  assertRegularFile(path: string, owner: string): void {
    try {
      const entry = lstatSync(path);
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error();
    } catch {
      ProtoGenerationErrors.fail(owner, "exported Proto source is missing or unsafe");
    }
  },

  runBuf(
    moduleRoot: string,
    output: string,
    owned: readonly string[],
    packageName: string,
    runner: SubprocessRunner = (command, arguments_, options) =>
      spawnSync(command, arguments_, options),
  ): void {
    const protocGenEs = protoGeneration.resolveTool("@bufbuild/protoc-gen-es/bin/protoc-gen-es");
    const rejectionGenerator = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts") ? "./rejection-generator.ts" : "./rejection-generator.js",
        import.meta.url,
      ),
    );
    writeFileSync(join(moduleRoot, "buf.yaml"), "version: v2\nmodules:\n  - path: .\n", "utf8");
    writeFileSync(
      join(moduleRoot, "buf.gen.yaml"),
      [
        "version: v2",
        "plugins:",
        `  - local: ${protocGenEs}`,
        "    out: output",
        "    opt:",
        "      - target=ts",
        "      - import_extension=js",
        "  - local:",
        `      - ${process.execPath}`,
        `      - ${rejectionGenerator}`,
        "    out: output",
        "    opt:",
        "      - target=ts",
        "      - import_extension=js",
        "",
      ].join("\n"),
      "utf8",
    );
    const buf = protoGeneration.resolveTool("@bufbuild/buf/bin/buf");
    const generated = runner(
      buf,
      ["generate", "--template", "buf.gen.yaml", ...owned.flatMap((file) => ["--path", file])],
      {
        cwd: moduleRoot,
        encoding: "utf8",
        timeout: bufTimeoutMs,
        maxBuffer: bufMaxBuffer,
      },
    );
    protoGeneration.assertBufResult(packageName, "generation", generated);
    const built = runner(buf, ["build", "--as-file-descriptor-set", "-o", "descriptor.bin"], {
      cwd: moduleRoot,
      encoding: "utf8",
      timeout: bufTimeoutMs,
      maxBuffer: bufMaxBuffer,
    });
    protoGeneration.assertBufResult(packageName, "validation", built);
    if (!existsSync(output))
      ProtoGenerationErrors.fail(packageName, "Buf generated no owned output");
  },

  runInterfacePhase(
    moduleRoot: string,
    output: string,
    owned: readonly string[],
    packageName: string,
    runner: SubprocessRunner = (command, arguments_, options) =>
      spawnSync(command, arguments_, options),
  ): void {
    const interfaceGenerator = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts") ? "./interface-generator.ts" : "./interface-generator.js",
        import.meta.url,
      ),
    );
    writeFileSync(
      join(moduleRoot, "buf.interfaces.gen.yaml"),
      [
        "version: v2",
        "plugins:",
        "  - local:",
        `      - ${process.execPath}`,
        `      - ${interfaceGenerator}`,
        "    out: output",
        "    opt:",
        "      - target=ts",
        "      - import_extension=js",
        "",
      ].join("\n"),
      "utf8",
    );
    const buf = protoGeneration.resolveTool("@bufbuild/buf/bin/buf");
    const generated = runner(
      buf,
      [
        "generate",
        "--template",
        "buf.interfaces.gen.yaml",
        ...owned.flatMap((file) => ["--path", file]),
      ],
      { cwd: moduleRoot, encoding: "utf8", timeout: bufTimeoutMs, maxBuffer: bufMaxBuffer },
    );
    protoGeneration.assertBufResult(packageName, "interface generation", generated);
  },

  assertBufResult(
    packageName: string,
    phase: "generation" | "interface generation" | "validation",
    result: SpawnSyncReturns<string>,
  ): void {
    if (result.error !== undefined) {
      if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT")
        ProtoGenerationErrors.fail(packageName, `Buf ${phase} timed out`);
      ProtoGenerationErrors.fail(
        packageName,
        `Buf ${phase} could not start: ${result.error.message}`,
      );
    }
    if (result.signal !== null)
      ProtoGenerationErrors.fail(packageName, `Buf ${phase} ended by signal ${result.signal}`);
    if (result.status === null)
      ProtoGenerationErrors.fail(packageName, `Buf ${phase} ended without an exit status`);
    if (result.status !== 0)
      ProtoGenerationErrors.fail(
        packageName,
        `Buf ${phase} failed: ${(result.stderr || result.stdout).trim()}`,
      );
  },

  resolveTool(specifier: string): string {
    try {
      return createRequire(import.meta.url).resolve(specifier);
    } catch {
      return ProtoGenerationErrors.fail(
        "@spine-event-engine/proto-tools",
        `cannot resolve packaged executable ${specifier}`,
      );
    }
  },

  rewriteDependencyImports(
    output: string,
    owners: Readonly<
      Record<string, { readonly packageName: string; readonly generatedExport: string }>
    >,
    currentPackage: string,
    directDependencies: ReadonlySet<string>,
  ): void {
    for (const file of protoGeneration.files(output)) {
      if (!file.endsWith(".ts")) continue;
      const rewritten = readFileSync(file, "utf8").replaceAll(
        /from "(\.\.?\/[^" ]+_pb\.js)"/g,
        (whole, specifier: string) => {
          const proto = relative(output, resolve(dirname(file), specifier))
            .replace(/_pb\.js$/, ".proto")
            .replaceAll("\\", "/");
          const owner = owners[proto];
          if (owner === undefined) return whole;
          if (owner.packageName === currentPackage) return whole;
          if (!directDependencies.has(owner.packageName))
            ProtoGenerationErrors.fail(
              currentPackage,
              `generated import ${proto} is owned by transitive dependency ${owner.packageName}`,
            );
          if (owner.generatedExport.length === 0)
            ProtoGenerationErrors.fail(currentPackage, `unmapped generated import ${proto}`);
          return `from ${JSON.stringify(`${owner.packageName}/${owner.generatedExport}`)}`;
        },
      );
      writeFileSync(file, rewritten, "utf8");
    }
  },

  writeModule(
    output: string,
    exportName: string,
    packageName: string,
    dependencies: readonly { readonly name: string; readonly moduleExport: string }[],
  ): void {
    const generated = protoGeneration
      .files(output)
      .filter((file) => file.endsWith("_pb.ts"))
      .sort()
      .map((file, index) => ({
        alias: `schemas${String(index)}`,
        path: `./${relative(output, file).replaceAll("\\", "/").replace(/\.ts$/, ".js")}`,
      }));
    const dependencyImports = dependencies
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((dependency, index) => ({ ...dependency, alias: `dependency${String(index)}` }));
    const sources = generated.map(({ path }) =>
      path.replace(/^\.\//u, "").replace(/_pb\.js$/u, ".proto"),
    );
    const source = generatedSource(
      [
        'import type { ProtoModule } from "@spine-event-engine/proto";',
        'import type { Message } from "@bufbuild/protobuf";',
        'import type { GenMessage } from "@bufbuild/protobuf/codegenv2";',
        ...generated.map(({ alias, path }) => `import * as ${alias} from ${JSON.stringify(path)};`),
        ...dependencyImports.map(
          ({ name, moduleExport, alias }) =>
            `import { ${moduleExport} as ${alias} } from ${JSON.stringify(name)};`,
        ),
        "",
        "const schemas = Object.freeze([",
        ...generated.map(({ alias }) =>
          [
            `  ...Object.values(${alias})`,
            '    .filter((value) => typeof value === "object" && value !== null &&',
            '      (value as { kind?: unknown }).kind === "message")',
            "    .map((value) => value as unknown as GenMessage<Message>),",
          ].join("\n"),
        ),
        "].sort((left, right) =>",
        "  (left as { typeName: string }).typeName.localeCompare(",
        "    (right as { typeName: string }).typeName,",
        "  ),",
        "));",
        "",
        `/** All Protobuf message schemas owned by \`${packageName}\`. */`,
        `export const ${exportName}: ProtoModule = Object.freeze({`,
        `  name: ${JSON.stringify(packageName)},`,
        "  schemas,",
        `  dependencies: Object.freeze([${dependencyImports.map(({ alias }) => alias).join(", ")}]),`,
        "});",
        "",
      ].join("\n"),
      sources,
    );
    writeFileSync(join(output, "proto-module.ts"), source, "utf8");
  },

  publish(
    packageRoot: string,
    generatedRoot: string,
    output: string,
    manifest: unknown,
    onRename: (from: string, to: string) => void = renameSync,
    manifestOperations: Partial<ManifestFileOperations> = {},
  ): void {
    const target = join(packageRoot, generatedRoot);
    const backup = join(dirname(target), `.${basename(target)}.${crypto.randomUUID()}.backup`);
    const manifestTarget = join(packageRoot, "spine-proto-manifest.json");
    const oldManifest = existsSync(manifestTarget)
      ? readFileSync(manifestTarget, "utf8")
      : undefined;
    let outputPublished = false;
    try {
      if (existsSync(target)) onRename(target, backup);
      mkdirSync(dirname(target), { recursive: true });
      onRename(output, target);
      outputPublished = true;
      ManifestFile.writeAtomically(
        manifestTarget,
        `${JSON.stringify(manifest, null, 2)}\n`,
        manifestOperations,
      );
      rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (outputPublished) rmSync(target, { recursive: true, force: true });
      if (existsSync(backup)) {
        renameSync(backup, target);
      }
      if (oldManifest === undefined) rmSync(manifestTarget, { force: true });
      else ManifestFile.writeAtomically(manifestTarget, oldManifest, manifestOperations);
      throw error;
    }
  },

  files(root: string): string[] {
    const output: string[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) continue;
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (lstatSync(path).isDirectory()) pending.push(path);
        else output.push(path);
      }
    }
    return output;
  },
});

/**
 * Generates and composes deterministic Protobuf package artifacts.
 */
export const ProtoGeneration: Readonly<{
  // prettier-ignore

  /**
   * Generates a model package's Protobuf-ES sources and module descriptor.
   *
   * @param packageRoot The root of the model package to generate.
   * @param operations Optional bounded filesystem and process seams for tests.
   */
  generate(packageRoot: string, operations?: GenerationOperations): void;

  /**
   * Determines the liveness of a generation-claim owner.
   *
   * @param pid The process identifier to probe.
   * @param probe The optional signal-zero probe to run.
   * @returns Whether the claim owner is alive, dead, or indeterminate.
   */
  claimLiveness(pid: number, probe?: (candidate: number) => unknown): ClaimLiveness;

  /**
   * Composes an application's deterministic model registry.
   *
   * @param packageRoot The root of the application package to compose.
   * @param operations Optional bounded manifest publication seams for tests.
   */
  compose(packageRoot: string, operations?: CompositionOperations): void;
}> = Object.freeze(protoGeneration);
