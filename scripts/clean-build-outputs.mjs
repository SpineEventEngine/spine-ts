import { createHash, randomUUID } from "node:crypto";
import { findPackageJSON } from "node:module";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { modelAtomicTargets } from "./proto-workflow.mjs";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Lists repository-relative build directories removed before a clean build.
 */
export const buildOutputPaths = Object.freeze([
  "packages/proto-tools/dist",
  "packages/proto/dist",
  "packages/ai/dist",
  "packages/deployment/dist",
  "packages/deployment-gce/dist",
  "packages/deployment-gke/dist",
  "packages/auth/dist",
  "packages/ai-vercel-ax/dist",
  "packages/client-web/dist",
  "packages/client-react/dist",
  "packages/client-node/dist",
  "packages/delivery-client/dist",
  "packages/delivery-server/dist",
  "packages/core/dist",
  "packages/core/test-fixtures/dist",
  "packages/transport/dist",
  "packages/server/dist",
  "packages/server-blackbox-tests/dist",
  "packages/server/test-fixtures/dist",
  "packages/server-blackbox-tests/dist",
  "packages/storage/dist",
  "packages/storage-datastore/dist",
  "packages/storage-postgres/dist",
  "packages/storage-mysql/dist",
  "packages/testing/dist",
  "packages/testing/test-fixtures/dist",
  "examples/todo/dist",
  "examples/projects/dist",
  "examples/orders/dist",
  "examples/support/dist",
  "examples/release-notes/dist",
  "examples/message-board/model/dist",
  "examples/message-board/app/dist",
  "examples/message-board/web/dist",
]);

const defaultFileSystem = Object.freeze({
  exists: existsSync,
  status: lstatSync,

  /**
   * Removes one validated build-output directory.
   *
   * @param target Absolute directory path selected by the cleanup routine.
   */
  remove(target) {
    rmSync(target, { recursive: true });
  },
});

/**
 * Removes configured build output directories from the repository checkout.
 *
 * @param fileSystem Filesystem adapter used to inspect and recursively remove configured directories.
 * @throws {Error} When an output escapes the checkout, is absent as a non-directory, or is a symlink.
 */
export function cleanBuildOutputs(fileSystem = defaultFileSystem) {
  const root = realpathSync(defaultRepoRoot);

  for (const outputPath of buildOutputPaths) {
    const target = resolve(root, outputPath);
    if (relative(root, target) !== outputPath) {
      throw new Error(`Generated output target is invalid: ${outputPath}.`);
    }
    if (!fileSystem.exists(target)) continue;

    const targetStatus = fileSystem.status(target);
    if (!targetStatus.isDirectory() || targetStatus.isSymbolicLink()) {
      throw new Error(`Generated output target must be a directory: ${outputPath}.`);
    }
    fileSystem.remove(target);
  }
  if (fileSystem === defaultFileSystem) restoreMetadataAdapters(root);
}

/**
 * Restores all emitted dependency adapters as one rollback-safe publication.
 *
 * @param root Repository checkout containing generated restoration records.
 * @param operations Optional rename seam for publication failure tests.
 */
export function restoreMetadataAdapters(root, operations = { rename: renameSync }) {
  const assets = [];
  for (const target of modelAtomicTargets) {
    if (target.handlerProjectPath === undefined) continue;
    const app = join(root, dirname(target.handlerProjectPath));
    const generated = join(root, target.handlerGeneratedPath ?? target.displayPath);
    const record = join(generated, "spine-dependencies.json");
    if (!existsSync(record)) {
      if (existsSync(join(generated, "spine-bootstrap.ts")))
        throw new Error(`Missing generated dependency adapter record: ${record}`);
      continue;
    }
    const value = JSON.parse(readFileSync(record, "utf8"));
    if (
      value.formatVersion !== 2 ||
      !Array.isArray(value.inputs) ||
      !Array.isArray(value.edges) ||
      !Array.isArray(value.runtime)
    )
      throw new Error(`Invalid generated dependency adapter record: ${record}`);
    for (const input of value.inputs) verifyAdapterInput(root, app, input);
    for (const edge of value.edges) verifyAdapterEdge(app, edge);
    for (const asset of value.runtime) assets.push(validateAdapterFile(app, asset));
  }
  publishRestoredAdapters(assets, operations);
}

function verifyAdapterEdge(app, edge) {
  if (
    typeof edge?.name !== "string" ||
    typeof edge.requester !== "string" ||
    isAbsolute(edge.requester) ||
    (edge.resolved !== null && (typeof edge.resolved !== "string" || isAbsolute(edge.resolved)))
  )
    throw new Error("Invalid generated dependency adapter edge");
  const requester = resolve(realpathSync(app), edge.requester);
  let current;
  try {
    const manifest = findPackageJSON(edge.name, join(requester, "package.json"));
    current = manifest === undefined ? null : realpathSync(dirname(manifest));
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    current = null;
  }
  const expected = edge.resolved === null ? null : resolve(realpathSync(app), edge.resolved);
  if (current !== expected)
    throw new Error(`Dependency metadata changed; regenerate handlers: ${edge.name}`);
}

function verifyAdapterInput(root, app, input) {
  if (typeof input?.path !== "string" || typeof input.hash !== "string" || isAbsolute(input.path))
    throw new Error("Invalid generated dependency adapter input");
  const file = resolve(app, input.path);
  if (!existsSync(file)) {
    const expectedBuildOutput = buildOutputPaths.some((path) => {
      const within = relative(join(root, path), file);
      return within !== "" && !within.startsWith("..") && !isAbsolute(within);
    });
    if (expectedBuildOutput) return;
    throw new Error(`Dependency metadata changed; regenerate handlers: ${input.path}`);
  }
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (digest !== input.hash)
    throw new Error(`Dependency metadata changed; regenerate handlers: ${input.path}`);
}

function validateAdapterFile(app, asset) {
  if (typeof asset?.path !== "string" || typeof asset.source !== "string" || isAbsolute(asset.path))
    throw new Error("Invalid generated dependency adapter payload");
  const file = resolve(app, asset.path);
  const within = relative(app, file);
  if (
    within.startsWith("..") ||
    isAbsolute(within) ||
    !["spine-dependencies.js", "spine-dependencies.d.ts"].includes(basename(file))
  )
    throw new Error(`Unsafe generated dependency adapter output: ${asset.path}`);
  for (
    let current = dirname(file);
    current !== app && current !== dirname(current);
    current = dirname(current)
  )
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error(`Unsafe generated dependency adapter output: ${asset.path}`);
  return { file, source: asset.source };
}

function publishRestoredAdapters(assets, operations) {
  const staged = [];
  let retainBackups = false;
  try {
    for (const { file, source } of assets) {
      mkdirSync(dirname(file), { recursive: true });
      const token = randomUUID();
      const entry = {
        file,
        stage: join(dirname(file), `.spine-dependencies-${token}`),
        backup: join(dirname(file), `.spine-dependencies-backup-${token}`),
        promoted: false,
      };
      staged.push(entry);
      writeFileSync(entry.stage, source);
    }
    for (const entry of staged) {
      if (existsSync(entry.file)) operations.rename(entry.file, entry.backup);
      operations.rename(entry.stage, entry.file);
      entry.promoted = true;
    }
  } catch (error) {
    const failures = [error];
    for (const entry of [...staged].reverse()) {
      try {
        if (entry.promoted) rmSync(entry.file, { force: true });
        if (existsSync(entry.backup)) operations.rename(entry.backup, entry.file);
      } catch (rollback) {
        failures.push(rollback);
      }
    }
    retainBackups = failures.length > 1;
    if (retainBackups)
      throw new AggregateError(failures, "Generated adapter restoration rollback failed");
    throw error;
  } finally {
    for (const entry of staged) {
      rmSync(entry.stage, { force: true });
      if (!retainBackups) rmSync(entry.backup, { force: true });
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanBuildOutputs();
}
