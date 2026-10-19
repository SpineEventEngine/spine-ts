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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { GitProject, GitReleaseComparison } from "../src/trusted/git-release.js";

const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const directories: string[] = [];

function repository(): string {
  const directory = mkdtempSync(join(tmpdir(), "spine-release-git-"));
  directories.push(directory);
  git(directory, "init", "--quiet");
  git(directory, "config", "user.name", "Release Fixture");
  git(directory, "config", "user.email", "fixture@example.invalid");
  return directory;
}

function git(directory: string, ...args: string[]): string {
  return execFileSync(gitExecutable, args, { cwd: directory, encoding: "utf8" }).trim();
}

function commit(directory: string, path: string, content: string, subject: string): string {
  writeFileSync(join(directory, path), content);
  git(directory, "add", "--", path);
  git(directory, "commit", "--quiet", "-m", subject);
  return git(directory, "rev-parse", "HEAD");
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("trusted Git release comparison", () => {
  it("lists real local project revisions without returning an unverified ref", async () => {
    const directory = repository();
    commit(directory, "notes.txt", "before\n", "Base");
    commit(directory, "notes.txt", "after\n", "Change");
    git(directory, "tag", "v1.0.0", "HEAD~1");
    const selected = await GitProject.select(directory, gitExecutable);
    expect(selected.repository).toBe(realpathSync(directory));
    expect(selected.refs).toContain("v1.0.0");
    expect(selected.refs).toContain("HEAD");
    expect(selected.refs).toContain("HEAD~1");
    expect(selected.refs).not.toContain("imaginary-branch");
  });
  it("lists every local ref beyond the former 200-ref cap", async () => {
    const directory = repository();
    commit(directory, "notes.txt", "before\n", "Base");
    commit(directory, "notes.txt", "after\n", "Change");
    for (let index = 0; index < 201; index++)
      git(directory, "tag", `release-${String(index).padStart(3, "0")}`);
    const selected = await GitProject.select(directory, gitExecutable);
    expect(selected.refs.filter((ref) => ref.startsWith("release-"))).toHaveLength(201);
  });
  it("pins moved refs and restricts detail reads to verified evidence", async () => {
    const directory = repository();
    const base = commit(directory, "notes.txt", "before\n", "Base release");
    const target = commit(directory, "notes.txt", "after\n", "Explain after release");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base: base.slice(0, 12),
      target: "HEAD",
    });
    expect(comparison.baseCommit).toBe(base);
    expect(comparison.targetCommit).toBe(target);
    expect(comparison.commits.map((entry) => entry.commit)).toEqual([target]);
    expect(comparison.changes.map((entry) => entry.path)).toEqual(["notes.txt"]);
    const listing = comparison.listReleaseChanges();
    expect(listing.complete).toBe(true);
    expect(listing.nextPageToken).toBeUndefined();
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "commit", commit: target }),
        expect.objectContaining({ kind: "change", path: "notes.txt" }),
      ]),
    );
    expect(() => comparison.listReleaseChanges("../../../etc")).toThrow("page token");
    const evidence = comparison.evidence[0];
    if (evidence === undefined) throw new Error("Expected verified change evidence.");
    expect(() => Object.assign(evidence, { path: "elsewhere.txt" })).toThrow();
    expect((await comparison.readChangePatch(evidence)).patch).toContain("+after");
    expect(await comparison.readReleaseFile("notes.txt")).toMatchObject({
      complete: true,
      text: "after\n",
      targetCommit: target,
    });
    commit(directory, "notes.txt", "later\n", "Move HEAD");
    expect((await comparison.readReleaseFile("notes.txt")).text).toBe("after\n");
    await expect(comparison.readReleaseFile("elsewhere.txt")).rejects.toThrow("catalog");
    await expect(
      comparison.readChangePatch({ ...evidence, path: "elsewhere.txt" }),
    ).rejects.toThrow("catalog");
  });

  it("compares divergent selected trees and reads source-only net deletion evidence", async () => {
    const directory = repository();
    const base = commit(directory, "first.txt", "first\n", "Base");
    git(directory, "checkout", "--quiet", "-b", "side");
    const side = commit(directory, "side.txt", "side\n", "Side");
    git(directory, "checkout", "--quiet", "--detach", base);
    const target = commit(directory, "target.txt", "target\n", "Target");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base: "side",
      target: "HEAD",
    });
    expect(comparison.baseCommit).toBe(side);
    expect(comparison.targetCommit).toBe(target);
    expect(comparison.commits.map((entry) => entry.commit)).toEqual([target]);
    expect(comparison.changes).toEqual(
      expect.arrayContaining([
        { path: "side.txt", status: "D" },
        { path: "target.txt", status: "A" },
      ]),
    );
    expect(comparison.evidence.some((entry) => entry.path === "side.txt")).toBe(false);
    expect((await comparison.readNetChangePatch("side.txt")).patch).toContain("-side");
    expect((await comparison.readNetChangePatch("target.txt")).patch).toContain("+target");
    await expect(comparison.readNetChangePatch("first.txt")).rejects.toThrow("catalog");
    git(directory, "branch", "-f", "side", target);
    expect((await comparison.readNetChangePatch("side.txt")).patch).toContain("-side");
  });

  it("compares a reverse range through the direct selected tree difference", async () => {
    const directory = repository();
    const base = commit(directory, "notes.txt", "before\n", "Base");
    const target = commit(directory, "notes.txt", "after\n", "Later");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base: target,
      target: base,
    });
    expect(comparison.commits).toEqual([]);
    expect(comparison.evidence).toEqual([]);
    expect(comparison.changes).toEqual([{ path: "notes.txt", status: "M" }]);
    expect((await comparison.readNetChangePatch("notes.txt")).patch).toContain("+before");
    expect((await comparison.readNetChangePatch("notes.txt")).patch).toContain("-after");
  });

  it("uses repository-root paths when selected from a nested directory", async () => {
    const directory = repository();
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "file.txt"), "root-before\n");
    writeFileSync(join(directory, "nested/file.txt"), "nested-unchanged\n");
    git(directory, "add", "--", "file.txt", "nested/file.txt");
    git(directory, "commit", "--quiet", "-m", "Base");
    const base = git(directory, "rev-parse", "HEAD");
    writeFileSync(join(directory, "file.txt"), "root-after\n");
    git(directory, "commit", "--quiet", "-am", "Change root file");
    const target = git(directory, "rev-parse", "HEAD");
    git(directory, "config", "diff.relative", "true");
    const comparison = await GitReleaseComparison.open({
      repository: join(directory, "nested"),
      gitExecutable,
      base,
      target,
    });
    expect(comparison.changes.map((change) => change.path)).toEqual(["file.txt"]);
    expect(comparison.workerBinding().repository).toBe(realpathSync(directory));
    expect((await comparison.readReleaseFile("file.txt")).text).toBe("root-after\n");
    const evidence = comparison.evidence[0];
    if (!evidence) throw new Error("Expected root path evidence.");
    expect((await comparison.readChangePatch(evidence)).patch).toContain("+root-after");
    expect((await comparison.readChangePatch(evidence)).patch).not.toContain("nested-unchanged");
  });

  it("catalogs both parents of a merge and keeps rename paths literal", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    const mainBranch = git(directory, "symbolic-ref", "--short", "HEAD");
    git(directory, "checkout", "--quiet", "-b", "topic");
    const topic = commit(directory, "a[1].txt", "topic\n", "Topic");
    git(directory, "checkout", "--quiet", mainBranch);
    commit(directory, "other.txt", "other\n", "Other");
    git(directory, "merge", "--quiet", "--no-ff", "topic", "-m", "Merge topic");
    renameSync(join(directory, "a[1].txt"), join(directory, "renamed[1].txt"));
    git(directory, "add", "-A");
    git(directory, "commit", "--quiet", "-m", "Rename literal path");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target: "HEAD",
    });
    const merge = comparison.commits.find((entry) => entry.parents.length === 2);
    expect(merge).toBeDefined();
    expect(
      comparison.evidence.some((entry) => entry.commit === merge?.commit && entry.parent === topic),
    ).toBe(true);
    const renamed = comparison.evidence.find((entry) => entry.path === "renamed[1].txt");
    expect(renamed?.previousPath).toBe("a[1].txt");
    if (!renamed) throw new Error("Expected rename evidence.");
    expect((await comparison.readChangePatch(renamed)).patch).toContain("rename to renamed[1].txt");
    expect((await comparison.readReleaseFile("renamed[1].txt")).text).toBe("topic\n");
  });

  it("reports symlinks and binary content while reading a large committed file", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    writeFileSync(join(directory, "binary.dat"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(directory, "large.txt"), "x".repeat(210_000));
    symlinkSync("base.txt", join(directory, "link.txt"));
    git(directory, "add", "-A");
    git(directory, "commit", "--quiet", "-m", "Add evidence");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target: "HEAD",
    });
    expect(await comparison.readReleaseFile("link.txt")).toMatchObject({
      complete: false,
      reason: "not-regular-file",
    });
    expect(await comparison.readReleaseFile("binary.dat")).toMatchObject({
      complete: false,
      reason: "binary-file",
    });
    const large = await comparison.readReleaseFile("large.txt");
    expect(large.complete).toBe(true);
    expect(large.text).toHaveLength(210_000);
    const binary = comparison.evidence.find((entry) => entry.path === "binary.dat");
    if (!binary) throw new Error("Expected binary evidence.");
    expect(await comparison.readChangePatch(binary)).toMatchObject({
      complete: false,
      reason: "binary-change",
    });
  });

  it("reads committed unusual filenames without consulting the working tree", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    const path = "line\nbreak [*].md";
    const target = commit(directory, path, "committed\n", "Document change");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target,
    });
    writeFileSync(join(directory, path), "uncommitted\n");
    expect(comparison.changes.map((change) => change.path)).toEqual([path]);
    expect((await comparison.readReleaseFile(path)).text).toBe("committed\n");
    const evidence = comparison.evidence[0];
    if (evidence === undefined) throw new Error("Expected verified change evidence.");
    expect((await comparison.readChangePatch(evidence)).patch).toContain("+committed");
  });

  it("continues every catalog page without silently losing entries", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    for (let number = 0; number < 24; number++) {
      writeFileSync(join(directory, `change-${String(number)}.txt`), `${String(number)}\n`);
    }
    git(directory, "add", "-A");
    git(directory, "commit", "--quiet", "-m", "Many changes");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target: "HEAD",
    });
    const entries = [];
    const complete = comparison.listReleaseChanges();
    expect(complete.nextPageToken).toBeUndefined();
    expect(complete.entries).toHaveLength(
      comparison.commits.length + comparison.changes.length + comparison.evidence.length,
    );
    let token: string | undefined;
    do {
      const page = comparison.listReleaseChanges(token, 20);
      entries.push(...page.entries);
      token = page.nextPageToken;
    } while (token !== undefined);
    expect(entries).toHaveLength(
      comparison.commits.length + comparison.changes.length + comparison.evidence.length,
    );
    expect(entries.filter((entry) => entry.kind === "evidence")).toHaveLength(24);
    expect(() => comparison.listReleaseChanges(String(entries.length + 1))).toThrow("page token");
  });

  it("accepts an identical pinned range as empty and rejects a bare repository", async () => {
    const directory = repository();
    const commitId = commit(directory, "notes.txt", "unchanged\n", "Initial release");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base: commitId,
      target: commitId,
    });
    expect(comparison.commits).toEqual([]);
    expect(comparison.changes).toEqual([]);
    expect(comparison.evidence).toEqual([]);
    expect(comparison.listReleaseChanges()).toMatchObject({ entries: [], complete: true });
    const bare = mkdtempSync(join(tmpdir(), "spine-release-bare-"));
    directories.push(bare);
    git(bare, "init", "--quiet", "--bare");
    await expect(
      GitReleaseComparison.open({
        repository: bare,
        gitExecutable,
        base: commitId,
        target: commitId,
      }),
    ).rejects.toThrow("worktree");
  });

  it("accepts a selected range with more than 200 commits", async () => {
    const directory = repository();
    const branch = git(directory, "symbolic-ref", "HEAD");
    const stream = Array.from({ length: 202 }, (_, index) => {
      const subject = index === 0 ? "Base" : `Change ${String(index)}`;
      const content = `${String(index)}\n`;
      return [
        `commit ${branch}`,
        `committer Release Fixture <fixture@example.invalid> ${String(index + 1)} +0000`,
        `data ${String(Buffer.byteLength(subject))}`,
        subject,
        "M 100644 inline notes.txt",
        `data ${String(Buffer.byteLength(content))}`,
        content,
        "",
      ].join("\n");
    }).join("");
    execFileSync(gitExecutable, ["fast-import", "--quiet"], { cwd: directory, input: stream });
    const base = git(directory, "rev-parse", "HEAD~201");
    const target = git(directory, "rev-parse", "HEAD");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target,
    });
    expect(comparison.commits).toHaveLength(201);
  }, 20_000);

  it("rejects cancelled reads and a replaced repository path", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    commit(directory, "change.txt", "change\n", "Change");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target: "HEAD",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(comparison.readReleaseFile("change.txt", controller.signal)).rejects.toThrow(
      "cancelled",
    );
    const moved = `${directory}-moved`;
    directories.push(moved);
    renameSync(directory, moved);
    mkdirSync(directory);
    await expect(comparison.readReleaseFile("change.txt")).rejects.toThrow("repository changed");
  });

  it("reports a missing committed blob as incomplete rather than reading the working tree", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    commit(directory, "change.txt", "committed\n", "Change");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target: "HEAD",
    });
    const blob = git(directory, "rev-parse", "HEAD:change.txt");
    rmSync(join(directory, ".git/objects", blob.slice(0, 2), blob.slice(2)));
    writeFileSync(join(directory, "change.txt"), "uncommitted\n");
    expect(await comparison.readReleaseFile("change.txt")).toMatchObject({
      complete: false,
      reason: "file-unavailable",
    });
  });

  it("accepts full SHA-256 object IDs and rejects an unavailable executable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spine-release-sha256-"));
    directories.push(directory);
    git(directory, "init", "--quiet", "--object-format=sha256");
    git(directory, "config", "user.name", "Release Fixture");
    git(directory, "config", "user.email", "fixture@example.invalid");
    const base = commit(directory, "base.txt", "base\n", "Base");
    const target = commit(directory, "change.txt", "change\n", "Change");
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target,
    });
    expect(comparison.targetCommit).toHaveLength(64);
    expect((await comparison.readReleaseFile("change.txt")).complete).toBe(true);
    await expect(
      GitReleaseComparison.open({
        repository: directory,
        gitExecutable: "/missing/git",
        base,
        target,
      }),
    ).rejects.toThrow();
  });

  it("changes the catalog digest when grafts rewrite traversal without moving commits", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    commit(directory, "middle.txt", "middle\n", "Middle");
    const target = commit(directory, "target.txt", "target\n", "Target");
    const accepted = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target,
    });
    writeFileSync(join(directory, ".git/info/grafts"), `${target} ${base}\n`);
    const altered = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target,
    });
    expect(altered.baseCommit).toBe(accepted.baseCommit);
    expect(altered.targetCommit).toBe(accepted.targetCommit);
    expect(altered.catalogDigest()).not.toBe(accepted.catalogDigest());
  });

  it("honors cancellation and explicit deadline while accepting a large catalog", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    const target = commit(directory, "target.txt", "target\n", "Target");
    const input = { repository: directory, gitExecutable, base, target };
    const controller = new AbortController();
    controller.abort();
    await expect(GitReleaseComparison.open(input, { signal: controller.signal })).rejects.toThrow();
    await expect(GitReleaseComparison.open(input, { deadlineEpochMs: 1 })).rejects.toThrow(
      "deadline",
    );
    const large = "s".repeat(115_000);
    commit(directory, "first.txt", "first\n", large);
    commit(directory, "second.txt", "second\n", large);
    const expanded = await GitReleaseComparison.open({ ...input, target: "HEAD" });
    expect(expanded.commits).toHaveLength(3);
    expect(expanded.commits[1]?.subject).toHaveLength(115_000);
  });

  it("kills an in-flight Git command and never starts the next command after cancellation or deadline", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    const target = commit(directory, "target.txt", "target\n", "Target");
    const executable = join(directory, "slow-git.cjs");
    const invocations = join(directory, "invocations");
    writeFileSync(
      executable,
      `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(invocations)}, 'start\\n');\nsetTimeout(() => process.exit(0), 3000);\n`,
    );
    chmodSync(executable, 0o755);
    const input = { repository: directory, gitExecutable: executable, base, target };
    const waitForInvocations = async (count: number) => {
      for (let index = 0; index < 100; index++) {
        if (
          existsSync(invocations) &&
          readFileSync(invocations, "utf8").trim().split("\n").length >= count
        )
          return;
        await delay(10);
      }
      throw new Error("Git fixture did not start the expected command.");
    };
    const controller = new AbortController();
    const cancelled = GitReleaseComparison.open(input, { signal: controller.signal });
    await waitForInvocations(1);
    controller.abort();
    await expect(cancelled).rejects.toThrow(/cancel/i);
    const expired = GitReleaseComparison.open(input, { deadlineEpochMs: Date.now() + 1_000 });
    await waitForInvocations(2);
    await expect(expired).rejects.toThrow(/deadline/i);
    expect(readFileSync(invocations, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("accepts an unrelated-history root without inventing a parent edge", async () => {
    const directory = repository();
    const base = commit(directory, "base.txt", "base\n", "Base");
    const main = git(directory, "symbolic-ref", "--short", "HEAD");
    git(directory, "checkout", "--quiet", "--orphan", "unrelated");
    git(directory, "rm", "--quiet", "-r", "--cached", ".");
    rmSync(join(directory, "base.txt"));
    commit(directory, "other.txt", "other\n", "Unrelated root");
    git(directory, "checkout", "--quiet", main);
    git(
      directory,
      "merge",
      "--quiet",
      "--allow-unrelated-histories",
      "--no-ff",
      "unrelated",
      "-m",
      "Merge unrelated",
    );
    const comparison = await GitReleaseComparison.open({
      repository: directory,
      gitExecutable,
      base,
      target: "HEAD",
    });
    expect(comparison.commits).toEqual(
      expect.arrayContaining([expect.objectContaining({ parents: [], subject: "Unrelated root" })]),
    );
    expect(
      comparison.evidence.some(
        (entry) => entry.commit === git(directory, "rev-parse", "unrelated"),
      ),
    ).toBe(false);
    expect((await comparison.readNetChangePatch("other.txt")).patch).toContain("+other");
  });
});
