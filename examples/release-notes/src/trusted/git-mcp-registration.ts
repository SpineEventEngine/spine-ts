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

import {
  Mcp,
  type AiControl,
  type AiScope,
  type McpServerRegistration,
} from "@spine-event-engine/ai";
import { Time } from "@spine-event-engine/core";

import { GitReleaseComparison } from "./git-release.js";

/**
 * Trusted per-operation comparison lookup supplied by the accepted Agent request.
 */
export interface GitMcpOperationLookup {
  /**
   * Absolute Electron or Node executable path.
   */
  readonly executable: string;

  /**
   * Fixed absolute worker bundle path.
   */
  readonly workerPath: string;

  /**
   * Fixed absolute process working directory.
   */
  readonly cwd: string;

  /**
   * Finds only the accepted comparison for this Agent operation.
   *
   * @param scope Authenticated accepted Agent scope.
   * @param control Callback cancellation and deadline.
   * @returns Pinned comparison or undefined when authorization fails.
   */
  readonly resolveComparison: (
    scope: AiScope,
    control: AiControl,
  ) => GitReleaseComparison | undefined | Promise<GitReleaseComparison | undefined>;
}

/**
 * Registers one fixed worker with operation-scoped, immutable Git comparisons.
 */
export const ReleaseGitRegistration = {
  /**
   * Registers a fixed executable and three read-only tools through Spine MCP.
   *
   * @param options Trusted process paths and accepted comparison lookup.
   * @returns Registry-ready MCP server registration.
   */
  create(options: GitMcpOperationLookup): McpServerRegistration {
    const active = (scope: AiScope, control: AiControl) => this.active(options, scope, control);
    const policy = {
      effect: "read" as const,
      timeoutMs: 10_000,
      maxArgumentBytes: 16_384,
      maxResultBytes: 512_000,
      authorize: async (scope: AiScope, _call: unknown, control: AiControl) =>
        (await active(scope, control)) !== undefined,
    };
    return Mcp.server({
      id: "release-git",
      revision: "v1",
      authorizeConnect: async (scope, control) => (await active(scope, control)) !== undefined,
      transport: {
        kind: "stdio",
        executable: options.executable,
        args: [options.workerPath],
        cwd: options.cwd,
        environment: async (scope, control) => {
          const comparison = await active(scope, control);
          if (!comparison) throw new Error("Release comparison is not active.");
          return {
            ELECTRON_RUN_AS_NODE: "1",
            SPINE_RELEASE_GIT_BINDING: JSON.stringify(comparison.workerBinding()),
          };
        },
      },
      tools: { list_release_changes: policy, read_change_patch: policy, read_release_file: policy },
    });
  },

  /**
   * Resolves only comparisons still valid under callback cancellation and deadline.
   *
   * @param options Trusted operation lookup.
   * @param scope Accepted Agent scope.
   * @param control Runtime cancellation and deadline.
   * @returns Accepted comparison, if still active.
   */
  async active(
    options: GitMcpOperationLookup,
    scope: AiScope,
    control: AiControl,
  ): Promise<GitReleaseComparison | undefined> {
    if (control.signal.aborted || Time.currentTimeMillis() >= control.deadlineEpochMs)
      return undefined;
    const comparison = await options.resolveComparison(scope, control);
    control.signal.throwIfAborted();
    if (Time.currentTimeMillis() >= control.deadlineEpochMs) return undefined;
    return comparison;
  },
};
