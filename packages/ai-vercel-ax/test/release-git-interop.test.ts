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

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPClient } from "@ai-sdk/mcp";
import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

import { BoundedMcpStdioTransport } from "../src/adapter/mcp-stdio-transport.js";
import { GitReleaseComparison } from "../../../examples/release-notes/src/trusted/git-release.js";

const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const exampleDirectory = resolve(
  fileURLToPath(new URL("../../../examples/release-notes/", import.meta.url)),
);
const directories: string[] = [];
const source = join(exampleDirectory, "src/trusted/git-worker-main.ts");

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("release Git MCP worker over the framework's bounded stdio client", () => {
  it("advertises only three read-only tools and refuses uncataloged detail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-git-mcp-"));
    directories.push(directory);
    const run = (...args: string[]) =>
      execFileSync(gitExecutable, args, {
        cwd: directory,
        encoding: "utf8",
      }).trim();
    run("init", "--quiet");
    run("config", "user.name", "Fixture");
    run("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(directory, "release.md"), "before\n");
    run("add", "--", "release.md");
    run("commit", "--quiet", "-m", "Base");
    const base = run("rev-parse", "HEAD");
    writeFileSync(join(directory, "release.md"), "after\n");
    run("commit", "--quiet", "-am", "Release");
    const target = run("rev-parse", "HEAD");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target,
    });
    const worker = join(directory, "worker.mjs");
    await build({
      entryPoints: [source],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: worker,
    });
    const controller = new AbortController();
    let sequence = 0;
    const transport = new BoundedMcpStdioTransport(
      process.execPath,
      [worker],
      directory,
      {
        SPINE_RELEASE_GIT_BINDING: JSON.stringify(comparison.workerBinding()),
      },
      {
        signal: controller.signal,
        deadlineEpochMs: Date.now() + 10_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: (request) =>
          Promise.resolve({
            id: String(++sequence),
            signal: controller.signal,
            deadlineEpochMs: Date.now() + 10_000,
            maxOutputBytes: request.maxOutputBytes,
          }),
        onReceived: () => undefined,
        finishMessage: () => Promise.resolve(),
      },
    );
    const client = await createMCPClient({
      transport,
      maxRetries: 0,
      protocolVersionDiscovery: false,
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "list_release_changes",
        "read_change_patch",
        "read_release_file",
      ]);
      expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
      transport.setCallTicket("list", 512_000);
      const listing = await client.callTool({ name: "list_release_changes", arguments: {} });
      transport.clearCallTicket();
      expect(listing.structuredContent).toMatchObject({ complete: true });
      const evidence = comparison.evidence[0];
      if (!evidence) throw new Error("Missing accepted evidence fixture.");
      transport.setCallTicket("patch", 512_000);
      const patch = await client.callTool({
        name: "read_change_patch",
        arguments: {
          commit: evidence.commit,
          parent: evidence.parent,
          path: evidence.path,
        },
      });
      transport.clearCallTicket();
      expect(patch.structuredContent).toMatchObject({ complete: true });
      expect(JSON.stringify(patch.structuredContent)).toContain("+after");
      transport.setCallTicket("file", 512_000);
      const file = await client.callTool({
        name: "read_release_file",
        arguments: { path: "release.md" },
      });
      transport.clearCallTicket();
      expect(file.structuredContent).toMatchObject({
        complete: true,
        text: "after\n",
        targetCommit: target,
      });
      transport.setCallTicket("denied", 512_000);
      const denied = await client.callTool({
        name: "read_release_file",
        arguments: { path: "private.txt" },
      });
      transport.clearCallTicket();
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("rejects a changed graft catalog before serving any tool", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-git-graft-"));
    directories.push(directory);
    const run = (...args: string[]) =>
      execFileSync(gitExecutable, args, {
        cwd: directory,
        encoding: "utf8",
      }).trim();
    run("init", "--quiet");
    run("config", "user.name", "Fixture");
    run("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(directory, "release.md"), "base\n");
    run("add", "--", "release.md");
    run("commit", "--quiet", "-m", "Base");
    const base = run("rev-parse", "HEAD");
    writeFileSync(join(directory, "release.md"), "middle\n");
    run("commit", "--quiet", "-am", "Middle");
    writeFileSync(join(directory, "release.md"), "target\n");
    run("commit", "--quiet", "-am", "Target");
    const target = run("rev-parse", "HEAD");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target,
    });
    const worker = join(directory, "worker.mjs");
    await build({
      entryPoints: [source],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: worker,
    });
    writeFileSync(join(directory, ".git/info/grafts"), `${target} ${base}\n`);
    const attempt = spawnSync(process.execPath, [worker], {
      cwd: directory,
      env: { SPINE_RELEASE_GIT_BINDING: JSON.stringify(comparison.workerBinding()) },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(attempt.status).not.toBe(0);
    expect(attempt.stderr).toContain("Release Git worker comparison changed.");
  });
});
