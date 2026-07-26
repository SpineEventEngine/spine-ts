import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { selectFormatFiles, trackedFiles } from "./format-files.mjs";

describe("format-files", () => {
  it("selects only tracked-format paths and skips generated output", () => {
    expect(
      selectFormatFiles([
        "package.json",
        ".prettierrc.json",
        "docs/USER_GUIDE.md",
        "packages/core/src/index.ts",
        "packages/proto/generated/spine/core/command_pb.ts",
        "examples/todo/generated/task_pb.ts",
        "examples/todo/src/index.test.ts",
        "packages/proto/proto/spine/README.md",
        "scripts/proto-workflow.mjs",
        "build-protocol/work-logs/T-0016a.md",
        "src/out-of-scope.ts",
      ]),
    ).toEqual([
      ".prettierrc.json",
      "build-protocol/work-logs/T-0016a.md",
      "docs/USER_GUIDE.md",
      "examples/todo/src/index.test.ts",
      "package.json",
      "packages/core/src/index.ts",
      "packages/proto/proto/spine/README.md",
      "scripts/proto-workflow.mjs",
    ]);
  });

  it("skips deleted paths, retains broken symlinks, and surfaces status failures", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "spine-format-files-"));
    try {
      execFileSync("git", ["init"], { cwd: repoRoot });
      execFileSync("git", ["config", "user.email", "tests@spine.io"], { cwd: repoRoot });
      execFileSync("git", ["config", "user.name", "Spine Tests"], { cwd: repoRoot });
      mkdirSync(join(repoRoot, "scripts"));
      writeFileSync(join(repoRoot, "scripts/kept.mjs"), "export const kept = true;\n");
      writeFileSync(join(repoRoot, "scripts/deleted.mjs"), "export const deleted = true;\n");
      symlinkSync("missing.mjs", join(repoRoot, "scripts/linked.mjs"));
      execFileSync("git", ["add", "."], { cwd: repoRoot });
      execFileSync("git", ["commit", "-m", "fixture"], { cwd: repoRoot });
      rmSync(join(repoRoot, "scripts/deleted.mjs"));

      const tracked = trackedFiles(repoRoot);
      expect(tracked).toContain("scripts/kept.mjs");
      expect(tracked).toContain("scripts/linked.mjs");
      expect(tracked).not.toContain("scripts/deleted.mjs");
      expect(selectFormatFiles(tracked)).toContain("scripts/linked.mjs");

      const failure = Object.assign(new Error("status denied"), { code: "EACCES" });
      expect(() =>
        trackedFiles(repoRoot, () => {
          throw failure;
        }),
      ).toThrow(failure);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
