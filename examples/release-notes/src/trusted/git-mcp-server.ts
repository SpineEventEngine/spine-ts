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

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { GitReleaseComparison } from "./git-release.js";

const annotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * Registers the three bounded read-only tools on an SDK MCP server.
 */
export const GitMcpServer = {
  /**
   * Creates a worker server for one pinned comparison.
   *
   * @param comparison Immutable accepted comparison.
   * @returns SDK MCP server with exactly three evidence tools.
   */
  create(comparison: GitReleaseComparison): McpServer {
    const server = new McpServer({ name: "release-git-mcp-server", version: "1.0.0" });
    this.registerList(server, comparison);
    this.registerPatch(server, comparison);
    this.registerFile(server, comparison);
    return server;
  },

  /**
   * Creates a structured success response within the transport budget.
   *
   * @param value Credential-free tool result.
   * @returns Structured and text result for MCP clients.
   */
  success(value: Record<string, unknown>): CallToolResult {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") > 200_000) return this.denied();
    return { content: [{ type: "text" as const, text: encoded }], structuredContent: value };
  },

  /**
   * Returns unavailable evidence without exposing Git or process diagnostics.
   *
   * @returns Safe MCP tool error.
   */
  denied(): CallToolResult {
    return {
      isError: true as const,
      content: [
        { type: "text" as const, text: "Evidence is unavailable or outside the accepted catalog." },
      ],
    };
  },

  /**
   * Registers bounded catalog paging.
   *
   * @param server SDK server.
   * @param comparison Immutable accepted comparison.
   */
  registerList(server: McpServer, comparison: GitReleaseComparison): void {
    server.registerTool(
      "list_release_changes",
      {
        title: "List release changes",
        description:
          "Page through accepted commits, changed paths, and per-parent patch evidence until nextPageToken is absent.",
        inputSchema: z.object({ pageToken: z.string().optional() }).strict(),
        annotations,
      },
      ({ pageToken }, context) => {
        if (context.mcpReq.signal.aborted) return this.denied();
        try {
          return this.success(comparison.listReleaseChanges(pageToken));
        } catch {
          return this.denied();
        }
      },
    );
  },

  /**
   * Registers catalog-constrained per-parent patches.
   *
   * @param server SDK server.
   * @param comparison Immutable accepted comparison.
   */
  registerPatch(server: McpServer, comparison: GitReleaseComparison): void {
    server.registerTool(
      "read_change_patch",
      {
        title: "Read an accepted change patch",
        description:
          "Read a bounded patch for an exact listed commit, parent, and path; incomplete evidence does not prove a complete claim.",
        inputSchema: z
          .object({ commit: z.string(), parent: z.string(), path: z.string() })
          .strict(),
        annotations,
      },
      async ({ commit, parent, path }, context) => {
        const evidence = comparison.evidence.find(
          (entry) => entry.commit === commit && entry.parent === parent && entry.path === path,
        );
        if (!evidence || context.mcpReq.signal.aborted) return this.denied();
        try {
          const detail = await comparison.readChangePatch(evidence, context.mcpReq.signal);
          context.mcpReq.signal.throwIfAborted();
          return this.success({ commit, parent, path, ...detail });
        } catch {
          return this.denied();
        }
      },
    );
  },

  /**
   * Registers catalog-constrained target-tree file reads.
   *
   * @param server SDK server.
   * @param comparison Immutable accepted comparison.
   */
  registerFile(server: McpServer, comparison: GitReleaseComparison): void {
    server.registerTool(
      "read_release_file",
      {
        title: "Read a changed release file",
        description:
          "Read bounded regular text at a listed net changed path in the pinned target tree; incomplete evidence does not prove a complete claim.",
        inputSchema: z.object({ path: z.string() }).strict(),
        annotations,
      },
      async ({ path }, context) => {
        if (context.mcpReq.signal.aborted) return this.denied();
        try {
          const detail = await comparison.readReleaseFile(path, context.mcpReq.signal);
          context.mcpReq.signal.throwIfAborted();
          return this.success({ path, ...detail });
        } catch {
          return this.denied();
        }
      },
    );
  },
};
