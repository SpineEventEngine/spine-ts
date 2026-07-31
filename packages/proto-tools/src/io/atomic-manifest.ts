import { renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Filesystem operations used to stage and atomically replace a manifest.
 */
export interface ManifestFileOperations {
  // prettier-ignore

  /**
   * Writes complete content to a unique staging file.
   *
   * @param path The staging-file path.
   * @param content The complete content to write.
   */
  readonly writeFile: (path: string, content: string) => void;

  /**
   * Replaces a destination manifest with a staging file.
   *
   * @param from The completed staging-file path.
   * @param to The destination manifest path.
   */
  readonly rename: (from: string, to: string) => void;

  /**
   * Removes a failed staging file.
   *
   * @param path The staging-file path to remove.
   */
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

/**
 * Publishes manifest files through complete sibling staging files.
 */
export const ManifestFile: Readonly<{
  writeAtomically(
    target: string,
    content: string,
    operations?: Partial<ManifestFileOperations>,
  ): void;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Replaces a manifest only after complete content exists in a unique sibling staging file.
   *
   * @param target The manifest file to replace.
   * @param content The complete manifest content.
   * @param operations Optional filesystem seams used by failure tests.
   * @returns Nothing.
   */
  writeAtomically(
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
        // Preserves the primary write or rename failure.
      }
      throw error;
    }
  },
});
