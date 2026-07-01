import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = new URL("./check-generated-clean.mjs", import.meta.url).pathname;

function createFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "spine-generated-clean-"));

  run("git", ["init"], repoRoot);
  run("git", ["config", "user.email", "test@example.invalid"], repoRoot);
  run("git", ["config", "user.name", "Test User"], repoRoot);
  writeFileSync(join(repoRoot, ".gitignore"), "packages/proto/generated/\n");
  mkdirSync(join(repoRoot, "packages/proto/generated/spine/core"), { recursive: true });
  writeFileSync(
    join(repoRoot, "packages/proto/generated/spine/core/command_pb.ts"),
    "export const command = 'fresh';\n",
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

function runChecker(repoRoot, expectedGeneratedRoot) {
  return spawnSync(
    process.execPath,
    [scriptPath, "--repo-root", repoRoot, "--expected-generated-root", expectedGeneratedRoot],
    {
      encoding: "utf8",
    },
  );
}

describe("check-generated-clean", () => {
  it("rejects symlinked generated output", () => {
    const repoRoot = createFixture();
    const linkedOutput = join(repoRoot, "linked-generated");
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));

    mkdirSync(linkedOutput, { recursive: true });
    rmSync(join(repoRoot, "packages/proto/generated"), { recursive: true });
    symlinkSync(linkedOutput, join(repoRoot, "packages/proto/generated"), "dir");
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated directory must not be a symlink");
  });

  it("rejects symlinked generated output ancestors", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-generated-clean-"));
    const linkedProtoRoot = mkdtempSync(join(tmpdir(), "spine-linked-proto-"));
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));

    run("git", ["init"], repoRoot);
    writeFileSync(join(repoRoot, ".gitignore"), "packages/proto/generated/\n");
    mkdirSync(join(repoRoot, "packages"), { recursive: true });
    mkdirSync(join(linkedProtoRoot, "generated/spine/core"), { recursive: true });
    writeFileSync(
      join(linkedProtoRoot, "generated/spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );
    symlinkSync(linkedProtoRoot, join(repoRoot, "packages/proto"), "dir");

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Generated path ancestor must not be a symlink: packages/proto",
    );
  });

  it("rejects stale or orphaned generated output compared with clean generation", () => {
    const repoRoot = createFixture();
    const expectedOutput = mkdtempSync(join(tmpdir(), "spine-expected-generated-"));

    writeFileSync(
      join(repoRoot, "packages/proto/generated/spine/core/command_pb.ts"),
      "export const command = 'stale';\n",
    );
    writeFileSync(
      join(repoRoot, "packages/proto/generated/spine/core/orphan_pb.ts"),
      "export const orphan = true;\n",
    );
    mkdirSync(join(expectedOutput, "spine/core"), { recursive: true });
    writeFileSync(
      join(expectedOutput, "spine/core/command_pb.ts"),
      "export const command = 'fresh';\n",
    );

    const result = runChecker(repoRoot, expectedOutput);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Generated proto output is stale.");
    expect(result.stderr).toContain("changed: spine/core/command_pb.ts");
    expect(result.stderr).toContain("unexpected: spine/core/orphan_pb.ts");
  });
});
