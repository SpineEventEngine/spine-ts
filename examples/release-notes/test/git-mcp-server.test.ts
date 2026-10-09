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

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { AiControl, AiScope } from "@spine-event-engine/ai";
import { expect, it } from "vitest";

import { ReleaseGitRegistration } from "../src/trusted/git-mcp-registration.js";
import { GitMcpServer } from "../src/trusted/git-mcp-server.js";
import { GitReleaseComparison } from "../src/trusted/git-release.js";

it("serves pinned evidence and rejects paths outside the catalog through the SDK protocol", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-mcp-memory-"));
  const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args: string[]) =>
    execFileSync(gitExecutable, args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(directory, "notes.txt"), "Before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Before");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(directory, "notes.txt"), "After\n");
  writeFileSync(join(directory, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  git("add", "-A");
  git("commit", "--quiet", "-m", "After");
  const target = git("rev-parse", "HEAD");
  const comparison = await GitReleaseComparison.open({
    repository: directory,
    gitExecutable,
    base,
    target,
  });
  const signal = new AbortController();
  signal.abort();
  const lookup = {
    executable: process.execPath,
    workerPath: "/unused-worker",
    cwd: directory,
    resolveComparison: () => comparison,
  };
  const scope = {} as AiScope;
  const control = (deadlineEpochMs: number, controller = signal) =>
    ({
      signal: controller.signal,
      deadlineEpochMs,
    }) as AiControl;
  await expect(
    ReleaseGitRegistration.active(lookup, scope, control(Date.now() + 10_000)),
  ).resolves.toBeUndefined();
  const live = new AbortController();
  await expect(
    ReleaseGitRegistration.active(lookup, scope, control(1, live)),
  ).resolves.toBeUndefined();
  const pending = Promise.withResolvers<GitReleaseComparison>();
  const delayed = ReleaseGitRegistration.active(
    { ...lookup, resolveComparison: () => pending.promise },
    scope,
    control(Date.now() + 50, live),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  pending.resolve(comparison);
  await expect(delayed).resolves.toBeUndefined();
  const server = GitMcpServer.create(comparison);
  const client = new Client({ name: "release-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "list_release_changes",
      "read_change_patch",
      "read_release_file",
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    const listing = await client.callTool({ name: "list_release_changes", arguments: {} });
    expect(listing.isError).not.toBe(true);
    expect(listing.structuredContent).toMatchObject({ complete: true });
    const patch = await client.callTool({
      name: "read_change_patch",
      arguments: { commit: target, parent: base, path: "notes.txt" },
    });
    expect(patch.structuredContent).toMatchObject({ complete: true, path: "notes.txt" });
    expect(JSON.stringify(patch.structuredContent)).toContain("+After");
    const file = await client.callTool({
      name: "read_release_file",
      arguments: { path: "notes.txt" },
    });
    expect(file.structuredContent).toMatchObject({ complete: true, text: "After\n" });
    const denied = await client.callTool({
      name: "read_release_file",
      arguments: { path: "secret.txt" },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain(directory);
    const deniedPatch = await client.callTool({
      name: "read_change_patch",
      arguments: { commit: target, parent: base, path: "secret.txt" },
    });
    expect(deniedPatch.isError).toBe(true);
    const incomplete = await client.callTool({
      name: "read_release_file",
      arguments: { path: "binary.dat" },
    });
    expect(incomplete.structuredContent).toMatchObject({ complete: false, reason: "binary-file" });
    const invalid = await client.callTool({
      name: "read_release_file",
      arguments: { path: 123 },
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain(directory);
    const badPage = await client.callTool({
      name: "list_release_changes",
      arguments: { pageToken: "../../" },
    });
    expect(badPage.isError).toBe(true);
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      client.callTool(
        {
          name: "read_change_patch",
          arguments: { commit: target, parent: base, path: "notes.txt" },
        },
        { signal: cancelled.signal },
      ),
    ).rejects.toThrow();
  } finally {
    await client.close();
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
