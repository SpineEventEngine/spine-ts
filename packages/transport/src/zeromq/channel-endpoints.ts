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

import type { BigIntStats } from "node:fs";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const privateDirectoryMode = 0o700;
const privateModeBits = 0o700n;
const posixModeMask = 0o7777n;
const posixWriteMask = 0o022n;
const isPosix = process.platform !== "win32";

/**
 * Describes a prepared, private IPC directory whose filesystem identity can be rechecked.
 */
export interface PreparedIpcDirectory {
  // prettier-ignore

  /**
   * Describes the canonical directory path accepted for native socket endpoints.
   */
  readonly path: string;

  /**
   * Describes the device and inode captured when the directory was prepared.
   */
  readonly identity: {
    readonly device: bigint;
    readonly inode: bigint;
  };
}

interface IpcPathPlan {
  readonly anchorPath: string;
  readonly missingComponents: readonly string[];
}

interface IpcPathWalk {
  readonly existingPath: string;
  readonly missingComponents: readonly string[];
}

/**
 * Prepares and revalidates secure IPC directories shared by ZeroMQ adapters.
 *
 * Every operation rejects symlink, ownership, mode, or identity changes instead of trusting a
 * path that a different process could have replaced.
 *
 * @internal
 */
export const ChannelEndpoints = {
  // prettier-ignore

  /**
   * Creates and validates a private IPC directory.
   *
   * @param ipcDirectory Specifies the requested local directory.
   * @param createComponent Creates one missing directory component.
   * @returns The canonical path and identity that callers must recheck before use.
   */
  async prepare(
    ipcDirectory: string,
    createComponent: (directory: string) => Promise<void> = async (directory) => {
      await mkdir(directory, { mode: privateDirectoryMode });
    },
  ): Promise<PreparedIpcDirectory> {
    const plan = await ChannelEndpoints.inspect(ipcDirectory);
    const completedPath = await ChannelEndpoints.createSuffix(
      plan.anchorPath,
      plan.missingComponents,
      createComponent,
    );
    return await ChannelEndpoints.finalize(completedPath);
  },

  /**
   * Checks a directory identity captured during preparation.
   *
   * @param prepared Supplies the prepared directory to inspect.
   * @returns Completes when the path remains canonical, private, and unchanged; otherwise rejects.
   */
  async recheck(prepared: PreparedIpcDirectory): Promise<void> {
    const canonicalPath = await realpath(prepared.path);
    if (canonicalPath !== prepared.path)
      throw new Error("ZeroMQ adapter ipcDirectory changed after preparation.");
    const finalEntry = await lstat(prepared.path, { bigint: true });
    ChannelEndpoints.requirePrivateFinalDirectory(finalEntry);
    const identityIsStable =
      isPosix ||
      (prepared.identity.device !== 0n &&
        prepared.identity.inode !== 0n &&
        finalEntry.dev !== 0n &&
        finalEntry.ino !== 0n);
    if (
      identityIsStable &&
      (finalEntry.dev !== prepared.identity.device || finalEntry.ino !== prepared.identity.inode)
    )
      throw new Error("ZeroMQ adapter ipcDirectory identity changed after preparation.");
  },

  /**
   * Finds the existing safe ancestor and missing suffix for an IPC directory.
   *
   * @param ipcDirectory Specifies the requested local directory.
   * @returns A validated anchor path and the components still needing creation.
   */
  async inspect(ipcDirectory: string): Promise<IpcPathPlan> {
    const parsed = path.parse(ipcDirectory);
    const components = ipcDirectory
      .slice(parsed.root.length)
      .split(path.sep)
      .filter((component) => component.length > 0);
    const walk = await ChannelEndpoints.walk(parsed.root, components);
    const followedAnchor = await stat(walk.existingPath, { bigint: true });
    const anchorPath = await realpath(walk.existingPath);
    const anchorEntry = await lstat(anchorPath, { bigint: true });
    ChannelEndpoints.requireMatchingIdentity(anchorEntry, followedAnchor, "canonical anchor");
    return { anchorPath, missingComponents: walk.missingComponents };
  },

  /**
   * Finds existing path components until the first missing component.
   *
   * @param root Supplies the filesystem root from which to walk.
   * @param components Supplies the path components to validate.
   * @returns The last existing path and any remaining components.
   */
  async walk(root: string, components: readonly string[]): Promise<IpcPathWalk> {
    let existingPath = root;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (component === undefined) continue;
      const candidate = path.join(existingPath, component);
      let lexicalEntry: BigIntStats;
      try {
        lexicalEntry = await lstat(candidate, { bigint: true });
      } catch (error) {
        if (!ChannelEndpoints.hasErrorCode(error, "ENOENT")) throw error;
        return { existingPath, missingComponents: components.slice(index) };
      }
      await ChannelEndpoints.validateEntry(
        candidate,
        index === components.length - 1,
        lexicalEntry,
      );
      existingPath = candidate;
    }
    return { existingPath, missingComponents: [] };
  },

  /**
   * Validates one existing component before accepting it as an IPC path ancestor.
   *
   * @param candidate Identifies the component being checked.
   * @param isFinal States whether the component is the requested final directory.
   * @param lexicalEntry Supplies the component's non-following filesystem metadata.
   * @returns Completes when the component is safe; otherwise rejects.
   */
  async validateEntry(
    candidate: string,
    isFinal: boolean,
    lexicalEntry: BigIntStats,
  ): Promise<void> {
    if (lexicalEntry.isSymbolicLink()) {
      if (isFinal)
        throw new Error("ZeroMQ adapter ipcDirectory final component must not be a symlink.");
      if (isPosix) await ChannelEndpoints.validatePosixAlias(candidate, lexicalEntry.uid);
    }
    const followed = await stat(candidate, { bigint: true });
    if (!followed.isDirectory())
      throw new Error("ZeroMQ adapter ipcDirectory path components must be directories.");
  },

  /**
   * Creates and validates every missing component beneath a safe anchor.
   *
   * @param anchorPath Supplies the validated existing ancestor.
   * @param missingComponents Supplies ordered directory components to create.
   * @param createComponent Creates one component, allowing a concurrent existing directory.
   * @returns The completed directory path after every component is safe.
   */
  async createSuffix(
    anchorPath: string,
    missingComponents: readonly string[],
    createComponent: (directory: string) => Promise<void>,
  ): Promise<string> {
    let completedPath = anchorPath;
    for (const component of missingComponents) {
      const next = path.join(completedPath, component);
      try {
        await createComponent(next);
      } catch (error) {
        if (!ChannelEndpoints.hasErrorCode(error, "EEXIST")) throw error;
      }
      const existing = await lstat(next, { bigint: true });
      if (existing.isSymbolicLink() || !existing.isDirectory())
        throw new Error("ZeroMQ adapter ipcDirectory creation encountered an unsafe path.");
      completedPath = next;
    }
    return completedPath;
  },

  /**
   * Returns the canonical path and identity of a completed IPC directory.
   *
   * @param completedPath Identifies the created directory to finalize.
   * @returns The frozen path and filesystem identity for later rechecks.
   */
  async finalize(completedPath: string): Promise<PreparedIpcDirectory> {
    const canonicalCompletedPath = await realpath(completedPath);
    if (canonicalCompletedPath !== completedPath)
      throw new Error("ZeroMQ adapter ipcDirectory must resolve to its canonical path.");
    const finalEntry = await lstat(completedPath, { bigint: true });
    ChannelEndpoints.requirePrivateFinalDirectory(finalEntry);
    return Object.freeze({
      path: completedPath,
      identity: Object.freeze({ device: finalEntry.dev, inode: finalEntry.ino }),
    });
  },

  /**
   * Checks a POSIX ancestor symlink allowed only for immutable root-owned aliases.
   *
   * @param aliasPath Identifies the symlink ancestor.
   * @param aliasUid Supplies the symlink owner's user identifier.
   * @returns Completes when the alias is safe; otherwise rejects.
   */
  async validatePosixAlias(aliasPath: string, aliasUid: bigint): Promise<void> {
    const parent = await stat(path.dirname(aliasPath), { bigint: true });
    if (aliasUid !== 0n || parent.uid !== 0n || (parent.mode & posixWriteMask) !== 0n)
      throw new Error(
        "ZeroMQ adapter ipcDirectory ancestor symlink must be an immutable root-owned alias.",
      );
  },

  /**
   * Checks that the final IPC directory is private and owned by this user.
   *
   * @param entry Supplies non-following metadata for the final directory.
   */
  requirePrivateFinalDirectory(entry: {
    readonly dev: bigint;
    readonly ino: bigint;
    readonly mode: bigint;
    readonly uid: bigint;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }): void {
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error("ZeroMQ adapter ipcDirectory must be a non-symlink directory.");
    if (!isPosix) return;
    const effectiveUserId = process.geteuid?.();
    if (effectiveUserId === undefined || entry.uid !== BigInt(effectiveUserId))
      throw new Error("ZeroMQ adapter ipcDirectory must be owned by the effective user.");
    if ((entry.mode & posixModeMask) !== privateModeBits)
      throw new Error("ZeroMQ adapter ipcDirectory must have exact POSIX mode 0700.");
  },

  /**
   * Checks that two filesystem entries retain the same device and inode.
   *
   * @param actual Supplies the identity observed after an operation.
   * @param expected Supplies the identity captured before the operation.
   * @param label Identifies the checked path in a rejection message.
   */
  requireMatchingIdentity(
    actual: { readonly dev: bigint; readonly ino: bigint },
    expected: { readonly dev: bigint; readonly ino: bigint },
    label: string,
  ): void {
    if (actual.dev !== expected.dev || actual.ino !== expected.ino)
      throw new Error(`ZeroMQ adapter ipcDirectory ${label} identity changed.`);
  },

  /**
   * Tests whether an unknown failure carries an expected Node error code.
   *
   * @param error Supplies the failure to inspect.
   * @param code Specifies the expected Node error code.
   * @returns `true` only when the failure has that error code.
   */
  hasErrorCode(error: unknown, code: string): boolean {
    return (
      error instanceof Error &&
      "code" in error &&
      (error as Error & { readonly code?: unknown }).code === code
    );
  },
};
