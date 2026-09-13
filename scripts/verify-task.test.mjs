import { describe, expect, it } from "vitest";
import {
  changedPaths,
  classifyTaskChanges,
  parseTaskVerificationArgs,
  plannedTaskTests,
  requiredTaskTests,
  taskGateCommands,
  vitestArgs,
} from "./verify-task.mjs";
import { findPrimaryMergeBase } from "./git-primary-branch.mjs";

describe("verify-task", () => {
  it("requires an explicit focused coverage choice and test paths", () => {
    expect(() => parseTaskVerificationArgs([])).toThrow("--coverage or --no-coverage");
    expect(() => parseTaskVerificationArgs(["--coverage"])).toThrow("test path");
    expect(() => parseTaskVerificationArgs(["--coverage", "test.mjs"])).toThrow("--source");
    const choice = parseTaskVerificationArgs([
      "--coverage",
      "scripts/package-metadata.test.mjs",
      "--source",
      "scripts/verify-task.mjs",
    ]);
    expect(choice).toEqual({
      coverage: true,
      paths: ["scripts/package-metadata.test.mjs"],
      sources: ["scripts/verify-task.mjs"],
    });
    expect(vitestArgs(choice)).toEqual([
      "exec",
      "vitest",
      "run",
      "--coverage",
      "--coverage.include=scripts/verify-task.mjs",
      "scripts/package-metadata.test.mjs",
    ]);
  });

  it("deduplicates repeated coverage source paths in order", () => {
    expect(
      vitestArgs(
        parseTaskVerificationArgs([
          "--coverage",
          "test.mjs",
          "--source",
          "scripts/verify-task.mjs",
          "scripts/verify-task.mjs",
          "scripts/check-cleanup-rules.mjs",
        ]),
      ),
    ).toEqual([
      "exec",
      "vitest",
      "run",
      "--coverage",
      "--coverage.include=scripts/verify-task.mjs",
      "--coverage.include=scripts/check-cleanup-rules.mjs",
      "test.mjs",
    ]);
  });

  it("permits an explicit documentation-or-record no-tests mode only", () => {
    expect(parseTaskVerificationArgs(["--no-tests"])).toEqual({ noTests: true });
    expect(parseTaskVerificationArgs(["--", "--no-tests"])).toEqual({ noTests: true });
    expect(parseTaskVerificationArgs(["--", "--no-coverage", "test.mjs"])).toEqual({
      coverage: false,
      paths: ["test.mjs"],
    });
    expect(() =>
      parseTaskVerificationArgs(["--no-coverage", "test.mjs", "--source", "source.mjs"]),
    ).toThrow("only with --coverage");
    expect(() => parseTaskVerificationArgs(["--no-tests", "test.mjs"])).toThrow("only argument");
  });

  it("skips Proto and TypeDoc gates only for known record or Markdown changes", () => {
    const recordOnly = classifyTaskChanges([
      "build-protocol/tasks/T-0103-wave6-efficiency/TASK.md",
      "README.md",
    ]);

    expect(recordOnly).toEqual({ proto: false, typeDoc: false });
    expect(taskGateCommands(recordOnly)).not.toContain("proto:generate");
    expect(taskGateCommands(recordOnly)).not.toContain("docs:check:generated");
    expect(taskGateCommands(recordOnly)).toContain("docs:audience:check");
  });

  it("fails closed for package source and shared tooling changes", () => {
    for (const path of [
      "packages/core/src/index.ts",
      "scripts/verify-task.mjs",
      "package.json",
      "build-protocol/release/generate-completed-task-integration-inventory.mjs",
    ]) {
      expect(classifyTaskChanges([path])).toEqual({ proto: true, typeDoc: true });
    }
  });

  it("requires repository tests for every non-Markdown classification", () => {
    expect(requiredTaskTests({ proto: false, typeDoc: false })).toEqual([]);
    expect(requiredTaskTests({ proto: true, typeDoc: true })).toEqual(["run", "--passWithNoTests"]);
  });

  it("selects affected package tests but falls back for shared tooling", () => {
    expect(
      requiredTaskTests({ proto: true, typeDoc: true }, ["packages/core/src/index.ts"]),
    ).toEqual(["run", "packages/core/test"]);
    expect(requiredTaskTests({ proto: true, typeDoc: true }, ["scripts/verify-task.mjs"])).toEqual([
      "run",
      "--passWithNoTests",
    ]);
  });

  it("requires every affected package test scope in one coverage-aware invocation", () => {
    const choice = parseTaskVerificationArgs([
      "--coverage",
      "packages/core/test/index.test.ts",
      "packages/server/test/server.test.ts",
      "--source",
      "packages/core/src/index.ts",
    ]);
    expect(
      plannedTaskTests(
        { proto: true, typeDoc: true },
        ["packages/core/src/index.ts", "packages/server/src/index.ts"],
        choice,
      ),
    ).toEqual([
      [
        "exec",
        "vitest",
        "run",
        "--coverage",
        "--coverage.include=packages/core/src/index.ts",
        "packages/core/test",
        "packages/server/test",
      ],
    ]);
  });

  it("does not repeat focused tests already covered by mandatory package or full suites", () => {
    const packageChoice = parseTaskVerificationArgs([
      "--no-coverage",
      "packages/core/test/index.test.ts",
      "packages/core/test/extra.test.ts",
    ]);
    expect(
      plannedTaskTests(
        { proto: true, typeDoc: true },
        ["packages/core/src/index.ts"],
        packageChoice,
      ),
    ).toEqual([["exec", "vitest", "run", "packages/core/test"]]);

    const fullChoice = parseTaskVerificationArgs(["--no-coverage", "scripts/verify-task.test.mjs"]);
    expect(
      plannedTaskTests({ proto: true, typeDoc: true }, ["scripts/verify-task.mjs"], fullChoice),
    ).toEqual([["exec", "vitest", "run", "--passWithNoTests"]]);
  });

  it("adds caller-selected tests that mandatory package coverage does not include", () => {
    const choice = parseTaskVerificationArgs([
      "--no-coverage",
      "packages/core/test/index.test.ts",
      "packages/server/test/server.test.ts",
    ]);

    expect(
      plannedTaskTests({ proto: true, typeDoc: true }, ["packages/core/src/index.ts"], choice),
    ).toEqual([
      ["exec", "vitest", "run", "packages/core/test"],
      ["exec", "vitest", "run", "packages/server/test/server.test.ts"],
    ]);
  });

  it("preserves focused coverage when mandatory package tests subsume its path", () => {
    const choice = parseTaskVerificationArgs([
      "--coverage",
      "packages/core/test/index.test.ts",
      "--source",
      "packages/core/src/index.ts",
    ]);
    expect(
      plannedTaskTests({ proto: true, typeDoc: true }, ["packages/core/src/index.ts"], choice),
    ).toEqual([
      [
        "exec",
        "vitest",
        "run",
        "--coverage",
        "--coverage.include=packages/core/src/index.ts",
        "packages/core/test",
      ],
    ]);
  });

  it("combines coverage mandatory scopes with uncovered caller tests once", () => {
    const choice = parseTaskVerificationArgs([
      "--coverage",
      "packages/core/test/index.test.ts",
      "packages/server/test/server.test.ts",
      "--source",
      "packages/core/src/index.ts",
    ]);
    expect(
      plannedTaskTests({ proto: true, typeDoc: true }, ["packages/core/src/index.ts"], choice),
    ).toEqual([
      [
        "exec",
        "vitest",
        "run",
        "--coverage",
        "--coverage.include=packages/core/src/index.ts",
        "packages/core/test",
        "packages/server/test/server.test.ts",
      ],
    ]);
  });

  it("deduplicates caller test paths before coverage planning", () => {
    const choice = parseTaskVerificationArgs([
      "--coverage",
      "packages/server/test/server.test.ts",
      "packages/server/test/server.test.ts",
      "--source",
      "packages/core/src/index.ts",
    ]);
    expect(
      plannedTaskTests({ proto: true, typeDoc: true }, ["packages/core/src/index.ts"], choice),
    ).toEqual([
      [
        "exec",
        "vitest",
        "run",
        "--coverage",
        "--coverage.include=packages/core/src/index.ts",
        "packages/core/test",
        "packages/server/test/server.test.ts",
      ],
    ]);
  });

  it("plans one coverage-aware full suite for shared changes", () => {
    const choice = parseTaskVerificationArgs([
      "--coverage",
      "scripts/verify-task.test.mjs",
      "--source",
      "scripts/verify-task.mjs",
    ]);
    expect(
      plannedTaskTests({ proto: true, typeDoc: true }, ["scripts/verify-task.mjs"], choice),
    ).toEqual([
      [
        "exec",
        "vitest",
        "run",
        "--coverage",
        "--coverage.include=scripts/verify-task.mjs",
        "--passWithNoTests",
      ],
    ]);
  });

  it("keeps both sides of a rename in the diff classification", () => {
    const { runGit, calls } = gitRunner([
      result("base\n"),
      result("packages/core/src/removed.ts\ndocs/renamed.md\n"),
      result(""),
      result(""),
      result(""),
    ]);

    expect(changedPaths(runGit)).toEqual(["packages/core/src/removed.ts", "docs/renamed.md"]);
    for (const args of calls.filter((args) => args[0] === "diff")) {
      expect(args).toContain("--no-renames");
    }
  });

  it("discovers deleted and untracked source paths", () => {
    const { runGit } = gitRunner([
      result("base\n"),
      result("packages/core/src/deleted.ts\n"),
      result(""),
      result(""),
      result("scripts/untracked-source.mjs\n"),
    ]);

    const paths = changedPaths(runGit);
    expect(paths).toEqual(["packages/core/src/deleted.ts", "scripts/untracked-source.mjs"]);
    expect(classifyTaskChanges(paths)).toEqual({ proto: true, typeDoc: true });
  });

  it("uses origin/master even when origin/main would be usable", () => {
    const { runGit, calls } = gitRunner([result("master-base\n"), result("stale-main-base\n")]);

    expect(findPrimaryMergeBase(runGit)).toBe("master-base");
    expect(calls).toEqual([["merge-base", "origin/master", "HEAD"]]);
  });

  it("classifies changes from origin/master", () => {
    const { runGit, calls } = gitRunner([
      result("base\n"),
      result("docs/changed.md\n"),
      result(""),
      result(""),
      result(""),
    ]);

    expect(changedPaths(runGit)).toEqual(["docs/changed.md"]);
    expect(calls[0]).toEqual(["merge-base", "origin/master", "HEAD"]);
  });

  it("fails closed when Git cannot classify paths or finds none", () => {
    const empty = gitRunner([result("base\n"), result(""), result(""), result(""), result("")]);
    expect(classifyTaskChanges(changedPaths(empty.runGit))).toEqual({ proto: true, typeDoc: true });

    const failed = gitRunner([
      { status: 1, stdout: "" },
      { status: 1, stdout: "" },
    ]);
    expect(classifyTaskChanges(changedPaths(failed.runGit))).toEqual({
      proto: true,
      typeDoc: true,
    });
  });
});

function gitRunner(results) {
  const calls = [];
  return {
    calls,
    runGit(args) {
      calls.push(args);
      return results.shift();
    },
  };
}

function result(stdout) {
  return { status: 0, stdout };
}
