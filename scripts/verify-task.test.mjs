import { describe, expect, it } from "vitest";
import {
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
    for (const path of ["packages/core/src/index.ts", "scripts/verify-task.mjs", "package.json"]) {
      expect(classifyTaskChanges([path])).toEqual({ proto: true, typeDoc: true });
    }
  });
});
