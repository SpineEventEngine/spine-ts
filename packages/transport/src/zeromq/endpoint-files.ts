import { unlink } from "node:fs/promises";

/**
 * Manages filesystem entries created for local IPC endpoints.
 */
export const EndpointFiles = {
  // prettier-ignore

  /**
   * Removes an endpoint file when it exists.
   *
   * @param filePath Specifies the endpoint file to remove.
   * @returns Completes after the file is absent.
   */
  async remove(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if (!EndpointFileErrors.isMissing(error)) {
        throw error;
      }
    }
  },
};

const EndpointFileErrors = {
  isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  },
};
