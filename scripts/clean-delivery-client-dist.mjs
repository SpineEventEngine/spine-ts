import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deliveryClientDistPath = join("packages", "delivery-client", "dist");
const defaultFileSystem = Object.freeze({
  exists: existsSync,
  status: lstatSync,
  remove(target) {
    rmSync(target, { recursive: true });
  },
});

export function cleanDeliveryClientDist(fileSystem = defaultFileSystem) {
  const root = realpathSync(defaultRepoRoot);
  const target = resolve(root, deliveryClientDistPath);

  if (relative(root, target) !== deliveryClientDistPath) {
    throw new Error("Delivery-client generated output target is invalid.");
  }

  if (!fileSystem.exists(target)) {
    return;
  }

  const targetStatus = fileSystem.status(target);

  if (!targetStatus.isDirectory() || targetStatus.isSymbolicLink()) {
    throw new Error("Delivery-client generated output target must be a directory.");
  }

  fileSystem.remove(target);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanDeliveryClientDist();
}
