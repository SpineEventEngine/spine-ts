import { renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Filesystem operations used to stage and atomically replace a manifest. */
export interface ManifestFileOperations {
  /** Writes complete content to its unique staging file. */
  readonly writeFile: (path: string, content: string) => void;
  /** Renames the staging file over the destination manifest. */
  readonly rename: (from: string, to: string) => void;
  /** Removes a failed staging file. */
  readonly remove: (path: string) => void;
}

const defaultOperations: ManifestFileOperations = {
  writeFile: (path, content) => {
    writeFileSync(path, content, "utf8");
  },
  rename: renameSync,
  remove: (path) => {
    rmSync(path, { force: true });
  },
};

/** Replaces a manifest only after complete content exists in a unique sibling staging file. */
export function writeManifestAtomically(
  target: string,
  content: string,
  operations: Partial<ManifestFileOperations> = {},
): void {
  const fileOperations = { ...defaultOperations, ...operations };
  const staging = join(
    dirname(target),
    `.${basename(target)}.${String(process.pid)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fileOperations.writeFile(staging, content);
    fileOperations.rename(staging, target);
  } catch (error) {
    try {
      fileOperations.remove(staging);
    } catch {
      // Preserve the primary write or rename failure.
    }
    throw error;
  }
}
