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
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

import { createManifest, readConfig } from "../index.js";
import { readManifestAt } from "../io/manifest-reader.js";
import { resolveModelGraph } from "../model/model-graph.js";
import { writeManifestAtomically, type ManifestFileOperations } from "../io/atomic-manifest.js";
export { generateHandlers } from "./handler-generator.js";

/** Bounded seams used to test failure handling while retaining real Buf integration. */
export interface GenerationOperations {
  readonly runBuf?: (
    moduleRoot: string,
    output: string,
    owned: readonly string[],
    packageName: string,
    runner?: SubprocessRunner,
  ) => void;
  readonly rewriteImports?: (
    output: string,
    owners: Readonly<
      Record<string, { readonly packageName: string; readonly generatedExport: string }>
    >,
    currentPackage: string,
  ) => void;
  readonly writeModule?: (
    output: string,
    exportName: string,
    packageName: string,
    dependencies: readonly { readonly name: string; readonly moduleExport: string }[],
  ) => void;
  readonly rename?: (from: string, to: string) => void;
  readonly manifestOperations?: Partial<ManifestFileOperations>;
  readonly runProcess?: SubprocessRunner;
  readonly lockOperations?: Partial<GenerationLockOperations>;
}

/** Bounded lock seams for deterministic ownership and cleanup tests. */
export interface GenerationLockOperations {
  readonly create: (path: string, content: string) => void;
  readonly list: (directory: string) => readonly string[];
  readonly read: (path: string) => string;
  readonly inspect: (path: string) => "regular" | "symlink" | "other";
  readonly remove: (path: string) => void;
  readonly liveness: (pid: number) => ClaimLiveness;
}

/** Result of a bounded generation-claim liveness probe. */
export type ClaimLiveness = "alive" | "dead" | "indeterminate";

/** Bounded process runner used for the packaged Buf executable. */
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

/** Bounded seams for atomic application-registry publication failures. */
export interface CompositionOperations {
  readonly registryOperations?: Partial<ManifestFileOperations>;
}

/** Generates a model package's owned Protobuf-ES sources and module descriptor. */
export function generateModel(packageRoot: string, operations: GenerationOperations = {}): void {
  const config = readConfig(packageRoot);
  if (config.mode !== "model") fail(packageRoot, "generate requires model mode");
  const lock = acquireLock(packageRoot, config.packageName, operations.lockOperations);
  let primaryError: unknown;
  try {
    const manifest = createManifest(packageRoot);
    const graph = resolveModelGraph(packageRoot, config.dependencies);
    const target = join(packageRoot, config.generatedRoot);
    mkdirSync(dirname(target), { recursive: true });
    const stage = mkdtempSync(join(dirname(target), `.${basename(target)}.stage-`));
    const moduleRoot = join(stage, "module");
    const output = join(moduleRoot, "output");
    try {
      copyOwnedSources(packageRoot, config.protoRoot, moduleRoot, manifest.protoFiles);
      for (const model of graph.models) copyDependencySources(model, moduleRoot);
      (operations.runBuf ?? runBuf)(
        moduleRoot,
        output,
        manifest.protoFiles,
        config.packageName,
        operations.runProcess,
      );
      (operations.rewriteImports ?? rewriteDependencyImports)(
        output,
        graph.protoOwners,
        config.packageName,
        new Set(config.dependencies),
      );
      (operations.writeModule ?? writeModule)(
        output,
        config.moduleExport,
        config.packageName,
        graph.models.filter((model) => config.dependencies.includes(model.name)),
      );
      publish(
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
    releaseLock(lock, config.packageName, operations.lockOperations);
  } catch (error) {
    if (primaryError === undefined) throw error;
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof Error) throw primaryError;
    throw new Error(`spine-proto: ${config.packageName}: generation failed`, {
      cause: primaryError,
    });
  }
}

interface GenerationLock {
  readonly path: string;
  readonly token: string;
}

function acquireLock(
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
    fail(packageName, "cannot acquire generation claim");
  }
  try {
    for (let scan = 0; scan < 2; scan += 1) {
      const claims = lockOperations
        .list(packageRoot)
        .filter((name) => name.startsWith(".spine-proto-generate.lock."))
        .sort();
      if (claims.length > 1000) fail(packageName, "generation claim count exceeds 1000");
      for (const name of claims) {
        const path = join(packageRoot, name);
        if (path === lock) continue;
        if (lockOperations.inspect(path) !== "regular")
          fail(packageName, "generation claim is not a regular file");
        try {
          const owner = JSON.parse(lockOperations.read(path)) as { pid?: unknown };
          if (typeof owner.pid !== "number" || owner.pid <= 0) throw new Error();
          if (lockOperations.liveness(owner.pid) !== "dead")
            fail(packageName, "generation already in progress for this package");
          lockOperations.remove(path);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("spine-proto:")) throw error;
          fail(packageName, "generation claim has invalid owner metadata");
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
}

function releaseLock(
  lock: GenerationLock,
  packageName: string,
  operations: Partial<GenerationLockOperations> = {},
): void {
  const lockOperations = { ...defaultLockOperations, ...operations };
  try {
    const owner = JSON.parse(lockOperations.read(lock.path)) as { token?: unknown };
    if (owner.token !== lock.token) fail(packageName, "generation lock ownership changed");
    if (lockOperations.inspect(lock.path) !== "regular")
      fail(packageName, "generation lock is not a regular file");
    lockOperations.remove(lock.path);
  } catch {
    fail(packageName, "cannot clean up generation lock");
  }
}

/** Classifies a signal-zero probe without treating unknown process errors as death. */
export function probeGenerationClaimLiveness(
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
  liveness: (pid) => probeGenerationClaimLiveness(pid),
};

/** Generates the explicit, deterministic application model registry. */
export function composeApplication(
  packageRoot: string,
  operations: CompositionOperations = {},
): void {
  const config = readConfig(packageRoot);
  if (config.mode !== "application") fail(packageRoot, "compose requires application mode");
  const imports = resolveModelGraph(packageRoot, config.modelPackages)
    .models.filter((model) => config.modelPackages.includes(model.name))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const aliases = imports.map((_, index) => `model${String(index)}`);
  const source = [
    'import { TypeRegistry } from "@spine-event-engine/core";',
    ...imports.map(
      (model, index) =>
        `import { ${model.moduleExport} as ${aliases[index] ?? "model"} } from ${JSON.stringify(model.name)};`,
    ),
    "",
    "/** Registry of every model package declared by this application. */",
    `export const typeRegistry: TypeRegistry = TypeRegistry.from(${aliases.join(", ")});`,
    "",
  ].join("\n");
  const target = join(packageRoot, config.registryOutput);
  mkdirSync(dirname(target), { recursive: true });
  writeManifestAtomically(target, source, operations.registryOperations);
}

function copyOwnedSources(
  packageRoot: string,
  protoRoot: string,
  destination: string,
  protoFiles: readonly string[],
): void {
  for (const protoFile of protoFiles) {
    const source = join(packageRoot, protoRoot, protoFile);
    assertRegularFile(source, packageRoot);
    const target = join(destination, protoFile);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function copyDependencySources(
  model: { readonly name: string; readonly root: string },
  destination: string,
): void {
  const manifestPath = resolveExportedManifest(model.root, model.name);
  for (const protoPath of readManifestAt(model.root, manifestPath).protoFiles) {
    const source = resolveExportedProto(model.root, model.name, protoPath);
    const target = join(destination, protoPath);
    mkdirSync(dirname(target), { recursive: true });
    assertRegularFile(source, model.name);
    copyFileSync(source, target);
  }
}

function resolveExportedManifest(packageRoot: string, packageName: string): string {
  try {
    return createRequire(join(packageRoot, "package.json")).resolve(
      `${packageName}/spine-proto-manifest.json`,
    );
  } catch {
    fail(packageName, "cannot resolve exported manifest");
  }
}

function resolveExportedProto(
  requesterRoot: string,
  packageName: string,
  protoPath: string,
): string {
  try {
    return createRequire(join(requesterRoot, "package.json")).resolve(
      `${packageName}/proto/${protoPath}`,
    );
  } catch {
    fail(packageName, `cannot resolve exported Proto source ${protoPath}`);
  }
}

function assertRegularFile(path: string, owner: string): void {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error();
  } catch {
    fail(owner, "exported Proto source is missing or unsafe");
  }
}

function runBuf(
  moduleRoot: string,
  output: string,
  owned: readonly string[],
  packageName: string,
  runner: SubprocessRunner = (command, arguments_, options) =>
    spawnSync(command, arguments_, options),
): void {
  const protocGenEs = resolveTool("@bufbuild/protoc-gen-es/bin/protoc-gen-es");
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
      "",
    ].join("\n"),
    "utf8",
  );
  const buf = resolveTool("@bufbuild/buf/bin/buf");
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
  assertBufResult(packageName, "generation", generated);
  const built = runner(buf, ["build", "--as-file-descriptor-set", "-o", "descriptor.bin"], {
    cwd: moduleRoot,
    encoding: "utf8",
    timeout: bufTimeoutMs,
    maxBuffer: bufMaxBuffer,
  });
  assertBufResult(packageName, "validation", built);
  if (!existsSync(output)) fail(packageName, "Buf generated no owned output");
}

function assertBufResult(
  packageName: string,
  phase: "generation" | "validation",
  result: SpawnSyncReturns<string>,
): void {
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT")
      fail(packageName, `Buf ${phase} timed out`);
    fail(packageName, `Buf ${phase} could not start: ${result.error.message}`);
  }
  if (result.signal !== null) fail(packageName, `Buf ${phase} ended by signal ${result.signal}`);
  if (result.status === null) fail(packageName, `Buf ${phase} ended without an exit status`);
  if (result.status !== 0)
    fail(packageName, `Buf ${phase} failed: ${(result.stderr || result.stdout).trim()}`);
}

function resolveTool(specifier: string): string {
  try {
    return createRequire(import.meta.url).resolve(specifier);
  } catch {
    fail("@spine-event-engine/proto-tools", `cannot resolve packaged executable ${specifier}`);
  }
}

function rewriteDependencyImports(
  output: string,
  owners: Readonly<
    Record<string, { readonly packageName: string; readonly generatedExport: string }>
  >,
  currentPackage: string,
  directDependencies: ReadonlySet<string>,
): void {
  for (const file of files(output)) {
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
          fail(
            currentPackage,
            `generated import ${proto} is owned by transitive dependency ${owner.packageName}`,
          );
        if (owner.generatedExport.length === 0)
          fail(currentPackage, `unmapped generated import ${proto}`);
        return `from ${JSON.stringify(`${owner.packageName}/${owner.generatedExport}`)}`;
      },
    );
    writeFileSync(file, rewritten, "utf8");
  }
}

function writeModule(
  output: string,
  exportName: string,
  packageName: string,
  dependencies: readonly { readonly name: string; readonly moduleExport: string }[],
): void {
  const generated = files(output)
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
  const source = [
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
  ].join("\n");
  writeFileSync(join(output, "proto-module.ts"), source, "utf8");
}

function publish(
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
  const oldManifest = existsSync(manifestTarget) ? readFileSync(manifestTarget, "utf8") : undefined;
  let outputPublished = false;
  try {
    if (existsSync(target)) onRename(target, backup);
    mkdirSync(dirname(target), { recursive: true });
    onRename(output, target);
    outputPublished = true;
    writeManifestAtomically(
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
    else writeManifestAtomically(manifestTarget, oldManifest, manifestOperations);
    throw error;
  }
}

function files(root: string): string[] {
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
}

function fail(owner: string, message: string): never {
  throw new Error(`spine-proto: ${owner}: ${message}`);
}
