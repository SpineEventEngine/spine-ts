import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const buildOutputPaths = Object.freeze([
  "packages/proto-tools/dist",
  "packages/proto/dist",
  "packages/deployment/dist",
  "packages/deployment-gce/dist",
  "packages/deployment-gke/dist",
  "packages/auth/dist",
  "packages/client-web/dist",
  "packages/client-react/dist",
  "packages/client-node/dist",
  "packages/delivery-client/dist",
  "packages/delivery-server/dist",
  "packages/core/dist",
  "packages/transport/dist",
  "packages/server/dist",
  "packages/storage/dist",
  "packages/storage-datastore/dist",
  "packages/storage-rdbms/dist",
  "packages/testing/dist",
  "examples/todo/dist",
  "examples/projects/dist",
  "examples/orders/dist",
  "examples/message-board/model/dist",
  "examples/message-board/app/dist",
  "examples/message-board/web/dist",
]);

const defaultFileSystem = Object.freeze({
  exists: existsSync,
  status: lstatSync,
  remove(target) {
    rmSync(target, { recursive: true });
  },
});

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
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanBuildOutputs();
}
