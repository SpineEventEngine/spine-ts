import { describe, expect, it } from "vitest";
import {
  changedPaths,
  classifyTaskChanges,
  parseTaskVerificationArgs,
  taskGateCommands,
  vitestArgs,
} from "./verify-task.mjs";

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

  it("falls back to origin/master when origin/main is unavailable", () => {
    const { runGit, calls } = gitRunner([
      { status: 128, stdout: "" },
      result("base\n"),
      result("docs/changed.md\n"),
      result(""),
      result(""),
      result(""),
    ]);

    expect(changedPaths(runGit)).toEqual(["docs/changed.md"]);
    expect(calls.slice(0, 2)).toEqual([
      ["merge-base", "origin/main", "HEAD"],
      ["merge-base", "origin/master", "HEAD"],
    ]);
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
