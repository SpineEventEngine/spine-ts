import { describe, expect, it } from "vitest";
import { parseTaskVerificationArgs, vitestArgs } from "./verify-task.mjs";

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
    expect(() => parseTaskVerificationArgs(["--no-tests", "test.mjs"])).toThrow("only argument");
  });
});
