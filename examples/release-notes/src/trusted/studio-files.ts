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

import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";

/**
 * Persists approved export bytes after the trusted native save dialog.
 */
export const StudioFiles = {
  /**
   * Replaces the selected destination atomically after syncing a private temporary file.
   *
   * @param destination Path selected through the native save dialog.
   * @param bytes Exact immutable bytes from the correlated approval Event.
   * @returns Completion after the private temporary file is renamed into place.
   */
  async writeApproved(destination: string, bytes: Uint8Array): Promise<void> {
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  },
};
