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

/**
 * Describes one packed framework artifact prepared for snapshot publication.
 */
export interface SnapshotArtifact {
  /**
   * Public NPM package name.
   */
  readonly name: string;

  /**
   * Absolute path to the packed tarball.
   */
  readonly tarball: string;

  /**
   * Subresource Integrity value calculated for the tarball.
   */
  readonly integrity: string;

  /**
   * Internal package names that must be available before this artifact is published.
   */
  readonly dependencies: readonly string[];
}

/**
 * Packs framework workspaces and records the artifacts required by snapshot publication.
 *
 * @param options Repository paths and command runner used during packing.
 * @returns Validated framework artifacts derived from the packed tarballs.
 */
export function packFrameworkArtifacts(options: {
  /**
   * Repository root containing the framework workspaces.
   */
  readonly root: string;

  /**
   * Directory that receives the packed tarballs.
   */
  readonly destination: string;

  /**
   * Executes one package-manager command in the requested working directory.
   */
  readonly run: (command: string, args: readonly string[], cwd: string) => void;
}): readonly SnapshotArtifact[];
