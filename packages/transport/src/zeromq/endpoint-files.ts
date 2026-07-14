import { unlink } from "node:fs/promises";

export const endpointFileAccess = {
  async remove(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  },
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
