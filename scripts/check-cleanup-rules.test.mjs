import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = new URL("./check-cleanup-rules.mjs", import.meta.url).pathname;

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-cleanup-rules-"));

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "test@example.invalid"], repoRoot);
  run("git", ["config", "user.name", "Test User"], repoRoot);
  writeFileSync(join(repoRoot, ".gitignore"), "packages/*/generated/\n");
  mkdirSync(join(repoRoot, "packages/demo/src"), { recursive: true });
  writeFileSync(join(repoRoot, "packages/demo/package.json"), '{"name":"demo"}\n');
  writeFileSync(
    join(repoRoot, "packages/demo/src/index.ts"),
    [
      "export type OnDone = () => void;",
      "export function register(onDone: OnDone, callback: () => void): void {",
      "  onDone();",
      "  callback();",
      "}",
      "",
    ].join("\n"),
  );
  run("git", ["add", "."], repoRoot);
  run("git", ["commit", "-m", "fixture"], repoRoot);

  return repoRoot;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
  }

  return result;
}

function runChecker(repoRoot) {
  return spawnSync(process.execPath, [scriptPath, "--repo-root", repoRoot], {
    encoding: "utf8",
  });
}

describe("check-cleanup-rules", () => {
  it("accepts package source when generated output is ignored and tests live outside src", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "packages/demo/test"), { recursive: true });
    writeFileSync(
      join(repoRoot, "packages/demo/test/index.test.ts"),
      "import '../src/index.js';\n",
    );

    const result = runChecker(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cleanup enforcement checks passed.");
  });

  it("rejects the old generated and test layouts", () => {
    const repoRoot = createFixture();
    mkdirSync(join(repoRoot, "packages/demo/src/generated"), { recursive: true });
    writeFileSync(
      join(repoRoot, "packages/demo/src/generated/demo_pb.ts"),
      "export const x = 1;\n",
    );
    writeFileSync(join(repoRoot, "packages/demo/src/index.test.ts"), "import './index.js';\n");
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "old layout"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tracked generated files under package src");
    expect(result.stderr).toContain("package test files under src");
  });

  it("rejects generated output that is tracked or not ignored", () => {
    const repoRoot = createFixture();
    writeFileSync(join(repoRoot, ".gitignore"), "\n");
    mkdirSync(join(repoRoot, "packages/demo/generated"), { recursive: true });
    writeFileSync(join(repoRoot, "packages/demo/generated/demo_pb.ts"), "export const x = 1;\n");
    run("git", ["add", "-f", "packages/demo/generated/demo_pb.ts", ".gitignore"], repoRoot);
    run("git", ["commit", "-m", "tracked generated"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tracked generated files under packages/*/generated");
    expect(result.stderr).toContain("generated directories not ignored by Git");
  });

  it("rejects long lines, callback names, callback types, and long semantic names", () => {
    const repoRoot = createFixture();
    writeFileSync(
      join(repoRoot, "packages/demo/src/index.ts"),
      [
        "export type FinishedCallback = () => void;",
        "export function register(done: FinishedCallback): void {",
        "  const repeatedSemanticNameWithTooManyParts = '1234567890'.repeat(13) + " +
          "'this line deliberately crosses the one hundred twenty character limit';",
        "  console.log(repeatedSemanticNameWithTooManyParts, done);",
        "}",
        "",
      ].join("\n"),
    );
    run("git", ["add", "."], repoRoot);
    run("git", ["commit", "-m", "bad names"], repoRoot);

    const result = runChecker(repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lines longer than 120 characters");
    expect(result.stderr).toContain("callback type names must start with On");
    expect(result.stderr).toContain("callback names must start with on");
    expect(result.stderr).toContain("semantic name components exceed 4");
  });
});
