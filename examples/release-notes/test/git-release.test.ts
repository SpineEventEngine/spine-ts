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
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { GitReleaseComparison } from "../src/trusted/git-release.js";

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

  it("rejects a nonancestor comparison before building a catalog", async () => {
    const directory = repository();
    const base = commit(directory, "first.txt", "first\n", "Base");
    git(directory, "checkout", "--quiet", "-b", "side");
    const side = commit(directory, "side.txt", "side\n", "Side");
    git(directory, "checkout", "--quiet", "--detach", base);
    const target = commit(directory, "target.txt", "target\n", "Target");
    await expect(
      GitReleaseComparison.open({
        repository: directory,
        gitExecutable,
        base: side,
        target,
      }),
    ).rejects.toThrow("ancestor");
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

  it("reports symlinks, binary content, and oversize files as incomplete evidence", async () => {
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
    expect(await comparison.readReleaseFile("large.txt")).toMatchObject({
      complete: false,
      reason: "file-unavailable-or-too-large",
    });
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
    let token: string | undefined;
    do {
      const page = comparison.listReleaseChanges(token);
      entries.push(...page.entries);
      token = page.nextPageToken;
    } while (token !== undefined);
    expect(entries).toHaveLength(
      comparison.commits.length + comparison.changes.length + comparison.evidence.length,
    );
    expect(entries.filter((entry) => entry.kind === "evidence")).toHaveLength(24);
  });

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
      reason: "file-unavailable-or-too-large",
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

  it("stops admission on cancellation, expired deadline, and aggregate catalog bytes", async () => {
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
    await expect(GitReleaseComparison.open({ ...input, target: "HEAD" })).rejects.toThrow(
      /bound|narrow/i,
    );
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

  it("rejects an unrelated-history root before claiming complete per-commit evidence", async () => {
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
    await expect(
      GitReleaseComparison.open({ repository: directory, gitExecutable, base, target: "HEAD" }),
    ).rejects.toThrow("root commit");
  });
});
